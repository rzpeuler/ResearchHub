import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { buildConsensusSnapshot } from '../../skills/earnings-review/expectations/consensus.ts'
import { buildValuationBasis, methodEligibility } from '../../skills/valuation/financials.ts'
import { EPS_PER_SHARE_UNIT } from '../../skills/earnings-review/expectations/contracts.ts'
import type { CompanyReadOnlyAcquisition } from './contracts.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'
import type { CompanyScenarioAssumptionsPlan } from './scenario-assumptions.ts'
import { dailyCloseAvailableAt } from '../../data/point-in-time.ts'

export interface CompanyValuationSection {
  readonly id: 'valuation' | 'bull-base-bear' | 'variant-perception'
  readonly title: string
  readonly markdown: string
  readonly sourceCandidateIds: readonly string[]
}

export interface CompanyValuationSectionsResult {
  readonly sections: readonly CompanyValuationSection[]
  readonly evidenceSources: readonly NormalizedResearchSource[]
  readonly reportSourceCandidateIds: readonly string[]
  readonly diagnostics: readonly string[]
}

const titles = {
  valuation: 'Valuation',
  'bull-base-bear': 'Bull / Base / Bear',
  'variant-perception': 'Variant Perception',
} as const

function gap(id: CompanyValuationSection['id'], title: string, diagnostic: string): CompanyValuationSection {
  return { id, title, markdown: `研究缺口：${diagnostic}。影响：本节不提供未经核验的估值、情景结果或预期差判断。`, sourceCandidateIds: [] }
}

function numberTokens(value: string): number[] {
  return [...value.normalize('NFKC').matchAll(/(?<![\p{L}\d])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\p{L}\d])/gu)]
    .map((match) => Number(match[0]!.replace(/,/g, '')))
    .filter(Number.isFinite)
}

/** Extract only a unique, directly disclosed FY row from a published issuer annual report. */
export function extractFilingBasicEps(
  sources: readonly NormalizedResearchSource[],
  fiscalYear: number,
  asOf: string,
): { readonly source: NormalizedResearchSource; readonly value: number; readonly location: string; readonly rowText: string } | undefined {
  const cutoff = Date.parse(asOf)
  const matches = sources.flatMap((source) => {
    if (source.candidate.kind !== 'official_disclosure'
      || !source.candidate.title.includes(String(fiscalYear))
      || !/年报|年度报告/u.test(source.candidate.title)
      || !source.candidate.publishedAt
      || !Number.isFinite(cutoff)
      || Date.parse(source.candidate.publishedAt) > cutoff) return []
    const lines = source.content.split(/\r?\n/u).map(line => line.normalize('NFKC'))
    const rows: { source: NormalizedResearchSource; value: number; location: string; rowText: string }[] = []
    const summaryHeading = /^[一二三四五六七八九十\d]+\s*[、.．]\s*主要会计数据和财务指标\s*$/u
    const sectionStarts = lines.flatMap((line, index) => summaryHeading.test(line.trim()) ? [index] : [])
    for (const sectionStart of sectionStarts) {
      let sectionEnd = lines.length
      for (let index = sectionStart + 1; index < lines.length; index++) {
        if (/^[一二三四五六七八九十\d]+\s*[、.．]\s*\S/u.test(lines[index]!.trim())) { sectionEnd = index; break }
      }
      let latestHeader = -1
      for (let index = sectionStart + 1; index < sectionEnd; index++) {
        const line = lines[index]!.trim()
        const years = [...line.matchAll(/(?:19|20)\s*\d{2}/gu)].map(match => Number(match[0].replace(/\s/gu, '')))
        if (years.includes(fiscalYear) && years.some(year => year !== fiscalYear) && !/基本每股收益/u.test(line)) latestHeader = index
        if (latestHeader < 0 || !/基本每股收益/u.test(line)) continue
        const marker = /基本每股收益/u.exec(line)
        if (!marker) continue
        const value = numberTokens(line.slice(marker.index + marker[0].length))[0]
        if (value !== undefined && value > 0) rows.push({ source, value, location: `paragraph:${index + 1}`, rowText: line })
      }
    }
    return rows
  })
  return matches.length === 1 ? matches[0] : undefined
}

function quoteSource(input: {
  readonly company: { readonly symbol: string; readonly name: string }
  readonly asOf: string
  readonly value: number
  readonly priceDate: string
  readonly originalSourceId?: string
  readonly originPublisher?: string
  readonly retrievalProvider?: string
  readonly sourceUrl?: string
  readonly retrievedAt: string
}): NormalizedResearchSource {
  const candidateId = `company-valuation-market-${input.company.symbol}-${input.priceDate}`
  const data = {
    metricId: 'valuation_market_price',
    ticker: input.company.symbol,
    value: input.value,
    unit: 'CNY/share',
    observationDate: input.priceDate,
    asOf: input.asOf,
    adjustmentMethod: 'UNADJUSTED',
    originalSourceId: input.originalSourceId,
    originPublisher: input.originPublisher,
    retrievalProvider: input.retrievalProvider,
    sourceUrl: input.sourceUrl,
    retrievedAt: input.retrievedAt,
  }
  const content = JSON.stringify(data)
  const title = `Company Research read-only market close ${input.company.symbol} ${input.priceDate}`
  return {
    candidate: { candidateId, kind: 'structured_data', tier: 2, title, provider: input.retrievalProvider ?? 'AKShare', publishedAt: input.priceDate, metadata: { companySymbol: input.company.symbol, originPublisher: input.originPublisher, retrievalProvider: input.retrievalProvider, sourceUrl: input.sourceUrl, dataProvenance: { metricId: 'valuation_market_price', unit: 'CNY/share', observationDate: input.priceDate, asOfMode: 'point-in-time close', adjustmentMethod: 'UNADJUSTED', originalSourceId: input.originalSourceId } } },
    retrievedAt: input.retrievedAt,
    title,
    content,
    contentHash: sha256(content),
    ...(input.sourceUrl ? { canonicalUrl: input.sourceUrl } : {}),
    publisher: input.originPublisher ?? 'Market data provider',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  }
}

function citations(ids: readonly string[]): string {
  return [...new Set(ids)].map((id) => `[${id}@paragraph:1]`).join(' ')
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/u.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match
  const month = Number(monthText)
  const day = Number(dayText)
  const monthStart = new Date(`${yearText}-${monthText}-01T00:00:00.000Z`)
  const daysInMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), month, 0)).getUTCDate()
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59
    && Number.isFinite(Date.parse(value))
}

function acquisitionAttemptSummary(
  items: readonly { readonly metricId?: string; readonly status: string; readonly quality?: { readonly pointInTimeSafe?: boolean; readonly valueVersionStatus?: string }; readonly attempts?: readonly { readonly sourceId: string; readonly fallbackLevel: string; readonly status: string }[] }[],
  marketQuoteConsumption?: string,
): string {
  if (!items.length) return marketQuoteConsumption ? `valuation_market_price=${marketQuoteConsumption}` : '无估值/预期类采集条目'
  const summary = items.map((item) => {
    const attemptItems = item.attempts ?? []
    const attempts = attemptItems.length
      ? attemptItems.map((attempt) => `${attempt.sourceId}/${attempt.fallbackLevel}:${attempt.status}`).join(', ')
      : '无来源尝试记录'
    if (item.metricId === 'valuation_market_price' && marketQuoteConsumption) {
      return `${item.metricId}=${marketQuoteConsumption}(upstream=${item.status}, upstreamPIT=${item.quality?.pointInTimeSafe === true ? 'safe' : 'not-qualified'}, valueVersion=${item.quality?.valueVersionStatus ?? 'not-proven'}; ${attempts})`
    }
    return `${item.metricId ?? 'unknown'}=${item.status}(PIT=${item.quality?.pointInTimeSafe === true ? 'safe' : 'not-qualified'}, valueVersion=${item.quality?.valueVersionStatus ?? 'not-proven'}; ${attempts})`
  }).join('；')
  if (marketQuoteConsumption && !items.some((item) => item.metricId === 'valuation_market_price')) return `valuation_market_price=${marketQuoteConsumption}；${summary}`
  return summary
}

function formatScenarioRate(value: number): string { return `${(value * 100).toFixed(2)}%` }
function formatScenarioAmount(value: number): string { return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value) }
function scenarioCitation(ref: { readonly sourceCandidateId: string; readonly location: string }): string { return `[${ref.sourceCandidateId}@${ref.location}]` }

type ConditionalPeSensitivity = {
  readonly markdown: string
  readonly sourceCandidateIds: readonly string[]
}

/**
 * Revalue the scenario profit bridge at the observed FY2025 reference PE.
 * Every input is re-bound to the existing asOf quote, issuer EPS row, and
 * scenario-plan filing row; this is a conditional sensitivity, never a target.
 */
function conditionalReferencePeSensitivity(input: {
  readonly plan: CompanyScenarioAssumptionsPlan
  readonly quote: number
  readonly marketSourceId: string
  readonly filingEps: NonNullable<ReturnType<typeof extractFilingBasicEps>>
  readonly basisYear: number
  readonly asOf: string
  readonly sources: readonly NormalizedResearchSource[]
}): ConditionalPeSensitivity | undefined {
  const { plan, quote, marketSourceId, filingEps, basisYear, asOf, sources } = input
  if (basisYear !== 2025 || plan.targetFiscalYear !== 2026 || plan.asOf !== asOf
    || !Number.isFinite(quote) || quote <= 0 || !Number.isFinite(filingEps.value) || filingEps.value <= 0
    || filingEps.source.rights.accessScope !== 'public' || filingEps.source.rights.retentionAllowed !== true
    || filingEps.source.rights.aiProcessingAllowed !== true) return undefined
  const scenarios = ['bear', 'base', 'bull'] as const
  if (plan.scenarios.length !== scenarios.length || plan.sensitivityGrid.targetFiscalYear !== 2026) return undefined
  const sourceById = new Map(sources.map(source => [source.candidate.candidateId, source]))
  const baseDriver = plan.scenarios[0]?.drivers.find(driver => driver.id === 'parent-net-profit')
  const basePoint = baseDriver?.historical.find(point => point.periodEnd === '2025-12-31')
  const baseProfit = baseDriver?.historicalBaseValue
  if (!baseDriver || !basePoint || baseDriver.targetFiscalYear !== 2026
    || baseDriver.basePeriod !== '2025-12-31' || baseDriver.unit !== 'CNY' || baseDriver.currency !== 'CNY'
    || baseDriver.scope !== 'consolidated' || baseDriver.financialMetric !== 'netProfit'
    || baseDriver.valuationMethod !== 'OPERATING_BRIDGE_ONLY_NO_FORWARD_VALUATION'
    || baseDriver.proposal.rateOriginKind !== 'RESEARCH_ASSUMPTION'
    || baseDriver.proposal.targetValueOriginKind !== 'DERIVED'
    || baseDriver.proposal.targetPeriod !== '2026-12-31'
    || !Number.isFinite(baseDriver.historicalBaseValue) || baseDriver.historicalBaseValue <= 0
    || basePoint.value !== baseDriver.historicalBaseValue
    || !baseDriver.baseSourceRefs.some(ref => ref.sourceCandidateId === basePoint.evidence.sourceCandidateId && ref.location === basePoint.evidence.location)) return undefined
  const profitSource = sourceById.get(basePoint.evidence.sourceCandidateId)
  if (!profitSource || sha256(profitSource.content) !== basePoint.sourceContentHash
    || profitSource.candidate.kind !== 'official_disclosure'
    || !profitSource.candidate.publishedAt || Date.parse(profitSource.candidate.publishedAt) > Date.parse(asOf)
    || profitSource.rights.accessScope !== 'public' || profitSource.rights.retentionAllowed !== true
    || profitSource.rights.aiProcessingAllowed !== true) return undefined
  const profitLineNumber = Number(/^paragraph:(\d+)$/u.exec(basePoint.evidence.location)?.[1])
  const profitLines = profitSource.content.split(/\r?\n/u).map(line => line.normalize('NFKC'))
  const profitLine = Number.isInteger(profitLineNumber) ? profitLines[profitLineNumber - 1]?.trim() : undefined
  const profitMarker = profitLine ? /归属于上市公司股东的净利润\s*[（(]元[）)]/u.exec(profitLine) : undefined
  const disclosedProfit = profitMarker ? numberTokens(profitLine!.slice(profitMarker.index + profitMarker[0].length))[0] : undefined
  const headerHasBasisYear = profitLines.slice(0, profitLineNumber - 1).some(line => new RegExp(`(?:^|\\D)${basisYear}\\s*年`).test(line))
  if (!profitLine || !profitMarker || disclosedProfit !== baseProfit || !headerHasBasisYear) return undefined

  if (baseProfit === undefined) return undefined
  const grid = plan.sensitivityGrid
  if (grid.rowRates.length !== 3 || grid.columnRates.length !== 3
    || grid.rowRates.some((rate, index) => !Number.isFinite(rate) || index > 0 && !(rate > grid.rowRates[index - 1]!))
    || grid.columnRates.some((rate, index) => !Number.isFinite(rate) || index > 0 && !(rate > grid.columnRates[index - 1]!))
    || grid.cells.length !== 3 || grid.cells.some(row => row.length !== 3)) return undefined
  const cells = grid.cells.map((row, rowIndex) => row.map((cell, columnIndex) => {
    if (cell.originKind !== 'DERIVED' || cell.parentNetProfitRate !== grid.columnRates[columnIndex]
      || cell.revenueRate !== grid.rowRates[rowIndex] || !Number.isFinite(cell.parentNetProfit)
      || cell.parentNetProfit <= 0 || !Number.isFinite(cell.parentNetProfitRate)) return undefined
    const recomputedProfit = baseProfit * (1 + cell.parentNetProfitRate)
    if (!Number.isFinite(recomputedProfit) || Math.abs(recomputedProfit - cell.parentNetProfit) > Math.max(1e-6, Math.abs(recomputedProfit) * 1e-12)) return undefined
    const value = quote * cell.parentNetProfit / baseProfit
    return Number.isFinite(value) && value > 0 ? value : undefined
  }))
  if (cells.some(row => row.some(value => value === undefined))) return undefined
  for (let row = 0; row < 3; row++) for (let column = 0; column < 2; column++) {
    if (!(cells[row]![column]! < cells[row]![column + 1]!)) return undefined
  }

  const namedRows = plan.scenarios.map((scenario, index) => {
    if (scenario.name !== scenarios[index]) return undefined
    const driver = scenario.drivers.find(item => item.id === 'parent-net-profit')
    if (!driver || driver.scenarioId !== scenario.name || driver.targetFiscalYear !== 2026
      || driver.basisDate !== asOf || driver.basePeriod !== '2025-12-31'
      || driver.historicalBaseValue !== baseProfit || driver.unit !== 'CNY' || driver.currency !== 'CNY'
      || driver.scope !== 'consolidated' || driver.financialMetric !== 'netProfit'
      || driver.proposal.rateOriginKind !== 'RESEARCH_ASSUMPTION' || driver.proposal.targetValueOriginKind !== 'DERIVED'
      || driver.proposal.targetPeriod !== '2026-12-31'
      || driver.proposal.rate !== driver.proposedAssumption.value
      || !Number.isFinite(driver.proposal.targetValue) || driver.proposal.targetValue <= 0
      || Math.abs(driver.proposal.targetValue - baseProfit * (1 + driver.proposal.rate)) > Math.max(1e-6, Math.abs(driver.proposal.targetValue) * 1e-12)
      || driver.proposal.rate !== grid.columnRates[index]
      || grid.rowRates[index] !== scenario.drivers.find(item => item.id === 'revenue')?.proposal.rate) return undefined
    const historical = driver.historical.find(point => point.periodEnd === '2025-12-31')
    if (!historical || historical.value !== baseProfit || historical.evidence.sourceCandidateId !== basePoint.evidence.sourceCandidateId
      || historical.evidence.location !== basePoint.evidence.location || historical.sourceContentHash !== basePoint.sourceContentHash) return undefined
    const conditionalValue = quote * driver.proposal.targetValue / baseProfit
    const epsProxy = filingEps.value * driver.proposal.targetValue / baseProfit
    if (!Number.isFinite(conditionalValue) || conditionalValue <= 0 || !Number.isFinite(epsProxy) || epsProxy <= 0) return undefined
    return `| ${scenario.name.toUpperCase()} | FY2026 归母净利润 ${formatScenarioAmount(driver.proposal.targetValue)} CNY | ${formatScenarioAmount(driver.proposal.targetValue)} ÷ ${formatScenarioAmount(baseProfit)} | ${filingEps.value} × (${formatScenarioAmount(driver.proposal.targetValue)} ÷ ${formatScenarioAmount(baseProfit)}) = ${epsProxy.toFixed(4)} CNY/share | ${formatScenarioAmount(conditionalValue)} CNY/share | DERIVED / 条件敏感性 |`
  })
  if (namedRows.some(row => row === undefined)) return undefined

  const sensitivityRows = cells.flatMap((row, rowIndex) => row.map((value, columnIndex) =>
    `| ${formatScenarioRate(grid.rowRates[rowIndex]!)} | ${formatScenarioRate(grid.columnRates[columnIndex]!)} | ${formatScenarioAmount(grid.cells[rowIndex]![columnIndex]!.parentNetProfit)} CNY | ${formatScenarioAmount(value!)} CNY/share | DERIVED / 条件敏感性 |`))
  const refs = [marketSourceId, filingEps.source.candidate.candidateId, basePoint.evidence.sourceCandidateId]
  return {
    sourceCandidateIds: [...new Set(refs)],
    markdown: `\n\n### FY2025 参考 PE 的 FY2026 条件敏感性（非价格预测）\n以下每个数均为 DERIVED 的条件研究敏感性，不是目标价、价格预测或概率加权结果。FY2025 参考 PE = asOf 未复权收盘价 ÷ FY2025 年报基本 EPS = ${quote} CNY/share ÷ ${filingEps.value} CNY/share = ${(quote / filingEps.value).toFixed(4)} 倍 ${citations([marketSourceId])} ${scenarioCitation({ sourceCandidateId: filingEps.source.candidate.candidateId, location: filingEps.location })}。FY2025 归母净利润基数为 ${formatScenarioAmount(baseProfit)} CNY ${scenarioCitation(basePoint.evidence)}。\n\n逐情景公式：FY2026 EPS proxy（CNY/share）= FY2025 基本 EPS（CNY/share） × [FY2026 情景归母净利润（CNY） ÷ FY2025 归母净利润（CNY）]；条件每股值（CNY/share）= EPS proxy × FY2025 参考 PE（倍）= asOf 收盘价（CNY/share） × [FY2026 情景归母净利润 ÷ FY2025 归母净利润]。示例操作数和情景假设沿用上表对应研究情景 ${scenarioCitation(basePoint.evidence)}；所有输出均基于 FY2025 全年基本 EPS 与归母净利润、FY2026 全年情景，以及 ${asOf.slice(0, 10)} 收盘价 ${citations([marketSourceId])} ${scenarioCitation({ sourceCandidateId: filingEps.source.candidate.candidateId, location: filingEps.location })}。条件假设是参考 PE 不变且加权平均股数不变；EPS proxy 是每股数，不是公司披露的 FY2026 EPS。股数变化、融资/回购、会计口径变化、资本结构与风险变化、估值倍数变化都会使该条件不成立。此算式不评价参考 PE 的经济合理性，不给情景概率，也不把条件每股值解释为合理价值。\n\n| 情景 | FY2026 情景归母净利润 | 净利润比例操作数 | FY2026 EPS proxy | 条件每股敏感性 | 类型 |\n|---|---:|---:|---:|---:|---|\n${namedRows.join('\n')}\n\nFY2026 3×3 条件敏感性使用同一股权每股口径；行沿用收入增速、列独立变动归母净利润增速。FY2026 利润单元格复算自 FY2025 归母净利润基数；对应 EPS proxy × FY2025 参考 PE，等价于收盘价 × FY2026/FY2025 归母净利润。\n\n| 收入增速假设 | 归母净利润增速假设 | FY2026 归母净利润 | 条件每股敏感性 (CNY/share) | 类型 |\n|---:|---:|---:|---:|---|\n${sensitivityRows.join('\n')}`,
  }
}

/** Render only a structurally validated candidate; economic eligibility remains with the independent reviewer. */
export function renderCompanyScenarioCandidate(plan: CompanyScenarioAssumptionsPlan, conditionalPe?: ConditionalPeSensitivity): CompanyValuationSection {
  const scenarioNames = { bear: 'Bear / 悲观', base: 'Base / 基准', bull: 'Bull / 乐观' } as const
  const blocks = plan.scenarios.map(scenario => {
    const drivers = scenario.drivers.map(driver => {
      const history = driver.historical.map(point => `${point.periodEnd.slice(0, 4)} ${formatScenarioAmount(point.value)} CNY ${scenarioCitation(point.evidence)}（text-sha256=${point.sourceContentHash}; ${point.verificationStatus}）`).join('；')
      const historyGrowth = driver.historical.slice(1).map((point, index) => `${point.periodEnd.slice(0, 4)}同比=${formatScenarioRate(point.value / driver.historical[index]!.value - 1)}`).join('，')
      const supportRefs = driver.dependencies.map(scenarioCitation).join(' ')
      const counterRefs = driver.counterevidence.map(scenarioCitation).join(' ')
      return `- ${driver.metricLabel}：scenarioId=${driver.scenarioId}；targetFiscalYear=${driver.targetFiscalYear}；basisDate=${driver.basisDate}；scope=${driver.scope}；valuationMethod=${driver.valuationMethod}；financialMetric=${driver.financialMetric}；unit=${driver.unit}；历史基数=${formatScenarioAmount(driver.historicalBaseValue)} CNY，basePeriod=${driver.basePeriod}，baseSourceRefs=${driver.baseSourceRefs.map(scenarioCitation).join(' ')}。研究假设增速 ${formatScenarioRate(driver.proposedAssumption.value)}（${driver.proposedAssumption.originKind}）；${historyGrowth}。${driver.assumptionDerivation} 历史行：${history}。targetMetric=${driver.targetMetric}；peerOrMultipleBasis=${driver.peerOrMultipleBasis}。支持/校准证据：${supportRefs}。反证与中期交叉核对（不混入年度校准）：${counterRefs}。可证伪条件：${driver.falsificationTrigger}。置信限制：${driver.confidenceLimitations}`
    }).join('\n')
    return `### ${scenarioNames[scenario.name]}\n${drivers}\n- 推导归母净利率 = FY2026 归母净利润 ÷ FY2026 营业收入 = ${formatScenarioRate(scenario.impliedParentNetMargin.value)}（DERIVED）。`
  })
  const rows = plan.sensitivityGrid.cells.flatMap(row => row.map(cell => `| ${formatScenarioRate(cell.revenueRate)} | ${formatScenarioRate(cell.parentNetProfitRate)} | ${formatScenarioAmount(cell.revenue)} | ${formatScenarioAmount(cell.parentNetProfit)} | ${formatScenarioRate(cell.impliedParentNetMargin)} |`))
  const h1 = plan.h1CrossCheck
  const h1Text = `FY2026 H1 独立交叉核对（YTD，不并入年度情景校准）：营业收入 ${formatScenarioAmount(h1.revenue.current)} CNY 对比上年同期 ${formatScenarioAmount(h1.revenue.prior)} CNY，同比 ${formatScenarioRate(h1.revenue.yoy)} ${scenarioCitation(h1.revenue.evidence)}；归母净利润 ${formatScenarioAmount(h1.parentNetProfit.current)} CNY 对比上年同期 ${formatScenarioAmount(h1.parentNetProfit.prior)} CNY，同比 ${formatScenarioRate(h1.parentNetProfit.yoy)} ${scenarioCitation(h1.parentNetProfit.evidence)}。`
  const allRefs = [...new Set(plan.scenarios.flatMap(scenario => scenario.drivers.flatMap(driver => [...driver.dependencies, ...driver.counterevidence])).concat([h1.revenue.evidence, h1.parentNetProfit.evidence]).map(ref => ref.sourceCandidateId).concat(conditionalPe?.sourceCandidateIds ?? []))]
  return {
    id: 'bull-base-bear', title: titles['bull-base-bear'],
    markdown: `独立经济理由审查状态：待审；以下为 FY2026 研究假设候选，不是概率加权结果，也未给出目标价。校准约定：Bear/Base/Bull 分别取 FY2023–FY2025 两段同比增速包络的低值、上下界算术中点和高值；历史范围本身不能证明经济合理性。\n\n${blocks.join('\n\n')}\n\n### 3×3 敏感性（行=营业收入同比假设，列=归母净利润同比假设）\nFY2026 值分别按 FY2025 基数 × (1 + 对应增速) 复算；利润率=归母净利润÷营业收入。\n| 收入增速 | 净利润增速 | FY2026 收入 (CNY) | FY2026 归母净利润 (CNY) | 归母净利率 |\n|---:|---:|---:|---:|---:|\n${rows.join('\n')}${conditionalPe?.markdown ?? '\n\n研究缺口：无法绑定经核验的 asOf 收盘价、FY2025 基本 EPS 与 FY2025 归母净利润情景基数；不输出参考 PE 条件敏感性。'}\n\n${h1Text}`,
    sourceCandidateIds: allRefs,
  }
}

type ExpectationSurface = { readonly provider: 'Tonghuashun / 同花顺' | 'EastMoney'; readonly evidenceMode: 'CUTOFF_SEALED_SNAPSHOT' | 'IMMUTABLE_VERSION'; readonly estimates: readonly EstimatePoint[]; readonly sources: readonly NormalizedResearchSource[] }
type ExpectationSurfaceSelection = { readonly surfaces: readonly ExpectationSurface[]; readonly diagnostics: readonly string[] }
// The acquisition payload crosses into Workflow as data. Keep this local
// structural view here so Workflow does not depend on a Plugin module.
type ExpectationPointProofForSelection = {
  readonly estimateId: string
  readonly sourceCandidateId: string
  readonly provider: string
  readonly matchedMetric: string
  readonly matchedValue: number
  readonly matchedUnit: string
  readonly matchedPeriod: string
  readonly matchedInstitutionKey: string
  readonly matchedPublishedAt: string
  readonly matchedField: string
  readonly providerObjectId?: string
  readonly observedRowHash: string
  readonly pointFingerprint: string
  readonly basisStatus: string
  readonly valueVersionStatus: string
  readonly correctionStatus: string
  /** A value version must be independently verified by a trusted source path. */
  readonly versionAvailableAt?: string
  readonly valueVersionId?: string
  readonly valueVersionKind?: 'IMMUTABLE_DOCUMENT' | 'MUTABLE_SNAPSHOT'
  readonly snapshotCapturedAt?: string
  readonly snapshotSealedAt?: string
}

function stableProofValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableProofValue).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableProofValue(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function proofRow(source: NormalizedResearchSource, proof: ExpectationPointProofForSelection): Record<string, unknown> | undefined {
  if (source.contentHash !== sha256(source.content)) return undefined
  let envelope: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(source.content)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    envelope = parsed as Record<string, unknown>
  } catch { return undefined }
  if (envelope.provider !== proof.provider) return undefined
  const row = proof.provider === 'eastmoney-reportapi' ? envelope.proofRow
    : proof.provider === 'akshare-ths-institution-forecast' || proof.provider === 'akshare-eastmoney-research-report' ? envelope.row
      : undefined
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return undefined
  return row as Record<string, unknown>
}

function sourceRowBindsEstimate(proof: ExpectationPointProofForSelection, estimate: EstimatePoint, row: Record<string, unknown>): boolean {
  if (sha256(stableProofValue(row)) !== proof.observedRowHash) return false
  const expectedFingerprint = sha256(stableProofValue({
    estimateId: proof.estimateId,
    sourceCandidateId: proof.sourceCandidateId,
    provider: proof.provider,
    providerObjectId: proof.providerObjectId ?? null,
    matchedField: proof.matchedField,
    matchedValue: proof.matchedValue,
    matchedPeriod: proof.matchedPeriod,
    matchedInstitutionKey: proof.matchedInstitutionKey,
    matchedPublishedAt: proof.matchedPublishedAt,
    metric: proof.matchedMetric,
    unit: proof.matchedUnit,
    observedRowHash: proof.observedRowHash,
  }))
  if (expectedFingerprint !== proof.pointFingerprint) return false
  if (proof.provider === 'eastmoney-reportapi') {
    const forecasts = Array.isArray(row.epsForecasts) ? row.epsForecasts as unknown[] : []
    const forecast = forecasts.find((item) => typeof item === 'object' && item !== null && !Array.isArray(item)
      && (item as Record<string, unknown>).providerField === proof.matchedField
      && (item as Record<string, unknown>).fiscalYear === Number(estimate.fiscalPeriod.slice(0, 4))) as Record<string, unknown> | undefined
    return row.infoCode === proof.providerObjectId
      && row.orgCode !== undefined && proof.matchedInstitutionKey === `eastmoney-org:${String(row.orgCode)}`
      && Number.isFinite(Date.parse(String(row.publishedAt))) && Date.parse(String(row.publishedAt)) === Date.parse(estimate.publishedAt)
      && forecast?.value === estimate.value && proof.matchedMetric === 'eps'
  }
  const rawInstitution = row['机构名称'] ?? row['机构'] ?? row.institution ?? row.institutionName ?? row.orgName
  const institutionPrefix = proof.provider === 'akshare-ths-institution-forecast' ? 'ths-org:' : 'eastmoney-org:'
  const institutionKey = estimate.institutionKey.startsWith(institutionPrefix) ? `${institutionPrefix}${String(rawInstitution ?? '')}` : String(rawInstitution ?? '')
  const rawPublication = row['报告日期'] ?? row['日期'] ?? row.reportDate ?? row.publishDate ?? row.publishedAt
  const rawValue = row[proof.matchedField]
  const numericValue = typeof rawValue === 'number' ? rawValue : typeof rawValue === 'string' ? Number(rawValue.normalize('NFKC').replace(/,/g, '').trim()) : Number.NaN
  const fieldPeriod = proof.provider === 'akshare-ths-institution-forecast'
    ? /^预测年报每股收益(\d{4})预测$/u.exec(proof.matchedField)?.[1]
    : /^(\d{4})-(?:盈利预测-收益|预测每股收益|EPS)$/u.exec(proof.matchedField)?.[1]
  return institutionKey === estimate.institutionKey
    && Number.isFinite(Date.parse(String(rawPublication))) && Date.parse(String(rawPublication)) === Date.parse(estimate.publishedAt)
    && numericValue === estimate.value && proof.matchedMetric === estimate.metric
    && fieldPeriod !== undefined && `${fieldPeriod}-FY` === estimate.fiscalPeriod
}

function canonicalInstitutionName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s　·.（）()]/gu, '').replace(/(证券|银行|研究所)?(股份有限公司|有限责任公司|有限公司|股份|有限)$/u, '$1')
}

function proofRejection(estimate: EstimatePoint, proofs: readonly ExpectationPointProofForSelection[], sources: ReadonlyMap<string, NormalizedResearchSource>, asOf: string, asOfMode: 'CURRENT_VALUE_ONLY' | 'HISTORICAL'): string | undefined {
  const matches = proofs.filter(proof => proof.estimateId === estimate.estimateId)
  if (matches.length !== 1) return matches.length === 0 ? 'PROOF_MISSING' : 'PROOF_AMBIGUOUS'
  const proof = matches[0]!
  const source = sources.get(proof.sourceCandidateId)
  if (!proof.pointFingerprint || !proof.observedRowHash || !proof.matchedField
    || !estimate.sourceCandidateIds.includes(proof.sourceCandidateId)
    || !source
    || proof.matchedMetric !== estimate.metric
    || proof.matchedValue !== estimate.value
    || proof.matchedUnit !== estimate.unit
    || proof.matchedPeriod !== estimate.fiscalPeriod
    || proof.matchedInstitutionKey !== estimate.institutionKey
    || proof.matchedPublishedAt !== estimate.publishedAt
    || proof.provider !== source.candidate.provider
    || source.candidate.publishedAt !== estimate.publishedAt) return 'PROOF_BINDING_MISMATCH'
  if (source.rights.accessScope !== 'public' || source.rights.aiProcessingAllowed !== true || source.rights.retentionAllowed !== true) return 'SOURCE_RIGHTS_NOT_QUALIFIED'
  const row = proofRow(source, proof)
  if (!row || !sourceRowBindsEstimate(proof, estimate, row)) return source.contentHash === sha256(source.content) ? 'POINT_NOT_BOUND_TO_SOURCE_CONTENT' : 'SOURCE_CONTENT_HASH_MISMATCH'
  if (asOfMode === 'HISTORICAL') return 'IMMUTABLE_VERSION_TRUST_UNAVAILABLE'
  const cutoff = Date.parse(asOf)
  const retrievedAt = Date.parse(source.retrievedAt)
  const capturedAt = Date.parse(proof.snapshotCapturedAt ?? '')
  const sealedAt = Date.parse(proof.snapshotSealedAt ?? '')
  if (![cutoff, retrievedAt, capturedAt, sealedAt].every(Number.isFinite)) return 'SNAPSHOT_TIME_METADATA_INVALID'
  if (!(retrievedAt <= capturedAt && capturedAt <= sealedAt)) return 'SNAPSHOT_TIME_ORDER_INVALID'
  if (retrievedAt > cutoff || capturedAt > cutoff || sealedAt > cutoff) return 'CURRENT_SNAPSHOT_NOT_AVAILABLE_BY_AS_OF'
  return undefined
}

function expectationSurfaces(acquisition: CompanyReadOnlyAcquisition, targetFiscalYear: number, asOf: string, asOfMode: 'CURRENT_VALUE_ONLY' | 'HISTORICAL'): ExpectationSurfaceSelection {
  const item = acquisition.earningsExpectationItems.find(candidate => candidate.metricId === 'earnings_expectation_eps')
  if (!item) return { surfaces: [], diagnostics: [] }
  const payloads = [item.value, ...(item.acquisition.observations ?? []).map(observation => observation.data)]
    .filter((value): value is NonNullable<typeof item.value> => value?.kind === 'expectation')
  const grouped = new Map<ExpectationSurface['provider'], { estimates: EstimatePoint[]; sources: NormalizedResearchSource[]; evidenceMode: ExpectationSurface['evidenceMode'] }>()
  const diagnostics: string[] = []
  for (const payload of payloads) {
    if (payload.kind !== 'expectation') continue
    const sources = payload.projection.sources
    const sourceById = new Map(sources.map(source => [source.candidate.candidateId, source]))
    const sourceIds = new Set(sourceById.keys())
    const candidates = payload.projection.estimates.filter(estimate => estimate.metric === 'eps'
      && estimate.fiscalPeriod === `${targetFiscalYear}-FY`
      && estimate.unit === EPS_PER_SHARE_UNIT
      && Number.isFinite(estimate.value)
      && Number.isFinite(Date.parse(estimate.publishedAt))
      && Date.parse(estimate.publishedAt) <= Date.parse(asOf)
      && estimate.sourceCandidateIds.every(id => sourceIds.has(id)))
    const provider = sources.some(source => /eastmoney/i.test(`${source.candidate.provider} ${source.publisher}`)) ? 'EastMoney'
      : sources.some(source => /tonghuashun|同花顺|ths/i.test(`${source.candidate.provider} ${source.publisher}`)) ? 'Tonghuashun / 同花顺'
        : undefined
    if (!provider) continue
    const proofs = (payload.projection.pointProofs ?? []) as readonly ExpectationPointProofForSelection[]
    const estimates = candidates.filter(estimate => {
      const rejection = proofRejection(estimate, proofs, sourceById, asOf, asOfMode)
      if (rejection) diagnostics.push(`EXPECTATION_POINT_PROOF_REJECTED:${provider}:${estimate.estimateId}:${rejection}`)
      return rejection === undefined
    }).map(estimate => {
        const institution = payload.projection.institutions.find(item => item.institutionKey === estimate.institutionKey)?.name
        return institution ? { ...estimate, institutionKey: institution } : estimate
      })
    diagnostics.push(`EXPECTATION_POINT_PROOF_COVERAGE:${provider}:eligible=${estimates.length}/${candidates.length}`)
    if (estimates.length === 0) continue
    const current = grouped.get(provider) ?? { estimates: [], sources: [], evidenceMode: asOfMode === 'CURRENT_VALUE_ONLY' ? 'CUTOFF_SEALED_SNAPSHOT' : 'IMMUTABLE_VERSION' }
    current.estimates.push(...estimates)
    current.sources.push(...sources)
    grouped.set(provider, current)
  }
  return { surfaces: [...grouped.entries()].map(([provider, value]) => ({
    provider, evidenceMode: value.evidenceMode,
    estimates: value.estimates,
    sources: [...new Map(value.sources.map(source => [source.candidate.candidateId, source])).values()],
  })), diagnostics }
}

function dedupeContributors(surfaces: readonly ExpectationSurface[]): { readonly all: readonly EstimatePoint[]; readonly uniqueByProvider: ReadonlyMap<ExpectationSurface['provider'], readonly EstimatePoint[]>; readonly overlaps: readonly string[] } {
  const surfaceRows = new Map<ExpectationSurface['provider'], Map<string, EstimatePoint>>()
  const nameByKey = new Map<string, string>()
  for (const surface of surfaces) {
    const rows = new Map<string, EstimatePoint>()
    for (const estimate of surface.estimates) {
      const canonical = canonicalInstitutionName(estimate.institutionKey.replace(/^(?:ths-org|eastmoney-org):/u, ''))
      if (!canonical) continue
      nameByKey.set(canonical, estimate.institutionKey.replace(/^(?:ths-org|eastmoney-org):/u, ''))
      const previous = rows.get(canonical)
      if (!previous || Date.parse(estimate.publishedAt) > Date.parse(previous.publishedAt)
        || Date.parse(estimate.publishedAt) === Date.parse(previous.publishedAt) && estimate.estimateId < previous.estimateId) rows.set(canonical, { ...estimate, institutionKey: canonical })
    }
    surfaceRows.set(surface.provider, rows)
  }
  const winners = new Map<string, { provider: ExpectationSurface['provider']; estimate: EstimatePoint }>()
  for (const [provider, rows] of surfaceRows) for (const [canonical, estimate] of rows) {
    const previous = winners.get(canonical)
    if (!previous || Date.parse(estimate.publishedAt) > Date.parse(previous.estimate.publishedAt)
      || Date.parse(estimate.publishedAt) === Date.parse(previous.estimate.publishedAt) && provider === 'Tonghuashun / 同花顺') winners.set(canonical, { provider, estimate })
  }
  const uniqueByProvider = new Map<ExpectationSurface['provider'], readonly EstimatePoint[]>()
  for (const [provider, rows] of surfaceRows) uniqueByProvider.set(provider, [...rows.keys()].flatMap(key => winners.get(key)?.provider === provider
    ? [{ ...winners.get(key)!.estimate, institutionKey: nameByKey.get(key) ?? key }]
    : []))
  const overlaps = [...surfaceRows.values()].flatMap((rows, index, all) => [...rows.keys()].filter(key => all.slice(index + 1).some(other => other.has(key))))
  return {
    all: [...winners.values()].map(item => item.estimate),
    uniqueByProvider,
    overlaps: [...new Set(overlaps)].map(key => nameByKey.get(key) ?? key).sort(),
  }
}

/** Build report-owned valuation basis and evidence-bounded expectation comparison from resolver results and issuer filing rows. */
export function buildCompanyValuationSections(input: {
  readonly company: { readonly symbol: string; readonly name: string }
  readonly asOf: string
  readonly asOfMode?: 'CURRENT_VALUE_ONLY' | 'HISTORICAL'
  readonly acquisition?: CompanyReadOnlyAcquisition
  readonly sources: readonly NormalizedResearchSource[]
  readonly scenarioCandidate?: CompanyScenarioAssumptionsPlan
}): CompanyValuationSectionsResult {
  const diagnostics: string[] = []
  const asOfMode = input.asOfMode ?? 'HISTORICAL'
  const variantGap = gap('variant-perception', titles['variant-perception'], '未取得与 FY2026 EPS 共识同指标、同期间、同单位的公司指引或独立本方预测')
  if (!input.acquisition) return { sections: [gap('valuation', titles.valuation, '估值数据解析器未配置或共享采集预算已耗尽'), gap('bull-base-bear', titles['bull-base-bear'], '估值数据解析器未配置或共享采集预算已耗尽'), variantGap], evidenceSources: [], reportSourceCandidateIds: [], diagnostics: ['VALUATION_DATA_RESOLVER_NOT_CONFIGURED_OR_BUDGET_EXHAUSTED'] }
  if (input.acquisition.valuationError) diagnostics.push(`VALUATION_RESOLVER_ERROR:${input.acquisition.valuationError}`)
  if (input.acquisition.earningsExpectationError) diagnostics.push(`EARNINGS_EXPECTATION_RESOLVER_ERROR:${input.acquisition.earningsExpectationError}`)
  diagnostics.push(...input.acquisition.valuationItems.filter(item => item.status !== 'AVAILABLE').map(item => `VALUATION_ITEM_${item.metricId}_${item.status}`))
  diagnostics.push(...input.acquisition.earningsExpectationItems.filter(item => item.status !== 'AVAILABLE').map(item => `EXPECTATION_ITEM_${item.metricId}_${item.status}`))

  const basisYear = input.acquisition.valuationBasisFiscalYear
  const quoteItem = input.acquisition.valuationItems.find((item) => item.metricId === 'valuation_market_price')
  const potentialQuote = quoteItem?.status === 'AVAILABLE' && quoteItem.value?.kind === 'market'
    ? quoteItem.value
    : undefined
  let quote = potentialQuote
  let quoteConsumption = 'REJECTED(QUOTE_NOT_AVAILABLE)'
  const asOfValid = validIsoTimestamp(input.asOf)
  if (!asOfValid) {
    diagnostics.push('VALUATION_MARKET_PRICE_ASOF_INVALID')
    quote = undefined
    quoteConsumption = 'REJECTED(VALUATION_MARKET_PRICE_ASOF_INVALID)'
  } else if (!potentialQuote) {
    quoteConsumption = 'REJECTED(QUOTE_NOT_AVAILABLE)'
  } else if (!validIsoTimestamp(potentialQuote.retrievedAt)) {
    diagnostics.push('VALUATION_MARKET_PRICE_RETRIEVAL_TIME_INVALID')
    quote = undefined
    quoteConsumption = 'REJECTED(VALUATION_MARKET_PRICE_RETRIEVAL_TIME_INVALID)'
  } else if (asOfMode === 'HISTORICAL' && Date.parse(potentialQuote.retrievedAt) > Date.parse(input.asOf)) {
    diagnostics.push('VALUATION_MARKET_PRICE_VINTAGE_UNVERIFIED_AT_ASOF')
    quote = undefined
    quoteConsumption = `REJECTED(VALUATION_MARKET_PRICE_VINTAGE_UNVERIFIED_AT_ASOF; retrievedAt=${potentialQuote.retrievedAt}>asOf=${input.asOf})`
  } else if (!(quoteItem?.quality?.pointInTimeSafe
    && potentialQuote.observation.priceDate <= input.asOf.slice(0, 10)
    && potentialQuote.observationAvailableAt === dailyCloseAvailableAt(potentialQuote.observation.priceDate)
    && Date.parse(potentialQuote.observationAvailableAt) <= Date.parse(asOfMode === 'CURRENT_VALUE_ONLY' ? potentialQuote.retrievedAt : input.asOf))) {
    quote = undefined
    quoteConsumption = 'REJECTED(MARKET_CLOSE_OR_UPSTREAM_PIT_GATE)'
  } else if (asOfMode === 'CURRENT_VALUE_ONLY' && Date.parse(potentialQuote.retrievedAt) > Date.parse(input.asOf)) {
    quoteConsumption = `CURRENT_REFERENCE_ONLY(retrievedAt=${potentialQuote.retrievedAt}>researchStart=${input.asOf}; historicalVersion=UNVERIFIED)`
    diagnostics.push('VALUATION_MARKET_PRICE_CURRENT_REFERENCE_ONLY_AFTER_ASOF')
  } else if (asOfMode === 'CURRENT_VALUE_ONLY') {
    quoteConsumption = `CURRENT_REFERENCE_ONLY(retrievedAt=${potentialQuote.retrievedAt}<=researchStart=${input.asOf}; historicalVersion=UNVERIFIED)`
  } else {
    quoteConsumption = `HISTORICAL_ASOF_QUALIFIED(retrievedAt=${potentialQuote.retrievedAt}<=asOf=${input.asOf})`
  }
  if (!quote) diagnostics.push('VALUATION_MARKET_CLOSE_NOT_PIT_SAFE')
  const acquisitionAttempts = acquisitionAttemptSummary([...input.acquisition.valuationItems, ...input.acquisition.earningsExpectationItems], quoteConsumption)
  /*
   * The resolver's observation availability check proves when the exchange
   * close could exist. A response fetched after a historical cutoff needs an
   * independently trusted archived version, which this consumer contract does
   * not provide. CURRENT_VALUE_ONLY remains usable as a current reference.
   */
  const qualifiedQuote = quote && quoteItem?.status === 'AVAILABLE' ? quote : undefined

  const filingEps = extractFilingBasicEps(input.sources, basisYear, input.asOf)
  if (!filingEps) diagnostics.push('VALUATION_FILING_BASIC_EPS_UNAVAILABLE_OR_AMBIGUOUS')

  const expectationSelection = expectationSurfaces(input.acquisition, input.acquisition.expectationTargetFiscalYear, input.asOf, asOfMode)
  const surfaces = expectationSelection.surfaces
  diagnostics.push(...expectationSelection.diagnostics)
  const dedupedExpectations = dedupeContributors(surfaces)
  const estimates = dedupedExpectations.all

  const marketEvidenceSource = qualifiedQuote ? quoteSource({
    company: input.company,
    asOf: input.asOf,
    value: qualifiedQuote.observation.close,
    priceDate: qualifiedQuote.observation.priceDate,
    originalSourceId: qualifiedQuote.sourceId,
    originPublisher: qualifiedQuote.originPublisher,
    retrievalProvider: qualifiedQuote.retrievalProvider,
    sourceUrl: qualifiedQuote.sourceUrl,
    retrievedAt: qualifiedQuote.retrievedAt,
  }) : undefined
  const selectedEstimateIds = new Set(estimates.flatMap((estimate) => estimate.sourceCandidateIds))
  const estimateSources = surfaces.flatMap(surface => surface.sources).filter((source, index, all) => selectedEstimateIds.has(source.candidate.candidateId) && all.findIndex(candidate => candidate.candidate.candidateId === source.candidate.candidateId) === index)
  const evidenceSources = [...(marketEvidenceSource ? [marketEvidenceSource] : []), ...estimateSources]
  const marketSourceId = marketEvidenceSource?.candidate.candidateId
  const epsSourceId = filingEps?.source.candidate.candidateId
  const baseSourceIds = [...new Set([marketSourceId, epsSourceId].filter((value): value is string => value !== undefined))]

  let valuationSection = gap('valuation', titles.valuation, quote
    ? '无法同时确认 PIT 收盘价与年度报告基本 EPS'
    : `市场报价消费资格未通过（${quoteConsumption}）；不以该报价计算参考 PE 或条件敏感性`)
  let scenarioSection = gap('bull-base-bear', titles['bull-base-bear'], `本轮没有来源支持的目标年经营驱动假设（销量/产品收入、经营利润率、现金流驱动及其 Bear/Base/Bull 区间），无法构成同财年、同方法的可复算敏感性。已尝试的估值/预期采集路线及资格状态：${acquisitionAttempts}。在获得合格经营假设前不建立三情景估值`)
  diagnostics.push('SCENARIO_OPERATING_DRIVER_PLAN_NOT_AVAILABLE')
  if (input.scenarioCandidate) {
    const conditionalPe = quote && filingEps && marketEvidenceSource
      ? conditionalReferencePeSensitivity({ plan: input.scenarioCandidate, quote: qualifiedQuote!.observation.close, marketSourceId: marketEvidenceSource.candidate.candidateId, filingEps, basisYear, asOf: input.asOf, sources: input.sources })
      : undefined
    scenarioSection = renderCompanyScenarioCandidate(input.scenarioCandidate, conditionalPe)
    diagnostics.splice(diagnostics.indexOf('SCENARIO_OPERATING_DRIVER_PLAN_NOT_AVAILABLE'), 1)
    diagnostics.push('SCENARIO_CANDIDATE_REQUIRES_INDEPENDENT_ECONOMIC_REVIEW')
    if (!conditionalPe) diagnostics.push('CONDITIONAL_REFERENCE_PE_SENSITIVITY_INPUTS_UNQUALIFIED')
  }
  if (quote && filingEps && marketEvidenceSource) {
    const reportDate = filingEps.source.candidate.publishedAt!.slice(0, 10)
    const market = { priceDate: qualifiedQuote!.observation.priceDate, close: qualifiedQuote!.observation.close }
    const basis = buildValuationBasis(market, { basisFiscalYear: basisYear, reportDate: `${basisYear}-12-31`, publicationDate: reportDate, eps: filingEps.value }, input.asOf.slice(0, 10), 'verified')
    const eligible = methodEligibility(basis)
    const peEligible = eligible.find((item) => item.method === 'PE')?.eligible === true
    const currentPe = basis.marketPrice / filingEps.value
    if (peEligible && Number.isFinite(currentPe) && currentPe > 0) {
      const filedRef = `[${filingEps.source.candidate.candidateId}@${filingEps.location}]`
      const marketRef = citations([marketSourceId!])
      const priceSensitivity = 1 / filingEps.value
      const epsSensitivity = qualifiedQuote!.observation.close / filingEps.value ** 2 * 0.01
      const quoteContext = asOfMode === 'CURRENT_VALUE_ONLY'
        ? ` ${qualifiedQuote!.observation.priceDate} 交易日收盘的理论可用时间为 ${dailyCloseAvailableAt(qualifiedQuote!.observation.priceDate)}；本次响应实际取得时间为 ${qualifiedQuote!.retrievedAt}（研究起点 asOf=${input.asOf}）。本节按 CURRENT_VALUE_ONLY 保留为当前参考 PE；该标签和响应内容不证明同一数值版本在历史 asOf 前已取得或不可变封存，也不构成历史 PIT 确认。`
        : ` 行情响应于 ${qualifiedQuote!.retrievedAt} 取得，不晚于历史 asOf=${input.asOf}；在本模块现有消费门下可用于该历史截面的参考 PE。`
      valuationSection = {
        id: 'valuation', title: titles.valuation,
        markdown: `截至 ${qualifiedQuote!.observation.priceDate}，${qualifiedQuote!.originPublisher} 未复权收盘价为 ${qualifiedQuote!.observation.close} CNY/share ${marketRef}。${quoteContext} FY${basisYear} 年报基本 EPS 为 ${filingEps.value} CNY/share ${filedRef}，以收盘价除以该 EPS 得到参考 PE ${currentPe.toFixed(2)} 倍。基于同一价格与 EPS，参考 PE 按 P/E 计算：价格每变动 1 CNY/share 的局部 PE 变化为 1/EPS = 1/${filingEps.value} = ${priceSensitivity.toFixed(2)} 倍；EPS 每变动 0.01 CNY/share 的局部 PE 变化为 −P/EPS² × 0.01 = −${qualifiedQuote!.observation.close}/${filingEps.value}² × 0.01 = −${epsSensitivity.toFixed(2)} 倍 ${marketRef} ${filedRef}。该局部敏感性只说明历史 PE 对输入的数学响应，不是未来盈利假设或目标价。当前数据未提供可确认的 FY${basisYear} BVPS，PB 不适用；同业候选缺少可复核的日期和统一估值口径，因此本节不采用可比公司倍数。参考 PE 是当前盈利基准下的倍数描述，不构成目标价或买卖建议。`,
        sourceCandidateIds: [...baseSourceIds],
      }

    } else diagnostics.push('VALUATION_PE_METHOD_NOT_ELIGIBLE')
  }

  const surfaceSnapshots = surfaces.map(surface => {
    const uniqueEstimates = dedupedExpectations.uniqueByProvider.get(surface.provider) ?? []
    const snapshot = buildConsensusSnapshot({ estimates: uniqueEstimates, metric: 'eps', fiscalPeriod: `${input.acquisition!.expectationTargetFiscalYear}-FY`, asOf: input.asOf, minimumCount: 2 }).snapshot
    return { surface, estimates: uniqueEstimates, snapshot }
  }).filter((item): item is typeof item & { snapshot: NonNullable<typeof item.snapshot> } => item.snapshot !== undefined)
  const thsSurface = surfaceSnapshots.find(item => item.surface.provider === 'Tonghuashun / 同花顺')
  const eastmoneySurface = surfaceSnapshots.find(item => item.surface.provider === 'EastMoney')
  let variantSection = variantGap
  if (thsSurface && eastmoneySurface && thsSurface.snapshot.unit === eastmoneySurface.snapshot.unit) {
    const comparisonDelta = eastmoneySurface.snapshot.median - thsSurface.snapshot.median
    const providerSources = [...thsSurface.surface.sources, ...eastmoneySurface.surface.sources]
      .filter((source, index, all) => all.findIndex(candidate => candidate.candidate.candidateId === source.candidate.candidateId) === index)
    const providerIds = new Set([...thsSurface.estimates, ...eastmoneySurface.estimates].flatMap(estimate => estimate.sourceCandidateIds))
    const citedSources = providerSources.filter(source => providerIds.has(source.candidate.candidateId))
    const citedSourceIds = new Set(citedSources.map(source => source.candidate.candidateId))
    const contributorRows = [thsSurface, eastmoneySurface].flatMap(item => item.estimates
      .filter(estimate => estimate.sourceCandidateIds.some(id => citedSourceIds.has(id)))
      .sort((left, right) => left.institutionKey < right.institutionKey ? -1 : left.institutionKey > right.institutionKey ? 1 : 0)
      .map(estimate => {
        const provider = item.surface.provider === 'Tonghuashun / 同花顺' ? '同花顺' : 'EastMoney'
        const estimateCitations = citations(estimate.sourceCandidateIds.filter(id => citedSourceIds.has(id)))
        return `| ${provider} | ${estimate.institutionKey} | ${estimate.fiscalPeriod} | ${String(estimate.value)} ${estimate.unit} | ${estimate.publishedAt} | ${estimateCitations} |`
      }))
    const contributorTable = `\n\n| 预期面 | 机构 | 财年 | EPS / 单位 | 发布日期 | 原始样本来源 |\n|---|---|---|---:|---|---|\n${contributorRows.join('\n')}`
    // Current snapshots and historical immutable versions are distinct claims.
    // A content-bound snapshot does not verify the source's historical revisions.
    // No current provider path independently authenticates immutable revision
    // history. Both the current snapshot and any unrecognized mode remain
    // explicitly unverified as historical value versions.
    const versionStatus = 'UNVERIFIED'
    diagnostics.push('VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED')
    const versionGap = `研究缺口：机构预测的历史数值版本未核验（本轮同花顺/EastMoney FY${input.acquisition.expectationTargetFiscalYear} EPS）；当前样本仅由截止时点快照、来源正文哈希及逐点字段绑定支持，不能证明更早的修订历史。估计路由尝试及资格状态：${acquisitionAttemptSummary(input.acquisition.earningsExpectationItems)}。现有输出未提供可验证的公司指引或独立本方预测面。以下样本差异仅表示本轮封存的可见数据，不构成历史预期差结论。\n\n`
    const dedupeNote = dedupedExpectations.overlaps.length
      ? `两个渠道存在 ${dedupedExpectations.overlaps.length} 家重叠机构；同一机构只保留截至 asOf 发布时间较新的唯一预测，平局固定优先同花顺。`
      : '两个渠道没有识别到重叠机构。'
    variantSection = {
      id: 'variant-perception', title: titles['variant-perception'],
      markdown: `${versionGap}FY${input.acquisition.expectationTargetFiscalYear} EPS 的两个可比预期面均采用 ${thsSurface.snapshot.unit}，并按机构和发布时间截至 ${input.asOf.slice(0, 10)} 去重。同花顺去重归属样本 ${thsSurface.snapshot.count} 家，中位数为 ${thsSurface.snapshot.median.toFixed(2)}；EastMoney 去重归属样本 ${eastmoneySurface.snapshot.count} 家，中位数为 ${eastmoneySurface.snapshot.median.toFixed(2)} ${citations(citedSources.map(source => source.candidate.candidateId))}。按“EastMoney 中位数 − 同花顺中位数”计算的渠道差为 ${comparisonDelta.toFixed(2)} ${thsSurface.snapshot.unit}。该渠道差仅作来源渠道对照，不构成已通过的独立预期面。${dedupeNote} 下表逐项列出保留的机构预测、发布日期、期间、单位及原始样本引用，供复核样本数和中位数。两个聚合渠道的历史数值版本状态为 ${versionStatus}；因此这只说明当前可见的可比预测差，不能证明历史版本在该日已存在，也不等同于公司指引、独立本方预测或市场定价偏差。${contributorTable}`,
      sourceCandidateIds: citedSources.map(source => source.candidate.candidateId),
    }
  } else {
    diagnostics.push('VARIANT_PERCEPTION_REQUIRES_TWO_COMPARABLE_UNIQUE_PROVIDER_SURFACES')
  }
  const sections = [valuationSection, scenarioSection, variantSection]
  const includedIds = new Set([...sections.flatMap((section) => section.sourceCandidateIds)])
  return {
    sections,
    evidenceSources,
    reportSourceCandidateIds: [...includedIds],
    diagnostics: [...new Set(diagnostics)],
  }
}
