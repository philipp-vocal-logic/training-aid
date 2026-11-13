/* View lifecycle scope managing AbortController listeners, rAFs, intervals, and timeouts */
export function createViewScope() {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const rafIds = new Set();
  const intervals = new Set();
  const timeouts = new Set();
  const cleanups = [];
  let disposed = false;

  function on(target, eventName, handler, options) {
    if (!target || typeof target.addEventListener !== "function") return;
    if (controller) {
      target.addEventListener(eventName, handler, { ...(options || {}), signal: controller.signal });
    } else {
      target.addEventListener(eventName, handler, options || false);
      cleanups.push(() => target.removeEventListener(eventName, handler, options || false));
    }
  }

  function onMediaChange(mql, handler) {
    if (!mql) return;
    if (typeof mql.addEventListener === "function") on(mql, "change", handler);
    else if (typeof mql.addListener === "function") {
      mql.addListener(handler);
      cleanups.push(() => typeof mql.removeListener === "function" && mql.removeListener(handler));
    }
  }

  function requestFrame(cb) {
    if (disposed || typeof requestAnimationFrame !== "function") return null;
    const id = requestAnimationFrame((ts) => {
      rafIds.delete(id);
      if (!disposed) cb(ts);
    });
    rafIds.add(id);
    return id;
  }

  function cancelFrame(id) {
    if (id !== null && id !== undefined) {
      rafIds.delete(id);
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
    }
  }

  function addInterval(cb, ms) {
    if (disposed) return null;
    const id = setInterval(() => !disposed && cb(), ms);
    intervals.add(id);
    return id;
  }

  function clearTrackedInterval(id) {
    if (id !== null && id !== undefined) {
      intervals.delete(id);
      clearInterval(id);
    }
  }

  function addTimeout(cb, ms) {
    if (disposed) return null;
    const id = setTimeout(() => {
      timeouts.delete(id);
      if (!disposed) cb();
    }, ms);
    timeouts.add(id);
    return id;
  }

  function onCleanup(fn) {
    if (typeof fn === "function") cleanups.push(fn);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (controller) controller.abort();
    for (const id of rafIds) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
    }
    rafIds.clear();
    for (const id of intervals) clearInterval(id);
    intervals.clear();
    for (const id of timeouts) clearTimeout(id);
    timeouts.clear();
    for (const fn of cleanups) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
    cleanups.length = 0;
  }

  return {
    on,
    onMediaChange,
    requestFrame,
    cancelFrame,
    addInterval,
    clearTrackedInterval,
    addTimeout,
    onCleanup,
    dispose,
    isDisposed: () => disposed,
  };
}
