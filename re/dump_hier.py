import UnityPy, json, math, re
from collections import defaultdict

META = 'apk/assets/bin/Data/Managed/Metadata/global-metadata.dat'
BUNDLE = 'apk/assets/aa/Android/defaultlocalgroup_assets_all_6e3d21aa82e0517f4a989c3366e60035.bundle'
MONO = 'apk/assets/aa/Android/8713be536fd0486a5bd5802129e5a43d_monoscripts_5cd2d5200e2a5c34818482f4e4949011.bundle'
DATA = 'apk/assets/bin/Data/data.unity3d'

env = UnityPy.load(BUNDLE, META, MONO)
env2 = UnityPy.load(DATA, META)

scripts = {}
names = {}
go_of_tf = {}
tf = {}          # tf pid -> dict(go, father, pos, quat, scale)
go_comps = defaultdict(list)   # go pid -> [(type, path_id)]
meshname = {}

for e in (env, env2):
    for o in e.objects:
        t = o.type.name
        try:
            if t == 'MonoScript':
                d = o.read_typetree()
                scripts[o.path_id] = ((d.get('m_Namespace','') + '.' + d.get('m_ClassName','')).strip('.'))
            elif t in ('GameObject',):
                d = o.read_typetree()
                names[o.path_id] = d.get('m_Name','')
                for c in d.get('m_Component', []):
                    pid = c.get('component', {}).get('m_PathID') or c.get('m_PathID')
                    if pid: go_comps[o.path_id].append(pid)
            elif t in ('Transform', 'RectTransform'):
                d = o.read_typetree()
                go_of_tf[o.path_id] = d['m_GameObject']['m_PathID']
                p = d.get('m_LocalPosition', {}); r = d.get('m_LocalRotation', {}); s = d.get('m_LocalScale', {})
                tf[o.path_id] = {'go': d['m_GameObject']['m_PathID'], 'father': d['m_Father']['m_PathID'],
                                 'pos': (p.get('x',0), p.get('y',0), p.get('z',0)),
                                 'quat': (r.get('x',0), r.get('y',0), r.get('z',0), r.get('w',1)),
                                 'scale': (s.get('x',1), s.get('y',1), s.get('z',1))}
            elif t == 'Mesh':
                d = o.read_typetree()
                meshname[o.path_id] = d.get('m_Name','')
        except Exception:
            pass

tf_of_go = {}
for tid, d in tf.items():
    tf_of_go.setdefault(d['go'], tid)

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by,
            aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw,
            aw*bw - ax*bx - ay*by - az*bz)

def qrot(q, v):
    x, y, z, w = q
    uvx, uvy, uvz = (y*v[2]-z*v[1], z*v[0]-x*v[2], x*v[1]-y*v[0])
    return (v[0] + 2*(w*uvx + y*uvz - z*uvy),
            v[1] + 2*(w*uvy + z*uvx - x*uvz),
            v[2] + 2*(w*uvz + x*uvy - y*uvx))

def scomp(a, b): return (a[0]*b[0], a[1]*b[1], a[2]*b[2])
def sapply(s, v): return (s[0]*v[0], s[1]*v[1], s[2]*v[2])

WORLD = {}
def world(tid):
    if tid in WORLD: return WORLD[tid]
    d = tf[tid]
    f = d['father']
    if f and f in tf:
        pw, wq, ws = world(f)
        lp = sapply(ws, d['pos'])
        pos = (pw[0]+qrot(wq, lp)[0], pw[1]+qrot(wq, lp)[1], pw[2]+qrot(wq, lp)[2])
        quat = qmul(wq, d['quat'])
        scale = scomp(ws, d['scale'])
    else:
        pos, quat, scale = d['pos'], d['quat'], d['scale']
    WORLD[tid] = (pos, quat, scale)
    return WORLD[tid]

def children(tid):
    return [t for t, d in tf.items() if d['father'] == tid]

def qyaw(q):
    x, y, z, w = q
    return math.degrees(math.atan2(2*(w*y + x*z), 1 - 2*(y*y + x*x)))

def comp_desc(pid, e_objs):
    for o in e_objs:
        if o.path_id == pid:
            t = o.type.name
            if t == 'MonoBehaviour':
                try:
                    tt = o.read_typetree()
                except Exception:
                    return {'type': 'MonoBehaviour', 'class': scripts.get(tt.get('m_Script',{}).get('m_PathID'),'?') if tt else '?', 'fields': {}}
                cls = scripts.get(tt.get('m_Script', {}).get('m_PathID'), 'Unknown')
                fields = {}
                for k, v in tt.items():
                    if k in ('m_GameObject', 'm_Enabled', 'm_Script', 'm_Name', 'm_EditorClassIdentifier'): continue
                    fields[k] = v
                return {'type': 'MB', 'class': cls, 'fields': fields}
            return {'type': t}
    return {'type': '?'}

def tree(tid, depth, e_objs, maxdepth=99):
    d = tf[tid]
    go = d['go']
    pos, quat, scale = world(tid)
    node = {'name': names.get(go, '?'), 'go': go,
            'local': {'pos': [round(v,4) for v in d['pos']], 'quat': [round(v,4) for v in d['quat']], 'scale': [round(v,4) for v in d['scale']]},
            'world': {'pos': [round(v,4) for v in pos], 'yaw': round(qyaw(quat),2), 'scale': [round(v,4) for v in scale]},
            'comps': [], 'children': []}
    for pid in go_comps.get(go, []):
        c = comp_desc(pid, e_objs)
        if c['type'] == 'MB':
            c['fields'] = {k: (str(v)[:200]) for k, v in c['fields'].items()}
        node['comps'].append(c)
    if depth < maxdepth:
        for ch in sorted(children(tid), key=lambda t: names.get(tf[t]['go'], '')):
            node['children'].append(tree(ch, depth+1, e_objs, maxdepth))
    return node

objs = list(env.objects)
objs2 = list(env2.objects)

# find level roots
roots = {}
for tid, d in tf.items():
    if d['father'] == 0:
        nm = names.get(d['go'], '')
        if re.match(r'^Level \d+$', nm):
            roots[nm] = tid
print('level roots:', sorted(roots, key=lambda s: int(s.split()[1])))

out = {}
for nm in sorted(roots, key=lambda s: int(s.split()[1])):
    out[nm] = tree(roots[nm], 0, objs, maxdepth=12)
json.dump(out, open('dump/level_trees.json', 'w'), default=str)
print('wrote dump/level_trees.json')

# cameras in the main scene
print('=== cameras in data.unity3d ===')
for o in objs2:
    if o.type.name == 'Camera':
        d = o.read_typetree()
        go = d['m_GameObject']['m_PathID']
        gonm = names.get(go, '?')
        tid = tf_of_go.get(go)
        w = world(tid) if tid else None
        print('Camera on', gonm, 'orthographic=', d.get('orthographic'), 'orthoSize=', d.get('orthographicSize'),
              'fov=', d.get('fieldOfView'), 'near=', d.get('near clip plane'), 'far=', d.get('far clip plane'))
        if w:
            print('  world pos', [round(v,3) for v in w[0]], 'quat', [round(v,4) for v in w[1]], 'yaw', round(qyaw(w[1]),2))
            print('  local pos', tf[tid]['pos'], 'quat', tf[tid]['quat'])
# any camera in aa bundle too
for o in objs:
    if o.type.name == 'Camera':
        d = o.read_typetree()
        go = d['m_GameObject']['m_PathID']
        print('aa Camera on', names.get(go,'?'), 'ortho=', d.get('orthographic'), 'size=', d.get('orthographicSize'), 'fov=', d.get('fieldOfView'))
