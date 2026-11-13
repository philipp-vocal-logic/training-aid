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
