function makeRasterizer(THREE) {
  function render(world, built, W, H, camera) {
    if (!camera) {
      camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 120);
      camera.position.set(8.5, 11.5, 25);
      camera.lookAt(0, 0.2, 7.5);
    }
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const buf = new Uint8ClampedArray(W * H * 4);
    const zbuf = new Float32Array(W * H).fill(2);
    const bgTop = [0x8a, 0x63, 0xf0];
    const bgBot = [0x4a, 0x2f, 0x9e];
    for (let y = 0; y < H; y++) {
      const t = y / H;
      const r = bgTop[0] + (bgBot[0] - bgTop[0]) * t;
      const g = bgTop[1] + (bgBot[1] - bgTop[1]) * t;
      const b = bgTop[2] + (bgBot[2] - bgTop[2]) * t;
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
      }
    }
    const light = new THREE.Vector3(5, 14, 10).normalize();
    const tris = [];
    built.scene.updateMatrixWorld(true);
    built.scene.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      const geo = obj.geometry;
      const pos = geo.attributes.position;
      const idx = geo.index;
      const mat = obj.material;
      const col = mat.color ? [mat.color.r, mat.color.g, mat.color.b] : [0.7, 0.7, 0.7];
      const emis = mat.emissive ? [mat.emissive.r, mat.emissive.g, mat.emissive.b] : [0, 0, 0];
      const basic = mat.isMeshBasicMaterial;
      const verts = [];
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
        verts.push(v.clone());
      }
      const n = idx ? idx.count / 3 : pos.count / 3;
      for (let t = 0; t < n; t++) {
        const ia = idx ? idx.getX(t * 3) : t * 3;
        const ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
        const w0 = verts[ia], w1 = verts[ib], w2 = verts[ic];
        const p0 = w0.clone().project(camera);
        const p1 = w1.clone().project(camera);
        const p2 = w2.clone().project(camera);
        if (p0.z > 1 || p1.z > 1 || p2.z > 1) continue;
        const nrm = new THREE.Vector3().subVectors(w1, w0).cross(new THREE.Vector3().subVectors(w2, w0)).normalize();
        const inten = basic ? 1 : Math.min(1, 0.45 + 0.55 * Math.max(0, nrm.dot(light)));
        const toSRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
        tris.push({
          x: [((p0.x * 0.5 + 0.5) * W), ((p1.x * 0.5 + 0.5) * W), ((p2.x * 0.5 + 0.5) * W)],
          y: [((-p0.y * 0.5 + 0.5) * H), ((-p1.y * 0.5 + 0.5) * H), ((-p2.y * 0.5 + 0.5) * H)],
          z: [(p0.z + p1.z + p2.z) / 3, p0.z, p1.z, p2.z],
          rgb: [0, 1, 2].map((k) => Math.max(0, Math.min(255, Math.round(255 * toSRGB(Math.min(1, col[k] * inten + emis[k])))))),
        });
      }
    });
    tris.sort((a, b) => b.z[0] - a.z[0]);
    for (const t of tris) {
      const minX = Math.max(0, Math.floor(Math.min(...t.x)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(...t.x)));
      const minY = Math.max(0, Math.floor(Math.min(...t.y)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(...t.y)));
      const d1 = (t.y[1] - t.y[2]) * (t.x[0] - t.x[2]) + (t.x[2] - t.x[1]) * (t.y[0] - t.y[2]);
      if (Math.abs(d1) < 1e-9) continue;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const w0 = ((t.y[1] - t.y[2]) * (x - t.x[2]) + (t.x[2] - t.x[1]) * (y - t.y[2])) / d1;
          const w1 = ((t.y[2] - t.y[0]) * (x - t.x[2]) + (t.x[0] - t.x[2]) * (y - t.y[2])) / d1;
          const w2 = 1 - w0 - w1;
          if (w0 < -0.01 || w1 < -0.01 || w2 < -0.01) continue;
          const z = w0 * t.z[1] + w1 * t.z[2] + w2 * t.z[3];
          const i = y * W + x;
          if (z < zbuf[i]) {
            zbuf[i] = z;
            buf[i * 4] = t.rgb[0];
            buf[i * 4 + 1] = t.rgb[1];
            buf[i * 4 + 2] = t.rgb[2];
            buf[i * 4 + 3] = 255;
          }
        }
      }
    }
    return buf;
  }
  return { render };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeRasterizer };
}
