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

test("views/workout.js: Wake Lock lifecycle across workout phases/visibility and #fs-toggle feature detection", async () => {
  const env = installBrowserEnv({
    catalog,
    initialHash: "#setup",
    manualBoot: true,
  });
  const { docRoot, appRoot, setHash, stepFrames } = env;

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

  // Case A: Fullscreen API absent -> #fs-toggle is hidden
  delete globalThis.document.fullscreenEnabled;
  delete docRoot.requestFullscreen;
  setHash("#workout/adhoc");
  let fsBtn = docRoot.getElementById("fs-toggle");
  assert.equal(fsBtn.hidden, true, "#fs-toggle must be hidden when Fullscreen API is absent");

  // Case B: Fullscreen API present -> #fs-toggle is visible and functional
  setHash("#quick");
  let reqFsCalls = 0;
  let exitFsCalls = 0;
  globalThis.document.fullscreenEnabled = true;
  globalThis.document.fullscreenElement = null;
  docRoot.requestFullscreen = () => {
    reqFsCalls += 1;
    globalThis.document.fullscreenElement = docRoot;
    return Promise.resolve();
  };
  globalThis.document.exitFullscreen = () => {
    exitFsCalls += 1;
    globalThis.document.fullscreenElement = null;
    return Promise.resolve();
  };

  setHash("#workout/adhoc");
  fsBtn = docRoot.getElementById("fs-toggle");
  assert.equal(fsBtn.hidden, false, "#fs-toggle must be visible when Fullscreen API is enabled");
  fsBtn.click();
  assert.equal(reqFsCalls, 1);
  fsBtn.click();
  assert.equal(exitFsCalls, 1);

  const viewport = docRoot.getElementById("workout-viewport");
  const primaryBtn = docRoot.getElementById("primary-btn");
  const skipBtn = docRoot.getElementById("skip-btn");

  // IDLE: wake lock is not held
  await Promise.resolve();
  assert.equal(viewport.dataset.state, "IDLE");
  assert.equal(mock.sentinels.length, 0);

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
  assert.equal(mock.sentinels.length, 1);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Pause during ACTIVE -> wake lock released
  primaryBtn.click();
  await Promise.resolve();
  assert.equal(mock.sentinels.at(-1).released, true);

  // Visibility hidden -> visible while paused does NOT re-acquire wake lock
  globalThis.document.hidden = true;
  docRoot.dispatchEvent({ type: "visibilitychange" });
  globalThis.document.hidden = false;
  docRoot.dispatchEvent({ type: "visibilitychange" });
  await Promise.resolve();
  assert.equal(mock.sentinels.length, 1);

  // Resume -> wake lock re-acquired
  primaryBtn.click();
  await Promise.resolve();
  assert.equal(mock.sentinels.length, 2);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Visibility hidden while unpaused -> wake lock released; returning visible -> re-acquired
  globalThis.document.hidden = true;
  docRoot.dispatchEvent({ type: "visibilitychange" });
  assert.equal(mock.sentinels.at(-1).released, true);

  globalThis.document.hidden = false;
  docRoot.dispatchEvent({ type: "visibilitychange" });
  await Promise.resolve();
  assert.equal(mock.sentinels.length, 3);
  assert.equal(mock.sentinels.at(-1).released, false);

  // Complete Set 1 -> REST: wake lock remains held
  stepFrames(120);
  await Promise.resolve();
  assert.equal(viewport.dataset.state, "REST");
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
