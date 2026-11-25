import UnityPy, json, math, re
from collections import defaultdict

META = 'apk/assets/bin/Data/Managed/Metadata/global-metadata.dat'
BUNDLE = 'apk/assets/aa/Android/defaultlocalgroup_assets_all_6e3d21aa82e0517f4a989c3366e60035.bundle'
MONO = 'apk/assets/aa/Android/8713be536fd0486a5bd5802129e5a43d_monoscripts_5cd2d5200e2a5c34818482f4e4949011.bundle'
DATA = 'apk/assets/bin/Data/data.unity3d'

env = UnityPy.load(BUNDLE, META, MONO)
env2 = UnityPy.load(DATA, META)

scripts, names, meshname = {}, {}, {}
tf, go_of_tf, go_comps = {}, {}, defaultdict(list)
raw = {}   # path_id -> (env_tag, object)

for tag, e in (('aa', env), ('data', env2)):
    for o in e.objects:
        t = o.type.name
        raw[(tag, o.path_id)] = o
        try:
            if t == 'MonoScript':
                d = o.read_typetree()
                scripts[(tag, o.path_id)] = ((d.get('m_Namespace','') + '.' + d.get('m_ClassName','')).strip('.'))
            elif t == 'GameObject':
                d = o.read_typetree()
                names[(tag, o.path_id)] = d.get('m_Name', '')
                for c in d.get('m_Component', []):
                    pid = c.get('component', {}).get('m_PathID')
                    if pid: go_comps[(tag, o.path_id)].append(pid)
            elif t in ('Transform', 'RectTransform'):
                d = o.read_typetree()
                p = d.get('m_LocalPosition', {}); r = d.get('m_LocalRotation', {}); s = d.get('m_LocalScale', {})
                tf[(tag, o.path_id)] = {'go': (tag, d['m_GameObject']['m_PathID']), 'father': (tag, d['m_Father']['m_PathID']),
                                         'pos': (p.get('x',0), p.get('y',0), p.get('z',0)),
                                         'quat': (r.get('x',0), r.get('y',0), r.get('z',0), r.get('w',1)),
                                         'scale': (s.get('x',1), s.get('y',1), s.get('z',1))}
                go_of_tf[(tag, o.path_id)] = (tag, d['m_GameObject']['m_PathID'])
            elif t == 'Mesh':
                meshname[(tag, o.path_id)] = o.read_typetree().get('m_Name', '')
        except Exception:
            pass

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
def world(key):
    if key in WORLD: return WORLD[key]
    d = tf[key]
    f = d['father']
    if f in tf:
        pw, wq, ws = world(f)
        lp = qrot(wq, sapply(ws, d['pos']))
        pos = (pw[0]+lp[0], pw[1]+lp[1], pw[2]+lp[2])
        quat = qmul(wq, d['quat'])
        scale = (ws[0]*d['scale'][0], ws[1]*d['scale'][1], ws[2]*d['scale'][2])
    else:
        pos, quat, scale = d['pos'], d['quat'], d['scale']
    WORLD[key] = (pos, quat, scale)
    return WORLD[key]

def yaw(q):
    x, y, z, w = q
    return math.degrees(math.atan2(2*(w*y + x*z), 1 - 2*(y*y + x*x)))

def fwd(q):
    f = qrot(q, (0, 0, 1))
    return [round(v, 4) for v in f]

def go_name(key): return names.get(key, '?')
def tf_of_go(gkey):
    for k, g in go_of_tf.items():
        if g == gkey: return k
    return None

def mb_fields(o):
    tt = o.read_typetree()
    cls = scripts.get((o.assets_file.name and 'aa' or 'aa', 0), '?') if False else None
    sp = tt.get('m_Script', {})
    tag = 'aa' if o in env.objects else 'data'
    cls = scripts.get((tag, sp.get('m_PathID')), 'Unknown')
    fields = {}
    for k, v in tt.items():
        if k in ('m_GameObject', 'm_Enabled', 'm_Script', 'm_Name', 'm_EditorClassIdentifier'): continue
        if isinstance(v, dict) and 'm_PathID' in v and len(v) <= 2:
            fields[k] = f'PPtr({v["m_PathID"]})'
        else:
            fields[k] = v
    return cls, fields

def comp_info(pid_key):
    tag, pid = pid_key
    o = raw.get(pid_key)
    if o is None: return {'type': '?'}
    t = o.type.name
    if t == 'MonoBehaviour':
        try:
            cls, fields = mb_fields(o)
            return {'type': 'MB', 'class': cls, 'fields': fields}
        except Exception as ex:
            return {'type': 'MB', 'class': '?', 'error': str(ex)[:80]}
    if t in ('BoxCollider', 'SphereCollider', 'CapsuleCollider', 'MeshCollider'):
        try:
            d = o.read_typetree()
            keys = {k: d.get(k) for k in d if k not in ('m_GameObject', 'm_Enabled', 'm_Material', 'm_IsTrigger', 'm_ProvidesContacts', 'm_IncludeLayers', 'm_ExcludeLayers', 'm_LayerOverridePriority', 'm_CallbackTarget', 'm_UsedByEffector', 'm_UsedByComposite', 'm_Offset', 'm_ContactOffset')}
            return {'type': t, 'fields': keys}
        except Exception as ex:
            return {'type': t, 'error': str(ex)[:80]}
    if t == 'MeshFilter':
        try:
            d = o.read_typetree()
            m = d.get('m_Mesh', {})
            return {'type': 'MeshFilter', 'mesh': meshname.get((tag, m.get('m_PathID')), f'PPtr({m.get("m_PathID")})')}
        except Exception:
            return {'type': 'MeshFilter'}
    return {'type': t}

def path_of(tkey, root_key):
    parts = []
    cur = tkey
    while cur and cur != root_key and cur in tf:
        parts.append(go_name(tf[cur]['go']))
        cur = tf[cur]['father']
    parts.reverse()
    return '/'.join(parts)

def children(tkey):
    return [k for k, d in tf.items() if d['father'] == tkey]

# ---- cameras ----
cams = []
for tag, e in (('aa', env), ('data', env2)):
    for o in e.objects:
        if o.type.name == 'Camera':
            d = o.read_typetree()
            go = (tag, d['m_GameObject']['m_PathID'])
            t = tf_of_go(go)
            w = world(t) if t else None
            cams.append({'on': go_name(go),
                         'orthographic': d.get('orthographic'), 'orthographicSize': d.get('orthographic size'),
                         'fov': d.get('field of view'), 'near': d.get('near clip plane'), 'far': d.get('far clip plane'),
                         'worldPos': [round(v, 4) for v in w[0]] if w else None,
                         'quat': [round(v, 5) for v in w[1]] if w else None,
                         'forward': fwd(w[1]) if w else None, 'yaw': round(yaw(w[1]), 2) if w else None})
print('=== cameras ===')
for c in cams: print(c)

# ---- coin prefabs ----
print('=== coin-like prefabs (aa) ===')
for o in env.objects:
    if o.type.name == 'GameObject':
        d = o.read_typetree()
        nm = d.get('m_Name', '')
        if re.match(r'^(Coin|.*Coin.*)$', nm) and 'Spawner' not in nm and 'Collector' not in nm:
            go = ('aa', o.path_id)
            t = tf_of_go(go)
            w = world(t) if t else None
            comps = [comp_info(( 'aa', pid)) for pid in go_comps.get(go, [])]
            interesting = [c for c in comps if c['type'] in ('MB', 'BoxCollider', 'SphereCollider', 'CapsuleCollider', 'MeshFilter', 'MeshCollider', 'Rigidbody')]
            print(nm, 'worldPos', [round(v,4) for v in w[0]] if w else None, 'scale', [round(v,4) for v in w[2]] if w else None)
            for c in interesting:
                print('   ', json.dumps(c, default=str)[:400])

# ---- per-level compact world spec ----
def walk(tkey, root, acc, depth=0):
    d = tf[tkey]
    go = d['go']
    nm = go_name(go)
    pos, quat, scale = world(tkey)
    comps = [comp_info(('aa', pid)) for pid in go_comps.get(go, [])]
    mbs = [c for c in comps if c['type'] == 'MB']
    colliders = [c for c in comps if c['type'] in ('BoxCollider', 'SphereCollider', 'CapsuleCollider', 'MeshCollider')]
    mesh = next((c['mesh'] for c in comps if c['type'] == 'MeshFilter'), None)
    node = {'path': path_of(tkey, root), 'name': nm,
            'pos': [round(v, 4) for v in pos], 'yaw': round(yaw(quat), 2), 'scale': [round(v, 4) for v in scale],
            'mesh': mesh,
            'mbs': [{'class': c['class'], 'fields': c.get('fields', {})} for c in mbs],
            'colliders': [{'type': c['type'], 'fields': c.get('fields', {})} for c in colliders]}
    acc.append(node)
    for ch in sorted(children(tkey), key=lambda k: go_name(tf[k]['go'])):
        walk(ch, root, acc, depth+1)

levels = {}
for key, d in tf.items():
    if key[0] != 'aa': continue
    if d['father'] == ( 'aa', 0 ) or d['father'] not in tf:
        nm = go_name(d['go'])
        if re.match(r'^Level \d+$', nm):
            acc = []
            walk(key, key, acc)
            levels[nm] = acc

json.dump({'cameras': cams, 'levels': levels}, open('dump/level_world.json', 'w'), default=str)
print('wrote dump/level_world.json; levels:', len(levels), 'nodes:', sum(len(v) for v in levels.values()))
for nm in ('Level 1', 'Level 12', 'Level 19'):
    print('===', nm, '===')
    for n in levels[nm]:
        if n['mbs'] or n['name'] in ('Pusher', 'Dozer', 'CoinCollector', 'CoinSpawnController', 'Spawn Point') or re.match(r'^Pusher \(\d+\)$', n['name']):
            cls = [m['class'].split('.')[-1] for m in n['mbs']]
            print(f"  {n['path'][:80]:80s} pos={n['pos']} yaw={n['yaw']} scale={n['scale']} mesh={n['mesh']} {cls}")
