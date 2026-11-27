// Headless full-loop smoke test: drop coins on a 3-tier level, simulate, collect.
const { CONFIG, LEVELS } = require('../js/config.js');
const { makeEngine } = require('../js/engine.js');
const { makeGame } = require('../js/game.js');

const engine = makeEngine(CONFIG);
const game = makeGame(CONFIG, LEVELS, engine);
// level 1: two tiers where the upper tier's open edge directly overhangs the lower tier,
// and the lower tier's open edge overhangs the collector chute - the flow is pure geometry
game.loadLevel(0);
game.state.charges = 100;
let drops = 0;
let maxBreaches = 0;
for (let i = 0; i < 60 * 60; i++) {
  if (i % 25 === 0 && game.drop()) drops++;
  game.tick(1 / 60);
  if (game.world) maxBreaches = Math.max(maxBreaches, game.world.stats.breaches);
}
const w = game.world;
const bank = Math.floor(game.state.bank);
console.log(`smoke ok: 60s sim from level 1, drops: ${drops}, reached level ${game.state.levelIndex + 1}, coins on board: ${w.coins.length}, bank: ${bank}, progress: ${Math.floor(game.state.progress)}`);
console.log(`  final world: collected=${w.stats.collected} lost=${w.stats.lost} breaches=${w.stats.breaches} exits=${JSON.stringify(w.stats.exits)}; max breaches across levels: ${maxBreaches}`);
if (drops < 50 || bank < 1) { console.error('FAIL: drops or collection broken'); process.exit(1); }
if (maxBreaches > 0) { console.error('FAIL: wall breaches observed'); process.exit(1); }
