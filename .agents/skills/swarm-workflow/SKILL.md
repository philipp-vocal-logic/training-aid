---
name: swarm-workflow
description: >-
  Project-specific swarm orchestration runbook for Training Aid. Activate this skill
  whenever /swarm is invoked or when planning multi-agent execution, worker model
  pinning, parallel branch decomposition, merge barriers, or verification in this repository.
---

# Training Aid Swarm Orchestration Runbook

Follow this runbook alongside the built-in `swarm` skill to avoid serial integration tails, redundant test harnesses, coordinator ping-pong, and unpinned heavy-model burn.

## 1. Swarm Entry Gate (YAGNI Check First)

Evaluate task scope **before** creating a swarm:

- **Solo Execution (0 workers)**: `<3` files touched, `<200` LOC delta, or tightly coupled single-module changes. Execute directly (or tell the user why solo execution is 5× faster if `/swarm` was not explicitly forced).
- **2-Worker Pair (`author` + `verifier`)**: Security-critical, kinematic, or algorithmic change confined to 1–2 files (`author` on `inherit` or `share` → `@verifier` → `@coordinator`).
- **Full Parallel DAG (`3–4 authors` + `integrator` + `verifier` + `monitor`)**: `≥3` strictly disjoint file slices (`>300` LOC total) with a stable interface contract defined upfront.

## 2. Gemini-Only Model Routing Matrix

Per project policy in `AGENTS.md`, **only Gemini models are permitted** (never select `claude-*` or `gpt-*`). Always inspect live quota via `swarm{action:"models"}` first:

1. **Pin Coordinator to Gemini Carbon**:
   - Ensure `coordinator` runs on `gemini-pro-orchestrator` (or `gemini-4-carbon-high` / `gemini-4-carbon-medium`). If started on another family, switch via `swarm{action:"model", model:"gemini-pro-orchestrator"}`.
2. **Explicitly Pin Every Worker to Argon or Hydrogen** (never omit `model` on `swarm{action:"add"}`):

| Worker Role | Default `model` Pin | Escalation / Quota Fallback | When to Use |
| :--- | :--- | :--- | :--- |
| `monitor` | `gemini-4-argon-low` | `gemini-4-hydrogen-low` | Mandatory stall watcher when `swarm_monitor` is available; ultra-low cost per timer wakeup. |
| `integrator` | `gemini-4-argon-medium` | `gemini-4-argon-high` | Runs `scripts/swarm_merge.sh` + `scripts/verify_gate.sh` and resolves minor seam diffs (`<15` turns). |
| Standard Author | `gemini-4-argon-high` | `gemini-4-hydrogen-medium` | UI views, CSS, CLI flags, standard feature slices, `README.md`, and `test-author` test/audit slices. |
| Deep-Logic Author | `gemini-4-hydrogen-high` | `gemini-4-hydrogen-xhigh` | Dense math, 2D FK kinematics (`svg_assets.py`), Reed-Solomon/compression (`qr.js`, `store.js`). |
| `verifier` | `gemini-4-hydrogen-high` | `gemini-4-hydrogen-medium` | Read-only adversarial diff, security/CSP/XSS, and route/teardown edge-case review. |

## 3. Decomposition & Chained Pipeline Rules

1. **Tests & Audit Are a Phase-1 Parallel Slice (`test-author`), Never an Integrator Chore**:
   - Whenever `tests/*` or `src/training_aid/audit.py` require >40 LOC of updates, assign a dedicated `test-author` (`workspace:"share"`, `model:"gemini-4-argon-high"`) in Phase 1 building concurrently against the upfront contract.
   - `integrator` must remain a lightweight merge-and-seam worker (`<5 min`), never a monolithic test author.
2. **Compact Contract + Short Briefs (`≤25` lines)**:
   - Record shared data shapes/signatures once (either in `<artifactDir>/scratch/contract.md` readable by workers or in concise bullet points) and use the templates in [brief_templates.md](./references/brief_templates.md).
3. **Zero-Coordinator-Ping-Pong Pipeline (`Authors ──► @integrator ──► @verifier ──► @coordinator`)**:
   - Spawn Phase-1 authors (`workspace:"share"`), `integrator` (`workspace:"inherit"`), `verifier` (`workspace:"inherit"`), and `monitor` (`gemini-4-argon-low`) in Turn 1.
   - Instruct `integrator` and `verifier` in their briefs: *"On initial startup before being called by a peer, immediately call `swarm_wait{since:0}` as your sole tool call."*
   - **Last-Finisher Barrier**: List the exact Phase-1 author roster names in each author's brief. When an author finishes its commit, it checks `swarm{action:"status"}`:
     - If **any listed sibling Phase-1 author is still `working`**, post `[READY] swarm/<name> @ <sha> ...` **with NO `@mention`**.
     - If **all listed sibling Phase-1 authors are `waiting`**, append **`@integrator`** to wake `integrator` directly.
   - `integrator` merges via [swarm_merge.sh](../../../scripts/swarm_merge.sh), fixes only cross-branch seam mismatches, commits on the target branch, and posts `[MERGED] <sha> @verifier` (citing `#seq` numbers—never copy-pasting reports).
   - `verifier` runs [verify_gate.sh](../../../scripts/verify_gate.sh) **once** and audits `git diff <base_sha>..HEAD`. Bugs go directly to `@integrator` (`@integrator` fixes and re-tags `@verifier`); clean sign-off goes to `@coordinator`.

## 4. Shutdown Checklist

When `[VERIFIED] @coordinator` arrives:
1. Confirm commits are landed on the main workspace branch, then `swarm{action:"kill"}` all finished workers (`authors`, `integrator`, `verifier`) to clean up worktrees—leaving `monitor` alive per `swarm` rules.
2. Post `[done] <one-line summary>` **with no `@` symbol** so `monitor` goes quiet.
3. Report concisely to the user with clickable `file://` links.
