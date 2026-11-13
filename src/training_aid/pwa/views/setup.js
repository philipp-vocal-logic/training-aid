/* Screen 1: Setup & Cross-Device Portability (#setup) */
(function () {
  "use strict";

  const root =
    typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this;

  const SETUP_PRESCRIPTIONS = {
    light: "2 sets · \u221220% load",
    moderate: "3 sets · Base load",
    intense: "4 sets · +20% load",
  };
  const SETUP_SPEEDS = { light: 0.36, moderate: 0.39, intense: 0.42 };

  const getDom = () => root.TrainingDom || (typeof require === "function" ? require("../dom.js") : null);
  const getQr = () => root.TrainingQR || (typeof require === "function" ? require("../qr.js") : null);

  function renderSetupView(ctx) {
    const dom = getDom();
    const { el, setTrustedSvg, resolveSvgMarkup, bindPreviewLoop } = dom;
    const scope = (ctx && ctx.scope) || dom.createViewScope();
    const { store, catalog, sound } = ctx;
    const navigateTo = ctx.navigateTo || ((h) => { if (typeof window !== "undefined") window.location.hash = h; });
    const syncTopbar = ctx.syncTopbar || (() => {});

    document.title = "Setup";
    syncTopbar("setup", false);

    const state = store.getState();
    const profile = (state && state.profile) || null;
    const curName = (profile && profile.name) || "";
    const curEq = (profile && profile.equipment) || "body_only";
    const curInt = (profile && profile.starting_intensity) || "moderate";
    let curDays = profile && profile.weekly_goal ? Number(profile.weekly_goal) : 3;
    if (curDays !== 2 && curDays !== 3 && curDays !== 4) curDays = 3;

    const programsCfg = (catalog && catalog.programs) || {};
    const eqArchMap = programsCfg.equipment_archetypes || {
      body_only: "squat", dumbbells: "curl", kettlebell_bands: "hinge", full_gym: "bench_press",
    };
    const eqPropMap = programsCfg.setup_equipment_props || {
      body_only: "body_only", dumbbells: "dumbbell", kettlebell_bands: "bands", full_gym: "barbell",
    };

    function getSetupSvgMarkup(eqKey) {
      const arch = eqArchMap[eqKey] || "squat";
      const eqMode = String(eqPropMap[eqKey] || "body_only").replace(/\s+/g, "_");
      return resolveSvgMarkup(catalog, arch, eqMode);
    }

    const prescriptionPill = el("span", {
      className: "pill", id: "setup-prescription-pill",
      textContent: SETUP_PRESCRIPTIONS[curInt] || SETUP_PRESCRIPTIONS.moderate,
    });
    const svgWrap = el("div", { id: "setup-svg-wrap", className: "stage-svg-wrap" });
    setTrustedSvg(svgWrap, getSetupSvgMarkup(curEq));

    const stageSection = el("section", { className: "graphic-stage", "aria-label": "Exercise preview" }, [
      el("div", { className: "stage-hud-top" }, [
        el("div", { style: { display: "flex", alignItems: "center", gap: "0.45rem" } }, [
          el("span", { className: "pill pill-brand", textContent: "Setup" }),
          prescriptionPill,
        ]),
      ]),
      svgWrap,
    ]);

    const nameInput = el("input", {
      type: "text", name: "name", className: "minimal-input",
      value: curName, placeholder: "Name", required: true, maxlength: "50",
    });

    function makeRadioTile(groupName, val, labelText, isChecked) {
      const radio = el("input", { type: "radio", name: groupName, value: val, checked: isChecked });
      return { input: radio, label: el("label", { className: "tile-option" }, [radio, el("span", { textContent: labelText })]) };
    }

    const eqTiles = [
      makeRadioTile("equipment", "body_only", "Body Only", curEq === "body_only"),
      makeRadioTile("equipment", "dumbbells", "Dumbbells", curEq === "dumbbells"),
      makeRadioTile("equipment", "kettlebell_bands", "KB · Bands", curEq === "kettlebell_bands"),
      makeRadioTile("equipment", "full_gym", "Full Gym", curEq === "full_gym"),
    ];
    const intTiles = [
      makeRadioTile("starting_intensity", "light", "Easy", curInt === "light"),
      makeRadioTile("starting_intensity", "moderate", "Moderate", curInt === "moderate"),
      makeRadioTile("starting_intensity", "intense", "Intense", curInt === "intense"),
    ];
    const dayTiles = [
      makeRadioTile("days_per_week", "2", "2\u00d7", curDays === 2),
      makeRadioTile("days_per_week", "3", "3\u00d7", curDays === 3),
      makeRadioTile("days_per_week", "4", "4\u00d7", curDays === 4),
    ];

    const setupForm = el("form", { className: "setup-form" }, [
      el("label", { className: "field-group" }, [el("span", { className: "field-label", textContent: "Name" }), nameInput]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", textContent: "Equipment" }),
        el("div", { className: "tile-grid-2" }, eqTiles.map((t) => t.label)),
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", textContent: "Intensity" }),
        el("div", { className: "tile-grid-3" }, intTiles.map((t) => t.label)),
      ]),
      el("div", { className: "field-group" }, [
        el("span", { className: "field-label", textContent: "Weekly" }),
        el("div", { className: "tile-grid-3" }, dayTiles.map((t) => t.label)),
      ]),
      el("button", {
        type: "submit", className: "btn-primary",
        style: { marginTop: "0.35rem", width: "100%" }, textContent: "Start \u2192",
      }),
    ]);

    const hasPlan = store.hasActivePlan();
    const shareBtn = el("button", {
      type: "button", id: "share-plan-btn", className: "btn-ghost btn-compact",
      disabled: !hasPlan, textContent: "Share Plan / QR",
    });
    const qrFrame = el("div", { id: "share-qr-wrap", className: "qr-frame" });
    const shareUrlInput = el("input", {
      type: "text", id: "share-url-input", className: "minimal-input share-url-input",
      readOnly: true, "aria-label": "Shareable plan URL",
    });
    const copyLinkBtn = el("button", {
      type: "button", id: "copy-share-link-btn", className: "btn-ghost btn-compact", textContent: "Copy Link",
    });
    const openTabLink = el("a", {
      id: "open-tab-link", className: "share-tab-link", href: "#plan",
      target: "_blank", rel: "noopener", textContent: "Open Tab Link",
    });
    const sharePanel = el("div", { id: "share-result-panel", className: "share-panel", hidden: true }, [
      qrFrame,
      el("div", { className: "share-url-row" }, [shareUrlInput, copyLinkBtn]),
      el("div", { className: "share-hint" }, [
        openTabLink,
        " — Scan the QR code on another device, copy the link, or open this tab link to hand off via Chrome / Safari synced tabs.",
      ]),
    ]);

    const includeLogsCheckbox = el("input", { type: "checkbox", id: "backup-include-logs", checked: true });
    const exportJsonBtn = el("button", {
      type: "button", id: "export-json-btn", className: "btn-ghost btn-compact",
      disabled: !hasPlan, textContent: "Export .json",
    });
    const shareCloudBtn = dom.canShareJsonFile()
      ? el("button", {
          type: "button", id: "share-json-file-btn", className: "btn-ghost btn-compact",
          disabled: !hasPlan, textContent: "Save to Cloud",
        })
      : null;
    const importFileInput = el("input", {
      type: "file", id: "import-json-input", className: "file-input-hidden", accept: ".json,application/json",
    });
    const importFileLabel = el(
      "label",
      { className: "btn-ghost btn-compact file-btn-label", tabindex: "0", role: "button" },
      [el("span", { textContent: "Import .json" }), importFileInput]
    );

    const backupButtons = [exportJsonBtn, ...(shareCloudBtn ? [shareCloudBtn] : []), importFileLabel];
    const portabilityStatus = el("span", { id: "portability-status", className: "pill pill-brand", hidden: true });

    const portabilityCard = el("section", { className: "portability-card", "aria-label": "Portability and Cross-Device Backup" }, [
      el("div", { className: "portability-head" }, [
        el("span", { className: "field-label", textContent: "Portability & Backup" }),
        portabilityStatus,
      ]),
      el("div", { className: "portability-block" }, [
        el("div", { className: "portability-actions" }, [
          shareBtn,
          !hasPlan ? el("span", { className: "muted", style: { fontSize: "0.76rem" }, textContent: "Create or import a plan to share" }) : null,
        ]),
        sharePanel,
      ]),
      el("hr", { className: "portability-divider" }),
      el("div", { className: "portability-block" }, [
        el("label", { className: "checkbox-row" }, [includeLogsCheckbox, el("span", { textContent: "Include workout history" })]),
        el("div", { className: "portability-actions" }, backupButtons),
      ]),
    ]);

    document.getElementById("app-root").replaceChildren(
      el("main", { className: "split-screen" }, [stageSection, el("section", { className: "side-pane" }, [setupForm, portabilityCard])])
    );

    let speed = SETUP_SPEEDS[curInt] || SETUP_SPEEDS.moderate;
    const previewLoop = bindPreviewLoop(scope, svgWrap, () => ({ speed, tempoMode: "standard" }));

    function setPortabilityFeedback(msg) {
      portabilityStatus.textContent = msg;
      portabilityStatus.hidden = false;
      dom.showToast(msg);
    }

    for (const tile of eqTiles) {
      scope.on(tile.input, "change", () => {
        if (!tile.input.checked) return;
        setTrustedSvg(svgWrap, getSetupSvgMarkup(tile.input.value));
        previewLoop.rebind(svgWrap);
      });
    }
    for (const tile of intTiles) {
      scope.on(tile.input, "change", () => {
        if (!tile.input.checked) return;
        const v = tile.input.value;
        speed = SETUP_SPEEDS[v] || SETUP_SPEEDS.moderate;
        prescriptionPill.textContent = SETUP_PRESCRIPTIONS[v] || SETUP_PRESCRIPTIONS.moderate;
      });
    }

    scope.on(setupForm, "submit", (e) => {
      e.preventDefault();
      let chosenEq = "body_only";
      for (const t of eqTiles) if (t.input.checked) chosenEq = t.input.value;
      let chosenInt = "moderate";
      for (const t of intTiles) if (t.input.checked) chosenInt = t.input.value;
      let chosenDays = 3;
      for (const t of dayTiles) if (t.input.checked) chosenDays = Number(t.input.value);

      store.setupPlan({
        name: nameInput.value.trim() || "Athlete",
        equipment: chosenEq,
        starting_intensity: chosenInt,
        days_per_week: chosenDays,
        sound_theme: store.getSoundTheme(),
      });
      navigateTo("#plan");
    });

    scope.on(shareBtn, "click", () => {
      if (!store.hasActivePlan()) return;
      Promise.resolve(store.encodeShareFragment())
        .then((fragment) => {
          if (scope.isDisposed()) return;
          const shareUrl = dom.buildShareUrl(fragment);
          shareUrlInput.value = shareUrl;
          openTabLink.setAttribute("href", shareUrl);
          const qr = getQr();
          if (qr && typeof qr.renderSvg === "function") {
            setTrustedSvg(qrFrame, qr.renderSvg(shareUrl, { margin: 2 }));
          }
          sharePanel.hidden = false;
        })
        .catch(() => dom.showToast("Could not encode share link"));
    });

    scope.on(shareUrlInput, "click", () => shareUrlInput.select());
    scope.on(copyLinkBtn, "click", () => {
      const urlText = shareUrlInput.value;
      if (!urlText) return;
      dom.copyTextToClipboard(urlText)
        .then(() => setPortabilityFeedback("Link copied"))
        .catch(() => {
          shareUrlInput.select();
          setPortabilityFeedback("Link copied");
        });
    });

    const buildBackupFilename = () => `training-aid-backup-${new Date().toISOString().slice(0, 10)}.json`;

    scope.on(exportJsonBtn, "click", () => {
      if (!store.hasActivePlan()) return;
      const jsonText = store.exportBackupJson({ includeLogs: includeLogsCheckbox.checked });
      const blobUrl = URL.createObjectURL(new Blob([jsonText], { type: "application/json" }));
      const dl = el("a", { href: blobUrl, download: buildBackupFilename() });
      document.body.appendChild(dl);
      dl.click();
      document.body.removeChild(dl);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
      setPortabilityFeedback("Backup exported");
    });

    if (shareCloudBtn) {
      scope.on(shareCloudBtn, "click", () => {
        if (!store.hasActivePlan()) return;
        const jsonText = store.exportBackupJson({ includeLogs: includeLogsCheckbox.checked });
        const file = new File([jsonText], buildBackupFilename(), { type: "application/json" });
        navigator.share({ files: [file], title: "Training Aid Backup" })
          .then(() => setPortabilityFeedback("Backup shared"))
          .catch(() => {});
      });
    }

    scope.on(importFileLabel, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        importFileInput.click();
      }
    });

    scope.on(importFileInput, "change", () => {
      const file = importFileInput.files && importFileInput.files[0];
      if (!file) return;
      file.text()
        .then((jsonText) => {
          importFileInput.value = "";
          promptJsonBackupImport(jsonText);
        })
        .catch(() => {
          importFileInput.value = "";
          dom.showToast("Could not read backup file");
        });
    });

    function promptJsonBackupImport(jsonText) {
      let parsed;
      try {
        parsed = JSON.parse(jsonText);
        if (!parsed || typeof parsed !== "object" || parsed.schema_version !== 1) {
          throw new Error("Unsupported backup format");
        }
      } catch {
        dom.openModal((mScope) => {
          const dismissBtn = el("button", { type: "button", className: "btn-ghost", textContent: "Dismiss" });
          mScope.on(dismissBtn, "click", dom.closeModal);
          return el("div", { className: "modal-card is-error", role: "dialog", "aria-modal": "true" }, [
            el("h2", { className: "modal-title", textContent: "Invalid Backup File" }),
            el("div", { className: "muted", textContent: "Please choose a valid Training Aid .json backup file (schema v1)." }),
            el("div", { className: "modal-actions" }, [dismissBtn]),
          ]);
        });
        return;
      }

      const incomingName = parsed.profile && typeof parsed.profile.name === "string"
        ? parsed.profile.name.trim().slice(0, 50) || "Athlete" : "Athlete";
      const incomingPlan = parsed.plan && typeof parsed.plan.name === "string"
        ? parsed.plan.name.trim().slice(0, 80) || "Training Plan" : "Training Plan";
      const routineCount = parsed.plan && Array.isArray(parsed.plan.routines) ? parsed.plan.routines.length : 0;
      const logCount = Array.isArray(parsed.logs) ? parsed.logs.length : 0;

      dom.openModal((mScope) => {
        const cancelBtn = el("button", { type: "button", className: "btn-ghost", textContent: "Cancel" });
        const mergeBtn = el("button", { type: "button", className: "btn-ghost", textContent: "Import & Merge History" });
        const replaceBtn = el("button", {
          type: "button", className: "btn-primary",
          textContent: store.hasActivePlan() ? "Replace Local Data" : "Import Backup",
        });

        function runImport(mergeLogs) {
          try {
            const res = store.importBackupJson(jsonText, { mergeLogs, keepExistingLogs: mergeLogs });
            if (res && typeof res.apply === "function") {
              res.apply({ keepExistingLogs: mergeLogs, mergeLogs });
            }
            if (sound && typeof sound.setTheme === "function") sound.setTheme(store.getSoundTheme());
            dom.closeModal();
            dom.showToast("Backup imported");
            navigateTo("#plan");
          } catch (err) {
            dom.closeModal();
            dom.showToast(err && err.message ? err.message : "Backup validation failed");
          }
        }

        mScope.on(cancelBtn, "click", dom.closeModal);
        mScope.on(mergeBtn, "click", () => runImport(true));
        mScope.on(replaceBtn, "click", () => runImport(false));

        const actionBtns = [cancelBtn, ...(store.hasActivePlan() ? [mergeBtn] : []), replaceBtn];
        return el("div", { className: "modal-card", role: "dialog", "aria-modal": "true" }, [
          el("div", { className: "modal-stats" }, [
            el("span", { className: "pill pill-brand", textContent: "Backup Restore" }),
            el("span", { className: "pill", textContent: `${routineCount} days` }),
            el("span", { className: "pill", textContent: `${logCount} workouts` }),
          ]),
          el("h2", { className: "modal-title", textContent: incomingPlan }),
          el("div", {
            className: "muted",
            textContent: `Athlete: ${incomingName}` + (store.hasActivePlan() ? " — Confirm before replacing local plan data." : ""),
          }),
          el("div", { className: "modal-actions" }, actionBtns),
        ]);
      });
    }

    return scope;
  }

  renderSetupView.render = renderSetupView;
  root.TrainingViews = root.TrainingViews || {};
  root.TrainingViews.setup = renderSetupView;
  if (typeof module !== "undefined" && module.exports) module.exports = renderSetupView;
})();
