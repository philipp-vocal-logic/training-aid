/* Screen 1: Setup — Multiselect Equipment, Weekly Goal, Intensity, Speed, Rest & JSON Backup (#setup) */
import {
  DEFAULT_INTENSITY_LABELS,
  EQUIPMENT_OPTIONS,
  REST_PRESETS,
  SPEED_LABELS,
  SPEED_SHORT_LABELS,
  VALID_SPEED_MODES,
  formatPageTitle,
} from "../core/constants.js";
import { el, makeEquipmentIcon, resolveSvgMarkup, setTrustedSvg } from "../ui/dom.js";
import { closeModal, openModal } from "../ui/modal.js";
import { bindPreviewLoop } from "../ui/preview-loop.js";
import { createViewScope } from "../ui/scope.js";

const SETUP_PRESCRIPTIONS = {
  light: "2 sets \u00b7 \u221220% intensity",
  moderate: "3 sets \u00b7 Base intensity",
  intense: "4 sets \u00b7 +20% intensity",
};
const PREVIEW_SPEED_BY_MODE = { slow: 0.29, normal: 0.39, fast: 0.49 };

function setDetailsOpen(detailsEl, isOpen) {
  const open = Boolean(isOpen);
  detailsEl.open = open;
  if (open) detailsEl.setAttribute("open", "");
  else detailsEl.removeAttribute("open");
  return detailsEl;
}

export function triggerStateExportDownload(store, nowDate) {
  const json = store && typeof store.exportStateJson === "function" ? store.exportStateJson() : null;
  if (!json) return null;
  const dt = nowDate instanceof Date ? nowDate : new Date();
  const yyyy = String(dt.getFullYear());
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const filename = `training-aid-backup-${yyyy}-${mm}-${dd}.json`;
  const blob = new Blob([json], { type: "application/json" });
  const url =
    typeof URL !== "undefined" && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(blob)
      : "";
  const link = el("a", {
    href: url || "data:application/json;charset=utf-8," + encodeURIComponent(json),
    download: filename,
    hidden: true,
  });
  if (typeof document !== "undefined" && document.body) document.body.appendChild(link);
  link.click();
  if (link.parentNode) link.parentNode.removeChild(link);
  if (url && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    URL.revokeObjectURL(url);
  }
  return filename;
}

function readBackupFileText(file) {
  if (!file) return Promise.reject(new Error("No backup file selected."));
  if (typeof file === "string") return file;
  if (typeof file.text === "function") return file.text();
  if (typeof file.content === "string") return file.content;
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("Unable to read backup file."));
      reader.readAsText(file);
    });
  }
  return Promise.reject(new Error("Unable to read backup file."));
}

export function renderSetupView(ctx) {
  const scope = (ctx && ctx.scope) || createViewScope();
  const { store, catalog } = ctx;
  const navigateTo =
    ctx.navigateTo ||
    ((h) => {
      if (typeof window !== "undefined") window.location.hash = h;
    });
  const syncTopbar = ctx.syncTopbar || (() => {});

  document.title = formatPageTitle("Setup");
  syncTopbar("setup", false);

  const state = store.getState();
  const profile = (state && state.profile) || null;
  const curName = (profile && profile.name) || "";
  const curEquipSet = new Set((profile && profile.equipment_list) || []);
  const curInt = (profile && profile.starting_intensity) || "moderate";
  const curDays = profile && profile.weekly_goal ? Number(profile.weekly_goal) : 3;
  const timing = store.getWorkoutTiming();
  const curSpeed = timing.speed_mode || "normal";
  const curRest = Number(timing.rest_seconds) || 30;

  function pickPreviewSvgMarkup(checkedIds, preferredId) {
    if (preferredId && checkedIds.has(preferredId)) {
      const preferredOpt = EQUIPMENT_OPTIONS.find((opt) => opt.id === preferredId);
      if (preferredOpt) {
        return resolveSvgMarkup(catalog, preferredOpt.arch, preferredOpt.prop);
      }
    }
    for (const opt of EQUIPMENT_OPTIONS) {
      if (checkedIds.has(opt.id)) {
        return resolveSvgMarkup(catalog, opt.arch, opt.prop);
      }
    }
    return resolveSvgMarkup(catalog, "squat", "body_only");
  }

  const prescriptionPill = el("span", {
    className: "pill",
    id: "setup-prescription-pill",
    textContent: SETUP_PRESCRIPTIONS[curInt] || SETUP_PRESCRIPTIONS.moderate,
  });
  const svgWrap = el("div", { id: "setup-svg-wrap", className: "stage-svg-wrap" });
  setTrustedSvg(svgWrap, pickPreviewSvgMarkup(curEquipSet));

  const stageSection = el(
    "section",
    { className: "graphic-stage setup-stage", "aria-label": "Exercise preview" },
    [
      el("div", { className: "stage-hud-top" }, [
        el("div", { className: "row-cluster" }, [
          el("span", { className: "pill pill-brand", textContent: "Setup" }),
          prescriptionPill,
        ]),
      ]),
      svgWrap,
    ]
  );

  function makeRadioTile(groupName, val, labelText, isChecked) {
    const radio = el("input", { type: "radio", name: groupName, value: String(val), checked: isChecked });
    return {
      input: radio,
      label: el("label", { className: "tile-option" }, [radio, el("span", { textContent: labelText })]),
    };
  }

  function makeCheckboxTile(opt, isChecked) {
    const box = el("input", { type: "checkbox", name: "equipment", value: opt.id, checked: isChecked });
    return {
      id: opt.id,
      input: box,
      label: el("label", { className: "tile-option tile-option-compact" }, [
        box,
        makeEquipmentIcon(opt.id, 16),
        el("span", { textContent: opt.label }),
      ]),
    };
  }

  const eqTiles = EQUIPMENT_OPTIONS.map((opt) => makeCheckboxTile(opt, curEquipSet.has(opt.id)));
  const selectAllBtn = el("button", { type: "button", className: "btn-ghost btn-xs", textContent: "Full Gym" });
  const clearEqBtn = el("button", { type: "button", className: "btn-ghost btn-xs", textContent: "Bodyweight" });

  const intTiles = [
    makeRadioTile("starting_intensity", "light", DEFAULT_INTENSITY_LABELS.light, curInt === "light"),
    makeRadioTile("starting_intensity", "moderate", DEFAULT_INTENSITY_LABELS.moderate, curInt === "moderate"),
    makeRadioTile("starting_intensity", "intense", DEFAULT_INTENSITY_LABELS.intense, curInt === "intense"),
  ];
  const dayValues = [2, 3, 4, 5];
  const activeDay = dayValues.includes(curDays) ? curDays : 3;
  const dayTiles = dayValues.map((d) => makeRadioTile("days_per_week", d, `${d}\u00d7`, activeDay === d));

  const speedTiles = VALID_SPEED_MODES.map((mode) =>
    makeRadioTile("speed_mode", mode, SPEED_LABELS[mode], curSpeed === mode)
  );
  const activeRest = REST_PRESETS.includes(curRest) ? curRest : 30;
  const restTiles = REST_PRESETS.map((sec) => makeRadioTile("rest_seconds", sec, `${sec}s`, activeRest === sec));

  let summarySpeedMode = curSpeed;
  let summaryRestSec = activeRest;
  const pacingSummaryPill = el("span", {
    className: "pill",
    textContent: `${SPEED_SHORT_LABELS[summarySpeedMode] || "Normal"} \u00b7 ${summaryRestSec}s`,
  });

  const setupPacingDisclosure = setDetailsOpen(
    el("details", { className: "disclosure-card setup-pacing-disclosure" }, [
      el("summary", { className: "disclosure-summary" }, [
        el("span", { className: "field-label", textContent: "Speed & Rest" }),
        pacingSummaryPill,
      ]),
      el("div", { className: "disclosure-body" }, [
        el("div", { className: "field-group" }, [
          el("span", { className: "field-label", textContent: "Speed" }),
          el("div", { className: "tile-grid-3" }, speedTiles.map((t) => t.label)),
        ]),
        el("div", { className: "field-group" }, [
          el("span", { className: "field-label", textContent: "Rest" }),
          el("div", { className: "tile-grid-5" }, restTiles.map((t) => t.label)),
        ]),
      ]),
    ]),
    false
  );

  const setupForm = el("form", { className: "setup-form" }, [
    el("div", { className: "field-group" }, [
      el("div", { className: "field-label-row" }, [
        el("span", { className: "field-label", textContent: "Equipment" }),
        el("div", { className: "row-cluster-tight" }, [clearEqBtn, selectAllBtn]),
      ]),
      el("div", { className: "muted text-xs", textContent: "Floor bodyweight exercises are always included." }),
      el("div", { className: "tile-grid-3 setup-equip-grid" }, eqTiles.map((t) => t.label)),
    ]),
    el("div", { className: "field-group" }, [
      el("span", { className: "field-label", textContent: "Intensity" }),
      el("div", { className: "tile-grid-3" }, intTiles.map((t) => t.label)),
    ]),
    el("div", { className: "field-group" }, [
      el("span", { className: "field-label", textContent: "Workouts per Week" }),
      el("div", { className: "tile-grid-4" }, dayTiles.map((t) => t.label)),
    ]),
    setupPacingDisclosure,
    el("button", { type: "submit", className: "btn-primary btn-block", textContent: "Save Plan \u2192" }),
  ]);

  const hasPlan = Boolean(store && store.hasActivePlan());
  const hasStorageErr = Boolean(store && typeof store.hasStorageError === "function" && store.hasStorageError());

  const fileInput = el("input", {
    type: "file",
    id: "backup-file-input",
    accept: "application/json,.json",
    hidden: true,
  });
  const importBtn = el("button", {
    type: "button",
    id: "backup-import-btn",
    className: "btn-ghost btn-compact",
    textContent: "Import Backup",
  });
  const exportBtn = el("button", {
    type: "button",
    id: "backup-export-btn",
    className: "btn-ghost btn-compact",
    hidden: !hasPlan,
    disabled: !hasPlan,
    textContent: "Export Backup",
  });
  const storageErrorPill = el("span", {
    id: "storage-error-pill",
    className: "pill pill-warn",
    role: "alert",
    hidden: !hasStorageErr,
    textContent: "Storage unavailable \u2014 export a backup to save your plan",
  });
  const statusMsg = el("span", {
    id: "backup-status-msg",
    className: "muted text-xs",
    role: "status",
    hidden: true,
  });

  const backupBar = el("div", { className: "backup-bar" }, [
    el("div", { className: "row-cluster-tight" }, [importBtn, exportBtn, fileInput]),
    storageErrorPill,
    statusMsg,
  ]);

  const backupDisclosure = setDetailsOpen(
    el("details", { className: "disclosure-card backup-disclosure" }, [
      el("summary", { className: "disclosure-summary" }, [
        el("span", { className: "field-label", textContent: "Backup & Restore" }),
      ]),
      backupBar,
    ]),
    hasStorageErr
  );

  function syncBackupUi() {
    const active = Boolean(store && store.hasActivePlan());
    const storageErr = Boolean(
      store && typeof store.hasStorageError === "function" && store.hasStorageError()
    );
    exportBtn.hidden = !active;
    exportBtn.disabled = !active;
    storageErrorPill.hidden = !storageErr;
    if (storageErr) setDetailsOpen(backupDisclosure, true);
  }

  document
    .getElementById("app-root")
    .replaceChildren(
      el("main", { className: "split-screen" }, [
        stageSection,
        el("section", { className: "side-pane" }, [setupForm, backupDisclosure]),
      ])
    );

  let speed = PREVIEW_SPEED_BY_MODE[curSpeed] || PREVIEW_SPEED_BY_MODE.normal;
  const previewLoop = bindPreviewLoop(scope, svgWrap, () => ({ speed, tempoMode: "standard" }));

  function syncEquipmentPreview(preferredId) {
    const checked = new Set(eqTiles.filter((t) => t.input.checked).map((t) => t.id));
    setTrustedSvg(svgWrap, pickPreviewSvgMarkup(checked, preferredId));
    previewLoop.rebind(svgWrap);
  }

  for (const tile of eqTiles) {
    scope.on(tile.input, "change", () =>
      syncEquipmentPreview(tile.input.checked ? tile.id : undefined)
    );
  }
  scope.on(selectAllBtn, "click", () => {
    for (const t of eqTiles) t.input.checked = true;
    syncEquipmentPreview();
  });
  scope.on(clearEqBtn, "click", () => {
    for (const t of eqTiles) t.input.checked = false;
    syncEquipmentPreview();
  });

  for (const tile of intTiles) {
    scope.on(tile.input, "change", () => {
      if (!tile.input.checked) return;
      prescriptionPill.textContent = SETUP_PRESCRIPTIONS[tile.input.value] || SETUP_PRESCRIPTIONS.moderate;
    });
  }
  for (const tile of speedTiles) {
    scope.on(tile.input, "change", () => {
      if (!tile.input.checked) return;
      summarySpeedMode = tile.input.value;
      speed = PREVIEW_SPEED_BY_MODE[summarySpeedMode] || PREVIEW_SPEED_BY_MODE.normal;
      pacingSummaryPill.textContent = `${SPEED_SHORT_LABELS[summarySpeedMode] || "Normal"} \u00b7 ${summaryRestSec}s`;
    });
  }
  for (const tile of restTiles) {
    scope.on(tile.input, "change", () => {
      if (!tile.input.checked) return;
      summaryRestSec = Number(tile.input.value) || 30;
      pacingSummaryPill.textContent = `${SPEED_SHORT_LABELS[summarySpeedMode] || "Normal"} \u00b7 ${summaryRestSec}s`;
    });
  }

  scope.on(importBtn, "click", () => fileInput.click());
  scope.on(exportBtn, "click", () => {
    if (triggerStateExportDownload(store)) {
      statusMsg.textContent = "Backup exported.";
      statusMsg.hidden = false;
    }
  });
  scope.on(fileInput, "change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const applyImportText = (rawText) => {
      try {
        store.importStateJson(rawText);
        syncBackupUi();
        statusMsg.textContent = "Backup imported.";
        statusMsg.hidden = false;
        navigateTo("#plan");
      } catch (err) {
        statusMsg.textContent = err && err.message ? err.message : "Invalid backup file.";
        statusMsg.hidden = false;
      } finally {
        fileInput.value = "";
      }
    };
    try {
      const readRes = readBackupFileText(file);
      if (typeof readRes === "string") {
        applyImportText(readRes);
      } else if (readRes && typeof readRes.then === "function") {
        readRes.then(applyImportText, (err) => {
          statusMsg.textContent = err && err.message ? err.message : "Invalid backup file.";
          statusMsg.hidden = false;
          fileInput.value = "";
        });
      }
    } catch (err) {
      statusMsg.textContent = err && err.message ? err.message : "Invalid backup file.";
      statusMsg.hidden = false;
      fileInput.value = "";
    }
  });

  function applySetupSave() {
    const chosenEq = eqTiles.filter((t) => t.input.checked).map((t) => t.id);
    let chosenInt = "moderate";
    for (const t of intTiles) if (t.input.checked) chosenInt = t.input.value;
    let chosenDays = 3;
    for (const t of dayTiles) if (t.input.checked) chosenDays = Number(t.input.value);
    let chosenSpeed = "normal";
    for (const t of speedTiles) if (t.input.checked) chosenSpeed = t.input.value;
    let chosenRest = 30;
    for (const t of restTiles) if (t.input.checked) chosenRest = Number(t.input.value);

    const latestState = store.getState();
    const latestName = (latestState && latestState.profile && latestState.profile.name) || curName;

    store.setupPlan({
      name: latestName || "Athlete",
      equipment_list: chosenEq,
      starting_intensity: chosenInt,
      days_per_week: chosenDays,
      sound_theme: store.getSoundTheme(),
      speed_mode: chosenSpeed,
      rest_seconds: chosenRest,
    });
    syncBackupUi();
    navigateTo("#plan");
  }

  scope.on(setupForm, "submit", (e) => {
    e.preventDefault();
    if (!store.hasActivePlan()) {
      applySetupSave();
      return;
    }
    openModal((mScope) => {
      const cancelBtn = el("button", {
        type: "button",
        id: "setup-overwrite-cancel-btn",
        className: "btn-ghost",
        textContent: "Cancel",
      });
      const confirmBtn = el("button", {
        type: "button",
        id: "setup-overwrite-confirm-btn",
        className: "btn-primary",
        textContent: "Replace Plan",
      });
      mScope.on(cancelBtn, "click", () => closeModal());
      mScope.on(confirmBtn, "click", () => {
        closeModal();
        applySetupSave();
      });
      return el("div", { className: "modal-card is-error" }, [
        el("h2", { className: "modal-title", textContent: "Replace Current Plan?" }),
        el("div", {
          className: "muted",
          textContent:
            "Saving a new setup will replace your current routines and custom exercise edits. Completed workout history will be kept.",
        }),
        el("div", { className: "modal-actions" }, [cancelBtn, confirmBtn]),
      ]);
    });
  });

  return scope;
}
