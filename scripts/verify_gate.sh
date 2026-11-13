#!/usr/bin/env bash
# Deterministic verification gate for Training Aid (lint, JS syntax, build, pytest, audit, git cleanliness).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

QUICK=0
ALLOW_DIRTY=0

usage() {
  cat <<'EOF'
Usage: bash scripts/verify_gate.sh [--quick] [--allow-dirty] [--help]

Options:
  --quick        Fast (<1s) check: ruff lint/format + node --check on all JS files only.
  --allow-dirty  Skip the final git status --porcelain cleanliness assertion.
  --help         Show this help message.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

NODE_BIN="$(uv run python -c 'from training_aid.audit import find_node_binary; print(find_node_binary() or "")')"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "[verify_gate] ERROR: Node.js binary not found via training_aid.audit.find_node_binary()" >&2
  exit 1
fi

echo "[verify_gate] 1. Ruff lint & format check..."
uv run ruff check .
uv run ruff format --check .

echo "[verify_gate] 2. JavaScript syntax check ($NODE_BIN)..."
for js_file in src/training_aid/pwa/*.js src/training_aid/static/*.js; do
  "$NODE_BIN" --check "$js_file"
done

if [[ "$QUICK" -eq 1 ]]; then
  if [[ "$ALLOW_DIRTY" -eq 0 && -n "$(git status --porcelain)" ]]; then
    echo "[verify_gate] ERROR: Working tree is dirty:" >&2
    git status --short >&2
    exit 1
  fi
  echo "[verify_gate] QUICK GATE PASSED."
  exit 0
fi

TMP_DIST="$(mktemp -d "${TMPDIR:-/tmp}/ta-gate-XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIST"
}
trap cleanup EXIT

echo "[verify_gate] 3. Static PWA CLI build smoke check..."
uv run training-aid --build-only --out-dir "$TMP_DIST/dist" >/dev/null

echo "[verify_gate] 4. Pytest suite..."
uv run pytest -q

echo "[verify_gate] 5. End-to-end catalog, kinematics & PWA bundle audit..."
uv run training-aid-check

if [[ "$ALLOW_DIRTY" -eq 0 ]]; then
  DIRTY="$(git status --porcelain)"
  if [[ -n "$DIRTY" ]]; then
    echo "[verify_gate] ERROR: Working tree has uncommitted/untracked files:" >&2
    echo "$DIRTY" >&2
    exit 1
  fi
fi

echo "[verify_gate] FULL GATE PASSED."
