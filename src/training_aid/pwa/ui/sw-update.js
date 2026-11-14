/* Service Worker update polling, safe-boundary activation, and loop-proof reload */

export const SW_UPDATE_THROTTLE_MS = 60_000;
export const SW_RELOAD_COOLDOWN_MS = 10_000;
export const SW_RELOAD_GUARD_KEY = "ta_sw_reload_ts";

export function createSwUpdater(options = {}) {
  const isSafeToReload =
    typeof options.isSafeToReload === "function" ? options.isSafeToReload : () => false;
  const nowFn = typeof options.nowFn === "function" ? options.nowFn : () => Date.now();
  const reloadFn =
    typeof options.reloadFn === "function"
      ? options.reloadFn
      : () => {
          if (
            typeof window !== "undefined" &&
            window.location &&
            typeof window.location.reload === "function"
          ) {
            window.location.reload();
          }
        };
  const getSessionStore = () => {
    if (options.sessionStore !== undefined) return options.sessionStore;
    try {
      return typeof sessionStorage !== "undefined" ? sessionStorage : null;
    } catch {
      return null;
    }
  };
  const swContainer =
    options.swContainer !== undefined
      ? options.swContainer
      : typeof navigator !== "undefined" && "serviceWorker" in navigator
        ? navigator.serviceWorker
        : null;

  const ac = new AbortController();
  let hadController = Boolean(swContainer && swContainer.controller);
  let registration = null;
  let waitingWorker = null;
  let reloadDeferred = false;
  let reloadTriggered = false;
  let skipWaitingSent = false;
  let lastUpdateCheckAt = 0;

  function triggerReloadOnce() {
    if (reloadTriggered || ac.signal.aborted) return false;
    const ts = nowFn();
    const sess = getSessionStore();
    if (sess && typeof sess.getItem === "function") {
      try {
        const rawPrev = sess.getItem(SW_RELOAD_GUARD_KEY);
        const prevTs = rawPrev !== null ? Number(rawPrev) : NaN;
        if (Number.isFinite(prevTs) && ts >= prevTs && ts - prevTs < SW_RELOAD_COOLDOWN_MS) {
          return false;
        }
      } catch {
        // Ignore inaccessible sessionStorage in restricted browsing contexts.
      }
    }
    reloadTriggered = true;
    if (sess && typeof sess.setItem === "function") {
      try {
        sess.setItem(SW_RELOAD_GUARD_KEY, String(ts));
      } catch {
        // Ignore storage quota or security exceptions.
      }
    }
    reloadFn();
    return true;
  }

  function evaluateBoundary() {
    if (ac.signal.aborted || reloadTriggered) return false;
    if (!isSafeToReload()) return false;
    if (reloadDeferred) {
      reloadDeferred = false;
      return triggerReloadOnce();
    }
    const candidate = waitingWorker || (registration && registration.waiting) || null;
    if (candidate && !skipWaitingSent && typeof candidate.postMessage === "function") {
      waitingWorker = candidate;
      skipWaitingSent = true;
      candidate.postMessage({ type: "SKIP_WAITING" });
      return true;
    }
    return false;
  }

  function onWaitingWorker(worker) {
    if (!worker || ac.signal.aborted) return;
    if (waitingWorker !== worker) {
      waitingWorker = worker;
      skipWaitingSent = false;
    }
    evaluateBoundary();
  }

  function trackInstalling(worker) {
    if (!worker || typeof worker.addEventListener !== "function") return;
    worker.addEventListener(
      "statechange",
      () => {
        if (ac.signal.aborted || worker.state !== "installed") return;
        if ((swContainer && swContainer.controller) || (registration && registration.waiting)) {
          onWaitingWorker((registration && registration.waiting) || worker);
        }
      },
      { signal: ac.signal }
    );
  }

  function checkForUpdate() {
    if (ac.signal.aborted || !registration || typeof registration.update !== "function") {
      return Promise.resolve(false);
    }
    const ts = nowFn();
    if (lastUpdateCheckAt > 0 && ts - lastUpdateCheckAt < SW_UPDATE_THROTTLE_MS) {
      return Promise.resolve(false);
    }
    lastUpdateCheckAt = ts;
    return Promise.resolve(registration.update())
      .then(() => {
        if (!ac.signal.aborted && registration && registration.waiting) {
          onWaitingWorker(registration.waiting);
        }
        return true;
      })
      .catch(() => false);
  }

  function start() {
    if (ac.signal.aborted || !swContainer || typeof swContainer.register !== "function") {
      return Promise.resolve(null);
    }
    hadController = Boolean(swContainer.controller);

    swContainer.addEventListener?.(
      "controllerchange",
      () => {
        if (ac.signal.aborted) return;
        if (!hadController) {
          hadController = true;
          return;
        }
        waitingWorker = null;
        skipWaitingSent = false;
        if (isSafeToReload()) {
          reloadDeferred = false;
          triggerReloadOnce();
        } else {
          reloadDeferred = true;
        }
      },
      { signal: ac.signal }
    );

    if (typeof document !== "undefined" && document && typeof document.addEventListener === "function") {
      document.addEventListener(
        "visibilitychange",
        () => {
          if (!document.hidden && document.visibilityState !== "hidden") {
            checkForUpdate();
          }
        },
        { signal: ac.signal }
      );
    }

    if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
      window.addEventListener("online", () => checkForUpdate(), { signal: ac.signal });
    }

    return Promise.resolve(swContainer.register("./sw.js", { updateViaCache: "none" }))
      .then((reg) => {
        if (ac.signal.aborted || !reg) return null;
        registration = reg;
        lastUpdateCheckAt = nowFn();
        if (reg.waiting) onWaitingWorker(reg.waiting);
        if (reg.installing) trackInstalling(reg.installing);
        reg.addEventListener?.(
          "updatefound",
          () => {
            if (reg.installing) trackInstalling(reg.installing);
          },
          { signal: ac.signal }
        );
        return reg;
      })
      .catch(() => null);
  }

  function dispose() {
    ac.abort();
    registration = null;
    waitingWorker = null;
  }

  return {
    start,
    checkForUpdate,
    evaluateBoundary,
    dispose,
  };
}
