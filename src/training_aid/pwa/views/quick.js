/* Screen 6: On-the-Fly & Random Workout Builder (#quick) */
import { el } from "../ui/dom.js";
import { createViewScope } from "../ui/scope.js";
import {
  renderCatalogPicker,
  renderEditableExerciseRow,
  renderEquipmentChipBar,
  renderPacingControls,
} from "../ui/widgets.js";

const TARGET_ID = "adhoc";

export function renderQuickView(ctx) {
  const scope = (ctx && ctx.scope) || createViewScope();
  const { store } = ctx;
  const syncTopbar = ctx.syncTopbar || (() => {});

  document.title = "On-the-Fly";
  syncTopbar("quick", false);

  store.ensureAdHocSession();

  const leftPane = el("section", { className: "editor-pane" });
  const picker = renderCatalogPicker(scope, store, {
    resultsId: "quick-search-results",
    placeholder: "Search name, muscle, gear, or category...",
    ariaLabel: "Search exercises",
    emptyText: "No matching exercises.",
    limit: 48,
    showEquipment: true,
    onAdd: (exId) => {
      store.addExerciseItem(TARGET_ID, exId);
      refreshAdHocPane();
    },
  });

  document
    .getElementById("app-root")
    .replaceChildren(el("main", { className: "editor-screen" }, [leftPane, picker]));

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
      textContent: "+ Random Exercise",
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

    const equipCard = el("div", { className: "filter-panel" }, [
      el("div", { className: "field-label-row" }, [
        el("span", { className: "field-label", textContent: "Available Equipment" }),
        renderPacingControls(scope, store.getWorkoutTiming(), (patch) => store.setWorkoutTiming(patch)),
      ]),
      renderEquipmentChipBar(scope, store.getSessionEquipment(), (nextList) => {
        store.setSessionEquipment(nextList);
        store.adaptAdHocForCurrentEquipment();
        refreshAdHocPane();
        picker.refresh();
      }),
      el("div", { className: "row-cluster" }, [shuffleBtn, addRandomBtn]),
    ]);

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
        : el("div", { className: "muted", textContent: "+ Generate or add exercises for your workout" });

    leftPane.replaceChildren(headerRow, equipCard, listNode);
  }

  refreshAdHocPane();
  return scope;
}
