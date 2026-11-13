#!/usr/bin/env bash
# Verify strictly disjoint file ownership across swarm branches, merge onto HEAD, and run verify_gate.sh.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DRY_RUN=0
ARGS=()

usage() {
  cat <<'EOF'
Usage: bash scripts/swarm_merge.sh [--dry-run] <base_ref> <branch1> [branch2 ...]

Verifies that all worker branches modified pairwise-disjoint file sets relative to <base_ref>,
merges them (--no-edit) in order into the current branch, and runs scripts/verify_gate.sh.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) ARGS+=("$arg") ;;
  esac
done

if [[ "${#ARGS[@]}" -lt 2 ]]; then
  echo "[swarm_merge] ERROR: Expected <base_ref> and at least one branch." >&2
  usage >&2
  exit 2
fi

BASE_REF="${ARGS[0]}"
BRANCHES=("${ARGS[@]:1}")

if ! git rev-parse --verify "${BASE_REF}^{commit}" >/dev/null 2>&1; then
  echo "[swarm_merge] ERROR: Invalid base_ref: $BASE_REF" >&2
  exit 1
fi

for br in "${BRANCHES[@]}"; do
  if ! git rev-parse --verify "${br}^{commit}" >/dev/null 2>&1; then
    echo "[swarm_merge] ERROR: Branch not found: $br" >&2
    exit 1
  fi
done

if [[ "$DRY_RUN" -eq 0 && -n "$(git status --porcelain)" ]]; then
  echo "[swarm_merge] ERROR: Working tree must be clean before merging:" >&2
  git status --short >&2
  exit 1
fi

declare -A OWNER_BY_FILE=()
COLLISIONS=0

echo "[swarm_merge] Checking disjoint file ownership against $BASE_REF..."
for br in "${BRANCHES[@]}"; do
  mapfile -t changed_files < <(git diff --name-only "${BASE_REF}...${br}")
  if [[ "${#changed_files[@]}" -eq 0 ]]; then
    echo "[swarm_merge] WARNING: Branch $br has 0 changed files relative to $BASE_REF."
    continue
  fi
  echo "  - $br (${#changed_files[@]} files): ${changed_files[*]}"
  for f in "${changed_files[@]}"; do
    if [[ -n "${OWNER_BY_FILE[$f]:-}" ]]; then
      echo "[swarm_merge] COLLISION: '$f' modified by both '${OWNER_BY_FILE[$f]}' and '$br'" >&2
      COLLISIONS=$((COLLISIONS + 1))
    else
      OWNER_BY_FILE["$f"]="$br"
    fi
  done
done

if [[ "$COLLISIONS" -gt 0 ]]; then
  echo "[swarm_merge] ABORTED: Found $COLLISIONS file-ownership collision(s). Ask offending worker(s) to revert out-of-scope paths." >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[swarm_merge] DRY RUN PASSED: All ${#BRANCHES[@]} branch(es) are strictly disjoint."
  exit 0
fi

for br in "${BRANCHES[@]}"; do
  echo "[swarm_merge] Merging $br..."
  git merge --no-edit "$br"
done

echo "[swarm_merge] Running full verification gate..."
bash "$REPO_ROOT/scripts/verify_gate.sh"
echo "[swarm_merge] MERGE & GATE COMPLETE."
