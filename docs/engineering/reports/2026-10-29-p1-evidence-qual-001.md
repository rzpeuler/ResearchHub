# P1-EVIDENCE-QUAL-001 — Valuation Evidence Qualification Audit

**Status:** `READY_FOR_CODE_REVIEW / P1_PRODUCT_NOT_ACCEPTED`. Gate A-D are documented below. No P1 product acceptance is claimed.

**Frozen branch/base:** `codex/p1-editorial-synthesis` at `b556dbc5a7b1a06820fff4f9fe2ba1caa1231114`; `origin/main` remains `6989b5f010d596e7436f1f4d49841ad8845ce64c`. PR #10 is OPEN and targets `main`.

**Worktree:** `C:\Users\Administrator\AppData\Local\Temp\researchhub-p1-editorial-synthesis-20261029\worktree`. Root worktree and its dirty/untracked files were not modified. The pre-run protected-set manifest is outside either worktree at `C:\Users\Administrator\AppData\Local\Temp\p1-evidence-qual-001-protection-before.json`.

**Model boundary:** no Company Research model or synthesis call is authorized in this task. Earlier user-directed Runtime connection smoke test is not a Company Research execution and is not used as evidence for synthesis quality. No model call was made while executing this task.

## ROOT_CAUSE_TRACE

### Archived BYD record and source lineage

The frozen P0 archive is `C:\Users\Administrator\Desktop\ResearchHub\runtime-data\company-quality-acceptance\2026-10-28-p0-19-risk-row-fix\002594-analysis.json` with its paired `002594-report.json`. Its report and source bodies are protected user data and were read only.

| Stage / field | Archived value or current-code location | Qualification finding |
|---|---|---|
| Research identity | `asOf=2026-10-27T20:19:59.628Z`; ten method results; P0 report remains 17/19 with `bull-base-bear` and `variant-perception` blocked. | The archived as-of instant is a snapshot boundary, not proof that later responses were available at the boundary. |
| FY2025 basic EPS source | `official-f7c8d23d2829a5e8@paragraph:231`: `基本每股收益（元/股） 3.58 4.61 -22.34% 3.44`; annual report publication `2026-03-27T16:00:00Z`, before the archived as-of. | `3.58` is a genuine disclosed FY2025 basic EPS at this locator. It is also numerically equal to a separate dividend amount. |
| Dividend same-number sources | `official-f7c8d23d2829a5e8@paragraph:43` and `@paragraph:98`: FY2025 cash dividend `每10股人民币3.58元`; later implementation summary `official-c19c34dd239b2e9c@paragraph:1115`. | These are genuine dividend disclosures, not EPS. The same numeric token must not transfer across metric/unit. |
| FY2025 EPS extractor | `workflows/company-deep-research/valuation-sections.ts:42-78`; requires issuer annual report, target fiscal year, publication no later than as-of, financial summary section, a header containing target and comparison years, and the unique `基本每股收益` row. | The extractor is not the source of the dividend/EPS ambiguity. Against the archived filing it resolves exactly `3.58` at `official-f7c8d23d2829a5e8@paragraph:231`. |
| Archived market record | `company-valuation-market-002594-2026-10-27@paragraph:1`: JSON contains `value=82.01`, `unit=CNY/share`, `observationDate=2026-10-27`, `asOf=2026-10-27T20:19:59.628Z`, `adjustmentMethod=UNADJUSTED`, original source `akshare-tencent-historical-market-data`, publisher Tencent, retriever AKShare, URL `https://gu.qq.com/sz002594/zs`, `retrievedAt=2026-10-27T20:20:02.952Z`. | Retrieval is 3.324 seconds after the archived as-of. This exact serialized row contains no `observationAvailableAt`, `valueVersionId`, `valueVersionStatus`, or snapshot/seal proof. |
| Archived resolver metadata | `valuationAcquisition.valuationRequirements` declares the market-price requirement `asOfMode=CURRENT_VALUE_ONLY`; `valuationItems[valuation_market_price].quality.pointInTimeSafe=true`; fallback route completes at `20:20:04.180Z`. | The status is only current-value mode. The archive's boolean does not attest retrieval-before-as-of or immutable historical value identity. No archived `CURRENT_REFERENCE_ONLY` / `HISTORICAL_ASOF_QUALIFIED` state exists. |
| Current quote consumer | `valuation-sections.ts:521-565` rejects a historical quote retrieved after as-of, requires close availability and `retrievedAt >= observationAvailableAt`, and labels current-only quotes as `CURRENT_REFERENCE_ONLY`; lines 559-565 explain that later retrieval is not an archived historical version. | Current consumer preserves the current-reference lane, but the generated quote source currently hard-codes `dataProvenance.asOfMode='point-in-time close'` at line 110 and hard-codes a generic public-rights object at lines 117-118. These do not prove the archived quote's historical version or original provider terms. |
| Quote evidence normalization | `valuation-sections.ts:81-119` serializes quote metric, ticker, amount, unit, observation date, as-of, adjustment, origin, retrieval provider, URL, and retrieval time into one hashed paragraph. | It omits the actual `observationAvailableAt` and value-version evidence even though `ResolvedDataItem` retains acquisition/source metadata (`data/resolver.ts:7-22`; `data/contracts.ts:134-164`). The archive itself also lacks that raw proof. |
| Workflow → synthesis ledger | `workflow.ts:648-677` builds the valuation section, appends generated valuation evidence sources, and resolves same-ID content conflicts. `workflow.ts:723-729` calls `buildSynthesisEvidenceLedger` with method results, sources, valuation Markdown, allowed source IDs, and conflicts, but no structured valuation qualification object or as-of. | The trusted qualification state is dropped at the handoff. |
| Ledger eligibility | `assembly.ts:88-155`: valuation is blocked only when its Markdown contains selected text markers (`UNVERIFIED`, `研究缺口`, etc.) or its citations fail exact resolution. Otherwise any resolvable citation set becomes `eligibility='verified'` at lines 148-155. | This is a production qualification defect: the generated current-reference disclosure says it does not establish historical PIT, but does not contain a recognized blocked marker; the ledger ignores `asOfMode`, `pointInTimeSafe`, `retrievedAt`, `observationAvailableAt`, and value-version proof. Valid locators plus Markdown can therefore upgrade an unqualified valuation paragraph. |
| Handoff into final model | `assembly.ts:2536-2554` builds the ledger and adds evidence from verified workflow entries; `2556-2598` populates allowed citation locations and excerpts from method evidence and verified workflow evidence; `2640+` sends both ledger and excerpts to `company_research_synthesis`. | A blocked ledger entry is excluded from workflow-owned excerpts, but any same source/location independently supplied in a complete method packet can still enter `verifiedEvidenceByLocation` and the general allowed-evidence map. Blocking only the workflow ledger is not a sufficient cross-path invariant. |
| Output validation / repair | `assembly.ts:2678-2719` checks citation existence, runs numeric grounding, attempts deterministic source-locator repair once, and retries the model within `maxAttempts`; failure remains a diagnostic/fallback. Numeric contexts at `2600-2638` are built from method evidence only, not the separate Workflow valuation evidence. | Current numeric rejection is fail-closed but unnecessarily rejects even a correctly cited Workflow EPS row because its evidence context is omitted. It is not a reliable substitute for qualification: the validator is numeric/citation-oriented and can accept the same amount from the wrong financial row. |

### A1 — What `3.58` means and how it reaches synthesis

The actual second raw model response names `FY2025 basic EPS=3.58元/股` and cites `official-f7c8d23d2829a5e8@paragraph:231`, which is the correct annual basic-EPS row. The P0 archived valuation section also cites that EPS row. The same annual report contains a separate dividend proposal of RMB 3.58 per ten shares at paragraphs 43/98; the later interim report records its implementation at paragraph 1115. Therefore:

- **Citable:** both the EPS row and dividend rows are exact, source-backed disclosures.
- **Calculable:** 82.01 / 3.58 = 22.91 as arithmetic only.
- **Actual EPS:** 3.58 CNY/share for FY2025 at paragraph 231.
- **Actual dividend:** 3.58 CNY per 10 shares at paragraphs 43/98 (not 3.58 CNY/share).
- **Historical valuation qualification:** absent for the archived 82.01 quote because its response was obtained after the as-of and the archive contains no immutable value-version proof.

The taskbook's prior description that the second model response itself cited the dividend disclosure as EPS is not borne out by the preserved response: it cites paragraph 231. The validator's repair diagnostic separately listed paragraphs 43/98 and 1115 as same-number alternate source candidates. The historical failure must remain recorded as a numeric-grounding failure, not rewritten as a model-success or as a demonstrated wrong EPS locator.

The EPS extractor is correct and unique. The actual failure is downstream: the synthesis ledger infers qualification from text and locators, while the final numeric validator does not bind an EPS assertion to the unique EPS row when a same-number dividend locator is chosen.

### A2 — Market quote time and qualification fields

| Field | Archive value |
|---|---|
| `priceDate` / `observationDate` | `2026-10-27` |
| `observationAvailableAt` | `NOT_AVAILABLE` in source JSON and evidence excerpt |
| `retrievedAt` | `2026-10-27T20:20:02.952Z` |
| research `asOf` | `2026-10-27T20:19:59.628Z` |
| archived acquisition `asOfMode` | `CURRENT_VALUE_ONLY` |
| `CURRENT_REFERENCE_ONLY` status | `NOT_AVAILABLE` in archived item/paragraph; introduced by later consumer code for current-only presentation |
| `HISTORICAL_ASOF_QUALIFIED` status | `NOT_AVAILABLE` in archive |
| numeric value-version proof | `NOT_AVAILABLE`; no verified ID, availability timestamp, immutable revision/vintage record, or seal evidence |
| original quote rights/terms proof | `NOT_AVAILABLE` in archived quote item; the normalized synthetic source currently assigns generic public processing rights in code |

The code can derive the exchange close's scheduled availability from `dailyCloseAvailableAt(priceDate)`, but that is not a substitute for an archived `observationAvailableAt` or proof of the exact acquired quote version. No missing field is inferred as a pass.

### A3 — EPS extraction correctness

`extractFilingBasicEps` has strict annual-report/year/unique-row constraints at `valuation-sections.ts:42-78`. Existing tests cover missing year header, wrong year, and ambiguous duplicate filing (`tests/workflows/company-valuation-sections.test.ts:402-422`). The extractor correctly returns paragraph 231; do not attribute the P1 failure to this function.

### A4 — Workflow valuation `verified`

Current `buildSynthesisEvidenceLedger` trusts string markers and exact-resolvable citations, not a structured qualification result. Existing tests explicitly encode the weakness: `tests/workflows/company-research-assembly.test.ts:39-56` expects the fabricated short text `已复算的估值基准。[market@paragraph:1]` to be verified solely because its locator resolves. The genuine workflow qualification tests in `tests/workflows/company-valuation-sections.test.ts:248-303` establish current-vs-historical behavior at the section builder but are not connected to that ledger test.

### A5 — Visible → citable → conclusion-qualified paths

The valuation section's own quote and EPS sources are merged into `researchInput.sources` (`workflow.ts:659-677`). Its markdown is handed to the ledger (`workflow.ts:723-729`). If ledger status is verified, `assembly.ts:2543-2554` promotes its references into final synthesis evidence. Method findings and method citations have a separate route into that same evidence map (`assembly.ts:2504-2534,2556-2598`), without metric-specific valuation checks. Thus a blocked valuation ledger alone does not prove that an identical market/EPS source is absent from another complete method's evidence.

No company method result was added or rerun for this audit. The identified general-method bypass is a source-level path, not a claim that the archived BYD methods actually emitted the quote source.

### A6 — Numeric grounding behavior

The committed raw retry response SHA-256 is `fb7de6a273dbabe5e19481c105ba984f6cc6a4ae80f21cb52dd0b3e80a6b274e`. The local execution record SHA-256 is `4efcb4c28d26afad763b8c8725370f803fa355729a825d0dbaa17b848c61ae2b`.

Both archived attempts fail closed at `validateCompanyNumericGrounding`: attempt 1 rejects `82.01元`, `3.58元`, and derived `22.91`; attempt 2 rejects `82.01元` and `3.58元`. The diagnostic identifies the cited sentence but its exact Workflow-owned price/EPS evidence is not in the validator's method-only `evidenceContexts`. The retry diagnostic lists dividend paragraphs 43/98/1115 as alternate same-number candidates; it does not establish that the model cited them.

An offline validator check performed during the prior audit found: (a) correct paragraph 231 EPS with explicit `CNY/share` is accepted when supplied as evidence; (b) a false basic-EPS assertion citing dividend paragraph 43 can also pass because the numeric validator checks number/unit/source-line grounding, not semantic metric identity; and (c) `3.58元/股` against paragraph 231 is rejected when the table's `(元/股)` header context is not supplied. Do not weaken this validator. The minimal fix belongs at the synthesis qualification/citation boundary, where exact metric row identity and historic price eligibility are available.

### A7 — Model-run and replay boundaries

The preserved local run record states provider `openai-codex`, model `gpt-6-luna`, as-of `2026-10-27T20:19:59.628Z`, and two synthesis attempts. The byte-exact second response is the committed text artifact above. Prior execution history documents that the first real response was captured by a wrapper that stopped on an input-hash assertion; that exact response was replayed as attempt 1 of a fresh production assembly run, followed by one real Pi retry as attempt 2. It was not a stubbed success and the final result remained `deterministic_fallback` with the raw failures preserved. This task adds no synthesis invocation and does not reinterpret the prior calls.

## QUALIFICATION_MATRIX

| Evidence | Raw disclosure / normalized source | Resolver and section result | Ledger / synthesis status | Numeric and final outcome |
|---|---|---|---|---|
| FY2025 EPS `3.58 CNY/share` | Official annual report, exact row paragraph 231; published before as-of; source hash in archive `51b0acae9aca05f698070fa41027809b86b425bb93d31a509005b192c78ee5a0`. | `extractFilingBasicEps` uniquely selects paragraph 231. | Can be inserted into valuation markdown; current ledger resolves locators but does not verify EPS metric identity. | Valid EPS fact if exact row is cited; it does not qualify the late quote or historical PE. |
| FY2025 dividend `3.58 CNY / 10 shares` | Annual report paragraphs 43/98; interim implementation paragraph 1115. | Separate source rows, different unit/metric. | May remain source-backed dividend evidence; must not become EPS or valuation input. | Numeric grounding alone can accept same amount with the wrong metric label; deterministic metric-row guard is required. |
| Quote `82.01 CNY/share` | Tencent publisher, AKShare retriever; observation 2026-10-27; archived retrieval at 20:20:02.952Z, after as-of 20:19:59.628Z. | Archive says `CURRENT_VALUE_ONLY`, `pointInTimeSafe=true`; availability timestamp, immutable value version and explicit rights proof are absent. Current section code rejects late quote in explicit historical mode but may keep it as a labeled current reference. | Current ledger can still mark a current-reference paragraph `verified` based on text + locators. | The existing production defect; must remain blocked from historical PE conclusion and not enter allowed conclusion citations. |
| Derived reference PE `22.91x` | Arithmetic `82.01 / 3.58`. | Requires qualified market input and exact FY EPS row; only EPS is established. | No verified ledger eligibility because price vintage is unqualified. | Historical PE must fail closed; not a target price or forecast. |
| Operating facts / numbers | Existing official filing paragraphs and structured financial evidence in methods. | Method-owned rows carry exact source references and bounded contexts. | Remain eligible when their own evidence and rights/PIT gates pass. | Preserve POS-02; do not globally strip numbers or sources. |

### Gate A decision

There is a confirmed production defect in the valuation-to-synthesis eligibility transfer: textual status and resolvable citations can mark a current-only/unqualified valuation section `verified`. The EPS extractor is not defective. The archived second model response cited the real EPS row, not the dividend row; same-value wrong-metric confusion remains a validator gap and must be covered negatively. The archived market quote cannot be repaired into a historical PIT value from the current archive because retrieval is after `asOf` and immutable version/availability evidence is missing. Gate B may implement only a fail-closed handoff and output guard; it must not fabricate a positive BYD historical valuation.

## KNOWN_UNCERTAINTIES

1. The original acquired quote's `observationAvailableAt`, provider vintage/value-version proof, and provider terms are absent from the protected archive. Current `ResolvedDataItem` retains `source`, `sources`, and `acquisition` (`data/resolver.ts:7-22`) and existing `AcquisitionSourceMetadata` supports `observationAvailableAt` and `valueVersion` (`data/contracts.ts:134-164`), but that does not retroactively prove the archive.
2. `quoteSource` currently assigns generic public rights to a synthesized paragraph rather than carrying independently archived quote rights. No external source or licensing lookup is authorized in this task.
3. The current assembly numeric validation context is assembled from method evidence, not verified Workflow valuation evidence. Any correction must preserve fail-closed numeric rules and provide exact contexts only for already-qualified Workflow rows.
4. No claim is made that a fresh Company Research Workflow, acquisition, report write, Knowledge write, or real synthesis was executed.

## Gate A files and immutable evidence

- Raw second response: `docs/engineering/reports/2026-10-29-p1-byd-auto-loop-final-response.txt`, SHA-256 `fb7de6a273dbabe5e19481c105ba984f6cc6a4ae80f21cb52dd0b3e80a6b274e`.
- Prior local two-attempt run record: `tmp/p1-goal-001-replay/auto-loop-final/002594-real-auto-loop-complete.json`, SHA-256 `4efcb4c28d26afad763b8c8725370f803fa355729a825d0dbaa17b848c61ae2b`.
- Archived BYD/Dongshan record set: 15 files, SHA-256 aggregate `8290b5db845754db6677b22fdaccbc4042a553d837e8791122c66e57665f101c`.
- Protected root dirty/untracked set: 39 files, SHA-256 aggregate `21c8a85bcdf7e6f86177ecfcd4091835035f3de9ffb3fc5a45e5e10b6a7c9f75`.
- Protected Knowledge Base set: 6,552 files, SHA-256 aggregate `c1a5d62c83afaec2b068690e2910bdeccec9d18919e710c9edcd9c83a83b4828`.
- Existing P1 worktree untracked set: 27 files, SHA-256 aggregate `33635e6cbed93434db3b0dad0bdd8f87fd92b158d746f9bfa102a908d6527a4d`.

No code was modified before completing this Gate A trace.

## Gate B — Minimal fail-closed repair

**Gate B result: implemented in the existing Workflow/Skill handoff; no Data contract, new provider, method, Skill, reviewer, or architecture layer was added.** The implementation changes only `workflows/company-deep-research/assembly.ts`, `valuation-sections.ts`, and `workflow.ts` within production code.

- `valuation-sections.ts` now carries the quote's actual `observationAvailableAt`, value-version record/status, freshness, and actual as-of mode into the normalized evidence body and `dataProvenance`. `pointInTimeSafe` is true only for an input that passed the historical consumer gate. Historical consumption requires a verified source value-version ID with valid availability no later than as-of, in addition to the existing close-availability and retrieval ordering checks. Current-value references remain labeled current-only and cannot be backcast.
- The normalized synthetic quote no longer invents public reuse/AI/derivative rights. Rights were not present in the archived market acquisition contract; the quote source now sets scope to `unknown`, terms unknown, and all reuse permissions false, so generated boilerplate cannot act as original publisher permission.
- `workflow.ts` passes the research as-of into the same evidence-ledger handoff. In `assembly.ts`, Workflow valuation eligibility now requires a structurally qualified market source and the unique exact annual-report basic-EPS row for the stated year. A market row independently arriving through an ordinary method's evidence packet is checked by the same gate and excluded when unqualified. A basic-EPS statement citing a same-number dividend row is blocked by row identity, not merely amount/unit.
- The final synthesis boundary rejects direct citations to unqualified market sources and rejects a positive PE claim unless the valuation Workflow entry is qualified. Only verified Workflow evidence is added to numeric-grounding contexts; blocked lines remain diagnostics and do not furnish validator context. The existing deterministic repair/retry loop and 19-section contract are unchanged.
- A small citation-scanning correction creates a fresh global locator matcher per sentence while deriving the exact market/EPS locator pair for an existing verified-reference-PE monitoring rule. This does not widen allowed evidence.

**Remaining source limit:** the protected BYD quote has no immutable value-version proof and no original rights evidence. Consequently the actual archived quote stays `CURRENT_VALUE_ONLY`/unqualified and cannot produce historical PE eligibility. The synthetic quote builder also cannot manufacture a proof that the upstream acquisition did not provide. Historical qualification can only happen when the already-existing acquisition source carries the verified version and the normalized evidence carries explicit rights; this audit does not claim that the protected BYD record meets those requirements.

## Gate C — Focused and full regression

| Validation | Result |
|---|---|
| `node --import tsx --test tests/workflows/company-research-assembly.test.ts` | PASS, 115/115. Includes exact EPS-row and alternate method-path negatives, qualified source positive, and a two-attempt invalid candidate test. Both attempts cite the unqualified late/current market value; both are rejected and assembly deterministically falls back without admitting that market source, preserving 19 sections. |
| `node --import tsx --test tests/workflows/company-valuation-sections.test.ts` | PASS, 24/24. Covers late retrieval, early forged seal, self-asserted version/status/hash, raw-content binding, retrieval-before-close, and qualified-version controls. The quote evidence test confirms synthetic source rights remain absent. |
| `npm run typecheck` | PASS (`tsc --noEmit`). |
| `npm run client:typecheck` | PASS. |
| `npm run client:build` | PASS. Existing bundle-size warning remains (744 kB JS chunk; the command reports the configured 500 kB warning threshold). |
| `npm test` | EXIT 1 at the Client suite: 223/228 passed, same five failures as the clean-main reference log: 3 existing conversation rename/archive tests in `src/App.test.tsx`; 2 existing report-navigation tests in `src/app/report-navigation.test.tsx`. Since npm short-circuits after Client failure, Node was run separately. |
| `npm run test:node` | EXIT 1: 3,288 passed / 21 failed of 3,309. Baseline was 3,284/3,305 with 21 failed. Normalized failing test-title sets compare equal: no baseline-only or new-only failure. The four-test count increase is from this branch's additions; failure count did not increase. |

The baseline comparison uses the preserved pre-task logs at `tmp/p1-goal-001-replay/continuation-calls/client-full.log` and `node-full.log`. Full Node output for this run was captured outside the repository at `%TEMP%\p1-evidence-qual-001-node-full.log`. The full Node runner rewrote six tracked validation evidence JSON files in the isolated worktree; those exact files were restored to their pre-run baseline before final review. No files in the root checkout were touched.

## Gate D — Product-quality and protection decision

No model call, Company Research Workflow, new acquisition, source fetch, report persistence, or Knowledge write occurred in this task. The task therefore does **not** establish that a real model produced a passing P1 BYD synthesis. It establishes that the existing production assembly path fails closed for the archived quote and for alternate method evidence paths, while retaining separately qualified operating evidence. The preserved P0 report remains 17/19 and strict `P0-19 BLOCKED`; no status was upgraded.

Read-only source review confirms:

- Financial period: FY2025 basic EPS is grounded to annual report paragraph 231; it is separate from the FY2025 dividend of RMB 3.58 per 10 shares at paragraphs 43/98. The valuation statement must label the former FY2025 and the market observation as 2026-10-27; the two periods cannot be conflated.
- Operating income/profit: the synthesis guard is limited to basic EPS identity and market price qualification. It does not reinterpret operating profit as revenue or alter ordinary operating evidence eligibility.
- Historical market PIT: the archived response was obtained 3.324 seconds after `asOf`; no post-as-of response can be called historical even though the exchange close was available earlier.
- Counterevidence and monitoring: unqualified price/EPS claims cannot enter the final verified ledger or historical PE monitor. Existing qualitative/citation rules for unrelated operations and the 19 stable sections remain in force.

**Decision:** `READY_FOR_CODE_REVIEW / P1_PRODUCT_NOT_ACCEPTED`. The PR remains open against `main`; this task makes no merge. A later CTO/product acceptance would require an independently reviewed real output under separately authorized model-call budget and qualified source evidence. The raw historical BYD source remains unqualified; no candidate report is represented as product-accepted.

## Final protected-set verification

The protected-set manifest captured before Gate A was rechecked entry by entry after tests and report edits. All files exist and their SHA-256 values are unchanged:

| Protected set | Files | Baseline aggregate SHA-256 | Changed / missing |
|---|---:|---|---:|
| Root dirty/untracked user state | 39 | `21c8a85bcdf7e6f86177ecfcd4091835035f3de9ffb3fc5a45e5e10b6a7c9f75` | 0 / 0 |
| P0 BYD/Dongshan archive | 15 | `8290b5db845754db6677b22fdaccbc4042a553d837e8791122c66e57665f101c` | 0 / 0 |
| Knowledge Base | 6,552 | `c1a5d62c83afaec2b068690e2910bdeccec9d18919e710c9edcd9c83a83b4828` | 0 / 0 |
| Pre-existing P1 untracked set | 27 | `33635e6cbed93434db3b0dad0bdd8f87fd92b158d746f9bfa102a908d6527a4d` | 0 / 0 |

The comparison checks every manifest entry's path and file hash. The generated six validation JSON changes described above were restored. New tracked edits are confined to this report, appended acceptance/progress addenda, the three allowed production files, and the two approved test files. Existing untracked `tmp/` and parser cache content remain unstaged.
