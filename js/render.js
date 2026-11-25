// Three.js renderer for the extracted machine. All static geometry is the REAL Unity
// mesh data exported from the APK (js/meshlib.js + per-level meshData in
// js/level_layouts.js, mirrored x -> -x into right-handed three.js with matching
// quaternion camera from LevelCameraBounds). Only coins are procedural (they are
// spawned at runtime in the original too), plus the background gradient plane.
const _MESH_LIB = (typeof MESH_LIB !== 'undefined') ? MESH_LIB
  : ((typeof module !== 'undefined' && module.exports) ? require('./meshlib.js').MESH_LIB : null);

function makeRenderer(CONFIG, LEVELS, THREE) {
  const W = CONFIG.world;
  const LIB = _MESH_LIB;

  // ---- caches: one BufferGeometry per submesh, one material per color ----
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
        g.setIndex(sub.idx);
        g.computeVertexNormals();
        list.push(g);
      }
    }
    geoCache.set(name, list);
    return list;
  }

  const matCache = new Map();
  function matFor(colors, i) {
    const c = (colors && colors.length ? colors[i % colors.length] : null) || [0.8, 0.8, 0.8];
    const key = c[0].toFixed(4) + ',' + c[1].toFixed(4) + ',' + c[2].toFixed(4);
    if (!matCache.has(key)) {
      matCache.set(key, new THREE.MeshStandardMaterial({
        color: new THREE.Color(c[0], c[1], c[2]), roughness: 0.75, metalness: 0.15,
      }));
    }
    return matCache.get(key);
  }

  // one THREE.Group per exported instance, one Mesh per submesh (per-submesh material)
  function addInstance(scene, inst) {
    const geos = geomsFor(inst.mesh);
    const grp = new THREE.Group();
    for (let s = 0; s < geos.length; s++) {
      const mesh = new THREE.Mesh(geos[s], matFor(inst.colors, s));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      grp.add(mesh);
    }
    grp.position.set(inst.pos[0], inst.pos[1], inst.pos[2]);
    grp.quaternion.set(inst.quat[0], inst.quat[1], inst.quat[2], inst.quat[3]);
    grp.scale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
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
        dozerAnims.push({ grp, base: d.pos.slice(), tierName: d.tier });
      }
    }

    const coinGroup = new THREE.Group();
    scene.add(coinGroup);

    return { scene, instanceGroups, dozerAnims, coinGroup };
  }

  function applyCamera(camera, level, aspect, world) {
    camera.near = 3;
    camera.far = 2000;
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
        if (v.z < -1 || v.z > 1 || Math.abs(v.x) > margin || Math.abs(v.y) > margin) return false;
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
      // dozer plates ride their tier's pusher along its sweep axis
      for (const da of built.dozerAnims) {
        const tier = world.tiers.find((t) => t.name === da.tierName);
        const p = tier && tier.pusher;
        if (!p) continue;
        const delta = p.pos - p.back;
        if (p.axis === 'x') da.grp.position.set(da.base[0] + delta, da.base[1], da.base[2]);
        else da.grp.position.set(da.base[0], da.base[1], da.base[2] + delta);
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

    return { render, resize, setLevel, coinMesh, applyCamera, get camera() { return camera; }, get built() { return built; }, get world() { return world; } };
  }

  return { buildScene, create, coinMesh, applyCamera, fitCameraToWorld };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { makeRenderer };
