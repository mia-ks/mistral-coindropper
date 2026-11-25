import assert from 'node:assert';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const THREE = await import(pathToFileURL(require.resolve('../js/vendor/three.module.js').replace(process.cwd(), process.cwd())).href).catch(async () => {
  return import(pathToFileURL('/workspace/coindozer-clean/js/vendor/three.module.js').href);
});
const { CONFIG, LEVELS } = require('../js/config.js');
const { makeEngine } = require('../js/engine.js');
const { makeRenderer } = require('../js/render.js');

const engine = makeEngine(CONFIG);
const renderer = makeRenderer(CONFIG, LEVELS, THREE);

const world = engine.createWorld(LEVELS[18]);
const built = renderer.buildScene(world);
assert.strictEqual(built.machineGroups.length, world.machines.length, 'one mesh group per machine');
assert.ok(built.scene.children.length > 10, 'scene has platform, walls, lights, machines');
assert.ok(built.pusher, 'pusher mesh exists');

const coin = renderer.coinMesh(CONFIG.coins[2]);
assert.ok(coin.children.length >= 2, 'coin mesh has rim + face');

let coinAdded = false;
built.coinGroup.add(coin);
coinAdded = built.coinGroup.children.includes(coin);
assert.ok(coinAdded);

console.log('render3d ok: level 19 scene has', built.machineGroups.length, 'machine groups,', built.scene.children.length, 'top-level objects');
