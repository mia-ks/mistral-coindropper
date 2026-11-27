// browser: LEVEL_LAYOUTS is the global lexical binding from the level_layouts.js classic script
// node: require it
const _LAYOUTS = (typeof module !== 'undefined' && module.exports)
  ? require('./level_layouts.js').LEVEL_LAYOUTS
  : LEVEL_LAYOUTS;

// World constants extracted from the APK (re/dump/levels_final.json):
// coin mesh Cylinder.002 AABB x coin prefab scale, Unity gravity -9.81, maxSpeed 5,
// all positions scaled x10 (LEVEL_LAYOUTS.scale) from Unity level units.
const S = _LAYOUTS.scale;
const BRONZE = _LAYOUTS.coins.BronzeCoin;
const SILVER = _LAYOUTS.coins.SilverCoin;
const GOLD = _LAYOUTS.coins.GoldCoin;
const GEM = _LAYOUTS.coins.GemCoin;

const CONFIG = {
  world: {
    scale: S,
    coinR: BRONZE.diameter / 2,          // 0.4338
    coinH: BRONZE.height,                // 0.1589
    gravity: 98.1,                       // -9.81 * S
    maxSpeed: 50,                        // maxSpeed 5 * S
    maxCoins: 220,
    substeps: 2,
    pairPasses: 3,
    wallRestitution: 0.25,
    floorDamping: 0.995,
    killMargin: 6,                       // below collector bottom
    snap: 0.05,
  },
  coins: [
    { id: 0, name: 'Bronze', value: BRONZE.fields.value, weight: BRONZE.fields.spawnWeight, color: 0xff9f1a, rim: 0xb25e00, symbol: '\u2605' },
    { id: 1, name: 'Silver', value: SILVER.fields.value, weight: SILVER.fields.spawnWeight, color: 0xd8dde6, rim: 0x8f97a6, symbol: 'S' },
    { id: 2, name: 'Gold', value: GOLD.fields.value, weight: GOLD.fields.spawnWeight, color: 0xffd24a, rim: 0xb8860b, symbol: 'G' },
    { id: 3, name: 'Gem', value: GEM.fields.value, weight: 0, color: 0x4ad6ff, rim: 0x1a7fa8, symbol: '\u25c6', gem: true },
  ],
  // CoinSpawnController fields (per level, defaults from Level 1)
  spawn: { maxCharges: 15, refillInterval: 2.0, chargesPerRefill: 1, guaranteedBronzeCount: 10 },
  goal: 100, // Level.targetCoins
  gemInterval: 40,
  levelRewardGems: 5,
  levelRewardCoinBase: 50,
  comboWindow: 3.0,
  comboMax: 20,
  comboStep: 0.1,
  offlineCapSeconds: 8 * 3600,
  offlineEfficiency: 0.5,
  machineCostBase: 2,
  machineCostMult: 1.6,
  machineMaxLevel: 10,
  machineEffectPerLevel: 0.2,
  // Per-machine-type defaults; every per-instance value extracted from the prefab
  // overrides these (see buildLevels). Lengths are in Unity units and get xS below.
  machineTypes: {
    ConveyorBelt:     { label: 'Conveyor',        direction: 2, speed: 2 },
    Fan:              { label: 'Air Blower',      speed: 10, pushMultiplier: 3, r: 4.5 },
    Magnet:           { label: 'Magnet',          speed: 0.55, attractionDuration: 2, slideDuration: 1, hiddenDuration: 3, attractMultiplier: 30, r: 4.5 },
    MovingMagnet:     { label: 'Moving Magnet',   speed: 0.55, attractionDuration: 2, travelDuration: 4, stayDuration: 1.5, attractMultiplier: 25, r: 4.5 },
    TeslaCoil:        { label: 'Tesla Coil',      speed: 2, interval: 1.2, firstPulseDelay: 1, maxHopDistance: 1, liftRatio: 0.15, r: 3 },
    Portal:           { label: 'Portal',          pullDuration: 0.4, duration: 1.15, hiddenDuration: 3, r: 2.5 },
    MultiplyingGate:  { label: 'x2 Gate',         multiplier: 2 },
    DollarGate:       { label: '$ Gate',          cashAmount: 1, addToProgression: 1 },
    Spike:            { label: 'Spikes',          r: 2.5 },
    MovingPlatform:   { label: 'Mover',           travelDuration: 4, stayDuration: 5, dropHoldDuration: 1 },
    Laser:            { label: 'Laser',           maxLength: 0.45, emitterCount: 5, emitterSpacing: 0.115, onDuration: 6, offDuration: 3 },
  },
};

// Length-valued params (Unity units -> game units xS). Times/durations stay in seconds.
const LENGTH_PARAMS = ['speed', 'maxHopDistance', 'maxLength', 'emitterSpacing', 'r', 'w', 'outOffset'];

function buildLevels() {
  const levels = [];
  const keys = Object.keys(_LAYOUTS.levels).sort((a, b) => parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]));
  for (const key of keys) {
    const raw = _LAYOUTS.levels[key];
    const idx = parseInt(key.split(' ')[1]);
    const spawn = { ...CONFIG.spawn, ...(raw.spawn || {}) };
    const tiers = (raw.tiers || []).map((t) => ({
      name: t.name,
      floor: t.floor, // {min:[x,top,z], max:[x,top,z]} world AABB of the platform collider
      walls: t.walls || [], // retaining wall colliders of this tier {go,col,min,max}
      visual: t.visual, // world AABB of the whole tier assembly (solid block extents)
      pusher: t.pusher, // {pos, box:{min,max}, wall, origin, axis, sign, travel, speed, ...}
    }));
    const machines = (raw.machines || []).map((m, i) => {
      const def = CONFIG.machineTypes[m.type] || { label: m.type };
      const params = { ...def, ...(m.params || {}) };
      for (const k of LENGTH_PARAMS) if (typeof params[k] === 'number') params[k] *= S;
      return { id: i, type: m.type, go: m.go, pos: m.pos, yaw: m.yaw || 0, tierName: m.tier, params, box: m.box, exit: m.exit || null, visual: m.visual || null };
    });
    levels.push({
      index: idx,
      goal: raw.goal || CONFIG.goal,
      camera: raw.camera, // raw Unity {pos, euler, fov} from LevelCameraBounds
      cameraGL: raw.cameraGL || null, // handedness-converted {pos, quat, fov} for three.js
      meshData: raw.meshData || null, // real exported Unity mesh instances + dozers
      spawn: { pos: spawn.pos, point: spawn.point, maxCharges: spawn.maxCharges, refillInterval: spawn.refillInterval, chargesPerRefill: spawn.chargesPerRefill, guaranteedBronzeCount: spawn.guaranteedBronzeCount },
      collector: raw.collector, // {pos, box:{min,max}}
      bg: raw.bg || null, // {pos, meshSize:[w,h,d]}
      tiers,
      walls: raw.walls || [], // level-level solid colliders (chute walls, base columns)
      machines,
    });
  }
  return levels;
}

// per-level background gradient top colors, sampled from the original's store
// screenshots (re/refshots) where a stage is shown; default purple otherwise
const BG_TOP = { 1: [101, 28, 143], 7: [74, 40, 106], 10: [85, 66, 72], 14: [66, 102, 100] };
const LEVELS = buildLevels();
for (const lv of LEVELS) {
  const t = BG_TOP[lv.index] || [138, 99, 240];
  lv.bgTop = t;
  lv.bgBottom = t.map((v) => Math.round(v * 0.42));
}

if (typeof module !== 'undefined' && module.exports) module.exports = { CONFIG, LEVELS };
