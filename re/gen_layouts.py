import json, math, re, unityload as U

L = U.load()
W = U.World(L)
S = 10.0  # world scale: level units -> game units

def r3(v): return [round(x * S, 4) for x in v]

def wpos(tid): return W.world2(tid)[0]
def wyaw(tid): return W.world2(tid)[1]
def wscale(tid): return W.world2(tid)[2]
def wmat(tid): return W.world_mat(tid)

def world_aabb(node_tf):
    mesh, aabb = W.mesh_of({'comps': [c for c in W.comps(L['tf'][node_tf]['go']) if c['kind'] == 'MESH']})
    if not aabb: return None
    m = wmat(node_tf)
    c, e = aabb['center'], aabb['extent']
    corners = []
    for dx in (-1, 1):
        for dy in (-1, 1):
            for dz in (-1, 1):
                corners.append(U.xform(m, (c[0]+dx*e[0], c[1]+dy*e[1], c[2]+dz*e[2])))
    xs = [c[0] for c in corners]; ys = [c[1] for c in corners]; zs = [c[2] for c in corners]
    return {'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)]}

def col_world_aabb(go, col):
    tid = W.tf_of_go(go)
    m = wmat(tid)
    f = col['fields']
    if col['type'] == 'BoxCollider':
        c = f.get('m_Center', {}); sz = f.get('m_Size', {})
        c = (c.get('x',0), c.get('y',0), c.get('z',0)); sz = (sz.get('x',0), sz.get('y',0), sz.get('z',0))
        corners = []
        for dx in (-1,1):
            for dy in (-1,1):
                for dz in (-1,1):
                    corners.append(U.xform(m, (c[0]+dx*sz[0]/2, c[1]+dy*sz[1]/2, c[2]+dz*sz[2]/2)))
    elif col['type'] == 'MeshCollider':
        mp = f.get('m_Mesh', {})
        pid = mp.get('m_PathID') if isinstance(mp, dict) else None
        aabb = None
        for tag in ('aa', 'data'):
            if (tag, pid) in L['meshaabb']:
                aabb = L['meshaabb'][(tag, pid)]; break
        if not aabb: return None
        c, e = aabb['center'], aabb['extent']
        corners = []
        for dx in (-1,1):
            for dy in (-1,1):
                for dz in (-1,1):
                    corners.append(U.xform(m, (c[0]+dx*e[0], c[1]+dy*e[1], c[2]+dz*e[2])))
    else:
        return None
    xs=[p[0] for p in corners]; ys=[p[1] for p in corners]; zs=[p[2] for p in corners]
    return {'min':[min(xs),min(ys),min(zs)], 'max':[max(xs),max(ys),max(zs)],
            'trigger': bool(f.get('m_IsTrigger')), 'enabled': bool(f.get('m_Enabled',1)),
            'go': L['names'].get(go, '?'), 'col': col['type'], 'goPid': go[1],
            'active': bool(L['go_active'].get(go, 1))}

def descendants(tid):
    out = []
    def rec(t):
        out.append(t)
        for ch in W.children(t): rec(ch)
    rec(tid)
    return out

def find_mb(nodes, cls_suffix):
    for t in nodes:
        for c in W.comps(L['tf'][t]['go']):
            if c['kind'] == 'MB' and c['class'].endswith(cls_suffix):
                return t, c
    return None, None

INTERACTIONS = ['PusherInteraction','ConveyorBeltInteraction','FanInteraction','MagnetInteraction','MovingMagnetInteraction',
                'LaserInteraction','TeslaCoilInteraction','PortalInteraction','MultiplyingGateInteraction','DollarGateInteraction',
                'SpikeInteraction','MovingPlatformInteraction','CoinCollectorInteraction']

levels = {}
roots = sorted([k for k, d in L['tf'].items() if k[0] == 'aa' and d['father'] == ('aa', 0) and re.match(r'^Level \d+$', L['names'].get(d['go'], ''))],
               key=lambda k: int(L['names'][L['tf'][k]['go']].split()[1]))

for root in roots:
    nm = L['names'][L['tf'][root]['go']]
    nodes = descendants(root)
    spec = {'level': int(nm.split()[1])}

    # goal + camera
    t, c = find_mb(nodes, '.Level')
    if c: spec['goal'] = U.clean(c['fields']).get('targetCoins')
    t, c = find_mb(nodes, 'LevelCameraBounds')
    if c:
        f = U.resolve_pptr(L, W, U.clean(c['fields']))
        spec['camera'] = {'pos': r3(f['zoomInMarker']['pos']), 'fov': f.get('fieldOfView', 20),
                          'euler': [f['rotationEuler']['x'], f['rotationEuler']['y'], f['rotationEuler']['z']],
                          'zoomOut': r3(f['zoomOutMarker']['pos'])}

    # tiers: direct children named Pusher / Pusher (n)
    tiers = []
    for ch in W.children(root):
        gonm = L['names'][L['tf'][ch]['go']]
        if not re.match(r'^Pusher( \(\d+\))?$', gonm): continue
        cp = wpos(ch)
        sub = descendants(ch)
        # the moving dozer assembly = the inner 'Pusher' node (parent of the node carrying
        # PusherInteraction) and all its descendants; NEVER treat these as the floor
        dt, dc = find_mb(sub, 'PusherInteraction')
        assembly = set(descendants(L['tf'][dt]['father'])) if dt else set()
        # all enabled non-trigger collider AABBs under the tier, excluding the moving assembly
        boxes = []
        for t in sub:
            if t in assembly: continue
            for c in W.comps(L['tf'][t]['go']):
                if c['kind'] == 'COL':
                    a = col_world_aabb(L['tf'][t]['go'], c)
                    if a and a['enabled'] and not a['trigger']:
                        a['area'] = (a['max'][0]-a['min'][0]) * (a['max'][2]-a['min'][2])
                        boxes.append(a)
        max_area = max((b['area'] for b in boxes), default=0)
        big = [b for b in boxes if b['area'] >= 0.5 * max_area]
        floor_top = min(b['max'][1] for b in big) if big else None
        floor_cols = [b for b in big if b['max'][1] <= floor_top + 0.02 * S] if floor_top is not None else []
        floor_sources = [{'go': b['go'], 'col': b['col'], 'goPid': b.get('goPid'), 'min': [round(v*S,4) for v in b['min']], 'max': [round(v*S,4) for v in b['max']]} for b in floor_cols]
        # retaining walls = the remaining solid colliders under the tier (they may sit on
        # GameObjects that are inactive in the prefab but carry enabled colliders and are
        # activated during play - dropping them was the source of exposed perimeter gaps)
        walls = [{'go': b['go'], 'col': b['col'], 'goPid': b.get('goPid'), 'active': b['active'],
                  'min': [round(v*S,4) for v in b['min']], 'max': [round(v*S,4) for v in b['max']]}
                 for b in boxes if b not in floor_cols]
        if floor_cols:
            floor = {'min': [min(b['min'][0] for b in floor_cols), floor_top, min(b['min'][2] for b in floor_cols)],
                     'max': [max(b['max'][0] for b in floor_cols), floor_top, max(b['max'][2] for b in floor_cols)],
                     'sources': floor_sources}
        else:
            floor = None
        # visual bounds: union of all descendant mesh AABBs
        vmin = [1e9, 1e9, 1e9]; vmax = [-1e9, -1e9, -1e9]
        for t in sub:
            a = world_aabb(t)
            if a:
                for i in range(3):
                    vmin[i] = min(vmin[i], a['min'][i]); vmax[i] = max(vmax[i], a['max'][i])
        visual = {'min': [round(v*S,4) for v in vmin], 'max': [round(v*S,4) for v in vmax]} if vmax[0] > -1e8 else None
        # pusher dozer: controller origin (inner Pusher node world pos), sweep axis resolved
        # from the Dozer node's world matrix local +Z (PusherInteraction.direction == 2),
        # and travel = distance from the plate's leading edge at rest to the floor's open edge
        pusher = None
        if dt:
            inner = L['tf'][dt]['father']
            origin = wpos(inner)
            m = wmat(dt)
            fwd = (m[0][2], m[1][2], m[2][2])  # world-space local +Z of the controller node
            ai = max(range(3), key=lambda i: abs(fwd[i]))
            axis_u = 'xyz'[ai]
            sign_u = 1 if fwd[ai] >= 0 else -1
            dp = wpos(dt)
            pf = U.clean(dc['fields'])
            box = next((c for c in W.comps(L['tf'][dt]['go']) if c['kind'] == 'COL' and c['type'] == 'BoxCollider'), None)
            pb = col_world_aabb(L['tf'][dt]['go'], box) if box else None
            pusher = {'pos': r3(dp), 'yaw': round(wyaw(dt), 2),
                      'box': {'min': [round(v*S,4) for v in pb['min']], 'max': [round(v*S,4) for v in pb['max']]} if pb else None,
                      'speed': pf.get('speed'), 'backHoldDuration': pf.get('backHoldDuration'),
                      'direction': pf.get('direction'), 'minDistance': pf.get('minDistance'), 'maxDistance': pf.get('maxDistance'),
                      'origin': r3(origin), 'fwd': [round(v, 4) for v in fwd],
                      'axis': axis_u, 'sign': sign_u}
            if pb and floor and axis_u in ('x', 'z'):
                a = 0 if axis_u == 'x' else 2
                tr = (floor['max'][a] - pb['max'][a]) if sign_u > 0 else (pb['min'][a] - floor['min'][a])
                pusher['travel'] = round(max(0.0, tr) * S, 4)
            # the DozerWall (moving back wall of the assembly) as a collider box
            wall_box = None
            for t2 in sub:
                if t2 in assembly and L['names'][L['tf'][t2]['go']] == 'DozerWall':
                    wc = next((c for c in W.comps(L['tf'][t2]['go']) if c['kind'] == 'COL' and c['fields'].get('m_Enabled', 1) and not c['fields'].get('m_IsTrigger')), None)
                    if wc:
                        wa = col_world_aabb(L['tf'][t2]['go'], wc)
                        if wa: wall_box = {'min': [round(v*S,4) for v in wa['min']], 'max': [round(v*S,4) for v in wa['max']]}
            if wall_box: pusher['wall'] = wall_box
        tiers.append({'name': gonm, 'pos': r3(cp), 'yaw': round(wyaw(ch), 2),
                      'floor': {'min': [round(v*S,4) for v in floor['min']], 'max': [round(v*S,4) for v in floor['max']], 'sources': floor_sources} if floor else None,
                      'walls': walls,
                      'visual': visual, 'pusher': pusher})
    # level-level solid colliders outside the tiers (chute walls, base columns): exclude
    # machines (handled via their zones), the background, and anything under a tier
    tier_node_set = set()
    for ch in W.children(root):
        if re.match(r'^Pusher( \(\d+\))?$', L['names'][L['tf'][ch]['go']]):
            tier_node_set |= set(descendants(ch))
    all_root_nodes = descendants(root)
    lvl_walls = []
    for t in all_root_nodes:
        if t in tier_node_set: continue
        go = L['tf'][t]['go']; gonm = L['names'].get(go, '?')
        if gonm == 'BG_New': continue
        has_mb_interaction = any(c['kind'] == 'MB' and any(c['class'].endswith(x) for x in INTERACTIONS) for c in W.comps(go))
        if has_mb_interaction: continue
        for c in W.comps(go):
            if c['kind'] == 'COL':
                a = col_world_aabb(go, c)
                if a and a['enabled'] and not a['trigger']:
                    lvl_walls.append({'go': gonm, 'col': a['col'], 'goPid': go[1], 'active': a['active'],
                                      'min': [round(v*S,4) for v in a['min']], 'max': [round(v*S,4) for v in a['max']]})
    spec['walls'] = lvl_walls
    spec['tiers'] = tiers

    # machines
    machines = []
    for t in nodes:
        go = L['tf'][t]['go']
        for c in W.comps(go):
            if c['kind'] == 'MB' and any(c['class'].endswith(x) for x in INTERACTIONS) and not c['class'].endswith('PusherInteraction') and not c['class'].endswith('CoinCollectorInteraction'):
                p = wpos(t)
                f = U.resolve_pptr(L, W, U.clean(c['fields']))
                f = {k: v for k, v in f.items() if not isinstance(v, (dict, list)) or k in ('rotationEuler',)}
                box = next((c2 for c2 in W.comps(go) if c2['kind'] == 'COL' and c2['type'] == 'BoxCollider'), None)
                bb = col_world_aabb(go, box) if box else None
                tier = None
                exit_info = None
                if c['class'].endswith('PortalInteraction'):
                    par = L['tf'][t]['father']
                    for sib in W.children(par):
                        snm = L['names'][L['tf'][sib]['go']]
                        if 'Out' in snm and 'Portal' in snm:
                            exit_info = {'pos': r3(wpos(sib)), 'yaw': round(wyaw(sib), 2)}
                machines.append({'type': c['class'].split('.')[-1].replace('Interaction', ''),
                                 'go': L['names'][go], 'pos': r3(p), 'yaw': round(wyaw(t), 2),
                                 '_node': t,
                                 'tier': tier, 'exit': exit_info, 'params': f,
                                 'box': {'min': [round(v*S,4) for v in bb['min']], 'max': [round(v*S,4) for v in bb['max']], 'trigger': bool(bb['trigger'])} if bb else None})
    # assign each machine to the tier whose floor contains it (highest such tier)
    for m in machines:
        best = None
        for t in tiers:
            if not t['floor']: continue
            f = t['floor']
            if f['min'][0]-1 <= m['pos'][0] <= f['max'][0]+1 and f['min'][2]-1 <= m['pos'][2] <= f['max'][2]+1:
                if m['pos'][1] >= f['min'][1] - 1 and (best is None or f['min'][1] > best['floor']['min'][1]):
                    best = t
        m['tier'] = best['name'] if best else None
    spec['machines'] = machines

    # collector
    t, c = find_mb(nodes, 'CoinCollectorInteraction')
    if t:
        p = wpos(t)
        box = next((c2 for c2 in W.comps(L['tf'][t]['go']) if c2['kind'] == 'COL' and c2['type'] == 'BoxCollider'), None)
        bb = col_world_aabb(L['tf'][t]['go'], box) if box else None
        spec['collector'] = {'pos': r3(p), 'yaw': round(wyaw(t), 2),
                             'box': {'min': [round(v*S,4) for v in bb['min']], 'max': [round(v*S,4) for v in bb['max']]} if bb else None}

    # spawn
    t, c = find_mb(nodes, 'CoinSpawnController')
    if t:
        p = wpos(t)
        f = U.resolve_pptr(L, W, U.clean(c['fields']))
        spec['spawn'] = {'pos': r3(p), 'point': r3(f['spawnPoint']['pos']) if f.get('spawnPoint') else None,
                         'maxCharges': f.get('maxCharges'), 'refillInterval': f.get('refillInterval'),
                         'chargesPerRefill': f.get('chargesPerRefill'), 'guaranteedBronzeCoinCount': f.get('guaranteedBronzeCoinCount')}

    # per-machine visual AABBs (union of descendant mesh AABBs, matrix-correct) + bg
    vis = {'tiers': {t['name']: {'visual': t['visual']} for t in tiers}, 'machines': [], 'bg': None}
    for m in machines:
        vmin = [1e9]*3; vmax = [-1e9]*3
        for dt in descendants(m['_node']):
            a = world_aabb(dt)
            if a:
                for i in range(3):
                    vmin[i] = min(vmin[i], a['min'][i]); vmax[i] = max(vmax[i], a['max'][i])
        mv = {'min': [round(v*S,4) for v in vmin], 'max': [round(v*S,4) for v in vmax]} if vmax[0] > -1e8 else None
        vis['machines'].append({'go': m['go'], 'type': m['type'], 'pos': m['pos'], 'visual': mv})
        del m['_node']
    for t in nodes:
        if L['names'][L['tf'][t]['go']] == 'BG_New':
            a = world_aabb(t)
            if a:
                p = wpos(t); sc = wscale(t)
                vis['bg'] = {'pos': r3(p), 'scale': [round(v,4) for v in sc],
                             'meshSize': [round(2*(a['max'][i]-a['min'][i])*S,4) for i in range(3)]}
    spec['visual'] = vis

    levels[nm] = spec

# coins
coins = {}
for o in L['env'].objects:
    if o.type.name == 'MonoBehaviour':
        try:
            tt = o.read_typetree()
            cls = L['scripts'].get(('aa', tt.get('m_Script', {}).get('m_PathID')), '')
            if cls.endswith('CoinController'):
                go = ('aa', tt['m_GameObject']['m_PathID'])
                tid = W.tf_of_go(go)
                s = wscale(tid)
                f = U.clean({k: v for k, v in tt.items() if k not in ('m_GameObject','m_Enabled','m_Script','m_Name')})
                mesh, aabb = None, None
                for c in W.comps(go):
                    if c['kind'] == 'MESH':
                        mesh, aabb = W.mesh_of({'comps': [c]})
                coins[L['names'][go]] = {'fields': f, 'scale': [round(v,4) for v in s],
                                         'mesh': mesh,
                                         'diameter': round(2*aabb['extent'][0]*s[0]*S, 4) if aabb else None,
                                         'height': round(2*aabb['extent'][2]*s[2]*S, 4) if aabb else None}
        except Exception:
            pass

out = {'scale': S, 'levels': levels, 'coins': coins}
json.dump(out, open('dump/levels_final.json', 'w'), indent=1, default=str)
json.dump({nm: levels[nm].pop('visual') for nm in levels}, open('dump/level_visual.json', 'w'), indent=1, default=str)
print('wrote dump/levels_final.json + dump/level_visual.json')
for nm in ('Level 1', 'Level 12', 'Level 19'):
    s = levels[nm]
    print('===', nm, 'goal', s.get('goal'), 'cam', s['camera'])
    for t in s['tiers']:
        print('  tier', t['name'], 'pos', t['pos'], 'yaw', t['yaw'], 'floor', t['floor'], 'pusher', (t['pusher'] or {}).get('pos'), (t['pusher'] or {}).get('speed'))
    print('  machines:', [(m['type'], m['pos'], m['tier']) for m in s['machines']])
    print('  collector:', s.get('collector', {}).get('pos'), 'spawn:', s.get('spawn'))
print('coins:', json.dumps(coins, default=str)[:600])
