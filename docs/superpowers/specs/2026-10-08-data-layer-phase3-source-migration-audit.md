# RHL-DL-GOAL-003 Source-Level Migration Audit

**Baseline:** `7648507243819b22a327b68fed4b5fb540f8ff30` (promoted Phase 2)
**Branch:** `codex/dl-goal-003-company-event-thesis-migration`
**Audit status:** completed before Phase 3 implementation

This audit records the live Company Deep Research, Event Research, and Thesis
Red Team acquisition paths. It is based on the workflows, their runtime
composition, Plugin contracts/adapters, Data Layer contracts, and the frozen
Event and Thesis Red Team architecture documents. It is the source-level basis
for the Phase 3 design; it does not change research methodology or Knowledge
contracts.

## Current migration matrix

| Workflow / purpose | Current provider and execution owner | Data semantics and time | Authority and deduplication | Roles, outcomes, and Knowledge effect | Target Data path / retained Workflow work |
|---|---|---|---|---|---|
| Company — basic profile | `CompanyDeepResearchWorkflow.acquireStructuredData` calls `akshare.companyBasic`; runtime supplies `AkshareDataAdapter`. Workflow validates the raw payload and JSON-serializes it into a source record. | One current company profile snapshot. The call has a symbol but no `asOf` or period request; it is not a historical profile version. | AKShare is a retrieval route / aggregator (`S3_AGGREGATOR`), not the original source. No generic URL/hash dedup. Candidate identity is currently `akshare-basic-<symbol>`. | Outcome is folded into the AKShare provider count. Its source can be sent to the Company Skill and is included in Gateway evidence bindings with the other acquired sources. | `company_basic_profile` requirement; Data policy selects the AKShare operation; Plugin parses to a provider-neutral profile snapshot. Workflow keeps typed Skill mapping, quality gate, report, and Gateway orchestration. |
| Company — financial data | Same loop calls `akshare.financialData`; raw provider rows are passed as `financialData` to `CompanyResearchSkill`. | Broad latest financial-indicator rows, with report and notice dates in provider output. No requested fiscal period; a current retrieval does not prove every row was available at an arbitrary historical `asOf`. | AKShare retrieval route, not original authority. No generic dedup; payload validation only rejects unusable empty/error payloads. | Included in AKShare provider outcome. Skill sees provider-shaped data; deterministic baseline extracts only the first row's generic `metric` or `value`, while the reasoning input receives the raw structure. | `company_financial_history` requirement; Plugin converts returned rows to a neutral dated financial-data structure. Data retains date/PIT quality; Workflow maps only accepted neutral values and keeps the existing synthesis and quality-gate flow. |
| Company — market history | Same loop calls `akshare.historicalMarketData`; raw rows are passed as `marketData` to the Skill. | Historical time series with row dates. No explicit requested period or end date today, and no value-version / observation-availability evidence is supplied. | AKShare retrieval route; no generic dedup. | Included in AKShare outcome and can reach Skill/Gateway through the existing Company result/source mapping. | `company_market_history` requirement with an explicit requested end/cutoff. Plugin maps rows to neutral dated observations. Data rejects future rows and marks historical rows without availability/version proof as not PIT-verified. Workflow retains report and proposal semantics. |
| Company — official disclosures and public news | Workflow iterates `acquisitionPlugins`, calls `discover`, chooses a Plugin by candidate kind, calls `fetch`, validates content, and calls `normalize`. Runtime currently injects CNINFO and GDELT. Unknown kinds fall back to the first Plugin. | Discovery receives Company and `asOf`; the Workflow currently accepts unknown or malformed publication dates through `withinAsOf`. It caps the aggregate at `maxSources` (default 20, max 50). | CNINFO is statutory/official (`S0_STATUTORY`). GDELT is a retrieval/aggregation route (`S3_AGGREGATOR`); current GDELT normalization labels the publisher `gdelt`, without preserving an identifiable original publisher. Candidate IDs are deduplicated, but canonical URL/content hash are not. | No research source role is assigned in Company. `ResearchSignalStore.append` occurs after discovery and before fetch, so a discovered document can be projected even if later fetch fails. This is a compatibility side effect, separate from Data resolution and Intelligence. Provider outcome is finally projected from usable source count plus diagnostics. All acquired source records are passed to Gateway evidence bindings; Skill proposals still determine durable semantics. | Reuse one `company_research_evidence` identity and `COLLECT_DIVERSE` policy for CNINFO and GDELT. Data/plugin composition owns source operations, common publication-window filtering, URL/hash dedup, and provenance. Workflow retains the source cap, research-purpose filtering, existing signal projection compatibility side effect, report, quality gate, Skill mapping, and Knowledge orchestration. |
| Event — selected anchor | `resolveAnchor` in the Event Workflow resolves `user_event`, `article`, `url`, or exact `daily_signal` via `DailySignalStore.getById`; validates company match, date, URL safety, and deterministic fingerprint. | Anchor date and explicit `asOf` remain Workflow semantics. Daily signal `publishedAt`, not `discoveredAt`, may supply event date. URL/article anchors are context and do not authorize arbitrary fetching. | Anchor is not an external provider and must not become a Common Data identity. | `anchor_context` is a research role. A daily signal is context only and is not Gateway evidence. | Keep anchor validation, Daily Signal lookup, company match, date derivation, fingerprint, and URL safety entirely in Workflow. No `dailySignalStore` to Catalog path. |
| Event — CNINFO evidence | `acquireEventSources` locates the CNINFO Plugin by name, discovers up to six candidates, filters provider/company/date/window/URL, then fetches and normalizes through Plugin methods. | Uses `asOf` and event-centered `eventWindowDays` (default 7, maximum 30); future/invalid dates are excluded, unknown dates are counted and may be retained, and dated candidates outside the event window are excluded. | CNINFO origin is statutory. Dedup is canonical URL then content hash across both providers. | CNINFO initially maps to `verification`; Stage A can reclassify it as supporting, contradicting, or background. Transport, fetch, usable-source counts are tracked separately. Only proposal-referenced evidence is bound through Gateway. | `company_research_evidence` requirement with `period.start/end` and `analysisAsOf`; Data/Plugin owns generic date eligibility, provenance and dedup. Workflow maps evidence and retains source roles, verification level, event impact, and durable proposal gating. |
| Event — GDELT/news evidence | Same Event loop invokes the GDELT Plugin; discovery, fetch, and normalization are directly Workflow-owned. | Same event window and cutoff. Unknown dates remain contextual but cannot establish strong verification. | GDELT is an aggregator/retrieval route, not automatically the original publisher. Current Plugin sets normalized `publisher` to `gdelt`; provenance must not inflate its authority. Same cross-provider URL/hash dedup as CNINFO. | GDELT initially maps to `supporting`; Stage A can label contradictions/support/background. Provider outcome distinguishes discovery transport from successful fetch and usable count. | Same shared identity/policy and bounded period. Preserve any reliable article-origin identity separately from retrieval provider; if unavailable, keep original publisher unknown and authority at aggregator level. Workflow retains research roles and verification. |
| Thesis Red Team — Daily Signal context | `signalContext` lists recent company signals from the Daily Signal store (30-day lookback, maximum 20) before Stage A. | Uses current run time and the store window; this is existing context, not an external evidence request. | No provider call or generic dedup is part of this path. | Signals feed attack/synthesis context only. They are not external evidence, are not Data inputs, and are not canonicalized. | Preserve the current independent signal context. No Data Catalog identity or resolver operation. |
| Thesis Red Team — CNINFO/GDELT external evidence | `acquire` filters Plugin names, then each Workflow loop calls `discover`, `fetch`, and `normalize`. It directly applies date filtering and URL/hash dedup. | `asOf` plus `lookbackDays` (default 365, range 30..1095); dated future/older items are filtered. Invalid and missing dates currently collapse into “unknown” and can enter context. Up to six discovered candidates per Plugin and 12 normalized sources overall. | CNINFO is statutory origin; GDELT is the retrieval/aggregation route. Dedup is URL if present, otherwise content hash. No event-style company-symbol filtering is applied in this loop. | Stage A attack design runs before acquisition; Stage B receives bounded evidence and signal context. Evidence qualification, verdict consistency, proposal gating, and Gateway binding determine durability. Runtime reads Thesis and Company hashes before/after; Thesis ID, lifecycle, sourceRefs, and hash must stay unchanged. | Shared `company_research_evidence` identity, with a requirement period `[asOf-lookbackDays, asOf]`. Data/Plugin own operation selection, common PIT, provenance and generic dedup. Workflow retains Stage A/B ordering, attack semantics, evidence qualification, proposal durability, signal context, telemetry, report, and Thesis immutability checks. |

**Runtime wiring finding:** `OfficialDisclosureResearchPlugin.name` is
`official-disclosure-research-acquisition`, while the current Thesis workflow
filters plugins by `/cninfo|gdelt/`. The normal runtime therefore skips the
configured CNINFO Plugin and attempts GDELT only. The migration must route the
official adapter by its explicit Data operation, not by Plugin name, and must
report the newly exercised CNINFO leg truthfully.

## Catalog identity decision

Add only identities for the stable external inputs actually consumed by the
current code:

| Proposed Common identity | Data kind | Meaning / consumer | Policy intent |
|---|---|---|---|
| `company_basic_profile` | `evidence` | Current structured company profile snapshot; Company Deep Research. | `FIRST_VALID`; one explicit AKShare operation. No claim that the snapshot is historically versioned. |
| `company_financial_history` | `evidence` | Company financial-indicator dataset with row-level period/publication fields; Company Deep Research. This is a dataset input, not a single financial conclusion. | `FIRST_VALID`; one explicit AKShare operation. Preserve dates and label historical availability unverified when the source provides no value-version proof. |
| `company_market_history` | `timeseries` | Company historical market observations; Company Deep Research. | `FIRST_VALID`; one explicit AKShare operation. Bind the runtime period end and keep observation date distinct from availability/retrieval. |
| `company_research_evidence` | `evidence` | Explicitly requested company-scoped external documents/news used by Company, Event, and Thesis Red Team. It describes source material, not verified facts, event impact, or thesis conclusions. | `COLLECT_DIVERSE`; independently attempt CNINFO and GDELT so one success cannot hide the other source outcome. Apply consumer periods at runtime. |

Company, Event, and Thesis all request company-scoped external research
evidence, so they share one identity. Their Workflow identities, periods,
caps, and research-role semantics remain separate. Event anchors and Daily
Signals are not cataloged. No identity is proposed for a research conclusion
or an Industry metric.

## Data-owned policy/executor semantics

- Data policy candidates represent explicit CNINFO and GDELT operations;
  there is no global provider registry or auto-discovery.
- `COLLECT_DIVERSE` is required for `company_research_evidence`: the current
  resolver executes every eligible candidate and records each attempt. A
  failure or empty result from one source remains visible beside another
  source's success. It does not reconcile contradictory evidence.
- Structured Company profile, finance, and market requirements each use one
  explicit AKShare operation with `FIRST_VALID`; the mode is not being used to
  express a fallback that does not exist.
- Provider-specific list/discover/fetch/parse operations stay in Plugin code.
  Common URL/content-hash dedup and date-window eligibility move to Data-owned
  helpers. Workflow-owned research-purpose/source caps can still narrow the
  resolved material after Data returns it.
- CNINFO authority remains `S0_STATUTORY`; GDELT's route remains
  `S3_AGGREGATOR`. The original article publisher is separate and is recorded
  only when the adapter has reliable evidence for it.
- Per-document publication time, retrieval time, original publisher, URL,
  content hash, and retrieval provider must remain attributable through the
  resolved evidence bundle. Missing dates may remain report-only/contextual
  when existing methodology allows, with `pointInTimeSafe=false`; invalid,
  future, or out-of-period dates cannot be treated as qualified historical
  evidence.

## Fixed research and persistence boundaries

- Company Skill does not call DataResolver. Provider-shaped AKShare payloads
  must be converted at Plugin or deterministic Workflow adapter boundaries to
  neutral structured Company data before Skill input mapping.
- Event anchor validation, source roles, evidence assessment, verification,
  event impact, and semantic duplicate-event judgment stay in Event Workflow
  and Skill. Only generic URL/content identity dedup moves to Data.
- Thesis Stage A attack design, Stage B evidence qualification, verdict
  consistency, proposal filtering, and Gateway interaction remain unchanged.
  No targeted attack-vector query is claimed where current providers only
  accept Company plus cutoff.
- Daily Signal context remains separate from external research evidence. The
  existing Company signal-store projection remains a Workflow compatibility
  side effect and is not moved into Data, policy, Plugin executor, or a new
  Intelligence registry.
- Only evidence used by accepted durable proposals reaches the Event/Thesis
  Gateway bindings. Existing Company source-binding behavior is preserved
  unless a deterministic regression proves a migration-only difference.
- Knowledge schemas, Writer, Gateway semantics, Thesis lifecycle operations,
  Industry research, and Daily Intelligence remain out of scope.

## Source evidence reviewed

- `workflows/company-deep-research/workflow.ts` and `contracts.ts`
- `workflows/event-research/workflow.ts` and `contracts.ts`
- `workflows/thesis-red-team/workflow.ts` and `contracts.ts`
- `skills/company-research/skill.ts` and `contracts.ts`
- `plugins/research-acquisition/contracts.ts`, `akshare.ts`, `official.ts`,
  and `gdelt.ts`
- `data/contracts.ts`, `requirements.ts`, `source-policy.ts`,
  `workflow.ts`, `resolver.ts`, and `common-catalog.ts`
- `app/services/research-service.ts` and `app/runtime/application-runtime.ts`
- `docs/architecture/PERSONAL_RESEARCH_V1_EVENT_RESEARCH_V0.1.md`
- `docs/architecture/PERSONAL_RESEARCH_V1_THESIS_RED_TEAM_V0.1.md`
- `docs/architecture/RESEARCHHUB_DATA_LAYER_ARCHITECTURE_V1.md`
- `docs/engineering/reports/2026-10-07-data-layer-foundation-goal-001.md`
- `docs/engineering/reports/2026-10-08-data-layer-phase2-valuation-earnings.md`
