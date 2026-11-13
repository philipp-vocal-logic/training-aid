# Training Aid — Agent & Swarm Rules

## 1. Architecture & File Map (Zero-Backend Static PWA)

Training Aid compiles static catalogs and forward-kinematics SVGs via Python ≥3.13 stdlib (`dependencies = []`) into a self-contained offline PWA (`dist/`):

- `src/training_aid/__init__.py`, `builder.py` — CLI (`training-aid`) & static bundle compiler (`dist/data/catalog.json` + 126 SVG thumbnails + 144 inline SVGs).
- `src/training_aid/coaching.py`, `svg_assets.py` — `CatalogExercise` taxonomy, cues, and 2D FK rig generator.
- `src/training_aid/audit.py` — End-to-end catalog, kinematics, CSP/privacy, and Node bundle audit (`training-aid-check`).
- `src/training_aid/pwa/{index.html,app.js,store.js,qr.js,sw.js,manifest.webmanifest,icon.svg}` — Offline PWA shell, SPA views, `localStorage` + `#import=` deflate portability, and ISO/IEC 18004 QR SVG encoder.
- `src/training_aid/static/{motion.js,sound.js,style.css}` — Rig animator, Web Audio synth, and full-screen CSS.
- `tests/{test_app.py,test_e2e_catalog.py}` — Pytest + Node integration suites.

## 2. Hard Invariants

- **Zero Runtime Dependencies & Strict Ruff**: Keep `dependencies = []` in `pyproject.toml`. All Python code must pass `ruff check .` (`select = ["ALL"]`, Google docstrings, 88-char lines) and `ruff format --check .`.
- **Zero External Network / CDNs**: Never reference external `http://` or `https://` URLs in PWA/static assets (only W3C SVG `xmlns` namespaces). Preserve the strict `Content-Security-Policy` in `index.html` and relative `./` paths for subdirectory hosting.
- **XSS Safety**: Render all user/imported strings strictly via DOM nodes and `textContent`. Only precompiled `catalog.svgs` or `TrainingQR.renderSvg()` output may pass through `setTrustedSvg()`.
- **Dual UMD JS Modules**: Client JS modules (`store.js`, `qr.js`, `app.js`, `motion.js`, `sound.js`) must preserve both `window.Training*` and CommonJS `module.exports` compatibility.

## 3. Fast Verification & Tool Resolution

- **Never hunt manually for `node` on `PATH`**: Resolve Node via `uv run python -c "from training_aid.audit import find_node_binary; print(find_node_binary() or '')"` or use the gate script directly.
- **Canonical Verification Gate**:
  - Fast author check (`<1s`, mid-edit): `bash scripts/verify_gate.sh --quick --allow-dirty`
  - Full pre-commit / CI gate (`~5s`): `bash scripts/verify_gate.sh`
  - Branch collision check & merge: `bash scripts/swarm_merge.sh <base_ref> <branch1> [branch2 ...]`

## 4. Standing Orchestrator & Swarm Policy (User-Authorized)

- **Gemini-Only Model Policy**: Only Gemini models may be used across orchestrators, swarm workers, and subagents (never select `claude-*` or `gpt-*`).
  - **Orchestrator (`coordinator`)**: Default pin to **Gemini Carbon** (`gemini-pro-orchestrator` or `gemini-4-carbon-high` / `gemini-4-carbon-medium`). If a swarm coordinator starts on a non-Carbon model, switch itself via `swarm{action:"model", model:"gemini-pro-orchestrator"}`.
  - **Workers / Subagents**: Explicitly pin every swarm worker to **Gemini Argon** or **Gemini Hydrogen** (never leave `model` blank on `swarm{action:"add"}` to inherit Carbon):
    - `monitor`: `gemini-4-argon-low` (fallback `gemini-4-hydrogen-low`)
    - `integrator`: `gemini-4-argon-medium` (fallback `gemini-4-argon-high`)
    - Standard slice authors (`ui`, `cli`, `tests`, `docs`): `gemini-4-argon-high` (or `gemini-4-hydrogen-medium`)
    - Complex math / kinematics / encoding authors: `gemini-4-hydrogen-high` (or `gemini-4-hydrogen-xhigh`)
    - `verifier` (read-only adversarial review): `gemini-4-hydrogen-high`
- **Coordinator Runbook**: Before spawning any swarm, load `.agents/skills/swarm-workflow/SKILL.md` and enforce its Swarm Entry Gate (execute `<3`-file / `<200`-LOC tasks solo without a swarm).
- **Swarm Worker Rules** (mandatory for every worker in this repo):
  1. **Strict Path Ownership**: Edit/stage only paths listed in your brief; commit on `swarm/<your-name>` in `share` workspaces; remove temporary build dirs before committing.
  2. **No Throwaway Harnesses**: Commit reusable assertions in `tests/` and run `bash scripts/verify_gate.sh`; never build multi-turn `/tmp` test frameworks. Read-only `verifier` runs `bash scripts/verify_gate.sh` once and audits `git diff <base>..HEAD`, delegating missing tests to `@integrator`.
  3. **Compact Board Posts (`≤12` lines)**: Report `[READY] swarm/<name> @ <sha>`, touched files, gate status, and concise notes.
  4. **Last-Finisher Barrier & Single-Peer Doorbell**: Phase-1 parallel authors call `swarm{action:"status"}` right before posting—omit `@mention` if any sibling Phase-1 author is still `working`, and append `@integrator` only when you are the last Phase-1 author to finish. Downstream stages `@mention` only the single next peer (`@integrator` → `@verifier` → `@coordinator`).
