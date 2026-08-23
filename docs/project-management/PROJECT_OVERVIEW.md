# Project Overview

## 项目名称

ResearchHub

## 产品定位

ResearchHub 是构建在 DeepSeek Harness 之上的 AI A股个人投资研究员，面向具有基础投资经验的个人投资者。

ResearchHub 的目标是成为持续工作的 AI 研究伙伴，帮助用户提升信息处理效率、研究质量、研究方法一致性和投资决策复盘能力。

ResearchHub 不执行交易，不承诺股价预测，也不替代 DeepSeek Harness 或构建通用 Agent 框架。

## 核心业务价值

- 将市场、公司、行业和事件信息组织为可追溯的研究过程。
- 通过 Skill 和 Workflow 固化研究方法。
- 通过 Capability 解耦 Agent 推理与金融数据来源。
- 通过 Evidence、Thesis、Prediction、Review 等结构化研究产物支持投资研究复盘。
- 通过 Research Memory 和 Decision Memory 累积长期研究资产。

## 用户需求

Phase 1 的目标用户是中国 A股市场中具有基础投资经验的个人投资者。当前架构覆盖的核心研究场景包括：

- 市场情报监控
- 个股研究
- 行业研究
- 异动分析
- 投资决策复盘

明确的非目标包括自动交易、股价预测引擎、量化交易平台、通用 Agent 框架和 Bloomberg 替代品。

## 当前阶段

**Phase 10 — Professional Media Provider MVP**

Architecture v0.2 和 Technical Design v0.1 已完成并冻结；Harness Integration Validation、Financial Capability Foundation、Market Capability、Research Artifact Framework、Event Analysis Skill MVP、Research Memory Framework MVP、Research Evaluation Framework MVP、真实 Market Provider MVP、CNINFO Announcement Provider MVP 和 Professional Media Provider MVP 已完成。当前媒体 Provider 已通过 fixture 验证并接入 News Capability 与 Event Analysis，生产媒体源授权、许可和质量监控仍需部署验收。

## 核心技术方向

- Runtime：DeepSeek Harness。
- 架构模式：Harness Extension + Financial Intelligence Layer。
- 智能层：Research Manager Agent、Research Skills、Research Workflows。
- 能力层：Market、Financial、News、Institution、Community、Knowledge Capabilities。
- 数据层：统一 `DataProvider` 契约、`ProviderRegistry` 和 source/timestamp/quality/confidence 可追溯元数据。
- 记忆层：Knowledge Memory、Company Memory、Research Memory、Decision Memory。
- 基础设施方向：结构化数据、向量数据和未来的图数据存储；具体实现按 Technical Design 和后续 ADR 执行。

ResearchHub 复用 Harness 的 Agent、Plugin、Workflow、Session、Tool 和 Memory 能力，不 fork Harness Core，不让 Agent 直接访问数据库，不把投资结论放入数据插件。

## 架构基线文档

- [ResearchHub Architecture v0.2](../architecture/RESEARCHHUB_ARCHITECTURE_V0.2.md)
- [ResearchHub Technical Design v0.1](../architecture/TECHNICAL_DESIGN_V0.1.md)
- [Research Artifact Design](../architecture/RESEARCH_ARTIFACT_DESIGN.md)
- [Event Analysis Skill Design](../architecture/EVENT_ANALYSIS_SKILL_DESIGN.md)
- [Research Memory Design](../architecture/RESEARCH_MEMORY_DESIGN.md)
- [Research Evaluation Design](../architecture/RESEARCH_EVALUATION_DESIGN.md)
- [Financial Data Provider Design](../architecture/FINANCIAL_PROVIDER_DESIGN.md)
- [Market Provider Design](../architecture/MARKET_PROVIDER_DESIGN.md)
- [Information Provider Design](../architecture/INFORMATION_PROVIDER_DESIGN.md)
- [Announcement Provider Design](../architecture/ANNOUNCEMENT_PROVIDER_DESIGN.md)
- [Professional Media Provider Design](../architecture/MEDIA_PROVIDER_DESIGN.md)

## 长期愿景

逐步建设一个具备持续情报、研究工作流、结构化研究产物、长期研究记忆和结果评估能力的个人 AI 投资研究平台，成为可复盘、可验证、可持续交接的研究系统。
