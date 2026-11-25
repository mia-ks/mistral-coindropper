// Three.js renderer for the extracted multi-tier machine. Geometry, positions, elevations
// and the camera rig all come from the APK-extracted level data (re/dump/levels_final.json):
// tier solid blocks from per-tier visual AABBs, machines at their extracted world transforms
// sized from their extracted visual AABBs, background plane from BG_New, camera from
// LevelCameraBounds (fov, euler, zoom-marker position, frame-fitted distance).
function makeRenderer(CONFIG, LEVELS, THREE) {
  const W = CONFIG.world;

  const COLORS = {
    blockSide: 0xf2f5ff, blockTop: 0xffffff, lip: 0x9fe870,
    pusher: 0x2f7bff,
    collector: 0x39d353, dispenser: 0x2f7bff,
    conveyor: 0x3a3f4a, roller: 0xffd24a, fan: 0x19c3d4, magnet: 0xe0483e,
    tesla: 0x9b59f6, portal: 0x35e0ff, gate: 0x2f7bff, dollar: 0x39d353,
    spike: 0xb8c0cc, mover: 0xff8a3c, laser: 0xff3c3c, wall: 0xdfe7f5,
  };

  function std(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...opts });
  }
  function box(w, h, d, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function cyl(rt, rb, h, mat, seg = 20) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  function gradientTexture(top, bottom) {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    const g = cv.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, top); gr.addColorStop(1, bottom);
    g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function coinTexture(symbol, base) {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(52, 52, 10, 64, 64, 62);
    gr.addColorStop(0, '#ffe9b0');
    gr.addColorStop(0.55, '#' + base.toString(16).padStart(6, '0'));
    gr.addColorStop(1, '#' + (base & 0x777777).toString(16).padStart(6, '0'));
    g.fillStyle = gr;
    g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(120,60,0,0.55)'; g.lineWidth = 5;
    g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.stroke();
    g.fillStyle = 'rgba(90,45,0,0.9)';
    g.font = 'bold 64px sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(symbol, 64, 68);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function coinMesh(def) {
    const g = new THREE.Group();
    const rim = cyl(W.coinR + 0.045, W.coinR + 0.045, W.coinH, std(def.rim, { metalness: 0.7, roughness: 0.3 }));
    g.add(rim);
    const faceMat = std(def.color, { metalness: 0.65, roughness: 0.25 });
    const tex = coinTexture(def.symbol, def.color);
    if (tex) faceMat.map = tex;
    const face = cyl(W.coinR, W.coinR, W.coinH + 0.02, faceMat);
    g.add(face);
    return g;
  }

  function buildMachineModel(m) {
    const g = new THREE.Group();
    const p = m.params;
    switch (m.type) {
      case 'ConveyorBelt': {
        const belt = box(4.6, 0.5, 2.0, std(COLORS.conveyor));
        belt.position.y = 0.25; g.add(belt);
        for (let i = -2; i <= 2; i++) {
          const r = cyl(0.22, 0.22, 1.9, std(COLORS.roller));
          r.rotation.x = Math.PI / 2;
          r.position.set((i * 4.6) / 5, 0.55, 0);
          r.name = 'roller';
          g.add(r);
        }
        break;
      }
      case 'Fan': {
        const pole = cyl(0.16, 0.22, 1.6, std(COLORS.wall)); pole.position.y = 0.8; g.add(pole);
        const housing = cyl(1.25, 1.25, 0.5, std(COLORS.fan), 24); housing.position.y = 2.0; g.add(housing);
        const blades = new THREE.Group();
        for (let i = 0; i < 4; i++) {
          const b = box(2.1, 0.1, 0.28, std(0xffffff));
          b.rotation.y = (i * Math.PI) / 4;
          blades.add(b);
        }
        blades.position.y = 2.05; blades.name = 'blades';
        g.add(blades);
        break;
      }
      case 'Magnet':
      case 'MovingMagnet': {
        const pole = cyl(0.14, 0.2, 1.7, std(COLORS.wall)); pole.position.y = 0.85; g.add(pole);
        const mag = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.3, 12, 24, Math.PI), std(COLORS.magnet, { metalness: 0.5 }));
        mag.position.y = 2.1; mag.name = 'magnet';
        g.add(mag);
        break;
      }
      case 'TeslaCoil': {
        const base = box(1.3, 0.9, 1.3, std(COLORS.wall)); base.position.y = 0.45; g.add(base);
        const coil = cyl(0.16, 0.45, 1.5, std(COLORS.tesla)); coil.position.y = 1.65; g.add(coil);
        const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), std(COLORS.tesla, { emissive: 0x6a2fd0, emissiveIntensity: 0.8 }));
        top.position.y = 2.6; g.add(top);
        const beam = cyl(0.07, 0.07, 3.2, new THREE.MeshBasicMaterial({ color: 0xc9a2ff, transparent: true, opacity: 0.8 }));
        beam.position.y = 4.2; beam.visible = false; beam.name = 'beam';
        g.add(beam);
        break;
      }
      case 'Portal': {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.2, 14, 32), new THREE.MeshBasicMaterial({ color: COLORS.portal }));
        ring.position.y = 1.9; ring.name = 'ring';
        g.add(ring);
        const disc = cyl(1.0, 1.0, 0.1, new THREE.MeshBasicMaterial({ color: 0x9ff0ff, transparent: true, opacity: 0.35 }));
        disc.rotation.x = Math.PI / 2; disc.position.y = 1.9;
        g.add(disc);
        break;
      }
      case 'MultiplyingGate':
      case 'DollarGate': {
        const col = m.type === 'DollarGate' ? COLORS.dollar : COLORS.gate;
        const h = 2.6, w = 3.4;
        for (const s of [-1, 1]) {
          const pillar = box(0.4, h, 0.4, std(col));
          pillar.position.set((s * w) / 2, h / 2, 0);
          g.add(pillar);
        }
        const bar = box(w + 0.4, 0.45, 0.45, std(col));
        bar.position.y = h;
        g.add(bar);
        const label = box(w * 0.7, 0.85, 0.1, std(0x1c2333));
        label.position.set(0, h - 0.7, 0.26);
        g.add(label);
        g.userData.label = m.type === 'DollarGate' ? '$' : 'x' + (p.multiplier || 2);
        break;
      }
      case 'Spike': {
        const base = box(3.4, 0.3, 3.4, std(COLORS.spike));
        base.position.y = 0.15; g.add(base);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
          const spike = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.85, 8), std(COLORS.spike, { metalness: 0.6 }));
          spike.position.set((i - 1) * 0.75, 0.72, (j - 1) * 0.75);
          spike.castShadow = true;
          g.add(spike);
        }
        break;
      }
      case 'MovingPlatform': {
        const plat = box(3.2, 0.4, 3.2, std(COLORS.mover));
        plat.position.y = 0.2; plat.name = 'platform';
        g.add(plat);
        break;
      }
      case 'Laser': {
        const em = box(0.8, 1.5, 0.8, std(COLORS.laser)); em.position.y = 0.75; g.add(em);
        const beam = box(0.22, 0.22, p.maxLength || 4.5, new THREE.MeshBasicMaterial({ color: COLORS.laser, transparent: true, opacity: 0.85 }));
        beam.position.set(0, 1.5, (p.maxLength || 4.5) / 2);
        beam.visible = false; beam.name = 'beam';
        g.add(beam);
        break;
      }
      default: {
        const b = box(1.5, 1.5, 1.5, std(0x9aa4b8));
        b.position.y = 0.75;
        g.add(b);
      }
    }
    return g;
  }

  function placeMachine(group, m) {
    // extracted visual AABB -> scale model to fit, base on its extracted min y
    group.rotation.y = (m.yaw * Math.PI) / 180;
    if (m.visual) {
      const v = m.visual;
      const size = [v.max[0] - v.min[0], v.max[1] - v.min[1], v.max[2] - v.min[2]];
      const bb = new THREE.Box3().setFromObject(group);
      const msize = bb.getSize(new THREE.Vector3());
      // per-axis fit to the extracted visual box, clamped so round machines don't squash
      const s = [
        size[0] / Math.max(msize.x, 1e-6),
        size[1] / Math.max(msize.y, 1e-6),
        size[2] / Math.max(msize.z, 1e-6),
      ].map((x) => Math.max(0.4, Math.min(x, 3)));
      group.scale.set(s[0], s[1], s[2]);
      const bb2 = new THREE.Box3().setFromObject(group);
      const c = bb2.getCenter(new THREE.Vector3());
      group.position.set(
        (v.min[0] + v.max[0]) / 2 - c.x,
        v.min[1] - bb2.min.y,
        (v.min[2] + v.max[2]) / 2 - c.z
      );
    } else {
      group.position.set(m.x, m.y, m.z);
    }
  }

  function buildScene(world) {
    const scene = new THREE.Scene();
    const bgTop = world.level.bgTop || [138, 99, 240];
    const bgBottom = world.level.bgBottom || [58, 42, 101];
    const bgCss = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    scene.background = new THREE.Color(bgCss(bgBottom));
    scene.fog = new THREE.Fog(bgCss(bgBottom), 120, 400);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x6a5aa8, 1.35);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.8);
    dir.position.set(40, 70, -30);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -60; dir.shadow.camera.right = 60;
    dir.shadow.camera.top = 80; dir.shadow.camera.bottom = -60;
    dir.shadow.camera.far = 300;
    dir.shadow.bias = -0.0005;
    scene.add(dir);
    scene.add(dir.target);

    // background plane from extracted BG_New
    const bg = world.level.bg;
    if (bg) {
      const tex = gradientTexture(bgCss(bgTop), bgCss(bgBottom));
      const mat = tex
        ? new THREE.MeshBasicMaterial({ map: tex })
        : new THREE.MeshBasicMaterial({ color: 0x6a4fd8 });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(bg.meshSize[0], bg.meshSize[1]), mat);
      // backdrop volume: put the gradient on its far face (away from the camera)
      plane.position.set(bg.pos[0], bg.pos[1] + bg.meshSize[1] / 2 - 10, bg.pos[2] + bg.meshSize[2] / 2);
      plane.rotation.y = Math.PI;
      scene.add(plane);
    }

    const tierGroups = [];
    const pusherMeshes = [];
    for (const t of world.tiers) {
      const g = new THREE.Group();
      const v = t.visual;
      const minX = v ? v.min[0] : t.minX, maxX = v ? v.max[0] : t.maxX;
      const minZ = v ? v.min[2] : t.minZ, maxZ = v ? v.max[2] : t.maxZ;
      const bottom = v ? v.min[1] : t.top - 5.6;
      const w = maxX - minX, d = maxZ - minZ, h = t.top - bottom;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
      // solid block (column) down to the extracted bottom
      const body = box(w, h, d, std(COLORS.blockSide));
      body.position.set(cx, bottom + h / 2, cz);
      g.add(body);
      // green top surface
      const top = box(w, 0.16, d, std(COLORS.blockTop, { roughness: 0.8 }));
      top.position.set(cx, t.top - 0.08, cz);
      g.add(top);
      // low lips on closed edges, open edge stays open
      const p = t.pusher;
      if (p) {
        const lipH = 0.5, lt = 0.22;
        const edges = [
          ['minX', box(lt, lipH, d), [minX + lt / 2, t.top + lipH / 2, cz]],
          ['maxX', box(lt, lipH, d), [maxX - lt / 2, t.top + lipH / 2, cz]],
          ['minZ', box(w, lipH, lt), [cx, t.top + lipH / 2, minZ + lt / 2]],
          ['maxZ', box(w, lipH, lt), [cx, t.top + lipH / 2, maxZ - lt / 2]],
        ];
        for (const [edge, mesh, pos] of edges) {
          if (edge === p.openEdge) continue;
          mesh.material = std(COLORS.wall);
          mesh.position.set(...pos);
          g.add(mesh);
        }
        // pusher: sliding plate (platform-colored) + blue back wall
        const plate = box(p.axis === 'x' ? p.d : p.w, p.h + 0.2, p.axis === 'z' ? p.d : p.w, std(0xdfeeda, { roughness: 0.7 }));
        const wall = box(p.axis === 'x' ? 0.15 : p.w, 1.1, p.axis === 'z' ? 0.15 : p.w, std(COLORS.pusher, { metalness: 0.4, roughness: 0.35 }));
        const pg = new THREE.Group();
        pg.add(plate); pg.add(wall);
        plate.position.set(0, p.h / 2 + 0.02, 0);
        wall.position.y = p.h + 0.55;
        if (p.axis === 'x') wall.position.x = -p.sign * (p.d / 2 + 0.1);
        else wall.position.z = -p.sign * (p.d / 2 + 0.1);
        g.add(pg);
        pusherMeshes.push({ tier: t, group: pg });
      }
      scene.add(g);
      tierGroups.push(g);
    }

    // dispenser at extracted spawn position
    const sp = world.spawn.pos;
    const disp = new THREE.Group();
    const db = box(1.6, 1.0, 1.6, std(COLORS.dispenser));
    db.position.y = 0.5;
    const nozzle = cyl(0.3, 0.42, 0.8, std(0x8a8f9c));
    nozzle.position.y = -0.4;
    disp.add(db); disp.add(nozzle);
    disp.position.set(sp[0], sp[1], sp[2]);
    scene.add(disp);

    // collector at extracted trigger volume
    let collectorMesh = null;
    if (world.collector) {
      const c = world.collector;
      collectorMesh = box(c.maxX - c.minX, Math.max(0.8, c.maxY - c.minY), c.maxZ - c.minZ,
        new THREE.MeshStandardMaterial({ color: COLORS.collector, transparent: true, opacity: 0.45, roughness: 0.4 }));
      collectorMesh.position.set((c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2, (c.minZ + c.maxZ) / 2);
      scene.add(collectorMesh);
    }

    // machines at extracted world transforms, sized from extracted visual AABBs
    const machineGroups = [];
    for (const m of world.machines) {
      m.tierRef = world.tiers[m.tierIdx];
      const g = buildMachineModel(m);
      placeMachine(g, m);
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
    camera.rotation.order = 'YXZ';
    // Unity camera forward is local +z; three.js camera forward is local -z,
    // so convert the extracted euler: (x,y,z) -> (-x, y+180, -z)
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
  // tower fits the (portrait) frame with a margin (the original rig does the same
  // via its zoomIn/zoomOut markers)
  function fitCameraToWorld(camera, world) {
    const pts = [];
    for (const t of world.tiers) {
      const v = t.visual;
      if (v) { pts.push(v.min, v.max); }
      pts.push([t.minX, t.top, t.minZ], [t.maxX, t.top, t.maxZ], [t.cx, t.top + 3, t.cz]);
    }
    if (world.collector) pts.push([world.collector.minX, world.collector.minY, world.collector.minZ], [world.collector.maxX, world.collector.maxY, world.collector.maxZ]);
    if (world.spawn && world.spawn.pos) pts.push(world.spawn.pos);
    for (const m of world.machines) pts.push([m.x, m.y + 2, m.z]);
    const target = new THREE.Vector3();
    for (const p of pts) target.add(new THREE.Vector3(...p));
    target.multiplyScalar(1 / pts.length);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const dist0 = camera.position.distanceTo(target);
    const fits = (d) => {
      camera.position.copy(target).addScaledVector(fwd, -d);
      camera.updateMatrixWorld(true);
      for (const p of pts) {
        const v = new THREE.Vector3(...p).project(camera);
        if (v.z < -1 || v.z > 1 || Math.abs(v.x) > 0.88 || Math.abs(v.y) > 0.88) return false;
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
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x241a4d, 1); // scene.background covers the frame
    const camera = new THREE.PerspectiveCamera(20, 1, 3, 2000);
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
      for (let gi = 0; gi < built.machineGroups.length; gi++) {
        const g = built.machineGroups[gi];
        const m = world.machines[gi];
        g.children.forEach((ch) => {
          if (ch.name === 'roller') ch.rotation.z += (m.params.speed || 0) * dt * 2;
          if (ch.name === 'blades') ch.rotation.y += (m.params.speed || 10) * dt * 0.8;
          if (ch.name === 'beam') ch.visible = m.type === 'Laser' ? !!m.on : !!m.firing;
          if (ch.name === 'ring') ch.rotation.z += dt * 1.5;
          if (ch.name === 'platform' && m.platOff != null) {
            const r = (m.yaw * Math.PI) / 180;
            ch.position.x = Math.sin(r) * m.platOff;
            ch.position.z = Math.cos(r) * m.platOff;
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
