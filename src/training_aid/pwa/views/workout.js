/* Screen 4: Full-Screen Active Workout — Strict Completion, Live Tempo & Configurable Rest (#workout/<id>) */
(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;
  const getDom = () => root.TrainingDom || (typeof require === "function" ? require("../dom.js") : null);
  const getDomain = () => root.TrainingDomain || (typeof require === "function" ? require("../domain.js") : null);

  function renderWorkoutView(ctx) {
    const dom = getDom();
    const domain = getDomain();
    const { el, setTrustedSvg, resolveSvgMarkup, makeVolumeOnIcon, makeVolumeOffIcon, makeFullscreenIcon, openModal, closeModal } = dom;
    const motion = root.TrainingMotion;
    const scope = (ctx && ctx.scope) || dom.createViewScope();
    const { store, catalog, sound } = ctx;
    const routineId = ctx.routineId || ctx.id || ctx.param;
    const isAdHoc = String(routineId) === "adhoc";
    const navigateTo = ctx.navigateTo || ((h) => { if (typeof window !== "undefined") window.location.hash = h; });
    const syncTopbar = ctx.syncTopbar || (() => {});
    const onCompleteLog = ctx.onCompleteLog || (() => {});

    const routine = isAdHoc ? store.getAdHocSession() : store.getRoutine(routineId);
    if (!routine) return scope;

    document.title = routine.name;
    syncTopbar("", true);

    const playlist = store.buildPlaylist(routine.id) || [];
    const exitHref = isAdHoc ? "#quick" : "#plan";
    const editHref = isAdHoc ? "#quick" : `#edit/${encodeURIComponent(routine.id)}`;
    const appRoot = document.getElementById("app-root");

    if (playlist.length === 0) {
      appRoot.replaceChildren(
        el("main", { id: "workout-viewport", className: "workout-viewport", dataset: { state: "FINISHED" } }, [
          el("div", { className: "finish-screen" }, [
            el("a", { href: exitHref, className: "hud-icon-btn", style: { position: "absolute", top: "1rem", left: "1.2rem" }, "aria-label": "Exit", textContent: "\u2715" }),
            el("h1", { className: "stage-title", style: { marginBottom: "1.2rem" }, textContent: routine.name }),
            el("a", { href: editHref, className: "btn-primary", textContent: "+ Exercises" }),
          ]),
        ])
      );
      return scope;
    }

    sound.setTheme(store.getSoundTheme());
    const firstEx = playlist[0];
    const wasSubstituted = !isAdHoc && playlist.some((p) => p.is_substituted || p.was_routine_substituted);
    const initialTiming = store.getWorkoutTiming();
    let configuredRestSeconds = Number(initialTiming.rest_seconds) || 30;
    let activeRestTarget = configuredRestSeconds;
    let currentSpeedMode = initialTiming.speed_mode || "normal";

    const themeOptions =
      (root.TrainingSound && Array.isArray(root.TrainingSound.THEMES) && root.TrainingSound.THEMES) ||
      (root.TrainingSoundPresets && Array.isArray(root.TrainingSoundPresets.THEMES) && root.TrainingSoundPresets.THEMES) ||
      [];
    const speedModes = (domain && domain.VALID_SPEED_MODES) || ["slow", "normal", "fast"];
    const speedLabels = { slow: "0.75\u00d7 Slow", normal: "1\u00d7 Tempo", fast: "1.25\u00d7 Fast" };
    const restPresets = (domain && domain.REST_PRESETS) || [15, 30, 45, 60, 90];

    const exitBtn = el("button", { type: "button", id: "exit-workout-btn", className: "hud-icon-btn", "aria-label": "Exit", textContent: "\u2715" });
    const stepProgressEl = el("span", { id: "step-progress", className: "pill", textContent: `1/${playlist.length} \u00b7 S1/${firstEx.sets}` });
    const titleEl = el("h1", { id: "ex-title", className: "hud-ex-title", textContent: firstEx.name });
    const howToEl = el("div", { id: "ex-how-to", className: "muted", style: { fontSize: "0.78rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }, textContent: firstEx.how_to || "" });
    const weightEl = el("span", { id: "ex-weight", className: "pill pill-brand", style: { display: firstEx.weight_label ? "inline-flex" : "none" }, textContent: firstEx.weight_label || "" });

    const speedSelect = el("select", { id: "speed-mode-select", className: "hud-select", "aria-label": "Exercise speed" },
      speedModes.map((m) => el("option", { value: m, selected: m === currentSpeedMode, textContent: speedLabels[m] || m })));
    const restChoices = restPresets.includes(configuredRestSeconds)
      ? restPresets
      : [...restPresets, configuredRestSeconds].sort((a, b) => a - b);
    const restSelect = el("select", { id: "rest-seconds-select", className: "hud-select", "aria-label": "Rest interval" },
      restChoices.map((sec) => el("option", { value: String(sec), selected: sec === configuredRestSeconds, textContent: `Rest ${sec}s` })));
    const soundSelect = el("select", { id: "sound-theme-select", className: "hud-select", "aria-label": "Sound theme" },
      themeOptions.map((opt) => el("option", { value: opt.id, textContent: opt.label })));
    const iconVolOn = makeVolumeOnIcon();
    const iconVolOff = makeVolumeOffIcon();
    const soundBtn = el("button", { type: "button", id: "sound-toggle", className: "hud-icon-btn", "aria-label": "Sound" }, [iconVolOn, iconVolOff]);
    const fsBtn = el("button", { type: "button", id: "fs-toggle", className: "hud-icon-btn", "aria-label": "Fullscreen" }, [makeFullscreenIcon()]);

    const getExSvgMarkup = (ex) => ex.svg_markup || resolveSvgMarkup(catalog, ex.svg_key || ex.archetype, ex.eq_mode);
    const svgHolder = el("div", { id: "svg-holder" });
    setTrustedSvg(svgHolder, getExSvgMarkup(firstEx));
    const canvasTapArea = el("div", { id: "canvas-tap-area", className: "workout-svg-canvas" }, [svgHolder]);
    const phaseCueEl = el("div", { id: "phase-cue", className: "phase-cue-float", textContent: firstEx.cue_work });
    const repReadoutEl = el("div", { id: "rep-readout", className: "rep-readout", textContent: `0/${firstEx.reps}${firstEx.is_hold ? "s" : ""}` });
    const extendRestBtn = el("button", { type: "button", id: "extend-rest-btn", className: "hud-icon-btn", style: { display: "none" }, "aria-label": "Add 15 seconds rest", textContent: "+15s" });
    const skipBtn = el("button", { type: "button", id: "skip-btn", className: "hud-icon-btn", style: { display: "none" }, "aria-label": "Skip rest or countdown", textContent: "\u23ed" });
    const primaryBtn = el("button", { type: "button", id: "primary-btn", className: "btn-primary", textContent: "\u25b6 Start" });
    const progressFillEl = el("div", { id: "set-progress-fill", className: "edge-progress-fill" });

    const stageEl = el("div", { id: "coach-stage" }, [
      el("header", { className: "workout-hud-top" }, [
        el("div", { className: "hud-title-cluster" }, [exitBtn, stepProgressEl, el("div", { style: { minWidth: "0" } }, [titleEl, howToEl]), weightEl]),
        el("div", { className: "hud-actions" }, [speedSelect, restSelect, soundSelect, soundBtn, fsBtn]),
      ]),
      canvasTapArea, phaseCueEl,
      el("footer", { className: "workout-hud-bottom" }, [repReadoutEl, el("div", { className: "coach-controls" }, [extendRestBtn, skipBtn, primaryBtn])]),
      el("div", { className: "edge-progress" }, [progressFillEl]),
    ]);

    const makeChoiceTile = (val, delta, word, isMore) => el("button",
      { type: "button", name: "next_intensity_choice", value: val, className: "finish-tile" + (isMore ? " finish-tile-more" : "") },
      [el("span", { className: "finish-delta", textContent: delta }), el("span", { className: "finish-word", textContent: word })]);
    const lessBtn = makeChoiceTile("less", "\u221210%", "Easier", false);
    const keepBtn = makeChoiceTile("keep", "=", "Same", false);
    const moreBtn = makeChoiceTile("more", "+10%", "Harder", true);
    const saveSingleBtn = el("button", { type: "button", id: "finish-save-btn", value: "keep", className: "btn-primary", style: { marginTop: "1.4rem" }, textContent: "Save Completed Workout \u2713" });
    const finishControls = isAdHoc || wasSubstituted ? saveSingleBtn : el("div", { className: "finish-grid" }, [lessBtn, keepBtn, moreBtn]);

    const finishScreenEl = el("div", { id: "finish-form", className: "finish-screen", style: { display: "none" } }, [
      el("div", { className: "finish-check", textContent: "\u2713" }),
      el("h2", { className: "stage-title", textContent: routine.name }),
      el("div", { className: "muted", style: { marginTop: "0.45rem" }, textContent: `${playlist.length} exercises completed` }),
      finishControls,
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
      const canSkipWait = nextState === "COUNTDOWN" || nextState === "REST";
      skipBtn.style.display = canSkipWait ? "inline-flex" : "none";
      extendRestBtn.style.display = nextState === "REST" ? "inline-flex" : "none";
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

      activeRestTarget = configuredRestSeconds;
      setState("REST");
      phaseElapsed = 0;
      lastCountdownInt = null;
      loadStagePreview();
      sound.beginPhase("REST", { restSeconds: activeRestTarget });
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
        const restRem = Math.max(0, Math.ceil(activeRestTarget - phaseElapsed));
        if (phaseElapsed >= 0.4 && repReadoutEl.textContent !== `${restRem}s`) repReadoutEl.textContent = `${restRem}s`;
        progressFillEl.style.width = `${Math.max(0, ((activeRestTarget - phaseElapsed) / activeRestTarget) * 100).toFixed(1)}%`;
        setCueText(restRem <= 3 && restRem > 0 ? String(restRem) : `Rest \u00b7 ${currentEx().name}`);
        applyNeutralBreath(phaseElapsed);
        if (restRem <= 3 && restRem >= 1 && restRem !== lastCountdownInt) { lastCountdownInt = restRem; sound.countdown(restRem); }
        if (phaseElapsed >= activeRestTarget) beginActiveSet();
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

    function skipWaitPhase() {
      if (state !== "REST" && state !== "COUNTDOWN") return;
      sound.ensureAudio();
      if (paused) { sound.stopAll(); paused = false; sound.resume(); }
      primaryBtn.textContent = "\u23f8";
      beginActiveSet();
    }

    scope.on(primaryBtn, "click", togglePlayPause);
    scope.on(canvasTapArea, "click", togglePlayPause);
    scope.on(skipBtn, "click", skipWaitPhase);
    scope.on(extendRestBtn, "click", () => {
      if (state !== "REST") return;
      activeRestTarget = Math.min(300, activeRestTarget + 15);
      lastCountdownInt = null;
      if (typeof sound.retimePhase === "function") {
        sound.retimePhase({ restSeconds: activeRestTarget });
      }
      const restRem = Math.max(0, Math.ceil(activeRestTarget - phaseElapsed));
      repReadoutEl.textContent = `${restRem}s`;
    });

    scope.on(speedSelect, "change", () => {
      currentSpeedMode = store.setWorkoutTiming({ speed_mode: speedSelect.value }).speed_mode;
      const activeEx = currentEx();
      const oldRepSec = activeEx.rep_seconds;
      for (const item of playlist) {
        item.rep_seconds = domain.resolveEffectiveRepSeconds({ rep_seconds: item.base_rep_seconds || item.rep_seconds, is_hold: item.is_hold }, currentSpeedMode);
      }
      if (state === "ACTIVE" && !activeEx.is_hold && oldRepSec > 0) {
        phaseElapsed = (phaseElapsed / oldRepSec) * activeEx.rep_seconds;
        if (typeof sound.retimePhase === "function") sound.retimePhase({ repSeconds: activeEx.rep_seconds }, phaseElapsed);
      }
      speedSelect.blur();
    });

    scope.on(restSelect, "change", () => {
      configuredRestSeconds = store.setWorkoutTiming({ rest_seconds: Number(restSelect.value) }).rest_seconds;
      if (state === "REST") {
        activeRestTarget = Math.max(Math.ceil(phaseElapsed) + 1, configuredRestSeconds);
        if (typeof sound.retimePhase === "function") sound.retimePhase({ restSeconds: activeRestTarget });
      }
      restSelect.blur();
    });

    scope.on(soundSelect, "change", () => {
      store.setSoundTheme(sound.setTheme(soundSelect.value));
      sound.ensureAudio();
      syncSoundUi();
      soundSelect.blur();
    });
    for (const sel of [speedSelect, restSelect, soundSelect]) {
      scope.on(sel, "keydown", (e) => { if (e.code === "Space") e.stopPropagation(); });
    }

    scope.on(soundBtn, "click", () => {
      store.setSoundTheme(sound.toggleMute());
      sound.ensureAudio();
      syncSoundUi();
    });
    scope.on(fsBtn, "click", () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
      else if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    });

    scope.on(exitBtn, "click", () => {
      if (state === "IDLE" || state === "FINISHED") { navigateTo(exitHref); return; }
      const wasRunning = !paused;
      if (wasRunning) togglePlayPause();
      openModal((mScope) => {
        const stayBtn = el("button", { type: "button", id: "exit-cancel-btn", className: "btn-ghost", textContent: "Keep Training" });
        const leaveBtn = el("button", { type: "button", id: "exit-confirm-btn", className: "btn-primary", textContent: "Abandon Workout" });
        mScope.on(stayBtn, "click", () => { closeModal(); if (wasRunning && paused) togglePlayPause(); });
        mScope.on(leaveBtn, "click", () => { closeModal(); navigateTo(exitHref); });
        return el("div", { className: "modal-card is-error", role: "dialog", "aria-modal": "true" }, [
          el("h2", { className: "modal-title", textContent: "Abandon Workout?" }),
          el("div", { className: "muted", textContent: "Workouts must be completed in full to count toward your weekly schedule and history." }),
          el("div", { className: "modal-actions" }, [stayBtn, leaveBtn]),
        ]);
      });
    });

    function commitFinishedWorkout(choice) {
      onCompleteLog(store.completeWorkout(routine.id, {
        next_intensity_choice: choice, duration_minutes: durationMinutes,
        speed_mode: currentSpeedMode, rest_seconds: configuredRestSeconds, playlist,
      }));
      navigateTo("#plan");
    }

    for (const btn of [lessBtn, keepBtn, moreBtn, saveSingleBtn]) {
      scope.on(btn, "click", () => commitFinishedWorkout(btn.value));
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
      else if (e.code === "ArrowRight") skipWaitPhase();
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
