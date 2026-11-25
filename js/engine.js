function makeEngine(cfg) {
  const W = cfg.world;

  function createWorld(levelDef) {
    return {
      time: 0,
      coins: [],
      pusher: { x: W.pusherBaseX, phase: 0, vx: 0 },
      machines: levelDef.machines.map((m, i) => normalizeMachine(m, i)),
      nextCoinId: 1,
    };
  }

  function normalizeMachine(m, i) {
    return {
      idx: i,
      type: m.type,
      label: m.label,
      x: m.x,
      w: m.w || 0,
      speed: m.speed || 0,
      y: m.y || 0,
      r: m.r || 0,
      interval: m.interval || 0,
      hop: m.hop || 0,
      mult: m.mult || 0,
      cash: m.cash || 0,
      outOffset: m.outOffset || 0,
      pull: m.pull || 0,
      attraction: m.attraction || 0,
      sway: m.sway || 0,
      stay: m.stay || 0,
      carry: m.carry || 0,
      on: m.on || 0,
      off: m.off || 0,
      timer: Math.random() * (m.interval || 1),
      phase: Math.random() * Math.PI * 2,
      level: 0,
    };
  }

  function statMult(machine) {
    return 1 + cfg.machineEffectPerLevel * machine.level;
  }

  function machineX(m, time) {
    if (m.type === 'movingMagnet' && m.sway) {
      return m.x + Math.sin(time * (Math.PI / Math.max(0.5, m.stay))) * m.sway;
    }
    return m.x;
  }

  function dropCoin(world, x, coinType) {
    if (world.coins.length >= W.maxCoins) return null;
    const c = {
      id: world.nextCoinId++,
      x: Math.max(W.backX + 3, Math.min(W.edgeX - 4, x)),
      y: 20,
      vx: 0,
      vy: 0,
      r: W.coinRadius,
      type: coinType.id,
      mult: 1,
      passed: {},
      dead: false,
    };
    world.coins.push(c);
    return c;
  }

  function applyMachines(world, dt) {
    const t = world.time;
    for (const m of world.machines) {
      const mx = machineX(m, t);
      const sm = statMult(m);
      switch (m.type) {
        case 'conveyor':
          for (const c of world.coins) {
            if (c.x > mx - m.w / 2 && c.x < mx + m.w / 2 && c.y < 8) {
              c.vx += m.speed * 30 * sm * dt;
            }
          }
          break;
        case 'fan':
          for (const c of world.coins) {
            const dx = c.x - mx, dy = c.y - (m.y || 7);
            const d = Math.hypot(dx, dy);
            if (d < m.r) {
              const f = (1 - d / m.r) * m.speed * 9 * sm;
              c.vy += f * dt;
              c.vx -= dx * 2 * dt;
            }
          }
          break;
        case 'magnet':
        case 'movingMagnet':
        case 'suction':
          for (const c of world.coins) {
            const dx = mx - c.x, dy = (m.y || 4) - c.y;
            const d = Math.hypot(dx, dy) || 0.001;
            const radius = m.type === 'suction' ? (m.r || 8) : m.r;
            if (d < radius) {
              const pull = (m.type === 'suction' ? m.pull : m.speed * 120) * sm;
              c.vx += (dx / d) * pull * dt;
              c.vy += (dy / d) * pull * dt * 0.6;
            }
          }
          break;
        case 'launcher':
          m.timer -= dt;
          if (m.timer <= 0) {
            m.timer = (m.interval || 1.2) / sm;
            let best = null, bd = (m.r || 6);
            for (const c of world.coins) {
              const d = Math.abs(c.x - mx);
              if (d < bd && c.y < 10) { bd = d; best = c; }
            }
            if (best) {
              best.x += (m.hop || 6) * sm;
              best.y = Math.max(best.y, 5);
              best.vy = 12;
              best.vx += 6;
              best.launched = t;
            }
          }
          break;
        case 'portal':
          for (const c of world.coins) {
            if (Math.abs(c.x - mx) < m.w / 2 && c.y < 8 && !c.passed['p' + m.idx]) {
              c.passed['p' + m.idx] = true;
              c.x = Math.min(W.edgeX - 5, mx + m.outOffset);
              c.y = 7;
              c.vx = 4;
              c.vy = 6;
            }
          }
          break;
        case 'gate':
          for (const c of world.coins) {
            if (Math.abs(c.x - mx) < m.w / 2 && c.y < 8 && !c.passed['g' + m.idx]) {
              c.passed['g' + m.idx] = true;
              c.mult *= (m.mult || 2) + 0.5 * m.level;
            }
          }
          break;
        case 'dollarGate':
          for (const c of world.coins) {
            if (Math.abs(c.x - mx) < m.w / 2 && c.y < 8 && !c.passed['d' + m.idx]) {
              c.passed['d' + m.idx] = true;
              c.cash = (c.cash || 0) + (m.cash || 1) * sm;
            }
          }
          break;
        case 'spike':
          for (const c of world.coins) {
            if (Math.abs(c.x - mx) < m.w / 2 && c.y < c.r + 1.2) {
              c.dead = true;
              c.deadCause = 'spike';
            }
          }
          break;
        case 'platform':
          for (const c of world.coins) {
            if (c.x > mx - m.w / 2 && c.x < mx + m.w / 2 && c.y < 8) {
              c.vx += (m.carry || 30) * sm * dt;
            }
          }
          break;
        case 'laser':
          m.timer += dt;
          const cycle = (m.on || 1) + (m.off || 2);
          const on = (m.timer % cycle) < (m.on || 1) / sm;
          m.laserOn = on;
          if (on) {
            for (const c of world.coins) {
              if (Math.abs(c.x - mx) < m.w / 2 + c.r && c.y < 12) {
                c.dead = true;
                c.deadCause = 'laser';
              }
            }
          }
          break;
      }
    }
  }

  function pusherPosition(world, pusherSpeed) {
    const p = world.pusher;
    p.phase += pusherSpeed * 3.0 * (1 / 60);
    const nx = W.pusherBaseX + ((1 - Math.cos(p.phase)) / 2) * W.pusherTravel;
    p.vx = (nx - p.x) * 60;
    p.x = nx;
    return p.x;
  }

  function collide(world, events) {
    const coins = world.coins;
    for (let i = 0; i < coins.length; i++) {
      const a = coins[i];
      if (a.dead) continue;
      if (a.y < W.floorY + a.r && a.x > W.backX && a.x < W.edgeX) {
        if (a.y < W.floorY + a.r) {
          a.y = W.floorY + a.r;
          if (a.vy < 0) a.vy = -a.vy * 0.05;
          a.vx *= 0.92;
        }
      }
      if (a.x - a.r < W.backX) {
        a.x = W.backX + a.r;
        a.vx = Math.abs(a.vx) * 0.1;
      }
      const pf = world.pusher.x + W.pusherThickness;
      if (a.x - a.r < pf && a.x > world.pusher.x && a.y < W.pusherHeight) {
        a.x = pf + a.r;
        if (world.pusher.vx > 0) a.vx = Math.max(a.vx, world.pusher.vx * 0.9);
        else a.vx = Math.max(a.vx, 0.5);
      }
      for (let j = i + 1; j < coins.length; j++) {
        const b = coins[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = a.r + b.r;
        if (d2 < min * min && d2 > 1e-9) {
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          const overlap = (min - d) / 2;
          a.x -= nx * overlap; a.y -= ny * overlap;
          b.x += nx * overlap; b.y += ny * overlap;
          const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
          const vel = rvx * nx + rvy * ny;
          if (vel < 0) {
            const imp = -(1 + 0.05) * vel / 2;
            a.vx -= imp * nx; a.vy -= imp * ny;
            b.vx += imp * nx; b.vy += imp * ny;
            const tx = -ny, ty = nx;
            const vt = rvx * tx + rvy * ty;
            const fr = vt * 0.08;
            a.vx -= fr * tx; a.vy -= fr * ty;
            b.vx += fr * tx; b.vy += fr * ty;
          }
        }
      }
    }
  }

  function step(world, dt, opts) {
    opts = opts || {};
    const events = [];
    const sub = 2;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) {
      world.time += h;
      pusherPosition(world, opts.pusherSpeed || 2);
      applyMachines(world, h);
      for (const c of world.coins) {
        if (c.dead) continue;
        c.vy -= W.gravity * h;
        c.x += c.vx * h;
        c.y += c.vy * h;
        c.vx = Math.max(-60, Math.min(60, c.vx));
        c.vy = Math.max(-60, Math.min(60, c.vy));
        if (!isFinite(c.x) || !isFinite(c.y)) { c.dead = true; c.deadCause = 'nan'; }
      }
      collide(world, events);
    }
    const remaining = [];
    for (const c of world.coins) {
      if (c.dead) {
        events.push({ type: 'destroy', coin: c, cause: c.deadCause });
        continue;
      }
      if (c.x > W.edgeX + c.r * 0.5) {
        events.push({ type: 'collect', coin: c, cash: c.cash || 0 });
        continue;
      }
      if (c.y > W.killY || c.y < -14) {
        events.push({ type: 'lost', coin: c });
        continue;
      }
      remaining.push(c);
    }
    world.coins = remaining;
    return events;
  }

  function shake(world, power) {
    for (const c of world.coins) {
      c.vx += (Math.random() - 0.5) * power;
      c.vy += 6 + Math.random() * power * 0.5;
    }
  }

  return { createWorld, dropCoin, step, shake, machineX, statMult };
}

if (typeof module !== 'undefined' && module.exports) {
  const { CONFIG, LEVELS } = require('./config.js');
  module.exports = { makeEngine, CONFIG, LEVELS };
}
