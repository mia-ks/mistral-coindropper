const CONFIG = {
  world: {
    halfX: 4.5,
    backZ: 1,
    edgeZ: 17,
    floorY: 0,
    pusherBaseZ: 1.6,
    pusherTravel: 3.5,
    pusherThick: 0.8,
    pusherH: 3,
    coinR: 0.55,
    coinH: 0.09,
    gravity: 14,
    maxCoins: 130,
    killY: 9,
    spawnY: 8,
  },
  coins: [
    { id: 0, name: 'Bronze', value: 2, weight: 90, color: 0xc98a4b, rim: 0x8a5a2b, symbol: 'B' },
    { id: 1, name: 'Silver', value: 5, weight: 8, color: 0xd8dde6, rim: 0x8f97a6, symbol: 'S' },
    { id: 2, name: 'Gold', value: 10, weight: 2, color: 0xffd24a, rim: 0xb8860b, symbol: 'G' },
    { id: 3, name: 'Gem', value: 1, weight: 0, color: 0x4ad6ff, rim: 0x1a7fa8, symbol: '◆', gem: true },
  ],
  spawn: {
    maxCharges: 15,
    refillInterval: 2.0,
    chargesPerRefill: 1,
    guaranteedBronzeCount: 10,
  },
  goal: 100,
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
  machineTypes: {
    conveyor:     { label: 'Conveyor',        w: 3 },
    fan:          { label: 'Air Blower',      speed: 10, y: 2.6, r: 3 },
    magnet:       { label: 'Magnet',          speed: 0.55, y: 2.2, r: 3.2, attraction: 2 },
    movingMagnet: { label: 'Junkyard Magnet', speed: 0.55, y: 2.2, r: 3.2, attraction: 2, sway: 2, stay: 1.5 },
    launcher:     { label: 'Launcher',        speed: 2, y: 1.2, r: 2.5, interval: 1.2, hop: 2.2 },
    portal:       { label: 'Portal',          w: 1.6, outOffset: 6, pull: 0.35 },
    gate:         { label: 'x2 Gate',         w: 3, mult: 2 },
    dollarGate:   { label: 'Cash Gate',       w: 3, cash: 1 },
    spike:        { label: 'Spikes',          w: 2.5 },
    platform:     { label: 'Mover',           w: 3.5, carry: 6, stay: 5 },
    laser:        { label: 'Laser',           w: 1.2, on: 1.0, off: 2.0 },
    suction:      { label: 'Suction',         speed: 2.2, y: 1.6, r: 2.8 },
  },
  upgrades: {
    coinValue: { label: 'Coin Value',   icon: 'C', baseCost: 50,  costMult: 3.0, max: 20, desc: '+25% coin value per level' },
    refill:    { label: 'Fast Refill',  icon: 'F', baseCost: 100, costMult: 2.5, max: 10, desc: 'Refill charges 10% faster per level' },
    capacity:  { label: 'Capacity',     icon: 'K', baseCost: 150, costMult: 2.5, max: 10, desc: '+5 max charges per level' },
    autoDrop:  { label: 'Auto Dropper', icon: 'A', baseCost: 500, costMult: 4.0, max: 5,  desc: 'Automatically drops a coin (5s, faster per level)' },
    combo:     { label: 'Combo Boost',  icon: 'X', baseCost: 200, costMult: 3.0, max: 10, desc: '+10% combo multiplier per level' },
  },
  shakeCost: 1,
};

function buildLevels(layouts) {
  return Object.keys(layouts).map((k) => {
    const n = parseInt(k);
    const L = layouts[n];
    return {
      index: n,
      goal: L.goal || CONFIG.goal,
      spawn: { ...CONFIG.spawn },
      machines: L.machines.map((m) => ({ ...(CONFIG.machineTypes[m.type] || {}), type: m.type, x: m.x, z: m.z })),
    };
  }).sort((a, b) => a.index - b.index);
}

let LAYOUTS = typeof LEVEL_LAYOUTS !== 'undefined' ? LEVEL_LAYOUTS : null;
if (!LAYOUTS && typeof module !== 'undefined' && module.exports) {
  LAYOUTS = require('./level_layouts.js').LEVEL_LAYOUTS;
}
const LEVELS = buildLevels(LAYOUTS || {});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, LEVELS, LEVEL_LAYOUTS: LAYOUTS };
}
