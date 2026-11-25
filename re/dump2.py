import UnityPy, json, re
from collections import defaultdict, Counter
META = 'apk/assets/bin/Data/Managed/Metadata/global-metadata.dat'
BUNDLE = 'apk/assets/aa/Android/defaultlocalgroup_assets_all_6e3d21aa82e0517f4a989c3366e60035.bundle'
MONO = 'apk/assets/aa/Android/8713be536fd0486a5bd5802129e5a43d_monoscripts_5cd2d5200e2a5c34818482f4e4949011.bundle'
DATA = 'apk/assets/bin/Data/data.unity3d'
env = UnityPy.load(BUNDLE, META, MONO)
env2 = UnityPy.load(DATA, META)

scripts = {}
for o in env.objects:
    if o.type.name == 'MonoScript':
        d = o.read_typetree()
        ns, cls = d.get('m_Namespace',''), d.get('m_ClassName','')
        scripts[o.path_id] = (ns+'.'+cls).strip('.') if ns else cls

names = {}
go_of_tf = {}
tf_father = {}
for e in (env, env2):
    for o in e.objects:
        try:
            if o.type.name in ('GameObject','Sprite','Texture2D','Material','Mesh','MonoScript'):
                d = o.read_typetree()
                names[o.path_id] = (o.type.name, d.get('m_Name') or d.get('m_ClassName',''))
            elif o.type.name in ('Transform','RectTransform'):
                d = o.read_typetree()
                go_of_tf[o.path_id] = d['m_GameObject']['m_PathID']
                tf_father[o.path_id] = d['m_Father']['m_PathID']
            elif o.type.name == 'GameObject':
                pass
        except Exception:
            pass
    # go -> its transform: via components? Transform has m_GameObject; build reverse
rev = defaultdict(list)
for tid, go in go_of_tf.items():
    rev[go].append(tid)
def root_go(go):
    seen = set()
    cur = go
    while True:
        tids = rev.get(cur)
        if not tids: return cur
        f = tf_father.get(tids[0], 0)
        if not f or f in seen: return cur
        seen.add(f)
        cur = go_of_tf.get(f, cur)
        if cur == go: return go
def goname(pid):
    return names.get(pid, ('','?'))[1]

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
                     'class': cls,
                     'fields': resolve({k:v for k,v in tt.items() if k not in ('m_GameObject','m_Enabled','m_Script','m_Name')})})
json.dump(recs, open('dump/monos2.json','w'), default=str)
print('records:', len(recs))

# coin values
print('=== coins ===')
for r in recs:
    if 'CoinController' in r['class'] and r['go'].endswith('Coin'):
        f = r['fields']
        print(f"{r['go']:10s} coinId={f.get('coinId')} value={f.get('value')} weight={f.get('spawnWeight')} currency={f.get('currency')} maxSpeed={f.get('maxSpeed')}")

# per level spec
print('=== levels ===')
LEVELCLASSES = ['.Level','CoinSpawnController','GemSpawnController','PusherInteraction','ConveyorBeltInteraction','FanInteraction','MagnetInteraction','MovingMagnetInteraction','LaserInteraction','TeslaCoilInteraction','PortalInteraction','MultiplyingGateInteraction','DollarGateInteraction','SpikeInteraction','MovingPlatformInteraction','CoinCollectorInteraction','InteractorUpgradeController','LevelCameraBounds']
levels = defaultdict(list)
for r in recs:
    if r['env']=='aa' and re.match(r'^Level \d+$', r['root']):
        levels[r['root']].append(r)
out = {}
for root in sorted(levels, key=lambda s: int(s.split()[1])):
    rs = levels[root]
    spec = {'level': int(root.split()[1]), 'machines': [], 'upgrades': [], 'level': {}}
    for r in rs:
        c = r['class']
        if c.endswith('.Level'):
            spec['goal'] = r['fields'].get('targetCoins')
        elif c.endswith('CoinSpawnController'):
            f = r['fields']
            spec['spawn'] = {k: f.get(k) for k in ('maxCharges','refillInterval','chargesPerRefill','guaranteedBronzeCoinCount','selectionMode')}
        elif c.endswith('GemSpawnController'):
            spec['gem'] = True
        elif c.endswith('InteractorUpgradeController'):
            spec['upgrades'].append({'go': r['go'], 'machineId': r['fields'].get('machineId'), 'cost': r['fields'].get('_currentUpgradeCost')})
        elif any(c.endswith(x) for x in LEVELCLASSES):
            spec['machines'].append({'type': c.split('.')[-1], 'go': r['go'], 'fields': r['fields']})
    out[root] = spec
    n = len(spec['machines'])
    print(f"{root}: goal={spec.get('goal')} spawn={spec.get('spawn')} machines={n} upgrades={len(spec['upgrades'])}")
json.dump(out, open('dump/level_spec.json','w'), default=str, indent=1)
