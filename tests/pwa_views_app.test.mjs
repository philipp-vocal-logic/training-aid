// End-to-end SPA router, UI primitive, and screen view tests for pwa/{ui,views,app.js}.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  resolveBuiltDist,
  importDistModule,
  installBrowserEnv,
} from "./helpers/dom_harness.mjs";

let distHandle;
let catalog;
let distDir;

before(() => {
  distHandle = resolveBuiltDist("ta-views-app-");
  catalog = distHandle.catalog;
  distDir = distHandle.distDir;
});

after(() => {
  if (distHandle) distHandle.cleanup();
});

test("parseRoute lean contract and dead UI helper removal (no showToast or formatLogDate)", async () => {
  installBrowserEnv({ catalog, manualBoot: true });
  const domMod = await importDistModule(distDir, "ui", "dom.js");
  const chartMod = await importDistModule(distDir, "ui", "progress-chart.js");
  const appMod = await importDistModule(distDir, "app.js");

  assert.equal("showToast" in domMod, false);
  assert.equal("formatLogDate" in domMod, false);
  assert.equal(typeof domMod.formatLogDateTime, "function");
  assert.equal(typeof chartMod.buildProgressChartSvg, "function");

  assert.deepEqual(appMod.parseRoute("#plan"), {
    view: "plan",
    param: null,
    invalid: false,
  });
  assert.deepEqual(appMod.parseRoute("#workout/adhoc"), {
    view: "workout",
    param: "adhoc",
    invalid: false,
  });
  assert.deepEqual(appMod.parseRoute("#edit/%"), {
    view: "invalid",
    param: null,
    invalid: true,
  });
});

test("multiselect #setup -> #plan -> #quick -> #workout/adhoc full completion -> #progress chart & date-time logs", async () => {
  const env = installBrowserEnv({
    catalog,
    initialHash: "#edit/%",
    manualBoot: true,
  });
  const {
    docRoot,
    topbar,
    appRoot,
    modalRoot,
    activeIntervals,
    winListeners,
    getHash,
    setHash,
    stepFrames,
  } = env;

  const appMod = await importDistModule(distDir, "app.js");
  await appMod.boot();
  assert.equal(getHash(), "#setup");

  // Setup with XSS attempt in name + multiselect equipment (Dumbbells + Bands) + Fast tempo + 15s rest
  const setupForm = appRoot.querySelector(".setup-form");
  const allInputs = setupForm.querySelectorAll("input");
  allInputs.find((n) => n.attrs.name === "name").value =
    "<img src=x onerror=alert(1)>";
  for (const inp of allInputs) {
    if (inp.attrs.name === "equipment") {
      inp.checked = inp.value === "dumbbell" || inp.value === "bands";
    }
    if (inp.attrs.name === "speed_mode") inp.checked = inp.value === "fast";
    if (inp.attrs.name === "rest_seconds") inp.checked = inp.value === "15";
  }
  setupForm.dispatchEvent({ type: "submit" });

  assert.equal(getHash(), "#plan");
  assert.ok(appRoot.textContent.includes("Recommended Today"));
  assert.ok(appRoot.textContent.includes("Intensity 100%"));
  assert.equal(
    docRoot
      .querySelectorAll("*")
      .filter((n) => n.attrs && ("onerror" in n.attrs || n.tagName === "SCRIPT"))
      .length,
    0
  );

  // Open On-the-Fly (#quick), generate workout, trim to 1 exercise with 2 sets x 2 reps
  setHash("#quick");
  assert.ok(Boolean(docRoot.getElementById("quick-generate-btn")));
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

  // Launch ad-hoc workout and verify strict completion rules
  setHash("#workout/adhoc");
  assert.equal(topbar.hidden, true);
  assert.equal(
    docRoot.getElementById("early-finish-btn"),
    null,
    "Early finish button must not exist"
  );

  const primaryBtn = docRoot.getElementById("primary-btn");
  const skipBtn = docRoot.getElementById("skip-btn");
  const viewport = docRoot.getElementById("workout-viewport");

  // Start -> COUNTDOWN (skip allowed) -> ACTIVE (skip forbidden!)
  primaryBtn.click();
  assert.equal(viewport.dataset.state, "COUNTDOWN");
  assert.equal(skipBtn.style.display, "inline-flex");
  skipBtn.click();
  assert.equal(viewport.dataset.state, "ACTIVE");
  assert.equal(skipBtn.style.display, "none");

  // Clicking skip or ArrowRight during ACTIVE must NOT skip the set
  skipBtn.click();
  for (const fn of [...(winListeners.get("keydown") || [])]) {
    fn({ code: "ArrowRight", preventDefault() {} });
  }
  assert.equal(viewport.dataset.state, "ACTIVE");

  // Mid-workout Exit opens confirmation modal instead of logging or silently exiting
  docRoot.getElementById("exit-workout-btn").click();
  assert.equal(modalRoot.hidden, false);
  docRoot.getElementById("exit-cancel-btn").click();
  assert.equal(modalRoot.hidden, true);

  // Complete Set 1 by advancing elapsed time -> enters REST (skip & +15s visible)
  stepFrames(120);
  assert.equal(viewport.dataset.state, "REST");
  assert.equal(skipBtn.style.display, "inline-flex");
  assert.equal(
    docRoot.getElementById("extend-rest-btn").style.display,
    "inline-flex"
  );
  docRoot.getElementById("extend-rest-btn").click();

  // Skip rest -> Set 2 ACTIVE -> complete Set 2 -> FINISHED
  skipBtn.click();
  assert.equal(viewport.dataset.state, "ACTIVE");
  stepFrames(120);
  assert.equal(viewport.dataset.state, "FINISHED");

  // Save completed workout -> navigates to #plan, then check #progress date/time & exercise log
  docRoot.getElementById("finish-save-btn").click();
  assert.equal(getHash(), "#plan");
  assert.ok(appRoot.textContent.includes("Done Today (1)"));

  setHash("#progress");
  assert.ok(Boolean(appRoot.querySelector(".progress-svg-chart")));
  assert.ok(Boolean(appRoot.querySelector(".log-ex-list")));
  assert.ok(
    /20\d\d\s\u00b7\s\d\d:\d\d/.test(appRoot.textContent),
    "Stats must render local year and HH:MM time"
  );

  appMod.teardownActiveView();
  assert.equal(activeIntervals.size, 0);
});

test("renderCatalogPicker batch pagination, query reset, lazy thumbs, and Rope Jumping selection in #edit/r1 and #quick", async () => {
  const env = installBrowserEnv({
    catalog,
    initialHash: "#setup",
    manualBoot: true,
  });
  const { docRoot, appRoot, activeIntervals, getHash, setHash } = env;

  const scopeMod = await importDistModule(distDir, "ui", "scope.js");
  const widgetsMod = await importDistModule(distDir, "ui", "widgets.js");
  const appMod = await importDistModule(distDir, "app.js");

  const scope = scopeMod.createViewScope();
  const mockExercises = Array.from({ length: 120 }, (_, i) => ({
    id: `ex_${String(i + 1).padStart(3, "0")}`,
    name: `Exercise ${String(i + 1).padStart(3, "0")}`,
    primary_muscle: "quadriceps",
    equipment: i % 2 === 0 ? "other" : "body only",
    thumb_url: "./svgs/thumbs/squat__body_only.svg",
  }));
  const searchCalls = [];
  const mockStore = {
    searchCatalog(query, limit, opts) {
      searchCalls.push({ query, limit, opts });
      const q = String(query || "").trim().toLowerCase();
      return mockExercises
        .filter((ex) => !q || ex.name.toLowerCase().includes(q))
        .slice(0, limit);
    },
  };

  const pickedIds = [];
  const picker = widgetsMod.renderCatalogPicker(scope, mockStore, {
    onAdd: (id) => pickedIds.push(id),
  });

  assert.equal( picker.querySelectorAll("select").length, 0, "Picker must have zero filter dropdowns" );
  assert.equal(
    picker.searchInput.getAttribute("placeholder"),
    "Search name, muscle, gear, or category..."
  );
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].limit, 1000);
  assert.equal(searchCalls[0].opts.compatibleOnly, false);

  // Batch 1: 48 of 120
  assert.equal(
    picker.resultsWrap.querySelector(".picker-meta").textContent,
    "Showing 48 of 120 exercises"
  );
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 48);
  const firstThumb = picker.resultsWrap.querySelector(".svg-thumb");
  assert.equal(firstThumb.getAttribute("loading"), "lazy");
  assert.equal(firstThumb.getAttribute("decoding"), "async");
  assert.ok(picker.resultsWrap.textContent.includes("quadriceps \u00b7 other"));
  const moreBtn1 = picker.resultsWrap.querySelector(".picker-more-btn");
  assert.ok(Boolean(moreBtn1));
  assert.equal(moreBtn1.textContent, "Show more (72 remaining)");

  // Batch 2: 96 of 120
  moreBtn1.click();
  assert.equal(
    picker.resultsWrap.querySelector(".picker-meta").textContent,
    "Showing 96 of 120 exercises"
  );
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 96);
  const moreBtn2 = picker.resultsWrap.querySelector(".picker-more-btn");
  assert.ok(Boolean(moreBtn2));
  assert.equal(moreBtn2.textContent, "Show more (24 remaining)");

  // Batch 3: 120 of 120 (no more button)
  moreBtn2.click();
  assert.equal(
    picker.resultsWrap.querySelector(".picker-meta").textContent,
    "120 exercises"
  );
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 120);
  assert.equal(picker.resultsWrap.querySelector(".picker-more-btn"), null);

  // Query change resets pagination and handles singular count
  picker.searchInput.value = "Exercise 001";
  picker.searchInput.dispatchEvent({ type: "input" });
  assert.equal(
    picker.resultsWrap.querySelector(".picker-meta").textContent,
    "1 exercise"
  );
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 1);
  assert.equal(picker.resultsWrap.querySelector(".picker-more-btn"), null);

  // Clearing query resets back to initial 48 batch
  picker.searchInput.value = "";
  picker.searchInput.dispatchEvent({ type: "search" });
  assert.equal(
    picker.resultsWrap.querySelector(".picker-meta").textContent,
    "Showing 48 of 120 exercises"
  );
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 48);

  // Empty state when no exercises match
  picker.searchInput.value = "nonexistent-exercise-xyz";
  picker.searchInput.dispatchEvent({ type: "input" });
  assert.equal(picker.resultsWrap.textContent, "No matching exercises.");
  scope.dispose();

  // Boot app and verify searching & adding "Rope Jumping" ("other" equipment) in #edit/r1 and #quick
  await appMod.boot();
  assert.equal(getHash(), "#setup");
  const setupForm = appRoot.querySelector(".setup-form");
  setupForm.dispatchEvent({ type: "submit" });
  assert.equal(getHash(), "#plan");

  setHash("#edit/r1");
  const editSearch = appRoot.querySelector(".minimal-input");
  assert.equal(
    editSearch.getAttribute("placeholder"),
    "Search name, muscle, gear, or category..."
  );
  editSearch.value = "Rope Jumping";
  editSearch.dispatchEvent({ type: "input" });
  const editResults = docRoot.getElementById("search-results");
  assert.ok(editResults.textContent.includes("Rope Jumping"));
  assert.ok(editResults.textContent.includes("quadriceps \u00b7 other"));
  const addRopeEditBtn = editResults
    .querySelectorAll("button")
    .find((b) => b.attrs["aria-label"] === "Add Rope Jumping");
  assert.ok(Boolean(addRopeEditBtn), "Rope Jumping must be selectable in #edit/r1");
  addRopeEditBtn.click();
  assert.ok(
    appRoot.querySelector(".ex-list").textContent.includes("Rope Jumping"),
    "Rope Jumping must be added to routine r1"
  );

  setHash("#quick");
  const quickSearch = appRoot.querySelector(".minimal-input");
  assert.equal(
    quickSearch.getAttribute("placeholder"),
    "Search name, muscle, gear, or category..."
  );
  quickSearch.value = "Rope Jumping";
  quickSearch.dispatchEvent({ type: "input" });
  const quickResults = docRoot.getElementById("quick-search-results");
  assert.ok(quickResults.textContent.includes("Rope Jumping"));
  assert.ok(quickResults.textContent.includes("quadriceps \u00b7 other"));
  const addRopeQuickBtn = quickResults
    .querySelectorAll("button")
    .find((b) => b.attrs["aria-label"] === "Add Rope Jumping");
  assert.ok(Boolean(addRopeQuickBtn), "Rope Jumping must be selectable in #quick");
  addRopeQuickBtn.click();
  assert.ok(
    appRoot.querySelector(".ex-list").textContent.includes("Rope Jumping"),
    "Rope Jumping must be added to On-the-Fly session"
  );

  appMod.teardownActiveView();
  assert.equal(activeIntervals.size, 0);
});
