/* Scoped Fullscreen API controller with standalone PWA detection, WebKit fallback, and route-exit cleanup */
export function createFullscreen(scope, opts = {}) {
  const doc = opts.doc !== undefined ? opts.doc : (typeof document !== "undefined" ? document : null);
  const win = opts.win !== undefined ? opts.win : (typeof window !== "undefined" ? window : null);
  const nav = opts.nav !== undefined ? opts.nav : (typeof navigator !== "undefined" ? navigator : null);
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;

  const standaloneMql =
    win && typeof win.matchMedia === "function" ? win.matchMedia("(display-mode: standalone)") : null;
  const fullscreenMql =
    win && typeof win.matchMedia === "function" ? win.matchMedia("(display-mode: fullscreen)") : null;

  let pending = false;

  const isDisposed = () => Boolean(scope && typeof scope.isDisposed === "function" && scope.isDisposed());

  function getActiveElement() {
    if (!doc) return null;
    return doc.fullscreenElement || doc.webkitFullscreenElement || null;
  }

  function isActive() {
    return Boolean(getActiveElement());
  }

  function hasApi() {
    const root = doc && doc.documentElement;
    if (!doc || !root) return false;
    const std = Boolean(doc.fullscreenEnabled && typeof root.requestFullscreen === "function");
    const webkit = Boolean(doc.webkitFullscreenEnabled && typeof root.webkitRequestFullscreen === "function");
    return std || webkit;
  }

  function isStandaloneApp() {
    if (nav && nav.standalone === true) return true;
    if (standaloneMql && standaloneMql.matches) return true;
    if (fullscreenMql && fullscreenMql.matches && !isActive()) return true;
    return false;
  }

  function isSupported() {
    return hasApi() && !isStandaloneApp();
  }

  function notify() {
    if (!isDisposed() && onChange) onChange();
  }

  function safeExit() {
    if (!doc || !isActive()) return false;
    const exitFn =
      typeof doc.exitFullscreen === "function"
        ? () => doc.exitFullscreen()
        : typeof doc.webkitExitFullscreen === "function"
          ? () => doc.webkitExitFullscreen()
          : null;
    if (!exitFn) return false;
    try {
      Promise.resolve(exitFn())
        .then(() => notify())
        .catch(() => notify());
      return true;
    } catch {
      return false;
    }
  }

  function enter() {
    if (isDisposed() || pending || isActive() || !isSupported()) return false;
    const root = doc && doc.documentElement;
    if (!root) return false;
    pending = true;
    let req;
    try {
      req =
        typeof root.requestFullscreen === "function"
          ? Promise.resolve(root.requestFullscreen({ navigationUI: "show" }))
          : Promise.resolve(root.webkitRequestFullscreen());
    } catch {
      pending = false;
      return false;
    }
    req
      .then(() => {
        pending = false;
        if (isDisposed() && isActive()) {
          safeExit();
          return;
        }
        notify();
      })
      .catch(() => {
        pending = false;
        notify();
      });
    return true;
  }

  function exit() {
    return safeExit();
  }

  function toggle() {
    return isActive() ? exit() : enter();
  }

  if (doc && typeof scope?.on === "function") {
    scope.on(doc, "fullscreenchange", notify);
    scope.on(doc, "webkitfullscreenchange", notify);
  }
  if (typeof scope?.onMediaChange === "function") {
    scope.onMediaChange(standaloneMql, notify);
    scope.onMediaChange(fullscreenMql, notify);
  }
  if (typeof scope?.onCleanup === "function") {
    scope.onCleanup(() => {
      safeExit();
    });
  }

  return {
    isSupported,
    isActive,
    enter,
    exit,
    toggle,
  };
}
