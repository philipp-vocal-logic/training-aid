/* Screen 6: On-the-Fly & Random Workout Builder (#quick) */
(function () {
  "use strict";

  const root =
    typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const getDom = () => root.TrainingDom || (typeof require === "function" ? require("../dom.js") : null);

  function renderQuickView(ctx) {
    const dom = getDom();
    const { el, renderEquipmentChipBar, renderPacingControls, renderEditableExerciseRow } = dom;
    const scope = (ctx && ctx.scope) || dom.createViewScope();
    const { store } = ctx;
    const syncTopbar = ctx.syncTopbar || (() => {});

    document.title = "On-the-Fly";
    syncTopbar("quick", false);

    store.ensureAdHocSession();

    const leftPane = el("section", { className: "editor-pane" });
    const searchInput = el("input", {
      type: "search",
      name: "q",
      className: "minimal-input",
      placeholder: "Search compatible exercises...",
      "aria-label": "Search compatible exercises",
    });
    const searchResultsWrap = el("div", { id: "quick-search-results" });
    const rightPane = el("section", { className: "editor-pane" }, [searchInput, searchResultsWrap]);

    document.getElementById("app-root").replaceChildren(
      el("main", { className: "editor-screen" }, [leftPane, rightPane])
    );

    function refreshAdHocPane() {
      const adhoc = store.ensureAdHocSession();
      const cards = store.buildRoutineCards(["adhoc"]);
      const rows = cards && cards[0] ? cards[0].exercises : [];

      const shuffleBtn = el("button", {
        type: "button", id: "quick-generate-btn", className: "btn-ghost btn-compact",
        textContent: "\ud83c\udfb2 Generate Workout",
      });
      const addRandomBtn = el("button", {
        type: "button", id: "quick-add-random-btn", className: "btn-ghost btn-compact",
        textContent: "+ Random Exercise",
      });
      const startBtn = rows.length > 0
        ? el("a", {
            href: "#workout/adhoc", id: "quick-start-btn", className: "btn-primary",
            style: { marginLeft: "auto", padding: "0.45rem 1.1rem", fontSize: "0.9rem" },
            textContent: "\u25b6 Start",
          })
        : null;

      scope.on(shuffleBtn, "click", () => {
        store.generateAdHocSession({ count: Math.max(4, rows.length || 4) });
        refreshAdHocPane();
      });
      scope.on(addRandomBtn, "click", () => {
        store.addRandomExerciseToAdHoc();
        refreshAdHocPane();
      });

      const headerRow = el("div", { style: { display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" } }, [
        el("a", {
          href: "#plan", className: "btn-ghost",
          style: { padding: "0.35rem 0.75rem" }, "aria-label": "Back", textContent: "\u2190",
        }),
        el("h1", { style: { fontSize: "1.15rem", fontWeight: "800", margin: "0" }, textContent: adhoc.name }),
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
          refreshCatalogSearch();
        }),
        el("div", { style: { display: "flex", gap: "0.45rem", flexWrap: "wrap", marginTop: "0.2rem" } }, [
          shuffleBtn,
          addRandomBtn,
        ]),
      ]);

      const listNode = rows.length > 0
        ? el(
            "ul",
            { className: "ex-list" },
            rows.map((row) =>
              renderEditableExerciseRow(scope, row, {
                onUpdate: (patch) => {
                  store.updateAdHocExercise(row.item.id, patch);
                  refreshAdHocPane();
                },
                onSwap: () => {
                  store.swapAdHocExercise(row.item.id);
                  refreshAdHocPane();
                },
                onRemove: () => {
                  store.removeAdHocExercise(row.item.id);
                  refreshAdHocPane();
                },
              })
            )
          )
        : el("div", { className: "muted", textContent: "+ Generate or add exercises for your workout" });

      leftPane.replaceChildren(headerRow, equipCard, listNode);
    }

    function refreshCatalogSearch() {
      const results = store.searchCatalog(searchInput.value, 24, { compatibleOnly: true }) || [];
      if (results.length === 0) {
        searchResultsWrap.replaceChildren(el("div", { className: "muted", textContent: "No compatible exercises match." }));
        return;
      }

      const grid = el(
        "div",
        { className: "catalog-grid" },
        results.map((ex) => {
          const thumbSrc = ex.thumb_url || "./svgs/thumbs/squat__body_only.svg";
          const addBtn = el("button", {
            type: "button", className: "btn-ghost",
            style: { padding: "0.3rem 0.7rem" }, "aria-label": `Add ${ex.name}`, textContent: "+",
          });
          scope.on(addBtn, "click", () => {
            store.addExerciseToAdHoc(ex.id);
            refreshAdHocPane();
          });
          return el("div", { className: "catalog-card" }, [
            el("div", { className: "ex-row-left" }, [
              el("img", { src: thumbSrc, alt: "", className: "svg-thumb" }),
              el("div", { style: { minWidth: "0" } }, [
                el("div", { className: "ex-row-name", textContent: ex.name }),
                el("div", {
                  className: "muted",
                  style: { fontSize: "0.75rem", textTransform: "capitalize" },
                  textContent: `${ex.primary_muscle || ""} \u00b7 ${ex.equipment || "body only"}`,
                }),
              ]),
            ]),
            addBtn,
          ]);
        })
      );
      searchResultsWrap.replaceChildren(grid);
    }

    scope.on(searchInput, "input", refreshCatalogSearch);
    scope.on(searchInput, "search", refreshCatalogSearch);

    refreshAdHocPane();
    refreshCatalogSearch();

    return scope;
  }

  renderQuickView.render = renderQuickView;
  root.TrainingViews = root.TrainingViews || {};
  root.TrainingViews.quick = renderQuickView;
  if (typeof module !== "undefined" && module.exports) module.exports = renderQuickView;
})();
