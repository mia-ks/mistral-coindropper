// Real-browser screenshots of the game (headless Chromium + SwiftShader WebGL).
//
// Usage:
//   npm i puppeteer            # once, anywhere
//   python3 -m http.server 8123 --bind 127.0.0.1 &   # serve the repo root
//   node tools/screenshot.mjs 1,12,19 3,5,2.5
//
// args: comma-separated level numbers, then comma-separated sim seconds per level.
// Writes docs/screenshot-level<N>.png at 1080x1920 (portrait 9:16, like the original).
//
// In a sandbox without system libs for Chrome, the debs can be fetched and
// extracted locally (no root): apt packages via deb.debian.org + dpkg -x, then
// run with LD_LIBRARY_PATH pointing at the extracted usr/lib/x86_64-linux-gnu.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
let puppeteer;
try { puppeteer = require('puppeteer'); }
catch { console.error('puppeteer not installed: npm i puppeteer'); process.exit(1); }

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(REPO, 'docs');
const PORT = process.env.PORT || 8123;

const levels = (process.argv[2] || '1,12,19').split(',').map(Number);
const sims = (process.argv[3] || '3,5,2.5').split(',').map(Number);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  defaultViewport: { width: 1080, height: 1920, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
for (let i = 0; i < levels.length; i++) {
  const lv = levels[i];
  await page.goto(`http://127.0.0.1:${PORT}/index.html?level=${lv}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction('!!window.__demo', { timeout: 20000 });
  await page.evaluate((lv, t) => { window.__demo.setLevel(lv); window.__demo.simulate(t, 14); }, lv, sims[i] || 3);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const shot = path.join(OUT, `screenshot-level${lv}.png`);
  await page.screenshot({ path: shot });
  console.log('saved', shot);
}
await browser.close();
