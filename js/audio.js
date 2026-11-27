function makeAudio() {
  let ctx = null;
  let muted = false;

  function ensure() {
    if (!ctx && typeof AudioContext !== 'undefined') {
      ctx = new AudioContext();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, slide) {
    if (muted) return;
    const ac = ensure();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ac.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur);
  }

  return {
    setMuted(m) { muted = m; },
    isMuted() { return muted; },
    drop() { tone(520, 0.08, 'triangle', 0.08, -120); },
    collect() { tone(880, 0.09, 'sine', 0.1, 220); },
    gem() { tone(1320, 0.15, 'sine', 0.12, 440); },
    buy() { tone(660, 0.07, 'square', 0.06); setTimeout(() => tone(990, 0.1, 'square', 0.06), 70); },
    deny() { tone(160, 0.15, 'sawtooth', 0.07, -60); },
    levelUp() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'triangle', 0.1), i * 90)); },
    shake() { tone(90, 0.2, 'sawtooth', 0.12, 40); },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeAudio };
}
