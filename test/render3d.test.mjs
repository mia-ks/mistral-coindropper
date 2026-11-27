import assert from 'node:assert';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('../js/vendor/three.module.js')).href);
const { CONFIG, LEVELS } = require('../js/config.js');
const { makeEngine } = require('../js/engine.js');
const { makeRenderer } = require('../js/render.js');
const { makeRasterizer } = require('./raster.js');
const { MESH_LIB } = require('../js/meshlib.js');

// numerical geometry check: the rendered world-space bbox of every exported instance
// (mesh verts through its matrix) must match the independently extracted Unity AABB
// (unit x10 + x-mirror applied). Catches scale/handedness regressions exactly.
for (const lv of LEVELS) {
  const m4 = new THREE.Matrix4();
  const v = new THREE.Vector3();
  for (const inst of [...lv.meshData.instances, ...lv.meshData.dozers]) {
    const entry = MESH_LIB[inst.mesh];
    assert.ok(entry, 'level ' + lv.index + ' mesh ' + inst.mesh);
    m4.fromArray(inst.mat);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const sub of entry.subs) {
      for (const p of sub.pos) {
        v.set(p[0] / 1000, p[1] / 1000, p[2] / 1000).applyMatrix4(m4);
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v.toArray()[k]); mx[k] = Math.max(mx[k], v.toArray()[k]); }
      }
    }
    assert.ok(inst.aabb, 'level ' + lv.index + ' inst ' + inst.name + ' has aabb');
    // tolerance covers vertex quantization (int/1000) amplified by large instance scales;
    // a missing x10 (or wrong handedness) is off by ~100% of the box size and fails hard
    const maxAbs = Math.max(...inst.mat.slice(0, 12).map(Math.abs));
    for (let k = 0; k < 3; k++) {
      const size = inst.aabb.max[k] - inst.aabb.min[k];
      const tol = 0.05 + 0.02 * size + 0.001 * maxAbs;
      assert.ok(Math.abs(mn[k] - inst.aabb.min[k]) < tol, 'level ' + lv.index + ' ' + inst.name + ' min[' + k + '] ' + mn[k].toFixed(3) + ' vs aabb ' + inst.aabb.min[k]);
      assert.ok(Math.abs(mx[k] - inst.aabb.max[k]) < tol, 'level ' + lv.index + ' ' + inst.name + ' max[' + k + '] ' + mx[k].toFixed(3) + ' vs aabb ' + inst.aabb.max[k]);
    }
  }
}
console.log('ok - rendered world bboxes of all mesh instances match extracted Unity AABBs (x10 + mirror) for all 19 levels');

const engine = makeEngine(CONFIG);
const renderer = makeRenderer(CONFIG, LEVELS, THREE);
const raster = makeRasterizer(THREE);

// extraction regression guards: the tier floor must be a STATIONARY collider (the moving
// pusher assembly must never be picked as the floor), and the sweep axis must be resolved
// from the controller node's local +Z, not from coincident-rectangle centers
for (const lv of LEVELS) {
  for (const t of lv.tiers) {
    const p = t.pusher, f = t.floor;
    assert.ok(f, 'level ' + lv.index + ' tier ' + t.name + ' has a floor');
    assert.ok(p && p.box && p.origin, 'level ' + lv.index + ' tier ' + t.name + ' pusher exports box+origin');
    const same = Math.abs(f.min[0] - p.box.min[0]) < 1e-6 && Math.abs(f.max[0] - p.box.max[0]) < 1e-6 &&
                 Math.abs(f.min[2] - p.box.min[2]) < 1e-6 && Math.abs(f.max[2] - p.box.max[2]) < 1e-6;
    assert.ok(!same, 'level ' + lv.index + ' tier ' + t.name + ': floor must not be the pusher collider');
    assert.ok(p.axis === 'x' || p.axis === 'z', 'level ' + lv.index + ' tier ' + t.name + ' axis from controller local +Z');
    assert.ok(p.travel > 0.5 && p.travel < 5, 'level ' + lv.index + ' tier ' + t.name + ' travel from geometry, got ' + p.travel);
    // the plate's leading edge at full travel must land flush with the floor's open edge
    const a = p.axis === 'x' ? 0 : 2;
    const lead0 = p.sign > 0 ? p.box.max[a] : p.box.min[a];
    const openEdge = p.sign > 0 ? f.max[a] : f.min[a];
    const leadEnd = lead0 + p.sign * p.travel;
    assert.ok(Math.abs(leadEnd - openEdge) < 0.05, 'level ' + lv.index + ' tier ' + t.name + ' plate ends flush with open edge: ' + leadEnd.toFixed(3) + ' vs ' + openEdge.toFixed(3));
  }
}
{
  const l1 = LEVELS[0];
  assert.strictEqual(l1.tiers.find((t) => t.name === 'Pusher (1)').pusher.axis, 'z', 'level 1 upper tier sweeps along z (tier yaw 0)');
  assert.strictEqual(l1.tiers.find((t) => t.name === 'Pusher').pusher.axis, 'x', 'level 1 lower tier sweeps along x (tier yaw -90)');
}
console.log('ok - floors are stationary base colliders (not the pusher), controller-resolved sweep axes, flush travel, all 19 levels');

// perimeter wall guards, measured on the ACTUAL platform edge with elevation:
// - the edge of the walkable platform at each side is the floor's edge segment at plate
//   elevation; a wall covers an edge sub-interval only if its footprint sits on that edge
//   AND it rises at least a coin-height above the plate top (so a resting coin is blocked)
//   AND its base is not floating above the plate
// - lateral sides must be covered CONTINUOUSLY (no uncovered gap > 0.05), the sweep side
//   must have no covering wall (coin descent opening), the back is closed by the moving
//   DozerWall (asserted at rest) with no static wall there
// - every wall collider must correspond to a rendered mesh of the SAME GameObject
//   (matched by goPid, not name) whose footprint overlaps the collider footprint
for (const lv of LEVELS) {
  const byPid = new Map(lv.meshData.instances.map((i) => [i.goPid, i]));
  const coinH = 0.1589, coinR = 0.4338;
  for (const t of lv.tiers) {
    const p = t.pusher, f = t.floor;
    assert.ok(t.walls && t.walls.length > 0, 'level ' + lv.index + ' tier ' + t.name + ' has retaining walls');
    assert.ok(p.wall, 'level ' + lv.index + ' tier ' + t.name + ' has the moving DozerWall collider');
    const plateTop = Math.max(f.min[1], p.box.max[1]);
    const ax = p.axis, sg = p.sign;
    const openSide = ax === 'x' ? (sg > 0 ? 'maxX' : 'minX') : (sg > 0 ? 'maxZ' : 'minZ');
    const backSide = ax === 'x' ? (sg > 0 ? 'minX' : 'maxX') : (sg > 0 ? 'minZ' : 'maxZ');
    const edgeOf = { minX: ['z', f.min[0], f.min[2], f.max[2]], maxX: ['z', f.max[0], f.min[2], f.max[2]], minZ: ['x', f.min[2], f.min[0], f.max[0]], maxZ: ['x', f.max[2], f.min[0], f.max[0]] };
    for (const side of ['minX', 'maxX', 'minZ', 'maxZ']) {
      const [along, plane, lo, hi] = edgeOf[side];
      const cover = [];
      for (const w of t.walls) {
        const onEdge = side === 'minX' ? Math.abs(w.max[0] - plane) < 0.8
          : side === 'maxX' ? Math.abs(w.min[0] - plane) < 0.8
          : side === 'minZ' ? Math.abs(w.max[2] - plane) < 0.8
          : Math.abs(w.min[2] - plane) < 0.8;
        if (!onEdge) continue;
        // elevation gates: blocks a coin resting on the plate, base not floating
        if (w.max[1] < plateTop + coinH * 0.5) continue; // must reach the coin center to block the disc face
        if (w.min[1] > plateTop + 0.2) continue;
        const a0 = along === 'z' ? w.min[2] : w.min[0], a1 = along === 'z' ? w.max[2] : w.max[0];
        cover.push([Math.max(a0, lo), Math.min(a1, hi)]);
      }
      cover.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const [a, b] of cover) { if (b <= a) continue; if (merged.length && a <= merged[merged.length - 1][1] + 0.05) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b); else merged.push([a, b]); }
      const gaps = [];
      let cur = lo;
      for (const [a, b] of merged) { if (a > cur + 0.05) gaps.push([cur, a]); cur = Math.max(cur, b); }
      if (cur < hi - 0.05) gaps.push([cur, hi]);
      const maxGap = gaps.reduce((m, [a, b]) => Math.max(m, b - a), 0);
      if (side === openSide) {
        assert.ok(merged.length === 0, 'level ' + lv.index + ' tier ' + t.name + ' open side ' + side + ' must be a free descent opening, got covering walls');
      } else if (side === backSide) {
        // back side: no dedicated static wall, but the edge must be closed by the moving
        // DozerWall (at rest) together with the ends of the lateral walls - no gaps
        const wb = p.wall;
        const along2 = ax === 'x' ? 'z' : 'x';
        const w0 = along2 === 'z' ? wb.min[2] : wb.min[0], w1 = along2 === 'z' ? wb.max[2] : wb.max[0];
        const backPlane = side === 'minX' ? f.min[0] : side === 'maxX' ? f.max[0] : side === 'minZ' ? f.min[2] : f.max[2];
        const wallOnBack = side === 'minX' || side === 'maxX' ? Math.abs((side === 'minX' ? wb.max[0] : wb.min[0]) - backPlane) < 1.2 : Math.abs((side === 'minZ' ? wb.max[2] : wb.min[2]) - backPlane) < 1.2;
        assert.ok(wallOnBack, 'level ' + lv.index + ' tier ' + t.name + ' DozerWall at rest must sit on the back edge');
        // the DozerWall is part of the moving pusher: it must rise above the plate surface
        // (it pushes coins); it is not a static retaining wall and needn't be coin-height tall
        assert.ok(wb.max[1] >= plateTop, 'level ' + lv.index + ' tier ' + t.name + ' DozerWall must rise above the plate surface');
        const backCover = [[w0, w1]];
        for (const w of t.walls) { // lateral wall ends reaching the back edge
          const a0 = along === 'z' ? w.min[2] : w.min[0], a1 = along === 'z' ? w.max[2] : w.max[0];
          if (Math.max(a0, lo) <= Math.min(a1, hi)) backCover.push([Math.max(a0, lo), Math.min(a1, hi)]);
        }
        backCover.sort((a, b) => a[0] - b[0]);
        const bm = [];
        for (const [a, b] of backCover) { if (b <= a) continue; if (bm.length && a <= bm[bm.length - 1][1] + 0.05) bm[bm.length - 1][1] = Math.max(bm[bm.length - 1][1], b); else bm.push([a, b]); }
        let cur = lo, maxGap2 = 0;
        for (const [a, b] of bm) { if (a > cur + 0.05) maxGap2 = Math.max(maxGap2, a - cur); cur = Math.max(cur, b); }
        if (cur < hi - 0.05) maxGap2 = Math.max(maxGap2, hi - cur);
        assert.ok(maxGap2 < 0.05, 'level ' + lv.index + ' tier ' + t.name + ' back edge not continuously closed by DozerWall + lateral walls, max gap ' + maxGap2.toFixed(2));
      } else {
        assert.ok(maxGap < 0.05, 'level ' + lv.index + ' tier ' + t.name + ' lateral side ' + side + ' has uncovered edge gaps: ' + JSON.stringify(gaps.map(([a, b]) => [a.toFixed(2), b.toFixed(2)])) + ' of [' + lo.toFixed(2) + ',' + hi.toFixed(2) + ']');
      }
    }
    // identity-based wall<->mesh correspondence (goPid + footprint overlap, not names)
    for (const w of t.walls) {
      const inst = byPid.get(w.goPid);
      assert.ok(inst, 'level ' + lv.index + ' tier ' + t.name + ' wall goPid ' + w.goPid + ' (' + w.go + ') has a rendered instance of the same GameObject');
      const ox = Math.min(inst.aabb.max[0], w.max[0]) - Math.max(inst.aabb.min[0], w.min[0]);
      const oz = Math.min(inst.aabb.max[2], w.max[2]) - Math.max(inst.aabb.min[2], w.min[2]);
      const overlap = Math.max(0, ox) * Math.max(0, oz);
      const colArea = Math.max(1e-6, (w.max[0] - w.min[0]) * (w.max[2] - w.min[2]));
      // a MeshCollider is the mesh itself -> must match almost exactly; a BoxCollider is a
      // simplified stand-in for the mesh -> must overlap it substantially
      const need = w.col === 'MeshCollider' ? 0.8 : 0.2;
      assert.ok(overlap > need * colArea, 'level ' + lv.index + ' tier ' + t.name + ' wall ' + w.go + ' (' + w.col + ') rendered mesh footprint overlaps its collider by only ' + (100 * overlap / colArea).toFixed(0) + '%, need ' + (need * 100) + '%');
      assert.ok(inst.aabb.max[1] > f.min[1] && inst.aabb.min[1] < w.max[1], 'level ' + lv.index + ' tier ' + t.name + ' wall ' + w.go + ' mesh vertically overlaps its collider');
    }
  }
}
console.log('ok - perimeter: continuous elevated coverage of the actual platform edge on lateral sides, free opening on the sweep side, DozerWall spans the back, wall colliders matched to rendered meshes by goPid, all 19 levels');

// pusher-vs-static intersection test on the REAL scene graph: build the scene with the
// renderer, step the engine, invoke the renderer's own updateAnimations, then intersect
// the dozer parts' actual world matrices (from the scene graph) with every static AABB.
// Rest-phase overlap is prefab-inherent (e.g. the wall planted into its slot); the motion
// must not ADD any intersection beyond the rest-phase baseline for each part/static pair.
{
  const lv = LEVELS[0];
  const world0 = engine.createWorld(lv);
  // the physics and the renderer must reference the SAME controller origin
  for (const t of world0.tiers) {
    const p = t.pusher, ai = p.axis === 'x' ? 0 : 2;
    assert.ok(Math.abs(p.back - p.origin[ai]) < 1e-6, 'tier ' + t.name + ' engine back == controller origin on sweep axis');
  }
  const built = renderer.buildScene(world0);
  const statics = lv.meshData.instances.map((i) => ({ aabb: i.aabb, name: i.name })).filter((s) => s.aabb);
  const dozers = lv.meshData.dozers;
  assert.ok(dozers.length >= 2 && dozers.some((d) => /DozerWall/.test(d.name)), 'level 1 dozer assembly exported (plate + wall)');
  // motion period from the actual controller parameters: 2*travel/speed + backHold
  const period = Math.max(...world0.tiers.map((t) => {
    const p = t.pusher;
    return p ? (2 * p.travel) / p.speed + p.hold : 0;
  }), 0.1);
  // the tier's own base slabs (floor sources) are the support the assembly slides on /
  // in: contact with them is allowed ONLY at or below the slab's top surface (a slot),
  // never above it. Any other static (walls, machines, other tiers) must stay clear of
  // the assembly beyond its rest-phase (prefab) contact.
  const slabNames = new Set();
  for (const t of lv.tiers) for (const s of (t.floor.sources || [])) slabNames.add(s.go);
  const isOwnSlab = (da, s2) => {
    const sx = s2.aabb.max[0] - s2.aabb.min[0], sz = s2.aabb.max[2] - s2.aabb.min[2];
    if (Math.min(sx, sz) < 1.5) return false; // thin = wall segment, not the base slab
    return [...slabNames].some((g) => s2.name === g || s2.name.startsWith(g + ' '));
  };
  const overlapAt = (step) => {
    const w2 = engine.createWorld(lv);
    const n = Math.round((step / 24) * period * 60);
    for (let i = 0; i < n; i++) engine.step(w2, 1 / 60);
    renderer.updateAnimations(w2, built, 0); // the same function the render loop calls
    built.scene.updateMatrixWorld(true);
    const out = [];
    for (const da of built.dozerAnims) {
      const inst = da.grp.userData.inst;
      const a = inst.aabb;
      if (!a) continue;
      const e = da.grp.matrix.elements;
      const bt = inst.mat;
      const dx = e[12] - bt[12], dy = e[13] - bt[13], dz = e[14] - bt[14];
      const b = { min: [a.min[0] + dx, a.min[1] + dy, a.min[2] + dz], max: [a.max[0] + dx, a.max[1] + dy, a.max[2] + dz] };
      for (const s2 of statics) {
        const ox = Math.min(b.max[0], s2.aabb.max[0]) - Math.max(b.min[0], s2.aabb.min[0]);
        const oy = Math.min(b.max[1], s2.aabb.max[1]) - Math.max(b.min[1], s2.aabb.min[1]);
        const oz = Math.min(b.max[2], s2.aabb.max[2]) - Math.max(b.min[2], s2.aabb.min[2]);
        const vol = Math.max(0, ox) * Math.max(0, oy) * Math.max(0, oz);
        if (vol > 1e-4) {
          // penetration depth: for a wall (thin horizontally, tall) it is the overlap along
          // the wall's thin axis (the plate slides in its slot - lengthwise overlap may grow);
          // for slabs/columns/machines it is the minimum-overlap axis (any deepening = clipping)
          const sx = s2.aabb.max[0] - s2.aabb.min[0], sz = s2.aabb.max[2] - s2.aabb.min[2];
          const isWall = Math.min(sx, sz) < 1.5; // thin horizontally = wall segment (incl. caps)
          const thin = sx <= sz ? 0 : 2;
          const depths = [Math.max(0, ox), Math.max(0, oy), Math.max(0, oz)];
          out.push({ da, s2, b, vol, depths, depth: isWall ? depths[thin] : Math.min(...depths), isWall, top: Math.min(b.max[1], s2.aabb.max[1]) });
        }
      }
    }
    return out;
  };
  // store per-axis penetration depths at rest for every overlapping pair
  const rest = new Map();
  for (const r of overlapAt(0)) rest.set(r.da.tierName + '|' + r.da.grp.userData.inst.name + '|' + r.s2.name, r);
  let worst = 0, worstWhat = '', worstDeep = 0, worstDeepWhat = '';
  for (let step = 1; step <= 24; step++) {
    for (const r of overlapAt(step)) {
      const k = r.da.tierName + '|' + r.da.grp.userData.inst.name + '|' + r.s2.name;
      const b0 = rest.get(k);
      if (r.vol > worst) { worst = r.vol; worstWhat = 'phase ' + step + ' ' + k; }
      if (isOwnSlab(r.da, r.s2)) {
        // slot contact with the tier's own base: must stay at/below the slab top surface
        assert.ok(r.top <= r.s2.aabb.max[1] + 1e-3, 'phase ' + step + ' ' + k + ': assembly rises above its own base slab top (visible clipping), overlap top ' + r.top.toFixed(3) + ' vs slab top ' + r.s2.aabb.max[1].toFixed(3));
        assert.ok(r.vol < 0.5, 'phase ' + step + ' ' + k + ': slot contact unbounded, vol ' + r.vol.toFixed(3));
      } else {
        // penetration depth must not exceed the prefab (rest) depth: the plate slides in
        // slots cut into the side walls (rest overlap is by design), but the sweep must
        // never push any part DEEPER into any static than the prefab pose
        const b = b0 ? b0.depth : 0;
        const added = r.depth - b;
        if (added > worstDeep) { worstDeep = added; worstDeepWhat = 'phase ' + step + ' ' + k + ' rest ' + b.toFixed(3) + ' now ' + r.depth.toFixed(3); }
        assert.ok(added < 0.02, 'motion deepens intersection at phase ' + step + ' for ' + k + ': rest depth ' + b.toFixed(3) + ' now ' + r.depth.toFixed(3));
        assert.ok(r.vol < 2.0, 'catastrophic overlap at phase ' + step + ' for ' + k + ': ' + r.vol.toFixed(3));
      }
    }
  }
  console.log('ok - real scene graph, runtime updateAnimations, controller-derived period ' + period.toFixed(2) + 's: worst overlap vol ' + worst.toFixed(4) + ' (' + worstWhat + '), worst added penetration depth ' + worstDeep.toFixed(4) + ' (' + worstDeepWhat + ')');
}

// camera rig must match the extracted (handedness-converted) LevelCameraBounds for every
// level, going through the SAME runtime path as the app (applyCamera with world -> marker fit)
for (const lv of LEVELS) {
  const cam = new THREE.PerspectiveCamera(1, 9 / 16, 3, 900);
  const w = engine.createWorld(lv);
  renderer.applyCamera(cam, lv, 9 / 16, w); // runtime path: extracted pose + marker-quad fit
  const gl = lv.cameraGL;
  assert.ok(gl, 'level ' + lv.index + ' cameraGL');
  assert.ok(Math.abs(cam.fov - gl.fov) < 1e-6, 'level ' + lv.index + ' fov');
  const wantQ = new THREE.Quaternion(gl.quat[0], gl.quat[1], gl.quat[2], gl.quat[3]);
  assert.ok(Math.abs(cam.quaternion.dot(wantQ)) > 1 - 1e-6, 'level ' + lv.index + ' cam quat (fit must not change orientation)');
  // the fit only slides along the extracted view ray: cam.pos = target - fwd * d
  const b = gl.bounds;
  const target = new THREE.Vector3(
    (b.topMarker[0] + b.bottomMarker[0] + b.leftMarker[0] + b.rightMarker[0]) / 4,
    (b.topMarker[1] + b.bottomMarker[1] + b.leftMarker[1] + b.rightMarker[1]) / 4,
    (b.topMarker[2] + b.bottomMarker[2] + b.leftMarker[2] + b.rightMarker[2]) / 4);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(wantQ);
  const got = cam.getWorldDirection(new THREE.Vector3());
  assert.ok(got.distanceTo(fwd) < 1e-4, 'level ' + lv.index + ' forward');
  const v = cam.position.clone().sub(target);
  assert.ok(v.length() > 1, 'level ' + lv.index + ' camera moved off target');
  v.normalize();
  assert.ok(Math.abs(v.dot(fwd) + 1) < 1e-3, 'level ' + lv.index + ' camera sits on the extracted view ray');
  // the marker quad must fit inside the frame at the fitted distance
  for (const mk of ['topMarker', 'bottomMarker', 'leftMarker', 'rightMarker']) {
    const p = new THREE.Vector3(...b[mk]).project(cam);
    assert.ok(p.z > -1 && p.z < 1 && Math.abs(p.x) <= 1.0 && Math.abs(p.y) <= 1.0, 'level ' + lv.index + ' marker ' + mk + ' in frame');
  }
}
console.log('ok - runtime camera path (pose + marker fit) matches extracted LevelCameraBounds for all 19 levels');

// scene graph is built from the real exported meshes
const level = LEVELS[11]; // level 12: 3 tiers
const world = engine.createWorld(level);
for (let i = 0; i < 60 * 3; i++) {
  if (i % 12 === 0 && world.coins.length < 60) engine.dropCoin(world, CONFIG.coins[0]);
  engine.step(world, 1 / 60);
}
for (let i = 0; i < 25; i++) engine.dropCoin(world, CONFIG.coins[0]); // fresh pile for the frame
for (let i = 0; i < 40; i++) engine.step(world, 1 / 60); // let them land
const built = renderer.buildScene(world);
assert.strictEqual(built.instanceGroups.length, level.meshData.instances.length, 'one group per exported mesh instance');
assert.strictEqual(built.dozerAnims.length, level.meshData.dozers.length, 'one animated dozer per exported Dozer');
for (const da of built.dozerAnims) {
  const tier = world.tiers.find((t) => t.name === da.tierName);
  assert.ok(tier && tier.pusher, 'dozer ' + da.tierName + ' resolves to a tier with a pusher');
}
let meshCount = 0;
built.scene.traverse((o) => { if (o.isMesh) meshCount++; });
assert.ok(meshCount >= level.meshData.instances.length + level.meshData.dozers.length, 'scene contains the mesh instances');
for (const c of world.coins) {
  const mesh = renderer.coinMesh(CONFIG.coins.find((k) => k.id === c.type) || CONFIG.coins[0]);
  mesh.position.set(c.x, c.y, c.z);
  built.coinGroup.add(mesh);
}
built.scene.add(built.coinGroup);

// rasterize a real frame at portrait mobile aspect through the same camera path as runtime
const W = 405, H = 720;
const camera = new THREE.PerspectiveCamera(1, W / H, 3, 2000);
renderer.applyCamera(camera, level, W / H, world);
const buf = raster.render(world, built, W, H, camera);

let bg = 0, orange = 0, nonBg = 0, white = 0, colored = 0;
const rowsWithNonBg = new Set();
const rowsWithWhite = new Set();
const colorSet = new Set();
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const isBg = b > 150 && r > 80 && r < 200 && g < 110;
    const isWhite = r > 215 && g > 215 && b > 218;
    if (isBg) bg++; else { nonBg++; rowsWithNonBg.add(y); }
    if (isWhite) { white++; rowsWithWhite.add(y); } else if (!isBg) colored++;
    colorSet.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
    if (r > 170 && g > 90 && g < 215 && b < 100 && r > b + 60) orange++;
  }
}
const total = W * H;
console.log(`pixels: bg=${(100 * bg / total).toFixed(1)}% nonBg=${(100 * nonBg / total).toFixed(1)}% white=${white} colored=${colored} coins=${orange} distinctColors=${colorSet.size} nonBgRows=${rowsWithNonBg.size}/${H} whiteRows=${rowsWithWhite.size}/${H}`);
assert.ok(nonBg / total > 0.08, 'frame is not blank: machine occupies >8% of the frame, got ' + (100 * nonBg / total).toFixed(1) + '%');
assert.ok(rowsWithNonBg.size > H * 0.3, 'machine silhouette spans >30% of frame rows, got ' + rowsWithNonBg.size + '/' + H);
assert.ok(orange > 30, 'coins visibly rendered, got ' + orange);
assert.ok(bg / total > 0.1, 'background visible around the tower, got ' + (100 * bg / total).toFixed(1) + '%');
assert.ok(colorSet.size > 12, 'frame has material/color diversity (not a flat white model), got ' + colorSet.size + ' distinct colors');
assert.ok(colored / total > 0.08, 'non-white non-bg structure >8% of frame (colored machinery), got ' + (100 * colored / total).toFixed(1) + '%');

console.log('render3d ok: portrait frame rasterized from the real exported scene graph + extracted camera; non-blank, silhouette and coins verified');
