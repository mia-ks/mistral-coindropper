import * as THREE from 'three';

// CONFIG / LEVELS are global lexical bindings from the classic scripts above
/* global CONFIG, LEVELS, makeEngine, makeGame, makeRenderer */
const engine = makeEngine(CONFIG);
const game = makeGame(CONFIG, LEVELS, engine);
const renderer = makeRenderer(CONFIG, LEVELS, THREE);

const canvas = document.getElementById('gl');
const view = renderer.create(canvas);

const hadSave = game.load();
const q = new URLSearchParams(location.search);
if (q.get('level')) { game.loadLevel(Math.max(1, Math.min(LEVELS.length, parseInt(q.get('level')) || 1)) - 1); }
view.setLevel(LEVELS[game.state.levelIndex], game.world);
// debug/screenshot hook: ?level=N&t=SECONDS&dropEvery=TICKS fast-forwards the sim
window.__game = game;
window.__view = view;
window.__demo = {
  setLevel(n) { game.loadLevel(n - 1); view.setLevel(LEVELS[game.state.levelIndex], game.world); refreshHud(); refreshUpgrades(); },
  simulate(seconds, dropEvery) {
    game.state.freezeLevel = true; // capture the requested level: never auto-advance mid-sim
    game.state.progress = 0;
    game.state.completed = false;
    game.state.charges = 999;
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) { if (i % (dropEvery || 20) === 0) game.drop(); game.tick(1 / 60); }
    view.render(0);
    refreshHud(); refreshUpgrades();
  },
};
view.resize();
window.addEventListener('resize', () => view.resize());

canvas.addEventListener('pointerdown', () => {
  const c = game.drop();
  if (c && window.playCoin) window.playCoin();
});

function refreshHud() {
  const s = game.state;
  document.getElementById('hud-coins').textContent = '\u{1FA99} ' + Math.floor(s.bank);
  document.getElementById('hud-cash').textContent = '$ ' + Math.floor(s.cash);
  document.getElementById('hud-gems').textContent = '\u{1F48E} ' + Math.floor(s.gems);
  const lv = LEVELS[s.levelIndex];
  document.getElementById('level-label').textContent = 'LEVEL ' + (s.levelIndex + 1) + ' / ' + LEVELS.length;
  const pct = Math.min(100, (100 * s.progress) / lv.goal);
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-text').textContent = Math.floor(Math.min(s.progress, lv.goal)) + ' / ' + lv.goal;
  const cap = lv.spawn.maxCharges + s.globalUpgrades.capacity * 5;
  const box = document.getElementById('charges');
  box.innerHTML = '';
  for (let i = 0; i < cap; i++) {
    const d = document.createElement('div');
    d.className = 'pip' + (i < s.charges ? '' : ' empty');
    box.appendChild(d);
  }
  document.getElementById('bb-coins').textContent = '\u{1FA99} ' + Math.floor(s.bank);
  document.getElementById('bb-rate').textContent = 'Coins/s $' + Math.floor(s.incomeRate);
  const combo = document.getElementById('combo');
  if (s.combo >= 2) { combo.textContent = 'x' + s.combo + ' COMBO'; combo.classList.add('show'); }
  else combo.classList.remove('show');
}

function refreshUpgrades() {
  const s = game.state;
  const list = document.getElementById('upgrades-list');
  list.innerHTML = '';
  const lv = LEVELS[s.levelIndex];
  for (const m of game.world ? game.world.machines : []) {
    const label = (CONFIG.machineTypes[m.type] || {}).label || m.type;
    const lvl = s.upgrades[m.id] || 0;
    const cost = Math.ceil(CONFIG.machineCostBase * Math.pow(CONFIG.machineCostMult, lvl));
    const b = document.createElement('button');
    b.className = 'upg';
    b.innerHTML = label + ' ' + (lvl > 0 ? 'Lv' + lvl : '') + ' <span class="cost">\u{1F48E}' + cost + '</span>';
    b.disabled = lvl >= CONFIG.machineMaxLevel || s.gems < cost;
    b.onclick = () => { if (game.upgradeMachine(m.id)) { refreshUpgrades(); refreshHud(); } };
    list.appendChild(b);
  }
}

let last = performance.now();
let hudTimer = 0, saveTimer = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  game.tick(dt);
  if (view.world !== game.world) view.setLevel(LEVELS[game.state.levelIndex], game.world);
  view.render(dt);
  hudTimer += dt;
  if (hudTimer > 0.15) { hudTimer = 0; refreshHud(); refreshUpgrades(); }
  saveTimer += dt;
  if (saveTimer > 5) { saveTimer = 0; game.save(); }
  requestAnimationFrame(frame);
}
window.addEventListener('beforeunload', () => game.save());
refreshHud();
refreshUpgrades();
requestAnimationFrame(frame);
