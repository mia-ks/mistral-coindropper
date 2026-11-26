import json

d = json.load(open('dump/levels_final.json'))
vis = json.load(open('dump/level_visual.json'))
meshes = json.load(open('dump/level_meshes.json'))

S = d['scale']

def negx(p):  # mirror x (Unity left-handed -> three right-handed), returns new list
    return [-p[0], p[1], p[2]]

def mirror_inst(inst):
    # export_meshes stored pos = negx(p_u) and quat = mirror_quat(q_u) (conjugation by
    # diag(-1,1,1)). With the mesh vertices themselves mirrored below (negx + winding
    # flip), the mirrored-world instance transform is exactly the conjugated one, so the
    # stored values are already correct: M*T_u = (M*T_u*M^-1) * M.
    # The column-major matrix is mirrored by negating row 0 of the row-major form,
    # i.e. column-major elements 0, 4, 8, 12.
    out = dict(inst)
    if inst.get('mat'):
        # with already-mirrored vertices the instance matrix must be the CONJUGATION
        # S*M*S (S = diag(-1,1,1,1)): negate entries where exactly one of row/col is 0.
        # column-major e[j*4+i] = M[i][j] -> negate indices 1,2,3 (col 0) and 4,8,12 (row 0)
        m = inst['mat']
        cm = list(m)
        for i in (1, 2, 3, 4, 8, 12):
            cm[i] = -m[i]
        out['mat'] = cm
    if inst.get('aabb'):
        out['aabb'] = negx_box(inst['aabb'])
    return out

def mirror_mesh(m):
    # true global mirror of geometry: x -> -x plus reversed winding so normals stay outward
    subs = []
    for s in m['subs']:
        pos = [[-p[0], p[1], p[2]] for p in s['pos']]
        idx = []
        for t in range(0, len(s['idx']), 3):
            idx.extend([s['idx'][t], s['idx'][t + 2], s['idx'][t + 1]])
        sub = {'pos': pos, 'idx': idx}
        if s.get('nrm'):
            sub['nrm'] = [[-n[0], n[1], n[2]] for n in s['nrm']]
        if s.get('uv'):
            sub['uv'] = [list(u) for u in s['uv']]
        if s.get('col'):
            sub['col'] = [list(c) for c in s['col']]
        subs.append(sub)
    return {'name': m['name'], 'subs': subs}

def negx_box(b):  # {min:[x,y,z], max:[x,y,z]} -> mirrored with min/max swapped in x
    if not b: return None
    return {'min': [-b['max'][0], b['min'][1], b['min'][2]], 'max': [-b['min'][0], b['max'][1], b['max'][2]]}

out = {'scale': S, 'coins': d['coins'], 'levels': {}}
for nm, s in d['levels'].items():
    lvl = {
        'goal': s.get('goal'),
        'camera': s.get('camera'),
        'spawn': s.get('spawn'),
        'collector': s.get('collector'),
        'tiers': [],
        'machines': s.get('machines', []),
    }
    v = vis.get(nm, {})
    m = meshes.get(nm, {})
    # mesh camera (handedness-converted pos+quat)
    if m.get('camera'):
        lvl['cameraGL'] = m['camera']
    for t in s.get('tiers', []):
        tv = v.get('tiers', {}).get(t['name'], {}).get('visual') or t.get('visual')
        pusher = None
        if t.get('pusher'):
            p = t['pusher']
            # derive sweep axis/sign in UNITY coords, then mirror: an x-mirror flips the
            # x component of the push direction (min/max swap), z is unchanged
            f, b = t['floor'], p['box']
            dx = (f['min'][0] + f['max'][0]) / 2 - (b['min'][0] + b['max'][0]) / 2
            dz = (f['min'][2] + f['max'][2]) / 2 - (b['min'][2] + b['max'][2]) / 2
            axis_u = 'x' if abs(dx) >= abs(dz) else 'z'
            sign_u = 1 if (dx if axis_u == 'x' else dz) >= 0 else -1
            pusher = {
                **p,
                'pos': negx(p['pos']),
                'box': negx_box(p['box']),
                'axis': axis_u,
                'sign': sign_u if axis_u == 'z' else -sign_u,
            }
        lvl['tiers'].append({
            'name': t['name'],
            'pos': negx(t['pos']),
            'yaw': -t['yaw'],
            'floor': negx_box(t['floor']),
            'visual': negx_box(tv),
            'pusher': pusher,
        })
    if v.get('bg'):
        bg = dict(v['bg'])
        bg['pos'] = negx(bg['pos'])
        lvl['bg'] = bg
    vms = v.get('machines', [])
    for mm in lvl['machines']:
        mm['pos'] = negx(mm['pos'])
        mm['yaw'] = -mm.get('yaw', 0)  # x-mirror maps yaw -> -yaw for local +z directions
        if mm.get('box'): mm['box'] = negx_box(mm['box'])
        if mm.get('visual'): mm['visual'] = negx_box(mm['visual'])
        if mm.get('exit'):
            mm['exit']['pos'] = negx(mm['exit']['pos'])
            mm['exit']['yaw'] = -mm['exit'].get('yaw', 0)
        for vm in vms:
            if vm['go'] == mm['go']:
                mm['visual'] = negx_box(vm.get('visual')) or mm.get('visual')
    if s.get('spawn'):
        lvl['spawn'] = dict(s['spawn'])
        lvl['spawn']['pos'] = negx(s['spawn']['pos'])
        if s['spawn'].get('point'): lvl['spawn']['point'] = negx(s['spawn']['point'])
    if s.get('collector'):
        lvl['collector'] = dict(s['collector'])
        lvl['collector']['pos'] = negx(s['collector']['pos'])
        if s['collector'].get('box'): lvl['collector']['box'] = negx_box(s['collector']['box'])
    if m:
        lvl['meshData'] = {'instances': [mirror_inst(i) for i in m.get('instances', [])],
                           'dozers': [mirror_inst(d) for d in m.get('dozers', [])]}
    out['levels'][nm] = lvl

header = """// GENERATED by re/gen_js2.py from re/dump/levels_final.json + level_visual.json + level_meshes.json
// (Unity level prefab hierarchies, parent-resolved WORLD transforms, mirrored x for
//  right-handed three.js; real mesh instances in meshData). Do not edit by hand.
"""
body = 'const LEVEL_LAYOUTS = ' + json.dumps(out, separators=(',', ':')) + ';\n'
body += "if (typeof module !== 'undefined' && module.exports) module.exports = { LEVEL_LAYOUTS };\n"
open('/workspace/coindozer-clean/js/level_layouts.js', 'w').write(header + body)
print('wrote js/level_layouts.js', len(body) // 1024, 'KB')

# global mesh library -> js/meshlib.js
lib = json.load(open('dump/meshes_global.json'))
lib = {k: mirror_mesh(g) for k, g in lib.items()}
mats = json.load(open('dump/materials.json'))
ml = 'const MESH_LIB = ' + json.dumps(lib, separators=(',', ':')) + ';\n'
ml += 'const MESH_MATS = ' + json.dumps(mats, separators=(',', ':')) + ';\n'
ml += "if (typeof module !== 'undefined' && module.exports) module.exports = { MESH_LIB, MESH_MATS };\n"
open('/workspace/coindozer-clean/js/meshlib.js', 'w').write('// GENERATED by re/export_meshes.py + re/gen_js2.py (original Unity meshes/materials, quantized) - do not edit\n' + ml)
print('wrote js/meshlib.js', len(ml) // 1024, 'KB')

# fixture (mirrored positions)
fix = {'scale': S, 'levels': {}}
for nm, s in d['levels'].items():
    lvl = out['levels'][nm]
    fix['levels'][nm] = {
        'goal': s.get('goal'),
        'camera': lvl.get('cameraGL') or s.get('camera'),
        'spawn': {k: lvl['spawn'].get(k) for k in ('maxCharges', 'refillInterval', 'chargesPerRefill', 'guaranteedBronzeCoinCount')} if lvl.get('spawn') else None,
        'tierCount': len(lvl['tiers']),
        'machineTypes': sorted(mm['type'] for mm in lvl['machines']),
        'machinePositions': [[mm['type'], mm['pos']] for mm in lvl['machines']],
        'collectorPos': lvl.get('collector', {}).get('pos'),
    }
json.dump(fix, open('/workspace/coindozer-clean/test/fixture-levels.json', 'w'), indent=1)
print('wrote test/fixture-levels.json')
