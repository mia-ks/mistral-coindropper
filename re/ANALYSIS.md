# RE analysis: Coins Clicker : Idle Collector (com.deadpixel.coinsclickercollector.game)

Target: XAPK v1.0.11 (versionCode 11), fetched from APKPure
(`https://d.apkpure.com/b/XAPK/com.deadpixel.coinsclickercollector.game?versionCode=11`,
SHA-256 f325c8ee…f1128 per APKPure). Base APK 130 MB + config.arm64_v8a split (44 MB).

Method (per the morluto/rea approach — inspect locally, gather evidence, then rebuild):
- `unzip` the XAPK → base APK + ABI split + manifest.json
- `pip install UnityPy androguard`
- androguard: AndroidManifest (permissions/activities/services)
- UnityPy + `assets/bin/Data/Managed/Metadata/global-metadata.dat`: typetree dump of
  `assets/aa/Android/defaultlocalgroup_assets_all_*.bundle` (31,857 objects) and
  `assets/bin/Data/data.unity3d` → per-level prefab configs, machine components, positions
- identifier/string extraction from global-metadata.dat (IL2CPP string tables)

## Engine / structure

- Unity (IL2CPP, Unity 2022+; `global-metadata.dat` v39), Addressables (`assets/aa`),
  3D physics (PhysX) coin pusher viewed from a side camera; game code namespace
  `CoinDozer.*` (290 classes: Controllers, Systems.{Ads,Analytics,Coins,Progression,
  LevelInteractions,IAP,RateUs,Rewards,Ftue}, UI.*).
- 19 level prefabs: `Assets/_Project/Prefabs/Levels/Level 1.prefab … Level 19.prefab`
  (Addressables keys). Extracted per-level machine lists/positions → `dump/levels_layout.json`,
  per-component typetrees → `dump/monos3.json`.

## Extracted game spec (facts used as design reference)

- Stage goal: `Level.targetCoins = 100` on all 19 levels (progress bar fill).
- Coin spawner (`CoinSpawnController`): `maxCharges 15`, `refillInterval 2.0 s`,
  `chargesPerRefill 1`, `guaranteedBronzeCoinCount 10` (first 10 drops are bronze).
- Coin table (`CoinController` on Bronze/Silver/Gold/Gem prefabs):
  - Bronze: value 2, spawnWeight 90, currency 0
  - Silver: value 5, weight 8 · Gold: value 10, weight 2
  - Gem: currency 2 (gems), weight 0, spawned by separate `GemSpawnController`
- Currencies: 0 = coins (bank), 1 = cash (DollarGate `cashAmount 1`), 2 = gems.
- Machines (`Systems.LevelInteractions.*Interaction`), base params:
  - Pusher "Dozer": speed 2 · Conveyor: speed 2
  - Fan/air blower: speed 10–50 · Magnet: speed 0.55, attractionDuration 2
  - MovingMagnet: + sway, stayDuration 1.5, rotationCostPerDegree
  - TeslaCoil "launcher": speed 2, interval 1.2, maxHopDistance 1.0
  - Portal: pullDuration 0.35 · MultiplyingGate x2 · DollarGate · Spikes ·
    MovingPlatform (stayDuration 5) · Laser · SuctionPipe · Ice platform · Bumper
- Per-machine upgrade buttons (`InteractorUpgradeController`): machineId
  0=pusher,1=conveyor,2=fan,3=magnet,4=movingMagnet,5=platform,6=portal,7=launcher…,
  base cost `_currentUpgradeCost = 2` (gems); machineId→target resolved in dump.
- Global systems: upgrade tree (`UpgradeTreeService`, tracks: coin value/rate,
  capacity, refill speed — `RefillSpeedUpgradeService`), combo
  (`CoinComboConfig`/tiers), FTUE, level objective/complete UI, idle hint,
  daily reward, rate-us, offline/idle earnings.

## Adware / monetization inventory (why the original is "slop")

- Permissions: `AD_ID`, `ACCESS_ADSERVICES_AD_ID/ATTRIBUTION/TOPICS`,
  `com.google.android.gms.permission.AD_ID`, INTERNET, BILLING, WAKE_LOCK, …
- 70+ ad SDK activities in the manifest: AppLovin MAX (+debugger), IronSource,
  Bigo, Smaato, InMobi, Yandex, Moloco, Mintegral/MBridge, Fyber, Vungle,
  BidMachine, Adsurge, Pangle/Bytedance, Facebook Audience Network, Google
  AdMob, Unity Ads; MRAID/OMSDK web assets in `assets/`.
- Analytics: Firebase (AppMeasurement services), AppMetrica, GameAnalytics, Adjust.
- IAP: Google Billing + Xsolla + PlayFab (`SIS.*`, `InAppProduct_RemoveAdsBundle`,
  `InAppProduct_Gems`, `InAppProduct_SkipIts`) — i.e. pay to remove ads / buy gems.
- Game code: `CoinDozer.Systems.Ads.AdBreakService` (forced interstitials;
  remote keys seen in metadata: `ADSTARTLEVEL`, `BANNERSTARTLEVEL`,
  `DAILY_REWARD_LEVEL`, "Quick Inter Delay", "Require Internet"), rewarded-video
  gates for upgrades/gems (`RvUpgradeService`, `SpawnerRvService`, `RVOfferService`),
  `RemoveAdsService`, `RateUsService`, remote config / A-B tests.
- Play-store reviews complain about forced ads restarting levels and no offline play.

## Notes / limitations

- The global tuning blob `TextAsset "metadata"` in `data.unity3d` is an encrypted
  binary (`MDE…`, entropy ~5.8) — not parsed; level/machine data above came from
  the Addressables prefabs instead, which contained everything needed.
- Extracted artifacts: `dump/monos3.json` (all MonoBehaviour typetrees with resolved
  names/positions), `dump/levels_layout.json`, `dump/scripts_all.json`,
  `apk_list.txt`. The 174 MB XAPK is at `game.xapk` if you want to inspect further.

---

## v2 extraction: hierarchy-resolved world transforms (re/dump_hier.py, re/dump_world.py, re/dump_world2.py, re/gen_layouts.py)

The first pass (dump2/dump3) read component-local transforms, which is why machine
positions looked like ~0. This pass walks each `Level N` prefab's GameObject tree and
composes parent transforms (position/quaternion/scale) into world space.

### Structure of a level (confirmed)
- Root `Level N` carries `Level` (targetCoins=100) and `LevelCameraBounds`.
- Each direct child named `Pusher` / `Pusher (n)` is one **tier**: a platform
  (`Base` + floor MeshCollider) plus a moving `Pusher/Dozer` plate (kinematic
  Rigidbody + BoxCollider + `PusherInteraction{direction,speed=2,minDistance,
  maxDistance,backHoldDuration=1}`) with a `DozerWall`. Levels have 1-5 tiers
  (Level 12: 3, Level 17: 5), stacked at different elevations and offsets - the
  game is a **vertical multi-tier tower**, not a single tray.
- `CoinSpawnController` (dispenser, LeanFingerTap = tap to drop) at the top:
  `maxCharges=15, refillInterval=2, chargesPerRefill=1, guaranteedBronzeCoinCount=10`,
  with a `Spawn Point` child.
- `CoinCollector` + `CoinCollectorInteraction` with a trigger BoxCollider at the bottom.
- Machines: `ConveyorBelt`, `Fan`(AirBlower), `Magnet`, `MovingMagnet`, `TeslaCoil`,
  `Portal` (paired with an `Out Portal` sibling in a `Portal Pair`), `MultiplyingGate`,
  `DollarGate`, `Spike`, `MovingPlatform`, `Laser` - each with a trigger BoxCollider and
  per-instance params (e.g. TeslaCoil level 12: interval=1.2, maxHopDistance=1.0;
  Portal: pullDuration=0.35-0.4; Magnet: attractionDuration=2, attractMultiplier=30).
- Coins: `BronzeCoin`/`SilverCoin`/`GoldCoin` prefabs, mesh `Cylinder.002`
  (world diameter 0.0868, height 0.0159 - flat discs), values 2/5/10, weights 90/8/2,
  maxSpeed 5; `GemCoin` = diamond mesh, currency 2.

### Camera rig (LevelCameraBounds, per level)
- `fieldOfView=20` (perspective, narrow - the "isometric look" of the store shots),
  `rotationEuler` = (35,330,0) for early levels, (30,320,0) for late levels,
  camera rests at the `zoomInMarker` transform (zoomOutMarker = max zoom-out),
  with top/bottom/left/right markers bounding pan. Scene `Main Camera` default:
  pos (0.55,2.11,-1.49), fov 50 - the menu view; per-level rig overrides to fov 20.

### Outputs
- `re/dump/level_trees.json`, `level_world.json`, `level_world2.json` - full trees with
  world transforms, colliders, component fields.
- `re/dump/levels_final.json` - compact per-level spec (tiers w/ floor AABBs, pushers,
  machines w/ world pos + params + trigger boxes, portal exits, collector, spawn, camera).
- `re/gen_js.py` turns that into `js/level_layouts.js` (all positions scaled x10).
- `test/fixture-levels.json` - expectations the test suite checks against.

### Known interpretation (documented, not extracted)
- Pusher sweep travel: the extracted plate is ~pad-sized, so the sweep range is derived
  geometrically (back edge -> past the open edge); speed=2 and backHoldDuration=1 are
  extracted and used as-is.
- Camera distance: the original rig picks zoom from markers; we keep the extracted
  direction/fov and fit distance to the portrait frame.
