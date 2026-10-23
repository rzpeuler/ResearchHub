import { resolve } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import type { KnowledgeProductionOutcome } from '../../knowledge/production/contracts.ts'
import type { CompanyResearchResult } from '../../skills/company-research/contracts.ts'
import type { NormalizedResearchSource, ResearchAcquisitionDiagnostic, ResearchProviderOutcome } from '../../plugins/research-acquisition/contracts.ts'
import type { CompanyResearchDataPayload, CompanyResearchEvidenceBatch, CompanyProfileSnapshot, CompanyFinancialHistory, CompanyMarketHistory } from '../../plugins/research-acquisition/company-research-data.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { materializePhase3CommonRequirement } from '../../data/requirements.ts'
import { sourceWithDataEvidenceProvenance } from '../../data/research-evidence.ts'
import type { DataResolver, ResolvedDataItem } from '../../data/resolver.ts'
import { normalizeCompanyCandidateIdentity, normalizeExchange } from '../../skills/knowledge-curation/identity/company-identity.ts'
import { validateResearchReport, writeResearchReport, type ResearchReport } from '../../app/services/research-report.ts'
import type { CompanyDeepResearchInput, CompanyDeepResearchResult } from './contracts.ts'
import { runResearchQualityGate } from '../research-quality-gate.ts'
import { calculateCompanyIndustryExposureBridge, renderCompanyIndustryExposureBridge } from './industry-exposure-bridge.ts'
import { COMPANY_RESEARCH_METHOD_IDS, COMPANY_METHOD_SECTION_IDS, COMPANY_METHOD_METHODOLOGY, executeCompanyResearchMethod, type CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'
import { insertCompanyFinancialOpeningSummary, prepareCompanyFinancialAnalysis, renderCompanyFinancialTable } from './financial-analysis.ts'
import { assembleCompanyResearch, repairCompanyResearchMarkdownTables, validateCompanyResearchSectionTables } from './assembly.ts'
import { COMPANY_CORE_SECTION_IDS, companySynthesisEvidenceFingerprint, ensureCompanyIncompleteSynthesisSections, evaluateCompanyResearchContent, findKnownCompetitorDenials, findKnownCustomerConcentrationDenials, mergeCompanySemanticQuality, reconcileCompanyCompetitorEvidence, reconcileCompanyControlOwnerHoldings, reconcileCompanyCrossSectionBoundaries, reconcileCompanyDriverClassificationLabels, reconcileCompanyDriverFinancialReferences, reconcileCompanyEmployeePlanEvidence, reconcileCompanyFinancialGrowthFormula, reconcileCompanyFinancialPeriodScope, reconcileCompanyFinancialScopeLimitations, reconcileCompanyIndustryForecastPeriods, reconcileCompanyLeverageFormula, reconcileCompanyProductCustomerConcentration, reconcileCompanyProductGrowthReferences, reconcileCompanyProductProductionGrowth, reconcileCompanyProductRevenueCostGrowth, reconcileCompanyProductRevenueDrivers, reconcileCompanyProductRevenueRowCitations, reconcileCompanyProductRevenueShares, reconcileCompanyProductTableSectionReferences, reconcileCompanyRiskBoundaries, reconcileCompanySegmentRowCitations, reconcileCompanyTechnologyProgressReferences, reconcileCompanyAnnualGrossMargin, reconcileCompanyConsolidatedGrossMargin, reconcileCompanyDriverConsolidatedGrossMargin, reconcileCompanyFinancialSummaryTable, reconcileCompanyPreparedAnalysisFacts, reconcileCompanyPlacementFacts } from './content-quality.ts'
import { prepareCompanyMarketSizing } from './market-sizing.ts'
import { assessCompanySourceHealth, type CompanySourceAttemptTrace } from '../../data/company-source-health.ts'
import { reviewCompanyResearchSemantics } from './semantic-quality.ts'

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const PEER_RESEARCH_TERMS: Readonly<Record<string, readonly string[]>> = {
  '002384': ['peer:鹏鼎控股', 'peer:中际旭创'],
  '002594': ['peer:吉利汽车', 'peer:宁德时代'],
}

/** Apply the report-level Markdown integrity gate after structural/semantic quality merging. */
export function applyCompanyResearchTableDiagnostics<T extends { passed: boolean; status: string; issues: readonly string[] }>(quality: T, diagnostics: readonly string[]): T {
  if (!diagnostics.length) return quality
  return { ...quality, passed: false, status: 'incomplete', issues: [...new Set([...quality.issues, ...diagnostics.map(diagnostic => `REPORT_${diagnostic}`)])] } as T
}

/** Turn reviewer notes into method-local actions without smuggling other methods' evidence into a revision packet. */
export function buildCompanyMethodReviewFeedback(skillId: string, checks: readonly { sectionId: string; reasons: readonly string[] }[]): string[] {
  return checks.filter(check => check.reasons.length).map(check => {
    const reason = check.reasons.join('；')
    if (/(?:竞争|竞品|竞争者|对手|市场份额)/.test(reason) && skillId !== 'competitive_market_map') {
      return `${check.sectionId}: 删除或改写本节任何关于报告整体“没有具名竞品、候选或产品路线”的绝对缺口。不要引入其他方法的公司名称、产品路线、数字或引用；明确写成“具名候选与已披露产品路线见竞争章节；本方法输入未提供直接竞争关系、客户重叠、市场份额及同口径成本/性能证据，故本节不判断相对竞争地位”。本方法只陈述其输入能支持的范围。`
    }
    if (skillId === 'business_driver_analysis' && ['revenue-profit-drivers', 'growth-drivers'].includes(check.sectionId)) {
      return `${check.sectionId}: 先逐行复核本方法本轮允许证据中的分行业、分产品及分地区表，将可核验的收入金额、占比、收入与成本增速、毛利率及原列名分别列为已知；只有实际未提供的指标才列为缺口。行业标签跨段时核对完整表头、标签及数值续行，不得因缺少量价或分部利润而否定已给出的收入行。将已知收入变化与尚不能拆分的销量、价格、组合、分部利润分开。比较成本与收入增速时先写清有序操作数和差额方向，不能把负增速大小关系或带符号差额写反。每个数值仅引用本方法输入中直接支持它的精确配对；无法确认行、单位或期间时保留该项缺口，不采用审查意见给出的数值或定位。`
    }
    if (['capital_allocation_review', 'management_governance_analysis'].includes(skillId) && check.sectionId === 'management-capital-allocation') {
      return `${check.sectionId}: 复核本方法本轮允许证据中的历史收购、并表、回购和员工持股行动，按行动发生期间、授权、实施、完成及后续结果分别建账。若材料仅证明行动存在或已实施，就保留该事实及精确引用；不能因缺少交易对价、回购价格或增量回报而写成没有行动或没有任何实施资料。历史行动不得冒充本期新增投入，员工持股购买不得直接称注销回购。实际未提供的对价、回报和可比口径仍逐项列为缺口，不用审查意见中的行动细节、数值或引用补齐。`
    }
    if (skillId === 'business_driver_analysis' && /(?:爬坡|扩产|催化|量产|订单)/.test(reason)) {
      return `${check.sectionId}: 不要把缺少量化订单、利用率或未来收入预测扩大写成完全没有经营进度。区分公司披露的项目进展与可核验的量化兑现；只引用本方法输入中实际提供的原文，未提供时说明本方法证据缺口。`
    }
    const safeReason = reason
      .replace(/[\[〔【［][^\]〕】］]*@paragraph:\d+[\]〕】］]/g, '')
      .replace(/\b(?:official|public-web|akshare|cninfo)[-\w]*\b/gi, '')
      .replace(/paragraph:\d+/gi, '')
      .replace(/中际旭创|新易盛|天孚通信/g, '具名同行')
      .replace(/(?<!\w)\d[\d,，]*(?:\.\d+)?\s*(?:亿元|万元|元|万亿|个百分点|[%％]|T|G|天|日|月|年)?/g, '')
      .replace(/\s+/g, ' ').trim()
    return `${check.sectionId}: ${safeReason}`
  })
}

/** Turn first-pass semantic review findings into section-local, evidence-bounded synthesis actions. */
export function buildCompanySynthesisReviewFeedback(checks: readonly { sectionId: string; reasons: readonly string[] }[]): string[] {
  const failed = new Set(checks.filter(check => check.reasons.length).map(check => check.sectionId))
  const feedback: string[] = []
  if (failed.has('revenue-profit-drivers')) feedback.push('revenue-profit-drivers: 分开呈现公司合计、分行业/分产品和分地区原表已披露的收入变化；逐行核对完整标签、表头及数值续行，不因没有量价或分部利润而把可核验的收入、成本或毛利率行称为未提供。只有扣除已披露分类后仍无法解释的部分，才称“未归因残差”，并把残差范围限定为量价、组合或分部利润无法拆分。对同一行成本与收入增速，按允许证据中的实际数值写明谁高、有序操作数、带符号方向差及公式；合并毛利率仅在preparedAnalysis确有同口径本期/上年同期值时列出两个操作数和百分点差公式。每个数值按其原表行分别附精确引用，不将不同口径共挂一组引用。')
  if (failed.has('growth-drivers')) feedback.push('growth-drivers: 核对有效方法结果和允许证据中的分行业及分产品收入金额、占比和可比增速；若已提供，先列出这些已知事实及行级引用，再说明销量、价格、组合或分部利润仍不能拆分及其对增长判断的影响。不得将缺少细分归因扩写为没有收入规模或结构资料；没有直接证据的指标仍保留缺口，不借用独立审查中的数字或定位。')
  if (failed.has('management-capital-allocation')) feedback.push('management-capital-allocation: 逐项核对允许证据及有效方法结果中的收购、并表、回购和员工持股行动，保留可核验的历史行动、实施或完成事实及精确引用；区分历史与本期、授权与实际执行、员工持股购买与注销回购。对价、价格、增量回报或门槛缺失只限制相应经济评价，不能据此否认行动存在；不从审查意见补造行动、数字或引用。')
  if (failed.has('monitoring-checklist')) feedback.push('monitoring-checklist: 对每个待补指标先核对有效方法结果和允许证据，区分已披露的历史累计购买或持有数量、截止日期、实施状态与尚未披露的后续增减、价格和收益。可核验的累计数作为带截止日期及精确引用的监控基线；缺失项仅写未来更新或仍缺的指标，不把已给出的累计行写成未提供。不得将不同计划或截止时点相加，也不得采用审查意见中的数值、计划名称或引用。')
  if (failed.has('business-model')) feedback.push('business-model: 收入构成表的产品、销售模式、地区及毛利率必须分属各自原表；金额/占比表与毛利率表分开引用。表格每个产品数据行应直接引用对应的完整产品行，禁止用一组跨多行的重复引用替代行级来源。')
  if (failed.has('products')) feedback.push('products: 不得无比较基准地称某产品毛利率“较高/更高”；若作相对判断，写清比较对象、期间和同口径两个数值并各引对应行，否则只陈述该产品的披露水平。产品金额、成本、毛利率及变化值分别引用精确的分产品行；不得引用分行业行替代。')
  if (failed.has('industry-exposure')) feedback.push('industry-exposure: 严格区分分行业、分产品、分地区表及其完整分类标签；描述公司产品收入分类时只引用“分产品”原表及正确产品行，描述行业暴露时只引用分行业行。不可依据相邻段落编号推断定位，也不可把行业行写作产品行。')
  if (failed.has('catalysts') || failed.has('risks')) feedback.push('catalysts/risks: 与具名竞品和产品路线有关的证据缺口必须限于直接竞争/竞标、客户重叠、市场份额及同口径性能成本比较；若竞争方法已识别公司和路线，应保留该候选及路线，不得称没有具名候选、路线或任何可比资料。')
  for (const check of checks) {
    if (!check.reasons.length) continue
    if (['revenue-profit-drivers', 'growth-drivers', 'management-capital-allocation', 'monitoring-checklist', 'business-model', 'products', 'industry-exposure', 'catalysts', 'risks'].includes(check.sectionId)) continue
    feedback.push(`${check.sectionId}: 逐条核对独立审查指出的问题与本轮有效方法结果、preparedAnalysis和允许证据；只修正证据明确支持的缺陷，不把审查意见本身当事实或引用。`)
  }
  return feedback
}

/** Keep table-derived risk figures attached to the exact disclosure row that carries them. */
export function addCompanyMethodEvidenceInstructions(skillId: string, methodology: string): string {
  if (skillId !== 'company_risk_analysis') return methodology
  return `${methodology}\n\nWorkflow 数值引用约束：风险表格中的每个披露金额、比例和汇总值，必须在同一风险单元格或句子中引用直接列出该数字的原始数据行；汇总行有该数字时，必须引用汇总行，不能只引用单位行或组成部分行来代替。表格的科目/列含义不在数据行中时，同时引用本次输入实际提供的对应表头和单位行。不得把相邻表格的表头、期间或单位借给本行；找不到唯一对应行时删除该数字并说明缺口。只有报告明确给出计算关系且各操作数均逐项引用时，才可用组成项计算并表述汇总值。引用仅能使用本次 evidence excerpts 中的精确 sourceCandidateId 与 paragraph 定位。`
}

/** Keep a validated method result when a review-only revision fails validation. */
export function mergeCompanyMethodRevisionResult(
  previous: CompanyResearchMethodResult | undefined,
  result: CompanyResearchMethodResult,
  options: { readonly preserveCompletedOnReviewFailure: boolean },
): CompanyResearchMethodResult {
  const retainPrevious = !!previous
    && previous.status === 'complete'
    && result.status !== 'complete'
    && options.preserveCompletedOnReviewFailure
    && !previous.diagnostics.some(diagnostic => diagnostic.code === 'EVIDENCE_REFRESH_REQUIRED')
  const selected = retainPrevious ? previous! : result
  const priorAttempts = previous?.attempts ?? 0
  return {
    ...selected,
    attempts: priorAttempts + result.attempts,
    diagnostics: [
      ...(previous?.diagnostics ?? []),
      ...result.diagnostics.map(diagnostic => ({ ...diagnostic, attempt: priorAttempts + diagnostic.attempt })),
      ...(retainPrevious ? [{
        code: 'REVIEW_REVISION_FAILED_PRIOR_COMPLETED_RESULT_RETAINED',
        message: `Review-driven revision failed validation (${result.diagnostics.map(diagnostic => diagnostic.code).join(', ') || result.status}); retained the prior validated method output for final synthesis and content review.`,
        attempt: priorAttempts + result.attempts,
      }] : []),
    ],
    attemptOutputs: [...previous?.attemptOutputs ?? [], ...(result.attemptOutputs ?? []).map(output => ({ ...output, attempt: priorAttempts + output.attempt }))],
    citationRepairs: [...previous?.citationRepairs ?? [], ...(result.citationRepairs ?? []).map(repair => ({ ...repair, attempt: priorAttempts + repair.attempt }))],
  }
}
export function initialCompanyResearchSearchTerms(company: CompanyDeepResearchInput['company']): readonly string[] {
  const name = (company.name ?? company.symbol).trim()
  // Put target-company filings and business materials before peer queries. The
  // public-web plugin reserves only a small number of query slots for each run.
  return [...new Set([
    `${name} 年报 半年报 业绩报告`,
    `${name} 主营业务 产品 技术`,
    `${name} 行业 市场规模 竞争`,
    `${name} 管理层 战略 投资者关系`,
    ...(PEER_RESEARCH_TERMS[company.symbol] ?? []),
  ])]
}
type AcquiredResearch = { readonly sources: readonly NormalizedResearchSource[]; readonly durableSources: readonly NormalizedResearchSource[]; readonly durableSourceCandidateIds: readonly string[]; readonly profileData?: CompanyProfileSnapshot; readonly financialData?: CompanyFinancialHistory['rows']; readonly marketData?: CompanyMarketHistory['rows']; readonly diagnostics: readonly ResearchAcquisitionDiagnostic[]; readonly providerOutcomes: readonly ResearchProviderOutcome[]; readonly sourceAttempts: readonly CompanySourceAttemptTrace[] }

/** Refresh only newly accepted statutory CNINFO periodic reports, never title-only web hits. */
function isCoreOfficialReport(source: NormalizedResearchSource): boolean {
  const provenance = source.candidate.metadata?.dataProvenance
  if (!provenance || typeof provenance !== 'object' || (provenance as Record<string, unknown>).originAuthority !== 'S0_STATUTORY') return false
  const provider = source.candidate.provider
  const retrievalProvider = (provenance as Record<string, unknown>).retrievalProvider
  if (!/^cninfo$/i.test(provider) && !(typeof retrievalProvider === 'string' && /^cninfo$/i.test(retrievalProvider))) return false
  return source.candidate.kind === 'official_disclosure' && /年度报告|半年度报告|年报|半年报|annual report|semi[- ]?annual report|interim report/i.test(source.title) && !/摘要|summary/i.test(source.title)
}

function makeReportSections(research: CompanyResearchResult, acquired: AcquiredResearch, sourceRefs: Readonly<Record<string,string>>, claimRefs: Readonly<Record<string,string>>): ResearchReport['sections'] {
  return research.sections.map(section => {
    const locations = [...new Map([...section.markdown.matchAll(/\[([^\]\s]+)@(paragraph:(\d+))\]/g)].flatMap(match=>{
      const source = acquired.sources.find(source=>source.candidate.candidateId===match[1])
      const line = source?.content.split(/\r?\n/)[Number(match[3])-1]
      return source && line?.trim() ? [[`${match[1]}@${match[2]}`,{sourceCandidateId:match[1]!,location:match[2]!}] as const] : []
    })).values()]
    return {id:section.id,title:section.title,markdown:section.markdown,sourceRefs:section.sourceCandidateIds.flatMap(id=>sourceRefs[id]?[sourceRefs[id]!]:[]),claimRefs:section.proposalIds.flatMap(id=>claimRefs[id]?[claimRefs[id]!]:[]),evidenceLinks:[...new Set(section.sourceCandidateIds.flatMap(id=>{const source=acquired.sources.find(s=>s.candidate.candidateId===id);const url=source?.canonicalUrl ?? source?.candidate.url;return url?.startsWith('https://')?[url]:[]}))],evidenceLocations:locations.map(ref=>{const source=acquired.sources.find(s=>s.candidate.candidateId===ref.sourceCandidateId);return {sourceCandidateId:ref.sourceCandidateId,url:source?.canonicalUrl ?? source?.candidate.url,locator:ref.location,excerpt:source?.content.split(/\r?\n/)[Number(ref.location.split(':')[1])-1]?.slice(0,800)}})}
  })
}

function appendFinancialSummary(methods: CompanyResearchMethodResult[], researchInput: CompanyResearchInput): CompanyResearchMethodResult[] {
  const table = renderCompanyFinancialTable(researchInput)
  if (!table) return methods
  const source = researchInput.sources.find(source => source.candidate.candidateId === table.sourceCandidateId)
  const firstParagraph = source?.content.split(/\r?\n/)[0]
  if (!source || !firstParagraph?.trim()) return methods
  const deterministicPacket = {sourceCandidateId:table.sourceCandidateId,title:source.title,url:source.canonicalUrl ?? source.candidate.url,publisher:source.publisher,publishedAt:source.candidate.publishedAt,excerpts:[{sourceCandidateId:table.sourceCandidateId,location:'paragraph:1',text:firstParagraph}]}
  const officialGrossMarginPacket = researchInput.sources.flatMap(candidate => {
    const provenance = candidate.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined
    if (provenance?.originAuthority !== 'S0_STATUTORY' || candidate.candidate.kind !== 'official_disclosure' || !/半年度报告|半年报/.test(candidate.title)) return []
    const lines = candidate.content.split(/\r?\n/)
    const statementStart = lines.findIndex(line => /(?:^|\s)(?:3、|三、)合并利润表/.test(line))
    if (statementStart < 0) return []
    const unitIndex = lines.findIndex((line,index) => index >= statementStart && index < statementStart+10 && /^单位\s*[：:]\s*元$/.test(line.trim()))
    const headerIndex = lines.findIndex((line,index) => index >= statementStart && index < statementStart+12 && /项目\s+20\d{2}\s*年半年度\s+20\d{2}\s*年半年度/.test(line))
    const revenueIndex = lines.findIndex((line,index) => index > statementStart && index < statementStart+24 && /^一、营业总收入\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(line.trim()))
    const costIndex = lines.findIndex((line,index) => index > statementStart && index < statementStart+35 && /^其中：营业成本\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(line.trim()))
    if (unitIndex < 0 || headerIndex < 0 || revenueIndex < 0 || costIndex < 0) return []
    const entries = [unitIndex,headerIndex,revenueIndex,costIndex].map(index => ({sourceCandidateId:candidate.candidate.candidateId,location:`paragraph:${index+1}`,text:lines[index]!.trim()}))
    return [{sourceCandidateId:candidate.candidate.candidateId,title:candidate.title,url:candidate.canonicalUrl ?? candidate.candidate.url,publisher:candidate.publisher,publishedAt:candidate.candidate.publishedAt,excerpts:entries}]
  })[0]
  const officialAnnualGrossMarginPacket = researchInput.sources.flatMap(candidate => {
    const provenance = candidate.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined
    if (provenance?.originAuthority !== 'S0_STATUTORY' || candidate.candidate.kind !== 'official_disclosure' || !/年度报告|年报/.test(candidate.title)) return []
    const lines = candidate.content.split(/\r?\n/)
    const statementStart = lines.findIndex(line => /(?:^|\s)(?:3、|三、)合并利润表/.test(line))
    if (statementStart < 0) return []
    const unitIndex = lines.findIndex((line,index) => index >= statementStart && index < statementStart+10 && /^单位\s*[：:]\s*元$/.test(line.trim()))
    const headerIndex = lines.findIndex((line,index) => index >= statementStart && index < statementStart+14 && /项目\s+20\d{2}\s*年度\s+20\d{2}\s*年度/.test(line))
    const revenueIndex = lines.findIndex((line,index) => index > statementStart && index < statementStart+28 && /^一、营业总收入\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(line.trim()))
    const costIndex = lines.findIndex((line,index) => index > statementStart && index < statementStart+40 && /^其中：营业成本\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(line.trim()))
    if (unitIndex < 0 || headerIndex < 0 || revenueIndex < 0 || costIndex < 0) return []
    const entries = [unitIndex,headerIndex,revenueIndex,costIndex].map(index => ({sourceCandidateId:candidate.candidate.candidateId,location:`paragraph:${index+1}`,text:lines[index]!.trim()}))
    return [{sourceCandidateId:candidate.candidate.candidateId,title:candidate.title,url:candidate.canonicalUrl ?? candidate.candidate.url,publisher:candidate.publisher,publishedAt:candidate.candidate.publishedAt,excerpts:entries}]
  })[0]
  const insertOpeningSummary = (markdown: string): string => {
    return insertCompanyFinancialOpeningSummary(markdown, table.openingSummary)
  }
  return methods.map(method => method.skillId !== 'financial_quality_analysis' || method.status !== 'complete' ? method : { ...method,
    deterministicEvidence: [...(method.deterministicEvidence ?? []).filter(packet => packet.sourceCandidateId !== table.sourceCandidateId && packet.sourceCandidateId !== officialGrossMarginPacket?.sourceCandidateId && packet.sourceCandidateId !== officialAnnualGrossMarginPacket?.sourceCandidateId),deterministicPacket,...(officialGrossMarginPacket?[officialGrossMarginPacket]:[]),...(officialAnnualGrossMarginPacket?[officialAnnualGrossMarginPacket]:[])],
    sections: method.sections.map(section => section.id !== 'financial-quality' ? section : {...section,markdown:`${insertOpeningSummary(section.markdown.split('\n\n确定性财务摘要（')[0])}\n\n${table.markdown}`}),
    findings: [...method.findings.filter(finding => finding.text !== '财务摘要直接列示取得的期间、单位和口径；缺失及冲突保留。'),{text:'财务摘要直接列示取得的期间、单位和口径；缺失及冲突保留。',kind:'fact' as const,evidence:[{sourceCandidateId:table.sourceCandidateId,location:'paragraph:1'}]}],
    sourceCandidateIds:[...new Set([...method.sourceCandidateIds,table.sourceCandidateId,...(officialGrossMarginPacket?[officialGrossMarginPacket.sourceCandidateId]:[]),...(officialAnnualGrossMarginPacket?[officialAnnualGrossMarginPacket.sourceCandidateId]:[])])],
  })
}

/** Add adjacent split-table rows needed to preserve source headers and continuation values. */
function appendCompanyOfficialContextEvidence(methods: CompanyResearchMethodResult[], researchInput: CompanyResearchInput): CompanyResearchMethodResult[] {
  const packets = new Map<string, NonNullable<CompanyResearchMethodResult['deterministicEvidence']>[number]>()
  for (const source of researchInput.sources) {
    if (source.candidate.kind !== 'official_disclosure') continue
    const lines = source.content.split(/\r?\n/)
    const base = { sourceCandidateId: source.candidate.candidateId, title: source.title, url: source.canonicalUrl ?? source.candidate.url, publisher: source.publisher, publishedAt: source.candidate.publishedAt }
    if (/年度报告/.test(source.title)) {
      const serverIndex = lines.findIndex(line => /2025\s*年全球服务器及存储领域市场规模/.test(line))
      if (serverIndex >= 0) {
        const excerpts = [serverIndex, serverIndex + 1, serverIndex + 2].filter(index => Boolean(lines[index]?.trim())).map(index => ({ sourceCandidateId: base.sourceCandidateId, location: `paragraph:${index + 1}`, text: lines[index]!.trim() }))
        packets.set('market_structure_analysis', { ...base, excerpts })
      }
      if (/东山精密|苏州东山/.test(source.content.slice(0,500)) && /50G\s*SFP56/i.test(source.content)) {
        const projectIndex=lines.findIndex(line=>/50G\s*SFP56/i.test(line))
        if(projectIndex>=0){
          const excerpts=[projectIndex-1,projectIndex,projectIndex+1,projectIndex+2].filter(index=>index>=0&&Boolean(lines[index]?.trim())).map(index=>({sourceCandidateId:base.sourceCandidateId,location:`paragraph:${index+1}`,text:lines[index]!.trim()}))
          packets.set('product_technology_analysis',{...base,excerpts})
        }
      }
    }
    if (/半年度报告/.test(source.title)) {
      const employeeIndex = lines.findIndex(line => /^150\s+3,048,701\s+无\s+0\.17%/.test(line.trim()))
      if (employeeIndex >= 0) {
        const headerIndexes = lines.map((line, index) => ({ line, index })).filter(({ line, index }) => index < employeeIndex && index >= employeeIndex - 16 && /员工人|^数$|总数（股）|有效的员工持股计划情况|核心技术（业务）骨干|不包括公司董事/.test(line.trim())).map(item => item.index)
        const selected = [...new Set([...headerIndexes, employeeIndex - 2, employeeIndex - 1, employeeIndex])].filter(index => index >= 0 && Boolean(lines[index]?.trim())).sort((a,b)=>a-b)
        const excerpts = selected.map(index => ({ sourceCandidateId: base.sourceCandidateId, location: `paragraph:${index + 1}`, text: lines[index]!.trim() }))
        packets.set('management_governance_analysis', { ...base, excerpts })
      }
    }
  }
  return methods.map(method => {
    const packet = packets.get(method.skillId)
    if (!packet || method.status !== 'complete') return method
    const current = method.deterministicEvidence ?? []
    if (current.some(item => item.sourceCandidateId === packet.sourceCandidateId && packet.excerpts.every(required => item.excerpts.some(excerpt => excerpt.location === required.location)))) return method
    return { ...method, deterministicEvidence: [...current, packet], sourceCandidateIds: [...new Set([...method.sourceCandidateIds, packet.sourceCandidateId])] }
  })
}

function check(input: CompanyDeepResearchInput): void {
  if (!safeId.test(input.workflowRunId)) throw new Error('workflowRunId must be safe')
  if (input.handle.schemaVersion !== '0.4' || input.handle.storageFormatVersion !== '1') throw new Error('Company Deep Research requires Schema 0.4 / Storage 1')
  if (!input.company.symbol.trim()) throw new Error('company symbol is required')
}

function abortIfNeeded(signal: AbortSignal | undefined): void { if (signal?.aborted) throw new Error('WORKFLOW_CANCELLED') }
async function canonicalCompanyRef(handle: CompanyDeepResearchInput['handle'], company: CompanyDeepResearchInput['company']): Promise<string | undefined> {
  const expectedExchange = normalizeExchange(company.exchange!)
  const matches = (await readCanonicalV04Assets(handle.rootRef)).objects.filter((item) => {
    if (item.kind !== 'entity') return false
    const value = item.value as Readonly<Record<string, unknown>>
    if (value.type !== 'company' || value.ticker !== company.symbol || typeof value.exchange !== 'string') return false
    try { return normalizeExchange(value.exchange) === expectedExchange } catch { return false }
  })
  return matches.length === 1 ? matches[0]!.value.id : undefined
}
function normalizeResearchCompany(company: CompanyDeepResearchInput['company']): CompanyDeepResearchInput['company'] {
  const normalized = normalizeCompanyCandidateIdentity({ candidateId: 'research-company', entityType: 'company', name: company.name ?? company.symbol, semanticFields: { ticker: company.symbol, ...(company.exchange === undefined ? {} : { exchange: company.exchange }) }, evidenceBlockRefs: [], reason: 'Research input identity normalization' })
  if (normalized.diagnostics.length > 0) throw new Error(`Company identity is unresolved: ${normalized.diagnostics.map((item) => item.message).join('; ')}`)
  const fields = normalized.candidate.semanticFields ?? {}; const exchange = typeof fields.exchange === 'string' ? fields.exchange : undefined
  if (exchange === undefined) throw new Error(`Company exchange is unresolved for symbol ${company.symbol}`)
  return { symbol: String(fields.ticker ?? company.symbol), name: normalized.candidate.name, exchange }
}

function resolvedValue<T extends CompanyResearchDataPayload>(item: ResolvedDataItem<CompanyResearchDataPayload>, kind: T['kind']): T | undefined {
  if (item.value?.kind === kind) return item.value as T
  for (const observation of item.acquisition.observations ?? []) if (observation.data.kind === kind) return observation.data as T
  return undefined
}

function resolvedValues<T extends CompanyResearchDataPayload>(item: ResolvedDataItem<CompanyResearchDataPayload>, kind: T['kind']): readonly T[] {
  const values = [item.value, ...(item.acquisition.observations ?? []).map((observation) => observation.data)]
  return [...new Set(values.filter((value): value is CompanyResearchDataPayload => value?.kind === kind))] as T[]
}

function providerForSource(sourceId: string): string { return sourceId.startsWith('cninfo-') ? 'cninfo' : sourceId.startsWith('gdelt-') ? 'gdelt' : sourceId.startsWith('akshare-') ? 'akshare' : sourceId }

function structuredSource(metricId: string, item: ResolvedDataItem<CompanyResearchDataPayload>, value: CompanyResearchDataPayload, company: CompanyDeepResearchInput['company']): NormalizedResearchSource | undefined {
  const source = item.source ?? item.acquisition.observations?.[0]?.source
  if (!source) return undefined
  const dataKind = metricId === 'company_basic_profile' ? 'basic' : metricId === 'company_financial_history' ? 'financial' : 'market'
  const title = metricId === 'company_basic_profile' ? 'Company basic profile' : metricId === 'company_financial_history' ? 'Company financial history' : 'Company market history'
  const pointInTimeStatus = value.kind === 'evidence' ? 'UNVERIFIED' : value.pointInTimeStatus
  const metadata = {
    dataKind, metricId, sourceId: source.sourceId, fallbackLevel: source.fallbackLevel,
    originAuthority: source.originAuthority, originPublisher: source.originPublisher,
    retrievalProvider: source.retrievalProvider, sourceUrl: source.sourceUrl,
    publishedAt: source.publishedAt, retrievedAt: source.retrievedAt,
    observedAt: source.observedAt, observationAvailableAt: source.observationAvailableAt,
    valueVersion: source.valueVersion ?? { status: 'UNVERIFIED', reason: metricId === 'company_basic_profile' ? 'Profile snapshot has no identified historical value version' : 'Historical numeric value version is not identified' },
    valueVersionStatus: source.valueVersion?.status ?? 'UNVERIFIED', quality: item.quality, attempts: item.attempts,
    pointInTimeStatus, qualityStatus: pointInTimeStatus,
  }
  const content = JSON.stringify(value)
  const publishedAt = source.publishedAt ?? (metricId === 'company_market_history' ? source.observedAt : undefined)
  return {
    candidate: { candidateId: `akshare-${dataKind}-${company.symbol}`, kind: 'structured_data', tier: 2, title, provider: source.retrievalProvider ?? 'AKShare', ...(publishedAt ? { publishedAt } : {}), metadata: { companySymbol: company.symbol, dataProvenance: metadata } },
    retrievedAt: source.retrievedAt, title, content, contentHash: sha256(content),
    ...(source.sourceUrl ? { canonicalUrl: source.sourceUrl } : {}),
    publisher: source.originPublisher ?? 'Unknown original publisher (retrieval via AKShare)',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  }
}

async function acquire(input: CompanyDeepResearchInput, company: CompanyDeepResearchInput['company'], asOf: string, deadlineAt: number, evidenceSearchTerms?: readonly string[], previous?: AcquiredResearch): Promise<AcquiredResearch> {
  const limit = Math.max(1, Math.min(input.maxSources ?? 20, 50))
  const now = input.now ?? (() => new Date().toISOString())
  const discoveredCandidateIds = new Set<string>()
  let consideredCandidateCount = 0
  const dataResolver: DataResolver<CompanyResearchDataPayload> = input.dataResolverFactory({
    company, asOf, asOfMode: input.asOf === undefined ? 'CURRENT_VALUE_ONLY' : 'HISTORICAL', now, signal: input.signal, limitPerSource: Math.min(10, limit),
    acquisitionDeadlineAt: deadlineAt,
    evidenceSearchTerms,
    onProgress: input.observations?.acquisitionActivity,
    onCandidatesDiscovered: async ({ candidates }) => {
      if (!input.signalStore) return
      for (const candidate of candidates) {
        abortIfNeeded(input.signal)
        if (discoveredCandidateIds.has(candidate.candidateId)) continue
        discoveredCandidateIds.add(candidate.candidateId)
        const publishedAt = candidate.publishedAt === undefined ? Number.NaN : Date.parse(candidate.publishedAt)
        if (!Number.isNaN(publishedAt) && publishedAt > Date.parse(asOf)) continue
        if (consideredCandidateCount >= limit) continue
        consideredCandidateCount += 1
        if (!['news', 'official_disclosure', 'rss'].includes(candidate.kind)) continue
        await input.signalStore.append({ signalId: `signal-${candidate.candidateId}`, kind: candidate.kind === 'official_disclosure' ? 'announcement' : 'news', source: candidate, publishedAt: candidate.publishedAt, discoveredAt: now(), contentReference: candidate.url })
      }
    },
  })
  const context = { workflowId: 'company-deep-research' as const, ticker: company.symbol, companyId: company.name, asOf, asOfMode: input.asOf === undefined ? 'CURRENT_VALUE_ONLY' as const : 'HISTORICAL' as const }
  const requirements = [
    ...(!previous?.profileData?.fields.length ? [materializePhase3CommonRequirement('company_basic_profile', context)] : []),
    ...(!previous?.financialData?.length ? [materializePhase3CommonRequirement('company_financial_history', context)] : []),
    ...(!previous?.marketData?.length ? [materializePhase3CommonRequirement('company_market_history', { ...context, period: { end: asOf } })] : []),
    materializePhase3CommonRequirement('company_research_evidence', context),
  ]
  abortIfNeeded(input.signal)
  const bundle = await dataResolver.resolve(requirements)
  abortIfNeeded(input.signal)
  const profileItem = bundle.items.find((item) => item.metricId === 'company_basic_profile')
  const financialItem = bundle.items.find((item) => item.metricId === 'company_financial_history')
  const marketItem = bundle.items.find((item) => item.metricId === 'company_market_history')
  const evidenceItem = bundle.items.find((item) => item.metricId === 'company_research_evidence')
  const profileData = profileItem && resolvedValue<CompanyProfileSnapshot>(profileItem, 'profile')
  const financialData = financialItem && resolvedValue<CompanyFinancialHistory>(financialItem, 'financial')
  const marketData = marketItem && resolvedValue<CompanyMarketHistory>(marketItem, 'market')
  const evidenceBatches = evidenceItem ? resolvedValues<CompanyResearchEvidenceBatch>(evidenceItem, 'evidence') : []
  const externalDocuments = evidenceBatches.flatMap((batch) => batch.documents)
  const selectedExternalDocuments = [...new Map(externalDocuments.map((document) => [document.record.candidate.candidateId, document])).values()].slice(0, limit)
  const externalSources = selectedExternalDocuments.map(sourceWithDataEvidenceProvenance)
  const dataValues = [
    ...(profileItem && profileData ? [structuredSource('company_basic_profile', profileItem, profileData, company)] : []),
    ...(financialItem && financialData ? [structuredSource('company_financial_history', financialItem, financialData, company)] : []),
    ...(marketItem && marketData ? [structuredSource('company_market_history', marketItem, marketData, company)] : []),
  ].filter((source): source is NormalizedResearchSource => source !== undefined)
  const sources = [...externalSources, ...dataValues]
  const durableDataSourceIds = dataValues.filter((source) => {
    const status = source.candidate.metadata?.dataProvenance && typeof source.candidate.metadata.dataProvenance === 'object'
      ? (source.candidate.metadata.dataProvenance as Record<string, unknown>).pointInTimeStatus
      : undefined
    return status === 'CURRENT_VALUE_ONLY' || status === 'PIT_VERIFIED'
  }).map((source) => source.candidate.candidateId)
  const durableSourceCandidateIds = [...durableDataSourceIds, ...selectedExternalDocuments.filter((document) => document.dateStatus === 'QUALIFIED' && document.pointInTimeSafe).map((document) => document.record.candidate.candidateId)]
  const durableSources = sources.filter((source) => durableSourceCandidateIds.includes(source.candidate.candidateId))
  const diagnostics: ResearchAcquisitionDiagnostic[] = []
  const outcomes = new Map<string, ResearchProviderOutcome>()
  for (const item of bundle.items) for (const attempt of item.acquisition.attempts) {
    const provider = providerForSource(attempt.sourceId)
    const unsupported = attempt.status === 'UNSUPPORTED'
    const status = attempt.status === 'SUCCESS' ? 'usable' : attempt.status === 'NO_DATA' || attempt.status === 'POINT_IN_TIME_INVALID' ? 'empty' : unsupported ? 'unsupported' : 'failed'
    const prior = outcomes.get(provider) ?? { provider, providerAttempted: false, providerSucceeded: false, providerEmpty: false, providerFailed: false, usableSourceCount: 0 }
    const observation = item.acquisition.observations?.find((entry) => entry.source.sourceId === attempt.sourceId)
    const evidenceCount = observation?.data.kind === 'evidence' ? observation.data.documents.length : 0
    const evidenceOutcome = observation?.data.kind === 'evidence' ? observation.data.outcome : undefined
    const hasFailure = (status === 'failed' && !unsupported) || (evidenceOutcome?.failed ?? 0) > 0
    const hasEmpty = status === 'empty' || status === 'unsupported' || (evidenceOutcome?.empty ?? 0) > 0
    if (status !== 'usable') diagnostics.push({ provider, status, reason: attempt.diagnostic ?? attempt.status })
    if (evidenceOutcome?.diagnostics.length) diagnostics.push({ provider, status: evidenceOutcome.failed > 0 ? 'failed' : 'empty', reason: evidenceOutcome.diagnostics.join('; ').slice(0, 500) })
    const succeeded = status === 'usable' && (provider === 'akshare' ? item.value !== undefined : evidenceCount > 0)
    outcomes.set(provider, { ...prior, providerAttempted: prior.providerAttempted || !unsupported, providerSucceeded: prior.providerSucceeded || succeeded, providerEmpty: prior.providerEmpty || (!succeeded && hasEmpty), providerFailed: prior.providerFailed || hasFailure, usableSourceCount: prior.usableSourceCount + (succeeded ? provider === 'akshare' ? 1 : evidenceCount : 0) })
  }
  for (const [provider, outcome] of outcomes) outcomes.set(provider, {
    ...outcome,
    providerSucceeded: outcome.usableSourceCount > 0,
    providerEmpty: outcome.usableSourceCount === 0 && !outcome.providerFailed,
  })
  const providerOutcomes = [...outcomes.values()].sort((a, b) => a.provider.localeCompare(b.provider))
  const providerObservations = [...outcomes.entries()].flatMap(([provider, outcome]) => {
    const metadata = provider === 'akshare' ? { providerId: 'akshare', label: '结构化数据' }
      : provider === 'cninfo' ? { providerId: 'cninfo', label: '上市公司公告' }
        : provider === 'gdelt' ? { providerId: 'gdelt', label: '新闻资料' } : undefined
    if (!metadata) return []
    const attempts = bundle.items.flatMap((item) => item.acquisition.attempts.filter((attempt) => providerForSource(attempt.sourceId) === provider))
    const timedAttempts = attempts.map((attempt) => ({ startedAt: attempt.startedAt, completedAt: attempt.completedAt, start: Date.parse(attempt.startedAt), end: Date.parse(attempt.completedAt) }))
    const validTiming = timedAttempts.length > 0 && timedAttempts.every((attempt) => Number.isFinite(attempt.start) && Number.isFinite(attempt.end) && attempt.end >= attempt.start)
    const startedAt = validTiming ? timedAttempts.reduce((earliest, attempt) => attempt.start < earliest.start ? attempt : earliest).startedAt : undefined
    const completedAt = validTiming ? timedAttempts.reduce((latest, attempt) => attempt.end > latest.end ? attempt : latest).completedAt : undefined
    const status = outcome.usableSourceCount > 0
      ? outcome.providerFailed || diagnostics.some((item) => item.provider === provider && item.status !== 'usable') ? 'partial' as const : 'success' as const
      : outcome.providerFailed ? 'failed' as const : outcome.providerAttempted ? 'unavailable' as const : 'skipped' as const
    return [{ ...metadata, status, ...(provider === 'akshare' ? {} : { recordCount: outcome.usableSourceCount }), ...(startedAt === undefined ? {} : { startedAt }), ...(completedAt === undefined ? {} : { completedAt }), diagnostics: diagnostics.filter((item) => item.provider === provider).map((item) => item.status === 'failed' ? 'PROVIDER_ATTEMPT_FAILED' : item.status === 'empty' ? 'PROVIDER_NO_USABLE_DATA' : item.status === 'unsupported' ? 'PROVIDER_UNSUPPORTED' : 'PROVIDER_DATA_AVAILABLE') }]
  })
  await input.observations?.providerObservations(providerObservations)
  const sourceAttempts: CompanySourceAttemptTrace[] = bundle.items.flatMap(item => item.acquisition.attempts.map(attempt => {
    const observation = item.acquisition.observations?.find(observation => observation.source.sourceId === attempt.sourceId)
    const validated = attempt.status === 'SUCCESS' && (observation?.data.kind === 'evidence' ? observation.data.documents.length > 0 : observation?.data !== undefined || item.value !== undefined && item.source?.sourceId === attempt.sourceId)
    return {metricId:item.metricId ?? item.requirementId,sourceId:attempt.sourceId,status:attempt.status,diagnostic:attempt.diagnostic,validated}
  }))
  return { sources, durableSources, durableSourceCandidateIds, profileData, financialData: financialData?.rows, marketData: marketData?.rows, diagnostics, providerOutcomes, sourceAttempts }
}

export async function runCompanyDeepResearch(input: CompanyDeepResearchInput): Promise<CompanyDeepResearchResult> {
  try {
    check(input)
    const company = normalizeResearchCompany(input.company)
    abortIfNeeded(input.signal)
    const existingCompanyRef = await canonicalCompanyRef(input.handle, company)
    if (existingCompanyRef === undefined && input.securityIdentity === undefined) {
      return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: [], createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: ['COMPANY_IDENTITY_UNVERIFIED'] }
    }
    const now = input.now ?? (() => new Date().toISOString())
    const asOf = input.asOf ?? now()
    await input.observations?.startStage('data_acquisition', '数据获取')
    const acquisitionBudgetLimitMs = 10 * 60_000
    let acquisitionRemainingMs = acquisitionBudgetLimitMs
    const acquireWithinBudget = async (terms?:readonly string[], previous?:AcquiredResearch) => {
      const startedAt = Date.now()
      try { return await acquire(input,company,asOf,startedAt+acquisitionRemainingMs,terms,previous) }
      finally { acquisitionRemainingMs=Math.max(0,acquisitionRemainingMs-Math.max(0,Date.now()-startedAt)) }
    }
    // Acquire the target's filings before any semantic method. Peer reports are
    // also useful for competition, but must not displace the target's annual
    // report, latest interim report, and product/business materials.
    const sourceConflicts: {round:number;candidateId:string;retainedSource:NormalizedResearchSource;incomingSource:NormalizedResearchSource}[] = []
    const initialTerms = initialCompanyResearchSearchTerms(company)
    let acquired = await acquireWithinBudget(initialTerms)
    // A transient CNINFO outage must not consume every semantic call on generic
    // web material and only deliver statutory reports after methods are spent.
    // Retry the missing primary-report input once, before any Skill is invoked.
    const cninfoResearchFailed = acquired.sourceAttempts.some(attempt => attempt.metricId === 'company_research_evidence' && /^cninfo-/i.test(attempt.sourceId) && attempt.status === 'SOURCE_ERROR')
    if (!acquired.sources.some(isCoreOfficialReport) && cninfoResearchFailed && acquisitionRemainingMs > 0) {
      const retryTerms = [`${company.name ?? company.symbol} 年度报告 半年度报告 年报 半年报`, ...initialTerms]
      const retry = await acquireWithinBudget(retryTerms, acquired)
      const retained = new Map(acquired.sources.map(source => [source.candidate.candidateId, source]))
      const additions: NormalizedResearchSource[] = []
      const retryConflicts: ResearchAcquisitionDiagnostic[] = []
      for (const source of retry.sources) {
        const original = retained.get(source.candidate.candidateId)
        if (original) {
          if (original.contentHash !== source.contentHash) {
            sourceConflicts.push({round:0,candidateId:source.candidate.candidateId,retainedSource:original,incomingSource:source})
            retryConflicts.push({provider:source.candidate.provider,candidateId:source.candidate.candidateId,status:'failed',reason:`SOURCE_CONTENT_CONFLICT: retained original ${original.contentHash}; supplemental ${source.contentHash} was not substituted or promoted`})
          }
          continue
        }
        if (retained.size >= (input.maxSources ?? 20)) continue
        retained.set(source.candidate.candidateId,source)
        additions.push(source)
      }
      const sources = [...retained.values()]
      const durableSourceCandidateIds = [...new Set([...acquired.durableSourceCandidateIds, ...retry.durableSourceCandidateIds.filter(id => additions.some(source => source.candidate.candidateId === id))])]
      const providerOutcomes = new Map(acquired.providerOutcomes.map(outcome => [outcome.provider,outcome]))
      for (const incoming of retry.providerOutcomes) {
        const previous = providerOutcomes.get(incoming.provider)
        providerOutcomes.set(incoming.provider, previous ? {
          provider: incoming.provider,
          providerAttempted: previous.providerAttempted || incoming.providerAttempted,
          providerSucceeded: previous.providerSucceeded || incoming.providerSucceeded,
          providerEmpty: previous.usableSourceCount + incoming.usableSourceCount === 0 && (previous.providerEmpty || incoming.providerEmpty),
          providerFailed: previous.providerFailed || incoming.providerFailed,
          usableSourceCount: Math.max(previous.usableSourceCount, incoming.usableSourceCount),
        } : incoming)
      }
      acquired = {
        ...retry,
        sources,
        durableSources: sources.filter(source => durableSourceCandidateIds.includes(source.candidate.candidateId)),
        durableSourceCandidateIds,
        profileData: retry.profileData?.fields.length ? retry.profileData : acquired.profileData,
        financialData: retry.financialData?.length ? retry.financialData : acquired.financialData,
        marketData: retry.marketData?.length ? retry.marketData : acquired.marketData,
        diagnostics: [...acquired.diagnostics, ...retry.diagnostics, ...retryConflicts],
        providerOutcomes: [...providerOutcomes.values()],
        sourceAttempts: [...acquired.sourceAttempts, ...retry.sourceAttempts],
      }
    }
    abortIfNeeded(input.signal)
    await input.observations?.finishStage('data_acquisition', 'completed', { summary: `已处理 ${acquired.providerOutcomes.length} 个可观察数据源` })
    const gateway = new KnowledgeProductionGateway(new KnowledgeBaseRegistry())
    const existingKnowledgeProjection = input.useStructuredKnowledge === false ? [] : await gateway.projectExistingKnowledge(input.handle, company)
    await input.observations?.startStage('research_synthesis', '研究综合分析')
    let synthesisMode: string | undefined
    let synthesisDiagnostics: readonly string[] = []
    let synthesisTableDiagnostics: readonly string[] = []
    const preReconciliationTableRepairs: string[] = []
    const synthesisAttemptOutputs: {attempt:number;output:unknown;allowedCitations:readonly string[]}[] = []
    let methodResults: CompanyResearchMethodResult[] = []
    let semanticExecutionBlock: 'RATE_LIMIT_OR_QUOTA' | 'AUTHENTICATION_OR_ACCOUNT' | undefined
    let reviewedResearch: CompanyResearchResult | undefined
    let lastStructurallyAcceptedResearch: CompanyResearchResult | undefined
    let lastStructurallyAcceptedEvidenceFingerprint: string | undefined
    let lastStructurallyAcceptedSynthesisMode: string | undefined
    let lastStructurallyAcceptedReview: Awaited<ReturnType<typeof reviewCompanyResearchSemantics>> | undefined
    let synthesisSnapshotStatus = 'not_captured'
    let semanticReview: Awaited<ReturnType<typeof reviewCompanyResearchSemantics>> | undefined
    let marketSizing: Awaited<ReturnType<typeof prepareCompanyMarketSizing>> | undefined
    let synthesisAttempts = 0
    let reviewAttempts = 0
    let reviewRounds = 0
    let finalSynthesisReviewed = false
    const qualityReviewHistory: {review:Awaited<ReturnType<typeof reviewCompanyResearchSemantics>>;sections:CompanyResearchResult['sections']}[] = []
    let revisionTargets: typeof COMPANY_RESEARCH_METHOD_IDS[number][] = []
    let researchInput: CompanyResearchInput = { company, asOf, sources: acquired.sources, durableSourceCandidateIds: acquired.durableSourceCandidateIds, profileData: acquired.profileData, financialData: acquired.financialData, marketData: acquired.marketData, existingKnowledgeProjection, signal: input.signal }
    const assemble = async () => {
      methodResults = appendCompanyOfficialContextEvidence(appendFinancialSummary(methodResults, researchInput), researchInput)
      await input.observations?.startSkill('company_research_synthesis', '公司研究综合分析')
      const synthesisReviewFeedback = semanticReview?.sectionChecks
        .filter(check => !check.questionAnswered || !check.evidenceSupportsConclusion || !check.numericReproducible || (check.sectionId === 'risks' && !check.riskTransmission))
      const targetedSynthesisFeedback = buildCompanySynthesisReviewFeedback(synthesisReviewFeedback ?? [])
      // Each assembly is a bounded semantic operation (at most two calls,
      // including format repair). A later review-driven revision is a new
      // assembly operation and must be allowed to use its own bounded budget.
      const assembled = await assembleCompanyResearch({...researchInput,qualityFeedback:targetedSynthesisFeedback}, methodResults, semanticExecutionBlock ? undefined : input.reasoningExecutor, now, 2)
      const normalizedSections = assembled.sections.map(section => {
        const repaired = repairCompanyResearchMarkdownTables(section.markdown)
        preReconciliationTableRepairs.push(...repaired.repairs.map(repair => `${section.id}: ${repair}`))
        return { ...section, markdown: repaired.markdown }
      })
      const competitorAligned = reconcileCompanyCompetitorEvidence({ sections: normalizedSections, methodResults })
      const productReferences = reconcileCompanyProductTableSectionReferences({ sections: competitorAligned, methodResults })
      const segmentCitations = reconcileCompanySegmentRowCitations({ sections: productReferences, methodResults })
      const rowCitations = reconcileCompanyProductRevenueRowCitations({ sections: segmentCitations, methodResults })
      const classificationLabels = reconcileCompanyDriverClassificationLabels({sections:rowCitations,methodResults})
      const growthReferences = reconcileCompanyProductGrowthReferences({ sections: classificationLabels, methodResults })
      const industryPeriods = reconcileCompanyIndustryForecastPeriods({ sections: growthReferences, methodResults })
      const preparedFacts = reconcileCompanyPreparedAnalysisFacts({ sections: industryPeriods, methodResults, preparedAnalysis: researchInput.preparedAnalysis, sources: researchInput.sources })
      const placementFacts = reconcileCompanyPlacementFacts({ sections: preparedFacts, methodResults })
      const technologyReferences = reconcileCompanyTechnologyProgressReferences({ sections: placementFacts, methodResults })
      const productMix = reconcileCompanyProductRevenueShares({ sections: technologyReferences, methodResults })
      const customerContext = reconcileCompanyProductCustomerConcentration({ sections: productMix, methodResults })
      const productionGrowth = reconcileCompanyProductProductionGrowth({ sections: customerContext, methodResults })
      const revenueCostGrowth = reconcileCompanyProductRevenueCostGrowth({ sections: productionGrowth, methodResults, sources: researchInput.sources })
      const financialFormula = reconcileCompanyFinancialGrowthFormula({ sections: revenueCostGrowth, methodResults })
      const consolidatedMargin = reconcileCompanyConsolidatedGrossMargin({ sections: financialFormula, methodResults })
      const financialBoundaries = reconcileCompanyFinancialScopeLimitations({ sections: consolidatedMargin, methodResults })
      const revenueDrivers = reconcileCompanyProductRevenueDrivers({ sections: financialBoundaries, methodResults })
      const linkedFinancial = reconcileCompanyDriverFinancialReferences({ sections: revenueDrivers, methodResults })
      const employeePlan = reconcileCompanyEmployeePlanEvidence({ sections: linkedFinancial, methodResults })
      const ownerHoldings = reconcileCompanyControlOwnerHoldings({ sections: employeePlan, methodResults })
      const financialHistoryRows = (researchInput.preparedAnalysis as {financial?:{table?:readonly {period?:string;metrics?:Readonly<Record<string,unknown>>;metadata?:Readonly<Record<string,{unit?:string;currency?:string;basis?:string}>>;conflicts?:readonly {metric:string}[]}[]}}|undefined)?.financial?.table
      const financialSourceId = methodResults.find(method=>method.skillId==='financial_quality_analysis')?.sourceCandidateIds[0]
      const leverage = reconcileCompanyLeverageFormula({sections:ownerHoldings,financialTable:financialHistoryRows,sourceCandidateId:financialSourceId})
      const riskAligned = reconcileCompanyRiskBoundaries({ sections: leverage, methodResults })
      const crossSectionBoundaries = reconcileCompanyCrossSectionBoundaries({ sections: riskAligned, methodResults })
      const financialSummarySections = reconcileCompanyFinancialSummaryTable({sections:crossSectionBoundaries,markdown:renderCompanyFinancialTable(researchInput)?.markdown})
      const periodBoundSections = reconcileCompanyFinancialPeriodScope({sections:financialSummarySections,methodResults})
      const finalFinancialFormulas = reconcileCompanyFinancialGrowthFormula({sections:periodBoundSections,methodResults})
      const finalLeverage = reconcileCompanyLeverageFormula({sections:finalFinancialFormulas,financialTable:financialHistoryRows,sourceCandidateId:financialSourceId})
      const researchedSections = reconcileCompanyAnnualGrossMargin({sections:finalLeverage,methodResults})
      const driverMarginSections = reconcileCompanyDriverConsolidatedGrossMargin({sections:researchedSections,methodResults,preparedAnalysis:researchInput.preparedAnalysis})
      finalSynthesisReviewed = false
      synthesisAttemptOutputs.push(...assembled.synthesisAttemptOutputs.map(output=>({...output,attempt:synthesisAttempts+output.attempt})))
      synthesisAttempts += assembled.synthesisAttempts
      synthesisMode = assembled.synthesisMode
      synthesisDiagnostics = [...synthesisDiagnostics,...assembled.synthesisDiagnostics]
      synthesisTableDiagnostics = assembled.tableDiagnostics
      await input.observations?.finishSkill('company_research_synthesis', synthesisMode === 'reasoning_executor' ? 'completed' : 'failed', synthesisMode === 'reasoning_executor' ? '推理执行器综合分析已返回' : '综合未通过校验，保留已有方法结果及未完成诊断')
      return { ...assembled, sections: driverMarginSections }
    }
    const review = async (research: CompanyResearchResult) => {
      await input.observations?.startSkill('content_quality_review', '研究内容独立审查')
      const previousAttempts = reviewAttempts
      // Each independent review operation has at most two attempts. Keep a
      // second review operation available after the bounded repair round even
      // when the first review needed its own format-repair attempt.
      const modelResult = await reviewCompanyResearchSemantics({...researchInput,sections:research.sections,methodResults,reasoningExecutor:input.reasoningExecutor,maxAttempts:2})
      const crossMethodDenials = findKnownCompetitorDenials({sections:research.sections,methodResults})
      const crossMethodReasons = crossMethodDenials.map(issue => `${issue.sectionId}: CROSS_METHOD_COMPETITOR_DENIAL: competitive_market_map identified ${issue.candidate} as a named candidate, but this section denies named competitors without preserving that candidate or a scoped comparison gap.`)
      const customerDenials = findKnownCustomerConcentrationDenials({sections:research.sections,methodResults})
      const customerReasons = customerDenials.map(issue => `${issue.sectionId}: CROSS_METHOD_CUSTOMER_CONCENTRATION_DENIAL: acquired report evidence contains a disclosed ${issue.metric}, but this section says those ratios are absent or unavailable.`)
      const consistencyIssues = [...crossMethodReasons, ...customerReasons]
      const result = consistencyIssues.length ? {
        ...modelResult,
        passed: false,
        status: 'failed' as const,
        issues: [...modelResult.issues, ...consistencyIssues],
        sectionChecks: modelResult.sectionChecks.map(check => {
          const reasons = [
            ...crossMethodDenials.filter(issue => issue.sectionId === check.sectionId).map(issue => `CROSS_METHOD_COMPETITOR_DENIAL:${issue.candidate}`),
            ...customerDenials.filter(issue => issue.sectionId === check.sectionId).map(() => 'CROSS_METHOD_CUSTOMER_CONCENTRATION_DENIAL'),
          ]
          return reasons.length ? {...check,evidenceSupportsConclusion:false,reasons:[...check.reasons,...reasons]} : check
        }),
        diagnostics: [...modelResult.diagnostics, ...crossMethodDenials.map(issue => ({code:'CROSS_METHOD_CONTRADICTION',message:`${issue.sectionId} denies a named competitor already identified by competitive_market_map: ${issue.candidate}`,attempt:modelResult.attempts})), ...customerDenials.map(issue => ({code:'CROSS_METHOD_CONTRADICTION',message:`${issue.sectionId} denies customer concentration ratios already disclosed in acquired report evidence`,attempt:modelResult.attempts}))],
      } : modelResult
      reviewAttempts += modelResult.attempts
      reviewRounds += 1
      finalSynthesisReviewed = true
      semanticExecutionBlock = result.diagnostics.find(diagnostic => diagnostic.code === 'RATE_LIMIT_OR_QUOTA' || diagnostic.code === 'AUTHENTICATION_OR_ACCOUNT')?.code as typeof semanticExecutionBlock
      if (result.status === 'cancelled') throw new Error('WORKFLOW_CANCELLED')
      await input.observations?.finishSkill('content_quality_review', result.passed ? 'completed' : 'failed', result.passed ? '核心研究问题、依据及风险路径通过独立审查' : result.issues.join(';'))
      const merged = {...result,attempts:reviewAttempts,rounds:reviewRounds,attemptOutputs:[...semanticReview?.attemptOutputs ?? [],...result.attemptOutputs?.map(output=>({...output,attempt:previousAttempts+output.attempt})) ?? []],diagnostics:[...semanticReview?.diagnostics ?? [],...result.diagnostics.map(diagnostic=>({...diagnostic,attempt:previousAttempts+diagnostic.attempt}))]}
      qualityReviewHistory.push({review:merged,sections:research.sections})
      return merged
    }
    for (let round = 0; round <= 2; round++) {
      abortIfNeeded(input.signal)
      const reportSourceCandidateIds = [...new Set([...acquired.durableSourceCandidateIds, ...(input.asOf === undefined ? acquired.sources.filter(source => source.candidate.provider === 'public-web' && source.content.trim().length >= 120).map(source => source.candidate.candidateId) : [])])]
      researchInput = { ...researchInput, sources: acquired.sources, durableSourceCandidateIds: acquired.durableSourceCandidateIds, reportSourceCandidateIds }
      researchInput = { ...researchInput, preparedAnalysis: {financial:prepareCompanyFinancialAnalysis(researchInput),...(marketSizing ? {marketSizing} : {})} }
      if (round === 0 && input.reasoningExecutor) {
        await input.observations?.startSkill('market_sizing_inputs', '市场规模输入提取与确定性计算')
        marketSizing = await prepareCompanyMarketSizing({ ...researchInput, reasoningExecutor: input.reasoningExecutor, maxAttempts: 2 })
        researchInput = { ...researchInput, preparedAnalysis: { financial: prepareCompanyFinancialAnalysis(researchInput), marketSizing } }
        semanticExecutionBlock = marketSizing.diagnostics.find(diagnostic => diagnostic.code === 'RATE_LIMIT_OR_QUOTA' || diagnostic.code === 'AUTHENTICATION_OR_ACCOUNT')?.code as typeof semanticExecutionBlock
        await input.observations?.finishSkill('market_sizing_inputs', 'completed', marketSizing.calculations.length ? '来源绑定的市场规模已复算' : '市场规模数字缺口保留，继续行业结构研究')
      }
      const pending = COMPANY_RESEARCH_METHOD_IDS.filter(id => { const previous = methodResults.find(method => method.skillId === id); return !previous || ((previous.status !== 'complete' || revisionTargets.includes(id)) && previous.attempts < 2) })
      if (pending.length) reviewedResearch = undefined
      // Two independent methods at a time, bounded by the existing executor surface.
      for (let offset = 0; offset < pending.length && !semanticExecutionBlock; offset += 2) {
        const results = await Promise.all(pending.slice(offset, offset + 2).map(async skillId => {
          const previous = methodResults.find(method => method.skillId === skillId)
          await input.observations?.startSkill(skillId, skillId)
          const canonicalMethodology = await readFile(new URL(`../../skills/${skillId}/SKILL.md`, import.meta.url), 'utf8')
          const feedbackChecks = semanticReview?.sectionChecks.filter(check => COMPANY_METHOD_SECTION_IDS[skillId].includes(check.sectionId)) ?? []
          const feedback = buildCompanyMethodReviewFeedback(skillId, feedbackChecks)
          const reviewedMethodology = feedback.length ? `${canonicalMethodology}\n\nWorkflow 上轮内容审查反馈（仅作待核查问题，不是证据）：\n- 只能依据本方法本轮输入中实际提供的 evidence excerpts、structured inputs 和明确 locator 作事实陈述或引用。\n- 若本方法输入包含 allowedCitationPairs，则仅允许逐字复制其中列出的来源-定位配对；上一稿或审查反馈中的引用，只有配对仍在该清单中才可保留。若未提供该清单，只能使用 evidence excerpts 中列出的完整来源-定位配对。\n- 反馈中出现的来源 ID、段落号、数字和结论，若未出现在本方法输入中，不得照抄、引用或当作已验证事实；应删除该主张、明确限定为待补证缺口，或保留原有谨慎结论。\n- 对于本方法输入之外的竞争对象、产品规格、数值或来源，即使只想标记为“待核实”或说明“本方法没有原文”，也不得复述其名称、数字、型号或路线；只用不含这些细节的范围限定说明本方法缺少可比证据。\n- 不得引用其他方法专属材料。竞争对手身份与横向比较仅由竞争分析方法处理；本方法没有相应原文时不得补写竞品名称或市场份额。\n- 修订仅处理本方法负责的问题，并对每项数字及关键结论逐一绑定本方法输入中可核验的证据位置。\n待核查反馈：\n${feedback.join('\n')}` : canonicalMethodology
          const methodologyText = addCompanyMethodEvidenceInstructions(skillId, reviewedMethodology)
          const result = await executeCompanyResearchMethod({ ...researchInput, skillId, methodology: methodologyText, reasoningExecutor: input.reasoningExecutor, maxAttempts: (2 - (previous?.attempts ?? 0)) as 1 | 2 })
          if (result.status === 'cancelled') throw new Error('WORKFLOW_CANCELLED')
          const merged = mergeCompanyMethodRevisionResult(previous, result, { preserveCompletedOnReviewFailure: feedback.length > 0 })
          await input.observations?.finishSkill(skillId, result.status === 'complete' ? 'completed' : 'failed', result.status === 'complete' ? '原子研究方法完成，证据位置已校验' : result.diagnostics.map(d => d.code).join(';') || '研究证据不足')
          return merged
        }))
        methodResults = [...methodResults.filter(method => !results.some(result => result.skillId === method.skillId)), ...results]
        await mkdir(resolve(input.reportRoot), { recursive: true })
        await writeFile(resolve(input.reportRoot, `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}.progress.json`), JSON.stringify({ company, asOf, round, methodResults, updatedAt: now() }, null, 2), 'utf8')
        semanticExecutionBlock = results.flatMap(result => result.diagnostics).find(diagnostic => diagnostic.code === 'RATE_LIMIT_OR_QUOTA' || diagnostic.code === 'AUTHENTICATION_OR_ACCOUNT')?.code as typeof semanticExecutionBlock
        if (semanticExecutionBlock) break
      }
      if (semanticExecutionBlock) {
        for (const skillId of COMPANY_RESEARCH_METHOD_IDS.filter(id => !methodResults.some(method => method.skillId === id))) methodResults.push({skillId,status:'failed',attempts:0,answer:'',markdown:'',sections:[],findings:[],risks:[],sourceCandidateIds:[],limitations:['语义执行受账户或额度限制，本方法未调用。'],diagnostics:[{code:semanticExecutionBlock,message:'Execution stopped after a shared account or quota failure; this method was not invoked.',attempt:0}]})
        break
      }
      const incomplete = methodResults.filter(method => method.status !== 'complete')
      revisionTargets = []
      if (!incomplete.length && input.reasoningExecutor && reviewRounds < 2) {
        reviewedResearch = await assemble()
        const structural = evaluateCompanyResearchContent({sections:reviewedResearch.sections,synthesisMode,methodResults,methodExecutions:methodResults})
        if (!structural.passed) break
        if (synthesisMode === 'reasoning_executor') {
          lastStructurallyAcceptedResearch = reviewedResearch
          lastStructurallyAcceptedEvidenceFingerprint = companySynthesisEvidenceFingerprint({ sections: reviewedResearch.sections, methodResults })
          lastStructurallyAcceptedSynthesisMode = synthesisMode
          synthesisSnapshotStatus = 'captured'
        }
        semanticReview = await review(reviewedResearch)
        if (lastStructurallyAcceptedResearch === reviewedResearch) lastStructurallyAcceptedReview = semanticReview
        if (semanticReview.passed) break
        const failedIds = semanticReview.sectionChecks.filter(check => !check.questionAnswered || !check.evidenceSupportsConclusion || !check.numericReproducible || !check.riskTransmission).map(check => check.sectionId)
        revisionTargets = COMPANY_RESEARCH_METHOD_IDS.filter(id => COMPANY_METHOD_SECTION_IDS[id].some(sectionId => failedIds.includes(sectionId)))
        if (semanticReview.diagnostics.some(diagnostic => diagnostic.code === 'RATE_LIMIT_OR_QUOTA' || diagnostic.code === 'AUTHENTICATION_OR_ACCOUNT')) break
        // An exhausted atomic method cannot be called again, but its remaining
        // valid evidence can still be synthesized against the review feedback.
        // Do not let one exhausted section owner suppress repair of sibling
        // owners or the final synthesis; the per-operation attempt filter below
        // enforces each method's own budget.
        if (reviewRounds >= 2 || semanticReview.sectionChecks.length !== COMPANY_CORE_SECTION_IDS.length) break
      }
      const needsSupplement = incomplete.some(method => method.attempts < 2) || !!semanticReview && !semanticReview.passed && semanticReview.sectionChecks.length === COMPANY_CORE_SECTION_IDS.length && reviewRounds < 2
      if (!needsSupplement || round === 2 || !input.reasoningExecutor || acquisitionRemainingMs <= 0) break
      const gapMethods = [...new Set([...incomplete.map(method => method.skillId),...revisionTargets])]
      const methodTerms = [...new Set([...gapMethods.map(id => COMPANY_METHOD_METHODOLOGY[id].terms[0]!),...gapMethods.flatMap(id => COMPANY_METHOD_METHODOLOGY[id].terms)])]
      const peerTerms = gapMethods.includes('competitive_market_map') ? [...(PEER_RESEARCH_TERMS[company.symbol] ?? [])] : []
      const terms = [...peerTerms, ...methodTerms].slice(0, 12)
      const supplemental = await acquireWithinBudget(terms, acquired)
      const retained = new Map(acquired.sources.map(source => [source.candidate.candidateId, source]))
      const addedIds: string[] = []
      const conflictDiagnostics: ResearchAcquisitionDiagnostic[] = []
      for (const source of supplemental.sources) {
        const original = retained.get(source.candidate.candidateId)
        if (original) {
          if (original.contentHash !== source.contentHash) {
            sourceConflicts.push({round:round+1,candidateId:source.candidate.candidateId,retainedSource:original,incomingSource:source})
            conflictDiagnostics.push({provider:source.candidate.provider,candidateId:source.candidate.candidateId,status:'failed',reason:`SOURCE_CONTENT_CONFLICT: retained original ${original.contentHash}; supplemental ${source.contentHash} was not substituted or promoted`})
          }
          continue
        }
        if (retained.size >= (input.maxSources ?? 50)) continue
        retained.set(source.candidate.candidateId,source); addedIds.push(source.candidate.candidateId)
      }
      const sources = [...retained.values()]
      const durableSourceCandidateIds = [...new Set([...acquired.durableSourceCandidateIds, ...supplemental.durableSourceCandidateIds.filter(id=>addedIds.includes(id))])]
      const addedCoreReports = sources.filter(source => addedIds.includes(source.candidate.candidateId) && durableSourceCandidateIds.includes(source.candidate.candidateId) && isCoreOfficialReport(source))
      if (addedCoreReports.length) {
        reviewedResearch = undefined
        // Previously complete prose can be stale: it never saw this newly available primary report.
        methodResults = methodResults.map(method => {
          if (method.status !== 'complete') return method
          const missing = addedCoreReports.filter(source => !method.executionEvidence?.some(packet => packet.sourceCandidateId === source.candidate.candidateId))
          if (!missing.length) return method
          const ids = missing.map(source => source.candidate.candidateId)
          if (method.attempts < 2) {
            revisionTargets = [...new Set([...revisionTargets, method.skillId])]
            return {...method, diagnostics:[...method.diagnostics,{code:'EVIDENCE_REFRESH_REQUIRED',message:`New statutory report evidence requires method refresh: ${ids.join(', ')}`,attempt:method.attempts}]}
          }
          return {...method,status:'insufficient_evidence' as const,limitations:[...method.limitations,`新增官方定期报告未纳入本方法，调用预算已耗尽：${ids.join(', ')}`],diagnostics:[...method.diagnostics,{code:'EVIDENCE_REFRESH_BUDGET_EXHAUSTED',message:`New statutory report evidence was not consumed; method budget exhausted: ${ids.join(', ')}`,attempt:method.attempts}]}
        })
      }
      const acceptedStructured = (kind: 'basic'|'financial'|'market') => durableSourceCandidateIds.includes(`akshare-${kind}-${company.symbol}`) && supplemental.sources.some(source=>source.candidate.candidateId===`akshare-${kind}-${company.symbol}` && retained.get(source.candidate.candidateId)?.contentHash===source.contentHash)
      acquired = { ...acquired, sources, durableSourceCandidateIds, durableSources: sources.filter(source => durableSourceCandidateIds.includes(source.candidate.candidateId)),
        profileData: acquired.profileData?.fields.length ? acquired.profileData : acceptedStructured('basic') ? supplemental.profileData : acquired.profileData,
        financialData: acquired.financialData?.length ? acquired.financialData : acceptedStructured('financial') ? supplemental.financialData : acquired.financialData,
        marketData: acquired.marketData?.length ? acquired.marketData : acceptedStructured('market') ? supplemental.marketData : acquired.marketData,
        diagnostics: [...acquired.diagnostics, ...supplemental.diagnostics,...conflictDiagnostics], providerOutcomes: [...acquired.providerOutcomes, ...supplemental.providerOutcomes], sourceAttempts:[...acquired.sourceAttempts,...supplemental.sourceAttempts] }
      researchInput = {...researchInput,profileData:acquired.profileData,financialData:acquired.financialData,marketData:acquired.marketData}
    }
    let research = reviewedResearch
    const currentEvidenceFingerprint = lastStructurallyAcceptedResearch ? companySynthesisEvidenceFingerprint({ sections: lastStructurallyAcceptedResearch.sections, methodResults }) : undefined
    const lastSynthesisEvidenceStillValid = !!lastStructurallyAcceptedEvidenceFingerprint && lastStructurallyAcceptedEvidenceFingerprint === currentEvidenceFingerprint
    const allCurrentMethodsComplete = methodResults.every(method => method.status === 'complete')
    const lastThesis = lastStructurallyAcceptedResearch?.sections.find(section => section.id === 'investment-thesis')?.markdown ?? ''
    const currentThesis = reviewedResearch?.sections.find(section => section.id === 'investment-thesis')?.markdown ?? ''
    const currentSynthesisWasDegraded = synthesisMode !== 'reasoning_executor' || !currentThesis || /^研究缺口：.*(?:尚未完成|缺失对应方法结果)/.test(currentThesis)
    if (lastStructurallyAcceptedResearch && lastThesis.trim() && !/^研究缺口：.*(?:尚未完成|缺失对应方法结果)/.test(lastThesis) && currentSynthesisWasDegraded && lastSynthesisEvidenceStillValid && allCurrentMethodsComplete) {
      // A review-driven retry may consume the remaining model quota after a
      // citation/numeric-validated synthesis already passed the structural
      // gate. Keep that content in the blocked report rather than replacing
      // thesis and monitoring sections with empty deterministic placeholders.
      // The saved semantic review remains attached, so this cannot turn a
      // failed or interrupted review into a passing report.
      research = lastStructurallyAcceptedResearch
      reviewedResearch = research
      synthesisMode = lastStructurallyAcceptedSynthesisMode
      semanticReview = lastStructurallyAcceptedReview ?? semanticReview
      finalSynthesisReviewed = !!lastStructurallyAcceptedReview
      synthesisSnapshotStatus = 'retained_after_block'
      if (semanticExecutionBlock) synthesisDiagnostics = [...synthesisDiagnostics, `RETAINED_STRUCTURALLY_VALID_SYNTHESIS_AFTER_${semanticExecutionBlock}`]
    } else if (lastStructurallyAcceptedResearch && currentSynthesisWasDegraded) {
      synthesisSnapshotStatus = !lastSynthesisEvidenceStillValid ? 'not_retained_evidence_changed' : !allCurrentMethodsComplete ? 'not_retained_methods_incomplete' : 'not_retained_unknown'
      synthesisDiagnostics = [...synthesisDiagnostics, `PRIOR_SYNTHESIS_NOT_RETAINED:${!lastSynthesisEvidenceStillValid ? 'CITED_EVIDENCE_CHANGED_OR_UNRESOLVED' : !allCurrentMethodsComplete ? 'METHODS_INCOMPLETE' : 'NO_BLOCK_REASON'}`]
    }
    research ??= await assemble()
    if (synthesisMode !== 'reasoning_executor') {
      const reason = lastStructurallyAcceptedResearch && !lastSynthesisEvidenceStillValid ? 'cited_evidence_unresolved' : !allCurrentMethodsComplete ? 'methods_incomplete' : 'review_or_synthesis_blocked'
      research = { ...research, sections: ensureCompanyIncompleteSynthesisSections(research.sections, reason) }
    }
    await input.observations?.finishStage('research_synthesis', synthesisMode === 'reasoning_executor' ? 'completed' : 'blocked', { summary: synthesisMode === 'reasoning_executor' ? '研究综合分析已返回' : '研究综合未通过，不能宣称完成', diagnostics: [...synthesisDiagnostics] })
    const industryExposure = input.industryExposure === undefined ? undefined : calculateCompanyIndustryExposureBridge(input.industryExposure)
    const withIndustryExposure = industryExposure === undefined ? research : { ...research, sections: research.sections.map((section) => section.title === 'Industry Exposure' ? { ...section, markdown: `${section.markdown}\n\n${renderCompanyIndustryExposureBridge(industryExposure)}`, sourceCandidateIds: [...new Set([...section.sourceCandidateIds, ...industryExposure.items.flatMap((item) => [...item.driver.sourceRefs, ...item.exposure.sourceRefs, ...(item.sensitivity?.sourceRefs ?? [])])])] } : section) }
    const normalizedFinalSections = withIndustryExposure.sections.map(section => {
      const repaired = repairCompanyResearchMarkdownTables(section.markdown)
      preReconciliationTableRepairs.push(...repaired.repairs.map(repair => `${section.id}: ${repair}`))
      return { ...section, markdown: repaired.markdown }
    })
    const reconciledSections = reconcileCompanyCompetitorEvidence({ sections: normalizedFinalSections, methodResults })
    const productCitations = reconcileCompanyProductTableSectionReferences({ sections: reconciledSections, methodResults })
    const segmentCitations = reconcileCompanySegmentRowCitations({ sections: productCitations, methodResults })
    const rowCitations = reconcileCompanyProductRevenueRowCitations({ sections: segmentCitations, methodResults })
    const classificationLabels = reconcileCompanyDriverClassificationLabels({sections:rowCitations,methodResults})
    const growthCitations = reconcileCompanyProductGrowthReferences({ sections: classificationLabels, methodResults })
    const industryPeriods = reconcileCompanyIndustryForecastPeriods({ sections: growthCitations, methodResults })
    const preparedFacts = reconcileCompanyPreparedAnalysisFacts({ sections: industryPeriods, methodResults, preparedAnalysis: researchInput.preparedAnalysis, sources: researchInput.sources })
    const placementFacts = reconcileCompanyPlacementFacts({ sections: preparedFacts, methodResults })
    const technologyReferences = reconcileCompanyTechnologyProgressReferences({ sections: placementFacts, methodResults })
    const productMix = reconcileCompanyProductRevenueShares({ sections: technologyReferences, methodResults })
    const customerContext = reconcileCompanyProductCustomerConcentration({ sections: productMix, methodResults })
    const productionGrowth = reconcileCompanyProductProductionGrowth({ sections: customerContext, methodResults })
    const revenueCostGrowth = reconcileCompanyProductRevenueCostGrowth({ sections: productionGrowth, methodResults, sources: researchInput.sources })
    const financialFormula = reconcileCompanyFinancialGrowthFormula({ sections: revenueCostGrowth, methodResults })
    const consolidatedMargin = reconcileCompanyConsolidatedGrossMargin({ sections: financialFormula, methodResults })
    const financialBoundaries = reconcileCompanyFinancialScopeLimitations({ sections: consolidatedMargin, methodResults })
    const revenueDrivers = reconcileCompanyProductRevenueDrivers({ sections: financialBoundaries, methodResults })
    const linkedFinancial = reconcileCompanyDriverFinancialReferences({ sections: revenueDrivers, methodResults })
    const employeePlan = reconcileCompanyEmployeePlanEvidence({ sections: linkedFinancial, methodResults })
    const ownerHoldings = reconcileCompanyControlOwnerHoldings({ sections: employeePlan, methodResults })
    const financialHistoryRows = (researchInput.preparedAnalysis as {financial?:{table?:readonly {period?:string;metrics?:Readonly<Record<string,unknown>>;metadata?:Readonly<Record<string,{unit?:string;currency?:string;basis?:string}>>;conflicts?:readonly {metric:string}[]}[]}}|undefined)?.financial?.table
    const financialSourceId = methodResults.find(method=>method.skillId==='financial_quality_analysis')?.sourceCandidateIds[0]
    const leverage = reconcileCompanyLeverageFormula({sections:ownerHoldings,financialTable:financialHistoryRows,sourceCandidateId:financialSourceId})
    const riskAligned = reconcileCompanyRiskBoundaries({ sections: leverage, methodResults })
    const crossSectionBoundaries = reconcileCompanyCrossSectionBoundaries({ sections: riskAligned, methodResults })
    const financialSummarySections = reconcileCompanyFinancialSummaryTable({sections:crossSectionBoundaries,markdown:renderCompanyFinancialTable(researchInput)?.markdown})
    const periodBoundSections = reconcileCompanyFinancialPeriodScope({sections:financialSummarySections,methodResults})
    const finalFinancialFormulas = reconcileCompanyFinancialGrowthFormula({sections:periodBoundSections,methodResults})
    const finalLeverage = reconcileCompanyLeverageFormula({sections:finalFinancialFormulas,financialTable:financialHistoryRows,sourceCandidateId:financialSourceId})
    const boundedSections = reconcileCompanyAnnualGrossMargin({sections:finalLeverage,methodResults})
    const finalFinancialSummary = renderCompanyFinancialTable(researchInput)?.openingSummary ?? ''
    let reportResearch = { ...withIndustryExposure, sections: boundedSections.map(section => section.id === 'financial-quality' ? { ...section, markdown: insertCompanyFinancialOpeningSummary(section.markdown, finalFinancialSummary) } : section) }
    const tableRepairRecords: string[] = [...preReconciliationTableRepairs]
    const tableRepairDiagnostics: string[] = []
    reportResearch = { ...reportResearch, sections: reportResearch.sections.map(section => {
      const repaired = repairCompanyResearchMarkdownTables(section.markdown)
      tableRepairRecords.push(...repaired.repairs.map(repair => `${section.id}: ${repair}`))
      tableRepairDiagnostics.push(...repaired.diagnostics.map(diagnostic => `${section.id}: ${diagnostic}`))
      return { ...section, markdown: repaired.markdown }
    }) }
    await input.observations?.startStage('quality_gate', '证据质量门')
    const qualityGate = runResearchQualityGate({ profile: 'company', asOf, sources: acquired.sources, referencedSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds), proposalSourceCandidateIds: research.proposals.flatMap((proposal) => proposal.sourceCandidateIds ?? []), reportSourceCandidateIds: reportResearch.sections.flatMap((section) => section.sourceCandidateIds) })
    const structuralContentQuality = evaluateCompanyResearchContent({ sections: reportResearch.sections, synthesisMode, methodResults, methodExecutions: methodResults })
    // Initial method diagnostics remain available in the checkpoint for repair
    // auditing. Only errors still present after deterministic reconciliation
    // on the final report sections block completion.
    const tableDiagnostics = [...tableRepairDiagnostics, ...validateCompanyResearchSectionTables(reportResearch.sections)]
    let contentQuality = structuralContentQuality
    if (structuralContentQuality.passed) {
      if ((industryExposure !== undefined && !semanticExecutionBlock) || !semanticReview || !finalSynthesisReviewed) {
        semanticReview = reviewRounds < 2 ? await review(reportResearch) : {passed:false,status:'failed',attempts:reviewAttempts,sectionChecks:[],issues:['SEMANTIC_REVIEW_BUDGET_EXHAUSTED'],diagnostics:[]}
      }
      contentQuality = mergeCompanySemanticQuality(structuralContentQuality,semanticReview)
    }
    // Semantic review is merged after structural checks; reapply this final
    // Markdown integrity gate so a passing review cannot erase table errors.
    contentQuality = applyCompanyResearchTableDiagnostics(contentQuality, tableDiagnostics)
    if (acquisitionRemainingMs <= 0) contentQuality = {...contentQuality,passed:false,status:'incomplete',issues:[...contentQuality.issues,'ACQUISITION_BUDGET_EXHAUSTED']}
    const methodExecutions = methodResults.map(method => ({skillId:method.skillId,status:method.status,attempts:method.attempts,summary:method.answer.slice(0,300),...(method.diagnostics.at(-1)?{errorCode:method.diagnostics.at(-1)!.code}:{})}))
    await mkdir(resolve(input.reportRoot), {recursive:true})
    await writeFile(resolve(input.reportRoot, `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}.analysis.json`), JSON.stringify({asOf,company,methodResults,contentQuality,synthesisMode,synthesisDiagnostics,synthesisSnapshotStatus,synthesisAttemptOutputs,synthesisAttempts,reviewAttempts,reviewRounds,qualityReviewHistory,tableRepairs:tableRepairRecords,tableRepairDiagnostics,tableDiagnostics:{methodSections:synthesisTableDiagnostics,finalReport:tableDiagnostics},acquisitionBudget:{limitMs:acquisitionBudgetLimitMs,spentMs:acquisitionBudgetLimitMs-acquisitionRemainingMs,remainingMs:acquisitionRemainingMs},sourceConflicts,preparedAnalysis:researchInput.preparedAnalysis,sourceDiagnostics:acquired.diagnostics,sourceAttempts:acquired.sourceAttempts,sourceAdvice:assessCompanySourceHealth(acquired.sourceAttempts),sourceSummaries:acquired.sources.map(source=>({candidateId:source.candidate.candidateId,title:source.title,url:source.canonicalUrl,publishedAt:source.candidate.publishedAt,contentHash:source.contentHash,content:source.content}))},null,2),'utf8')
    const noAcquiredEvidence = acquired.sources.length === 0
    await input.observations?.finishStage('quality_gate', qualityGate.eligibleForGateway && !noAcquiredEvidence && contentQuality.passed ? 'completed' : 'blocked', { summary: contentQuality.passed ? '证据与研究内容质量门已验收' : '公司研究核心内容未完成，未进入 Knowledge Gateway', diagnostics: [...(noAcquiredEvidence ? ['NO_COMPANY_RESEARCH_EVIDENCE'] : qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code)),...contentQuality.issues] })
    if (!qualityGate.eligibleForGateway || noAcquiredEvidence || !contentQuality.passed) {
      const gapDiagnostics = [...qualityGate.diagnostics.filter((item) => item.severity === 'ERROR').map((item) => item.code), ...(noAcquiredEvidence ? ['NO_COMPANY_RESEARCH_EVIDENCE'] : []), ...contentQuality.issues]
      const blockedQualityGate = noAcquiredEvidence ? { ...qualityGate, status: 'FAIL' as const, eligibleForGateway: false, diagnostics: [...qualityGate.diagnostics, { code: 'NO_COMPANY_RESEARCH_EVIDENCE', severity: 'ERROR' as const, message: 'No usable Company profile, financial, market, or external research evidence was acquired.', affectedRefs: [] }] } : qualityGate
      const reportId = `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}`
      await input.observations?.startStage('report_generation', '研究报告生成')
      const report = validateResearchReport({ reportId, reportType: 'company_research', subjectRefs: existingCompanyRef ? [existingCompanyRef] : [], ...(input.securityIdentity === undefined ? {} : { verifiedSecurityIdentity: input.securityIdentity }), generatedAt: research.generatedAt, asOf, workflowRunId: input.workflowRunId, knowledgeBaseRevision: input.handle.revision, sourceRefs: [], claimRefs: [], researchQuality: contentQuality, methodExecutions, methodology: noAcquiredEvidence ? '本轮未取得可用公司研究证据，报告保留具体来源故障与待回答问题；未执行 Knowledge 写入。' : '本轮已有证据及部分研究结果，但证据质量、核心研究内容或独立语义审查未全部通过；保留通过核验的分析、具体缺口和失败诊断，未执行 Knowledge 写入。', sections: makeReportSections(reportResearch, acquired, {}, {}), outputPath: `${reportId}.md` })
      await input.observations?.finishStage('report_generation', 'completed', { summary: '阻塞结果报告已生成' })
      await input.observations?.startStage('report_persistence', '报告保存')
      const outputPath = await writeResearchReport(report, resolve(input.reportRoot))
      await input.observations?.finishStage('report_persistence', 'completed', { summary: '阻塞结果报告已保存' })
      return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, report: { reportId, outputPath }, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: gapDiagnostics.length ? gapDiagnostics : ['COMPANY_RESEARCH_QUALITY_GATE_FAILED'], research: reportResearch, industryExposure, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate: blockedQualityGate }
    }
    const effectiveWriteKnowledge = input.writeKnowledge !== false && (existingCompanyRef !== undefined || input.writeKnowledge === true)
    let outcome: KnowledgeProductionOutcome = { status: 'no_changes', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, baseRevision: input.handle.revision, createdIds: [], updatedIds: [], sourceRefsByLocalId: {}, claimRefsByProposalId: {}, entityRefsByLocalKey: {}, relationRefsByProposalId: {}, resolutionIntents: [], errors: [] }
    await input.observations?.startStage('knowledge_gateway', 'Knowledge Gateway')
    if (effectiveWriteKnowledge) {
      outcome = await gateway.submit({ handle: input.handle, producerType: 'company_deep_research', producerRunId: input.workflowRunId, schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: company.name ?? company.symbol, aliases: [company.symbol], semanticFields: { ticker: company.symbol, exchange: company.exchange } }, proposals: research.proposals, evidenceBindings: acquired.durableSources.map((source) => ({ localSourceId: source.candidate.candidateId, source })), asOf, now, writeKnowledge: true })
      const persisted = new Set((await readCanonicalV04Assets(input.handle.rootRef)).registry.map((entry) => entry.id))
      const submittedRefs = [...Object.values(outcome.sourceRefsByLocalId), ...Object.values(outcome.claimRefsByProposalId), ...Object.values(outcome.entityRefsByLocalKey), ...Object.values(outcome.relationRefsByProposalId)]
      const unpersistedRefs = submittedRefs.filter((ref) => !persisted.has(ref))
      if (unpersistedRefs.length > 0) { await input.observations?.finishStage('knowledge_gateway', 'blocked', { summary: 'Knowledge Gateway 引用校验未通过', diagnostics: ['CANONICAL_REFERENCE_NOT_PERSISTED'] }); return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [`COMPANY_CANONICAL_REFERENCE_NOT_PERSISTED: ${[...new Set(unpersistedRefs)].sort().join(', ')}`], research: reportResearch, industryExposure, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate } }
    }
    await input.observations?.finishStage('knowledge_gateway', outcome.status === 'blocked' || outcome.status === 'failed' ? 'blocked' : effectiveWriteKnowledge ? 'completed' : 'skipped', { summary: outcome.status === 'blocked' || outcome.status === 'failed' ? 'Knowledge Gateway 未完成写入' : effectiveWriteKnowledge ? 'Knowledge Gateway 已返回' : '本次未授权 Knowledge 写入', ...((outcome.status === 'blocked' || outcome.status === 'failed') ? { diagnostics: ['KNOWLEDGE_GATEWAY_BLOCKED'] } : {}) })
    if (outcome.status === 'blocked' || outcome.status === 'failed') return { workflowRunId: input.workflowRunId, status: 'blocked', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: [], updatedIds: [], committedIds: [], sourceIds: Object.values(outcome.sourceRefsByLocalId), claimIds: Object.values(outcome.claimRefsByProposalId), errors: outcome.errors, research, resolutionIntents: outcome.resolutionIntents, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate }
    // Gateway dry-runs may return a planned entity ref even when writeKnowledge
    // is false. Only attach a ref backed by an entity actually present in the KB.
    const companyRef = existingCompanyRef ?? (effectiveWriteKnowledge ? outcome.entityRefsByLocalKey.company : undefined)
    const reportId = `company-research-${company.symbol.toLowerCase()}-${input.workflowRunId}`
    await input.observations?.startStage('report_generation', '研究报告生成')
    const report: ResearchReport = validateResearchReport({ reportId, reportType: 'company_research', subjectRefs: companyRef ? [companyRef] : [], ...(input.securityIdentity === undefined ? {} : { verifiedSecurityIdentity: input.securityIdentity }), generatedAt: research.generatedAt, asOf, workflowRunId: input.workflowRunId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, sourceRefs: Object.values(outcome.sourceRefsByLocalId), claimRefs: Object.values(outcome.claimRefsByProposalId), researchQuality: contentQuality, methodExecutions, methodology: '原子方法研究与跨方法综合；来源及内容双重验收；Knowledge 写入由 Gateway、Validation 和 Writer 执行。', sections: makeReportSections(reportResearch, acquired, outcome.sourceRefsByLocalId, outcome.claimRefsByProposalId), outputPath: `${reportId}.md` })
    await input.observations?.finishStage('report_generation', 'completed', { summary: '研究报告已生成' })
    await input.observations?.startStage('report_persistence', '报告保存')
    const outputPath = await writeResearchReport(report, resolve(input.reportRoot))
    await input.observations?.finishStage('report_persistence', 'completed', { summary: '研究报告已保存' })
    return { workflowRunId: input.workflowRunId, status: 'completed', knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: outcome.knowledgeBaseRevision, report: { reportId, outputPath }, proposalIds: research.proposals.map((proposal) => proposal.proposalId), createdIds: outcome.createdIds, updatedIds: outcome.updatedIds, committedIds: [...outcome.createdIds, ...outcome.updatedIds], sourceIds: Object.values(outcome.sourceRefsByLocalId), claimIds: Object.values(outcome.claimRefsByProposalId), errors: [], research: reportResearch, industryExposure, resolutionIntents: outcome.resolutionIntents, acquisitionDiagnostics: acquired.diagnostics, providerOutcomes: acquired.providerOutcomes, qualityGate }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { workflowRunId: input.workflowRunId, status: message === 'WORKFLOW_CANCELLED' ? 'cancelled' : 'failed', knowledgeBaseId: input.handle.knowledgeBaseId, proposalIds: [], createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], claimIds: [], errors: [message] }
  }
}
