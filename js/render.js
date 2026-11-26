// Three.js renderer for the extracted machine. All static geometry is the REAL Unity
// mesh data exported from the APK (js/meshlib.js + per-level meshData in
// js/level_layouts.js, mirrored x -> -x into right-handed three.js with matching
// quaternion camera from LevelCameraBounds). Only coins are procedural (they are
// spawned at runtime in the original too), plus the background gradient plane.
const _ML = (typeof MESH_LIB !== 'undefined') ? { LIB: MESH_LIB, MATS: (typeof MESH_MATS !== 'undefined' ? MESH_MATS : {}) }
  : ((typeof module !== 'undefined' && module.exports)
      ? (() => { const m = require('./meshlib.js'); return { LIB: m.MESH_LIB, MATS: m.MESH_MATS }; })()
      : { LIB: null, MATS: {} });

function makeRenderer(CONFIG, LEVELS, THREE) {
  const W = CONFIG.world;
  const LIB = _ML.LIB;
  const MATS = _ML.MATS;

  function yawDirLocal(yawDeg) {
    const r = (yawDeg * Math.PI) / 180;
    return [Math.sin(r), Math.cos(r)];
  }

  // ---- caches: one BufferGeometry per submesh, one material per exported material ----
  const geoCache = new Map();
  function geomsFor(name) {
    if (geoCache.has(name)) return geoCache.get(name);
    const entry = LIB && LIB[name];
    const list = [];
    if (entry && entry.subs) {
      for (const sub of entry.subs) {
        const n = sub.pos.length;
        const arr = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          arr[i * 3] = sub.pos[i][0] / 1000;
          arr[i * 3 + 1] = sub.pos[i][1] / 1000;
          arr[i * 3 + 2] = sub.pos[i][2] / 1000;
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        if (sub.nrm && sub.nrm.length === n) {
          const na = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) { na[i * 3] = sub.nrm[i][0] / 1000; na[i * 3 + 1] = sub.nrm[i][1] / 1000; na[i * 3 + 2] = sub.nrm[i][2] / 1000; }
          g.setAttribute('normal', new THREE.BufferAttribute(na, 3));
        } else g.computeVertexNormals();
        if (sub.uv && sub.uv.length === n) {
          const ua = new Float32Array(n * 2);
          for (let i = 0; i < n; i++) { ua[i * 2] = sub.uv[i][0] / 10000; ua[i * 2 + 1] = sub.uv[i][1] / 10000; }
          g.setAttribute('uv', new THREE.BufferAttribute(ua, 2));
        }
        // vertex colors when present (white fill otherwise, so one material can serve all)
        const ca = new Float32Array(n * 3);
        if (sub.col && sub.col.length === n) {
          for (let i = 0; i < n; i++) { ca[i * 3] = sub.col[i][0] / 255; ca[i * 3 + 1] = sub.col[i][1] / 255; ca[i * 3 + 2] = sub.col[i][2] / 255; }
        } else {
          ca.fill(1);
        }
        g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
        g.setIndex(sub.idx);
        list.push(g);
      }
    }
    geoCache.set(name, list);
    return list;
  }

  // textures from the exported data URLs (browser only); node tests fall back to flat colors
  const texCache = new Map();
  const pendingTex = [];
  function texFor(def) {
    if (!def.tex || typeof document === 'undefined') return null;
    if (texCache.has(def.tex)) return texCache.get(def.tex);
    const img = new Image();
    const tex = new THREE.Texture(img);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    if (def.uvScale) tex.repeat.set(def.uvScale[0], def.uvScale[1]);
    if (def.uvOffset) tex.offset.set(def.uvOffset[0], def.uvOffset[1]);
    const p = new Promise((res) => { img.onload = () => { tex.needsUpdate = true; res(); }; img.onerror = () => res(); });
    pendingTex.push(p);
    img.src = def.tex;
    texCache.set(def.tex, tex);
    return tex;
  }

  const matCache = new Map();
  function matByPid(pid) {
    const key = 'p' + pid;
    if (matCache.has(key)) return matCache.get(key);
    const def = MATS[String(pid)] || MATS[pid];
    let mat;
    if (def) {
      const [r, g, b, a] = def.color;
      const map = texFor(def);
      const blending = (def.mode != null && def.mode >= 2) || a < 0.995;
      mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b), map,
        roughness: def.smoothness != null ? 1 - def.smoothness : 0.5,
        metalness: def.metallic || 0,
        vertexColors: true,
        transparent: blending, opacity: a,
        side: def.cull === 0 ? THREE.DoubleSide : def.cull === 1 ? THREE.BackSide : THREE.FrontSide,
      });
      if (blending) mat.depthWrite = false;
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0xd8dce6, roughness: 0.75, metalness: 0.15, vertexColors: true });
    }
    matCache.set(key, mat);
    return mat;
  }
  function matFor(colors, i) {
    const c = (colors && colors.length ? colors[i % colors.length] : null) || [0.8, 0.8, 0.8];
    const key = c[0].toFixed(4) + ',' + c[1].toFixed(4) + ',' + c[2].toFixed(4);
    if (!matCache.has(key)) {
      matCache.set(key, new THREE.MeshStandardMaterial({
        color: new THREE.Color(c[0], c[1], c[2]), roughness: 0.75, metalness: 0.15, vertexColors: true,
      }));
    }
    return matCache.get(key);
  }
  function instMat(inst, s) {
    if (inst.mats && inst.mats.length) return matByPid(inst.mats[s % inst.mats.length]);
    return matFor(inst.colors, s);
  }

  // one THREE.Group per exported instance, one Mesh per submesh (per-submesh material).
  // Transform = the exact exported hierarchical matrix (column-major), so nonuniform
  // parent scales compose correctly.
  function addInstance(scene, inst) {
    const geos = geomsFor(inst.mesh);
    const grp = new THREE.Group();
    grp.name = inst.name || '';
    grp.userData.chain = inst.chain || [];
    if (inst.mat) {
      grp.matrixAutoUpdate = false;
      grp.matrix.fromArray(inst.mat);
    } else {
      grp.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
      grp.quaternion.set(inst.quat[0], inst.quat[1], inst.quat[2], inst.quat[3]);
      grp.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
    }
    grp.matrix.decompose(grp.position, grp.quaternion, grp.scale);
    grp.userData.baseMat = grp.matrix.clone();
    grp.userData.inst = inst;
    grp.userData.baseQuat = inst.quat ? inst.quat.slice() : [0, 0, 0, 1];
    grp.userData.basePos = inst.pos ? inst.pos.slice() : [0, 0, 0];
    grp.userData.baseScale = inst.scale ? inst.scale.slice() : [1, 1, 1];
    for (let s = 0; s < geos.length; s++) {
      const mesh = new THREE.Mesh(geos[s], instMat(inst, s));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      grp.add(mesh);
    }
    scene.add(grp);
    return grp;
  }

  function std(color, opts = {}) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2, ...opts });
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
    const rim = cyl(W.coinR + 0.045, W.coinR + 0.045, W.coinH, std(def.rim, { metalness: 0.3, roughness: 0.4, emissive: def.rim, emissiveIntensity: 0.25 }));
    g.add(rim);
    const faceMat = std(def.color, { metalness: 0.25, roughness: 0.35, emissive: def.color, emissiveIntensity: 0.3 });
    const tex = coinTexture(def.symbol, def.color);
    if (tex) faceMat.map = tex;
    const face = cyl(W.coinR, W.coinR, W.coinH + 0.02, faceMat);
    g.add(face);
    return g;
  }

  function buildScene(world) {
    const scene = new THREE.Scene();
    const bgTop = world.level.bgTop || [138, 99, 240];
    const bgBottom = world.level.bgBottom || [58, 42, 101];
    const bgCss = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    scene.background = new THREE.Color(bgCss(bgTop));
    scene.fog = new THREE.Fog(bgCss(bgBottom), 120, 400);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a7ac8, 1.6);
    scene.add(hemi);
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const dir = new THREE.DirectionalLight(0xffffff, 2.0);
    dir.position.set(-40, 70, -50); // from the camera side (mirrored world), like the original's key light
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.camera.left = -80; dir.shadow.camera.right = 80;
    dir.shadow.camera.top = 100; dir.shadow.camera.bottom = -80;
    dir.shadow.camera.far = 400;
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
      plane.position.set(bg.pos[0], bg.pos[1] + bg.meshSize[1] / 2 - 10, bg.pos[2] + bg.meshSize[2] / 2);
      plane.rotation.y = Math.PI;
      plane.userData.skipRaster = true; // software rasterizer paints its own gradient backdrop
      scene.add(plane);
    }

    // real exported geometry: static instances + animated dozer plates
    const md = world.level.meshData;
    const instanceGroups = [];
    const dozerAnims = [];
    if (md) {
      for (const inst of md.instances) instanceGroups.push(addInstance(scene, inst));
      for (const d of md.dozers) {
        const grp = addInstance(scene, d);
        dozerAnims.push({ grp, tierName: d.tier, origin: d.origin || null });
      }
      // attach visual groups to their machine by actual hierarchy (ancestor chain contains the machine GO)
      for (const m of world.machines) {
        m.vizGroups = instanceGroups.filter((g) => (g.userData.chain || []).includes(m.go));
        for (const g of m.vizGroups) {
          // per-group clones so animations never mutate shared materials/textures
          for (const ch of g.children) {
            ch.material = ch.material.clone();
            if (ch.material.map) ch.material.map = ch.material.map.clone();
            ch.userData.baseEmissive = ch.material.emissive ? ch.material.emissive.clone() : null;
            ch.userData.baseEmissiveIntensity = ch.material.emissiveIntensity != null ? ch.material.emissiveIntensity : 1;
          }
        }
      }
    }

    const coinGroup = new THREE.Group();
    scene.add(coinGroup);

    return { scene, instanceGroups, dozerAnims, coinGroup };
  }

  function applyCamera(camera, level, aspect, world) {
    camera.near = 1;
    camera.far = 8000;
    camera.aspect = aspect;
    const gl = level.cameraGL;
    if (gl) {
      // handedness-converted extracted camera: mirrored LevelCameraBounds zoom marker
      // position + quaternion (euler mirrored, then 180 deg about Y for three's -z forward)
      camera.fov = gl.fov;
      camera.position.set(gl.pos[0], gl.pos[1], gl.pos[2]);
      camera.quaternion.set(gl.quat[0], gl.quat[1], gl.quat[2], gl.quat[3]);
    } else {
      const cam = level.camera;
      camera.fov = cam.fov;
      camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
      camera.rotation.order = 'YXZ';
      camera.rotation.set(
        (-cam.euler[0] * Math.PI) / 180,
        ((cam.euler[1] + 180) * Math.PI) / 180,
        (-cam.euler[2] * Math.PI) / 180
      );
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (world) fitCameraToWorld(camera, world);
  }

  // keep the extracted view direction/fov; move along the view ray so the whole
  // tower fits the (portrait) frame with a margin (the original rig does the same
  // via its zoomIn/zoomOut markers)
  function fitCameraToWorld(camera, world) {
    // frame the extracted LevelCameraBounds marker quad (top/bottom/left/right markers
    // sit at the original's screen edges); fall back to the tier/collector extents
    const gl = world.level.cameraGL;
    let pts = null;
    if (gl && gl.bounds) {
      pts = [gl.bounds.topMarker, gl.bounds.bottomMarker, gl.bounds.leftMarker, gl.bounds.rightMarker];
    } else {
      pts = [];
      for (const t of world.tiers) {
        const v = t.visual;
        if (v) { pts.push(v.min, v.max); }
        pts.push([t.minX, t.top, t.minZ], [t.maxX, t.top, t.maxZ], [t.cx, t.top + 3, t.cz]);
      }
      if (world.collector) pts.push([world.collector.minX, world.collector.minY, world.collector.minZ], [world.collector.maxX, world.collector.maxY, world.collector.maxZ]);
      if (world.spawn && world.spawn.pos) pts.push(world.spawn.pos);
      for (const m of world.machines) pts.push([m.x, m.y + 2, m.z]);
    }
    const margin = (gl && gl.bounds) ? 0.985 : 0.88;
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
        if (Math.abs(v.x) > margin || Math.abs(v.y) > margin) return false;
      }
      return true;
    };
    let lo = dist0 * 0.4, hi = Math.min(dist0 * 200, 7000);
    if (fits(lo)) { /* close enough */ }
    else if (!fits(hi)) { lo = hi; }
    else { for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; } lo = hi; }
    camera.position.copy(target).addScaledVector(fwd, -lo);
    camera.updateMatrixWorld(true);
  }

  // shared animation update used by BOTH the runtime render loop and the tests
  function updateAnimations(world, built, dt) {
    // dozer assemblies: ONE shared world-space translation (p.pos - p.back along the sweep
    // axis) added to each part's ORIGINAL matrix, so relative Dozer/DozerWall offsets and
    // the controller origin are preserved exactly
    for (const da of built.dozerAnims) {
      const tier = world.tiers.find((t) => t.name === da.tierName);
      const p = tier && tier.pusher;
      if (!p) continue;
      // rest pose = controller origin (exported inner 'Pusher' node world pos): the
      // shared translation is measured from that origin, exactly like the physics
      const ai = p.axis === 'x' ? 0 : 2;
      const back = da.origin ? da.origin[ai] : p.back;
      const delta = p.pos - back;
      da.grp.matrix.copy(da.grp.userData.baseMat);
      const e = da.grp.matrix.elements;
      if (p.axis === 'x') e[12] += delta; else e[14] += delta;
    }
    // machine part animations on the real meshes (fans spin, portals pulse, ...)
    const t = world.time;
    for (const m of world.machines) {
      const gs = m.vizGroups || [];
      if (!gs.length) continue;
      const p = m.params;
      const dir = yawDirLocal(m.yaw);
      for (const g of gs) {
        const nm = g.name || '';
        if ((m.type === 'Fan') && nm.startsWith('Fan')) {
          const a = (p.speed || 10) * dt * 0.5 + (g.userData.spin || 0);
          g.userData.spin = a;
          g.matrix.copy(g.userData.baseMat).multiply(new THREE.Matrix4().makeRotationZ(a)); // local blade axis
        } else if (m.type === 'Portal' && /Portal/.test(nm)) {
          const s = 1 + 0.07 * Math.sin(t * 3 + g.userData.basePos[0]);
          g.matrix.copy(g.userData.baseMat).multiply(new THREE.Matrix4().makeScale(s, s, s));
        } else if ((m.type === 'Magnet' || m.type === 'MovingMagnet') && /Magnet/.test(nm)) {
          if (g.userData.magOff == null) g.userData.magOff = [g.userData.basePos[0] - m.x, g.userData.basePos[2] - m.z];
          const mx = m.type === 'MovingMagnet' ? (m.magX != null ? m.magX : m.x) : m.x;
          const mz = m.type === 'MovingMagnet' ? (m.magZ != null ? m.magZ : m.z) : m.z;
          const dx = mx + g.userData.magOff[0] - g.userData.basePos[0];
          const dz = mz + g.userData.magOff[1] - g.userData.basePos[2];
          g.matrix.copy(new THREE.Matrix4().makeTranslation(dx, 0, dz)).multiply(g.userData.baseMat);
        } else if (m.type === 'TeslaCoil' && /Tesla/.test(nm)) {
          for (const ch of g.children) {
            if (!ch.userData.baseEmissive) continue;
            if (m.firing) {
              ch.material.emissive.setRGB(0.7, 0.4, 1.0);
              ch.material.emissiveIntensity = 2.5;
            } else {
              ch.material.emissive.copy(ch.userData.baseEmissive);
              ch.material.emissiveIntensity = ch.userData.baseEmissiveIntensity;
            }
          }
        } else if (m.type === 'MovingPlatform' && /MovingPlate|Slider/.test(nm) && m.platOff != null) {
          g.matrix.copy(new THREE.Matrix4().makeTranslation(dir[0] * m.platOff, 0, dir[1] * m.platOff)).multiply(g.userData.baseMat);
        } else if (m.type === 'ConveyorBelt' && /Coveyor/.test(nm)) {
          for (const ch of g.children) {
            const map = ch.material && ch.material.map; // this group's own cloned texture
            if (map) map.offset.y -= (p.speed || 2) * dt * 0.06;
          }
        }
      }
    }

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
      updateAnimations(world, built, dt);
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

    return { render, resize, setLevel, coinMesh, applyCamera, whenTexturesReady: () => Promise.all(pendingTex), get camera() { return camera; }, get built() { return built; }, get world() { return world; } };
  }

  return { buildScene, create, coinMesh, applyCamera, fitCameraToWorld, updateAnimations };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeRenderer };
