// Service Worker differential precache, CDN/HTTP cache-busting, and safe-boundary client reload tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  resolveBuiltDist,
  importDistModule,
  installBrowserEnv,
  makeMemoryStorage,
} from "./helpers/dom_harness.mjs";

let distHandle;
let catalog;
let distDir;

before(() => {
  distHandle = resolveBuiltDist("ta-sw-lifecycle-");
  catalog = distHandle.catalog;
  distDir = distHandle.distDir;
});

after(() => {
  if (distHandle) distHandle.cleanup();
});

function createInMemoryCaches(baseHref) {
  const buckets = new Map();
  const normalizeKey = (reqOrUrl, ignoreSearch = false) => {
    const raw = typeof reqOrUrl === "string" ? reqOrUrl : reqOrUrl.url;
    const u = new URL(raw, baseHref);
    if (ignoreSearch) u.search = "";
    return u.toString();
  };

  return {
    buckets,
    async open(name) {
      if (!buckets.has(name)) buckets.set(name, new Map());
      const store = buckets.get(name);
      return {
        async put(reqOrUrl, resp) {
          store.set(normalizeKey(reqOrUrl, false), resp.clone());
        },
        async match(reqOrUrl, opts) {
          const ignore = Boolean(opts && opts.ignoreSearch);
          const target = normalizeKey(reqOrUrl, ignore);
          for (const [k, v] of store.entries()) {
            if (normalizeKey(k, ignore) === target) return v.clone();
          }
          return undefined;
        },
      };
    },
    async keys() {
      return [...buckets.keys()];
    },
    async delete(name) {
      return buckets.delete(name);
    },
    async match(reqOrUrl, opts) {
      for (const name of buckets.keys()) {
        const cache = await this.open(name);
        const hit = await cache.match(reqOrUrl, opts);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

function mountServiceWorkerVm(swCode, { caches, baseHref, activeWorker = null, onFetch }) {
  const listeners = new Map();
  let skipWaitingCalls = 0;
  let clientsClaimCalls = 0;

  const selfObj = {
    location: new URL(baseHref),
    registration: { active: activeWorker },
    clients: {
      async claim() {
        clientsClaimCalls += 1;
      },
    },
    async skipWaiting() {
      skipWaitingCalls += 1;
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
  };

  const sandbox = {
    self: selfObj,
    caches,
    URL,
    Request,
    Response,
    Promise,
    fetch: (req) => onFetch(req instanceof Request ? req : new Request(String(req))),
  };
  vm.runInNewContext(swCode, sandbox, { filename: "sw.js" });

  return {
    get skipWaitingCalls() {
      return skipWaitingCalls;
    },
    get clientsClaimCalls() {
      return clientsClaimCalls;
    },
    async dispatchExtendable(type, extra = {}) {
      const pending = [];
      const evt = {
        type,
        ...extra,
        waitUntil(p) {
          pending.push(Promise.resolve(p));
        },
      };
      for (const fn of listeners.get(type) || []) fn(evt);
      await Promise.all(pending);
    },
    dispatchMessage(data) {
      for (const fn of listeners.get("message") || []) fn({ data });
    },
    async dispatchFetch(reqUrl, init = {}) {
      let responsePromise = null;
      const request = new Request(reqUrl, init);
      if (init.mode === "navigate") {
        Object.defineProperty(request, "mode", { value: "navigate" });
      }
      const evt = {
        request,
        respondWith(p) {
          responsePromise = Promise.resolve(p);
        },
      };
      for (const fn of listeners.get("fetch") || []) fn(evt);
      return responsePromise ? responsePromise : null;
    },
  };
}

test("AC-2: sw.js reuses unchanged precache assets, busts changed/runtime fetches with ?v=, and gates skipWaiting", async () => {
  const baseHref = "https://trainer.local/training-aid/sw.js";
  const swTextV1 = fs.readFileSync(path.join(distDir, "sw.js"), "utf8");
  const caches = createInMemoryCaches(baseHref);
  const fetchCalls = [];

  const onFetch = async (req) => {
    fetchCalls.push({ url: req.url, cache: req.cache });
    return new Response(`body:${req.url}`, { status: 200 });
  };

  // 1. Initial install (no active SW): fetches all shell assets with ?v=<rev> + reload and skips waiting
  const swV1 = mountServiceWorkerVm(swTextV1, { caches, baseHref, activeWorker: null, onFetch });
  await swV1.dispatchExtendable("install");
  assert.equal(swV1.skipWaitingCalls, 1, "First install must call skipWaiting() immediately");
  assert.ok(fetchCalls.length > 20, "First install must fetch all precached shell assets");
  for (const call of fetchCalls) {
    const parsed = new URL(call.url);
    assert.ok(parsed.pathname.startsWith("/training-aid/"), "Requests must preserve subpath base");
    assert.match(parsed.searchParams.get("v") || "", /^[0-9a-f]{12}$/);
    assert.equal(call.cache, "reload");
  }
  const v1CacheName = [...caches.buckets.keys()][0];
  assert.match(v1CacheName, /^training-aid-pwa-v1-[0-9a-f]{12}$/);

  // 2. Differential update install (active SW exists, only ./app.js changed): 0 fetches for catalog.json!
  const swTextV2 = swTextV1
    .replace(/CACHE_VERSION\s*=\s*"v1-[0-9a-f]{12}"/, 'CACHE_VERSION = "v1-ffffffffffff"')
    .replace(/("\.\/app\.js":\s*")[0-9a-f]{12}(")/, "$1ffffffffffff$2");

  fetchCalls.length = 0;
  const swV2 = mountServiceWorkerVm(swTextV2, {
    caches,
    baseHref,
    activeWorker: { state: "activated" },
    onFetch,
  });
  await swV2.dispatchExtendable("install");

  assert.equal(
    fetchCalls.length,
    1,
    "Differential install must fetch ONLY mutated ./app.js and reuse unchanged catalog.json from v1 cache"
  );
  assert.equal(fetchCalls[0].url, "https://trainer.local/training-aid/app.js?v=ffffffffffff");
  assert.equal(fetchCalls[0].cache, "reload");
  assert.equal(swV2.skipWaitingCalls, 0, "Update install must NOT call skipWaiting() automatically");
  assert.equal(caches.buckets.has(v1CacheName), true, "Active v1 cache must remain intact while waiting");

  // Explicit SKIP_WAITING message triggers skipWaiting(), and activate purges v1 cache
  swV2.dispatchMessage({ type: "SKIP_WAITING" });
  assert.equal(swV2.skipWaitingCalls, 1);
  await swV2.dispatchExtendable("activate");
  assert.equal(swV2.clientsClaimCalls, 1);
  assert.equal(caches.buckets.has(v1CacheName), false, "Activate must delete superseded v1 cache");
  assert.equal(caches.buckets.has("training-aid-pwa-v1-ffffffffffff"), true);

  const reusedCatalog = await caches.match("https://trainer.local/training-aid/data/catalog.json");
  assert.ok(Boolean(reusedCatalog), "Copied-forward catalog.json must be present in v2 cache");

  // 3. Runtime cache miss busts CDN/HTTP cache with ?v=<CACHE_VERSION> and caches clean URL
  fetchCalls.length = 0;
  const thumbUrl = "https://trainer.local/training-aid/svgs/thumbs/squat__barbell.svg";
  const thumbResp1 = await swV2.dispatchFetch(thumbUrl);
  assert.equal(thumbResp1.status, 200);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, `${thumbUrl}?v=v1-ffffffffffff`);
  assert.equal(fetchCalls[0].cache, "no-cache");

  // Allow async cache.put microtask to settle, then verify cache hit with 0 network calls
  await new Promise((resolve) => setImmediate(resolve));
  const thumbResp2 = await swV2.dispatchFetch(thumbUrl);
  assert.equal(thumbResp2.status, 200);
  assert.equal(fetchCalls.length, 1, "Subsequent thumbnail request must hit CacheStorage");

  // Internal revision metadata path must never be intercepted by fetch handler
  const internalResp = await swV2.dispatchFetch("https://trainer.local/training-aid/__sw_revisions__");
  assert.equal(internalResp, null);
});

test("AC-3: createSwUpdater throttles resume checks, ignores initial claim, and blocks reload loops", async () => {
  installBrowserEnv({ catalog, initialHash: "#plan", manualBoot: true });
  const { createSwUpdater, SW_UPDATE_THROTTLE_MS, SW_RELOAD_COOLDOWN_MS } = await importDistModule(
    distDir,
    "ui",
    "sw-update.js"
  );

  let nowTs = 100_000;
  let safe = true;
  let reloads = 0;
  let updateCalls = 0;
  const containerListeners = new Map();
  const sessionStore = makeMemoryStorage();

  const swContainer = {
    controller: null,
    addEventListener(type, fn) {
      containerListeners.set(type, fn);
    },
    register() {
      return Promise.resolve({
        waiting: null,
        installing: null,
        update() {
          updateCalls += 1;
          return Promise.resolve();
        },
        addEventListener() {},
      });
    },
  };

  const updater = createSwUpdater({
    swContainer,
    sessionStore,
    isSafeToReload: () => safe,
    nowFn: () => nowTs,
    reloadFn: () => {
      reloads += 1;
    },
  });
  await updater.start();

  // Initial first-visit clients.claim() must NOT reload the page
  swContainer.controller = { scriptURL: "./sw.js" };
  containerListeners.get("controllerchange")();
  assert.equal(reloads, 0, "First-visit controller claim must not reload");

  // Throttled update checks on visibilitychange / online
  await updater.checkForUpdate();
  assert.equal(updateCalls, 0, "Immediate check within 60s window must be throttled");
  nowTs += SW_UPDATE_THROTTLE_MS + 1;
  await updater.checkForUpdate();
  assert.equal(updateCalls, 1, "Check after 60s throttle window must call registration.update()");

  // Second controllerchange (real upgrade) reloads once
  containerListeners.get("controllerchange")();
  assert.equal(reloads, 1);

  // Simulated post-reload updater within 10s cooldown must NOT loop
  nowTs += SW_RELOAD_COOLDOWN_MS - 500;
  const updaterAfterReload = createSwUpdater({
    swContainer,
    sessionStore,
    isSafeToReload: () => true,
    nowFn: () => nowTs,
    reloadFn: () => {
      reloads += 1;
    },
  });
  await updaterAfterReload.start();
  containerListeners.get("controllerchange")();
  assert.equal(reloads, 1, "SessionStorage cooldown latch must prevent rapid reload loops");

  updater.dispose();
  updaterAfterReload.dispose();
});

test("AC-3: app.js defers SW activation & multi-tab reload across #setup, #workout, completion banner, modals, and gear overrides", async () => {
  const env = installBrowserEnv({ catalog, initialHash: "#setup", manualBoot: true });
  const { docRoot, appRoot, getHash, setHash, getReloadCount, stepFrames } = env;

  const containerListeners = new Map();
  const regListeners = new Map();
  const postedMessages = [];
  const registration = {
    waiting: null,
    installing: null,
    update: () => Promise.resolve(),
    addEventListener(type, fn) {
      regListeners.set(type, fn);
    },
  };
  globalThis.navigator.serviceWorker = {
    controller: { scriptURL: "./sw.js" },
    addEventListener(type, fn) {
      containerListeners.set(type, fn);
    },
    register() {
      return Promise.resolve(registration);
    },
  };

  // Waiting worker already queued while user is on #setup (unsafe!)
  const waitingV2 = {
    postMessage(msg) {
      postedMessages.push(msg);
    },
  };
  registration.waiting = waitingV2;

  const appMod = await importDistModule(distDir, "app.js");
  const { openModal, closeModal } = await importDistModule(distDir, "ui", "modal.js");
  const { el } = await importDistModule(distDir, "ui", "dom.js");
  await appMod.boot();

  assert.equal(getHash(), "#setup");
  assert.equal(appMod.isSafeToReload(), false);
  assert.equal(postedMessages.length, 0, "Must not activate waiting SW while on #setup");

  // Submitting #setup saves plan to localStorage and mounts clean #plan -> activates waiting SW!
  appRoot.querySelector(".setup-form").dispatchEvent({ type: "submit" });
  assert.equal(getHash(), "#plan");
  assert.equal(appMod.isSafeToReload(), true);
  assert.deepEqual(postedMessages, [{ type: "SKIP_WAITING" }]);

  // Simulate gear filter override & modal blocking isSafeToReload on #plan
  appRoot.querySelector(".filter-panel").querySelector(".equip-chip-bar").querySelectorAll("button")[0].click();
  assert.equal(appMod.isSafeToReload(), false, "Active session gear filter must block reload");
  // Reset gear filter back to baseline
  appRoot.querySelector("#reset-gear-btn")?.click();
  // Re-toggle same chip off if no reset button
  if (!appMod.isSafeToReload()) {
    appRoot.querySelector(".filter-panel").querySelector(".equip-chip-bar").querySelectorAll("button")[0].click();
  }
  assert.equal(appMod.isSafeToReload(), true);

  openModal(() => el("div", { textContent: "Dialog" }));
  assert.equal(appMod.isSafeToReload(), false, "Open modal must block reload");
  closeModal();
  assert.equal(appMod.isSafeToReload(), true);

  // Enter #workout/r1 and simulate another tab triggering controllerchange mid-workout
  registration.waiting = null;
  setHash("#workout/r1");
  assert.equal(appMod.isSafeToReload(), false, "Active #workout must never be interrupted");

  containerListeners.get("controllerchange")();
  assert.equal(getReloadCount(), 0, "Mid-workout tab must defer reload on controllerchange");

  // Complete a 1-exercise ad-hoc workout -> save -> #plan mounts with ✓ completion banner
  setHash("#quick");
  assert.equal(appMod.isSafeToReload(), false, "#quick with ad-hoc session must block reload");
  setHash("#workout/adhoc");
  docRoot.getElementById("primary-btn").click();
  let guard = 0;
  while (docRoot.getElementById("finish-form").style.display === "none" && guard < 400) {
    const skipBtn = docRoot.getElementById("skip-btn");
    if (skipBtn && skipBtn.style.display !== "none") skipBtn.click();
    stepFrames(30);
    guard += 1;
  }
  const finishSaveBtn = docRoot.getElementById("finish-save-btn");
  assert.ok(Boolean(finishSaveBtn), "Workout must reach finish screen");
  finishSaveBtn.click();

  assert.equal(getHash(), "#plan");
  assert.ok(appRoot.textContent.includes("\u2713 Quick Workout Saved"));
  assert.equal(
    getReloadCount(),
    0,
    "Must not reload on top of freshly rendered post-workout completion banner"
  );

  // Navigating to clean #progress executes the deferred one-shot reload!
  setHash("#progress");
  assert.equal(getReloadCount(), 1, "Deferred reload must execute once user enters clean #progress");

  appMod.teardownActiveView();
});
