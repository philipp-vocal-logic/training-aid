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

test("renderCatalogPicker facets, equipment chips, reset, full-card click-to-add, and live badges in #edit/r1 and #quick", async () => {
  const env = installBrowserEnv({
    catalog,
    initialHash: "#setup",
    manualBoot: true,
  });
  const { docRoot, appRoot, activeIntervals, getHash, setHash } = env;

  const scopeMod = await importDistModule(distDir, "ui", "scope.js");
  const widgetsMod = await importDistModule(distDir, "ui", "widgets.js");
  const pickerMod = await importDistModule(distDir, "ui", "catalog-picker.js");
  const appMod = await importDistModule(distDir, "app.js");

  assert.equal(widgetsMod.renderCatalogPicker, pickerMod.renderCatalogPicker);

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

  const addedCounts = new Map();
  const pickedIds = [];
  const picker = widgetsMod.renderCatalogPicker(scope, mockStore, {
    getAddedCounts: () => addedCounts,
    onAdd: (id) => {
      pickedIds.push(id);
      addedCounts.set(id, (addedCounts.get(id) || 0) + 1);
      picker.refresh();
    },
  });

  // 3 facet selects + conditional Reset button inside .picker-filter-strip
  const filterStrip = picker.querySelector(".picker-filter-strip");
  assert.ok(Boolean(filterStrip), "Picker must render .picker-filter-strip");
  const selects = filterStrip.querySelectorAll("select");
  assert.equal(selects.length, 3, "Picker must render 3 facet dropdowns");
  const [muscleSelect, categorySelect, movementSelect] = selects;
  assert.equal(muscleSelect.getAttribute("aria-label"), "Filter by muscle");
  assert.equal(categorySelect.getAttribute("aria-label"), "Filter by category");
  assert.equal(movementSelect.getAttribute("aria-label"), "Filter by movement");
  assert.equal(muscleSelect.children[0].textContent, "All Muscles");
  assert.equal(categorySelect.children[0].textContent, "All Categories");
  assert.equal(movementSelect.children[0].textContent, "All Movements");
  assert.equal(muscleSelect.children.length, pickerMod.MUSCLE_OPTIONS.length + 1);
  assert.equal(categorySelect.children.length, pickerMod.CATEGORY_OPTIONS.length + 1);
  assert.equal(movementSelect.children.length, pickerMod.MOVEMENT_OPTIONS.length + 1);

  const resetBtn = filterStrip.querySelector(".picker-reset-btn");
  assert.ok(Boolean(resetBtn), "Picker must render .picker-reset-btn");
  assert.equal(resetBtn.textContent, "Reset");
  assert.equal(resetBtn.hidden, true, "Reset button must be hidden when no filter or query is active");

  // 8 selectable .equip-chip buttons in .catalog-equip-bar (including body_only)
  const equipBar = picker.querySelector(".catalog-equip-bar");
  assert.ok(Boolean(equipBar), "Picker must render .catalog-equip-bar");
  assert.equal(equipBar.getAttribute("aria-label"), "Filter catalog equipment");
  const equipChips = equipBar.querySelectorAll("button");
  assert.equal(equipChips.length, 8);
  assert.equal(equipChips[0].dataset.equipId, "body_only");
  assert.equal(equipChips[0].textContent, "Bodyweight");
  for (const chip of equipChips) {
    assert.equal(chip.getAttribute("aria-pressed"), "false");
    assert.equal(chip.classList.contains("is-active"), false);
    assert.ok(Boolean(chip.querySelector(".equip-icon")));
  }

  assert.equal(
    picker.searchInput.getAttribute("placeholder"),
    "Search name, muscle, gear, or category..."
  );
  assert.equal(searchCalls.length, 1);
  assert.equal(searchCalls[0].limit, 1000);
  assert.equal(searchCalls[0].opts.compatibleOnly, false);
  assert.deepEqual(searchCalls[0].opts.filters, {
    equipment: [],
    muscle: "",
    category: "",
    movement: "",
  });
  assert.deepEqual(picker.getFilters(), {
    equipment: [],
    muscle: "",
    category: "",
    movement: "",
  });

  // Batch 1: 48 of 120 full-card buttons
  assert.equal(
    picker.resultsWrap.querySelector(".picker-meta").textContent,
    "Showing 48 of 120 exercises"
  );
  const batch1Cards = picker.resultsWrap.querySelectorAll(".catalog-card");
  assert.equal(batch1Cards.length, 48);
  const firstCard = batch1Cards[0];
  assert.equal(firstCard.tagName, "BUTTON");
  assert.equal(firstCard.classList.contains("catalog-card-btn"), true);
  assert.equal(firstCard.classList.contains("is-added"), false);
  assert.equal(firstCard.dataset.exerciseId, "ex_001");
  assert.equal(firstCard.getAttribute("aria-label"), "Add Exercise 001");
  assert.equal(firstCard.querySelectorAll("button").length, 0, "No nested button inside card button");
  assert.equal(firstCard.querySelector(".catalog-card-badge").textContent, "+");

  const firstThumb = picker.resultsWrap.querySelector(".svg-thumb");
  assert.equal(firstThumb.getAttribute("loading"), "lazy");
  assert.equal(firstThumb.getAttribute("decoding"), "async");
  assert.ok(picker.resultsWrap.textContent.includes("quadriceps \u00b7 other"));
  const moreBtn1 = picker.resultsWrap.querySelector(".picker-more-btn");
  assert.ok(Boolean(moreBtn1));
  assert.equal(moreBtn1.textContent, "Show more (72 remaining)");

  // Click full card once -> badge "✓" + .is-added, twice -> badge "✓ 2"
  firstCard.click();
  assert.deepEqual(pickedIds, ["ex_001"]);
  let updatedFirstCard = picker.resultsWrap.querySelectorAll(".catalog-card")[0];
  assert.equal(updatedFirstCard.classList.contains("is-added"), true);
  assert.equal(updatedFirstCard.querySelector(".catalog-card-badge").textContent, "\u2713");
  updatedFirstCard.click();
  updatedFirstCard = picker.resultsWrap.querySelectorAll(".catalog-card")[0];
  assert.equal(updatedFirstCard.classList.contains("is-added"), true);
  assert.equal(updatedFirstCard.querySelector(".catalog-card-badge").textContent, "\u2713 2");

  // Batch 2: 96 of 120
  picker.resultsWrap.querySelector(".picker-more-btn").click();
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

  // Changing a facet select resets pagination to 48, shows Reset button, and forwards opts.filters
  muscleSelect.value = "quadriceps";
  muscleSelect.dispatchEvent({ type: "change" });
  assert.equal(resetBtn.hidden, false);
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 48);
  assert.deepEqual(searchCalls.at(-1).opts.filters, {
    equipment: [],
    muscle: "quadriceps",
    category: "",
    movement: "",
  });

  // Expand to 96 then toggle equipment chips -> resets pagination to 48 and updates aria-pressed/.is-active
  picker.resultsWrap.querySelector(".picker-more-btn").click();
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 96);
  equipChips[0].click(); // body_only
  equipChips[1].click(); // dumbbell
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 48);
  assert.equal(equipChips[0].classList.contains("is-active"), true);
  assert.equal(equipChips[0].getAttribute("aria-pressed"), "true");
  assert.equal(equipChips[1].classList.contains("is-active"), true);
  assert.equal(equipChips[1].getAttribute("aria-pressed"), "true");

  categorySelect.value = "cardio";
  categorySelect.dispatchEvent({ type: "change" });
  movementSelect.value = "lower";
  movementSelect.dispatchEvent({ type: "change" });
  assert.deepEqual(picker.getFilters(), {
    equipment: ["body_only", "dumbbell"],
    muscle: "quadriceps",
    category: "cardio",
    movement: "lower",
  });
  assert.deepEqual(searchCalls.at(-1).opts.filters, {
    equipment: ["body_only", "dumbbell"],
    muscle: "quadriceps",
    category: "cardio",
    movement: "lower",
  });

  // Query change resets pagination and handles singular count
  picker.searchInput.value = "Exercise 001";
  picker.searchInput.dispatchEvent({ type: "input" });
  assert.equal(
    picker.resultsWrap.querySelector(".picker-meta").textContent,
    "1 exercise"
  );
  assert.equal(picker.resultsWrap.querySelectorAll(".catalog-card").length, 1);
  assert.equal(picker.resultsWrap.querySelector(".picker-more-btn"), null);

  // Clicking Reset clears activeEquip, all 3 selects, and searchInput, hiding Reset and resetting to 48
  resetBtn.click();
  assert.equal(resetBtn.hidden, true);
  assert.equal(picker.searchInput.value, "");
  assert.deepEqual(picker.getFilters(), {
    equipment: [],
    muscle: "",
    category: "",
    movement: "",
  });
  for (const chip of equipChips) {
    assert.equal(chip.classList.contains("is-active"), false);
    assert.equal(chip.getAttribute("aria-pressed"), "false");
  }
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

  // Boot app and verify searching, full-card click-to-add, and live .is-added badges in #edit/r1 and #quick
  await appMod.boot();
  assert.equal(getHash(), "#setup");
  const setupForm = appRoot.querySelector(".setup-form");
  setupForm.dispatchEvent({ type: "submit" });
  assert.equal(getHash(), "#plan");

  setHash("#edit/r1");
  const editResults = docRoot.getElementById("search-results");
  assert.equal(
    editResults.querySelector(".picker-meta").textContent,
    "Showing 48 of 876 exercises"
  );
  const editEquipChips = appRoot
    .querySelector(".catalog-equip-bar")
    .querySelectorAll(".equip-chip");
  editEquipChips[0].click(); // body_only -> 176 bodyweight exercises
  assert.equal(
    editResults.querySelector(".picker-meta").textContent,
    "Showing 48 of 176 exercises"
  );
  const [editMuscleSelect, , editMovementSelect] = appRoot
    .querySelector(".picker-filter-strip")
    .querySelectorAll("select");
  editMuscleSelect.value = "chest";
  editMuscleSelect.dispatchEvent({ type: "change" });
  editMovementSelect.value = "push";
  editMovementSelect.dispatchEvent({ type: "change" });
  const filteredChestPushCards = editResults.querySelectorAll(".catalog-card");
  assert.ok(filteredChestPushCards.length > 0 && filteredChestPushCards.length < 48);
  assert.ok(
    filteredChestPushCards.every((c) => c.textContent.includes("chest \u00b7 body only"))
  );
  appRoot.querySelector(".picker-reset-btn").click();
  assert.equal(
    editResults.querySelector(".picker-meta").textContent,
    "Showing 48 of 876 exercises"
  );

  const editSearch = appRoot.querySelector(".minimal-input");
  assert.equal(
    editSearch.getAttribute("placeholder"),
    "Search name, muscle, gear, or category..."
  );
  editSearch.value = "Rope Jumping";
  editSearch.dispatchEvent({ type: "input" });
  assert.ok(editResults.textContent.includes("Rope Jumping"));
  assert.ok(editResults.textContent.includes("quadriceps \u00b7 other"));
  const findEditRopeCard = () =>
    editResults
      .querySelectorAll("button")
      .find((b) => b.attrs["aria-label"] === "Add Rope Jumping");
  let addRopeEditBtn = findEditRopeCard();
  assert.ok(Boolean(addRopeEditBtn), "Rope Jumping must be selectable in #edit/r1");
  assert.equal(addRopeEditBtn.classList.contains("is-added"), false);
  assert.equal(addRopeEditBtn.querySelector(".catalog-card-badge").textContent, "+");

  addRopeEditBtn.click();
  assert.ok(
    appRoot.querySelector(".ex-list").textContent.includes("Rope Jumping"),
    "Rope Jumping must be added to routine r1"
  );
  addRopeEditBtn = findEditRopeCard();
  assert.equal(addRopeEditBtn.classList.contains("is-added"), true);
  assert.equal(addRopeEditBtn.querySelector(".catalog-card-badge").textContent, "\u2713");

  addRopeEditBtn.click();
  addRopeEditBtn = findEditRopeCard();
  assert.equal(addRopeEditBtn.classList.contains("is-added"), true);
  assert.equal(addRopeEditBtn.querySelector(".catalog-card-badge").textContent, "\u2713 2");

  // Removing one instance in #edit/r1 updates badge back to "✓", and swapping the remaining one resets badge to "+"
  const editRemoveBtns = appRoot
    .querySelectorAll("button")
    .filter((b) => b.attrs["aria-label"] === "Remove");
  editRemoveBtns.at(-1).click();
  addRopeEditBtn = findEditRopeCard();
  assert.equal(addRopeEditBtn.classList.contains("is-added"), true);
  assert.equal(addRopeEditBtn.querySelector(".catalog-card-badge").textContent, "\u2713");

  const editSwapBtns = appRoot
    .querySelectorAll("button")
    .filter((b) => b.attrs["aria-label"] === "Random swap");
  editSwapBtns.at(-1).click();
  addRopeEditBtn = findEditRopeCard();
  assert.equal(addRopeEditBtn.classList.contains("is-added"), false);
  assert.equal(addRopeEditBtn.querySelector(".catalog-card-badge").textContent, "+");

  setHash("#quick");
  assert.equal(
    appRoot.querySelector(".filter-panel").querySelector(".field-label").textContent,
    "Workout Gear (Generator)"
  );
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
  const findQuickRopeCard = () =>
    quickResults
      .querySelectorAll("button")
      .find((b) => b.attrs["aria-label"] === "Add Rope Jumping");
  let addRopeQuickBtn = findQuickRopeCard();
  assert.ok(Boolean(addRopeQuickBtn), "Rope Jumping must be selectable in #quick");
  assert.equal(addRopeQuickBtn.classList.contains("is-added"), false);
  assert.equal(addRopeQuickBtn.querySelector(".catalog-card-badge").textContent, "+");

  addRopeQuickBtn.click();
  assert.ok(
    appRoot.querySelector(".ex-list").textContent.includes("Rope Jumping"),
    "Rope Jumping must be added to On-the-Fly session"
  );
  addRopeQuickBtn = findQuickRopeCard();
  assert.equal(addRopeQuickBtn.classList.contains("is-added"), true);
  assert.equal(addRopeQuickBtn.querySelector(".catalog-card-badge").textContent, "\u2713");

  addRopeQuickBtn.click();
  addRopeQuickBtn = findQuickRopeCard();
  assert.equal(addRopeQuickBtn.classList.contains("is-added"), true);
  assert.equal(addRopeQuickBtn.querySelector(".catalog-card-badge").textContent, "\u2713 2");

  // Removing one Rope Jumping instance in #quick updates badge to "✓", and Generate Workout resets it to "+"
  const quickRemoveBtns = appRoot
    .querySelectorAll("button")
    .filter((b) => b.attrs["aria-label"] === "Remove");
  quickRemoveBtns.at(-1).click();
  addRopeQuickBtn = findQuickRopeCard();
  assert.equal(addRopeQuickBtn.classList.contains("is-added"), true);
  assert.equal(addRopeQuickBtn.querySelector(".catalog-card-badge").textContent, "\u2713");

  docRoot.getElementById("quick-generate-btn").click();
  addRopeQuickBtn = findQuickRopeCard();
  assert.equal(addRopeQuickBtn.classList.contains("is-added"), false);
  assert.equal(addRopeQuickBtn.querySelector(".catalog-card-badge").textContent, "+");

  appMod.teardownActiveView();
  assert.equal(activeIntervals.size, 0);
});

test("makeEquipmentIcon SVG symbols, .equip-chip & #setup tile icons, and #setup newly-checked preview", async () => {
  const env = installBrowserEnv({
    catalog,
    initialHash: "#setup",
    manualBoot: true,
  });
  const { docRoot, appRoot, activeIntervals, setHash } = env;

  const constantsMod = await importDistModule(distDir, "core", "constants.js");
  const domMod = await importDistModule(distDir, "ui", "dom.js");
  const appMod = await importDistModule(distDir, "app.js");

  const consolidatedIds = [
    "body_only",
    "dumbbell",
    "kettlebells",
    "bands",
    "barbell",
    "pull_up_bar",
    "bench",
    "machine",
    "cable",
    "unknown_fallback_id",
  ];
  for (const id of consolidatedIds) {
    const icon = domMod.makeEquipmentIcon(id, 15);
    assert.equal(icon.tagName, "SVG");
    assert.equal(icon.classList.contains("equip-icon"), true);
    assert.equal(icon.getAttribute("aria-hidden"), "true");
    assert.equal(icon.getAttribute("data-equip-icon"), id);
    assert.equal(icon.dataset.equipIcon, id);
    assert.equal(icon.getAttribute("width"), "15");
    assert.equal(icon.getAttribute("height"), "15");
    assert.ok(
      icon.children.length >= 1 && icon.children.length <= 3,
      `Expected 1..3 child nodes for ${id}, got ${icon.children.length}`
    );
    assert.equal(icon.textContent, "", `Icon for ${id} must have zero textContent`);
  }

  // Verify "cable" alias matches "machine" glyph structure and unknown ID falls back to circle
  const machineIcon = domMod.makeEquipmentIcon("machine", 14);
  const cableIcon = domMod.makeEquipmentIcon("cable", 14);
  assert.equal(cableIcon.children.length, machineIcon.children.length);
  assert.equal(
    cableIcon.children[1].getAttribute("d"),
    machineIcon.children[1].getAttribute("d")
  );
  const fallbackIcon = domMod.makeEquipmentIcon("unknown_fallback_id");
  assert.equal(fallbackIcon.children.length, 1);
  assert.equal(fallbackIcon.children[0].tagName, "CIRCLE");

  // Boot at #setup and verify .setup-equip-grid tiles & newly-checked preview behavior
  await appMod.boot();
  const equipGrid = appRoot.querySelector(".setup-equip-grid");
  assert.ok(Boolean(equipGrid), "#setup must render .setup-equip-grid container");
  const tileLabels = equipGrid.querySelectorAll(".tile-option");
  assert.equal(tileLabels.length, constantsMod.EQUIPMENT_OPTIONS.length);

  constantsMod.EQUIPMENT_OPTIONS.forEach((opt, idx) => {
    const label = tileLabels[idx];
    const icon = label.querySelector(".equip-icon");
    assert.ok(Boolean(icon), `Tile for ${opt.id} must contain .equip-icon`);
    assert.equal(icon.getAttribute("data-equip-icon"), opt.id);
    assert.equal(icon.getAttribute("width"), "16");
    assert.equal(label.textContent, opt.label);
  });

  const svgWrap = docRoot.getElementById("setup-svg-wrap");
  const eqInputs = equipGrid.querySelectorAll("input");
  const dumbbellOpt = constantsMod.EQUIPMENT_OPTIONS.find((o) => o.id === "dumbbell");
  const laterOpt =
    constantsMod.EQUIPMENT_OPTIONS.find((o) => o.id === "barbell") ||
    constantsMod.EQUIPMENT_OPTIONS[1];
  const dumbbellInput = eqInputs.find((i) => i.value === dumbbellOpt.id);
  const laterInput = eqInputs.find((i) => i.value === laterOpt.id);

  dumbbellInput.checked = true;
  dumbbellInput.dispatchEvent({ type: "change" });
  assert.equal(
    svgWrap.innerHTML,
    domMod.resolveSvgMarkup(catalog, dumbbellOpt.arch, dumbbellOpt.prop).trim()
  );
  assert.equal(
    svgWrap.querySelector("svg").getAttribute("data-archetype"),
    dumbbellOpt.arch
  );

  // Checking a second option after "dumbbell" previews that newly checked option
  laterInput.checked = true;
  laterInput.dispatchEvent({ type: "change" });
  assert.equal(
    svgWrap.innerHTML,
    domMod.resolveSvgMarkup(catalog, laterOpt.arch, laterOpt.prop).trim()
  );
  assert.equal(
    svgWrap.querySelector("svg").getAttribute("data-archetype"),
    laterOpt.arch
  );

  // Unchecking the second option falls back to the remaining checked "dumbbell" option
  laterInput.checked = false;
  laterInput.dispatchEvent({ type: "change" });
  assert.equal(
    svgWrap.innerHTML,
    domMod.resolveSvgMarkup(catalog, dumbbellOpt.arch, dumbbellOpt.prop).trim()
  );

  // Submit setup and verify .equip-chip-bar icons in #plan and #quick
  appRoot.querySelector(".setup-form").dispatchEvent({ type: "submit" });
  for (const route of ["#plan", "#quick"]) {
    setHash(route);
    const chipBar = appRoot.querySelector(".equip-chip-bar");
    assert.ok(Boolean(chipBar), `${route} must render .equip-chip-bar`);
    const baselineChip = chipBar.querySelector(".is-baseline");
    assert.ok(Boolean(baselineChip));
    assert.equal(
      baselineChip.querySelector(".equip-icon").getAttribute("data-equip-icon"),
      "body_only"
    );
    assert.equal(baselineChip.textContent, "Bodyweight \u2713");

    const toggleBtns = chipBar.querySelectorAll("button");
    assert.equal(toggleBtns.length, constantsMod.EQUIPMENT_OPTIONS.length);
    constantsMod.EQUIPMENT_OPTIONS.forEach((opt, idx) => {
      const btn = toggleBtns[idx];
      const icon = btn.querySelector(".equip-icon");
      assert.ok(Boolean(icon), `Chip button for ${opt.id} in ${route} must contain .equip-icon`);
      assert.equal(icon.getAttribute("data-equip-icon"), opt.id);
      assert.equal(icon.getAttribute("width"), "14");
      assert.equal(btn.textContent, opt.label);
    });
  }

  appMod.teardownActiveView();
  assert.equal(activeIntervals.size, 0);
});
