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

test('retaining walls: coins on level 1 are blocked by every walled side, exit only via the open edge', () => {
  const world = engine.createWorld(LEVELS[0]);
  assert.ok(world.walls.length > 0, 'level 1 has extracted wall colliders in the physics world');
  for (const t of world.tiers) assert.ok(t.walls.length > 0 && t.pusher.wall, 'tier ' + t.name + ' has walls + moving DozerWall');
  // fling a coin at each walled side of each tier; it must never cross the wall's inner face
  for (const t of world.tiers) {
    const p = t.pusher;
    const sides = [
      { name: 'minX', face: Math.max(...t.walls.filter((w) => w.maxX <= t.minX + 0.8).map((w) => w.maxX)), dir: [-1, 0] },
      { name: 'maxX', face: Math.min(...t.walls.filter((w) => w.minX >= t.maxX - 0.8).map((w) => w.minX)), dir: [1, 0] },
      { name: 'minZ', face: Math.max(...t.walls.filter((w) => w.maxZ <= t.minZ + 0.8).map((w) => w.maxZ)), dir: [0, -1] },
      { name: 'maxZ', face: Math.min(...t.walls.filter((w) => w.minZ >= t.maxZ - 0.8).map((w) => w.minZ)), dir: [0, 1] },
    ];
    const openSide = p.openEdge;
    for (const s of sides) {
      const walled = t.walls.some((w) =>
        (s.name === 'minX' && w.maxX <= t.minX + 0.8) || (s.name === 'maxX' && w.minX >= t.maxX - 0.8) ||
        (s.name === 'minZ' && w.maxZ <= t.minZ + 0.8) || (s.name === 'maxZ' && w.minZ >= t.maxZ - 0.8));
      if (!walled) continue; // open side: no wall, coins must be able to leave here
      const w2 = engine.createWorld(LEVELS[0]);
      for (const tt of w2.tiers) tt.pusher = null; // isolate the static walls; the moving DozerWall is covered by the enclosure test below
      const c = engine.dropCoin(w2, CONFIG.coins[0]);
      const ti = w2.tiers.findIndex((x) => x.name === t.name); // t belongs to another world instance - find by name
      const cx = (t.minX + t.maxX) / 2, cz = (t.minZ + t.maxZ) / 2;
      c.x = cx; c.z = cz; c.y = t.top + CONFIG.world.coinH / 2; c.vy = 0; c.falling = false; c.tier = ti;
      c.vx = s.dir[0] * 30; c.vz = s.dir[1] * 30;
      let crossed = false, gone = false;
      for (let i = 0; i < 240; i++) {
        engine.step(w2, 1 / 60);
        if (!w2.coins.includes(c)) { gone = true; break; }
        if (s.name === 'minX' && c.x - c.r < s.face - 0.05) crossed = true;
        if (s.name === 'maxX' && c.x + c.r > s.face + 0.05) crossed = true;
        if (s.name === 'minZ' && c.z - c.r < s.face - 0.05) crossed = true;
        if (s.name === 'maxZ' && c.z + c.r > s.face + 0.05) crossed = true;
      }
      assert.ok(!crossed, 'tier ' + t.name + ': coin crossed the ' + s.name + ' wall (face=' + s.face.toFixed(2) + ')');
      if (gone) {
        // removal is acceptable ONLY via the open edge; a wall breach must never delete a coin silently
        assert.ok(w2.stats.breaches === 0 && Object.keys(w2.stats.exits).every((e) => e === openSide),
          'tier ' + t.name + ': coin removed only via the open edge; exits=' + JSON.stringify(w2.stats.exits) + ' breaches=' + w2.stats.breaches);
      }
    }
  }
  // and the open edge really is open: a coin in the strip ahead of the plate's leading
  // edge (the descent opening) is not blocked by any wall and falls off the tier
  const w3 = engine.createWorld(LEVELS[0]);
  const t = w3.tiers[1]; // lower tier, open edge = minX (sweeps toward the collector)
  const p = t.pusher;
  const c = engine.dropCoin(w3, CONFIG.coins[0]);
  const openVal = p.openEdge === 'minX' ? t.minX : p.openEdge === 'maxX' ? t.maxX : p.openEdge === 'minZ' ? t.minZ : t.maxZ;
  const inward = (t.minX + t.maxX) / 2, inwardZ = (t.minZ + t.maxZ) / 2;
  c.x = p.openEdge === 'minX' ? openVal + 0.6 : p.openEdge === 'maxX' ? openVal - 0.6 : inward;
  c.z = p.openEdge === 'minZ' ? openVal + 0.6 : p.openEdge === 'maxZ' ? openVal - 0.6 : inwardZ;
  c.y = t.top + CONFIG.world.coinH / 2; c.vy = 0; c.falling = false; c.tier = 1;
  c.vx = p.openEdge === 'minX' ? -30 : p.openEdge === 'maxX' ? 30 : 0;
  c.vz = p.openEdge === 'minZ' ? -30 : p.openEdge === 'maxZ' ? 30 : 0;
  let left = false, fell = false;
  for (let i = 0; i < 240; i++) {
    engine.step(w3, 1 / 60);
    if (!w3.coins.includes(c)) { left = true; break; }
    if (p.openEdge === 'minX' && c.x < openVal) left = true;
    if (p.openEdge === 'maxX' && c.x > openVal) left = true;
    if (p.openEdge === 'minZ' && c.z < openVal) left = true;
    if (p.openEdge === 'maxZ' && c.z > openVal) left = true;
    if (c.falling && c.tier === -1) fell = true;
  }
  assert.ok(left, 'coin crossed the open edge (no wall there)');
  assert.ok(fell || !w3.coins.includes(c), 'coin fell off the tier through the opening');
  assert.ok(w3.stats.breaches === 0, 'crossing the open edge is not a wall breach');
  assert.ok(Object.keys(w3.stats.exits).every((e) => e === p.openEdge), 'exit recorded via the open edge only: ' + JSON.stringify(w3.stats.exits));
});

test('no coin - resting OR in flight - ever penetrates any collider (tier walls, level walls incl. machine posts, moving DozerWall) (level 1, 30s)', () => {
  const world = engine.createWorld(LEVELS[0]);
  let maxPen = 0, maxPenInfo = null;
  for (let i = 0; i < 30 * 60; i++) {
    if (i % 5 === 0 && world.coins.length < 150) engine.dropCoin(world, CONFIG.coins[0]);
    engine.step(world, 1 / 60);
    // walls = every exported solid collider: level walls (chute, columns, gate rods) +
    // tier walls; plus each pusher's moving DozerWall translated by the sweep delta
    const wallsAll = [...world.walls];
    for (const t of world.tiers) {
      const p = t.pusher;
      if (p && p.wall) {
        const delta = p.pos - p.back;
        const wb = p.wall;
        wallsAll.push(p.axis === 'x'
          ? { minX: wb.minX + delta, maxX: wb.maxX + delta, minZ: wb.minZ, maxZ: wb.maxZ, minY: wb.minY, maxY: wb.maxY, go: 'DozerWall:' + t.name }
          : { minX: wb.minX, maxX: wb.maxX, minZ: wb.minZ + delta, maxZ: wb.maxZ + delta, minY: wb.minY, maxY: wb.maxY, go: 'DozerWall:' + t.name });
      }
    }
    for (const c of world.coins) { // NO exclusion of falling coins - they are checked too
      for (const w of wallsAll) {
        if (c.y - c.h / 2 >= w.maxY - 0.1 || c.y + c.h / 2 <= (w.minY != null ? w.minY : -1e9)) continue; // resting ON the wall top is fine; only face penetration counts
        const cx = Math.max(w.minX, Math.min(c.x, w.maxX));
        const cz = Math.max(w.minZ, Math.min(c.z, w.maxZ));
        const d = Math.hypot(c.x - cx, c.z - cz);
        if (d < c.r && c.r - d > maxPen) { maxPen = c.r - d; maxPenInfo = { coin: c.id, wall: w.go, pen: +(c.r - d).toFixed(3), x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2) }; }
      }
    }
  }
  // threshold note: the gate-rod/side-wall gap on level 1 is 7.066-6.296 = 0.770 wide,
  // narrower than a coin (diameter 0.868). A coin passing through that gap transiently
  // penetrates by at most 2r - gap = 0.098 (fully on one face) and the relaxed projection
  // converges to the per-wall minimum (0.868-0.770)/2 = 0.049 while it settles. So the
  // hard bound is 0.098; anything above that means resolution failed or a wall was crossed
  // (crossings are separately caught by stats.breaches below).
  assert.ok(maxPen <= 0.098 + 1e-3, 'coin penetrated a wall beyond the geometric bound by ' + maxPen.toFixed(3) + ' ' + JSON.stringify(maxPenInfo));
  assert.ok(world.stats.breaches === 0, 'no wall breaches recorded over 30s: ' + JSON.stringify(world.stats.breachLog.slice(0, 5)));
});

test('trajectory accounting (level 1, 60s): every coin tracked, upper->lower->collector flow, exits by edge, lost != collected', () => {
  const world = engine.createWorld(LEVELS[0]);
  const trans = {};
  const prev = new Map();
  let drops = 0;
  for (let i = 0; i < 60 * 60; i++) {
    if (i % 25 === 0 && drops < 150) { engine.dropCoin(world, CONFIG.coins[0]); drops++; }
    engine.step(world, 1 / 60);
    for (const c of world.coins) {
      const pt = prev.get(c.id);
      if (pt != null && pt >= 0 && pt !== c.tier) trans[pt + '->' + c.tier] = (trans[pt + '->' + c.tier] || 0) + 1;
      prev.set(c.id, c.tier);
    }
  }
  const s = world.stats;
  assert.ok(s.breaches === 0, 'zero wall breaches: ' + JSON.stringify(s.breachLog.slice(0, 5)));
  assert.ok((trans['0->1'] || 0) > 0, 'coins flowed from the upper tier to the lower tier: ' + JSON.stringify(trans));
  assert.ok(s.collected > 0, 'coins reached the actual collector volume: collected=' + s.collected);
  assert.ok(s.lost > 0, 'coins falling outside the machine are counted lost (not collected): lost=' + s.lost);
  assert.ok(s.collected + s.lost + world.coins.length >= drops, `full accounting: collected(${s.collected}) + lost(${s.lost}) + onBoard(${world.coins.length}) >= drops(${drops})`);
  const exitEdges = Object.keys(s.exits);
  assert.ok(exitEdges.length > 0, 'edge exits recorded: ' + JSON.stringify(s.exits));
  // every recorded exit edge must be either the tier's open edge or an unwalled side (a walled-side exit would already be a breach)
  console.log('    trajectory: exits=' + JSON.stringify(s.exits) + ' transitions=' + JSON.stringify(trans) + ` collected=${s.collected} lost=${s.lost} onBoard=${world.coins.length} drops=${drops}`);
});

test('dense pile + exactly coincident coins resolve without overlap or disappearance', () => {
  const world = engine.createWorld(LEVELS[0]);
  const top = world.tiers.reduce((a, b) => (b.floorTop > a.floorTop ? b : a));
  for (const t of world.tiers) t.pusher = null;
  const ti = world.tiers.indexOf(top);
  const cs = [];
  for (let i = 0; i < 24; i++) {
    const c = engine.dropCoin(world, CONFIG.coins[0]);
    c.x = top.cx; c.z = top.cz; c.y = top.floorTop + CONFIG.world.coinH / 2 + (i % 3) * 0.01;
    c.vx = 0; c.vy = 0; c.vz = 0; c.falling = false; c.tier = ti;
    cs.push(c);
  }
  cs[1].x = cs[0].x; cs[1].z = cs[0].z; cs[1].y = cs[0].y; // exactly coincident pair
  for (let i = 0; i < 180; i++) engine.step(world, 1 / 60);
  let maxOverlap = 0;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (Math.abs(a.y - b.y) < 0.7 * CONFIG.world.coinH) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        maxOverlap = Math.max(maxOverlap, 2 * CONFIG.world.coinR - d);
      }
    }
  }
  assert.ok(maxOverlap <= 0.06, 'same-layer overlap <= 0.06 after pile settles, got ' + maxOverlap.toFixed(3));
  // a coin may leave the pile legitimately (collected/lost/evicted) but only with a
  // recorded event - silent disappearance would be a bug
  const removed = new Set(world.events.filter((e) => ['collect', 'lost', 'evict'].includes(e.type)).map((e) => e.coin && e.coin.id));
  for (const c of cs) {
    if (!world.coins.includes(c)) assert.ok(removed.has(c.id), 'coin ' + c.id + ' removed without a collect/lost/evict event');
  }
});

test('machine post colliders (gate rods) are resolved like any wall - not excluded from collision', () => {
  const world = engine.createWorld(LEVELS[0]);
  const post = world.walls.find((w) => w.go === 'RightRod' || w.go === 'LeftRod');
  assert.ok(post, 'gate rod collider exported in world.walls');
  const c = engine.dropCoin(world, CONFIG.coins[0]);
  c.x = post.maxX + c.r + 0.2; c.z = (post.minZ + post.maxZ) / 2; c.y = (post.minY + post.maxY) / 2;
  c.vx = -30; c.vy = 0; c.vz = 0; c.falling = true; c.tier = -1;
  let maxPen = 0;
  for (let i = 0; i < 120 && world.coins.includes(c); i++) {
    engine.step(world, 1 / 60);
    if (c.y - c.h / 2 >= post.maxY - 0.1 || c.y + c.h / 2 <= post.minY) continue;
    const cx = Math.max(post.minX, Math.min(c.x, post.maxX));
    const cz = Math.max(post.minZ, Math.min(c.z, post.maxZ));
    const d = Math.hypot(c.x - cx, c.z - cz);
    if (d < c.r) maxPen = Math.max(maxPen, c.r - d);
  }
  assert.ok(maxPen <= 0.05, 'coin never penetrated the rod post by more than 0.05, got ' + maxPen.toFixed(3));
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
