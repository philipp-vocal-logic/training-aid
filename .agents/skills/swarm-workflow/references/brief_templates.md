# Compact Swarm Brief Templates (`≤25` Lines)

Replace `<...>` placeholders. Keep briefs terse—workers already inherit `AGENTS.md` automatically.

## 1. Phase-1 Slice Author (`workspace:"share"`)

```text
Branch: `swarm/<name>` (`git checkout -b swarm/<name>` from `<base_sha>`).
Phase-1 Sibling Authors: `<author-1>, <author-2>, <author-3>`
Owned Paths (ONLY touch/stage these): `<path1>, <path2>`
Forbidden Paths: Everything else (do not touch tests/audit unless owned).
Contract: Follow `<contract_path_or_inline_signatures>`.

Requirements:
- <3-6 concise bullet points of exact behavior & edge cases>

Done & Barrier Handoff:
1. Run `bash scripts/verify_gate.sh --quick --allow-dirty` (plus targeted unit test if owned), clean temporary outputs, and commit ONLY Owned Paths on `swarm/<name>`.
2. Call `swarm{action:"status"}`:
   - If ANY sibling in `<author-1>, <author-2>, <author-3>` is `working`, post `[READY] swarm/<name> @ <sha> | Files: ...` with NO `@mention`.
   - If ALL siblings are `waiting`, append `@integrator` to that post.
   - Tag `@coordinator` ONLY if blocked on an ambiguous contract decision.
```

## 2. Pre-Spawned Integrator (`workspace:"inherit"`, `model:"gemini-4-argon-medium"`)

```text
Role: Merge & seam integrator on `<target_branch>` (base `<base_sha>`).
Expected Branches: `swarm/<author-1> swarm/<author-2> swarm/<author-3>`

Startup Rule:
- If the `[READY]` posts for all expected branches are not on the board yet, call `swarm_wait{since:0}` immediately as your ONLY action.

When Woken by `@integrator`:
1. Read `[READY]` posts via `read_board`; if any expected Phase-1 author is still `working`, call `swarm_wait{since:<head>}` immediately.
2. Run `bash scripts/swarm_merge.sh <base_sha> swarm/<author-1> swarm/<author-2> swarm/<author-3>`.
   - On file-ownership collision, do NOT resolve manually—tag the offending `@<author>` to drop out-of-scope files.
3. Fix only genuine cross-module seam mismatches, ensure `bash scripts/verify_gate.sh` passes with a clean tree, commit if seams were patched, and post `[MERGED] <head_sha> (refs #<s1>, #<s2>, ...) @verifier` (≤10 lines).
4. If `@verifier` reports defects, fix on `<target_branch>`, re-run `bash scripts/verify_gate.sh`, commit, and reply `@verifier`.
```

## 3. Pre-Spawned Read-Only Verifier (`workspace:"inherit"`, `model:"gemini-4-hydrogen-high"`)

```text
Role: Independent read-only verifier (base `<base_sha>`). NEVER edit tracked files or write multi-turn `/tmp` test frameworks.

Startup Rule:
- Before `[MERGED]` is posted naming `@verifier`, call `swarm_wait{since:0}` immediately as your ONLY action.

When Woken by `@verifier`:
1. Run `bash scripts/verify_gate.sh` ONCE to confirm lint, JS syntax, build, pytest, E2E audit, and clean `git status`.
2. Inspect `git diff <base_sha>..HEAD` against the contract and `AGENTS.md` invariants:
   - Logic/boundary bugs, malformed input handling, listener/timer/audio teardown leaks, CSP/XSS sinks, and missing test coverage.
3. Handoff (≤12 lines):
   - Defects or missing regression tests found -> post concrete file:line + repro mentioning ONLY `@integrator`.
   - Zero defects & clean `git status` -> post `[VERIFIED] <head_sha> @coordinator`.
```

## 4. Stall Monitor (`workspace:"inherit"`, `model:"gemini-4-argon-low"`)

```text
You are this swarm's stall monitor. Load the swarm_monitor skill and follow it. Post only to break a stall.
```
