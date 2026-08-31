# Task Registry

ResearchHub 的轻量任务数据库。每个可独立执行、审查和验收的工程任务都使用稳定的 Task ID。

## 状态定义

- **Planned**：已登记，尚未开始。
- **In Progress**：正在执行。
- **Review**：实现完成，等待审查或验收。
- **Completed**：实现和必要验证均完成。
- **Blocked**：存在明确阻塞，无法继续。

## 任务列表

| Task ID | Task Name | Status | Priority | Created | Assignee | Commit Hash | Acceptance |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KNOWLEDGE-V0.3-FREEZE-CORRECTION-001 | Correct Knowledge v0.3 Freeze Candidate architecture blockers | Completed | P0 | 2026-08-27 | Luna | `5620302317cf13e2d4faa52be31ad033d3df8b4f` | Accepted — Sol verified |
| KNOWLEDGE-V0.3-FREEZE-CORRECTION-001-R1 | Close Knowledge v0.3 Freeze Candidate residual consistency gaps | Completed | P0 | 2026-08-27 | Luna | `47e312f79a221d7dd45b42508e52526fd61b1a74` | Accepted — Sol verified |
| KNOWLEDGE-V0.3-GOVERNANCE-INTEGRATION-001 | Integrate Knowledge v0.3 Architecture Freeze into project governance | Completed | P0 | 2026-08-27 | Luna | `6e0245b1b30a9896273cfd49e710054931792de4` | Accepted — Sol verified |
| KNOWLEDGE-V0.3-GOVERNANCE-INTEGRATION-001-R1 | Close current-governance residuals after Knowledge v0.3 integration | Completed | P0 | 2026-08-27 | Luna | `747812dcf994ac7804b67d62c82aa9f5fadba00f` | Accepted — Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-A-001 | Add Knowledge v0.3 executable Schema and versioned Domain Model | Completed | P0 | 2026-08-27 | Luna | `ba24ecc82561190aa4c1791034c71f4bf6d1ff70` | Accepted - Sol verified (Stage A closure `c0c70b832a70f2f0fdc533c00236c03d47554d99`) |
| KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R1 | Correct Knowledge v0.3 Schema/Domain structural fidelity | Completed | P0 | 2026-08-27 | Luna | `4b9f5619fdd4e68b079d118860c6adc76da50442` | Accepted - Sol verified (Stage A closure `c0c70b832a70f2f0fdc533c00236c03d47554d99`) |
| KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R2 | Enforce v0.3 Module canonical reference typing | Completed | P0 | 2026-08-27 | Luna | `4906669841f094144081fbe2ad424fd0c232be37` | Accepted - Sol verified (Stage A closure `c0c70b832a70f2f0fdc533c00236c03d47554d99`) |
| KNOWLEDGE-V0.3-IMPLEMENTATION-A-001-R3 | Align Business Exposure financialContribution nullability | Completed | P0 | 2026-08-27 | Luna | `c0c70b832a70f2f0fdc533c00236c03d47554d99` | Accepted - Sol verified (Stage A closure `c0c70b832a70f2f0fdc533c00236c03d47554d99`) |
| KNOWLEDGE-V0.3-IMPLEMENTATION-B-001 | Implement deterministic Knowledge v0.2 to v0.3 migration transformation layer | Completed | P0 | 2026-08-27 | Luna | `2b00ffcd021f70cca1d31259f92dee0105447fd6` | Accepted — Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-B-001-R1 | Harden Knowledge v0.2 to v0.3 migration semantic safety | Completed | P0 | 2026-08-27 | Luna | `61d9590bc453f5b78c417057c17e68569341d553` | Accepted — Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-B-002 | Implement Knowledge v0.3 read, validation, and migration runtime integration | Completed | P0 | 2026-08-27 | Luna | `b401c949a212599e88228366013ec0dee254b30b` | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-B-002-R1 | Correct Knowledge v0.3 Raw identity and runtime validation gaps | Completed | P0 | 2026-08-27 | Luna | `268749316f2b4d8ba58441c8885dcf560d0d3e5e` | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-B-002-R2 | Close Knowledge v0.3 temporal, numeric, and migration recovery gaps | Completed | P0 | 2026-08-27 | Luna | `b835fac3dabfee029796311c222e744b0a326cdb` | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-B-003 | Accept production-like AI Hardware example migration to Knowledge v0.3 | Completed | P0 | 2026-08-27 | Luna | `24973ad5be501ac4088f75c17539a77e90a7d2f4` | Accepted — Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-B-003-R1 | Complete deterministic legacy migration policy and evidence closure | Completed | P0 | 2026-08-27 | Luna | `5a32f9116015ac24151251da05bec64df88af49b` | Completed / Rework Required — Sol verification |
| KNOWLEDGE-V0.3-IMPLEMENTATION-B-003-R2 | Close temporal migration safety accounting and evidence gaps | Completed | P0 | 2026-08-27 | Luna | Current R2 implementation commit (see Git handoff) | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-001 | Implement Knowledge Curation v0.3 Schema Context Builder | Completed | P0 | 2026-08-27 | Luna | Current C1 implementation commit (see Git handoff) | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-001-R1 | Complete Knowledge Curation v0.3 semantic Schema Context | Completed | P0 | 2026-08-27 | Luna | Current C1-R1 implementation commit (see Git handoff) | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-002 | Implement Knowledge Curation v0.3 cutover | Blocked | P0 | 2026-08-27 | Luna | — | Superseded by C-002-R1 |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R1 | Implement Curation/Workflow v0.3 integration | Blocked | P0 | 2026-08-27 | Luna | — | Dependency on C-003 |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-003 | Implement and activate Knowledge v0.3 Runtime Foundation | Completed | P0 | 2026-08-28 | Luna | Current C3 implementation commit (see Git handoff) | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R1 | Close Knowledge v0.3 Runtime validation acceptance gaps | Completed | P0 | 2026-08-28 | Luna | `2becf8189c941eb9adf42af4c0e4bc9627c1e3c5` | Superseded by C3-R2/R3 |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R2 | Unify Knowledge v0.3 canonical validation | Completed | P0 | 2026-08-28 | Luna | Current C3-R2 implementation commit (see Git handoff) | Superseded by C3-R3 |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-003-R3 | Finalize Knowledge v0.3 ChangeSet validation boundary | Completed | P0 | 2026-08-31 | Luna | Current C3-R3 implementation commit (see Git handoff) | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R2 | Resume Knowledge Curation/Workflow v0.3 cutover | Completed | P0 | 2026-08-28 | Luna | Current implementation commit (see Git handoff) | Accepted - Sol verified |
| KNOWLEDGE-V0.3-IMPLEMENTATION-C-002-R2-R1 | Close Knowledge v0.3 curation ingestion correctness gaps | Completed | P0 | 2026-08-31 | Luna | Current R1 implementation commit (see Git handoff) | Accepted - Sol verified |
| KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004 | Validate Knowledge v0.3 with the specified real PDF and configured production-like runtime | Blocked | P0 | 2026-08-31 | Luna | Current product-validation evidence commit (see Git handoff) | Blocked / Environment Credential - Historical |
| KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R1 | Resume real PDF Product Validation after credential repair | Completed | P0 | 2026-08-31 | Luna | Current product-validation evidence commit (see Git handoff) | Completed / Root Cause Identified - Sol verified |
| KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R2 | Complete Knowledge v0.3 real PDF product validation | Completed | P0 | 2026-08-31 | Luna | Current product-validation evidence commit (see Git handoff) | Completed / Engineering Rework Required - Sol verified |
| KNOWLEDGE-V0.3-INTEGRATION-FIX-C-005 | Fix Knowledge curation contract propagation through DSH | Completed | P0 | 2026-08-31 | Luna | Current integration-fix commit (see Git handoff) | Completed / Accepted - Sol verified |
| KNOWLEDGE-V0.3-PRODUCT-VALIDATION-C-004-R3 | Rerun full Knowledge v0.3 real PDF product validation after C5 | Completed | P0 | 2026-08-31 | Luna | Current product-validation evidence commit (see Git handoff) | Completed / Runtime Execution Blocker - Sol verified |
| KNOWLEDGE-V0.3-LLM-EXECUTION-DIAGNOSTIC-C-006 | Diagnose Knowledge curation LLM execution envelope | Completed | P0 | 2026-08-31 | Luna | Current diagnostic commit (see Git handoff) | Completed / Accepted - Sol verified |
| KNOWLEDGE-V0.3-LLM-REASONING-POLICY-C-007 | Set explicit operation-specific reasoning policy for Knowledge Curation | Completed | P0 | 2026-08-31 | Luna | Current reasoning-policy implementation commit (see Git handoff) | Completed / Sol Verification Pending |
| RH-GOV-001 | Initialize project execution state management system | Completed | P0 | 2026-08-23 | Luna | `539c35c3daecf6ac0e35947a45d12271ff6044b4` | Accepted |
| RH-DOC-002 | Synchronize architecture baseline documentation | Completed | P0 | 2026-08-23 | Luna | `539c35c3daecf6ac0e35947a45d12271ff6044b4` | Accepted |
| RH-ENG-001 | Validate minimum ResearchHub Harness integration | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — typecheck and integration test passed |
| RH-ENG-002 | Add financial plugin foundation and Market Plugin MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — plugin, plugin and integration tests passed |
| RH-DESIGN-001 | Add Research Artifact Framework foundation | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — type, validation, serialization and relationship tests passed |
| RH-ENG-003A | Add Event Analysis Skill Framework MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — Skill, Plugin, Artifact and Session integration tests passed |
| RH-DESIGN-002 | Add Research Memory Framework MVP | Completed | P0 | 2026-08-23 | Luna | Historical task commit | Accepted — Memory core, Local JSON plugin, adapter and full tests passed |
| RH-DESIGN-003 | Add Research Evaluation Framework MVP | Completed | P0 | 2026-08-23 | Luna | `febd88f88150bba025b6f3c1dd59f7bd73dfd8db` | Accepted — Review, Outcome, Evaluation Engine and Memory tests passed |
| RH-DESIGN-004 | Add financial data plugin framework | Completed | P0 | 2026-08-23 | Luna | `7dbbde94019f648219b3f4c137cc67b1ffaacb7e` | Accepted — Plugin, Registry, Plugin bridge and full tests passed |
| RH-ENG-005 | Add real A-share market data plugins | Completed | P0 | 2026-08-23 | Luna | `336213464b61d03fbed95738eff67bce46665461` | Accepted — Tushare, AkShare, normalization, fallback and full tests passed |
| RH-DESIGN-006 | Design Information Plugin architecture | Completed | P0 | 2026-08-24 | Luna | `7f7fb65db70827d02aaa40e8786ca18b9000faa1` | Accepted — NewsItem, Plugin Interface, Source Hierarchy and compatibility design completed |
| RH-ENG-006 | Implement Announcement Plugin MVP | Completed | P0 | 2026-08-24 | Luna | `e0e8e5b3d3320be2624c5583d2e590f8b63714ad` | Accepted — CNINFO adapter, NewsItem normalization, symbol mapping, Registry, Plugin and Event Analysis tests passed |
| RH-ENG-007 | Implement Professional Media Plugin MVP | Completed | P0 | 2026-08-24 | Luna | `6b162241c4e55492bf3b6a2b53d5aa1316cbcd34` | Accepted — media NewsItem, publisher/tier metadata, Registry, News Plugin and Event Analysis tests passed |
| RH-DESIGN-007 | Design Financial Intelligence Data Layer | Completed | P0 | 2026-08-24 | Luna | `7cf3187961bec7bf0cfadd0dd74a745366fae864` | Accepted — FinancialStatement, FinancialMetric, Plugin, Plugin, Evidence and Memory compatibility design completed |
| RH-ENG-008 | Implement Financial Statement Plugin MVP | Completed | P0 | 2026-08-24 | Luna | `05b216b0022618c55ae2fcddfe081f36f472a742` | Accepted — Tushare/AkShare adapters, normalization, Financial Plugin, Evidence integration and full tests passed |
| RH-DESIGN-008 | Design Research Workflow Architecture | Completed | P0 | 2026-08-24 | Luna | `77f0728ade15a1d38ee4050499da98241bcf7595` | Accepted — Workflow, Research Manager, Harness boundary, Report aggregation and compatibility design completed |
| RH-ENG-009 | Implement Research Workflow Framework MVP | Completed | P0 | 2026-08-24 | Luna | `c809b19bb59ecc901536d840950440bcf810cb4e` | Accepted — Workflow Registry, Research Manager, Event Analysis chain, Report View, Harness integration and E2E tests passed |

| RH-ENG-010 | Upgrade Event Analysis Skill Architecture | Completed | P0 | 2026-08-24 | Luna | `229f523cb13ce9bf19a46063a4bd45397a81425b` | Accepted — Skill Package, research method, Evidence/output schemas, Evaluation rules and full regression tests passed |

| RH-ENG-011 | Implement Company Research Skill Package MVP | Completed | P0 | 2026-08-24 | Luna | `1d342afd7f14bd8a7edf7633e8968484cc3860a9` | Accepted — Company Skill Package, company-research Workflow, Artifact chain, Evaluation compatibility, and E2E tests passed |
| RH-DESIGN-012 | ResearchHub Architecture Simplification & Governance Update | Completed | P0 | 2026-08-24 | Luna | Current task commit | Accepted — Architecture v0.3, ADR-010, Harness boundary, and project governance synchronized |
| ARCH-REFACTOR-002 | Separate DSH Runtime from Research Assets | Completed | P0 | 2026-08-24 | Luna | Current task commit | Accepted — root dsh Runtime Orchestrator, package boundaries, one-way dependency, imports, tests, and governance synchronized |

| ARCH-REFACTOR-003 | Migrate to Research Output and Knowledge architecture | Completed | P0 | 2026-08-25 | Luna | `eca21579a44287d8346090fd852dc076810c6acb` | Accepted — Research Output, Research Object, Knowledge boundary, and ADR-014 documented |
| KNOWLEDGE-ARCHITECTURE-001 | Freeze Knowledge Architecture v0.1 | Completed | P0 | 2026-08-25 | Luna | `0208e4e65619002d6a40109c731bf9c39f3156a9` | Accepted — top-level Knowledge asset, Workflow lifecycle, and no automatic formation documented |
| KNOWLEDGE-IMPLEMENTATION-PHASE-001 | Implement Knowledge Layer foundation | Completed | P0 | 2026-08-25 | Luna | `61e346ce7b3b3ffb35b90bb340b5b198f5bcf093` | Accepted — Loader, Access Skill, Validation Skill, fixtures, and integration tests passed |
| KNOWLEDGE-IMPLEMENTATION-PHASE-001-REWORK-001 | Close Knowledge foundation acceptance gaps | Completed | P0 | 2026-08-25 | Luna | `babb3e275fb28a569e8aea4a354f1587933b5740` | Accepted — Registry, module, relation, lifecycle, and workflow integration gaps closed |
| KNOWLEDGE-PRODUCTION-DATASET-V0.1 | Add AI Hardware Production Knowledge Dataset | Completed | P0 | 2026-08-25 | Luna | `c28272c2dd1041d3b96b1f16cfa9fb1cc1f4e843` | Accepted — source-traceable production assets and dataset validation passed |
| KNOWLEDGE-PRODUCTION-DATASET-V0.1-REWORK-001 | Rework Production Knowledge Dataset semantics | Completed | P0 | 2026-08-25 | Luna | `6d3d12a00002141d95585361440e19dfe26326ac` | Accepted — financial segment mapping, provenance, taxonomy, and placeholder cleanup passed |
| KNOWLEDGE-PHASE-2C-FRONTEND-MIGRATION-001 | Migrate Knowledge frontend to production projection | Completed | P0 | 2026-08-25 | Luna | `e4540f6a9e46f22b679b31485cb540142ab35030` | Accepted — read-only directory, graph, entity endpoints and frontend migration passed |
| KNOWLEDGE-PHASE-2C-SEMANTICS-AND-LOCALIZATION-001 | Align Knowledge frontend semantics and localization | Completed | P0 | 2026-08-25 | Luna | `d80fe14a5f52f59bdf5998a9f5a080182fdd19ea` | Accepted — Chinese-first content and company-scale semantics passed |
| KNOWLEDGE-PHASE-2C-FINAL-CLOSEOUT-001 | Close Knowledge frontend production validation | Completed | P0 | 2026-08-25 | Luna | `9af84922ca08c84bf19cfe26fa5e3bdafe2e07f2` | Accepted — company total-revenue scale and final frontend regression passed |
| KNOWLEDGE-PHASE-2C-SEGMENT-SCALE-001 | Scale Knowledge graph nodes by market size | Completed | P1 | 2026-08-25 | Luna | `788792464a33b2a4c0d0e6d53f0aef0eb9a722d3` | Accepted — raw segment scale input, comparable-level frontend sizing, fallback, and regression tests passed |
| RH-TOOLS-001 | Add AKShare Financial Bridge tooling | Completed | P1 | 2026-08-25 | Luna | `820ba4d3443a6a695069f07a609882e775423827` | Accepted — lightweight Python bridge source committed and pushed |
| RH-GOV-CONSISTENCY-002 | Close architecture, governance, and AKShare Bridge consistency gaps | Completed | P0 | 2026-08-26 | Luna | `c18878b551627c77a0396c1980436291622d7e10` | Accepted — Bridge period/date semantics, deterministic tests, documentation, and governance synchronized |
| RH-GOV-CONSISTENCY-002-R1 | Close default-period and cross-period indicator regressions | Completed | P0 | 2026-08-26 | Luna | `9a9cd7d85bd4664c64b88c33f2c2d4a1a34dfb79` | Accepted — latest available default period, explicit period semantics, indicator alignment, and network-free validation passed |
| KNOWLEDGE-ARCHITECTURE-002-DOC-SYNC-001 | Synchronize Knowledge Base Instance Architecture v0.2 governance | Completed | P0 | 2026-08-26 | Luna | `2a1a53d129d088328224c2a35b1ef0fa34870657` | Accepted — Sol verified |
| KNOWLEDGE-ARCHITECTURE-002-DOC-SYNC-001-R1 | Close Knowledge architecture governance acceptance gaps | Completed | P0 | 2026-08-26 | Luna | `Current task commit` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-A-001 | Establish Knowledge Base runtime foundation | Completed | P0 | 2026-08-26 | Luna | `Current task commit` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-A-001-R1 | Close Knowledge Base runtime foundation contract gaps | Completed | P0 | 2026-08-26 | Luna | `Current task commit` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-A-001-R2 | Finalize Knowledge Base runtime foundation integrity | Completed | P0 | 2026-08-26 | Luna | `Current task commit` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-B-001 | Migrate current read path to scoped Knowledge Base | Completed | P0 | 2026-08-26 | Luna | `Current task commit` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-C-001 | Implement durable Knowledge Base mutation infrastructure | Completed | P0 | 2026-08-26 | Luna | `e8e775fa495cc7f0bf3214a6a4fff6e54203e041` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-C-001-R1 | Close durable mutation contract gaps | Completed | P0 | 2026-08-26 | Luna | `56b4faae472e104398d4dd41eedf63014ecd3016` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-C-001-R2 | Finalize durable mutation concurrency and errors | Completed | P0 | 2026-08-26 | Luna | `1f8c8a42d89690046da9f9ea7bb83090f273fd37` | Accepted — Sol verified |
| KNOWLEDGE-INGESTION-D1-CURATION-001 | Implement Knowledge Curation Skill | Completed | P0 | 2026-08-26 | Luna | `5385c3b965a50e20558655bc45f9569de345b801` | Accepted — Sol verified |
| KNOWLEDGE-INGESTION-D2-WORKFLOW-001 | Implement Research Report Knowledge Ingestion Workflow | Completed | P0 | 2026-08-26 | Luna | `f5c3033741efb7bf3767603ebea9cc47455fde29` | Accepted — Sol verified |
| KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R1 | Close Research Report Ingestion Workflow contract gaps | Completed | P0 | 2026-08-26 | Luna | `d7694c19118b00611222f3e2c89b0ac9c44f1d0a` | Accepted — Sol verified |
| KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R2 | Finalize ingestion audit and partial planning | Completed | P0 | 2026-08-26 | Luna | `028d539cc95073ad964d7dc9a4e50a4b5868135c` | Accepted — Sol verified |
| KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R3 | Finalize ingestion workflow completion semantics | Completed | P0 | 2026-08-26 | Luna | `696fec71d7ec750fa9cc68c38759951e68c972ff` | Accepted — Sol verified |
| KNOWLEDGE-PRODUCT-VALIDATION-SETUP-001 | Prepare real AI Hardware product validation runtime | Completed / Awaiting Local Inputs | P0 | 2026-08-26 | Luna | `be31e87837f4f97a28cecb886c4b8a4b09cdbbae` | Accepted — Sol verified |
| KNOWLEDGE-PRODUCT-VALIDATION-SETUP-001-R1 | Harden real DeepSeek validation runtime composition | Completed / Awaiting Local Inputs | P0 | 2026-08-26 | Luna | `404b03cebf7a201d03d5a6d064a487454266da17` | Accepted — Sol verified |
| KNOWLEDGE-PRODUCT-VALIDATION-RUN-001 | Run first real AI Hardware Knowledge Product Validation | Paused / DOCUMENT_RESOLUTION | P0 | 2026-08-26 | Luna | `a7ed95ed78da410c51a18a649d1805216bc17b2e` | Review Pending / Sol Verification |
| KNOWLEDGE-PRODUCT-VALIDATION-RUN-001-R1 | Resume first real AI Hardware Knowledge Product Validation | Product Validation Blocked | P0 | 2026-08-27 | Luna | `e4d6568771c03e586b5d085c508c3fcce54e4eeb` | Review Pending / Sol Verification |
| KNOWLEDGE-DOCUMENT-RESOLUTION-001 | Harden research report document resolution | Completed | P0 | 2026-08-26 | Luna | `33334ef9a45f2ba379c6189f3346a6845afcaf25` | Accepted — Sol verified |
| KNOWLEDGE-DOCUMENT-RESOLUTION-001-R1 | Make Docling runtime deterministic and validate offline parsing | Completed | P0 | 2026-08-27 | Luna | `a073264862b1cb01e4c07e306f1e5cabf38ecac7` | Accepted — Sol verified |
| KNOWLEDGE-INGESTION-D2-WORKFLOW-001-R4 | Correct D2 R3 implementation commit traceability | Completed | P0 | 2026-08-26 | Luna | `6046c9eb29b4a29e2200d28917ee6faa98bf5a00` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-E-001 | Implement Knowledge Schema Migration Runtime | Completed | P0 | 2026-08-26 | Luna | `8265eaf53c721e33c8038e114c6f243cb034ebbe` | Accepted — Sol verified |
| KNOWLEDGE-RUNTIME-MIGRATION-E-001-R1 | Close migration runtime contract gaps | Completed | P0 | 2026-08-26 | Luna | `bf9f2a37fa51a2e14637e74d21d05df9a889f8ee` | Accepted — Sol verified |

## RH-DESIGN-004 Acceptance Scope

- `DataPlugin`、`PluginResult` 和 `FinancialDataMetadata` 已定义并进行运行时校验。
- `PluginRegistry` 支持注册、类型化 Handle 查询、重复/未知 Plugin 错误。
- Mock Market/News Plugin 位于 `packages/plugins/adapters/`，未接入真实 API 或爬虫。
- Market/News Plugin 通过 Registry 获取 Plugin，不直接导入或实例化具体 Plugin。
- Plugin 输出保留 source、timestamp、quality、confidence 元数据。
- TypeScript、Plugin、Plugin、Artifact、Memory、Evaluation、Skill 和 Harness integration 测试通过。

## RH-ENG-005 Acceptance Scope

- `TushareMarketPlugin` and `AkShareMarketPlugin` implement the common `DataPlugin` boundary without SDK dependencies.
- Tushare uses native HTTP with `TUSHARE_TOKEN`; AkShare uses an explicit `AKSHARE_ENDPOINT` bridge and never silently falls back to Mock.
- PluginResult metadata includes `plugin`, `source`, `timestamp`, `quality` and `confidence`.
- Market Plugin method, input and business output contract remain unchanged.
- Registry composition supports configured primary/fallback, combined failure context and deterministic injected-transport tests.
- No real network call is made by the default test suite; no Harness Core, trading logic or frozen architecture change was introduced.

## RH-DESIGN-006 Acceptance Scope

- `NewsItem` 定义了 title、content、publishedAt、source、sourceType、symbols 和 confidence。
- `sourceType` 严格限制为 `official`、`media`、`community`。
- Information Plugin 复用 `DataPlugin`、`PluginResult` 和 `FinancialDataMetadata`。
- Source Metadata、Plugin Metadata 和 item-level confidence 的边界已明确。
- 未接入真实新闻 API、公告源、政策源、爬虫、NLP 或情绪分析。

## RH-ENG-006 Acceptance Scope

- `AnnouncementPlugin` emits canonical official `NewsItem` values with source metadata.
- `CninfoAnnouncementSourceAdapter` isolates official-source protocol and uses injectable transport.
- Security-code and explicit issuer-name mappings reject ambiguous or mismatched announcements.
- Registry exposes `announcement-plugin` through an unchanged News Plugin contract.
- Plugin, Plugin, and Event Analysis integration tests pass without network dependency.
- No Harness Core, News Plugin implementation, Event Analysis Skill, trading logic, NLP, crawler, or frozen architecture document was changed.

## RH-ENG-007 Acceptance Scope

- `MediaPlugin` emits `sourceType: 'media'` NewsItem-compatible records.
- Media metadata includes `publisher`, strict `tier-1|tier-2|tier-3`, and confidence.
- Fixture `ProfessionalMediaSourceAdapter` isolates source integration without network dependency.
- Registry exposes `media-plugin` through an unchanged News Plugin contract.
- Plugin and Event Analysis integration tests pass.
- No named media API, News Plugin implementation, Event Analysis Skill, NLP, sentiment, community-opinion, trading, or frozen architecture document was changed.

## RH-DESIGN-007 Acceptance Scope

- Historical `FinancialStatement` and `FinancialMetric` models preserve period, unit, currency, source, and confidence.
- Financial Plugin reuses `DataPlugin`, `PluginResult`, `FinancialDataMetadata`, and Plugin Registry.
- Financial Plugin converts structured facts into existing Evidence Artifacts.
- Thesis, Prediction, Evaluation, and Memory compatibility is documented without adding raw financial Memory entries.
- No real API, forecast model, valuation strategy, investment advice, trading logic, or frozen architecture document was changed.

## RH-ENG-008 Acceptance Scope

- `TushareFinancialPlugin` and `AkShareFinancialPlugin` implement the common Financial Plugin boundary without SDK dependencies in the TypeScript runtime.
- Income, balance-sheet, and cash-flow fields are normalized to `FinancialStatement` and `FinancialMetric` with period, unit, plugin, source, timestamp, quality, and confidence metadata.
- Plugin Registry composition supports configurable primary/fallback selection and fixture-only injection for tests.
- Financial Plugin exposes `get_financial_snapshot(symbol)` and does not contain vendor calls, credentials, forecasts, valuation logic, or investment advice.
- Financial Evidence Adapter creates session-linked Evidence artifacts from reported metrics.
- TypeScript, Plugin, Plugin, Artifact, Memory, Evaluation, Skill, and Event Analysis integration tests remain green.
- No Harness Core, frozen architecture document, external production dependency, or real network call was introduced into the default test suite.

## RH-DESIGN-008 Acceptance Scope

- Workflow Definition is independent from Skill and contains lifecycle metadata, steps, inputs, outputs, dependencies, and version.
- Research Manager coordinates research intent, Workflow selection, Skill execution, Artifact collection, and Report assembly.
- Harness Workflow Runtime / Harness Runtime Loop remains the execution boundary; ResearchHub does not build a parallel Harness Workflow Runtime, Harness Runtime, or Plugin Runtime.
- Skill remains reusable research methodology and does not contain cross-skill workflow graphs or direct data-source calls.
- Research Report is an aggregate view over Evidence, Thesis, and Prediction Artifact IDs, not a new base Artifact type.
- Artifact, Memory, Evaluation, Plugin, Plugin, Session, and Cordis Plugin boundaries remain compatible.
- RH-ENG-009 is the next engineering implementation task; no production workflow code is included in this design task.

## RH-ENG-009 Acceptance Scope

- Workflow Definition and Registry validate and register the `event-analysis` workflow.
- Research Manager validates Research Requests, resolves Workflows, creates execution context, invokes an injected executor, and aggregates Artifact IDs into a non-Artifact Report View.
- Harness-facing Research Manager service and `run_research_workflow` tool reuse the existing DSH, Session, Skill, Tool, and JSONL persistence boundaries.
- Event Analysis invokes Market, Announcement, Media, and Financial Plugin ports; Announcement and Media reuse the existing News Plugin contract through different Plugin Handles.
- Evidence, Thesis, and Prediction are created with the active Session ID and validated relationships.
- TypeScript, workflow, Manager, existing plugin/artifact/memory/evaluation/skill tests, and Harness end-to-end workflow test pass.
- No Harness Core, Harness Runtime Loop, Harness Workflow Runtime, Plugin Runtime, trading logic, investment advice, or external network dependency was introduced.

## 历史 RH-ENG-001 约束

- DeepSeek Harness `0.1.1-rc.2` 依赖版本已锁定。
- `tests/integration/` 是验证代码隔离区，不是生产业务实现。
- Runtime → Extension → DSH → Skill → Plugin → Session 路径已验证。
- 未修改 Harness Core、业务 API、生产配置或金融业务逻辑。

## 登记规则

- Task ID 必须稳定、唯一且可搜索。
- 新任务记录名称、状态、优先级、创建时间和验收标准。
- Completed 任务必须记录完成人、commit hash 和验收状态。
- Blocked 任务必须记录阻塞原因和恢复条件。

## SKILL-MIGRATION-001 — Financial Research Skill Asset Migration

**Status:** Completed
**Priority:** P0
**Created:** 2026-08-24
**Commit:** Current task commit

Acceptance scope: Equity Research, Industry Research, Earnings Review, and
Valuation packages with Plugin ports, schemas, templates, deterministic tests,
runtime-neutrality scan, and DSH invocation validation.
