---
name: management_governance_analysis
description: 研究管理团队背景、控制结构、治理与激励，使用带位置的研究证据，不获取数据或写入 Knowledge。
---

# Management and Governance

## Purpose

研究管理团队背景、控制结构、治理与激励。

## Invocation Match

用于管理层履历、治理结构和利益一致性问题，由 Workflow 选择并独立执行。

## Typical Intents

- 管理层履历、治理结构和利益一致性问题。

## Inputs

公司身份、asOf、董事履历、股权、治理与薪酬证据。材料仅限已获取正文；每项包含 sourceCandidateId 及 paragraph 位置。

## Produces

中文 answer、markdown、fact/inference/assumption findings 及其证据位置、limitations、risks、完成状态。

## Methodology

梳理关键人员职责、相关履历和任职变化；确认控制权和董事会安排；比较激励与股东利益；对关联交易和治理风险给出影响路径。头衔不代表能力，承诺兑现依赖独立可归因的结果。

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
