"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const RIG_SELECTORS = [
  ".js-head", ".js-neck", ".js-torso", ".js-thigh-f", ".js-shin-f", ".js-thigh-b", ".js-shin-b",
  ".js-forefoot-f", ".js-forefoot-b", ".js-uarm-f", ".js-farm-f", ".js-uarm-b", ".js-farm-b",
  ".js-j-shoulder", ".js-j-hip", ".js-j-knee", ".js-j-elbow", ".js-weight", ".js-weight-cap",
  ".js-weight-b", ".js-kb-handle-f", ".js-bar-shaft", ".js-bar-hub", ".js-band-f", ".js-band-b",
  ".js-cable", ".js-cable-grip", ".js-shadow", ".js-aura", ".js-ring", ".js-pulse",
];

let distDir = process.env.TA_DIST_DIR || "";
let ownedTempDir = "";
let catalog = null;
const toCamel = (s) => s.replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());

function parseSvgOpenAttrs(markup) {
  const openTag = markup.slice(0, markup.indexOf(">") + 1);
  const attrs = {};
  for (const m of openTag.matchAll(/([a-zA-Z0-9_:-]+)="([^"]*)"/g)) {
    attrs[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }
  return attrs;
}

const makeParam = (init) => ({
  value: init,
  setValueAtTime(v) { this.value = v; },
  linearRampToValueAtTime(v) { this.value = v; },
  exponentialRampToValueAtTime(v) { this.value = v; },
});

let lastAudioCtx = null;
class MockAudioContext {
  constructor() {
    this.currentTime = 10.0; this.state = "running"; this.sampleRate = 44100;
    this.destination = { kind: "dest" }; this.sources = []; this.nodes = [];
    lastAudioCtx = this;
  }
  resume() { return Promise.resolve(); }
  _src(extra) {
    const s = Object.assign({
      started: false, immediateStopped: false, disconnected: false, onended: null,
      connect() {}, disconnect() { this.disconnected = true; },
      start() { this.started = true; }, stop(...a) { if (a.length === 0) this.immediateStopped = true; },
    }, extra);
    this.sources.push(s); this.nodes.push(s); return s;
  }
  createOscillator() { return this._src({ type: "sine", frequency: makeParam(440), detune: makeParam(0) }); }
  createBufferSource() { return this._src({ buffer: null }); }
  createGain() {
    const g = { gain: makeParam(1), disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
    this.nodes.push(g); return g;
  }
  createBiquadFilter() {
    const f = { type: "lowpass", frequency: makeParam(1000), Q: makeParam(1), disconnected: false, connect() {}, disconnect() { this.disconnected = true; } };
    this.nodes.push(f); return f;
  }
  createBuffer(_ch, len, sr) {
    const arr = new Float32Array(len);
    return { sampleRate: sr, length: len, getChannelData: () => arr };
  }
}

class MockNode {
  constructor(tag) {
    this.tagName = String(tag || "DIV").toUpperCase();
    this.children = []; this.parentNode = null;
    this.attrs = {}; this.dataset = {}; this.style = {};
    this.listeners = new Map();
    this._className = ""; this._textContent = ""; this._innerHTML = "";
    this.hidden = false; this.disabled = false; this.checked = false; this.value = "";
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
      const rigMap = Object.fromEntries(RIG_SELECTORS.map((sel) => [sel, new MockNode("g")]));
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
  focus() {}
  blur() {}
  select() {}
  matches(sel) {
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

before(() => {
  if (!distDir || !fs.existsSync(path.join(distDir, "data", "catalog.json"))) {
    ownedTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-ui-audio-"));
    distDir = path.join(ownedTempDir, "dist");
    execFileSync("uv", ["run", "training-aid", "--build-only", "--out-dir", distDir], { cwd: REPO_ROOT, stdio: "ignore" });
  }
  catalog = JSON.parse(fs.readFileSync(path.join(distDir, "data", "catalog.json"), "utf8"));
  globalThis.window = globalThis;
  globalThis.AudioContext = MockAudioContext;
});

after(() => { if (ownedTempDir) fs.rmSync(ownedTempDir, { recursive: true, force: true }); });

test("motion.js FK parity & safe-grip bounds across all 126 catalog.svgs", () => {
  new Function(fs.readFileSync(path.join(distDir, "static", "motion.js"), "utf8"))();
  const TM = globalThis.TrainingMotion;
  const entries = Object.entries(catalog.svgs);
  assert.equal(entries.length, 126);

  for (const [svgKey, markup] of entries) {
    assert.ok(svgKey.includes(":"));
    const dataset = {};
    for (const [k, v] of Object.entries(parseSvgOpenAttrs(markup))) {
      if (k.startsWith("data-")) dataset[toCamel(k.slice(5))] = v;
    }
    const els = Object.fromEntries(
      RIG_SELECTORS.map((sel) => [sel, { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }])
    );
    const rig = TM.bindSvg({ dataset, querySelector: (sel) => els[sel] || null });
    for (const t of [0, 0.5, 1]) rig.applyPose(t, { swapSides: t === 1 });
    rig.applyHold(0.25); rig.applyRestBreath(0.8); rig.applyPose(0.5);

    const hf = [Number(els[".js-farm-f"].attrs.x2), Number(els[".js-farm-f"].attrs.y2)];
    if (dataset.equipment === "barbell" || dataset.equipment === "dumbbell") {
      const wf = [Number(els[".js-weight"].attrs.cx), Number(els[".js-weight"].attrs.cy)];
      assert.ok(Math.hypot(wf[0] - hf[0], wf[1] - hf[1]) <= 0.03);
    } else if (dataset.equipment === "kettlebells") {
      const hdl = [Number(els[".js-kb-handle-f"].attrs.cx), Number(els[".js-kb-handle-f"].attrs.cy)];
      assert.ok(Math.hypot(hdl[0] - hf[0], hdl[1] - hf[1]) <= 3.0);
    }
  }
});

test("sound.js 5 themes, retimePhase, {2, 4, 8} subdivisions, zero localStorage, and node cleanup", () => {
  for (const rel of ["sound-presets.js", "sound-pattern.js", "sound-synth.js", "sound.js"]) {
    const src = fs.readFileSync(path.join(distDir, "static", rel), "utf8");
    assert.ok(!src.includes("localStorage"), `${rel} must not reference localStorage`);
    new Function(src)();
  }
  const TM = globalThis.TrainingMotion;
  const TS = globalThis.TrainingSound;
  assert.equal(TS.subdivisionsForRep(1.0, true), 2);
  assert.equal(TS.subdivisionsForRep(2.2, false), 4);
  assert.equal(TS.subdivisionsForRep(2.8, false), 8);

  const ctrl = TS.createController({ turnaroundForMode: TM.turnaroundForMode });
  const ctx = ctrl.ensureAudio();
  ctrl.beginPhase("ACTIVE", { repSeconds: 2.8, reps: 4, tempoMode: "standard", isHold: false });
  ctx.currentTime = 11.4;
  assert.ok(Math.abs(ctrl.advancePhase(0.016) - 1.4) < 1e-6);
  ctrl.retimePhase({ repSeconds: 2.0 }, 1.0);
  ctx.currentTime = 11.5;
  assert.ok(Math.abs(ctrl.advancePhase(0.016) - 1.1) < 1e-6);
  ctx.currentTime = 11.7;
  ctrl.retimePhase({ repSeconds: 1.8 });
  assert.ok(Math.abs(ctrl.advancePhase(0.016) - 1.3) < 1e-6);
  ctrl.stopAll();
  assert.ok(ctx.sources.every((s) => s.immediateStopped && s.disconnected));
});

test("multiselect setup, non-destructive filter, on-the-fly #quick, strict full completion & date-time stats", async () => {
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
  const toastRoot = new MockNode("div"); toastRoot.id = "toast-root";
  docRoot.replaceChildren(topbar, appRoot, modalRoot, toastRoot);

  const storageMap = new Map();
  const domStorage = {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => { storageMap.set(String(k), String(v)); },
    removeItem: (k) => { storageMap.delete(k); },
    clear: () => { storageMap.clear(); },
  };
  const winListeners = new Map();
  let currentHash = "#edit/%";
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
    localStorage: domStorage, __TRAINING_CATALOG__: catalog,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: (cb) => { const id = timerSeq++; rafQueue.set(id, cb); return id; },
    cancelAnimationFrame: (id) => { rafQueue.delete(id); },
    setInterval: (cb) => { const id = timerSeq++; activeIntervals.set(id, cb); return id; },
    clearInterval: (id) => { activeIntervals.delete(id); },
    history: { replaceState(_s, _t, url) { const i = String(url).indexOf("#"); currentHash = i >= 0 ? String(url).slice(i) : ""; } },
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
      readyState: "complete", hidden: false, title: "", body: docRoot, documentElement: docRoot,
      createElement: (tag) => new MockNode(tag), createElementNS: (_ns, tag) => new MockNode(tag),
      createTextNode: (txt) => { const t = new MockNode("#text"); t.textContent = String(txt); return t; },
      getElementById: (id) => docRoot.querySelector("#" + id),
      querySelector: (sel) => docRoot.querySelector(sel), querySelectorAll: (sel) => docRoot.querySelectorAll(sel),
      addEventListener: (t, fn, o) => docRoot.addEventListener(t, fn, o),
      removeEventListener: (t, fn) => docRoot.removeEventListener(t, fn),
    },
  });

  function stepFrames(deltaSeconds) {
    if (lastAudioCtx) lastAudioCtx.currentTime += deltaSeconds;
    simTs += deltaSeconds * 1000;
    const pending = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, cb] of pending) cb(simTs);
  }

  for (const rel of [
    "domain.js", "recommender.js", "codec.js", "store.js", "qr.js", "dom.js",
    "views/setup.js", "views/plan.js", "views/quick.js", "views/edit.js", "views/workout.js", "views/progress.js",
  ]) {
    new Function(fs.readFileSync(path.join(distDir, rel), "utf8"))();
  }

  new Function(fs.readFileSync(path.join(distDir, "app.js"), "utf8"))();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(currentHash, "#setup");

  // Setup with XSS attempt in name + multiselect equipment (Dumbbells + Bands) + Fast tempo + 15s rest
  const setupForm = appRoot.querySelector(".setup-form");
  const allInputs = setupForm.querySelectorAll("input");
  allInputs.find((n) => n.attrs.name === "name").value = "<img src=x onerror=alert(1)>";
  for (const inp of allInputs) {
    if (inp.attrs.name === "equipment") inp.checked = inp.value === "dumbbell" || inp.value === "bands";
    if (inp.attrs.name === "speed_mode") inp.checked = inp.value === "fast";
    if (inp.attrs.name === "rest_seconds") inp.checked = inp.value === "15";
  }
  setupForm.dispatchEvent({ type: "submit" });

  assert.equal(currentHash, "#plan");
  assert.ok(appRoot.textContent.includes("Recommended Today"));
  assert.ok(appRoot.textContent.includes("Intensity 100%"));
  assert.equal(docRoot.querySelectorAll("*").filter((n) => n.attrs && ("onerror" in n.attrs || n.tagName === "SCRIPT")).length, 0);

  // Open On-the-Fly (#quick), generate workout, trim to 1 fast set so we can test full workout completion end-to-end
  globalThis.location.hash = "#quick";
  assert.ok(Boolean(docRoot.getElementById("quick-generate-btn")));
  docRoot.getElementById("quick-generate-btn").click();
  let removeBtns = appRoot.querySelectorAll("button").filter((b) => b.attrs["aria-label"] === "Remove");
  while (removeBtns.length > 1) {
    removeBtns[removeBtns.length - 1].click();
    removeBtns = appRoot.querySelectorAll("button").filter((b) => b.attrs["aria-label"] === "Remove");
  }
  const numInputs = appRoot.querySelectorAll(".rx-num-input");
  numInputs[0].value = "2"; numInputs[0].dispatchEvent({ type: "change" });
  numInputs[1].value = "2"; numInputs[1].dispatchEvent({ type: "change" });

  // Launch ad-hoc workout and verify strict completion rules
  globalThis.location.hash = "#workout/adhoc";
  assert.equal(topbar.hidden, true);
  assert.equal(docRoot.getElementById("early-finish-btn"), null, "Early finish button must not exist");

  const primaryBtn = docRoot.getElementById("primary-btn");
  const skipBtn = docRoot.getElementById("skip-btn");
  const viewport = docRoot.getElementById("workout-viewport");

  // Start -> COUNTDOWN (skip allowed) -> ACTIVE (skip forbidden!)
  primaryBtn.click();
  assert.equal(viewport.dataset.state, "COUNTDOWN");
  assert.equal(skipBtn.style.display, "inline-flex");
  skipBtn.click();
  assert.equal(viewport.dataset.state, "ACTIVE");
  assert.equal(skipBtn.style.display, "none");

  // Clicking skip or ArrowRight during ACTIVE must NOT skip the set
  skipBtn.click();
  for (const fn of [...(winListeners.get("keydown") || [])]) fn({ code: "ArrowRight", preventDefault() {} });
  assert.equal(viewport.dataset.state, "ACTIVE");

  // Mid-workout Exit opens confirmation modal instead of logging or silently exiting
  docRoot.getElementById("exit-workout-btn").click();
  assert.equal(modalRoot.hidden, false);
  docRoot.getElementById("exit-cancel-btn").click();
  assert.equal(modalRoot.hidden, true);

  // Complete Set 1 by advancing elapsed time -> enters REST (skip & +15s visible)
  stepFrames(120);
  assert.equal(viewport.dataset.state, "REST");
  assert.equal(skipBtn.style.display, "inline-flex");
  assert.equal(docRoot.getElementById("extend-rest-btn").style.display, "inline-flex");
  docRoot.getElementById("extend-rest-btn").click();

  // Skip rest -> Set 2 ACTIVE -> complete Set 2 -> FINISHED
  skipBtn.click();
  assert.equal(viewport.dataset.state, "ACTIVE");
  stepFrames(120);
  assert.equal(viewport.dataset.state, "FINISHED");

  // Save completed workout -> navigates to #plan, then check #progress date/time & exercise log
  docRoot.getElementById("finish-save-btn").click();
  assert.equal(currentHash, "#plan");
  assert.ok(appRoot.textContent.includes("Done Today (1)"));

  globalThis.location.hash = "#progress";
  assert.ok(Boolean(appRoot.querySelector(".progress-svg-chart")));
  assert.ok(Boolean(appRoot.querySelector(".log-ex-list")));
  assert.ok(/20\d\d\s\u00b7\s\d\d:\d\d/.test(appRoot.textContent), "Stats must render local year and HH:MM time");
  assert.equal(activeIntervals.size, 0);
});
