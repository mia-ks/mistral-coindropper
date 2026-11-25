// Three.js renderer for the extracted multi-tier machine. Camera rig per level comes from
// the APK's LevelCameraBounds (position = zoomIn marker, perspective fov, euler rotation).
function makeRenderer(CONFIG, LEVELS, THREE) {
  const W = CONFIG.world;

  const COLORS = {
    platform: 0xf2f5ff, platformSide: 0xd9e0f2, lip: 0x9fe870,
    pusher: 0x2f7bff, pusherWall: 0x2f7bff,
    collector: 0x39d353, dispenser: 0xff8a3c,
    conveyor: 0x3a3f4a, roller: 0xffd24a, fan: 0x19c3d4, magnet: 0xe0483e,
    tesla: 0x9b59f6, portal: 0x35e0ff, gate: 0xffc93c, dollar: 0x7dcea0,
    spike: 0xb8c0cc, mover: 0xff8a3c, laser: 0xff3c3c, wall: 0xc7d2ea,
  };

  function std(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.25, ...opts });
  }
  function box(w, h, d, mat) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); }
  function cyl(rt, rb, h, mat, seg = 20) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat); }

  function coinTexture(symbol, color) {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#' + color.toString(16).padStart(6, '0');
    g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.font = 'bold 72px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(symbol, 64, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function coinMesh(def) {
    const g = new THREE.Group();
    const rim = cyl(W.coinR + 0.04, W.coinR + 0.04, W.coinH, std(def.rim, { metalness: 0.7, roughness: 0.3 }));
    g.add(rim);
    const faceMat = std(def.color, { metalness: 0.75, roughness: 0.25 });
    const tex = coinTexture(def.symbol, def.color);
    if (tex) faceMat.map = tex;
    const face = cyl(W.coinR, W.coinR, W.coinH + 0.02, faceMat);
    g.add(face);
    return g;
  }

  function buildMachineMesh(m) {
    const g = new THREE.Group();
    const p = m.params;
    const tier = m.tierRef;
    const baseY = tier ? tier.top : m.y;
    g.position.set(m.x, baseY, m.z);
    g.rotation.y = (m.yaw * Math.PI) / 180;
    const zw = Math.max(1, m.zone.maxX - m.zone.minX);
    const zd = Math.max(1, m.zone.maxZ - m.zone.minZ);
    switch (m.type) {
      case 'ConveyorBelt': {
        const len = Math.max(zw, zd);
        const belt = box(len, 0.5, Math.min(zw, zd) > 2 ? 2.2 : len * 0.6, std(COLORS.conveyor));
        belt.position.y = 0.25;
        g.add(belt);
        for (let i = -2; i <= 2; i++) {
          const r = cyl(0.22, 0.22, Math.min(zw, zd) > 2 ? 2.0 : len * 0.55, std(COLORS.roller));
          r.rotation.x = Math.PI / 2;
          r.position.set((i * len) / 5, 0.55, 0);
          r.name = 'roller';
          g.add(r);
        }
        break;
      }
      case 'Fan': {
        const pole = cyl(0.18, 0.24, 1.6, std(COLORS.wall)); pole.position.y = 0.8; g.add(pole);
        const housing = cyl(1.3, 1.3, 0.5, std(COLORS.fan), 24); housing.position.y = 2.0; g.add(housing);
        const blades = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const b = box(2.2, 0.12, 0.3, std(0xffffff));
          b.rotation.y = (i * Math.PI) / 4;
          blades.add(b);
        }
        blades.position.y = 2.05; blades.name = 'blades';
        g.add(blades);
        break;
      }
      case 'Magnet':
      case 'MovingMagnet': {
        const pole = cyl(0.15, 0.2, 1.8, std(COLORS.wall)); pole.position.y = 0.9; g.add(pole);
        const mag = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.32, 12, 24, Math.PI), std(COLORS.magnet, { metalness: 0.5 }));
        mag.position.y = 2.2; mag.name = 'magnet';
        g.add(mag);
        break;
      }
      case 'TeslaCoil': {
        const base = box(1.4, 1.0, 1.4, std(COLORS.wall)); base.position.y = 0.5; g.add(base);
        const coil = cyl(0.18, 0.5, 1.6, std(COLORS.tesla)); coil.position.y = 1.8; g.add(coil);
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), std(COLORS.tesla, { emissive: 0x6a2fd0, emissiveIntensity: 0.7 }));
        top.position.y = 2.8; g.add(top);
        const beam = cyl(0.08, 0.08, 3.5, new THREE.MeshBasicMaterial({ color: 0xc9a2ff, transparent: true, opacity: 0.8 }));
        beam.position.y = 4.4; beam.visible = false; beam.name = 'beam';
        g.add(beam);
        break;
      }
      case 'Portal': {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.22, 14, 32), new THREE.MeshBasicMaterial({ color: COLORS.portal }));
        ring.position.y = 2.0; ring.name = 'ring';
        g.add(ring);
        const disc = cyl(1.1, 1.1, 0.1, new THREE.MeshBasicMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0.35 }));
        disc.rotation.x = Math.PI / 2; disc.position.y = 2.0;
        g.add(disc);
        break;
      }
      case 'MultiplyingGate':
      case 'DollarGate': {
        const h = 3.2, w = Math.max(2.5, zw * 0.8);
        for (const s of [-1, 1]) {
          const pillar = box(0.4, h, 0.4, std(m.type === 'DollarGate' ? COLORS.dollar : COLORS.gate));
          pillar.position.set((s * w) / 2, h / 2, 0);
          g.add(pillar);
        }
        const bar = box(w + 0.4, 0.5, 0.5, std(m.type === 'DollarGate' ? COLORS.dollar : COLORS.gate));
        bar.position.y = h;
        g.add(bar);
        const label = box(w * 0.7, 0.9, 0.12, std(0x1c2333));
        label.position.set(0, h - 0.8, 0.28);
        g.add(label);
        g.userData.label = m.type === 'DollarGate' ? '$' : 'x' + (p.multiplier || 2);
        break;
      }
      case 'Spike': {
        const base = box(zw * 0.9 || 3, 0.3, zd * 0.9 || 3, std(COLORS.spike));
        base.position.y = 0.15;
        g.add(base);
        const n = 3;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), std(COLORS.spike, { metalness: 0.6 }));
          spike.position.set((i - 1) * 0.8, 0.75, (j - 1) * 0.8);
          g.add(spike);
        }
        break;
      }
      case 'MovingPlatform': {
        const plat = box(Math.max(2.5, zw * 0.7), 0.4, Math.max(2.5, zd * 0.7), std(COLORS.mover));
        plat.position.y = 0.2;
        plat.name = 'platform';
        g.add(plat);
        break;
      }
      case 'Laser': {
        const em = box(0.8, 1.6, 0.8, std(COLORS.laser)); em.position.y = 0.8; g.add(em);
        const beam = box(0.25, 0.25, (p.maxLength || 4.5), new THREE.MeshBasicMaterial({ color: COLORS.laser, transparent: true, opacity: 0.85 }));
        beam.position.set(0, 1.6, (p.maxLength || 4.5) / 2);
        beam.visible = false;
        beam.name = 'beam';
        g.add(beam);
        break;
      }
      default: {
        const b = box(1.5, 1.5, 1.5, std(0x888888));
        b.position.y = 0.75;
        g.add(b);
      }
    }
    return g;
  }

  function buildScene(world) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6a4fd8);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x40306a, 1.1);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(30, 60, -20);
    scene.add(dir);

    const tierGroups = [];
    const pusherMeshes = [];
    for (const t of world.tiers) {
      const g = new THREE.Group();
      const w = t.maxX - t.minX, d = t.maxZ - t.minZ;
      const thick = t.visual ? Math.max(0.8, t.visual.max[1] - t.top) : 1.4;
      const body = box(w, thick, d, std(0xe8edf8));
      body.position.set(t.cx, t.top - thick / 2, t.cz);
      g.add(body);
      const top = box(w, 0.18, d, std(0xeef7ee));
      top.position.set(t.cx, t.top - 0.09, t.cz);
      g.add(top);
      // green lip on the open edge
      const p = t.pusher;
      if (p) {
        const lip = box(p.axis === 'x' ? 0.35 : w, 0.3, p.axis === 'z' ? 0.35 : d, std(COLORS.lip));
        if (p.openEdge === 'maxX') lip.position.set(t.maxX - 0.17, t.top + 0.05, t.cz);
        else if (p.openEdge === 'minX') lip.position.set(t.minX + 0.17, t.top + 0.05, t.cz);
        else if (p.openEdge === 'maxZ') lip.position.set(t.cx, t.top + 0.05, t.maxZ - 0.17);
        else lip.position.set(t.cx, t.top + 0.05, t.minZ + 0.17);
        g.add(lip);
        // side walls on closed edges
        const wallH = 1.4, wt = 0.3;
        const edges = [
          ['minX', box(wt, wallH, d), [t.minX + wt / 2, t.top + wallH / 2, t.cz]],
          ['maxX', box(wt, wallH, d), [t.maxX - wt / 2, t.top + wallH / 2, t.cz]],
          ['minZ', box(w, wallH, wt), [t.cx, t.top + wallH / 2, t.minZ + wt / 2]],
          ['maxZ', box(w, wallH, wt), [t.cx, t.top + wallH / 2, t.maxZ - wt / 2]],
        ];
        for (const [edge, mesh, pos] of edges) {
          if (edge === p.openEdge) continue;
          mesh.material = std(COLORS.wall);
          mesh.position.set(...pos);
          g.add(mesh);
        }
        // pusher plate + tall back wall
        const plate = box(p.axis === 'x' ? p.d : p.w, p.h + 0.2, p.axis === 'z' ? p.d : p.w, std(0xeef7ee, { roughness: 0.6 })); // sliding top surface, platform-colored
        const wall = box(p.axis === 'x' ? 0.15 : p.w, 1.1, p.axis === 'z' ? 0.15 : p.w, std(COLORS.pusherWall, { metalness: 0.4, roughness: 0.35 }));
        const pg = new THREE.Group();
        pg.add(plate); pg.add(wall);
        plate.position.set(0, p.h / 2 + 0.02, 0); // rides on the platform surface
        wall.position.y = p.h + 0.55;
        if (p.axis === 'x') wall.position.x = -p.sign * (p.d / 2 + 0.12);
        else wall.position.z = -p.sign * (p.d / 2 + 0.12);
        g.add(pg);
        pusherMeshes.push({ tier: t, group: pg });
      }
      scene.add(g);
      tierGroups.push(g);
    }

    // dispenser
    const sp = world.spawn.pos;
    const disp = new THREE.Group();
    const db = box(1.6, 1.0, 1.6, std(COLORS.dispenser));
    db.position.y = 0.5;
    const nozzle = cyl(0.3, 0.42, 0.8, std(0x8a8f9c));
    nozzle.position.y = -0.4;
    disp.add(db); disp.add(nozzle);
    disp.position.set(sp[0], sp[1], sp[2]);
    scene.add(disp);

    // collector
    let collectorMesh = null;
    if (world.collector) {
      const c = world.collector;
      collectorMesh = box(c.maxX - c.minX, Math.max(0.8, c.maxY - c.minY), c.maxZ - c.minZ,
        new THREE.MeshStandardMaterial({ color: COLORS.collector, transparent: true, opacity: 0.45, roughness: 0.4 }));
      collectorMesh.position.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
      scene.add(collectorMesh);
    }

    // machines
    const machineGroups = [];
    for (const m of world.machines) {
      m.tierRef = world.tiers[m.tierIdx];
      const g = buildMachineMesh(m);
      scene.add(g);
      machineGroups.push(g);
    }

    const coinGroup = new THREE.Group();
    scene.add(coinGroup);

    return { scene, tierGroups, pusherMeshes, machineGroups, coinGroup, collectorMesh, dispenser: disp };
  }

  function applyCamera(camera, level, aspect, world) {
    const cam = level.camera;
    camera.fov = cam.fov;
    camera.near = 3;
    camera.far = 2000;
    camera.aspect = aspect;
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    // Unity camera forward is local +z; three.js camera forward is local -z,
    // so convert the extracted euler: (x,y,z) -> (-x, y+180, -z)
    camera.rotation.order = 'YXZ';
    camera.rotation.set(
      (-cam.euler[0] * Math.PI) / 180,
      ((cam.euler[1] + 180) * Math.PI) / 180,
      (-cam.euler[2] * Math.PI) / 180
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (world) fitCameraToWorld(camera, world);
  }

  // keep the extracted view direction/fov; move along the view ray so the whole
  // tower fits the (portrait) frame with a margin (mirrors the original rig's
  // zoom-marker selection between zoomIn/zoomOut)
  function fitCameraToWorld(camera, world) {
    const pts = [];
    for (const t of world.tiers) {
      pts.push([t.minX, t.top, t.minZ], [t.maxX, t.top, t.maxZ], [t.minX, t.top + 3, t.maxZ], [t.maxX, t.top + 3, t.minZ], [t.cx, t.top - 2, t.cz]);
    }
    if (world.collector) pts.push([world.collector.minX, world.collector.minY, world.collector.minZ], [world.collector.maxX, world.collector.maxY, world.collector.maxZ]);
    if (world.spawn && world.spawn.pos) pts.push(world.spawn.pos);
    for (const m of world.machines) pts.push([m.x, m.y + 2, m.z]);
    const target = new THREE.Vector3();
    for (const p of pts) target.add(new THREE.Vector3(...p));
    target.multiplyScalar(1 / pts.length);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const base = camera.position.clone();
    const dist0 = base.distanceTo(target);
    const fits = (d) => {
      camera.position.copy(target).addScaledVector(fwd, -d);
      camera.updateMatrixWorld(true);
      for (const p of pts) {
        const v = new THREE.Vector3(...p).project(camera);
        if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.94 || Math.abs(v.y) > 0.94) return false;
      }
      return true;
    };
    let lo = dist0 * 0.4, hi = dist0 * 24;
    if (fits(lo)) { /* close enough */ }
    else if (!fits(hi)) { lo = hi; }
    else { for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; } lo = hi; }
    camera.position.copy(target).addScaledVector(fwd, -lo);
    camera.updateMatrixWorld(true);
  }

  function create(canvas) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setClearColor(0x000000, 0);
    const camera = new THREE.PerspectiveCamera(20, 1, 3, 900);
    let built = null, world = null, level = null;
    let coinMeshes = new Map();

    function resize() {
      const w = canvas.clientWidth || canvas.width;
      const h = canvas.clientHeight || canvas.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setSize(w, h, false);
      renderer.setPixelRatio(dpr);
      if (level) applyCamera(camera, level, w / h, world);
    }

    function setLevel(lv, wrld) {
      level = lv; world = wrld;
      built = buildScene(world);
      coinMeshes = new Map();
      applyCamera(camera, level, (canvas.clientWidth || 1) / (canvas.clientHeight || 1), world);
    }

    function render(dt) {
      if (!built || !world) return;
      for (const pm of built.pusherMeshes) {
        const p = pm.tier.pusher;
        if (p.axis === 'x') pm.group.position.set(p.pos, pm.tier.top, p.pcz);
        else pm.group.position.set(p.pcx, pm.tier.top, p.pos);
      }
      for (const g of built.machineGroups) {
        const m = world.machines[built.machineGroups.indexOf(g)];
        g.children.forEach((ch) => {
          if (ch.name === 'roller') ch.rotation.z += (m.params.speed || 0) * dt * 2;
          if (ch.name === 'blades') ch.rotation.y += (m.params.speed || 10) * dt * 0.8;
          if (ch.name === 'beam') ch.visible = m.type === 'Laser' ? !!m.on : !!m.firing;
          if (ch.name === 'ring') ch.rotation.z += dt * 1.5;
          if (ch.name === 'platform' && m.platOff != null) {
            const dir = [(m.yaw * Math.PI) / 180];
            const s = Math.sin(dir[0]), c = Math.cos(dir[0]);
            ch.position.x = s * m.platOff;
            ch.position.z = c * m.platOff;
          }
        });
      }
      const seen = new Set();
      for (const c of world.coins) {
        seen.add(c.id);
        let mesh = coinMeshes.get(c.id);
        if (!mesh) {
          const def = CONFIG.coins.find((k) => k.id === c.type) || CONFIG.coins[0];
          mesh = coinMesh(def);
          coinMeshes.set(c.id, mesh);
          built.coinGroup.add(mesh);
        }
        mesh.position.set(c.x, c.y, c.z);
        mesh.rotation.x = c.rx;
        mesh.rotation.z = c.rz;
        const s = 1 + (c.mult - 1) * 0.15;
        mesh.scale.set(s, 1, s);
      }
      for (const [id, mesh] of coinMeshes) {
        if (!seen.has(id)) { built.coinGroup.remove(mesh); coinMeshes.delete(id); }
      }
      renderer.render(built.scene, camera);
    }

    return { render, resize, setLevel, coinMesh, get camera() { return camera; }, get built() { return built; }, get world() { return world; } };
  }

  return { buildScene, create, coinMesh, applyCamera };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeRenderer };
