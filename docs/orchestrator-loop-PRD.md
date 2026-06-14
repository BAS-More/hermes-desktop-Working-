# Orchestrator Closed-Loop — PRD

Status: DRAFT FOR APPROVAL
Engine: BAS-More/hermes-agent fork · Desktop: feat/factory-tab
Author: Avi + Claude (Opus 4.8), 2026-06-14

## The vision (Avi's words)

> The orchestrator is given the results he must achieve and the guidelines (code
> quality, security, etc.). He picks the team of agents/sub-agents for the task,
> oversees what they're doing, and keeps them running in the react loop to the
> successful finish.

## What exists vs. the gap

| Duty | Status | Note |
|---|---|---|
| Given guidelines (quality/security) | ✅ done | the governor + secret scanner + avi-os-gates/tdad skills |
| Picks the team | ✅ done | the decomposer routes each child to the best profile |
| Given results to achieve | ◑ partial | a card body is the goal; no structured acceptance criteria |
| **Oversees in-flight** | ❌ gap | fans out ONCE, then sleeps until all children finish |
| **React loop to finish** | ❌ gap | when children finish the root just auto-promotes; nobody verifies the ASSEMBLED result vs the goal and spawns corrective work |

Today = **fan-out-once-then-assemble**. Target = **plan → verify → re-plan → loop-until-done**. The difference is the closed loop.

## Architecture decision (grounded)

Avi chose "engine dispatcher, autonomous, headless." The honest synthesis: the
**dispatcher (Python) owns the loop control-flow** (detect state, spawn, enforce
bounds), and a **spawned orchestrator worker (LLM) does the judgment** — the
dispatcher cannot itself judge "does this meet the goal?". This reuses the proven
review-worker machinery (`status='review'`, `claim_review_task`, the review
dispatch block at kanban_db.py:6439) — the orchestrator-verify is essentially a
review worker for the build ROOT that can re-open the build.

## The closed loop (new behavior)

```
triage card (goal + guidelines)
   │  decompose (EXISTING) — orchestrator picks team, seeds .ezra governance
   ▼
children run (EXISTING) — per-task goal-mode workers, governed
   │  all children done
   ▼
ROOT → 'review'  (NEW: instead of auto-promote to ready/done)
   │  dispatcher spawns the ORCHESTRATOR profile as a build-verify worker
   ▼
orchestrator-verify worker (NEW skill: orchestrator-verify)
   reads: the build goal + acceptance criteria + each child's result/artifacts
   judges: does the ASSEMBLED result meet the goal + guidelines?
   ├─ PASS → complete the root (build done) ✅
   └─ FAIL → record the gap + create N corrective child tasks under the root
              → root back to 'todo' (waits on the new children)
   ▼
corrective children run → root → 'review' again → re-verify  (THE LOOP)
   bounded by: build iteration ceiling + per-block retry cap + a NEW
   max_verify_rounds; on exhaustion → park root 'blocked' for human.
```

## Engine work

### E1. Acceptance criteria as a first-class build record
- At decompose, the orchestrator records the build's **acceptance criteria**
  ("done when…") into the build's `.ezra/` (new `acceptance.yaml` or a field in
  governance.yaml) + the root task metadata. Source: extracted from the card
  body by the decomposer LLM (it already produces structured JSON — add an
  `acceptance` field to its output schema).
- Read by the verify worker; surfaced in `govern --json`.

### E2. Root → review instead of auto-promote
- `recompute_ready` / the child-completion path: when ALL children of a root are
  done AND the root is a build-root (has an acceptance record / a new
  `is_build_root` flag), transition the root to `review` + assign the
  orchestrator profile, instead of promoting to `ready`/auto-done.
- Gate this on a config flag `kanban.orchestrator_loop: true` (default OFF first
  — this changes core dispatch; opt-in until proven) so existing builds are
  unaffected.

### E3. orchestrator-verify skill + worker
- A new skill `orchestrator-verify` (HOME skills/, like sdlc-review): instructs
  the worker to read the goal + acceptance + child results, judge PASS/FAIL with
  reasons, and on FAIL emit a structured list of corrective child tasks.
- The review dispatch already force-loads `sdlc-review` for review workers; add
  branch: if the review task is a BUILD ROOT, load `orchestrator-verify` instead.

### E4. Re-decompose on FAIL (the corrective spawn)
- A helper `reopen_build_with_children(root_id, children, reason)`: creates the
  corrective child tasks under the existing root, links them, transitions the
  root `review → todo` (waits on new children), records the verify verdict +
  reason as a root event. Reuses `decompose_triage_task`'s child-insert logic
  (factor out the shared insert).

### E5. Loop bounds (the runaway guards — non-negotiable)
- `max_verify_rounds` (default 3): root metadata counter; each FAIL→reopen
  increments. On exhaustion the root parks `blocked` ("verify loop exhausted —
  human review") rather than looping forever.
- The EXISTING budget breaker (wallclock + iteration ceiling) still bounds the
  whole subtree — the corrective children count as iterations.
- The EXISTING per-block retry cap still applies per worker.
- So three independent ceilings bound the loop; it cannot run away (critical
  given the ~93% weekly quota reality).

### E6. govern --json surfacing
- Build status: per-build goal, acceptance criteria, current verify round,
  last verdict + reason, loop state (running / verifying / corrective / done /
  parked). Feeds the Factory tab.

## Desktop work (after engine proven)
- Factory tab: a "Builds" view or section showing each active build — goal,
  acceptance criteria, which agents are on it, verify round N/max, last verdict,
  live state. This is the "oversees what they're doing" pane.
- (Optional) a build detail with the corrective-task history (the loop made
  visible).

## Verification plan
- Unit: acceptance record write/read; root→review transition gated by flag;
  reopen_build_with_children; max_verify_rounds parks at the cap.
- Live proof: a real build whose first attempt is deliberately incomplete →
  orchestrator-verify FAILS → spawns a corrective task → it runs → re-verify
  PASSES → root done. Then a build that can never pass → confirm it parks at
  max_verify_rounds (loop doesn't run away).
- Regression: with `orchestrator_loop: false` (default), existing fan-out
  behavior is byte-identical (no regression for current builds).

## Safety + rollout
- `orchestrator_loop` defaults OFF. Turn ON for one board / one build to prove,
  then default-on once trusted.
- Fork-durable (engine), restore-guard markers, all the usual.
- This touches CORE dispatch (root completion) — the flag-gate + the
  byte-identical-when-off regression are mandatory before it ships on.

## LOCKED DECISIONS (Avi, 2026-06-14)
1. **Acceptance criteria: AUTO-extract from the card** (decomposer LLM derives the
   "done when…"; editable in UI later).
2. **max_verify_rounds = 3.**
3. **On FAIL the orchestrator COMMANDS DIRECTIVE adjustments** — corrective tasks
   are specific ("builder did X wrong; do Y to meet criterion Z"), getting more
   pointed each round, guiding the builder to success. NOT vague re-decompose.
4. **On exhaustion (3 rounds): ESCALATE to human with full diagnosis + the
   specific recommended fix, and park.** Not silent give-up, not ship-best-effort.
   The orchestrator guides autonomously within the 3-round envelope; the ceiling
   exists only because unbounded looping risks the ~93% weekly quota.
5. **Rollout: flag OFF by default** (`kanban.orchestrator_loop`), prove on one
   build, then consider default-on. Byte-identical-when-off regression mandatory.

Design consequence of #3: E3 (orchestrator-verify) must output, on FAIL, a
structured PER-CRITERION gap analysis + directive correction per gap — the
corrective task bodies are those directives. E4 carries the orchestrator's
reason/diagnosis into each corrective task so the builder gets specific guidance,
not a re-statement of the original goal.

## FOLDED FROM "Loop Engineering" research (Avi, 2026-06-14)

The datasciencedojo loop-engineering guide names guardrails we were missing.
Both folded into the build:

6. **No-progress detection (REQUIRED guardrail).** The verify worker records a
   fingerprint of each round's assembled result. If round N's fingerprint equals
   round N-1's, the corrective work produced NO change ("silent failure" /
   "insistent failure" — the article's hardest-to-catch mode). Don't burn the
   remaining rounds: escalate to human immediately with the diagnosis. Lives in
   the verify-result handler (E5), alongside the round cap.
7. **Deterministic-first verification.** The article: verification must be
   deterministic (tests/type-check) OR a separate evaluator — never agent
   self-assessment alone. Our verify worker IS the separate evaluator (good), but
   the orchestrator-verify skill now instructs: for any criterion checkable by a
   command (tests pass, build green, lint/type clean), RUN it and judge on the
   real exit/result; reserve LLM judgment for genuinely subjective criteria. A
   criterion marked PASS on a deterministic check is more trustworthy than
   "looks done".

These cost almost nothing relative to the loop and close the two failure modes
the article stresses most (silent failure + weak verification). The three
runaway ceilings (max_verify_rounds + budget breaker + retry cap) stay; the
no-progress detector is a FOURTH, earlier guard.
