// Mobile standalone workout resilience tests: Wake Lock, Fullscreen feature-detection, audioSession, and safe-area CSS.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveBuiltDist,
  importDistModule,
  installBrowserEnv,
  MockAudioContext,
} from "./helpers/dom_harness.mjs";

let distHandle;
let catalog;
let distDir;

before(() => {
  distHandle = resolveBuiltDist("ta-workout-mobile-");
  catalog = distHandle.catalog;
  distDir = distHandle.distDir;
});

after(() => {
  if (distHandle) distHandle.cleanup();
});

function makeMockWakeLock() {
  const sentinels = [];
  const requests = [];
  let deferredMode = false;
  let pendingResolve = null;
  let shouldReject = false;

  function createSentinel(type) {
    const listeners = new Map();
    const s = {
      type,
      released: false,
      releaseCalls: 0,
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, new Set());
        listeners.get(ev).add(fn);
      },
      dispatchRelease() {
        s.released = true;
        for (const fn of [...(listeners.get("release") || [])]) fn();
      },
      release() {
        s.releaseCalls += 1;
        s.dispatchRelease();
        return Promise.resolve();
      },
    };
    sentinels.push(s);
    return s;
  }

  return {
    sentinels,
    requests,
    setDeferred(v) {
      deferredMode = Boolean(v);
    },
    setReject(v) {
      shouldReject = Boolean(v);
    },
    resolvePending() {
      if (pendingResolve) {
        const fn = pendingResolve;
        pendingResolve = null;
        fn();
      }
    },
    wakeLock: {
      request(type) {
        requests.push(type);
        if (shouldReject) return Promise.reject(new Error("WakeLock denied"));
        if (deferredMode) {
          return new Promise((resolve) => {
            pendingResolve = () => resolve(createSentinel(type));
          });
        }
        return Promise.resolve(createSentinel(type));
      },
    },
  };
}

test("ui/wake-lock.js: acquire, deduplicate, pending cancellation, OS release event, rejection safety, and scope cleanup", async () => {
  const scopeMod = await importDistModule(distDir, "ui", "scope.js");
  const wakeMod = await importDistModule(distDir, "ui", "wake-lock.js");

  // 1. Missing wakeLock API is a no-op
  const noopScope = scopeMod.createViewScope();
  const noopWl = wakeMod.createWakeLock(noopScope, {});
  noopWl.sync(true);
  assert.equal(noopWl.isHeld(), false);
  noopWl.release();
  noopScope.dispose();

  // 2. Acquire, deduplicate, OS auto-release, and manual release
  const scope = scopeMod.createViewScope();
  const mock = makeMockWakeLock();
  const wl = wakeMod.createWakeLock(scope, { wakeLock: mock.wakeLock });

  wl.sync(true);
  wl.sync(true); // deduplicated while pending/held
  await Promise.resolve();
  assert.equal(mock.requests.length, 1);
  assert.equal(mock.requests[0], "screen");
  assert.equal(wl.isHeld(), true);

  // OS auto-release clears held state so next sync(true) re-requests
  mock.sentinels[0].dispatchRelease();
  assert.equal(wl.isHeld(), false);

  wl.sync(true);
  await Promise.resolve();
  assert.equal(mock.requests.length, 2);
  assert.equal(wl.isHeld(), true);

  // sync(false) releases held sentinel
  wl.sync(false);
  assert.equal(wl.isHeld(), false);
  assert.equal(mock.sentinels[1].releaseCalls, 1);

  // 3. Cancellation while request Promise is still pending
  mock.setDeferred(true);
  wl.sync(true);
  wl.sync(false);
  mock.resolvePending();
  await Promise.resolve();
  assert.equal(wl.isHeld(), false);
  assert.equal(mock.sentinels[2].releaseCalls, 1);

  // 4. Rejection is swallowed cleanly and allows subsequent requests
  mock.setDeferred(false);
  mock.setReject(true);
  wl.sync(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(wl.isHeld(), false);

  mock.setReject(false);
  wl.sync(true);
  await Promise.resolve();
  assert.equal(wl.isHeld(), true);

  // 5. Scope disposal releases active sentinel
  scope.dispose();
  assert.equal(wl.isHeld(), false);
  assert.equal(mock.sentinels.at(-1).releaseCalls, 1);
});

test("audio/controller.js: navigator.audioSession.type syncs to 'playback' when active and 'auto' when muted/stopped", async () => {
  globalThis.window = globalThis;
  globalThis.AudioContext = MockAudioContext;
  const controllerMod = await importDistModule(distDir, "audio", "controller.js");

  const audioSession = { type: "auto" };
  const ctrl = controllerMod.createController({
    theme: "minimal",
    navigatorObj: { audioSession },
    audioContextFactory: () => new MockAudioContext(),
  });

  assert.equal(audioSession.type, "auto");
  ctrl.ensureAudio();
  assert.equal(audioSession.type, "playback");

  // Muting switches audioSession back to "auto"
  ctrl.setTheme("off");
  assert.equal(audioSession.type, "auto");

  // Unmuting restores "playback"
  ctrl.toggleMute();
  assert.equal(audioSession.type, "playback");

  // stopAll() resets audioSession to "auto"
  ctrl.stopAll();
  assert.equal(audioSession.type, "auto");

  // Read-only or throwing audioSession.type never breaks controller
  const throwingNav = {
    audioSession: {
      get type() {
        return "auto";
      },
      set type(_v) {
        throw new Error("Unsupported type");
      },
    },
  };
  const safeCtrl = controllerMod.createController({
    theme: "minimal",
    navigatorObj: throwingNav,
    audioContextFactory: () => new MockAudioContext(),
  });
  assert.ok(safeCtrl.ensureAudio());
  safeCtrl.setTheme("off");
  safeCtrl.stopAll();
});

test("views/workout.js: Wake Lock lifecycle, #fs-toggle removal, and #workout-tune-btn modal pause/resume/settings", async () => {
  const env = installBrowserEnv({
    catalog,
    initialHash: "#setup",
    manualBoot: true,
  });
  const { docRoot, appRoot, modalRoot, setHash, stepFrames } = env;

  const mock = makeMockWakeLock();
  const audioSession = { type: "auto" };
  globalThis.navigator.wakeLock = mock.wakeLock;
  globalThis.navigator.audioSession = audioSession;

  const appMod = await importDistModule(distDir, "app.js");
  await appMod.boot();

  // Create plan and trim ad-hoc session to 1 exercise (2 sets x 2 reps)
  appRoot.querySelector(".setup-form").dispatchEvent({ type: "submit" });
  setHash("#quick");
  docRoot.getElementById("quick-generate-btn").click();
  let removeBtns = appRoot
    .querySelectorAll("button")
    .filter((b) => b.attrs["aria-label"] === "Remove");
  while (removeBtns.length > 1) {
    removeBtns[removeBtns.length - 1].click();
    removeBtns = appRoot
      .querySelectorAll("button")
      .filter((b) => b.attrs["aria-label"] === "Remove");
  }
  const numInputs = appRoot.querySelectorAll(".rx-num-input");
  numInputs[0].value = "2";
  numInputs[0].dispatchEvent({ type: "change" });
  numInputs[1].value = "2";
  numInputs[1].dispatchEvent({ type: "change" });

  setHash("#workout/adhoc");

  // #fs-toggle is removed; top HUD .hud-actions renders only #workout-tune-btn and #sound-toggle
  assert.equal(docRoot.getElementById("fs-toggle"), null, "#fs-toggle must not exist");
  const hudTop = appRoot.querySelector(".workout-hud-top");
  const hudActions = hudTop.querySelector(".hud-actions");
  assert.deepEqual(
    hudActions.children.map((c) => c.id),
    ["workout-tune-btn", "sound-toggle"],
    "Top HUD .hud-actions must only render #workout-tune-btn and #sound-toggle"
  );
  assert.equal(hudTop.querySelector("#speed-mode-select"), null);
  assert.equal(hudTop.querySelector("#rest-seconds-select"), null);
  assert.equal(hudTop.querySelector("#sound-theme-select"), null);

  const tuneBtn = docRoot.getElementById("workout-tune-btn");
  const viewport = docRoot.getElementById("workout-viewport");
  const primaryBtn = docRoot.getElementById("primary-btn");
  const skipBtn = docRoot.getElementById("skip-btn");

  // IDLE: wake lock is not held; opening & closing #workout-tune-btn modal in IDLE keeps state IDLE
  await Promise.resolve();
  assert.equal(viewport.dataset.state, "IDLE");
  assert.equal(mock.sentinels.length, 0);

  tuneBtn.click();
  assert.equal(modalRoot.hidden, false);
  assert.ok(modalRoot.textContent.includes("Workout Settings"));
  assert.ok(Boolean(docRoot.getElementById("speed-mode-select")));
  assert.ok(Boolean(docRoot.getElementById("rest-seconds-select")));
  assert.ok(Boolean(docRoot.getElementById("sound-theme-select")));
  docRoot.getElementById("workout-tune-close-btn").click();
  assert.equal(modalRoot.hidden, true);
  assert.equal(viewport.dataset.state, "IDLE");
  assert.equal(primaryBtn.textContent, "\u25b6 Start");

  // Start -> COUNTDOWN: wake lock acquired & audioSession set to "playback"
  primaryBtn.click();
  await Promise.resolve();
  assert.equal(viewport.dataset.state, "COUNTDOWN");
  assert.equal(audioSession.type, "playback");
  assert.equal(mock.sentinels.length, 1);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Skip countdown -> ACTIVE: wake lock remains held
  skipBtn.click();
  await Promise.resolve();
  assert.equal(viewport.dataset.state, "ACTIVE");
  assert.equal(primaryBtn.textContent, "\u23f8");
  assert.equal(mock.sentinels.length, 1);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Opening #workout-tune-btn during ACTIVE pauses the session and releases wake lock
  tuneBtn.click();
  await Promise.resolve();
  assert.equal(modalRoot.hidden, false);
  assert.equal(primaryBtn.textContent, "\u25b6", "Session must pause when tune modal opens");
  assert.equal(mock.sentinels.at(-1).released, true);

  const speedSel = docRoot.getElementById("speed-mode-select");
  const restSel = docRoot.getElementById("rest-seconds-select");
  const soundSel = docRoot.getElementById("sound-theme-select");
  speedSel.value = "fast";
  speedSel.dispatchEvent({ type: "change" });
  restSel.value = "45";
  restSel.dispatchEvent({ type: "change" });
  soundSel.value = "techno";
  soundSel.dispatchEvent({ type: "change" });
  assert.equal(primaryBtn.textContent, "\u25b6", "Changing tune settings must keep session paused until modal closes");

  // Closing via #workout-tune-close-btn resumes session and re-acquires wake lock
  docRoot.getElementById("workout-tune-close-btn").click();
  await Promise.resolve();
  assert.equal(modalRoot.hidden, true);
  assert.equal(primaryBtn.textContent, "\u23f8", "Session must resume when tune modal closes");
  assert.equal(mock.sentinels.length, 2);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Opening #workout-tune-btn and closing via Escape/cancel also resumes session
  tuneBtn.click();
  await Promise.resolve();
  assert.equal(primaryBtn.textContent, "\u25b6");
  modalRoot.querySelector("dialog").dispatchEvent({ type: "cancel" });
  await Promise.resolve();
  assert.equal(modalRoot.hidden, true);
  assert.equal(primaryBtn.textContent, "\u23f8");
  assert.equal(mock.sentinels.length, 3);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Manual Pause during ACTIVE -> wake lock released
  primaryBtn.click();
  await Promise.resolve();
  assert.equal(mock.sentinels.at(-1).released, true);

  // Visibility hidden -> visible while paused does NOT re-acquire wake lock
  globalThis.document.hidden = true;
  docRoot.dispatchEvent({ type: "visibilitychange" });
  globalThis.document.hidden = false;
  docRoot.dispatchEvent({ type: "visibilitychange" });
  await Promise.resolve();
  assert.equal(mock.sentinels.length, 3);

  // Resume -> wake lock re-acquired
  primaryBtn.click();
  await Promise.resolve();
  assert.equal(mock.sentinels.length, 4);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Visibility hidden while unpaused -> wake lock released; returning visible -> re-acquired
  globalThis.document.hidden = true;
  docRoot.dispatchEvent({ type: "visibilitychange" });
  assert.equal(mock.sentinels.at(-1).released, true);

  globalThis.document.hidden = false;
  docRoot.dispatchEvent({ type: "visibilitychange" });
  await Promise.resolve();
  assert.equal(mock.sentinels.length, 5);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Complete Set 1 -> REST (with updated 45s rest from modal): wake lock remains held
  stepFrames(120);
  await Promise.resolve();
  assert.equal(viewport.dataset.state, "REST");
  assert.equal(docRoot.getElementById("rep-readout").textContent, "45s");
  assert.equal(mock.sentinels.at(-1).released, false);

  // Skip REST -> Set 2 ACTIVE -> Complete Set 2 -> FINISHED: wake lock released
  skipBtn.click();
  assert.equal(viewport.dataset.state, "ACTIVE");
  stepFrames(120);
  await Promise.resolve();
  assert.equal(viewport.dataset.state, "FINISHED");
  assert.equal(mock.sentinels.at(-1).released, true);

  appMod.teardownActiveView();
});

test("ui/dom.js <details open> + makeTuneIcon, catalog-picker disclosures, and #edit/#quick single-chip-bar & picker-disclosure", async () => {
  const env = installBrowserEnv({
    catalog,
    initialHash: "#setup",
    manualBoot: true,
  });
  const { docRoot, appRoot, setHash } = env;

  const domMod = await importDistModule(distDir, "ui", "dom.js");
  const scopeMod = await importDistModule(distDir, "ui", "scope.js");
  const pickerMod = await importDistModule(distDir, "ui", "catalog-picker.js");
  const appMod = await importDistModule(distDir, "app.js");

  // 1. dom.js: el("details", { open }) syncs property & attribute; makeTuneIcon() builds SVG
  const openDetails = domMod.el("details", { className: "test-d", open: true });
  assert.equal(openDetails.open, true);
  assert.equal(openDetails.getAttribute("open"), "");
  const closedDetails = domMod.el("details", { className: "test-d", open: false });
  assert.equal(closedDetails.open, false);
  assert.equal(closedDetails.getAttribute("open"), null);

  const tuneIcon = domMod.makeTuneIcon();
  assert.equal(tuneIcon.tagName, "SVG");
  assert.equal(tuneIcon.getAttribute("width"), "18");
  assert.equal(tuneIcon.getAttribute("height"), "18");
  assert.equal(tuneIcon.getAttribute("aria-hidden"), "true");

  // 2. catalog-picker.js: default limit=48, picker-filters-disclosure badge, and showEquipmentFilter: false
  const pScope = scopeMod.createViewScope();
  const mockStore = {
    searchCatalog: () => catalog.exercises.slice(0, 60),
  };
  const defaultPicker = pickerMod.renderCatalogPicker(pScope, mockStore, {});
  assert.equal(defaultPicker.resultsWrap.querySelectorAll(".catalog-card").length, 48);
  const filtersDisc = defaultPicker.querySelector(".picker-filters-disclosure");
  assert.ok(Boolean(filtersDisc), "Picker must wrap filters in <details class='disclosure-card picker-filters-disclosure'>");
  assert.equal(filtersDisc.open, false);
  assert.ok(Boolean(filtersDisc.querySelector(".picker-filter-strip")));
  assert.ok(Boolean(filtersDisc.querySelector(".catalog-equip-bar")));
  const badge = filtersDisc.querySelector(".pill-brand");
  assert.equal(badge.hidden, true);

  const muscleSel = filtersDisc.querySelector(".picker-filter-strip").querySelector("select");
  muscleSel.value = "chest";
  muscleSel.dispatchEvent({ type: "change" });
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, "1");

  const noEquipPicker = pickerMod.renderCatalogPicker(pScope, mockStore, {
    limit: 24,
    showEquipmentFilter: false,
  });
  assert.equal(noEquipPicker.resultsWrap.querySelectorAll(".catalog-card").length, 24);
  assert.equal(noEquipPicker.querySelector(".catalog-equip-bar"), null);
  pScope.dispose();

  // 3. Boot app -> #edit/r1 and #quick picker-disclosure & single-chip-bar on #quick
  await appMod.boot();
  appRoot.querySelector(".setup-form").dispatchEvent({ type: "submit" });

  // On mobile (<861px), #edit/r1 has rows.length > 0 so .picker-disclosure defaults to closed (open = false)
  setHash("#edit/r1");
  let editPickerDisc = appRoot.querySelector(".picker-disclosure");
  assert.ok(Boolean(editPickerDisc), "#edit must wrap picker in <details class='picker-disclosure'>");
  assert.equal(editPickerDisc.open, false);
  assert.equal(
    docRoot.getElementById("search-results").querySelector(".picker-meta").textContent,
    "Showing 24 of 876 exercises"
  );

  // User opens .picker-disclosure and adds an exercise -> open state is preserved across refreshRoutineExercises()
  editPickerDisc.open = true;
  docRoot.getElementById("edit-add-random-btn").click();
  assert.equal(appRoot.querySelector(".picker-disclosure").open, true);

  // On #quick on mobile (<861px), ensureAdHocSession pre-populates 4 exercises so .picker-disclosure defaults to closed (open = false)
  setHash("#quick");
  let quickPickerDisc = appRoot.querySelector(".picker-disclosure");
  assert.ok(Boolean(quickPickerDisc), "#quick must wrap picker in <details class='picker-disclosure'>");
  assert.equal(quickPickerDisc.open, false);
  assert.equal(
    docRoot.getElementById("quick-search-results").querySelector(".picker-meta").textContent,
    "Showing 24 of 876 exercises"
  );

  // #quick renders ONLY ONE .equip-chip-bar (omitting .catalog-equip-bar) and unified "Equipment" label
  assert.equal(appRoot.querySelectorAll(".equip-chip-bar").length, 1);
  assert.equal(appRoot.querySelector(".catalog-equip-bar"), null);
  const gearDetails = appRoot.querySelector(".filter-panel");
  assert.ok(Boolean(gearDetails), "#quick must wrap equipment panel in <details class='filter-panel disclosure-card'>");
  assert.equal(gearDetails.tagName, "DETAILS");
  assert.equal(gearDetails.open, false);
  assert.equal(gearDetails.querySelector(".field-label").textContent, "Equipment");
  assert.ok(gearDetails.querySelector(".pill").textContent.includes("Bodyweight"));

  // Opening gearDetails and toggling an equipment chip preserves gearDetails.open === true
  gearDetails.open = true;
  gearDetails.querySelector(".equip-chip-bar").querySelector("button").click();
  const updatedGearDetails = appRoot.querySelector(".filter-panel");
  assert.equal(updatedGearDetails.open, true);

  // Action buttons (#quick-generate-btn, #quick-add-random-btn) remain outside gearDetails
  assert.equal(updatedGearDetails.querySelector("#quick-generate-btn"), null);
  assert.ok(Boolean(docRoot.getElementById("quick-generate-btn")));
  assert.ok(Boolean(docRoot.getElementById("quick-add-random-btn")));

  // Removing all exercises in #quick (rows.length === 0) auto-opens .picker-disclosure
  let quickRemoveBtns = appRoot
    .querySelectorAll("button")
    .filter((b) => b.attrs["aria-label"] === "Remove");
  while (quickRemoveBtns.length > 0) {
    quickRemoveBtns[0].click();
    quickRemoveBtns = appRoot
      .querySelectorAll("button")
      .filter((b) => b.attrs["aria-label"] === "Remove");
  }
  assert.equal(appRoot.querySelector(".picker-disclosure").open, true);

  // Desktop (>=861px) defaults .picker-disclosure to open even when rows.length > 0
  globalThis.matchMedia = (q) => ({
    matches: q.includes("min-width: 861px"),
    addEventListener() {},
    removeEventListener() {},
  });
  setHash("#edit/r1");
  assert.equal(appRoot.querySelector(".picker-disclosure").open, true);

  appMod.teardownActiveView();
});

test("styles/layout.css & styles/workout.css: notched safe-area env(safe-area-inset-*) rules", () => {
  const layoutCss = fs.readFileSync(path.join(distDir, "styles", "layout.css"), "utf8");
  const workoutCss = fs.readFileSync(path.join(distDir, "styles", "workout.css"), "utf8");

  const extractBlock = (css, selector) => {
    const idx = css.indexOf(selector);
    assert.ok(idx >= 0, `Missing selector ${selector}`);
    const open = css.indexOf("{", idx);
    const close = css.indexOf("}", open);
    return css.slice(open, close + 1);
  };

  const topbarBlock = extractBlock(layoutCss, ".topbar");
  assert.ok(topbarBlock.includes("env(safe-area-inset-top"));
  assert.ok(topbarBlock.includes("env(safe-area-inset-left"));
  assert.ok(topbarBlock.includes("env(safe-area-inset-right"));

  const hudTopBlock = extractBlock(workoutCss, ".workout-hud-top");
  assert.ok(hudTopBlock.includes("env(safe-area-inset-top"));
  assert.ok(hudTopBlock.includes("env(safe-area-inset-left"));
  assert.ok(hudTopBlock.includes("env(safe-area-inset-right"));

  const cueFloatBlock = extractBlock(workoutCss, ".phase-cue-float");
  assert.ok(cueFloatBlock.includes("env(safe-area-inset-bottom"));

  const hudBottomBlock = extractBlock(workoutCss, ".workout-hud-bottom");
  assert.ok(hudBottomBlock.includes("env(safe-area-inset-bottom"));
  assert.ok(hudBottomBlock.includes("env(safe-area-inset-left"));
  assert.ok(hudBottomBlock.includes("env(safe-area-inset-right"));

  const edgeProgressBlock = extractBlock(workoutCss, ".edge-progress");
  assert.ok(edgeProgressBlock.includes("env(safe-area-inset-bottom"));
});
