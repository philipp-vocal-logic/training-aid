/* Reusable domain UI controls: equipment chip bar, pacing selects, editable exercise rows, and catalog picker */
import {
  EQUIPMENT_OPTIONS,
  REST_PRESETS,
  SPEED_LABELS,
  VALID_SPEED_MODES,
  formatRestLabel,
  isWeightedCatalogEquipment,
} from "../core/constants.js";
import { el, makeEquipmentIcon } from "./dom.js";

export { renderCatalogPicker } from "./catalog-picker.js";

export function renderEquipmentChipBar(scope, selectedList, onChange, extraNode) {
  const activeSet = new Set(Array.isArray(selectedList) ? selectedList : []);

  const chips = EQUIPMENT_OPTIONS.map((opt) => {
    const active = activeSet.has(opt.id);
    const btn = el(
      "button",
      {
        type: "button",
        className: "equip-chip" + (active ? " is-active" : ""),
        dataset: { equipId: opt.id },
        "aria-pressed": active ? "true" : "false",
      },
      [makeEquipmentIcon(opt.id, 14), el("span", { textContent: opt.label })]
    );
    scope.on(btn, "click", () => {
      const next = new Set(activeSet);
      if (next.has(opt.id)) next.delete(opt.id);
      else next.add(opt.id);
      onChange([...next]);
    });
    return btn;
  });

  return el("div", { className: "equip-chip-bar", role: "group", "aria-label": "Available equipment" }, [
    el("span", { className: "equip-chip is-baseline" }, [
      makeEquipmentIcon("body_only", 14),
      el("span", { textContent: "Bodyweight \u2713" }),
    ]),
    ...chips,
    extraNode || null,
  ]);
}

export function renderPacingControls(scope, timing, onTimingChange) {
  const speedSelect = el(
    "select",
    { className: "hud-select pacing-select", "aria-label": "Speed" },
    VALID_SPEED_MODES.map((m) =>
      el("option", { value: m, selected: timing.speed_mode === m, textContent: `Speed: ${SPEED_LABELS[m] || m}` })
    )
  );
  const curRest = Number(timing.rest_seconds) || 30;
  const restValues = REST_PRESETS.includes(curRest)
    ? REST_PRESETS
    : [...REST_PRESETS, curRest].sort((a, b) => a - b);
  const restSelect = el(
    "select",
    { className: "hud-select pacing-select", "aria-label": "Rest" },
    restValues.map((sec) =>
      el("option", { value: String(sec), selected: curRest === sec, textContent: formatRestLabel(sec) })
    )
  );

  scope.on(speedSelect, "change", () => onTimingChange({ speed_mode: speedSelect.value }));
  scope.on(restSelect, "change", () => onTimingChange({ rest_seconds: Number(restSelect.value) }));

  return el("div", { className: "pacing-strip" }, [speedSelect, restSelect]);
}

export function renderEditableExerciseRow(scope, row, handlers) {
  const isWeighted = Boolean(
    (isWeightedCatalogEquipment(row.exercise.equipment) && !row.exercise.is_hold) ||
      (row.item.base_weight_kg !== null && row.item.base_weight_kg !== undefined)
  );
  const thumbSrc = row.thumb_url || "./svgs/thumbs/squat__body_only.svg";

  const setsInput = el("input", {
    type: "number",
    min: "1",
    max: "20",
    value: String(row.item.sets),
    className: "rx-num-input",
    "aria-label": `Sets for ${row.exercise.name}`,
  });
  const repsInput = el("input", {
    type: "number",
    min: "1",
    max: "600",
    value: String(row.item.base_reps),
    className: "rx-num-input",
    "aria-label": `${row.exercise.is_hold ? "Seconds" : "Reps"} for ${row.exercise.name}`,
  });
  const weightInput = isWeighted
    ? el("input", {
        type: "number",
        min: "0.5",
        max: "500",
        step: "0.5",
        value: row.item.base_weight_kg ? String(row.item.base_weight_kg) : "10",
        className: "rx-num-input rx-weight-input",
        "aria-label": `Weight kg for ${row.exercise.name}`,
      })
    : null;

  const commitPatch = () => {
    handlers.onUpdate({
      sets: Number(setsInput.value),
      base_reps: Number(repsInput.value),
      base_weight_kg: weightInput ? Number(weightInput.value) : null,
    });
  };
  scope.on(setsInput, "change", commitPatch);
  scope.on(repsInput, "change", commitPatch);
  if (weightInput) scope.on(weightInput, "change", commitPatch);

  const swapBtn = el("button", {
    type: "button",
    className: "btn-ghost btn-icon-sm",
    title: "Swap with random exercise",
    "aria-label": "Random swap",
    textContent: "\u21bb",
  });
  const removeBtn = el("button", {
    type: "button",
    className: "btn-ghost btn-icon-sm",
    title: "Remove exercise",
    "aria-label": "Remove",
    textContent: "\u2715",
  });
  scope.on(swapBtn, "click", handlers.onSwap);
  scope.on(removeBtn, "click", handlers.onRemove);

  return el("li", { className: "catalog-card editable-ex-card" }, [
    el("div", { className: "ex-row-left" }, [
      el("img", { src: thumbSrc, alt: "", className: "svg-thumb" }),
      el("div", { className: "min-w-0" }, [
        el("div", { className: "ex-row-name", textContent: row.exercise.name }),
        el("div", { className: "rx-inline-controls" }, [
          setsInput,
          el("span", { className: "muted", textContent: "\u00d7" }),
          repsInput,
          el("span", { className: "muted", textContent: row.exercise.is_hold ? "sec" : "reps" }),
          ...(weightInput
            ? [
                el("span", { className: "muted", textContent: "@" }),
                weightInput,
                el("span", { className: "muted", textContent: "kg" }),
              ]
            : []),
        ]),
      ]),
    ]),
    el("div", { className: "rx-row-actions" }, [swapBtn, removeBtn]),
  ]);
}
