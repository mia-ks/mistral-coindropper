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

const world = engine.createWorld(LEVELS[0]);
const built = renderer.buildScene(world);
assert.strictEqual(built.machineGroups.length, world.machines.length, 'one mesh group per machine');
assert.ok(built.pusher, 'pusher mesh exists');

for (let i = 0; i < 5; i++) {
  const c = engine.dropCoin(world, (i - 2) * 1.2, 6, CONFIG.coins[0]);
  c.y = CONFIG.world.coinH;
  const mesh = renderer.coinMesh(CONFIG.coins[0]);
  mesh.position.set(c.x, c.y, c.z);
  built.coinGroup.add(mesh);
}
built.scene.add(built.coinGroup);

const W = 640, H = 400;
const buf = raster.render(world, built, W, H);

let bg = 0, orange = 0, green = 0, blue = 0;
for (let i = 0; i < W * H; i++) {
  const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
  if (b > 150 && r > 80 && r < 200 && g < 160) bg++;
  if (r > 200 && g > 100 && g < 200 && b < 80) orange++;
  if (g > 180 && r < 160 && b < 160) green++;
  if (b > 180 && r < 120 && g < 160) blue++;
}
const total = W * H;
console.log(`pixels: bg=${(100 * bg / total).toFixed(1)}% orange(coins)=${orange} green(gate/collector)=${green} blue(pusher/conveyor)=${blue}`);
assert.ok(bg / total > 0.3, 'background should dominate an empty-ish scene');
assert.ok(orange > 300, 'coins must be visibly rendered (orange pixels), got ' + orange);
assert.ok(green > 200, 'gate/collector green must be visible, got ' + green);
assert.ok(blue > 200, 'blue pusher must be visible, got ' + blue);

console.log('render3d ok: frame actually rasterized, scene graph + pixels verified');
