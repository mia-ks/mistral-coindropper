import UnityPy, json, math, re
from collections import defaultdict

META = 'apk/assets/bin/Data/Managed/Metadata/global-metadata.dat'
BUNDLE = 'apk/assets/aa/Android/defaultlocalgroup_assets_all_6e3d21aa82e0517f4a989c3366e60035.bundle'
MONO = 'apk/assets/aa/Android/8713be536fd0486a5bd5802129e5a43d_monoscripts_5cd2d5200e2a5c34818482f4e4949011.bundle'

env = UnityPy.load(BUNDLE, META, MONO)

scripts, names, meshname = {}, {}, {}
tf, go_of_tf, go_comps = {}, {}, defaultdict(list)

for o in env.objects:
    t = o.type.name
    try:
        if t == 'MonoScript':
            d = o.read_typetree()
            scripts[o.path_id] = ((d.get('m_Namespace','') + '.' + d.get('m_ClassName','')).strip('.'))
        elif t == 'GameObject':
            d = o.read_typetree()
            names[o.path_id] = d.get('m_Name', '')
            for c in d.get('m_Component', []):
                pid = c.get('component', {}).get('m_PathID')
                if pid: go_comps[o.path_id].append(pid)
        elif t in ('Transform', 'RectTransform'):
            d = o.read_typetree()
            p = d.get('m_LocalPosition', {}); r = d.get('m_LocalRotation', {}); s = d.get('m_LocalScale', {})
            tf[o.path_id] = {'go': d['m_GameObject']['m_PathID'], 'father': d['m_Father']['m_PathID'],
                             'pos': (p.get('x',0), p.get('y',0), p.get('z',0)),
                             'quat': (r.get('x',0), r.get('y',0), r.get('z',0), r.get('w',1)),
                             'scale': (s.get('x',1), s.get('y',1), s.get('z',1))}
            go_of_tf[o.path_id] = d['m_GameObject']['m_PathID']
        elif t == 'Mesh':
            meshname[o.path_id] = o.read_typetree().get('m_Name', '')
    except Exception:
        pass

tf_of_go = {}
for tid, g in go_of_tf.items(): tf_of_go.setdefault(g, tid)

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz)
def qrot(q, v):
    x, y, z, w = q
    uvx, uvy, uvz = (y*v[2]-z*v[1], z*v[0]-x*v[2], x*v[1]-y*v[0])
    return (v[0] + 2*(w*uvx + y*uvz - z*uvy), v[1] + 2*(w*uvy + z*uvx - x*uvz), v[2] + 2*(w*uvz + x*uvy - y*uvx))
def sapply(s, v): return (s[0]*v[0], s[1]*v[1], s[2]*v[2])

WORLD = {}
def world(tid):
    if tid in WORLD: return WORLD[tid]
    d = tf[tid]
    f = d['father']
    if f in tf:
        pw, wq, ws = world(f)
        lp = qrot(wq, sapply(ws, d['pos']))
        WORLD[tid] = ((pw[0]+lp[0], pw[1]+lp[1], pw[2]+lp[2]), qmul(wq, d['quat']),
                      (ws[0]*d['scale'][0], ws[1]*d['scale'][1], ws[2]*d['scale'][2]))
    else:
        WORLD[tid] = (d['pos'], d['quat'], d['scale'])
    return WORLD[tid]

def yaw(q):
    x, y, z, w = q
    return math.degrees(math.atan2(2*(w*y + x*z), 1 - 2*(y*y + x*x)))

def children(tid): return [t for t, d in tf.items() if d['father'] == tid]

def comps_of_go(go):
    out = []
    for pid in go_comps.get(go, []):
        for o in env.objects:
            if o.path_id == pid:
                t = o.type.name
                if t == 'MonoBehaviour':
                    try:
                        tt = o.read_typetree()
                        cls = scripts.get(tt.get('m_Script', {}).get('m_PathID'), 'Unknown')
                        fields = {k: v for k, v in tt.items() if k not in ('m_GameObject','m_Enabled','m_Script','m_Name','m_EditorClassIdentifier')}
                        out.append(('MB', cls, fields))
                    except Exception: pass
                elif t in ('BoxCollider','SphereCollider','CapsuleCollider','MeshCollider'):
                    try:
                        d = o.read_typetree()
                        out.append(('COL', t, d))
                    except Exception: pass
                elif t == 'MeshFilter':
                    try:
                        d = o.read_typetree()
                        out.append(('MESH', meshname.get(d['m_Mesh']['m_PathID'], '?'), {}))
                    except Exception: pass
                elif t == 'Rigidbody':
                    try:
                        d = o.read_typetree()
                        out.append(('RB', 'Rigidbody', {'isKinematic': d.get('m_IsKinematic'), 'mass': d.get('m_Mass'), 'useGravity': d.get('m_UseGravity')}))
                    except Exception: pass
                break
    return out

def clean(v, depth=0):
    if depth > 6: return '...'
    if isinstance(v, dict):
        if 'm_PathID' in v and len(v) <= 2: return f'PPtr({v["m_PathID"]})'
        return {k: clean(x, depth+1) for k, x in v.items() if k not in ('m_FileID',)}
    if isinstance(v, list): return [clean(x, depth+1) for x in v]
    if isinstance(v, float): return round(v, 5)
    return v

def resolve_pptr(v):
    if isinstance(v, dict) and 'm_PathID' in v and len(v) <= 2:
        pid = v['m_PathID']
        if pid in tf:
            w = world(pid)
            return {'pos': [round(x,4) for x in w[0]], 'yaw': round(yaw(w[1]),2)}
        if pid in names: return {'name': names[pid]}
    if isinstance(v, dict): return {k: resolve_pptr(x) for k, x in v.items()}
    if isinstance(v, list): return [resolve_pptr(x) for x in v]
    return v

def walk(tid, path, acc):
    d = tf[tid]
    go = d['go']
    pos, quat, scale = world(tid)
    node = {'path': path + '/' + names.get(go, '?'), 'go': go, 'tf': tid,
            'name': names.get(go, '?'),
            'pos': [round(v, 4) for v in pos], 'yaw': round(yaw(quat), 2),
            'quat': [round(v, 5) for v in quat], 'scale': [round(v, 4) for v in scale],
            'comps': []}
    for kind, a, b in comps_of_go(go):
        if kind == 'MB': node['comps'].append({'kind': 'MB', 'class': a, 'fields': clean(b)})
        elif kind == 'COL':
            f = {}
            for k in ('m_Size','m_Center','m_Radius','m_Height','m_Direction','m_IsTrigger','m_Enabled'):
                if k in b: f[k] = clean(b[k])
            node['comps'].append({'kind': 'COL', 'type': a, 'fields': f})
        elif kind == 'MESH': node['comps'].append({'kind': 'MESH', 'mesh': a})
        elif kind == 'RB': node['comps'].append({'kind': 'RB', 'fields': clean(b)})
    acc.append(node)
    for ch in children(tid):
        walk(ch, node['path'], acc)

roots = {}
for tid, d in tf.items():
    if d['father'] == 0 and re.match(r'^Level \d+$', names.get(d['go'], '')):
        roots[names[d['go']]] = tid

out = {'levels': {}}
for nm in sorted(roots, key=lambda s: int(s.split()[1])):
    acc = []
    walk(roots[nm], '', acc)
    out['levels'][nm] = acc

# coin prefabs: resolve CoinSpawnController coinPrefabs from scene-ish spawner in aa? find all CoinController MBs
print('=== coin prefabs ===')
coins = {}
for o in env.objects:
    if o.type.name == 'MonoBehaviour':
        try:
            tt = o.read_typetree()
            cls = scripts.get(tt.get('m_Script', {}).get('m_PathID'), '')
            if cls.endswith('CoinController'):
                go = tt['m_GameObject']['m_PathID']
                tid = tf_of_go.get(go)
                w = world(tid) if tid else None
                f = clean({k: v for k, v in tt.items() if k not in ('m_GameObject','m_Enabled','m_Script','m_Name')})
                info = {'name': names.get(go), 'worldPos': [round(v,4) for v in w[0]] if w else None,
                        'scale': [round(v,4) for v in w[2]] if w else None, 'fields': f, 'comps': []}
                for kind, a, b in comps_of_go(go):
                    if kind == 'COL':
                        info['comps'].append({'type': a, 'fields': {k: clean(b[k]) for k in ('m_Size','m_Center','m_Radius','m_Height','m_Direction') if k in b}})
                    elif kind == 'MESH': info['comps'].append({'mesh': a})
                coins[names.get(go)] = info
                print(names.get(go), json.dumps(info, default=str)[:500])
        except Exception:
            pass
out['coins'] = coins

json.dump(out, open('dump/level_world2.json', 'w'), default=str)
print('wrote dump/level_world2.json, levels:', len(out['levels']), 'coins:', list(coins))

# quick view: Level 1 tiers and camera bounds
L = out['levels']['Level 1']
for n in L:
    if n['path'].count('/') <= 2:
        cls = [c['class'].split('.')[-1] for c in n['comps'] if c['kind'] == 'MB']
        cols = [c for c in n['comps'] if c['kind'] == 'COL']
        if cls or n['name'].startswith(('Pusher', 'Coin', 'Limits', 'BG')):
            print(n['path'], n['pos'], 'yaw', n['yaw'], 'scale', n['scale'], cls, json.dumps(cols)[:220])
