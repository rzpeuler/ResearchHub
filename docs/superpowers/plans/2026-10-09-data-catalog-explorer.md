# Data Catalog Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only Common and Industry Catalog browsing to Data Sources, backed by HTTP projections of the catalogs and runtime instances the application actually uses.

**Architecture:** Application projection services will read `COMMON_DATA_CATALOG`, the current Common SourcePolicy definitions, registered Industry identities, and the exact `IndustryDataCatalog` instance bound into the runtime resolver. GET routes expose safe JSON only; `RuntimeClient` and the existing Data Sources page render it without adding frontend catalog state or mutation paths.

**Tech Stack:** TypeScript, Node HTTP runtime, React, Vitest/jsdom, Node test runner.

**Spec:** User-provided RHL-DL-UI-001 taskbook at `C:\Users\Administrator\.codex\attachments\b3115fa5-77d9-44e8-9e2f-78f6875dc6c4\pasted-text-1.txt`; supporting repository contract: `docs/engineering/specs/2026-09-22-data-source-governance-foundation-v0.1.md`.

## Global Constraints

- Keep the feature read-only; do not add Catalog lifecycle, DataResolver, Knowledge Schema, or provider-test mutations.
- `COMMON_DATA_CATALOG` is the complete Common Catalog source; do not infer its contents from `getDataSourceCatalog().rows` or hardcode its current item count.
- `IndustryDataCatalog.list()` and `INDUSTRY_IDENTITIES` are the only production Industry definition and identity sources.
- The Industry projection must read the same catalog instance bound to the runtime resolver, including when a test catalog is injected.
- Match SourcePolicies and sources by stable policy/source identifiers; never infer a mapping from display labels or similar names.
- A configured SourcePolicy does not prove a bound runtime adapter, passed connection test, passed capability sample, or historical PIT safety.
- Keep `DISCOVERED`, `VALIDATED`, and `CANONICAL` lifecycle values unchanged; do not seed production Catalog definitions or display audited candidates as registered metrics.
- Preserve the existing source-policy, integration, credential, onboarding, refresh, active-test cancellation, and credential-redaction behavior.
- Do not add a database, registry framework, provider manager, editable catalog, or external-provider calls on page load.
- Update architecture documentation only if implementation changes a normative runtime contract; do not rewrite Data Layer v1 invariants.

## Review Focus

- A new Common definition with no exact policy must remain visible with `NOT_CONFIGURED`/`UNMAPPED`, without guessed fallback sources. Pin in Task 1 with dynamic-count and unmapped-definition tests.
- An injected Industry Catalog must be the same object read by the resolver and projection route. Pin in Tasks 2 and 5 with an injected-catalog HTTP/UI test.
- Empty production Industry definitions must show the registered identities and a canonical count of zero, with no fixture metrics. Pin in Tasks 2 and 4.
- Policy configuration, provider binding, test results, and PIT verification must remain separate claims. Pin in Tasks 1, 2, and 4 with positive and negative state cases.
- A Catalog API failure must not break integrations/onboarding or expose credential/provider error data. Pin in Tasks 2, 4, and 5.

---

### Task 6: Documentation, full validation, and remote delivery

**Files:**
- Create: `docs/engineering/reports/2026-10-09-data-catalog-explorer.md`
- Modify architecture documentation only if review finds a normative runtime contract needs an additive clarification; do not change Data Layer v1 core constraints.

- [ ] **Step 1: Run all Data Sources focused tests** plus the new projection and HTTP tests.
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, `npm run client:typecheck`, `npm run client:build`, and `git diff --check`. Compare exact failing Node test identifiers to the current accepted baseline; require zero new deterministic failures.
- [ ] **Step 3: Record** baseline and Phase 4 promotion HEAD, API contracts and data sources, exact policy mapping behavior, real counts from both catalogs, shared-runtime-instance proof, UI interactions, security review, test results, limitations, validated code HEAD, and final delivery HEAD in the engineering report.
- [ ] **Step 4: Review the final diff** for forbidden catalog copies, candidate promotion, provider/network calls, persistence, mutation routes, sensitive data, and regressions to existing Data Sources behavior.
- [ ] **Step 5: Commit and push** `codex/dl-ui-001-data-catalog-explorer`; verify remote HEAD equals local HEAD, the worktree is clean, and `main` remains at the Phase 4 promotion commit.
