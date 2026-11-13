# Lean Swarm Brief Templates

Every worker already receives `AGENTS.md` in `<user_rules>`. Keep briefs compact (`~15–25` lines) by stating only slice-specific scope, contract reference, non-goals, and testable `AC-1..AC-N`.

---

## 1. Phase-1 Slice Author (`workspace:"share"`, `gemini-4-argon-high` or `gemini-4-hydrogen-high`)

```text
Objective: <1-3 sentences on this slice's single concern.>
Base Commit: `<base_sha>` (commit directly on your active worktree branch `git branch --show-current`)
Phase-1 Siblings: `<author-1>, <author-2>, ...`

Owned Paths/Globs (ONLY edit/stage/delete within these; include co-located unit tests if assigned):
- `<glob_or_path_1>` — <modular files & 1-line responsibility each (~100-350 LOC)>
- `<owned_test_file>` — <reusable unit tests for this slice>

Contract & Reuse:
- Spec: `<absolute path to <artifactDir>/scratch/contract.md OR inline signatures>`
- Approved APIs/Libs: `<stdlib / Web Platform APIs / approved package>`
- Tool Reminder: Use absolute worktree paths (`pwd`) for `read_file`/`write_file`/`edit_file`, and set `Overwrite: true` on `write_file` when replacing existing files.

Non-Goals (KISS/YAGNI):
- <1-2 explicit out-of-scope boundaries; no unrequested flags or shims>

Acceptance Criteria:
- AC-1: <Concrete input/state -> exact expected output/behavior>
- AC-2: <Edge/invalid case -> exact safe handling>
- AC-3: <Owned unit test + lint/syntax checks pass (`bash scripts/verify_gate.sh --quick --staged`)>

Handoff:
1. If blocked on a contradictory AC, contract flaw, or out-of-scope file: do NOT guess—post `[BLOCKED] <issue + options> @coordinator` and `swarm_wait`.
2. Stage & commit ONLY Owned Paths on your current worktree branch (`BRANCH=$(git branch --show-current)`).
3. Read `read_board` + `swarm{action:"status"}`:
   - If all Phase-1 Siblings already posted `[READY]`, post `[READY] <BRANCH> @ <sha> | Files: ... | ACs: AC-1..3 @integrator` (<=12 lines) and `swarm_wait`.
   - Otherwise post `[READY] <BRANCH> @ <sha> | Files: ... | ACs: AC-1..3` (NO `@mention`), then check `read_board{since:<prev_head>}` once before `swarm_wait`: if concurrent posts just completed all sibling `[READY]` reports without `@integrator`, post `@integrator all slices ready (refs #...)`.
```

---

## 2. Pre-Spawned Integrator (`workspace:"inherit"`, `gemini-4-argon-medium`)

```text
Role: Merge & cross-slice seam integrator on `<target_branch>` (base `<base_sha>`).
Expected Phase-1 Authors: `<author-1>, <author-2>, ...`
Contract Ref: `<absolute path to contract.md or brief seqs>`

1. Startup: Call `swarm_wait{since:0}` immediately unless woken by `@integrator`.
2. When woken: `read_board{since:0}` to collect the `<BRANCH>` refs from all Expected Phase-1 `[READY]` posts (if any expected author has not posted `[READY]`, `swarm_wait{since:<head>}`).
3. Run `bash scripts/swarm_merge.sh <base_sha> <branch1> <branch2> ...` (on file collision or slice-logic bug, tag `@<author>`; on contract/AC flaw, post `[BLOCKED] <issue> @coordinator` and `swarm_wait`).
4. Fix ONLY genuine cross-slice seam mismatches, ensure full `bash scripts/verify_gate.sh` passes with clean `git status`, commit any seam fix, and post `[MERGED] <head_sha> (refs #...) @verifier` (<=10 lines).
```

---

## 3. Pre-Spawned Read-Only Verifier (`workspace:"inherit"`, `gemini-4-hydrogen-high`)

```text
Role: Read-only adversarial verifier (base `<base_sha>`). Never edit tracked files or create `/tmp` harnesses.
Contract Ref: `<absolute path to contract.md or brief seqs>`

1. Startup: Call `swarm_wait{since:0}` immediately unless woken by `@verifier`.
2. When woken: Run `bash scripts/verify_gate.sh` ONCE, then audit `git diff <base_sha>..HEAD` against `AC-1..AC-N`, `contract.md`, and `AGENTS.md` (KISS/YAGNI, <500-LOC modularity, zero external URLs, `textContent` XSS safety, view/audio teardown).
3. Handoff (<=12 lines): Seam defect -> `@integrator`; slice bug -> `@<author>`; spec/AC flaw -> `[BLOCKED] <issue> @coordinator`; all green -> `[VERIFIED] <head_sha> @coordinator`.
```

---

## 4. Stall Monitor (`workspace:"inherit"`, `gemini-4-argon-low`)

```text
You are this swarm's stall monitor. Load the swarm_monitor skill and follow it. Post only to break a stall.
```
