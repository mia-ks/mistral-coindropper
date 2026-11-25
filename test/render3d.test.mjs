import assert from 'node:assert';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('../js/vendor/three.module.js')).href);
const { CONFIG, LEVELS } = require('../js/config.js');
const { makeEngine } = require('../js/engine.js');
const { makeRenderer } = require('../js/render.js');
const { makeRasterizer } = require('./raster.js');

const engine = makeEngine(CONFIG);
const renderer = makeRenderer(CONFIG, LEVELS, THREE);
const raster = makeRasterizer(THREE);

// camera rig must match the extracted (handedness-converted) LevelCameraBounds for every level
for (const lv of LEVELS) {
  const cam = new THREE.PerspectiveCamera(1, 9 / 16, 3, 900);
  renderer.applyCamera(cam, lv, 9 / 16); // no world -> no fit, raw extracted pose
  const gl = lv.cameraGL;
  assert.ok(gl, 'level ' + lv.index + ' cameraGL');
  assert.ok(Math.abs(cam.fov - gl.fov) < 1e-6, 'level ' + lv.index + ' fov');
  assert.ok(Math.abs(cam.position.x - gl.pos[0]) < 1e-6 &&
            Math.abs(cam.position.y - gl.pos[1]) < 1e-6 &&
            Math.abs(cam.position.z - gl.pos[2]) < 1e-6, 'level ' + lv.index + ' cam pos');
  const wantQ = new THREE.Quaternion(gl.quat[0], gl.quat[1], gl.quat[2], gl.quat[3]);
  assert.ok(Math.abs(cam.quaternion.dot(wantQ)) > 1 - 1e-6, 'level ' + lv.index + ' cam quat');
  // three.js camera forward is local -z; it must equal quat * (0,0,-1)
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(wantQ);
  const got = cam.getWorldDirection(new THREE.Vector3());
  assert.ok(got.distanceTo(fwd) < 1e-4, 'level ' + lv.index + ' forward');
}
console.log('ok - camera pose (mirrored pos + quat, fov 20) matches extracted LevelCameraBounds for all 19 levels');

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

let bg = 0, orange = 0, nonBg = 0, white = 0;
const rowsWithNonBg = new Set();
const rowsWithWhite = new Set();
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    const isBg = b > 150 && r > 80 && r < 200 && g < 110;
    if (isBg) bg++; else { nonBg++; rowsWithNonBg.add(y); }
    if (r > 170 && g > 90 && g < 215 && b < 100 && r > b + 60) orange++;
    if (r > 215 && g > 215 && b > 218) { white++; rowsWithWhite.add(y); }
  }
}
const total = W * H;
console.log(`pixels: bg=${(100 * bg / total).toFixed(1)}% nonBg=${(100 * nonBg / total).toFixed(1)}% white=${white} coins=${orange} nonBgRows=${rowsWithNonBg.size}/${H} whiteRows=${rowsWithWhite.size}/${H}`);
assert.ok(nonBg / total > 0.15, 'frame is not blank: tower occupies >15% of the frame, got ' + (100 * nonBg / total).toFixed(1) + '%');
assert.ok(rowsWithWhite.size > H * 0.3, 'tower silhouette (light structure) spans >30% of frame rows, got ' + rowsWithWhite.size);
assert.ok(orange > 30, 'coins visibly rendered, got ' + orange);
assert.ok(bg / total > 0.1, 'background visible around the tower, got ' + (100 * bg / total).toFixed(1) + '%');

console.log('render3d ok: portrait frame rasterized from the real exported scene graph + extracted camera; non-blank, silhouette and coins verified');
