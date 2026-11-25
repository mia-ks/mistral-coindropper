const CONFIG = {
  world: {
    width: 100,
    backX: 8,
    edgeX: 92,
    floorY: 0,
    pusherBaseX: 11,
    pusherTravel: 7,
    pusherThickness: 2.5,
    pusherHeight: 9,
    coinRadius: 1.5,
    gravity: 55,
    maxCoins: 140,
    killY: 30,
  },
  coins: [
    { id: 0, name: 'Bronze', value: 2, weight: 90, color: '#c98a4b', rim: '#8a5a2b', symbol: 'B' },
    { id: 1, name: 'Silver', value: 5, weight: 8, color: '#d8dde6', rim: '#8f97a6', symbol: 'S' },
    { id: 2, name: 'Gold', value: 10, weight: 2, color: '#ffd24a', rim: '#b8860b', symbol: 'G' },
    { id: 3, name: 'Gem', value: 1, weight: 0, color: '#4ad6ff', rim: '#1a7fa8', symbol: '◆', gem: true },
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
    conveyor:     { label: 'Conveyor',   w: 12, speed: 2 },
    fan:          { label: 'Air Blower', w: 0, speed: 10, y: 7, r: 11 },
    magnet:       { label: 'Magnet',     w: 0, speed: 0.55, y: 6, r: 9, attraction: 2 },
    movingMagnet: { label: 'Junkyard Magnet', w: 0, speed: 0.55, y: 6, r: 9, attraction: 2, sway: 3, stay: 1.5 },
    launcher:     { label: 'Launcher',   w: 0, speed: 2, y: 3, r: 6, interval: 1.2, hop: 6 },
    portal:       { label: 'Portal',     w: 3, outOffset: 18, pull: 0.35 },
    gate:         { label: 'x2 Gate',    w: 3, mult: 2 },
    dollarGate:   { label: 'Cash Gate',  w: 3, cash: 1 },
    spike:        { label: 'Spikes',     w: 4 },
    platform:     { label: 'Mover',      w: 10, carry: 30, stay: 5 },
    laser:        { label: 'Laser',      w: 2, on: 1.0, off: 2.0 },
    suction:      { label: 'Suction',    w: 6, pull: 150, y: 4, r: 8 },
  },
  upgrades: {
    coinValue: { label: 'Coin Value',   icon: '💰', baseCost: 50,  costMult: 3.0, max: 20, desc: '+25% coin value per level' },
    refill:    { label: 'Fast Refill',  icon: '⚡', baseCost: 100, costMult: 2.5, max: 10, desc: 'Refill charges 10% faster per level' },
    capacity:  { label: 'Capacity',     icon: '🧺', baseCost: 150, costMult: 2.5, max: 10, desc: '+5 max charges per level' },
    autoDrop:  { label: 'Auto Dropper', icon: '🤖', baseCost: 500, costMult: 4.0, max: 5,  desc: 'Automatically drops a coin (5s, faster per level)' },
    combo:     { label: 'Combo Boost',  icon: '🔥', baseCost: 200, costMult: 3.0, max: 10, desc: '+10% combo multiplier per level' },
  },
  shakeCost: 1,
};

function levelMachines(list) {
  const out = [];
  const n = list.length;
  list.forEach((t, i) => {
    const x = n === 1 ? 58 : 30 + (56 * i) / (n - 1);
    const def = CONFIG.machineTypes[t] || {};
    out.push({ type: t, x: Math.round(x * 10) / 10, ...def });
  });
  return out;
}

const LEVELS = [
  { machines: levelMachines(['gate']) },
  { machines: levelMachines(['conveyor', 'gate']) },
  { machines: levelMachines(['fan', 'gate']) },
  { machines: levelMachines(['conveyor', 'fan', 'gate']) },
  { machines: levelMachines(['conveyor', 'spike', 'gate']) },
  { machines: levelMachines(['conveyor', 'fan', 'gate', 'gate']) },
  { machines: levelMachines(['conveyor', 'conveyor', 'magnet', 'fan', 'gate']) },
  { machines: levelMachines(['conveyor', 'conveyor', 'portal', 'spike', 'gate']) },
  { machines: levelMachines(['conveyor', 'fan', 'spike', 'gate', 'gate']) },
  { machines: levelMachines(['conveyor', 'conveyor', 'fan', 'portal', 'spike', 'gate', 'dollarGate']) },
  { machines: levelMachines(['conveyor', 'platform', 'magnet', 'fan', 'spike', 'gate', 'portal']) },
  { machines: levelMachines(['launcher', 'launcher', 'fan', 'gate']) },
  { machines: levelMachines(['conveyor', 'fan', 'portal', 'spike', 'gate']) },
  { machines: levelMachines(['conveyor', 'conveyor', 'fan', 'fan', 'magnet', 'launcher', 'portal', 'gate']) },
  { machines: levelMachines(['conveyor', 'fan', 'fan', 'magnet', 'launcher', 'portal', 'gate', 'gate']) },
  { machines: levelMachines(['conveyor', 'conveyor', 'fan', 'launcher', 'launcher', 'portal', 'spike', 'movingMagnet', 'dollarGate', 'gate', 'gate']) },
  { machines: levelMachines(['conveyor', 'conveyor', 'conveyor', 'fan', 'fan', 'laser', 'portal', 'gate', 'gate']) },
  { machines: levelMachines(['conveyor', 'conveyor', 'conveyor', 'fan', 'magnet', 'portal', 'spike', 'spike', 'gate']) },
  { machines: levelMachines(['conveyor', 'fan', 'fan', 'fan', 'launcher', 'launcher', 'launcher', 'magnet', 'movingMagnet', 'platform', 'portal', 'spike', 'dollarGate', 'dollarGate', 'gate']) },
].map((l, i) => ({
  index: i + 1,
  goal: CONFIG.goal,
  spawn: { ...CONFIG.spawn },
  machines: l.machines,
}));

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, LEVELS };
}
