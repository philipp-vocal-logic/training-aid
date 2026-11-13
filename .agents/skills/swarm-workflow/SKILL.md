---
name: swarm-workflow
description: >-
  Project-specific swarm orchestration runbook for Training Aid. Activate this skill
  whenever /swarm is invoked or when planning multi-agent execution, worker model
  pinning, parallel branch decomposition, merge barriers, or verification in this repository.
---

# Training Aid Swarm Orchestration Runbook

Follow this runbook alongside the built-in `swarm` skill to enforce separation of concerns, prevent wheel reinvention and monolithic files, eliminate serial integration tails, and avoid unpinned heavy-model burn.

## 1. Phase 0: Entry Gate, Separation of Concerns & Reuse Planning

Before spawning any worker, complete these four coordinator checks:

1. **Swarm Entry Gate (YAGNI Check First)**:
   - **Solo Execution (0 workers)**: `<3` files touched, `<200` LOC delta, or tightly coupled single-module changes. Execute directly (or explain why solo execution is faster if `/swarm` was not explicitly forced).
   - **2-Worker Pair (`author` + `verifier`)**: Security-critical, kinematic, or algorithmic change confined to 1–2 modules (`author` on `inherit` or `share` → `@verifier` → `@coordinator`).
   - **Full Parallel DAG (`3–4 authors` + `integrator` + `verifier` + `monitor`)**: `≥3` strictly disjoint module/directory slices (`>300` LOC total) with an upfront interface contract.
2. **Separation of Concerns in Planning & Module Boundaries**:
   - **Role Separation**: `coordinator` plans contracts, dependencies, and `AC-1..AC-N` (never edits app code); slice authors own one cohesive architectural concern each (pure domain logic, storage/codecs, per-screen UI views, CLI/builder, or tests); `integrator` merges and wires cross-slice seams only; `verifier` performs read-only `AC` + architectural/security review.
   - **Directory/Glob Ownership & Suggested Modular Files**: Never lock a feature author into a single mega-file (e.g., *"only touch `app.js`"*). Grant ownership of a cohesive directory/glob (e.g., `src/training_aid/pwa/views/**`) with explicit **Suggested Modular Files to Create/Modify** (`~100–350` LOC per file; split before `~500` LOC).
   - **Parallel `test-author` Slice**: Whenever `tests/*` or `src/training_aid/audit.py` need `>40` LOC of updates, spawn a dedicated Phase-1 `test-author` (`workspace:"share"`, `model:"gemini-4-argon-high"`) writing standalone `.py`/`.mjs` tests concurrently against `AC-1..AC-N`—never defer test authoring to `integrator`.
3. **Upfront Stdlib & Permissive Third-Party Library Selection (No Wheel Reinvention)**:
   - Decide reuse in Phase 0 using the 3-tier hierarchy in `AGENTS.md`: **(1) Python ≥3.13 stdlib & Web Platform APIs** → **(2) Stable permissive OSS libraries (`MIT`/`Apache-2.0`/`BSD`/`ISC`)** → **(3) Custom code strictly for root workout/kinematic domain logic**.
   - If a third-party library is warranted, name the exact package/vendored module in the contract and assign `pyproject.toml` + `uv.lock` (plus `builder.py` copying if needed) or `src/training_aid/pwa/vendor/` to **one** designated slice so parallel branches never collide.
4. **Sufficient, Self-Contained Briefs with Testable Acceptance Criteria (`AC-1..AC-N`)**:
   - Every worker starts cold with zero conversation history. Write complete, structured briefs using [brief_templates.md](./references/brief_templates.md) containing:
     1. **Context & Objective** (why and what)
     2. **Owned Scope & Suggested Modular Files** (each with a 1-line responsibility)
     3. **Shared Contract & Approved Libraries** (exact signatures + stdlib/3rd-party APIs to use)
     4. **KISS / YAGNI Non-Goals** (explicit out-of-scope items so workers only do what is asked)
     5. **Testable Acceptance Criteria (`AC-1` … `AC-N`)** (concrete inputs → expected outputs, error cases, and verification commands)

## 2. Gemini-Only Model Routing Matrix

Per `AGENTS.md`, **only Gemini models are permitted** (never select `claude-*` or `gpt-*`). Check live availability via `swarm{action:"models"}` first:

1. **Pin Coordinator to Gemini Carbon**:
   - Run `coordinator` on `gemini-pro-orchestrator` (or `gemini-4-carbon-high` / `gemini-4-carbon-medium`). If started on another family, switch immediately via `swarm{action:"model", model:"gemini-pro-orchestrator"}`.
2. **Explicitly Pin Every Worker to Argon or Hydrogen** (never omit `model` on `swarm{action:"add"}`):

| Worker Role | Default `model` Pin | Escalation / Quota Fallback | When to Use |
| :--- | :--- | :--- | :--- |
| `monitor` | `gemini-4-argon-low` | `gemini-4-hydrogen-low` | Mandatory stall watcher when `swarm_monitor` is available; ultra-low cost per timer wakeup. |
| `integrator` | `gemini-4-argon-medium` | `gemini-4-argon-high` | Runs [swarm_merge.sh](../../../scripts/swarm_merge.sh) + [verify_gate.sh](../../../scripts/verify_gate.sh) and wires cross-slice seams (`<15` turns). |
| Standard Author | `gemini-4-argon-high` | `gemini-4-hydrogen-medium` | Modular UI views, storage/CLI slices, `README.md`, and `test-author` standalone test suites. |
| Deep-Logic Author | `gemini-4-hydrogen-high` | `gemini-4-hydrogen-xhigh` | Core workout progression math or 2D FK kinematics (`svg_assets.py`) where no library applies. |
| `verifier` | `gemini-4-hydrogen-high` | `gemini-4-hydrogen-medium` | Read-only audit of `AC-1..AC-N`, KISS/YAGNI, modularity, reuse, and CSP/XSS/teardown safety. |

## 3. Chained Pipeline & Last-Finisher Barrier

Run `Authors ──► @integrator ──► @verifier ──► @coordinator` with zero coordinator ping-pong:

1. **Turn-1 Spawn**:
   - Write any shared multi-slice interface spec to `<artifactDir>/scratch/contract.md` (or inline if concise), then spawn Phase-1 authors (`workspace:"share"`), `integrator` (`workspace:"inherit"`), `verifier` (`workspace:"inherit"`), and `monitor` (`gemini-4-argon-low`).
   - Both `integrator` and `verifier` immediately park via `swarm_wait{since:0}` on initial startup until named.
2. **Last-Finisher Barrier**:
   - List all Phase-1 sibling author names in every Phase-1 author brief.
   - After committing on `swarm/<name>`, each author calls `swarm{action:"status"}`:
     - If **any sibling Phase-1 author is still `working`**, post `[READY] swarm/<name> @ <sha> ...` **with NO `@mention`**.
     - If **all sibling Phase-1 authors are `waiting`**, append **`@integrator`** to wake `integrator` directly.
3. **Merge & Adversarial Verification**:
   - `integrator` merges via [swarm_merge.sh](../../../scripts/swarm_merge.sh), resolves only cross-slice seam wiring, runs [verify_gate.sh](../../../scripts/verify_gate.sh), commits if needed, and posts `[MERGED] <sha> (refs #...) @verifier`.
   - `verifier` runs [verify_gate.sh](../../../scripts/verify_gate.sh) **once** and audits `git diff <base_sha>..HEAD` for:
     - Full coverage of every `AC-1..AC-N` criterion and edge case
     - Adherence to KISS/YAGNI (flagging unrequested features or speculative abstractions)
     - Proper reuse vs. wheel reinvention and lean modular file sizes (flagging `>500`-LOC multi-concern monoliths)
     - CSP/offline privacy, DOM `textContent` XSS safety, and route/timer/audio teardown cleanliness
   - Defects or missing regression tests go directly to `@integrator`; clean sign-off posts `[VERIFIED] <sha> @coordinator`.

## 4. Shutdown Checklist

When `[VERIFIED] @coordinator` arrives:
1. Confirm commits are landed on the target workspace branch, then `swarm{action:"kill"}` finished workers (`authors`, `integrator`, `verifier`) to clean up `share` worktrees—leaving `monitor` alive per `swarm` rules.
2. Post `[done] <one-line summary>` **with no `@` symbol** so `monitor` stops scheduling timers.
3. Summarize concisely for the user with clickable `file://` links.
