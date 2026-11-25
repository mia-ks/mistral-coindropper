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

test('config: 19 levels from extracted 3D layouts, machines in bounds', () => {
  assert.strictEqual(LEVELS.length, 19);
  for (const lv of LEVELS) {
    assert.strictEqual(lv.goal, 100);
    assert.strictEqual(lv.spawn.maxCharges, 15);
    assert.ok(lv.machines.length >= 1);
    for (const m of lv.machines) {
      assert.ok(CONFIG.machineTypes[m.type], 'unknown machine ' + m.type);
      assert.ok(Math.abs(m.x) <= CONFIG.world.halfX, 'x out of bounds: ' + m.x);
      assert.ok(m.z > CONFIG.world.backZ && m.z < CONFIG.world.edgeZ, 'z off track: ' + m.z);
    }
  }
  assert.ok(LEVELS[18].machines.length >= 10, 'level 19 should be busy');
});

test('config: coin table matches extracted values/weights', () => {
  const byId = Object.fromEntries(CONFIG.coins.map((c) => [c.id, c]));
  assert.deepStrictEqual([byId[0].value, byId[1].value, byId[2].value, byId[3].gem], [2, 5, 10, true]);
  assert.deepStrictEqual([byId[0].weight, byId[1].weight, byId[2].weight], [90, 8, 2]);
});

test('economy: first 10 drops are guaranteed bronze, then weighted', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  s.charges = 100;
  const types = [];
  for (let i = 0; i < 40; i++) {
    const c = game.dropAt((i % 8) - 4, 5 + (i % 5), false);
    types.push(c.type);
  }
  assert.ok(types.slice(0, 10).every((t) => t === 0));
  assert.ok(types.slice(10).every((t) => t >= 0 && t <= 2));
  assert.strictEqual(s.totalDrops, 40);
  assert.strictEqual(s.charges, 60);
});

test('economy: upgrade purchase deducts coins, scales cost, respects max', () => {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, memStorage());
  const s = game.getState();
  s.coins = 1000;
  assert.strictEqual(game.upgradeCost('coinValue'), 50);
  assert.ok(game.buyUpgrade('coinValue'));
  assert.strictEqual(s.coins, 950);
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

test('physics 3D: coins fall, stack, get pushed off the front edge and collected', () => {
  const engine = makeEngine(CONFIG);
  const world = engine.createWorld(LEVELS[1]);
  let collects = 0;
  let drops = 0;
  for (let step = 0; step < 90 * 60; step++) {
    if (step % 45 === 0 && drops < 40) {
      engine.dropCoin(world, ((drops % 9) - 4) * 0.9, 3.2, CONFIG.coins[0]);
      drops++;
    }
    const events = engine.step(world, 1 / 60, { pusherSpeed: 2 });
    collects += events.filter((e) => e.type === 'collect').length;
    for (const c of world.coins) {
      assert.ok(isFinite(c.x) && isFinite(c.y) && isFinite(c.z), 'NaN coin position');
      assert.ok(Math.abs(c.vx) <= 31 && Math.abs(c.vy) <= 31 && Math.abs(c.vz) <= 31, 'velocity explosion');
    }
    assert.ok(world.coins.length <= CONFIG.world.maxCoins);
  }
  assert.ok(collects > 0, 'expected coins collected over 90s, got ' + collects);
});

test('physics 3D: flat coins stack in layers instead of interpenetrating', () => {
  const engine = makeEngine(CONFIG);
  const world = engine.createWorld(LEVELS[0]);
  for (let i = 0; i < 6; i++) engine.dropCoin(world, 0, 11, CONFIG.coins[0]);
  for (let i = 0; i < 60 * 8; i++) engine.step(world, 1 / 60, { pusherSpeed: 0 });
  const cs = world.coins;
  assert.ok(cs.length >= 4, 'coins should remain on board: ' + cs.length);
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      const dXZ = Math.hypot(b.x - a.x, b.z - a.z);
      if (dXZ < 2 * CONFIG.world.coinR - 0.02) {
        assert.ok(Math.abs(b.y - a.y) >= 2 * CONFIG.world.coinH - 0.02,
          `coins overlap: dXZ=${dXZ.toFixed(3)} dy=${Math.abs(b.y - a.y).toFixed(3)}`);
      }
    }
  }
  const maxY = Math.max(...cs.map((c) => c.y));
  assert.ok(maxY > CONFIG.world.coinH + 0.05, 'some coin should be stacked on top, maxY=' + maxY);
});

test('physics 3D: spikes destroy, fan lifts, shake imparts velocity', () => {
  const engine = makeEngine(CONFIG);
  const lv = { goal: 100, spawn: CONFIG.spawn, machines: [{ type: 'spike', label: 'Spikes', x: 0, z: 10, w: 2.5 }] };
  const world = engine.createWorld(lv);
  const c = engine.dropCoin(world, 0, 10, CONFIG.coins[0]);
  let destroyed = false;
  for (let i = 0; i < 180 && !destroyed; i++) {
    const ev = engine.step(world, 1 / 60, { pusherSpeed: 0 });
    destroyed = ev.some((e) => e.type === 'destroy' && e.coin === c);
  }
  assert.ok(destroyed, 'spike should destroy the coin');

  const lv2 = { goal: 100, spawn: CONFIG.spawn, machines: [{ type: 'fan', label: 'Fan', x: 0, z: 10, speed: 50, y: 2.6, r: 3 }] };
  const w2 = engine.createWorld(lv2);
  const c2 = engine.dropCoin(w2, 0, 10, CONFIG.coins[0]);
  let maxY = 0;
  for (let i = 0; i < 240 && !c2.dead; i++) {
    engine.step(w2, 1 / 60, { pusherSpeed: 0 });
    maxY = Math.max(maxY, c2.y);
  }
  assert.ok(maxY > 3, 'fan should lift the coin, maxY=' + maxY);

  const w3 = engine.createWorld(LEVELS[0]);
  const c3 = engine.dropCoin(w3, 0, 8, CONFIG.coins[0]);
  engine.step(w3, 1 / 60, { pusherSpeed: 0 });
  const before = c3.vx + c3.vy + c3.vz;
  engine.shake(w3, 14);
  assert.ok(c3.vx + c3.vy + c3.vz !== before, 'shake should move coins');
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

test('renderer module exposes buildScene/create/coinMesh', () => {
  const { makeRenderer } = require('../js/render.js');
  const r = makeRenderer(CONFIG, LEVELS);
  assert.strictEqual(typeof r.buildScene, 'function');
  assert.strictEqual(typeof r.create, 'function');
  assert.strictEqual(typeof r.coinMesh, 'function');
});

console.log(`\n${passed} tests passed`);
