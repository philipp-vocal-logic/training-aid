/* Screen 4: Full-Screen Active Workout — Strict Completion, Live Tempo & Configurable Rest (#workout/<id>) */
import {
  REST_PRESETS,
  SOUND_THEMES,
  SPEED_LABELS,
  VALID_SPEED_MODES,
  formatPageTitle,
  formatRestLabel,
} from "../core/constants.js";
import { createWorkoutSession } from "../core/workout-engine.js";
import { bindSvg, prefersReducedMotion, tempoCurve, turnaroundForMode } from "../rig/motion.js";
import { el, makeTuneIcon, makeVolumeOffIcon, makeVolumeOnIcon, resolveSvgMarkup, setTrustedSvg } from "../ui/dom.js";
import { closeModal, openModal } from "../ui/modal.js";
import { createViewScope } from "../ui/scope.js";
import { createWakeLock } from "../ui/wake-lock.js";

const EVENT_AUDIO_MAP = {
  startSignal: "startSignal",
  midRep: "midRep",
  stopSet: "stopSet",
  workoutComplete: "workoutComplete",
  pauseAudio: "pause",
  resumeAudio: "resume",
  stopAllAudio: "stopAll",
};

export function renderWorkoutView(ctx) {
  const scope = (ctx && ctx.scope) || createViewScope();
  const { store, catalog, sound } = ctx;
  const targetId = ctx.param || ctx.routineId || ctx.id;
  const isAdHoc = String(targetId) === "adhoc";
  const navigateTo = ctx.navigateTo || ((h) => { if (typeof window !== "undefined") window.location.hash = h; });
  const syncTopbar = ctx.syncTopbar || (() => {});
  const onCompleteLog = ctx.onCompleteLog || (() => {});

  const routine = store.getRoutine(targetId);
  if (!routine) return scope;

  document.title = formatPageTitle(routine.name);
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
          el("h1", { className: "stage-title", textContent: routine.name }),
          el("a", { href: editHref, className: "btn-primary", textContent: "+ Add Exercises" }),
        ]),
      ])
    );
    return scope;
  }

  sound.setTheme(store.getSoundTheme());
  const firstEx = playlist[0];
  const wasSubstituted = !isAdHoc && playlist.some((p) => p.is_substituted || p.was_routine_substituted);
  const initialTiming = store.getWorkoutTiming();

  const session = createWorkoutSession({
    playlist,
    speedMode: initialTiming.speed_mode || "normal",
    restSeconds: Number(initialTiming.rest_seconds) || 30,
    turnaroundForMode,
  });
  const initSnap = session.getSnapshot();

  const exitBtn = el("button", { type: "button", id: "exit-workout-btn", className: "hud-icon-btn", "aria-label": "Exit", textContent: "\u2715" });
  const stepProgressEl = el("span", { id: "step-progress", className: "pill", textContent: initSnap.stepLabel });
  const titleEl = el("h1", { id: "ex-title", className: "hud-ex-title", textContent: firstEx.name });
  const howToEl = el("div", { id: "ex-how-to", className: "muted text-xs truncate", textContent: firstEx.how_to || "" });
  const weightEl = el("span", { id: "ex-weight", className: "pill pill-brand", style: { display: firstEx.weight_label ? "inline-flex" : "none" }, textContent: firstEx.weight_label || "" });

  const speedSelect = el("select", { id: "speed-mode-select", className: "hud-select workout-tune-select", "aria-label": "Speed" },
    VALID_SPEED_MODES.map((m) => el("option", { value: m, selected: m === initSnap.speedMode, textContent: SPEED_LABELS[m] || m })));
  speedSelect.value = initSnap.speedMode;
  const restChoices = REST_PRESETS.includes(initSnap.configuredRestSeconds)
    ? REST_PRESETS
    : [...REST_PRESETS, initSnap.configuredRestSeconds].sort((a, b) => a - b);
  const restSelect = el("select", { id: "rest-seconds-select", className: "hud-select workout-tune-select", "aria-label": "Rest" },
    restChoices.map((sec) => el("option", { value: String(sec), selected: sec === initSnap.configuredRestSeconds, textContent: formatRestLabel(sec) })));
  restSelect.value = String(initSnap.configuredRestSeconds);
  const soundSelect = el("select", { id: "sound-theme-select", className: "hud-select workout-tune-select", "aria-label": "Sound" },
    SOUND_THEMES.map((opt) => el("option", { value: opt.id, textContent: opt.label })));
  const tuneBtn = el("button", { type: "button", id: "workout-tune-btn", className: "hud-icon-btn", "aria-label": "Workout settings" }, [makeTuneIcon()]);
  const iconVolOn = makeVolumeOnIcon();
  const iconVolOff = makeVolumeOffIcon();
  const soundBtn = el("button", { type: "button", id: "sound-toggle", className: "hud-icon-btn", "aria-label": "Sound" }, [iconVolOn, iconVolOff]);

  const getExSvgMarkup = (ex) => ex.svg_markup || resolveSvgMarkup(catalog, ex.svg_key || ex.archetype, ex.eq_mode);
  const svgHolder = el("div", { id: "svg-holder" });
  setTrustedSvg(svgHolder, getExSvgMarkup(firstEx));
  const canvasTapArea = el("div", { id: "canvas-tap-area", className: "workout-svg-canvas" }, [svgHolder]);
  const phaseCueEl = el("div", { id: "phase-cue", className: "phase-cue-float", textContent: initSnap.cueText });
  const repReadoutEl = el("div", { id: "rep-readout", className: "rep-readout", textContent: initSnap.readoutText });
  const extendRestBtn = el("button", { type: "button", id: "extend-rest-btn", className: "hud-icon-btn", style: { display: "none" }, "aria-label": "Add 15 seconds rest", textContent: "+15s" });
  const skipBtn = el("button", { type: "button", id: "skip-btn", className: "hud-icon-btn", style: { display: "none" }, "aria-label": "Skip rest or countdown", textContent: "\u23ed" });
  const primaryBtn = el("button", { type: "button", id: "primary-btn", className: "btn-primary", textContent: "\u25b6 Start" });
  const progressFillEl = el("div", { id: "set-progress-fill", className: "edge-progress-fill" });

  const stageEl = el("div", { id: "coach-stage" }, [
    el("header", { className: "workout-hud-top" }, [
      el("div", { className: "hud-title-cluster" }, [exitBtn, stepProgressEl, el("div", { className: "min-w-0" }, [titleEl, howToEl]), weightEl]),
      el("div", { className: "hud-actions" }, [tuneBtn, soundBtn]),
    ]),
    canvasTapArea,
    phaseCueEl,
    el("footer", { className: "workout-hud-bottom" }, [repReadoutEl, el("div", { className: "coach-controls" }, [extendRestBtn, skipBtn, primaryBtn])]),
    el("div", { className: "edge-progress" }, [progressFillEl]),
  ]);

  const makeChoiceTile = (val, delta, word, isMore) =>
    el("button", { type: "button", name: "next_intensity_choice", value: val, className: "finish-tile" + (isMore ? " finish-tile-more" : "") }, [
      el("span", { className: "finish-delta", textContent: delta }),
      el("span", { className: "finish-word", textContent: word }),
    ]);
  const [lessBtn, keepBtn, moreBtn] = [makeChoiceTile("less", "\u221210%", "Easier", false), makeChoiceTile("keep", "=", "Same", false), makeChoiceTile("more", "+10%", "Harder", true)];
  const saveSingleBtn = el("button", { type: "button", id: "finish-save-btn", value: "keep", className: "btn-primary", textContent: "Save Completed Workout \u2713" });
  const finishControls = isAdHoc || wasSubstituted ? saveSingleBtn : el("div", { className: "finish-grid" }, [lessBtn, keepBtn, moreBtn]);

  const finishScreenEl = el("div", { id: "finish-form", className: "finish-screen", style: { display: "none" } }, [
    el("div", { className: "finish-check", textContent: "\u2713" }),
    el("h2", { className: "stage-title", textContent: routine.name }),
    el("div", { className: "muted", textContent: `${playlist.length} exercises completed` }),
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

  let rig = bindSvg(svgHolder.querySelector("svg"));
  let boundExIdx = 0, lastDiscretePoseKey = null, lastFrameTs = null, rafId = null, durationMinutes = 25;
  const sessionStartMs = Date.now();

  const durationInterval = scope.addInterval(() => {
    if (session.getSnapshot().state === "FINISHED") { scope.clearTrackedInterval(durationInterval); return; }
    const mins = Math.floor((Date.now() - sessionStartMs) / 60000);
    if (mins >= 1) durationMinutes = mins;
  }, 10000);

  function popCounter() {
    if (prefersReducedMotion()) return;
    repReadoutEl.classList.add("pop");
    scope.addTimeout(() => repReadoutEl.classList.remove("pop"), 140);
  }

  function applyPose(pose) {
    if (!rig || !pose || pose.kind === "none") return;
    if (pose.kind === "breath") {
      if (prefersReducedMotion()) {
        if (lastDiscretePoseKey !== "neutral") { lastDiscretePoseKey = "neutral"; rig.applyPose(0); }
      } else { lastDiscretePoseKey = null; rig.applyRestBreath(pose.phaseSec || 0); }
    } else if (pose.kind === "hold") {
      if (prefersReducedMotion()) {
        if (lastDiscretePoseKey !== "hold") { lastDiscretePoseKey = "hold"; rig.applyPose(1, { swapSides: false }); }
      } else { lastDiscretePoseKey = null; rig.applyHold(pose.phaseSec || 0); }
    } else if (pose.kind === "rep") {
      const poseOpts = { swapSides: Boolean(pose.swapSides) };
      const mode = pose.mode || rig.tempoMode || "standard";
      if (prefersReducedMotion()) {
        const discreteT = pose.isWorkPhase ? 1 : 0;
        const poseKey = `${pose.repIndex || 0}:${discreteT}:${poseOpts.swapSides ? "1" : "0"}`;
        if (poseKey !== lastDiscretePoseKey) { lastDiscretePoseKey = poseKey; rig.applyPose(discreteT, poseOpts); }
      } else { lastDiscretePoseKey = null; rig.applyPose(tempoCurve(pose.frac || 0, mode), poseOpts); }
    }
  }

  function bindExerciseSvg(ex, exIdx) {
    if (!ex) return;
    boundExIdx = exIdx;
    setTrustedSvg(svgHolder, getExSvgMarkup(ex));
    rig = bindSvg(svgHolder.querySelector("svg"));
    lastDiscretePoseKey = null;
  }

  function dispatchEvents(events, snapshot) {
    if (!Array.isArray(events)) return;
    for (const ev of events) {
      if (!ev || !ev.type) continue;
      const mapped = EVENT_AUDIO_MAP[ev.type];
      if (mapped && typeof sound[mapped] === "function") sound[mapped]();
      else if (ev.type === "exerciseChanged") bindExerciseSvg(snapshot.currentExercise, snapshot.exIdx);
      else if (ev.type === "beginPhase") sound.beginPhase(ev.phase || ev.state || snapshot.state, ev.params || ev.options || ev);
      else if (ev.type === "retimePhase" && typeof sound.retimePhase === "function") {
        sound.retimePhase(ev.params || ev.options || ev, ev.phaseElapsed ?? ev.elapsed);
      } else if (ev.type === "countdown") sound.countdown(ev.remaining ?? ev.seconds ?? ev.value ?? ev.count);
      else if (ev.type === "repDone") sound.repDone(ev.rep ?? ev.completed, ev.total ?? ev.reps);
      else if (ev.type === "holdTick") sound.holdTick(ev.remaining ?? ev.seconds ?? ev.value);
      else if (ev.type === "popCounter") popCounter();
    }
  }

  const wakeLock = createWakeLock(scope);
  const shouldHoldWakeLock = (s) => !s.paused && s.state !== "IDLE" && s.state !== "FINISHED" && !document.hidden;
  const shouldRunLoop = (s) => !s.paused && s.state !== "FINISHED" && !document.hidden && !(s.state === "IDLE" && prefersReducedMotion());
  const stopLoop = () => { if (rafId !== null) { scope.cancelFrame(rafId); rafId = null; } lastFrameTs = null; };
  const ensureLoop = () => {
    if (!shouldRunLoop(session.getSnapshot())) stopLoop();
    else if (rafId === null) { lastFrameTs = null; rafId = scope.requestFrame(tick); }
  };

  function syncSnapshot(snapshot) {
    if (snapshot.exIdx !== boundExIdx && snapshot.currentExercise) bindExerciseSvg(snapshot.currentExercise, snapshot.exIdx);
    const ex = snapshot.currentExercise || firstEx;
    viewportEl.dataset.state = snapshot.state;
    stepProgressEl.textContent = snapshot.stepLabel;
    titleEl.textContent = ex.name;
    howToEl.textContent = ex.how_to || "";
    weightEl.textContent = ex.weight_label || "";
    weightEl.style.display = ex.weight_label ? "inline-flex" : "none";
    if (phaseCueEl.textContent !== snapshot.cueText) phaseCueEl.textContent = snapshot.cueText;
    if (repReadoutEl.textContent !== snapshot.readoutText) repReadoutEl.textContent = snapshot.readoutText;
    progressFillEl.style.width = `${Number(snapshot.progressPct || 0).toFixed(1)}%`;
    skipBtn.style.display = snapshot.canSkipWait ? "inline-flex" : "none";
    extendRestBtn.style.display = snapshot.canExtendRest ? "inline-flex" : "none";
    if (snapshot.state === "IDLE") primaryBtn.textContent = "\u25b6 Start";
    else if (snapshot.state !== "FINISHED") primaryBtn.textContent = snapshot.paused ? "\u25b6" : "\u23f8";

    if (snapshot.state === "FINISHED") {
      stopLoop();
      scope.clearTrackedInterval(durationInterval);
      stageEl.style.display = "none";
      finishScreenEl.style.display = "flex";
    }
    applyPose(snapshot.pose);
    wakeLock.sync(shouldHoldWakeLock(snapshot));
    ensureLoop();
  }

  const applyResult = (res) => { if (res) { dispatchEvents(res.events, res.snapshot); syncSnapshot(res.snapshot); } };

  function tick(ts) {
    rafId = null;
    const snap = session.getSnapshot();
    if (!shouldRunLoop(snap)) { lastFrameTs = null; return; }
    const dt = lastFrameTs === null ? 0 : Math.min(0.1, (ts - lastFrameTs) / 1000);
    lastFrameTs = ts;
    if (snap.state === "IDLE") applyResult(session.advance(dt));
    else if (snap.state !== "FINISHED") applyResult(session.advance(sound.advancePhase(dt), { absolute: true }));
  }

  const togglePlayPause = () => { sound.ensureAudio(); applyResult(session.togglePlayPause()); };
  const skipWaitPhase = () => { if (session.getSnapshot().canSkipWait) { sound.ensureAudio(); applyResult(session.skipWait()); } };

  scope.on(primaryBtn, "click", togglePlayPause);
  scope.on(canvasTapArea, "click", togglePlayPause);
  scope.on(skipBtn, "click", skipWaitPhase);
  scope.on(extendRestBtn, "click", () => applyResult(session.extendRest(15)));

  scope.on(speedSelect, "change", () => {
    applyResult(session.setSpeedMode(store.setWorkoutTiming({ speed_mode: speedSelect.value }).speed_mode));
    speedSelect.blur();
  });
  scope.on(restSelect, "change", () => {
    applyResult(session.setRestSeconds(store.setWorkoutTiming({ rest_seconds: Number(restSelect.value) }).rest_seconds));
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

  scope.on(soundBtn, "click", () => { store.setSoundTheme(sound.toggleMute()); sound.ensureAudio(); syncSoundUi(); });
  scope.on(tuneBtn, "click", () => {
    const snap = session.getSnapshot();
    const wasRunning = snap.state !== "IDLE" && snap.state !== "FINISHED" && !snap.paused;
    if (wasRunning) togglePlayPause();
    const closeTuneModal = () => {
      closeModal();
      if (wasRunning && session.getSnapshot().paused) togglePlayPause();
    };
    openModal((mScope) => {
      const curSnap = session.getSnapshot();
      speedSelect.value = curSnap.speedMode;
      restSelect.value = String(curSnap.configuredRestSeconds);
      soundSelect.value = sound.getTheme();
      const doneBtn = el("button", { type: "button", id: "workout-tune-close-btn", className: "btn-primary", textContent: "Done" });
      mScope.on(doneBtn, "click", closeTuneModal);
      return el("div", { className: "modal-card", role: "dialog", "aria-modal": "true" }, [
        el("h2", { className: "modal-title", textContent: "Workout Settings" }),
        el("div", { className: "workout-tune-fields" }, [
          el("label", { className: "field-block" }, [
            el("span", { className: "field-label", textContent: "Speed" }),
            speedSelect,
          ]),
          el("label", { className: "field-block" }, [
            el("span", { className: "field-label", textContent: "Rest" }),
            restSelect,
          ]),
          el("label", { className: "field-block" }, [
            el("span", { className: "field-label", textContent: "Sound" }),
            soundSelect,
          ]),
        ]),
        el("div", { className: "modal-actions" }, [doneBtn]),
      ]);
    }, closeTuneModal);
  });

  scope.on(exitBtn, "click", () => {
    const snap = session.getSnapshot();
    if (snap.state === "IDLE" || snap.state === "FINISHED") { navigateTo(exitHref); return; }
    const wasRunning = !snap.paused;
    if (wasRunning) togglePlayPause();
    openModal((mScope) => {
      const stayBtn = el("button", { type: "button", id: "exit-cancel-btn", className: "btn-ghost", textContent: "Keep Training" });
      const leaveBtn = el("button", { type: "button", id: "exit-confirm-btn", className: "btn-primary", textContent: "Abandon Workout" });
      mScope.on(stayBtn, "click", () => { closeModal(); if (wasRunning && session.getSnapshot().paused) togglePlayPause(); });
      mScope.on(leaveBtn, "click", () => { closeModal(); navigateTo(exitHref); });
      return el("div", { className: "modal-card is-error", role: "dialog", "aria-modal": "true" }, [
        el("h2", { className: "modal-title", textContent: "Abandon Workout?" }),
        el("div", { className: "muted", textContent: "Workouts must be completed in full to count toward your weekly schedule and history." }),
        el("div", { className: "modal-actions" }, [stayBtn, leaveBtn]),
      ]);
    });
  });

  for (const btn of [lessBtn, keepBtn, moreBtn, saveSingleBtn]) {
    scope.on(btn, "click", () => {
      const snap = session.getSnapshot();
      onCompleteLog(store.completeWorkout(routine.id, {
        next_intensity_choice: btn.value,
        duration_minutes: durationMinutes,
        speed_mode: snap.speedMode,
        rest_seconds: snap.configuredRestSeconds,
        playlist: typeof session.getPlaylist === "function" ? session.getPlaylist() : playlist,
      }));
      navigateTo("#plan");
    });
  }

  scope.on(document, "visibilitychange", () => {
    const snap = session.getSnapshot();
    if (document.hidden) { wakeLock.release(); sound.pause(); stopLoop(); }
    else {
      if (!snap.paused && snap.state !== "IDLE" && snap.state !== "FINISHED") sound.resume();
      wakeLock.sync(shouldHoldWakeLock(snap));
      ensureLoop();
    }
  });
  const mql = typeof globalThis.matchMedia === "function" ? globalThis.matchMedia("(prefers-reduced-motion: reduce)") : null;
  scope.onMediaChange(mql, () => { lastDiscretePoseKey = null; syncSnapshot(session.getSnapshot()); });
  scope.on(window, "keydown", (e) => {
    if (e.target && e.target.tagName === "SELECT") return;
    if (e.code === "Space" && session.getSnapshot().state !== "FINISHED") { e.preventDefault(); togglePlayPause(); }
    else if (e.code === "ArrowRight") skipWaitPhase();
  });

  syncSnapshot(initSnap);
  return scope;
}
