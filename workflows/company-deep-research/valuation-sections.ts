import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { buildConsensusSnapshot } from '../../skills/earnings-review/expectations/consensus.ts'
import { buildValuationBasis, methodEligibility } from '../../skills/valuation/financials.ts'
import { THS_EPS_UNIT } from '../../plugins/research-acquisition/earnings-expectations-ths.ts'
import type { CompanyReadOnlyAcquisition } from './contracts.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'

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

type ExpectationSurface = { readonly provider: 'Tonghuashun / 同花顺' | 'EastMoney'; readonly estimates: readonly EstimatePoint[]; readonly sources: readonly NormalizedResearchSource[] }

function canonicalInstitutionName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s　·.（）()]/gu, '').replace(/(证券|银行|研究所)?(股份有限公司|有限责任公司|有限公司|股份|有限)$/u, '$1')
}

function expectationSurfaces(acquisition: CompanyReadOnlyAcquisition, targetFiscalYear: number, asOf: string): readonly ExpectationSurface[] {
  const item = acquisition.earningsExpectationItems.find(candidate => candidate.metricId === 'earnings_expectation_eps')
  if (!item) return []
  const payloads = [item.value, ...(item.acquisition.observations ?? []).map(observation => observation.data)]
    .filter((value): value is NonNullable<typeof item.value> => value?.kind === 'expectation')
  const grouped = new Map<ExpectationSurface['provider'], { estimates: EstimatePoint[]; sources: NormalizedResearchSource[] }>()
  for (const payload of payloads) {
    if (payload.kind !== 'expectation') continue
    const sources = payload.projection.sources
    const sourceIds = new Set(sources.map(source => source.candidate.candidateId))
    const estimates = payload.projection.estimates.filter(estimate => estimate.metric === 'eps'
      && estimate.fiscalPeriod === `${targetFiscalYear}-FY`
      && estimate.unit === THS_EPS_UNIT
      && Number.isFinite(estimate.value)
      && Number.isFinite(Date.parse(estimate.publishedAt))
      && Date.parse(estimate.publishedAt) <= Date.parse(asOf)
      && estimate.sourceCandidateIds.every(id => sourceIds.has(id)))
      .map(estimate => {
        const institution = payload.projection.institutions.find(item => item.institutionKey === estimate.institutionKey)?.name
        return institution ? { ...estimate, institutionKey: institution } : estimate
      })
    const provider = sources.some(source => /eastmoney/i.test(`${source.candidate.provider} ${source.publisher}`)) ? 'EastMoney'
      : sources.some(source => /tonghuashun|同花顺|ths/i.test(`${source.candidate.provider} ${source.publisher}`)) ? 'Tonghuashun / 同花顺'
        : undefined
    if (!provider || estimates.length === 0) continue
    const current = grouped.get(provider) ?? { estimates: [], sources: [] }
    current.estimates.push(...estimates)
    current.sources.push(...sources)
    grouped.set(provider, current)
  }
  return [...grouped.entries()].map(([provider, value]) => ({
    provider,
    estimates: value.estimates,
    sources: [...new Map(value.sources.map(source => [source.candidate.candidateId, source])).values()],
  }))
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
  readonly acquisition?: CompanyReadOnlyAcquisition
  readonly sources: readonly NormalizedResearchSource[]
}): CompanyValuationSectionsResult {
  const diagnostics: string[] = []
  const variantGap = gap('variant-perception', titles['variant-perception'], '未取得与 FY2026 EPS 共识同指标、同期间、同单位的公司指引或独立本方预测')
  if (!input.acquisition) return { sections: [gap('valuation', titles.valuation, '估值数据解析器未配置或共享采集预算已耗尽'), gap('bull-base-bear', titles['bull-base-bear'], '估值数据解析器未配置或共享采集预算已耗尽'), variantGap], evidenceSources: [], reportSourceCandidateIds: [], diagnostics: ['VALUATION_DATA_RESOLVER_NOT_CONFIGURED_OR_BUDGET_EXHAUSTED'] }
  if (input.acquisition.valuationError) diagnostics.push(`VALUATION_RESOLVER_ERROR:${input.acquisition.valuationError}`)
  if (input.acquisition.earningsExpectationError) diagnostics.push(`EARNINGS_EXPECTATION_RESOLVER_ERROR:${input.acquisition.earningsExpectationError}`)
  diagnostics.push(...input.acquisition.valuationItems.filter(item => item.status !== 'AVAILABLE').map(item => `VALUATION_ITEM_${item.metricId}_${item.status}`))
  diagnostics.push(...input.acquisition.earningsExpectationItems.filter(item => item.status !== 'AVAILABLE').map(item => `EXPECTATION_ITEM_${item.metricId}_${item.status}`))

  const basisYear = input.acquisition.valuationBasisFiscalYear
  const quoteItem = input.acquisition.valuationItems.find((item) => item.metricId === 'valuation_market_price')
  const quote = quoteItem?.status === 'AVAILABLE' && quoteItem.value?.kind === 'market'
    && quoteItem.quality.pointInTimeSafe
    && quoteItem.value.observation.priceDate <= input.asOf.slice(0, 10)
    ? quoteItem.value
    : undefined
  if (!quote) diagnostics.push('VALUATION_MARKET_CLOSE_NOT_PIT_SAFE')

  const filingEps = extractFilingBasicEps(input.sources, basisYear, input.asOf)
  if (!filingEps) diagnostics.push('VALUATION_FILING_BASIC_EPS_UNAVAILABLE_OR_AMBIGUOUS')

  const surfaces = expectationSurfaces(input.acquisition, input.acquisition.expectationTargetFiscalYear, input.asOf)
  const expectationItem = input.acquisition.earningsExpectationItems.find(item => item.metricId === 'earnings_expectation_eps')
  const dedupedExpectations = dedupeContributors(surfaces)
  const estimates = dedupedExpectations.all

  const marketEvidenceSource = quote ? quoteSource({
    company: input.company,
    asOf: input.asOf,
    value: quote.observation.close,
    priceDate: quote.observation.priceDate,
    originalSourceId: quote.sourceId,
    originPublisher: quote.originPublisher,
    retrievalProvider: quote.retrievalProvider,
    sourceUrl: quote.sourceUrl,
    retrievedAt: quote.retrievedAt,
  }) : undefined
  const selectedEstimateIds = new Set(estimates.flatMap((estimate) => estimate.sourceCandidateIds))
  const estimateSources = surfaces.flatMap(surface => surface.sources).filter((source, index, all) => selectedEstimateIds.has(source.candidate.candidateId) && all.findIndex(candidate => candidate.candidate.candidateId === source.candidate.candidateId) === index)
  const evidenceSources = [...(marketEvidenceSource ? [marketEvidenceSource] : []), ...estimateSources]
  const marketSourceId = marketEvidenceSource?.candidate.candidateId
  const epsSourceId = filingEps?.source.candidate.candidateId
  const baseSourceIds = [...new Set([marketSourceId, epsSourceId].filter((value): value is string => value !== undefined))]

  let valuationSection = gap('valuation', titles.valuation, '无法同时确认 PIT 收盘价与年度报告基本 EPS')
  let scenarioSection = gap('bull-base-bear', titles['bull-base-bear'], '本轮没有来源支持的目标年经营驱动假设、统一财务口径及可复算敏感性参数；因此不建立三情景估值')
  diagnostics.push('SCENARIO_OPERATING_DRIVER_PLAN_NOT_AVAILABLE')
  if (quote && filingEps && marketEvidenceSource) {
    const reportDate = filingEps.source.candidate.publishedAt!.slice(0, 10)
    const market = { priceDate: quote.observation.priceDate, close: quote.observation.close }
    const basis = buildValuationBasis(market, { basisFiscalYear: basisYear, reportDate: `${basisYear}-12-31`, publicationDate: reportDate, eps: filingEps.value }, input.asOf.slice(0, 10), 'verified')
    const eligible = methodEligibility(basis)
    const peEligible = eligible.find((item) => item.method === 'PE')?.eligible === true
    const currentPe = basis.marketPrice / filingEps.value
    if (peEligible && Number.isFinite(currentPe) && currentPe > 0) {
      const filedRef = `[${filingEps.source.candidate.candidateId}@${filingEps.location}]`
      const marketRef = citations([marketSourceId!])
      valuationSection = {
        id: 'valuation', title: titles.valuation,
        markdown: `截至 ${quote.observation.priceDate}，${quote.originPublisher} 未复权收盘价为 ${quote.observation.close} CNY/share ${marketRef}。FY${basisYear} 年报基本 EPS 为 ${filingEps.value} CNY/share ${filedRef}，以收盘价除以该 EPS 得到参考 PE ${currentPe.toFixed(2)} 倍。当前数据未提供可确认的 FY${basisYear} BVPS，PB 不适用；同业候选缺少可复核的日期和统一估值口径，因此本节不采用可比公司倍数。参考 PE 是当前盈利基准下的倍数描述，不构成目标价或买卖建议。`,
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
    const versionEvidence = (expectationItem?.acquisition.observations ?? []).map(observation => observation.source.valueVersion)
    const versionStatus = versionEvidence.length > 0 && versionEvidence.every(evidence => evidence?.status === 'VERIFIED') ? 'VERIFIED' : 'UNVERIFIED'
    if (versionStatus !== 'VERIFIED') diagnostics.push('VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED')
    const versionGap = versionStatus === 'VERIFIED'
      ? ''
      : '研究缺口：机构预测的历史数值版本未核验，以下样本差异仅用于复核当前可见数据，不构成符合asOf的预期差结论。\n\n'
    const dedupeNote = dedupedExpectations.overlaps.length
      ? `两个渠道存在 ${dedupedExpectations.overlaps.length} 家重叠机构；同一机构只保留截至 asOf 发布时间较新的唯一预测，平局固定优先同花顺。`
      : '两个渠道没有识别到重叠机构。'
    variantSection = {
      id: 'variant-perception', title: titles['variant-perception'],
      markdown: `${versionGap}FY${input.acquisition.expectationTargetFiscalYear} EPS 的两个可比预期面均采用 ${thsSurface.snapshot.unit}，并按机构和发布时间截至 ${input.asOf.slice(0, 10)} 去重。同花顺去重归属样本 ${thsSurface.snapshot.count} 家，中位数为 ${thsSurface.snapshot.median}；EastMoney 去重归属样本 ${eastmoneySurface.snapshot.count} 家，中位数为 ${eastmoneySurface.snapshot.median} ${citations(citedSources.map(source => source.candidate.candidateId))}。按“EastMoney 中位数 − 同花顺中位数”计算的渠道差为 ${comparisonDelta.toFixed(2)} ${thsSurface.snapshot.unit}。${dedupeNote} 下表逐项列出保留的机构预测、发布日期、期间、单位及原始样本引用，供复核样本数和中位数。两个聚合渠道的历史数值版本状态为 ${versionStatus}；因此这只说明当前可见的可比预测差，不能证明历史版本在该日已存在，也不等同于公司指引、独立本方预测或市场定价偏差。${contributorTable}`,
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
