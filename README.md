# Training Aid

Minimal, full-screen guided workout trainer.

## Screens

1. **Setup (`/setup`)** — Full-screen live SVG preview alongside minimal equipment, intensity, and weekly frequency tiles.
2. **Plan (`/`)** — Split full-screen stage with interactive animated exercise preview and compact routine deck.
3. **Workout (`/workouts/{id}`)** — Edge-to-edge `100vw × 100dvh` animated SVG motion coach with minimal HUD (`1/4 · S1/3`, 1-word movement cues, giant counter, configurable Web Audio tempo packs alongside minimal cues, browser fullscreen toggle `⛶`, and `Space`/`→` shortcuts), ending with 1-tap adaptation (`−10%`, `=`, `+10%`).
4. **Stats (`/progress`)** — Full-screen intensity progression chart and compact session rail.

## Run

```bash
uv run training-aid
```

Open **http://127.0.0.1:8000**.

## Test

```bash
uv run pytest -v
```
