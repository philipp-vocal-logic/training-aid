// Shared Node ESM test harness for Training Aid static PWA suites.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export const DEFAULT_RIG_SELECTORS = Object.freeze([
  ".js-head", ".js-neck", ".js-torso", ".js-thigh-f", ".js-shin-f", ".js-thigh-b", ".js-shin-b",
  ".js-forefoot-f", ".js-forefoot-b", ".js-uarm-f", ".js-farm-f", ".js-uarm-b", ".js-farm-b",
  ".js-j-shoulder", ".js-j-hip", ".js-j-knee", ".js-j-elbow", ".js-weight", ".js-weight-cap",
  ".js-weight-b", ".js-kb-handle-f", ".js-bar-shaft", ".js-bar-hub", ".js-band-f", ".js-band-b",
  ".js-cable", ".js-cable-grip", ".js-shadow", ".js-aura", ".js-ring", ".js-pulse",
  ".js-clavicle", ".js-pelvis", ".js-j-shoulder-b", ".js-j-hip-b", ".js-j-knee-b", ".js-j-elbow-b",
]);

export const toCamel = (s) => String(s).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());

export function parseSvgOpenAttrs(markup) {
  const openTag = markup.slice(0, markup.indexOf(">") + 1);
  const attrs = {};
  for (const m of openTag.matchAll(/([a-zA-Z0-9_:-]+)="([^"]*)"/g)) {
    attrs[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  return attrs;
}

export function makeRigElementMap(selectors = DEFAULT_RIG_SELECTORS) {
  return Object.fromEntries(
    selectors.map((sel) => [sel, { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }])
  );
}

export function resolveBuiltDist(prefix = "ta-esm-") {
  let distDir = process.env.TA_DIST_DIR || "";
  let ownedTempDir = "";
  if (!distDir || !fs.existsSync(path.join(distDir, "data", "catalog.json"))) {
    ownedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    distDir = path.join(ownedTempDir, "dist");
    execFileSync("uv", ["run", "training-aid", "--build-only", "--out-dir", distDir], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
  }
  const catalog = JSON.parse(fs.readFileSync(path.join(distDir, "data", "catalog.json"), "utf8"));
  return {
    distDir,
    catalog,
    cleanup() {
      if (ownedTempDir) fs.rmSync(ownedTempDir, { recursive: true, force: true });
    },
  };
}

export function importDistModule(distDir, ...segments) {
  return import(pathToFileURL(path.join(distDir, ...segments)).href);
}

export function makeMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [String(k), String(v)]));
  const writes = [];
  return {
    writes,
    getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
    setItem: (k, v) => { writes.push(String(k)); map.set(String(k), String(v)); },
    removeItem: (k) => { map.delete(String(k)); },
    clear: () => { map.clear(); },
  };
}

const makeAudioParam = (init) => ({
  value: init,
  setValueAtTime(v) { this.value = v; },
  linearRampToValueAtTime(v) { this.value = v; },
  exponentialRampToValueAtTime(v) { this.value = v; },
});

let lastAudioCtx = null;

export class MockAudioContext {
  constructor() {
    this.currentTime = 10.0; this.state = "running"; this.sampleRate = 44100;
    this.destination = { kind: "dest" }; this.sources = []; this.nodes = [];
    lastAudioCtx = this;
  }
  resume() { this.state = "running"; return Promise.resolve(); }
  _src(extra) {
    const s = Object.assign({
      started: false, immediateStopped: false, disconnected: false, onended: null,
      connect() {}, disconnect() { this.disconnected = true; },
      start() { this.started = true; }, stop(...a) { if (a.length === 0) this.immediateStopped = true; },
    }, extra);
    this.sources.push(s); this.nodes.push(s); return s;
  }
  createOscillator() { return this._src({ type: "sine", frequency: makeAudioParam(440), detune: makeAudioParam(0) }); }
  createBufferSource() { return this._src({ buffer: null }); }
  createGain() {
    const g = { gain: makeAudioParam(1), disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
    this.nodes.push(g); return g;
  }
  createBiquadFilter() {
    const f = { type: "lowpass", frequency: makeAudioParam(1000), Q: makeAudioParam(1), disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
    this.nodes.push(f); return f;
  }
  createBuffer(_ch, len, sr) {
    const arr = new Float32Array(len);
    return { sampleRate: sr, length: len, getChannelData: () => arr };
  }
}

export class MockNode {
  constructor(tag) {
    this.tagName = String(tag || "DIV").toUpperCase();
    this.children = []; this.parentNode = null;
    this.attrs = {}; this.dataset = {}; this.style = {};
    this.listeners = new Map();
    this._className = ""; this._textContent = ""; this._innerHTML = "";
    this.hidden = false; this.disabled = false; this.checked = false; this.value = "";
    this.open = false; this.files = null;
    const tokens = () => new Set(this._className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...cls) => { const s = tokens(); for (const c of cls) s.add(c); this._className = [...s].join(" "); },
      remove: (...cls) => { const s = tokens(); for (const c of cls) s.delete(c); this._className = [...s].join(" "); },
      toggle: (c, f) => {
        const s = tokens();
        if (f !== undefined ? Boolean(f) : !s.has(c)) s.add(c); else s.delete(c);
        this._className = [...s].join(" ");
      },
      contains: (c) => tokens().has(c),
    };
  }
  get id() { return this.attrs.id || ""; }
  set id(v) { this.attrs.id = String(v); }
  get className() { return this._className; }
  set className(v) { this._className = String(v); }
  get textContent() {
    return this.children.length === 0 ? this._textContent : this._textContent + this.children.map((c) => c.textContent || "").join("");
  }
  set textContent(v) { this.children = []; this._innerHTML = ""; this._textContent = String(v); }
  get innerHTML() { return this._innerHTML; }
  set innerHTML(markup) {
    this.children = []; this._textContent = ""; this._innerHTML = String(markup);
    if (this._innerHTML.trim().startsWith("<svg")) {
      const svgChild = new MockNode("svg");
      for (const [k, v] of Object.entries(parseSvgOpenAttrs(this._innerHTML))) svgChild.setAttribute(k, v);
      const rigMap = Object.fromEntries(DEFAULT_RIG_SELECTORS.map((sel) => [sel, new MockNode("g")]));
      svgChild.querySelector = (sel) => rigMap[sel] || null;
      this.appendChild(svgChild);
    }
  }
  setAttribute(k, v) {
    const sv = String(v); this.attrs[k] = sv;
    if (k === "class") this._className = sv;
    if (k.startsWith("data-")) this.dataset[toCamel(k.slice(5))] = sv;
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  appendChild(ch) { if (ch) { ch.parentNode = this; this.children.push(ch); } return ch; }
  removeChild(ch) { const i = this.children.indexOf(ch); if (i >= 0) { this.children.splice(i, 1); ch.parentNode = null; } return ch; }
  replaceChildren(...nodes) { this.children = []; this._textContent = ""; this._innerHTML = ""; for (const n of nodes) if (n) this.appendChild(n); }
  addEventListener(type, fn, opts) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    const set = this.listeners.get(type); set.add(fn);
    if (opts && opts.signal) opts.signal.addEventListener("abort", () => set.delete(fn), { once: true });
  }
  removeEventListener(type, fn) { const s = this.listeners.get(type); if (s) s.delete(fn); }
  dispatchEvent(evt) {
    const e = Object.assign({ preventDefault() {}, stopPropagation() {}, target: this }, evt);
    for (const fn of [...(this.listeners.get(e.type) || [])]) fn(e);
  }
  click() { this.dispatchEvent({ type: "click" }); }
  focus() {
    if (typeof globalThis.document !== "undefined" && globalThis.document) {
      globalThis.document.activeElement = this;
    }
  }
  blur() {
    if (
      typeof globalThis.document !== "undefined" &&
      globalThis.document &&
      globalThis.document.activeElement === this
    ) {
      globalThis.document.activeElement = globalThis.document.body || null;
    }
  }
  select() {}
  showModal() {
    this.open = true;
    this.setAttribute("open", "");
  }
  close() {
    this.open = false;
    this.removeAttribute("open");
  }
  matches(sel) {
    if (sel.includes(",")) return sel.split(",").some((s) => this.matches(s.trim()));
    if (sel === "*") return true;
    if (sel.startsWith("#")) return this.id === sel.slice(1);
    if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
    return sel === "a[data-nav]" ? this.tagName === "A" && "nav" in this.dataset : this.tagName === sel.toUpperCase();
  }
  getElementById(id) { return this.querySelector("#" + id); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = (n) => { for (const ch of n.children || []) { if (ch.matches && ch.matches(sel)) out.push(ch); walk(ch); } };
    walk(this); return out;
  }
}

export function installBrowserEnv({ catalog = null, initialHash = "#edit/%", manualBoot = true } = {}) {
  const docRoot = new MockNode("body");
  const topbar = new MockNode("header"); topbar.id = "app-topbar";
  const brandLink = new MockNode("a"); brandLink.id = "brand-home-link";
  const nav = new MockNode("nav"); nav.id = "primary-nav";
  for (const key of ["plan", "quick", "progress", "setup"]) {
    const a = new MockNode("a"); a.dataset.nav = key; nav.appendChild(a);
  }
  topbar.replaceChildren(brandLink, nav);
  const appRoot = new MockNode("div"); appRoot.id = "app-root";
  const modalRoot = new MockNode("div"); modalRoot.id = "modal-root"; modalRoot.hidden = true;
  docRoot.replaceChildren(topbar, appRoot, modalRoot);

  const storage = makeMemoryStorage();
  const winListeners = new Map();
  let currentHash = initialHash;
  const activeIntervals = new Map();
  const rafQueue = new Map();
  let timerSeq = 1;
  let simTs = 1000;

  Object.defineProperty(globalThis, "navigator", {
    value: { storage: { persist: () => Promise.resolve(true) } },
    configurable: true,
    writable: true,
  });

  Object.assign(globalThis, {
    window: globalThis,
    AudioContext: MockAudioContext,
    localStorage: storage,
    __TRAINING_CATALOG__: catalog,
    __TA_MANUAL_BOOT__: Boolean(manualBoot),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (cb) => { const id = timerSeq++; rafQueue.set(id, cb); return id; },
    cancelAnimationFrame: (id) => { rafQueue.delete(id); },
    setInterval: (cb) => { const id = timerSeq++; activeIntervals.set(id, cb); return id; },
    clearInterval: (id) => { activeIntervals.delete(id); },
    history: {
      replaceState(_s, _t, url) {
        const i = String(url).indexOf("#");
        currentHash = i >= 0 ? String(url).slice(i) : "";
      },
    },
    location: {
      protocol: "https:", origin: "https://trainer.local", pathname: "/", search: "",
      get href() { return "https://trainer.local/" + currentHash; },
      get hash() { return currentHash; },
      set hash(v) {
        const next = v.startsWith("#") ? v : "#" + v;
        if (currentHash !== next) {
          currentHash = next;
          for (const fn of [...(winListeners.get("hashchange") || [])]) fn({ type: "hashchange" });
        }
      },
    },
    addEventListener: (type, fn, opts) => {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      const set = winListeners.get(type); set.add(fn);
      if (opts && opts.signal) opts.signal.addEventListener("abort", () => set.delete(fn), { once: true });
    },
    removeEventListener: (type, fn) => { const s = winListeners.get(type); if (s) s.delete(fn); },
    document: {
      readyState: "complete", hidden: false, title: "", body: docRoot, documentElement: docRoot, activeElement: docRoot,
      createElement: (tag) => new MockNode(tag), createElementNS: (_ns, tag) => new MockNode(tag),
      createTextNode: (txt) => { const t = new MockNode("#text"); t.textContent = String(txt); return t; },
      getElementById: (id) => docRoot.querySelector("#" + id),
      querySelector: (sel) => docRoot.querySelector(sel), querySelectorAll: (sel) => docRoot.querySelectorAll(sel),
      addEventListener: (t, fn, o) => docRoot.addEventListener(t, fn, o),
      removeEventListener: (t, fn) => docRoot.removeEventListener(t, fn),
    },
  });

  function stepFrames(deltaSeconds) {
    const viewport = docRoot.getElementById("workout-viewport");
    const startState = viewport ? viewport.dataset.state : null;
    let remaining = Number(deltaSeconds) || 0;
    while (remaining > 0 && rafQueue.size > 0) {
      const step = remaining > 1 && startState ? 0.1 : remaining;
      remaining = Math.max(0, remaining - step);
      if (lastAudioCtx) lastAudioCtx.currentTime += step;
      simTs += step * 1000;
      const pending = [...rafQueue.entries()];
      rafQueue.clear();
      for (const [, cb] of pending) cb(simTs);
      if (startState && viewport && viewport.dataset.state !== startState) break;
    }
  }

  return {
    docRoot, topbar, appRoot, modalRoot, storage, activeIntervals, rafQueue, winListeners,
    getHash: () => currentHash,
    setHash: (h) => { globalThis.location.hash = h; },
    stepFrames,
  };
}
