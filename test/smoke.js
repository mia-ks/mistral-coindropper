const assert = require('assert');
const { CONFIG, LEVELS } = require('../js/config.js');
const { makeEngine } = require('../js/engine.js');
const { makeGame } = require('../js/game.js');

const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const engine = makeEngine(CONFIG);
const game = makeGame(CONFIG, LEVELS, engine, storage);
assert.ok(LEVELS.length === 19);

let t = 0;
let drops = 0;
for (let i = 0; i < 660; i++) {
  if (i % 35 === 0 && game.canDrop()) {
    game.dropAt(((drops * 1.7) % 8) - 4, 4 + (drops % 5), false);
    drops++;
  }
  const { events } = game.tick(1 / 60, t);
  for (const e of events) assert.ok(e.type === 'collect' || e.type === 'destroy' || e.type === 'lost');
  t += 1 / 60;
  if (i % 300 === 0) game.save();
}
game.save();
assert.ok(store.has('coindozer-clean-save-v1'), 'save written');
const s = JSON.parse(store.get('coindozer-clean-save-v1'));
assert.ok(s.totalDrops === drops);
assert.ok(drops >= 15, 'drops happened: ' + drops);
for (const c of game.getWorld().coins) {
  assert.ok(isFinite(c.x) && isFinite(c.y) && isFinite(c.z));
}
console.log('smoke ok: 660 ticks,', drops, 'drops, coins on board:', game.getWorld().coins.length, ', bank:', Math.floor(s.coins), ', collected:', s.stats.collected);
