import UnityPy, json, os, re
from collections import Counter, defaultdict
META = 'apk/assets/bin/Data/Managed/Metadata/global-metadata.dat'
BUNDLE = 'apk/assets/aa/Android/defaultlocalgroup_assets_all_6e3d21aa82e0517f4a989c3366e60035.bundle'
MONO = 'apk/assets/aa/Android/8713be536fd0486a5bd5802129e5a43d_monoscripts_5cd2d5200e2a5c34818482f4e4949011.bundle'
DATA = 'apk/assets/bin/Data/data.unity3d'
os.makedirs('dump', exist_ok=True)

envs = {}
envs['aa'] = UnityPy.load(BUNDLE, META, MONO)
envs['data'] = UnityPy.load(DATA, META)

# script map
scripts = {}
for o in envs['aa'].objects:
    if o.type.name == 'MonoScript':
        d = o.read_typetree()
        ns, cls = d.get('m_Namespace',''), d.get('m_ClassName','')
        scripts[o.path_id] = (ns + '.' + cls).strip('.') if ns else cls
open('dump/scripts.txt','w').write('\n'.join(f'{k}\t{v}' for k,v in sorted(scripts.items(), key=lambda x: x[1])))

# name maps per env
def build(env):
    names = {}
    gos = {}
    for o in env.objects:
        try:
            if o.type.name in ('GameObject','Sprite','Texture2D','MonoScript','Material','Mesh','AudioClip','FontAsset'):
                d = o.read_typetree() if o.type.name!='GameObject' else o.read_typetree()
                nm = d.get('m_Name') or d.get('m_ClassName','')
                names[o.path_id] = (o.type.name, nm)
            if o.type.name == 'GameObject':
                gos[o.path_id] = o
        except Exception:
            pass
    return names, gos

allnames = {}
envinfo = {}
for k, env in envs.items():
    n, g = build(env)
    allnames.update(n)
    envinfo[k] = (env, g)

def resolve(v):
    if isinstance(v, dict) and 'm_PathID' in v:
        pid = v['m_PathID']
        if pid in allnames:
            t, nm = allnames[pid]
            return f'{t}:{nm}' if nm else t
        if pid in scripts:
            return 'Script:' + scripts[pid]
        return f'PPtr({pid})'
    if isinstance(v, dict):
        return {kk: resolve(vv) for kk, vv in v.items()}
    if isinstance(v, list):
        return [resolve(x) for x in v]
    return v

records = []
for k, env in envs.items():
    for o in env.objects:
        if o.type.name != 'MonoBehaviour':
            continue
        try:
            tt = o.read_typetree()
        except Exception:
            continue
        sp = tt.get('m_Script', {})
        cls = scripts.get(sp.get('m_PathID'), 'Unknown')
        go = tt.get('m_GameObject', {}).get('m_PathID')
        goname = allnames.get(go, ('?', ''))[1]
        rec = resolve({kk: vv for kk, vv in tt.items() if kk not in ('m_GameObject','m_Enabled','m_Script','m_Name')})
        records.append({'env': k, 'path_id': o.path_id, 'go': goname, 'class': cls, 'fields': rec})

json.dump(records, open('dump/monos.json','w'), default=str)
c = Counter(r['class'] for r in records)
print('MonoBehaviour classes:', len(c))
for cls, n in c.most_common(80):
    print(f'{n:5d}  {cls}')
# GameObject names summary
gonames = Counter(v[1] for v in allnames.values() if v[0]=='GameObject' and v[1])
print('--- GameObject names (top 120) ---')
for nm, n in gonames.most_common(120):
    print(f'{n:4d}  {nm}')
