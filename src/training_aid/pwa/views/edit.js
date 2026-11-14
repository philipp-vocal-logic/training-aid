/* Screen 3: Routine Editor — Prescription (Sets, Reps, Weight) & Random Exercise Swap (#edit/<routineId>) */
import { formatPageTitle } from "../core/constants.js";
import { el } from "../ui/dom.js";
import { createViewScope } from "../ui/scope.js";
import { renderCatalogPicker, renderEditableExerciseRow } from "../ui/widgets.js";

function countExercises(routine) {
  const counts = new Map();
  for (const item of routine?.exercises || []) {
    if (item && item.exercise_id) {
      counts.set(item.exercise_id, (counts.get(item.exercise_id) || 0) + 1);
    }
  }
  return counts;
}

export function renderEditView(ctx) {
  const scope = (ctx && ctx.scope) || createViewScope();
  const { store } = ctx;
  const targetId = ctx.param || ctx.routineId || ctx.id;
  const syncTopbar = ctx.syncTopbar || (() => {});

  const routine = store.getRoutine(targetId);
  if (!routine) return scope;

  document.title = formatPageTitle(routine.name);
  syncTopbar("plan", false);

  const initCards = store.buildRoutineCards([routine]);
  const initRows = initCards && initCards[0] ? initCards[0].exercises : [];
  const defaultPickerOpen =
    initRows.length === 0 ||
    Boolean(globalThis.matchMedia?.("(min-width: 861px)")?.matches);

  const leftPane = el("section", { className: "editor-pane" });
  const picker = renderCatalogPicker(scope, store, {
    resultsId: "search-results",
    placeholder: "Search exercise, muscle, equipment, or category...",
    ariaLabel: "Search exercises",
    emptyText: "No matching exercises.",
    limit: 24,
    showEquipment: true,
    getAddedCounts: () => countExercises(store.getRoutine(targetId)),
    onAdd: (exId) => {
      store.addExerciseItem(targetId, exId);
      refreshRoutineExercises();
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

  function refreshRoutineExercises() {
    const latestRoutine = store.getRoutine(targetId);
    if (!latestRoutine) return;
    const cards = store.buildRoutineCards([latestRoutine]);
    const rows = cards && cards[0] ? cards[0].exercises : [];
    const routineIdEnc = encodeURIComponent(latestRoutine.id);

    const addRandomBtn = el("button", {
      type: "button",
      id: "edit-add-random-btn",
      className: "btn-ghost btn-compact",
      textContent: "+ Random",
    });
    scope.on(addRandomBtn, "click", () => {
      store.addRandomExerciseItem(latestRoutine.id);
      refreshRoutineExercises();
    });

    const headerRow = el("div", { className: "row-cluster" }, [
      el("a", {
        href: "#plan",
        className: "btn-ghost btn-compact",
        "aria-label": "Back",
        textContent: "\u2190",
      }),
      el("h1", { className: "pane-heading", textContent: latestRoutine.name }),
      addRandomBtn,
      rows.length > 0
        ? el("a", {
            href: `#workout/${routineIdEnc}`,
            className: "btn-primary btn-compact push-right",
            textContent: "\u25b6 Start",
          })
        : null,
    ]);

    const listContent =
      rows.length > 0
        ? el(
            "ul",
            { className: "ex-list" },
            rows.map((row) =>
              renderEditableExerciseRow(scope, row, {
                onUpdate: (patch) => {
                  store.updateExerciseItem(latestRoutine.id, row.item.id, patch);
                  refreshRoutineExercises();
                },
                onSwap: () => {
                  store.swapExerciseItem(latestRoutine.id, row.item.id);
                  refreshRoutineExercises();
                },
                onRemove: () => {
                  store.removeExerciseItem(latestRoutine.id, row.item.id);
                  refreshRoutineExercises();
                },
              })
            )
          )
        : el("div", { className: "muted", textContent: "+ Select or randomize exercises" });

    if (rows.length === 0) {
      pickerDisclosure.open = true;
      pickerDisclosure.setAttribute("open", "");
    }
    leftPane.replaceChildren(headerRow, listContent);
    picker.refresh();
  }

  refreshRoutineExercises();
  return scope;
}
