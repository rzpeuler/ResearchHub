# Data Source Plugin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Data Sources page with a truthful inventory of Runtime-assembled integrations, safe tests, OS-vault credential configuration, and local drafts for sources that need code adapters.

**Architecture:** Workflow keeps ownership of metric policies and fallback order. Runtime exposes a narrow application service built from explicit integration descriptors and adapter-specific test functions; it does not scan or dynamically load plugins. The client uses Runtime APIs for tests, credentials, and drafts; credentials go to the Windows credential vault and onboarding data stays in `runtime-data`.

**Tech Stack:** TypeScript, Node HTTP Runtime, React, Vitest, `node:test`, `@napi-rs/keyring` 2.1.0 for Windows Credential Manager access.

**Spec:** `docs/superpowers/specs/2026-10-06-data-source-plugin-management-design.md`

## Global Constraints

- Workflow continues to own metric-level source selection and fallback order.
- Plugin continues to own concrete external capability integration.
- Do not add a general plugin loader, discovery registry, provider framework, or service locator.
- The UI cannot supply arbitrary URLs, code, shell commands, or plugin packages.
- Drafts are local runtime application data under `runtime-data`, not source code, model context, or Knowledge.
- The browser, source catalog, onboarding drafts, API responses, logs, and test diagnostics must never store or return secret values.
- Tests must not invoke the Knowledge Production Gateway, ChangeSet, Writer, or canonical Knowledge mutation path.
- The page has no runtime enable/disable switch; new Workflow use requires a code-reviewed `SourcePolicy` update.

## Review Focus

- Unknown or stale integration ID: reject before invoking a provider operation; pin in the administration service and route tests.
- Secret-like values in provider errors or response bodies: redact and never serialize them; pin in service and HTTP route tests.
- Timeout, rate limit, empty response, or malformed capability sample: return a stable bounded status and preserve only a safe summary; pin in adapter/service tests.
- Unsupported onboarding endpoint/script or secret-bearing draft field: reject without network access; pin in draft validation tests.
- OS credential vault unavailable or unsupported platform: fail closed with a safe error and never fall back to plaintext; pin in credential-store tests.

---

## File Map

- `app/services/data-source-administration-contracts.ts` — typed integration, capability, credential-field, test-result, and sanitized-summary contracts.
- `app/services/data-source-administration.ts` — validates integration/test requests, resolves credentials server-side, maps failures, and persists only sanitized summaries.
- `app/services/data-source-test-store.ts` — bounded local persistence for the latest safe test summary per integration/test kind.
- `app/runtime/source-credential-store.ts` — credential-store port and Windows OS-vault implementation.
- `app/services/data-source-onboarding-store.ts` — validated local onboarding drafts and lifecycle transitions.
- `app/runtime/contracts.ts` — adds the application service to the Runtime service contract.
- `app/runtime/application-runtime.ts` — constructs services and explicit source descriptors from the concrete Runtime dependencies.
- `app/services/daily-intelligence-composition.ts` — returns descriptors alongside the actual Daily integrations it assembles.
- `app/runtime/server.ts` — protected API routes for integrations, tests, credentials, and drafts.
- `client/src/api/runtime-client.ts` — typed client methods for the new routes.
- `client/src/app/data-sources/DataSourcesPage.tsx` and `data-sources-page.css` — three-tab page and forms/statuses.
- `tests/app/services/data-source-administration.test.ts` — service validation, test behavior, redaction, and summary persistence.
- `tests/app/services/data-source-onboarding-store.test.ts` — draft validation, lifecycle, and persistence.
- `tests/app/runtime/source-credential-store.test.ts` — credential port behavior using an injected vault driver.
- `tests/app/runtime/data-source-admin-routes.test.ts` — HTTP authorization, API contracts, and no-Knowledge-write behavior.
- `client/src/api/runtime-client.test.ts` — route, body, and mutation-token contracts.
- `client/src/app/data-sources/DataSourcesPage.test.tsx` — page tabs, inventory, tests, credential form, and onboarding states.

## Interfaces

Task 1 defines these contracts for later tasks:

```ts
export type DataSourceTestKind = 'connection' | 'capability_sample'
export type DataSourceTestStatus = 'passed' | 'failed' | 'cancelled' | 'unsupported'
export type DataSourceTestErrorCode =
  | 'missing_configuration' | 'authentication_failed' | 'timeout' | 'rate_limited'
  | 'access_denied' | 'no_data' | 'contract_mismatch' | 'provider_failed'

export interface DataSourceTestSummary {
  readonly integrationId: string
  readonly kind: DataSourceTestKind
  readonly capabilityId?: string
  readonly status: DataSourceTestStatus
  readonly startedAt: string
  readonly completedAt: string
  readonly errorCode?: DataSourceTestErrorCode
}

export interface DataSourceIntegrationDescriptor {
  readonly integrationId: string
  readonly displayName: string
  readonly sourceIds: readonly string[]
  readonly credentialFields: readonly { readonly id: string; readonly label: string; readonly required: boolean }[]
  readonly capabilities: readonly { readonly id: string; readonly label: string; readonly metricIds: readonly string[] }[]
  readonly supportedTests: { readonly connection: boolean; readonly capabilitySamples: readonly string[] }
}

export interface DataSourceIntegrationDefinition {
  readonly descriptor: DataSourceIntegrationDescriptor
  readonly testTimeoutMs: number
  readonly testConnection?: (signal: AbortSignal) => Promise<void>
  readonly capabilitySamples?: Readonly<Record<string, (signal: AbortSignal) => Promise<void>>>
}

export interface DataSourceIntegrationView {
  readonly integration: DataSourceIntegrationDescriptor
  readonly credentialState: 'not_required' | 'missing' | 'configured' | 'vault_unavailable'
  readonly policyLinked: boolean
  readonly latestTests: readonly DataSourceTestSummary[]
}

export interface SourceCredentialStore {
  read(integrationId: string): Promise<Readonly<Record<string, string>> | undefined>
  write(integrationId: string, values: Readonly<Record<string, string>>): Promise<void>
  has(integrationId: string): Promise<boolean>
  delete(integrationId: string): Promise<void>
}

export interface DataSourceAdministrationService {
  listIntegrations(): Promise<readonly DataSourceIntegrationView[]>
  saveCredentials(integrationId: string, values: Readonly<Record<string, string>>): Promise<void>
  removeCredentials(integrationId: string): Promise<void>
  runTest(input: { readonly integrationId: string; readonly kind: DataSourceTestKind; readonly capabilityId?: string }, signal?: AbortSignal): Promise<DataSourceTestSummary>
}

export type DataSourceOnboardingStatus = 'draft' | 'ready_for_adapter' | 'adapter_available' | 'verified'

export interface DataSourceOnboardingDraft {
  readonly requestId: string
  readonly input: DataSourceOnboardingDraftInput
  readonly status: DataSourceOnboardingStatus
  readonly createdAt: string
  readonly updatedAt: string
}

export interface DataSourceOnboardingService {
  list(): Promise<readonly DataSourceOnboardingDraft[]>
  create(input: DataSourceOnboardingDraftInput): Promise<DataSourceOnboardingDraft>
  update(requestId: string, input: DataSourceOnboardingDraftInput): Promise<DataSourceOnboardingDraft>
  markReady(requestId: string): Promise<DataSourceOnboardingDraft>
}

export interface DataSourceOnboardingDraftInput {
  readonly integrationId: string
  readonly displayName: string
  readonly documentationUrl: string
  readonly accessMode: 'api' | 'rss' | 'web' | 'python_bridge' | 'other'
  readonly publisher: string
  readonly proposedAuthority: 'S0_STATUTORY' | 'S1_OFFICIAL' | 'S2_PROFESSIONAL' | 'S3_AGGREGATOR' | 'S4_COMMUNITY' | 'unknown'
  readonly capabilityIds: readonly string[]
  readonly metricIds: readonly string[]
  readonly authenticationMode: 'none' | 'api_key' | 'oauth' | 'other'
  readonly termsUrl?: string
  readonly rightsNotes: string
  readonly rateLimitNotes: string
  readonly timeBoundaryNotes: string
  readonly providerTermsReviewed: boolean
}
```

`DataSourceIntegrationDefinition` includes a stable ID, matching
`SourceCandidate.sourceId` values, display metadata, credential field
labels/required flags, capability and metric descriptors, and optional
adapter-owned connection/sample callbacks. `DataSourceIntegrationView`
includes credential presence, whether current source policies reference the
integration, and sanitized latest test results. `SourceCredentialStore` uses
the exact methods shown above.
Runtime integration IDs use unique lowercase kebab-case
`^[a-z0-9]+(?:-[a-z0-9]+)*$` values of at most 64 characters. Credential
field IDs use unique `^[A-Za-z][A-Za-z0-9_-]{0,63}$` values within each
integration. Validate these constraints while constructing the administration
service, matching the constraints enforced by the credential store.
`DataSourceOnboardingService` uses an immutable generated `requestId` as the
draft route key, while `integrationId` is unique among drafts and can be edited
only before `markReady`. It owns the exact `list()`, `create(input)`,
`update(requestId, input)`, and `markReady(requestId)` methods above. The
persisted state is only `draft` or `ready_for_adapter`; `adapter_available`
and `verified` are derived at read time from the explicit integration view and
latest tests. Verification requires complete publisher/authority/rights/time
metadata, at least one supported test, and every applicable supported test to
have passed. There is no `enable()` operation. Integration IDs use
`^[a-z0-9]+(?:-[a-z0-9]+)*$`, are limited to 64 characters, and freeze when
`markReady` is called. Credential-field IDs use
`^[A-Za-z][A-Za-z0-9_-]{0,63}$`. Documentation and terms URLs must use HTTPS,
reject username/password/fragments, and are never fetched by the application.

---

### Task 1: Define Administration Contracts and Safe Test Service

**Files:**
- Create: `app/services/data-source-administration-contracts.ts`
- Create: `app/services/data-source-administration.ts`
- Create: `app/services/data-source-test-store.ts`
- Create: `tests/app/services/data-source-administration.test.ts`

**Interfaces:**
- Consumes: adapter definitions passed explicitly to the service; a credential-store port; a test-summary store.
- Produces: `DataSourceAdministrationService` as defined above; `MemoryDataSourceTestStore` for isolated tests and a file-backed store for Runtime.

- [ ] **Step 1: Write failing service tests**

Add tests named:

```ts
test('lists only supplied Runtime integrations and reports credential presence')
test('rejects unknown integrations and unsupported test kinds before calling adapters')
test('runs exactly one bounded adapter test without source fallback')
test('aborts a supported adapter operation when the caller cancels')
test('maps timeout, rate limit, access denial, no data, and contract mismatch to stable codes')
test('redacts secrets and provider bodies from failed test summaries')
test('persists only sanitized latest test summaries')
```

Assert that unknown integrations invoke no callback, a test invokes exactly
one callback, caller cancellation reaches the adapter, raw provider output is
absent from returned/persisted results, and the latest summary contains only
the fields in `DataSourceTestSummary`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test tests/app/services/data-source-administration.test.ts`
Expected: FAIL because the service contracts and implementation do not exist.

- [ ] **Step 3: Implement contracts, service, error mapping, and summary store**

Implement the exact interfaces above. Reject duplicate or invalid integration
IDs and invalid/duplicate credential field IDs before exposing any definition.
Require a declared callback for the
requested test kind; validate credential field IDs and mandatory fields against
the selected integration definition before vault writes. Enforce each
definition's `testTimeoutMs` by combining timeout and caller cancellation into
an abort signal. Map timeout, rate limit, access denial, no data, contract
mismatch, and unknown provider failure to stable codes. Strip credential-like
strings and never keep provider response bodies. Bound summary-store entries to
one latest result per integration and test kind.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --import tsx --test tests/app/services/data-source-administration.test.ts`
Expected: PASS with all seven named cases.

- [ ] **Step 5: Commit**

```bash
git add app/services/data-source-administration-contracts.ts app/services/data-source-administration.ts app/services/data-source-test-store.ts tests/app/services/data-source-administration.test.ts
git commit -m "feat: add data source administration service"
```

### Task 2: Add the OS Credential Store

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `app/runtime/source-credential-store.ts`
- Create: `tests/app/runtime/source-credential-store.test.ts`

**Interfaces:**
- Consumes: `DataSourceIntegrationDefinition` credential field metadata from Task 1.
- Produces: `SourceCredentialStore` with `read(integrationId)`,
  `write(integrationId, values)`, `has(integrationId)`, and
  `delete(integrationId)`; Windows implementation backed by Windows Credential
  Manager.

- [ ] **Step 1: Write failing credential-store tests**

Add tests named:

```ts
test('round-trips a multi-field integration credential through the injected vault')
test('rejects invalid IDs, empty secrets, control characters, and oversized values')
test('fails closed when the OS vault is unavailable')
test('never exposes stored values from credential-presence queries or errors')
```

Use an injected fake vault driver. Assert that no filesystem secret fallback
is created and that every error is safe to serialize. Validate stable
integration IDs using the same strict lowercase kebab-case constraint as the
administration service, plus credential-field ID and credential-map
size/value bounds in the store. The
administration service validates credential field IDs against the selected
integration definition and requires all mandatory fields before replacing a
stored credential map.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test tests/app/runtime/source-credential-store.test.ts`
Expected: FAIL because the credential-store port and implementation do not exist.

- [ ] **Step 3: Implement the Windows Credential Manager adapter**

Add `@napi-rs/keyring` 2.1.0 and its lockfile entry. Use the package's native
Windows credential backend behind an injectable driver. Store one bounded,
serialized credential map per stable integration ID. On unsupported platforms
or vault failure, return a safe unavailable error; do not fall back to files,
environment mutation, or browser storage. Keep native imports out of tests by
injecting the driver.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --import tsx --test tests/app/runtime/source-credential-store.test.ts`
Expected: PASS with all four named cases.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json app/runtime/source-credential-store.ts tests/app/runtime/source-credential-store.test.ts
git commit -m "feat: store data source credentials in OS vault"
```

### Task 3: Describe Actual Runtime Integrations and Their Tests

**Files:**
- Create: `app/services/data-source-integrations.ts`
- Modify: `app/services/daily-intelligence-composition.ts`
- Modify: `app/runtime/application-runtime.ts`
- Modify: `app/runtime/contracts.ts`
- Create: `tests/app/services/data-source-integrations.test.ts`

**Interfaces:**
- Consumes: `DataSourceIntegrationDefinition` from Task 1; `SourceCredentialStore` from Task 2.
- Produces: `services.dataSourceAdministrationService` constructed from the
  same concrete source dependencies used by Runtime compositions.

- [ ] **Step 1: Write failing composition tests**

Add tests named:

```ts
test('describes only explicitly assembled source integrations')
test('groups operations for the same upstream integration and unions capabilities')
test('does not list metadata-only Daily catalog entries as executable integrations')
test('declares test support only when a bounded adapter callback exists')
test('enforces each integration test timeout and forwards cancellation to provider operations')
```

Assert descriptor IDs match actual injected composition dependencies; assert no
catalog-only source becomes testable.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test tests/app/services/data-source-integrations.test.ts`
Expected: FAIL because no explicit integration descriptors are produced.

- [ ] **Step 3: Build descriptors alongside concrete Runtime instances**

Add a narrow explicit descriptor builder. Reuse the AKShare, CNINFO, GDELT,
RSS, and industry-source objects created by Runtime compositions; do not scan
the plugin directory or instantiate a second connector solely for display.
Return Daily integration descriptors beside `DailyIntelligenceComposition`
providers and assemble the final service in `application-runtime.ts`. Include
capability-sample callbacks only for operations with bounded read-only inputs;
otherwise mark that test unsupported. Every callback accepts an `AbortSignal`
and honors cancellation when the underlying transport supports it. The
administration service enforces each definition's declared `testTimeoutMs` and
forwards the resulting cancellation signal.

- [ ] **Step 4: Run focused tests and Runtime typecheck**

Run: `node --import tsx --test tests/app/services/data-source-integrations.test.ts`
Expected: PASS with all five named cases.

Run: `npm run typecheck`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add app/services/data-source-integrations.ts app/services/daily-intelligence-composition.ts app/runtime/application-runtime.ts app/runtime/contracts.ts tests/app/services/data-source-integrations.test.ts
git commit -m "feat: expose explicit runtime source integrations"
```

### Task 4: Persist Local Onboarding Drafts

**Files:**
- Create: `app/services/data-source-onboarding-store.ts`
- Create: `tests/app/services/data-source-onboarding-store.test.ts`

**Interfaces:**
- Consumes: integration descriptor contract from Task 1.
- Produces: `DataSourceOnboardingService` with `list`, `create`, `update`,
  `markReady`, and runtime-derived adapter-available/verified display state.

- [ ] **Step 1: Write failing onboarding tests**

Add tests named:

```ts
test('creates and reloads a draft using local runtime-data storage')
test('rejects credentials, arbitrary executable fields, and invalid documentation URLs')
test('keeps an unsupported draft out of Runtime integration listings and tests')
test('derives adapter availability only from a matching explicit integration ID')
test('does not mark a draft verified before metadata and supported tests pass')
```

Assert drafts survive store reconstruction; no request callback or network fetch
is invoked for the documentation URL; invalid/duplicate IDs, unknown fields,
and secret-like keys are rejected. Require HTTPS documentation/terms URLs and
reject URL username, password, and fragment components.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test tests/app/services/data-source-onboarding-store.test.ts`
Expected: FAIL because the store and service do not exist.

- [ ] **Step 3: Implement validation, persistence, and lifecycle**

Persist validated draft records under `runtime-data/source-onboarding/` using
atomic writes consistent with existing file-backed application stores.
Validate `integrationId` as a unique lowercase kebab-case ID (maximum 64
characters) and freeze it at `markReady`. Require documentation/terms URLs to
use HTTPS and reject embedded credentials or fragments; never fetch them.
Allow only `draft → ready_for_adapter`; derive `adapter_available` from an exact
stable-ID match in the explicit integration inventory. Derive `verified` only
when required publisher/authority/rights/time metadata is complete, at least
one applicable supported test exists, and every applicable supported test has
passed. No API operation can set `verified` directly. Do not provide an
enable/disable operation.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `node --import tsx --test tests/app/services/data-source-onboarding-store.test.ts`
Expected: PASS with all five named cases.

- [ ] **Step 5: Commit**

```bash
git add app/services/data-source-onboarding-store.ts tests/app/services/data-source-onboarding-store.test.ts
git commit -m "feat: persist data source onboarding drafts"
```

### Task 5: Expose Protected Runtime APIs

**Files:**
- Modify: `app/runtime/contracts.ts`
- Modify: `app/runtime/application-runtime.ts`
- Modify: `app/runtime/server.ts`
- Create: `tests/app/runtime/data-source-admin-routes.test.ts`

**Interfaces:**
- Consumes: administration service from Tasks 1–3 and onboarding service from Task 4.
- Produces: HTTP routes:
  - `GET /api/data-sources/integrations`
  - `POST /api/data-sources/integrations/:id/credentials`
  - `DELETE /api/data-sources/integrations/:id/credentials`
  - `POST /api/data-sources/integrations/:id/tests` (accepts an abortable bounded test request)
  - `GET|POST /api/data-sources/onboarding`
  - `PATCH /api/data-sources/onboarding/:requestId` with either exact action
    `{ "action": "update", "input": <DataSourceOnboardingDraftInput> }` or
    `{ "action": "mark_ready" }`; lifecycle status is never caller-set.

- [ ] **Step 1: Write failing HTTP route tests**

Add tests named:

```ts
test('lists real integration descriptors without requiring a mounted Knowledge Base')
test('requires the Runtime mutation token for credential, test, and draft writes')
test('saves and removes credentials without echoing secret values')
test('returns bounded sanitized test results and rejects unknown integrations')
test('aborts a running connector test when the HTTP client disconnects')
test('persists drafts without changing the source-policy catalog or Knowledge revision')
```

Use injected fake services, assert exact JSON shapes and status codes, and
verify no Knowledge service or Writer method is called.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --import tsx --test tests/app/runtime/data-source-admin-routes.test.ts`
Expected: FAIL because the routes and service wiring do not exist.

- [ ] **Step 3: Wire services and implement route validation**

Expose the services through `ResearchHubApplicationServices`. Route every
credential write, test request, and draft mutation through
`validateMutation`; use bounded `readJson` limits and exact request fields.
Use `validateRead` only for descriptor/draft reads. Return only safe DTOs and
map missing integrations, unsupported tests, and vault failures to stable
Runtime errors.

- [ ] **Step 4: Run the focused test and Runtime typecheck**

Run: `node --import tsx --test tests/app/runtime/data-source-admin-routes.test.ts`
Expected: PASS with all six named cases.

Run: `npm run typecheck`
Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add app/runtime/contracts.ts app/runtime/application-runtime.ts app/runtime/server.ts tests/app/runtime/data-source-admin-routes.test.ts
git commit -m "feat: add data source administration routes"
```

### Task 6: Add Typed Client Methods and Three-Tab UI

**Files:**
- Modify: `client/src/api/runtime-client.ts`
- Modify: `client/src/api/runtime-client.test.ts`
- Modify: `client/src/app/data-sources/DataSourcesPage.tsx`
- Modify: `client/src/app/data-sources/data-sources-page.css`
- Create: `client/src/app/data-sources/DataSourcesPage.test.tsx`

**Interfaces:**
- Consumes: API DTOs and routes from Task 5.
- Produces: `RuntimeClient` methods `listDataSourceIntegrations`,
  `saveDataSourceCredentials`, `removeDataSourceCredentials`,
  `testDataSourceIntegration`, `listDataSourceOnboardingDrafts`,
  `createDataSourceOnboardingDraft`, `updateDataSourceOnboardingDraft`, and
  `markDataSourceOnboardingDraftReady`.

- [ ] **Step 1: Write failing RuntimeClient tests**

Add tests named:

```ts
it('uses read authorization for integration and onboarding lists')
it('uses mutation authorization for credentials, source tests, and draft changes')
it('encodes integration and draft IDs and posts only supported test fields')
```

Assert exact paths, methods, bodies, and presence/absence of
`X-ResearchHub-Runtime-Token`.

- [ ] **Step 2: Run the focused client test and verify it fails**

Run: `npm run client:test -- client/src/api/runtime-client.test.ts`
Expected: FAIL because the typed methods do not exist.

- [ ] **Step 3: Add RuntimeClient methods and page UI**

Keep the existing source-policy table intact under the first tab. Add the
three-tab layout selected in brainstorming. The integration tab shows actual
descriptor states, capabilities, policy linkage, credential presence, and
latest sanitized test status. Expose only tests declared by the adapter. The
test action accepts an `AbortSignal`; show a cancel action while an operation is
running and reset UI state after cancellation. Add a
credential dialog with named password fields; clear submitted values from React
state after completion and never prefill saved values. The onboarding tab
supports the supported-connector path and the validated local-draft path; it
does not accept executable code or arbitrary test endpoints. Display
“已验证 / 待 SourcePolicy 接入” rather than a runtime enable toggle.

- [ ] **Step 4: Write and run page tests**

Add tests named:

```ts
it('keeps source policies, integrations, and onboarding in separate tabs')
it('distinguishes adapter/configuration state from test state')
it('clears credential inputs after save and never renders returned secret values')
it('renders supported tests and safe failure categories only')
it('cancels a running test and restores its idle state')
it('creates and edits a local onboarding draft without offering arbitrary code or URL tests')
```

Run: `npm run client:test -- client/src/api/runtime-client.test.ts client/src/app/data-sources/DataSourcesPage.test.tsx`
Expected: PASS with all listed client/page cases.

- [ ] **Step 5: Run client typecheck and commit**

Run: `npm run client:typecheck`
Expected: PASS with no TypeScript errors.

```bash
git add client/src/api/runtime-client.ts client/src/api/runtime-client.test.ts client/src/app/data-sources/DataSourcesPage.tsx client/src/app/data-sources/data-sources-page.css client/src/app/data-sources/DataSourcesPage.test.tsx
git commit -m "feat: manage source integrations from data sources page"
```

### Task 7: Integrated Verification and Final Review

**Files:**
- Modify as needed: files from Tasks 1–6 only.
- Test: `tests/app/runtime/data-source-admin-routes.test.ts`
- Test: `client/src/app/data-sources/DataSourcesPage.test.tsx`

**Interfaces:**
- Consumes: all service, route, credential, draft, and UI interfaces from Tasks 1–6.
- Produces: a verified vertical slice with no source-policy or Knowledge mutation.

- [ ] **Step 1: Run focused node and client suites**

Run: `npm run test:node`
Expected: PASS across the repository's Node test suite.

Run: `npm run client:test`
Expected: PASS across the client test suite.

- [ ] **Step 2: Run both typechecks and production client build**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run client:typecheck`
Expected: PASS.

Run: `npm run client:build`
Expected: PASS and produce the normal client build output.

- [ ] **Step 3: Review security and workflow boundaries**

Inspect the final diff for credential value leakage, arbitrary URL/script
execution, unbounded provider calls, Knowledge writes, and source-policy
changes. Confirm the integration list is built from real explicit composition
objects and not metadata-only catalog entries.

- [ ] **Step 4: Commit any final corrections**

```bash
git add <only-reviewed-correction-files>
git commit -m "fix: close data source management review findings"
```

## External package reference

The plan pins `@napi-rs/keyring` 2.1.0, verified from the npm registry during
planning. Its [upstream repository](https://github.com/Brooooooklyn/keyring-node)
documents OS keychain access and the Node API; implementation must confirm the
Windows Credential Manager behavior with a local Windows smoke check before
claiming credential-store acceptance.
