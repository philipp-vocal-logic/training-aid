# Training Aid

Minimal, zero-backend, offline-first guided workout PWA built with Python ≥3.13 and zero-build native ES Modules.

## Screens

1. **Setup (`#setup`)** — Full-screen live SVG preview alongside multiselect equipment, intensity, weekly frequency, exercise speed (`slow` / `normal` / `fast`), and rest interval tiles.
2. **Plan (`#plan` & `#edit/<id>`)** — Split full-screen stage with interactive animated exercise preview, non-destructive daily equipment filter, compact routine deck, and instant offline catalog search across all 876 exercises.
3. **On-the-Fly (`#quick`)** — Instant balanced workout generator and custom ad-hoc session builder that counts toward weekly goals and history without advancing the saved split cursor.
4. **Workout (`#workout/<id>`)** — Edge-to-edge `100vw × 100dvh` animated SVG motion coach with minimal HUD (`1/4 · S1/3`, live step-by-step form cue, movement cues, giant counter, live tempo/rest controls, 4-layer Web Audio synth packs, fullscreen toggle `⛶`, and `Space`/`→` shortcuts), ending with 1-tap adaptation (`−10%`, `=`, `+10%`).
5. **Stats (`#progress`)** — Full-screen inline SVG intensity progression chart, streak KPIs, and detailed date-time workout history rail.

## Privacy & Offline Architecture

- **100% local state:** Profile, routines, and workout history stay in browser `localStorage` (`training_aid_state_v2`) with persistent storage requests where supported.
- **Zero backend & zero external requests:** Compiled entirely with the Python standard library (`dependencies = []`), strict `Content-Security-Policy`, zero external CDNs or telemetry, and deterministic offline precaching (`APP_SHELL_ASSETS` + `CACHE_VERSION`) via `sw.js`.

## Run & Build

```bash
# Compile static bundle into dist/ and serve locally on http://127.0.0.1:8000
uv run training-aid

# Compile static bundle into dist/ (or --out-dir PATH) for static hosting
uv run training-aid --build-only
```

## GitHub Pages Deployment

The repository ships with `.github/workflows/pages.yml`, which runs `bash scripts/verify_gate.sh`, compiles the clean `dist/` bundle via `uv run training-aid --build-only --out-dir dist`, and deploys to GitHub Pages using `actions/deploy-pages@v4`. All asset URLs and Service Worker precache routes use relative `./` paths so the PWA runs seamlessly at either a root domain or a `/<repo>/` subpath.

## Test & Audit

```bash
# Run full deterministic verification gate (Ruff, JS syntax, build, Node ESM tests, pytest, E2E audit)
bash scripts/verify_gate.sh

uv run pytest -v
uv run training-aid-check

# Enable fast (<1s) Ruff + JS syntax pre-commit hook on fresh clones
git config core.hooksPath .githooks
```

## License

Licensed under the [GNU General Public License v3.0 or later](./LICENSE) (`GPL-3.0-or-later`).
