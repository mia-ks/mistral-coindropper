function makeRenderer(CONFIG, LEVELS) {
  const W = CONFIG.world;

  function view(canvas) {
    const scale = canvas.width / W.width;
    const topPad = 34;
    return {
      scale,
      toScreenX: (x) => x * scale,
      toScreenY: (y) => canvas.height - topPad - y * scale,
      toWorldX: (sx) => sx / scale,
    };
  }

  function drawMachine(ctx, v, m, time, engine) {
    const x = v.toScreenX(engine.machineX(m, time));
    const y = v.toScreenY(0);
    const s = v.scale;
    ctx.save();
    if (m.type === 'conveyor') {
      const w = m.w * s;
      ctx.fillStyle = '#3a4a63';
      ctx.fillRect(x - w / 2, y - 1.2 * s, w, 1.2 * s);
      ctx.fillStyle = '#55688a';
      const off = (time * m.speed * 4) % (1.2 * s);
      for (let i = -1; i < w / (1.2 * s) + 1; i++) {
        ctx.beginPath();
        ctx.arc(x - w / 2 + i * 1.2 * s + off, y - 0.6 * s, 0.45 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (m.type === 'fan') {
      const fy = v.toScreenY(m.y);
      ctx.fillStyle = '#2e6f8e';
      ctx.beginPath();
      ctx.arc(x, fy, 1.6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(140,220,255,0.7)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const ph = (time * 3 + i * 0.7) % 1;
        ctx.globalAlpha = 1 - ph;
        ctx.beginPath();
        ctx.moveTo(x, fy);
        ctx.lineTo(x + (Math.sin(i) * 0.4) * s, fy - (2 + ph * 6) * s);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    } else if (m.type === 'magnet' || m.type === 'movingMagnet' || m.type === 'suction') {
      const fy = v.toScreenY(m.y);
      ctx.fillStyle = m.type === 'suction' ? '#7a4ad6' : '#c0392b';
      ctx.beginPath();
      ctx.arc(x, fy, 1.5 * s, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(x - 1.5 * s, fy, 3 * s, 1 * s);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.arc(x, fy, (m.r || 8) * s * (0.9 + 0.1 * Math.sin(time * 4)), 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.type === 'launcher') {
      const fy = v.toScreenY(m.y);
      ctx.fillStyle = '#b8860b';
      ctx.beginPath();
      ctx.moveTo(x - 1.8 * s, y);
      ctx.lineTo(x, fy - 0.5 * s);
      ctx.lineTo(x + 1.8 * s, y);
      ctx.fill();
      if (m.timer < 0.15) {
        ctx.fillStyle = 'rgba(255,220,80,0.9)';
        ctx.beginPath();
        ctx.arc(x, fy, 2.2 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (m.type === 'portal') {
      const fy = v.toScreenY(5);
      const pulse = 1 + 0.15 * Math.sin(time * 5);
      ctx.strokeStyle = '#b44aff';
      ctx.lineWidth = 0.5 * s;
      ctx.beginPath();
      ctx.ellipse(x, fy, 1.2 * s * pulse, 3 * s * pulse, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (m.type === 'gate') {
      ctx.fillStyle = '#27ae60';
      ctx.fillRect(x - 0.4 * s, y, 0.8 * s, 6 * s);
      ctx.fillStyle = '#2ecc71';
      ctx.font = `${Math.round(2.2 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('x2', x, v.toScreenY(7.2));
    } else if (m.type === 'dollarGate') {
      ctx.fillStyle = '#145a32';
      ctx.fillRect(x - 0.4 * s, y, 0.8 * s, 6 * s);
      ctx.fillStyle = '#7dcea0';
      ctx.font = `${Math.round(2.2 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('$', x, v.toScreenY(7.2));
    } else if (m.type === 'spike') {
      ctx.fillStyle = '#e74c3c';
      const n = Math.max(2, Math.round(m.w));
      for (let i = 0; i < n; i++) {
        const sx = x - (m.w / 2) * s + (i + 0.5) * (m.w * s / n);
        ctx.beginPath();
        ctx.moveTo(sx - 0.5 * s, y);
        ctx.lineTo(sx, y - 2.2 * s);
        ctx.lineTo(sx + 0.5 * s, y);
        ctx.fill();
      }
    } else if (m.type === 'platform') {
      const w = m.w * s;
      const px = x - w / 2 + Math.sin(time * 1.2) * 1.5 * s;
      ctx.fillStyle = '#8e6e3a';
      ctx.fillRect(px, y - 0.8 * s, w, 0.8 * s);
    } else if (m.type === 'laser') {
      const fy = v.toScreenY(11);
      ctx.strokeStyle = '#555';
      ctx.lineWidth = 0.4 * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, fy);
      ctx.stroke();
      if (m.laserOn) {
        ctx.strokeStyle = 'rgba(255,60,60,0.85)';
        ctx.lineWidth = 0.5 * s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, fy);
        ctx.stroke();
      }
    }
    if (m.level > 0) {
      ctx.fillStyle = '#ffd24a';
      ctx.font = `${Math.round(1.8 * s)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('★'.repeat(Math.min(m.level, 5)), x, y - 0.8 * s);
    }
    ctx.restore();
  }

  function draw(ctx, canvas, world, game, fx, time) {
    const v = view(canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, '#101828');
    bg.addColorStop(1, '#1c2b45');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, canvas.height - 34, canvas.width, 34);
    const platY = v.toScreenY(0);
    const g = ctx.createLinearGradient(0, platY - 2 * v.scale, 0, canvas.height - 34);
    g.addColorStop(0, '#4a3b28');
    g.addColorStop(1, '#241c12');
    ctx.fillStyle = g;
    ctx.fillRect(v.toScreenX(W.backX), platY, (W.edgeX - W.backX) * v.scale, canvas.height - 34 - platY);
    ctx.fillStyle = '#6b5636';
    ctx.fillRect(v.toScreenX(W.backX), platY - 0.35 * v.scale, (W.edgeX - W.backX) * v.scale, 0.35 * v.scale);
    ctx.fillStyle = '#33291b';
    ctx.fillRect(0, platY - 0.35 * v.scale, v.toScreenX(W.backX), canvas.height - platY);

    const trayX = v.toScreenX(W.edgeX);
    ctx.fillStyle = 'rgba(80,200,120,0.25)';
    ctx.fillRect(trayX, platY - 8 * v.scale, canvas.width - trayX, 8 * v.scale);
    ctx.fillStyle = '#2ecc71';
    ctx.font = `${Math.round(2 * v.scale)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('COLLECT', trayX + (canvas.width - trayX) / 2, platY - 9.2 * v.scale);

    for (const m of world.machines) drawMachine(ctx, v, m, time, game.engine);

    const px = v.toScreenX(world.pusher.x);
    const pw = W.pusherThickness * v.scale;
    const ph = W.pusherHeight * v.scale;
    const pg = ctx.createLinearGradient(px, 0, px + pw, 0);
    pg.addColorStop(0, '#8fa3c8');
    pg.addColorStop(1, '#5d7099');
    ctx.fillStyle = pg;
    ctx.fillRect(px, v.toScreenY(W.pusherHeight), pw, ph);
    ctx.fillStyle = '#c8d4ea';
    ctx.fillRect(px, v.toScreenY(W.pusherHeight), pw, 0.5 * v.scale);

    for (const c of world.coins) {
      const def = CONFIG.coins.find((k) => k.id === c.type) || CONFIG.coins[0];
      const cx = v.toScreenX(c.x);
      const cy = v.toScreenY(c.y);
      const r = c.r * v.scale;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = def.color;
      ctx.fill();
      ctx.lineWidth = Math.max(1, r * 0.18);
      ctx.strokeStyle = def.rim;
      ctx.stroke();
      ctx.fillStyle = def.rim;
      ctx.font = `bold ${Math.round(r * 1.1)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def.symbol, cx, cy);
      ctx.textBaseline = 'alphabetic';
      if (c.mult > 1) {
        ctx.fillStyle = '#2ecc71';
        ctx.font = `${Math.round(r * 0.8)}px sans-serif`;
        ctx.fillText('x' + Math.round(c.mult), cx, cy - r - 2);
      }
    }

    for (const f of fx.floaters) {
      ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
      ctx.fillStyle = f.color || '#ffd24a';
      ctx.font = `bold ${Math.round(2.4 * v.scale)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(f.text, v.toScreenX(f.x), v.toScreenY(f.y) - (f.maxLife - f.life) * v.scale * 0.8);
      ctx.globalAlpha = 1;
    }
    for (const p of fx.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(v.toScreenX(p.x), v.toScreenY(p.y), p.r * v.scale * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  return { draw, view };
}

if (typeof module !== 'undefined' && module.exports) {
  const { CONFIG, LEVELS } = require('./config.js');
  module.exports = { makeRenderer, CONFIG, LEVELS };
}
