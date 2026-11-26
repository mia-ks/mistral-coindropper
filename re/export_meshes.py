import json, math, re, unityload as U
from UnityPy.export import MeshExporter
from UnityPy.helpers.MeshHelper import MeshHandler

L = U.load()
W = U.World(L)
env = L['env']
MESH_IDS = {o.path_id for o in env.objects if o.type.name == 'Mesh'}

# ---- textures (decoded, downscaled, data-URL) and materials (color+alpha+map) ----
import base64, io
tex_data_cache = {}
def tex_data(pid):
    if pid in tex_data_cache: return tex_data_cache[pid]
    url = None
    for o in env.objects:
        if o.type.name == 'Texture2D' and o.path_id == pid:
            try:
                im = o.read().image
                has_alpha = im.mode in ('RGBA', 'LA') and im.getextrema()[3][0] < 255 if im.mode in ('RGBA','LA') else False
                if max(im.size) > 256:
                    im = im.resize((256, 256) if max(im.size) == im.width else (int(im.width*256/max(im.size)), int(im.height*256/max(im.size))))
                buf = io.BytesIO()
                if has_alpha:
                    im.convert('RGBA').save(buf, 'PNG')
                    mime = 'image/png'
                else:
                    im.convert('RGB').save(buf, 'JPEG', quality=82)
                    mime = 'image/jpeg'
                url = 'data:%s;base64,%s' % (mime, base64.b64encode(buf.getvalue()).decode())
            except Exception:
                pass
            break
    tex_data_cache[pid] = url
    return url

mat_def_cache = {}
mat_defs = {}
def mat_def(mid):
    if mid in mat_def_cache: return mat_def_cache[mid]
    d_def = {'name': str(mid), 'color': [0.85, 0.85, 0.9, 1.0], 'tex': None, 'uvScale': [1, 1], 'uvOffset': [0, 0],
             'metallic': 0.0, 'smoothness': 0.5, 'cull': 2, 'mode': 0}
    for o in env.objects:
        if o.type.name == 'Material' and o.path_id == mid:
            try:
                d = o.read_typetree()
                c = d.get('m_Color', {})
                d_def['color'] = [round(c.get('r', 1), 4), round(c.get('g', 1), 4), round(c.get('b', 1), 4), round(c.get('a', 1), 4)]
                d_def['name'] = d.get('m_Name', str(mid))
                sp = d.get('m_SavedProperties') or {}
                for e in (sp.get('m_Floats') or []):
                    if isinstance(e, (list, tuple)) and len(e) == 2:
                        k, v = e[0], e[1]
                        if k == '_Metallic': d_def['metallic'] = round(float(v), 4)
                        elif k in ('_Glossiness', '_Smoothness'): d_def['smoothness'] = round(float(v), 4)
                        elif k == '_Cull': d_def['cull'] = int(v)
                        elif k == '_Mode': d_def['mode'] = int(v)
                # new serialization: m_SavedProperties.m_TexEnvs = [[name, {m_Texture, m_Scale, m_Offset}], ...]
                for e in (sp.get('m_TexEnvs') or []):
                    if isinstance(e, (list, tuple)) and len(e) == 2 and e[0] in ('_BaseMap', '_MainTex'):
                        v = e[1] or {}
                        pid = (v.get('m_Texture') or {}).get('m_PathID', 0)
                        sc = v.get('m_Scale') or {}
                        of = v.get('m_Offset') or {}
                        if pid:
                            d_def['tex'] = tex_data(pid)
                            d_def['uvScale'] = [round(sc.get('x', 1), 4), round(sc.get('y', 1), 4)]
                            d_def['uvOffset'] = [round(of.get('x', 0), 4), round(of.get('y', 0), 4)]
                for e in (sp.get('m_Colors') or []):
                    if isinstance(e, (list, tuple)) and len(e) == 2 and e[0] in ('_BaseColor', '_Color'):
                        cc = e[1] or {}
                        d_def['color'] = [round(cc.get('r', 1), 4), round(cc.get('g', 1), 4), round(cc.get('b', 1), 4), round(cc.get('a', 1), 4)]
            except Exception:
                pass
            break
    mat_def_cache[mid] = d_def
    mat_defs[str(mid)] = d_def
    return d_def

def mat_color(mid):
    c = mat_def(mid)['color']
    return (c[0], c[1], c[2])

# ---- mesh geometry cache ----
mesh_cache = {}
def mesh_geom(mesh_key):
    if mesh_key in mesh_cache: return mesh_cache[mesh_key]
    if mesh_key[1] not in MESH_IDS:
        mesh_cache[mesh_key] = {'name': L['meshname'].get(mesh_key, '?'), 'subs': [], 'external': True}
        return mesh_cache[mesh_key]
    for o in env.objects:
        if o.type.name == 'Mesh' and o.path_id == mesh_key[1]:
            try:
                h = MeshHandler(o.read())
                h.process()
                subs = []
                tris = h.get_triangles()
                nsub = len(tris)
                pos = h.m_Vertices
                nrm = h.m_Normals or [(0, 0, 1)] * len(pos)
                q = lambda v: [int(round(v[0] * 1000)), int(round(v[1] * 1000)), int(round(v[2] * 1000))]
                uv = h.m_UV0 or []
                quv = lambda v: [int(round(v[0] * 10000)), int(round(v[1] * 10000))]
                nrm = h.m_Normals or []
                qn = lambda v: [int(round(v[0] * 1000)), int(round(v[1] * 1000)), int(round(v[2] * 1000))]
                cols = h.m_Colors or []
                # MeshHandler returns Color32 bytes (0..255) already
                qc = lambda v: [min(255, max(0, int(round(v[0])))), min(255, max(0, int(round(v[1])))), min(255, max(0, int(round(v[2])))), min(255, max(0, int(round(v[3] if len(v) > 3 else 255))))]
                for si in range(nsub):
                    t = tris[si]
                    sub = {
                        'pos': [q(p) for p in pos],
                        'idx': [int(x) for tri in t for x in tri],
                    }
                    if nrm: sub['nrm'] = [qn(p) for p in nrm]
                    if uv: sub['uv'] = [quv(p) for p in uv]
                    if cols: sub['col'] = [qc(p) for p in cols]
                    subs.append(sub)
                xs = [p[0] for p in pos]; ys = [p[1] for p in pos]; zs = [p[2] for p in pos]
                mesh_cache[mesh_key] = {'name': L['meshname'].get(mesh_key, '?'), 'subs': subs,
                                        'vbox': {'min': [min(xs), min(ys), min(zs)], 'max': [max(xs), max(ys), max(zs)]}}
            except Exception as e:
                mesh_cache[mesh_key] = {'name': L['meshname'].get(mesh_key, '?'), 'error': str(e)[:80], 'subs': []}
            break
    return mesh_cache[mesh_key]

# ---- math: unity->three mirror (x -> -x) ----
def mirror_pos(p): return [-p[0], p[1], p[2]]
def mirror_quat(q): return [q[0], -q[1], -q[2], q[3]]  # conjugate by diag(-1,1,1)
def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return [aw*bx + ax*bw + ay*bz - az*by, aw*by - ax*bz + ay*bw + az*bx,
            aw*bz + ax*by - ay*bx + az*bw, aw*bw - ax*bx - ay*by - az*bz]
def euler_to_quat(x, y, z):  # Unity order: R = Ry * Rx * Rz
    cx, sx = math.cos(x/2), math.sin(x/2)
    cy, sy = math.cos(y/2), math.sin(y/2)
    cz, sz = math.cos(z/2), math.sin(z/2)
    qx = [sx, 0, 0, cx]; qy = [0, sy, 0, cy]; qz = [0, 0, sz, cz]
    return qmul(qmul(qy, qx), qz)
CAM_FLIP = [0, 1, 0, 0]  # 180 deg about Y: three camera looks -z, unity +z

def descendants(tid):
    out = []
    def rec(t):
        out.append(t)
        for ch in W.children(t): rec(ch)
    rec(tid)
    return out

def renderer_mats(go):
    for o in env.objects:
        if o.type.name == 'MeshRenderer':
            try:
                d = o.read_typetree()
                if d['m_GameObject']['m_PathID'] == go[1]:
                    mats = d.get('m_Materials', [])
                    pids = [m['m_PathID'] if m.get('m_PathID') else 0 for m in mats]
                    return pids, [mat_color(p) if p else (0.8, 0.8, 0.8) for p in pids]
            except Exception:
                pass
    return [0], [(0.8, 0.8, 0.8)]

def renderer_colors(go):
    return renderer_mats(go)[1]

def mesh_key_of(go):
    for o in env.objects:
        if o.type.name == 'MeshFilter':
            try:
                d = o.read_typetree()
                if d['m_GameObject']['m_PathID'] == go[1]:
                    return ('aa', d['m_Mesh']['m_PathID'])
            except Exception:
                pass
    return None

roots = sorted([k for k, d in L['tf'].items() if k[0] == 'aa' and d['father'] == ('aa', 0) and re.match(r'^Level \d+$', L['names'].get(d['go'], ''))],
               key=lambda k: int(L['names'][L['tf'][k]['go']].split()[1]))

out = {}
for root in roots:
    nm = L['names'][L['tf'][root]['go']]
    lvl_idx = int(nm.split()[1])
    instances = []
    dozers = []
    meshes_used = set()
    # tier containers for dozer attribution
    tier_names = set()
    for ch in W.children(root):
        if re.match(r'^Pusher( \(\d+\))?$', L['names'][L['tf'][ch]['go']]):
            tier_names.add(L['names'][L['tf'][ch]['go']])
    go_active = L['go_active']
    def chain_of(t):
        out = []
        cur = t
        while cur and cur != root:
            out.append(L['names'][L['tf'][cur]['go']])
            cur = L['tf'][cur]['father']
        return out[::-1]
    def is_visible(t):
        # every ancestor GameObject active, and an enabled MeshRenderer on this GO
        cur = t
        while cur and cur != ('aa', 0):
            go = L['tf'][cur]['go']
            if not go_active.get(go, 1): return False
            cur = L['tf'][cur]['father']
        go = L['tf'][t]['go']
        for o in env.objects:
            if o.type.name == 'MeshRenderer':
                try:
                    d = o.read_typetree()
                    if d['m_GameObject']['m_PathID'] == go[1]:
                        return d.get('m_Enabled', 1) != 0
                except Exception:
                    pass
        return False
    for t in descendants(root):
        go = L['tf'][t]['go']
        gonm = L['names'][go]
        if gonm in ('BG_New',) or 'ParticleSystem' in gonm:
            continue
        mk = mesh_key_of(go)
        if not mk: continue
        if not is_visible(t): continue
        p, q, s = W.world(t)
        M = W.world_mat(t)  # exact hierarchical matrix (row-major, column vectors)
        cm = [M[r][c] for c in range(4) for r in range(4)]  # column-major for THREE.Matrix4.fromArray
        # unit conversion x10 applies to the WHOLE affine transform: scale the linear
        # 3x3 part (rows 0..2) and the translation, keep the homogeneous bottom row
        for r in range(3):
            for c in range(4):
                cm[c * 4 + r] *= 10
        # expected world AABB of this instance (mesh VERTEX extents x world matrix), game units
        g = mesh_geom(mk)
        vbox = g.get('vbox') if g else None
        inst_aabb = None
        if vbox:
            pts = [U.xform(M, (vbox['min'][0] + (dx > 0) * (vbox['max'][0] - vbox['min'][0]),
                               vbox['min'][1] + (dy > 0) * (vbox['max'][1] - vbox['min'][1]),
                               vbox['min'][2] + (dz > 0) * (vbox['max'][2] - vbox['min'][2])))
                   for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
            inst_aabb = {'min': [round(min(q2[0] for q2 in pts) * 10, 3), round(min(q2[1] for q2 in pts) * 10, 3), round(min(q2[2] for q2 in pts) * 10, 3)],
                         'max': [round(max(q2[0] for q2 in pts) * 10, 3), round(max(q2[1] for q2 in pts) * 10, 3), round(max(q2[2] for q2 in pts) * 10, 3)]}
        # dozer = node named Dozer or under 'Pusher' child of a tier, with Rigidbody kinematic
        is_dozer = gonm == 'Dozer'
        pids, cols = renderer_mats(go)
        inst = {
            'mesh': str(mk[1]),
            'meshName': L['meshname'].get(mk, '?'),
            'mat': [round(v, 5) for v in cm],
            'pos': [round(v * 10, 3) for v in mirror_pos(p)],
            'quat': [round(v, 5) for v in mirror_quat(q)],
            'scale': [round(v * 10, 3) for v in s],
            'mats': [str(int(x)) for x in pids],
            'colors': [list(c) for c in cols],
            'name': gonm,
            'chain': chain_of(t),
            'aabb': inst_aabb,
        }
        g = mesh_geom(mk)
        if not g.get('subs'):
            continue
        meshes_used.add(mk)
        if is_dozer:
            # find owning tier
            par = L['tf'][t]['father']; tier = None
            while par and par != root:
                pn = L['names'][L['tf'][par]['go']]
                if pn in tier_names: tier = pn; break
                par = L['tf'][par]['father']
            dozers.append({**inst, 'tier': tier})
        else:
            instances.append(inst)
    for mk in meshes_used:
        mesh_geom(mk)  # populate global cache
    # camera: LevelCameraBounds zoomInMarker + euler + fov
    cam = None
    for c in W.comps(L['tf'][root]['go']):
        if c['kind'] == 'MB' and 'LevelCameraBounds' in c['class']:
            f = U.resolve_pptr(L, W, U.clean(c['fields']))
            pos = f['zoomInMarker']['pos']
            eu = f['rotationEuler']
            q_u = euler_to_quat(math.radians(eu['x']), math.radians(eu['y']), math.radians(eu['z']))
            q_t = qmul(mirror_quat(q_u), CAM_FLIP)
            cam = {'pos': [round(v * 10, 3) for v in mirror_pos(pos)],
                   'quat': [round(v, 6) for v in q_t],
                   'fov': f.get('fieldOfView', 20)}
            bounds = {}
            for mk in ('topMarker', 'bottomMarker', 'leftMarker', 'rightMarker'):
                mp = f.get(mk)
                if mp and mp.get('pos'):
                    bounds[mk] = [round(v * 10, 3) for v in mirror_pos(mp['pos'])]
            if bounds:
                cam['bounds'] = bounds
    out[nm] = {'level': lvl_idx, 'camera': cam, 'instances': instances, 'dozers': dozers}
    print(nm, 'instances', len(instances), 'dozers', len(dozers), 'uniqueMeshes', len(meshes_used), 'cam', cam and cam['fov'])

json.dump(out, open('dump/level_meshes.json', 'w'))
lib = {str(k[1]): g for k, g in mesh_cache.items() if g.get('subs')}
json.dump(lib, open('dump/meshes_global.json', 'w'))
json.dump(mat_defs, open('dump/materials.json', 'w'))
import os
print('wrote dump/level_meshes.json', os.path.getsize('dump/level_meshes.json') // 1024, 'KB,',
      'dump/meshes_global.json', os.path.getsize('dump/meshes_global.json') // 1024, 'KB,', len(lib), 'meshes')
