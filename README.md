# Training Aid

Minimal, zero-backend, offline-first guided workout PWA.

## Screens

1. **Setup (`#setup`)** — Full-screen live SVG preview alongside equipment, intensity, and weekly frequency tiles, plus zero-server device portability via QR/share link (`#import=` `deflate-raw` fragment) and `.json` backup export/import.
2. **Plan (`#plan` & `#edit/<id>`)** — Split full-screen stage with interactive animated exercise preview, compact routine deck, and instant offline catalog search across all 876 exercises.
3. **Workout (`#workout/<id>`)** — Edge-to-edge `100vw × 100dvh` animated SVG motion coach with minimal HUD (`1/4 · S1/3`, live step-by-step form cue, 1-word movement cues, giant counter, Web Audio tempo packs, fullscreen toggle `⛶`, and `Space`/`→` shortcuts), ending with 1-tap adaptation (`−10%`, `=`, `+10%`).
4. **Stats (`#progress`)** — Full-screen inline SVG intensity progression chart, streak KPIs, and compact session rail.

## Privacy & Offline Architecture

- **100% local state:** Profile, routines, and workout history stay in browser `localStorage` (`training_aid_state_v1`) with persistent storage requests where supported.
- **Zero backend & zero external requests:** Compiled entirely with the Python standard library (`dependencies = []`), strict `Content-Security-Policy`, no external CDNs or telemetry, and full offline precaching via `sw.js`.

## Run & Build

```bash
# Compile static bundle into dist/ and serve locally on http://127.0.0.1:8000
uv run training-aid

# Compile static bundle into dist/ (or --out-dir PATH) for static hosting
uv run training-aid --build-only
```

## Test & Audit

```bash
uv run pytest -v
uv run training-aid-check
```
