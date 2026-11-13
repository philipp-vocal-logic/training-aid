# Training Aid — Agent & Swarm Rules

## 1. Architecture & File Map (Zero-Backend Static PWA)

Training Aid compiles static exercise catalogs and forward-kinematics SVGs via Python ≥3.13 into a self-contained offline PWA (`dist/`):

- `src/training_aid/{__init__.py,cli.py}` — CLI entrypoint (`training-aid`).
- `src/training_aid/compiler/{__init__.py,coaching.py,catalog_builder.py,bundler.py}` — `CatalogExercise` model, coaching metadata, `dist/data/catalog.json` (`schema_version = 2`, 876 exercises, 126 inline SVGs), 126 SVG thumbnails, and 1:1 `dist/` bundler with deterministic `sw.js` `APP_SHELL_ASSETS` + `CACHE_VERSION` stamping.
- `src/training_aid/kinematics/{__init__.py,registry.py,ik_compiler.py,fk_solver.py,svg_renderer.py}` — Declarative `AnimationRegistry`, 2-link IK pose compiler, 2D FK solver, and interactive/thumbnail SVG renderer.
- `src/training_aid/audit/{__init__.py,models.py,node_runner.py,bundle_security.py,catalog_checks.py,rig_checks.py}` — End-to-end catalog, kinematics, CSP/privacy, and Node ESM bundle audit (`training-aid-check`).
- `src/training_aid/pwa/` — Unified 1:1 client tree copied directly into `dist/`:
  - `{index.html,app.js,sw.js,manifest.webmanifest,icon.svg}` — Offline PWA shell, Service Worker template, and SPA router.
  - `core/{constants,prescription,catalog,generator,projections,stats,workout-engine}.js` — Pure zero-DOM domain logic, compatibility/substitution, and workout state machine.
  - `state/{codec,store}.js` — Schema v2 state validation and `localStorage` (`training_aid_state_v2`) store with unified routine/ad-hoc item CRUD.
  - `rig/motion.js` & `audio/{presets,pattern,synth,controller}.js` — 2D FK rig animator and 4-layer Web Audio synth engine.
  - `ui/{dom,scope,preview-loop,modal,progress-chart,widgets}.js`, `views/{setup,plan,quick,edit,workout,progress}.js`, `styles/{tokens,primitives,layout,workout,screens}.css` — Modular DOM primitives, screen views, and CSS.
- `tests/{test_app.py,test_e2e_catalog.py,test_sw_cache_stamp.py,check_motion_rig.mjs,pwa_*.test.mjs,helpers/dom_harness.mjs}` — Pytest and Node native ESM suites.

## 2. Core Engineering Principles (KISS, YAGNI, Reuse & Modularity)

- **KISS, YAGNI & Scope Discipline ("Only Do What Is Asked")**:
  - Implement the simplest solution that satisfies the stated task and testable acceptance criteria (`AC-1..AC-N`)—nothing more.
  - Never add speculative generality, unrequested config flags, unused modes/versions, plugin layers, or gold-plating for hypothetical future needs.
- **Do Not Reinvent the Wheel (3-Tier Reuse Hierarchy)**:
  1. **Standard Libraries First**: Always prefer Python ≥3.13 stdlib (`pathlib`, `json`, `tomllib`, `hashlib`, `html.parser`, `http.server`, `urllib`, `dataclasses`) and native Web Platform APIs (`structuredClone`, `Web Audio API`, `AbortController`, `URL`, `Intl`, `<dialog>`, native `<svg>`, CSS Grid/Flex).
  2. **Stable, Permissively Licensed Third-Party Libraries (`MIT`, `Apache-2.0`, `BSD`, `ISC`)**: For solved commodity problems (e.g., parsers, schema validation, cryptography, rich charting), use mature, actively maintained, lightweight open-source libraries—added cleanly via `pyproject.toml`/`uv` for Python (updating `tests/test_app.py` dependency assertions intentionally) or vendored offline with version + license header under `src/training_aid/pwa/vendor/` for client JS. Never reimplement complex RFC/ISO specs from scratch. *(In swarms, new packages are approved in Phase 0 by the coordinator with a single designated file owner.)*
  3. **Custom Code Only for Root Domain Logic**: Write bespoke code strictly for Training Aid's core domain value (exercise taxonomy/cues, workout progression/scaling rules, 2D kinematic pose rigs, and guided workout UX).
- **Separation of Concerns & Lean Modular Design**:
  - Separate **pure domain logic/math** (`pwa/core/`), **storage & codec adapters** (`pwa/state/`), **rig & audio engines** (`pwa/rig/`, `pwa/audio/`), **UI primitives & per-screen views** (`pwa/ui/`, `pwa/views/`), **CLI/build compiler** (`compiler/`, `kinematics/`, `audit/`), and **standalone test modules** (`tests/`).
  - Target `~100–350` LOC per module; split responsibilities into focused files before exceeding `~500` LOC instead of growing multi-concern monoliths.

## 3. Hard Security & Quality Invariants

- **Strict Ruff**: All Python code must pass `ruff check .` (`select = ["ALL"]`, Google docstrings, 88-char lines) and `ruff format --check .`.
- **Zero External Runtime Network / CDNs**: Never reference external `http://` or `https://` URLs in PWA/static assets (only W3C SVG `xmlns` namespaces). Preserve the strict `Content-Security-Policy` in `index.html` and relative `./` paths for subdirectory hosting; bundle/vendor any third-party client libraries locally.
- **XSS Safety**: Render all user/imported strings strictly via DOM nodes and `textContent`. Only precompiled `catalog.svgs` may pass through `setTrustedSvg()`.
- **Native ES Modules**: Client JS modules (except Service Worker `sw.js`) use standard ES module `import` / `export` syntax with explicit relative `./...js` / `../...js` specifiers, cleanly importable in both browser execution and Node `node:test` `.mjs` suites.

## 4. Fast Verification & Tool Resolution

- **Never hunt manually for `node` on `PATH`**: Resolve Node via `uv run python -c "from training_aid.audit import find_node_binary; print(find_node_binary() or '')"` or use `scripts/verify_gate.sh`.
- **Canonical Verification Gate**:
  - Fast author check (`<1s`, mid-edit): `bash scripts/verify_gate.sh --quick --allow-dirty`
  - Full pre-commit / CI gate (`~5s`): `bash scripts/verify_gate.sh`
  - Branch collision check & merge: `bash scripts/swarm_merge.sh <base_ref> <branch1> [branch2 ...]`

## 5. Standing Orchestrator & Swarm Policy (User-Authorized)

- **Gemini-Only Model Policy**: Only Gemini models may be used across orchestrators, swarm workers, and subagents (never select `claude-*` or `gpt-*`).
  - **Orchestrator (`coordinator`)**: Default pin to **Gemini Carbon** (`gemini-pro-orchestrator` or `gemini-4-carbon-high` / `gemini-4-carbon-medium`). If a swarm coordinator starts on a non-Carbon model, switch itself via `swarm{action:"model", model:"gemini-pro-orchestrator"}`.
  - **Workers / Subagents**: Explicitly pin every swarm worker to **Gemini Argon** or **Gemini Hydrogen** (never leave `model` blank on `swarm{action:"add"}` to inherit Carbon):
    - `monitor`: `gemini-4-argon-low` (fallback `gemini-4-hydrogen-low`)
    - `integrator`: `gemini-4-argon-medium` (fallback `gemini-4-argon-high`)
    - Standard slice authors (`ui`, `cli`, `tests`, `docs`): `gemini-4-argon-high` (or `gemini-4-hydrogen-medium`)
    - Deep-logic domain authors (core math / 2D kinematics): `gemini-4-hydrogen-high` (or `gemini-4-hydrogen-xhigh`)
    - `verifier` (read-only adversarial review): `gemini-4-hydrogen-high` (fallback `gemini-4-hydrogen-medium`)
- **Coordinator Runbook**: Before spawning any swarm, load `.agents/skills/swarm-workflow/SKILL.md` and `.agents/skills/swarm-workflow/references/brief_templates.md`—enforce the Swarm Entry Gate (execute `<3`-file / `<200`-LOC tasks solo) and give every worker a complete brief with context, suggested modular files, approved libraries, YAGNI non-goals, and testable acceptance criteria (`AC-1..AC-N`).
- **Swarm Worker Rules** (mandatory for every worker in this repo):
  1. **Directory/Module Path Ownership**: Edit/stage only paths/globs assigned in your brief, follow the suggested modular file layout, remove temporary build dirs, and commit on `swarm/<your-name>` in `share` workspaces.
  2. **Acceptance-Criteria Focus & No Throwaway Harnesses**: Implement strictly what `AC-1..AC-N` require, commit reusable tests in `tests/`, and run `bash scripts/verify_gate.sh`; never build multi-turn `/tmp` test frameworks. Read-only `verifier` runs `bash scripts/verify_gate.sh` once and audits `git diff <base>..HEAD` against `AC-1..AC-N`, KISS/YAGNI, modularity, and security invariants.
  3. **Concise Board Posts (`≤15` lines)**: Report `[READY] swarm/<name> @ <sha>`, created/modified files, `AC` & gate status, and brief notes.
  4. **Last-Finisher Barrier & Single-Peer Doorbell**: Phase-1 parallel authors call `swarm{action:"status"}` right before posting—omit `@mention` if any sibling Phase-1 author is still `working`, and append `@integrator` only when you are the last Phase-1 author to finish. Downstream stages `@mention` only the single next peer (`@integrator` → `@verifier` → `@coordinator`).
