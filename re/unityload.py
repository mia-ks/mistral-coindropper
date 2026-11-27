import UnityPy, math
from collections import defaultdict

META = 'apk/assets/bin/Data/Managed/Metadata/global-metadata.dat'
BUNDLE = 'apk/assets/aa/Android/defaultlocalgroup_assets_all_6e3d21aa82e0517f4a989c3366e60035.bundle'
MONO = 'apk/assets/aa/Android/8713be536fd0486a5bd5802129e5a43d_monoscripts_5cd2d5200e2a5c34818482f4e4949011.bundle'
DATA = 'apk/assets/bin/Data/data.unity3d'

def load():
    env = UnityPy.load(BUNDLE, META, MONO)
    env2 = UnityPy.load(DATA, META)
    scripts, names, meshname, meshaabb = {}, {}, {}, {}
    tf, go_of_tf, go_comps, go_active = {}, {}, defaultdict(list), {}
    for tag, e in (('aa', env), ('data', env2)):
        for o in e.objects:
            t = o.type.name
            try:
                if t == 'MonoScript':
                    d = o.read_typetree()
                    scripts[(tag, o.path_id)] = ((d.get('m_Namespace','') + '.' + d.get('m_ClassName','')).strip('.'))
                elif t == 'GameObject':
                    d = o.read_typetree()
                    names[(tag, o.path_id)] = d.get('m_Name', '')
                    go_active[(tag, o.path_id)] = d.get('m_IsActive', 1)
                    for c in d.get('m_Component', []):
                        pid = c.get('component', {}).get('m_PathID')
                        if pid: go_comps[(tag, o.path_id)].append((tag, pid))
                elif t in ('Transform', 'RectTransform'):
                    d = o.read_typetree()
                    p = d.get('m_LocalPosition', {}); r = d.get('m_LocalRotation', {}); s = d.get('m_LocalScale', {})
                    tf[(tag, o.path_id)] = {'go': (tag, d['m_GameObject']['m_PathID']), 'father': (tag, d['m_Father']['m_PathID']),
                                            'pos': (p.get('x',0), p.get('y',0), p.get('z',0)),
                                            'quat': (r.get('x',0), r.get('y',0), r.get('z',0), r.get('w',1)),
                                            'scale': (s.get('x',1), s.get('y',1), s.get('z',1))}
                    go_of_tf[(tag, o.path_id)] = (tag, d['m_GameObject']['m_PathID'])
                elif t == 'Mesh':
                    d = o.read_typetree()
                    meshname[(tag, o.path_id)] = d.get('m_Name', '')
                    a = d.get('m_LocalAABB', {})
                    c, ex = a.get('m_Center', {}), a.get('m_Extent', {})
                    meshaabb[(tag, o.path_id)] = {'center': (c.get('x',0), c.get('y',0), c.get('z',0)),
                                                  'extent': (ex.get('x',0), ex.get('y',0), ex.get('z',0))}
            except Exception:
                pass
    return dict(env=env, env2=env2, scripts=scripts, names=names, meshname=meshname, meshaabb=meshaabb,
                tf=tf, go_of_tf=go_of_tf, go_comps=go_comps, go_active=go_active)

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return (aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz)

def qrot(q, v):
    x, y, z, w = q
    uvx, uvy, uvz = (y*v[2]-z*v[1], z*v[0]-x*v[2], x*v[1]-y*v[0])
    return (v[0] + 2*(w*uvx + y*uvz - z*uvy), v[1] + 2*(w*uvy + z*uvx - x*uvz), v[2] + 2*(w*uvz + x*uvy - y*uvx))

def sapply(s, v): return (s[0]*v[0], s[1]*v[1], s[2]*v[2])

def mat_mul(a, b):  # row-major 4x4, column vectors
    return [[sum(a[i][k] * b[k][j] for k in range(4)) for j in range(4)] for i in range(4)]

def trs_mat(p, q, s):
    x, y, z, w = q
    R = [[1-2*(y*y+z*z), 2*(x*y-z*w),   2*(x*z+y*w)],
         [2*(x*y+z*w),   1-2*(x*x+z*z), 2*(y*z-x*w)],
         [2*(x*z-y*w),   2*(y*z+x*w),   1-2*(x*x+y*y)]]
    M = [[R[i][j] * s[j] for j in range(3)] + [p[i]] for i in range(3)]
    M.append([0.0, 0.0, 0.0, 1.0])
    return M

def xform(m, v):
    return (m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2] + m[0][3],
            m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2] + m[1][3],
            m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2] + m[2][3])

class World:
    def __init__(self, L):
        self.L = L
        self.tf = L['tf']
        self._W = {}
        self._WM = {}
    def world(self, key):
        if key in self._W: return self._W[key]
        d = self.tf[key]
        f = d['father']
        if f in self.tf:
            pw, wq, ws = self.world(f)
            lp = qrot(wq, sapply(ws, d['pos']))
            self._W[key] = ((pw[0]+lp[0], pw[1]+lp[1], pw[2]+lp[2]), qmul(wq, d['quat']),
                             (ws[0]*d['scale'][0], ws[1]*d['scale'][1], ws[2]*d['scale'][2]))
        else:
            self._W[key] = (d['pos'], d['quat'], d['scale'])
        return self._W[key]
    def yaw(self, q):
        x, y, z, w = q
        return math.degrees(math.atan2(2*(w*y + x*z), 1 - 2*(y*y + x*x)))
    def world_mat(self, key):
        # full hierarchical 4x4 matrix composition (correct under nonuniform scale,
        # unlike separate pos/quat/scale accumulation)
        if key in self._WM: return self._WM[key]
        d = self.tf[key]
        f = d['father']
        if f in self.tf:
            M = mat_mul(self.world_mat(f), trs_mat(d['pos'], d['quat'], d['scale']))
        else:
            M = trs_mat(d['pos'], d['quat'], d['scale'])
        self._WM[key] = M
        return M
    def world2(self, key):
        # (pos, yaw, scale, mat): pos = translation (exact), yaw from the matrix z column,
        # scale = column norms
        M = self.world_mat(key)
        pos = (M[0][3], M[1][3], M[2][3])
        sx = math.sqrt(M[0][0]**2 + M[1][0]**2 + M[2][0]**2)
        sy = math.sqrt(M[0][1]**2 + M[1][1]**2 + M[2][1]**2)
        sz = math.sqrt(M[0][2]**2 + M[1][2]**2 + M[2][2]**2)
        yaw = math.degrees(math.atan2(M[0][2] / (sz or 1), M[2][2] / (sz or 1)))
        return pos, yaw, (sx, sy, sz), M
    def children(self, key):
        return [k for k, d in self.tf.items() if d['father'] == key]
    def tf_of_go(self, go):
        for k, g in self.L['go_of_tf'].items():
            if g == go: return k
        return None
    def comps(self, go):
        out = []
        for ckey in self.L['go_comps'].get(go, []):
            tag, pid = ckey
            for o in (self.L['env'].objects if tag == 'aa' else self.L['env2'].objects):
                if o.path_id == pid:
                    t = o.type.name
                    try:
                        if t == 'MonoBehaviour':
                            tt = o.read_typetree()
                            cls = self.L['scripts'].get((tag, tt.get('m_Script', {}).get('m_PathID')), 'Unknown')
                            fields = {k: v for k, v in tt.items() if k not in ('m_GameObject','m_Enabled','m_Script','m_Name','m_EditorClassIdentifier')}
                            out.append({'kind': 'MB', 'class': cls, 'fields': fields})
                        elif t in ('BoxCollider','SphereCollider','CapsuleCollider','MeshCollider'):
                            d = o.read_typetree()
                            out.append({'kind': 'COL', 'type': t, 'fields': d})
                        elif t == 'MeshFilter':
                            d = o.read_typetree()
                            out.append({'kind': 'MESH', 'meshKey': (tag, d['m_Mesh']['m_PathID'])})
                        elif t == 'Rigidbody':
                            d = o.read_typetree()
                            out.append({'kind': 'RB', 'kinematic': d.get('m_IsKinematic'), 'useGravity': d.get('m_UseGravity')})
                    except Exception:
                        pass
                    break
        return out
    def mesh_of(self, node):
        for c in node['comps']:
            if c['kind'] == 'MESH':
                return self.L['meshname'].get(c['meshKey'], '?'), self.L['meshaabb'].get(c['meshKey'])
        return None, None

def clean(v, depth=0):
    if depth > 8: return '...'
    if isinstance(v, dict):
        if 'm_PathID' in v and len(v) <= 2: return ('PPtr', v['m_PathID'])
        return {k: clean(x, depth+1) for k, x in v.items() if k != 'm_FileID'}
    if isinstance(v, list): return [clean(x, depth+1) for x in v]
    if isinstance(v, float): return round(v, 5)
    return v

def resolve_pptr(L, W, v):
    if isinstance(v, tuple) and len(v) == 2 and v[0] == 'PPtr':
        pid = v[1]
        for tag in ('aa', 'data'):
            key = (tag, pid)
            if key in W.tf:
                p, q, s = W.world(key)
                return {'pos': [round(x, 4) for x in p], 'yaw': round(W.yaw(q), 2)}
            if key in L['names']:
                return {'name': L['names'][key]}
        return None
    if isinstance(v, dict): return {k: resolve_pptr(L, W, x) for k, x in v.items()}
    if isinstance(v, list): return [resolve_pptr(L, W, x) for x in v]
    return v
