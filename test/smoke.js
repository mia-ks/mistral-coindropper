const fs = require('fs');
const path = require('path');
const vm = require('vm');

function ctx2dStub(counter) {
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return () => ({ width: 10 });
      if (typeof k === 'string') {
        return (...a) => { counter.n++; };
      }
      return undefined;
    },
    set() { return true; },
  });
}

function elStub(id, counter) {
  const el = {
    id,
    children: [],
    style: {},
    textContent: '',
    innerHTML: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    querySelector() { return elStub('q', counter); },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (el._listeners ||= {})[type] = fn; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    parentElement: null,
    width: 800,
    height: 600,
    getContext() { return ctx2dStub(counter); },
  };
  Object.defineProperty(el, 'childElementCount', { get() { return this.children.length; } });
  return el;
}

const counter = { n: 0 };
const elements = {};
const canvas = elStub('game', counter);
canvas.parentElement = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };

const storageMap = new Map();
const sandbox = {
  console,
  module: undefined,
  performance: { now: () => sandbox.__now },
  __now: 0,
  requestAnimationFrame: (cb) => { sandbox.__raf = cb; },
  localStorage: {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(k, String(v)),
    removeItem: (k) => storageMap.delete(k),
  },
  document: {
    getElementById: (id) => {
      if (id === 'game') return canvas;
      if (!elements[id]) elements[id] = elStub(id, counter);
      return elements[id];
    },
    addEventListener() {},
    hidden: false,
    createElement: (tag) => elStub(tag, counter),
  },
  window: { addEventListener() {} },
  addEventListener() {},
  confirm: () => true,
  AudioContext: undefined,
  setTimeout: (fn) => 0,
  clearTimeout() {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const f of ['config.js', 'engine.js', 'game.js', 'render.js', 'audio.js', 'main.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}

let frames = 0;
function runFrames(n, dtMs) {
  for (let i = 0; i < n; i++) {
    sandbox.__now += dtMs;
    const cb = sandbox.__raf;
    sandbox.__raf = null;
    cb(sandbox.__now);
    frames++;
  }
}

runFrames(30, 16.7);
canvas._listeners.pointerdown({ clientX: 400, clientY: 300 });
runFrames(30, 16.7);
canvas._listeners.pointerdown({ clientX: 500, clientY: 300 });
runFrames(600, 16.7);

if (!(counter.n > 100)) throw new Error('renderer did not draw, draw calls=' + counter.n);
if (!storageMap.has('coindozer-clean-save-v1')) throw new Error('no save written');
const save = JSON.parse(storageMap.get('coindozer-clean-save-v1'));
if (save.totalDrops < 2) throw new Error('drops not registered: ' + save.totalDrops);
console.log('smoke ok:', frames, 'frames,', counter.n, 'draw calls, totalDrops =', save.totalDrops, ', coins =', Math.floor(save.coins));
