// Multi-tier coin-machine physics. Tiers, machines, collector, spawn and camera all come
// from the APK-extracted level layouts (parent-resolved world transforms). Coins are flat
// discs: same-layer contacts collide as circles in x-z, stacked coins rest face-to-face in y.
function makeEngine(CONFIG) {
  const W = CONFIG.world;

  function yawDir(yawDeg) {
    const r = (yawDeg * Math.PI) / 180;
    return [Math.sin(r), Math.cos(r)]; // Unity local +z in world x-z
  }

  function inRect(x, z, minX, maxX, minZ, maxZ, m = 0) {
    return x >= minX - m && x <= maxX + m && z >= minZ - m && z <= maxZ + m;
  }

  function wallRect(w) {
    return { minX: w.min[0], maxX: w.max[0], minY: w.min[1], maxY: w.max[1], minZ: w.min[2], maxZ: w.max[2], go: w.go || null };
  }

  // Per-edge top elevation of the static retaining walls lying ALONG each base edge:
  // the wall must be thin on the edge axis (<=1.6, i.e. it runs along the edge, not
  // perpendicular to it), sit within 0.8 of the edge line, and span the other axis.
  // Used by the exit classifier: crossing the base edge BELOW this top means the coin
  // passed through a wall that should have stopped it -> breach.
  function edgeWallTops(walls, bminX, bmaxX, bminZ, bmaxZ) {
    const tops = { minX: -Infinity, maxX: -Infinity, minZ: -Infinity, maxZ: -Infinity };
    const edgeDist = (v0, v1, e) => Math.max(0, e - v1, v0 - e); // 0 if interval covers the edge line
    for (const w of walls) {
      const spansZ = w.minX <= bmaxX + 0.01 && w.maxX >= bminX - 0.01; // crosses the tier's x range
      const spansX = w.minZ <= bmaxZ + 0.01 && w.maxZ >= bminZ - 0.01; // crosses the tier's z range
      if (edgeDist(w.minX, w.maxX, bminX) < 0.8 && w.maxX - w.minX < 1.6 && spansZ) tops.minX = Math.max(tops.minX, w.maxY);
      if (edgeDist(w.minX, w.maxX, bmaxX) < 0.8 && w.maxX - w.minX < 1.6 && spansZ) tops.maxX = Math.max(tops.maxX, w.maxY);
      if (edgeDist(w.minZ, w.maxZ, bminZ) < 0.8 && w.maxZ - w.minZ < 1.6 && spansX) tops.minZ = Math.max(tops.minZ, w.maxY);
      if (edgeDist(w.minZ, w.maxZ, bmaxZ) < 0.8 && w.maxZ - w.minZ < 1.6 && spansX) tops.maxZ = Math.max(tops.maxZ, w.maxY);
    }
    return tops;
  }

  // Was the coin, at the moment it crossed a base edge, blocked by a wall that should
  // have stopped it? A wall counts only if it lies along that edge, is thin on the edge
  // axis, COVERS the crossing point (perpendicular interval expanded by the coin
  // radius contains the crossing coordinate), and the coin's bottom is below its top.
  function edgeWallBreach(t, edge, c) {
    const bot = c.y - c.h / 2;
    const bminX = t.baseMinX, bmaxX = t.baseMaxX, bminZ = t.baseMinZ, bmaxZ = t.baseMaxZ;
    const edgeDist = (v0, v1, e) => Math.max(0, e - v1, v0 - e);
    for (const w of t.walls) {
      let on = false;
      if (edge === 'minX' && edgeDist(w.minX, w.maxX, bminX) < 0.8 && w.maxX - w.minX < 1.6 && c.z >= w.minZ - c.r && c.z <= w.maxZ + c.r) on = true;
      if (edge === 'maxX' && edgeDist(w.minX, w.maxX, bmaxX) < 0.8 && w.maxX - w.minX < 1.6 && c.z >= w.minZ - c.r && c.z <= w.maxZ + c.r) on = true;
      if (edge === 'minZ' && edgeDist(w.minZ, w.maxZ, bminZ) < 0.8 && w.maxZ - w.minZ < 1.6 && c.x >= w.minX - c.r && c.x <= w.maxX + c.r) on = true;
      if (edge === 'maxZ' && edgeDist(w.minZ, w.maxZ, bmaxZ) < 0.8 && w.maxZ - w.minZ < 1.6 && c.x >= w.minX - c.r && c.x <= w.maxX + c.r) on = true;
      if (on && bot < w.maxY - W.snap - 0.01) return w.maxY;
    }
    return null;
  }

  function normalizeTier(t) {
    const f = t.floor;
    const tier = {
      name: t.name,
      minX: f.min[0], maxX: f.max[0], minZ: f.min[2], maxZ: f.max[2],
      floorTop: f.min[1], top: f.min[1], // floorTop = static base collider top; top raised to plate top below
      cx: (f.min[0] + f.max[0]) / 2, cz: (f.min[2] + f.max[2]) / 2,
      visual: t.visual,
      walls: (t.walls || []).map(wallRect), // extracted retaining-wall colliders
      pusher: null,
    };
    // edgeWall computed against the BASE (floor collider) bounds, before the pusher
    // block widens minX..maxZ to the union with the plate-at-rest footprint
    tier.edgeWall = edgeWallTops(tier.walls, tier.minX, tier.maxX, tier.minZ, tier.maxZ);
    const p = t.pusher;
    if (p && p.box) {
      const b = p.box;
      // axis/sign come from the exported controller: PusherInteraction.direction == 2
      // (local +Z) resolved through the Dozer node's full world matrix (gen_layouts.py)
      const axis = p.axis || 'x';
      const sign = (p.sign != null ? p.sign : 1);
      const ax = axis === 'x' ? sign : 0, az = axis === 'z' ? sign : 0;
      // controller origin (inner 'Pusher' node world pos, exported): the prefab pose is
      // the rest pose, so back = origin projected on the sweep axis
      const origin = p.origin || [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
      const back = axis === 'x' ? origin[0] : origin[2];
      // travel: extracted from geometry (plate leading edge at rest -> floor open edge);
      // the plate ends flush with the open edge, so carried coins fall off there
      const travel = Math.max(0.3, p.travel != null ? p.travel : 2);
      tier.pusher = {
        ax, az, axis, sign, back, travel, origin,
        wall: p.wall ? wallRect(p.wall) : null, // moving DozerWall collider
        // the plate collider's own footprint at rest, preserving its offset from the
        // controller origin (the Dozer node is NOT at the inner Pusher node's origin)
        boxRest: { minX: b.min[0], maxX: b.max[0], minZ: b.min[2], maxZ: b.max[2], top: b.max[1] },
        pcx: (b.min[0] + b.max[0]) / 2, pcz: (b.min[2] + b.max[2]) / 2,
        speed: (p.speed != null ? p.speed : 2) * W.scale,
        hold: p.backHoldDuration != null ? p.backHoldDuration : 1,
        w: axis === 'x' ? b.max[2] - b.min[2] : b.max[0] - b.min[0],
        d: axis === 'x' ? b.max[0] - b.min[0] : b.max[2] - b.min[2],
        h: Math.max(0.6, b.max[1] - b.min[1]),
        y: (b.min[1] + b.max[1]) / 2,
        t: 0, pos: back, vel: 0,
        openEdge: sign > 0 ? (axis === 'x' ? 'maxX' : 'maxZ') : (axis === 'x' ? 'minX' : 'minZ'),
      };
      tier.pusher.pos = back;
      // base bounds = the stationary floor collider's footprint (the true platform).
      // minX..maxZ below become the union of base + plate-at-rest and are used ONLY for
      // rendering, machine attachment and drop targeting - NEVER for support or exit
      // tests. Support elevation is NOT the union: coins rest on the moving plate where
      // the plate currently is, and on the static base only where it is exposed
      // (see supportTopAt / supportTierAt) - no artificial permanent surface.
      tier.baseMinX = tier.minX; tier.baseMaxX = tier.maxX; tier.baseMinZ = tier.minZ; tier.baseMaxZ = tier.maxZ;
      tier.minX = Math.min(tier.minX, b.min[0]); tier.maxX = Math.max(tier.maxX, b.max[0]);
      tier.minZ = Math.min(tier.minZ, b.min[2]); tier.maxZ = Math.max(tier.maxZ, b.max[2]);
      tier.cx = (tier.minX + tier.maxX) / 2; tier.cz = (tier.minZ + tier.maxZ) / 2;
      tier.plateTop = b.max[1];
      tier.top = Math.max(tier.top, tier.plateTop);
    }
    return tier;
  }

  function normalizeMachine(m, tiers) {
    // attach to the tier named by the exporter (floor containment); otherwise the tier
    // whose walkable bounds overlap the machine's zone the most; fallback: nearest center
    let best = -1, bd = Infinity, bo = -1, boArea = 0;
    for (let i = 0; i < tiers.length; i++) {
      const t = tiers[i];
      const d = Math.hypot(m.pos[0] - t.cx, m.pos[2] - t.cz);
      if (d < bd) { bd = d; best = i; }
      if (m.box) {
        const ox = Math.min(m.box.max[0], t.maxX) - Math.max(m.box.min[0], t.minX);
        const oz = Math.min(m.box.max[2], t.maxZ) - Math.max(m.box.min[2], t.minZ);
        const area = Math.max(0, ox) * Math.max(0, oz);
        if (area > boArea) { boArea = area; bo = i; }
      }
    }
    if (bo >= 0) best = bo;
    const p = m.params;
    const pad = 0.3;
    const zone = m.box
      ? { minX: m.box.min[0] - pad, maxX: m.box.max[0] + pad, minZ: m.box.min[2] - pad, maxZ: m.box.max[2] + pad }
      : { minX: m.pos[0] - (p.r || 25), maxX: m.pos[0] + (p.r || 25), minZ: m.pos[2] - (p.r || 25), maxZ: m.pos[2] + (p.r || 25) };
    return {
      id: m.id, type: m.type, go: m.go, x: m.pos[0], y: m.pos[1], z: m.pos[2],
      yaw: m.yaw, tierIdx: m.tierName != null ? tiers.findIndex((t) => t.name === m.tierName) : best,
      tierIdxFallback: best, params: p, zone, exit: m.exit || null, visual: m.visual || null,
      t: 0, pulse: 0, on: true, platT: 0, platPos: 0, magPos: 0, level: p.level || 1,
    };
  }

  // circle (coin) vs AABB wall collision in x/z with y-overlap gating; pushes the coin
  // out along the minimum-penetration axis and reflects the RELATIVE normal velocity
  // (wv = wall velocity for kinematic moving colliders such as the DozerWall, so the
  // pusher face imparts its own velocity to the coins it sweeps)
  function collideWall(c, w, wvx = 0, wvz = 0) {
    const bot = c.y - c.h / 2, top = c.y + c.h / 2;
    if (bot >= w.maxY - 0.01 || top <= w.minY + 0.01) return;
    const cx = Math.max(w.minX, Math.min(c.x, w.maxX));
    const cz = Math.max(w.minZ, Math.min(c.z, w.maxZ));
    let dx = c.x - cx, dz = c.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > c.r * c.r) return;
    if (d2 < 1e-9) {
      // center inside the rect: eject along the axis of least penetration
      const px = (Math.min(c.x - w.minX, w.maxX - c.x) + c.r) * 0.7;
      const pz = (Math.min(c.z - w.minZ, w.maxZ - c.z) + c.r) * 0.7;
      if (px < pz) {
        const s = (c.x - (w.minX + w.maxX) / 2) >= 0 ? 1 : -1;
        c.x += s * px;
        const vn = (c.vx - wvx) * s;
        if (vn < 0) c.vx -= (1 + W.wallRestitution) * vn * s;
      } else {
        const s = (c.z - (w.minZ + w.maxZ) / 2) >= 0 ? 1 : -1;
        c.z += s * pz;
        const vn = (c.vz - wvz) * s;
        if (vn < 0) c.vz -= (1 + W.wallRestitution) * vn * s;
      }
      return;
    }
    const d = Math.sqrt(d2);
    // RELAXED projection: a full pushout can fight a neighbouring wall when the gap
    // between two colliders is narrower than the coin diameter (e.g. gate rod vs side
    // wall: 0.770 < 0.868) - full pushes then oscillate between the two faces. A 0.7
    // push per pass converges to the geometric minimum residual instead.
    const push = (c.r - d) * 0.7;
    const nx = dx / d, nz = dz / d;
    c.x += nx * push; c.z += nz * push;
    const vn = (c.vx - wvx) * nx + (c.vz - wvz) * nz;
    if (vn < 0) { c.vx -= (1 + W.wallRestitution) * vn * nx; c.vz -= (1 + W.wallRestitution) * vn * nz; }
  }

  function collideAllWalls(world, c) {
    for (const w of world.walls) collideWall(c, w);
    // moving DozerWall of each pusher: the assembly's wall collider translated by the
    // shared sweep delta, so the pusher stays enclosed through its whole travel; the
    // wall is kinematic - it carries the plate's sweep velocity
    for (const t of world.tiers) {
      const p = t.pusher;
      if (!p || !p.wall) continue;
      const delta = p.pos - p.back;
      const w = p.wall;
      const wvx = p.axis === 'x' ? p.vel : 0, wvz = p.axis === 'z' ? p.vel : 0;
      const wr = p.axis === 'x'
        ? { minX: w.minX + delta, maxX: w.maxX + delta, minY: w.minY, maxY: w.maxY, minZ: w.minZ, maxZ: w.maxZ }
        : { minX: w.minX, maxX: w.maxX, minY: w.minY, maxY: w.maxY, minZ: w.minZ + delta, maxZ: w.maxZ + delta };
      collideWall(c, wr, wvx, wvz);
    }
  }

  function createWorld(level) {
    const tiers = level.tiers.map(normalizeTier);
    const levelWalls = (level.walls || []).map(wallRect);
    const allWalls = [...levelWalls];
    for (const t of tiers) allWalls.push(...t.walls);
    const machines = level.machines.map((m) => normalizeMachine(m, tiers));
    for (const m of machines) if (m.tierIdx < 0) m.tierIdx = m.tierIdxFallback;
    const collector = level.collector && level.collector.box
      ? { minX: level.collector.box.min[0], maxX: level.collector.box.max[0], minY: level.collector.box.min[1], maxY: level.collector.box.max[1], minZ: level.collector.box.min[2], maxZ: level.collector.box.max[2] }
      : null;
    const portals = machines.filter((m) => m.type === 'Portal');
    // walkable machine surfaces (conveyor belts): coins can rest on the extracted visual top
    const surfaces = machines
      .filter((m) => m.type === 'ConveyorBelt' && m.visual)
      .map((m) => ({
        machine: m.id,
        minX: m.visual.min[0], maxX: m.visual.max[0],
        minZ: m.visual.min[2], maxZ: m.visual.max[2],
        top: m.visual.max[1],
      }));
    return {
      level, tiers, machines, portals, collector, surfaces, walls: allWalls,
      spawn: level.spawn,
      coins: [], events: [], time: 0, nextCoinId: 1,
      stats: { exits: {}, breaches: 0, breachLog: [], collected: 0, lost: 0 },
      killY: collector ? collector.minY - W.killMargin : -60,
    };
  }

  function supportSurfaceAt(world, x, z, bottomY) {
    let best = null, bestTop = -Infinity;
    for (const s of world.surfaces) {
      if (inRect(x, z, s.minX, s.maxX, s.minZ, s.maxZ) && s.top <= bottomY + W.snap && s.top > bestTop) {
        bestTop = s.top; best = s;
      }
    }
    return best;
  }

  // The original dispenser chute/slides deliver the coin from the spawn point onto the
  // machine (belts, slides). We emulate the end of that chute: land the drop on the
  // nearest support rect (tier floor or conveyor belt top) to the spawn column.
  function dropTarget(world, sp) {
    const rects = [];
    for (const t of world.tiers) rects.push({ minX: t.minX, maxX: t.maxX, minZ: t.minZ, maxZ: t.maxZ, top: t.top });
    for (const s of world.surfaces) rects.push(s);
    let best = null, bd = 8; // max horizontal miss distance
    for (const r of rects) {
      const cx = Math.max(r.minX, Math.min(sp[0], r.maxX));
      const cz = Math.max(r.minZ, Math.min(sp[2], r.maxZ));
      const d = Math.hypot(cx - sp[0], cz - sp[2]);
      if (d > bd) continue;
      if (!best || d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && r.top > best.top)) {
        best = { ...r, cx, cz };
        bd = d;
      }
    }
    if (best) return { x: best.cx, y: best.top + 2.5, z: best.cz };
    return { x: sp[0], y: sp[1], z: sp[2] };
  }

  function dropCoin(world, typeDef) {
    if (world.coins.length >= W.maxCoins) {
      const old = world.coins.shift();
      world.events.push({ type: 'evict', coin: old });
    }
    const sp = world.spawn.point || world.spawn.pos;
    const tgt = dropTarget(world, sp);
    const c = {
      id: world.nextCoinId++, type: typeDef.id,
      x: tgt.x + (Math.random() - 0.5) * 0.6,
      y: tgt.y + W.coinH / 2,
      z: tgt.z + (Math.random() - 0.5) * 0.6,
      vx: 0, vy: -1, vz: 0,
      r: W.coinR, h: W.coinH, mult: 1,
      falling: true, tier: -1,
      gates: new Set(), portalT: {}, holdT: {},
      rx: 0, rz: 0,
    };
    world.coins.push(c);
    return c;
  }

  function addCoinRaw(world, data) {
    const c = {
      id: data.id, type: data.type, x: data.x, y: data.y, z: data.z,
      vx: data.vx, vy: data.vy, vz: data.vz, r: W.coinR, h: W.coinH,
      mult: data.mult || 1, falling: !!data.falling, tier: data.tier != null ? data.tier : -1, surface: data.surface != null ? data.surface : null,
      gates: new Set(data.gates || []), portalT: data.portalT || {}, holdT: data.holdT || {},
      rx: data.rx || 0, rz: data.rz || 0,
    };
    if (world.nextCoinId <= c.id) world.nextCoinId = c.id + 1;
    world.coins.push(c);
    return c;
  }

  // Support comes from exactly two physical surfaces per tier: the stationary base
  // floor collider (base bounds -> floorTop) and the pusher plate at its CURRENT
  // position (pusherPlateRect -> plateTop). The plate's rest footprint is never a
  // permanent support: when the plate has swept away, the overhang is open and coins
  // there fall (recorded as exits, then lost at killY - not silently supported).
  function supportTierAt(world, x, z, bottomY) {
    let best = -1, bestTop = -Infinity;
    for (let i = 0; i < world.tiers.length; i++) {
      const t = world.tiers[i];
      let top = null;
      if (inRect(x, z, t.baseMinX, t.baseMaxX, t.baseMinZ, t.baseMaxZ)) top = t.floorTop;
      const p = t.pusher;
      if (p && p.boxRest) {
        const pr = pusherPlateRect(t);
        if (inRect(x, z, pr.minX, pr.maxX, pr.minZ, pr.maxZ)) top = Math.max(top != null ? top : -Infinity, pr.top);
      }
      if (top != null && top <= bottomY + W.snap && top > bestTop) { bestTop = top; best = i; }
    }
    return best;
  }

  // Top of any solid collider covering (x,z) at or below the coin's previous bottom:
  // static tier/level walls (a coin can rest on top of a retaining wall) plus each
  // pusher's moving DozerWall translated by the shared sweep delta.
  function wallTopAt(world, x, z, bottomY) {
    let best = -Infinity;
    for (const w of world.walls) {
      if (inRect(x, z, w.minX, w.maxX, w.minZ, w.maxZ) && w.maxY <= bottomY + W.snap && w.maxY > best) best = w.maxY;
    }
    for (const t of world.tiers) {
      const p = t.pusher;
      if (!p || !p.wall) continue;
      const d = p.pos - p.back, w = p.wall;
      const minX = w.minX + (p.axis === 'x' ? d : 0), maxX = w.maxX + (p.axis === 'x' ? d : 0);
      const minZ = w.minZ + (p.axis === 'z' ? d : 0), maxZ = w.maxZ + (p.axis === 'z' ? d : 0);
      if (inRect(x, z, minX, maxX, minZ, maxZ) && w.maxY <= bottomY + W.snap && w.maxY > best) best = w.maxY;
    }
    return best;
  }

  function updatePusher(tier, dt) {
    const p = tier.pusher;
    if (!p) return;
    const fwdTime = p.travel / p.speed;
    const period = 2 * fwdTime + p.hold;
    p.t += dt;
    let ph = p.t % period;
    let pos, vel;
    if (ph < fwdTime) { pos = p.back + p.sign * p.speed * ph; vel = p.sign * p.speed; }
    else if (ph < 2 * fwdTime) { const q = ph - fwdTime; pos = p.back + p.sign * (p.travel - p.speed * q); vel = -p.sign * p.speed; }
    else { pos = p.back; vel = 0; }
    p.pos = pos; p.vel = vel;
  }

  function pusherPlateRect(tier) {
    // the plate's extracted collider footprint translated by the shared sweep delta
    // (p.pos - p.back): preserves the collider's offset from the controller origin
    const p = tier.pusher;
    const delta = p.pos - p.back;
    const b = p.boxRest;
    if (p.axis === 'x') return { minX: b.minX + delta, maxX: b.maxX + delta, minZ: b.minZ, maxZ: b.maxZ, y: p.y, h: p.h, top: b.top };
    return { minX: b.minX, maxX: b.maxX, minZ: b.minZ + delta, maxZ: b.maxZ + delta, y: p.y, h: p.h, top: b.top };
  }

  // support elevation at (x,z) on a tier: the moving plate's top where the plate
  // currently covers the point, else the static base floor's top
  function supportTopAt(tier, x, z) {
    const p = tier.pusher;
    if (p && p.boxRest) {
      const pr = pusherPlateRect(tier);
      if (x >= pr.minX && x <= pr.maxX && z >= pr.minZ && z <= pr.maxZ) return pr.top;
    }
    return tier.floorTop;
  }

  function applyMachine(world, m, dt) {
    const p = m.params;
    const tier = world.tiers[m.tierIdx];
    const tierTop = tier ? tier.top : m.y;
    const dir = yawDir(m.yaw);
    const zone = m.zone;
    for (const c of world.coins) {
      if (c.y < m.y - 5 || c.y > m.y + 8) continue; // machines act near their own elevation (incl. coins falling past edge-mounted ones)
      if (!inRect(c.x, c.z, zone.minX, zone.maxX, zone.minZ, zone.maxZ)) continue;
      switch (m.type) {
        case 'ConveyorBelt': {
          const belt = p.speed;
          const cur = c.vx * dir[0] + c.vz * dir[1];
          const nv = cur + (belt - cur) * Math.min(1, 8 * dt);
          c.vx += dir[0] * (nv - cur); c.vz += dir[1] * (nv - cur);
          break;
        }
        case 'Fan': {
          c.vy += p.speed * 3 * dt;
          c.vx += dir[0] * p.speed * (p.pushMultiplier || 3) * 0.3 * dt;
          c.vz += dir[1] * p.speed * (p.pushMultiplier || 3) * 0.3 * dt;
          c.falling = true;
          break;
        }
        case 'Magnet':
        case 'MovingMagnet': {
          let mx = m.x, mz = m.z;
          if (m.type === 'MovingMagnet') {
            const span = Math.max(2, Math.abs(zone.maxX - zone.minX), Math.abs(zone.maxZ - zone.minZ)) * 0.5;
            const cyc = (p.stayDuration || 1.5) + (p.travelDuration || 4);
            const ph = m.t % (2 * cyc);
            const k = ph < p.stayDuration ? 0 : ph < p.stayDuration + p.travelDuration ? (ph - p.stayDuration) / p.travelDuration : ph < 2 * p.stayDuration + p.travelDuration ? 1 : 1 - (ph - 2 * p.stayDuration - p.travelDuration) / p.travelDuration;
            mx = m.x - dir[0] * span + dir[0] * 2 * span * k;
            mz = m.z - dir[1] * span + dir[1] * 2 * span * k;
            m.magX = mx; m.magZ = mz;
          }
          const dx = mx - c.x, dz = mz - c.z;
          const d = Math.hypot(dx, dz) || 1e-6;
          const acc = (p.attractMultiplier || 30) * (p.speed != null ? 1 : 1) * 10;
          if (d < 1.6) {
            const ht = (c.holdT[m.id] || 0) + dt;
            c.holdT[m.id] = ht;
            if (ht <= (p.attractionDuration || 2)) {
              c.vx = c.vx * 0.7 + (dx / d) * 6 * dt * 10;
              c.vz = c.vz * 0.7 + (dz / d) * 6 * dt * 10;
              c.vy = Math.max(c.vy, 0) * 0.7;
            }
          } else {
            c.vx += (dx / d) * acc * dt;
            c.vz += (dz / d) * acc * dt;
          }
          break;
        }
        case 'TeslaCoil': break; // pulses handled in step() via m.firing
        case 'Portal': {
          const ex = m.exit;
          if (!ex) break;
          const pt = (c.portalT[m.id] || 0) + dt;
          c.portalT[m.id] = pt;
          const dx = m.x - c.x, dz = m.z - c.z, d = Math.hypot(dx, dz) || 1e-6;
          c.vx += (dx / d) * 300 * dt; c.vz += (dz / d) * 300 * dt;
          c.vy *= Math.max(0, 1 - 6 * dt); // the portal sucks coins in against gravity
          if (pt >= (p.pullDuration || 0.4)) {
            const pd = yawDir(ex.yaw);
            c.x = ex.pos[0] + pd[0] * 1.2; c.z = ex.pos[2] + pd[1] * 1.2;
            c.vx = pd[0] * 4; c.vz = pd[1] * 4;
            c.portalT[m.id] = 0; c.falling = true; c.tier = -1;
            world.events.push({ type: 'portal', coin: c, from: m.id });
          }
          break;
        }
        case 'MultiplyingGate': {
          if (!c.gates.has(m.id)) {
            c.gates.add(m.id);
            c.mult *= p.multiplier || 2;
            world.events.push({ type: 'gate', coin: c, machine: m.id, mult: c.mult });
          }
          break;
        }
        case 'DollarGate': {
          if (!c.gates.has(m.id)) {
            c.gates.add(m.id);
            world.events.push({ type: 'dollar', coin: c, machine: m.id, amount: p.cashAmount || 1, addToProgression: !!p.addToProgression });
          }
          break;
        }
        case 'Spike': {
          c.vx = -dir[0] * 25; c.vz = -dir[1] * 25; c.vy = Math.max(c.vy, 8);
          c.falling = true;
          break;
        }
        case 'MovingPlatform': {
          // platform rect rides on this machine's zone, ferrying coins along dir
          const span = Math.max(3, Math.abs(zone.maxX - zone.minX) * 0.5, Math.abs(zone.maxZ - zone.minZ) * 0.5);
          const stay = p.stayDuration || 5, trav = p.travelDuration || 4;
          const cyc = 2 * (stay + trav);
          const ph = m.platT % cyc;
          let k;
          if (ph < stay) k = 0;
          else if (ph < stay + trav) k = (ph - stay) / trav;
          else if (ph < 2 * stay + trav) k = 1;
          else k = 1 - (ph - 2 * stay - trav) / trav;
          const off = (k - 0.5) * 2 * span;
          m.platOff = off;
          const pminX = zone.minX + dir[0] * off, pmaxX = zone.maxX + dir[0] * off;
          const pminZ = zone.minZ + dir[1] * off, pmaxZ = zone.maxZ + dir[1] * off;
          if (inRect(c.x, c.z, Math.min(pminX, pmaxX), Math.max(pminX, pmaxX), Math.min(pminZ, pmaxZ), Math.max(pminZ, pmaxZ))) {
            const pv = m.platVel || 0;
            c.x += dir[0] * pv * dt; c.z += dir[1] * pv * dt;
            c.vx = dir[0] * pv; c.vz = dir[1] * pv;
          }
          break;
        }
        case 'Laser': {
          if (m.on) {
            const len = p.maxLength || 4.5;
            const n = p.emitterCount || 5;
            const spacing = p.emitterSpacing || 1.15;
            for (let e = 0; e < n; e++) {
              const off = (e - (n - 1) / 2) * spacing;
              const bx = m.x + dir[0] * len / 2 - dir[1] * off;
              const bz = m.z + dir[1] * len / 2 + dir[0] * off;
              if (Math.abs((c.x - m.x) * dir[1] - (c.z - m.z) * dir[0] - off) < 0.5 &&
                  ((c.x - m.x) * dir[0] + (c.z - m.z) * dir[1]) > -0.5 &&
                  ((c.x - m.x) * dir[0] + (c.z - m.z) * dir[1]) < len) {
                c.vx += dir[0] * 60 * dt; c.vz += dir[1] * 60 * dt;
              }
            }
          }
          break;
        }
      }
    }
  }

  function updateMachineTimers(world, dt) {
    for (const m of world.machines) {
      m.t += dt;
      const p = m.params;
      if (m.type === 'TeslaCoil') {
        const first = p.firstPulseDelay || 1, interval = p.interval || 1.2;
        const k = m.t >= first ? Math.floor((m.t - first) / interval) : -1;
        m.firing = k > (m.lastK != null ? m.lastK : -1);
        if (m.firing) m.lastK = k;
      }
      if (m.type === 'Laser') {
        const on = p.onDuration || 6, off = p.offDuration || 3;
        const ph = m.t % (on + off);
        m.on = ph < on;
      }
      if (m.type === 'MovingPlatform') {
        m.platT += dt;
        const stay = p.stayDuration || 5, trav = p.travelDuration || 4;
        const cyc = 2 * (stay + trav);
        const ph = m.platT % cyc;
        let k;
        if (ph < stay) k = 0;
        else if (ph < stay + trav) k = (ph - stay) / trav;
        else if (ph < 2 * stay + trav) k = 1;
        else k = 1 - (ph - 2 * stay - trav) / trav;
        const span = Math.max(3, Math.abs(m.zone.maxX - m.zone.minX) * 0.5, Math.abs(m.zone.maxZ - m.zone.minZ) * 0.5);
        const prev = m.platK != null ? m.platK : 0;
        m.platVel = ((k - prev) * 2 * span) / Math.max(dt, 1e-6);
        m.platK = k;
      }
    }
  }

  function step(world, dt) {
    const sub = W.substeps;
    for (let s = 0; s < sub; s++) {
      const h = dt / sub;
      world.time += h;
      for (const t of world.tiers) updatePusher(t, h);
      updateMachineTimers(world, h);
      for (const m of world.machines) {
        if (m.type === 'TeslaCoil' && m.firing) {
          m.firing = false;
          const p = m.params, tier = world.tiers[m.tierIdx], dir = yawDir(m.yaw);
          for (const c of world.coins) {
            if (!inRect(c.x, c.z, m.zone.minX, m.zone.maxX, m.zone.minZ, m.zone.maxZ)) continue;
            if (c.y > (tier ? tier.top : m.y) + 2.5) continue;
            const hop = p.maxHopDistance;
            const vh = Math.sqrt(hop * W.gravity);
            const vy = Math.sqrt(2 * W.gravity * hop * (p.liftRatio || 0.15));
            c.vx = dir[0] * vh; c.vz = dir[1] * vh; c.vy = Math.max(c.vy, vy);
            c.falling = true; c.tier = -1;
          }
        } else applyMachine(world, m, h);
      }
      // integrate
      for (const c of world.coins) {
        c.py = c.y;
        c.vy -= W.gravity * h;
        const sp = Math.hypot(c.vx, c.vy, c.vz);
        if (sp > W.maxSpeed) { const k = W.maxSpeed / sp; c.vx *= k; c.vy *= k; c.vz *= k; }
        c.x += c.vx * h; c.y += c.vy * h; c.z += c.vz * h;
        c.rx += c.vz * h / c.r; c.rz -= c.vx * h / c.r;
      }
      // pusher plates drag coins on their tier by FRICTION (velocity coupling, not a
      // rigid glue - a glued coin would oscillate with the plate and never ratchet to
      // the open edge); the leading face is a hard contact that clamps the coin
      for (let ti = 0; ti < world.tiers.length; ti++) {
        const t = world.tiers[ti];
        if (!t.pusher) continue;
        const pr = pusherPlateRect(t);
        const p = t.pusher;
        const k = Math.min(1, 6 * h);
        for (const c of world.coins) {
          if (c.tier !== ti || c.falling) continue; // only coins resting on this tier
          if (c.y > t.top + 3) continue;
          if (inRect(c.x, c.z, pr.minX, pr.maxX, pr.minZ, pr.maxZ, c.r)) {
            if (p.axis === 'x') {
              c.vx += (p.vel - c.vx) * k;
              if (p.sign > 0 && c.x + c.r > pr.maxX) c.x = pr.maxX + c.r;
              if (p.sign < 0 && c.x - c.r < pr.minX) c.x = pr.minX - c.r;
            } else {
              c.vz += (p.vel - c.vz) * k;
              if (p.sign > 0 && c.z + c.r > pr.maxZ) c.z = pr.maxZ + c.r;
              if (p.sign < 0 && c.z - c.r < pr.minZ) c.z = pr.minZ - c.r;
            }
            c.falling = false;
          }
        }
      }
      // support + landing (use previous bottom so fast falls can't tunnel). Support
      // surfaces: tier base floor, the pusher plate at its CURRENT position, retaining
      // wall tops (static + moving DozerWall), and conveyor-belt tops - the highest
      // surface at or below the coin's previous bottom wins.
      for (const c of world.coins) {
        const bottom = c.y - c.h / 2;
        const prevBottom = (c.py != null ? c.py : c.y) - c.h / 2;
        const probeY = Math.max(bottom, prevBottom);
        const ti = supportTierAt(world, c.x, c.z, probeY);
        let top = -Infinity, supTier = -1, supSurface = null;
        if (ti >= 0) { top = supportTopAt(world.tiers[ti], c.x, c.z); supTier = ti; }
        const wt = wallTopAt(world, c.x, c.z, probeY);
        if (wt > top) { top = wt; supTier = ti; supSurface = null; }
        const s = supportSurfaceAt(world, c.x, c.z, probeY);
        if (s && s.top > top) { top = s.top; supTier = -1; supSurface = s.machine; }
        if (top > -Infinity) {
          c.tier = supTier;
          c.surface = supSurface;
          // resting on another coin (stacked) takes precedence over the floor
          let onCoin = null;
          for (const o of world.coins) {
            if (o === c || o.y >= c.y) continue;
            if (Math.hypot(o.x - c.x, o.z - c.z) < 0.9 * c.r && c.y - o.y < 1.8 * c.h) { onCoin = o; break; }
          }
          if (onCoin && c.vy <= 0 && prevBottom >= onCoin.y + c.h - W.snap) {
            c.y = onCoin.y + c.h;
            if (c.vy < 0) c.vy = 0;
            c.falling = false; c.tier = onCoin.tier;
            // stacked coins rub against each other: friction couples horizontal velocity
            // so a pile is pushed as a pile, not a frictionless tower
            const kf = Math.min(1, 10 * h);
            c.vx += (onCoin.vx - c.vx) * kf;
            c.vz += (onCoin.vz - c.vz) * kf;
          } else if (c.vy <= 0 && prevBottom >= top - W.snap && bottom <= top + W.snap) {
            c.y = top + c.h / 2;
            if (c.vy < 0) c.vy = 0;
            c.falling = false;
            c.vx *= W.floorDamping; c.vz *= W.floorDamping;
          } else if (bottom < top - W.snap) {
            c.falling = true;
          }
        } else {
          c.tier = -1;
          c.surface = null;
          c.falling = true;
        }
      }
      // unified contact resolution: coin-coin pairs AND all wall colliders (static tier/
      // level walls + moving DozerWall) are resolved together inside the same passes, so
      // neither constraint can finally violate the other (previously wall-after-pair or
      // pair-after-wall each left the other violated)
      for (let pass = 0; pass < W.pairPasses; pass++) {
        const cs = world.coins;
        for (let i = 0; i < cs.length; i++) {
          for (let j = i + 1; j < cs.length; j++) {
            const a = cs[i], b = cs[j];
            const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
            const rr = a.r + b.r;
            if (Math.abs(dy) < 0.7 * W.coinH) {
              const d = Math.hypot(dx, dz);
              if (d < rr) {
                // exactly coincident coins (d ~ 0): separate along an arbitrary axis
                const nx = d > 1e-9 ? dx / d : 1, nz = d > 1e-9 ? dz / d : 0;
                const pen = rr - d;
                a.x -= nx * pen / 2; a.z -= nz * pen / 2;
                b.x += nx * pen / 2; b.z += nz * pen / 2;
                const rvx = b.vx - a.vx, rvz = b.vz - a.vz;
                const vn = rvx * nx + rvz * nz;
                if (vn < 0) {
                  const imp = -vn * 0.5;
                  a.vx -= nx * imp; a.vz -= nz * imp;
                  b.vx += nx * imp; b.vz += nz * imp;
                  const tx = -nz, tz = nx;
                  const vt = rvx * tx + rvz * tz;
                  const fr = vt * 0.08;
                  a.vx += fr * tx; a.vz += fr * tz;
                  b.vx -= fr * tx; b.vz -= fr * tz;
                }
              }
            } else if (Math.abs(dy) < 1.8 * W.coinH) {
              const d = Math.hypot(dx, dz);
              if (d < rr * 0.9) {
                if (dy > 0) { b.y = a.y + W.coinH; if (b.vy < 0) b.vy = 0; b.tier = a.tier; b.falling = false; }
                else { a.y = b.y + W.coinH; if (a.vy < 0) a.vy = 0; a.tier = b.tier; a.falling = false; }
              }
            }
          }
        }
        for (const c of cs) collideAllWalls(world, c);
      }
      // trajectory tracking: record which edge of each tier's BASE footprint every coin
      // exits through. Exit via the pusher's open edge = the designed flow. Exit via a
      // side that has a static retaining wall and the coin's bottom is BELOW that wall's
      // top at the crossing = a wall breach. Exit via an unwalled side (the back
      // overhang behind the moving DozerWall) or over a wall top = a fall; the coin is
      // then honestly counted 'lost' when it reaches killY.
      for (const c of world.coins) {
        if (c.tier >= 0) { c._ptier = c.tier; c._exitRecorded = false; }
        else if (c._ptier != null && !c._exitRecorded) {
          const t = world.tiers[c._ptier];
          let edge = null;
          if (c.x < t.baseMinX) edge = 'minX'; else if (c.x > t.baseMaxX) edge = 'maxX';
          else if (c.z < t.baseMinZ) edge = 'minZ'; else if (c.z > t.baseMaxZ) edge = 'maxZ';
          if (edge) {
            c._exitRecorded = true;
            world.stats.exits[edge] = (world.stats.exits[edge] || 0) + 1;
            const open = t.pusher ? t.pusher.openEdge : null;
            if (edge !== open) {
              const wallTop = edgeWallBreach(t, edge, c);
              if (wallTop != null) {
                world.stats.breaches++;
                if (world.stats.breachLog.length < 20) world.stats.breachLog.push({ coin: c.id, tier: t.name, edge, x: +c.x.toFixed(2), y: +c.y.toFixed(2), z: +c.z.toFixed(2), wallTop: +wallTop.toFixed(2) });
              }
            }
          }
        }
      }
      // collector + kill: coins falling out of the machine are LOST, not collected
      for (let i = world.coins.length - 1; i >= 0; i--) {
        const c = world.coins[i];
        const col = world.collector;
        if (col && c.x > col.minX && c.x < col.maxX && c.z > col.minZ && c.z < col.maxZ && c.y > col.minY - 2 && c.y < col.maxY + 4) {
          world.coins.splice(i, 1);
          world.stats.collected++;
          world.events.push({ type: 'collect', coin: c });
        } else if (c.y < world.killY) {
          world.coins.splice(i, 1);
          world.stats.lost++;
          world.events.push({ type: 'lost', coin: c });
        }
      }
    }
  }

  function serialize(world) {
    return {
      time: world.time,
      nextCoinId: world.nextCoinId,
      coins: world.coins.map((c) => ({
        id: c.id, type: c.type, x: c.x, y: c.y, z: c.z, vx: c.vx, vy: c.vy, vz: c.vz,
        mult: c.mult, falling: c.falling, tier: c.tier, surface: c.surface != null ? c.surface : null, gates: [...c.gates], portalT: c.portalT, holdT: c.holdT,
        rx: c.rx, rz: c.rz,
      })),
      pushers: world.tiers.map((t) => (t.pusher ? { t: t.pusher.t, pos: t.pusher.pos } : null)),
      machines: world.machines.map((m) => ({ id: m.id, t: m.t, platT: m.platT, platK: m.platK, lastK: m.lastK, on: m.on })),
    };
  }

  function restore(world, data) {
    world.time = data.time || 0;
    world.nextCoinId = data.nextCoinId || 1;
    world.coins = [];
    for (const cd of data.coins || []) addCoinRaw(world, cd);
    (data.pushers || []).forEach((pd, i) => {
      const t = world.tiers[i];
      if (t && t.pusher && pd) { t.pusher.t = pd.t; t.pusher.pos = pd.pos; }
    });
    (data.machines || []).forEach((md) => {
      const m = world.machines.find((x) => x.id === md.id);
      if (m) { m.t = md.t || 0; m.platT = md.platT || 0; m.platK = md.platK; m.lastK = md.lastK; m.on = md.on !== false; }
    });
  }

  return { createWorld, dropCoin, addCoinRaw, step, serialize, restore, pusherPlateRect, supportTierAt, supportTopAt, supportSurfaceAt, wallTopAt, yawDir };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeEngine };
