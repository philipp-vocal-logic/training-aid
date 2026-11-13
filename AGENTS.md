# Training Aid — Agent & Swarm Rules

## 1. Architecture & File Map (Zero-Backend Static PWA)

Training Aid compiles static exercise catalogs and forward-kinematics SVGs via Python ≥3.13 into a self-contained offline PWA (`dist/`):

- `src/training_aid/{__init__.py,cli.py}` — CLI entrypoint (`training-aid`).
- `src/training_aid/compiler/{__init__.py,coaching.py,catalog_builder.py,bundler.py}` — `CatalogExercise` model, coaching metadata, `dist/data/catalog.json` (`schema_version = 2`, 876 exercises, 168 inline SVGs), 168 SVG thumbnails, and 1:1 `dist/` bundler with deterministic `sw.js` `APP_SHELL_ASSETS` + `CACHE_VERSION` stamping.
- `src/training_aid/kinematics/{__init__.py,registry.py,ik_compiler.py,fk_solver.py,svg_props.py,svg_renderer.py}` — Declarative `AnimationRegistry`, 2-link IK pose compiler, 2D FK solver, equipment prop geometry, and interactive/thumbnail SVG renderer.
- `src/training_aid/audit/{__init__.py,models.py,node_runner.py,bundle_security.py,catalog_checks.py,rig_checks.py}` — End-to-end catalog, kinematics, CSP/privacy, and Node ESM bundle audit (`training-aid-check`).
- `src/training_aid/pwa/` — Unified 1:1 client tree copied directly into `dist/`:
  - `{index.html,app.js,sw.js,manifest.webmanifest,icon.svg}` — Offline PWA shell, Service Worker template, and SPA router.
  - `core/{constants,prescription,catalog,generator,projections,stats,workout-engine}.js` — Pure zero-DOM domain logic, compatibility/substitution, and workout state machine.
  - `state/{codec,items,store}.js` — Schema v2 state validation and `localStorage` (`training_aid_state_v2`) store with unified routine/ad-hoc item CRUD.
  - `rig/motion.js` & `audio/{presets,pattern,synth,controller}.js` — 2D FK rig animator and 4-layer Web Audio synth engine.
  - `ui/{dom,scope,preview-loop,modal,progress-chart,widgets}.js`, `views/{setup,plan,quick,edit,workout,progress}.js`, `styles/{tokens,primitives,layout,workout,screens}.css` — Modular DOM primitives, screen views, and CSS.
- `tests/{test_app.py,test_e2e_catalog.py,test_sw_cache_stamp.py,check_motion_rig.mjs,pwa_*.test.mjs,helpers/dom_harness.mjs}` — Pytest and Node native ESM suites.

## 2. Core Engineering Principles (KISS, YAGNI, Reuse & Modularity)

- **KISS, YAGNI & Scope Discipline ("Only Do What Is Asked")**:
  - Implement the simplest solution that satisfies the stated task and testable acceptance criteria (`AC-1..AC-N`)—nothing more.
  - Never add speculative generality, unrequested config flags, unused modes/versions, plugin layers, or gold-plating for hypothetical future needs.
- **Do Not Reinvent the Wheel (3-Tier Reuse Hierarchy)**:
  1. **Standard Libraries First**: Prefer Python ≥3.13 stdlib (`pathlib`, `json`, `tomllib`, `hashlib`, `html.parser`, `http.server`, `urllib`, `dataclasses`) and native Web Platform APIs (`structuredClone`, `Web Audio API`, `AbortController`, `URL`, `Intl`, `<dialog>`, native `<svg>`, CSS Grid/Flex).
  2. **Stable, Permissively Licensed Third-Party Libraries (`MIT`, `Apache-2.0`, `BSD`, `ISC`)**: Use mature, lightweight OSS libraries for commodity problems—added via `pyproject.toml`/`uv` for Python or vendored offline with version + license header under `src/training_aid/pwa/vendor/` for client JS (coordinator-approved with one designated file owner in swarms).
  3. **Custom Code Only for Root Domain Logic**: Write bespoke code strictly for exercise taxonomy/cues, workout progression/scaling rules, 2D kinematic pose rigs, and guided workout UX.
- **Separation of Concerns & Lean Modular Design**:
  - Keep pure domain logic (`pwa/core/`), state/storage (`pwa/state/`), rig & audio (`pwa/rig/`, `pwa/audio/`), UI & views (`pwa/ui/`, `pwa/views/`), compiler/kinematics/audit (`compiler/`, `kinematics/`, `audit/`), and tests (`tests/`) cleanly separated (`~100–350` LOC target; split before `~500` LOC).

## 3. Hard Security & Quality Invariants

- **Strict Ruff**: All Python code must pass `ruff check .` (`select = ["ALL"]`, Google docstrings, 88-char lines) and `ruff format --check .`.
- **Zero External Runtime Network / CDNs**: Never reference external `http://` or `https://` URLs in PWA assets (only W3C SVG `xmlns` namespaces). Preserve strict `Content-Security-Policy` in `index.html` and relative `./` paths.
- **XSS Safety**: Render all user/imported strings strictly via DOM nodes and `textContent`. Only precompiled `catalog.svgs` may pass through `setTrustedSvg()`.
- **Native ES Modules**: Client JS modules (except Service Worker `sw.js`) use standard ES module `import` / `export` syntax with explicit relative `./...js` / `../...js` specifiers.

## 4. Fast Verification & Tool Resolution

- **Node Resolution**: Use `scripts/verify_gate.sh` or `uv run python -c "from training_aid.audit.node_runner import find_node_binary; print(find_node_binary() or '')"`.
- **Canonical Verification Commands**:
  - Staged-only worktree/pre-commit check (`<0.3s`): `bash scripts/verify_gate.sh --quick --staged`
  - Repo-wide fast lint + JS syntax check (`<1s`): `bash scripts/verify_gate.sh --quick --allow-dirty`
  - Full pre-merge / CI gate (`~4s`): `bash scripts/verify_gate.sh`
  - Disjoint branch merge + pycache cleanup + full gate: `bash scripts/swarm_merge.sh <base_ref> <ref1> [ref2 ...]`

## 5. Standing Orchestrator & Swarm Policy (User-Authorized)

- **Gemini-Only Model Policy**: Never select `claude-*` or `gpt-*`.
  - **Coordinator**: Pin to **Gemini Carbon** (`gemini-pro-orchestrator` or `gemini-4-carbon-high` / `gemini-4-carbon-medium`).
  - **Workers / Subagents** (explicitly set `model` on every `swarm{action:"add"}`):
    - `monitor`: `gemini-4-argon-low` (fallback `gemini-4-hydrogen-low`)
    - `integrator`: `gemini-4-argon-medium` (fallback `gemini-4-argon-high`)
    - Standard authors (`ui`, `cli`, `tests`, `docs`): `gemini-4-argon-high` (or `gemini-4-hydrogen-medium`)
    - Deep-logic authors (`pwa/core/`, `kinematics/`): `gemini-4-hydrogen-high` (or `gemini-4-hydrogen-xhigh`)
    - `verifier` (read-only review): `gemini-4-hydrogen-high` (fallback `gemini-4-hydrogen-medium`)
- **Coordinator Runbook**: Load `.agents/skills/swarm-workflow/SKILL.md` and `.agents/skills/swarm-workflow/references/brief_templates.md` before spawning any swarm; execute `<3`-file / `<200`-LOC tasks solo.
- **Swarm Worker Rules** (mandatory for every worker):
  1. **Owned Paths, Native Worktree Branch & File Tools**: Edit/stage only paths/globs in your brief. In `share` workspaces, commit directly on the pre-created worktree branch (`git branch --show-current`)—do **not** create manual `swarm/<name>` branches. Always pass **absolute paths** to `read_file`/`write_file`/`edit_file`, and pass `Overwrite: true` to `write_file` when replacing an existing file.
  2. **AC Focus & Live Verification**: Implement strictly `AC-1..AC-N`, run owned `pytest` / `node --test` suites + `bash scripts/verify_gate.sh --quick --staged`, and delete temporary build dirs; never build multi-turn `/tmp` harnesses. Read-only `verifier` runs `bash scripts/verify_gate.sh` once and audits `git diff <base>..HEAD`.
  3. **Concise Posts (`≤12` lines) & Race-Free Barrier**: Check `read_board` + `swarm{action:"status"}`. Post `[READY] <branch> @ <sha>` (include `@integrator` if all sibling Phase-1 `[READY]` posts are already on the board). If omitted, call `read_board{since:<prev_head>}` once before `swarm_wait`: if concurrent posts just completed all Phase-1 `[READY]` reports without `@integrator`, post `@integrator all slices ready (refs #...)`. Downstream stages mention only the next peer (`@integrator` → `@verifier` → `@coordinator`).
  4. **Escalation & Defect Routing (Never Guess on Blockers)**: On contradictory `AC`s, a flawed `contract.md`, or needed edits outside Owned Paths, stop—post `[BLOCKED] <issue + options> @coordinator` and `swarm_wait`. Route ownership collisions or deep slice bugs to `@<author>` (fixes on worktree branch → `[READY] <branch> @ <sha> @integrator`), and cross-slice seam bugs to `@integrator` (fixes on target branch → `@verifier`).
