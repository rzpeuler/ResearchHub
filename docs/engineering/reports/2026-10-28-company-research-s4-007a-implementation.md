# S4-007A Private Scenario Contract Validator

**Task:** `RHL-CQR-P0-19-S4-007A-PRIVATE-CONTRACT-VALIDATOR`\
**Branch:** `codex/company-research-p0-01-06`\
**Frozen starting commit:** `79ed57d35216777b823823d1b7797181d73ce04b`\
**Implementation commit:** `b7ff3ba1e5dcf5f6f5b23160f7052976e6a58b5b`\
**Scope:** private Workflow-domain contract and deterministic validation only.

## Result

Added a private scenario assumption contract and pure validator. The modules are imported only by the new synthetic test file; neither `workflows/company-deep-research/workflow.ts` nor the existing `scenario-assumptions.ts` imports them. No runtime source acquisition, model, independent reviewer, Knowledge write, public schema, SourcePolicy, or atomic Skill method was changed.

The Phase 1 boundary remains fail closed. Inputs can be structurally checked and review fingerprints frozen, but this implementation cannot establish independently verified historical availability or source-use rights. It always returns `reportEligible: false`; it never changes a claimed status into `VERIFIED` or `QUALIFIED`.

## Files and exports

The implementation commit contains three new files (1,262 inserted lines). This report is the fourth authorized file.

| File | Role |
|---|---|
| `workflows/company-deep-research/scenario-method-contracts.ts` | Branded runtime-parsed primitives, source/version/rights evidence, orthogonal observation statuses, research-assumption proposals, scenario bridges, reviews, diagnostics, fixture-only equity/EV inputs. |
| `workflows/company-deep-research/scenario-method-validation.ts` | Pure canonical hashing, parsers, provenance/time/scope/period checks, Bear/Base/Bull structure checks, stale-review check, and fixture-only multi-class equity/EV consistency checks. |
| `tests/workflows/company-scenario-method-contracts.test.ts` | Eleven `FIXTURE_ONLY` Node tests. No company estimate or product data is embedded. |
| `docs/engineering/reports/2026-10-28-company-research-s4-007a-implementation.md` | Implementation and validation record. |

Validator exports:

- `hashCanonicalScenarioValue`, `parseScenarioNonEmptyString`, `parseScenarioSha256`, `parseScenarioIsoDate`, `parseScenarioIsoInstant`
- `validateScenarioMethodContract`, `scenarioMethodReviewPacketHash`, `validateReviewFreshness`
- `getHistoricalTrustAnchorStatus`, `preserveIndependentStatusDimensions`
- `validateEquityMarketInput`, `validateEnterpriseValueBridgeConsistency`

The main result has a literal `reportEligible: false`. Review inputs can only remain `REVIEW_REQUIRED`, `UNAVAILABLE`, `REJECTED`, or `STALE_REVIEW`; there is no deterministic reviewer-pass or publication-eligibility API.

## Evidence and temporal trust boundary

The reviewed source and provider structures expose caller/provider metadata, content hashes, and rights booleans; they do not provide an approved signature verifier, externally anchored historical-version registry, or rights authority for this contract. No approved trust-root path was available to bind `trustRoot`, `proofStatus`, publication time, or rights assertions to an independently controlled authority. The private validator therefore uses an empty allowlist and exposes this boundary through `getHistoricalTrustAnchorStatus()`.

For a fact, the validator recomputes the immutable-content SHA, checks that the exact excerpt is within that content and contains the literal raw token, reproduces the per-row binding hash, and compares the source locator, raw and normalized values, conversion, metric, period, scope, unit, currency, share basis, rights text hash, and observation timestamps across the packet. These checks detect internal mismatch; they do not prove who published the content or that a claimed version existed by T0. Local hashes, IDs, signatures-as-strings, status labels, and caller-declared trust roots remain claims. Thus even internally consistent proof packages return `valueVersionStatus: UNVERIFIED`; missing proof is `UNAVAILABLE`; an explicit conflict remains `CONFLICTED`.

The validator keeps `originKind`, value-version status, and consumer eligibility separate. A historical version that is independently verified but unsuitable for the requested consumer can remain `VERIFIED` with `eligibility: UNAVAILABLE`; this private slice has no independent verifier to produce that first condition. In this implementation, structural relevance cannot upgrade eligibility beyond `UNVERIFIED`.

`observedAt`, carrier `sourcePublishedAt`, `retrievedAt`, exact `valueVersionAvailableAt`, and snapshot capture/seal timestamps are distinct. It checks availability and publication against `analysisAsOf`, and for a sealed snapshot enforces capture ≤ seal ≤ analysisAsOf plus capture ≤ retrieval. A retrieval after T0 can be structurally consistent only when the claimed exact immutable version was available by T0; without the absent external proof it remains unverified. A late capture with a forged earlier seal is rejected by ordering checks.

## Scope and deterministic checks

- `ScenarioHorizon` takes an explicit analysis cutoff, T0/T1 mode, base period, target period, target fiscal year, currency, financial scope, method, driver set, and source snapshot hash. No year is hard-coded.
- FY observations must cover January 1–December 31; H1 YTD must cover January 1–June 30. Derived arithmetic requires same-period, same-scope, same-currency inputs and is limited to `OBSERVED_ARITHMETIC_ONLY`; it cannot annualize H1 or implement a forecast/FCFF bridge.
- Scenario structure requires ordered Bear/Base/Bull cases, one consistent horizon and exact driver set, explicit proposal authors/mechanisms/triggers, located input/counterevidence/calibration refs, and resolved adjustment metadata. This validates shape only; it neither supplies assumptions nor computes forecasts.
- Hashes use versioned canonical JSON, recursively sorted object keys, preserved array order except explicitly modeled sets, and SHA-256. The review fingerprint covers horizon, observations and value-version proofs, proposals/scenarios, rights, units/share basis, method and rubric versions. Any changed input changes the packet hash.
- Multi-class share inputs are fixture-only. Required classes must all have quotes and FX at the selected cutoff. Listed-unit conversion is explicit; post-cancellation issued shares are used as-is, pre-cancellation shares require proven cancellations, treasury/repurchased-held shares are handled once, and target-date diluted shares remain separate from market-cap shares.
- EV consistency requires every amount to be known with refs, explicit zero, not applicable with a reason, or unavailable with a reason. Net-debt basis rejects a second cash subtraction; leases cannot be counted both within gross debt and as a separate claim; class equity allocation must reconcile to the total. No EV or per-share price is generated.

## Validation evidence

Commands were run against implementation source commit `b7ff3ba1e5dcf5f6f5b23160f7052976e6a58b5b`.

| Command | Result |
|---|---|
| `node --import tsx --test tests/workflows/company-scenario-method-contracts.test.ts` | 11 passed, 0 failed. Covers missing-vs-zero, status orthogonality, late availability, late retrieval with forged early seal, source/raw/content/rights binding, FY/H1 period label, parameterized target year/driver completeness, canonical review freshness, multi-class quote and share-count treatment, net-debt/cash double counting, and no report-eligibility escape. |
| `node --import tsx --test tests/workflows/company-scenario-assumptions.test.ts tests/workflows/company-valuation-sections.test.ts` | 26 passed, 0 failed; existing assertions unchanged. |
| `npm run typecheck -- --pretty false` | Passed. |
| `npm run client:build` | Passed; Vite emitted its existing large-chunk advisory (>500 kB). |
| `npm run test:node` | 3,233 total; 3,212 passed; 21 failed. The 21 failure titles match all 21 entries in `company-research-p0-19-close-002-gate0-baseline.json`; 0 added and 0 disappeared. Historical recorded run was 3,189 total / 3,168 passed / 21 failed; the current discovered suite is larger. This suite is not green. |
| `npm run client:test` | 223 total; 218 passed; 5 failed. The failures are the same five baseline identities in `company-research-p0-19-close-002-gate0-baseline.json`; 0 added and 0 disappeared. This suite is not green. |

The frozen baseline is failure-identity evidence, not a claim that either full suite passes. No actual-company run or model/reviewer execution was invoked by this task.

## Preservation and delivery

Before/after SHA-256 matched for all five pre-existing dirty evidence files:

| Existing user file | Preserved SHA-256 |
|---|---|
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json` | `7252fd35dec70403fd6bb8b3edc6ffadd25211fd158461a1dde30458bf07f442` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json` | `ef0e7475e0464ca1e3950feb348b0d3ed6dc7383e32200faa3fc413207bc641a` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json` | `12c951be5ca88fb35b155187055b0a15a50d212133c9b68088c0d1674500c0fa` |
| `tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json` | `61cd5cf5b24a7f0fc10746e0269a845d6e29464614c43738d7585ec075fb4670` |
| `tests/validation/evidence/company-quality-pi-default-deny.json` | `4c02302a5b31cec6d93b9298e06a76bd0b834b4bacc914670c7fd06aa6300038` |

The full Node suite regenerated timestamps in four existing evidence JSON files. Those timestamps were restored from the pre-run hashes; all five user-file hashes above match the frozen pre-run values. The paired BYD/Dongshan analysis sidecars also retained their recorded hashes (`60c877…de35` and `725881…e98b3`). The earlier report records the remaining sidecar and Knowledge-integrity hashes; those artifacts were not staged or written by this change.

The implementation commit stages only the three authorized code/test files. The report is committed separately so it can cite the tested implementation SHA. All commits are limited to `codex/company-research-p0-01-06`; no merge to `main` is authorized by this task.

## Stop point

**Phase 1 Contract/Validator Ready for Architecture Review.** This is not `S4 Implemented`, not 19/19, and not P0 accepted. T1/T0 historical proof verification still needs a separately approved external trust/rights adapter. Economic scenario calculations, atomic Skill methodology, independent review lifecycle, production workflow wiring, actual company estimates, report publication eligibility, and Knowledge writes remain outside this authorization.

## FIX-001 修订记录

**Task:** `RHL-CQR-P0-19-S4-007A-FIX-001`\
**Frozen start and remote branch SHA:** `99f4c12cddf9f8bf5da67c8fb9f81c30d9e29664`\
**Implementation commits:** `3e18003771cbcbbcc92d9f10acba875f9c2c2a85`, then `b056950db9eb007bab63bf59b850e483f06c5f64` (final source SHA)\
**Result:** `S4-007A-FIX-001 Ready for Architecture Re-review` (not Phase 1 Accepted).

### Corrections

1. **Review hash preserves operand order.** `normalizeObservationForHash()` now keeps `derivation.inputObservationIds` in the submitted order for every arithmetic operation, including ADD/MULTIPLY. This contract treats the ordered source-reference sequence as review-significant even when the arithmetic operation is commutative; no hidden sorting changes research-evidence identity. Canonical object-key ordering remains unchanged. The new test uses two distinct source facts, both numerically 100, and verifies SUBTRACT (0), DIVIDE (1), and PERCENT_CHANGE (0) produce the same numeric result after reversal but different review hashes. The old review record becomes `STALE_REVIEW` for each reversed packet.

2. **Unavailable EV amounts block input qualification.** An `UNAVAILABLE` amount with a reason remains a valid way to express missing data, but the validator now emits `MISSING_REQUIRED_DRIVER` for each named unavailable component. Debt selection is conditional: gross-debt basis requires gross debt and cash; net-debt basis requires net debt and explicitly excludes separately-subtracted cash/gross debt. The unused debt basis must be evidence-backed `NOT_APPLICABLE` with a nonempty reason. Lease amount is required when lease claims are included with a consistent lease-inclusive earnings basis; otherwise it must be evidence-backed `NOT_APPLICABLE`. Preferred/convertible claims, non-controlling claims, other senior claims, and total equity value must each be known with evidence, an evidenced `KNOWN_ZERO`, or evidence-backed `NOT_APPLICABLE` where appropriate. Any `UNAVAILABLE` component blocks the fixture assessment. Class allocation, class quotes, rights, share-count handling, and `FIXTURE_ONLY` limits are unchanged; no EV or per-share amount is calculated.

3. **Plain-text source coordinates are checked against the addressed segment.** The private validator supports canonical 1-based `paragraph:N` and `line:N` locators. It normalizes CRLF/CR to LF for indexing, splits paragraphs at blank-line separators, then checks the exact excerpt and raw token inside the selected segment. A paragraph excerpt copied from another paragraph fails even though it occurs elsewhere in the full text. A repeated token is distinguished by the segment locator and excerpt context. `page:N`, `table:N`, `cell:N`, noncanonical ordinals, and out-of-range coordinates return `SOURCE_LOCATION_UNVERIFIED`; consumer eligibility is `UNAVAILABLE` and method status is blocked. No page/table/cell coordinate mapper exists in the current source payload, so this patch does not invent one. A correct paragraph/line location only proves local structural correspondence: absent an approved external source/version/rights trust root, historical value status remains `UNVERIFIED`.

Only the four authorized files changed in this revision:

- `workflows/company-deep-research/scenario-method-validation.ts`
- `workflows/company-deep-research/scenario-method-contracts.ts` (one new private diagnostic code, `SOURCE_LOCATION_UNVERIFIED`)
- `tests/workflows/company-scenario-method-contracts.test.ts` (the original eleven tests remain; five new FIX-001 tests bring the total to sixteen)
- `docs/engineering/reports/2026-10-28-company-research-s4-007a-implementation.md` (this appended record)

No new export, public data field, source adapter, trust root, parser, provider, workflow connection, Skill/Registry change, company estimate, model/Reviewer execution, or Knowledge write was added.

### FIX-001 validation

Commands ran against final implementation source commit `b056950db9eb007bab63bf59b850e483f06c5f64` (the working-tree code and test bytes were committed without further source changes):

| Command | Result |
|---|---|
| `node --import tsx --test tests/workflows/company-scenario-method-contracts.test.ts` | Exit 0; 16 passed, 0 failed. Includes three reversed-operand operations with numerically equal results and stale-review assertions; four unavailable EV component cases; evidenced zero vs unavailable/unsupported zero; correct/wrong paragraph, line, repeated-token, and unsupported page/table/cell coordinates. |
| `node --import tsx --test tests/workflows/company-scenario-assumptions.test.ts tests/workflows/company-valuation-sections.test.ts` | Exit 0; 26 passed, 0 failed. |
| `npm run typecheck -- --pretty false` | Exit 0. |
| `npm run test:node` | Exit 1 (inherited suite failures); 3,238 tests, 3,217 passed, 21 failed. Compared each `(file path, location, title)` with `tests/validation/evidence/company-research-p0-19-close-002-gate0-baseline.json`: 21 baseline identities, 0 added, 0 missing. |
| `npm run client:test` | Exit 1 (inherited suite failures); 223 tests, 218 passed, 5 failed. Compared each failure identity with the baseline: 5 baseline identities, 0 added, 0 missing. |

The full-suite logs were captured under the operating-system temporary directory for identity comparison; they are not committed. `npm run client:build` was not run in this fix because there are no client files or interfaces changed.

### Protected artifacts and scope

The target branch pointed to the frozen SHA before edits. Five pre-existing dirty evidence JSON files were byte-backed up outside the repository before full Node/client runs and restored from those exact bytes; all five post-run SHA-256 values match the pre-run values recorded in the preceding section. The Node run may regenerate four evidence timestamps; the byte restoration was verified after both suites. No dirty evidence file was staged.

All 15 files under `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/` matched their pre-run SHA-256 values after testing, including both companies’ run/report/bundle/workflow artifacts and both `kb-integrity.json` sidecars. Those sidecars retain their recorded Knowledge integrity hash `4322cd…f1f0a`. No `ResearchHubData/knowledge-bases` content was used as an input or written by this change. Existing ignored `tmp/`, parser cache, and runtime launch logs remained outside the staged paths; full-suite output was sent to the OS temp directory.

Staging was limited to the three modified code/test paths for the implementation commit, followed by this one authorized report path. No history rewrite or merge was performed. The branch remains `codex/company-research-p0-01-06`; no product gate or `reportEligible: false` was altered. BYD and Dongshan remain 17/19 blocked; P0-19 remains `NOT_ACCEPTED`.

**Stop point:** `S4-007A-FIX-001 Ready for Architecture Re-review`. The accepted Phase 1 status, economic bridge, source/trust infrastructure, independent Reviewer, real company runs, and Knowledge mutation still require their separately authorized decisions.
## FIX-002 修订记录

**Task:** RHL-CQR-P0-19-S4-007A-FIX-002
**Frozen start / remote:** e366e0ffa1db4eeffe3c7ac0ebee7328db856db4; the branch matched this SHA before edits.
**Implementation commit:** ab32984dce53268299a1a02957118a9ddcea4633 on codex/company-research-p0-01-06. This commit contains only the validator and its synthetic tests; this report is appended in a separate documentation commit.

### 修复范围

1. GROSS_DEBT 要求 separatelySubtractedCash 为有有效 evidence refs 的 KNOWN 或 KNOWN_ZERO。有效 NOT_APPLICABLE 和 UNAVAILABLE 都不能充当现金金额；诊断标明 separatelySubtractedCash。NET_DEBT 仍要求现金为有 reason 和 evidence refs 的 NOT_APPLICABLE，以防重复扣现金。
2. KNOWN_ZERO 只有运行时 amount 严格等于数字 0、evidenceRefs 是至少含一个非空字符串的数组时才能解析为零。非零、缺失、null、字符串零、NaN、Infinity 与空 refs 都会阻断；外层 malformed-input fail-closed 捕获保留。
3. KNOWN 金额有限性、符号边界及 refs 规则保持原状；没有改变其他 EV senior claim、租赁、股份分配语义。仅作 FIXTURE_ONLY 结构校验，不证明 refs 对应真实授权来源。
4. 原有 16 个测试函数和断言均保留；新增 3 个测试函数，现共 19 个。新增覆盖 GROSS_DEBT 有效现金/NA/UNAVAILABLE/零值、NET_DEBT + 现金 NA 的有效形态，以及现金和优先/可转债 claim 上的六类畸形 KNOWN_ZERO 输入。原有 NET_DEBT + 单独扣现金反例仍通过。

### FIX-002 验证

所有命令针对最终实现提交 ab32984dce53268299a1a02957118a9ddcea4633。完整 Node 与客户端失败身份仅按冻结 evidence 所规定的 file path、location、title 比较；没有声称两套失败的错误正文逐字相同。

| 命令 | 结果 |
|---|---|
| node --import tsx --test tests/workflows/company-scenario-method-contracts.test.ts | Exit 0；19 passed，0 failed。原有 16 项均保留，FIX-002 的 3 项新增通过。 |
| node --import tsx --test tests/workflows/company-scenario-assumptions.test.ts tests/workflows/company-valuation-sections.test.ts | Exit 0；26 passed，0 failed。 |
| npm run typecheck -- --pretty false | Exit 0。 |
| npm run test:node | Exit 1；3,241 tests，3,220 passed，21 failed。与 tests/validation/evidence/company-research-p0-19-close-002-gate0-baseline.json 的 21 个精确 (file path, location, title) 身份比较：0 新增、0 消失，21 个相同。基线既有记录为 3,238 tests，3,217 passed，21 failed；本次总数多出的 3 项是 FIX-002 新测试。 |
| npm run client:test | Exit 1；223 tests，218 passed，5 failed。与同一 baseline 的五个失败身份逐项相同：0 新增、0 消失。 |
| npm run client:build | 未运行；本修复不改客户端文件或接口。 |

客户端继承失败身份为：

- src/App.test.tsx：server conversation 搜索/筛选与 rename/archive 刷新；版本冲突后的 rename 重试；archive view 移动与 restore。
- src/app/report-navigation.test.tsx：无报告 bundle 打开原对话 Activity；拒绝错误 run 被返回到 conversation artifact request。

全量测试日志及比较过程记录在本机系统临时目录 C:\Users\ADMINI~1\AppData\Local\Temp\ResearchHub-S4-007A-FIX-002-e366e0f\（node-final.log、client-final.log）；日志未加入 Git。

### 用户文件和旧运行保护

五个预先存在的 dirty evidence JSON 在两次 Node/client 回归前逐字节复制到系统临时目录，测试后以原始字节恢复。前后 SHA-256 一致；这些文件未暂存、未提交：

| 用户文件 | SHA-256（前后相同） |
|---|---|
| tests/validation/evidence/RHL-EXEC-003-A-004-FIX-002-thesis-authorized.json | 7252fd35dec70403fd6bb8b3edc6ffadd25211fd158461a1dde30458bf07f442 |
| tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-event-readonly.json | ef0e7475e0464ca1e3950feb348b0d3ed6dc7383e32200faa3fc413207bc641a |
| tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-industry-readonly.json | 12c951be5ca88fb35b155187055b0a15a50d212133c9b68088c0d1674500c0fa |
| tests/validation/evidence/RHL-EXEC-003-A-004-FIX-003-thesis-references.json | 61cd5cf5b24a7f0fc10746e0269a845d6e29464614c43738d7585ec075fb4670 |
| tests/validation/evidence/company-quality-pi-default-deny.json | 4c02302a5b31cec6d93b9298e06a76bd0b834b4bacc914670c7fd06aa6300038 |

两家公司旧 run/report/bundle/workflow 产物及 started 与 KB integrity sidecars 共 15 个文件，测试前后逐文件 SHA-256 均相同：

| 文件 | SHA-256 |
|---|---|
| 002384-analysis.json | 72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3 |
| 002384-bundle.json | 691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f |
| 002384-company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6.md | 3c14d4fbb29aee31bc434b9c99b98de3e79f6897581c4519a46aa87f236eb91f |
| 002384-kb-integrity.json | 4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a |
| 002384-report.json | 6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4 |
| 002384-started.json | 716537e8348f69818ffdc128970e509ed77b367443dc1d4a12292e2d972f87df |
| 002384-workflow.json | 0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd |
| 002594-analysis.json | 60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35 |
| 002594-bundle.json | 1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739 |
| 002594-company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4.md | 0f83c1cd96f5962402eae69503e2c53cdf76e16f01a6acf2f0324e986a036604 |
| 002594-kb-integrity.json | 4322cd0b20c70c400615987b06de5d400e45fecc7676cac11cccfd5678ff1f0a |
| 002594-report.json | 2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1 |
| 002594-started.json | 7f1b87714dea542920e07235206af7db367abfc9f58cb4d043328c49dcb6fe1 |
| 002594-workflow.json | 43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6 |
| summary.json | e9999cf1ff2173c1ce5d87387abb0c65d9473426b5334547285499f0f51f9228 |

Both KB integrity records retain the same readonly result and hash. No Knowledge path was written. Existing ignored parser cache, tmp directory, and runtime launch logs were not staged or deleted. The temporary test logs are local evidence only and are not committed.

### FIX-002 文件与状态

本任务实际修改文件只有三项：workflows/company-deep-research/scenario-method-validation.ts、tests/workflows/company-scenario-method-contracts.test.ts、docs/engineering/reports/2026-10-28-company-research-s4-007a-implementation.md。scenario-method-contracts.ts 未改；五份用户 JSON、独立审查报告、生产 workflow、Skills、公共数据契约、Knowledge 与旧运行均未改。

没有新增 provider、trust root、Reviewer 或真实计算。reportEligible 仍为字面 false；无公司模型重跑、数据源调用或 Knowledge 写入。BYD 与 Dongshan 仍为 17/19 blocked，19/19 及独立语义复核门未变，P0-19 仍 NOT_ACCEPTED。

**停机点：** S4-007A-FIX-002 Ready for Architecture Re-review。不得自行签发 Phase 1 Accepted、S4 Implemented 或 P0-19 ACCEPTED；不得开始 S4-007B.
