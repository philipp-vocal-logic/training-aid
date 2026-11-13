/* Screen Wake Lock lifecycle helper with automatic cleanup and visibility re-acquire */
export function createWakeLock(scope, navObj) {
  const nav = navObj !== undefined ? navObj : (typeof navigator !== "undefined" ? navigator : null);
  let shouldHoldState = false;
  let sentinel = null;
  let pending = false;

  const isDisposed = () => Boolean(scope && typeof scope.isDisposed === "function" && scope.isDisposed());

  function safeRelease(target) {
    if (!target || typeof target.release !== "function") return;
    try {
      Promise.resolve(target.release()).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  function release() {
    shouldHoldState = false;
    const held = sentinel;
    sentinel = null;
    if (held) safeRelease(held);
  }

  function sync(shouldHold) {
    if (sentinel && sentinel.released) sentinel = null;
    if (!shouldHold || isDisposed()) {
      release();
      return;
    }
    shouldHoldState = true;
    if (sentinel || pending || typeof nav?.wakeLock?.request !== "function") return;
    pending = true;
    let req;
    try {
      req = Promise.resolve(nav.wakeLock.request("screen"));
    } catch {
      pending = false;
      return;
    }
    req
      .then((s) => {
        pending = false;
        if (!s) return;
        if (!shouldHoldState || isDisposed()) {
          safeRelease(s);
          return;
        }
        sentinel = s;
        if (typeof s.addEventListener === "function") {
          s.addEventListener(
            "release",
            () => {
              if (sentinel === s) sentinel = null;
            },
            { once: true }
          );
        }
      })
      .catch(() => {
        pending = false;
      });
  }

  if (typeof scope?.onCleanup === "function") {
    scope.onCleanup(release);
  }

  return {
    sync,
    release,
    isHeld: () => Boolean(sentinel && !sentinel.released),
  };
}
