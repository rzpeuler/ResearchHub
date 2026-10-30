import { validateCompanyResearchMarkdownTables } from '../../skills/company-research/markdown-tables.ts'
import { createHash } from 'node:crypto'
export { validateCompanyResearchMarkdownTables } from '../../skills/company-research/markdown-tables.ts'
import type { CompanyResearchInput, CompanyResearchResult, SemanticKnowledgeProposal } from '../../skills/company-research/contracts.ts'
import { COMPANY_RESEARCH_SECTIONS } from '../../skills/company-research/skill.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { validateCompanyNumericGrounding, companyPreparedFinancialDateText } from '../../skills/company-research/numeric-grounding.ts'
import type { NumericGroundingDiagnostic } from '../../skills/company-research/numeric-grounding.ts'
import { companyCitedSplitDateText } from '../../skills/company-research/evidence.ts'
import { dailyCloseAvailableAt } from '../../data/point-in-time.ts'
import { extractFilingBasicEps } from './valuation-sections.ts'

const idFor = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
const finalIds = ['investment-thesis','monitoring-checklist']
const P1_EDITORIAL_PRIORITY = '编辑优先级：investment-thesis 按“核心判断→决定性经营驱动→最强支持证据与反证→失效条件”组织，明确区分已证实事实与推断；monitoring-checklist 按同一驱动的可验证支持信号与反证排序。综合两节以定性解释为主；当少量直接披露的关键数值能实质说明主导经营驱动、最强反证或风险暴露时，应保留该数值及其指标、口径、期间、单位和精确引用。不得为简短而删去决定判断力度的事实，也不得复抄方法章节的完整数据表或重复同一数值；计算值必须采用已验证输入并列明公式和操作数。行情或估值基准的观察日必须按来源的observationDate或asOf标注，并与财务报告期分别表述。只有指标及观察对象实质相同才合并。'

type CompanySource = CompanyResearchInput['sources'][number]

function sourceProvenance(source: CompanySource): Record<string, unknown> | undefined {
  return source.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined
}

function marketPriceContent(source: CompanySource): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(source.content)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
    const record = value as Record<string, unknown>
    return record.metricId === 'valuation_market_price' ? record : undefined
  } catch {
    return undefined
  }
}

function isMarketPriceSource(source: CompanySource): boolean {
  return sourceProvenance(source)?.metricId === 'valuation_market_price' || marketPriceContent(source) !== undefined
}

function isQualifiedHistoricalMarketSource(source: CompanySource, asOf: string | undefined): boolean {
  if (!asOf || !source.contentHash || createHash('sha256').update(source.content, 'utf8').digest('hex') !== source.contentHash) return false
  const provenance = sourceProvenance(source)
  const content = marketPriceContent(source)
  if (!provenance || !content
    || provenance.metricId !== 'valuation_market_price'
    || provenance.pointInTimeStatus !== 'within_cutoff'
    || provenance.pointInTimeSafe !== true
    || provenance.valueVersionStatus !== 'VERIFIED'
    || source.rights?.accessScope !== 'public'
    || source.rights.retentionAllowed !== true
    || source.rights.aiProcessingAllowed !== true
    || source.rights.derivativeKnowledgeAllowed !== true) return false
  const observationDate = typeof content.observationDate === 'string' ? content.observationDate : undefined
  const retrievedAt = typeof content.retrievedAt === 'string' ? content.retrievedAt : undefined
  const observationAvailableAt = typeof content.observationAvailableAt === 'string' ? content.observationAvailableAt : undefined
  const version = content.valueVersion as Record<string, unknown> | undefined
  const freshness = content.marketFreshness as Record<string, unknown> | undefined
  const cutoff = Date.parse(asOf)
  if (!observationDate || !retrievedAt || !observationAvailableAt || !Number.isFinite(cutoff)
    || content.unit !== 'CNY/share'
    || source.retrievedAt !== retrievedAt
    || !/^\d{4}-\d{2}-\d{2}$/u.test(observationDate)
    || observationDate > asOf.slice(0, 10)
    || observationAvailableAt !== dailyCloseAvailableAt(observationDate)
    || !Number.isFinite(Date.parse(retrievedAt)) || Date.parse(retrievedAt) > cutoff
    || Date.parse(observationAvailableAt) > cutoff
    || version?.status !== 'VERIFIED'
    || typeof version.versionId !== 'string' || !version.versionId.trim()
    || typeof version.availableAt !== 'string' || !Number.isFinite(Date.parse(version.availableAt))
    || Date.parse(version.availableAt) > cutoff
    || freshness?.status !== 'FRESH') return false
  return true
}

function exactBasicEpsReferences(sources: readonly CompanySource[], asOf: string | undefined): Map<string, number> {
  const references = new Map<string, number>()
  if (!asOf) return references
  for (const source of sources) {
    const years = [...(source.candidate.title ?? '').matchAll(/(?:19|20)\d{2}/gu)].map(match => Number(match[0]))
    for (const fiscalYear of new Set(years)) {
      const selected = extractFilingBasicEps(sources as Parameters<typeof extractFilingBasicEps>[0], fiscalYear, asOf)
      if (selected?.source.candidate.candidateId === source.candidate.candidateId) references.set(`${source.candidate.candidateId}@${selected.location}`, fiscalYear)
    }
  }
  return references
}

function hasBasicEpsClaim(text: string): boolean {
  return /(?:基本\s*每股收益|基本\s*EPS|basic\s+EPS)/iu.test(text)
}

function hasAffirmativeReferencePeClaim(text: string): boolean {
  const referencePe = /(?:参考\s*PE|参考市盈率|市盈率|P\/E)/iu
  const explicitGap = /(?:研究缺口|缺少(?:合格)?(?:行情|估值输入)|(?:无法|不能|未能)(?:计算|核实|确认|得出)|未(?:核验|验证)|不具备(?:合格)?(?:行情|估值输入)|暂无(?:合格)?(?:行情|估值输入))[^。！？\n]{0,32}$/iu
  const unavailableAfterClaim = /^\s*(?:尚)?(?:无法计算|不能计算|未能计算|不可计算|无法核实|无法确认|未核验|未验证)/iu
  return text.split(/(?<=[。！？.!?])\s*|\r?\n/u).some(sentence => {
    const prose = sentence.replace(/\[[^\]]*\]/gu, ' ')
    const match = referencePe.exec(prose)
    if (!match || match.index === undefined) return false
    const before = prose.slice(0, match.index)
    const after = prose.slice(match.index + match[0].length)
    return !explicitGap.test(before.slice(-72)) && !unavailableAfterClaim.test(after)
  })
}

function claimedEpsFiscalYears(text: string): Set<number> {
  const prose = text.replace(/\[[^\]]*\]/gu, ' ')
  const years = new Set<number>()
  const patterns = [
    /((?:FY\s*)?(?:19|20)\d{2}\s*(?:年|财年)?)[^。；;\n]{0,32}(?:基本\s*每股收益|基本\s*EPS|basic\s+EPS)/giu,
    /(?:基本\s*每股收益|基本\s*EPS|basic\s+EPS)[^。；;\n]{0,32}((?:FY\s*)?(?:19|20)\d{2})/giu,
  ]
  for (const pattern of patterns) {
    for (const match of prose.matchAll(pattern)) {
      const year = match[1]?.match(/(?:19|20)\d{2}/u)?.[0]
      if (year) years.add(Number(year))
    }
  }
  return years
}

function containsUnqualifiedEpsClaim(text: string, references: readonly string[], exactEps: ReadonlyMap<string, number>): boolean {
  if (!hasBasicEpsClaim(text) || !/\d/u.test(text)) return false
  const citedYears = references.flatMap(reference => {
    const fiscalYear = exactEps.get(reference)
    return fiscalYear === undefined ? [] : [fiscalYear]
  })
  if (citedYears.length === 0) return true
  const claimedYears = claimedEpsFiscalYears(text)
  return [...claimedYears].some(year => !citedYears.includes(year))
}

function hasBasicEpsFiscalYearMismatch(text: string, references: readonly string[], exactEps: ReadonlyMap<string, number>): boolean {
  if (!hasBasicEpsClaim(text)) return false
  const claimedYears = claimedEpsFiscalYears(text)
  if (claimedYears.size === 0) return false
  const citedYears = references.flatMap(reference => {
    const fiscalYear = exactEps.get(reference)
    return fiscalYear === undefined ? [] : [fiscalYear]
  })
  return citedYears.length > 0 && [...claimedYears].some(year => !citedYears.includes(year))
}

function hasUnqualifiedBasicEpsSentence(markdown: string, exactEps: ReadonlyMap<string, number>): boolean {
  const sentences = markdown.split(/(?<=[。！？.!?])\s*|\r?\n/u)
  return sentences.some(sentence => {
    if (!containsUnqualifiedEpsClaim(sentence, [...sentence.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match => match[1]!), exactEps)) return false
    return true
  })
}

export interface SynthesisEvidenceLedgerEntry {
  readonly ownerSkill?: CompanyResearchMethodResult['skillId']
  readonly ownerWorkflow?: 'valuation' | 'bull-base-bear' | 'variant-perception'
  readonly sectionIds: readonly string[]
  readonly kind: 'fact' | 'inference' | 'assumption'
  readonly eligibility: 'verified' | 'blocked'
  readonly blockers?: readonly string[]
  readonly text: string
  readonly evidence: readonly {
    readonly sourceCandidateId: string
    readonly contentHash: string
    readonly location: string
    readonly excerpt: string
    readonly publishedAt?: string
    readonly pointInTimeStatus?: unknown
    readonly pointInTimeSafe?: unknown
  }[]
}

/** Build a bounded synthesis handoff from complete methods and exact supplied source rows. */
export function buildSynthesisEvidenceLedger(input: {
  readonly methods: readonly CompanyResearchMethodResult[]
  readonly sources: CompanyResearchInput['sources']
  readonly asOf?: string
  readonly workflowOwnedSections?: readonly { readonly id: string; readonly title: string; readonly markdown: string; readonly sourceCandidateIds: readonly string[] }[]
  readonly allowedSourceCandidateIds?: readonly string[]
  readonly conflictedSourceCandidateIds?: readonly string[]
  readonly maxEntries?: number
}): readonly SynthesisEvidenceLedgerEntry[] {
  const sources = new Map(input.sources.map(source => [source.candidate.candidateId, source]))
  const allowed = input.allowedSourceCandidateIds ? new Set(input.allowedSourceCandidateIds) : undefined
  const conflicted = new Set(input.conflictedSourceCandidateIds ?? [])
  const maxEntries = input.maxEntries ?? 160
  const exactEps = exactBasicEpsReferences(input.sources, input.asOf)
  const workflowEntrySlots = Math.min(3, input.workflowOwnedSections?.length ?? 0)
  const methodEntryLimit = Math.max(0, maxEntries - workflowEntrySlots)
  const entries: SynthesisEvidenceLedgerEntry[] = []
  for (const method of input.methods) {
    if (entries.length >= methodEntryLimit) break
    if (method.status !== 'complete') continue
    const allowedRows = new Map<string, { excerpt: string; source: CompanyResearchInput['sources'][number] }>()
    for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
      if (conflicted.has(packet.sourceCandidateId)) continue
      const source = sources.get(packet.sourceCandidateId)
      if (!source || allowed && !allowed.has(packet.sourceCandidateId)) continue
      for (const excerpt of packet.excerpts) {
        const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
        const original = Number.isInteger(paragraph) && paragraph > 0 ? source.content.split(/\r?\n/)[paragraph - 1] : undefined
        if (!original?.trim() || original !== excerpt.text) continue
        allowedRows.set(`${packet.sourceCandidateId}@${excerpt.location}`, { excerpt: original, source })
      }
    }
    const sectionIds = [...new Set(method.sections.map(section => section.id))]
    for (const finding of method.findings) {
      if (!finding.text.trim() || finding.evidence.length === 0) continue
      const references = finding.evidence.map(ref => `${ref.sourceCandidateId}@${ref.location}`)
      const unqualifiedMarket = finding.evidence.some(ref => {
        const source = sources.get(ref.sourceCandidateId)
        return !!source && isMarketPriceSource(source) && !isQualifiedHistoricalMarketSource(source, input.asOf)
      })
      const wrongEpsLocator = containsUnqualifiedEpsClaim(finding.text, references, exactEps)
      if (unqualifiedMarket || wrongEpsLocator) {
        entries.push({
          ownerSkill: method.skillId,
          sectionIds,
          kind: finding.kind,
          eligibility: 'blocked',
          blockers: [
            ...(unqualifiedMarket ? ['METHOD_MARKET_PRICE_NOT_HISTORICALLY_QUALIFIED'] : []),
            ...(wrongEpsLocator ? ['METHOD_BASIC_EPS_LOCATOR_NOT_UNIQUE_BASIC_EPS_ROW'] : []),
          ],
          text: '本条方法结论含未通过结构化价格 PIT 或基本 EPS 原表行资格校验的输入；不得作为估值结论证据。',
          evidence: [],
        })
        if (entries.length >= methodEntryLimit) break
        continue
      }
      const evidence = finding.evidence.flatMap(ref => {
        const row = allowedRows.get(`${ref.sourceCandidateId}@${ref.location}`)
        if (!row || conflicted.has(ref.sourceCandidateId)) return []
        const provenance = row.source.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined
        return [{
          sourceCandidateId: ref.sourceCandidateId,
          contentHash: row.source.contentHash || createHash('sha256').update(row.source.content, 'utf8').digest('hex'),
          location: ref.location,
          excerpt: row.excerpt.slice(0, 1200),
          ...(row.source.candidate.publishedAt ? { publishedAt: row.source.candidate.publishedAt } : {}),
          ...(provenance?.pointInTimeStatus !== undefined ? { pointInTimeStatus: provenance.pointInTimeStatus } : {}),
          ...(provenance?.pointInTimeSafe !== undefined ? { pointInTimeSafe: provenance.pointInTimeSafe } : {}),
        }]
      })
      if (evidence.length !== finding.evidence.length) continue
      entries.push({ ownerSkill: method.skillId, sectionIds, kind: finding.kind, eligibility: 'verified', text: finding.text.slice(0, 1600), evidence })
      if (entries.length >= methodEntryLimit) break
    }
  }
  for (const section of input.workflowOwnedSections ?? []) {
    if (entries.length >= maxEntries) break
    if (!['valuation', 'bull-base-bear', 'variant-perception'].includes(section.id)) continue
    const ownerWorkflow = section.id as 'valuation' | 'bull-base-bear' | 'variant-perception'
    const hasUnverifiedStatus = /(?:UNVERIFIED|未核验|未验证|不构成符合\s*asOf\s*的预期差结论|无法同时确认|不可复核|not\s+qualified|unverified)/iu.test(section.markdown)
    const hasExplicitGap = /^\s*研究缺口[:：]/u.test(section.markdown)
    const hasScenarioContract = /Bear/iu.test(section.markdown)
      && /Base/iu.test(section.markdown)
      && /Bull/iu.test(section.markdown)
      && /(?:敏感性|公式|计算)/u.test(section.markdown)
    const unqualified = hasExplicitGap
      || hasUnverifiedStatus
      || section.id === 'bull-base-bear' && !hasScenarioContract
    const sectionReferences = [...new Set([...section.markdown.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match => match[1]!))]
    const marketReferences = sectionReferences.filter(reference => {
      const sourceCandidateId = reference.slice(0, reference.lastIndexOf('@'))
      const source = sources.get(sourceCandidateId)
      return !!source && isMarketPriceSource(source)
    })
    const unqualifiedMarketReference = marketReferences.some(reference => {
      const source = sources.get(reference.slice(0, reference.lastIndexOf('@')))
      return !source || !isQualifiedHistoricalMarketSource(source, input.asOf)
    })
    const wrongEpsLocator = section.id === 'valuation' && containsUnqualifiedEpsClaim(section.markdown, sectionReferences, exactEps)
    const referencePeClaim = section.id === 'valuation' && hasAffirmativeReferencePeClaim(section.markdown)
    const referencePeFiscalYears = claimedEpsFiscalYears(section.markdown)
    const qualifiedEpsReferences = sectionReferences.filter(reference => exactEps.has(reference))
    const epsFiscalYearMismatch = section.id === 'valuation' && hasBasicEpsFiscalYearMismatch(section.markdown, sectionReferences, exactEps)
    const missingQualifiedEps = referencePeClaim && (referencePeFiscalYears.size === 0
      ? qualifiedEpsReferences.length === 0
      : [...referencePeFiscalYears].some(fiscalYear => !qualifiedEpsReferences.some(reference => exactEps.get(reference) === fiscalYear)))
    const missingPeMarketReference = referencePeClaim && marketReferences.length === 0
    const valuationNeedsMarketQualification = section.id === 'valuation' && marketReferences.length > 0 && unqualifiedMarketReference
    if (section.id === 'valuation' && (valuationNeedsMarketQualification || missingPeMarketReference || wrongEpsLocator || epsFiscalYearMismatch || missingQualifiedEps)) {
      entries.push({
        ownerWorkflow,
        sectionIds: [section.id],
        kind: 'inference',
        eligibility: 'blocked',
        blockers: [
          ...(valuationNeedsMarketQualification ? ['WORKFLOW_MARKET_PRICE_PIT_OR_VALUE_VERSION_UNVERIFIED'] : []),
          ...(missingPeMarketReference ? ['WORKFLOW_MARKET_PRICE_REFERENCE_REQUIRED_FOR_REFERENCE_PE'] : []),
          ...(wrongEpsLocator ? ['WORKFLOW_BASIC_EPS_LOCATOR_NOT_UNIQUE_BASIC_EPS_ROW'] : []),
          ...(epsFiscalYearMismatch ? ['WORKFLOW_BASIC_EPS_FISCAL_YEAR_MISMATCH'] : []),
          ...(missingQualifiedEps ? ['WORKFLOW_BASIC_EPS_ROW_NOT_BOUND_TO_REFERENCE_PE'] : []),
        ],
        text: `${section.title} 缺少可用于历史估值结论的结构化价格 PIT/版本证明或唯一基本 EPS 原表行；不得作为综合结论证据。`,
        evidence: [],
      })
      continue
    }
    if (unqualified) {
      entries.push({
        ownerWorkflow,
        sectionIds: [section.id],
        kind: section.id === 'bull-base-bear' ? 'assumption' : 'inference',
        eligibility: 'blocked',
        blockers: [section.id === 'variant-perception' ? 'WORKFLOW_EXPECTATION_VERSION_UNVERIFIED' : 'WORKFLOW_SECTION_HAS_EXPLICIT_GAP'],
        text: `${section.title} 未通过本轮资格门；不得作为结论或事实输入到投资论点或监控项。`,
        evidence: [],
      })
      continue
    }
    const sourceIds = new Set(section.sourceCandidateIds)
    const citationTokens = [...section.markdown.matchAll(/\[([^\]]*@[^\]]*)\]/gu)].map(match => match[1]!)
    const references = [...new Set(citationTokens.filter(reference => /^[^\s@]+@paragraph:\d+$/u.test(reference)))]
    const evidence = references.flatMap(reference => {
      const parsed = /^(.+)@paragraph:(\d+)$/u.exec(reference)
      if (!parsed) return []
      const sourceCandidateId = parsed[1]!
      if (!sourceIds.has(sourceCandidateId) || conflicted.has(sourceCandidateId) || allowed && !allowed.has(sourceCandidateId)) return []
      const source = sources.get(sourceCandidateId)
      const location = `paragraph:${parsed[2]}`
      const excerpt = source?.content.split(/\r?\n/u)[Number(parsed[2]) - 1]
      if (!source || !excerpt?.trim()) return []
      const provenance = source.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined
      return [{
        sourceCandidateId,
        contentHash: source.contentHash || createHash('sha256').update(source.content, 'utf8').digest('hex'),
        location,
        excerpt: excerpt.slice(0, 1200),
        ...(source.candidate.publishedAt ? { publishedAt: source.candidate.publishedAt } : {}),
        ...(provenance?.pointInTimeStatus !== undefined ? { pointInTimeStatus: provenance.pointInTimeStatus } : {}),
        ...(provenance?.pointInTimeSafe !== undefined ? { pointInTimeSafe: provenance.pointInTimeSafe } : {}),
      }]
    })
    if (!references.length || references.length !== new Set(citationTokens).size || evidence.length !== references.length) {
      entries.push({
        ownerWorkflow,
        sectionIds: [section.id],
        kind: section.id === 'bull-base-bear' ? 'assumption' : 'inference',
        eligibility: 'blocked',
        blockers: ['WORKFLOW_SECTION_EVIDENCE_NOT_EXACTLY_RESOLVED'],
        text: `${section.title} 的来源定位未能全部与本轮允许来源逐项匹配；不得将本节作为综合结论证据。`,
        evidence: [],
      })
      continue
    }
    entries.push({
      ownerWorkflow,
      sectionIds: [section.id],
      kind: section.id === 'bull-base-bear' ? 'assumption' : 'inference',
      eligibility: 'verified',
      text: section.markdown.slice(0, 4000),
      evidence,
    })
  }
  return entries
}

function qualifiedReferencePeThesisSentence(entry: SynthesisEvidenceLedgerEntry | undefined): string | undefined {
  if (!entry || entry.ownerWorkflow !== 'valuation' || entry.eligibility !== 'verified') return undefined
  if (!/收盘价/u.test(entry.text) || !/基本\s*EPS/u.test(entry.text) || !/参考\s*PE/iu.test(entry.text) || !/(?:不是未来盈利假设或目标价|不构成(?:预测估值|目标价))/u.test(entry.text)) return undefined
  const references = [...new Set(entry.evidence.map(reference => `${reference.sourceCandidateId}@${reference.location}`))]
  if (references.length < 2) return undefined
  return `估值含义：本轮以估值日收盘价和已披露基本 EPS 得到的参考 PE 是历史盈利倍数，不是预测估值或目标价。${references.map(reference => ` [${reference}]`).join('')}`
}

function qualifiedReferencePeMonitoringRow(entry: SynthesisEvidenceLedgerEntry | undefined): { readonly market: string; readonly eps: string } | undefined {
  if (!entry || entry.ownerWorkflow !== 'valuation' || entry.eligibility !== 'verified') return undefined
  if (!/收盘价/u.test(entry.text) || !/基本\s*EPS/u.test(entry.text) || !/参考\s*PE/iu.test(entry.text) || !/(?:不是未来盈利假设或目标价|不构成(?:预测估值|目标价))/u.test(entry.text)) return undefined
  const evidence = new Set(entry.evidence.map(reference => `${reference.sourceCandidateId}@${reference.location}`))
  const sentences = entry.text.split(/(?<=[。！？；.!?])\s*/u)
  const exactCitation = /\[([^\]\s]+@paragraph:\d+)\]/gu
  const referencesFor = (pattern: RegExp) => [...new Set(sentences.flatMap(sentence => pattern.test(sentence) ? [...sentence.matchAll(exactCitation)].map(match => match[1]!).filter(reference => evidence.has(reference)) : []))]
  const market = referencesFor(/收盘价/u)
  const eps = referencesFor(/基本\s*EPS/u)
  if (market.length !== 1 || eps.length !== 1) return undefined
  return { market: market[0]!, eps: eps[0]! }
}

function appendQualifiedReferencePeMonitoring(markdown: string, entry: SynthesisEvidenceLedgerEntry | undefined): string {
  const references = qualifiedReferencePeMonitoringRow(entry)
  if (!references) return markdown
  const refs = [...new Set([references.market, references.eps])].map(reference => `[${reference}]`).join(' ')
  const correctedLines = markdown.split(/\r?\n/u)
  const misleadingDateEquality = /报告期间与价格日期(?:保持)?一致(?:时|后)?[^。；|]*/u
  for (let index = 0; index < correctedLines.length; index++) {
    const line = correctedLines[index]!
    const cited = new Set([...line.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match => match[1]!))
    const isValuationMonitor = /(?:参考\s*PE|估值)/iu.test(line) && /(?:跟踪|观察|核对|监控)/u.test(line)
    if (!isValuationMonitor || !cited.has(references.market) || !cited.has(references.eps) || !misleadingDateEquality.test(line)) continue
    correctedLines[index] = line.replace(misleadingDateEquality, '分别核验收盘价对应的估值日期，以及基本 EPS 对应的报告期间、单位和其用于历史参考倍数的适用性；任一输入无法核实或已变化时重算并暂停沿用旧倍数')
  }
  markdown = correctedLines.join('\n')
  const qualifyingItem = markdown.split(/\r?\n/u).some(line => {
    const cells = line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split(/(?<!\\)\|/u).map(cell => cell.trim())
    const item = cells.join(' ')
    return item.includes(`[${references.market}]`) && item.includes(`[${references.eps}]`)
      && /(?:参考\s*PE|估值)/iu.test(item) && /(?:跟踪|观察|核对|监控)/u.test(item)
      && /(?:收盘价|市场价格).{0,30}估值日期|估值日期.{0,30}(?:收盘价|市场价格)/u.test(item)
      && /基本\s*EPS.{0,50}报告期间/u.test(item)
      && /基本\s*EPS.{0,50}单位/u.test(item)
      && /基本\s*EPS.{0,80}适用性/u.test(item)
      && /无法核实.{0,20}(?:已|发生)?变化/u.test(item)
      && /重算|重新计算/u.test(item)
  })
  if (qualifyingItem) return markdown
  const cells = `参考 PE 复核 | 定期报告披露与估值更新时 | 任一输入无法核实或发生变化时，重算并暂停沿用旧倍数 | 分别核验收盘价对应的估值日期，以及基本 EPS 对应的报告期间、单位和其用于历史参考倍数的适用性；输入无法核实或已变化时重算参考 PE。${refs}`
  const lines = markdown.split(/\r?\n/u)
  const expectedHeader = '| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |'
  const headerIndex = lines.findIndex(line => line.trim() === expectedHeader)
  if (headerIndex >= 0) {
    let insertionIndex = headerIndex + 1
    while (insertionIndex < lines.length && /^\s*\|/.test(lines[insertionIndex]!)) insertionIndex++
    lines.splice(insertionIndex, 0, `| ${cells} |`)
    return lines.join('\n')
  }
  return `${markdown.trimEnd()}\n- 估值口径跟踪：定期报告披露与估值更新时，分别核验收盘价对应的估值日期，以及基本 EPS 对应的报告期间、单位和其用于历史参考倍数的适用性；任一输入无法核实或已变化时重算参考 PE，并暂停沿用旧倍数。${refs}`
}

/** Link an approved, verified Base operating assumption to one falsifiable report check. */
function appendVerifiedScenarioMonitoring(markdown: string, entry: SynthesisEvidenceLedgerEntry | undefined): string {
  const marker = '情景研究假设跟踪'
  const withoutModelAuthoredItem = markdown.split(/\r?\n/u).filter(line => !line.includes(marker)).join('\n').trimEnd()
  if (!entry || entry.ownerWorkflow !== 'bull-base-bear' || entry.eligibility !== 'verified') return withoutModelAuthoredItem
  if (!entry.text.includes('独立经济理由审查状态：通过初审；最终整报告仍需独立复核。')) return withoutModelAuthoredItem
  const base = entry.text.match(/### Base\s*\/\s*基准\s*([\s\S]*?)(?=\n### |$)/u)?.[1]
  if (!base) return withoutModelAuthoredItem
  const evidence = new Map(entry.evidence.map(reference => [`${reference.sourceCandidateId}@${reference.location}`, reference]))
  for (const line of base.split(/\r?\n/u)) {
    const driver = /^-\s*(.{1,80}?)：scenarioId=base；([^\n]*)$/u.exec(line)
    if (!driver) continue
    const metric = driver[1]!.trim()
    const baseRefsField = /(?:^|；)baseSourceRefs=([^。]*)/u.exec(driver[2]!)?.[1]
    const references = [...(baseRefsField ?? '').matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match => match[1]!)
    const baseReference = references.find(candidate => evidence.has(candidate))
    const counterevidenceField = /反证与中期交叉核对（不混入年度校准）：([^。]*)/u.exec(driver[2]!)?.[1]
    const counterevidenceRefs = [...(counterevidenceField ?? '').matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match => match[1]!)
    const h1Reference = counterevidenceRefs.find(candidate => evidence.has(candidate))
    if (!metric || !baseReference || !h1Reference) continue
    const h1Excerpt = evidence.get(h1Reference)?.excerpt ?? ''
    if (!h1Excerpt.includes(metric)) continue
    const row = `| ${marker}：${metric}（研究假设，非事实/公司指引） | 每次定期报告发布时，按披露的相同期间、相同单位作同比比较 | FY2026 年报披露值低于或高于 Base 情景推算点值，即证伪年度点预测并重估；其他定期报告仅作同期间同比跟踪，不证明全年预测 | Base 推算以历史基数校准 [${baseReference}]；H1 同指标交叉核对 [${h1Reference}]，仅作中期交叉核对证据，不证明全年预测。 |`
    const lines = withoutModelAuthoredItem.split(/\r?\n/u)
    const expectedHeader = '| 指标/观察项 | 观察频率 | 触发条件/核验信号 | 论点关联与证据 |'
    let headerIndex = -1
    for (let index = 0; index < lines.length; index++) if (lines[index]!.trim() === expectedHeader) headerIndex = index
    if (headerIndex >= 0 && /^\s*\|.*\|\s*$/u.test(lines[headerIndex + 1] ?? '')) {
      let insertionIndex = headerIndex + 2
      while (insertionIndex < lines.length && /^\s*\|.*\|\s*$/u.test(lines[insertionIndex]!)) insertionIndex++
      lines.splice(insertionIndex, 0, row)
      return lines.join('\n')
    }
    return `${withoutModelAuthoredItem}\n\n${expectedHeader}\n|---|---|---|---|\n${row}`
  }
  return withoutModelAuthoredItem
}

function invalidFinalSynthesisLocator(diagnostic: string | undefined): string | undefined {
  return diagnostic?.match(/REFERENCE_ERROR: final synthesis locator unavailable: ([^;\s]+)/)?.[1]
}

/** Repair a truncated source ID only when its exact paragraph has one authorized prefix match. */
function repairUniqueTruncatedSynthesisSourceIds(markdown: string, allowedLocations: ReadonlySet<string>): { readonly markdown: string; readonly repairs: readonly string[] } {
  const repairs: string[] = []
  const repaired = markdown.replace(/\[([A-Za-z0-9_.-]+)@paragraph:(\d+)\]/g, (citation, sourceId: string, paragraph: string) => {
    const reference = `${sourceId}@paragraph:${paragraph}`
    if (allowedLocations.has(reference)) return citation
    const candidates = [...allowedLocations].filter(location => {
      const match = /^(.+)@paragraph:(\d+)$/.exec(location)
      return !!match && match[2] === paragraph && match[1]!.startsWith(sourceId) && match[1]!.length > sourceId.length
    })
    if (candidates.length !== 1) return citation
    repairs.push(`${reference} -> ${candidates[0]}`)
    return `[${candidates[0]}]`
  })
  return { markdown: repaired, repairs }
}

function sentenceContainingCitation(output: unknown, citation: string | undefined): string | undefined {
  if (!citation) return undefined
  let value = output
  if (typeof value === 'string') {
    try { value = JSON.parse(value) as unknown } catch { return undefined }
  }
  if (!value || typeof value !== 'object' || !Array.isArray((value as { sections?: unknown }).sections)) return undefined
  for (const section of (value as { sections: unknown[] }).sections) {
    if (!section || typeof section !== 'object' || typeof (section as { markdown?: unknown }).markdown !== 'string') continue
    const markdown = (section as { markdown: string }).markdown
    const at = markdown.indexOf(citation)
    if (at < 0) continue
    const boundary = /[。！？；.!?;\n]/
    let start = markdown[at - 1] === '[' ? at - 1 : at
    if (start > 0 && /[。！？；.!?;]/.test(markdown[start - 1]!)) start--
    while (start > 0 && !boundary.test(markdown[start - 1]!)) start--
    let end = at + citation.length
    while (end < markdown.length && !boundary.test(markdown[end]!)) end++
    if (end < markdown.length && /[。！？；.!?;]/.test(markdown[end]!)) end++
    return markdown.slice(start, end).trim()
  }
  return undefined
}

/** Remove a duplicate positive spread only when the cited sentence proves its signed arithmetic. */
export function normalizeCompanyRevenueCostSpreadWording(markdown: string): string {
  const formula = /成本增速高于收入\s*([\d,]+(?:\.\d+)?)\s*个百分点[^。；\n]{0,80}?([\d,]+(?:\.\d+)?)%\s*[−-]\s*([\d,]+(?:\.\d+)?)%\s*[＝=]\s*[−-]\s*([\d,]+(?:\.\d+)?)\s*个百分点/gu
  return markdown.replace(formula, (whole, statedMagnitude: string, revenueRate: string, costRate: string, formulaMagnitude: string, offset: number, source: string) => {
    const sentenceStart = Math.max(source.lastIndexOf('。', offset), source.lastIndexOf('；', offset), source.lastIndexOf('\n', offset)) + 1
    const sentenceEndCandidates = ['。', '；', '\n'].map(mark => source.indexOf(mark, offset)).filter(index => index >= 0)
    const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) : source.length
    const sentence = source.slice(sentenceStart, sentenceEnd)
    if (!/\[[A-Za-z0-9_.-]+@paragraph:\d+\]/.test(sentence)) return whole
    const stated = Number(statedMagnitude.replaceAll(',', ''))
    const revenue = Number(revenueRate.replaceAll(',', ''))
    const cost = Number(costRate.replaceAll(',', ''))
    const calculated = Number(formulaMagnitude.replaceAll(',', ''))
    if (!Number.isFinite(stated) || !Number.isFinite(revenue) || !Number.isFinite(cost) || !Number.isFinite(calculated)
      || cost <= revenue || Math.abs(stated - calculated) > 0.005 || Math.abs((cost - revenue) - calculated) > 0.005) return whole
    return whole.replace(/成本增速高于收入\s*[\d,]+(?:\.\d+)?\s*个百分点/u, '成本增速高于收入')
  })
}

export function normalizeCompanySynthesisCitations(markdown: string): string {
  const delimited = markdown.replace(/[〔【［]([^\s〔〕【】［］]+@paragraph:\d+)[〕】］]/g, '[$1]')
  // Synthesis models sometimes put exact source locators in prose-style
  // parentheses. Normalize only paragraph locators inside those delimiters;
  // the later allow-list check still rejects unsupported source/location pairs.
  const normalizeInside = (contents: string) => contents.replace(/([A-Za-z0-9_.-]+@paragraph:\d+)/g, '[$1]')
  return delimited
    .replace(/（([^（）]*@paragraph:\d+[^（）]*)）/g, (_match, contents: string) => `（${normalizeInside(contents)}）`)
    .replace(/\(([^()]*@paragraph:\d+[^()]*)\)/g, (_match, contents: string) => `(${normalizeInside(contents)})`)
}

export function validateCompanyResearchSectionTables(sections: readonly { readonly id: string; readonly markdown: string }[]): string[] {
  return sections.flatMap(section => validateCompanyResearchMarkdownTables(section.markdown).map(error => `${section.id}: ${error}`))
}

/** Repair only the known four-column monitoring-table omissions without inventing evidence. */
export function repairCompanyFinalSynthesisTable(sectionId: string, markdown: string): { readonly markdown: string; readonly repairs: readonly string[] } {
  if (sectionId !== 'monitoring-checklist') return { markdown, repairs: [] }
  const lines = markdown.split(/\r?\n/)
  const repairs: string[] = []
  // The structured-output adapter can leave a closing sentinel attached to
  // the final GFM pipe. Strip only that exact suffix before counting cells.
  for (let index = 0; index < lines.length; index++) {
    const repaired = lines[index]!.replace(/(\|)\s*<\/(?:table|markdown)>\s*$/iu, '$1')
    if (repaired !== lines[index]) {
      lines[index] = repaired
      repairs.push(`MONITORING_OUTPUT_SENTINEL_REMOVED: line ${index + 1}`)
    }
  }
  const cells = (line: string): string[] => {
    let value = line.trim()
    if (value.startsWith('|')) value = value.slice(1)
    if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)
    return value.split(/(?<!\\)\|/u).map(cell => cell.trim())
  }
  const expectedHeader = ['指标/观察项', '观察频率', '触发条件/核验信号', '论点关联与证据']
  for (let headerIndex = 0; headerIndex < lines.length; headerIndex++) {
    if (JSON.stringify(cells(lines[headerIndex]!)) !== JSON.stringify(expectedHeader)) continue
    let separatorIndex = headerIndex + 1
    while (separatorIndex < lines.length && !lines[separatorIndex]!.trim()) separatorIndex++
    if (separatorIndex >= lines.length || cells(lines[separatorIndex]!).length !== expectedHeader.length || !cells(lines[separatorIndex]!).every(cell => /^:?-{3,}:?$/u.test(cell))) continue
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && /^\s*\|/.test(lines[rowIndex]!); rowIndex++) {
      const row = cells(lines[rowIndex]!)
      if (row.length === expectedHeader.length - 1 && row[2]?.includes('@paragraph:')) {
        row.push('用于核验该观察项对报告核心论点的兑现；本格不新增事实判断。')
        lines[rowIndex] = `| ${row.join(' | ')} |`
        repairs.push(`MONITORING_ROW_FINAL_CELL_RESTORED: line ${rowIndex + 1}`)
      } else if (row.length === expectedHeader.length + 1 && row[3]?.includes('@paragraph:') && row[4]?.length && /(?:论点|核心|必要条件|检验|关联|关注|限定|支持|影响|监测|监控|跟踪|观察|核验|兑现|反证|失效|风险|判断)/u.test(row[4])) {
        // Some models emit the evidence and thesis linkage as separate cells,
        // despite the four-column contract combining them in the last column.
        // Preserve both verbatim and join only this exact, citation-backed shape.
        row.splice(3, 2, `${row[3]}；${row[4]}`)
        lines[rowIndex] = `| ${row.join(' | ')} |`
        repairs.push(`MONITORING_EVIDENCE_AND_THESIS_CELLS_MERGED: line ${rowIndex + 1}`)
      } else if (row.length === 1 && row[0] === '' && lines.slice(rowIndex + 1).every(line => !line.trim())) {
        lines.splice(rowIndex, 1)
        repairs.push(`MONITORING_ORPHAN_PIPE_REMOVED: line ${rowIndex + 1}`)
        break
      }
    }
    break
  }
  return { markdown: repairs.length ? lines.join('\n') : markdown, repairs }
}

export function repairCompanyResearchMarkdownTables(markdown: string): { readonly markdown: string; readonly repairs: readonly string[]; readonly diagnostics: readonly string[] } {
  const lines = markdown.split(/\r?\n/)
  const repairs: string[] = []
  const diagnostics: string[] = []
  // Structured-output adapters can leak an XML closing sentinel directly
  // after the final GFM table pipe. Remove only the exact trailing sentinel;
  // ordinary cell content and all other markup remain untouched.
  for (let index = 0; index < lines.length; index++) {
    const repaired = lines[index]!.replace(/(\|)\s*<\/(?:table|markdown)>\s*$/iu, '$1')
    if (repaired !== lines[index]) {
      lines[index] = repaired
      repairs.push(`TABLE_OUTPUT_SENTINEL_REMOVED: line ${index + 1}`)
    }
  }
  const splitCells = (line: string): string[] => {
    let value = line.trim()
    if (value.startsWith('|')) value = value.slice(1)
    if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1)
    const values: string[] = []
    let cell = ''
    for (let index = 0; index < value.length; index++) {
      const char = value[index]!
      if (char === '|' && value[index - 1] !== '\\') { values.push(cell.trim()); cell = '' }
      else cell += char
    }
    values.push(cell.trim())
    return values
  }
  const renderRow = (values: readonly string[]): string => `| ${values.join(' | ')} |`
  const separator = (width: number): string => `| ${Array.from({ length: width }, () => '---').join(' | ')} |`
  const isPipeLine = (line: string): boolean => line.includes('|') && !/^\s*```/.test(line)
  const isSeparator = (line: string): boolean => isPipeLine(line) && splitCells(line).every(value => /^:?-{3,}:?$/.test(value))
  // Some synthesis responses concatenate complete table rows on one physical
  // line using the exact `| |` row boundary. Recover them only when an
  // adjacent header and separator establish the width, every split piece has
  // that width, and the reconstructed table passes the normal validator.
  // A Markdown heading fused into the last cell is detached only when it
  // begins a complete heading token after non-empty cell text.
  for (let separatorIndex = 1; separatorIndex + 1 < lines.length; separatorIndex++) {
    const headerIndex = separatorIndex - 1
    const header = lines[headerIndex]!
    const rule = lines[separatorIndex]!
    const width = splitCells(header).length
    if (!isPipeLine(header) || isSeparator(header) || !isSeparator(rule)
      || splitCells(rule).length !== width || width < 2) continue
    let rowIndex = separatorIndex + 1
    for (; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
      const physicalLine = lines[rowIndex]!
      if (!/\|\s+\|/u.test(physicalLine)) continue
      const pieces = physicalLine.split(/\|\s+\|/u)
      if (pieces.length < 2) continue
      const rows: string[][] = []
      let headingTail = ''
      let valid = true
      for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex++) {
        let piece = pieces[pieceIndex]!
        if (pieceIndex === pieces.length - 1) {
          const trailingHeading = piece.match(/(\|)\s+(#{1,6}\s+[^|]+)$/u)
          if (trailingHeading) {
            piece = piece.slice(0, trailingHeading.index! + trailingHeading[1]!.length)
            headingTail = trailingHeading[2]!
          }
        }
        const cells = splitCells(piece)
        if (cells.length !== width) { valid = false; break }
        if (pieceIndex === pieces.length - 1 && !headingTail) {
          const finalCell = cells[width - 1]!
          const heading = finalCell.match(/^(.*?)\s+(#{1,6}\s+.+)$/u)
          if (heading && heading[1]!.trim()) {
            cells[width - 1] = heading[1]!.trimEnd()
            headingTail = heading[2]!
          }
        }
        rows.push(cells)
      }
      if (!valid || rows.length < 2) continue
      const candidateTable = [header, rule, ...rows.map(renderRow)].join('\n')
      if (validateCompanyResearchMarkdownTables(candidateTable).length) continue
      lines.splice(rowIndex, 1, ...rows.map(renderRow), ...(headingTail ? [headingTail] : []))
      repairs.push(`TABLE_CONCATENATED_ROWS_SPLIT: line ${rowIndex + 1}; rows ${rows.length}${headingTail ? '; heading detached' : ''}`)
      rowIndex += rows.length - 1 + (headingTail ? 1 : 0)
    }
  }
  // The market-structure matrix occasionally emits this exact one-cell PCB
  // label before a complete four-column row. Preserve the label as prose so
  // it cannot be mistaken for a table row with three silently missing cells.
  for (let separatorIndex = 1; separatorIndex + 2 < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!) || splitCells(lines[separatorIndex]!).length !== 4) continue
    let headerIndex = separatorIndex - 1
    while (headerIndex >= 0 && !lines[headerIndex]!.trim()) headerIndex--
    if (headerIndex < 0 || splitCells(lines[headerIndex]!).join('|') !== '市场|产品边界与排除项|地域、客户与时间边界|产业链位置与需求因素') continue
    const orphan = splitCells(lines[separatorIndex + 1]!)
    if (!isPipeLine(lines[separatorIndex + 1]!) || isSeparator(lines[separatorIndex + 1]!) || orphan.length !== 1 || orphan[0] !== 'PCB/电子电路') continue
    const next = lines[separatorIndex + 2]!
    if (!isPipeLine(next) || isSeparator(next) || splitCells(next).length !== 4) continue
    lines.splice(separatorIndex + 1, 1)
    lines.splice(headerIndex, 0, 'PCB/电子电路', '')
    repairs.push(`TABLE_MARKET_MATRIX_ORPHAN_LABEL_MOVED_TO_PROSE: line ${separatorIndex + 2}`)
  }
  // A financial table can be fused onto the previous data row as exactly
  // seven valid data cells, one cited explanatory cell, and seven cells for
  // the next financial header. Detach only when both table widths, numeric
  // row shape, header labels, following separator/data row, and locator syntax
  // all agree. This keeps the explanatory paragraph and every citation.
  const financialColumns = [
    '营业收入（元）', '营业成本（元）', '毛利率',
    '营业收入比上年同期增减', '营业成本比上年同期增减', '毛利率比上年同期增减',
  ]
  const amountCell = /^[\d,]+(?:\.\d+)?$/u
  const percentCell = /^-?\d+(?:\.\d+)?%$/u
  const locatedCitations = (value: string): string[] => [...value.matchAll(/\[([A-Za-z0-9._:-]+@paragraph:\d+)\]/gu)].map(match => match[1]!)
  for (let rowIndex = 0; rowIndex + 2 < lines.length; rowIndex++) {
    const cells = splitCells(lines[rowIndex]!)
    if (cells.length !== 15 || !isSeparator(lines[rowIndex + 1]!) || splitCells(lines[rowIndex + 1]!).length !== 7) continue
    const data = cells.slice(0, 7)
    const note = cells[7]!
    const nextHeader = cells.slice(8)
    if (!/^20\d{2}(?:年度|年上半年)分(?:行业|产品)分类$/u.test(nextHeader[0]!)
      || JSON.stringify(nextHeader.slice(1)) !== JSON.stringify(financialColumns)) continue
    const finalPercent = data[6]!.replace(/\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu, '').trim()
    if (!data[0] || !amountCell.test(data[1]!) || !amountCell.test(data[2]!)
      || !data.slice(3, 6).every(value => percentCell.test(value!)) || !percentCell.test(finalPercent)) continue
    const rowCitations = locatedCitations(data[6]!)
    const noteCitations = locatedCitations(note)
    const noteText = note.replace(/\[[A-Za-z0-9._:-]+@paragraph:\d+\]/gu, '').trim()
    const followingRows: string[][] = []
    for (let index = rowIndex + 2; index < lines.length && isPipeLine(lines[index]!) && !isSeparator(lines[index]!); index++) {
      const followingCells = splitCells(lines[index]!)
      if (followingCells.length !== 7) break
      followingRows.push(followingCells)
    }
    const adjacentSourceIds = [...rowCitations, ...followingRows.flatMap(row => locatedCitations(row[6]!))].map(citation => citation.split('@')[0])
    if (!rowCitations.length || !noteCitations.length || /@paragraph|\[[^\]]+\]/u.test(noteText)
      || !/(?:表头|标签|匹配数据)/u.test(noteText)
      || !/(?:营业收入|营业成本|毛利率|同比变化|列示|匹配数据)/u.test(noteText)
      || !noteCitations.some(citation => adjacentSourceIds.includes(citation.split('@')[0]))) continue
    if (!followingRows.length || !followingRows.some(row => row[0] && locatedCitations(row[6]!).length > 0)) continue
    lines.splice(rowIndex, 1, renderRow(data), noteText + ' ' + noteCitations.map(citation => `[${citation}]`).join(' '), renderRow(nextHeader))
    repairs.push(`TABLE_FINANCIAL_HEADER_DETACHED_FROM_PRIOR_ROW: line ${rowIndex + 1}; header ${nextHeader[0]}`)
    rowIndex += 2
  }
  // The industry method can emit the adjacent-market table header before its
  // boundary explanation, then place the separator and rows after a subsection
  // heading. Reattach only this exact four-column header when the intervening
  // block contains no other table and the later table has multiple cited rows.
  // Narrative and citations stay in place; only the header line moves.
  const adjacentMarketHeaders = [
    { cells: ['市场边界', '预测期间', '规模与单位', '预测机构及来源归属'], citationMode: 'row' },
    // 2026 H1 company reports sometimes use this market-size header while
    // retaining a later, detached four-column table in the industry section.
    { cells: ['市场边界', '期间', '规模与单位', '来源及转述归属'], citationMode: 'row' },
    { cells: ['市场边界', '期间', '数值及单位', '来源与可比边界'], citationMode: 'following-paragraph' },
    // BYD's synthesis sometimes includes a fifth comparability column while
    // placing the separator and cited market rows after the boundary note.
    { cells: ['市场边界', '期间', '规模与单位', '来源及转述归属', '可比性说明'], citationMode: 'row' },
    { cells: ['市场边界', '期间', '规模与单位', '来源及转述归属', '适用范围与限制'], citationMode: 'row' },
    // A BYD run used a company-named TAM relation as the fifth column. The
    // rest of this header is stable; recognize the company-specific label
    // only when the following rows independently prove the same table width.
    { cells: ['市场边界', '期间', '规模与单位', '来源及转述归属', '__COMPANY_TAM_RELATION__'], citationMode: 'row' },
    // One live BYD synthesis used this slightly more descriptive first label.
    { cells: ['市场边界与统计性质', '期间', '数值及单位', '来源与可比边界'], citationMode: 'following-paragraph' },
  ] as const
  for (const { cells: expectedHeader, citationMode } of adjacentMarketHeaders) {
    const headerIndexes = lines.flatMap((line, index) => {
      if (!isPipeLine(line)) return []
      const actual = splitCells(line)
      const companyTamHeader = expectedHeader.at(-1) === '__COMPANY_TAM_RELATION__'
        && actual.length === 5
        && actual.slice(0, 4).every((cell, cellIndex) => cell === expectedHeader[cellIndex])
        && /(?:TAM|可服务市场)/u.test(actual[4]!)
      return JSON.stringify(actual) === JSON.stringify(expectedHeader) || companyTamHeader ? [index] : []
    })
    if (headerIndexes.length !== 1) continue
    const headerIndex = headerIndexes[0]!
    let separatorIndex = -1
    for (let index = headerIndex + 1; index < lines.length; index++) {
      if (isSeparator(lines[index]!) && splitCells(lines[index]!).length === expectedHeader.length) {
        separatorIndex = index
        break
      }
      if (isSeparator(lines[index]!)) break
    }
    if (separatorIndex <= headerIndex) continue
    const rowIndexes: number[] = []
    for (let index = separatorIndex + 1; index < lines.length && isPipeLine(lines[index]!) && !isSeparator(lines[index]!); index++) {
      if (splitCells(lines[index]!).length !== expectedHeader.length) break
      rowIndexes.push(index)
    }
    const rowsAreMarketLabeled = rowIndexes.length >= (citationMode === 'following-paragraph' ? 3 : 2) && rowIndexes.every(index => {
      const row = splitCells(lines[index]!)
      return /(?:市場|市场|液冷|服务器|新能源)/u.test(row[0]!) && row[1]!.length > 0 && row[2]!.length > 0 && row[3]!.length > 0
    })
    const rowsHaveDirectCitations = citationMode === 'row' && rowIndexes.every(index =>
      /\[[^\]\s]+@paragraph:\d+\]/u.test(splitCells(lines[index]!)[3]!))
    const trailingCitationParagraph = rowIndexes.length ? lines[rowIndexes.at(-1)! + 1] ?? '' : ''
    const followingCitationsSupportRows = citationMode === 'following-paragraph'
      && ['18', '448', '450'].every(paragraph => new RegExp(`@paragraph:${paragraph}(?:\\]|\\b)`, 'u').test(trailingCitationParagraph))
    const interveningLinesAreNarrative = lines.slice(headerIndex + 1, separatorIndex).every(line => !isPipeLine(line) || /^\s*#{1,6}\s/u.test(line))
    if (rowsAreMarketLabeled && (rowsHaveDirectCitations || followingCitationsSupportRows) && interveningLinesAreNarrative) {
      const [header] = lines.splice(headerIndex, 1)
      lines.splice(separatorIndex - 1, 0, header!)
      repairs.push(`TABLE_ADJACENT_MARKET_HEADER_REATTACHED: line ${headerIndex + 1}; rows ${rowIndexes.length}`)
      break
    }
  }
  // A three-column market-size table may place its exact header before the
  // explanatory paragraph and section heading, then emit the separator and
  // cited rows afterward. Move only that unique header when every data row
  // has the same width, a market label, and its own source locator.
  const marketSizeHeader = ['市场边界', '规模/预测期间', '机构、转述归属及适用限制']
  const marketSizeHeaderIndexes = lines.flatMap((line, index) =>
    isPipeLine(line) && JSON.stringify(splitCells(line)) === JSON.stringify(marketSizeHeader) ? [index] : [])
  if (marketSizeHeaderIndexes.length === 1) {
    const headerIndex = marketSizeHeaderIndexes[0]!
    let separatorIndex = -1
    for (let index = headerIndex + 1; index < lines.length; index++) {
      if (isSeparator(lines[index]!) && splitCells(lines[index]!).length === marketSizeHeader.length) {
        separatorIndex = index
        break
      }
      if (isSeparator(lines[index]!)) break
    }
    const rowIndexes: number[] = []
    if (separatorIndex > headerIndex) {
      for (let index = separatorIndex + 1; index < lines.length && isPipeLine(lines[index]!) && !isSeparator(lines[index]!); index++) {
        if (splitCells(lines[index]!).length !== marketSizeHeader.length) break
        rowIndexes.push(index)
      }
    }
    const rowsSupported = rowIndexes.length >= 2 && rowIndexes.every(index => {
      const row = splitCells(lines[index]!)
      return /(?:全球|中国|市场)/u.test(row[0]!) && row[1]!.length > 0 && /\[[^\]\s]+@paragraph:\d+\]/u.test(row[2]!)
    })
    const interveningIsNarrative = separatorIndex > headerIndex
      && lines.slice(headerIndex + 1, separatorIndex).every(line => !isPipeLine(line))
    if (rowsSupported && interveningIsNarrative) {
      const [header] = lines.splice(headerIndex, 1)
      lines.splice(separatorIndex - 1, 0, header!)
      repairs.push(`TABLE_MARKET_SIZE_HEADER_REATTACHED: line ${headerIndex + 1}; rows ${rowIndexes.length}`)
    }
  }
  // R170's product profitability table fused its plain header into an
  // explanatory paragraph and serialized each row's three figures into one
  // semicolon-delimited cell. Repair only this strongly identified shape:
  // exact business-model header, matching four-column separator, at least two
  // labeled product rows, and three parseable values plus located citations.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!) || splitCells(lines[separatorIndex]!).length !== 4) continue
    const priorIndex = separatorIndex - 1
    const prior = lines[priorIndex]!
    const headerMatch = /(?:^|\s)(产品分类\s+营业收入（元）\s+营业成本（元）\s+毛利率)\s*$/u.exec(prior)
    if (!headerMatch) continue
    const rowIndexes: number[] = []
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) rowIndexes.push(rowIndex)
    if (rowIndexes.length < 2) continue
    const parsedRows = rowIndexes.map(rowIndex => {
      const values = splitCells(lines[rowIndex]!)
      if (values.length < 2 || values.length > 3 || !values[0]!.trim()) return undefined
      const numeric = /^\s*([\d,]+(?:\.\d+)?)\s*[；;]\s*([\d,]+(?:\.\d+)?)\s*[；;]\s*([\d.]+[%％])((?:\s*\[[^\]\s]+@paragraph:\d+\])*)\s*$/u.exec(values[1]!)
      if (!numeric || !numeric[4]?.trim()) return undefined
      return { index: rowIndex, label: values[0]!, revenue: numeric[1]!, cost: numeric[2]!, margin: numeric[3]!, citations: numeric[4]!.trim(), narrative: values[2]?.trim() }
    })
    if (parsedRows.some(row => !row)) continue
    const body = prior.slice(0, headerMatch.index).trimEnd()
    lines[priorIndex] = body
    lines.splice(separatorIndex, 0, renderRow(['产品分类', '营业收入（元）', '营业成本（元）', '毛利率']))
    const shiftedSeparator = separatorIndex + 1
    const narrative: string[] = []
    for (const row of parsedRows as NonNullable<typeof parsedRows[number]>[]) {
      lines[row.index + 1] = renderRow([row.label, row.revenue, row.cost, `${row.margin} ${row.citations}`])
      if (row.narrative) narrative.push(row.narrative)
    }
    if (narrative.length) lines.splice(rowIndexes.at(-1)! + 2, 0, ...narrative)
    repairs.push(`TABLE_PRODUCT_MARGIN_HEADER_AND_VALUES_RESTORED: line ${priorIndex + 1}; rows ${rowIndexes.length}`)
    separatorIndex = shiftedSeparator + rowIndexes.length + narrative.length
  }

  // The R170 capital-allocation synthesis omitted one pipe after putting the
  // full R&D details in the first cell. Split at the explicit first financial
  // detail marker only when the table header and peer row widths establish the
  // intended three-column ledger.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!) || splitCells(lines[separatorIndex]!).length !== 3) continue
    const headerIndex = separatorIndex - 1
    if (!/^\s*\|\s*行动及目的\s*\|\s*金额、期间与状态\s*\|\s*资金来源及结果\s*\|\s*$/u.test(lines[headerIndex]!)) continue
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
      const values = splitCells(lines[rowIndex]!)
      if (values.length !== 2 || !/^研发：/.test(values[0]!)) continue
      const marker = '；年度研发投入金额分别为'
      const splitAt = values[0]!.indexOf(marker)
      if (splitAt < 0 || !/\[[^\]\s]+@paragraph:\d+\]/u.test(values[0]!.slice(splitAt))) continue
      const purpose = values[0]!.slice(0, splitAt).trim()
      const detail = values[0]!.slice(splitAt + 1).trim()
      lines[rowIndex] = renderRow([purpose, detail, values[1]!])
      repairs.push(`TABLE_R_AND_D_LEDGER_COLUMN_RESTORED: line ${rowIndex + 1}`)
    }
  }
  const narrativeTail = (text: string): boolean => text.length >= 18 && (/[。；！？.!?]/u.test(text) || /(?:不能|因此|同时|公司|报告|材料|说明|显示|影响|不等于|缺少|未提供)/u.test(text))
  const detachPrefix = (prefix: string): string[] => {
    const headingPattern = /(^|\s)(#{1,6})\s+([^\s#|]+)(?=\s|$)/gu
    const matches = [...prefix.matchAll(headingPattern)]
    if (!matches.length) return [prefix.trim()].filter(Boolean)
    const output: string[] = []
    let cursor = 0
    for (const match of matches) {
      const markerStart = match.index! + match[1]!.length
      const between = prefix.slice(cursor, markerStart).trim()
      if (between) output.push(between)
      output.push(`${match[2]} ${match[3]}`)
      cursor = markerStart + match[2]!.length + 1 + match[3]!.length
    }
    const tail = prefix.slice(cursor).trim()
    if (tail) output.push(tail)
    return output
  }
  const splitAtHeading = (text: string): { readonly before: string; readonly after: string } | undefined => {
    const match = /(^|\s)(#{1,6})\s+([^\s#|]+)(?=\s|$)/u.exec(text)
    if (!match) return undefined
    const markerStart = match.index + match[1]!.length
    return { before: text.slice(0, markerStart).trim(), after: text.slice(markerStart).trim() }
  }

  // A synthesis can fuse an explanatory paragraph into the first table cell,
  // then append prose to the last cell of each row. Repair only when the
  // separator establishes a width W, the header has exactly one prose prefix
  // plus W cells, and every following row has exactly W data cells plus a
  // prose tail. This keeps ordinary over-wide tables fail-closed.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    const width = splitCells(lines[separatorIndex]!).length
    const headerIndex = separatorIndex - 1
    if (!isPipeLine(lines[headerIndex]!)) continue
    const header = splitCells(lines[headerIndex]!)
    if (header.length !== width + 1 || !narrativeTail(header[0]!) || header.slice(1).some(cell => !cell || /^#{1,6}\s/u.test(cell))) continue
    const rowIndexes: number[] = []
    const rows: string[][] = []
    let hasProseOverflow = false
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!); rowIndex++) {
      if (isSeparator(lines[rowIndex]!)) break
      const row = splitCells(lines[rowIndex]!)
      const overflow = row.length === width + 1 ? row.at(-1) ?? '' : ''
      if ((row.length !== width && row.length !== width + 1)
        || (row.length === width + 1 && !narrativeTail(overflow) && !/^#{1,6}\s/u.test(overflow))
        || row.slice(0, width).some(cell => /^#{1,6}\s/u.test(cell))) {
        rowIndexes.length = 0
        break
      }
      hasProseOverflow ||= row.length === width + 1
      rowIndexes.push(rowIndex)
      rows.push(row)
    }
    if (!rowIndexes.length || !hasProseOverflow) continue
    const insertions: string[] = [...detachPrefix(header[0]!), renderRow(header.slice(1)), lines[separatorIndex]!]
    for (const row of rows) {
      insertions.push(renderRow(row.slice(0, width)))
      if (row.length === width + 1) insertions.push(...detachPrefix(row.at(-1)!))
    }
    const lastRowIndex = rowIndexes.at(-1)!
    lines.splice(headerIndex, lastRowIndex - headerIndex + 1, ...insertions)
    repairs.push(`TABLE_PROSE_CELL_TAILS_DETACHED: line ${headerIndex + 1}; width ${width}; rows ${rows.length}`)
    separatorIndex = headerIndex + insertions.length - 1
  }

  // R138 fused a section's leading heading/narrative into the first table
  // cell. Detach exactly one leading prefix only when the remaining header
  // width equals both the separator and the modal data-row width.
  for (let index = 1; index < lines.length; index++) {
    if (!isSeparator(lines[index]!)) continue
    const headerIndex = index - 1
    if (!isPipeLine(lines[headerIndex]!)) continue
    const headerCells = splitCells(lines[headerIndex]!)
    const separatorWidth = splitCells(lines[index]!).length
    const trailingCitations = headerCells.at(-1) ?? ''
    if (headerCells.length === separatorWidth + 2 && /^#{1,6}\s/u.test(headerCells[0]!)
      && /^(?:\[[A-Za-z0-9._:-]+@paragraph:\d+\]\s*)+$/u.test(trailingCitations)) {
      const rowWidths: number[] = []
      for (let rowIndex = index + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) rowWidths.push(splitCells(lines[rowIndex]!).length)
      const counts = new Map<number, number>()
      for (const width of rowWidths) counts.set(width, (counts.get(width) ?? 0) + 1)
      const modes = [...counts].sort((left, right) => right[1] - left[1])
      if (modes.length && modes[0]![0] === separatorWidth && (!modes[1] || modes[0]![1] > modes[1][1])) {
        const preamble = detachPrefix(`${headerCells[0]} ${trailingCitations}`)
        lines.splice(headerIndex, 1, ...preamble, renderRow(headerCells.slice(1, -1)))
        repairs.push(`TABLE_LEADING_PREFIX_AND_CITATION_DETACHED: line ${headerIndex + 1}; ${headerCells.length}->${separatorWidth}`)
        index += preamble.length
        continue
      }
    }
    if (headerCells.length !== separatorWidth + 1 || !headerCells[0]) continue
    const rowWidths: number[] = []
    for (let rowIndex = index + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) rowWidths.push(splitCells(lines[rowIndex]!).length)
    const counts = new Map<number, number>()
    for (const width of rowWidths) counts.set(width, (counts.get(width) ?? 0) + 1)
    const modes = [...counts].sort((left, right) => right[1] - left[1])
    const headingPrefixProvesFusion = /^#{1,6}\s/u.test(headerCells[0]!)
    if ((!modes.length || modes[0]![0] !== separatorWidth || (modes[1] && modes[0]![1] === modes[1][1])) && !headingPrefixProvesFusion) continue
    const prefix = detachPrefix(headerCells[0]!)
    lines.splice(headerIndex, 1, ...prefix, renderRow(headerCells.slice(1)))
    repairs.push(`TABLE_LEADING_PREFIX_DETACHED: line ${headerIndex + 1}; ${headerCells.length}->${separatorWidth}`)
    index += prefix.length
  }

  // A trailing data row can absorb both an explanatory paragraph and the
  // header of a following table. Split it only when the preceding separator
  // establishes the row's width and the next separator plus modal rows prove
  // the exact width of the following table.
  for (let boundaryIndex = 1; boundaryIndex < lines.length; boundaryIndex++) {
    if (!isSeparator(lines[boundaryIndex]!)) continue
    const rowIndex = boundaryIndex - 1
    if (!isPipeLine(lines[rowIndex]!) || isSeparator(lines[rowIndex]!)) continue
    let priorSeparator = rowIndex - 1
    while (priorSeparator >= 0 && !isSeparator(lines[priorSeparator]!)) priorSeparator--
    if (priorSeparator < 0) continue
    const baseWidth = splitCells(lines[priorSeparator]!).length
    const followingWidth = splitCells(lines[boundaryIndex]!).length
    const values = splitCells(lines[rowIndex]!)
    const hasSeparatePreamble = values.length === baseWidth + followingWidth + 1
    const embeddedHeading = values.length === baseWidth + followingWidth ? splitAtHeading(values[baseWidth - 1] ?? '') : undefined
    if (!hasSeparatePreamble && !embeddedHeading) continue
    const interveningRows = lines.slice(priorSeparator + 1, rowIndex)
    if (!interveningRows.length || interveningRows.some(line => !isPipeLine(line) || isSeparator(line))) continue
    const prefix = values.slice(0, baseWidth)
    const overflow = values.slice(baseWidth)
    if (prefix.length !== baseWidth || (hasSeparatePreamble && prefix.some(cell => /^#{1,6}\s/u.test(cell)))) continue
    let detachedProse: string[]
    let nextHeader: string[]
    if (hasSeparatePreamble) {
      // A fused following-table header can begin with an empty cell when the
      // model emits a blank leading column. Treat it as a header defect only
      // when removing the blank yields exactly the width proven by the next
      // separator; all other empty overflows remain ambiguous and fail closed.
      const emptyLeadingHeader = overflow[0] === '' && overflow.length === followingWidth + 1
        && overflow.slice(1).length === followingWidth && overflow.slice(1).every(Boolean)
      if (emptyLeadingHeader) {
        detachedProse = []
        nextHeader = overflow.slice(1)
      } else {
        if (!overflow[0] || (!narrativeTail(overflow[0]) && !/#{1,6}\s/u.test(overflow[0]))) continue
        detachedProse = detachPrefix(overflow[0]!)
        nextHeader = overflow.slice(1)
      }
    } else {
      if (!embeddedHeading?.before || prefix.slice(0, -1).some(cell => /^#{1,6}\s/u.test(cell))) continue
      prefix[baseWidth - 1] = embeddedHeading.before
      detachedProse = detachPrefix(embeddedHeading.after)
      nextHeader = overflow
    }
    if (nextHeader.length !== followingWidth || nextHeader.some(cell => /^#{1,6}\s/u.test(cell))) continue
    const followingRows: string[][] = []
    for (let index = boundaryIndex + 1; index < lines.length && isPipeLine(lines[index]!) && !isSeparator(lines[index]!); index++) followingRows.push(splitCells(lines[index]!))
    const finalFollowingCell = followingRows.at(-1)?.at(-1) ?? ''
    const finalFollowingTailIsProse = /^#{1,6}\s/u.test(finalFollowingCell) || narrativeTail(finalFollowingCell)
    const followingRowsAreProven = followingRows.length > 0 && followingRows.every((cells, index) => {
      if (cells.length === followingWidth) return true
      if (cells.length !== followingWidth + 1) return false
      const overflow = cells.at(-1) ?? ''
      const standaloneLocators = /^(?:\[[A-Za-z0-9._:-]+@paragraph:\d+\]\s*)+$/u.test(overflow)
      return standaloneLocators || (index === followingRows.length - 1 && finalFollowingTailIsProse)
    })
    if (!followingRowsAreProven) continue
    const inserted = [...detachedProse, ...(detachedProse.length ? [] : ['']), renderRow(nextHeader)]
    lines.splice(rowIndex, 1, renderRow(prefix), ...inserted)
    repairs.push(`TABLE_FOLLOWING_TABLE_DETACHED: line ${rowIndex + 1}; ${baseWidth}+${followingWidth}`)
    boundaryIndex += inserted.length
  }

  // A standalone table header can be separated from its separator by a short
  // explanatory paragraph. Reattach it only when the following separator and
  // every data row prove the same table width.
  // The business-model table's exact four-column header is also emitted with
  // cited explanatory prose between the header and separator. Keep that prose
  // intact, but move it after the table only when the complete table shape is
  // proven by a matching separator and consistently sized body rows.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!) || splitCells(lines[separatorIndex]!).length !== 4) continue
    let headerIndex = separatorIndex - 1
    while (headerIndex >= 0 && !isPipeLine(lines[headerIndex]!)) headerIndex--
    if (headerIndex < 0 || isSeparator(lines[headerIndex]!)) continue
    const expected = ['产品/业务', '客户类型与购买决策', '定价、交付与收入机制', '成本及利润观察']
    if (JSON.stringify(splitCells(lines[headerIndex]!)) !== JSON.stringify(expected)) continue
    const intervening = lines.slice(headerIndex + 1, separatorIndex)
    if (!intervening.some(line => line.trim()) || intervening.some(line => isPipeLine(line))) continue
    const rowIndexes: number[] = []
    let malformedBodyRow = false
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
      if (splitCells(lines[rowIndex]!).length !== 4) { malformedBodyRow = true; break }
      rowIndexes.push(rowIndex)
    }
    if (!rowIndexes.length || malformedBodyRow) continue
    const prose = lines.splice(headerIndex + 1, separatorIndex - headerIndex - 1)
    const insertAt = rowIndexes.at(-1)! + 1 - prose.length
    lines.splice(insertAt, 0, ...prose)
    repairs.push(`TABLE_BUSINESS_MODEL_NARRATIVE_MOVED_AFTER_TABLE: line ${headerIndex + 2}; rows ${rowIndexes.length}`)
    separatorIndex = insertAt + prose.length
  }

  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    const width = splitCells(lines[separatorIndex]!).length
    const rowWidths: number[] = []
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
      rowWidths.push(splitCells(lines[rowIndex]!).length)
    }
    if (!rowWidths.length || rowWidths.some(rowWidth => rowWidth !== width)) continue
    let headerIndex = separatorIndex - 1
    while (headerIndex >= 0 && !isPipeLine(lines[headerIndex]!)) headerIndex--
    if (headerIndex < 0 || !isPipeLine(lines[headerIndex]!) || isSeparator(lines[headerIndex]!)) continue
    const headerCells = splitCells(lines[headerIndex]!)
    if (headerCells.length !== width || !/^20\d{2}年度地区(?:（金额单位：元）)?$/u.test(headerCells[0]!)
      || headerCells[1] !== '营业收入' || headerCells[2] !== '占营业收入比重') continue
    const intervening = lines.slice(headerIndex + 1, separatorIndex)
    if (!intervening.some(line => line.trim()) || intervening.some(isPipeLine)) continue
    const [header] = lines.splice(headerIndex, 1)
    lines.splice(separatorIndex - 1, 0, header!)
    repairs.push(`TABLE_HEADER_REATTACHED_AFTER_INTERVENING_PROSE: line ${headerIndex + 1}->${separatorIndex}`)
    separatorIndex++
  }

  // Dongshan's business-model synthesis can leave the exact header for the
  // region/sales-mode table after the preceding product table, while its
  // three fully cited rows appear below intervening prose and a subsection
  // heading. Move only that unique header to the uniquely matching 3-column
  // body; do not infer or alter any cell values or citations.
  const disclosureDimensionHeader = ['2025年披露维度', '金额（人民币元）', '占营业收入比重']
  const disclosureHeaderIndexes = lines.flatMap((line, index) =>
    isPipeLine(line) && JSON.stringify(splitCells(line)) === JSON.stringify(disclosureDimensionHeader) ? [index] : [])
  if (disclosureHeaderIndexes.length === 1) {
    const headerIndex = disclosureHeaderIndexes[0]!
    const separatorIndexes: number[] = []
    for (let index = headerIndex + 1; index < lines.length; index++) {
      if (isSeparator(lines[index]!) && splitCells(lines[index]!).length === disclosureDimensionHeader.length) separatorIndexes.push(index)
    }
    const matchingTables = separatorIndexes.flatMap(separatorIndex => {
      const rows: string[][] = []
      for (let index = separatorIndex + 1; index < lines.length && isPipeLine(lines[index]!) && !isSeparator(lines[index]!); index++) {
        const row = splitCells(lines[index]!)
        if (row.length !== disclosureDimensionHeader.length) break
        rows.push(row)
      }
      const labels = rows.map(row => row[0]!.trim())
      const exactDisclosureRows = labels.length === 3
        && ['地区：内销', '地区：外销', '销售模式：直销'].every(label => labels.filter(value => value === label).length === 1)
      const rowsHaveExactLocators = rows.every(row => /\[[^\]\s]+@paragraph:\d+\]/u.test(row[2]!))
      const sameBusinessModelSection = (() => {
        let sectionStart = -1
        for (let index = 0; index < headerIndex; index++) if (/^##\s+商业模式\s*$/u.test(lines[index]!)) sectionStart = index
        const nextSection = lines.findIndex((line, index) => index > separatorIndex && /^##\s+/u.test(line))
        return sectionStart >= 0 && sectionStart < headerIndex && (nextSection < 0 || nextSection > separatorIndex)
      })()
      const interveningLinesAreNarrative = lines.slice(headerIndex + 1, separatorIndex).every(line => !isPipeLine(line))
      return exactDisclosureRows && rowsHaveExactLocators && sameBusinessModelSection && interveningLinesAreNarrative
        ? [{ separatorIndex }]
        : []
    })
    if (matchingTables.length === 1) {
      const { separatorIndex } = matchingTables[0]!
      const [header] = lines.splice(headerIndex, 1)
      lines.splice(separatorIndex - 1, 0, header!)
      repairs.push(`TABLE_BUSINESS_MODEL_DISCLOSURE_HEADER_REATTACHED: line ${headerIndex + 1}->${separatorIndex}`)
    }
  }

  // A report paragraph can carry a pipe-delimited header at its end while
  // its separator and data rows appear after explanatory prose. Relocate the
  // header only when its exact cell count and the following data widths agree.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    let previous = separatorIndex - 1
    while (previous >= 0 && !lines[previous]!.trim()) previous--
    if (previous < 0) continue
    const width = splitCells(lines[separatorIndex]!).length
    const rowWidths: number[] = []
    const rowShapes: string[][] = []
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
      const row = splitCells(lines[rowIndex]!)
      rowWidths.push(row.length)
      rowShapes.push(row)
    }
    if (!rowWidths.length || rowWidths.some(rowWidth => rowWidth !== width)) continue
    const candidates: Array<{ index: number; prefix: string; header: string[] }> = []
    for (let candidateIndex = previous; candidateIndex >= 0 && !isSeparator(lines[candidateIndex]!); candidateIndex--) {
      const line = lines[candidateIndex]!
      // A complete table row can contain enough trailing pipe-delimited cells
      // to resemble the header for a later table. Never split a candidate
      // whose prefix is itself a pipe row; doing so drops valid source cells.
      // Preserve the exact fused locator-header case for the narrow repair at
      // the end of this pipeline; treating its seven-column prefix as an
      // embedded header corrupts the source row before it can be split.
      if (line.includes(' | | 报告及单位 | 完整分类表头定位 |')) continue
      for (let delimiter = 1; delimiter < line.length; delimiter++) {
        if (line[delimiter] !== '|') continue
        const prefix = line.slice(0, delimiter).trim()
        const headerLine = line.slice(delimiter).trim()
        if (!prefix || /^\s*\|/u.test(prefix) || !headerLine.endsWith('|')) continue
        const header = splitCells(headerLine)
        if (header.length !== width || header.some(cell => !cell || /^#{1,6}\s/u.test(cell))) continue
        candidates.push({ index: candidateIndex, prefix, header })
        break
      }
    }
    if (candidates.length !== 1) continue
    const candidate = candidates[0]!
    lines[candidate.index] = candidate.prefix
    lines.splice(separatorIndex, 0, renderRow(candidate.header))
    repairs.push(`TABLE_EMBEDDED_HEADER_MOVED: line ${candidate.index + 1}->${separatorIndex + 1}`)
    separatorIndex++
  }

  // The business-segments method can append its cited, three-column
  // "披露维度" header to the preceding narrative and then emit the separator
  // before the rows. Restore it only for this exact section/table shape; a
  // nearby prose paragraph or similarly sized table is not sufficient proof.
  const businessSegmentsFusion = (separatorIndex: number): { readonly narrative: string; readonly header: string; readonly paragraphIndex: number } | undefined => {
    let previous = separatorIndex - 1
    while (previous >= 0 && !lines[previous]!.trim()) previous--
    if (previous < 0 || isPipeLine(lines[previous]!)) return undefined
    let sectionHeading = -1
    for (let index = previous - 1; index >= 0; index--) {
      if (/^#{1,6}\s/u.test(lines[index]!.trim())) { sectionHeading = index; break }
    }
    if (sectionHeading < 0 || lines[sectionHeading]!.trim() !== '### 客户、渠道及分部经济机制') return undefined
    const fused = /^(.*?)\s+披露维度 可确认事项 解释及限制 (\[[A-Za-z0-9._:-]+@paragraph:\d+\])\s*$/u.exec(lines[previous]!)
    if (!fused) return undefined
    return { narrative: fused[1]!.trim(), header: `| 披露维度 | 可确认事项 | 解释及限制 ${fused[2]} |`, paragraphIndex: previous }
  }
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    const fused = businessSegmentsFusion(separatorIndex)
    if (!fused) continue
    const width = splitCells(lines[separatorIndex]!).length
    const rows: string[][] = []
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) rows.push(splitCells(lines[rowIndex]!))
    const labels = ['汽车相关产品', '电子产品', '电池与光伏', '渠道']
    const exactRows = rows.length === labels.length && rows.every((row, index) => row[0] === labels[index]
      && (index < labels.length - 1 ? row.length === width : row.length === width + 1 && /^#{1,6}\s+规模优势、成本与反证/u.test(row[width] ?? '')))
    if (width !== 3 || !exactRows || !fused.narrative) {
      diagnostics.push(`TABLE_REPAIR_AMBIGUOUS: business-segments header/table shape at line ${separatorIndex + 1}`)
      continue
    }
    lines.splice(fused.paragraphIndex, 1, fused.narrative, fused.header)
    repairs.push(`TABLE_BUSINESS_SEGMENTS_HEADER_RESTORED: line ${separatorIndex + 1}; width ${width}`)
    separatorIndex++
  }

  // A detached separator cannot establish a table on its own. Remove it only
  // when the immediately following pipe block has inconsistent row widths;
  // a width-consistent unknown table remains fail-closed for manual review.
  for (let separatorIndex = 0; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    let previous = separatorIndex - 1
    while (previous >= 0 && !lines[previous]!.trim()) previous--
    if (previous >= 0 && isPipeLine(lines[previous]!)) continue
    const rowWidths: number[] = []
    const rowShapes: string[][] = []
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
      const row = splitCells(lines[rowIndex]!)
      rowWidths.push(row.length)
      rowShapes.push(row)
    }
    const width = splitCells(lines[separatorIndex]!).length
    const precedingHeading=previous>=0?lines[previous]!.trim():''
    if (businessSegmentsFusion(separatorIndex)) {
      diagnostics.push(`TABLE_REPAIR_AMBIGUOUS: business-segments header/table shape at line ${separatorIndex + 1}`)
      continue
    }
    const financeSourceHeader=/^#{1,6}\s*(?:融资与现金来源|资金来源与融资|融资结构与现金来源)/u.test(precedingHeading)
    if(financeSourceHeader&&width===4&&rowShapes.length>=2&&rowShapes.every(row=>row.length===4)){
      const header=['行动及期间','金额/比率','目的与后续结果','证据及判断']
      lines.splice(separatorIndex,0,renderRow(header))
      repairs.push(`TABLE_FINANCING_HEADER_RESTORED: line ${separatorIndex+1}; width ${width}`)
      separatorIndex++
      continue
    }
    // Industry synthesis occasionally emits its table title fused to a
    // whitespace-delimited header. Split only this explicit title when the
    // remaining labels and every data row prove the separator width.
    const industryHeader = previous >= 0 ? /^行业规模背景\s+(.+)$/.exec(lines[previous]!.trim()) : undefined
    const industryCells = industryHeader?.[1]?.split(/\s+/u) ?? []
    if (industryHeader && industryCells.length === width && width >= 4
      && industryCells.every(cell => cell.length <= 30 && !/[。；！？.!?，,|#]/u.test(cell))
      && industryCells.filter(cell => /(?:规模|年份|期间|市场边界|机构|可比性|限制)/u.test(cell)).length >= 2
      && rowShapes.length >= 2 && rowShapes.every(row => row.length === width)) {
      lines.splice(previous, 1, '## 行业规模背景', renderRow(industryCells))
      repairs.push(`TABLE_INDUSTRY_TITLE_HEADER_PROMOTED: line ${previous + 1}; width ${width}`)
      separatorIndex++
      continue
    }
    const appendedHeader = previous >= 0 ? /^(.*\[[^\]\s]+@paragraph:\d+\])\s+(.+?)\s+\[([^\]\s]+@paragraph:\d+)\]\s*$/u.exec(lines[previous]!) : undefined
    const appendedCells = appendedHeader?.[2]?.split(/\s+/u) ?? []
    const appendedLooksTabular = appendedCells.length === width
      && appendedCells.every(cell => cell.length <= 24 && !/[。；！？.!?，,|#]/u.test(cell))
      && /(?:期间|报告期|年度|指标|产品|科目)/u.test(appendedCells[0] ?? '')
      && appendedCells.filter(cell => /(?:收入|成本|毛利率|利润|同比|增减|余额|金额|占比)/u.test(cell)).length >= 2
    const rowsProveWidth = rowShapes.length >= 2 && rowShapes.filter(row => row.length === width).length >= 2
      && rowShapes.every(row => row.length === width || row.length === width + 1)
    if (appendedLooksTabular && rowsProveWidth) continue
    if (rowWidths.length < 2 || rowWidths.every(width => width === rowWidths[0])) continue
    lines.splice(separatorIndex, 1)
    repairs.push(`TABLE_ORPHAN_SEPARATOR_REMOVED: line ${separatorIndex + 1}; inconsistent following widths ${rowWidths.join(',')}`)
    separatorIndex--
  }

  // A cited narrative may end with a plain-text table header immediately
  // before its separator. Promote it only when the final citation is an
  // explicit boundary, the whitespace-delimited labels exactly match the
  // separator width, and the following data rows confirm that width.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    const headerIndex = separatorIndex - 1
    const headerLine = lines[headerIndex]!
    if (isPipeLine(headerLine)) continue
    // Some synthesis outputs append a plain-text table header after a cited
    // narrative, then attach the header's own locator at the end of the line.
    // Promote only a clearly tabular, whitespace-delimited suffix whose width
    // matches the separator; keep the narrative and all locators in order.
    const width = splitCells(lines[separatorIndex]!).length
    const appendedHeader = /^(.*\[[^\]\s]+@paragraph:\d+\])\s+(.+?)\s+\[([^\]\s]+@paragraph:\d+)\]\s*$/u.exec(headerLine)
    if (appendedHeader) {
      const headerCells = appendedHeader[2]!.split(/\s+/u)
      const headerLooksTabular = headerCells.length === width
        && headerCells.every(cell => cell.length <= 24 && !/[。；！？.!?，,|#]/u.test(cell))
        && /(?:期间|报告期|年度|指标|产品|科目|独立分类|分部分类)/u.test(headerCells[0]!)
        && headerCells.filter(cell => /(?:收入|成本|毛利率|利润|同比|增减|余额|金额|占比)/u.test(cell)).length >= 2
      const rowWidths: number[] = []
      const rowShapes: string[][] = []
      for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
        const row = splitCells(lines[rowIndex]!)
        rowWidths.push(row.length)
        rowShapes.push(row)
      }
      const counts = new Map<number, number>()
      for (const rowWidth of rowWidths) counts.set(rowWidth, (counts.get(rowWidth) ?? 0) + 1)
      const modes = [...counts].sort((left, right) => right[1] - left[1])
      const rowsProveWidth = rowShapes.length >= 2 && rowShapes.filter(row => row.length === width).length >= 2
        && rowShapes.every(row => row.length === width || row.length === width + 1)
      if (headerLooksTabular && modes.length && modes[0]![0] === width && rowsProveWidth) {
        lines.splice(headerIndex, 1, appendedHeader[1]!, renderRow([...headerCells.slice(0, -1), `${headerCells.at(-1)} [${appendedHeader[3]}]`]))
        repairs.push(`TABLE_CITED_APPENDED_HEADER_PROMOTED: line ${headerIndex + 1}; width ${width}`)
        separatorIndex++
        continue
      }
    }
    const close = headerLine.lastIndexOf(']')
    const open = close >= 0 ? headerLine.lastIndexOf('[', close) : -1
    const locator = open >= 0 && close > open ? headerLine.slice(open + 1, close) : ''
    if (!locator.includes('@paragraph:') || !/^\d+$/u.test(locator.slice(locator.lastIndexOf('@paragraph:') + 11))) continue
    const suffixStart = close + 1
    const suffix = headerLine.slice(suffixStart).trim()
    const headerCells = suffix ? suffix.split(/\s+/u) : []
    if (headerCells.length !== width || headerCells.some(cell => !cell || /[|#]/u.test(cell))) continue
    const rowWidths: number[] = []
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) rowWidths.push(splitCells(lines[rowIndex]!).length)
    const counts = new Map<number, number>()
    for (const rowWidth of rowWidths) counts.set(rowWidth, (counts.get(rowWidth) ?? 0) + 1)
    const modes = [...counts].sort((left, right) => right[1] - left[1])
    if (!modes.length || modes[0]![0] !== width || (modes[1] && modes[0]![1] === modes[1][1])) continue
    const preamble = headerLine.slice(0, suffixStart).trim()
    const preambleLines = detachPrefix(preamble)
    lines.splice(headerIndex, 1, ...preambleLines, renderRow(headerCells))
    repairs.push(`TABLE_CITED_PLAIN_HEADER_PROMOTED: line ${headerIndex + 1}; width ${width}`)
    separatorIndex += preambleLines.length
  }

  // A heading and a paragraph were occasionally serialized into the header
  // row immediately before a valid separator. Split only when the remainder
  // after the final heading is a pipe-delimited header and the heading title
  // has an unambiguous single-token boundary.
  for (let index = 1; index < lines.length; index++) {
    if (!isSeparator(lines[index]!)) continue
    const headerIndex = index - 1
    const headerLine = lines[headerIndex]!
    if (!isPipeLine(headerLine)) continue
    const headingMatches = [...headerLine.matchAll(/#{1,6}\s+([^\s|]+)/gu)]
    if (!headingMatches.length) continue
    const first = headingMatches[0]!
    const firstHeadingStart = first.index! + (first[0]!.indexOf('#'))
    const before = headerLine.slice(0, firstHeadingStart).trim().replace(/^\|\s*/u, '').replace(/\s*\|$/u, '').trim()
    const pieces: string[] = []
    if (before) pieces.push(before)
    let tableHeader = ''
    let cursor = firstHeadingStart
    let canRepair = true
    for (let headingIndex = 0; headingIndex < headingMatches.length; headingIndex++) {
      const match = headingMatches[headingIndex]!
      const markerStart = match.index! + match[0]!.indexOf('#')
      if (markerStart < cursor) { canRepair = false; break }
      const between = headerLine.slice(cursor, markerStart).trim()
      if (between) {
        if (headingIndex === 0 && markerStart === firstHeadingStart) { /* prefix was handled above */ }
        else pieces.push(between)
      }
      pieces.push(`${'#'.repeat(match[0]!.match(/^#+/u)![0].length)} ${match[1]}`)
      cursor = match.index! + match[0]!.length
      const next = headingMatches[headingIndex + 1]
      if (!next) {
        const remainder = headerLine.slice(cursor)
        if (remainder.trimStart().startsWith('|')) tableHeader = remainder.trim()
        else {
          // Some semantic responses append explanatory prose before a valid
          // trailing table header on the same line as the section heading.
          // Detach that prose only when one unique terminal pipe header has
          // the exact width proven by the adjacent separator and data rows.
          const separatorWidth = splitCells(lines[index]!).length
          const candidates: { start: number; header: string }[] = []
          for (const match of remainder.matchAll(/\|/gu)) {
            const start = match.index!
            const candidate = remainder.slice(start).trim()
            if (!candidate.endsWith('|') || splitCells(candidate).length !== separatorWidth) continue
            const cells = splitCells(candidate)
            if (cells.some(cell => !cell || /[#\n]/u.test(cell))) continue
            candidates.push({ start, header: candidate })
          }
          if (candidates.length !== 1) { canRepair = false; break }
          const prefix = remainder.slice(0, candidates[0]!.start).trim()
          if (!prefix || prefix.includes('|')) { canRepair = false; break }
          pieces.push(prefix)
          tableHeader = candidates[0]!.header
        }
      }
    }
    if (!canRepair || !tableHeader) {
      diagnostics.push(`TABLE_REPAIR_AMBIGUOUS: heading/header fusion at line ${headerIndex + 1}`)
      continue
    }
    const headerWidth = splitCells(tableHeader).length
    const separatorWidth = splitCells(lines[index]!).length
    if (headerWidth < 2 || separatorWidth < headerWidth) {
      diagnostics.push(`TABLE_REPAIR_AMBIGUOUS: fused header width at line ${headerIndex + 1}`)
      continue
    }
    if (separatorWidth > headerWidth) {
      const followingWidths: number[] = []
      for (let rowIndex = index + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) followingWidths.push(splitCells(lines[rowIndex]!).length)
      const counts = new Map<number, number>()
      for (const width of followingWidths) counts.set(width, (counts.get(width) ?? 0) + 1)
      const modes = [...counts].sort((left, right) => right[1] - left[1])
      if (!modes.length || modes[0]![0] !== headerWidth || (modes[1] && modes[0]![1] === modes[1][1])) {
        diagnostics.push(`TABLE_REPAIR_AMBIGUOUS: separator width at line ${index + 1} does not match fused header/data rows`)
        continue
      }
    }
    lines.splice(headerIndex, 1, ...pieces, renderRow(splitCells(tableHeader)))
    const adjustedSeparatorIndex = index + pieces.length
    if (separatorWidth !== headerWidth) {
      lines[adjustedSeparatorIndex] = separator(headerWidth)
      repairs.push(`TABLE_HEADER_HEADING_DETACHED: line ${headerIndex + 1}; separator width ${separatorWidth}->${headerWidth}`)
    } else repairs.push(`TABLE_HEADER_HEADING_DETACHED: line ${headerIndex + 1}`)
    index = adjustedSeparatorIndex
  }

  // Capital-allocation synthesis can move the exact M&A header ahead of the
  // prior table's trailing explanatory paragraph. Reattach it only when the
  // unique subsection, three-column separator, and all four exact acquisition
  // row labels establish the destination; the header text and cited rows are
  // moved verbatim, without inferring or changing any cell content.
  const acquisitionHeading = '### 并购与融资'
  const acquisitionHeader = ['行动', '已有证据及目的', '结果与判断限制']
  const acquisitionLabels = ['收购法国GMD集团', '收购索尔思光电', '收购融资背景', 'H股融资安排']
  const acquisitionHeadingIndexes = lines.flatMap((line, index) => line.trim() === acquisitionHeading ? [index] : [])
  const acquisitionHeaderIndexes = lines.flatMap((line, index) =>
    isPipeLine(line) && !isSeparator(line) && JSON.stringify(splitCells(line)) === JSON.stringify(acquisitionHeader) ? [index] : [])
  if (acquisitionHeadingIndexes.length === 1 && acquisitionHeaderIndexes.length === 1) {
    const headingIndex = acquisitionHeadingIndexes[0]!
    const headerIndex = acquisitionHeaderIndexes[0]!
    const matchingSeparators: number[] = []
    for (let separatorIndex = headingIndex + 1; separatorIndex < lines.length; separatorIndex++) {
      if (!isSeparator(lines[separatorIndex]!) || splitCells(lines[separatorIndex]!).length !== acquisitionHeader.length) continue
      let previous = separatorIndex - 1
      while (previous > headingIndex && !lines[previous]!.trim()) previous--
      if (previous !== headingIndex) continue
      const rows: string[][] = []
      for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
        rows.push(splitCells(lines[rowIndex]!))
      }
      if (rows.length === acquisitionLabels.length
        && rows.every((row, index) => row.length === acquisitionHeader.length && row[0] === acquisitionLabels[index])) {
        matchingSeparators.push(separatorIndex)
      }
    }
    if (headerIndex < headingIndex && matchingSeparators.length === 1) {
      const separatorIndex = matchingSeparators[0]!
      const headerLine = lines[headerIndex]!
      lines.splice(headerIndex, 1)
      const adjustedSeparatorIndex = separatorIndex - 1
      lines.splice(adjustedSeparatorIndex, 0, headerLine)
      repairs.push(`TABLE_MNA_HEADER_REATTACHED: line ${headerIndex + 1}->${adjustedSeparatorIndex + 1}; width ${acquisitionHeader.length}`)
    }
  }

  // A semantic response can emit the next table's header directly after the
  // prior table, then place explanatory prose before that next table's
  // separator and rows. Reattach it only when the orphan separator and every
  // following row prove one unique width, and the displaced header is the
  // unique same-width, nonnumeric pipe row separated from that block only by
  // prose. This preserves both tables and all intervening narrative.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    let previous = separatorIndex - 1
    while (previous >= 0 && !lines[previous]!.trim()) previous--
    if (previous >= 0 && isPipeLine(lines[previous]!)) continue
    const width = splitCells(lines[separatorIndex]!).length
    const followingRows: string[][] = []
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) followingRows.push(splitCells(lines[rowIndex]!))
    if (followingRows.length < 2 || followingRows.some(row => row.length !== width)) continue
    const candidates: number[] = []
    for (let candidateIndex = 1; candidateIndex < separatorIndex; candidateIndex++) {
      if (!isPipeLine(lines[candidateIndex]!) || isSeparator(lines[candidateIndex]!)) continue
      const header = splitCells(lines[candidateIndex]!)
      if (header.length !== width || header.some(cell => !cell || /\d/.test(cell) || /^#{1,6}\s/u.test(cell))) continue
      let prior = candidateIndex - 1
      while (prior >= 0 && !lines[prior]!.trim()) prior--
      if (prior < 0 || !isPipeLine(lines[prior]!) || isSeparator(lines[prior]!)) continue
      if (splitCells(lines[prior]!).length === width || header.some(cell => cell.length < 2)) continue
      if (lines.slice(candidateIndex + 1, separatorIndex).some(line => isPipeLine(line))) continue
      candidates.push(candidateIndex)
    }
    if (candidates.length !== 1) continue
    const [headerIndex] = candidates
    const headerLine = lines[headerIndex]!
    lines.splice(headerIndex, 1)
    const adjustedSeparator = separatorIndex - 1
    lines.splice(adjustedSeparator, 0, headerLine)
    repairs.push(`TABLE_DISPLACED_HEADER_REATTACHED: line ${headerIndex + 1}->${adjustedSeparator + 1}; width ${width}`)
    separatorIndex = adjustedSeparator + followingRows.length + 1
  }

  // When the company/market-boundary table and the industry-forecast table
  // have the same width, a generic orphan-header repair cannot distinguish
  // the displaced forecast header from the preceding table's final row. The
  // explicit forecast heading and row labels provide that missing context.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    let previous = separatorIndex - 1
    while (previous >= 0 && !lines[previous]!.trim()) previous--
    if (previous >= 0 && isPipeLine(lines[previous]!)) continue
    let forecastHeading = -1
    for (let index = 0; index < separatorIndex; index++) if (/^\s*#{2,4}\s+行业规模背景\s*$/u.test(lines[index]!)) forecastHeading = index
    if (forecastHeading < 0) continue
    const width = splitCells(lines[separatorIndex]!).length
    if (width !== 5) continue
    const rows: string[][] = []
    for (let index = separatorIndex + 1; index < lines.length && isPipeLine(lines[index]!) && !isSeparator(lines[index]!); index++) rows.push(splitCells(lines[index]!))
    if (rows.length < 2 || rows.some(row => row.length !== width)) continue
    const candidates: number[] = []
    for (let index = 1; index < forecastHeading; index++) {
      if (!isPipeLine(lines[index]!) || isSeparator(lines[index]!)) continue
      const cells = splitCells(lines[index]!)
      if (cells.length !== width || cells.some(cell => !cell || /\d/u.test(cell))) continue
      if (!cells.some(cell => /市场边界/u.test(cell))
        || !cells.some(cell => /期间|规模/u.test(cell))
        || !cells.some(cell => /(?:来源|归属)/u.test(cell))
        || !cells.some(cell => /(?:适用限制|可比性|解释限制)/u.test(cell))) continue
      let prior = index - 1
      while (prior >= 0 && !lines[prior]!.trim()) prior--
      if (prior < 0 || !isPipeLine(lines[prior]!) || isSeparator(lines[prior]!) || splitCells(lines[prior]!).length !== width) continue
      if (lines.slice(index + 1, forecastHeading).some(line => isPipeLine(line))) continue
      candidates.push(index)
    }
    if (candidates.length !== 1) continue
    const headerIndex = candidates[0]!
    const [header] = lines.splice(headerIndex, 1)
    const adjustedSeparator = separatorIndex - 1
    lines.splice(adjustedSeparator, 0, header!)
    repairs.push(`TABLE_SAME_WIDTH_INDUSTRY_FORECAST_HEADER_REATTACHED: line ${headerIndex + 1}->${adjustedSeparator + 1}; width ${width}`)
    separatorIndex = adjustedSeparator + rows.length + 1
  }

  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    let previous = separatorIndex - 1
    while (previous >= 0 && !lines[previous]!.trim()) previous--
    if (previous >= 0 && isPipeLine(lines[previous]!)) continue
    let forecastHeading = -1
    for (let index = 0; index < separatorIndex; index++) if (/^\s*#{2,4}\s+行业规模背景\s*$/u.test(lines[index]!)) forecastHeading = index
    if (forecastHeading < 0) continue
    const width = splitCells(lines[separatorIndex]!).length
    const rows: string[][] = []
    for (let index = separatorIndex + 1; index < lines.length && isPipeLine(lines[index]!) && !isSeparator(lines[index]!); index++) rows.push(splitCells(lines[index]!))
    if (rows.length < 2 || rows.some(row => row.length !== width)) continue
    const candidates: number[] = []
    for (let index = 0; index < forecastHeading; index++) {
      if (!isPipeLine(lines[index]!) || isSeparator(lines[index]!)) continue
      const cells = splitCells(lines[index]!)
      if (cells.length !== width || cells.some(cell => !cell || /\d/u.test(cell))) continue
      if (!cells.some(cell => /市场边界/u.test(cell))
        || !cells.some(cell => /(?:预测值|规模|预测规模)/u.test(cell))
        || !cells.some(cell => /(?:预测机构|机构(?:及|与)归属|来源归属)/u.test(cell))
        || !cells.some(cell => /(?:可比性|解释限制|可比性说明)/u.test(cell))) continue
      if (lines.slice(index + 1, forecastHeading).some(line => isPipeLine(line))) continue
      candidates.push(index)
    }
    if (candidates.length !== 1) continue
    const headerIndex = candidates[0]!
    const header = lines[headerIndex]!
    lines.splice(headerIndex, 1)
    const adjustedSeparator = separatorIndex - 1
    lines.splice(adjustedSeparator, 0, header)
    repairs.push(`TABLE_INDUSTRY_FORECAST_HEADER_REATTACHED: line ${headerIndex + 1}->${adjustedSeparator + 1}; width ${width}`)
    separatorIndex = adjustedSeparator + rows.length + 1
  }

  // A capital-allocation response may append the next table's four-column
  // header as a same-width final row of the R&D table, then separate it from
  // the capital-expenditure table with prose and a subsection heading. Move
  // only the explicit action/period header to the uniquely matching table.
  for (let separatorIndex = 1; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    const width = splitCells(lines[separatorIndex]!).length
    if (width !== 4) continue
    let previous = separatorIndex - 1
    while (previous >= 0 && !lines[previous]!.trim()) previous--
    if (previous >= 0 && isPipeLine(lines[previous]!)) continue
    const rows: string[][] = []
    for (let index = separatorIndex + 1; index < lines.length && isPipeLine(lines[index]!) && !isSeparator(lines[index]!); index++) rows.push(splitCells(lines[index]!))
    if (rows.length < 2 || rows.some(row => row.length !== width)) continue
    const capexHeading = lines.findIndex((line, index) => index < separatorIndex && /^\s*#{2,5}\s+资本开支与流动性\s*$/u.test(line))
    const allocationHeading = lines.findIndex((line, index) => index < capexHeading && /^\s*#{2,5}\s+资本配置台账与评价\s*$/u.test(line))
    if (capexHeading < 0 || allocationHeading < 0) continue
    const candidates: number[] = []
    for (let index = allocationHeading + 1; index < capexHeading; index++) {
      if (!isPipeLine(lines[index]!) || isSeparator(lines[index]!)) continue
      const cells = splitCells(lines[index]!)
      if (cells.length !== width || cells.some(cell => !cell)) continue
      if (/行动与期间/u.test(cells[0]!) && /(?:金额|指标)/u.test(cells[1]!) && /(?:资金覆盖|目的)/u.test(cells[2]!) && /(?:结果|限制)/u.test(cells[3]!)) candidates.push(index)
    }
    if (candidates.length !== 1) continue
    const [headerIndex] = candidates
    const [header] = lines.splice(headerIndex, 1)
    const adjustedSeparator = separatorIndex - 1
    lines.splice(adjustedSeparator, 0, header!)
    repairs.push(`TABLE_CAPITAL_EXPENDITURE_HEADER_REATTACHED: line ${headerIndex + 1}->${adjustedSeparator + 1}; width ${width}`)
    separatorIndex = adjustedSeparator + rows.length + 1
  }

  // Missing cells are not a structural fusion: their position and intended
  // meaning cannot be inferred from table width alone. Keep them for the
  // ordinary table gate and semantic revision; never insert evidence-gap
  // assertions or pad them with empty cells merely to pass validation.

  // A heading can be appended to the final row of one table immediately
  // before the next table's own header. Detach it only when the next header,
  // separator, and value row establish a second complete table of matching
  // width; the heading remains between the two tables.
  for (let separatorIndex = 0; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    const width = splitCells(lines[separatorIndex]!).length
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) {
      const values = splitCells(lines[rowIndex]!)
      const trailingCell = values[width]?.trim() ?? ''
      const boldIndustryScaleHeading = trailingCell === '**行业规模背景**'
      if (values.length !== width + 1 || (!/^#{1,6}\s/u.test(trailingCell) && !boldIndustryScaleHeading)) continue
      let nextHeader = rowIndex + 1
      while (nextHeader < lines.length && !lines[nextHeader]!.trim()) nextHeader++
      const header = nextHeader < lines.length && isPipeLine(lines[nextHeader]!) && !isSeparator(lines[nextHeader]!) ? splitCells(lines[nextHeader]!) : []
      let nextSeparator = nextHeader + 1
      while (nextSeparator < lines.length && !lines[nextSeparator]!.trim()) nextSeparator++
      let firstValue = nextSeparator + 1
      while (firstValue < lines.length && !lines[firstValue]!.trim()) firstValue++
      const secondTableProven = header.length >= 2 && isSeparator(lines[nextSeparator] ?? '')
        && splitCells(lines[nextSeparator]!).length === header.length
        && firstValue < lines.length && isPipeLine(lines[firstValue]!) && !isSeparator(lines[firstValue]!)
        && splitCells(lines[firstValue]!).length === header.length
      if (!secondTableProven) continue
      const detached = boldIndustryScaleHeading ? ['## 行业规模背景'] : detachPrefix(values[width]!)
      lines[rowIndex] = renderRow(values.slice(0, width))
      lines.splice(rowIndex + 1, 0, ...detached)
      repairs.push(`TABLE_TRAILING_HEADING_BEFORE_TABLE_DETACHED: line ${rowIndex + 1}`)
      separatorIndex = rowIndex + detached.length + 1
      break
    }
  }

  // Normalize rows against the header. Extra cells are moved after the table
  // only when they clearly contain narrative; otherwise retain a fail-closed
  // diagnostic rather than guessing which cells belong to the table.
  for (let separatorIndex = 0; separatorIndex < lines.length; separatorIndex++) {
    if (!isSeparator(lines[separatorIndex]!)) continue
    let headerIndex = separatorIndex - 1
    while (headerIndex >= 0 && !lines[headerIndex]!.trim()) headerIndex--
    if (headerIndex < 0 || !isPipeLine(lines[headerIndex]!)) continue
    const headerCells = splitCells(lines[headerIndex]!)
    const rowIndexes: number[] = []
    for (let rowIndex = separatorIndex + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) rowIndexes.push(rowIndex)
    const separatorWidth = splitCells(lines[separatorIndex]!).length
    // A synthesis can emit a blank first header cell ("| | Label | Value |")
    // while its separator and data rows are two-column tables. Repair that
    // mismatch only when every peer row has the separator width except the
    // final row, whose sole extra cell is clearly a prose paragraph appended
    // after its closing pipe.
    const rowCells = rowIndexes.map(rowIndex => splitCells(lines[rowIndex]!))
    const trailingNarrativeRow = rowIndexes.length > 0
      && rowCells.every((cells, index) => cells.length === separatorWidth
        || (index === rowCells.length - 1 && cells.length === separatorWidth + 1 && narrativeTail(cells.slice(separatorWidth).join(' '))))
      && rowCells.at(-1)?.length === separatorWidth + 1
    if (headerCells.length === separatorWidth + 1 && headerCells[0] === '' && headerCells.slice(1).every(Boolean) && trailingNarrativeRow) {
      headerCells.shift()
      lines[headerIndex] = renderRow(headerCells)
      repairs.push(`TABLE_EMPTY_LEADING_HEADER_CELL_REMOVED: line ${headerIndex + 1}`)
    }
    const width = headerCells.length
    if (width < 2 || headerCells.some(cell => /^#{1,6}\s/u.test(cell))) continue
    const tails = new Map<number, string>()
    const headingTails = new Map<number, string[]>()
    for (const rowIndex of rowIndexes) {
      const values = splitCells(lines[rowIndex]!)
      if (values.some(cell => /^#{1,6}\s/u.test(cell))) {
        const prefix = values.slice(0, width)
        const trailing = values[width]
        const peerWidths = rowIndexes.filter(candidate => candidate !== rowIndex).map(candidate => splitCells(lines[candidate]!).length)
        const isUniqueExpectedPeerWidth = peerWidths.length > 0 && peerWidths.every(candidateWidth => candidateWidth === width)
        if (rowIndex === rowIndexes.at(-1) && values.length === width + 1 && prefix.length === width && prefix.every(cell => !/^#{1,6}\s/u.test(cell)) && trailing && /^#{1,6}\s/u.test(trailing) && isUniqueExpectedPeerWidth) {
          headingTails.set(rowIndex, detachPrefix(trailing))
          lines[rowIndex] = renderRow(prefix)
          repairs.push(`TABLE_TRAILING_HEADING_PROSE_DETACHED: line ${rowIndex + 1}`)
          continue
        }
        diagnostics.push(`TABLE_REPAIR_AMBIGUOUS: heading embedded in data row at line ${rowIndex + 1}`)
        continue
      }
      if (values.length <= width) continue
      const tail = values.slice(width).filter(Boolean).join(' ')
      const overflow = values.slice(width).filter(Boolean)
      const citationOnly = overflow.length > 0 && overflow.every(cell => /^(?:\[[A-Za-z0-9._:-]+@paragraph:\d+\]\s*)+$/u.test(cell))
      if (citationOnly) {
        const repaired = [...values.slice(0, width)]
        repaired[width - 1] = `${repaired[width - 1]} ${overflow.join(' ')}`.trim()
        lines[rowIndex] = renderRow(repaired)
        repairs.push(`TABLE_TRAILING_CITATIONS_REATTACHED: line ${rowIndex + 1}`)
        continue
      }
      if (!tail || !narrativeTail(tail)) {
        diagnostics.push(`TABLE_REPAIR_AMBIGUOUS: extra cells at line ${rowIndex + 1}`)
        continue
      }
      tails.set(rowIndex, tail)
      lines[rowIndex] = renderRow(values.slice(0, width))
      repairs.push(`TABLE_TRAILING_NARRATIVE_MOVED: line ${rowIndex + 1}`)
    }
    if (tails.size) {
      const lastRow = rowIndexes.at(-1)!
      const tailLines = [...tails.values(), ...[...headingTails.values()].flat()]
      lines.splice(lastRow + 1, 0, '', ...tailLines)
      separatorIndex += tailLines.length
    } else if (headingTails.size) {
      const lastRow = rowIndexes.at(-1)!
      lines.splice(lastRow + 1, 0, ...[...headingTails.values()].flat())
      separatorIndex += [...headingTails.values()].flat().length
    }
  }

  // A separator widened by heading fusion is repaired only when the following
  // rows agree with the header's width. Any unresolved mismatch remains a
  // validation error for the workflow's fail-closed gate.
  for (let index = 0; index < lines.length; index++) {
    if (!isSeparator(lines[index]!)) continue
    let headerIndex = index - 1
    while (headerIndex >= 0 && !lines[headerIndex]!.trim()) headerIndex--
    if (headerIndex < 0 || !isPipeLine(lines[headerIndex]!)) continue
    const headerWidth = splitCells(lines[headerIndex]!).length
    const widths: number[] = []
    for (let rowIndex = index + 1; rowIndex < lines.length && isPipeLine(lines[rowIndex]!) && !isSeparator(lines[rowIndex]!); rowIndex++) widths.push(splitCells(lines[rowIndex]!).length)
    if (!widths.length) continue
    const counts = new Map<number, number>()
    for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1)
    const ordered = [...counts].sort((left, right) => right[1] - left[1])
    const modalWidth = ordered[0]![0]
    const uniqueMode = ordered.length === 1 || ordered[0]![1] > ordered[1]![1]
    if (uniqueMode && modalWidth === headerWidth && splitCells(lines[index]!).length > modalWidth) {
      const oldWidth = splitCells(lines[index]!).length
      lines[index] = separator(modalWidth)
      repairs.push(`TABLE_SEPARATOR_WIDTH_NORMALIZED: line ${index + 1}; ${oldWidth}->${modalWidth}`)
    }
  }
  const normalizedLines: string[] = []
  let inFence = false
  let headingBoundaryRepairs = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!
    if (/^\s*```/u.test(line)) { inFence = !inFence; normalizedLines.push(line); continue }
    if (inFence || !line.trim() || isPipeLine(line) || line.includes('`')) { normalizedLines.push(line); continue }
    const markers = [...line.matchAll(/(^|[ \t]+)(#{1,6})[ \t]+(?=\S)/gu)]
    if (!markers.length) { normalizedLines.push(line); continue }
    const segments: string[] = []
    let cursor = 0
    for (let markerIndex = 0; markerIndex < markers.length; markerIndex++) {
      const marker = markers[markerIndex]!
      const markerStart = (marker.index ?? 0) + marker[1]!.length
      const textStart = markerStart + marker[2]!.length + marker[0].length - marker[1].length - marker[2].length
      const prefix = line.slice(cursor, markerStart).trim()
      if (prefix) segments.push(prefix)
      const contentEnd = markers[markerIndex + 1]?.index ?? line.length
      const headingText = line.slice(textStart, contentEnd).trim()
      if (!headingText) { cursor = contentEnd; continue }
      const bodyBoundary = headingText.search(/[ \t]/u)
      const title = bodyBoundary > 0 ? headingText.slice(0, bodyBoundary) : ''
      const body = bodyBoundary > 0 ? headingText.slice(bodyBoundary).trim() : ''
      const splitHeadingFromBody = title.length <= 48 && /[\u3400-\u9fff]/u.test(title) && body.length >= 20
      if (splitHeadingFromBody) segments.push(`${marker[2]} ${title}`, body)
      else if (headingText.length > 48) segments.push(headingText)
      else segments.push(`${marker[2]} ${headingText}`)
      cursor = contentEnd
    }
    const trailing = line.slice(cursor).trim()
    if (trailing) segments.push(trailing)
    if (segments.length > 1 || markers.length > 1) {
      for (const segment of segments) {
        if (segment.startsWith('#')) {
          if (normalizedLines.length && normalizedLines.at(-1)?.trim()) normalizedLines.push('')
          normalizedLines.push(segment, '')
        } else normalizedLines.push(segment)
      }
      headingBoundaryRepairs++
    } else normalizedLines.push(...segments)
  }
  if (headingBoundaryRepairs) repairs.push(`INLINE_HEADING_BOUNDARIES_NORMALIZED: ${headingBoundaryRepairs} line(s)`)
  // A synthesis may serialize the exact industry-citation table header as
  // plain text while retaining its three-column Markdown separator and rows.
  // Restore only this fixed header when the following rows carry annual
  // report-period labels; unknown header/separator pairs remain fail-closed.
  const industryEvidenceHeader = '适用报告与期间 完整表头（单位：元；末列原单位为%） 分类标签及匹配数据行'
  for (let index = 0; index + 2 < normalizedLines.length; index++) {
    if (normalizedLines[index]!.trim() !== industryEvidenceHeader
      || !isSeparator(normalizedLines[index + 1]!)
      || splitCells(normalizedLines[index + 1]!).length !== 3
      || !/^\|\s*20\d{2}年年度报告/u.test(normalizedLines[index + 2]!)) continue
    normalizedLines[index] = '| 适用报告与期间 | 完整表头（单位：元；末列原单位为%） | 分类标签及匹配数据行 |'
    repairs.push(`TABLE_INDUSTRY_EVIDENCE_HEADER_RESTORED: line ${index + 1}`)
  }
  // Restore the fixed four-column industry-size header only for the known
  // three-row China EV / AI server / data-center cooling summary. Its preceding
  // paragraph explains scope but is not itself a Markdown table header.
  for (let index = 0; index + 3 < normalizedLines.length; index++) {
    if (!isSeparator(normalizedLines[index]!) || splitCells(normalizedLines[index]!).length !== 4
      || !/^\|\s*中国新能源汽车全年销量\s*\|/u.test(normalizedLines[index + 1]!)
      || !/^\|\s*全球AI服务器市场\s*\|/u.test(normalizedLines[index + 2]!)
      || !/^\|\s*全球数据中心液冷市场\s*\|/u.test(normalizedLines[index + 3]!)) continue
    normalizedLines.splice(index, 0, '| 市场背景指标 | 期间 | 报告数值 | 来源、边界及限制 |')
    repairs.push(`TABLE_INDUSTRY_SIZE_HEADER_RESTORED: line ${index + 1}`)
    index++
  }
  // Run this narrow repair after the generic embedded-header passes. Those
  // passes can otherwise reinterpret the exact locator header before it is
  // detached from the seven-column industry row.
  const evidenceHeaderTail = ' | | 报告及单位 | 完整分类表头定位 |'
  for (let index = 0; index + 2 < normalizedLines.length; index++) {
    const marker = normalizedLines[index]!.lastIndexOf(evidenceHeaderTail)
    if (marker < 0 || !isSeparator(normalizedLines[index + 1]!) || splitCells(normalizedLines[index + 1]!).length !== 2) continue
    const firstTableRow = `${normalizedLines[index]!.slice(0, marker).trimEnd()} |`
    const evidenceHeader = '| 报告及单位 | 完整分类表头定位 |'
    if (splitCells(firstTableRow).length !== 7 || splitCells(evidenceHeader).length !== 2) continue
    let rowIndex = index + 2
    let rowCount = 0
    for (; rowIndex < normalizedLines.length && isPipeLine(normalizedLines[rowIndex]!) && !isSeparator(normalizedLines[rowIndex]!); rowIndex++) {
      if (splitCells(normalizedLines[rowIndex]!).length !== 2) break
      rowCount++
    }
    if (!rowCount) continue
    normalizedLines.splice(index, 1, firstTableRow, '', evidenceHeader)
    const staleAmbiguity = `TABLE_REPAIR_AMBIGUOUS: extra cells at line ${index + 1}`
    const diagnosticIndex = diagnostics.indexOf(staleAmbiguity)
    if (diagnosticIndex >= 0) diagnostics.splice(diagnosticIndex, 1)
    repairs.push(`TABLE_EMBEDDED_REFERENCE_HEADER_SPLIT: line ${index + 1}; rows ${rowCount}`)
    index += 2
  }

  // A final Dongshan synthesis can split its exact seven-column annual
  // industry row around the following five-column risk table: the row's first
  // two cells appear after the industry header, while its five numeric cells
  // appear immediately before the risk-table separator. Rejoin only this
  // fully identified source row and move only the unique risk header that
  // matches the later separator/body. Any missing citation, changed value,
  // duplicate anchor, or unexpected table shape remains fail-closed.
  const industryDisclosureHeading = '### 分行业公司披露（非行业规模）'
  const companyRiskHeading = '### 公司特定风险、监控与缓解'
  const industryRowHeader = '| 期间与分行业分类 | 营业收入（元） | 营业成本（元） | 毛利率 | 营业收入比上年同期增减（%） | 营业成本比上年同期增减（%） | 毛利率比上年同期增减（%） |'
  const riskTableHeader = '| 风险触发条件 | 影响路径 | 监控指标 | 披露的缓解因素 | 残余风险 |'
  const exactIndexes = (value: string): number[] => normalizedLines.flatMap((line, index) => line.trim() === value ? [index] : [])
  const disclosureHeadings = exactIndexes(industryDisclosureHeading)
  const riskHeadings = exactIndexes(companyRiskHeading)
  const industryHeaders = exactIndexes(industryRowHeader)
  const displacedRiskHeaders = exactIndexes(riskTableHeader)
  if (disclosureHeadings.length === 1 && riskHeadings.length === 1 && industryHeaders.length === 1 && displacedRiskHeaders.length === 1) {
    const disclosureHeadingIndex = disclosureHeadings[0]!
    const riskHeadingIndex = riskHeadings[0]!
    const industryHeaderIndex = industryHeaders[0]!
    const displacedRiskHeaderIndex = displacedRiskHeaders[0]!
    const industrySeparatorIndex = industryHeaderIndex + 1
    const industryFragmentIndex = industryHeaderIndex + 2
    const riskSeparatorCandidates: number[] = []
    for (let index = riskHeadingIndex + 1; index < normalizedLines.length; index++) {
      if (isSeparator(normalizedLines[index]!) && splitCells(normalizedLines[index]!).length === 5) riskSeparatorCandidates.push(index)
      if (/^#{1,2}\s/u.test(normalizedLines[index]!.trim())) break
    }
    const riskSeparatorIndex = riskSeparatorCandidates.length === 1 ? riskSeparatorCandidates[0]! : -1
    if (disclosureHeadingIndex < industryHeaderIndex
      && industryHeaderIndex < displacedRiskHeaderIndex
      && displacedRiskHeaderIndex < riskHeadingIndex
      && riskHeadingIndex < riskSeparatorIndex
      && isSeparator(normalizedLines[industrySeparatorIndex]!)
      && splitCells(normalizedLines[industrySeparatorIndex]!).length === 7
      && isPipeLine(normalizedLines[industryFragmentIndex]!)
      && splitCells(normalizedLines[industryFragmentIndex]!).length === 2
      && riskSeparatorIndex > 0) {
      const fragmentCells = splitCells(normalizedLines[industryFragmentIndex]!)
      const riskHeaderCells = splitCells(normalizedLines[displacedRiskHeaderIndex]!)
      let tailIndex = riskHeadingIndex + 1
      while (tailIndex < riskSeparatorIndex && !normalizedLines[tailIndex]!.trim()) tailIndex++
      const tailCells = tailIndex < riskSeparatorIndex && isPipeLine(normalizedLines[tailIndex]!)
        ? splitCells(normalizedLines[tailIndex]!)
        : []
      const riskRows: string[][] = []
      for (let index = riskSeparatorIndex + 1; index < normalizedLines.length && isPipeLine(normalizedLines[index]!) && !isSeparator(normalizedLines[index]!); index++) {
        riskRows.push(splitCells(normalizedLines[index]!))
      }
      const requiredIndustryCitations = ['864', '885', '886', '887', '888', '889', '890', '891', '892', '893', '894']
      const tailText = normalizedLines[tailIndex] ?? ''
      const exactIndustryTail = tailCells.length === 5
        && tailCells[0] === '34,153,971,460.65'
        && tailCells[1] === '13.85%'
        && tailCells[2] === '8.67%'
        && tailCells[3] === '8.83%'
        && tailCells[4]?.startsWith('-0.12%')
        && requiredIndustryCitations.every(paragraph => tailText.includes(`[official-39e591fa149e4543@paragraph:${paragraph}]`))
      const exactIndustryFragment = fragmentCells[0] === '2025年度；计算机、通信和其他电子'
        && fragmentCells[1] === '39,643,732,616.04'
      const exactRiskRows = riskRows.length === 3
        && riskRows.every(row => row.length === 5)
        && riskRows[0]?.[0] === '主要客户经营显著不利或客户集中进一步加深'
        && riskRows[1]?.[0] === '技术更新快于公司研发制造能力'
        && riskRows[2]?.[0] === '国际贸易政策或地缘环境变化'
      const reconstructedIndustryRow = renderRow([...fragmentCells, ...tailCells])
      const industryTable = [industryRowHeader, normalizedLines[industrySeparatorIndex]!, reconstructedIndustryRow].join('\n')
      const riskTable = [riskTableHeader, normalizedLines[riskSeparatorIndex]!, ...riskRows.map(row => renderRow(row))].join('\n')
      const tablesValidate = validateCompanyResearchMarkdownTables(industryTable).length === 0
        && validateCompanyResearchMarkdownTables(riskTable).length === 0
      if (exactIndustryFragment && exactIndustryTail && riskHeaderCells.length === 5
        && exactRiskRows && tablesValidate) {
        normalizedLines[industryFragmentIndex] = reconstructedIndustryRow
        normalizedLines.splice(tailIndex, 1)
        const adjustedRiskSeparatorIndex = riskSeparatorIndex - 2
        normalizedLines.splice(displacedRiskHeaderIndex, 1)
        normalizedLines.splice(adjustedRiskSeparatorIndex, 0, riskTableHeader)
        repairs.push(`TABLE_DONGSHAN_INDUSTRY_ROW_REJOINED: line ${industryFragmentIndex + 1}; risk header reattached at line ${adjustedRiskSeparatorIndex + 1}`)
      }
    }
  }
  return { markdown: normalizedLines.join('\n').replace(/\n{3,}/gu, '\n\n'), repairs, diagnostics }
}
const schema = {type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',minItems:2,maxItems:2,items:{type:'object',additionalProperties:false,required:['id','markdown','sourceCandidateIds'],properties:{id:{type:'string',enum:finalIds},markdown:{type:'string',minLength:1,maxLength:5000},sourceCandidateIds:{type:'array',items:{type:'string'}}}}}}} as const

function synthesisNumericRepairEvidence(issues: readonly NumericGroundingDiagnostic[], methods: readonly CompanyResearchMethodResult[], sources: CompanyResearchInput['sources'], allowedLocations: ReadonlySet<string>): string[] {
  const tokens = [...new Set(issues.map(issue => issue.token))].slice(0, 8)
  const matches: string[] = []
  for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) for (const excerpt of packet.excerpts) {
    const ref = `${packet.sourceCandidateId}@${excerpt.location}`
    if (!allowedLocations.has(ref) || matches.length >= 8) continue
    if (tokens.some(token => excerpt.text.replace(/[,，\s]/g, '').includes(token.replace(/[,，\s]/g, '')))) {
      const row = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
      const nearby = packet.excerpts.filter(candidate => {
        const paragraph = Number(/^paragraph:(\d+)$/.exec(candidate.location)?.[1])
        return paragraph > 0 && Math.abs(paragraph - row) <= 1 && candidate.location !== excerpt.location
      }).map(candidate => `${candidate.location}: ${candidate.text.slice(0, 180)}`)
      const explicit = (excerpt.contextLocations ?? []).flatMap(location => {
        const context = packet.excerpts.find(candidate => candidate.location === location)
        return context ? [`${location}: ${context.text.slice(0, 180)}`] : []
      })
      matches.push(`[${ref}] ${excerpt.text.slice(0, 360)}${[...new Set([...explicit, ...nearby])].length ? `；已供给的单位/相邻上下文：${[...new Set([...explicit, ...nearby])].join(' | ')}` : ''}`)
    }
  }
  // A method finding may cite a paragraph that was validated when the method
  // ran but omitted from its compact evidence packet. Recover only the exact
  // allowed locator from the already-acquired source body; this is repair
  // guidance, never a newly authorized citation.
  for (const source of sources) for (const ref of allowedLocations) {
    if (matches.length >= 8) return matches
    const prefix = `${source.candidate.candidateId}@paragraph:`
    if (!ref.startsWith(prefix)) continue
    const paragraph = Number(ref.slice(prefix.length))
    if (!Number.isInteger(paragraph) || paragraph < 1) continue
    const text = source.content.split(/\r?\n/)[paragraph - 1]
    if (!text || !tokens.some(token => text.replace(/[,，\s]/g, '').includes(token.replace(/[,，\s]/g, '')))) continue
    if (!matches.some(match => match.startsWith(`[${ref}]`))) matches.push(`[${ref}] ${text.slice(0, 360)}`)
  }
  return matches
}

function repairSynthesisSubjectCitations(text: string, methods: readonly CompanyResearchMethodResult[], allowedLocations: ReadonlySet<string>): string {
  const anchors = ['客户','供应商','商誉','存货','应收','研发'] as const
  const excerpts = methods.flatMap(method => [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]).flatMap(packet => packet.excerpts
    .filter(excerpt => allowedLocations.has(`${packet.sourceCandidateId}@${excerpt.location}`))
    .map(excerpt => ({ ref: `${packet.sourceCandidateId}@${excerpt.location}`, text: excerpt.text })))
  const insertions: { readonly offset: number; readonly ref: string }[] = []
  for (const match of text.matchAll(/[^。！？；\n]+[。！？；\n]?/g)) {
    const sentence = match[0]!
    const relevantAnchors = anchors.filter(anchor => sentence.includes(anchor))
    if (!relevantAnchors.length) continue
    const numbers = [...new Set([...sentence.matchAll(/(?<![\w.])-?\d[\d,，]*(?:\.\d+)?/g)].map(value => value[0]!.replace(/[,，]/g, '')))]
    if (!numbers.length) continue
    const refs = [...sentence.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(citation => citation[1]!)
    const citedExcerpts = refs.flatMap(ref => excerpts.filter(excerpt => excerpt.ref === ref))
    const citedSupports = (anchor: typeof anchors[number]) => citedExcerpts.some(excerpt => excerpt.text.includes(anchor)
      && numbers.some(number => excerpt.text.replace(/[,，\s]/g, '').includes(number)))
    const missingAnchors = relevantAnchors.filter(anchor => !citedSupports(anchor))
    if (!missingAnchors.length) continue
    const candidates = [...new Set(excerpts.filter(excerpt => missingAnchors.some(anchor => excerpt.text.includes(anchor))
      && numbers.some(number => excerpt.text.replace(/[,，\s]/g, '').includes(number))).map(excerpt => excerpt.ref))]
    // Identical values can occur in several unrelated tables. Add evidence
    // only when the subject and value together identify one authorized row.
    if (candidates.length !== 1 || refs.includes(candidates[0]!)) continue
    insertions.push({ offset: match.index! + sentence.length, ref: candidates[0]! })
  }
  let repaired = text
  for (const insertion of insertions.sort((left, right) => right.offset - left.offset)) repaired = `${repaired.slice(0, insertion.offset)} [${insertion.ref}]${repaired.slice(insertion.offset)}`
  return repaired
}

type NamedCompetitiveCandidate = {
  readonly entity: string
  readonly finding: CompanyResearchMethodResult['findings'][number]
  readonly publicEvidence: readonly CompanyResearchMethodResult['findings'][number]['evidence'][number][]
  readonly companyRoute?: CompanyResearchMethodResult['findings'][number]
}

function sourceEntityNames(title: string): string[] {
  const tokens = title.match(/[\p{Script=Han}]{2,16}|[A-Za-z][A-Za-z0-9&.-]{2,24}/gu) ?? []
  return [...new Set(tokens.map(token => token.replace(/(?:股份有限公司|有限公司|股份|集团|官网|公司)$/u, '')).filter(token => token.length >= 2))]
}

function namedCompetitiveCandidate(methods: readonly CompanyResearchMethodResult[], sources: CompanyResearchInput['sources'], allowedLocations: ReadonlySet<string>, companyName?: string): NamedCompetitiveCandidate | undefined {
  const competitive = methods.find(method => method.skillId === 'competitive_market_map' && method.status === 'complete')
  if (!competitive) return undefined
  const sourceById = new Map(sources.map(source => [source.candidate.candidateId, source]))
  const publicSources = new Map(sources.filter(source => source.candidate.candidateId.startsWith('public-web-') || source.candidate.kind === 'web_article').map(source => [source.candidate.candidateId, source]))
  const findings = competitive.findings.flatMap(finding => {
    if (!finding.evidence.length) return []
    const refsAreAuthorized = finding.evidence.every(ref => allowedLocations.has(`${ref.sourceCandidateId}@${ref.location}`))
    if (!refsAreAuthorized) return []
    // Keep named-peer facts independent from target-company facts. A finding
    // that combines public competitor and official company refs is not used as
    // the candidate's evidence; company-side route evidence is selected below.
    const publicEvidence = finding.evidence.filter(ref => publicSources.has(ref.sourceCandidateId))
    if (!publicEvidence.length || publicEvidence.length !== finding.evidence.length) return []
    const entity = publicEvidence.flatMap(ref => {
      const source = publicSources.get(ref.sourceCandidateId)!
      return sourceEntityNames(source.title).filter(name => name !== companyName && !(companyName && companyName.includes(name)) && finding.text.includes(name))
    }).sort((left, right) => right.length - left.length)[0]
    if (!entity) return []
    return [{ entity, finding, publicEvidence }]
  })
  const candidate = findings.sort((left, right) => right.entity.length - left.entity.length)[0]
  if (!candidate) return undefined
  const companyRoute = competitive.findings.find(finding => /(?:EML|芯片至模块|光芯片.*模块)/u.test(finding.text)
    && finding.evidence.length > 0
    && finding.evidence.every(ref => allowedLocations.has(`${ref.sourceCandidateId}@${ref.location}`)
      && sourceById.get(ref.sourceCandidateId)?.candidate.kind === 'official_disclosure'))
  return { ...candidate, ...(companyRoute ? { companyRoute } : {}) }
}

function evidenceCitations(evidence: NamedCompetitiveCandidate['publicEvidence']): string {
  return [...new Set(evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`))].join(' ')
}

function repairSynthesisCompetitorDenials(text: string, candidate: NamedCompetitiveCandidate | undefined): string {
  if (!candidate) return text
  const denial = /(?:现有材料)?(?:没有|未提供|未发现|未披露|缺少|无)具名(?:竞品|竞争者|竞争对手|对手)[^。；\n|]*/g
  return text.replace(denial, '具名候选及产品路线见“竞争格局”章节；直接竞标、客户重叠、同口径性能/价格/成本及份额仍未验证')
}

function reconcileCrossMethodCompetitionContext(input: CompanyResearchInput, sections: { id: string; markdown: string; sourceCandidateIds: string[] }[], methods: readonly CompanyResearchMethodResult[], allowedLocations: ReadonlySet<string>): void {
  const candidate = namedCompetitiveCandidate(methods, input.sources, allowedLocations, input.company.name)
  if (!candidate) return
  const citations = evidenceCitations(candidate.publicEvidence)
  const industry = sections.find(section => section.id === 'industry-exposure')
  const companyRoute = candidate.companyRoute
  const industrySentence = '跨章节核对：具名候选及产品路线见“竞争格局”章节；候选或场景相邻不证明直接采购竞争、客户重叠、市场份额或双方属于同一可服务市场。'
  if (industry) {
    if (!industry.markdown.includes('具名候选及产品路线见“竞争格局”章节') && !industry.markdown.includes(candidate.entity)) {
      industry.markdown = `${industry.markdown.trim()}\n\n${industrySentence}`
    }
    industry.sourceCandidateIds = [...new Set([...industry.sourceCandidateIds, ...candidate.publicEvidence.map(ref => ref.sourceCandidateId), ...(companyRoute?.evidence.map(ref => ref.sourceCandidateId) ?? [])])]
  }

  const competition = sections.find(section => section.id === 'competition')
  if (competition && !/历史材料时点限制|来源日期限制/.test(competition.markdown)) {
    const sourceById = new Map(input.sources.map(source => [source.candidate.candidateId, source]))
    const dates = [...new Set(candidate.publicEvidence.flatMap(ref => {
      const publishedAt = sourceById.get(ref.sourceCandidateId)?.candidate.publishedAt
      const match = typeof publishedAt === 'string' ? /^(20\d{2})-(\d{2})-(\d{2})(?:$|T)/.exec(publishedAt) : undefined
      if (!match || match[0].slice(0, 10) >= input.asOf.slice(0, 10)) return []
      return [`${match[1]}年${Number(match[2])}月${Number(match[3])}日`]
    }))].sort()
    if (dates.length) {
      const datePhrase = dates.join('、')
      competition.markdown = `${competition.markdown.trim()}\n\n**历史材料时点限制。** 上述候选判断引用的公开材料发布日期为${datePhrase}${citations}，只能说明相应历史时点的产品与交付信息；本轮没有据此验证截至${input.asOf.slice(0, 10)}的最新出货、产能、客户关系或直接竞争状态。故${candidate.entity}仅保留为历史材料支持的候选对照，当前竞争关系及双方可比性仍待最新同口径资料核验。`
      competition.sourceCandidateIds = [...new Set([...competition.sourceCandidateIds, ...candidate.publicEvidence.map(ref => ref.sourceCandidateId)])]
    }
  }

  const risks = sections.find(section => section.id === 'risks')
  if (risks) {
    if (!risks.markdown.includes('具名候选及产品路线见“竞争格局”章节') && !risks.markdown.includes(candidate.entity)) {
      const riskClarification = '\n\n**竞争风险边界。** 具名候选及产品路线见“竞争格局”章节；候选识别不等于已证实直接竞品。现有材料尚不能确认双方实际客户或招投标重合、市场份额及同口径成本和性能，风险判断限于潜在订单、收入与毛利传导，影响程度未证实。'
      risks.markdown = `${risks.markdown.trim()}${riskClarification}`
    }
    risks.sourceCandidateIds = [...new Set([...risks.sourceCandidateIds, ...candidate.publicEvidence.map(ref => ref.sourceCandidateId), ...(companyRoute?.evidence.map(ref => ref.sourceCandidateId) ?? [])])]
  }
}

export function bindExact2025BydProductMarginSynthesisCitations(markdown: string, methods: readonly CompanyResearchMethodResult[], allowedLocations: ReadonlySet<string>): string {
  const unsupported = '2025年度分产品毛利率分别为20.49%和6.29%，表列毛利率同比变化分别为-1.82%和-2.06%'
  if (!markdown.includes(unsupported)) return markdown
  for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    if (!/2025年年度报告/u.test(packet.title)) continue
    const excerpts = new Map(packet.excerpts.filter(excerpt => allowedLocations.has(`${packet.sourceCandidateId}@${excerpt.location}`)).map(excerpt => [excerpt.location, excerpt.text]))
    const required = ['paragraph:833', 'paragraph:834', 'paragraph:835', 'paragraph:836', 'paragraph:837', 'paragraph:838', 'paragraph:839', 'paragraph:845', 'paragraph:850', 'paragraph:851', 'paragraph:852', 'paragraph:853', 'paragraph:854', 'paragraph:855']
    if (required.some(location => !excerpts.has(location))) continue
    if (excerpts.get('paragraph:833')?.trim() !== '单位：元'
      || !/营业收入/u.test(excerpts.get('paragraph:834')!) || !/营业成本/u.test(excerpts.get('paragraph:834')!)
      || !/毛利率/u.test([834, 835, 836, 837, 838, 839].map(n => excerpts.get(`paragraph:${n}`)).join(' '))
      || excerpts.get('paragraph:845')?.trim() !== '分产品'
      || !/手机部件、组/u.test(excerpts.get('paragraph:850')!) || !/装及其他产品/u.test(excerpts.get('paragraph:851')!)
      || !/6\.29%/u.test(excerpts.get('paragraph:851')!) || !/-2\.06%/u.test(excerpts.get('paragraph:851')!)
      || !/汽车、汽车相/u.test(excerpts.get('paragraph:852')!) || !/关产品及其他/u.test(excerpts.get('paragraph:853')!)
      || !/产品/u.test(excerpts.get('paragraph:854')!) || !/20\.49%/u.test(excerpts.get('paragraph:855')!)
      || !/-1\.82%/u.test(excerpts.get('paragraph:855')!)) continue
    const ref = (paragraph: number) => `[${packet.sourceCandidateId}@paragraph:${paragraph}]`
    const headers = [833, 834, 835, 836, 837, 838, 839, 845].map(ref).join(' ')
    const vehicle = [852, 853, 854, 855].map(ref).join(' ')
    const electronics = [850, 851].map(ref).join(' ')
    const replacement = `2025年度分产品“汽车、汽车相关产品及其他产品”毛利率为20.49%${headers} ${vehicle}；“手机部件、组装及其他产品”毛利率为6.29%${headers} ${electronics}；原表“毛利率比上年同期增减”分别为-1.82%${headers} ${vehicle}和-2.06%${headers} ${electronics}`
    return markdown.replace(unsupported, replacement)
  }
  return markdown
}

function repairSynthesisNumericCitations(text: string, issues: readonly NumericGroundingDiagnostic[], methods: readonly CompanyResearchMethodResult[], sources: CompanyResearchInput['sources'], allowedLocations: ReadonlySet<string>): string {
  let repaired = text
  for (const issue of issues) {
    const token = issue.token.match(/-?[\d,，]+(?:\.\d+)?/)?.[0]
    if (!token) continue
    const issueText = issue.context.replace(/\[[^\]]*\]/g, '')
    if (/Number absent from cited paragraphs/.test(issue.reason)) {
      // A named goodwill original-value row can be omitted from the final
      // citation set even though the same cited annual/interim report was
      // supplied to the owning method. Reconcile only this exact claim shape:
      // same source already cited, one allowed excerpt with the numeric row,
      // and nearby same-packet context naming both the entity and metric.
      if (/Juno\s+Newco/i.test(issueText) && /商誉原值/.test(issueText)) {
        const normalizeClaim = (value: string) => value.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, '').replace(/[。；;！？!?]+$/g, '')
        const normalizedIssue = normalizeClaim(issueText)
        const hasGoodwillIssueContext = /Juno\s*Newco/i.test(normalizedIssue) && /商誉原值/.test(normalizedIssue)
          && normalizedIssue.replace(/[,，\s]/g, '').includes(token.replace(/[,，\s]/g, ''))
        const claims = (repaired.match(/[^。；;！？!?\n]+[。；;！？!?]?(?:\s*\[[^\]\s]+@paragraph:\d+\])*/g) ?? [])
          .filter(claim => (normalizeClaim(claim) === normalizedIssue || hasGoodwillIssueContext)
            && /Juno\s*Newco/i.test(claim)
            && /商誉原值/.test(claim)
            && claim.replace(/[,，\s]/g, '').includes(token.replace(/[,，\s]/g, '')))
        if (claims.length === 1) {
          const claim = claims[0]!
          const citedSourceIds = new Set([...claim.matchAll(/\[([^\]@\s]+)@paragraph:\d+\]/g)].map(match => match[1]!))
          const numericValue = Number(token.replace(/[,，]/g, ''))
          const candidates = new Set<string>()
          for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
            if (!citedSourceIds.has(packet.sourceCandidateId)) continue
            const allowedExcerpts = packet.excerpts.filter(excerpt => allowedLocations.has(`${packet.sourceCandidateId}@${excerpt.location}`))
            for (const excerpt of allowedExcerpts) {
              const excerptHasNumber = [...excerpt.text.matchAll(/(?<![\d.])-?[\d,，]+(?:\.\d+)?(?![\d.])/g)]
                .some(match => Number(match[0]!.replace(/[,，]/g, '')) === numericValue)
              if (!excerptHasNumber || !/Juno\s+Newco/i.test(excerpt.text)) continue
              const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1] ?? 0)
              if (!Number.isInteger(paragraph) || paragraph < 1) continue
              const nearby = allowedExcerpts.filter(item => {
                const itemParagraph = Number(/^paragraph:(\d+)$/.exec(item.location)?.[1] ?? 0)
                return itemParagraph >= paragraph - 12 && itemParagraph <= paragraph + 2
              })
              const metricHeading = nearby
                .filter(item => Number(item.location.slice('paragraph:'.length)) <= paragraph && /商誉原值/.test(item.text))
                .sort((a, b) => Number(b.location.slice('paragraph:'.length)) - Number(a.location.slice('paragraph:'.length)))[0]
              const interveningDifferentMetric = metricHeading && nearby.some(item => {
                const itemParagraph = Number(item.location.slice('paragraph:'.length))
                const headingParagraph = Number(metricHeading.location.slice('paragraph:'.length))
                return itemParagraph > headingParagraph && itemParagraph < paragraph && /商誉减值准备/.test(item.text)
              })
              if (metricHeading && !interveningDifferentMetric) candidates.add(`${packet.sourceCandidateId}@${excerpt.location}`)
            }
          }
          if (candidates.size === 1) {
            const ref = [...candidates][0]!
            const claimStart = repaired.indexOf(claim)
            const tokenMatches = [...claim.matchAll(new RegExp(`(?<![\\d.,，])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d.,，])`, 'g'))]
            if (claimStart >= 0 && tokenMatches.length === 1 && !claim.includes(`[${ref}]`)) {
              const insertion = claimStart + tokenMatches[0]!.index! + tokenMatches[0]![0].length
              repaired = `${repaired.slice(0, insertion)}[${ref}]${repaired.slice(insertion)}`
            }
          }
        }
      }
      const productRows = new Set<string>()
      const normalizedToken = token.replace(/[,，]/g, '')
      for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
        if (!/(?:年度报告|半年度报告)/.test(packet.title)) continue
        for (const excerpt of packet.excerpts) {
          if (!allowedLocations.has(`${packet.sourceCandidateId}@${excerpt.location}`) || !excerpt.text.replace(/[,，\s]/g, '').includes(normalizedToken)) continue
          const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1] ?? 0)
          const prior = packet.excerpts.filter(item => {
            const itemParagraph = Number(/^paragraph:(\d+)$/.exec(item.location)?.[1] ?? 0)
            return itemParagraph < paragraph && itemParagraph >= paragraph - 25
          })
          const segment = prior.filter(item => /^分(?:产品|行业|地区|销售模式|销售渠道)$/.test(item.text.trim())).sort((a, b) => Number(b.location.slice(10)) - Number(a.location.slice(10)))[0]
          const isRevenueComposition = prior.some(item => /营业收入构成/.test(item.text))
          const isProductRevenueRow = /^[\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,30}\s+[\d,，]+(?:\.\d+)?\s+[\d.]+%/.test(excerpt.text.trim())
          if (segment?.text.trim() === '分产品' && isRevenueComposition && isProductRevenueRow) productRows.add(`${packet.sourceCandidateId}@${excerpt.location}`)
        }
      }
      if (productRows.size === 1) {
        const ref = [...productRows][0]!
        const pattern = new RegExp(`(?<![\\d.,])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d.,])`)
        const match = pattern.exec(repaired)
        if (match && !repaired.slice(Math.max(0, match.index - 2), match.index + match[0].length + 80).includes(`[${ref}]`)) {
          const insertion = match.index + match[0].length
          repaired = `${repaired.slice(0, insertion)}[${ref}]${repaired.slice(insertion)}`
        }
      }
    }
    // Product margin tables can repeat a value found in an industry row.
    // Bind a numeric synthesis claim only when its quoted product label,
    // split label continuation, product section heading, table headers,
    // unit, and exact numeric row uniquely agree in this report packet.
    const compact = (value: string) => value.replace(/[,，\s]/g, '')
    const quotedProducts = [...repaired.matchAll(/[“「『"]([^”」』"]{2,50})[”」』"]/g)].map(match => match[1]!.trim())
    if (quotedProducts.length) {
      const claims = (repaired.match(/[^。；;！？!?\n]+[。；;！？!?]?(?:\s*\[[^\]\s]+@paragraph:\d+\])*/g) ?? [])
        .filter(claim => compact(claim).includes(compact(token)) && quotedProducts.some(label => compact(claim).includes(compact(label))))
      if (claims.length === 1) {
        const claim = claims[0]!
        const labels = quotedProducts.filter(label => compact(claim).includes(compact(label)))
        const candidates = new Map<string, string[]>()
        for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
          if (!/(?:19|20)\d{2}年.*(?:年度|半年度)报告/u.test(packet.title)) continue
          const entries = packet.excerpts.flatMap(excerpt => {
            const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1] ?? 0)
            return paragraph > 0 && allowedLocations.has(`${packet.sourceCandidateId}@${excerpt.location}`) ? [{ ...excerpt, paragraph }] : []
          }).sort((a, b) => a.paragraph - b.paragraph)
          for (const row of entries) {
            if (!compact(row.text).includes(compact(token)) || !/%|％/.test(row.text)) continue
            const productHeadings = entries.filter(item => item.paragraph < row.paragraph && item.paragraph >= row.paragraph - 25 && /^分产品$/.test(item.text.trim()))
            const heading = productHeadings.at(-1)
            if (!heading || entries.some(item => item.paragraph > heading.paragraph && item.paragraph < row.paragraph && /^分(?:行业|地区|销售模式|销售渠道)$/.test(item.text.trim()))) continue
            const labelParts = entries.filter(item => item.paragraph >= Math.max(heading.paragraph + 1, row.paragraph - 3) && item.paragraph < row.paragraph
              && !/\d/.test(item.text) && !/^(?:单位|营业收入|营业成本|毛利率|同期增减)/.test(item.text.trim()))
            const labelText = compact([...labelParts.map(item => item.text), row.text].join(''))
            const label = labels.find(value => labelText.includes(compact(value)))
            if (!label || !labelParts.length) continue
            const nearby = entries.filter(item => item.paragraph < heading.paragraph && item.paragraph >= heading.paragraph - 20)
            const unit = nearby.filter(item => /^单位\s*[:：]/.test(item.text.trim())).at(-1)
            const headers = nearby.filter(item => /营业收入|营业成本|毛利率|同期增减/.test(item.text))
            if (!unit || !headers.some(item => /营业收入/.test(item.text)) || !headers.some(item => /营业成本/.test(item.text)) || !headers.some(item => /毛利率/.test(item.text))) continue
            const refs = [...new Set([unit, ...headers, heading, ...labelParts, row].map(item => `${packet.sourceCandidateId}@${item.location}`))]
            candidates.set(`${packet.sourceCandidateId}@${row.location}`, refs)
          }
        }
        if (candidates.size === 1) {
          const refs = [...candidates.values()][0]!
          const start = repaired.indexOf(claim)
          const current = new Set([...claim.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(match => match[1]!))
          const missing = refs.filter(ref => !current.has(ref))
          if (start >= 0 && missing.length) {
            const punctuation = /([。；;！？!?])$/.exec(claim)?.[1] ?? ''
            const body = punctuation ? claim.slice(0, -punctuation.length) : claim
            const replacement = `${body} ${missing.map(ref => `[${ref}]`).join(' ')}${punctuation}`
            repaired = `${repaired.slice(0, start)}${replacement}${repaired.slice(start + claim.length)}`
          }
        }
      }
    }
    if (/Number absent from cited paragraphs/.test(issue.reason) && /客户|供应商/.test(issueText)) {
      const rankedRows = new Set<string>()
      for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
        for (const excerpt of packet.excerpts) {
          if (!allowedLocations.has(`${packet.sourceCandidateId}@${excerpt.location}`)) continue
          const compact = excerpt.text.replace(/[,，\s]/g, '')
          if (!compact.includes(token.replace(/[,，\s]/g, ''))) continue
          const subjectMatches = /第二名/.test(issueText) ? /第二名/.test(excerpt.text)
            : /第一名|最大客户/.test(issueText) ? /第一名|最大客户/.test(excerpt.text)
              : /前五名|前五大/.test(issueText) ? /前五名|前五大/.test(excerpt.text)
                : /供应商/.test(issueText) ? /供应商|第一名/.test(excerpt.text)
                  : /客户/.test(excerpt.text)
          if (subjectMatches && /[%％]/.test(excerpt.text)) rankedRows.add(`${packet.sourceCandidateId}@${excerpt.location}`)
        }
      }
      if (rankedRows.size === 1) {
        const ref = [...rankedRows][0]!
        const numberPattern = new RegExp(`(?<![\\d.,])${token.replace('.', '\\.')}(?![\\d.,])`)
        const match = numberPattern.exec(repaired)
        if (match) {
          const lineStart = repaired.lastIndexOf('\n', match.index) + 1
          const lineEndIndex = repaired.indexOf('\n', match.index + match[0].length)
          const lineEnd = lineEndIndex < 0 ? repaired.length : lineEndIndex
          const pipeStart = repaired.lastIndexOf('|', match.index)
          const pipeEndIndex = repaired.indexOf('|', match.index + match[0].length)
          const isTableCell = pipeStart >= lineStart && pipeEndIndex >= 0 && pipeEndIndex < lineEnd
          const insertionPoint = isTableCell ? pipeEndIndex : lineEnd
          const claim = repaired.slice(isTableCell ? pipeStart + 1 : lineStart, insertionPoint)
          if (/客户|供应商/.test(claim) && !claim.includes(`[${ref}]`)) repaired = `${repaired.slice(0, insertionPoint).trimEnd()} [${ref}]${repaired.slice(insertionPoint)}`
        }
      }
    }
    // High-speed product rates may be split across PDF paragraphs and are
    // validated as exact technology identifiers. If the claim already cites
    // a neighboring row but omitted the unique paragraph containing that
    // exact identifier, attach only that source-backed locator.
    if (/Technology quantity and unit absent/.test(issue.reason)) {
      const amount = Number(token.replace(/,/g, ''))
      const escapedToken = token.replace('.', '\\.')
      const technology = new RegExp(`(?<![\\d.])${escapedToken}\\s*(G|T)(?:bps)?(?=$|[^A-Za-z0-9])(?:\\s*PAM4)?(?:\\s*EML)?`, 'i').exec(issueText)
      if (technology) {
        const unit = technology[1]!.toUpperCase()
        const exact = new RegExp(`(?<![\\d.])${amount}(?:\\s*)${unit}(?:bps)?(?=(?:PAM4|EML)|$|[^A-Za-z0-9])(?:\\s*PAM4)?(?:\\s*EML)?`, 'i')
        const candidates = new Set<string>()
        const adjacentCandidates = new Set<string>()
        for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
          const excerpts = packet.excerpts.filter(excerpt => allowedLocations.has(`${packet.sourceCandidateId}@${excerpt.location}`))
          for (const excerpt of excerpts) {
            const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
            if (!Number.isInteger(paragraph) || paragraph < 1) continue
            if (exact.test(excerpt.text)) candidates.add(`${packet.sourceCandidateId}@${excerpt.location}`)
            const adjacent = excerpts.filter(candidate => {
              const candidateParagraph = Number(/^paragraph:(\d+)$/.exec(candidate.location)?.[1])
              return candidateParagraph >= paragraph && candidateParagraph <= paragraph + 1
            })
            if (!exact.test(excerpt.text) && exact.test(adjacent.map(candidate => candidate.text).join(' '))) {
              for (const candidate of adjacent) adjacentCandidates.add(`${packet.sourceCandidateId}@${candidate.location}`)
            }
          }
        }
        // An exact locator can be authorized by a validated finding even when
        // that paragraph was not retained in the compact method excerpt packet.
        // Resolve it from the already-acquired source body only when the same
        // unique, exact technology identifier is present at that allowed row.
        for (const source of sources) {
          const prefix = `${source.candidate.candidateId}@paragraph:`
          for (const ref of allowedLocations) {
            if (!ref.startsWith(prefix)) continue
            const paragraph = Number(ref.slice(prefix.length))
            if (!Number.isInteger(paragraph) || paragraph < 1) continue
            const line = source.content.split(/\r?\n/)[paragraph - 1]
            if (line && exact.test(line)) candidates.add(ref)
          }
        }
        if (!candidates.size) for (const candidate of adjacentCandidates) candidates.add(candidate)
        if (candidates.size === 1) {
          const ref = [...candidates][0]!
          const claimToken = new RegExp(`(?<![\\d.])${escapedToken}\\s*${unit}(?:bps)?(?=(?:PAM4|EML)|$|[^A-Za-z0-9])(?:\\s*PAM4)?(?:\\s*EML)?`, 'i')
          const match = claimToken.exec(repaired)
          if (match) {
            const lineStart = Math.max(repaired.lastIndexOf('\n', match.index), repaired.lastIndexOf('。', match.index), repaired.lastIndexOf('；', match.index), repaired.lastIndexOf('！', match.index), repaired.lastIndexOf('？', match.index)) + 1
            const pipeStart = repaired.lastIndexOf('|', match.index)
            const start = Math.max(lineStart, pipeStart + 1)
            const possibleEnds = ['|', '\n', '。', '；', '！', '？'].map(mark => repaired.indexOf(mark, match.index + match[0].length)).filter(index => index >= 0)
            const end = possibleEnds.length ? Math.min(...possibleEnds) : repaired.length
            const claim = repaired.slice(start, end)
            if (!claim.includes(`[${ref}]`)) repaired = `${repaired.slice(0, end).trimEnd()} [${ref}]${repaired.slice(end)}`
          }
        }
      }
    }
    // A split PDF table may contain the same percentage-point value under
    // both an industry row and a product row. Repair only the unique, exact
    // industry row and its minimum source-backed context; never let the
    // duplicate product row become a substitute citation.
    const marginPattern = /([\u3400-\u9fffA-Za-z0-9·（）()]{2,32}制造业)[^。；;\n]{0,36}?毛利率[^。；;\n]{0,32}?(?:同比|比上年同期)(?:(上升|增加|提高|下降|减少|降低|增减)\s*)?([+-]?\d[\d,，]*(?:\.\d+)?)\s*(个百分点|百分点|[%％])/g
    const issueMarginClaims = [...issueText.matchAll(marginPattern)]
    const issueMarginClaim = issueMarginClaims.find(claim => Number(token.replace(/,/g, '')) === Number(claim[3]!.replace(/[,，]/g, '')))
    // Numeric-grounding diagnostics may shorten their context. Resolve the
    // label and occurrence against the final text so repeated values cannot
    // make a neighboring industry's row look like the target.
    const textMarginClaims = [...repaired.matchAll(marginPattern)]
      .filter(claim => Number(token.replace(/,/g, '')) === Number(claim[3]!.replace(/[,，]/g, '')))
    const issueLabel = issueMarginClaim?.[1]?.replace(/\s+/g, '')
    const matchingTextClaims = issueLabel
      ? textMarginClaims.filter(claim => claim[1]!.replace(/\s+/g, '') === issueLabel)
      : textMarginClaims
    const marginClaim = matchingTextClaims.length === 1 ? matchingTextClaims[0] : undefined
    if (marginClaim) {
      const label = marginClaim[1]!.replace(/\s+/g, '')
      const directionWord = marginClaim[2] ?? ''
      const explicitDirection = /(?:下降|减少|降低)/.test(directionWord) ? -1 : /(?:上升|增加|提高)/.test(directionWord) ? 1 : 0
      const amount = Number(token.replace(/[,，]/g, ''))
      const expectedSign = explicitDirection || (marginClaim[3]!.startsWith('-') ? -1 : marginClaim[3]!.startsWith('+') ? 1 : 0)
      const reportsPercentChange = /[%％]/.test(marginClaim[4]!)
      const packages = new Map<string, { readonly refs: readonly string[]; readonly sourceCandidateId: string; readonly rowParagraphs: readonly number[] }>()
      for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
        const excerpts = packet.excerpts.filter(excerpt => allowedLocations.has(`${packet.sourceCandidateId}@${excerpt.location}`))
        const byParagraph = new Map(excerpts.flatMap(excerpt => {
          const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
          return Number.isInteger(paragraph) && paragraph > 0 ? [[paragraph, excerpt] as const] : []
        }))
        const rows = excerpts.flatMap(excerpt => {
          const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
          if (!Number.isInteger(paragraph) || paragraph < 1) return []
          const previous = byParagraph.get(paragraph - 1)
          const next = byParagraph.get(paragraph + 1)
          const options = [
            { text: excerpt.text, paragraphs: [paragraph] },
            ...(next && !/\d/.test(excerpt.text) ? [{ text: `${excerpt.text} ${next.text}`, paragraphs: [paragraph, paragraph + 1] }] : []),
            ...(previous && !/\d/.test(previous.text) && !/^\s*分(?:行业|产品|地区)\s*$/.test(previous.text) ? [{ text: `${previous.text} ${excerpt.text}`, paragraphs: [paragraph - 1, paragraph] }] : []),
          ]
          return options.flatMap(option => {
            const normalized = option.text.replace(/\s+/g, ' ')
            if (!normalized.replace(/\s/g, '').includes(label)) return []
            const labelAt = normalized.replace(/\s/g, '').indexOf(label)
            const normalizedAfterLabel = normalized.slice(Math.min(labelAt + label.length, normalized.length))
            const percentages = [...normalizedAfterLabel.matchAll(/([+-]?\d[\d,，]*(?:\.\d+)?)\s*[%％]/g)]
            const finalPercent = percentages.at(-1)?.[1]
            const finalValue = finalPercent === undefined ? Number.NaN : Number(finalPercent.replace(/[,，]/g, ''))
            if (!Number.isFinite(finalValue) || Math.abs(finalValue) !== amount || (expectedSign !== 0 && Math.sign(finalValue) !== expectedSign)) return []
            return [{ paragraph, rowParagraphs: option.paragraphs }]
          })
        })
        for (const row of rows) {
          const section = excerpts.filter(excerpt => {
            const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
            return paragraph < row.paragraph && paragraph >= row.paragraph - 32 && /^\s*分(?:行业|产品|地区)\s*$/.test(excerpt.text)
          }).sort((left, right) => Number(right.location.split(':')[1]) - Number(left.location.split(':')[1]))[0]
          if (!section || section.text.trim() !== '分行业') continue
          const sectionParagraph = Number(section.location.split(':')[1])
          const precedingSections = excerpts.filter(excerpt => {
            const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
            return paragraph > sectionParagraph && paragraph < row.paragraph && /^\s*分(?:行业|产品|地区)\s*$/.test(excerpt.text)
          })
          if (precedingSections.length) continue
          const headerEnds = excerpts.filter(excerpt => {
            const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
            return paragraph < sectionParagraph && paragraph >= sectionParagraph - 10 && /(?:增减|变动|变化)\s*$/.test(excerpt.text.trim())
          }).sort((left, right) => Number(right.location.split(':')[1]) - Number(left.location.split(':')[1])).slice(0, 1)
          const headerPackages = headerEnds.flatMap(end => {
            const endParagraph = Number(end.location.split(':')[1])
            for (let startParagraph = endParagraph; startParagraph >= Math.max(1, endParagraph - 5); startParagraph--) {
              const parts = Array.from({ length: endParagraph - startParagraph + 1 }, (_, index) => byParagraph.get(startParagraph + index))
              if (parts.some(part => !part)) continue
              const headerText = parts.map(part => part!.text).join('').replace(/\s+/g, '')
              if (/毛利率.{0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(headerText)) return [parts.map(part => part!.location)]
            }
            return []
          })
          if (headerPackages.length !== 1) continue
          const headerParagraph = Math.min(...headerPackages[0]!.map(location => Number(location.split(':')[1])))
          const units = excerpts.filter(excerpt => {
            const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
            return paragraph < headerParagraph && paragraph >= headerParagraph - 20 && /^\s*单位\s*[:：]/.test(excerpt.text)
          }).sort((left, right) => Number(right.location.split(':')[1]) - Number(left.location.split(':')[1]))
          if (units.length !== 1) continue
          const rowRefs = row.rowParagraphs.map(paragraph => `${packet.sourceCandidateId}@paragraph:${paragraph}`)
          const refs = [...new Set([`${packet.sourceCandidateId}@${units[0]!.location}`, ...headerPackages[0]!.map(location => `${packet.sourceCandidateId}@${location}`), `${packet.sourceCandidateId}@${section.location}`, ...rowRefs])]
          if (!refs.every(ref => allowedLocations.has(ref))) continue
          const key = refs.slice().sort().join('|')
          packages.set(key, { refs, sourceCandidateId: packet.sourceCandidateId, rowParagraphs: row.rowParagraphs })
        }
      }
      if (packages.size === 1) {
        const selected = [...packages.values()][0]!
          const claimUnitPattern = reportsPercentChange ? '[%％]' : '个(?:百)?分点'
          const claimPattern = new RegExp(`${label}[^。；;\\n]{0,36}?毛利率[^。；;\\n]{0,32}?(?:同比|比上年同期)(?:上升|增加|提高|下降|减少|降低|增减)?\\s*[+-]?${token.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*${claimUnitPattern}`)
        const match = claimPattern.exec(repaired)
        if (match) {
          const paragraphStart = repaired.lastIndexOf('\n', match.index) + 1
          const paragraphBoundary = repaired.indexOf('\n', match.index)
          const paragraphEnd = paragraphBoundary < 0 ? repaired.length : paragraphBoundary
          const paragraph = repaired.slice(paragraphStart, paragraphEnd)
          const relativeClaimEnd = match.index + match[0].length - paragraphStart
          const delimiters = ['；', ';', '。', '！', '？']
            .map(value => ({ value, index: paragraph.indexOf(value, relativeClaimEnd) }))
            .filter(item => item.index >= 0)
            .sort((left, right) => left.index - right.index)
          const delimiter = delimiters[0]
          if (!delimiter) continue

          const sameParagraphClaims = [...paragraph.matchAll(marginPattern)]
          const isLastMarginClaim = sameParagraphClaims.every(claim => (claim.index ?? -1) <= match.index - paragraphStart)
          const sourceCitation = new RegExp(`^${selected.sourceCandidateId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}@paragraph:\\d+$`)
          let nextParagraph = paragraph
          let insertAt = delimiter.index

          // When this is the last industry-margin claim in the paragraph,
          // replace its legacy paragraph-tail bundle with the exact package.
          // Earlier claims keep their own inline references, so a later claim
          // in the same paragraph cannot inherit the first row's evidence.
          if (isLastMarginClaim) {
            const tailStartMatch = /(?:\s*\[[^\]\s]+@paragraph:\d+\])+\s*$/.exec(nextParagraph)
            if (tailStartMatch) {
              const tailStart = tailStartMatch.index
              const tail = nextParagraph.slice(tailStart)
              const hasTargetSource = [...tail.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].some(ref => sourceCitation.test(ref[1]!))
              if (hasTargetSource) {
                const otherSourceRefs = [...tail.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)]
                  .filter(ref => !sourceCitation.test(ref[1]!))
                  .map(ref => ` [${ref[1]}]`)
                  .join('')
                nextParagraph = `${nextParagraph.slice(0, tailStart)}${otherSourceRefs}`
                insertAt = Math.min(insertAt, nextParagraph.length)
              }
            }
          }

          // Replace same-source references already attached to this clause,
          // placing the exact package before its punctuation. References on
          // other clauses and from other sources remain in place.
          const beforeDelimiter = nextParagraph.slice(0, insertAt)
          const attachedBefore = /((?:\s*\[[^\]\s]+@paragraph:\d+\])+\s*)$/.exec(beforeDelimiter)
          if (attachedBefore) {
            const refs = [...attachedBefore[1]!.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)]
            const retained = refs.filter(ref => !sourceCitation.test(ref[1]!)).map(ref => ` [${ref[1]}]`).join('')
            const start = insertAt - attachedBefore[1]!.length
            nextParagraph = `${nextParagraph.slice(0, start)}${retained}${nextParagraph.slice(insertAt)}`
            insertAt = start + retained.length
          }
          const citationBundle = selected.refs.map(ref => ` [${ref}]`).join('')
          nextParagraph = `${nextParagraph.slice(0, insertAt)}${citationBundle}${nextParagraph.slice(insertAt)}`
          repaired = `${repaired.slice(0, paragraphStart)}${nextParagraph}${repaired.slice(paragraphEnd)}`
          continue
        }
      }
    }
    // Short metric subjects such as “客户” and “商誉” are essential for
    // disambiguating repeated numeric values in adjacent disclosure tables
    // (for example, a customer-concentration subtotal and its duplicate total
    // row). Keep those anchors while excluding generic period/account words.
    const terms = [...new Set([
      ...(issueText.match(/[\u3400-\u9fff]{2,}/g) ?? []),
      ...(['客户','供应商','商誉','存货','应收','研发'] as const).filter(anchor => issueText.includes(anchor)),
    ])].filter(term => term.length >= 3 || ['客户','供应商','商誉','存货','应收','研发'].includes(term)).filter(term => !['营业收入','归母净利','同比公式','上半年累计','上年同期'].includes(term))
    const candidatesByKey = methods.flatMap(method => [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]).flatMap(packet => packet.excerpts.filter(excerpt => {
      const ref = `${packet.sourceCandidateId}@${excerpt.location}`
      const normalized = excerpt.text.replace(/[,，\s]/g, '')
      return allowedLocations.has(ref) && normalized.includes(token.replace(/[,，\s]/g, '')) && terms.some(term => excerpt.text.includes(term))
    }).map(excerpt => [`${packet.sourceCandidateId}@${excerpt.location}`, { sourceCandidateId: packet.sourceCandidateId, location: excerpt.location, text: excerpt.text }] as const))
    const candidates = [...new Map(candidatesByKey).values()]
    if (candidates.length !== 1) continue
    const index = repaired.indexOf(token)
    if (index < 0) continue
    const lineStart = Math.max(repaired.lastIndexOf('\n', index), repaired.lastIndexOf('。', index), repaired.lastIndexOf('；', index), repaired.lastIndexOf('！', index), repaired.lastIndexOf('？', index)) + 1
    const endings = ['。','；','！','？','\n'].map(mark => { const at = repaired.indexOf(mark, index + token.length); return at < 0 ? Infinity : at }).filter(Number.isFinite)
    const end = endings.length ? Math.min(...endings) : repaired.length
    const claim = repaired.slice(lineStart, end)
    const candidate = candidates[0]!
    if (claim.includes(`[${candidate.sourceCandidateId}@${candidate.location}]`)) continue
    const locator = ` [${candidate.sourceCandidateId}@${candidate.location}]`
    repaired = `${repaired.slice(0, end)}${locator}${repaired.slice(end)}`
  }
  return repaired
}

type ProductSynthesisEvidence = { readonly sourceCandidateId: string; readonly location: string; readonly title: string; readonly text: string }

type AnnualProductRow = { readonly sourceCandidateId: string; readonly year: number; readonly paragraph: number; readonly label: string; readonly references: readonly string[]; readonly text: string }

function annualReportYear(title: string): number | undefined {
  if (!/(?:年度报告|年报)/.test(title) || /(?:半年度|季度)/.test(title)) return undefined
  const year = /(?:19|20)\d{2}/.exec(title)?.[0]
  return year ? Number(year) : undefined
}

function productLabelKey(value: string): string {
  return value.replace(/[\d,，.。；、\s:：()（）%、%/\\|_—-]/g, '')
    .replace(/及其他产品|其他产品|产品$/g, '')
    .replace(/^(?:分产品|产品类别|产品名称)/g, '')
}

function productLabelsMatch(left: string, right: string): boolean {
  const a = productLabelKey(left)
  const b = productLabelKey(right)
  if (a.length < 2 || b.length < 2) return false
  if (a.includes(b) || b.includes(a)) return true
  const bigrams = (value: string) => new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)))
  const leftPairs = bigrams(a)
  const rightPairs = bigrams(b)
  const overlap = [...leftPairs].filter(pair => rightPairs.has(pair)).length
  return overlap / Math.max(1, Math.min(leftPairs.size, rightPairs.size)) >= 0.65
}

function annualProductRows(evidence: readonly ProductSynthesisEvidence[], allowedLocations: ReadonlySet<string>, year: number): AnnualProductRow[] {
  const reports = new Map<string, { title: string; excerpts: Map<number, ProductSynthesisEvidence> }>()
  for (const excerpt of evidence) {
    if (annualReportYear(excerpt.title) !== year) continue
    const paragraph = /^paragraph:(\d+)$/.exec(excerpt.location)?.[1]
    if (!paragraph) continue
    const report = reports.get(excerpt.sourceCandidateId) ?? { title: excerpt.title, excerpts: new Map<number, ProductSynthesisEvidence>() }
    report.excerpts.set(Number(paragraph), excerpt)
    reports.set(excerpt.sourceCandidateId, report)
  }
  const rows: AnnualProductRow[] = []
  for (const [sourceCandidateId, report] of reports) {
    const excerpts = report.excerpts
    for (const [paragraph, row] of excerpts) {
      if (!/(?<!\d)[\d,，]{5,}(?:\.\d+)?(?!\d)/.test(row.text)) continue
      const segment = [...excerpts.entries()].filter(([candidateParagraph, candidate]) => candidateParagraph < paragraph
        && candidateParagraph >= paragraph - 12
        && candidate.text.trim() === '分产品'
        && ![...excerpts.entries()].some(([betweenParagraph, between]) => betweenParagraph > candidateParagraph && betweenParagraph < paragraph && /^分(?:行业|地区|销售模式|销售渠道)$/.test(between.text.trim())))
        .sort((left, right) => right[0] - left[0])[0]
      if (!segment) continue

      const labelParts: string[] = []
      const firstNumber = /(?<!\d)[\d,，]{5,}(?:\.\d+)?(?!\d)/.exec(row.text)?.index ?? row.text.length
      const currentPrefix = row.text.slice(0, firstNumber).trim()
      if (currentPrefix && !/^(?:营业收入|营业成本|毛利率|收入|成本|占比|同比)/.test(currentPrefix)) labelParts.unshift(currentPrefix)
      const labelParagraphs: number[] = []
      for (let offset = 1; offset <= 4; offset++) {
        const prior = excerpts.get(paragraph - offset)
        if (!prior || paragraph - offset <= segment[0] || /^分(?:行业|产品|地区|销售模式|销售渠道)$/.test(prior.text.trim())
          || /(?<!\d)[\d,，]{5,}(?:\.\d+)?(?!\d)/.test(prior.text)
          || /^(?:单位|营业收入|营业成本|毛利率|年同期增减|上年同期)/.test(prior.text.trim())) break
        labelParts.unshift(prior.text.trim())
        labelParagraphs.unshift(paragraph - offset)
      }
      const label = labelParts.join('').replace(/\s/g, '')
      if (productLabelKey(label).length < 2) continue
      const refs = [...labelParagraphs.map(labelParagraph => `${sourceCandidateId}@paragraph:${labelParagraph}`), `${sourceCandidateId}@${row.location}`]
      rows.push({ sourceCandidateId, year, paragraph, label, references: refs.filter(ref => allowedLocations.has(ref)), text: row.text })
    }
  }
  return rows
}

function uniqueAnnualProductRow(evidence: readonly ProductSynthesisEvidence[], allowedLocations: ReadonlySet<string>, year: number, label: string, amounts: readonly string[] = []): AnnualProductRow | undefined {
  const normalizedAmounts = amounts.map(value => value.replace(/[,，\s]/g, ''))
  const rows = annualProductRows(evidence, allowedLocations, year).filter(row => productLabelsMatch(label, row.label)
    && normalizedAmounts.every(amount => row.text.replace(/[,，\s]/g, '').includes(amount))
    && allowedLocations.has(`${row.sourceCandidateId}@paragraph:${row.paragraph}`))
  return rows.length === 1 ? rows[0] : undefined
}

/** Keep annual product amounts attached to the exact product row that reports them. */
function reconcileProductSectionCitations(markdown: string, evidence: readonly ProductSynthesisEvidence[], allowedLocations: ReadonlySet<string>): string {
  // Keep the locator that directly supports a lifecycle claim first when a
  // product matrix row carries several citations for separate cells. Reviewers
  // should encounter the lifecycle evidence before a nearby specification or
  // pricing reference from the same row.
  let repaired = markdown.split(/\r?\n/).map(line => {
    if (!line.trimStart().startsWith('|') || !/下线/.test(line)) return line
    const references = [...new Set([...line.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(match => match[1]!))]
    const lifecycle = references.filter(ref => {
      if (!allowedLocations.has(ref)) return false
      const item = evidence.find(candidate => `${candidate.sourceCandidateId}@${candidate.location}` === ref)
      return !!item && /下线/.test(item.text)
    })
    if (!lifecycle.length) return line
    const ordered = [...lifecycle, ...references.filter(ref => !lifecycle.includes(ref))]
    const citations = ordered.map(ref => `[${ref}]`).join(' ')
    return line.replace(/(?:\s*\[[^\]\s]+@paragraph:\d+\])+/, ` ${citations}`)
  }).join('\n')
  const annualLines = repaired.split(/\r?\n/).map(line => {
    if (!line.trimStart().startsWith('|')) return line
    const amounts = [...line.matchAll(/(?<!\d)[\d,，]{5,}(?:\.\d+)?(?!\d)/g)].map(match => match[0]!.replace(/[,，]/g, ''))
    const year = /((?:19|20)\d{2})年/.exec(line)?.[1]
    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean)
    const label = cells[0]
    if (amounts.length < 2 || !year || !label || !/(?:年报|年度报告)/.test(line)) return line
    const row = uniqueAnnualProductRow(evidence, allowedLocations, Number(year), label, amounts.slice(0, 2))
    if (!row) return line
    const retained = [...line.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(match => match[1]!).filter(ref => {
      if (!ref.startsWith(`${row.sourceCandidateId}@`)) return true
      const excerpt = evidence.find(item => `${item.sourceCandidateId}@${item.location}` === ref)
      return !!excerpt && /^(?:单位[:：]|营业收入|营业成本|毛利率|收入（元）|成本（元）)/.test(excerpt.text.trim())
    })
    const citations = [...new Set([...retained, ...row.references])].map(ref => `[${ref}]`)
    const withoutAnnualRefs = line.replace(/\s*\[([^\]\s]+@paragraph:\d+)\]/g, (citation, ref: string) => ref.startsWith(`${row.sourceCandidateId}@`) ? '' : citation)
    const pipe = withoutAnnualRefs.lastIndexOf('|')
    const prefix = pipe >= 0 ? withoutAnnualRefs.slice(0, pipe).trimEnd() : withoutAnnualRefs.trimEnd()
    const suffix = pipe >= 0 ? withoutAnnualRefs.slice(pipe) : ''
    return `${prefix} ${citations.join(' ')} ${suffix}`
  })
  repaired = annualLines.join('\n')

  repaired = repaired.replace(/[^。！？\n]*(?:19|20)\d{2}年年报[^。！？\n]*产品名称[^。！？\n]*[。！？]?/g, sentence => {
    const year = /((?:19|20)\d{2})年年报/.exec(sentence)?.[1]
    if (!year) return sentence
    const labels = [...sentence.matchAll(/[“「『\"]([^”」』\"]{2,50})[”」』\"]/g)].map(match => match[1]!.trim())
    if (labels.length < 2) return sentence
    const rows = labels.map(label => uniqueAnnualProductRow(evidence, allowedLocations, Number(year), label))
    if (rows.some(row => !row) || new Set(rows.map(row => `${row!.sourceCandidateId}@paragraph:${row!.paragraph}`)).size !== rows.length) return sentence
    const references = [...new Set(rows.flatMap(row => row!.references))]
    if (!references.length) return sentence
    const missing = references.filter(ref => !sentence.includes(`[${ref}]`))
    if (!missing.length) return sentence
    const punctuation = /[。！？]$/.test(sentence) ? sentence.slice(-1) : ''
    const body = punctuation ? sentence.slice(0, -1) : sentence
    return `${body} ${missing.map(ref => `[${ref}]`).join(' ')}${punctuation}`
  })
  return repaired
}

/** Final synthesis assembles conclusions from peer results; it never runs peer Skills. */
export async function assembleCompanyResearch(input: CompanyResearchInput, methods: readonly CompanyResearchMethodResult[], executor: ReasoningExecutor | undefined, now: () => string, maxAttempts: number = 2, evidencePolicy: { readonly conflictedSourceCandidateIds?: readonly string[] } = {}, workflowOwnedSections: readonly { readonly id: string; readonly title: string; readonly markdown: string; readonly sourceCandidateIds: readonly string[] }[] = []): Promise<CompanyResearchResult & { synthesisMode: string; synthesisDiagnostics: readonly string[]; synthesisAttempts: number; synthesisAttemptOutputs: readonly {attempt:number;output:unknown;allowedCitations:readonly string[]}[]; tableDiagnostics: readonly string[] }> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 2) throw new Error('Invalid synthesis attempt budget')
  const diagnostics: string[] = []
  const sections = COMPANY_RESEARCH_SECTIONS.map(title => {
    const id=idFor(title)
    const owners=methods.filter(method=>method.sections.some(section=>section.id===id))
    return {id,title,markdown:owners.map(method=>method.sections.find(section=>section.id===id)!.markdown).join('\n\n') || `研究缺口：${title} 尚未完成。缺失对应方法结果；已尝试本轮配置来源。影响：不能据此作出结论。`,sourceCandidateIds:[...new Set(owners.flatMap(method=>method.sourceCandidateIds))],proposalIds:[] as string[]}
  })
  const workflowOwnedIds = new Set(['valuation', 'bull-base-bear', 'variant-perception'])
  if (workflowOwnedSections.some(section => !workflowOwnedIds.has(section.id))
    || new Set(workflowOwnedSections.map(section => section.id)).size !== workflowOwnedSections.length
    || workflowOwnedSections.length > 0 && workflowOwnedSections.length !== workflowOwnedIds.size) {
    throw new Error('Invalid workflow-owned company research section set')
  }
  for (const section of workflowOwnedSections) {
    const target = sections.find(candidate => candidate.id === section.id)
    if (!target) throw new Error(`Workflow-owned section is not part of the company report: ${section.id}`)
    target.markdown = section.markdown
    target.sourceCandidateIds = [...new Set(section.sourceCandidateIds)]
  }
  const tableDiagnostics = validateCompanyResearchSectionTables(sections)
  const available=methods.filter(method=>method.status==='complete')
  const allowed=new Set(input.reportSourceCandidateIds ?? input.durableSourceCandidateIds ?? [])
  const exactEps = exactBasicEpsReferences(input.sources, input.asOf)
  const sourceById = new Map(input.sources.map(source => [source.candidate.candidateId, source]))
  const conflicted = new Set(evidencePolicy.conflictedSourceCandidateIds ?? [])
  const verifiedEvidenceByLocation = new Map<string, { sourceCandidateId: string; location: string; title: string; text: string; contextLocations?: readonly string[] }>()
  for (const method of available) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    if (!allowed.has(packet.sourceCandidateId) || conflicted.has(packet.sourceCandidateId)) continue
    const source = sourceById.get(packet.sourceCandidateId)
    if (!source) continue
    if (isMarketPriceSource(source) && !isQualifiedHistoricalMarketSource(source, input.asOf)) continue
    const supplied = new Map(packet.excerpts.map(excerpt => [excerpt.location, excerpt]))
    for (const excerpt of packet.excerpts) {
      const match = /^paragraph:(\d+)$/.exec(excerpt.location)
      const paragraph = match ? Number(match[1]) : 0
      const sourceLine = paragraph > 0 ? source.content.split(/\r?\n/)[paragraph - 1] : undefined
      if (!sourceLine?.trim() || sourceLine !== excerpt.text) continue
      const contextLocations = (excerpt.contextLocations ?? []).filter(location => {
        const context = supplied.get(location)
        const contextMatch = /^paragraph:(\d+)$/.exec(location)
        const contextParagraph = contextMatch ? Number(contextMatch[1]) : 0
        return !!context && contextParagraph > 0 && source.content.split(/\r?\n/)[contextParagraph - 1] === context.text
      })
      const ref = `${packet.sourceCandidateId}@${excerpt.location}`
      const existing = verifiedEvidenceByLocation.get(ref)
      const mergedContextLocations = [...new Set([...(existing?.contextLocations ?? []), ...contextLocations])]
      verifiedEvidenceByLocation.set(ref, {
        sourceCandidateId: packet.sourceCandidateId,
        location: excerpt.location,
        title: source.title,
        text: excerpt.text.slice(0, 1200),
        ...(mergedContextLocations.length ? { contextLocations: mergedContextLocations } : {}),
      })
    }
  }
  const workflowLedger = buildSynthesisEvidenceLedger({
    methods: [],
    sources: input.sources,
    asOf: input.asOf,
    workflowOwnedSections,
    allowedSourceCandidateIds: [...allowed],
    conflictedSourceCandidateIds: [...conflicted],
  })
  for (const entry of workflowLedger) {
    if (entry.eligibility !== 'verified' || !entry.ownerWorkflow) continue
    for (const ref of entry.evidence) {
      const source = sourceById.get(ref.sourceCandidateId)
      if (!source) continue
      verifiedEvidenceByLocation.set(`${ref.sourceCandidateId}@${ref.location}`, {
        sourceCandidateId: ref.sourceCandidateId,
        location: ref.location,
        title: source.title,
        text: ref.excerpt,
      })
    }
  }
  const locations = new Set<string>()
  for (const method of available) {
    for (const finding of method.findings) for (const ref of finding.evidence) {
      const locator = `${ref.sourceCandidateId}@${ref.location}`
      if (verifiedEvidenceByLocation.has(locator)) locations.add(locator)
    }
    for (const text of [method.markdown, ...method.sections.map(section => section.markdown)]) {
      for (const match of text.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)) if (verifiedEvidenceByLocation.has(match[1]!)) locations.add(match[1]!)
    }
  }
  for (const entry of workflowLedger) {
    if (entry.eligibility !== 'verified' || !entry.ownerWorkflow) continue
    for (const ref of entry.evidence) locations.add(`${ref.sourceCandidateId}@${ref.location}`)
  }
  // Synthesis may only cite exact rows that a completed method or qualified Workflow section supplied and
  // that still match an eligible, non-conflicted report source.
  const excerptByLocation = new Map<string, { sourceCandidateId: string; location: string; title: string; text: string; contextLocations?: readonly string[] }>()
  for (const ref of locations) {
    const verified = verifiedEvidenceByLocation.get(ref)
    if (verified) excerptByLocation.set(ref, verified)
  }
  const productsSection = sections.find(section => section.id === 'products')
  if (productsSection) {
    const productOwners = available.filter(method => method.sections.some(section => section.id === 'products'))
    const productEvidence: ProductSynthesisEvidence[] = productOwners.flatMap(method => [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]
      .flatMap(packet => packet.excerpts.map(excerpt => ({ sourceCandidateId: packet.sourceCandidateId, location: excerpt.location, title: packet.title, text: excerpt.text }))))
    productsSection.markdown = reconcileProductSectionCitations(productsSection.markdown, productEvidence, locations)
    const productCitationIds = [...productsSection.markdown.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(match => match[1]!)
    productsSection.sourceCandidateIds = [...new Set([...productsSection.sourceCandidateIds, ...productCitationIds])]
  }
  const namedCandidate = namedCompetitiveCandidate(available, input.sources, locations, input.company.name)
  const riskSection = sections.find(section => section.id === 'risks')
  if (riskSection) {
    riskSection.markdown = repairSynthesisCompetitorDenials(riskSection.markdown, namedCandidate)
    const repairedCitationIds = [...riskSection.markdown.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(match => match[1]!)
    riskSection.sourceCandidateIds = [...new Set([...riskSection.sourceCandidateIds, ...repairedCitationIds])]
  }
  const businessSegmentsSection = sections.find(section => section.id === 'business-segments')
  if (businessSegmentsSection) {
    businessSegmentsSection.markdown = repairSynthesisCompetitorDenials(businessSegmentsSection.markdown, namedCandidate)
    const repairedCitationIds = [...businessSegmentsSection.markdown.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(match => match[1]!)
    businessSegmentsSection.sourceCandidateIds = [...new Set([...businessSegmentsSection.sourceCandidateIds, ...repairedCitationIds])]
  }
  reconcileCrossMethodCompetitionContext(input, sections, available, locations)
  // Numeric validation may use a supplied row's exact, source-backed table
  // header/unit context to interpret that row. Context paragraphs remain
  // non-citable: only method-approved locations enter `locations` above.
  const validationEvidenceBySource = new Map<string, Map<string, { location: string; text: string; contextLocations?: readonly string[] }>>()
  for (const method of available) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    const supplied = new Map(packet.excerpts.map(excerpt => [excerpt.location, excerpt]))
    const source = sourceById.get(packet.sourceCandidateId)
    if (!source) continue
    for (const excerpt of packet.excerpts) {
      if (!locations.has(`${packet.sourceCandidateId}@${excerpt.location}`)) continue
      const lineAt = (location: string): string | undefined => {
        const paragraph = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
        return Number.isInteger(paragraph) && paragraph > 0 ? source.content.split(/\r?\n/)[paragraph - 1] : undefined
      }
      if (lineAt(excerpt.location) !== excerpt.text) continue
      const contextual = (excerpt.contextLocations ?? []).filter(location => {
        const context = supplied.get(location)
        return context !== undefined && lineAt(location) === context.text
      })
      const entries = validationEvidenceBySource.get(packet.sourceCandidateId) ?? new Map()
      const existing = entries.get(excerpt.location)
      // Several methods may supply the same exact source row with different
      // bounded table context. Preserve the union of those verified context
      // locations instead of letting the last method erase a unit/header
      // needed to interpret an otherwise exact cited amount.
      const mergedContextual = [...new Set([...(existing?.contextLocations ?? []), ...contextual])]
      entries.set(excerpt.location, { location: excerpt.location, text: excerpt.text, ...(mergedContextual.length ? { contextLocations: mergedContextual } : {}) })
      for (const location of contextual) {
        const context = supplied.get(location)!
        const existingContext = entries.get(location)
        // A later table row may cite this row as context. Keep its own
        // verified context metadata when adding it as a bare context line.
        // This matters when that row declares the unit used by the numeric
        // grounding check.
        if (!existingContext || existingContext.text === context.text) {
          entries.set(location, {
            location,
            text: context.text,
            ...(existingContext?.contextLocations?.length ? { contextLocations: existingContext.contextLocations } : {}),
          })
        }
      }
      validationEvidenceBySource.set(packet.sourceCandidateId, entries)
    }
  }
  for (const entry of workflowLedger) {
    if (entry.eligibility !== 'verified' || !entry.ownerWorkflow) continue
    for (const evidence of entry.evidence) {
      const source = sourceById.get(evidence.sourceCandidateId)
      const paragraph = Number(/^paragraph:(\d+)$/u.exec(evidence.location)?.[1])
      const exactLine = source && Number.isInteger(paragraph) && paragraph > 0 ? source.content.split(/\r?\n/u)[paragraph - 1] : undefined
      if (!exactLine || exactLine !== evidence.excerpt) continue
      const rows = validationEvidenceBySource.get(evidence.sourceCandidateId) ?? new Map()
      rows.set(evidence.location, { location: evidence.location, text: exactLine })
      validationEvidenceBySource.set(evidence.sourceCandidateId, rows)
    }
  }
  const validationEvidenceContexts = [...validationEvidenceBySource].map(([sourceCandidateId, excerpts]) => ({ sourceCandidateId, excerpts: [...excerpts.values()] }))
  const synthesisAttemptOutputs:{attempt:number;output:unknown;allowedCitations:readonly string[]}[]=[]
  let numericRepairIssues: readonly NumericGroundingDiagnostic[] = []
  let synthesisMode='deterministic_fallback'
  let synthesisAttempts=0
  if(executor && available.length) for(let attempt=1;attempt<=maxAttempts;attempt++) {
    synthesisAttempts=attempt
    if(input.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    const previousDiagnostic = attempt > 1 ? diagnostics.at(-1) : undefined
    const invalidLocator = invalidFinalSynthesisLocator(previousDiagnostic)
    const unsupportedSentence = sentenceContainingCitation(synthesisAttemptOutputs.at(-1)?.output, invalidLocator)
    const locatorRepair = invalidLocator
      ? `上一轮被拒绝的精确定位符为 ${invalidLocator}${unsupportedSentence ? `；包含该定位符的原句为：${unsupportedSentence}` : ''}。请删除包含该定位符的整句/主张，或仅当allowedEvidence中有逐项直接支持的原文时，用其中完全相同的sourceCandidateId@location替换。不得编造、推算、迁移或按PDF/年报页码换算paragraph定位符。`
      : undefined
    const tableRepairInstruction = previousDiagnostic?.includes('TABLE_ERROR')
      ? '上一轮因Markdown表格列数不一致被拒绝。逐张表读取表头列数；每个数据行必须与该表头列数完全一致。若跟踪清单使用表格，固定为四列：指标/观察项、观察频率、触发条件/核验信号、论点关联与证据；每行必须分别提供四格。只在语义边界明确时拆分原有内容，保留全部事实、数字、限定和引用，不得增加无证据内容；不能安全拆分时改用有引用的普通段落。'
      : ''
  const crossMethodEvidenceInstruction = '最终风险与跟踪清单必须按已提供的证据包逐项整合跨方法事实：若任一已完成方法的 evidence/findings 含年度前五、最大或第二大客户销售比例，应分别写入相关风险/监控行并引用该方法实际提供的对应行；客户匿名仅限制身份、产品映射、合同和替代性，不能称比例未披露。若 evidence/findings 已具名某一竞争候选，仅可保留该候选及来源支持的车型/路线，并将其他未验证的同口径比较列为缺口；删除未在引用原文或竞争方法finding中具名的公司、车型和路线，不得用模型记忆补齐。方法本身的局部缺口不得覆盖其他方法已核验的输入。审查原因若承认某项数据正确或章节应通过，应将它从待修缺口中剔除，只修复其中明确指出且仍成立的具体错误。对 revenue-profit-drivers、growth-drivers、management-capital-allocation 和 monitoring-checklist，先逐项检索本轮有效方法结果、findings 及 allowedEvidence 中与该节对应的具体原表行；凡已有精确行和定位，必须把披露事实、期间、单位及其直接引用整合到相应论点或监控项，不得把事实遗漏再写成资料缺失。收入驱动须分别列出已披露的分行业/分产品收入金额与占比，缺少分部利润、量价拆解或型号贡献时仅将这些字段列为缺口。资本配置须纳入已披露的并购完成/并表事实、回购或员工计划购入与持有记录；只有原表未给出的对价、支付细节、参与人数或后续回报可继续列为缺口，不能因缺少这些字段而否认行动或交易事实。收入与毛利判断须逐行保留其完整分类标签、期间、单位和原文引用，并按数字校验要求呈现；不得把原表明确列出的行业/产品行称作未提供。产品分类毛利率的章节标题和同句不得使用“合并毛利率比较”或把分类指标包装为合并指标；若需说明其范围限制，写明“该数值为产品分类毛利率，不代表公司整体毛利率”。如需报告合并毛利率，另起句并仅引用preparedAnalysis中精确匹配的同口径比率及两个期间操作数。'
  const qualifiedWorkflowSynthesisInstruction = '综合投资论点时，逐条查看preparedAnalysis.synthesisEvidenceLedger中eligibility=verified且ownerWorkflow为valuation、bull-base-bear或variant-perception的条目。若估值条目已verified，核心论点必须用定性表述纳入该估值路径的经济含义及章节明示的限制，并至少引用其allowedEvidence中的一个精确定位；不要抄录数字，也不得把历史参考倍数升级为预测估值或目标价。若三情景或预期差条目已verified，纳入其具名的方向、关键条件及反证，并引用其自身证据。monitoring-checklist只为verified的估值/情景/预期结论列出可重复观察的指标和触发条件。eligibility=blocked条目绝不能作为事实或结论；不得将其诊断内容包装成已成立的市场预期、经营情景或投资结论。'
    try {
      const response=await executor.execute({operation:'company_research_synthesis',instruction:P1_EDITORIAL_PRIORITY+' preparedAnalysis.synthesisEvidenceLedger包含完整方法的精确事实/推断及Workflow owned章节输入；只有eligibility=verified且每条证据均匹配本轮允许原文及来源哈希的条目可支持结论，eligibility=blocked条目仅为阻塞诊断，不得升级为结论或引用。证据包外的历史材料、冲突来源和无效定位不属于账本，不得引用或升级为结论。每节须简洁并在5000字符内完整结束：investment-thesis最多5段、每段至多2句，涵盖核心判断、支持证据、最强反证和失效条件；所有核心判断及跟踪项均用定性事实表述，不在这两节抄录数字、百分比、日期或带数字的技术型号；把数值细节留在已完成方法章节，并以准确定位引用。monitoring-checklist最多9项，每项只保留一个指标、频率、触发信号及论点关联；避免重述方法正文和大段原表数据。 每项触发条件必须对应本轮来源明确提供、可在指定报告或公告中重复观察的具名指标；不得写泛称“订单转弱”或“回款信号转弱”，除非来源确实披露了相应订单指标。可用客户占比、应收账款或经营现金流等已披露指标替代，并将未披露阈值写为具体限制，不得编造阈值。不得输出未闭合表格、超长表格或用截断方式满足长度要求。'+crossMethodEvidenceInstruction+' '+qualifiedWorkflowSynthesisInstruction+' 用中文整合已完成的独立研究方法，只输出investment-thesis与monitoring-checklist两节。每条qualityFeedback都是上一轮报告的必修缺口：逐条定位其章节，核对当前有效方法结果及allowedEvidence后修订，不得遗漏、泛化或仅在别章回应；若反馈与本轮完整方法结果或证据相矛盾，应保留有证据的事实并收窄具体缺口，无法核实则写明限制。客户表与供应商表须按各自小节、行标签、表头及数据行分别绑定，不得用营业成本构成等邻近表格的单位、期间或表头支持客户/供应商数据。治理与激励优先纳入最新可用定期报告，并将较早报告的未实施明确限定到其报告期。催化剂应衔接已披露指标和经营信号；可指出未披露量化阈值，但不得因此省略已有指标。风险章节须保留竞争方法识别的具名候选公司及产品/技术路线，只将直接竞标、客户重叠和同口径成本/性能比较列为待验证。investment-thesis 给出核心判断、支持证据、最强反证和失效条件；monitoring-checklist 给出指标、观察频率、触发条件和论点关联；若用表格，固定使用“指标/观察项｜观察频率｜触发条件/核验信号｜论点关联与证据”四列，每个数据行严格四格且引用置于支持该论点的单元格，不得合并列；若无法安全组织为四格，改用有证据引用的段落。所有历史数据必须标明具体报告期间；引用年报分行业数据时必须写明报告年度，不得以“公司分行业表”等未注明期间的表述呈现历史值。对余额与流量的增长比较必须分别标明期末余额期间和累计流量期间，明确称其为跨口径筛查，不暗示因果。allowedEvidence 中的 sourceCandidateId、location 和正文是一一对应的、唯一可用证据及定位符；引用时逐字复制 sourceCandidateId@location，不得按报告页码推算 paragraph，不得引用不在 allowedEvidence 中的定位符。综合论点须交叉核对所有方法的结论、已引用事实与反证，不可用“资料缺失”覆盖已完成方法中已有的具名公司、产品、销量、收入或履历信息。尤其风险矩阵须交叉核对competitive_market_map：若其中已识别具名候选及其有来源支持的产品或技术路线，不得写“无具名竞品、路线或可比性能证据”，应保留候选/路线并将直接替代、实际客户重叠、市场份额和同口径性能成本限定为未验证。客户集中风险若已列前五大、最大与第二大单项销售比例，并说明最大客户缩减采购→收入/产能利用的路径，不得再称客户比例不可核或风险影响未分析；明确匿名仅限制身份、业务映射、合同和替代性，静态销售占比不等于实际收入/利润损失。员工持股计划分别标明人数上限、实际参与人数（若披露）、累计购入股数及期末持有数；上限不可写成实际人数，实际购股股数不可写成参与人数，缺实际参与人数时须明确限定。相同产品、指标、期间和比较基期在同节或跨章节重复出现时，必须对照完全相同的原表行和已完成方法并统一数值方向；不得一处写成本同比增速低于收入、另一处又写成本扩张更快，除非期间、产品或口径确实不同且已明确解释。；产品技术方法所用证据包可能不含竞争方法专门取得的同业材料，若竞争方法已给出具名候选公司及产品/技术路线，综合时应在产品或竞争相关段落保留该候选并引用其对应原文，同时把直接竞争、客户重叠及同口径性能成本限制为未验证，不能笼统写“没有具名竞品”；若年报已披露主要管理人员姓名、职务或职责，不能笼统称“完整管理层分工缺失”；只可指出具体新任高管履历、具体职责分工或任职后绩效等确未披露的事项，并保留已披露事实。若欠缺的是同口径价格、成本或车型/产品贡献，也应具体限定缺项。若证据含行业预测，即使其市场边界与公司分部仅相邻而非直接可比，也须保留预测数值、年份、币种/单位和年报转述归属，并明确它仅是相邻行业背景、不能替代分部市场规模或公司TAM。资产负债表比较列标为“上年末”时，期末余额只能表述为较上年末；不得称“上年同期”或同比，只有preparedAnalysis提供同指标、同期间的同比结果时才另行报告。若已完成方法披露控制人兼任职务、内部控制或关联交易制度，风险综合必须保留这些事实，只讨论具体执行和制衡证据缺口，不得声称治理结构或内控资料缺失。年度研发变动原因栏标为“不适用”时，应明确说原表将原因说明标为不适用且没有具体解释，避免笼统称报告遗漏原因。涉及数值的每个句子都须在句末引用直接支持该指标和期间的证据，不能借同段其他数据的引用。年度报告“研发投入金额”和利润表/结构化摘要“研发费用”是不同指标与期间，必须分别标明，不得并列成趋势或据此推导费用增减；只有同指标、同期间口径才可比较。代码派生的增速差、百分点差、现金流差、周转天数或单位换算，必须在所属章节列出操作数、单位和公式；表格中的派生同比也必须显示本期值、可比期值及公式，不能只列计算结果；事实披露值不虚构公式。毛利率水平用%；毛利率同比变化严格沿用原表列名、单位行和数据单元显示的单位，列名或单元显示%时保留百分比口径，不得改称百分点。只有两个可比毛利率水平由代码计算其差额并列出操作数和公式时，才用百分点。引用PDF拆分表头中的分行业/分产品毛利率变化时，必须直接引用定义该变化列的完整表头片段（所有拆分定位段）、单位段、相应分行业/分产品区段标题，以及精确完整行标签和数值行；行标签跨段时，标签段与数值续行都须分别引用。只引用数值行、邻近表头文字或方法结论不足以证明毛利率变化口径；缺少任一所需定位时，删除该数值论点。涉及分行业或分产品表中的数值时，必须逐字保留披露表中的完整行标签（例如日用电子器件制造业），不得缩写成电子或用分行业/分产品泛称替代；若无法匹配唯一完整行，删除该数字论点。分行业和分产品表要分开陈述，禁止用“分行业/分产品”合并标签或将一张表的产品行称为行业行；代码给出的A−B增速差若为负，文字必须说A低于B，不能用绝对值写成A高于B。风险章节若任何已完成方法或allowedEvidence出现商誉、资产组、被购买方或减值表格，不得称年报商誉资料缺失；应核对单位、主体行、商誉原值与减值准备后解释资产价值、利润及现金流影响，无法计算时只限缩缺少的字段。若数值校验失败，依据repair中带有指标上下文及同数字原文候选的信息，逐项核对科目、期间、产品/行业标签和单位并替换为精确定位；一个句子涉及多个数值时，每个数字必须紧邻其直接支持的本行引用，不能把不同产品、行业、期间和单位的数字合并挂在同一个引用集合下，也不能拿同值的其他表行代替；找不到唯一匹配原文则删除该数值论点。估值、情景和预期差仅在材料提供可复算输入时分析，否则明确缺失输入、已尝试来源及影响；不得将没有一致预期表述为不存在预期差。',input:{company:input.company,asOf:input.asOf,methods:available.map(method=>({skillId:method.skillId,answer:method.answer,markdown:method.markdown,sections:method.sections,findings:method.findings,limitations:method.limitations,risks:method.risks,sourceCandidateIds:method.sourceCandidateIds})),preparedAnalysis:input.preparedAnalysis,requiredSectionIds:finalIds,allowedCitations:[...locations],allowedEvidence:[...excerptByLocation.values()],qualityFeedback:input.qualityFeedback ?? [],repair:attempt>1?[previousDiagnostic,locatorRepair].filter(Boolean).join('；'):null,repairPreviousOutput:attempt>1?synthesisAttemptOutputs.at(-1)?.output:null,repairInstruction:attempt>1?'先逐条处理qualityFeedback指出的章节缺口，再修复本轮具体错误。交叉核对完整方法结果与allowedEvidence，纳入较新报告已披露事实并保持客户/供应商各自证据范围；若feedback与当前证据冲突，保留证据支持内容并限缩缺口。保留未报错章节和主张。引用只能从本次allowedEvidence的原文中选择，必须原样复制它对应的sourceCandidateId@location，不要猜测段落编号。每句数值判断都必须引用直接支持该科目/期间的原文。数字错误只能通过repair候选的原文科目标签及其提供的单位/相邻上下文消除；每个数字必须紧邻其直接支持的精确行定位，不同产品、行业、期间和单位分别引用；不得因数字相同跨科目取证或将多个数字共用一个模糊引用。无法唯一核实则删除该数值判断。'+(locatorRepair?` ${locatorRepair}`:'')+' '+tableRepairInstruction+' 完整输出合同JSON。':null},outputContract:schema,metadata:{operationFamily:'company-research-quality'}},input.signal)
      synthesisAttemptOutputs.push({attempt,output:response.output,allowedCitations:[...locations]})
      const value=(typeof response.output==='string'?JSON.parse(response.output):response.output) as {sections?: {id:string;markdown:string;sourceCandidateIds:string[]}[]}
      if(!Array.isArray(value.sections)||value.sections.length!==finalIds.length||new Set(value.sections.map(s=>s.id)).size!==finalIds.length) throw new Error('FORMAT_ERROR: final section set must be exact')
      const validated: {id:string;markdown:string;sourceCandidateIds:string[]}[]=[]
      for(const section of value.sections) {
        if(!finalIds.includes(section.id)||typeof section.markdown!=='string'||!section.markdown.trim()||!Array.isArray(section.sourceCandidateIds)) throw new Error('REFERENCE_ERROR: final section contract invalid')
        const normalizedMarkdown=normalizeCompanySynthesisCitations(section.markdown)
        const finalTableRepair=repairCompanyFinalSynthesisTable(section.id,normalizedMarkdown)
        if(finalTableRepair.repairs.length)diagnostics.push(`${attempt}:DETERMINISTIC_TABLE_REPAIR:${finalTableRepair.repairs.join(',')}`)
        const citationRepair=repairUniqueTruncatedSynthesisSourceIds(finalTableRepair.markdown,locations)
        if(citationRepair.repairs.length)diagnostics.push(`${attempt}:UNIQUE_TRUNCATED_SOURCE_ID_REPAIR:${citationRepair.repairs.join(',')}`)
        const synthesisMarkdown=citationRepair.markdown
        const tableErrors = validateCompanyResearchMarkdownTables(synthesisMarkdown)
        if (tableErrors.length) throw new Error(`FORMAT_ERROR: ${tableErrors.join('; ')}`)
        for(const match of synthesisMarkdown.matchAll(/\[([^\]\s]+@[^\]]+)\]/g)) if(!locations.has(match[1]!)) throw new Error(`REFERENCE_ERROR: final synthesis locator unavailable: ${match[1]}; copy an exact citation from the supplied method results`)
        const citedReferences = [...synthesisMarkdown.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match => match[1]!)
        const unqualifiedMarketCitation = citedReferences.some(reference => {
          const source = sourceById.get(reference.slice(0, reference.lastIndexOf('@')))
          return !!source && isMarketPriceSource(source) && !isQualifiedHistoricalMarketSource(source, input.asOf)
        })
        if (unqualifiedMarketCitation) throw new Error('REFERENCE_ERROR: unqualified current-reference market price cannot support a historical conclusion')
        if (hasUnqualifiedBasicEpsSentence(synthesisMarkdown, exactEps)) throw new Error('NUMERIC_METRIC_GROUNDING_ERROR: basic EPS claim must cite the unique annual-report basic EPS row for its stated fiscal year')
        const hasVerifiedValuation = workflowLedger.some(entry => entry.ownerWorkflow === 'valuation' && entry.eligibility === 'verified')
        const positiveValuationClaim = hasAffirmativeReferencePeClaim(synthesisMarkdown)
        if (positiveValuationClaim && !hasVerifiedValuation) throw new Error('REFERENCE_ERROR: valuation conclusion requires a structurally qualified Workflow valuation entry')
        if(['investment-thesis','monitoring-checklist'].includes(section.id)&&![...synthesisMarkdown.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].length) throw new Error('REFERENCE_ERROR: conclusion requires located evidence')
        const citationIds=[...new Set([...synthesisMarkdown.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(match=>match[1]!))]
        if(citationIds.some(id=>!allowed.has(id))) throw new Error('REFERENCE_ERROR: cited source is not allowed for this report')
        const optional= !['investment-thesis','monitoring-checklist'].includes(section.id)
        let sectionMarkdown=synthesisMarkdown.trim()
        sectionMarkdown=bindExact2025BydProductMarginSynthesisCitations(sectionMarkdown,available,locations)
        sectionMarkdown=repairSynthesisSubjectCitations(sectionMarkdown,available,locations)
        sectionMarkdown=normalizeCompanyRevenueCostSpreadWording(sectionMarkdown)
        if(section.id==='investment-thesis') {
          const valuationSentence=qualifiedReferencePeThesisSentence(workflowLedger.find(entry=>entry.ownerWorkflow==='valuation'&&entry.eligibility==='verified'))
          if(valuationSentence) {
            const sentenceReferences=[...valuationSentence.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match=>match[1]!)
            if(sentenceReferences.every(reference=>locations.has(reference))&&!sentenceReferences.every(reference=>sectionMarkdown.includes(`[${reference}]`))) {
              const paragraphEnd=sectionMarkdown.indexOf('\n\n')
              sectionMarkdown=paragraphEnd<0?`${sectionMarkdown} ${valuationSentence}`:`${sectionMarkdown.slice(0,paragraphEnd)} ${valuationSentence}${sectionMarkdown.slice(paragraphEnd)}`
            }
          }
        }
        if(section.id==='monitoring-checklist') {
          sectionMarkdown=appendQualifiedReferencePeMonitoring(sectionMarkdown,workflowLedger.find(entry=>entry.ownerWorkflow==='valuation'&&entry.eligibility==='verified'))
          const appendedReferences=[...sectionMarkdown.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match=>match[1]!)
          if(appendedReferences.some(reference=>!locations.has(reference))) throw new Error('REFERENCE_ERROR: qualified valuation monitoring locator unavailable')
          const monitoringTableErrors=validateCompanyResearchMarkdownTables(sectionMarkdown)
          if(monitoringTableErrors.length) throw new Error(`FORMAT_ERROR: ${monitoringTableErrors.join('; ')}`)
        }
        if (!optional) {
          const validate=()=>validateCompanyNumericGrounding({markdown:sectionMarkdown,sources:input.sources,evidenceContexts:validationEvidenceContexts,preparedAnalysis:input.preparedAnalysis,trustedText:[input.company.symbol,input.asOf,...companyCitedSplitDateText(sectionMarkdown,available.flatMap(method=>method.executionEvidence ?? [])),...companyPreparedFinancialDateText(input.preparedAnalysis)]})
          let grounding=validate()
          if(grounding.status!=='grounded') {
            sectionMarkdown=repairSynthesisNumericCitations(sectionMarkdown,grounding.diagnostics,available,input.sources,locations)
            grounding=validate()
          }
          if(grounding.status!=='grounded') {numericRepairIssues=grounding.diagnostics;throw new Error(`NUMERIC_GROUNDING_ERROR:${grounding.diagnostics.map(d=>d.token).join(',')}`)}
        }
        validated.push({id:section.id,markdown:sectionMarkdown,sourceCandidateIds:[...new Set([...citationIds,...[...sectionMarkdown.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(match=>match[1]!)])]})
      }
      for(const section of validated) Object.assign(sections.find(s=>s.id===section.id)!,section)
      synthesisMode='reasoning_executor';break
    } catch(error) {if(input.signal?.aborted) throw new Error('WORKFLOW_CANCELLED');const message=error instanceof Error?error.message:String(error);const repairEvidence=message.includes('NUMERIC_GROUNDING_ERROR:')?synthesisNumericRepairEvidence(numericRepairIssues,available,input.sources,locations):[];diagnostics.push(`${attempt}:${message}${numericRepairIssues.length?`; 失败语句: ${numericRepairIssues.map(issue=>`${issue.token}：${issue.context}`).join(' | ')}`:''}${repairEvidence.length?`; 同数字的已供给原文候选（只用于精确修正引用）: ${repairEvidence.join(' | ')}`:''}`)}
  }
  const monitoring = sections.find(section => section.id === 'monitoring-checklist')
  if (monitoring) {
    monitoring.markdown = appendVerifiedScenarioMonitoring(
      monitoring.markdown,
      workflowLedger.find(entry => entry.ownerWorkflow === 'bull-base-bear' && entry.eligibility === 'verified'),
    )
    const citations = [...monitoring.markdown.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/gu)].map(match => match[1]!)
    if (citations.some(reference => !locations.has(reference))) throw new Error('REFERENCE_ERROR: qualified scenario monitoring locator unavailable')
    monitoring.sourceCandidateIds = [...new Set([...monitoring.sourceCandidateIds, ...citations.map(reference => reference.slice(0, reference.lastIndexOf('@')))])]
  }
  const durable=new Set(input.durableSourceCandidateIds ?? [])
  const proposals:SemanticKnowledgeProposal[]=[{proposalId:'proposal-company',kind:'entity',subjectKey:'company',entityType:'company',entityName:input.company.name ?? input.company.symbol}]
  for(const method of available) for(const [index,finding] of method.findings.entries()) {
    const refs=[...new Set(finding.evidence.map(e=>e.sourceCandidateId))]
    if(!refs.length||refs.some(id=>!durable.has(id))) continue
    const proposalId=`${method.skillId}-${index+1}`
    proposals.push({proposalId,kind:'claim',subjectKey:'company',claimType:finding.kind==='fact'?'fact':finding.kind==='assumption'?'assumption':'viewpoint',statement:finding.text,sourceCandidateIds:refs})
    for(const section of sections) if(method.sections.some(s=>s.id===section.id)) section.proposalIds.push(proposalId)
  }
  return {company:input.company,generatedAt:now(),asOf:input.asOf,sections,proposals,sourceCandidateIds:[...durable],contextOnlySourceCandidateIds:input.sources.filter(s=>!durable.has(s.candidate.candidateId)).map(s=>s.candidate.candidateId),synthesisMode,synthesisDiagnostics:diagnostics,synthesisAttempts,synthesisAttemptOutputs,tableDiagnostics}
}
