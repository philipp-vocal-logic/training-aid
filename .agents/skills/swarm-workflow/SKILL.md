---
name: swarm-workflow
description: >-
  Project-specific swarm orchestration runbook for Training Aid. Activate this skill
  whenever /swarm is invoked or when planning multi-agent execution, worker model
  pinning, parallel branch decomposition, merge barriers, or verification in this repository.
---

# Training Aid Swarm Orchestration Runbook

Use alongside the built-in `swarm` skill to keep coordination lean, prevent context bloat, enforce disjoint modular slices, and run zero-bottleneck peer pipelines.

## 1. Phase 0: Entry Gate, Context Budget & Slice Design

1. **Swarm Entry Gate (YAGNI First)**:
   - **Solo (0 workers)**: `<3` files, `<200` LOC delta, or a tightly coupled single-module change. Execute directly unless `/swarm` was explicitly requested.
   - **2-Worker Pair (`author` + `verifier`)**: Security-critical, kinematic, or math change confined to 1–2 modules (`author` on `share` or `inherit` → `@verifier` → `@coordinator`).
   - **Full Parallel DAG (`3–4 authors` + `integrator` + `verifier` + `monitor`)**: `≥3` strictly disjoint directory/glob slices (`>300` LOC total) backed by a shared interface contract.
2. **Coordinator Context Budget (Avoid Mid-Turn Compaction)**:
   - Never read `>15` repository files directly in the coordinator's main context during Phase 0. Delegate broad file inventories, export mapping, and dead-code greps to the read-only `research` subagent and have it return a compact `<150`-line summary.
3. **Disjoint Directory Ownership & Co-Located Unit Tests**:
   - Assign cohesive directory/glob globs (e.g., `src/training_aid/pwa/core/**`) with suggested single-concern files (`~100–350` LOC; `<500` LOC cap).
   - **Co-locate unit tests on structural refactors**: When splitting or renaming modules across slices, assign each unit test file (`tests/pwa_core_state.test.mjs`, `tests/test_sw_cache_stamp.py`, etc.) to the slice that owns the tested code so authors execute **live** `pytest` / `node --test` runs in their own worktree before committing. Use a dedicated Phase-1 `test-author` slice only for additive features on stable module paths or cross-slice E2E harnesses.
4. **Single-Source-of-Truth Interface Contract (`<artifactDir>/scratch/contract.md`)**:
   - Write multi-slice contracts once to `<artifactDir>/scratch/contract.md` instead of duplicating signatures across board briefs:
     - Select reuse upfront per `AGENTS.md` (stdlib/Web APIs → permissive OSS with **1** designated lockfile/vendor owner → custom domain code).
     - Specify exact exported signatures, DOM IDs, and schema fields directly in code/JSON blocks—**never** pair explicit key lists with redundant prose counts (e.g., do not write `"exact 19 keys"` above an 18-key list).

## 2. Gemini-Only Model Routing Matrix

Check live availability via `swarm{action:"models"}` if uncertain; never select `claude-*` or `gpt-*`, and always set `model` explicitly on `swarm{action:"add"}`:

| Role | Default `model` Pin | Fallback | Scope |
| :--- | :--- | :--- | :--- |
| `coordinator` | `gemini-pro-orchestrator` / `gemini-4-carbon-high` | `gemini-4-carbon-medium` | Contracts, spawn, stall recovery, closeout (never edits app code). |
| `monitor` | `gemini-4-argon-low` | `gemini-4-hydrogen-low` | Background stall watcher (`swarm_monitor` skill). |
| `integrator` | `gemini-4-argon-medium` | `gemini-4-argon-high` | [swarm_merge.sh](../../../scripts/swarm_merge.sh) + cross-slice seam fixes + [verify_gate.sh](../../../scripts/verify_gate.sh). |
| Standard Author | `gemini-4-argon-high` | `gemini-4-hydrogen-medium` | UI views/styles, state/CLI/audit modules, test suites, docs. |
| Deep-Logic Author | `gemini-4-hydrogen-high` | `gemini-4-hydrogen-xhigh` | Core progression/engine math (`pwa/core/`) & 2D FK/IK (`kinematics/`). |
| `verifier` | `gemini-4-hydrogen-high` | `gemini-4-hydrogen-medium` | Single [verify_gate.sh](../../../scripts/verify_gate.sh) run + read-only `git diff` audit. |

## 3. Chained Pipeline & Closeout (`Authors → @integrator → @verifier → @coordinator`)

1. **Compact Turn-1 Spawn**:
   - Title the swarm and spawn all Phase-1 authors (`workspace:"share"`), `integrator` (`workspace:"inherit"`), `verifier` (`workspace:"inherit"`), and `monitor` in a single turn using the lean templates in [brief_templates.md](./references/brief_templates.md) (do not repeat `AGENTS.md` standing rules in briefs), then end the turn with the exact `open_board` line.
2. **Native Worktree Branches & Race-Free Barrier**:
   - Authors commit directly on their `share` worktree's auto-created branch (`git branch --show-current`; `.githooks/pre-commit` lints staged files only via `--staged` so unmerged sibling slices never block commits).
   - Authors synchronize via serialized board `seq` numbers (`AGENTS.md` §5.3) so exactly one last finisher wakes `@integrator` even on simultaneous completions.
3. **Merge, Verification & Blocker Escalation**:
   - `integrator` merges the `<branch>` refs reported in `[READY]` posts via [swarm_merge.sh](../../../scripts/swarm_merge.sh), fixes only cross-slice seams (routing ownership collisions or slice-logic bugs to `@<author>`), and posts `[MERGED] <sha> (refs #...) @verifier`.
   - `verifier` runs [verify_gate.sh](../../../scripts/verify_gate.sh) **once**, audits `git diff <base_sha>..HEAD` against `AC-1..AC-N` and `AGENTS.md` invariants, routes seam defects to `@integrator`, slice bugs to `@<author>`, task/spec flaws to `[BLOCKED] @coordinator`, or posts `[VERIFIED] <sha> @coordinator`.
   - **On `[BLOCKED] @coordinator`**: Resolve repo-factual contract/scope issues immediately (update `contract.md` and mention **only** affected `@<worker>`s); if user intent or trade-offs are ambiguous, ask the **user** directly before resuming workers.
4. **Closeout**:
   - Verify clean `git status -sb` on `master`, `swarm{action:"kill"}` finished workers (`authors`, `integrator`, `verifier`—auto-removing both `share` worktrees and their `swarm-<name>-*` branches; leave `monitor` alive), post `[done] <one-line summary>` **with no `@`**, and summarize concisely for the user.
