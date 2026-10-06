# ResearchHub — Personal Research v1 Daily Intelligence Architecture

Status: FROZEN for M2 implementation; PASS / CLOSED by CTO acceptance at `218280579cdd7b6cfdf67506150cfa82cef4322e`
Date: 2026-09-08

## Scope

Daily Intelligence v1 adds two product workflows, `morning_brief` and `evening_brief`, for a local single-user, non-commercial research workspace. It is bounded by an explicit watchlist, canonical Knowledge tracked companies, and a small configured source catalog. It is not a generic news platform, a trading system, an institutional-consensus system, or a replacement for Company Deep Research.

The default timezone is `Asia/Shanghai`; default local run times are 08:00 and 20:30, both configurable.

## Frozen data flow

```text
Source Catalog / Watchlist
  -> Discovery / Fetch / Normalize
  -> ResearchSignal v2 (non-canonical)
  -> deterministic first-pass deduplication
  -> bounded enrichment
  -> deterministic EventSignalCluster
  -> deterministic explainable ranking
  -> Signal Store
  -> bounded Existing Knowledge projection
  -> ResearchChangeAssessment
  -> Morning / Evening Brief Synthesis
       -> ResearchReport
       -> optional local Semantic Proposals
            -> Knowledge Production Gateway
            -> validated ChangeSet -> shared Writer
```

ResearchSignal, EventSignalCluster, ResearchChangeAssessment, and Daily Brief are non-canonical workflow artifacts. News, institutional views, market observations, and community narratives do not become Claims by default. Only durable, evidence-backed semantic changes may enter the existing Knowledge Production Gateway; Daily Intelligence never allocates canonical IDs, constructs a ChangeSet, or calls a schema-specific Writer.

## Components and ownership

- `plugins/daily-intelligence/`: narrow source adapters, catalog/watchlist loading, signal persistence, deduplication, clustering, ranking, calendar, and scheduler contracts. It does not own canonical mutation.
- `skills/daily-intelligence/`: bounded signal enrichment and brief synthesis. Reasoning receives projections and may return local labels, narrative, and local proposals only. Deterministic fallbacks remain available when a provider or model is unavailable.
- `workflows/daily-intelligence/`: lifecycle, cancellation, provider outcome accounting, stage ordering, idempotency, report finalization, and the optional Gateway call.
- `app/services/daily-intelligence-service.ts`: product-level start/list/get operations shared by Pi and HTTP.
- `app/services/daily-intelligence-composition.ts`: one narrow product composition shared by Runtime, CLI, Scheduler, and Pi entrypoints; it owns active catalog provider wiring, watchlist paths, AKShare calendar/cache/manual overrides, and the Pi executor supplied by the host.
- `app/pi/` and `app/runtime/server.ts`: thin product surfaces for brief generation and bounded report retrieval; no host paths or internal objects are exposed.
- `runtime-data/daily-intelligence/`: signal JSONL, brief metadata/content, and scheduler state. These are runtime artifacts, never canonical Knowledge.

## Signal v2 boundary

Each signal has a stable local `signalId`, provider/source identity, source account reference when configured, publication/discovery times, title/content reference/content hash, bounded entity/theme hints, category, source tier, relevance, novelty, sentiment, importance, optional public engagement, optional `rawRef`, and a deterministic `clusterKey`. JSONL persistence is append-safe; bounded time-window reads and deterministic identity checks prevent unbounded growth from entering a single synthesis call.

Provider outcomes distinguish `attempted`, `succeeded`, `empty`, `blocked`, `failed`, and `usable`. Empty or inaccessible providers produce explicit gaps and never abort the whole Brief. Source bodies are retained only under the existing Raw/provenance path when a durable Knowledge proposal requires them.

## Acquisition policy

The source order is official/first-party, structured free data, professional public information, specialist sources, then bounded community sources. Existing CNINFO, AKShare, GDELT, and RSS adapters are reused or adapted. `WebResearchAcquisition` is a narrow HTML/PDF/text adapter over `DocumentInputResolver`; static HTML uses native fetch. Optional rendering is an injected seam only and is not enabled by default. CAPTCHA bypass, anti-bot circumvention, fingerprint spoofing, cookie theft, and login automation are excluded.

Institutional information is represented as `institutional_view` or estimate-observation signals. Unless point-in-time, broker-attributed, multi-contributor data is actually available, the Brief prints `Consensus: Unavailable from current free-source stack`; no `ConsensusSnapshot` canonical kind is introduced.

Community acquisition has two bounded experiments, Xueqiu and Eastmoney Guba, restricted to watchlist/tracked entities and configured themes/industries. Community attention aggregates remain non-canonical.

## Dedup, enrichment, cluster, and rank

First-pass dedup is deterministic and considers canonical URL, provider object ID, content hash, normalized title, publisher, and publication date. Semantic clustering, if a real reasoning executor is available, sees only the bounded first-pass survivors and cannot rewrite stored signals. The deterministic cluster identity is based on normalized event title/topic/entity/date-window keys and keeps source diversity and first/last seen timestamps.

Ranking is deterministic and explainable. The score combines source tier, recency, watchlist/entity relevance, novelty, importance, and public engagement with fixed documented weights. Every top item stores a short score-reason list so the Brief can explain ordering.

## Change and Knowledge policy

`ResearchChangeAssessment` answers whether a top cluster is new, supports or contradicts an existing Claim, affects an Assumption or Thesis, is a Catalyst/Risk, or is noise. Existing Knowledge is projected only for relevant companies/entities and bounded claims/relations. A news item alone never creates a Claim. The synthesis skill can emit at most a small bounded set of local proposals, and the Workflow sends only deterministic, source-backed durable candidates to the existing Gateway. Ambiguity and conflict use existing semantic resolution and durable ReviewCase semantics.

## Brief and report contracts

Morning contains at least the 14 requested areas: overnight global, macro/policy, A-share announcements, market/assets, AI/technology/industry, public institutional views, investor-relations activity, watchlist, community changes, thesis changes, catalysts, risks, research gaps, and today's questions. Evening contains at least the 13 requested areas: A-share summary, sector/industry/theme performance, market events, company announcements, public institutional views, investor-relations activity, community narrative, watchlist changes, Knowledge changes, Thesis/Assumption impacts, Catalysts/Risks, outstanding gaps, and tomorrow watchlist.

Unavailable data is rendered as `Unavailable` or an explicit Research Gap. Each report item has source references or is explicitly marked as a gap/interpretation. Report metadata records source coverage and semantic-quality telemetry: signal, dedup, cluster, top-rank, claim, sourced-claim, Raw-provenance, unsupported-proposal, report-source-coverage, durable-change, and review counts.

The idempotency key is `briefType + tradeDate`. Repeating it returns the existing report; `forceRefresh=true` creates a new revision for the same logical brief and records the prior revision. Reports are finalized only after the optional Gateway result and reload validation are complete.

## Calendar and scheduler

`TradingCalendarService` first attempts a configured public/AKShare calendar adapter, then uses the most recent local cache, then manual overrides, then a deterministic weekday fallback with explicit confidence. `DailyBriefScheduler` uses China-local due times (08:00/20:30), persists last successful runs, is restart-safe, catches up only the bounded same-day slots, and shares the same Application Workflow as CLI/manual/Pi/HTTP triggers. It uses a closable local timer only; no Redis, queue, worker, or scheduler framework is introduced.

FIX-002 closes the semantic and composition correctness gaps: Workflow calls asynchronous enrichment and bounded change assessment before synthesis; proposal subject/source/entity admissibility is deterministic; multi-company proposals are submitted separately with `<workflowRunId>-<subjectKey>`; and the report exposes only Gateway-returned canonical subject refs. FIX-003 adds bounded transport normalization for Pi structured output, strict partial-field fallback, `assessmentRefs` on Synthesis proposals, and a deterministic durable-eligibility gate before Gateway submission. Empty model sections finalize to Research Gaps and exact section guards prevent cross-domain announcement leakage. Runtime performs one immediate due check at startup and then checks every 60 seconds; `close()` clears the timer. M2 is PASS / CLOSED and M3 is not started.

## FIX-001 closure

FIX-001 makes the catalog's 43 entries runtime-classified as identity, active feed, discovery source, or reference-only, with operational status. Company-scoped acquisition fans out across the four configured watchlist companies; broad feeds carry no fabricated company identity. Discovery retains item title, URL, provider object ID, and source publication time when present; unknown publication time remains unknown. HTML/PDF/text normalization passes through `DocumentInputResolver` and retains full normalized-source content and raw bytes for any later Gateway evidence binding. Daily reasoning uses `daily_signal_enrichment`, `daily_change_assessment`, and `daily_brief_synthesis`; all model references are validated against local signal/assessment IDs, and deterministic gaps are emitted when output is unavailable or invalid. Daily reports use non-canonical signal references/evidence links and never manufacture canonical Source refs.

Windows scripts install/remove current-user Task Scheduler entries without credentials or an administrator-only assumption. Installation is idempotent; inability to install in the current environment is recorded as an environment limitation, not an M2 product failure.

## Non-goals

No Industry/Theme/Earnings/Portfolio Research, trading or broker execution, multi-agent orchestration, DSH, ResearchManager, Capability/Provider/Planner framework, generic crawler/RAG, Graph DB, Vector DB, Redis, distributed worker, automatic full-market crawl, or canonical ConsensusSnapshot is part of M2.
