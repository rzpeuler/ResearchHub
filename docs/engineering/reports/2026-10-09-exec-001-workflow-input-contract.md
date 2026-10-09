# RHL-EXEC-001 — Workflow Input Contract & Semantic Dispatch Closure

## Status

`IMPLEMENTED / SOL ACCEPTANCE PENDING`

## Baseline and delivery

| Item | Value |
| --- | --- |
| Repository | `C:\Users\Administrator\Desktop\ResearchHub` |
| Worktree | `C:\Users\Administrator\Desktop\ResearchHub_worktrees\EXEC_001` |
| Baseline (`origin/main`) | `9424d3b01185d8df8310c224cffa8e81622e69b6` |
| Branch | `codex/exec-001-workflow-input-contract` |
| Implementation HEAD | `4555d4c45a24f7146b37d754bb7bf999488c9e4f` |
| Final delivery HEAD | Report commit at branch tip; exact SHA is recorded in the delivery response |
| Main merge | None |

The implementation uses the existing `ResearchDispatchService`,
`WorkflowDefinitionRegistry`, `ReasoningExecutor`, `ResearchRequest`,
`ResearchDispatchDecision`, `WorkflowService`, and `ResearchBundle`. No new
planner, identity Agent, runtime, provider framework, Knowledge schema, or
orchestration layer was added. The implementation changes stay within dispatch,
runtime response handling, client feedback, and their tests.

## Final contracts

`WorkflowDefinition.inputSchema` is the authoritative parameter contract sent
to semantic resolution and used for deterministic validation. Registry
construction rejects schemas that are not strict object schemas, schemas that
allow undeclared properties, and disagreement between the schema's top-level
`required` list and the compatibility `requiredInputs` projection.

The shared AJV validator checks types, enums, nested objects, arrays, lengths,
numeric bounds, date/time formats, conditional requirements, and unknown
properties. Missing required fields remain distinguishable from invalid values.
Workflow-specific business conditions that JSON Schema cannot settle remain
with their existing Workflow.

The semantic resolver receives the selected Workflow schema, request policies,
allowed Skills, source-library context, and the injected Runtime timestamp. An
explicit Workflow request narrows the available Workflow description to that
single definition. The resolver may make one bounded repair call after an
invalid semantic output; it does not run an open-ended repair loop. Invalid
semantic output falls back only to the existing deterministic dispatch path,
whose arguments are subjected to the same selected schema.

The dispatch boundary independently checks selected Workflow existence,
schema-valid arguments, mapped and executable Skills, explicit Workflow
identity, and exact preservation of `contextPolicy` and `persistencePolicy`.
LLM-provided `missingRequiredInputs` is advisory; the service recomputes missing
fields from the selected schema. Unknown argument fields are rejected, never
silently copied to an adapter.

## LLM, identity, and policy responsibilities

The LLM interprets user language into business inputs such as company or
industry names, reporting period, event anchor, analysis methods, and thesis
content. The LLM does not establish canonical identity. Company symbols and
canonical entity, claim, thesis, source, and observation references are checked
against active canonical objects in the mounted Schema 0.4 Knowledge Base.
Missing, ambiguous, inactive, or out-of-window references return
`UNRESOLVED_REFERENCE`; no adapter starts on that result.

Synchronous compatibility dispatch cannot perform that trusted Knowledge
lookup, so it now returns `UNRESOLVED_REFERENCE` before invoking an adapter
whenever the selected contract contains a company identity or the supplied
arguments contain canonical references. A regression test proves the adapter
call count remains zero.

Runtime-owned values remain outside LLM authority. The service supplies its
clock, run ID, source-library context, and the original context and persistence
policies. Semantic output that changes either policy is rejected. No user
Knowledge-write permission is enabled by the resolver.

## Date semantics

An injected clock is used for deterministic dispatch context and current Thesis
Lifecycle timestamps. Current Valuation keeps `asOf` undefined; Runtime time
does not turn a current request into historical analysis. An explicit valid
past cutoff is normalized to a timezone-aware ISO timestamp. Invalid-calendar
and future cutoffs return `INVALID_INPUT` before adapter execution. A timezone
input such as `2025-06-30T15:00:00+08:00` is normalized to
`2025-06-30T07:00:00.000Z`.

## Missing input, repair, and client feedback

The service returns structured `NEEDS_INPUT`, `INVALID_INPUT`, or
`UNRESOLVED_REFERENCE` feedback containing the selected Workflow, missing
fields, schema-validated arguments, a reason, and a suggested question. The
App renders this feedback and preserves the request text and selected Workflow;
it does not silently submit the same request as ordinary chat. A bounded repair
summary is shown when repair or deterministic fallback was used. Public
resolution diagnostics are restricted to safe codes rather than raw provider
errors.

Full multi-turn form filling and resumption remain outside EXEC-001.

## Representative Workflow cases

### Valuation

The injected-clock test sends a current Valuation request through semantic
resolution, trusted Company verification, and the existing `startValuation`
adapter. It verifies no historical `asOf` is manufactured and preserves the
adapter's real `COMPANY_COVERAGE_NOT_FOUND` blocked reason. Explicit past,
timezone-normalized, invalid-calendar, and future cutoff cases are covered. A
real valuation report is not required by this task.

### Industry Research

The semantic test routes “分析一下锂电池行业的供需变化” to the existing
Industry Research Workflow with the complete industry name. It enters the
existing adapter without inventing a canonical Industry ID. The Industry
catalog and data-source availability remain outside this public input
contract.

### Thesis Lifecycle

The contract distinguishes `CREATE` and `REFRESH`, validates nested
formalization/refresh objects, and reports the conditional `formalization` or
`refresh` requirement. A controlled Schema 0.4 fixture verifies a valid Thesis
reference before adapter start; missing and inactive canonical references are
reported as `UNRESOLVED_REFERENCE`. This path does not accept a Thesis or bypass
the existing human review/Knowledge production gates.

## Existing Workflow contract audit

`createWorkflowDefinitionRegistry()` currently registers nine executable
Workflow definitions. “Extraction coverage” distinguishes an explicit semantic
input test from merely having a schema or adapter test.

| Workflow | Contract ready | Semantic/extraction coverage | Adapter binding | Known product blocker | EXEC-002 | EXEC-003 |
| --- | --- | --- | --- | --- | --- | --- |
| `company_research` | Yes: symbol, optional name/exchange/asOf | Partial: schema and trusted identity path; no dedicated full semantic argument case | Yes, when ResearchService is composed | Exact active canonical Company and downstream coverage/data | Add dedicated full semantic extraction case if the prompt contract changes | Company coverage and evidence availability |
| `daily_intelligence` | Yes: brief type enum and ISO trade date | Yes: morning/evening and date dispatch cases | Yes, when DailyIntelligenceService is composed | Configured signal coverage and trading-date policy | None identified | Signal/source coverage |
| `earnings_review` | Yes: symbol, fiscal year, period enum; optional identity/asOf | Yes: explicit and semantic missing-period cases | Yes, when ResearchService is composed | Exact covered Company and source coverage | None identified | Company/report-period data coverage |
| `event_research` | Yes: discriminated event-anchor variants and company identity | Partial: schema and HTTP Workflow start covered; no dedicated natural-language anchor extraction case | Yes, when ResearchService is composed | Verified Company and user/source-backed event anchor | Add event-anchor semantic cases | Event source availability and company coverage |
| `industry_research` | Yes: industry name, aliases, optional asOf | Yes: semantic industry-name routing and adapter entry | Yes, when ResearchService is composed | Industry evidence/metric source availability | None identified | Industry source and evidence gaps |
| `theme_framework` | Yes: bounded name and optional user definition | Yes: explicit/automatic semantic and App cases | Yes, when ThemeFrameworkService is configured | Active Schema 0.4 Knowledge and human review | None identified | Theme coverage and acceptance workflow |
| `thesis_lifecycle` | Yes: mode-conditional CREATE/REFRESH nested contracts | Yes: nested schema, missing input, valid/invalid reference cases | Yes: existing lifecycle Workflow | Canonical refs, mounted Knowledge, and review gates | None identified | Multi-turn refresh recovery and governed production remain separate |
| `thesis_red_team` | Yes: Company, active Claim ref, optional lookback/asOf | Partial: invalid canonical reference and schema gates; no complete natural-language extraction case | Yes, when ResearchService is composed | Exact active Company/Thesis Claim and source coverage | Add full semantic extraction cases if its input language expands | Company/Thesis coverage and evidence sources |
| `valuation` | Yes: symbol, methods, target year and optional historical cutoff | Yes: current/past/timezone/invalid date and adapter-entry cases | Yes, when ResearchService is composed | Current internal Company coverage can block before data acquisition | None identified | Company coverage and valuation data availability |

The three partial extraction rows identify bounded test follow-ups, not
contract-schema mismatches. The implementation does not change any of these
Workflows' internal research or data behavior.

## Future Workflow extensibility

Tests register a test-only `test_portfolio_review` Workflow with `benchmark`,
`holdings` array, and `reviewPeriod` enum fields. The selected schema is
automatically supplied to semantic resolution and the generic validator checks
valid, invalid, missing, nested, enum, and unknown fields without adding
field-specific dispatch code. Registry tests cover schema replacement,
addition, and deletion. A schema-valid test-only Workflow without a bound
adapter returns an explicit non-start result; it is never reported as started.
The test definition is not present in the production registry.

## Tests and baseline comparison

| Validation | Result |
| --- | --- |
| Focused dispatch + homepage Runtime tests | 27/27 passed |
| Full Client suite | 98/98 passed |
| Full Node suite | 2,112 total; 2,089 passed; 23 failed |
| Exact Node failure-identifier comparison | Baseline: 24 failures; current: 23; 0 new identifiers; 1 baseline-only identifier now passes |
| `npm run typecheck` | Passed |
| `npm run client:typecheck` | Passed |
| `npm run client:build` | Passed; existing 631.32 kB minified chunk advisory remains |
| `git diff --check` | Passed |

The baseline-only test now passing is `Workflow Definition Registry exposes
the current executable research set`. The Node suite exits nonzero on the 23
pre-existing failures; this is baseline-limited, not a green full-suite claim.
The exact logs are `%TEMP%\rhl-exec-001-npm-test-baseline.log` and
`%TEMP%\rhl-exec-001-npm-test-final.log`.

Semantic dispatch tests use controlled `ReasoningExecutor` substitutes:
`MOCK_REASONING_ACCEPTED`. A live provider/model end-to-end run was not
performed: `REAL_MODEL_E2E_NOT_VERIFIED`.

## Known limitations

- Without a configured `ReasoningExecutor`, the service retains the existing
  deterministic extraction fallback; it still applies the selected schema and
  reference gates.
- Identity verification requires structured Knowledge access and an active
  mounted Schema 0.4 Knowledge Base. No identity acquisition system is added.
- Internal product/data limitations such as Company coverage, Industry source
  availability, and Thesis review remain with their owning Workflows and
  EXEC-003 follow-up.
- Event, Company Research, and Thesis Red Team can receive additional
  workflow-specific semantic extraction tests under EXEC-002 without changing
  the shared contract mechanism.
- No authenticated real-model E2E was run.

## Scope and review

Changed production files are limited to:

```text
app/runtime/application-runtime.ts
app/runtime/contracts.ts
app/runtime/server.ts
app/services/research-dispatch-contracts.ts
app/services/research-dispatch-service.ts
app/services/workflow-input-contract.ts
app/services/workflow-registry.ts
client/src/App.tsx
client/src/api/runtime-client.ts
```

Corresponding tests cover Registry/schema behavior, dispatch behavior,
Application Runtime/HTTP behavior, and visible App feedback. No files under
`workflows/**`, `knowledge/**`, or `data/resolver.ts` were changed. The code
diff was reviewed for the direct Pi/Workflow/Skill/Plugin/Knowledge boundary
and `git diff --check` passed.

The final report is committed and pushed on
`codex/exec-001-workflow-input-contract`. The branch remains separate from
`main` pending Sol acceptance.
