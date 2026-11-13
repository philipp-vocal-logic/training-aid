// Unit and integration tests for SW updateViaCache, JSON backup Export/Import, storage error detection,
// #setup overwrite confirmation guard, native <dialog>/<details> disclosures, and keyboard-accessible tiles.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
  distHandle = resolveBuiltDist("ta-state-a11y-");
  catalog = distHandle.catalog;
  distDir = distHandle.distDir;
});

after(() => {
  if (distHandle) distHandle.cleanup();
});

test("AC-1: app.js registers ./sw.js with { updateViaCache: 'none' }", async () => {
  installBrowserEnv({ catalog, initialHash: "#setup", manualBoot: true });
  const regCalls = [];
  globalThis.navigator.serviceWorker = {
    register(url, opts) {
      regCalls.push({ url, opts });
      return Promise.resolve({});
    },
  };

  const appMod = await importDistModule(distDir, "app.js");
  await appMod.boot();

  assert.equal(regCalls.length, 1);
  assert.equal(regCalls[0].url, "./sw.js");
  assert.deepEqual(regCalls[0].opts, { updateViaCache: "none" });
  appMod.teardownActiveView();
});

test("AC-1: store.exportStateJson, store.importStateJson round-trip, validation, and store.hasStorageError", async () => {
  installBrowserEnv({ catalog, manualBoot: true });
  const { createStore, SCHEMA_VERSION } = await importDistModule(distDir, "state", "store.js");

  let shouldThrowQuota = false;
  const baseStorage = makeMemoryStorage();
  const faultyStorage = {
    getItem: (k) => baseStorage.getItem(k),
    setItem: (k, v) => {
      if (shouldThrowQuota) throw new Error("QuotaExceededError");
      baseStorage.setItem(k, v);
    },
  };

  const store = createStore({
    catalog,
    storage: faultyStorage,
    nowFn: () => new Date("2026-11-13T10:00:00Z"),
  });

  assert.equal(store.hasActivePlan(), false);
  assert.equal(store.exportStateJson(), null);
  assert.equal(store.hasStorageError(), false);

  // Trigger storage error during setupPlan
  shouldThrowQuota = true;
  store.setupPlan({
    name: "Backup Athlete",
    equipment_list: ["dumbbell", "kettlebells"],
    starting_intensity: "moderate",
    days_per_week: 3,
    sound_theme: "minimal",
    speed_mode: "fast",
    rest_seconds: 45,
  });
  assert.equal(store.hasActivePlan(), true);
  assert.equal(store.hasStorageError(), true);

  // Recover when storage succeeds
  shouldThrowQuota = false;
  store.addWorkoutDay();
  assert.equal(store.hasStorageError(), false);

  // Complete a workout and customize a routine
  store.completeWorkout("r1", {
    next_intensity_choice: "more",
    duration_minutes: 30,
    completed_at: "2026-11-13T10:30:00Z",
  });
  const exportedJson = store.exportStateJson();
  assert.equal(typeof exportedJson, "string");
  const parsedExport = JSON.parse(exportedJson);
  assert.equal(parsedExport.schema_version, SCHEMA_VERSION);
  assert.equal(parsedExport.profile.name, "Backup Athlete");
  assert.equal(parsedExport.plan.routines.length, 4);
  assert.equal(parsedExport.logs.length, 1);

  // Import into a fresh store instance and verify round-trip + transient session reset
  const store2 = createStore({
    catalog,
    storage: makeMemoryStorage(),
    nowFn: () => new Date("2026-11-13T12:00:00Z"),
  });
  store2.setupPlan({ name: "Temp", equipment_list: [], days_per_week: 2 });
  store2.setSessionEquipment(["barbell"]);
  store2.generateAdHocSession();
  assert.equal(store2.hasSessionEquipmentOverride(), true);
  assert.equal(store2.hasAdHocSession(), true);

  const importedState = store2.importStateJson(exportedJson);
  assert.equal(importedState.profile.name, "Backup Athlete");
  assert.deepEqual(importedState.profile.equipment_list, ["dumbbell", "kettlebells"]);
  assert.equal(importedState.plan.routines.length, 4);
  assert.equal(importedState.logs.length, 1);
  assert.equal(store2.hasSessionEquipmentOverride(), false);
  assert.equal(store2.hasAdHocSession(), false);

  // Reject empty, malformed JSON, or invalid schema without mutating existing state
  assert.throws(() => store2.importStateJson(""), /non-empty JSON/i);
  assert.throws(() => store2.importStateJson("{not-valid-json"), /not valid JSON/i);
  assert.throws(
    () => store2.importStateJson(JSON.stringify({ schema_version: 1, profile: {}, plan: { routines: [] } })),
    /schema_version/i
  );
  assert.throws(
    () => store2.importStateJson(JSON.stringify({ schema_version: 2, profile: null, plan: { routines: [] } })),
    /profile/i
  );
  assert.equal(store2.getState().profile.name, "Backup Athlete");
});

test("AC-2: #setup overwrite confirmation guard, .backup-bar & <details> disclosures, and #progress-export-btn removal", async () => {
  const env = installBrowserEnv({ catalog, initialHash: "#setup", manualBoot: true });
  const { docRoot, appRoot, modalRoot, getHash, setHash } = env;

  const createdUrls = [];
  const revokedUrls = [];
  const origCreateObjUrl = URL.createObjectURL;
  const origRevokeObjUrl = URL.revokeObjectURL;
  URL.createObjectURL = (blob) => {
    const u = `blob:ta-test-${createdUrls.length + 1}`;
    createdUrls.push({ url: u, blob });
    return u;
  };
  URL.revokeObjectURL = (u) => {
    revokedUrls.push(u);
  };

  try {
    const appMod = await importDistModule(distDir, "app.js");
    await appMod.boot();
    assert.equal(getHash(), "#setup");

    // Verify .setup-form omits Athlete name input, keeps <input type='file'> outside, and wraps disclosures in <details>
    const setupForm = appRoot.querySelector(".setup-form");
    assert.equal(
      setupForm.querySelectorAll("input").some((i) => i.attrs.name === "name"),
      false,
      ".setup-form must omit Athlete name input"
    );
    assert.equal(
      setupForm.querySelectorAll("input").some((i) => i.attrs.type === "file"),
      false,
      ".setup-form must not contain <input type='file'>"
    );
    const pacingDisclosure = setupForm.querySelector(".setup-pacing-disclosure");
    assert.ok(Boolean(pacingDisclosure) && pacingDisclosure.tagName === "DETAILS");
    assert.equal(pacingDisclosure.open, false);
    assert.equal(pacingDisclosure.getAttribute("open"), null);

    const backupDisclosure = appRoot.querySelector(".backup-disclosure");
    assert.ok(Boolean(backupDisclosure) && backupDisclosure.tagName === "DETAILS");
    assert.equal(setupForm.querySelector(".backup-disclosure"), null);
    assert.equal(backupDisclosure.open, false);
    assert.equal(backupDisclosure.getAttribute("open"), null);
    const backupBar = backupDisclosure.querySelector(".backup-bar");
    assert.ok(Boolean(backupBar), "#setup must render .backup-bar inside .backup-disclosure");
    assert.equal(docRoot.getElementById("backup-export-btn").hidden, true);
    assert.equal(docRoot.getElementById("storage-error-pill").hidden, true);

    // 1. First-time #setup submit saves directly without confirmation modal, defaulting name to "Athlete"
    setupForm.dispatchEvent({ type: "submit" });
    assert.equal(modalRoot.hidden, true, "First-time setup must not open overwrite modal");
    assert.equal(getHash(), "#plan");

    // Verify #plan <details.filter-panel> is closed by default and preserves open across gear toggles
    const planFilter = appRoot.querySelector(".filter-panel");
    assert.ok(Boolean(planFilter) && planFilter.tagName === "DETAILS");
    assert.equal(planFilter.open, false);
    assert.equal(planFilter.getAttribute("open"), null);
    planFilter.open = true;
    planFilter.setAttribute("open", "");
    planFilter.querySelector(".equip-chip-bar").querySelectorAll("button")[0].click();
    const reRenderedFilter = appRoot.querySelector(".filter-panel");
    assert.equal(reRenderedFilter.open, true, "Gear toggle in #plan must preserve filter-panel open state");
    assert.equal(reRenderedFilter.getAttribute("open"), "");

    // Add a custom workout day in #plan so routines length becomes 4
    const addDayBtn = appRoot
      .querySelectorAll("button")
      .find((b) => b.textContent.includes("+ Day"));
    addDayBtn.click();
    assert.equal(getHash(), "#edit/r4");

    // 2. Navigate back to #setup when active plan exists -> Export button is visible
    setHash("#setup");
    const exportBtn = docRoot.getElementById("backup-export-btn");
    assert.equal(exportBtn.hidden, false);
    assert.equal(exportBtn.disabled, false);

    // Export JSON from #setup
    exportBtn.click();
    assert.equal(createdUrls.length, 1);
    assert.equal(revokedUrls.length, 1);
    const exportedText = await createdUrls[0].blob.text();
    const exportedData = JSON.parse(exportedText);
    assert.equal(exportedData.profile.name, "Athlete");
    assert.equal(exportedData.plan.routines.length, 4);

    // 3. Submitting #setup when store.hasActivePlan() opens confirmation modal
    const setupForm2 = appRoot.querySelector(".setup-form");
    setupForm2.dispatchEvent({ type: "submit" });

    assert.equal(modalRoot.hidden, false, "Submitting #setup with active plan must open modal");
    assert.equal(getHash(), "#setup", "Must stay on #setup until confirmed");
    const cancelBtn = docRoot.getElementById("setup-overwrite-cancel-btn");
    const confirmBtn = docRoot.getElementById("setup-overwrite-confirm-btn");
    assert.ok(Boolean(cancelBtn));
    assert.ok(Boolean(confirmBtn));

    // Cancel keeps original plan and routines intact
    cancelBtn.click();
    assert.equal(modalRoot.hidden, true);
    setHash("#plan");
    assert.equal(appRoot.querySelectorAll(".routine-card").length, 4);

    // Return to #setup, submit again, and Confirm overwrite
    setHash("#setup");
    const setupForm3 = appRoot.querySelector(".setup-form");
    setupForm3.dispatchEvent({ type: "submit" });
    assert.equal(modalRoot.hidden, false);
    docRoot.getElementById("setup-overwrite-confirm-btn").click();
    assert.equal(modalRoot.hidden, true);
    assert.equal(getHash(), "#plan");
    assert.equal(appRoot.querySelectorAll(".routine-card").length, 3, "Plan replaced with fresh 3-day schedule");

    // 4. Verify #progress omits #progress-export-btn and renders compact .empty-state-card when empty
    setHash("#progress");
    assert.equal(docRoot.getElementById("progress-export-btn"), null, "#progress must omit #progress-export-btn");
    assert.equal(docRoot.getElementById("empty-progress-svg"), null);
    assert.ok(Boolean(appRoot.querySelector(".empty-state-card")));

    // 5. Test Import JSON error handling (XSS & invalid schema) and valid round-trip restore on #setup
    setHash("#setup");
    const fileInput = docRoot.getElementById("backup-file-input");
    const statusMsg = docRoot.getElementById("backup-status-msg");

    fileInput.files = [{ text: () => "<script>alert(1)</script>" }];
    fileInput.dispatchEvent({ type: "change" });
    assert.equal(statusMsg.hidden, false);
    assert.match(statusMsg.textContent, /not valid JSON/i);
    assert.equal(getHash(), "#setup");

    // Valid import restores the 4-routine backup (with custom profile.name and completed workout log) and navigates to #plan
    const backupWithLog = JSON.parse(exportedText);
    backupWithLog.profile.name = "Restored Athlete";
    backupWithLog.logs = [
      {
        id: "log_test_1",
        routine_id: "r1",
        routine_name: "Day 1",
        completed_at: "2026-11-13T10:30:00.000Z",
        duration_minutes: 25,
        intensity_at_session: 0,
        next_intensity_choice: "keep",
        is_adhoc: false,
        was_substituted: false,
        speed_mode: "normal",
        rest_seconds: 30,
        exercises: [{ exercise_id: catalog.exercises[0].id, name: catalog.exercises[0].name, sets: 3, reps: 10, unit: "reps", weight_kg: null }],
      },
    ];
    fileInput.files = [{ text: () => JSON.stringify(backupWithLog) }];
    fileInput.dispatchEvent({ type: "change" });
    assert.equal(getHash(), "#plan");
    assert.equal(appRoot.querySelectorAll(".routine-card").length, 4);

    // Confirming #setup overwrite preserves curName ("Restored Athlete") and completed workout history
    setHash("#setup");
    const setupForm4 = appRoot.querySelector(".setup-form");
    setupForm4.dispatchEvent({ type: "submit" });
    docRoot.getElementById("setup-overwrite-confirm-btn").click();
    assert.equal(
      JSON.parse(env.storage.getItem("training_aid_state_v2")).profile.name,
      "Restored Athlete",
      "Setup overwrite must preserve existing curName"
    );

    setHash("#progress");
    const logDetails = appRoot.querySelector(".log-details");
    assert.ok(Boolean(logDetails) && logDetails.tagName === "DETAILS");
    assert.equal(logDetails.open, false);
    assert.equal(logDetails.getAttribute("open"), null);
    assert.ok(Boolean(logDetails.querySelector(".disclosure-summary")));
    assert.ok(Boolean(logDetails.querySelector(".log-ex-list")), "Completed workout history must be kept after plan overwrite");

    // Verify #storage-error-pill renders and .backup-disclosure auto-opens when localStorage.setItem throws
    const origSetItem = env.storage.setItem;
    env.storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    setHash("#setup");
    const fileInput2 = docRoot.getElementById("backup-file-input");
    fileInput2.files = [{ text: () => JSON.stringify(backupWithLog) }];
    fileInput2.dispatchEvent({ type: "change" });
    setHash("#setup");
    assert.equal(docRoot.getElementById("storage-error-pill").hidden, false);
    const errBackupDisclosure = appRoot.querySelector(".backup-disclosure");
    assert.equal(errBackupDisclosure.open, true, ".backup-disclosure must auto-open when hasStorageErr is true");
    assert.equal(errBackupDisclosure.getAttribute("open"), "");
    env.storage.setItem = origSetItem;

    appMod.teardownActiveView();
  } finally {
    URL.createObjectURL = origCreateObjUrl;
    URL.revokeObjectURL = origRevokeObjUrl;
  }
});

test("AC-3: modal.js uses <dialog class='modal-dialog'>, focuses first control, and restores priorFocus on close", async () => {
  const env = installBrowserEnv({ catalog, initialHash: "#setup", manualBoot: true });
  const { docRoot, modalRoot, winListeners } = env;
  const { el } = await importDistModule(distDir, "ui", "dom.js");
  const { openModal, closeModal } = await importDistModule(distDir, "ui", "modal.js");

  const triggerBtn = el("button", { id: "trigger-btn", textContent: "Open" });
  docRoot.appendChild(triggerBtn);
  triggerBtn.focus();
  assert.equal(document.activeElement, triggerBtn);

  let escapeCount = 0;
  openModal(
    (mScope) => {
      const firstBtn = el("button", { id: "modal-first-btn", textContent: "First" });
      const secondBtn = el("button", { id: "modal-second-btn", textContent: "Second" });
      mScope.on(firstBtn, "click", () => closeModal());
      return el("div", { className: "modal-card" }, [firstBtn, secondBtn]);
    },
    () => {
      escapeCount += 1;
      closeModal();
    }
  );

  assert.equal(modalRoot.hidden, false);
  const dialog = modalRoot.querySelector("dialog");
  assert.ok(Boolean(dialog), "Modal must mount a native <dialog> element");
  assert.equal(dialog.classList.contains("modal-dialog"), true);
  assert.equal(dialog.open, true, "dialog.showModal() must mark dialog open");

  const firstBtn = docRoot.getElementById("modal-first-btn");
  assert.equal(
    document.activeElement,
    firstBtn,
    "openModal must focus the first interactive control inside <dialog>"
  );

  // Triggering both dialog 'cancel' and window 'Escape' must only invoke onEscape once
  dialog.dispatchEvent({ type: "cancel" });
  for (const fn of [...(winListeners.get("keydown") || [])]) {
    fn({ key: "Escape", preventDefault() {} });
  }
  assert.equal(escapeCount, 1);
  assert.equal(modalRoot.hidden, true);
  assert.equal(
    document.activeElement,
    triggerBtn,
    "closeModal must restore focus to the element active before openModal"
  );
});

test("AC-3: primitives.css keeps .tile-option inputs keyboard-focusable (no display: none) and resets dialog.modal-dialog", () => {
  const cssPath = path.join(distDir, "styles", "primitives.css");
  const cssText = fs.readFileSync(cssPath, "utf8");

  assert.equal(
    /\.tile-option\s+input[^{]*\{[^}]*display\s*:\s*none/i.test(cssText),
    false,
    ".tile-option inputs must not use display: none"
  );
  assert.match(cssText, /\.tile-option:has\(input:focus-visible\)/);
  assert.match(cssText, /dialog\.modal-dialog\s*\{/);
});
