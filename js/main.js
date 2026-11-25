import * as THREE from 'three';
/* global CONFIG, LEVELS, makeEngine, makeGame, makeRenderer, makeAudio */
(function () {
  const engine = makeEngine(CONFIG);
  const game = makeGame(CONFIG, LEVELS, engine, typeof localStorage !== 'undefined' ? localStorage : null);
  const renderer = makeRenderer(CONFIG, LEVELS, THREE);
  const audio = makeAudio();

  const stage = document.getElementById('stage');
  const overlay = document.getElementById('overlay');
  const view = renderer.create(stage, overlay);
  const el = (id) => document.getElementById(id);
  const ui = {
    coins: el('ui-coins'), cash: el('ui-cash'), gems: el('ui-gems'),
    level: el('ui-level'), pfill: el('progress-fill'), ptext: el('progress-text'),
    combo: el('ui-combo'), charges: el('charges'), toast: el('toast'),
    panel: el('panel'), gup: el('global-upgrades'), mup: el('machine-upgrades'),
    pup: el('pusher-upgrade'),
  };

  const hadSave = game.load();
  if (hadSave) game.loadLevel(game.getState().levelIndex, true);
  audio.setMuted(!!game.getState().settings.muted);
  updateMuteIcon();
  const offline = game.applyOffline();
  if (offline && offline.gain > 1) {
    toast(`Welcome back! +${fmt(offline.gain)} coins while you were away (${Math.round(offline.seconds / 60)} min)`);
  }

  function fmt(n) {
    if (n < 1000) return Math.floor(n).toString();
    const units = ['K', 'M', 'B', 'T'];
    let u = -1;
    while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
    return n.toFixed(n >= 100 ? 0 : 1) + units[u];
  }

  let toastTimer = null;
  function toast(msg, ms) {
    ui.toast.textContent = msg;
    ui.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.add('hidden'), ms || 2600);
  }

  window.addEventListener('resize', () => view.resize());
  view.resize();

  const fx = { floaters: [], particles: [] };
  function addFloater(x, y, z, text, color) {
    fx.floaters.push({ x, y, z, text, color, life: 1.2, maxLife: 1.2 });
  }
  function burst(x, y, z, color, n) {
    for (let i = 0; i < (n || 8); i++) {
      fx.particles.push({
        x, y, z, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 5,
        color, life: 0.7, maxLife: 0.7,
      });
    }
  }

  stage.addEventListener('pointerdown', (e) => {
    if (!ui.panel.classList.contains('hidden')) return;
    const p = view.pick(e.clientX, e.clientY);
    if (!p) return;
    if (!game.canDrop()) {
      audio.deny();
      toast('Out of drops — refilling…');
      return;
    }
    const c = game.dropAt(p.x, p.z, false);
    if (c) {
      audio.drop();
      addFloater(c.x, c.y, c.z, '-1', '#9db4e8');
    }
    game.save();
  });

  el('btn-shake').addEventListener('click', () => {
    if (game.shake()) { audio.shake(); toast('Board shake!'); }
    else { audio.deny(); toast('Shake costs $1 cash'); }
  });
  el('btn-upgrades').addEventListener('click', () => { renderPanel(); ui.panel.classList.remove('hidden'); });
  el('btn-close-panel').addEventListener('click', () => ui.panel.classList.add('hidden'));
  el('btn-mute').addEventListener('click', () => {
    const m = !audio.isMuted();
    audio.setMuted(m);
    game.getState().settings.muted = m;
    game.save();
    updateMuteIcon();
  });
  function updateMuteIcon() { el('btn-mute').textContent = audio.isMuted() ? 'muted' : 'sound'; }
  el('btn-reset').addEventListener('click', () => {
    if (confirm('Reset all progress?')) {
      game.reset();
      game.loadLevel(0, false);
      toast('Save reset');
    }
  });

  function row(name, desc, lvl, max, cost, currency, onBuy) {
    const div = document.createElement('div');
    div.className = 'up-row';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<div class="name">${name}</div><div class="desc">${desc}</div><div class="lvl">Lv ${lvl}/${max}</div>`;
    const btn = document.createElement('button');
    btn.className = 'up-btn' + (currency === 'gem' ? ' gem' : '');
    if (cost === null) { btn.textContent = 'MAX'; btn.disabled = true; }
    else {
      btn.textContent = (currency === 'gem' ? 'gem ' : 'coin ') + fmt(cost);
      btn.addEventListener('click', () => {
        if (onBuy()) { audio.buy(); renderPanel(); }
        else audio.deny();
      });
    }
    div.appendChild(info);
    div.appendChild(btn);
    return div;
  }

  function renderPanel() {
    const s = game.getState();
    ui.gup.innerHTML = '';
    for (const key of Object.keys(CONFIG.upgrades)) {
      const u = CONFIG.upgrades[key];
      ui.gup.appendChild(row(
        u.label, u.desc, s.upgrades[key], u.max,
        game.upgradeCost(key), 'coin', () => game.buyUpgrade(key)
      ));
    }
    ui.mup.innerHTML = '';
    const world = game.getWorld();
    const li = s.levelIndex;
    world.machines.forEach((m, i) => {
      ui.mup.appendChild(row(
        m.label, `${m.type} · +20% effect per level`, m.level, CONFIG.machineMaxLevel,
        game.machineUpgradeCost(li, i), 'gem', () => game.buyMachineUpgrade(li, i)
      ));
    });
    ui.pup.innerHTML = '';
    const plvl = s.pusherLevels[li] || 0;
    ui.pup.appendChild(row(
      'Pusher', 'Pushes coins faster · +20% speed per level', plvl, CONFIG.machineMaxLevel,
      game.pusherUpgradeCost(li), 'gem', () => game.buyPusherUpgrade(li)
    ));
    refreshAffordability();
  }

  function refreshAffordability() {
    const s = game.getState();
    ui.gup.querySelectorAll('.up-row').forEach((div, i) => {
      const key = Object.keys(CONFIG.upgrades)[i];
      const cost = game.upgradeCost(key);
      const btn = div.querySelector('.up-btn');
      if (cost !== null) btn.disabled = s.coins < cost;
    });
    const li = s.levelIndex;
    ui.mup.querySelectorAll('.up-row').forEach((div, i) => {
      const cost = game.machineUpgradeCost(li, i);
      const btn = div.querySelector('.up-btn');
      if (cost !== null) btn.disabled = s.gems < cost;
    });
    const pc = game.pusherUpgradeCost(li);
    const pbtn = ui.pup.querySelector('.up-btn');
    if (pc !== null && pbtn) pbtn.disabled = s.gems < pc;
  }

  let lastLevelsCompleted = game.getState().stats.levelsCompleted;
  let hudTimer = 0;
  let saveTimer = 0;
  let last = performance.now();
  let acc = 0;
  const STEP = 1 / 60;

  function updateHud() {
    const s = game.getState();
    const lv = game.currentLevel();
    ui.coins.textContent = fmt(s.coins);
    ui.cash.textContent = fmt(s.cash);
    ui.gems.textContent = fmt(s.gems);
    ui.level.textContent = 'Level ' + (s.levelIndex + 1) + ' / ' + LEVELS.length;
    const pct = Math.min(100, (s.progress / lv.goal) * 100);
    ui.pfill.style.width = pct + '%';
    ui.ptext.textContent = fmt(s.progress) + ' / ' + fmt(lv.goal);
    ui.combo.textContent = s.combo > 1 ? 'combo x' + s.combo : '';
    const max = game.maxCharges();
    if (ui.charges.childElementCount !== max) {
      ui.charges.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const d = document.createElement('div');
        d.className = 'charge';
        ui.charges.appendChild(d);
      }
    }
    [...ui.charges.children].forEach((d, i) => {
      d.classList.toggle('full', i < Math.floor(s.charges));
    });
    if (!ui.panel.classList.contains('hidden')) refreshAffordability();
  }

  function frame(nowMs) {
    const now = nowMs / 1000;
    let dt = (nowMs - last) / 1000;
    last = nowMs;
    dt = Math.min(dt, 0.1);
    acc += dt;
    while (acc >= STEP) {
      const t0 = performance.now() / 1000;
      const { events } = game.tick(STEP, t0);
      for (const e of events) {
        if (e.type === 'collect') {
          const def = CONFIG.coins.find((c) => c.id === e.coin.type);
          if (def && def.gem) {
            addFloater(e.coin.x, e.coin.y + 1, e.coin.z, '+1 gem', '#4ad6ff');
            burst(e.coin.x, e.coin.y, e.coin.z, '#4ad6ff', 10);
            audio.gem();
          } else {
            addFloater(e.coin.x, e.coin.y + 1, e.coin.z, '+' + fmt(def.value * e.coin.mult * game.coinValueMult() * game.comboMult()), '#ffd24a');
            burst(e.coin.x, e.coin.y, e.coin.z, '#ffd24a', 8);
            audio.collect();
          }
          if (e.cash) addFloater(e.coin.x, e.coin.y + 2, e.coin.z, '+$' + e.cash, '#7dcea0');
        } else if (e.type === 'destroy') {
          burst(e.coin.x, e.coin.y, e.coin.z, '#e74c3c', 6);
        }
      }
      if (game.getState().stats.levelsCompleted !== lastLevelsCompleted) {
        lastLevelsCompleted = game.getState().stats.levelsCompleted;
        const r = game.getState().lastLevelReward || { gems: 0, coins: 0 };
        toast(`Level complete! +${fmt(r.coins)} coins +${r.gems} gems`);
        audio.levelUp();
      }
      acc -= STEP;
    }

    for (const f of fx.floaters) f.life -= dt;
    fx.floaters = fx.floaters.filter((f) => f.life > 0);
    for (const p of fx.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vy -= CONFIG.world.gravity * 0.6 * dt;
    }
    fx.particles = fx.particles.filter((p) => p.life > 0);

    view.render(game.getWorld(), fx, now);

    hudTimer -= dt;
    if (hudTimer <= 0) { hudTimer = 0.12; updateHud(); }
    saveTimer += dt;
    if (saveTimer > 5) { saveTimer = 0; game.save(); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('beforeunload', () => game.save());
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.save(); });
})();
