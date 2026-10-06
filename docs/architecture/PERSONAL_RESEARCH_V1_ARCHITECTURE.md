# ResearchHub — Personal Research v1 Architecture

Status: FROZEN for the first Company Research production slice; M1 PASS / CLOSED by CTO acceptance at `7a1453179979ef2680165f79c3119656ee03c3a1`
Date: 2026-09-08

## Product scope

Personal Research v1 is a local, single-user, non-commercial, A-share-first investment research system of record. The first materially different Producer is `research_company`:

```text
Company Deep Research
 -> free public acquisition
 -> Research Report
 -> Semantic Knowledge Proposal
 -> Proposal Validation / Canonical Binding / Knowledge State Diff
 -> bounded semantic resolution / deterministic Resolution Policy
 -> ResolutionIntent / ChangeSet Planning / ChangeSet Validation
 -> shared Writer
 -> canonical Knowledge
```

The report is a user-facing artifact; canonical Knowledge is durable research state. A ResearchSignal or fetched article is not a Claim by default.

## Company Research Workflow

```text
Objective
 -> Schema Projection
 -> bounded Planning
 -> Official / AKShare / GDELT / RSS acquisition
 -> normalize and archive Raw evidence
 -> Company Research Skill
 -> Markdown Report draft + Semantic Proposals
 -> Knowledge Production Gateway
 -> canonical binding and Knowledge State Diff
 -> bounded semantic resolution and deterministic Resolution Policy
 -> ResolutionIntent / ChangeSet Planning / ChangeSet Validation
 -> shared Writer
 -> reload/verify
 -> finalize Report references
```

Workflow owns lifecycle, cancellation, source bounds, and terminal status. Skill owns semantic methodology and interpretation. Plugin owns external I/O. The producer-neutral Knowledge Production Gateway owns canonical binding, state diff, ResolutionIntent policy, ChangeSet planning, and the single Writer entry. Canonical IDs are allocated only from canonical identity and existing state; no local proposal ID is durable. No Skill or Workflow may call a schema-specific Writer.

## Schema and storage

Foundation Fix 002 closes the first correctness boundaries: structured payloads have usable/empty/failed semantics and empty data creates diagnostics or research gaps only; content-addressed Raw bytes are distinct from provenance-context Source identity; workflow `asOf` is an information cutoff and never Claim temporal scope; Validator-issued receipts are opaque module-private capabilities; semantic-slot changes are resolved as exact merge, explicit supersession, contradiction preservation, or durable ReviewCase; relation proposals are schema- and endpoint-validated; and Company exchange normalization reuses the existing identity rules. CNINFO PDF acquisition passes bytes through `DocumentInputResolver` for normalized text and never uses a PDF response-text path. Real Provider Smoke and real Pi `company_research_synthesis` evidence are retained under `tests/validation/evidence/RHL_PERSONAL_RESEARCH_V1_FOUNDATION_FIX_002*`.

Schema 0.4 continues Storage Format 1 and adds claim types `assumption`, `thesis`, and `catalyst`; canonical claim dependency references; forecast `probability` distinct from `confidence`; and source acquisition/rights metadata. A fresh v0.4 Knowledge Base is selected explicitly by its manifest. Existing v0.3 runtime directories are readable only through their v0.3 path and are not automatically migrated or rewritten.

Claim dependencies must resolve to canonical Claims. Self-references and cycles are rejected deterministically; validation uses an iterative graph algorithm so malformed cycles cannot crash Loader or Writer. Source rights are explicit, carry the personal non-commercial research policy basis, and default public/non-commercial policy still denies redistribution. Every committed Source/Claim evidence path is Raw-backed and Raw integrity is verified before commit.

## Report and Signal boundary

`ResearchReport` stores report identity, company subject, generation/as-of time, Workflow run, committed Knowledge revision, final Source/Claim references, methodology, ordered sections, and a runtime-relative Markdown output path. Reports live under `runtime-data/reports/` and never under source-controlled code.

`ResearchSignal` stores non-canonical news, announcements, public/institutional views, and community attention. It lives in a runtime intake file, never in the Registry, Graph, or Writer input. It can point to a candidate URL/content reference but cannot acquire Writer authority.

## Source priority and deterministic computation

Tier 1 is regulator/exchange/CNINFO/company official material; Tier 2 is structured public financial and government/industry data; Tier 3 is professional media/public institutional material; Tier 4 is specialist/community material; Tier 5 is general discussion. Critical Claims should bind to the highest available tier.

The Skill may state assumptions and interpretations. Deterministic code computes relative valuation, scenario valuation, percentages, dates, and aggregations. An LLM-provided numerical valuation is never accepted without programmatic recomputation.

## Non-goals

No automatic trading, broker execution, multi-agent orchestration, generic provider/capability/planner/workflow frameworks, Graph DB, Vector DB, RAG, queue/Redis, distributed worker, custom Agent Runtime, unrestricted crawler, or automatic Schema 0.3 migration. Industry Research, Theme Workflow, ReviewDecision execution, and consensus-data integration remain separate milestones.
