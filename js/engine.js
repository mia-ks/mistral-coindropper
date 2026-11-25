function makeEngine(cfg) {
  const W = cfg.world;

  function createWorld(levelDef) {
    return {
      time: 0,
      coins: [],
      pusher: { z: W.pusherBaseZ, phase: 0, vz: 0, level: 0 },
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
      z: m.z,
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
      laserOn: false,
      level: 0,
    };
  }

  function statMult(m) {
    return 1 + cfg.machineEffectPerLevel * m.level;
  }

  function machineX(m, time) {
    if (m.type === 'movingMagnet' && m.sway) {
      return m.x + Math.sin(time * (Math.PI / Math.max(0.5, m.stay))) * m.sway;
    }
    return m.x;
  }

  function dropCoin(world, x, z, coinType) {
    if (world.coins.length >= W.maxCoins) return null;
    const c = {
      id: world.nextCoinId++,
      x: Math.max(-W.halfX + 1, Math.min(W.halfX - 1, x)),
      y: W.spawnY,
      z: Math.max(W.backZ + 2, Math.min(W.edgeZ - 2, z)),
      vx: 0,
      vy: 0,
      vz: 0,
      r: W.coinR,
      type: coinType.id,
      mult: 1,
      passed: {},
      dead: false,
    };
    world.coins.push(c);
    return c;
  }

  function inZoneX(c, m, halfWidth) {
    return Math.abs(c.x - m.x) < halfWidth;
  }

  function applyMachines(world, dt) {
    const t = world.time;
    for (const m of world.machines) {
      const mx = machineX(m, t);
      const sm = statMult(m);
      switch (m.type) {
        case 'conveyor':
          for (const c of world.coins) {
            if (Math.abs(c.z - m.z) < m.w / 2 && c.y < 4 && Math.abs(c.x - mx) < W.halfX) {
              c.vz += m.speed * 30 * sm * dt;
            }
          }
          break;
        case 'fan':
          for (const c of world.coins) {
            const dx = c.x - mx, dz = c.z - m.z;
            const d = Math.hypot(dx, dz);
            if (d < m.r && c.y < 7) {
              const f = (1 - d / m.r) * m.speed * 3 * sm;
              c.vy += f * dt;
              c.vx -= dx * 1.5 * dt;
              c.vz -= dz * 1.5 * dt;
            }
          }
          break;
        case 'magnet':
        case 'movingMagnet':
        case 'suction':
          for (const c of world.coins) {
            const dx = mx - c.x, dy = (m.y || 1.6) - c.y, dz = m.z - c.z;
            const d = Math.hypot(dx, dy, dz) || 0.001;
            if (d < m.r) {
              const pull = (m.type === 'suction' ? (m.speed || 2) * 60 : m.speed * 60) * sm;
              c.vx += (dx / d) * pull * dt;
              c.vy += (dy / d) * pull * dt * 0.7;
              c.vz += (dz / d) * pull * dt;
            }
          }
          break;
        case 'launcher':
          m.timer -= dt;
          if (m.timer <= 0) {
            m.timer = (m.interval || 1.2) / sm;
            let best = null, bd = m.r;
            for (const c of world.coins) {
              const d = Math.hypot(c.x - mx, c.z - m.z);
              if (d < bd && c.y < 5) { bd = d; best = c; }
            }
            if (best) {
              best.z += (m.hop || 2.2) * sm;
              best.y = Math.max(best.y, 2.5);
              best.vy = 5;
              best.vz += 3;
              best.launched = t;
            }
          }
          break;
        case 'portal':
          for (const c of world.coins) {
            if (Math.abs(c.z - m.z) < m.w / 2 && inZoneX(c, { x: mx }, 1.5) && c.y < 4 && !c.passed['p' + m.idx]) {
              c.passed['p' + m.idx] = true;
              c.z = Math.min(W.edgeZ - 2, m.z + m.outOffset);
              c.y = 3.5;
              c.vy = 3;
              c.vz = 2;
            }
          }
          break;
        case 'gate':
          for (const c of world.coins) {
            if (Math.abs(c.z - m.z) < 0.6 && inZoneX(c, { x: mx }, 2) && c.y < 4 && !c.passed['g' + m.idx]) {
              c.passed['g' + m.idx] = true;
              c.mult *= (m.mult || 2) + 0.5 * m.level;
            }
          }
          break;
        case 'dollarGate':
          for (const c of world.coins) {
            if (Math.abs(c.z - m.z) < 0.6 && inZoneX(c, { x: mx }, 2) && c.y < 4 && !c.passed['d' + m.idx]) {
              c.passed['d' + m.idx] = true;
              c.cash = (c.cash || 0) + (m.cash || 1) * sm;
            }
          }
          break;
        case 'spike':
          for (const c of world.coins) {
            if (Math.abs(c.x - mx) < m.w / 2 && Math.abs(c.z - m.z) < m.w / 2 && c.y < W.coinH + 0.5) {
              c.dead = true;
              c.deadCause = 'spike';
            }
          }
          break;
        case 'platform':
          for (const c of world.coins) {
            if (Math.abs(c.z - m.z) < m.w / 2 && c.y < 4 && Math.abs(c.x - mx) < W.halfX) {
              c.vz += (m.carry || 10) * sm * dt;
            }
          }
          break;
        case 'laser':
          m.timer += dt;
          const cycle = (m.on || 1) + (m.off || 2);
          m.laserOn = (m.timer % cycle) < (m.on || 1) / sm;
          if (m.laserOn) {
            for (const c of world.coins) {
              if (Math.abs(c.z - m.z) < m.w / 2 + c.r && Math.abs(c.x - mx) < 2.5 && c.y < 5) {
                c.dead = true;
                c.deadCause = 'laser';
              }
            }
          }
          break;
      }
    }
  }

  function pusherStep(world, speed, dt) {
    const p = world.pusher;
    p.phase += speed * 3.0 * dt;
    const nz = W.pusherBaseZ + ((1 - Math.cos(p.phase)) / 2) * W.pusherTravel;
    p.vz = (nz - p.z) / Math.max(dt, 1e-6);
    p.z = nz;
  }

  function collide(world) {
    const coins = world.coins;
    const pf = world.pusher.z + W.pusherThick;
    const R = W.coinR, H = W.coinH;
    for (const a of coins) {
      if (a.dead) continue;
      const onPlatform = Math.abs(a.x) < W.halfX && a.z > W.backZ && a.z < W.edgeZ;
      if (onPlatform && a.y - H < W.floorY) {
        a.y = W.floorY + H;
        if (a.vy < 0) a.vy = -a.vy * 0.05;
        a.vx *= 0.995;
        a.vz *= 0.995;
      }
      if (a.z - R < W.backZ) {
        a.z = W.backZ + R;
        a.vz = Math.abs(a.vz) * 0.1;
      }
      if (Math.abs(a.x) + R > W.halfX) {
        a.x = Math.sign(a.x) * (W.halfX - R);
        a.vx = -a.vx * 0.1;
      }
      if (a.z - R < pf && a.z > world.pusher.z && a.y < W.pusherH && Math.abs(a.x) < W.halfX) {
        a.z = pf + R;
        a.vz = Math.max(a.vz, world.pusher.vz > 0 ? world.pusher.vz * 0.9 : 0.3);
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < coins.length; i++) {
        const a = coins[i];
        if (a.dead) continue;
        for (let j = i + 1; j < coins.length; j++) {
          const b = coins[j];
          if (b.dead) continue;
          const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
          const dXZ = Math.hypot(dx, dz);
          if (dXZ >= 2 * R) continue;
          const ady = Math.abs(dy);
          if (ady < 2 * H && dXZ < 1e-4) {
            if (dy >= 0) { if (b.y < a.y + 2 * H) b.y = a.y + 2 * H; }
            else { if (a.y < b.y + 2 * H) a.y = b.y + 2 * H; }
            const rvy = b.vy - a.vy;
            if (dy >= 0 && rvy < 0) { const imp = -rvy / 2; a.vy -= imp; b.vy += imp; }
            if (dy < 0 && rvy > 0) { const imp = rvy / 2; a.vy -= imp; b.vy += imp; }
          } else if (ady < 2 * H) {
            const d = dXZ || 1e-6;
            const nx = dx / d, nz = dz / d;
            const overlap = (2 * R - dXZ) / 2;
            a.x -= nx * overlap; a.z -= nz * overlap;
            b.x += nx * overlap; b.z += nz * overlap;
            const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
            const vel = rvx * nx + rvz * nz;
            if (vel < 0) {
              const imp = -(1 + 0.05) * vel / 2;
              a.vx -= imp * nx; a.vz -= imp * nz;
              b.vx += imp * nx; b.vz += imp * nz;
              const tx = -nz, tz = nx;
              const vt = rvx * tx + rvz * tz;
              const fr = vt * 0.06;
              a.vx -= fr * tx; a.vz -= fr * tz;
              b.vx += fr * tx; b.vz += fr * tz;
            }
          } else if (ady < 2 * R) {
            if (dy >= 0) { if (b.y < a.y + 2 * H) b.y = a.y + 2 * H; }
            else { if (a.y < b.y + 2 * H) a.y = b.y + 2 * H; }
            const rvy = b.vy - a.vy;
            if (dy >= 0 && rvy < 0) { const imp = -rvy / 2; a.vy -= imp; b.vy += imp; }
            if (dy < 0 && rvy > 0) { const imp = rvy / 2; a.vy -= imp; b.vy += imp; }
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
      pusherStep(world, opts.pusherSpeed != null ? opts.pusherSpeed : 2, h);
      applyMachines(world, h);
      for (const c of world.coins) {
        if (c.dead) continue;
        c.vy -= W.gravity * h;
        c.x += c.vx * h;
        c.y += c.vy * h;
        c.z += c.vz * h;
        const lim = 30;
        c.vx = Math.max(-lim, Math.min(lim, c.vx));
        c.vy = Math.max(-lim, Math.min(lim, c.vy));
        c.vz = Math.max(-lim, Math.min(lim, c.vz));
        if (!isFinite(c.x) || !isFinite(c.y) || !isFinite(c.z)) { c.dead = true; c.deadCause = 'nan'; }
      }
      collide(world);
    }
    const remaining = [];
    for (const c of world.coins) {
      if (c.dead) {
        events.push({ type: 'destroy', coin: c, cause: c.deadCause });
        continue;
      }
      if (c.z > W.edgeZ + c.r * 0.5) {
        events.push({ type: 'collect', coin: c, cash: c.cash || 0 });
        continue;
      }
      if (c.y > W.killY || c.y < -4) {
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
      c.vz += (Math.random() - 0.5) * power;
      c.vy += 4 + Math.random() * power * 0.4;
    }
  }

  return { createWorld, dropCoin, step, shake, machineX, statMult };
}

if (typeof module !== 'undefined' && module.exports) {
  const { CONFIG, LEVELS } = require('./config.js');
  module.exports = { makeEngine, CONFIG, LEVELS };
}
