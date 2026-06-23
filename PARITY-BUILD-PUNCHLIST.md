# Claude-Code-Desktop Parity — Build Punch-List

Status as of this build. All 6 phases delivered via TDAD (Gherkin spec → RED →
build → GREEN), with typecheck + full vitest + gap + drift gates after each.
Orchestrated by Opus 4.8; PAL free models (gpt-oss-120b, qwen3-32b,
llama-3.3-70b, gemini-2.5-pro) advised each phase's schema/tests/security/a11y.

## What shipped (all committed on branch feat/active-sessions-new-chat-btn)

| Phase | Commit | Module(s) | Tests |
|---|---|---|---|
| P0 | 598f6ab | src/shared/agent-events.ts | 13 |
| P1 | 598f6ab | src/shared/diff-model.ts, screens/Diff/DiffView.tsx, reveal-in-folder IPC | 20 |
| P2 | 25fcca5 | src/shared/review-anchor.ts, DiffView comment UI + Review-code | 15 |
| P3 | da68126 | src/shared/panel-layout.ts, screens/Layout/RightPanel.tsx | 13 |
| P4 | db9ec89 | src/shared/preview-model.ts | 22 |
| P5 | 6c64315 | src/shared/p5-models.ts | 17 |
| P6 | a405530 | src/shared/design-tokens.ts | 12 |

Full suite at completion: **1603 passed / 9 skipped, 151 files** (started at
1464 → +139 new tests, zero regressions). Every phase: drift = 0 net-new bugs,
only intended files touched. Two existing files extended (icons/index.tsx +
i18n/index.ts) — additive only.

## DEFERRED — needs Avi (input / environment / hardware I can't reach)

### 1. Visual sign-off (HIGH — the one thing tests can't prove)
DiffView, RightPanel, the auto-ticking todo, and any preview render are
LOGIC-tested but not PIXEL-verified. Tests are blind to CSS clipping, z-index,
overflow. Needs a CDP screenshot against the RUNNING app — which I can't drive
while the desktop app hosts my session.
ACTION: run the app, open the new panes, eyeball; or run scripts/drive-live-
regression-suite.js style CDP capture. Recipe: hermes-desktop-dev skill →
references/cdp-visual-validation.md.

### 2. Wire the panes into the live app (DONE for RightPanel; DiffView pending)
DONE (commit d7e63de): <RightPanel> is now mounted in Chat.tsx, fed live by the
useAgentPanel hook which folds the chat transport's event stream (opt-in
onAgentPanelEvent tap — isolated, cache-safe). Default-hidden, toggled by a
PanelRight toolbar button, persisted in localStorage. 5 hook tests + existing
transport tests green.
REMAINING:
- Emit the 6 agent events (todo/task/diff/review/plan/usage.update) from the
  Python agent core over the existing IPC channel — until the core emits them,
  the panel renders empty (the fold path is proven by tests).
- Mount <DiffView/> where diffs are surfaced; feed onAddComment -> review-anchor.

### 3. Monaco diff editor (LOW — drop-in upgrade)
P1 ships a dependency-free side-by-side renderer. The diff-model already
supports a Monaco-backed viewer; swap when desired (add monaco-editor dep).

### 4. <webview> partition wiring + auto-verify loop (MEDIUM)
P4 delivered previewPartition / classifyPreviewTarget / verify reducer (tested).
Wiring per-project partitions into the existing <webview partition="..."> in
src/main/app/start.ts + WebPreviewPanel.tsx, and driving the real screenshot/
DOM/click/fix browser loop, needs the running app.
SECURITY NOTE: partition hash is pure FNV-1a (renderer-safe). If you want a
hard boundary, have the main process re-derive the same partition name with
SHA-256 over the normalized path.

### 5. GitHub token (P5 CI live calls)
ciSummary / canAutoMerge / shouldAutoFix gating logic is tested. Live CI status,
auto-fix, and auto-merge need `gh` authenticated + the status bar wired to it.

### 6. OS keychain (P5 connectors)
Connectors/plugin-manager UI credential storage was scoped out of the pure
models. Needs keychain integration when that UI is built.

### 7. Install / package (your call, your two-phase rule)
I did NOT build or swap anything into the live app. When ready:
- build:unpack → stage app.asar.new + hermes-agent.exe.new
- run your Update Hermes.bat (quits app, atomic swap, relaunch)
Never swap the live app from an agent session — it hosts the session.

### 8. Housekeeping (LOW)
- vitest.config.ts: pre-existing `poolOptions` v4 deprecation warning (not mine)
  — one-line migration to top-level pool options.
- CRLF: git normalizes via .gitattributes; warnings are cosmetic.

## How to resume any deferred item
Each model is pure and imported by relative path (../../../../shared/<name>).
The wiring items (2, 4) are "subscribe + mount" — no new contracts needed; the
reducers/selectors are the stable API the panes consume.
