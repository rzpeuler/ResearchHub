# Data Catalog Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only Common and Industry Catalog browsing to Data Sources, backed by HTTP projections of the catalogs and runtime instances the application actually uses.

**Architecture:** Application projection services will read `COMMON_DATA_CATALOG`, the current Common SourcePolicy definitions, registered Industry identities, and the exact `IndustryDataCatalog` instance bound into the runtime resolver. GET routes expose safe JSON only; `RuntimeClient` and the existing Data Sources page render it without adding frontend catalog state or mutation paths.

**Tech Stack:** TypeScript, Node HTTP runtime, React, Vitest/jsdom, Node test runner.

**Spec:** User-provided RHL-DL-UI-001 taskbook at `C:\Users\Administrator\.codex\attachments\933cb3c5-aaa1-46e8-b69a-1a61b74773e1\pasted-text-1.txt`; supporting repository contract: `docs/engineering/specs/2026-09-22-data-source-governance-foundation-v0.1.md`.

## Global Constraints

- Keep the feature read-only; do not add Catalog lifecycle, DataResolver, Knowledge Schema, or provider-test mutations.
- `COMMON_DATA_CATALOG` is the complete Common Catalog source; do not infer its contents from `getDataSourceCatalog().rows` or hardcode its current item count.
- `IndustryDataCatalog.list()` and `INDUSTRY_IDENTITIES` are the only production Industry definition and identity sources.
- Common and Industry are different catalog contracts: Common rows show its source-policy columns; Industry rows show `industryId`, `metricId`, `name`, `description`, `metricFamily`, `semanticRole`, `dataKind`, and `lifecycleStatus`. Do not project Industry metrics through the Common fallback-source table.
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

### Task 1: Read-only Catalog projection contracts

**Files:** Create `app/services/data-catalog-projection.ts`; test `tests/app/services/data-catalog-projection.test.ts`.

**Produces:** Typed Common and Industry response projections. Common matching uses exact metric/policy identifiers and keeps policy status distinct from source binding, tests, and PIT. Industry projection reads `IndustryDataCatalog.list()` without mutation.

- [x] Add dynamic-count, exact/unmapped Common, policy-vs-adapter, empty Industry, lifecycle, and policy metadata tests.
- [x] Run the focused projection tests and observe RED before implementation.
- [x] Implement pure projections with no guessed mapping or Catalog mutation.
- [x] Verify focused projection tests pass (5/5) and root typecheck passes.
- [x] Commit `16aea19`.

### Task 2: Runtime binding and read-only HTTP routes

**Files:** Modify `app/runtime/application-runtime.ts` and `app/runtime/server.ts`; test `tests/app/runtime/data-catalog-projection-routes.test.ts`.

**Produces:** `GET /api/data-sources/catalog/common` and `GET /api/data-sources/catalog/industry`; one Industry catalog instance is shared by resolver composition and route projection.

- [x] Add failing real HTTP tests for dynamic Common definitions, injected Industry Catalog identity, read-only behavior, and response redaction.
- [x] Bind the default or injected catalog once; project only actual policy and safe integration summaries.
- [x] Run projection routes plus existing Data Source administration routes (10/10).
- [x] Run root typecheck and commit `a9f4fbd`.

### Task 3: RuntimeClient read methods

**Files:** Modify `client/src/api/runtime-client.ts` and `client/src/api/runtime-client.test.ts`.

**Produces:** Typed `getCommonDataCatalog()` and `getIndustryDataCatalog()` GET methods with standard safe error handling and no mutation methods.

- [x] Add failing endpoint/method/shape/error-propagation tests and observe RED.
- [x] Add typed GET methods using the projection response contracts.
- [x] Run RuntimeClient tests (22/22) and client typecheck.
- [x] Commit `8489361`.

### Task 4: Data Fields tab and Catalog Explorer UI

**Files:** Modify `client/src/app/data-sources/DataSourcesPage.tsx`, `client/src/app/data-sources/data-sources-page.css`, and `client/src/app/data-sources/DataSourcesPage.test.tsx`.

**Produces:** Separate Common and Industry catalog views nested under the existing Source policies tab, with live counts, search, filters, details, explicit state semantics, and independent loading/errors. Preserve the three top-level tabs and their credential, test, onboarding, refresh, and cancellation behavior.

- [x] Add failing tests for tabs, both catalogs, search/filter, details, status distinctions, empty/error/loading/no-match, and refresh.
- [x] Implement the read-only UI with existing i18n and no production fixtures.
- [x] Run DataSourcesPage tests (17/17) and client typecheck.
- [x] Commit `2431659`.

#### Root integration correction — Industry-specific list projection

The initial UI review missed the taskbook's Industry metric-list contract and reused the Common seven-column source-policy projection for Industry. The root-integrated page now renders the eight Industry definition fields listed above as one row per metric; source-policy and provider details remain in the metric detail panel.

- [x] Add rendered-table assertions for all eight Industry fields in Chinese and English, including injected Application → HTTP → RuntimeClient → UI data.
- [x] Verify one table row per Industry metric even when a metric has multiple SourcePolicy references.
- [x] Verify the Common seven-column source-policy table is unchanged.

### Task 5: Real Application-to-page contract test

**Files:** Create `tests/app/runtime/data-catalog-projection-ui-e2e.test.ts` and test-only `tests/app/runtime/css-loader.mjs`.

**Produces:** A Node/jsdom integration test that runs the real Application Runtime, HTTP server, RuntimeClient, and DataSourcesPage against both catalog endpoints.

- [x] Use an injected test-only Industry Catalog; assert Common definitions and the same injected Industry definition reach the UI.
- [x] Assert the production empty catalog remains empty and no provider call occurs.
- [x] Run `node --import tsx --test tests/app/runtime/data-catalog-projection-ui-e2e.test.ts` (1/1).
- [x] Commit `f2163da`.

### Task 6: Report, full validation, review, and remote delivery

**Files:** Create `docs/engineering/reports/2026-10-09-data-catalog-explorer.md`.

- [x] Run all focused Data Sources, projection, HTTP, RuntimeClient, UI, and cross-layer tests.
- [x] Run `npm test`, both typechecks, client build, and exact baseline identifier comparison.
- [x] Record baseline, APIs, counts, mapping semantics, runtime identity, UI, security, tests, and limitations in the report.
- [x] Review changed files for copied Catalog state, promotion, providers, persistence, mutation routes, sensitive data, and regressions.
- [x] Complete fresh whole-branch review, commit/push the branch, and verify remote SHA, clean worktree, and unchanged `main`. The final review included the task-scoped projection redaction, exact resolver binding state, and independent Catalog refresh fixes; implementation and report were pushed as `c3f50a8` before this plan-closure update. Final tip SHA is recorded in the delivery response after remote verification.
