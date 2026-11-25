// Headless full-loop smoke test: drop coins on a 3-tier level, simulate, collect.
const { CONFIG, LEVELS } = require('../js/config.js');
const { makeEngine } = require('../js/engine.js');
const { makeGame } = require('../js/game.js');

const engine = makeEngine(CONFIG);
const game = makeGame(CONFIG, LEVELS, engine);
game.loadLevel(11); // level 12: 3 tiers, tesla coils, fan, gate
game.state.charges = 100;
let drops = 0;
for (let i = 0; i < 60 * 60; i++) {
  if (i % 25 === 0 && game.drop()) drops++;
  game.tick(1 / 60);
}
const w = game.world;
const bank = Math.floor(game.state.bank);
console.log(`smoke ok: 60s sim on level 12, drops: ${drops}, coins on board: ${w.coins.length}, bank: ${bank}, progress: ${Math.floor(game.state.progress)}`);
if (drops < 50 || bank < 1) { console.error('FAIL: drops or collection broken'); process.exit(1); }
