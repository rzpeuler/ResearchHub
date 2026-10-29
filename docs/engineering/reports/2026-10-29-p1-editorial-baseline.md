# P1 Editorial Baseline — 2026-10-29

This is a read-only baseline from the archived P0-19 pair. It describes editorial quality only. It does not change either report's `17/19 BLOCKED` status or qualify the two failed sections.

## Inputs and identity

Archive root: `runtime-data/company-quality-acceptance/2026-10-28-p0-19-risk-row-fix/` in the local root checkout. Raw report/source bodies and runtime archives are not copied into Git.

| Company | Report / run | asOf | Report SHA-256 | Analysis SHA-256 | Bundle SHA-256 | Workflow SHA-256 | Source snapshot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BYD 002594 | `company-research-002594-82bcc425-d48d-4e55-bc45-111aa8c28ba4` / `82bcc425-d48d-4e55-bc45-111aa8c28ba4` | `2026-10-27T20:19:59.628Z` | `2867b270318b21e334c28246935326dab19fa734c094253bb80637b2c32390c1` | `60c877932829d114eb02af13304402ec5599b4410df5bc63926f4f646489de35` | `1fd11c5f5e7764d23bd4950712faf056efeff09436dd983635b24c156a7a8739` | `43316166217675df70473ed86cf646fa988dd3dfc53be6c4e75f7f32bf6ff7f6` | 42 candidate/content-hash pairs; aggregate `e341f61ea5a3d43be05e3b10e1e2d3597cf5d60e716847194c4514e5603fe2bd` |
| Dongshan Precision 002384 | `company-research-002384-860916a8-4958-4d29-8da1-56ad5dd1c2c6` / `860916a8-4958-4d29-8da1-56ad5dd1c2c6` | `2026-10-27T20:26:46.347Z` | `6fa63686b889150551b42eab66b3ce32f4246871f5a3d4be99117d0e0d8917d4` | `72588193faff4c2e75fb2e07c0b07197619b8c23b9fa49f843e7f05ae34e98b3` | `691f3f561b02523f00865f574f6fd373b202c9dad98502abbd61fa3b5958067f` | `0cf91dfa99a0ca0b1daff3b8711e5e29ab1f07c1d693cfa7f986999adc718ebd` | 25 candidate/content-hash pairs; aggregate `42b23c9e4f0be94534e42eeae1504ba42433ff153d58bfa4a2bd23c4f215b0c9` |

Aggregate source snapshot hash is SHA-256 over the UTF-8 JSON serialization of the candidate ID/content-hash pairs sorted by candidate ID. Both reports contain the same 19 section IDs in the same order and 10 complete method results. Both have `researchQuality.passed=false`, `status=incomplete`, and core coverage `17/19`. The unchanged failures are `bull-base-bear` (`RESEARCH_GAP`, `NO_ATTRIBUTABLE_EVIDENCE`, `WORKFLOW_SECTION_NO_LOCATED_EVIDENCE`) and `variant-perception` (`RESEARCH_GAP`, `VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED`).

## Evidence-location counts by section

| Section | BYD | Dongshan |
| --- | ---: | ---: |
| company-overview | 21 | 24 |
| business-model | 43 | 45 |
| business-segments | 50 | 33 |
| revenue-profit-drivers | 39 | 32 |
| products | 76 | 76 |
| technologies | 17 | 31 |
| industry-exposure | 58 | 42 |
| supply-chain | 18 | 21 |
| competition | 20 | 26 |
| financial-quality | 45 | 66 |
| growth-drivers | 36 | 44 |
| management-capital-allocation | 78 | 115 |
| catalysts | 6 | 30 |
| risks | 34 | 44 |
| valuation | 2 | 2 |
| bull-base-bear | 0 | 0 |
| variant-perception | 28 | 13 |
| investment-thesis | 21 | 32 |
| monitoring-checklist | 22 | 35 |

## Editorial findings

### BYD

- **Existing through-line:** battery/electronics capabilities support vehicles and intelligent systems, with computing infrastructure as an extension; commercialization and returns remain unproven. The thesis cites annual-report evidence at `official-c19c34dd239b2e9c@paragraph:198,3251,167`.
- **Strong support:** disclosed intelligent-vehicle, flash-charge/storage and server/liquid-cooling progress at `official-c19c34dd239b2e9c@paragraph:164,166,342,347,561`.
- **Strong counterevidence:** H1 product revenue declines and profit/operating-cash divergence at `official-c19c34dd239b2e9c@paragraph:707,708,706` and `akshare-financial-002594@paragraph:1`; customer concentration at `official-f7c8d23d2829a5e8@paragraph:918,922,923`; price competition at `official-f7c8d23d2829a5e8@paragraph:397`.
- **Monitoring:** nine cited items cover product revenue mix, profit, cash/capex, working capital, customer concentration, goodwill, computing, vehicle/charging execution and historical valuation inputs. The checklist is executable, but several individual rows repeat caveats already stated in the thesis or method chapters.
- **Classification:** `EDITORIAL_ORDERING` (the principal automotive counterevidence arrives after broad strategic framing); `DUPLICATE_OR_GENERIC` (repeated scope caveats and detailed method facts in the short synthesis); `SOURCE_MISSING` / `OUT_OF_P1_SCOPE` for blocked scenarios and expectation evidence. No material cross-section contradiction was found in these two synthesis sections.
- **Baseline scores (0–4):** thesis clarity 3; causal evidence chain 3; counterevidence/failure conditions 3; monitorability 3; cross-section consistency 3; concision 2. The 2 reflects a 1,524-character thesis plus nine monitoring bullets with repeated scope wording, for example “客户匿名仅限制身份、产品映射、合同和替代性” is repeated across thesis and monitoring (`official-f7c8d23d2829a5e8@paragraph:918,922,923`).

### Dongshan Precision

- **Existing through-line:** manufacturing capabilities are extending into AI-infrastructure products; value depends on profitable delivery, integration and cash conversion rather than strategic positioning. Evidence includes acquisition and product positioning at `official-39e591fa149e4543@paragraph:821,816` and `official-296fff2b2889c26f@paragraph:584,585`.
- **Strong support:** EML product stages at `official-296fff2b2889c26f@paragraph:359,360,362`; product-category margin and qualification/expansion limits at `official-39e591fa149e4543@paragraph:885-891,895,899`.
- **Strong counterevidence:** customer concentration at `official-39e591fa149e4543@paragraph:965,968-970`; H1 revenue/profit versus operating-cash movement and working-capital screen at `akshare-financial-002384@paragraph:1`.
- **Monitoring:** nine items include separate top-five and largest/second-largest customer measures. The distinction is useful, but both rows track the same concentration mechanism and the thesis repeats the same identity/attribution limitation. The thesis also reproduces five annual product-revenue amounts already covered in the business-segment chapters (`official-39e591fa149e4543@paragraph:862-877`).
- **Concrete copy defect:** the source-bound sentence joins a citation to the next word: `...第二大客户7.00%； [official-39e591fa149e4543@paragraph:965]匿名仅限制身份...`. The supporting content is otherwise present and correctly locatable.
- **Classification:** `DUPLICATE_OR_GENERIC` (repeated concentration caveat and product-revenue list in synthesis); `EDITORIAL_ORDERING` (monitoring begins with two versions of one customer-risk mechanism before commercialization/cash checks); `SOURCE_MISSING` / `OUT_OF_P1_SCOPE` for the blocked valuation/scenario claims. No material cross-section contradiction was found in these two synthesis sections.
- **Baseline scores (0–4):** thesis clarity 3; causal evidence chain 3; counterevidence/failure conditions 3; monitorability 3; cross-section consistency 3; concision 2. The 2 reflects a 2,262-character thesis that repeats the product revenue table and customer caveat, plus the citation-spacing defect above.

## M1 decision

Both archived synthesis sections already meet a professional baseline in five of six dimensions; this task therefore targets demonstrable editing gains, not a claim that the underlying research is weak. Minimal candidate gains are: (1) lead with the decisive present-period driver and its strongest disconfirming evidence; (2) compress method-detail repetition while preserving the source locators and limits; (3) reorder monitoring around the same driver → proof/invalidator chain and consolidate only genuinely duplicative indicators. Do not add scenarios, expectation estimates, thresholds, or facts to fill the blocked sections.

## Replay boundary

The report/analysis sidecars retain method outputs, source text, source content hashes and exact locators, but `sourceSummaries` do not serialize the normalized-source `rights` object or `retrievedAt`. New synthesis will use only the exact allowed evidence set from the saved synthesis handoff (9 candidate IDs for BYD; 6 for Dongshan), not all archived source bodies. Those IDs map to the existing CNINFO, public-web, structured-financial and valuation adapters; the current adapters explicitly mark them `accessScope=public`, `aiProcessingAllowed=true`, and `retentionAllowed=true` (`plugins/research-acquisition/official.ts`, `plugins/research-acquisition/company-public-web.ts`, `workflows/company-deep-research/workflow.ts`, and `workflows/company-deep-research/valuation-sections.ts`). No rights values are inferred from the source text or written back to the archive. The exact source content hashes and `asOf` remain fixed. Because `retrievedAt` is not part of the synthesis handoff and no time-sensitive or historical quote claim may be added, this is a same-source-snapshot editorial replay, not a replay of the full acquisition event.
