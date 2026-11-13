/* Screen 4: Full-Screen Active Workout (#workout/<routineId>) */
(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const REST_SECONDS = 20;
  const DEFAULT_SOUND_THEMES = [
    { id: "off", label: "Off" }, { id: "minimal", label: "Minimal Cues" },
    { id: "techno", label: "Techno Pulse" }, { id: "trance", label: "Trance Arp" },
    { id: "studio", label: "Studio Kit" },
  ];
  const getDom = () => root.TrainingDom || (typeof require === "function" ? require("../dom.js") : null);

  function renderWorkoutView(ctx) {
    const dom = getDom();
    const { el, setTrustedSvg, resolveSvgMarkup, makeVolumeOnIcon, makeVolumeOffIcon, makeFullscreenIcon, makeCheckIcon } = dom;
    const motion = root.TrainingMotion;
    const scope = (ctx && ctx.scope) || dom.createViewScope();
    const { store, catalog, sound } = ctx;
    const routineId = ctx.routineId || ctx.id || ctx.param;
    const navigateTo = ctx.navigateTo || ((h) => { if (typeof window !== "undefined") window.location.hash = h; });
    const syncTopbar = ctx.syncTopbar || (() => {});
    const onCompleteLog = ctx.onCompleteLog || (() => {});

    const routine = store.getRoutine(routineId);
    if (!routine) return scope;

    document.title = routine.name;
    syncTopbar("", true);

    const playlist = store.buildPlaylist(routine.id) || [];
    const appRoot = document.getElementById("app-root");

    if (playlist.length === 0) {
      appRoot.replaceChildren(
        el("main", { id: "workout-viewport", className: "workout-viewport", dataset: { state: "FINISHED" } }, [
          el("div", { className: "finish-screen" }, [
            el("a", { href: "#plan", className: "hud-icon-btn", style: { position: "absolute", top: "1rem", left: "1.2rem" }, "aria-label": "Exit", textContent: "\u2715" }),
            el("h1", { className: "stage-title", style: { marginBottom: "1.2rem" }, textContent: routine.name }),
            el("a", { href: `#edit/${encodeURIComponent(routine.id)}`, className: "btn-primary", textContent: "+ Exercises" }),
          ]),
        ])
      );
      return scope;
    }

    sound.setTheme(store.getSoundTheme());
    const firstEx = playlist[0];
    const themeOptions = root.TrainingSound && Array.isArray(root.TrainingSound.THEMES) ? root.TrainingSound.THEMES : DEFAULT_SOUND_THEMES;

    const stepProgressEl = el("span", { id: "step-progress", className: "pill", textContent: `1/${playlist.length} \u00b7 S1/${firstEx.sets}` });
    const titleEl = el("h1", { id: "ex-title", className: "hud-ex-title", textContent: firstEx.name });
    const howToEl = el("div", {
      id: "ex-how-to", className: "muted",
      style: { fontSize: "0.78rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
      textContent: firstEx.how_to || "",
    });
    const weightEl = el("span", {
      id: "ex-weight", className: "pill pill-brand",
      style: { display: firstEx.weight_label ? "inline-flex" : "none" },
      textContent: firstEx.weight_label || "",
    });

    const soundSelect = el(
      "select",
      { id: "sound-theme-select", className: "hud-select", "aria-label": "Sound theme" },
      themeOptions.map((opt) => el("option", { value: opt.id, textContent: opt.label }))
    );
    const iconVolOn = makeVolumeOnIcon();
    const iconVolOff = makeVolumeOffIcon();
    const soundBtn = el("button", { type: "button", id: "sound-toggle", className: "hud-icon-btn", "aria-label": "Sound" }, [iconVolOn, iconVolOff]);
    const fsBtn = el("button", { type: "button", id: "fs-toggle", className: "hud-icon-btn", "aria-label": "Fullscreen" }, [makeFullscreenIcon()]);
    const earlyBtn = el("button", { type: "button", id: "early-finish-btn", className: "hud-icon-btn", "aria-label": "Finish" }, [makeCheckIcon()]);

    const getExSvgMarkup = (ex) => ex.svg_markup || resolveSvgMarkup(catalog, ex.svg_key || ex.archetype, ex.eq_mode);
    const svgHolder = el("div", { id: "svg-holder" });
    setTrustedSvg(svgHolder, getExSvgMarkup(firstEx));
    const canvasTapArea = el("div", { id: "canvas-tap-area", className: "workout-svg-canvas" }, [svgHolder]);
    const phaseCueEl = el("div", { id: "phase-cue", className: "phase-cue-float", textContent: firstEx.cue_work });
    const repReadoutEl = el("div", { id: "rep-readout", className: "rep-readout", textContent: `0/${firstEx.reps}${firstEx.is_hold ? "s" : ""}` });
    const skipBtn = el("button", { type: "button", id: "skip-btn", className: "hud-icon-btn", style: { display: "none" }, "aria-label": "Skip", textContent: "\u23ed" });
    const primaryBtn = el("button", { type: "button", id: "primary-btn", className: "btn-primary", textContent: "\u25b6 Start" });
    const progressFillEl = el("div", { id: "set-progress-fill", className: "edge-progress-fill" });

    const stageEl = el("div", { id: "coach-stage" }, [
      el("header", { className: "workout-hud-top" }, [
        el("div", { className: "hud-title-cluster" }, [
          el("a", { href: "#plan", className: "hud-icon-btn", "aria-label": "Exit", textContent: "\u2715" }),
          stepProgressEl, el("div", { style: { minWidth: "0" } }, [titleEl, howToEl]), weightEl,
        ]),
        el("div", { className: "hud-actions" }, [soundSelect, soundBtn, fsBtn, earlyBtn]),
      ]),
      canvasTapArea, phaseCueEl,
      el("footer", { className: "workout-hud-bottom" }, [
        repReadoutEl, el("div", { className: "coach-controls" }, [skipBtn, primaryBtn]),
      ]),
      el("div", { className: "edge-progress" }, [progressFillEl]),
    ]);

    const makeChoiceTile = (val, delta, word, isMore) => el(
      "button",
      { type: "button", name: "next_intensity_choice", value: val, className: "finish-tile" + (isMore ? " finish-tile-more" : "") },
      [el("span", { className: "finish-delta", textContent: delta }), el("span", { className: "finish-word", textContent: word })]
    );
    const lessBtn = makeChoiceTile("less", "\u221210%", "Easier", false);
    const keepBtn = makeChoiceTile("keep", "=", "Same", false);
    const moreBtn = makeChoiceTile("more", "+10%", "Harder", true);

    const finishScreenEl = el("div", { id: "finish-form", className: "finish-screen", style: { display: "none" } }, [
      el("div", { className: "finish-check", textContent: "\u2713" }),
      el("h2", { className: "stage-title", textContent: routine.name }),
      el("div", { className: "finish-grid" }, [lessBtn, keepBtn, moreBtn]),
    ]);

    const viewportEl = el("main", { id: "workout-viewport", className: "workout-viewport", dataset: { state: "IDLE" } }, [stageEl, finishScreenEl]);
    appRoot.replaceChildren(viewportEl);

    function syncSoundUi() {
      soundSelect.value = sound.getTheme();
      const muted = sound.isMuted();
      iconVolOn.style.display = muted ? "none" : "block";
      iconVolOff.style.display = muted ? "block" : "none";
    }
    syncSoundUi();

    let state = "IDLE", paused = false, exIdx = 0, setNum = 1, phaseElapsed = 0, idleElapsed = 0;
    let lastFrameTs = null, rafId = null, lastCountdownInt = null, lastCompletedRep = 0;
    let midRepFiredForRep = -1, lastDiscretePoseKey = null, durationMinutes = 25;
    const sessionStartMs = Date.now();

    const durationInterval = scope.addInterval(() => {
      if (state === "FINISHED") {
        scope.clearTrackedInterval(durationInterval);
        return;
      }
      const mins = Math.floor((Date.now() - sessionStartMs) / 60000);
      if (mins >= 1) durationMinutes = mins;
    }, 10000);

    let rig = motion.bindSvg(svgHolder.querySelector("svg"));
    const currentEx = () => playlist[exIdx];
    const formatReadout = (done, ex) => `${done}/${ex.reps}${ex.is_hold ? "s" : ""}`;
    const setCueText = (text) => { if (phaseCueEl.textContent !== text) phaseCueEl.textContent = text; };

    function applyNeutralBreath(phaseSec) {
      if (!rig) return;
      if (motion.prefersReducedMotion()) {
        if (lastDiscretePoseKey !== "neutral") {
          lastDiscretePoseKey = "neutral";
          rig.applyPose(0);
        }
        return;
      }
      lastDiscretePoseKey = null;
      rig.applyRestBreath(phaseSec);
    }

    const shouldRunLoop = () => !paused && state !== "FINISHED" && !document.hidden && !(state === "IDLE" && motion.prefersReducedMotion());

    function stopLoop() {
      if (rafId !== null) {
        scope.cancelFrame(rafId);
        rafId = null;
      }
      lastFrameTs = null;
    }

    function ensureLoop() {
      if (!shouldRunLoop()) stopLoop();
      else if (rafId === null) {
        lastFrameTs = null;
        rafId = scope.requestFrame(tick);
      }
    }

    function setState(nextState) {
      state = nextState;
      viewportEl.dataset.state = nextState;
    }

    function loadStagePreview() {
      const ex = currentEx();
      stepProgressEl.textContent = `${exIdx + 1}/${playlist.length} \u00b7 S${setNum}/${ex.sets}`;
      titleEl.textContent = ex.name;
      howToEl.textContent = ex.how_to || "";
      weightEl.textContent = ex.weight_label || "";
      weightEl.style.display = ex.weight_label ? "inline-flex" : "none";
      setTrustedSvg(svgHolder, getExSvgMarkup(ex));
      rig = motion.bindSvg(svgHolder.querySelector("svg"));
      lastDiscretePoseKey = null;
      applyNeutralBreath(0);
    }

    function popCounter() {
      if (motion.prefersReducedMotion()) return;
      repReadoutEl.classList.add("pop");
      scope.addTimeout(() => repReadoutEl.classList.remove("pop"), 140);
    }

    function beginCountdown() {
      const ex = currentEx();
      setState("COUNTDOWN");
      paused = false;
      phaseElapsed = 0;
      lastCountdownInt = 3;
      loadStagePreview();
      repReadoutEl.textContent = formatReadout(0, ex);
      progressFillEl.style.width = "0%";
      setCueText("3");
      sound.resume();
      sound.beginPhase("COUNTDOWN", { countdownSeconds: 3.0, repSeconds: ex.rep_seconds });
      sound.countdown(3);
      primaryBtn.textContent = "\u23f8";
      skipBtn.style.display = "inline-flex";
      ensureLoop();
    }

    function beginActiveSet() {
      const ex = currentEx();
      const mode = ex.tempo_mode || rig.tempoMode || "standard";
      setState("ACTIVE");
      paused = false;
      phaseElapsed = 0;
      lastCompletedRep = 0;
      midRepFiredForRep = -1;
      lastDiscretePoseKey = null;
      repReadoutEl.textContent = formatReadout(0, ex);
      progressFillEl.style.width = "0%";
      primaryBtn.textContent = "\u23f8";
      skipBtn.style.display = "inline-flex";
      sound.beginPhase("ACTIVE", {
        repSeconds: ex.rep_seconds, reps: ex.reps, tempoMode: mode,
        turnaround: motion.turnaroundForMode(mode), isHold: Boolean(ex.is_hold),
      });
      sound.startSignal();
      setCueText(ex.cue_work);
      if (motion.prefersReducedMotion() && rig) {
        lastDiscretePoseKey = ex.is_hold ? "hold" : "0:1:0";
        rig.applyPose(1, { swapSides: false });
      }
      ensureLoop();
    }

    function completeEntireWorkout() {
      setState("FINISHED");
      stopLoop();
      scope.clearTrackedInterval(durationInterval);
      sound.beginPhase("FINISHED", {});
      sound.workoutComplete();
      stageEl.style.display = "none";
      finishScreenEl.style.display = "flex";
    }

    function finishCurrentSet() {
      const completedEx = currentEx();
      repReadoutEl.textContent = formatReadout(completedEx.reps, completedEx);
      progressFillEl.style.width = "100%";
      popCounter();

      if (setNum < completedEx.sets) setNum += 1;
      else if (exIdx + 1 < playlist.length) { exIdx += 1; setNum = 1; }
      else { completeEntireWorkout(); return; }

      setState("REST");
      phaseElapsed = 0;
      lastCountdownInt = null;
      loadStagePreview();
      sound.beginPhase("REST", { restSeconds: REST_SECONDS });
      sound.stopSet();
      setCueText(`Rest \u00b7 ${currentEx().name}`);
      primaryBtn.textContent = "\u23f8";
      ensureLoop();
    }

    function tick(ts) {
      rafId = null;
      if (!shouldRunLoop()) { lastFrameTs = null; return; }
      const dt = lastFrameTs === null ? 0 : Math.min(0.1, (ts - lastFrameTs) / 1000);
      lastFrameTs = ts;

      if (state === "IDLE") {
        idleElapsed += dt;
        applyNeutralBreath(idleElapsed);
      } else if (state === "COUNTDOWN") {
        phaseElapsed = sound.advancePhase(dt);
        applyNeutralBreath(phaseElapsed);
        const rem = Math.ceil(3.0 - phaseElapsed);
        if (rem >= 1) {
          setCueText(String(rem));
          if (rem !== lastCountdownInt) { lastCountdownInt = rem; sound.countdown(rem); }
        }
        if (phaseElapsed >= 3.0) beginActiveSet();
      } else if (state === "ACTIVE") {
        phaseElapsed = sound.advancePhase(dt);
        const ex = currentEx();
        const totalSec = ex.reps * ex.rep_seconds;

        if (phaseElapsed >= totalSec) {
          finishCurrentSet();
        } else {
          const repFloat = phaseElapsed / ex.rep_seconds;
          const completed = Math.min(ex.reps, Math.floor(repFloat));
          const repIndex = Math.floor(repFloat);
          const frac = repFloat - repIndex;
          progressFillEl.style.width = `${Math.min(100, (phaseElapsed / totalSec) * 100).toFixed(1)}%`;

          if (ex.is_hold) {
            if (motion.prefersReducedMotion()) {
              if (lastDiscretePoseKey !== "hold") { lastDiscretePoseKey = "hold"; rig.applyPose(1); }
            } else {
              rig.applyHold(phaseElapsed);
            }
            setCueText(Math.floor(phaseElapsed / 2) % 2 === 0 ? ex.cue_work : ex.cue_return);
          } else {
            const mode = ex.tempo_mode || rig.tempoMode || "standard";
            const isWorkPhase = frac < motion.turnaroundForMode(mode);
            const poseOpts = { swapSides: Boolean(ex.is_alternating && repIndex % 2 === 1) };

            if (motion.prefersReducedMotion()) {
              const discreteT = isWorkPhase ? 1 : 0;
              const poseKey = `${repIndex}:${discreteT}:${poseOpts.swapSides ? "1" : "0"}`;
              if (poseKey !== lastDiscretePoseKey) { lastDiscretePoseKey = poseKey; rig.applyPose(discreteT, poseOpts); }
            } else {
              rig.applyPose(motion.tempoCurve(frac, mode), poseOpts);
            }
            setCueText(isWorkPhase ? ex.cue_work : ex.cue_return);
            if (!isWorkPhase && midRepFiredForRep < repIndex && repIndex < ex.reps) {
              midRepFiredForRep = repIndex;
              sound.midRep();
            }
          }

          if (completed > lastCompletedRep) {
            lastCompletedRep = completed;
            repReadoutEl.textContent = formatReadout(completed, ex);
            popCounter();
            if (completed < ex.reps) {
              if (ex.is_hold) sound.holdTick(ex.reps - completed);
              else sound.repDone(completed, ex.reps);
            }
          }
        }
      } else if (state === "REST") {
        phaseElapsed = sound.advancePhase(dt);
        const restRem = Math.max(0, Math.ceil(REST_SECONDS - phaseElapsed));
        if (phaseElapsed >= 0.6 && repReadoutEl.textContent !== `${restRem}s`) repReadoutEl.textContent = `${restRem}s`;
        progressFillEl.style.width = `${Math.max(0, ((REST_SECONDS - phaseElapsed) / REST_SECONDS) * 100).toFixed(1)}%`;
        setCueText(restRem <= 3 && restRem > 0 ? String(restRem) : `Rest \u00b7 ${currentEx().name}`);
        applyNeutralBreath(phaseElapsed);
        if (restRem <= 3 && restRem >= 1 && restRem !== lastCountdownInt) { lastCountdownInt = restRem; sound.countdown(restRem); }
        if (phaseElapsed >= REST_SECONDS) beginActiveSet();
      }

      if (shouldRunLoop() && rafId === null) rafId = scope.requestFrame(tick);
    }

    function togglePlayPause() {
      sound.ensureAudio();
      if (state === "IDLE") { beginCountdown(); return; }
      if (state === "FINISHED") return;
      paused = !paused;
      primaryBtn.textContent = paused ? "\u25b6" : "\u23f8";
      if (paused) { sound.pause(); stopLoop(); setCueText("Paused"); }
      else { sound.resume(); ensureLoop(); }
    }

    function skipCurrentPhase() {
      sound.ensureAudio();
      if (state === "IDLE" || state === "FINISHED") return;
      if (paused) { sound.stopAll(); paused = false; sound.resume(); }
      primaryBtn.textContent = "\u23f8";
      if (state === "REST" || state === "COUNTDOWN") beginActiveSet();
      else if (state === "ACTIVE") finishCurrentSet();
    }

    scope.on(primaryBtn, "click", togglePlayPause);
    scope.on(canvasTapArea, "click", togglePlayPause);
    scope.on(skipBtn, "click", skipCurrentPhase);

    scope.on(soundSelect, "change", () => {
      const applied = sound.setTheme(soundSelect.value);
      store.setSoundTheme(applied);
      sound.ensureAudio();
      syncSoundUi();
      soundSelect.blur();
    });
    scope.on(soundSelect, "keydown", (e) => { if (e.code === "Space") e.stopPropagation(); });
    scope.on(soundBtn, "click", () => {
      const nextTheme = sound.toggleMute();
      store.setSoundTheme(nextTheme);
      sound.ensureAudio();
      syncSoundUi();
    });
    scope.on(fsBtn, "click", () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    });
    scope.on(earlyBtn, "click", () => {
      paused = true;
      setState("FINISHED");
      sound.stopAll();
      sound.beginPhase("FINISHED", {});
      stopLoop();
      scope.clearTrackedInterval(durationInterval);
      stageEl.style.display = "none";
      finishScreenEl.style.display = "flex";
    });

    for (const btn of [lessBtn, keepBtn, moreBtn]) {
      scope.on(btn, "click", () => {
        onCompleteLog(store.completeWorkout(routine.id, {
          next_intensity_choice: btn.value,
          duration_minutes: durationMinutes,
          completed_ids: playlist.map((item) => item.item_id),
        }));
        navigateTo("#plan");
      });
    }

    scope.on(document, "visibilitychange", () => {
      if (document.hidden) { sound.pause(); stopLoop(); }
      else {
        if (!paused && state !== "IDLE" && state !== "FINISHED") sound.resume();
        ensureLoop();
      }
    });
    scope.onMediaChange(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)"), () => {
      lastDiscretePoseKey = null;
      if (state !== "ACTIVE" && state !== "FINISHED") applyNeutralBreath(0);
      ensureLoop();
    });
    scope.on(window, "keydown", (e) => {
      if (e.target && e.target.tagName === "SELECT") return;
      if (e.code === "Space" && state !== "FINISHED") { e.preventDefault(); togglePlayPause(); }
      else if (e.code === "ArrowRight") skipCurrentPhase();
    });

    applyNeutralBreath(0);
    ensureLoop();
    return scope;
  }

  renderWorkoutView.render = renderWorkoutView;
  root.TrainingViews = root.TrainingViews || {};
  root.TrainingViews.workout = renderWorkoutView;
  if (typeof module !== "undefined" && module.exports) module.exports = renderWorkoutView;
})();
