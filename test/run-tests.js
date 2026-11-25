const assert = require('assert');
const { CONFIG, LEVELS } = require('../js/config.js');
const { makeEngine } = require('../js/engine.js');
const { makeGame } = require('../js/game.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok -', name);
  } catch (e) {
    console.error('FAIL -', name);
    console.error(e);
    process.exitCode = 1;
  }
}

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

test('config: 19 levels, all with goal and spawn params', () => {
  assert.strictEqual(LEVELS.length, 19);
  for (const lv of LEVELS) {
    assert.strictEqual(lv.goal, 100);
    assert.strictEqual(lv.spawn.maxCharges, 15);
    assert.strictEqual(lv.spawn.refillInterval, 2.0);
    assert.ok(Array.isArray(lv.machines) && lv.machines.length >= 1);
  }
});

test('config: machine types known and positions on track', () => {
  for (const lv of LEVELS) {
    for (const m of lv.machines) {
      assert.ok(CONFIG.machineTypes[m.type], 'unknown machine ' + m.type);
      assert.ok(m.x > CONFIG.world.backX && m.x < CONFIG.world.edgeX, 'machine off track: ' + m.x);
    }
  }
});

test('config: coin table matches extracted values/weights', () => {
  const byId = Object.fromEntries(CONFIG.coins.map((c) => [c.id, c]));
  assert.deepStrictEqual(
    [byId[0].value, byId[1].value, byId[2].value, byId[3].gem],
    [2, 5, 10, true]
  );
  assert.deepStrictEqual(
    [byId[0].weight, byId[1].weight, byId[2].weight],
    [90, 8, 2]
  );
});

test('economy: first 10 drops are guaranteed bronze, then weighted', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  s.charges = 100;
  const types = [];
  for (let i = 0; i < 40; i++) {
    const c = game.dropAt(30 + (i % 10) * 5, false);
    types.push(c.type);
  }
  assert.deepStrictEqual(types.slice(0, 10).every((t) => t === 0), true);
  assert.ok(types.slice(10).every((t) => t >= 0 && t <= 2));
  assert.strictEqual(s.totalDrops, 40);
  assert.strictEqual(s.charges, 60);
});

test('economy: upgrade purchase deducts coins, scales cost, respects max', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  s.coins = 1000;
  const c0 = game.upgradeCost('coinValue');
  assert.strictEqual(c0, 50);
  assert.ok(game.buyUpgrade('coinValue'));
  assert.strictEqual(s.coins, 950);
  assert.strictEqual(s.upgrades.coinValue, 1);
  assert.strictEqual(game.upgradeCost('coinValue'), Math.round(50 * 3));
  assert.strictEqual(game.coinValueMult(), 1.25);
  s.coins = 0;
  assert.strictEqual(game.buyUpgrade('coinValue'), false);
  s.upgrades.coinValue = CONFIG.upgrades.coinValue.max;
  assert.strictEqual(game.upgradeCost('coinValue'), null);
});

test('economy: machine and pusher upgrades spend gems', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  s.gems = 10;
  assert.strictEqual(game.machineUpgradeCost(0, 0), 2);
  assert.ok(game.buyMachineUpgrade(0, 0));
  assert.strictEqual(s.gems, 8);
  assert.strictEqual(s.machineLevels[0][0], 1);
  assert.ok(game.buyPusherUpgrade(0));
  assert.strictEqual(s.gems, 6);
  assert.strictEqual(s.pusherLevels[0], 1);
  assert.strictEqual(game.pusherSpeed(), 2 * 1.2);
});

test('economy: combo multiplier grows within window and resets after', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  game.handleEvents([{ type: 'collect', coin: { type: 0, mult: 1 } }], 100);
  assert.strictEqual(s.combo, 1);
  game.handleEvents([{ type: 'collect', coin: { type: 0, mult: 1 } }], 101);
  assert.strictEqual(s.combo, 2);
  assert.ok(game.comboMult() > 1.1);
  game.handleEvents([{ type: 'collect', coin: { type: 0, mult: 1 } }], 200);
  assert.strictEqual(s.combo, 1);
});

test('economy: collecting fills goal and completes level with rewards', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  s.progress = 99;
  s.coins = 0;
  s.gems = 0;
  game.handleEvents([{ type: 'collect', coin: { type: 0, mult: 1 } }], 1);
  assert.strictEqual(s.stats.levelsCompleted, 1);
  assert.strictEqual(s.levelIndex, 1);
  assert.ok(s.gems >= CONFIG.levelRewardGems);
  assert.ok(s.coins >= CONFIG.levelRewardCoinBase * 1);
  assert.strictEqual(s.progress, 0);
});

test('economy: gate multiplies coin value at collect', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  s.coins = 0;
  s.upgrades.coinValue = 0;
  s.combo = 0;
  s.lastCollectAt = -99;
  game.handleEvents([{ type: 'collect', coin: { type: 2, mult: 2 } }], 5);
  assert.strictEqual(s.coins, 10 * 2 * 1 * 1);
});

test('physics: coins fall, get pushed, and some are collected over 40s', () => {
  const engine = makeEngine(CONFIG);
  const world = engine.createWorld(LEVELS[0]);
  let collects = 0;
  let drops = 0;
  for (let step = 0; step < 40 * 60; step++) {
    if (step % 30 === 0 && drops < 25) {
      engine.dropCoin(world, 20 + (drops % 8) * 6, CONFIG.coins[0]);
      drops++;
    }
    const events = engine.step(world, 1 / 60, { pusherSpeed: 2 });
    collects += events.filter((e) => e.type === 'collect').length;
    for (const c of world.coins) {
      assert.ok(isFinite(c.x) && isFinite(c.y), 'NaN coin position');
      assert.ok(Math.abs(c.vx) <= 61 && Math.abs(c.vy) <= 61, 'velocity explosion');
    }
    assert.ok(world.coins.length <= CONFIG.world.maxCoins);
  }
  assert.ok(collects > 0, 'expected some coins to be collected, got ' + collects);
});

test('physics: spikes destroy coins, fan lifts them, shake imparts velocity', () => {
  const engine = makeEngine(CONFIG);
  const lv = { goal: 100, spawn: CONFIG.spawn, machines: [{ type: 'spike', label: 'Spikes', x: 50, w: 4 }] };
  const world = engine.createWorld(lv);
  const c = engine.dropCoin(world, 50, CONFIG.coins[0]);
  let destroyed = false;
  for (let i = 0; i < 120 && !destroyed; i++) {
    const ev = engine.step(world, 1 / 60, { pusherSpeed: 0 });
    destroyed = ev.some((e) => e.type === 'destroy' && e.coin === c);
  }
  assert.ok(destroyed, 'spike should destroy the coin');

  const lv2 = { goal: 100, spawn: CONFIG.spawn, machines: [{ type: 'fan', label: 'Fan', x: 40, w: 0, speed: 50, y: 7, r: 11 }] };
  const w2 = engine.createWorld(lv2);
  const c2 = engine.dropCoin(w2, 40, CONFIG.coins[0]);
  let maxY = 0;
  for (let i = 0; i < 180; i++) {
    engine.step(w2, 1 / 60, { pusherSpeed: 0 });
    maxY = Math.max(maxY, c2.dead ? maxY : c2.y);
  }
  assert.ok(maxY > 6, 'fan should lift the coin, maxY=' + maxY);

  const w3 = engine.createWorld(LEVELS[0]);
  const c3 = engine.dropCoin(w3, 40, CONFIG.coins[0]);
  engine.step(w3, 1 / 60, { pusherSpeed: 0 });
  const vx0 = c3.vx;
  engine.shake(w3, 14);
  assert.ok(c3.vy > 0 || c3.vx !== vx0, 'shake should move coins');
});

test('save/load roundtrip and offline earnings cap', () => {
  const store = memStorage();
  const engine = makeEngine(CONFIG);
  const g1 = makeGame(CONFIG, LEVELS, engine, store);
  const s = g1.getState();
  s.coins = 123.5;
  s.gems = 7;
  s.levelIndex = 4;
  s.incomeRate = 10;
  g1.save();
  const raw = JSON.parse(store.getItem('coindozer-clean-save-v1'));
  raw.lastSeen = Date.now() - 3 * 3600 * 1000;
  store.setItem('coindozer-clean-save-v1', JSON.stringify(raw));
  const g2 = makeGame(CONFIG, LEVELS, makeEngine(CONFIG), store);
  assert.ok(g2.load());
  const s2 = g2.getState();
  assert.strictEqual(s2.coins, 123.5);
  assert.strictEqual(s2.gems, 7);
  assert.strictEqual(s2.levelIndex, 4);
  const off = g2.applyOffline();
  assert.ok(off.gain > 0);
  assert.ok(off.gain <= CONFIG.offlineCapSeconds * 10 * CONFIG.offlineEfficiency + 1);
});

test('charges refill over time up to capacity upgrade', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  s.charges = 0;
  s.upgrades.capacity = 2;
  for (let i = 0; i < 60 * 70; i++) game.tick(1 / 60, i / 60);
  assert.strictEqual(s.charges, CONFIG.spawn.maxCharges + 10);
  s.upgrades.refill = 10;
  assert.ok(game.refillInterval() >= 0.4);
});

test('renderer module loads and exposes draw/view', () => {
  const { makeRenderer } = require('../js/render.js');
  const r = makeRenderer(CONFIG, LEVELS);
  assert.strictEqual(typeof r.draw, 'function');
  assert.strictEqual(typeof r.view, 'function');
});

console.log(`\n${passed} tests passed`);
