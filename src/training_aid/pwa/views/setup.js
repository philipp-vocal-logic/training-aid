/* Screen 1: Setup — Multiselect Equipment, Weekly Goal, Intensity, Speed & Rest (#setup) */
import { EQUIPMENT_OPTIONS, REST_PRESETS } from "../core/constants.js";
import { el, makeEquipmentIcon, resolveSvgMarkup, setTrustedSvg } from "../ui/dom.js";
import { bindPreviewLoop } from "../ui/preview-loop.js";
import { createViewScope } from "../ui/scope.js";

const SETUP_PRESCRIPTIONS = {
  light: "2 sets \u00b7 \u221220% load",
  moderate: "3 sets \u00b7 Base load",
  intense: "4 sets \u00b7 +20% load",
};
const PREVIEW_SPEED_BY_MODE = { slow: 0.29, normal: 0.39, fast: 0.49 };

export function renderSetupView(ctx) {
  const scope = (ctx && ctx.scope) || createViewScope();
  const { store, catalog } = ctx;
  const navigateTo =
    ctx.navigateTo ||
    ((h) => {
      if (typeof window !== "undefined") window.location.hash = h;
    });
  const syncTopbar = ctx.syncTopbar || (() => {});

  document.title = "Setup";
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

  const stageSection = el("section", { className: "graphic-stage", "aria-label": "Exercise preview" }, [
    el("div", { className: "stage-hud-top" }, [
      el("div", { className: "row-cluster" }, [
        el("span", { className: "pill pill-brand", textContent: "Setup" }),
        prescriptionPill,
      ]),
    ]),
    svgWrap,
  ]);

  const nameInput = el("input", {
    type: "text",
    name: "name",
    className: "minimal-input",
    value: curName,
    placeholder: "Athlete name",
    required: true,
    maxlength: "50",
  });

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
  const selectAllBtn = el("button", { type: "button", className: "btn-ghost btn-xs", textContent: "All Gym" });
  const clearEqBtn = el("button", { type: "button", className: "btn-ghost btn-xs", textContent: "Bodyweight Only" });

  const intTiles = [
    makeRadioTile("starting_intensity", "light", "Easy", curInt === "light"),
    makeRadioTile("starting_intensity", "moderate", "Moderate", curInt === "moderate"),
    makeRadioTile("starting_intensity", "intense", "Intense", curInt === "intense"),
  ];
  const dayValues = [2, 3, 4, 5];
  const activeDay = dayValues.includes(curDays) ? curDays : 3;
  const dayTiles = dayValues.map((d) => makeRadioTile("days_per_week", d, `${d}\u00d7`, activeDay === d));

  const speedTiles = [
    makeRadioTile("speed_mode", "slow", "Slow (0.75\u00d7)", curSpeed === "slow"),
    makeRadioTile("speed_mode", "normal", "Normal (1\u00d7)", curSpeed === "normal"),
    makeRadioTile("speed_mode", "fast", "Fast (1.25\u00d7)", curSpeed === "fast"),
  ];
  const activeRest = REST_PRESETS.includes(curRest) ? curRest : 30;
  const restTiles = REST_PRESETS.map((sec) => makeRadioTile("rest_seconds", sec, `${sec}s`, activeRest === sec));

  const setupForm = el("form", { className: "setup-form" }, [
    el("label", { className: "field-group" }, [
      el("span", { className: "field-label", textContent: "Name" }),
      nameInput,
    ]),
    el("div", { className: "field-group" }, [
      el("div", { className: "field-label-row" }, [
        el("span", { className: "field-label", textContent: "Available Equipment (Multiselect)" }),
        el("div", { className: "row-cluster-tight" }, [clearEqBtn, selectAllBtn]),
      ]),
      el("div", { className: "muted text-xs", textContent: "Floor bodyweight exercises are always included." }),
      el("div", { className: "tile-grid-3 setup-equip-grid" }, eqTiles.map((t) => t.label)),
    ]),
    el("div", { className: "field-group" }, [
      el("span", { className: "field-label", textContent: "Starting Intensity" }),
      el("div", { className: "tile-grid-3" }, intTiles.map((t) => t.label)),
    ]),
    el("div", { className: "field-group" }, [
      el("span", { className: "field-label", textContent: "Weekly Workout Schedule" }),
      el("div", { className: "tile-grid-4" }, dayTiles.map((t) => t.label)),
    ]),
    el("div", { className: "field-group" }, [
      el("span", { className: "field-label", textContent: "Exercise Speed (Tempo)" }),
      el("div", { className: "tile-grid-3" }, speedTiles.map((t) => t.label)),
    ]),
    el("div", { className: "field-group" }, [
      el("span", { className: "field-label", textContent: "Pause / Rest Interval" }),
      el("div", { className: "tile-grid-5" }, restTiles.map((t) => t.label)),
    ]),
    el("button", { type: "submit", className: "btn-primary btn-block", textContent: "Save Plan \u2192" }),
  ]);

  document
    .getElementById("app-root")
    .replaceChildren(
      el("main", { className: "split-screen" }, [
        stageSection,
        el("section", { className: "side-pane" }, [setupForm]),
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
      speed = PREVIEW_SPEED_BY_MODE[tile.input.value] || PREVIEW_SPEED_BY_MODE.normal;
    });
  }

  scope.on(setupForm, "submit", (e) => {
    e.preventDefault();
    const chosenEq = eqTiles.filter((t) => t.input.checked).map((t) => t.id);
    let chosenInt = "moderate";
    for (const t of intTiles) if (t.input.checked) chosenInt = t.input.value;
    let chosenDays = 3;
    for (const t of dayTiles) if (t.input.checked) chosenDays = Number(t.input.value);
    let chosenSpeed = "normal";
    for (const t of speedTiles) if (t.input.checked) chosenSpeed = t.input.value;
    let chosenRest = 30;
    for (const t of restTiles) if (t.input.checked) chosenRest = Number(t.input.value);

    store.setupPlan({
      name: nameInput.value.trim() || "Athlete",
      equipment_list: chosenEq,
      starting_intensity: chosenInt,
      days_per_week: chosenDays,
      sound_theme: store.getSoundTheme(),
      speed_mode: chosenSpeed,
      rest_seconds: chosenRest,
    });
    navigateTo("#plan");
  });

  return scope;
}
