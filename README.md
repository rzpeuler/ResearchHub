# ResearchHub_Lite

ResearchHub_Lite is the clean foundation for the ResearchHub Agent-first
investment research application. It is built on the Pi Coding Agent and
preserves the deterministic Knowledge architecture needed for safe durable
research. Codex owns repository engineering work directly.

## Product model

text
User
 → Pi Coding Agent
 → Free Research / Knowledge Query / Knowledge Production


- Free Research is exploratory and non-persistent by default.
- Knowledge Query is read-only and returns bounded Knowledge projections or references.
- Knowledge Production is explicit durable work that enters a product-level Application Tool and deterministic Workflow.

Review is downstream governance for Knowledge Production, not a fourth research mode. Canonical persistence requires explicit Knowledge Production intent; an upload or attachment is not automatically ingestion.

Daily Intelligence v1 and FIX-003 have fresh real-Pi execution evidence. They provide Asia/Shanghai Morning (08:00) and Evening (20:30) Briefs from item-level public acquisition over the 43-entry catalog and four-company watchlist, with real async semantic enrichment/change assessment/synthesis, source-stage telemetry, canonical-only report provenance, explicit unavailable/blocked states, and no fabricated consensus. A bounded Daily Continuous Research maintenance slice now carries materiality/thesis impact and existing-Claim update/contradiction resolution through the existing Gateway/Writer/replay path. Runtime, CLI, Scheduler, and Pi entrypoints share one narrow product composition. M3 Research Coverage Architecture v0.1 remains the historical architecture baseline; current Company, Earnings, Valuation, Event, Thesis Red Team, and deterministic Industry paths are implemented and covered by current tests/evidence, while fresh Industry product-quality evidence remains partial because of live source coverage.

## Current architecture

Pi Coding Agent is the canonical application host. ResearchHub directly reuses Pi's Agent loop, ModelRuntime, authentication, provider/model catalog, file-backed settings, Skills/Extensions, normal coding-agent tools, and session/runtime facilities. Agent-host portability is not a current product requirement.

ResearchHub owns the product semantics:

- app/pi/ — Pi application session and product-level tools;
- workflows/ — deterministic lifecycle, routing, validation, and write authorization;
- skills/ — ResearchHub semantic research Skills;
- plugins/ — document, evidence, and host integration;
- knowledge/ — Schema, provenance, resolution, validation, and canonical persistence;
- runtime-data/ — runtime Knowledge Base data;
- tests/ — deterministic and integration regressions.

app/services/ now provides the thin Application Service layer shared by Pi Application Tools and future UI/API surfaces. The implemented v0.1 surface is bounded Knowledge query, explicit document ingestion, process-scoped Workflow status/cancel, and read-only durable Review access. It is not a generic service framework.

Application Runtime v0.1: PASS / CLOSED. Homepage Shell v0.1 is implemented pending CTO acceptance. It provides a local Node.js runtime with persistent Pi conversations, HTTP JSON APIs, normalized SSE, controlled workspace attachments, Workflow observation/cancellation, and loopback/origin/runtime-token protection, plus a same-origin React + TypeScript + Vite browser client. See Application Runtime & Client Architecture v0.1
.

Personal Research v1 Company Research foundation is PASS / CLOSED by CTO acceptance at 7a1453179979ef2680165f79c3119656ee03c3a1, on an explicit Schema 0.4 / Storage 1 fresh-KB lane. Empty/failed provider payloads are diagnostic-only, Raw identity is separated from provenance-context Source identity, Claim temporal scope is semantic, and canonical mutation remains behind the Validator-issued ChangeSet and shared Writer. The research_company Application Service, Pi tool, and optional HTTP Product API run bounded official-disclosure, AKShare, GDELT, and RSS acquisition, produce a Markdown report and non-canonical ResearchSignals, then pass semantic proposals through the producer-neutral Knowledge Production Gateway. See Personal Research v1 Architecture
, Reuse Audit
, and Fix 002 evidence
.

## Run the local Homepage

text
npm install
npm run client:build
npm run researchhub


The Runtime prints its loopback URL. Open it in a browser; the client is served by the same Runtime origin. The Application Shell provides Research (/ and /research), a read-only Daily Brief reader (/briefs), a read-only Knowledge Graph Projection page (/graph), and a read-only Review Inbox (/reviews). Graph uses the bounded Directory and rooted graph APIs over active canonical Entities and Relations; Claims and Sources remain Inspector detail. Research contains the Agent conversation shell, Attachments, Workflow observation, Review notifications, and Company Research when a Schema 0.4 Knowledge Base is mounted. Daily Briefs reads persisted Morning/Evening outputs without adding a frontend mutation path. Theme Research, Industry Research, and ReviewDecision remain separate capabilities.

The left sidebar contains navigation and, at its bottom, the global model selector, Knowledge Base selector, and Settings with Chinese/English language selection. The selected Pi provider/model is shared by chat and production Workflow reasoning. The Knowledge Base selector lists supported direct children of `../ResearchHubData/knowledge-bases`; set `RESEARCHHUB_KNOWLEDGE_BASES_ROOT` to use another catalog directory. `RESEARCHHUB_KNOWLEDGE_BASE_ROOT` still supplies an initial mount when no selection has been saved. Model and Knowledge Base choices are saved in the local ignored `runtime-data/application-settings.json` and restored after restart; an explicit unmount stays unmounted. If a saved choice is unavailable, select another in the sidebar. Changing settings requires conversations, requests, and Workflows to be idle. The launcher `start-researchhub.bat` builds the client and starts this Runtime.

ReasoningExecutor remains the Workflow semantic-operation boundary and deterministic testing seam. It is not a product-level host-portability architecture. Conversation context and Workflow semantic context remain separate even when they share Pi ModelRuntime.

Application Tools expose product actions such as query, ingestion, workflow status/cancel, and Review reads. They must not expose Knowledge mutation primitives such as create_entity, create_relation, create_claim, create_changeset, commit_changeset, or write_registry.

Pi Agent Skills under .pi/skills/ are host/Agent capabilities. ResearchHub Skills under skills/ provide domain methodology. Neither changes the canonical mutation boundary: durable Knowledge changes pass through the ResearchHub Knowledge Production path, validated ChangeSet, and Writer.

Workspace files, uploads, and attachments may be read or analyzed during Free Research. Formal canonical ingestion starts only after explicit Knowledge Production intent and establishes the required Raw/Source provenance.

## Current ingestion direction

text
Intake & Raw Archive
 ↓
Parse Structured Document
 ↓
Understand + Plan
 ↓
Deterministic Plan Validation
 ↓
Bounded Parallel Extraction + Per-Unit Validation
 ↓
Candidate Consolidation
 ↓
Retrieve Existing Knowledge
 ↓
Deterministic Knowledge Resolution + bounded Semantic Cases
 ↓
Resolve References + Plan ChangeSet
 ↓
Final Deterministic Validation
 ↓
Atomic Write
 ↓
Reload & Verify


LLM reasoning owns semantic decomposition; Workflow owns execution control; deterministic code owns plan admissibility and Knowledge integrity.

## Documentation references

The following documents describe the product architecture and engineering
context:

- ResearchHub Application Interaction Architecture v0.1

- Knowledge Production Architecture v0.1

- Review Governance v0.1

Task reports and engineering notes record repository history and validation
evidence. ResearchHub_Lite is not a clone of the original ResearchHub.
