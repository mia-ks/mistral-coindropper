// Game state: currencies, charges, combo, level progression, upgrades, save/load.
// Economy rules verified against the APK's extracted values (re/dump/).
function makeGame(CONFIG, LEVELS, engine) {
  const SAVE_KEY = 'coindozer-clean-save-v3';

  const state = {
    levelIndex: 0,
    bank: 0, gems: 0, cash: 0,
    charges: CONFIG.spawn.maxCharges,
    refillTimer: 0,
    totalDrops: 0,
    combo: 0, comboTimer: 0,
    progress: 0,
    completed: false,
    freezeLevel: false, // transient: scripted capture must never auto-advance the level
    upgrades: {},       // machineId -> level
    globalUpgrades: { value: 0, refill: 0, capacity: 0, combo: 0 },
    lastSave: Date.now(),
    incomeRate: 0,      // coins/s, measured from recent collections
    recent: [],         // [timestamp, amount]
  };

  let world = null;

  function level() { return LEVELS[state.levelIndex]; }

  function loadLevel(idx) {
    state.levelIndex = ((idx % LEVELS.length) + LEVELS.length) % LEVELS.length;
    world = engine.createWorld(level());
    state.progress = 0;
    state.completed = false;
    state.freezeLevel = false;
    return world;
  }

  function pickCoinType() {
    // first `guaranteedBronzeCount` drops are bronze (checked before incrementing)
    if (state.totalDrops < level().spawn.guaranteedBronzeCount) return CONFIG.coins[0];
    const total = CONFIG.coins.reduce((s, c) => s + c.weight, 0);
    let r = Math.random() * total;
    for (const c of CONFIG.coins) { r -= c.weight; if (r <= 0) return c; }
    return CONFIG.coins[0];
  }

  function drop() {
    const lv = level();
    const cap = lv.spawn.maxCharges + state.globalUpgrades.capacity * 5;
    if (state.charges <= 0 || !world || world.coins.length >= CONFIG.world.maxCoins) return null;
    if (state.charges >= cap) state.refillTimer = 0;
    state.charges--;
    const def = pickCoinType();
    state.totalDrops++;
    return engine.dropCoin(world, def);
  }

  function comboMult() {
    return 1 + CONFIG.comboStep * Math.max(0, state.combo - 1);
  }

  function collect(coin) {
    const def = CONFIG.coins.find((c) => c.id === coin.type) || CONFIG.coins[0];
    // combo updated before payout; expires during tick
    if (state.comboTimer > 0) { state.combo = Math.min(CONFIG.comboMax, state.combo + 1); }
    else state.combo = 1;
    state.comboTimer = CONFIG.comboWindow;
    let value = def.value * (1 + state.globalUpgrades.value * 0.5) * coin.mult * comboMult();
    if (def.gem) { state.gems += value; return value; }
    state.bank += value;
    state.progress += value;
    const now = Date.now();
    state.recent.push([now, value]);
    while (state.recent.length && now - state.recent[0][0] > 10000) state.recent.shift();
    const sum = state.recent.reduce((s, r) => s + r[1], 0);
    state.incomeRate = sum / 10;
    // level completes only on crossing the goal
    const goal = level().goal;
    if (!state.completed && state.progress >= goal) {
      state.completed = true;
      state.gems += CONFIG.levelRewardGems;
      state.bank += CONFIG.levelRewardCoinBase * (state.levelIndex + 1);
    }
    return value;
  }

  function tick(dt) {
    // charges refill
    const cap = level().spawn.maxCharges + state.globalUpgrades.capacity * 5;
    if (state.charges < cap) {
      state.refillTimer += dt;
      const interval = Math.max(0.2, level().spawn.refillInterval * Math.pow(0.9, state.globalUpgrades.refill));
      while (state.refillTimer >= interval && state.charges < cap) {
        state.refillTimer -= interval;
        state.charges = Math.min(cap, state.charges + level().spawn.chargesPerRefill);
      }
    }
    // combo expiry
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) { state.comboTimer = 0; state.combo = 0; }
    }
    if (world) engine.step(world, dt);
    if (world) {
      for (const ev of world.events) {
        if (ev.type === 'collect') collect(ev.coin);
        else if (ev.type === 'dollar') {
          state.cash += ev.amount;
          if (ev.addToProgression) state.progress += ev.amount;
        }
      }
      world.events.length = 0;
    }
    // level progression: complete on crossing; last level rolls progress over
    const goal = level().goal;
    if (state.completed && !state.freezeLevel) {
      if (state.levelIndex === LEVELS.length - 1) {
        state.progress -= goal; // endless carry-over, no repeated reward
        state.completed = false;
      } else {
        loadLevel(state.levelIndex + 1);
      }
    }
  }

  function upgradeMachine(id) {
    const lvl = (state.upgrades[id] || 0);
    if (lvl >= CONFIG.machineMaxLevel) return false;
    const cost = Math.ceil(CONFIG.machineCostBase * Math.pow(CONFIG.machineCostMult, lvl));
    if (state.gems < cost) return false;
    state.gems -= cost;
    state.upgrades[id] = lvl + 1;
    if (world) {
      const m = world.machines.find((x) => x.id === id);
      if (m) m.level = lvl + 1;
    }
    return true;
  }

  function upgradeGlobal(key) {
    const lvl = state.globalUpgrades[key] || 0;
    const cost = 3 + lvl * 2;
    if (state.gems < cost) return false;
    state.gems -= cost;
    state.globalUpgrades[key] = lvl + 1;
    return true;
  }

  function serialize() {
    return {
      v: 3,
      state: {
        levelIndex: state.levelIndex, bank: state.bank, gems: state.gems, cash: state.cash,
        charges: state.charges, refillTimer: state.refillTimer, totalDrops: state.totalDrops,
        combo: state.combo, comboTimer: state.comboTimer, progress: state.progress,
        completed: state.completed, upgrades: state.upgrades, globalUpgrades: state.globalUpgrades,
        lastSave: Date.now(), incomeRate: state.incomeRate,
      },
      world: world ? engine.serialize(world) : null,
    };
  }

  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(serialize())); } catch (e) { /* private mode */ }
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      const data = JSON.parse(raw);
      if (!data || data.v !== 3 || !data.state) return false;
      Object.assign(state, data.state);
      loadLevel(state.levelIndex);
      if (data.world) engine.restore(world, data.world); // coins restored raw: no respawn clamping
      // offline earnings: incomeRate * elapsed * efficiency, capped; 0 when incomeRate is 0
      const elapsed = Math.min(CONFIG.offlineCapSeconds, Math.max(0, (Date.now() - (state.lastSave || Date.now())) / 1000));
      const gain = (state.incomeRate > 0 ? state.incomeRate : 0) * elapsed * CONFIG.offlineEfficiency;
      state.bank += gain;
      state.offlineGain = gain;
      return true;
    } catch (e) { return false; }
  }

  return {
    state, loadLevel, drop, tick, collect, upgradeMachine, upgradeGlobal, save, load, serialize,
    get world() { return world; }, comboMult,
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeGame };
