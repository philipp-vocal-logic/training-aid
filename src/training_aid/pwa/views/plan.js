/* Screen 2: Daily Recommended Session, Non-Destructive Equipment Filter & Weekly Plan (#plan) */
(function () {
  "use strict";

  const root =
    typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const getDom = () => root.TrainingDom || (typeof require === "function" ? require("../dom.js") : null);

  function getCardIntensityPercent(card) {
    if (card && typeof card.intensity_percent === "number") return card.intensity_percent;
    if (card && card.routine && typeof card.routine.intensity_percent === "number") {
      return card.routine.intensity_percent;
    }
    const lvl = (card && card.routine && Number(card.routine.intensity_level)) || 0;
    return 100 + Math.max(-5, lvl) * 10;
  }

  function renderPlanView(ctx) {
    const dom = getDom();
    const {
      el, setTrustedSvg, resolveSvgMarkup, bindPreviewLoop,
      renderEquipmentChipBar, renderPacingControls,
    } = dom;
    const scope = (ctx && ctx.scope) || dom.createViewScope();
    const { store, catalog } = ctx;
    const navigateTo = ctx.navigateTo || ((h) => { if (typeof window !== "undefined") window.location.hash = h; });
    const syncTopbar = ctx.syncTopbar || (() => {});

    document.title = "Plan";
    syncTopbar("plan", false);

    const state = store.getState();
    const rec = store.getRecommendedToday();
    const routineCards = store.buildRoutineCards(undefined, { adaptForSession: true });
    const nextCard = rec.card;
    const stats = rec.stats;
    const completedLog = typeof ctx.consumeCompletedLog === "function" ? ctx.consumeCompletedLog() : ctx.completedLog || null;

    const stageTagText = rec.trained_today
      ? `Done Today (${rec.workouts_today}) \u2713 \u00b7 Next`
      : "Recommended Today";
    const stageTag = el("span", { className: "pill pill-brand", id: "stage-tag", textContent: stageTagText });
    const nextIntensityPct = nextCard ? getCardIntensityPercent(nextCard) : 100;
    const stageIntensityPill = el("span", {
      className: "pill", id: "stage-intensity",
      hidden: !nextCard,
      textContent: `Intensity ${nextIntensityPct}%`,
    });
    const adaptedBadge = nextCard && nextCard.was_substituted
      ? el("span", { className: "pill", textContent: `${nextCard.substituted_count} adapted for gear` })
      : null;

    let completedBanner = null;
    if (completedLog) {
      const choice = completedLog.next_intensity_choice;
      const deltaLabel = completedLog.is_adhoc
        ? "On-the-Fly Saved"
        : choice === "more"
          ? "+10%"
          : choice === "less"
            ? "\u221210%"
            : "Saved";
      completedBanner = el("span", { className: "pill pill-brand", role: "status", textContent: `\u2713 ${deltaLabel}` });
    }

    let currentSvgKey = nextCard
      ? nextCard.lead_svg_key || `${nextCard.lead_archetype || "squat"}:body_only`
      : "squat:body_only";

    const svgWrap = el("div", { id: "overview-svg-wrap", className: "stage-svg-wrap" });
    setTrustedSvg(svgWrap, resolveSvgMarkup(catalog, currentSvgKey));

    const stageTitleEl = el("h1", {
      className: "stage-title", id: "stage-routine-title",
      textContent: nextCard ? nextCard.routine.name : "",
    });

    let stageActionBtn = null;
    if (nextCard) {
      const hasExercises = nextCard.exercises && nextCard.exercises.length > 0;
      const nextIdEnc = encodeURIComponent(nextCard.routine.id);
      stageActionBtn = el("a", {
        id: "stage-start-btn", className: "btn-primary",
        href: hasExercises ? `#workout/${nextIdEnc}` : `#edit/${nextIdEnc}`,
        textContent: hasExercises ? "\u25b6 Start" : "+ Add",
      });
    }

    const stageSection = el("section", { className: "graphic-stage", "aria-label": "Recommended workout preview" }, [
      el("div", { className: "stage-hud-top" }, [
        el("div", { style: { display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" } }, [
          stageTag, stageIntensityPill, adaptedBadge,
        ]),
        completedBanner,
      ]),
      svgWrap,
      nextCard
        ? el("div", { className: "stage-hud-bottom" }, [
            el("div", null, [
              el("div", { className: "muted", style: { marginBottom: "0.15rem" }, textContent: state.plan.name }),
              stageTitleEl,
            ]),
            el("div", { style: { display: "flex", gap: "0.5rem", alignItems: "center" } }, [
              el("a", { href: "#quick", className: "btn-ghost", textContent: "\u26a1 On-the-Fly" }),
              stageActionBtn,
            ]),
          ])
        : null,
    ]);

    const weeklyGoal = Math.max(1, Number(stats.weekly_goal) || 3);
    const pct = Math.min(100, Math.round(((Number(stats.workouts_this_week) || 0) / weeklyGoal) * 100));
    const addDayBtn = el("button", { type: "button", className: "btn-ghost btn-compact", title: "Add workout day", textContent: "+ Day" });
    scope.on(addDayBtn, "click", () => {
      const created = store.addWorkoutDay();
      if (created && created.id) navigateTo(`#edit/${encodeURIComponent(created.id)}`);
    });

    const weekStrip = el("div", { className: "week-strip" }, [
      el("span", { className: "pill", textContent: stats.message }),
      el("div", { className: "mini-bar", "aria-label": "Weekly goal" }, [
        el("div", { className: "mini-bar-fill", style: { width: `${pct}%` } }),
      ]),
      el("a", { href: "#quick", className: "btn-ghost btn-compact", textContent: "\u26a1 Quick" }),
      addDayBtn,
    ]);

    let resetEqBtn = null;
    if (rec.is_equipment_overridden) {
      resetEqBtn = el("button", {
        type: "button", className: "btn-ghost btn-xs",
        title: "Restore saved plan equipment", textContent: "Reset Gear",
      });
      scope.on(resetEqBtn, "click", () => {
        store.resetSessionEquipment();
        navigateTo("#plan");
      });
    }

    const equipPanel = el("section", { className: "filter-panel" }, [
      el("div", { className: "field-label-row" }, [
        el("span", { className: "field-label", textContent: "Equipment Available Today" }),
        renderPacingControls(scope, store.getWorkoutTiming(), (patch) => store.setWorkoutTiming(patch)),
      ]),
      renderEquipmentChipBar(
        scope,
        rec.equipment,
        (nextList) => {
          store.setSessionEquipment(nextList);
          navigateTo("#plan");
        },
        resetEqBtn
      ),
    ]);

    const previewLoop = bindPreviewLoop(scope, svgWrap, (rig) => ({
      speed: 0.38,
      tempoMode: rig && rig.tempoMode && rig.tempoMode !== "hold" ? rig.tempoMode : "standard",
    }));

    function swapStageSvg(svgKey, fallbackArch) {
      const targetKey = svgKey || `${fallbackArch || "squat"}:body_only`;
      if (targetKey === currentSvgKey) return;
      const markup = resolveSvgMarkup(catalog, targetKey);
      if (!markup) return;
      currentSvgKey = targetKey;
      setTrustedSvg(svgWrap, markup);
      previewLoop.rebind(svgWrap);
    }

    const articleElements = [];
    const cardNodes = routineCards.map((card) => {
      const isNext = Boolean(nextCard && card.routine.id === nextCard.routine.id);
      const cardPct = getCardIntensityPercent(card);
      const hasEx = Boolean(card.exercises && card.exercises.length > 0);
      const routineIdEnc = encodeURIComponent(card.routine.id);

      const exListNode = hasEx
        ? el("ul", { className: "ex-list" }, card.exercises.map((row) => {
            const thumbSrc = row.thumb_url || "./svgs/thumbs/squat__body_only.svg";
            const nameGroup = [el("span", { className: "ex-row-name", textContent: row.exercise.name })];
            if (row.is_substituted && row.replaced_name) {
              nameGroup.push(
                el("span", {
                  className: "muted",
                  style: { fontSize: "0.72rem", display: "block" },
                  textContent: `\u21c4 replaces ${row.replaced_name}`,
                })
              );
            }
            const li = el(
              "li",
              { className: "ex-row", dataset: { archetype: row.archetype, svgKey: row.svg_key || `${row.archetype}:body_only` } },
              [
                el("div", { className: "ex-row-left" }, [
                  el("img", { src: thumbSrc, alt: "", className: "svg-thumb" }),
                  el("div", { style: { minWidth: "0" } }, nameGroup),
                ]),
                el("span", { className: "ex-row-target", textContent: row.scaled.formatted }),
              ]
            );
            scope.on(li, "mouseenter", () => swapStageSvg(row.svg_key, row.archetype));
            scope.on(li, "click", () => {
              swapStageSvg(row.svg_key, row.archetype);
              stageTitleEl.textContent = card.routine.name;
              stageIntensityPill.textContent = `Intensity ${cardPct}%`;
              stageIntensityPill.hidden = false;
              if (stageActionBtn) {
                stageActionBtn.setAttribute("href", hasEx ? `#workout/${routineIdEnc}` : `#edit/${routineIdEnc}`);
                stageActionBtn.textContent = hasEx ? "\u25b6 Start" : "+ Add";
              }
              for (const a of articleElements) a.classList.toggle("is-next", a === article);
            });
            return li;
          }))
        : el("a", { href: `#edit/${routineIdEnc}`, className: "muted", textContent: "+ Add exercises" });

      const article = el(
        "article",
        {
          className: "routine-card" + (isNext ? " is-next" : ""),
          dataset: {
            archetype: card.lead_archetype,
            svgKey: card.lead_svg_key || `${card.lead_archetype}:body_only`,
            routineName: card.routine.name,
            startUrl: `#workout/${routineIdEnc}`,
            hasEx: hasEx ? "1" : "0",
          },
        },
        [
          el("div", { className: "routine-card-head" }, [
            el("div", { style: { display: "flex", alignItems: "center", gap: "0.45rem", minWidth: "0", flexWrap: "wrap" } }, [
              el("span", { className: "routine-name", textContent: card.routine.name }),
              el("span", { className: "pill", textContent: `${cardPct}%` }),
              card.was_substituted ? el("span", { className: "pill pill-brand", textContent: "\u21c4 Adapted" }) : null,
            ]),
            el("div", { style: { display: "flex", gap: "0.35rem" } }, [
              el("a", {
                href: `#edit/${routineIdEnc}`, className: "btn-ghost",
                style: { padding: "0.28rem 0.65rem" }, "aria-label": "Edit", textContent: "\u270e",
              }),
              hasEx
                ? el("a", {
                    href: `#workout/${routineIdEnc}`, className: "btn-ghost",
                    style: { padding: "0.28rem 0.65rem" }, "aria-label": "Start", textContent: "\u25b6",
                  })
                : null,
            ]),
          ]),
          exListNode,
        ]
      );
      articleElements.push(article);
      return article;
    });

    document.getElementById("app-root").replaceChildren(
      el("main", { className: "split-screen" }, [
        stageSection,
        el("section", { className: "side-pane" }, [weekStrip, equipPanel, ...cardNodes]),
      ])
    );

    return scope;
  }

  renderPlanView.render = renderPlanView;
  root.TrainingViews = root.TrainingViews || {};
  root.TrainingViews.plan = renderPlanView;
  if (typeof module !== "undefined" && module.exports) module.exports = renderPlanView;
})();
