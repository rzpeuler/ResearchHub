---
name: product_technology_analysis
description: 解释产品竞争力、技术路线及商业化约束，使用带位置的研究证据，不获取数据或写入 Knowledge。
---

# Product and Technology

## Purpose

解释产品竞争力、技术路线及商业化约束。

## Invocation Match

用于产品矩阵、技术差异和护城河问题，由 Workflow 选择并独立执行。

## Typical Intents

- 产品矩阵、技术差异和护城河问题。

## Inputs

产品及应用材料、技术证据、客户需求、asOf。材料仅限已获取正文；每项包含 sourceCandidateId 及 paragraph 位置。

## Produces

中文 answer、markdown、fact/inference/assumption findings 及其证据位置、limitations、risks、完成状态。

## Methodology

按客户任务建立产品矩阵；分析性能、成本、可靠性及替代路线；区分研发、样机、认证和量产阶段；比较技术投入与商业结果；公司宣称与独立验证分开。专利数量不能单独证明护城河。

## Evidence Requirements

关键事实引用准确来源位置；不以搜索摘要、模型记忆或典型行业惯例代替公司证据。保留来源时间、范围及冲突。

## Deterministic / Model Boundary

模型解释已提供证据；代码校验输入、引用和输出合同。Skill 不调用外部接口、不写入 KB、不调用其他 Skill；Workflow 管理采集、重试和组合。

## Missing Data

保留已有证据支持的部分分析。说明缺失输入、需要获取的材料和结论影响；核心问题未回答时标记 insufficient_evidence。

## Validation / QC

关键论点必须在 findings 中并绑定精确来源位置。判断、事实和假设分开；答案解释因果和反证。仅格式完整不代表研究完成。

## Related Skills

business_model_map、financial_quality_analysis、company_risk_analysis 是 Workflow 选择的同级方法；本 Skill 不调用它们。
