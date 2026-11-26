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
