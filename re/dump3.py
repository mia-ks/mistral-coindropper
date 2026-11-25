import UnityPy, json, re
from collections import defaultdict, Counter
META = 'apk/assets/bin/Data/Managed/Metadata/global-metadata.dat'
BUNDLE = 'apk/assets/aa/Android/defaultlocalgroup_assets_all_6e3d21aa82e0517f4a989c3366e60035.bundle'
MONO = 'apk/assets/aa/Android/8713be536fd0486a5bd5802129e5a43d_monoscripts_5cd2d5200e2a5c34818482f4e4949011.bundle'
DATA = 'apk/assets/bin/Data/data.unity3d'
env = UnityPy.load(BUNDLE, META, MONO)
env2 = UnityPy.load(DATA, META)
print('data.unity3d types:', Counter(o.type.name for o in env2.objects).most_common(20))

scripts = {}
for e in (env, env2):
    for o in e.objects:
        if o.type.name == 'MonoScript':
            try:
                d = o.read_typetree()
                ns, cls = d.get('m_Namespace',''), d.get('m_ClassName','')
                scripts[o.path_id] = (ns+'.'+cls).strip('.') if ns else cls
            except Exception: pass
print('total scripts:', len(scripts))
cd = sorted(v for v in scripts.values() if 'CoinDozer' in v)
print('CoinDozer scripts (%d):' % len(cd))
for v in cd: print('  ', v)

names = {}
go_of_tf = {}
tf_father = {}
tf_pos = {}
for e in (env, env2):
    for o in e.objects:
        try:
            if o.type.name in ('GameObject','Sprite','Texture2D','Material','Mesh','MonoScript','AudioClip'):
                d = o.read_typetree()
                names[o.path_id] = (o.type.name, d.get('m_Name') or d.get('m_ClassName',''))
            elif o.type.name in ('Transform','RectTransform'):
                d = o.read_typetree()
                go_of_tf[o.path_id] = d['m_GameObject']['m_PathID']
                tf_father[o.path_id] = d['m_Father']['m_PathID']
                p = d.get('m_LocalPosition', {})
                r = d.get('m_LocalRotation', {})
                s = d.get('m_LocalScale', {})
                tf_pos[o.path_id] = {'pos': (round(p.get('x',0),3), round(p.get('y',0),3), round(p.get('z',0),3)),
                                     'rot': (round(r.get('x',0),4), round(r.get('y',0),4), round(r.get('z',0),4), round(r.get('w',1),4)),
                                     'scale': (round(s.get('x',1),3), round(s.get('y',1),3), round(s.get('z',1),3))}
        except Exception:
            pass
rev = defaultdict(list)
for tid, go in go_of_tf.items(): rev[go].append(tid)
def root_go(go):
    seen=set(); cur=go
    while True:
        tids = rev.get(cur)
        if not tids: return cur
        f = tf_father.get(tids[0], 0)
        if not f or f in seen: return cur
        seen.add(f); cur = go_of_tf.get(f, cur)
        if cur == go: return go
def goname(pid): return names.get(pid, ('','?'))[1]
def gopos(go):
    tids = rev.get(go)
    if not tids: return None
    return tf_pos.get(tids[0])
def resolve(v):
    if isinstance(v, dict) and 'm_PathID' in v:
        pid = v['m_PathID']
        if pid in names:
            t, nm = names[pid]
            return f'{t}:{nm}' if nm else t
        if pid in scripts: return 'Script:'+scripts[pid]
        return f'PPtr({pid})'
    if isinstance(v, dict): return {k: resolve(x) for k,x in v.items()}
    if isinstance(v, list): return [resolve(x) for x in v]
    return v

recs = []
for e, tag in ((env,'aa'), (env2,'data')):
    for o in e.objects:
        if o.type.name != 'MonoBehaviour': continue
        try: tt = o.read_typetree()
        except Exception: continue
        sp = tt.get('m_Script', {})
        cls = scripts.get(sp.get('m_PathID'), 'Unknown')
        go = tt.get('m_GameObject', {}).get('m_PathID')
        recs.append({'env': tag, 'pid': o.path_id, 'go': goname(go), 'root': goname(root_go(go)),
                     'pos': gopos(go), 'class': cls,
                     'fields': resolve({k:v for k,v in tt.items() if k not in ('m_GameObject','m_Enabled','m_Script','m_Name')})})
json.dump(recs, open('dump/monos3.json','w'), default=str)
json.dump({str(k): v for k,v in scripts.items()}, open('dump/scripts_all.json','w'), default=str)
print('records:', len(recs))
# data env CoinDozer classes now resolved?
print('data-env classes:', Counter(r['class'] for r in recs if r['env']=='data').most_common(40))
