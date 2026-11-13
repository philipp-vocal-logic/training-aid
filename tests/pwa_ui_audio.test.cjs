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

class MockAudioContext {
  constructor() {
    this.currentTime = 10.0; this.state = "running"; this.sampleRate = 44100;
    this.destination = { kind: "dest" }; this.sources = []; this.nodes = [];
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
      RIG_SELECTORS.map((sel) => [sel, { attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); } }]),
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

test("sound.js 5 themes, {2, 4, 8} subdivisions, zero localStorage, and node cleanup", () => {
  for (const rel of ["sound-presets.js", "sound-pattern.js", "sound-synth.js", "sound.js"]) {
    const src = fs.readFileSync(path.join(distDir, "static", rel), "utf8");
    assert.ok(!src.includes("localStorage"), `${rel} must not reference localStorage`);
    new Function(src)();
  }
  const TM = globalThis.TrainingMotion;
  const TS = globalThis.TrainingSound;
  assert.deepEqual(TS.THEMES.map((t) => [t.id, t.label]), [
    ["off", "Off"], ["minimal", "Minimal Cues"], ["techno", "Techno Pulse"],
    ["trance", "Trance Arp"], ["studio", "Studio Kit"],
  ]);
  assert.equal(TS.subdivisionsForRep(1.0, true), 2);
  assert.equal(TS.subdivisionsForRep(2.2, false), 4);
  assert.equal(TS.subdivisionsForRep(2.8, false), 8);

  const byArch = new Map(catalog.exercises.map((ex) => [ex.archetype, ex]));
  assert.equal(byArch.size, 18);
  for (const meta of byArch.values()) {
    assert.equal(TS.buildRepPattern({ theme: "off", repSeconds: meta.rep_seconds }).length, 0);
    assert.equal(TS.buildRepPattern({ theme: "minimal", repSeconds: meta.rep_seconds }).length, 0);
    for (const theme of ["techno", "trance", "studio"]) {
      const pat = TS.buildRepPattern({
        theme, repSeconds: meta.rep_seconds, tempoMode: meta.tempo_mode,
        isHold: meta.is_hold, repIndex: 8, totalReps: 10,
      });
      assert.ok(pat.length >= 1 && pat[0].role === "downbeat" && pat[0].offsetSec === 0);
      assert.ok(pat.every((e) => e.isFinalStretch === true));
      const turns = pat.filter((e) => e.role === "turnaround");
      if (meta.is_hold) {
        assert.equal(turns.length, 0);
      } else {
        const expOff = Number((TM.turnaroundForMode(meta.tempo_mode) * meta.rep_seconds).toFixed(4));
        assert.equal(turns.length, 1);
        assert.equal(turns[0].offsetSec, expOff);
        for (const sub of pat.filter((e) => e.role === "subdivision")) {
          assert.ok(Math.abs(sub.offsetSec - expOff) >= 0.045);
        }
      }
    }
  }

  const ctrl = TS.createController({ turnaroundForMode: TM.turnaroundForMode });
  assert.equal(ctrl.getTheme(), "minimal");
  ctrl.setTheme("trance"); ctrl.toggleMute();
  assert.equal(ctrl.getTheme(), "off");
  assert.equal(ctrl.isMuted(), true);
  ctrl.toggleMute();
  assert.equal(ctrl.getTheme(), "trance");

  const ctx = ctrl.ensureAudio();
  ctrl.beginPhase("ACTIVE", { repSeconds: 2.8, reps: 4, tempoMode: "standard", isHold: false });
  assert.ok(ctx.sources.length > 0);
  ctx.currentTime = 10.65;
  assert.ok(Math.abs(ctrl.advancePhase(0.016) - 0.65) < 1e-6);

  const prePause = ctx.sources.slice();
  ctrl.pause();
  assert.ok(prePause.every((s) => s.immediateStopped && s.disconnected) && ctx.nodes.every((n) => n.disconnected));
  assert.ok(Math.abs(ctrl.advancePhase(0.5) - 0.65) < 1e-6);

  ctrl.resume(); ctrl.toggleMute();
  assert.ok(Math.abs(ctrl.advancePhase(0.25) - 0.9) < 1e-6);
  ctrl.toggleMute(); ctrl.startSignal(); ctrl.stopAll();
  assert.ok(ctx.sources.every((s) => s.immediateStopped && s.disconnected));
});

test("dom.js, views/*, and app.js routing, workout HUD sync, teardown, and XSS safety", async () => {
  const docRoot = new MockNode("body");
  const topbar = new MockNode("header"); topbar.id = "app-topbar";
  const brandLink = new MockNode("a"); brandLink.id = "brand-home-link";
  const nav = new MockNode("nav"); nav.id = "primary-nav";
  for (const key of ["plan", "progress", "setup"]) {
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
  let timerSeq = 1;

  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: () => Promise.resolve() }, storage: { persist: () => Promise.resolve(true) } },
    configurable: true,
    writable: true,
  });
  Object.assign(globalThis, {
    localStorage: domStorage, __TRAINING_CATALOG__: catalog,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    requestAnimationFrame: () => timerSeq++, cancelAnimationFrame: () => {},
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

  for (const rel of [
    "domain.js", "codec.js", "store.js", "qr.js", "dom.js",
    "views/setup.js", "views/plan.js", "views/edit.js", "views/workout.js", "views/progress.js",
  ]) {
    new Function(fs.readFileSync(path.join(distDir, rel), "utf8"))();
  }
  assert.ok(globalThis.TrainingDom.resolveSvgMarkup(catalog, "squat", "kettlebells").includes("js-kb-handle-f"));
  assert.equal(globalThis.TrainingDom.resolveSvgMarkup(catalog, "squat", "unknown"), catalog.svgs["squat:body_only"]);

  let stopAllCalls = 0;
  const origCreateCtrl = globalThis.TrainingSound.createController;
  globalThis.TrainingSound = Object.assign({}, globalThis.TrainingSound, {
    createController(opts) {
      const ctrl = origCreateCtrl(opts);
      const origStopAll = ctrl.stopAll.bind(ctrl);
      ctrl.stopAll = () => { stopAllCalls += 1; return origStopAll(); };
      return ctrl;
    },
  });

  new Function(fs.readFileSync(path.join(distDir, "app.js"), "utf8"))();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(currentHash, "#setup");

  const setupForm = appRoot.querySelector(".setup-form");
  const allInputs = setupForm.querySelectorAll("input");
  allInputs.find((n) => n.attrs.name === "name").value = "<img src=x onerror=alert(1)>";
  const fullGymRadio = allInputs.find((n) => n.attrs.name === "equipment" && n.value === "full_gym");
  for (const inp of allInputs) if (inp.attrs.name === "equipment") inp.checked = inp === fullGymRadio;
  fullGymRadio.dispatchEvent({ type: "change" });
  setupForm.dispatchEvent({ type: "submit" });

  assert.equal(currentHash, "#plan");
  assert.equal(docRoot.querySelectorAll("*").filter((n) => n.attrs && ("onerror" in n.attrs || n.tagName === "SCRIPT")).length, 0);

  globalThis.location.hash = "#workout/r1";
  assert.equal(topbar.hidden, true);
  const liveStore = globalThis.TrainingStore.createStore({ storage: domStorage, catalog });
  const r1Playlist = liveStore.buildPlaylist("r1");
  const howToEl = docRoot.getElementById("ex-how-to");
  assert.equal(howToEl.textContent, r1Playlist[0].how_to);

  const primaryBtn = docRoot.getElementById("primary-btn");
  const skipBtn = docRoot.getElementById("skip-btn");
  primaryBtn.click(); skipBtn.click();
  for (let s = 1; s < r1Playlist[0].sets; s++) { skipBtn.click(); skipBtn.click(); }
  skipBtn.click();
  assert.equal(howToEl.textContent, r1Playlist[1].how_to);

  const soundSelect = docRoot.getElementById("sound-theme-select");
  soundSelect.value = "techno"; soundSelect.dispatchEvent({ type: "change" });
  assert.equal(JSON.parse(domStorage.getItem(globalThis.TrainingStore.STORAGE_KEY)).profile.sound_theme, "techno");
  assert.equal(domStorage.getItem("training_aid_sound_theme"), null);

  docRoot.getElementById("early-finish-btn").click();
  appRoot.querySelectorAll("button").find((b) => b.value === "more").click();
  assert.equal(currentHash, "#plan");
  assert.ok(appRoot.textContent.includes("+10%"));

  globalThis.location.hash = "#progress";
  assert.ok(Boolean(appRoot.querySelector(".progress-svg-chart")));
  globalThis.location.hash = "#edit/r1";
  assert.equal(activeIntervals.size, 0);

  globalThis.location.hash = "#workout/r1";
  docRoot.getElementById("primary-btn").click(); docRoot.getElementById("skip-btn").click();
  const stopsBefore = stopAllCalls;
  globalThis.location.hash = await liveStore.encodeShareFragment();
  assert.ok(stopAllCalls > stopsBefore);
  assert.equal(topbar.hidden, false);
  assert.equal((winListeners.get("keydown") || new Set()).size, 0);
  assert.equal(activeIntervals.size, 0);
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(modalRoot.hidden, false);
  docRoot.getElementById("import-cancel-btn").click();
  assert.equal(modalRoot.hidden, true);
  assert.equal(currentHash, "#plan");
});
