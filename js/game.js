function makeGame(CONFIG, LEVELS, engine, storage) {
  const store = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
  const SAVE_KEY = 'coindozer-clean-save-v1';

  function defaultState() {
    return {
      v: 1,
      coins: 0,
      cash: 0,
      gems: 0,
      levelIndex: 0,
      progress: 0,
      charges: CONFIG.spawn.maxCharges,
      refillTimer: 0,
      totalDrops: 0,
      combo: 0,
      lastCollectAt: -99,
      upgrades: { coinValue: 0, refill: 0, capacity: 0, autoDrop: 0, combo: 0 },
      machineLevels: {},
      pusherLevels: {},
      autoTimer: 0,
      gemTimer: CONFIG.gemInterval,
      stats: { collected: 0, earned: 0, spent: 0, levelsCompleted: 0 },
      incomeRate: 0,
      settings: { muted: false },
      lastSeen: Date.now(),
    };
  }

  let state = defaultState();
  let world = engine.createWorld(LEVELS[0]);

  function save() {
    state.lastSeen = Date.now();
    if (store) {
      try { store.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
    }
  }

  function load() {
    if (!store) return false;
    try {
      const raw = store.getItem(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1) return false;
      state = Object.assign(defaultState(), s);
      state.upgrades = Object.assign(defaultState().upgrades, s.upgrades || {});
      state.stats = Object.assign(defaultState().stats, s.stats || {});
      state.settings = Object.assign(defaultState().settings, s.settings || {});
      return true;
    } catch (e) {
      return false;
    }
  }

  function reset() {
    state = defaultState();
    world = engine.createWorld(LEVELS[0]);
    save();
  }

  function currentLevel() {
    return LEVELS[Math.min(state.levelIndex, LEVELS.length - 1)];
  }

  function loadLevel(index, preserveProgress) {
    state.levelIndex = Math.max(0, Math.min(index, LEVELS.length - 1));
    if (!preserveProgress) state.progress = 0;
    world = engine.createWorld(currentLevel());
    const ml = state.machineLevels[state.levelIndex] || {};
    world.machines.forEach((m, i) => { m.level = ml[i] || 0; });
    const pusherLvl = state.pusherLevels[state.levelIndex] || 0;
    world.pusher.level = pusherLvl;
  }

  function coinValueMult() {
    return Math.pow(1.25, state.upgrades.coinValue);
  }

  function comboMult() {
    const base = 1 + CONFIG.comboStep * Math.min(state.combo, CONFIG.comboMax);
    return base * (1 + 0.1 * state.upgrades.combo);
  }

  function maxCharges() {
    return CONFIG.spawn.maxCharges + 5 * state.upgrades.capacity;
  }

  function refillInterval() {
    return Math.max(0.4, CONFIG.spawn.refillInterval * Math.pow(0.9, state.upgrades.refill));
  }

  function autoDropInterval() {
    if (!state.upgrades.autoDrop) return Infinity;
    return 5 * Math.pow(0.7, state.upgrades.autoDrop - 1);
  }

  function pickCoinType() {
    if (state.totalDrops < CONFIG.spawn.guaranteedBronzeCount) return CONFIG.coins[0];
    const total = CONFIG.coins.reduce((s, c) => s + (c.gem ? 0 : c.weight), 0);
    let roll = Math.random() * total;
    for (const c of CONFIG.coins) {
      if (c.gem) continue;
      roll -= c.weight;
      if (roll <= 0) return c;
    }
    return CONFIG.coins[0];
  }

  function canDrop() {
    return state.charges >= 1 && world.coins.length < CONFIG.world.maxCoins;
  }

  function dropAt(x, z, free) {
    if (!free && !canDrop()) return null;
    if (!free) {
      state.charges -= 1;
      state.totalDrops += 1;
    }
    const type = pickCoinType();
    return engine.dropCoin(world, x, z, type);
  }

  function dropGem() {
    const x = (Math.random() * 2 - 1) * (CONFIG.world.halfX - 1.5);
    const z = CONFIG.world.backZ + 3 + Math.random() * (CONFIG.world.edgeZ - CONFIG.world.backZ - 6);
    return engine.dropCoin(world, x, z, CONFIG.coins[3]);
  }

  function upgradeCost(key) {
    const u = CONFIG.upgrades[key];
    const lvl = state.upgrades[key];
    if (lvl >= u.max) return null;
    return Math.round(u.baseCost * Math.pow(u.costMult, lvl));
  }

  function buyUpgrade(key) {
    const cost = upgradeCost(key);
    if (cost === null || state.coins < cost) return false;
    state.coins -= cost;
    state.stats.spent += cost;
    state.upgrades[key] += 1;
    save();
    return true;
  }

  function machineUpgradeCost(levelIdx, machineIdx) {
    const lvl = ((state.machineLevels[levelIdx] || {})[machineIdx]) || 0;
    if (lvl >= CONFIG.machineMaxLevel) return null;
    return Math.round(CONFIG.machineCostBase * Math.pow(CONFIG.machineCostMult, lvl));
  }

  function pusherUpgradeCost(levelIdx) {
    const lvl = state.pusherLevels[levelIdx] || 0;
    if (lvl >= CONFIG.machineMaxLevel) return null;
    return Math.round(CONFIG.machineCostBase * Math.pow(CONFIG.machineCostMult, lvl));
  }

  function buyMachineUpgrade(levelIdx, machineIdx) {
    const cost = machineUpgradeCost(levelIdx, machineIdx);
    if (cost === null || state.gems < cost) return false;
    state.gems -= cost;
    if (!state.machineLevels[levelIdx]) state.machineLevels[levelIdx] = {};
    state.machineLevels[levelIdx][machineIdx] = (state.machineLevels[levelIdx][machineIdx] || 0) + 1;
    if (levelIdx === state.levelIndex && world.machines[machineIdx]) {
      world.machines[machineIdx].level = state.machineLevels[levelIdx][machineIdx];
    }
    save();
    return true;
  }

  function buyPusherUpgrade(levelIdx) {
    const cost = pusherUpgradeCost(levelIdx);
    if (cost === null || state.gems < cost) return false;
    state.gems -= cost;
    state.pusherLevels[levelIdx] = (state.pusherLevels[levelIdx] || 0) + 1;
    if (levelIdx === state.levelIndex) world.pusher.level = state.pusherLevels[levelIdx];
    save();
    return true;
  }

  function pusherSpeed() {
    const lvl = state.pusherLevels[state.levelIndex] || 0;
    return 2 * (1 + CONFIG.machineEffectPerLevel * lvl);
  }

  function handleEvents(events, now) {
    let collectedValue = 0;
    let cashGain = 0;
    let gemsGain = 0;
    for (const e of events) {
      if (e.type === 'collect') {
        const def = CONFIG.coins.find((c) => c.id === e.coin.type) || CONFIG.coins[0];
        if (def.gem) {
          gemsGain += 1;
        } else {
          const v = def.value * e.coin.mult * coinValueMult() * comboMult();
          collectedValue += v;
          cashGain += e.cash || 0;
        }
        if (now - state.lastCollectAt < CONFIG.comboWindow) state.combo += 1;
        else state.combo = 1;
        state.lastCollectAt = now;
        state.stats.collected += 1;
      }
    }
    if (collectedValue > 0 || cashGain > 0 || gemsGain > 0) {
      state.coins += collectedValue;
      state.cash += cashGain;
      state.gems += gemsGain;
      state.stats.earned += collectedValue;
      state.progress += collectedValue;
      const lv = currentLevel();
      if (state.progress >= lv.goal) {
        state.progress = lv.goal;
        completeLevel();
      }
    }
    return { collectedValue, cashGain, gemsGain };
  }

  function completeLevel() {
    state.stats.levelsCompleted += 1;
    const reward = CONFIG.levelRewardGems;
    const coinBonus = CONFIG.levelRewardCoinBase * (state.levelIndex + 1);
    state.gems += reward;
    state.coins += coinBonus;
    state.lastLevelReward = { gems: reward, coins: coinBonus };
    if (state.levelIndex < LEVELS.length - 1) {
      loadLevel(state.levelIndex + 1);
    } else {
      state.levelIndex = LEVELS.length - 1;
    }
    save();
  }

  function tick(dt, now) {
    state.refillTimer += dt;
    const ri = refillInterval();
    while (state.refillTimer >= ri && state.charges < maxCharges()) {
      state.refillTimer -= ri;
      state.charges += CONFIG.spawn.chargesPerRefill;
    }
    if (state.charges >= maxCharges()) state.refillTimer = 0;

    state.gemTimer -= dt;
    if (state.gemTimer <= 0) {
      state.gemTimer = CONFIG.gemInterval;
      dropGem();
    }

    state.autoTimer += dt;
    const ai = autoDropInterval();
    if (ai !== Infinity && state.autoTimer >= ai) {
      state.autoTimer = 0;
      if (canDrop()) {
        const x = (Math.random() * 2 - 1) * (CONFIG.world.halfX - 1.5);
        dropAt(x, CONFIG.world.backZ + 3 + Math.random() * 6, false);
      }
    }

    const events = engine.step(world, dt, { pusherSpeed: pusherSpeed() });
    const gains = handleEvents(events, now);

    const window = 10;
    state.incomeRate = state.incomeRate * 0.9 + (gains.collectedValue / Math.max(dt, 0.001)) * 0.1;
    state._window = window;
    return { events, gains };
  }

  function shake() {
    if (state.cash < CONFIG.shakeCost) return false;
    state.cash -= CONFIG.shakeCost;
    engine.shake(world, 14);
    save();
    return true;
  }

  function applyOffline() {
    const now = Date.now();
    const away = Math.max(0, (now - (state.lastSeen || now)) / 1000);
    if (away < 60) return null;
    const capped = Math.min(away, CONFIG.offlineCapSeconds);
    const rate = Math.max(state.incomeRate, 2);
    const gain = capped * rate * CONFIG.offlineEfficiency;
    if (gain > 0) {
      state.coins += gain;
      state.stats.earned += gain;
    }
    return { seconds: away, gain };
  }

  function getState() { return state; }
  function getWorld() { return world; }

  return {
    load, save, reset, tick, dropAt, canDrop, shake,
    buyUpgrade, buyMachineUpgrade, buyPusherUpgrade,
    upgradeCost, machineUpgradeCost, pusherUpgradeCost,
    coinValueMult, comboMult, maxCharges, refillInterval, autoDropInterval, pusherSpeed,
    currentLevel, loadLevel, applyOffline, handleEvents,
    getState, getWorld,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  const { CONFIG, LEVELS } = require('./config.js');
  const { makeEngine } = require('./engine.js');
  const engine = makeEngine(CONFIG);
  module.exports = { makeGame, CONFIG, LEVELS, engine };
}
