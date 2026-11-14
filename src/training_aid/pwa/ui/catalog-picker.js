/* Faceted catalog picker with equipment chips, muscle/category/movement selects, and click-to-add cards */
import { EQUIPMENT_OPTIONS } from "../core/constants.js";
import { el, makeEquipmentIcon } from "./dom.js";

export const CATALOG_EQUIP_OPTIONS = [
  { id: "body_only", label: "Bodyweight" },
  ...EQUIPMENT_OPTIONS,
];

export const MUSCLE_OPTIONS = [
  { value: "abdominals", label: "Abdominals" },
  { value: "abductors", label: "Abductors" },
  { value: "adductors", label: "Adductors" },
  { value: "biceps", label: "Biceps" },
  { value: "calves", label: "Calves" },
  { value: "chest", label: "Chest" },
  { value: "forearms", label: "Forearms" },
  { value: "glutes", label: "Glutes" },
  { value: "hamstrings", label: "Hamstrings" },
  { value: "lats", label: "Lats" },
  { value: "lower back", label: "Lower Back" },
  { value: "middle back", label: "Middle Back" },
  { value: "neck", label: "Neck" },
  { value: "quadriceps", label: "Quadriceps" },
  { value: "shoulders", label: "Shoulders" },
  { value: "traps", label: "Traps" },
  { value: "triceps", label: "Triceps" },
];

export const CATEGORY_OPTIONS = [
  { value: "strength", label: "Strength" },
  { value: "cardio", label: "Cardio" },
  { value: "plyometrics", label: "Plyometrics" },
  { value: "stretching", label: "Stretching" },
  { value: "powerlifting", label: "Powerlifting" },
  { value: "olympic weightlifting", label: "Olympic Lifting" },
  { value: "strongman", label: "Strongman" },
];

export const MOVEMENT_OPTIONS = [
  { value: "lower", label: "Lower Body" },
  { value: "push", label: "Push" },
  { value: "pull", label: "Pull" },
  { value: "core", label: "Core" },
];

function buildFacetSelect(ariaLabel, defaultLabel, options) {
  return el(
    "select",
    { className: "hud-select pacing-select", "aria-label": ariaLabel },
    [
      el("option", { value: "", textContent: defaultLabel }),
      ...options.map((opt) =>
        el("option", { value: opt.value, textContent: opt.label })
      ),
    ]
  );
}

function readAddedCount(counts, exId) {
  if (!counts) return 0;
  if (counts instanceof Map) return Number(counts.get(exId)) || 0;
  return Number(counts[exId]) || 0;
}

export function renderCatalogPicker(scopeOrOpts, maybeStore, maybeOpts = {}) {
  const isObjCall =
    scopeOrOpts &&
    typeof scopeOrOpts.on !== "function" &&
    typeof scopeOrOpts === "object";
  const opts = isObjCall ? scopeOrOpts : maybeOpts || {};
  const scope = isObjCall ? opts.scope : scopeOrOpts;
  const store = isObjCall ? opts.store : maybeStore;

  const placeholder =
    opts.placeholder || "Search exercise, muscle, equipment, or category...";
  const ariaLabel = opts.ariaLabel || placeholder.replace(/\.+$/, "");
  const resultsId = opts.resultsId || "search-results";
  const emptyText = opts.emptyText || "No matching exercises.";
  const pageSize = Number(opts.limit) > 0 ? Math.trunc(Number(opts.limit)) : 48;
  const compatibleOnly = Boolean(opts.compatibleOnly);
  const showEquipment = opts.showEquipment !== false;
  const showEquipmentFilter = opts.showEquipmentFilter !== false;
  const fetchLimit = 1000;
  const onSelect = opts.onAdd || opts.onSelect || (() => {});
  const getAddedCounts =
    typeof opts.getAddedCounts === "function" ? opts.getAddedCounts : null;

  const activeEquip = new Set();

  const searchInput = el("input", {
    type: "search",
    name: "q",
    className: "minimal-input",
    placeholder,
    "aria-label": ariaLabel,
  });

  const muscleSelect = buildFacetSelect(
    "Filter by muscle",
    "All Muscles",
    MUSCLE_OPTIONS
  );
  const categorySelect = buildFacetSelect(
    "Filter by category",
    "All Categories",
    CATEGORY_OPTIONS
  );
  const movementSelect = buildFacetSelect(
    "Filter by movement",
    "All Movements",
    MOVEMENT_OPTIONS
  );
  const resetBtn = el("button", {
    type: "button",
    className: "btn-ghost btn-xs picker-reset-btn",
    textContent: "Reset",
    hidden: true,
  });

  const filterStrip = el("div", { className: "picker-filter-strip" }, [
    muscleSelect,
    categorySelect,
    movementSelect,
    resetBtn,
  ]);

  const equipButtons = showEquipmentFilter
    ? CATALOG_EQUIP_OPTIONS.map((opt) => {
        const btn = el(
          "button",
          {
            type: "button",
            className: "equip-chip",
            dataset: { equipId: opt.id },
            "aria-pressed": "false",
          },
          [makeEquipmentIcon(opt.id, 14), el("span", { textContent: opt.label })]
        );
        scope.on(btn, "click", () => {
          if (activeEquip.has(opt.id)) activeEquip.delete(opt.id);
          else activeEquip.add(opt.id);
          visibleCount = pageSize;
          refresh();
        });
        return { id: opt.id, btn };
      })
    : [];

  const equipBar = showEquipmentFilter
    ? el(
        "div",
        {
          className: "equip-chip-bar catalog-equip-bar",
          role: "group",
          "aria-label": "Filter catalog equipment",
        },
        equipButtons.map((item) => item.btn)
      )
    : null;

  const filterCountBadge = el("span", {
    className: "pill pill-brand",
    hidden: true,
  });

  const filtersDisclosure = el(
    "details",
    { className: "disclosure-card picker-filters-disclosure", open: false },
    [
      el("summary", { className: "disclosure-summary" }, [
        el("span", { className: "field-label", textContent: "Filters" }),
        filterCountBadge,
      ]),
      filterStrip,
      equipBar,
    ]
  );

  const resultsWrap = el("div", { id: resultsId });
  const pane = el("section", { className: "editor-pane" }, [
    searchInput,
    filtersDisclosure,
    resultsWrap,
  ]);

  let visibleCount = pageSize;
  const computeFilterKey = () =>
    `${searchInput.value}\0${muscleSelect.value}\0${categorySelect.value}\0${movementSelect.value}\0${[...activeEquip].join(",")}`;
  let lastFilterKey = computeFilterKey();

  function getFilters() {
    return {
      equipment: [...activeEquip],
      muscle: muscleSelect.value,
      category: categorySelect.value,
      movement: movementSelect.value,
    };
  }

  function syncFilterControls() {
    for (const { id, btn } of equipButtons) {
      const active = activeEquip.has(id);
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    const activeFacetCount =
      activeEquip.size +
      (muscleSelect.value ? 1 : 0) +
      (categorySelect.value ? 1 : 0) +
      (movementSelect.value ? 1 : 0);
    filterCountBadge.hidden = activeFacetCount === 0;
    filterCountBadge.textContent =
      activeFacetCount > 0 ? String(activeFacetCount) : "";
    const hasActiveFilter = Boolean(
      activeFacetCount > 0 || searchInput.value.trim()
    );
    resetBtn.hidden = !hasActiveFilter;
  }

  function renderSlice(results) {
    if (results.length === 0) {
      resultsWrap.replaceChildren(
        el("div", { className: "muted", textContent: emptyText })
      );
      return;
    }

    const counts = getAddedCounts ? getAddedCounts() : null;
    const shown = results.slice(0, visibleCount);
    const metaRow = el("div", {
      className: "picker-meta muted text-xs",
      textContent:
        results.length > shown.length
          ? `Showing ${shown.length} of ${results.length} exercises`
          : `${results.length} ${results.length === 1 ? "exercise" : "exercises"}`,
    });

    const grid = el(
      "div",
      { className: "catalog-grid" },
      shown.map((ex) => {
        const thumbSrc = ex.thumb_url || "./svgs/thumbs/squat__body_only.svg";
        const addedCount = readAddedCount(counts, ex.id);
        const badgeText =
          addedCount <= 0
            ? "+"
            : addedCount === 1
              ? "\u2713"
              : `\u2713 ${addedCount}`;

        const subText = showEquipment
          ? `${ex.primary_muscle || ""} \u00b7 ${ex.equipment || "body only"}`
          : ex.primary_muscle || "";

        const cardBtn = el(
          "button",
          {
            type: "button",
            className:
              "catalog-card catalog-card-btn" +
              (addedCount > 0 ? " is-added" : ""),
            dataset: { exerciseId: ex.id },
            "aria-label": `Add ${ex.name}`,
          },
          [
            el("div", { className: "ex-row-left" }, [
              el("img", {
                src: thumbSrc,
                alt: "",
                className: "svg-thumb",
                loading: "lazy",
                decoding: "async",
              }),
              el("div", { className: "min-w-0" }, [
                el("div", { className: "ex-row-name", textContent: ex.name }),
                el("div", {
                  className: "muted text-xs text-cap",
                  textContent: subText,
                }),
              ]),
            ]),
            el("span", {
              className: "catalog-card-badge",
              "aria-hidden": "true",
              textContent: badgeText,
            }),
          ]
        );
        scope.on(cardBtn, "click", () => onSelect(ex.id, ex));
        return cardBtn;
      })
    );

    if (results.length > shown.length) {
      const moreBtn = el("button", {
        type: "button",
        className: "btn-ghost btn-compact picker-more-btn",
        textContent: `Show more (${results.length - shown.length} remaining)`,
      });
      scope.on(moreBtn, "click", () => {
        visibleCount += pageSize;
        renderSlice(results);
      });
      resultsWrap.replaceChildren(metaRow, grid, moreBtn);
    } else {
      resultsWrap.replaceChildren(metaRow, grid);
    }
  }

  function refresh() {
    const nextKey = computeFilterKey();
    if (nextKey !== lastFilterKey) {
      visibleCount = pageSize;
      lastFilterKey = nextKey;
    }
    syncFilterControls();
    const filters = getFilters();
    const results =
      store.searchCatalog(searchInput.value, fetchLimit, {
        compatibleOnly,
        filters,
      }) || [];
    renderSlice(results);
  }

  for (const sel of [muscleSelect, categorySelect, movementSelect]) {
    scope.on(sel, "change", () => {
      visibleCount = pageSize;
      refresh();
    });
  }
  scope.on(resetBtn, "click", () => {
    activeEquip.clear();
    muscleSelect.value = "";
    categorySelect.value = "";
    movementSelect.value = "";
    searchInput.value = "";
    visibleCount = pageSize;
    refresh();
  });
  scope.on(searchInput, "input", refresh);
  scope.on(searchInput, "search", refresh);
  refresh();

  pane.refresh = refresh;
  pane.searchInput = searchInput;
  pane.resultsWrap = resultsWrap;
  pane.getFilters = getFilters;
  return pane;
}
