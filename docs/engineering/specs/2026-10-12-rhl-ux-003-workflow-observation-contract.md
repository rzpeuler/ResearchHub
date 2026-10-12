# RHL-UX-003 Workflow Observation Contract

Status: Implemented for CTO acceptance

## Authority and scope

`WorkflowService` remains the sole in-process authority for Workflow status, stage history, Provider observations, Skill observations, and observation revision. The observations are part of `WorkflowRunView`; they are not a second scheduler, event bus, or persistence database. Existing `GET /api/workflows/:runId` returns the current safe snapshot.

Run status and terminal status retain their existing meanings. `observationRevision` increases when the authoritative snapshot changes. A client may keep the highest revision it has seen and ignore older snapshots. Run state is process-local: a Runtime restart does not resume execution. The durable Conversation–WorkflowRun association may identify a lost run, which the Client renders as interrupted rather than running.

## Stage lifecycle

Stages exist only after a producer calls `startStage` at a real Workflow boundary. Company Research currently reports, in execution order:

| Stage ID | Display label | Producer boundary |
| --- | --- | --- |
| `identity_validation` | 研究对象校验 | ResearchService identity resolution |
| `data_acquisition` | 数据获取 | Company Research DataResolver completes acquisition |
| `research_synthesis` | 研究综合分析 | CompanyResearchSkill synthesis/baseline returns |
| `quality_gate` | 证据质量门 | Research quality gate evaluates acquired evidence |
| `knowledge_gateway` | Knowledge Gateway | Authorized Gateway submission or explicit no-write decision |
| `report_generation` | 研究报告生成 | ResearchReport is validated and materialized |
| `report_persistence` | 报告保存 | Report write completes |

Stages use `pending` only as a contract value; producers currently emit a stage at `running` and later finish it with `completed`, `skipped`, `failed`, `blocked`, or `cancelled`. A finish with no matching running stage is ignored. Duplicate starts, duplicate finishes, updates after a stage is terminal, and updates after the Workflow is terminal are idempotent no-ops. Workflow terminal closure closes any still-running stage at the actual enclosing terminal timestamp. Durations are non-negative and omitted when the start timestamp is unavailable or invalid. No percentage is derived from stage count.

## Provider observations

Company Research projects only allowlisted Provider IDs and labels: `akshare` / 结构化数据, `cninfo` / 上市公司公告, and `gdelt` / 新闻资料. Status is derived from actual acquisition attempts and usable returned data:

- `success`: usable data and no observed empty/failed attempt for that Provider.
- `partial`: at least one usable result and at least one observed empty, unsupported, or failed attempt.
- `unavailable`: an actual attempt occurred without usable data and without a classified failure.
- `failed`: attempts failed and yielded no usable result.
- `skipped`: no Provider attempt was made.

Diagnostic codes preserve the distinction between failed and unsupported attempts: `PROVIDER_ATTEMPT_FAILED` represents an attempted operation that failed, while `PROVIDER_UNSUPPORTED` records an operation the configured adapter cannot perform. Unsupported operations do not set `providerAttempted` or `providerFailed`, and a Provider with no actual attempt remains `skipped`.

Counts represent usable records only where the source returns countable external records; structured AKShare observations do not claim a record count. Acquisition is concurrent across requirements, so timestamps describe the earliest actual attempt start through the latest actual attempt completion for that Provider, not summed provider CPU time. Invalid or reversed intervals are omitted and receive `PROVIDER_TIMING_INVALID`. Provider outcomes are currently published when the acquisition bundle is complete; a long-running acquisition does not yet emit per-attempt live updates.

## Skill observations

Company Research reports `company_research_synthesis` only around the actual `CompanyResearchSkill` call. The observation is `completed` when the skill returns a result, including its deterministic evidence-bounded fallback. Its safe summary distinguishes a reasoning-executor result from the deterministic fallback. Exceptions that escape the skill are reported as failed; the skill's existing fallback for executor timeout or invalid output is visible as fallback and does not change research semantics.

Pi Agent tool calls remain Agent Activity events. Provider observations remain acquisition results. Neither is mislabeled as a Workflow Skill.

## Safety projection

Observation labels and summaries are bounded and pattern-filtered for paths and common credential forms. Diagnostics crossing the observation API must match stable uppercase diagnostic codes (`[A-Z][A-Z0-9_]{0,63}`). Failed Workflow error summaries are restricted to stable diagnostic codes; other free-form adapter/provider/identity text becomes `Workflow execution failed; details were omitted.` Raw errors and stacks are not part of `WorkflowRunView`. Provider IDs and labels are selected from a producer allowlist. React renders textual values as escaped text.

## Recovery and results

For a live process, the existing Workflow polling path re-queries `GET /api/workflows/:runId`, so refresh and conversation return recover the authoritative current snapshot. Polling stops on a terminal state, preserves the last trusted snapshot during temporary failure, and ignores stale run responses. Terminal report, bundle, and review links use the existing result projection and are shown only when verified against the corresponding result store. A request that had no durably recorded terminal state when Runtime restarts is interrupted and is never represented as resumed execution. A terminal outcome already recorded from `WorkflowService` remains terminal in the accepted-request ledger; when its detailed run snapshot is unavailable, the Client shows the known outcome and explains that stage details are unavailable.

The durable accepted-request Activity is reconciled when the associated dispatch completion settles: Runtime reads the terminal status from `WorkflowService`, then persists `workflow_completed`, `workflow_blocked`, `workflow_failed`, or `workflow_cancelled` with its finish time. `completed_with_review` maps to the completed request outcome while the run retains its more specific status. The UI derives elapsed time from the accepted/start/finish timestamps; it does not keep an ended run's Activity timer running. Dispatch failure before a confirmed Workflow start stays a dispatch failure and is not promoted to a Workflow terminal outcome.

Before association, the accepted request may contain a reserved Run ID. Runtime summaries may use it only after recovery marks that accepted dispatch `interrupted`; a live `submitting` reservation is never presented as a confirmed Workflow. After recovery, the registry ID and reservation preserve an interrupted Workflow card, but the `workflowRunId` field remains unset unless `WorkflowService` start was confirmed. This avoids implying a run that may never have started.

## Current coverage boundary

Only `company_research` has fine-grained stage, Provider, and Skill observations in this task. All registered Workflows retain WorkflowService-level pending/running/terminal status, total start/completion timestamps, revision, and the result references produced by their existing dispatch/service paths. Other registered Workflows do not receive synthetic stages in this change.

| Workflow ID | Fine-grained stage / Provider / Skill coverage | Shared WorkflowService coverage |
| --- | --- | --- |
| `company_research` | Real identity, acquisition, synthesis, quality, Knowledge Gateway, report generation, and persistence boundaries; allowlisted acquisition Provider outcomes; Company Research synthesis Skill | Yes |
| `industry_research` | None added; no generic phases inferred | Yes |
| `theme_framework` | None added; candidate and human acceptance boundaries remain owned by the existing workflow | Yes |
| `earnings_review` | None added | Yes |
| `valuation` | None added | Yes |
| `event_research` | None added | Yes |
| `thesis_red_team` | None added | Yes |
| `thesis_lifecycle` | None added | Yes |
| `daily_intelligence` | None added | Yes |

Observation timestamps are available for the overall run and each explicitly emitted Company Research stage or completed acquisition Provider interval. There is no finer live timestamp/status for individual concurrent acquisition attempts in this change. Historical detailed stage progress is not persisted across Runtime restart; only the Conversation association and accepted Activity ledger survive, and the UI says the run was interrupted.
