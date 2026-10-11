# RHL-EXEC-003-A-004 — Unified Research Product E2E & Readiness Closure

**Status:** IMPLEMENTED / SOL ACCEPTANCE PENDING
**Branch:** `codex/exec-003-a-004-unified-product-e2e`
**Baseline main:** `87f55224c1c7389dba75b41b6e6ec39bc1f986bc`
**Product readiness:** ENGINEERING_READY; CORE_PRODUCT_READY not established.

## 1. Baseline & Git State

A-003 commit `87f55224c1c7389dba75b41b6e6ec39bc1f986bc` was verified as an ancestor of `origin/main`. The A-004 worktree was created from that exact clean `origin/main`; baseline evidence is in [RHL-EXEC-003-A-004-baseline.json](../../../tests/validation/evidence/RHL-EXEC-003-A-004-baseline.json). The root checkout was left untouched. A-004 is not merged to `main`.

## 2. Scope and Architecture Compliance

Work stayed within Company Research, Valuation, Earnings Review, their existing Application/Workflow/Skill/Plugin paths, runtime status restoration, and required parser cancellation behavior. No new Agent Runtime, orchestration framework, Knowledge schema, provider framework, or product line was introduced. Existing `ResearchService`, `ResearchDispatchService`, `DataResolver`, `SourcePolicy`, Pi ModelRuntime, ResearchReport, ResearchBundle, Gateway, and Writer boundaries remain authoritative.

## 3. User Entry Points

| Entry | Evidence and result |
|---|---|
| ResearchRun UI → RuntimeClient → HTTP Application API | Client tests cover selection, input, start, run ID restoration, polling exhaustion, resume, terminal state and report/bundle navigation. Real HTTP product-start E2E is in the two HTTP artifacts in Sections 14–15. |
| `ResearchDispatchService.startAsync` → verified identity → production binding → `ResearchService` → Workflow → Bundle | `tests/app/services/research-dispatch-security-identity.test.ts` now executes the production Valuation binding through the DataResolver, checks unresolved market data, and reloads a matching blocked Bundle. |
| Pi Application Tool → `ResearchService` → Company Workflow | `tests/app/pi/research-company-tool-integration.test.ts` invokes the actual `research_company` tool against `ResearchService`, reloads the Report, verifies run identity and confirms the mounted Knowledge tree is unchanged. |

The deterministic Pi tool integration uses controlled provider data. The separate live Pi ModelRuntime result is recorded in Section 16. No browser automation was used to claim an HTTP E2E.

## 4. Company Research

The real 002487 HTTP run completed with verified identity, one AKShare structured source and ten usable CNINFO sources in the earlier capped run. Its report and bundle reloaded, the report carried six HTTPS links, and its isolated Knowledge tree did not change. A second capped run saved the full generated report in [RHL-EXEC-003-A-004-report-002487-company.json](../../../tests/validation/evidence/RHL-EXEC-003-A-004-report-002487-company.json): identity and cutoff are explicit; provider-returned financial observations carry period and publication date and are labeled `CURRENT_VALUE_ONLY`; unavailable profile/market values and unsupported sections remain explicit gaps. It does not assert units or historical numeric value versions that the data did not prove.

The live snapshot had a CNINFO timeout and no profile fields. It contains a bounded financial report rather than a full investment thesis. The older capped run had usable CNINFO evidence; both artifacts are retained so the source outcome difference is visible. A report's section count is not used as a quality proxy.

## 5. Valuation

The 002487 and 600519 live HTTP comparisons both stopped with `VALUATION_MARKET_PRICE_UNAVAILABLE`. Financial transport returned 70 rows for 002487 and 103 for 600519; fiscal-year basis and official publication metadata were available, but no eligible market rows/price were available. PE/PB eligibility alone did not authorize an output without price. Reports were not fabricated; blocked bundles were reloaded. Freshness, exchange calendar coverage, PE/PB calculations, publication timing and PIT guards remain covered by focused deterministic suites, including A-002's 143 freshness tests.

## 6. Earnings Review

002487 FY2025 and H1 2026 both returned `EARNINGS_PERIOD_EVIDENCE_UNAVAILABLE`. CNINFO parsing exceeded the configured 600-second bound; AKShare observations did not satisfy the exact-period official filing gate. Each run produced an explicit blocked state, no false earnings report, a reloaded Bundle, and an unchanged isolated Knowledge tree. `ACTUAL_VS_CONSENSUS_REAL_DATA_GAP` remains a valid gap when no qualifying consensus is available. The 600519 FY/H1 attempt results are recorded in Section 15 after the current real run completes.

## 7. Verified Security Identity

Live 002487 evidence resolves `002487 / 大金重工 / SZSE` from `akshare_security_directory`; current Pi ModelRuntime evidence uses the same identity. Production Dispatch passes one identity handoff into the ResearchService binding and rejects conflicting exchanges before provider execution. First-run unverified Company identity blocks instead of creating a Company through a write-enabled request. Deterministic identity and Pi tool tests verify same-symbol/exchange consistency.

## 8. Data Source and PIT

Company financial rows retain provider-returned period end and publication time; unsupported units and historical value-version proofs are not inferred. Valuation only uses a price when DataResolver validates its source, session freshness, exchange calendar coverage, analysis cutoff and period metadata. Earnings applies exact fiscal period, official filing/publication timing and current-value versus historical-PIT gates. The real evidence distinguishes AKShare, CNINFO, GDELT and configured market fallbacks and records unavailable sources.

## 9. Knowledge Read-only Integrity

Every real HTTP artifact hashes the complete isolated Schema 0.4 Knowledge tree before and after. All recorded runs show identical paths and SHA-256 digests, including first Company research without a canonical Company. Pi tool integration also snapshots the complete tree. Tests cover Raw archive, manifests, registry and other Knowledge-owned paths. Reports/Bundles use application-owned report and bundle stores only.

## 10. Authorized Knowledge Write Control

`writeKnowledge=false` prevents Gateway dry-run submissions from producing Raw archive or registry side effects and prevents temporary references from becoming canonical refs. Existing verified Company subjects remain readable. Unverified first-run identity cannot bypass identity governance even when a caller asks for writes. Authorized writes still use the existing Knowledge Production Gateway, validated ChangeSet and Writer; no direct canonical-write path was added.

## 11. Workflow Lifecycle and UI

The UI preserves the active run ID and restores status polling after navigation/reload; users can resume tracking after the default polling window. Pending Bundle status does not show a premature open action. Tests cover completed, completed-with-review, blocked, failed and cancelled projections, and prevent a cancelled run from later being represented as completed. Docling parser timeout/cancellation now terminates the process tree instead of leaving the Workflow indefinitely active.

## 12. Report/Bundle Reconciliation

Real HTTP runs reload Report and Bundle by their persisted IDs. For completed Company runs, Report `workflowRunId`, Bundle `workflowRunId` and requested run ID match. Blocked Valuation/Earnings runs retain explicit terminal status and a reloadable Bundle without inventing a Report. Dispatch integration asserts the same run ID and blocked terminal status in the persisted Bundle.

## 13. Cross-Workflow Consistency

The two-symbol matrix attempts Company, Valuation, FY2025 Earnings and H1 2026 Earnings in isolated Schema 0.4 Knowledge. One Company run completed, but no symbol completed the required Company → Valuation → Earnings triplet because market price and exact-period official filing evidence were unavailable. Identity, timeline semantics, report IDs, bundle IDs and read-only isolation are checked independently; dates are not collapsed into a single cutoff.

### Formal product acceptance matrix

Each cell records the observed evidence, including blocked cells; `blocked` means a safe explicit gap, not a successful research result.

| Acceptance dimension | Company Research | Valuation | Earnings Review |
|---|---|---|---|
| User input correct | HTTP request includes 002487, SZSE, verified name and `maxSources=1` in [Company artifact](../../../tests/validation/evidence/RHL-EXEC-003-A-004-real-http-002487-company-cap1.json). | HTTP request includes symbol, exchange and PE/PB methods in [Valuation comparison](../../../tests/validation/evidence/RHL-EXEC-003-A-004-real-http-valuation-comparison.json). | HTTP attempts explicitly use 002487 FY2025 and H1 2026 in [002487 matrix](../../../tests/validation/evidence/RHL-EXEC-003-A-004-real-http-e2e-attempt-002487.json). |
| Verified security identity | `002487 / 大金重工 / SZSE`, source `akshare_security_directory`, in Company artifact. | Same resolved security in Valuation comparison; mismatch checks in `research-dispatch-security-identity.test.ts`. | Same resolved security and source in 002487 matrix. |
| Real Provider | AKShare usable source and CNINFO 10 usable sources in the capped Company run; GDELT unavailable. | Financial transport succeeded but market transport/eligible price did not; recorded as blocked, not usable valuation. | AKShare returned one usable source, but CNINFO official evidence failed for the requested periods. |
| PIT / exact period | Financial rows include period/publication dates and explicit `CURRENT_VALUE_ONLY`; see full report snapshot. | FY basis and official publication verified; historical numeric version and eligible market price are not claimed. | FY2025 and H1 2026 exact-period gates were applied; no substitute-period actuals are used. |
| Deterministic data quality | Provider observations and profile/market gaps are listed in [full Report snapshot](../../../tests/validation/evidence/RHL-EXEC-003-A-004-report-002487-company.json). | `VALUATION_MARKET_PRICE_UNAVAILABLE`; no PE/PB result is emitted without eligible price. | `EARNINGS_PERIOD_EVIDENCE_UNAVAILABLE`; source timeout does not become a result. |
| Semantic result / fallback | Company Report completed with bounded facts and explicit gaps; live Pi timeout used deterministic fallback (Section 16). | Safe blocked result; no model estimate substitutes for missing deterministic inputs. | Safe blocked result; no actual-vs-consensus comparison is fabricated. |
| ResearchReport | Company report reloaded; `reportType=company_research`, exact `workflowRunId`, 19 report sections and real HTTPS evidence links. | No Report is emitted for the blocked run; report reference is absent in the valuation artifact. | No Report is emitted for either blocked exact-period run. |
| ResearchBundle | `research-bundle-d73ca28d-b685-409a-8e39-3268c5913430`, reloaded and tied to the same run. | Blocked Bundle reloaded for each symbol; terminal state matches the run. | Both blocked Bundles reloaded; terminal state matches each run. |
| Read-only Knowledge | Full isolated tree SHA-256 unchanged in the Company artifact and the full report snapshot run. | Full isolated tree unchanged in valuation comparison. | Full isolated tree unchanged in 002487 matrix. |
| Report reference authenticity | 4 HTTPS links in the capped run; no canonical refs are asserted without persisted source objects. | No Report or canonical refs are fabricated for the blocked run. | No Report or canonical refs are fabricated for blocked runs. |
| Application status consistency | HTTP 202 start; workflow `completed`; Report and Bundle IDs share `runId`. | HTTP start/status reaches `blocked`, reason is preserved, Bundle reloads. | HTTP start/status reaches `blocked`, exact gap is preserved, Bundles reload. |
| Report / Bundle reload | Report and Bundle `workflowRunId` equal the request `runId`. | Bundle reload validated; no Report exists to open. | Bundle reload validated; no Report exists to open. |

## 14. Real 002487 E2E

Evidence: [capped live attempt](../../../tests/validation/evidence/RHL-EXEC-003-A-004-real-http-e2e-attempt-002487.json), [maxSources=1 Company run](../../../tests/validation/evidence/RHL-EXEC-003-A-004-real-http-002487-company-cap1.json), [Valuation comparison](../../../tests/validation/evidence/RHL-EXEC-003-A-004-real-http-valuation-comparison.json), and [full Company report snapshot](../../../tests/validation/evidence/RHL-EXEC-003-A-004-report-002487-company.json).

| Workflow | Result | Reload / isolation |
|---|---|---|
| Company Research | Run `3a9b9279-6bde-4ced-91f5-b18f9920c6eb`: `REAL_PROVIDER_COMPLETED`; AKShare 1 usable source, CNINFO 10, GDELT unavailable. | Report and Bundle reloaded; 6 HTTPS links; Knowledge tree unchanged. The additional maxSources=1 run is `d73ca28d-b685-409a-8e39-3268c5913430`. |
| Valuation | Run `08d231f6-ad1b-46d5-9ee7-144999620856`: `REAL_PROVIDER_BLOCKED`; `VALUATION_MARKET_PRICE_UNAVAILABLE`. | No fabricated Report; blocked Bundle reloaded; tree unchanged. |
| FY2025 Earnings | Run `c349c1f2-fda8-4a48-98e2-7100468d3217`: `REAL_PROVIDER_BLOCKED`; `EARNINGS_PERIOD_EVIDENCE_UNAVAILABLE`. | No fabricated Report; Bundle reloaded; tree unchanged. |
| H1 2026 Earnings | Run `c878f2b7-2c8f-4d90-a292-f4d818573762`: `REAL_PROVIDER_BLOCKED`; `EARNINGS_PERIOD_EVIDENCE_UNAVAILABLE`. | No fabricated Report; Bundle reloaded; tree unchanged. |

The initial uncapped attempt is retained as `REAL_HTTP_E2E_INCOMPLETE` because it exceeded the intended source bound; it is not used as the final Company result.

## 15. Real 600519 E2E

Evidence: [600519 live HTTP matrix](../../../tests/validation/evidence/RHL-EXEC-003-A-004-real-http-600519-e2e.json), [full Company Report snapshot](../../../tests/validation/evidence/RHL-EXEC-003-A-004-report-600519-company.json). All four capped live runs finished. All four have synchronized terminal states, matching and reloadable Bundles, unchanged read-only Knowledge trees, and the final tree digest matches the initial digest. A Report is present only for the completed Company run; its absence on blocked runs matches their empty `reportRef` and Bundle `reportId`.

| Workflow | Run / result | Source and artifact evidence |
|---|---|---|
| Company Research | `546a40b8-f6e4-4181-99ae-e7fee61b74e1`, `REAL_PROVIDER_COMPLETED`. | AKShare returned one usable source; CNINFO and GDELT failed. Report reloaded with identity `600519 / 贵州茅台 / SH`; full report saved; Bundle reloaded. |
| Valuation | `17d64146-742d-471c-906e-e7aaf884a192`, `REAL_PROVIDER_BLOCKED`: `VALUATION_MARKET_PRICE_UNAVAILABLE`. | Market price unavailable; no valuation Report was fabricated. The blocked Bundle reloaded and agrees with the terminal Workflow status. |
| FY2025 Earnings | `eaa578ac-adfc-493a-8bbd-d2ddb48e2af6`, `REAL_PROVIDER_BLOCKED`: `EARNINGS_PERIOD_EVIDENCE_UNAVAILABLE`. | AKShare returned one usable source; CNINFO timed out at 600,000 ms. The blocked Bundle reloaded and agrees with the terminal Workflow status. |
| H1 2026 Earnings | `224c4eaa-8d13-4163-b3aa-f83c72cb2c7d`, `REAL_PROVIDER_BLOCKED`: `EARNINGS_PERIOD_EVIDENCE_UNAVAILABLE`. | AKShare returned one usable source; CNINFO timed out at 600,000 ms. The blocked Bundle reloaded and agrees with the terminal Workflow status. |

## 16. Pi ModelRuntime Outcomes

Evidence: [real Pi ModelRuntime HTTP run](../../../tests/validation/evidence/RHL-EXEC-003-A-004-real-pi-http-e2e.json). Configured model `zhipu-openapi/glm-5.3-flash` was invoked through `PiReasoningExecutor`; `company_research_synthesis` timed out at 180,021 ms. The existing deterministic, evidence-bounded Company fallback completed, and Report/Bundle reloaded with matching run ID. Classification is `REAL_MODEL_FALLBACK`, not model completion. The Knowledge tree remained unchanged.

## 17. Focused Tests

The final focused identity, production Dispatch and Pi Application Tool integration command is `node --import tsx --test tests/app/services/research-dispatch-security-identity.test.ts tests/app/pi/research-company-tool-integration.test.ts`: 13/13 pass. Additional workflow, route, report, DataResolver, PIT, parser timeout, cancellation and UI tests are included in the full regression run below.

## 18. Full Regression Comparison

Clean-main baseline at `87f55224c1c7389dba75b41b6e6ec39bc1f986bc`: client 122/122 pass; Node 2,169 pass and 21 fail (2,190 total). Final full regression: client 124/124 pass; Node 2,178 pass and 21 fail (2,199 total). Exact `(file path, test title)` comparison shows **0 new failures**, **0 baseline failures missing**, and all 21 failure IDs match. One earlier concurrent run had an additional timeout-sensitive reasoning failure; it passed in isolation and did not recur in the final full run.

Other final validations: server `npm run typecheck` passed after the added integrations; `npm run client:typecheck` passed; `npm run client:build` passed with the existing >500 kB chunk warning; `git diff --check` passed.

## 19. Known Product Gaps

- No real sample completed all three required workflows in the same Runtime.
- EastMoney market transport failed in the live comparison; the available fallback did not yield an eligible current market row.
- Official CNINFO PDF parsing exceeded its 600-second timeout in the affected earnings attempts.
- The Pi model call timed out; deterministic fallback completed the Company run.
- The full Company report snapshot has financial observations but no usable company profile; many methodology sections correctly remain gaps.
- Company structured financial data does not prove historical numeric value versions, so `CURRENT_VALUE_ONLY` remains explicit.

## 20. Product Readiness Decision

**ENGINEERING_READY.** Read-only Knowledge integrity, identity gating, PIT and source-quality guards, Report/Bundle contracts, UI status recovery, parser cancellation and the exact baseline failure comparison are covered. **CORE_PRODUCT_READY is not declared**: the required one-symbol Company/Valuation/Earnings completed triplet and fully reviewable reports are not available from the attempted live sources. `PERSONAL_RESEARCH_V1_CANDIDATE` is therefore also not reached. The remaining limitations are data/model availability, not fabricated success.

## 21. Final Commit and Branch State

This report and implementation are delivered on `codex/exec-003-a-004-unified-product-e2e`; final delivery verifies the pushed branch HEAD against the commit containing this report and confirms a clean worktree. The exact full SHA is included in the task delivery. This task does not merge A-004 to `main`.

## 22. RHL-EXEC-003-A-004-FIX-001 — Pi Research Tool Default-Deny Knowledge Persistence

**Status: IMPLEMENTED / SOL ACCEPTANCE PENDING.** No merge to `main` is included.

### Root cause and implementation

`scopedResearchService` previously returned the unwrapped ResearchService when its policy context was absent. With a context object whose current policy was unset, it also passed the original tool input through unchanged. The Company, Valuation, and Earnings Workflows treat `writeKnowledge !== false` as permission to persist when existing Company coverage is present, so an omitted policy could reach the Gateway and Writer as an implicit authorization.

The Pi Application Tool boundary now applies `defaultResearchContextPolicy()` and `defaultResearchPersistencePolicy()` to `research_company`, `review_earnings`, and `analyze_valuation`. It sets `writeKnowledge` only when the active request explicitly carries `true`, and replaces any tool-supplied persistence flag. The validated policy is materialized into the service input at tool invocation, so later asynchronous policy cleanup cannot change the decision. Existing direct `ResearchService` production calls remain available, and existing Thesis lifecycle gates and HTTP ResearchRunPage read-only behavior are preserved.

`ResearchHubSessionRuntime.startPrompt` now installs the default read-only policy when callers omit one. A write-authorized prompt cannot overlap another prompt; steer and follow-up are rejected while such a prompt is active. Once it completes, the next ordinary prompt returns to the default read-only policy. This avoids granting queued session text the previous prompt's write authorization.

### Existing Company and authorized-write regression

The real Pi Application Tool test mounts an isolated Schema 0.4 Knowledge Base, persists `entity:company-600519`, and runs the Company Research Workflow with a controlled evidence plugin and a Skill executor that returns two valid evidence-bound proposals. Under both an omitted policy and explicit `writeKnowledge=false`, the Workflow completes and creates a reloadable ResearchReport; the existing Company subject resolves, while source and claim refs for unpersisted proposals remain empty. The SHA-256 of the complete Knowledge tree—including Canonical registry, Raw data, and ReviewCase files—remains `8f382097fa1352c31b256288a739fd121318bfec2e54e30a58ac1ea7f07ea887` before and after each read-only run.

With explicit `writeKnowledge=true`, the same Company/evidence fixture completes through the existing Gateway/Writer path, commits evidence Sources and both valid Claims, and reloads a report whose canonical references all resolve through the persisted Registry. Existing workflow tests continue to verify that missing identity or evidence and invalid proposals do not bypass governance. The controlled test fixture is not represented as a real-source acceptance.

Machine-readable details, run/report IDs, proposal IDs, reference resolution, and before/after tree hashes are recorded in [FIX-001 Pi default-deny evidence](../../../tests/validation/evidence/RHL-EXEC-003-A-004-FIX-001-pi-default-deny.json).

### Pi, HTTP, and workflow regression coverage

- A policy matrix checks all three affected Pi tools with no policy context, an inactive context, explicit read-only, and explicit authorization. Missing/inactive/read-only policies all reach ResearchService with `writeKnowledge=false`; only explicit authorization reaches it as `true`.
- A live faux-Pi HTTP session calls the ResearchService tool through `/api/conversations/prompt` with policy omitted, explicit read-only, and explicit authorization. The omitted and read-only requests both pass `false`; authorization passes `true`. Follow-up during the authorized request returns a conflict, and the next ordinary prompt passes `false`.
- Company, Valuation, and Earnings workflow regressions pass; the HTTP ResearchRunPage path remains explicitly read-only. No Workflow or Knowledge Schema was rewritten.
- Focused test run: **209/209 passed** across the Pi host, Thesis compatibility, HTTP session, Company, Valuation, and Earnings suites.

### Full regression and remaining product readiness

| Run | Client | Node | Exact baseline comparison |
|---|---:|---:|---|
| Clean `origin/main` `87f55224c1c7389dba75b41b6e6ec39bc1f986bc` | 122 passed / 0 failed | 2,169 passed / 21 failed | Baseline recorded in `tests/validation/evidence/RHL-EXEC-003-A-004-baseline.json` |
| FIX-001 working tree | 124 passed / 0 failed | 2,180 passed / 21 failed | 0 new failures; all 21 failure `(file, test title)` IDs match main |

`npm run typecheck`, `npm run client:typecheck`, `npm run client:build`, and `git diff --check` passed. The build retains the previously documented client-bundle size warning. Product readiness remains separate from this security fix: the live EastMoney market transport and CNINFO PDF parsing timeouts recorded in Sections 19–20 are still blockers, and no Company/Valuation/Earnings completed live triplet is claimed.

### Delivery

FIX-001 is committed and pushed to `codex/exec-003-a-004-unified-product-e2e`. The pushed commit is the delivery SHA; the remote HEAD equality and clean-worktree result are verified for delivery. SOL acceptance remains pending, and this task does not merge to `main`.

## 23. RHL-EXEC-003-A-004-FIX-002 — Complete Pi Research Tool Policy Coverage

**Status: IMPLEMENTED / SOL ACCEPTANCE PENDING.** The FIX-002 change is confined to Pi ResearchService policy enforcement, read-only Gateway evaluation, regression tests, and evidence. No Workflow, Knowledge Schema, DataResolver, Provider, or research algorithm was redesigned.

### Root cause and correction

FIX-001's `scopedResearchService()` proxy listed only Company, Earnings, Valuation, and the two Thesis Lifecycle methods. Industry, Event, and Thesis Red Team therefore reached `ResearchService` without materializing `ResearchRequest` permissions. Thesis CREATE/REFRESH also had a no-policy pass-through that treated an absent policy as permission.

The proxy now covers all eight production methods and snapshots effective flags synchronously before invoking `ResearchService`:

`startResearchCompany`, `startIndustryResearch`, `startEarningsReview`, `startValuation`, `startEventResearch`, `startThesisRedTeam`, `startThesisLifecycleRefresh`, and `startThesisLifecycleCreate`.

For the first six methods, `writeKnowledge` is true only when the active policy explicitly sets it true; absent and inactive policies default to false. Tool arguments cannot forge or override it. `useStructuredKnowledge` continues to follow the context policy independently. The explicit `writeKnowledge=true` / `structuredKnowledge=false` combination preserves the request's write permission while disabling structured Knowledge context, as required by the two independent policy controls.

Thesis CREATE and REFRESH now require both active `writeKnowledge=true` and `structuredKnowledge=true`; missing policy, `current: undefined`, read-only policy, or structured Knowledge disabled all reject before the lifecycle service is called.

Production Event testing uncovered a second read-only side effect: `KnowledgeProductionGateway` archived newly acquired Raw evidence before its `writeKnowledge=false` early return. Read-only evaluation now uses a virtual content-addressed Raw ref and does not create Raw files or update `registry/raw.yaml`. Authorized Gateway/Writer behavior is unchanged.

### Policy matrix and authorized behavior

The six read-only-capable Pi methods are exercised across five cases: missing policy context; present but inactive context (`current` undefined); explicit read-only; explicit authorized write; and structured Knowledge disabled. Every case supplies forged `writeKnowledge=true` in the tool input. Captured ResearchService inputs verify default-deny, explicit authorization, independent `useStructuredKnowledge`, and flag replacement. A separate deferred-completion test mutates the shared policy object after tool invocation and verifies the already-captured service input remains unchanged.

Thesis tests cover both CREATE and REFRESH under missing, inactive, explicit read-only, and structured-disabled policies, and verify no lifecycle call occurs. The authorized tool test runs real Thesis Formalize through `ResearchService`, `KnowledgeProductionGateway`, and Writer, committing the Thesis and resolving its admitted Claim evidence. Existing FIX-001 Company integration still proves explicit authorized Sources/Claims reach the same Gateway/Writer path.

### Canonical Company and non-core production evidence

The existing isolated Canonical Company fixture from FIX-001 continues to prove default and explicit read-only Company runs preserve the complete Knowledge tree, with the authorized case persisting validated evidence and Claims.

FIX-002 adds a real `ResearchRequest(writeKnowledge=false) → research_event Pi Tool → ResearchService → Event Research Workflow → KnowledgeProductionGateway` test over an isolated Schema 0.4 Knowledge Base containing canonical `entity:company-600519`. The Skill accepts two evidence-backed Proposals. A forged tool `writeKnowledge=true` is replaced by `false`; both proposals reach the actual Gateway dry-run, zero IDs are committed, and the full tree SHA-256 remains unchanged (`3f5111903948ae08fbda7e930f169048dd5de6e3ea9f3182e96fd97059660d5c` before and after). The Gateway regression separately asserts that dry-run leaves `registry/raw.yaml` and the Raw archive untouched.

Evidence: [Event read-only production chain](../../../tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-event-readonly.json), [authorized Thesis CREATE](../../../tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json), and [FIX-001 Company evidence](../../../tests/validation/evidence/RHL-EXEC-003-A-004-FIX-001-pi-default-deny.json).

### HTTP and session coverage

The faux-Pi HTTP session test retains omitted-policy, explicit read-only, and explicit-authorized prompts; confirms follow-up during an authorized prompt returns HTTP 409; and confirms the next ordinary prompt is read-only. That final prompt invokes `research_event`, a different tool from the authorized `research_company` call, and still reaches ResearchService with `writeKnowledge=false`.

### Full regression and remaining product readiness blockers

Focused policy, HTTP, Company, Thesis, Event, Gateway, Valuation, and Earnings tests passed. The final required full regression reported Client **124/124 passed** and Node **2,183 passed / 21 failed** (2,204 total). The 21 failing `(file path, test title)` identifiers exactly match the 21 recorded at clean `origin/main` `87f55224c1c7389dba75b41b6e6ec39bc1f986bc`: **0 new failures, 0 baseline failures missing**. `npm test` therefore exits nonzero on the repository's existing baseline failures. An earlier Client run had one transient Thesis UI wait failure; the isolated rerun and final full rerun both passed all 124 client tests.

`npm run typecheck`, `npm run client:typecheck`, `npm run client:build`, and `git diff --check` passed. Vite still reports the existing client bundle over 500 kB. The product readiness blockers from Sections 19–20 remain: external live-source availability and parsing prevent a same-symbol Company/Valuation/Earnings completed triplet, and the Pi model result remains classified as deterministic fallback after timeout. This policy fix does not claim CORE_PRODUCT_READY or Sol acceptance.

### Delivery

FIX-002 is delivered on the original branch `codex/exec-003-a-004-unified-product-e2e` and original `EXEC_003_A_004` worktree. The pushed remote branch HEAD, final full SHA, clean worktree, and ancestry status are verified in the delivery record. No merge to `main` is included. Status remains **IMPLEMENTED / SOL ACCEPTANCE PENDING**.

## 24. RHL-EXEC-003-A-004-FIX-003 — Read-only Research Report Reference Integrity

**Status: IMPLEMENTED / SOL ACCEPTANCE PENDING.** The three targeted Workflows now resolve report references against the loaded Schema 0.4 Canonical Registry after Gateway evaluation and before report persistence. Gateway dry-run planning behavior, Schema, and research algorithms are unchanged.

### Root cause and correction

The Gateway intentionally returns proposal-to-reference mappings during `writeKnowledge=false` evaluation. Event and Thesis Red Team copied those planned mappings directly into report fields, while Industry filtered some Section refs but still exposed unfiltered top-level refs, public reference maps, and a possibly virtual Industry subject. A syntactically valid `source:` or `claim:` string therefore could appear Canonical even though it was absent from the actual Registry.

`workflows/canonical-report-refs.ts` now derives the allowlist from `readCanonicalV04Assets(...).registry` and filters report subject/source/claim refs plus Section source/claim/relation refs. It also supports filtering public Workflow ref maps and Gateway intent targets. The Registry loader validates each registered object and its storage before the IDs are used.

- **Event Research** reads the Registry after the real Gateway call, requires the existing Company subject to remain registered, filters report and public source/claim/commitment refs, and removes synthetic `evidence:<candidate>` links. External links are retained only when they are valid HTTPS evidence URLs.
- **Industry Deep Research** validates the reloaded subject is an actual registered Industry Entity, filters top-level/Section refs and public entity/relation/claim/source maps, ID lists, and intent targets. A read-only run without a persisted Industry root returns `blocked` before writing a report; it never invents a subject ref.
- **Thesis Red Team** loads the Registry before both blocked and successful report writes, filters every report/public source and claim ref, and preserves valid existing Company/Thesis refs. Authorized Gateway writes are reloaded and retained when present in the Registry.
- Findings, Proposal IDs, provider results, and other noncanonical research outputs remain available as research results. No Knowledge Schema, Gateway dry-run contract, or research algorithm changed.

### Read-only and authorized production-path evidence

| Workflow | Read-only proof | Reference and persistence result |
|---|---|---|
| Event | `ResearchRequest(writeKnowledge=false) → Pi research_event Tool → ResearchService → Event Workflow → actual KnowledgeProductionGateway dry-run`; existing `entity:company-600519`; two valid accepted Proposals | No Source/Claim writes or committed IDs; every report and Section canonical ref resolves; all external evidence links are HTTPS; full Knowledge-tree SHA-256 is unchanged: `3f5111903948ae08fbda7e930f169048dd5de6e3ea9f3182e96fd97059660d5c` before and after. |
| Industry | Industry Workflow with an existing canonical Industry root and an actual Gateway dry-run | Only the persisted Industry root remains in public Entity refs; top-level and all 16 Section refs resolve; no canonical files change: `080b11c6c9b0494a4acfc18b39fd1331864e7f9778266004e2bd738abd52dc3a` before and after. A separate no-root read-only run is safely blocked without writing a report. |
| Thesis Red Team | Thesis Red Team Workflow, existing persisted Company/Thesis, valid evidence and proposals, `writeKnowledge=false` | Existing subject and Section Claim refs resolve; planned Source/Claim refs are absent; full Knowledge-tree SHA-256 is unchanged: `841b0e96d1d3afcb3316b60e6c21212cf4e93175071636df4f010d07b9067b24` before and after. |

The authorized Thesis Red Team run in the same regression fixture completes through Gateway/Writer, persists one Source and two Claims, and verifies every report ref against the reloaded Registry. Existing authorized Industry coverage also verifies a persisted Industry root and resolvable report refs. Detailed ref lists and hashes are recorded in [Event read-only evidence](../../../tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json), [Industry read-only evidence](../../../tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json), and [Thesis read-only/authorized evidence](../../../tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json).

### Retained policy and application coverage

FIX-001/FIX-002 Pi default-deny matrices, synchronous policy snapshots, authorized Thesis CREATE/REFRESH, raw-free Gateway dry-runs, Company/Valuation/Earnings allow/block behavior, HTTP user paths, asynchronous long-task state, and Run/Bundle reconciliation remain in the full regression suite. The Event case above exercises the actual Application-to-Workflow-to-Gateway chain; Industry and Thesis tests exercise their actual Workflows and Gateway against isolated Schema 0.4 Knowledge Bases.

### Validation

Focused tests passed: Event Pi Application integration **1/1**, Industry Deep Research Workflow **51/51**, Industry DOMAIN/identity root gates **2/2**, and Thesis Red Team fixture **3/3**. The Industry no-root cases now explicitly verify that useful data gaps/evidence are retained while report persistence is blocked.

Full validation used a clean `origin/main` worktree at `87f55224c1c7389dba75b41b6e6ec39bc1f986bc` and the FIX-003 working tree based on `135a98bcd2e91aae9ec3811ebaa4518f34362f96`:

| Run | Client | Node | Failure comparison |
|---|---:|---:|---|
| Clean `origin/main` | 122/122 passed | 2,169 passed / 21 failed (2,190 total) | Exact baseline failure set |
| FIX-003 working tree | 124/124 passed | 2,185 passed / 21 failed (2,206 total) | The exact same 21 failure identifiers; 0 new failures and 0 baseline failures missing |

The per-identifier comparison is preserved in [FIX-003 full regression evidence](../../../tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-full-regression.json). `npm test` exits nonzero because those 21 pre-existing failures remain. `npm run typecheck`, `npm run client:typecheck`, `npm run client:build`, and `git diff --check` pass. Vite continues to report the existing client bundle over 500 kB.

### Delivery

FIX-003 is committed and pushed to the original `codex/exec-003-a-004-unified-product-e2e` branch. It is not merged to `main`. SOL acceptance remains pending.
