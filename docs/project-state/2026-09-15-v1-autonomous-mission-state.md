# ResearchHub V1 Autonomous Mission State

Updated: 2026-09-16

## Mission

Deliver a locally runnable V1 for personal A-share investment research with a
real public-data research loop, professional reports, evidence-backed
structured Knowledge, provenance, durable change, reload, and subsequent
research reuse.

## Repository checkpoint

- Branch: `main`
- Latest implementation commit: `c1a39bd` (`feat: restore official industry evidence path`)
- Remote: `origin/main` synchronized after fetch/push verification
- Working tree: clean
- Phase 0: `ACCEPTED`
- Phase 1: `ACCEPTED`
- Phase 3 critical path: `ACCEPTED_BOUNDED_V1`

## Current Capability Matrix

| Capability | State | Current evidence / gap |
| --- | --- | --- |
| Knowledge durable write, validation, revision | IMPLEMENTED_AND_VERIFIED | v0.4 Gateway, ChangeSet, Writer, stale revision/hash guards, and replay tests pass. |
| Raw/Source provenance | IMPLEMENTED_AND_VERIFIED | Content-derived Raw identity, Source-to-Raw links, rights/provenance validation, and ingestion tests pass. |
| Reload/restart/ReviewCase persistence | IMPLEMENTED_AND_VERIFIED | Runtime and storage tests cover reload and durable ReviewCase state. |
| Exact replay/idempotency | IMPLEMENTED_AND_VERIFIED | Ingestion and Industry replay tests preserve identity and avoid duplicate revisions. |
| Company Research | IMPLEMENTED_AND_VERIFIED | Company workflow, report, evidence, Gateway path, and accepted real-Pi evidence exist. |
| Earnings Review | IMPLEMENTED_AND_VERIFIED | Deterministic and real-Pi gate evidence exists, including report and replay. |
| Valuation | IMPLEMENTED_AND_VERIFIED | Deterministic calculation, scenarios, report, persistence, and route tests exist. Five consecutive VAL-HTTP-001 runs passed; the earlier timing failure was not reproduced. |
| Event Research | IMPLEMENTED_AND_VERIFIED | Direct/second-order impact, report, Gateway/Writer, and real-Pi evidence exist. |
| Thesis Red Team | IMPLEMENTED_AND_VERIFIED | Stage A/B, invalidation, evidence binding, report, and real-Pi evidence exist. |
| Industry eight-module deterministic loop | IMPLEMENTED_AND_VERIFIED | Eight modules, bounded Wave 2, one Gateway/Writer, sixteen sections, graph and replay tests pass. |
| Industry bounded second-target generality | IMPLEMENTED_AND_VERIFIED | Deterministic `AI Server Hardware` validation completed eight modules, one Gateway/Writer submission, canonical reload, and stable no-new-semantic replay. |
| Industry alias and bounded evidence-context routing | IMPLEMENTED_AND_VERIFIED | Bounded aliases, compound design terms, Chinese module terms, module-specific evidence ranking, safe same-domain CPCA attachments, rich-article preservation, bounded provider intake of 12 within the total source cap of 24, bounded four-way candidate acquisition concurrency, official CNINFO Industry full-text discovery, and module-relevant windows from long normalized documents participate in routing without changing evidence qualification or persistence boundaries; focused regressions and full suite pass. |
| Industry real product-quality E2E | IMPLEMENTED_AND_VERIFIED | Latest TEST-054 completed one bounded wave, attempted all seven providers and all eight modules, submitted one Gateway/Writer ChangeSet, reloaded canonical Knowledge, and generated the validated 16-section report. It produced 24 qualified public evidence items (13 official CNINFO/MIIT tier-1 and 11 CPCA tier-4); all modules returned supported or partial results, the strict classifier is `INDUSTRY_PRODUCT_QUALITY_READY`, and 21 explicit research gaps remain visible. Fixtures remain test-only. |
| Industry graph projection | IMPLEMENTED_AND_VERIFIED | Existing directory/rooted graph APIs and Industry replay tests pass; the latest real product-quality run persisted and reloaded the validated Industry evidence graph. |
| Morning/Evening Brief engine | IMPLEMENTED_AND_VERIFIED | Fresh FIX-003 real-Pi run completed both morning/evening briefs with enrichment, change assessment, synthesis, and Knowledge seed/Gateway context; no secrets or raw bodies were included. |
| Daily live-provider coverage | PARTIAL_EXTERNAL_PROVIDER_COVERAGE | Current live smoke has usable CNINFO company announcements; GDELT, RSS, institutional, community, and AKShare probes retain empty, HTTP 429/521, or bounded bridge-failure outcomes. No fabricated fallback is allowed. |
| Runtime HTTP/SSE/security/attachments | IMPLEMENTED_AND_VERIFIED | Bootstrap, loopback/origin/token controls, SSE, upload, cancellation and product route tests pass. |
| Managed Docling parser | IMPLEMENTED_AND_VERIFIED | Preflight is `READY`; MIIT PDF fetch/normalization smoke was accepted. |
| Unified Continuous Research maintenance | IMPLEMENTED_AND_VERIFIED_BOUNDED_V1 | The bounded Daily path identifies tracked Entities, projects existing Claims/Theses, assesses materiality and Thesis impact, and performs governed update/contradict/replay handling. A broader generic cross-workflow scheduler is outside the V1 criterion and prohibited architecture expansion. |
| First-class research UI | PARTIAL_RUN_LAUNCHER | Conversation, upload, graph, review, polling, dedicated Daily Briefs, report catalog, and governed launch forms for six research workflows exist; Review decisions remain read-only. |
| Review decision execution | DESIGN_ONLY | Review access is read-only; decision mutation remains intentionally absent. |
| Legacy Web-Chat2Codex control plane | DEPRECATED | Phase 0 removed `.web-chat2codex/**` and `docs/governance/**`; product Codex/Pi integration remains. |

## Task queue

| ID | Phase | Status | Goal / acceptance |
| --- | --- | --- | --- |
| RHL-P0-CLEANUP | 0 | ACCEPTED | Remove legacy control-plane assets, preserve product behavior, and pass post-cleanup checks. Commit `5bb59a4`. |
| RHL-P1-REALITY | 1 | ACCEPTED | Establish this matrix and backlog from current source, tests, reports, and live evidence. |
| RHL-P3-INDUSTRY-ROUTING | 3 | ACCEPTED_IMPLEMENTED_AND_VERIFIED | Route official CNINFO/MIIT PCB evidence to Industry modules, preserve bounded search terms, keep accepted-evidence telemetry truthful, and verify fresh real TEST-054. Implementation commit `c1a39bd`; strict product-quality gate is READY. |
| RHL-P3-INDUSTRY-GENERALITY | 3 | ACCEPTED_BOUNDED | Rerun the Industry flow against `AI Server Hardware`; eight modules, one Gateway/Writer submission, canonical reload, and stable no-new-semantic replay passed. |
| RHL-P3-INDUSTRY-ALIAS-ROUTING | 3 | ACCEPTED_IMPLEMENTED_AND_VERIFIED | Include bounded target aliases and compound terms in Industry evidence routing; focused regressions and fresh real TEST-054 passed with all eight modules covered. |
| RHL-P1-TEST-HEALTH | 1 | ACCEPTED_RECONCILED | Five consecutive `VAL-HTTP-001` runs passed; no valuation semantic change was made and the prior timing failure was not reproduced. |
| RHL-P2-DOCUMENT-STATUS | 2 | ACCEPTED | Reconcile current entry documents with verified source/test reality while preserving historical architecture and task-report evidence. |
| RHL-P2-CONTINUOUS-RESEARCH | 8 | ACCEPTED_BOUNDED_DAILY_SLICE | Implement and verify the bounded Daily maintenance path through existing Claim projection, Gateway/Writer, reload, and replay; broader unified maintenance remains open. |
| RHL-P1-UI-EXPOSURE | 1 | ACCEPTED_DAILY_BRIEF_READER | Expose the existing bounded Daily Brief list/detail API as a read-only UI route; general report catalog and direct launch forms remain open. |
| RHL-P1-UI-REPORT-CATALOG | 1 | ACCEPTED_IMPLEMENTED | Add a read-only general report list/detail route over existing persisted Research Reports without adding workflow launch forms or mutation paths. |
| RHL-P1-UI-RESEARCH-RUN-LAUNCHER | 1 | ACCEPTED_IMPLEMENTED | Add a governed `/run` surface for the six existing research Workflow endpoints; preserve Runtime token, server validation, and asynchronous polling boundaries. |
| RHL-P2-REVIEW-DECISIONS | 5 | DEFERRED | Requires an explicit product decision for write-capable Review actions; keep current read-only boundary until then. |

## Acceptance gates

- [x] Phase 0 cleanup accepted and synchronized.
- [x] Typecheck, client typecheck, client build, parser preflight, and full product test suite pass after the latest Industry evidence changes (Node `987/987`, client `27/27`; Vite emitted `dist/client`).
- [x] Industry strict product-quality evidence gate completes with one wave, eight modules, report/canonical/reload path, and explicit research gaps preserved.
- [x] Industry flow is rerun against a second distinct research target for bounded generality.
- [x] Remaining deterministic test health is explicitly reconciled; five consecutive VAL-HTTP-001 runs passed.
- [x] New Evidence can enter the bounded Daily Continuous Research path, link to existing Knowledge/Thesis state, assess material change, and replay through Gateway/Writer without duplicate revision; no generic cross-workflow framework is required by V1.
- [x] The read-only general Research Report catalog is implemented, validated, committed, and synchronized.
- [x] Final external validation requirements are listed with completed, external-blocked, and explicitly deferred boundaries in `docs/task-reports/2026-09-15-final-external-validation-inventory.md`.

## Current decision

The Industry routing implementation and bounded second-target generality are
accepted. The latest live Industry workflow completes all eight module calls in
one bounded wave and reaches the strict product-quality READY gate with real
CNINFO, MIIT, and CPCA evidence; module-specific ranking and the official
full-text route are covered by focused tests and the live run. Twenty-one
research gaps remain explicit in the report and are not treated as facts.
Continue using fixtures only for deterministic tests; never present
placeholders as real evidence or persist them as production research output.
Do not add providers without a demonstrated source gap, relax evidence
qualification, create a generic research framework, or treat historical
reports as current acceptance.
