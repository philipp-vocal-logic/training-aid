/* Thin SPA router, view lifecycle, and boot controller */
(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const dom = root.TrainingDom || (typeof require === "function" ? require("./dom.js") : null);

  function getViews() {
    const v = root.TrainingViews || {};
    if (typeof require === "function") {
      for (const name of ["setup", "plan", "quick", "edit", "workout", "progress"]) {
        if (!v[name]) {
          try { v[name] = require(`./views/${name}.js`); } catch { /* ignore */ }
        }
      }
    }
    return v;
  }

  function safeDecodeRouteParam(rawSegment) {
    if (!rawSegment) return null;
    try { return decodeURIComponent(rawSegment) || null; } catch { return null; }
  }

  function makeRoute(view, id, extra) {
    return { view, name: view, route: view, id, param: id, routineId: id, invalid: false, ...extra };
  }

  function parseRoute(rawHash) {
    const clean = String(rawHash || "").replace(/^#+/, "");
    if (!clean || clean === "/" || clean === "plan") return makeRoute("plan", null);
    if (clean === "setup" || clean === "progress" || clean === "quick") return makeRoute(clean, null);
    if (clean.startsWith("edit/")) {
      const editId = safeDecodeRouteParam(clean.slice(5));
      if (editId !== null) return makeRoute("edit", editId);
    }
    if (clean.startsWith("workout/")) {
      const workoutId = safeDecodeRouteParam(clean.slice(8));
      if (workoutId !== null) return makeRoute("workout", workoutId);
    }
    return makeRoute("invalid", null, { invalid: true });
  }

  let catalog = null, store = null, sound = null, activeScope = null, lastCompletedLog = null;

  function teardownActiveView() {
    if (sound) sound.stopAll();
    if (activeScope) {
      activeScope.dispose();
      activeScope = null;
    }
  }

  function syncTopbar(activeNav, hideTopbar) {
    const topbar = document.getElementById("app-topbar");
    const nav = document.getElementById("primary-nav");
    const brandLink = document.getElementById("brand-home-link");
    const hasPlan = Boolean(store && store.hasActivePlan());

    if (topbar) topbar.hidden = Boolean(hideTopbar);
    if (brandLink) brandLink.setAttribute("href", hasPlan ? "#plan" : "#setup");
    if (nav) {
      nav.hidden = !hasPlan;
      for (const lnk of nav.querySelectorAll("a[data-nav]")) {
        if (lnk.dataset.nav === activeNav) lnk.setAttribute("aria-current", "page");
        else lnk.removeAttribute("aria-current");
      }
    }
  }

  function replaceHash(hash) {
    const target = hash.startsWith("#") ? hash : "#" + hash;
    window.history.replaceState(null, "", window.location.pathname + window.location.search + target);
  }

  function navigateTo(hash) {
    const target = hash.startsWith("#") ? hash : "#" + hash;
    if (window.location.hash === target) handleRoute();
    else window.location.hash = target;
  }

  function mountView(viewName, routineId) {
    const views = getViews();
    teardownActiveView();
    const scope = dom.createViewScope();
    activeScope = scope;
    const viewFn = views[viewName];
    if (typeof viewFn === "function") {
      viewFn({
        scope, store, catalog, sound, routineId: routineId || null,
        navigateTo, replaceHash, syncTopbar,
        consumeCompletedLog: () => { const log = lastCompletedLog; lastCompletedLog = null; return log; },
        onCompleteLog: (log) => { lastCompletedLog = log; },
      });
    }
  }

  function handleRoute() {
    if (!store || !catalog) return;
    const parsed = parseRoute(window.location.hash || "");

    dom.closeModal();
    if (parsed.view === "setup") { mountView("setup"); return; }
    if (!store.hasActivePlan()) { replaceHash("#setup"); mountView("setup"); return; }
    if (parsed.view === "plan" || parsed.view === "progress" || parsed.view === "quick") {
      mountView(parsed.view);
      return;
    }
    if (parsed.view === "edit" && store.getRoutine(parsed.id)) {
      mountView("edit", parsed.id);
      return;
    }
    if (parsed.view === "workout") {
      if (parsed.id === "adhoc") {
        if (!store.hasAdHocSession()) store.ensureAdHocSession();
        mountView("workout", "adhoc");
        return;
      }
      if (store.getRoutine(parsed.id)) {
        mountView("workout", parsed.id);
        return;
      }
    }
    replaceHash("#plan");
    mountView("plan");
  }

  function boot() {
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator &&
        (window.location.protocol === "https:" || window.location.protocol === "http:")) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }

    const catalogPromise = root.__TRAINING_CATALOG__
      ? Promise.resolve(root.__TRAINING_CATALOG__)
      : fetch("./data/catalog.json").then((resp) => {
          if (!resp.ok) throw new Error(`Failed to load catalog (${resp.status})`);
          return resp.json();
        });

    return catalogPromise
      .then((loadedCatalog) => {
        catalog = loadedCatalog;
        store = root.TrainingStore.createStore({ catalog });
        sound = root.TrainingSound.createController({
          theme: store.getSoundTheme(),
          turnaroundForMode: root.TrainingMotion && root.TrainingMotion.turnaroundForMode,
        });
        sound.setTheme(store.getSoundTheme());
        window.removeEventListener("hashchange", handleRoute);
        window.addEventListener("hashchange", handleRoute);
        handleRoute();
      })
      .catch((err) => {
        const appRoot = document.getElementById("app-root");
        if (appRoot && dom) {
          appRoot.replaceChildren(
            dom.el("main", { className: "boot-screen" }, [
              dom.el("div", { className: "muted", textContent: `Unable to load trainer catalog: ${err && err.message ? err.message : "offline"}` }),
            ])
          );
        }
      });
  }

  const viewsObj = getViews();
  const exportedApi = {
    parseRoute, safeDecodeRouteParam, boot, handleRoute, teardownActiveView,
    resolveSvgMarkup: dom && dom.resolveSvgMarkup,
    createViewScope: dom && dom.createViewScope,
    formatLogDate: dom && dom.formatLogDate,
    formatLogDateTime: dom && dom.formatLogDateTime,
    buildProgressChartSvg: viewsObj.progress && viewsObj.progress.buildProgressChartSvg,
  };

  root.TrainingApp = exportedApi;
  if (typeof module !== "undefined" && module.exports) module.exports = exportedApi;

  if (typeof document !== "undefined" && typeof window !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
