/* Thin SPA router, #import= ingestion, view lifecycle, and boot controller */
(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const dom = root.TrainingDom || (typeof require === "function" ? require("./dom.js") : null);

  function getViews() {
    const v = root.TrainingViews || {};
    if (typeof require === "function") {
      for (const name of ["setup", "plan", "edit", "workout", "progress"]) {
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
    return { view, name: view, route: view, id, param: id, routineId: id, token: null, invalid: false, ...extra };
  }

  function parseRoute(rawHash) {
    const raw = String(rawHash || "");
    const clean = raw.replace(/^#+/, "");
    if (clean.startsWith("import=")) {
      const token = clean.slice(7);
      return makeRoute("import", token, {
        routineId: null, token, rawHash: raw.startsWith("#") ? raw : "#" + clean, invalid: !token,
      });
    }
    if (!clean || clean === "/" || clean === "plan") return makeRoute("plan", null);
    if (clean === "setup" || clean === "progress") return makeRoute(clean, null);
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

  function handleIncomingShareImport(rawHash) {
    mountView(store.hasActivePlan() ? "plan" : "setup");
    const { el, openModal, closeModal, showToast } = dom;

    function finishImportFlow() {
      closeModal();
      replaceHash(store.hasActivePlan() ? "#plan" : "#setup");
      handleRoute();
    }

    Promise.resolve()
      .then(() => store.decodeShareFragment(rawHash))
      .then((preview) => {
        const incState = (preview && preview.state) || {};
        const athleteName = (incState.profile && incState.profile.name) || "Athlete";
        const planName = (incState.plan && incState.plan.name) || "Shared Training Plan";
        const rCount = Number(preview.routineCount) || 0;
        const exCount = Number(preview.exerciseCount) || 0;

        openModal((mScope) => {
          const cancelBtn = el("button", { type: "button", id: "import-cancel-btn", className: "btn-ghost", textContent: "Cancel" });
          const confirmBtn = el("button", { type: "button", id: "import-confirm-btn", className: "btn-primary", textContent: "Import Plan (Keep History)" });

          mScope.on(cancelBtn, "click", finishImportFlow);
          mScope.on(confirmBtn, "click", () => {
            if (typeof preview.apply === "function") preview.apply({ keepExistingLogs: true });
            else {
              const res = store.importBackupJson(incState, { mergeLogs: true, keepExistingLogs: true });
              if (res && typeof res.apply === "function") res.apply({ keepExistingLogs: true, mergeLogs: true });
            }
            sound.setTheme(store.getSoundTheme());
            finishImportFlow();
            showToast("Plan imported");
          });

          return el("div", { className: "modal-card", role: "dialog", "aria-modal": "true", "aria-label": "Import shared training plan" }, [
            el("div", { className: "modal-stats" }, [
              el("span", { className: "pill pill-brand", textContent: "Shared Plan" }),
              el("span", { className: "pill", textContent: `${rCount} routines` }),
              el("span", { className: "pill", textContent: `${exCount} exercises` }),
            ]),
            el("h2", { className: "modal-title", textContent: planName }),
            el("div", { className: "muted", textContent: `Athlete: ${athleteName} · Your local workout history will be preserved.` }),
            el("div", { className: "modal-actions" }, [cancelBtn, confirmBtn]),
          ]);
        }, finishImportFlow);
      })
      .catch(() => {
        openModal((mScope) => {
          const cancelBtn = el("button", { type: "button", id: "import-cancel-btn", className: "btn-ghost", textContent: "Cancel" });
          mScope.on(cancelBtn, "click", finishImportFlow);
          return el("div", { className: "modal-card is-error", role: "dialog", "aria-modal": "true", "aria-label": "Invalid share link" }, [
            el("h2", { className: "modal-title", textContent: "Invalid Share Link" }),
            el("div", { className: "muted", textContent: "This #import= link is malformed or corrupted and could not be imported." }),
            el("div", { className: "modal-actions" }, [cancelBtn]),
          ]);
        }, finishImportFlow);
      });
  }

  function handleRoute() {
    if (!store || !catalog) return;
    const rawHash = window.location.hash || "";
    const parsed = parseRoute(rawHash);

    if (parsed.view === "import" && !parsed.invalid) {
      handleIncomingShareImport(rawHash);
      return;
    }
    dom.closeModal();
    if (parsed.view === "setup") { mountView("setup"); return; }
    if (!store.hasActivePlan()) { replaceHash("#setup"); mountView("setup"); return; }
    if (parsed.view === "plan" || parsed.view === "progress") { mountView(parsed.view); return; }
    if ((parsed.view === "edit" || parsed.view === "workout") && store.getRoutine(parsed.id)) {
      mountView(parsed.view, parsed.id);
      return;
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
    buildProgressChartSvg: viewsObj.progress && viewsObj.progress.buildProgressChartSvg,
  };

  root.TrainingApp = exportedApi;
  if (typeof module !== "undefined" && module.exports) module.exports = exportedApi;

  if (typeof document !== "undefined" && typeof window !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  }
})();
