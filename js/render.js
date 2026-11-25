function makeRenderer(CONFIG, LEVELS, THREE) {
  const W = CONFIG.world;

  function textTexture(text, color) {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(10,16,30,0.85)';
    g.fillRect(0, 0, 256, 128);
    g.fillStyle = color || '#fff';
    g.font = 'bold 72px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 64);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  function box(w, h, d, color, opts) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7, metalness: 0.15 }, opts || {}))
    );
    return m;
  }

  function buildMachine(m) {
    const g = new THREE.Group();
    g.position.set(m.x, 0, m.z);
    const star = box(0.5, 0.18, 0.5, 0xffd24a);
    star.position.y = 4.2;
    star.visible = false;
    g.add(star);
    g.userData.star = star;
    switch (m.type) {
      case 'conveyor': {
        const base = box(W.halfX * 2, 0.5, m.w, 0x2f7bff, { roughness: 0.5 });
        base.position.y = 0.25;
        g.add(base);
        g.userData.rollers = [];
        for (let i = 0; i < 5; i++) {
          const r = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, W.halfX * 2, 12), new THREE.MeshStandardMaterial({ color: 0xeaf3ff }));
          r.rotation.z = Math.PI / 2;
          r.position.set(0, 0.55, -m.w / 2 + (i + 0.5) * (m.w / 5));
          g.add(r);
          g.userData.rollers.push(r);
        }
        break;
      }
      case 'fan': {
        const pole = box(0.25, m.y, 0.25, 0xff6ad5);
        pole.position.y = m.y / 2;
        g.add(pole);
        const head = new THREE.Group();
        head.position.y = m.y;
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.14, 10, 24), new THREE.MeshStandardMaterial({ color: 0xff6ad5 }));
        head.add(ring);
        const blades = new THREE.Group();
        for (let i = 0; i < 3; i++) {
          const b = box(1.7, 0.08, 0.22, 0xffe3f4);
          b.rotation.y = (i * Math.PI * 2) / 3;
          blades.add(b);
        }
        head.add(blades);
        head.rotation.x = -Math.PI / 2;
        g.add(head);
        g.userData.blades = blades;
        break;
      }
      case 'magnet':
      case 'movingMagnet':
      case 'suction': {
        const color = m.type === 'suction' ? 0xa55eff : 0xff4757;
        const body = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.35, 10, 20, Math.PI), new THREE.MeshStandardMaterial({ color }));
        body.position.y = m.y;
        body.rotation.x = Math.PI;
        g.add(body);
        const bar = box(2.7, 0.5, 0.7, color);
        bar.position.y = m.y + 0.55;
        g.add(bar);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(m.r, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 }));
        ring.position.y = 0.6;
        ring.rotation.x = Math.PI / 2;
        g.add(ring);
        g.userData.ring = ring;
        break;
      }
      case 'launcher': {
        const base = box(2.2, 0.3, 2.2, 0xffa502);
        base.position.y = 0.15;
        g.add(base);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.6, 16), new THREE.MeshStandardMaterial({ color: 0xffc312 }));
        cone.position.y = 1.1;
        g.add(cone);
        const flash = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffdc50, transparent: true, opacity: 0.0 }));
        flash.position.y = 1.4;
        g.add(flash);
        g.userData.flash = flash;
        break;
      }
      case 'portal': {
        const tor = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.16, 10, 28), new THREE.MeshStandardMaterial({ color: 0xc56cf0, emissive: 0x6c2bd9 }));
        tor.position.y = 2.2;
        g.add(tor);
        g.userData.tor = tor;
        break;
      }
      case 'gate':
      case 'dollarGate': {
        const color = m.type === 'gate' ? 0x2ed573 : 0x1e90ff;
        const p1 = box(0.35, 4, 0.35, color);
        p1.position.set(-1.8, 2, 0);
        const p2 = p1.clone();
        p2.position.x = 1.8;
        g.add(p1); g.add(p2);
        const tex = textTexture(m.type === 'gate' ? 'x2' : '$', m.type === 'gate' ? '#7dffa8' : '#7dcea0');
        const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: tex || null, transparent: true, color: tex ? 0xffffff : color }));
        panel.position.y = 3.1;
        g.add(panel);
        break;
      }
      case 'spike': {
        for (let i = 0; i < 5; i++) {
          const cone = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xff4757 }));
          cone.position.set(-1 + i * 0.5, 0.45, 0);
          g.add(cone);
        }
        break;
      }
      case 'platform': {
        const pad = box(W.halfX * 2, 0.4, m.w, 0x7bed9f);
        pad.position.y = 0.2;
        g.add(pad);
        g.userData.pad = pad;
        break;
      }
      case 'laser': {
        const emitter = box(0.5, 4.5, 0.5, 0x576574);
        emitter.position.y = 2.25;
        g.add(emitter);
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 4.5, 8), new THREE.MeshBasicMaterial({ color: 0xff3c3c, transparent: true, opacity: 0.85 }));
        beam.position.y = 2.25;
        beam.visible = false;
        g.add(beam);
        g.userData.beam = beam;
        break;
      }
    }
    return g;
  }

  function buildScene(world) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x6a4fd8);
    scene.fog = new THREE.Fog(0x6a4fd8, 34, 70);
    scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    const dir = new THREE.DirectionalLight(0xfff2d9, 1.6);
    dir.position.set(5, 14, 10);
    scene.add(dir);

    const plat = box(W.halfX * 2 + 1.5, 1, W.edgeZ - W.backZ + 3, 0xf2f5ff, { roughness: 0.9, metalness: 0 });
    plat.position.set(0, -0.5, (W.backZ + W.edgeZ) / 2 + 0.5);
    scene.add(plat);
    const lip = box(W.halfX * 2 + 1.5, 0.14, W.edgeZ - W.backZ + 3, 0x9fe870);
    lip.position.set(0, 0.07, (W.backZ + W.edgeZ) / 2 + 0.5);
    scene.add(lip);
    const back = box(W.halfX * 2 + 1.5, 1.6, 0.4, 0xdfe6f7, { roughness: 0.9 });
    back.position.set(0, 0.8, W.backZ - 0.2);
    scene.add(back);
    for (const s of [-1, 1]) {
      const wall = box(0.35, 1.6, W.edgeZ - W.backZ + 3, 0xdfe6f7, { roughness: 0.9 });
      wall.position.set(s * (W.halfX + 0.55), 0.8, (W.backZ + W.edgeZ) / 2 + 0.5);
      scene.add(wall);
    }
    const deck = box(W.halfX * 2 + 1.5, 1.2, 3.4, 0xe8edfb, { roughness: 0.9 });
    deck.position.set(0, -1.2, W.edgeZ + 1.7);
    scene.add(deck);

    const collector = box(W.halfX * 2 + 1.5, 2.2, 3.2, 0x2ed573, { transparent: true, opacity: 0.22, emissive: 0x0a5c2e });
    collector.position.set(0, 0.6, W.edgeZ + 1.6);
    scene.add(collector);
    const cTex = textTexture('COLLECT', '#7dffa8');
    const cLabel = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ map: cTex || null, transparent: true, color: 0x2ecc71 }));
    cLabel.position.set(0, 4.6, W.edgeZ + 1.5);
    cLabel.rotation.y = Math.PI;
    scene.add(cLabel);

    const pusher = box(W.halfX * 2 + 1, W.pusherH, W.pusherThick, 0x2f7bff, { metalness: 0.25, roughness: 0.35 });
    const pusherFace = box(W.halfX * 2 + 1, W.pusherH - 0.5, 0.12, 0x9cc4ff);
    pusherFace.position.z = W.pusherThick / 2 + 0.07;
    pusher.add(pusherFace);
    pusher.position.set(0, W.pusherH / 2, world.pusher.z + W.pusherThick / 2);
    scene.add(pusher);

    const machineGroups = world.machines.map((m) => {
      const g = buildMachine(m);
      scene.add(g);
      return g;
    });

    return { scene, pusher, collector, machineGroups, coinGroup: new THREE.Group() };
  }

  function coinMesh(def) {
    const g = new THREE.Group();
    const h = W.coinH;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(W.coinR + 0.05, W.coinR + 0.05, h * 2, 24), new THREE.MeshStandardMaterial({ color: def.rim, roughness: 0.35, metalness: 0.7 }));
    const face = new THREE.Mesh(new THREE.CylinderGeometry(W.coinR, W.coinR, h * 2 + 0.02, 24), new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.2, metalness: 0.8 }));
    g.add(rim); g.add(face);
    const tex = textTexture(def.gem ? '◆' : '$', '#8a5a00');
    if (tex) {
      const face2 = new THREE.Mesh(new THREE.CircleGeometry(W.coinR * 0.72, 20), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      face2.rotation.x = -Math.PI / 2;
      face2.position.y = h + 0.015;
      g.add(face2);
    }
    return g;
  }

  function create(container, overlay) {
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1);
    container.appendChild(renderer.domElement);
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(8.5, 11.5, 25);
    camera.lookAt(0, 0.2, 7.5);
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let built = null;
    let coinMeshes = new Map();

    function resize() {
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }

    function pick(clientX, clientY) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera({ x: nx, y: ny }, camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hit)) {
        return { x: hit.x, z: hit.z };
      }
      return null;
    }

    function project(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { sx: (v.x * 0.5 + 0.5) * rect.width, sy: (-v.y * 0.5 + 0.5) * rect.height };
    }

    function render(world, fx, time) {
      if (!built || built.world !== world) {
        built = Object.assign(buildScene(world), { world });
        built.scene.add(built.coinGroup);
        coinMeshes = new Map();
      }
      built.pusher.position.z = world.pusher.z + W.pusherThick / 2;
      built.machineGroups.forEach((g, i) => {
        const m = world.machines[i];
        if (m.type === 'movingMagnet' && m.sway) g.position.x = m.x + Math.sin(time * (Math.PI / Math.max(0.5, m.stay))) * m.sway;
        if (g.userData.rollers) for (const r of g.userData.rollers) r.rotation.x += m.speed * 0.08;
        if (g.userData.blades) g.userData.blades.rotation.z += 0.25 * (1 + m.level * 0.2);
        if (g.userData.tor) { const s = 1 + 0.12 * Math.sin(time * 5); g.userData.tor.scale.set(s, s, s); }
        if (g.userData.flash) g.userData.flash.material.opacity = Math.max(0, 0.8 - m.timer * 4);
        if (g.userData.beam) g.userData.beam.visible = !!m.laserOn;
        if (g.userData.pad) g.userData.pad.position.z = Math.sin(time * 1.1) * 0.8;
        if (g.userData.ring) g.userData.ring.scale.setScalar(1 + 0.08 * Math.sin(time * 4));
        if (g.userData.star) { g.userData.star.visible = m.level > 0; g.userData.star.scale.setScalar(0.6 + m.level * 0.12); }
      });
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
        mesh.rotation.x = c.rx || 0;
        mesh.rotation.z = c.rz || 0;
        mesh.rotation.y += 0.02 + Math.abs(c.vx + c.vz) * 0.01;
        mesh.scale.setScalar(c.mult > 1 ? 1 + Math.min(0.5, (c.mult - 1) * 0.15) : 1);
      }
      for (const [id, mesh] of coinMeshes) {
        if (!seen.has(id)) {
          built.coinGroup.remove(mesh);
          coinMeshes.delete(id);
        }
      }
      built.collector.material.opacity = 0.14 + 0.08 * Math.sin(time * 3);
      renderer.render(built.scene, camera);
      if (overlay && fx) {
        const ctx = overlay.getContext('2d');
        const rect = renderer.domElement.getBoundingClientRect();
        if (overlay.width !== rect.width) { overlay.width = rect.width; overlay.height = rect.height; }
        ctx.clearRect(0, 0, overlay.width, overlay.height);
        for (const f of fx.floaters) {
          const p = project(f.x, f.y, f.z);
          ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
          ctx.fillStyle = f.color || '#ffd24a';
          ctx.font = 'bold 18px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(f.text, p.sx, p.sy - (f.maxLife - f.life) * 30);
        }
        for (const p of fx.particles) {
          const pp = project(p.x, p.y, p.z);
          ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(pp.sx, pp.sy, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }

    return { render, resize, pick, project, canvas: renderer.domElement, get camera() { return camera; } };
  }

  return { buildScene, create, coinMesh };
}

if (typeof module !== 'undefined' && module.exports) {
  const { CONFIG, LEVELS } = require('./config.js');
  module.exports = { makeRenderer, CONFIG, LEVELS };
}
