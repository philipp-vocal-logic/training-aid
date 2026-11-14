/* Screen 6: Quick Workout & Random Builder (#quick) */
import { formatEquipmentSummary, formatPageTitle } from "../core/constants.js";
import { el } from "../ui/dom.js";
import { createViewScope } from "../ui/scope.js";
import {
  renderCatalogPicker,
  renderEditableExerciseRow,
  renderEquipmentChipBar,
  renderPacingControls,
} from "../ui/widgets.js";

const TARGET_ID = "adhoc";

function countExercises(routine) {
  const counts = new Map();
  for (const item of routine?.exercises || []) {
    if (item && item.exercise_id) {
      counts.set(item.exercise_id, (counts.get(item.exercise_id) || 0) + 1);
    }
  }
  return counts;
}

export function renderQuickView(ctx) {
  const scope = (ctx && ctx.scope) || createViewScope();
  const { store } = ctx;
  const syncTopbar = ctx.syncTopbar || (() => {});

  document.title = formatPageTitle("Quick Workout");
  syncTopbar("quick", false);

  store.ensureAdHocSession();
  const initCards = store.buildRoutineCards([TARGET_ID]);
  const initRows = initCards && initCards[0] ? initCards[0].exercises : [];
  const defaultPickerOpen =
    initRows.length === 0 ||
    Boolean(globalThis.matchMedia?.("(min-width: 861px)")?.matches);

  const leftPane = el("section", { className: "editor-pane" });
  const picker = renderCatalogPicker(scope, store, {
    resultsId: "quick-search-results",
    placeholder: "Search exercise, muscle, equipment, or category...",
    ariaLabel: "Search exercises",
    emptyText: "No matching exercises.",
    limit: 24,
    showEquipment: true,
    showEquipmentFilter: false,
    getAddedCounts: () => countExercises(store.getRoutine(TARGET_ID)),
    onAdd: (exId) => {
      store.addExerciseItem(TARGET_ID, exId);
      refreshAdHocPane();
    },
  });

  const pickerDisclosure = el(
    "details",
    { className: "picker-disclosure", open: defaultPickerOpen },
    [
      el("summary", {
        className: "btn-ghost btn-block picker-toggle-summary",
        textContent: "+ Add Exercises",
      }),
      picker,
    ]
  );

  document
    .getElementById("app-root")
    .replaceChildren(
      el("main", { className: "editor-screen" }, [leftPane, pickerDisclosure])
    );

  function refreshAdHocPane() {
    const adhoc = store.ensureAdHocSession();
    const cards = store.buildRoutineCards([TARGET_ID]);
    const rows = cards && cards[0] ? cards[0].exercises : [];

    const shuffleBtn = el("button", {
      type: "button",
      id: "quick-generate-btn",
      className: "btn-ghost btn-compact",
      textContent: "\ud83c\udfb2 Generate Workout",
    });
    const addRandomBtn = el("button", {
      type: "button",
      id: "quick-add-random-btn",
      className: "btn-ghost btn-compact",
      textContent: "+ Random",
    });
    const startBtn =
      rows.length > 0
        ? el("a", {
            href: "#workout/adhoc",
            id: "quick-start-btn",
            className: "btn-primary btn-compact push-right",
            textContent: "\u25b6 Start",
          })
        : null;

    scope.on(shuffleBtn, "click", () => {
      store.generateAdHocSession({ count: Math.max(4, rows.length || 4) });
      refreshAdHocPane();
    });
    scope.on(addRandomBtn, "click", () => {
      store.addRandomExerciseItem(TARGET_ID);
      refreshAdHocPane();
    });

    const headerRow = el("div", { className: "row-cluster" }, [
      el("a", {
        href: "#plan",
        className: "btn-ghost btn-compact",
        "aria-label": "Back",
        textContent: "\u2190",
      }),
      el("h1", { className: "pane-heading", textContent: adhoc.name }),
      startBtn,
    ]);

    const actionRow = el("div", { className: "row-cluster" }, [
      shuffleBtn,
      addRandomBtn,
    ]);

    const eq = store.getSessionEquipment();
    const timing = store.getWorkoutTiming();
    const prevGearDetails = leftPane.querySelector(".filter-panel");
    const isGearOpen = prevGearDetails ? Boolean(prevGearDetails.open) : false;

    const equipCard = el(
      "details",
      { className: "filter-panel disclosure-card", open: isGearOpen },
      [
        el("summary", { className: "disclosure-summary" }, [
          el("span", {
            className: "field-label",
            textContent: "Equipment",
          }),
          el("span", {
            className: "pill",
            textContent: `${formatEquipmentSummary(eq)} \u00b7 ${timing.rest_seconds}s`,
          }),
        ]),
        el("div", { className: "disclosure-body" }, [
          renderPacingControls(scope, timing, (patch) => {
            store.setWorkoutTiming(patch);
            refreshAdHocPane();
          }),
          renderEquipmentChipBar(scope, eq, (nextList) => {
            store.setSessionEquipment(nextList);
            store.adaptAdHocForCurrentEquipment();
            refreshAdHocPane();
          }),
        ]),
      ]
    );

    const listNode =
      rows.length > 0
        ? el(
            "ul",
            { className: "ex-list" },
            rows.map((row) =>
              renderEditableExerciseRow(scope, row, {
                onUpdate: (patch) => {
                  store.updateExerciseItem(TARGET_ID, row.item.id, patch);
                  refreshAdHocPane();
                },
                onSwap: () => {
                  store.swapExerciseItem(TARGET_ID, row.item.id);
                  refreshAdHocPane();
                },
                onRemove: () => {
                  store.removeExerciseItem(TARGET_ID, row.item.id);
                  refreshAdHocPane();
                },
              })
            )
          )
        : el("div", {
            className: "muted",
            textContent: "+ Generate or add exercises for your workout",
          });

    if (rows.length === 0) {
      pickerDisclosure.open = true;
      pickerDisclosure.setAttribute("open", "");
    }
    leftPane.replaceChildren(headerRow, actionRow, equipCard, listNode);
    picker.refresh();
  }

  refreshAdHocPane();
  return scope;
}
