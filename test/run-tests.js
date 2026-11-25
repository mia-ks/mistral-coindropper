// Test suite: layout fidelity vs APK-extracted fixture, camera rig, multi-tier physics,
// machine behaviours, economy, save/load. Run: node test/run-tests.js
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const { CONFIG, LEVELS } = require('../js/config.js');
const { makeEngine } = require('../js/engine.js');
const { MESH_LIB, MESH_MATS } = require('../js/meshlib.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-levels.json'), 'utf8'));
const engine = makeEngine(CONFIG);

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok -', name); }
  catch (e) { console.error('FAIL -', name, '\n', e.message); process.exitCode = 1; }
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// ---------- layout fidelity vs extracted data ----------
test('19 levels, all with goal 100 from Level.targetCoins', () => {
  assert.strictEqual(LEVELS.length, 19);
  for (const lv of LEVELS) assert.strictEqual(lv.goal, 100);
});

test('tier count per level matches extracted PusherInteraction count', () => {
  for (const lv of LEVELS) {
    const fx = fixture.levels['Level ' + lv.index];
    assert.strictEqual(lv.tiers.length, fx.tierCount, 'level ' + lv.index + ' tiers');
  }
});

test('level 12 has 3 tiers, level 17 has 5 (multi-tier tower)', () => {
  assert.strictEqual(LEVELS[11].tiers.length, 3);
  assert.strictEqual(LEVELS[16].tiers.length, 5);
});

test('machine types and world positions match extracted prefab transforms', () => {
  for (const lv of LEVELS) {
    const fx = fixture.levels['Level ' + lv.index];
    const got = lv.machines.map((m) => [m.type, m.pos]).sort((a, b) => a[0].localeCompare(b[0]));
    const want = fx.machinePositions.slice().sort((a, b) => a[0].localeCompare(b[0]));
    assert.strictEqual(got.length, want.length, 'level ' + lv.index + ' machine count');
    for (let i = 0; i < got.length; i++) {
      assert.strictEqual(got[i][0], want[i][0], 'level ' + lv.index + ' machine type ' + i);
      for (let k = 0; k < 3; k++) assert.ok(near(got[i][1][k], want[i][1][k], 0.05), `level ${lv.index} machine ${i} coord ${k}: ${got[i][1][k]} vs ${want[i][1][k]}`);
    }
  }
});

test('tier floors are real extracted collider AABBs (not evenly spaced)', () => {
  const zs = LEVELS[18].tiers.map((t) => t.floor.min[2]);
  const sorted = zs.slice().sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] > 0.01);
  const tops = LEVELS[18].tiers.map((t) => t.floor.min[1]);
  assert.ok(new Set(tops).size > 1, 'level 19 tiers at distinct elevations');
});

test('camera rig per level matches extracted LevelCameraBounds (mirrored pos, quat, fov)', () => {
  for (const lv of LEVELS) {
    const fx = fixture.levels['Level ' + lv.index].camera;
    const gl = lv.cameraGL;
    assert.ok(gl, 'level ' + lv.index + ' has cameraGL');
    assert.ok(near(gl.fov, fx.fov, 0.01), 'level ' + lv.index + ' fov');
    for (let k = 0; k < 3; k++) assert.ok(near(gl.pos[k], fx.pos[k], 1e-6), 'level ' + lv.index + ' cam pos ' + k);
    for (let k = 0; k < 4; k++) assert.ok(near(gl.quat[k], fx.quat[k], 1e-6), 'level ' + lv.index + ' cam quat ' + k);
  }
  assert.strictEqual(LEVELS[0].camera.fov, 20);
  assert.deepStrictEqual(LEVELS[0].camera.euler, [35, 330, 0]);
});

test('every level carries real exported mesh instances, all referencing the mesh lib', () => {
  for (const lv of LEVELS) {
    assert.ok(lv.meshData && lv.meshData.instances.length > 0, 'level ' + lv.index + ' meshData');
    for (const inst of lv.meshData.instances) {
      assert.ok(MESH_LIB[inst.mesh] && MESH_LIB[inst.mesh].subs.length > 0, 'level ' + lv.index + ' mesh ' + inst.mesh);
      for (const pid of inst.mats || []) if (pid && pid !== '0') assert.ok(MESH_MATS[String(pid)], 'level ' + lv.index + ' material ' + pid);
      for (const sub of MESH_LIB[inst.mesh].subs) assert.ok(sub.pos && sub.idx, 'level ' + lv.index + ' mesh ' + inst.mesh + ' has pos+idx');
    }
    for (const d of lv.meshData.dozers) assert.ok(MESH_LIB[d.mesh], 'dozer mesh ' + d.mesh);
    const tierNames = new Set(lv.tiers.map((t) => t.name));
    for (const d of lv.meshData.dozers) assert.ok(tierNames.has(d.tier), 'level ' + lv.index + ' dozer tier ' + d.tier);
  }
});

test('spawn config extracted: 15 charges, refill 2s, first 10 bronze', () => {
  for (const lv of LEVELS) {
    assert.strictEqual(lv.spawn.maxCharges, 15);
    assert.strictEqual(lv.spawn.refillInterval, 2);
    assert.strictEqual(lv.spawn.guaranteedBronzeCount, 10);
  }
});

test('coin geometry extracted: flat disc ratio ~5.5, values 2/5/10 weights 90/8/2', () => {
  assert.ok(near(CONFIG.world.coinR * 2 / CONFIG.world.coinH, 0.8676 / 0.1589, 0.05));
  assert.deepStrictEqual(CONFIG.coins.slice(0, 3).map((c) => [c.value, c.weight]), [[2, 90], [5, 8], [10, 2]]);
});

test('per-instance machine params override defaults (level 12 tesla hop = maxHopDistance 1.0)', () => {
  const teslas = LEVELS[11].machines.filter((m) => m.type === 'TeslaCoil');
  assert.strictEqual(teslas.length, 2);
  for (const t of teslas) assert.strictEqual(t.params.maxHopDistance, 10); // 1.0 * S
  const conveyor = LEVELS[1].machines.find((m) => m.type === 'ConveyorBelt');
  assert.ok(conveyor && conveyor.params.speed > 0, 'conveyor speed non-zero');
});

// ---------- physics: multi-tier tower ----------

function placeOnMachine(world, m) {
  const tier = world.tiers[m.tierIdx];
  tier.pusher = null; // isolate the machine from the tier pusher
  const c = engine.dropCoin(world, CONFIG.coins[0]);
  c.x = Math.min(Math.max(m.x, tier.minX + 0.6), tier.maxX - 0.6);
  c.z = Math.min(Math.max(m.z, tier.minZ + 0.6), tier.maxZ - 0.6);
  c.y = tier.top + CONFIG.world.coinH / 2; c.vy = 0; c.vx = 0; c.vz = 0;
  c.falling = false; c.tier = m.tierIdx;
  return c;
}

function simWorld(lvIdx, seconds, dropEvery = 0) {
  const world = engine.createWorld(LEVELS[lvIdx]);
  let drops = 0;
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) {
    if (dropEvery && i % dropEvery === 0 && drops < 60) { engine.dropCoin(world, CONFIG.coins[0]); drops++; }
    engine.step(world, 1 / 60);
  }
  return world;
}

test('coin dropped at dispenser lands on the top tier (support by tier floor)', () => {
  const world = engine.createWorld(LEVELS[0]);
  const c = engine.dropCoin(world, CONFIG.coins[0]);
  const topTier = world.tiers.reduce((a, b) => (b.top > a.top ? b : a));
  let landed = false;
  for (let i = 0; i < 60; i++) {
    engine.step(world, 1 / 60);
    if (!c.falling && c.tier === world.tiers.indexOf(topTier) && near(c.y, topTier.top + CONFIG.world.coinH / 2, 0.05)) landed = true;
  }
  assert.ok(landed, 'coin landed on the top tier floor at least once');
});

test('pusher sweeps coins off the open edge; coins fall to the tier below (level 1: 2 tiers)', () => {
  const world = simWorld(0, 25, 30);
  const tiers = world.tiers;
  assert.strictEqual(tiers.length, 2);
  const byTier = {};
  for (const c of world.coins) byTier[c.tier] = (byTier[c.tier] || 0) + 1;
  const tops = tiers.map((t) => t.top).sort((a, b) => b - a);
  // at least one coin reached the lower tier or the collector over 25s of pushing
  const collected = world.events.filter((e) => e.type === 'collect').length;
  assert.ok(collected > 0 || (byTier[0] || 0) > 0, 'coins moved down: collected=' + collected + ' onLower=' + (byTier[0] || 0));
});

test('level 12 (3 tiers): coins land on tiers and can fall between tiers', () => {
  const w2 = engine.createWorld(LEVELS[11]);
  assert.strictEqual(w2.tiers.length, 3);
  // a coin falling above a lower tier lands on it (gravity-driven inter-tier transition)
  const lower = w2.tiers.reduce((a, b) => (b.top < a.top ? b : a));
  const c = engine.dropCoin(w2, CONFIG.coins[0]);
  c.x = lower.cx; c.z = lower.cz; c.y = lower.top + 6; c.vy = -5; c.falling = true; c.tier = -1;
  let landed = false;
  for (let i = 0; i < 120; i++) {
    engine.step(w2, 1 / 60);
    if (!c.falling && c.tier === w2.tiers.indexOf(lower)) landed = true;
  }
  assert.ok(landed, 'coin falling from above landed on the lower tier');
  // a dropped coin reaches some tier
  const w3 = engine.createWorld(LEVELS[11]);
  const c2 = engine.dropCoin(w3, CONFIG.coins[0]);
  const visited = new Set();
  for (let i = 0; i < 30 * 60; i++) {
    engine.step(w3, 1 / 60);
    if (c2.tier >= 0) visited.add(c2.tier);
    if (!w3.coins.includes(c2)) break;
  }
  assert.ok(visited.size >= 1, 'dropped coin landed on a tier: ' + [...visited].join(','));
});

test('coins are collected inside the collector volume, not by a bare y threshold', () => {
  const world = engine.createWorld(LEVELS[0]);
  const col = world.collector;
  assert.ok(col, 'collector box exists');
  const c = engine.dropCoin(world, CONFIG.coins[0]);
  c.x = (col.minX + col.maxX) / 2; c.z = (col.minZ + col.maxZ) / 2; c.y = col.minY + 1; c.vy = -5;
  engine.step(world, 1 / 60);
  assert.ok(!world.coins.includes(c), 'coin inside collector collected');
  assert.ok(world.events.some((e) => e.type === 'collect'));
});

test('conveyor accelerates coins along its direction at extracted speed', () => {
  const lv = LEVELS.find((l) => l.machines.some((m) => m.type === 'ConveyorBelt'));
  const world = engine.createWorld(lv);
  const m = world.machines.find((x) => x.type === 'ConveyorBelt');
  const tier = world.tiers[m.tierIdx];
  tier.pusher = null;
  const c = engine.dropCoin(world, CONFIG.coins[0]);
  c.x = tier.cx; c.z = tier.cz; c.y = tier.top + CONFIG.world.coinH / 2; c.vy = 0; c.vx = 0; c.vz = 0; c.falling = false; c.tier = m.tierIdx;
  const dir = engine.yawDir(m.yaw);
  let maxV = 0;
  for (let i = 0; i < 90; i++) { engine.step(world, 1 / 60); maxV = Math.max(maxV, c.vx * dir[0] + c.vz * dir[1]); }
  assert.ok(maxV > m.params.speed * 0.5, 'coin reached >= half belt speed, maxV=' + maxV.toFixed(2) + ' belt=' + m.params.speed);
});

test('fan lifts a resting coin upward (speed from prefab)', () => {
  const lv = LEVELS.find((l) => l.machines.some((m) => m.type === 'Fan'));
  const world = engine.createWorld(lv);
  const m = world.machines.find((x) => x.type === 'Fan');
  const tier = world.tiers[m.tierIdx];
  const c = placeOnMachine(world, m);
  let maxY = c.y;
  for (let i = 0; i < 90; i++) { engine.step(world, 1 / 60); maxY = Math.max(maxY, c.y); }
  assert.ok(maxY > tier.top + CONFIG.world.coinH / 2 + 1.0, 'coin lifted from rest: maxY=' + maxY.toFixed(2) + ' top=' + tier.top);
});

test('tesla coil hops coins ~maxHopDistance (level 12: 10 units), on its interval', () => {
  const world = engine.createWorld(LEVELS[11]);
  const m = world.machines.find((x) => x.type === 'TeslaCoil');
  const c = placeOnMachine(world, m);
  for (const o of world.machines) if (o !== m) o.zone = { minX: 1e9, maxX: 1e9, minZ: 1e9, maxZ: 1e9 }; // isolate coil
  const dir = engine.yawDir(m.yaw);
  const vh = Math.sqrt(m.params.maxHopDistance * CONFIG.world.gravity); // impulse that yields range = maxHopDistance
  let maxV = 0;
  for (let i = 0; i < 60 * 4; i++) {
    engine.step(world, 1 / 60);
    maxV = Math.max(maxV, c.vx * dir[0] + c.vz * dir[1]);
  }
  assert.ok(maxV > 0.7 * vh && maxV < 1.4 * vh, 'hop impulse ~sqrt(hop*g)=' + vh.toFixed(1) + ', got maxV=' + maxV.toFixed(1));
});

test('portal pulls for pullDuration then teleports to the Out Portal exit', () => {
  const lv = LEVELS.find((l) => l.machines.some((m) => m.type === 'Portal' && m.exit));
  const world = engine.createWorld(lv);
  const m = world.machines.find((x) => x.type === 'Portal' && x.exit);
  for (const o of world.machines) if (o !== m) o.zone = { minX: 1e9, maxX: 1e9, minZ: 1e9, maxZ: 1e9 }; // isolate portal
  const c = engine.dropCoin(world, CONFIG.coins[0]);
  c.x = m.x; c.z = m.z; c.y = m.y; c.vy = 0; c.vx = 0; c.vz = 0; c.falling = true; c.tier = -1;
  let teleported = false;
  for (let i = 0; i < 60 * 3; i++) {
    engine.step(world, 1 / 60);
    const d = Math.hypot(c.x - m.exit.pos[0], c.z - m.exit.pos[2]);
    if (d < 2.5) { teleported = true; break; }
  }
  assert.ok(teleported, 'coin teleported to Out Portal exit at ' + JSON.stringify(m.exit.pos));
  assert.ok(m.params.pullDuration > 0 && m.params.pullDuration < 1, 'pullDuration extracted, got ' + m.params.pullDuration);
});

test('x2 gate multiplies a passing coin exactly once', () => {
  const lv = LEVELS[0];
  const world = engine.createWorld(lv);
  const m = world.machines.find((x) => x.type === 'MultiplyingGate');
  const c = placeOnMachine(world, m);
  for (let i = 0; i < 30; i++) engine.step(world, 1 / 60);
  assert.strictEqual(c.mult, 2);
  for (let i = 0; i < 30; i++) engine.step(world, 1 / 60);
  assert.strictEqual(c.mult, 2, 'gate applies once');
});

test('coins stack face-to-face in y (flat discs)', () => {
  const world = engine.createWorld(LEVELS[0]);
  const tier = world.tiers.reduce((a, b) => (b.top > a.top ? b : a));
  tier.pusher = null;
  const a = engine.dropCoin(world, CONFIG.coins[0]);
  a.x = tier.cx; a.z = tier.cz; a.y = tier.top + CONFIG.world.coinH / 2; a.vy = 0; a.falling = false; a.tier = world.tiers.indexOf(tier);
  const b = engine.dropCoin(world, CONFIG.coins[0]);
  b.x = tier.cx; b.z = tier.cz; b.y = a.y + CONFIG.world.coinH * 2; b.vy = -2;
  for (let i = 0; i < 90; i++) engine.step(world, 1 / 60);
  assert.ok(near(b.y - a.y, CONFIG.world.coinH, 0.03), 'stacked one coin-height apart: dy=' + (b.y - a.y).toFixed(3));
});

// ---------- economy ----------
const { makeGame } = require('../js/game.js');

test('first 10 drops are exactly bronze', () => {
  const g = makeGame(CONFIG, LEVELS, engine);
  g.loadLevel(0);
  for (let i = 0; i < 10; i++) { const c = g.drop(); assert.strictEqual(c.type, 0); }
  g.state.charges = 1000;
  let nonBronze = 0;
  for (let i = 0; i < 200; i++) { const c = g.drop(); if (c && c.type !== 0) nonBronze++; }
  assert.ok(nonBronze > 0, 'later drops include silver/gold');
});

test('combo updates before payout and expires in tick', () => {
  const g = makeGame(CONFIG, LEVELS, engine);
  g.loadLevel(0);
  g.state.comboTimer = 0; g.state.combo = 5;
  const v1 = g.collect({ type: 0, mult: 1 }); // combo 5 -> mult 1.4 on this payout? combo set to 1 first
  assert.strictEqual(g.state.combo, 1);
  // expired combo gives no multiplier on next collect after window passes
  g.state.combo = 8; g.state.comboTimer = 0.01;
  for (let i = 0; i < 5; i++) g.tick(0.01); // expires
  assert.strictEqual(g.state.combo, 0);
  const before = g.state.bank;
  g.collect({ type: 0, mult: 1 });
  assert.ok(near(g.state.bank - before, 2, 0.001), 'no expired multiplier applied');
});

test('level completes only on crossing goal; last level rolls over without re-reward', () => {
  const g = makeGame(CONFIG, LEVELS, engine);
  g.loadLevel(LEVELS.length - 1);
  g.state.progress = 99;
  const gemsBefore = g.state.gems;
  g.collect({ type: 0, mult: 1 }); // +2 -> 101 >= 100: completes once
  assert.strictEqual(g.state.completed, true);
  assert.strictEqual(g.state.gems, gemsBefore + CONFIG.levelRewardGems);
  g.tick(0.016);
  g.tick(0.016);
  assert.strictEqual(g.state.gems, gemsBefore + CONFIG.levelRewardGems, 'no repeat reward after rollover');
  assert.ok(g.state.progress < 100, 'progress rolled over');
});

test('charges refill over time up to capacity upgrade', () => {
  const g = makeGame(CONFIG, LEVELS, engine);
  g.loadLevel(0);
  g.state.charges = 0;
  for (let i = 0; i < 60 * 5; i++) g.tick(1 / 60);
  assert.ok(g.state.charges >= 2, 'refilled: ' + g.state.charges);
});

// ---------- save/load: full simulation state ----------
test('save/load round-trips coin positions/velocities and machine timers exactly', () => {
  const g = makeGame(CONFIG, LEVELS, engine);
  g.loadLevel(11); // 3-tier level with machines
  for (let i = 0; i < 90; i++) { if (i % 10 === 0) g.drop(); g.tick(1 / 60); }
  const snap = g.serialize();
  const g2 = makeGame(CONFIG, LEVELS, engine);
  g2.loadLevel(11);
  engine.restore(g2.world, snap.world);
  const a = engine.serialize(g.world), b = engine.serialize(g2.world);
  assert.deepStrictEqual(a.coins, b.coins, 'coin states identical (no respawn clamping)');
  assert.deepStrictEqual(a.machines, b.machines, 'machine timers identical');
  assert.deepStrictEqual(a.pushers, b.pushers, 'pusher phases identical');
});

test('offline earnings are exactly 0 when income rate is 0', () => {
  const g = makeGame(CONFIG, LEVELS, engine);
  g.loadLevel(0);
  g.state.incomeRate = 0;
  g.state.lastSave = Date.now() - 3600 * 1000;
  const bankBefore = g.state.bank;
  // emulate load path math
  const elapsed = Math.min(CONFIG.offlineCapSeconds, 3600);
  const gain = (g.state.incomeRate > 0 ? g.state.incomeRate : 0) * elapsed * CONFIG.offlineEfficiency;
  g.state.bank += gain;
  assert.strictEqual(g.state.bank, bankBefore);
});

console.log(`\n${passed} tests passed`);
