# Free Research intent and execution visibility acceptance

Baseline: `9265566`. Delivery branch: `codex/free-research-observability-fix`.
Contract: [approved implementation](../specs/2026-10-14-free-research-intent-observability.md).
Evidence: [regression and live receipt](2026-10-14-free-research-intent-observability-evidence.json).

## Delivered behavior

- LLM routing accepts object names before execution identifiers, resolves them
  through the trusted directory, and generates registered Workflow arguments.
  Full names/codes start when unique; pinyin, initials and name fragments show
  all matching candidates. Selection, missing goals and missing inputs continue
  the same operation with preserved policies and idempotent confirmation.
- One semantic repair attempt remains. Permanent semantic/model failure is
  explicit, with classified safe diagnostics rather than a false contract warning
  and silent free-chat fallback. Historical cutoffs cannot be invented.
- Sidecar v3 supports v2 reads, multiple tool-started Workflow associations,
  safe tool activity and pending clarification. Agent stop cancels preparation
  or waiting; started Workflow cancellation is separate.
- Timeline and right panel show real request/task/stage/source state, errors,
  elapsed time and verified artifact actions. Tool-only messages no longer
  create empty assistant answers. The composer keeps interaction controls.
- Company acquisition deadlines cover response bodies, parser signals and the
  whole acquisition budget. Completed evidence survives source timeouts; quality
  gates are unchanged. Native parsing is not labelled as an active download.

## Validation

- Backend and client TypeScript checks and production client build passed.
- Full Node regression: **2275 passed / 21 failed / 2296 total**. The exact
  `(filePath, testTitle)` failure set equals the original baseline's 21 failures.
- Full client regression: **196 passed / 5 failed / 201 total**. The exact failure
  set equals the original baseline's five failures. There are no new failures.
- After the final live-review corrections, 75 focused tests passed, including
  terminal request synchronization over real HTTP/SSE, confirmation binding and
  idempotency, independent cancellation, body/parser deadlines and partial evidence.
- Isolated provider-free browser acceptance verified candidate persistence after
  refresh, selected-object continuation, source activity in timeline/right panel,
  Agent stop with a still-running task, per-task cancellation, empty-message
  suppression and a connected SSE indicator. This is not external-provider proof.
- Root-launched live Runtime used `openai-codex/gpt-6-luna`. The original request
  selected `company_research` in **one semantic attempt**, with verified
  `东山精密 / 002384 / SZ`. `dsjm` returned the actual directory candidate and
  waited for selection. Confirmation started a Workflow, and its duplicate
  returned the same run ID. Browser and API showed real structured-data,
  discovery, download, body-read and parsing activity. Acceptance runs were then
  cancelled explicitly. Knowledge writes were disabled and KB revision stayed 6.

## Limits and preservation

This repair does not claim an all-green inherited suite or a completed live
research report. Some live provider payloads were unusable; those outcomes remained
visible. Parser/provider availability and evidence sufficiency still determine
whether a future report completes or is blocked.

The pre-existing `server.ts` Theme Framework persistence change is preserved in
the working tree and excluded from this repair's commit. Test-generated historical
evidence files are restored to their baseline content. Operational acceptance
artifacts stay under ignored `runtime-data/acceptance/free-research-fix`.
