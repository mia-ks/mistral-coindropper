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

// camera rig must match the extracted LevelCameraBounds for every level
for (const lv of LEVELS) {
  const cam = new THREE.PerspectiveCamera(1, 9 / 16, 3, 900);
  renderer.applyCamera(cam, lv, 9 / 16);
  assert.ok(Math.abs(cam.fov - lv.camera.fov) < 1e-6, 'level ' + lv.index + ' fov');
  assert.ok(Math.abs(cam.position.x - lv.camera.pos[0]) < 1e-6, 'level ' + lv.index + ' cam x');
  // camera forward must equal the Unity camera forward Ry(ey)*Rx(ex)*(0,0,1)
  const ex = lv.camera.euler.map((d) => (d * Math.PI) / 180);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(ex[0], ex[1], ex[2], 'YXZ'));
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const got = cam.getWorldDirection(new THREE.Vector3());
  assert.ok(got.distanceTo(fwd) < 1e-4, 'level ' + lv.index + ' forward ' + JSON.stringify(got) + ' vs ' + JSON.stringify(fwd));
}
console.log('ok - camera rig matches LevelCameraBounds for all 19 levels (fov 20, euler, zoom marker pos)');

// rasterize a real frame of level 12 (3 tiers) at portrait mobile aspect, using the level's camera
const level = LEVELS[11];
const world = engine.createWorld(level);
for (let i = 0; i < 60 * 5; i++) {
  if (i % 12 === 0 && world.coins.length < 60) engine.dropCoin(world, CONFIG.coins[0]);
  engine.step(world, 1 / 60);
}
const built = renderer.buildScene(world);
assert.strictEqual(built.machineGroups.length, world.machines.length, 'one mesh group per machine');
assert.strictEqual(built.tierGroups.length, world.tiers.length, 'one group per tier');
assert.strictEqual(built.pusherMeshes.length, world.tiers.length, 'one pusher per tier');
for (const c of world.coins) {
  const mesh = renderer.coinMesh(CONFIG.coins.find((k) => k.id === c.type) || CONFIG.coins[0]);
  mesh.position.set(c.x, c.y, c.z);
  built.coinGroup.add(mesh);
}
built.scene.add(built.coinGroup);

const W = 405, H = 720; // portrait 9:16 mobile
const camera = new THREE.PerspectiveCamera(1, W / H, 3, 900);
renderer.applyCamera(camera, level, W / H);
const buf = raster.render(world, built, W, H, camera);

let bg = 0, orange = 0, platform = 0, pusher = 0;
const rowsWithPlatform = new Set();
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const r = buf[i], g = buf[i + 1], b = buf[i + 2];
    if (b > 150 && r > 80 && r < 200 && g < 160) bg++;
    if (r > 200 && g > 100 && g < 200 && b < 80) orange++;
    if (r > 215 && g > 215 && b > 218) { platform++; rowsWithPlatform.add(y); }
    if (b > 180 && r < 120 && g < 160) pusher++;
  }
}
const total = W * H;
console.log(`pixels: bg=${(100 * bg / total).toFixed(1)}% coins=${orange} platform=${platform} (rows: ${rowsWithPlatform.size}) pusher=${pusher}`);
assert.ok(bg / total > 0.25, 'purple background visible');
assert.ok(orange > 150, 'coins visibly rendered, got ' + orange);
assert.ok(platform > 3000, 'platforms visibly rendered, got ' + platform);
assert.ok(rowsWithPlatform.size > 40, 'multi-tier silhouette: platform spans many rows, got ' + rowsWithPlatform.size);
assert.ok(pusher > 100, 'pusher visible, got ' + pusher);

console.log('render3d ok: portrait frame rasterized from the real scene graph + extracted camera, pixel classes verified');
