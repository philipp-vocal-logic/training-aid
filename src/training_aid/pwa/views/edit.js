/* Screen 3: Routine Editor (#edit/<routineId>) */
(function () {
  "use strict";

  const root =
    typeof window !== "undefined"
      ? window
      : typeof globalThis !== "undefined"
        ? globalThis
        : this;

  function getDom() {
    return (
      root.TrainingDom ||
      (typeof require === "function" ? require("../dom.js") : null)
    );
  }

  function renderEditView(ctx) {
    const dom = getDom();
    const { el } = dom;
    const scope = (ctx && ctx.scope) || dom.createViewScope();
    const store = ctx.store;
    const routineId = ctx.routineId || ctx.id || ctx.param;
    const syncTopbar = ctx.syncTopbar || (() => {});

    const routine = store.getRoutine(routineId);
    if (!routine) return scope;

    document.title = routine.name;
    syncTopbar("plan", false);

    const leftPane = el("section", { className: "editor-pane" });
    const searchInput = el("input", {
      type: "search",
      name: "q",
      className: "minimal-input",
      placeholder: "Search...",
      "aria-label": "Search exercises",
    });
    const searchResultsWrap = el("div", { id: "search-results" });
    const rightPane = el("section", { className: "editor-pane" }, [
      searchInput,
      searchResultsWrap,
    ]);

    document
      .getElementById("app-root")
      .replaceChildren(
        el("main", { className: "editor-screen" }, [leftPane, rightPane])
      );

    function refreshRoutineExercises() {
      const latestRoutine = store.getRoutine(routineId);
      if (!latestRoutine) return;
      const cards = store.buildRoutineCards([latestRoutine]);
      const rows = cards && cards[0] ? cards[0].exercises : [];
      const routineIdEnc = encodeURIComponent(latestRoutine.id);

      const headerRow = el(
        "div",
        { style: { display: "flex", alignItems: "center", gap: "0.6rem" } },
        [
          el("a", {
            href: "#plan",
            className: "btn-ghost",
            style: { padding: "0.35rem 0.75rem" },
            "aria-label": "Back",
            textContent: "\u2190",
          }),
          el("h1", {
            style: { fontSize: "1.15rem", fontWeight: "800", margin: "0" },
            textContent: latestRoutine.name,
          }),
          rows.length > 0
            ? el("a", {
                href: `#workout/${routineIdEnc}`,
                className: "btn-primary",
                style: {
                  marginLeft: "auto",
                  padding: "0.4rem 0.95rem",
                  fontSize: "0.85rem",
                },
                textContent: "\u25b6",
              })
            : null,
        ]
      );

      let listContent;
      if (rows.length > 0) {
        listContent = el(
          "ul",
          { className: "ex-list" },
          rows.map((row) => {
            const thumbSrc =
              row.thumb_url || "./svgs/thumbs/squat__body_only.svg";
            const removeBtn = el("button", {
              type: "button",
              className: "btn-ghost",
              style: { padding: "0.3rem 0.65rem" },
              "aria-label": "Remove",
              textContent: "\u2715",
            });
            scope.on(removeBtn, "click", () => {
              store.removeExerciseFromRoutine(latestRoutine.id, row.item.id);
              refreshRoutineExercises();
            });
            return el("li", { className: "catalog-card" }, [
              el("div", { className: "ex-row-left" }, [
                el("img", { src: thumbSrc, alt: "", className: "svg-thumb" }),
                el("div", { style: { minWidth: "0" } }, [
                  el("div", {
                    className: "ex-row-name",
                    textContent: row.exercise.name,
                  }),
                  el("div", {
                    className: "ex-row-target",
                    textContent: row.scaled.formatted,
                  }),
                ]),
              ]),
              removeBtn,
            ]);
          })
        );
      } else {
        listContent = el("div", {
          className: "muted",
          textContent: "+ Select exercises",
        });
      }

      leftPane.replaceChildren(headerRow, listContent);
    }

    function refreshCatalogSearch() {
      const results = store.searchCatalog(searchInput.value, 16) || [];
      if (results.length === 0) {
        searchResultsWrap.replaceChildren(
          el("div", { className: "muted", textContent: "\u2014" })
        );
        return;
      }

      const grid = el(
        "div",
        { className: "catalog-grid" },
        results.map((ex) => {
          const thumbSrc = ex.thumb_url || "./svgs/thumbs/squat__body_only.svg";
          const addBtn = el("button", {
            type: "button",
            className: "btn-ghost",
            style: { padding: "0.3rem 0.7rem" },
            "aria-label": "Add",
            textContent: "+",
          });
          scope.on(addBtn, "click", () => {
            store.addExerciseToRoutine(routineId, ex.id);
            refreshRoutineExercises();
          });
          return el("div", { className: "catalog-card" }, [
            el("div", { className: "ex-row-left" }, [
              el("img", { src: thumbSrc, alt: "", className: "svg-thumb" }),
              el("div", { style: { minWidth: "0" } }, [
                el("div", { className: "ex-row-name", textContent: ex.name }),
                el("div", {
                  className: "muted",
                  style: { fontSize: "0.75rem", textTransform: "capitalize" },
                  textContent: ex.primary_muscle || "",
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

    refreshRoutineExercises();
    refreshCatalogSearch();

    return scope;
  }

  renderEditView.render = renderEditView;

  root.TrainingViews = root.TrainingViews || {};
  root.TrainingViews.edit = renderEditView;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = renderEditView;
  }
})();
