# Data Source Plugin Management Design

## Status

Design approved for specification review on 2026-10-06. Implementation has not
started.

## Objective

Extend the existing Data Sources page so users can inspect data integrations
that are actually assembled in the Runtime, run safe connection and capability
tests, and start onboarding a new source without treating a UI draft as an
executable integration.

The page keeps the existing read-only metric source-policy table. Workflow
continues to own metric-level source selection and fallback order. Plugin
continues to own concrete external capability integration.

## Existing context

- `client/src/app/data-sources/DataSourcesPage.tsx` currently renders the
  read-only source-policy table.
- `GET /api/data-sources/policies` returns Workflow policy rows; it does not
  enumerate executable plugins.
- Runtime compositions explicitly instantiate acquisition integrations.
  `config/research-sources/catalog.yaml` is a Daily source-account catalog and
  is not a general plugin registry.
- D0-001 defines deterministic Workflow-owned source selection and explicitly
  rejects a global registration, discovery, provider-framework, or service-
  locator layer.
- Pi `ModelRuntime` credentials serve model providers and are not a general
  data-source credential store.

## Product structure

The Data Sources page has three tabs:

1. **Source policies** — retain the current read-only metric table.
2. **Configured integrations** — show data integrations represented by
   explicit Runtime composition descriptors.
3. **Add a data source** — configure a connector that already has a supported
   adapter, or save an onboarding draft for a source that needs code changes.

The visual direction selected is the three-tab layout. Integration rows show
integration ID and name, enabled/configuration status, declared capabilities
and metrics, supported test types, and latest sanitized test summary. Related
operations from one upstream provider may be grouped into one integration row
with multiple capability entries.

Configuration and test state are separate. The UI must distinguish:

- Adapter assembled / missing configuration / disabled.
- Never tested / testing / connection passed or failed / capability sample
  passed or failed / test unsupported.

Passing a connection check does not imply that capability data is available.
Passing a capability sample does not imply that the source meets a Workflow's
authority floor or that research coverage is complete.

## Runtime inventory and test boundary

Add a narrow application-level data-source administration service that receives
descriptors and test operations from the existing explicit Runtime composition.
It is an inventory for this page, not a general plugin loader or discovery
registry. Descriptors must be derived from integrations that are actually
assembled; metadata-only entries in the Daily source catalog must not appear as
executable integrations.

Each integration may explicitly provide a connection check and zero or more
bounded capability-sample operations. Unsupported checks are reported as
unsupported. The UI cannot supply arbitrary URLs, code, shell commands, or
plugin packages. Each test targets one integration and never follows a
Workflow fallback chain.

Connection checks report reachability and authentication. Capability samples
make a small read-only request for one declared capability and validate the
adapter's required output shape, source identity, and applicable time fields.
Adapters set their own strict timeout, response-size, row, and concurrency
bounds. Tests may be cancelled where the underlying operation supports
cancellation.

Test results are non-canonical diagnostics. Store only a sanitized latest
summary: test kind, capability if applicable, start/completion time, status,
and stable error category. Never persist raw credentials or unbounded provider
responses. Tests must not invoke the Knowledge Production Gateway, ChangeSet,
Writer, or canonical Knowledge mutation path.

## Credentials

For supported adapters that require credentials, allow secret entry on the
page and send it only to the local Runtime over its same-origin API. A separate
`SourceCredentialStore` interface stores, reads, and deletes credentials by
integration ID. On Windows, use Windows Credential Manager. Other operating
systems may provide native backends behind the same interface when supported.

The browser, source catalog, onboarding drafts, API responses, logs, and test
diagnostics must never store or return secret values. Read APIs expose only a
configured/missing indicator. The credential API validates integration IDs
and input bounds; adapter test operations resolve secrets server-side. Secret
rotation and removal are available for supported integrations. Do not reuse Pi
model-provider auth records for data-source credentials.

## New-source onboarding

The page offers two explicit paths:

- **Configure a supported connector:** choose an integration with an
  implemented adapter, provide its supported settings/credentials, then run
  connection and capability tests.
- **Register an unsupported source:** create or edit a local onboarding draft.
  Collect source identity and documentation URL, access/auth mode, data
  categories and desired metrics/capabilities, source authority/publisher,
  terms and rights constraints, rate limits, and time-boundary requirements.
  The documentation URL is descriptive metadata; the application does not
  fetch it automatically.

Drafts are local runtime application data under `runtime-data`, not source
code, model context, or Knowledge. Drafts never contain secrets and cannot be
tested or selected by research Workflows. Draft lifecycle:

`draft → ready_for_adapter → adapter_available → verified → enabled`

`ready_for_adapter` means the request metadata is complete; it is a local
workflow state and does not submit data to an external service. The application
matches the draft's stable integration ID to an explicitly composed adapter to
reach `adapter_available`. `verified` requires supported tests to pass and
required publisher, authority, rights, and time-boundary metadata to be
confirmed. `enabled` requires an explicit user action. Enabling only makes the
adapter available to policies that already reference it; it does not add or
change any `SourcePolicy` candidate, authority, or fallback level. Workflow
policy updates remain code-reviewed changes.

There is no arbitrary plugin upload, package installation, JavaScript/Python
script editor, dynamic module import, or user-defined outbound test endpoint.

## API boundary

Add application routes alongside the existing data-source policy route, with
typed request/response contracts for:

- Listing runtime integration descriptors and latest sanitized test states.
- Saving/removing a supported integration's credential without returning it.
- Starting one connection or capability-sample test and retrieving its bounded
  result.
- Creating, listing, and editing local onboarding drafts.

The client never accesses the filesystem or OS credential vault directly. The
service validates all input, rejects tests for unknown or unassembled
integrations, and exposes no arbitrary network target. Existing policy API
semantics remain unchanged.

## Error behavior

Represent at least: missing configuration, authentication failure, timeout,
rate limit, access denied, no sample data, unsupported capability, response
contract mismatch, and other provider failure. Show a concise safe explanation
and stable category; redact credential-like strings, authorization headers,
and provider response bodies. A failed test does not disable the integration,
change source order, or silently run another provider. Rate-limited tests show
the retry condition without automatic repeated calls.

Onboarding drafts remain editable after implementation or verification
failures. Validation errors identify the affected form fields. A draft with
missing terms/rights or authority metadata cannot become verified.

## Acceptance criteria

- The existing policy table remains available and read-only.
- The integration list matches actual Runtime composition, not catalog labels
  or static claims of availability.
- Each displayed test type is explicitly supported by that integration; tests
  are bounded, cancellable when possible, and have separate observable states.
- Secrets are stored through the OS credential backend and do not appear in
  browser storage, JSON files, API responses, logs, or diagnostics.
- Tests do not call canonical Knowledge mutation and do not change Workflow
  policy or fallback order.
- Unsupported sources can be drafted, edited, and resumed after restart, but
  cannot be tested or used in research before explicit code integration and
  verification.
- Connection success, capability sample success, and source-policy coverage
  are presented as distinct outcomes.
- Automated verification covers descriptor accuracy, unsupported-test
  rejection, bounded test behavior, failure redaction, secret-store behavior,
  draft persistence, and the unchanged source-policy behavior. Live external
  provider checks are reported separately from offline fixture tests.

## Non-goals

- Dynamic discovery or loading of arbitrary plugins.
- Editing metric source priorities or fallback policy from the page.
- Adding generic provider routing or changing Workflow, Skill, or Knowledge
  ownership.
- Treating configured metadata, a successful ping, or an onboarding draft as
  proof of usable research coverage.
- Making industry research metric policies fit into the existing generic
  metric-policy table.

## References

- `docs/engineering/specs/2026-09-22-data-source-governance-foundation-v0.1.md`
- `app/services/data-source-catalog.ts`
- `app/runtime/application-runtime.ts`
- `app/services/daily-intelligence-composition.ts`
- `client/src/app/data-sources/DataSourcesPage.tsx`
