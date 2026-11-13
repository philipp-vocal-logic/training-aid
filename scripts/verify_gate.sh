#!/usr/bin/env bash
# Deterministic verification gate for Training Aid (lint, JS syntax, build, Node ESM suites, pytest, audit, git cleanliness).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Prevent inherited main-workspace VIRTUAL_ENV warnings inside git worktrees.
unset VIRTUAL_ENV

QUICK=0
STAGED=0
ALLOW_DIRTY=0

usage() {
  cat <<'EOF'
Usage: bash scripts/verify_gate.sh [--quick] [--staged] [--allow-dirty] [--help]

Options:
  --quick        Fast (<1s) check: ruff lint/format + node --check on JS/MJS files only.
  --staged       Check only staged existing .py/.js/.mjs files (implies --quick --allow-dirty; worktree-safe).
  --allow-dirty  Skip the final git status --porcelain cleanliness assertion.
  --help         Show this help message.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    --staged) QUICK=1; STAGED=1; ALLOW_DIRTY=1 ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

resolve_node_bin() {
  if [[ -n "${TA_NODE_BIN:-}" && -x "$TA_NODE_BIN" ]]; then
    printf '%s\n' "$TA_NODE_BIN"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  local candidate
  while IFS= read -r candidate; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done < <(compgen -G "$HOME/.local/share/*/node-v*/bin/node" "$HOME/.nvm/versions/node/*/bin/node" 2>/dev/null | sort -r || true)
  return 1
}

NODE_BIN="$(resolve_node_bin || true)"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "[verify_gate] ERROR: Node.js binary not found." >&2
  exit 1
fi

if [[ "$STAGED" -eq 1 ]]; then
  PY_FILES=()
  JS_FILES=()
  while IFS= read -r -d '' rel_path; do
    [[ -f "$rel_path" ]] || continue
    case "$rel_path" in
      *.py) PY_FILES+=("$rel_path") ;;
      *.js|*.mjs) JS_FILES+=("$rel_path") ;;
    esac
  done < <(git diff --cached --name-only --diff-filter=ACMR -z)

  if [[ "${#PY_FILES[@]}" -gt 0 ]]; then
    uv run ruff check -- "${PY_FILES[@]}"
    uv run ruff format --check -- "${PY_FILES[@]}"
  fi
  for js_file in "${JS_FILES[@]}"; do
    "$NODE_BIN" --check "$js_file"
  done
  exit 0
fi

echo "[verify_gate] 1. Ruff lint & format check..."
uv run ruff check .
uv run ruff format --check .

echo "[verify_gate] 2. JavaScript syntax check ($NODE_BIN)..."
JS_COUNT=0
while IFS= read -r -d '' js_file; do
  "$NODE_BIN" --check "$js_file"
  JS_COUNT=$((JS_COUNT + 1))
done < <(find src/training_aid/pwa tests -type f \( -name '*.js' -o -name '*.mjs' \) -print0 2>/dev/null | sort -z)
if [[ "$JS_COUNT" -eq 0 ]]; then
  echo "[verify_gate] ERROR: No JavaScript files discovered for syntax check." >&2
  exit 1
fi

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
export TA_DIST_DIR="$TMP_DIST/dist"

echo "[verify_gate] 4. Standalone Node ESM test suites ($NODE_BIN)..."
"$NODE_BIN" --test tests/*.test.mjs

echo "[verify_gate] 5. Pytest suite..."
uv run pytest -q

echo "[verify_gate] 6. End-to-end catalog, kinematics & PWA bundle audit..."
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
