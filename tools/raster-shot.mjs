import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const THREE = await import(pathToFileURL(path.join(root, 'js/vendor/three.module.js')).href);
const { CONFIG, LEVELS } = require(path.join(root, 'js/config.js'));
const { makeEngine } = require(path.join(root, 'js/engine.js'));
const { makeRenderer } = require(path.join(root, 'js/render.js'));
const { makeRasterizer } = require(path.join(root, 'test/raster.js'));

function writePNG(file, buf, W, H) {
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    Buffer.from(buf.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

const table = [];
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  table[i] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const levelIdx = Math.max(0, Number(process.argv[2] || 1) - 1);
const simSeconds = Number(process.argv[3] || 11);
const out = process.argv[4] || path.join(root, 'docs', `raster-level${levelIdx + 1}.png`);

const engine = makeEngine(CONFIG);
const renderer = makeRenderer(CONFIG, LEVELS, THREE);
const raster = makeRasterizer(THREE);
const world = engine.createWorld(LEVELS[levelIdx]);
let drops = 0;
for (let i = 0; i < simSeconds * 60; i++) {
  if (i % 20 === 0 && drops < 45) {
    engine.dropCoin(world, ((drops % 9) - 4) * 0.9, 3.2 + (drops % 4), CONFIG.coins[drops < 30 ? 0 : drops % 3]);
    drops++;
  }
  engine.step(world, 1 / 60, { pusherSpeed: 2 });
}
const built = renderer.buildScene(world);
for (const c of world.coins) {
  const def = CONFIG.coins.find((k) => k.id === c.type) || CONFIG.coins[0];
  const mesh = renderer.coinMesh(def);
  mesh.position.set(c.x, c.y, c.z);
  built.coinGroup.add(mesh);
}
built.scene.add(built.coinGroup);
const W = 540, H = 960;
const camera = new THREE.PerspectiveCamera(1, W / H, 3, 2000);
renderer.applyCamera(camera, LEVELS[levelIdx], W / H, world);
const buf = raster.render(world, built, W, H, camera);
fs.mkdirSync(path.dirname(out), { recursive: true });
writePNG(out, buf, W, H);
console.log(`${out} | level ${levelIdx + 1} | coins on board: ${world.coins.length} | ${W}x${H} rasterized from the real scene graph`);
