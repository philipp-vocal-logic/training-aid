# Swarm Brief Templates (Self-Contained, Modular & Testable)

Replace `<...>` placeholders. Every worker starts with **zero conversation history** (inheriting only `AGENTS.md`), so briefs must give complete context, modular file suggestions, approved libraries, YAGNI boundaries, and testable `AC-1..AC-N` criteria without unstructured prose fluff.

---

## 1. Phase-1 Slice Author (`workspace:"share"`, `model:"gemini-4-argon-high"` or `"gemini-4-hydrogen-high"`)

```text
Context & Objective:
<2-4 sentences: what architectural concern this slice owns and how it fits the user goal.>

Branch & Sibling Roster:
- Branch: `swarm/<name>` (`git checkout -b swarm/<name>` from `<base_sha>`)
- Phase-1 Sibling Authors: `<author-1>, <author-2>, <test-author>`

Ownership Scope & Lean Modular Layout:
- Owned Paths/Globs (ONLY create/edit/stage within these): `<e.g., src/training_aid/pwa/views/**, src/training_aid/pwa/router.js>`
- Suggested Modular Files to Create/Update (keep each focused on one concern, ~100-350 LOC; split before 500 LOC):
  - `<path/file_a.ext>` — <1-line single responsibility>
  - `<path/file_b.ext>` — <1-line single responsibility>
- Forbidden Paths: Everything outside Owned Paths/Globs (never touch sibling slices or shared lockfiles unless explicitly listed above).

Shared Contract & Approved Libraries (Do Not Reinvent the Wheel):
- Interface Contract: `<path to <artifactDir>/scratch/contract.md OR exact exported signatures & data shapes>`
- Reuse / Libraries to Use: `<exact Python >=3.13 stdlib / Web Platform APIs / coordinator-approved MIT|Apache|BSD|ISC library or vendored module>`

KISS & YAGNI Non-Goals (Only Do What Is Asked):
- Implement ONLY what `AC-1..AC-N` require—no speculative config flags, extra modes/versions, or premature abstractions.
- Do NOT hand-roll commodity specs/parsers covered by stdlib or the approved library above.
- <1-2 task-specific out-of-scope boundaries>

Testable Acceptance Criteria:
- AC-1: <Given X input/state, module/function Y produces Z exact output/DOM state.>
- AC-2: <Boundary / malformed input case -> exact safe fallback or error behavior.>
- AC-3: <Separation/security invariant: e.g., zero external URLs, DOM `textContent` only, clean listener/timer teardown, reusable unit test in `<owned_test_path>` if owned.>

Verification & Last-Finisher Barrier Handoff:
1. Run `bash scripts/verify_gate.sh --quick --allow-dirty` (plus targeted pytest/Node test for owned tests), remove temporary build dirs, and commit ONLY Owned Paths on `swarm/<name>`.
2. Call `swarm{action:"status"}`:
   - If ANY sibling in `<author-1>, <author-2>, <test-author>` is still `working`, post `[READY] swarm/<name> @ <sha> | Files: ... | ACs verified: AC-1..N` (<=15 lines) with NO `@mention`.
   - If ALL listed siblings are `waiting`, append `@integrator` to that post.
   - Tag `@coordinator` ONLY if blocked on a genuine contract contradiction.
```

---

## 2. Pre-Spawned Integrator (`workspace:"inherit"`, `model:"gemini-4-argon-medium"`)

```text
Role: Merge & cross-slice seam integrator on `<target_branch>` (base `<base_sha>`).
Expected Phase-1 Branches: `swarm/<author-1> swarm/<author-2> swarm/<test-author>`
Shared Contract & Acceptance Criteria Ref: `<contract_path_or_post_ref>`

Startup Rule:
- If `[READY]` posts for all expected Phase-1 branches are not on the board yet, call `swarm_wait{since:0}` immediately as your ONLY action.

When Woken by `@integrator`:
1. Read `[READY]` posts via `read_board`; if any expected Phase-1 author is still `working`, call `swarm_wait{since:<head>}` immediately.
2. Merge cleanly via `bash scripts/swarm_merge.sh <base_sha> swarm/<author-1> swarm/<author-2> swarm/<test-author>`.
   - On file-ownership collision, do NOT resolve manually—tag the offending `@<author>` to drop out-of-scope files.
3. Wire ONLY genuine cross-slice seam mismatches (imports, script tags, asset copy lists in `builder.py`) while preserving modular separation and KISS/YAGNI.
4. Run full `bash scripts/verify_gate.sh` (must pass 100% with clean `git status`), commit any seam fix on `<target_branch>`, and post `[MERGED] <head_sha> (refs #<s1>, #<s2>, ...) @verifier` (<=12 lines).
5. If `@verifier` reports concrete defects or missing `AC` coverage, apply minimal fixes on `<target_branch>`, re-run `bash scripts/verify_gate.sh`, commit, and reply `@verifier`.
```

---

## 3. Pre-Spawned Read-Only Verifier (`workspace:"inherit"`, `model:"gemini-4-hydrogen-high"`)

```text
Role: Independent read-only verifier (base `<base_sha>`). NEVER edit tracked files or build multi-turn `/tmp` test harnesses.
Contract & Acceptance Criteria Ref: `<contract_path_or_author_brief_seqs>`

Startup Rule:
- Before `[MERGED]` is posted naming `@verifier`, call `swarm_wait{since:0}` immediately as your ONLY action.

When Woken by `@verifier`:
1. Run `bash scripts/verify_gate.sh` ONCE to confirm ruff lint/format, recursive JS syntax, CLI static build, pytest, E2E audit, and clean `git status`.
2. Audit `git diff <base_sha>..HEAD` against every `AC-1..AC-N` criterion and `AGENTS.md`:
   - Functional accuracy, boundary/malformed input handling, and test assertions matching `AC-1..AC-N`.
   - KISS/YAGNI & Reuse: flag speculative unrequested features or hand-rolled reinvention of stdlib/approved libraries.
   - Modularity & Separation of Concerns: flag multi-concern mega-files (`>500` LOC) or embedded raw JS test blobs where standalone modules belong.
   - Security & Lifecycle: zero external `http(s)://` URLs, strict `textContent` XSS safety, and clean route/timer/audio teardown.
3. Handoff (<=15 lines):
   - Concrete defects, violated invariants, or untested `AC`s -> post `file:line` + exact fix guidance mentioning ONLY `@integrator`.
   - All `AC`s + gate + invariants green -> post `[VERIFIED] <head_sha> @coordinator`.
```

---

## 4. Stall Monitor (`workspace:"inherit"`, `model:"gemini-4-argon-low"`)

```text
You are this swarm's stall monitor. Load the swarm_monitor skill and follow it. Post only to break a stall.
```
