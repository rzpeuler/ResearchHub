# RHL-UX-IA-001 Artifact Relationship Matrix

Status: implementation relationship audit. Scope: current registered dispatch bindings and existing direct application services. This matrix describes persisted artifacts, rather than promising outputs based on registry labels.

## Research type matrix

All Workflow rows below create a real tracked Workflow run only after dispatch reaches `started`; validation, missing-input and executor-unavailable responses do not create a research Bundle. Dispatch attempts a Bundle for terminal results, failure and cancellation when a Bundle store is configured. A Bundle persistence failure produces a safe diagnostic and does not imply that a Bundle exists. Direct domain service calls do not pass through dispatch Bundle persistence.

| Registered dispatch ID | Research Report production | Dispatch Bundle | Tracked WorkflowRun | Direct-service distinction |
| --- | --- | --- | --- | --- |
| `company_research` | Conditional: completed output and some quality-blocked report-only paths; early blocked/failed/cancelled runs may have no Report | Attempted on terminal/failure/cancel paths | Yes | `ResearchService.startResearchCompany` may persist Report, never itself creates a Bundle |
| `industry_research` | Conditional: domain workflow returns optional report reference | Attempted | Yes | `ResearchService.startIndustryResearch` does not persist Bundle |
| `earnings_review` | Conditional: report generation succeeds after exact-period and quality gates | Attempted | Yes | Direct service does not persist Bundle |
| `valuation` | Conditional: evidence/method/quality eligibility and successful Report write | Attempted | Yes | Direct service does not persist Bundle |
| `event_research` | Conditional: successful report generation; earlier failures may have none | Attempted | Yes | Direct service does not persist Bundle |
| `thesis_red_team` | Conditional: includes completed and explicit semantic-blocked diagnostic Reports; early failures may have none | Attempted | Yes | Direct service does not persist Bundle |
| `daily_intelligence` | Conditional: new successful synthesis writes `daily_brief` ResearchReport and DailyBriefReport; non-trading-day skip has none; `already_completed` may refer to a prior Report belonging to a different run | Attempted | Yes | Direct `DailyIntelligenceService` persists brief/report without Bundle; dispatch refuses a previous-run report reference |
| `theme_framework` | No ResearchReport from this binding; result is a reviewable candidate | Attempted | Yes | Direct Theme Framework service stores candidate, not ResearchBundle |
| `thesis_lifecycle` | No Report from registered deterministic CREATE/REFRESH binding (`runThesisLifecycle`) | Attempted | Yes | Separate application Thesis Lifecycle refresh/decision services can persist `thesis_lifecycle` Reports; those services do not go through dispatch Bundle creation |
| Free Research dispatch | No ResearchReport | Session pending then constrained completed/failed Bundle | No tracked Workflow run; `free-<UUID>` is a session artifact identity | Pi session boundary; `workflowRunId` field in Bundle stores the session artifact identity, not a claim of Workflow execution |
| Skill Plan dispatch | No ResearchReport | Session pending then constrained completed/failed Bundle | No tracked Workflow run; `skill-<UUID>` is a session artifact identity | Pi session boundary, identical association rules to Free Research |

A Report can exist without any Bundle (direct service invocation or Bundle persistence failure). A Bundle can exist without any Report (failed/cancelled/blocked research, session research, Theme Framework, deterministic Thesis Lifecycle or Report persistence failure). Report quality and Bundle execution status are separate concepts.

## Trusted identity links

| Relationship | Trusted key and validation | Missing/error handling |
| --- | --- | --- |
| Report → Bundle | Persisted `Report.workflowRunId` → `GET /api/research/bundles/by-run/:runId`; returned `Bundle.workflowRunId` must equal the Report run, and `bundleId` must equal `research-bundle-${runId}` | Missing is HTTP 404; malformed/unreadable is sanitized HTTP 500; neither prevents report body reading |
| Report → Workflow history | `Report.workflowRunId` → existing `GET /api/workflows/:runId`; returned `runId` must match | Historical observation explicitly marked; missing snapshot supplies no invented stages; `interrupted` is not success |
| Bundle → Report | Optional `Bundle.report.reportId` is added only after dispatch resolves the actual stored Report or DailyBriefReport and verifies its `workflowRunId` | Absent for cancelled or unverified reports; client must also verify resolved Report run before preferring its appendix |
| Workflow → Bundle | Terminal execution projection `bundleRef` plus matching `executionResult.runId`; by-run query and returned identity checks | Persistence failure/unavailable remains a real empty/error state |
| Conversation → Workflow → Bundle | Server-owned accepted request `workflowRunId` exposed through Activity; submitting `reservedWorkflowRunId` is only a reservation and must be confirmed before claiming execution | Historical conversation Activity persists independently of active Pi Session |
| Conversation → session Bundle | New optional server-owned accepted request/Activity `researchBundleRunId`, stored when dispatch hands Free Research/Skill Plan to Pi chat | No Report or Workflow needed; fetch by this exact run ID. Legacy session requests lacking this field cannot safely recover their association |

Never associate by report title, security code, timestamps or list ordering. `sourceLibraryHits` contain existing excerpts, `sourceLibraryRef`, `rawRef`, optional canonical `sourceRef`, content hash, chunk index and provenance. They are retrieval hits, not complete source documents or inferred provenance. Report source/evidence references remain authoritative and should not be duplicated in the appendix.

## Original-conversation access gap and minimal repair

Before this task, Workflow requests already retained their exact `workflowRunId` in the durable Conversation accepted-request ledger and Activity. The client only offered the active Workflow result Bundle action, so older/no-report Workflow activities needed their own access action.

Free Research and Skill Plan had a deeper gap: dispatch generated a `free-`/`skill-` run ID, but `markReadyForChat` saved only the dispatch mode and discarded the unrelated Workflow reservation. The ID survived only in the immediate dispatch response and the prompt's client hint. After switching/restarting, no trusted Conversation key located that Bundle.

The repair adds optional `researchBundleRunId` to the existing Conversation sidecar and Activity projection without changing Report or Bundle schemas. The server stores the dispatch-generated session run at the ready-for-chat transition, validates its mode-specific prefix and UUID, prevents association changes on idempotent replay, and retains it through chat completion/interruption. Replay exposes the stored run. Prompt context and Bundle completion use the stored association even if the client omits its hint; a supplied hint referencing another operation/conversation is rejected before request claim or creation. Existing legacy records stay readable; no retroactive guess is made.

## Backend integrity and access boundary

The Bundle file validator requires internally consistent `bundleId`, `workflowRunId` and optional execution-result run/workflow identities. By-run retrieval now also verifies the loaded Bundle matches the requested run and deterministic ID, rejecting an internally valid other-run file transplanted under a different filename. Missing files return undefined/404. Direct malformed JSON/invalid content throws and the HTTP layer sanitizes the error; catalog listing skips corrupt derived records.

The existing Runtime is local-first: all API reads retain loopback Host/Origin validation; mutating requests retain Runtime-token enforcement. Report/Bundle/Workflow GET APIs do not currently implement a separate per-user or per-conversation read ACL. This task preserves that existing local-runtime boundary and does not claim multi-user ownership authorization. Session Bundle attachment is additionally bound to the accepted operation in the active conversation, so caller-controlled IDs cannot change that association. Raw Provider responses, credentials, private reasoning and arbitrary stacks must not be rendered.

## Source and validation evidence

Source audit: `app/services/workflow-registry.ts`, `research-dispatch-service.ts`, `research-bundle.ts`, `research-report.ts`, `research-service.ts`, `daily-intelligence-service.ts`, `thesis-lifecycle-service.ts`; Workflow report producers; `app/runtime/conversation-state-store.ts`, `session-runtime.ts`, `contracts.ts`, `server.ts`; `client/src/App.tsx` and Runtime client.

Targeted validation: `conversation-state-store.test.ts` covers session association persistence, immutable replay, mode/ID rejection and interruption retention. `ux-ia-session-bundle.integration.test.ts` uses real application Runtime/Pi SessionManager with an isolated faux Provider: Free Research dispatch, original-operation ownership, wrong-operation rejection, stored-ID completion, no-report Bundle retrieval, Activity recovery after Runtime restart and cross-conversation rejection. `research-bundle.test.ts` covers transplanted other-run file rejection and normal/missing by-run reads. Exact final test counts and browser evidence are recorded in the regression and E2E reports.
