/* Thin SPA router, view lifecycle, and boot controller */
import { createController } from "./audio/controller.js";
import { turnaroundForMode } from "./rig/motion.js";
import { createStore } from "./state/store.js";
import { el } from "./ui/dom.js";
import { closeModal } from "./ui/modal.js";
import { createViewScope } from "./ui/scope.js";
import { renderEditView } from "./views/edit.js";
import { renderPlanView } from "./views/plan.js";
import { renderProgressView } from "./views/progress.js";
import { renderQuickView } from "./views/quick.js";
import { renderSetupView } from "./views/setup.js";
import { renderWorkoutView } from "./views/workout.js";

const VIEWS = {
  setup: renderSetupView,
  plan: renderPlanView,
  quick: renderQuickView,
  edit: renderEditView,
  workout: renderWorkoutView,
  progress: renderProgressView,
};

export function safeDecodeRouteParam(rawSegment) {
  if (!rawSegment) return null;
  try {
    return decodeURIComponent(rawSegment) || null;
  } catch {
    return null;
  }
}

export function parseRoute(rawHash) {
  const clean = String(rawHash || "").replace(/^#+/, "");
  if (!clean || clean === "/" || clean === "plan") {
    return { view: "plan", param: null, invalid: false };
  }
  if (clean === "setup" || clean === "progress" || clean === "quick") {
    return { view: clean, param: null, invalid: false };
  }
  if (clean.startsWith("edit/")) {
    const editId = safeDecodeRouteParam(clean.slice(5));
    if (editId !== null) return { view: "edit", param: editId, invalid: false };
  }
  if (clean.startsWith("workout/")) {
    const workoutId = safeDecodeRouteParam(clean.slice(8));
    if (workoutId !== null) return { view: "workout", param: workoutId, invalid: false };
  }
  return { view: "invalid", param: null, invalid: true };
}

let catalog = null;
let store = null;
let sound = null;
let activeScope = null;
let lastCompletedLog = null;

export function teardownActiveView() {
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

function mountView(viewName, param) {
  teardownActiveView();
  const scope = createViewScope();
  activeScope = scope;
  const viewFn = VIEWS[viewName];
  if (typeof viewFn === "function") {
    viewFn({
      scope,
      store,
      catalog,
      sound,
      param: param || null,
      navigateTo,
      replaceHash,
      syncTopbar,
      consumeCompletedLog: () => {
        const log = lastCompletedLog;
        lastCompletedLog = null;
        return log;
      },
      onCompleteLog: (log) => {
        lastCompletedLog = log;
      },
    });
  }
}

export function handleRoute() {
  if (!store || !catalog) return;
  const parsed = parseRoute(window.location.hash || "");

  closeModal();
  if (parsed.view === "setup") {
    mountView("setup", null);
    return;
  }
  if (!store.hasActivePlan()) {
    replaceHash("#setup");
    mountView("setup", null);
    return;
  }
  if (parsed.view === "plan" || parsed.view === "progress" || parsed.view === "quick") {
    mountView(parsed.view, null);
    return;
  }
  if (parsed.view === "edit" && store.getRoutine(parsed.param)) {
    mountView("edit", parsed.param);
    return;
  }
  if (parsed.view === "workout") {
    if (parsed.param === "adhoc") {
      if (!store.hasAdHocSession()) store.ensureAdHocSession();
      mountView("workout", "adhoc");
      return;
    }
    if (store.getRoutine(parsed.param)) {
      mountView("workout", parsed.param);
      return;
    }
  }
  replaceHash("#plan");
  mountView("plan", null);
}

export function boot() {
  if (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    window.location &&
    (window.location.protocol === "https:" || window.location.protocol === "http:")
  ) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  const catalogPromise = globalThis.__TRAINING_CATALOG__
    ? Promise.resolve(globalThis.__TRAINING_CATALOG__)
    : fetch("./data/catalog.json").then((resp) => {
        if (!resp.ok) throw new Error(`Failed to load catalog (${resp.status})`);
        return resp.json();
      });

  return catalogPromise
    .then((loadedCatalog) => {
      catalog = loadedCatalog;
      store = createStore({ catalog });
      sound = createController({
        theme: store.getSoundTheme(),
        turnaroundForMode,
      });
      sound.setTheme(store.getSoundTheme());
      window.removeEventListener("hashchange", handleRoute);
      window.addEventListener("hashchange", handleRoute);
      handleRoute();
    })
    .catch((err) => {
      const appRoot = document.getElementById("app-root");
      if (appRoot) {
        appRoot.replaceChildren(
          el("main", { className: "boot-screen" }, [
            el("div", {
              className: "muted",
              textContent: `Unable to load trainer catalog: ${err && err.message ? err.message : "offline"}`,
            }),
          ])
        );
      }
    });
}

if (typeof document !== "undefined" && typeof window !== "undefined" && !window.__TA_MANUAL_BOOT__) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      if (document.getElementById("app-root")) boot();
    });
  } else if (document.getElementById("app-root")) {
    boot();
  }
}
