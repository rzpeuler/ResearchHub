import type { CompanyFinancialObservation } from '../../data/company-research-contracts.ts'
import type { NormalizedResearchSource, ResearchCompanyIdentity } from '../../plugins/research-acquisition/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'

export type CompanyScenarioName = 'bull' | 'base' | 'bear'
export interface ScenarioEvidenceRef { readonly sourceCandidateId: string; readonly location: `paragraph:${number}` }

export interface CompanyScenarioHistoryPoint {
  readonly value: number
  readonly periodEnd: string
  readonly publishedAt: string
  readonly evidence: ScenarioEvidenceRef
  /** Hash of the exact normalized text used to bind this row, not a numeric-version proof. */
  readonly sourceContentHash: string
  readonly verificationStatus: 'EXACT_OFFICIAL_ROW_AND_DATA_OBSERVATION_MATCHED'
}

export interface CompanyScenarioDriver {
  readonly scenarioId: CompanyScenarioName
  readonly targetFiscalYear: 2026
  readonly basisDate: string
  readonly valuationMethod: 'OPERATING_BRIDGE_ONLY_NO_FORWARD_VALUATION'
  readonly financialMetric: 'revenue' | 'netProfit'
  readonly scope: 'consolidated'
  readonly historicalBaseValue: number
  readonly basePeriod: '2025-12-31'
  readonly baseSourceRefs: readonly [ScenarioEvidenceRef]
  readonly proposedAssumption: { readonly value: number; readonly unit: 'fraction'; readonly originKind: 'RESEARCH_ASSUMPTION' }
  readonly targetMetric: 'FY2026 revenue' | 'FY2026 parent-attributable net profit'
  readonly peerOrMultipleBasis: 'NOT_APPLIED_NO_QUALIFIED_FORWARD_VALUATION_BASIS'
  readonly inputDependencies: readonly ScenarioEvidenceRef[]
  readonly id: 'revenue' | 'parent-net-profit'
  readonly metricKey: 'revenue' | 'netProfit'
  readonly metricLabel: string
  readonly unit: 'CNY'
  readonly currency: 'CNY'
  readonly basis: 'YTD'
  readonly historical: readonly CompanyScenarioHistoryPoint[]
  readonly proposal: {
    readonly rateOriginKind: 'RESEARCH_ASSUMPTION'
    readonly rate: number
    readonly targetValue: number
    readonly targetValueOriginKind: 'DERIVED'
    readonly targetPeriod: '2026-12-31'
  }
  /** Mechanical calibration rationale only; economic reasonableness needs separate semantic review. */
  readonly rationale: string
  readonly assumptionDerivation: string
  readonly derivation: string
  readonly counterEvidenceRefs: readonly ScenarioEvidenceRef[]
  readonly counterevidence: readonly ScenarioEvidenceRef[]
  readonly falsificationTrigger: string
  readonly confidenceLimitations: string
  readonly limitations: string
  readonly forecastBridge: { readonly formula: 'last_observation * (1 + rate)' }
  readonly sensitivityRange: { readonly lowRate: number; readonly highRate: number }
  readonly dependencies: readonly ScenarioEvidenceRef[]
}

export interface CompanyScenarioSensitivityCell {
  readonly revenueRate: number
  readonly parentNetProfitRate: number
  readonly revenue: number
  readonly parentNetProfit: number
  readonly impliedParentNetMargin: number
  readonly originKind: 'DERIVED'
}

export interface CompanyScenarioSensitivityGrid {
  readonly targetFiscalYear: 2026
  readonly rowRates: readonly [number, number, number]
  readonly columnRates: readonly [number, number, number]
  /** Rows vary revenue growth; columns independently vary parent-attributable net-profit growth. */
  readonly cells: readonly (readonly [CompanyScenarioSensitivityCell, CompanyScenarioSensitivityCell, CompanyScenarioSensitivityCell])[]
}

export interface CompanyScenarioAssumptionsPlan {
  readonly workflowRunId: string
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly targetFiscalYear: 2026
  readonly method: { readonly name: 'historical-envelope-operating-bridge'; readonly outputMetric: 'FY2026 revenue and parent-attributable net profit'; readonly outputUnit: 'CNY'; readonly outputBasis: 'FY' }
  readonly economicRationaleStatus: 'REQUIRES_SEMANTIC_REVIEW'
  readonly h1CrossCheck: {
    readonly periodEnd: '2026-06-30'
    readonly priorPeriodEnd: '2025-06-30'
    readonly publishedAt: string
    readonly revenue: { readonly current: number; readonly prior: number; readonly yoy: number; readonly evidence: ScenarioEvidenceRef }
    readonly parentNetProfit: { readonly current: number; readonly prior: number; readonly yoy: number; readonly evidence: ScenarioEvidenceRef }
  }
  readonly sensitivityGrid: CompanyScenarioSensitivityGrid
  readonly scenarios: readonly {
    readonly name: CompanyScenarioName
    readonly drivers: readonly [CompanyScenarioDriver, CompanyScenarioDriver]
    readonly impliedParentNetMargin: { readonly value: number; readonly originKind: 'DERIVED' }
  }[]
}

export interface CompanyScenarioAssumptionBuildInput {
  readonly runId: string
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly targetFiscalYear: number
  readonly observations: readonly CompanyFinancialObservation[]
  readonly sources: readonly NormalizedResearchSource[]
}

export interface CompanyScenarioAssumptionBuildResult {
  /** The candidate is blocked from report use until an independent reviewer validates its economic rationale. */
  readonly status: 'blocked' | 'candidate_requires_semantic_review'
  readonly plan?: CompanyScenarioAssumptionsPlan
  readonly diagnostics: readonly string[]
}

export interface CompanyScenarioValidationInput {
  readonly plan: CompanyScenarioAssumptionsPlan
  readonly currentRunId: string
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly targetFiscalYear: number
  readonly sources: readonly NormalizedResearchSource[]
  readonly observations: readonly CompanyFinancialObservation[]
}

export interface CompanyScenarioValidationResult {
  /** True only after both structural checks and an independent economic review; this module cannot set it true. */
  readonly valid: boolean
  readonly structurallyValid: boolean
  readonly reportEligible: false
  readonly diagnostics: readonly string[]
}

const TARGET_YEAR = 2026 as const
const METHOD: CompanyScenarioAssumptionsPlan['method'] = {
  name: 'historical-envelope-operating-bridge',
  outputMetric: 'FY2026 revenue and parent-attributable net profit',
  outputUnit: 'CNY',
  outputBasis: 'FY',
}
const METRICS = [
  { id: 'revenue', key: 'revenue', label: '营业收入', row: /^营业收入\s*[（(]元[）)]/u },
  { id: 'parent-net-profit', key: 'netProfit', label: '归属于上市公司股东的净利润', row: /^归属于上市公司股东的净利润\s*[（(]元[）)]/u },
] as const
type Metric = typeof METRICS[number]
type ParsedMetricRow = { readonly line: number; readonly valuesByYear: ReadonlyMap<number, number> }

const dateOnly = (value: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return Number.NaN
  return Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)
}
const close = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-10)
const normalize = (value: string): string => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const numberTokens = (value: string): { value: number; percent: boolean }[] => [...value.matchAll(/(?<![\p{L}\d])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\p{L}\d])/gu)]
  .map(match => ({ value: Number(match[0]!.replace(/,/gu, '')), percent: /^\s*[%％]/u.test(value.slice(match.index! + match[0]!.length)) }))
  .filter(item => Number.isFinite(item.value))

function companyIdentifiesSource(company: ResearchCompanyIdentity, source: NormalizedResearchSource): boolean {
  if (!company.name?.trim()) return false
  const opening = source.content.split(/\r?\n/u).slice(0, 40).map(normalize).join(' ')
  const name = normalize(company.name)
  return name.length >= 2 && opening.includes(name)
}

function sourceIsUsable(source: NormalizedResearchSource, company: ResearchCompanyIdentity, asOfTime: number, annual: boolean): boolean {
  const publishedAt = dateOnly(source.candidate.publishedAt ?? '')
  if (source.candidate.kind !== 'official_disclosure' || !Number.isFinite(publishedAt) || publishedAt > asOfTime) return false
  if (!companyIdentifiesSource(company, source)) return false
  if (source.rights.accessScope !== 'public' || source.rights.aiProcessingAllowed !== true || source.rights.retentionAllowed !== true) return false
  return annual
    ? /(?:19|20)\d{2}\s*年.*(?:年度报告|年报)/u.test(normalize(source.candidate.title))
    : /2026\s*年.*半年度报告/u.test(normalize(source.candidate.title))
}

function reportYear(source: NormalizedResearchSource): number | undefined {
  const match = /((?:19|20)\d{2})\s*年/u.exec(normalize(source.candidate.title))
  return match ? Number(match[1]) : undefined
}

/** Parse the exact metric row against the nearest preceding three-year column header. */
function parseAnnualMetricRow(source: NormalizedResearchSource, metric: Metric): ParsedMetricRow[] {
  const lines = source.content.split(/\r?\n/u).map(normalize)
  const rows: ParsedMetricRow[] = []
  for (let line = 0; line < lines.length; line++) {
    const row = lines[line]!
    if (!metric.row.test(row)) continue
    let years: number[] | undefined
    for (let header = line - 1; header >= Math.max(0, line - 10); header--) {
      const headerText = lines[header]!
      const candidateYears = [...headerText.matchAll(/((?:19|20)\d{2})\s*年/gu)].map(match => Number(match[1]))
      if (candidateYears.length === 3 && new Set(candidateYears).size === 3) { years = candidateYears; break }
    }
    if (!years || new Set(years).size !== 3) continue
    const remainder = row.replace(metric.row, '')
    const values = numberTokens(remainder).filter(item => !item.percent).map(item => item.value)
    // Annual headline rows contain three year values and an intervening yoy percentage.
    if (values.length !== 3 || years.some(year => year < 2020 || year > TARGET_YEAR)) continue
    rows.push({ line, valuesByYear: new Map(years.map((year, index) => [year, values[index]!])) })
  }
  return rows
}

/** Parse the exact half-year row with separate current/prior header lines and a trailing yoy percentage. */
function parseHalfYearMetricRow(source: NormalizedResearchSource, metric: Metric): ParsedMetricRow[] {
  const lines = source.content.split(/\r?\n/u).map(normalize)
  const rows: ParsedMetricRow[] = []
  for (let line = 0; line < lines.length; line++) {
    const row = lines[line]!
    if (!metric.row.test(row)) continue
    const header = lines.slice(Math.max(0, line - 8), line).join(' ')
    if (!header.includes('本报告期') || !header.includes('上年同期')) continue
    const values = numberTokens(row.replace(metric.row, '')).filter(item => !item.percent).map(item => item.value)
    if (values.length !== 2) continue
    rows.push({ line, valuesByYear: new Map([[2026, values[0]!], [2025, values[1]!]]) })
  }
  return rows
}

function ref(source: NormalizedResearchSource, line: number): ScenarioEvidenceRef {
  return { sourceCandidateId: source.candidate.candidateId, location: `paragraph:${line + 1}` }
}

function matchingObservation(
  observations: readonly CompanyFinancialObservation[],
  metric: Metric,
  periodEnd: string,
): { readonly observation?: CompanyFinancialObservation; readonly diagnostic?: string } {
  const candidates = observations.filter(item => item.periodEnd === periodEnd && item.metrics[metric.key] !== undefined)
  if (candidates.length !== 1) return { diagnostic: candidates.length === 0 ? 'OBSERVATION_MISSING' : 'OBSERVATION_DUPLICATED_OR_CONFLICTED' }
  const observation = candidates[0]!
  if (observation.sourceConflicts?.some(conflict => conflict.metric === metric.key)) return { diagnostic: 'OBSERVATION_SOURCE_CONFLICT' }
  const value = observation.metrics[metric.key]
  const metadata = observation.metricMetadata?.[metric.key]
  if (!Number.isFinite(value) || value! <= 0 || metadata?.unit !== 'CNY' || metadata.currency !== 'CNY' || metadata.basis !== 'YTD' || !observation.publishedAt) return { diagnostic: 'OBSERVATION_NOT_POSITIVE_CNY_YTD' }
  return { observation }
}

type EvidenceBoundObservation = { readonly observation: CompanyFinancialObservation; readonly source: NormalizedResearchSource; readonly location: `paragraph:${number}` }

function findAnnualEvidence(input: CompanyScenarioAssumptionBuildInput, metric: Metric, year: number, asOfTime: number): EvidenceBoundObservation | undefined {
  const matches: EvidenceBoundObservation[] = []
  const disclosedValues: number[] = []
  for (const source of input.sources) {
    if (!sourceIsUsable(source, input.company, asOfTime, true)) continue
    const yearInTitle = reportYear(source)
    if (yearInTitle === undefined || yearInTitle < year || yearInTitle > year + 2) continue
    const rows = parseAnnualMetricRow(source, metric)
    if (rows.length !== 1) continue
    const row = rows[0]!
    const rowValue = row.valuesByYear.get(year)
    if (rowValue === undefined) continue
    disclosedValues.push(rowValue)
    const joined = matchingObservation(input.observations, metric, `${year}-12-31`)
    if (!joined.observation || joined.observation.metrics[metric.key] !== rowValue) continue
    matches.push({ observation: joined.observation, source, location: `paragraph:${row.line + 1}` })
  }
  if (new Set(disclosedValues).size > 1) return undefined
  // Multiple filings for one year are acceptable only when they carry the same exact fact; use the earliest qualifying report deterministically.
  if (!matches.length) return undefined
  if (matches.some(item => !close(item.observation.metrics[metric.key]!, matches[0]!.observation.metrics[metric.key]!))) return undefined
  matches.sort((left, right) => (reportYear(left.source) ?? Infinity) - (reportYear(right.source) ?? Infinity) || left.source.candidate.candidateId.localeCompare(right.source.candidate.candidateId))
  const chosen = matches[0]!
  const duplicateRef = matches.filter(item => item.source.candidate.candidateId === chosen.source.candidate.candidateId && item.location === chosen.location)
  return duplicateRef.length === 1 ? chosen : undefined
}

function findH1CrossCheck(input: CompanyScenarioAssumptionBuildInput, metric: Metric, asOfTime: number): {
  readonly current: number; readonly prior: number; readonly currentObservation: CompanyFinancialObservation; readonly evidence: ScenarioEvidenceRef; readonly source: NormalizedResearchSource
} | undefined {
  const sources = input.sources.filter(source => sourceIsUsable(source, input.company, asOfTime, false))
  const values: { current: number; prior: number; currentObservation: CompanyFinancialObservation; evidence: ScenarioEvidenceRef; source: NormalizedResearchSource }[] = []
  for (const source of sources) {
    const rows = parseHalfYearMetricRow(source, metric)
    if (rows.length !== 1) continue
    const row = rows[0]!
    const current = row.valuesByYear.get(2026)
    const prior = row.valuesByYear.get(2025)
    if (current === undefined || prior === undefined) continue
    const currentJoined = matchingObservation(input.observations, metric, '2026-06-30')
    const priorJoined = matchingObservation(input.observations, metric, '2025-06-30')
    if (!currentJoined.observation || !priorJoined.observation) continue
    if (!Number.isFinite(dateOnly(currentJoined.observation.publishedAt ?? '')) || dateOnly(currentJoined.observation.publishedAt!) > asOfTime || !Number.isFinite(dateOnly(priorJoined.observation.publishedAt ?? '')) || dateOnly(priorJoined.observation.publishedAt!) > asOfTime) continue
    if (currentJoined.observation.metrics[metric.key] !== current || priorJoined.observation.metrics[metric.key] !== prior) continue
    values.push({ current, prior, currentObservation: currentJoined.observation, evidence: ref(source, row.line), source })
  }
  return values.length === 1 ? values[0] : undefined
}

function rateEnvelope(history: readonly CompanyScenarioHistoryPoint[]): readonly [number, number, number] | undefined {
  const ordered = [...history].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
  if (ordered.length !== 3 || ordered.some(point => !Number.isFinite(point.value) || point.value <= 0)) return undefined
  if (ordered[0]!.periodEnd !== '2023-12-31' || ordered[1]!.periodEnd !== '2024-12-31' || ordered[2]!.periodEnd !== '2025-12-31') return undefined
  const rates = ordered.slice(1).map((point, index) => point.value / ordered[index]!.value - 1)
  if (rates.some(rate => !Number.isFinite(rate))) return undefined
  const low = Math.min(...rates)
  const high = Math.max(...rates)
  const middle = (low + high) / 2
  if (!(low < middle && middle < high)) return undefined
  return [low, middle, high]
}

function makeSensitivityGrid(
  revenueBase: number,
  profitBase: number,
  revenueRates: readonly [number, number, number],
  profitRates: readonly [number, number, number],
): CompanyScenarioSensitivityGrid | undefined {
  const rows = revenueRates.map(revenueRate => profitRates.map(parentNetProfitRate => {
    const revenue = revenueBase * (1 + revenueRate)
    const parentNetProfit = profitBase * (1 + parentNetProfitRate)
    const impliedParentNetMargin = parentNetProfit / revenue
    return { revenueRate, parentNetProfitRate, revenue, parentNetProfit, impliedParentNetMargin, originKind: 'DERIVED' as const }
  }) as [CompanyScenarioSensitivityCell, CompanyScenarioSensitivityCell, CompanyScenarioSensitivityCell]) as CompanyScenarioSensitivityGrid['cells']
  const all = rows.flat()
  if (all.some(cell => !Number.isFinite(cell.revenue) || !Number.isFinite(cell.parentNetProfit) || !Number.isFinite(cell.impliedParentNetMargin))) return undefined
  // Revenue is monotone by row; profit is monotone by column. Implied margin is monotone in each independent input.
  for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) {
    const cell = rows[row]![column]!
    if (row < 2 && !(cell.revenue < rows[row + 1]![column]!.revenue)) return undefined
    if (column < 2 && !(cell.parentNetProfit < rows[row]![column + 1]!.parentNetProfit)) return undefined
    if (row < 2 && !(cell.impliedParentNetMargin > rows[row + 1]![column]!.impliedParentNetMargin)) return undefined
    if (column < 2 && !(cell.impliedParentNetMargin < rows[row]![column + 1]!.impliedParentNetMargin)) return undefined
  }
  return { targetFiscalYear: TARGET_YEAR, rowRates: revenueRates, columnRates: profitRates, cells: rows }
}

function driverFor(
  scenarioId: CompanyScenarioName,
  metric: Metric,
  history: readonly CompanyScenarioHistoryPoint[],
  rate: number,
  crossEvidence: ScenarioEvidenceRef,
  asOf: string,
): CompanyScenarioDriver {
  const last = history.at(-1)!
  const envelope = rateEnvelope(history)!
  const derivation = `FY2026 ${metric.label} = FY2025 ${last.value} CNY × (1 + ${rate}); 计算值为 ${last.value * (1 + rate)} CNY。`
  const limitations = '两段历史同比增速不足以证明未来驱动、结构或利润可持续；未把2026H1 YTD同比混入年度校准，也未给出情景概率或目标价。未具备经验证的前瞻估值方法/倍数输入，因此本情景只输出经营指标，不输出股权价值或企业价值。'
  return {
    scenarioId,
    targetFiscalYear: TARGET_YEAR,
    basisDate: asOf,
    valuationMethod: 'OPERATING_BRIDGE_ONLY_NO_FORWARD_VALUATION',
    financialMetric: metric.key,
    scope: 'consolidated',
    historicalBaseValue: last.value,
    basePeriod: '2025-12-31',
    baseSourceRefs: [last.evidence],
    proposedAssumption: { value: rate, unit: 'fraction', originKind: 'RESEARCH_ASSUMPTION' },
    targetMetric: metric.key === 'revenue' ? 'FY2026 revenue' : 'FY2026 parent-attributable net profit',
    peerOrMultipleBasis: 'NOT_APPLIED_NO_QUALIFIED_FORWARD_VALUATION_BASIS',
    inputDependencies: history.map(point => point.evidence),
    id: metric.id,
    metricKey: metric.key,
    metricLabel: metric.label,
    unit: 'CNY', currency: 'CNY', basis: 'YTD', historical: history,
    proposal: { rateOriginKind: 'RESEARCH_ASSUMPTION', rate, targetValue: last.value * (1 + rate), targetValueOriginKind: 'DERIVED', targetPeriod: '2026-12-31' },
    rationale: `研究假设：FY2023-FY2025 两个同比增速包络为 ${(envelope[0] * 100).toFixed(2)}% 至 ${(envelope[2] * 100).toFixed(2)}%；本案取 ${(rate * 100).toFixed(2)}%。中位情景取上下界算术中点，仅为校准约定，不是概率或共识。历史范围本身不证明经济合理性。`,
    assumptionDerivation: derivation,
    derivation,
    counterEvidenceRefs: [crossEvidence],
    counterevidence: [crossEvidence],
    falsificationTrigger: `FY2026 年报披露的${metric.label}若低于或高于该情景推算值，则该情景的点预测被证伪；2026H1同比结果仅作中期交叉核对。`,
    confidenceLimitations: limitations,
    limitations,
    forecastBridge: { formula: 'last_observation * (1 + rate)' },
    sensitivityRange: { lowRate: envelope[0], highRate: envelope[2] },
    dependencies: history.map(point => point.evidence),
  }
}

/** Build FY2026 arithmetic candidates from official annual rows. This cannot establish economic reasonableness. */
export function buildCompanyScenarioAssumptionPlan(input: CompanyScenarioAssumptionBuildInput): CompanyScenarioAssumptionBuildResult {
  const diagnostics: string[] = []
  const cutoff = dateOnly(input.asOf)
  if (!input.runId.trim() || !input.company.symbol.trim() || !input.company.name?.trim() || !Number.isFinite(cutoff)) diagnostics.push('RUN_COMPANY_OR_AS_OF_UNVERIFIABLE')
  if (input.targetFiscalYear !== TARGET_YEAR) diagnostics.push('ONLY_FY2026_SCENARIOS_SUPPORTED')
  if (Number.isFinite(cutoff) && new Date(cutoff).getUTCFullYear() !== TARGET_YEAR) diagnostics.push('AS_OF_MUST_BE_FY2026')
  if (diagnostics.length) return { status: 'blocked', diagnostics }

  const histories = new Map<Metric, CompanyScenarioHistoryPoint[]>()
  for (const metric of METRICS) {
    const history: CompanyScenarioHistoryPoint[] = []
    for (const year of [2023, 2024, 2025]) {
      const evidence = findAnnualEvidence(input, metric, year, cutoff)
      if (!evidence) { diagnostics.push(`ANNUAL_SOURCE_OBSERVATION_JOIN_UNPROVEN:${metric.key}:${year}`); continue }
      const publishedAt = evidence.observation.publishedAt!
      if (!Number.isFinite(dateOnly(publishedAt)) || dateOnly(publishedAt) > cutoff) { diagnostics.push(`ANNUAL_OBSERVATION_PUBLISHED_AFTER_AS_OF:${metric.key}:${year}`); continue }
      history.push({ value: evidence.observation.metrics[metric.key]!, periodEnd: `${year}-12-31`, publishedAt, evidence: { sourceCandidateId: evidence.source.candidate.candidateId, location: evidence.location }, sourceContentHash: sha256(evidence.source.content), verificationStatus: 'EXACT_OFFICIAL_ROW_AND_DATA_OBSERVATION_MATCHED' })
    }
    if (history.length !== 3) diagnostics.push(`ANNUAL_HISTORY_INCOMPLETE:${metric.key}`)
    if (!rateEnvelope(history)) diagnostics.push(`ANNUAL_RATE_ENVELOPE_INVALID:${metric.key}`)
    histories.set(metric, history)
  }
  const h1 = new Map<Metric, ReturnType<typeof findH1CrossCheck> extends infer _ ? NonNullable<ReturnType<typeof findH1CrossCheck>> : never>()
  for (const metric of METRICS) {
    const crossCheck = findH1CrossCheck(input, metric, cutoff)
    if (!crossCheck) diagnostics.push(`FY2026_H1_CROSS_CHECK_UNPROVEN:${metric.key}`)
    else h1.set(metric, crossCheck)
  }
  if (diagnostics.length) return { status: 'blocked', diagnostics: [...new Set(diagnostics)].sort() }

  const revenueMetric = METRICS[0]!
  const profitMetric = METRICS[1]!
  const revenueHistory = histories.get(revenueMetric)!
  const profitHistory = histories.get(profitMetric)!
  const revenueRates = rateEnvelope(revenueHistory)!
  const profitRates = rateEnvelope(profitHistory)!
  const revenueBase = revenueHistory.at(-1)!.value
  const profitBase = profitHistory.at(-1)!.value
  const sensitivityGrid = makeSensitivityGrid(revenueBase, profitBase, revenueRates, profitRates)
  if (!sensitivityGrid) return { status: 'blocked', diagnostics: ['SENSITIVITY_GRID_NOT_FINITE_OR_MONOTONE'] }

  const scenarios = (['bear', 'base', 'bull'] as const).map((name, index) => {
    const revenueDriver = driverFor(name, revenueMetric, revenueHistory, revenueRates[index]!, h1.get(revenueMetric)!.evidence, input.asOf)
    const profitDriver = driverFor(name, profitMetric, profitHistory, profitRates[index]!, h1.get(profitMetric)!.evidence, input.asOf)
    return {
      name,
      drivers: [revenueDriver, profitDriver] as const,
      impliedParentNetMargin: { value: profitDriver.proposal.targetValue / revenueDriver.proposal.targetValue, originKind: 'DERIVED' as const },
    }
  })
  const plan: CompanyScenarioAssumptionsPlan = {
    workflowRunId: input.runId,
    company: input.company,
    asOf: input.asOf,
    targetFiscalYear: TARGET_YEAR,
    method: METHOD,
    economicRationaleStatus: 'REQUIRES_SEMANTIC_REVIEW',
    h1CrossCheck: {
      periodEnd: '2026-06-30', priorPeriodEnd: '2025-06-30',
      publishedAt: h1.get(revenueMetric)!.source.candidate.publishedAt!,
      revenue: { current: h1.get(revenueMetric)!.current, prior: h1.get(revenueMetric)!.prior, yoy: h1.get(revenueMetric)!.current / h1.get(revenueMetric)!.prior - 1, evidence: h1.get(revenueMetric)!.evidence },
      parentNetProfit: { current: h1.get(profitMetric)!.current, prior: h1.get(profitMetric)!.prior, yoy: h1.get(profitMetric)!.current / h1.get(profitMetric)!.prior - 1, evidence: h1.get(profitMetric)!.evidence },
    },
    sensitivityGrid,
    scenarios,
  }
  // The values are auditable candidates; annual history alone cannot supply the required operating rationale.
  return { status: 'candidate_requires_semantic_review', plan, diagnostics: ['ECONOMIC_RATIONALE_NOT_PROVEN_BY_HISTORICAL_DATA'] }
}

function resolveParagraph(refValue: ScenarioEvidenceRef, sources: readonly NormalizedResearchSource[], company: ResearchCompanyIdentity, asOfTime: number, annual: boolean): { source: NormalizedResearchSource; lines: string[]; line: number } | undefined {
  if (!/^paragraph:[1-9]\d*$/.test(refValue.location)) return undefined
  const source = sources.find(item => item.candidate.candidateId === refValue.sourceCandidateId)
  if (!source || !sourceIsUsable(source, company, asOfTime, annual)) return undefined
  const lines = source.content.split(/\r?\n/u).map(normalize)
  const line = Number(refValue.location.slice('paragraph:'.length)) - 1
  return line < 0 || line >= lines.length ? undefined : { source, lines, line }
}

/** Revalidate report rows, unique Data Layer joins, historical envelope choices and all nine calculations. */
export function validateCompanyScenarioAssumptions(input: CompanyScenarioValidationInput): CompanyScenarioValidationResult {
  const { plan } = input
  const errors = new Set<string>()
  const add = (code: string) => errors.add(code)
  const asOfTime = dateOnly(input.asOf)
  if (!plan.workflowRunId || plan.workflowRunId !== input.currentRunId) add('RUN_ID_MISMATCH')
  if (plan.company.symbol !== input.company.symbol || plan.company.exchange !== input.company.exchange || plan.company.name !== input.company.name) add('COMPANY_MISMATCH')
  if (plan.asOf !== input.asOf || !Number.isFinite(asOfTime) || new Date(asOfTime).getUTCFullYear() !== TARGET_YEAR) add('AS_OF_MISMATCH_OR_INVALID')
  if (plan.targetFiscalYear !== TARGET_YEAR || input.targetFiscalYear !== TARGET_YEAR) add('TARGET_FISCAL_YEAR_INVALID')
  if (JSON.stringify(plan.method) !== JSON.stringify(METHOD)) add('METHOD_BASIS_INCONSISTENT')
  if (plan.economicRationaleStatus !== 'REQUIRES_SEMANTIC_REVIEW') add('ECONOMIC_REVIEW_STATUS_INVALID')

  const names = plan.scenarios.map(item => item.name)
  if (names.length !== 3 || new Set(names).size !== 3 || !(['bear', 'base', 'bull'] as const).every(name => names.includes(name))) add('SCENARIO_SET_INVALID')
  if (plan.scenarios.length === 3) {
    const ordered = ['bear', 'base', 'bull'].map(name => plan.scenarios.find(item => item.name === name)!)
    const canonicalHistories = new Map<string, CompanyScenarioHistoryPoint[]>()
    for (const scenario of ordered) {
      if (scenario.drivers.length !== 2 || new Set(scenario.drivers.map(driver => driver.id)).size !== 2) add('SCENARIO_DRIVER_SET_INCONSISTENT')
      for (const metric of METRICS) {
        const driver = scenario.drivers.find(item => item.id === metric.id)
        if (!driver || driver.metricKey !== metric.key || driver.metricLabel !== metric.label || driver.unit !== 'CNY' || driver.currency !== 'CNY' || driver.basis !== 'YTD') { add('DRIVER_CONTRACT_INCOMPLETE'); continue }
        const signature = JSON.stringify(driver.historical)
        const prior = canonicalHistories.get(metric.id)
        if (prior && JSON.stringify(prior) !== signature) add('DRIVER_HISTORY_INCONSISTENT_ACROSS_SCENARIOS')
        else canonicalHistories.set(metric.id, [...driver.historical])
        if (driver.historical.length !== 3) { add('HISTORICAL_CALIBRATION_INSUFFICIENT'); continue }
        const history = [...driver.historical].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))
        if (history.some((point, index) => point.periodEnd !== `${2023 + index}-12-31` || !Number.isFinite(point.value) || point.value <= 0 || !Number.isFinite(dateOnly(point.publishedAt)) || dateOnly(point.publishedAt) > asOfTime)) add('HISTORICAL_PERIOD_OR_VALUE_INVALID')
        for (const point of history) {
          const periodRows = input.observations.filter(observation => observation.periodEnd === point.periodEnd && observation.metrics[metric.key] !== undefined)
          if (periodRows.length !== 1) { add(periodRows.length ? 'OBSERVATION_DUPLICATED_OR_CONFLICTED' : 'OBSERVATION_MISSING'); continue }
          const observation = periodRows[0]!
          const metadata = observation.metricMetadata?.[metric.key]
          if (observation.sourceConflicts?.some(conflict => conflict.metric === metric.key)) add('OBSERVATION_SOURCE_CONFLICT')
          if (!close(observation.metrics[metric.key]!, point.value) || observation.publishedAt !== point.publishedAt || metadata?.unit !== 'CNY' || metadata.currency !== 'CNY' || metadata.basis !== 'YTD') add('OBSERVATION_VALUE_PERIOD_UNIT_OR_BASIS_MISMATCH')
          const resolved = resolveParagraph(point.evidence, input.sources, input.company, asOfTime, true)
          if (!resolved) { add('ANNUAL_EVIDENCE_UNRESOLVED_OR_UNAUTHORIZED'); continue }
          if (point.sourceContentHash !== sha256(resolved.source.content) || point.verificationStatus !== 'EXACT_OFFICIAL_ROW_AND_DATA_OBSERVATION_MATCHED') add('ANNUAL_EVIDENCE_CONTENT_BINDING_INVALID')
          const rows = parseAnnualMetricRow({ ...resolved.source, content: resolved.lines.join('\n') }, metric)
          const exactRow = rows.find(row => row.line === resolved.line)
          const year = Number(point.periodEnd.slice(0, 4))
          const titleYear = reportYear(resolved.source)
          const value = exactRow?.valuesByYear.get(year)
          if (!exactRow || titleYear === undefined || titleYear < year || titleYear > year + 2 || value === undefined || value !== point.value) add('ANNUAL_REPORT_YEAR_VALUE_PAIR_MISMATCH')
        }
        const envelope = rateEnvelope(history)
        if (!envelope) { add('ANNUAL_RATE_ENVELOPE_INVALID'); continue }
        const scenarioIndex = scenario.name === 'bear' ? 0 : scenario.name === 'base' ? 1 : 2
        const proposal = driver.proposal
        const basePoint = history[2]!
        if (driver.scenarioId !== scenario.name || driver.targetFiscalYear !== TARGET_YEAR || driver.basisDate !== input.asOf
          || driver.valuationMethod !== 'OPERATING_BRIDGE_ONLY_NO_FORWARD_VALUATION'
          || driver.financialMetric !== metric.key || driver.scope !== 'consolidated'
          || !close(driver.historicalBaseValue, basePoint.value) || driver.basePeriod !== '2025-12-31'
          || JSON.stringify(driver.baseSourceRefs) !== JSON.stringify([basePoint.evidence])
          || driver.proposedAssumption?.originKind !== 'RESEARCH_ASSUMPTION' || driver.proposedAssumption?.unit !== 'fraction'
          || !close(driver.proposedAssumption?.value ?? Number.NaN, proposal.rate)
          || driver.targetMetric !== (metric.key === 'revenue' ? 'FY2026 revenue' : 'FY2026 parent-attributable net profit')
          || driver.peerOrMultipleBasis !== 'NOT_APPLIED_NO_QUALIFIED_FORWARD_VALUATION_BASIS'
          || JSON.stringify(driver.inputDependencies) !== JSON.stringify(driver.dependencies)
          || driver.counterEvidenceRefs.length !== 1 || JSON.stringify(driver.counterEvidenceRefs) !== JSON.stringify(driver.counterevidence)
          || driver.assumptionDerivation !== driver.derivation || driver.confidenceLimitations !== driver.limitations) add('SCENARIO_ASSUMPTION_AUDIT_FIELDS_INCONSISTENT')
        if (proposal.rateOriginKind !== 'RESEARCH_ASSUMPTION' || !close(proposal.rate, envelope[scenarioIndex])) add('SCENARIO_RATE_NOT_HISTORICAL_ENVELOPE_POINT')
        if (proposal.targetValueOriginKind !== 'DERIVED' || proposal.targetPeriod !== '2026-12-31' || !close(proposal.targetValue, history[2]!.value * (1 + proposal.rate))) add('FORECAST_BRIDGE_ARITHMETIC_MISMATCH')
        if (driver.forecastBridge.formula !== 'last_observation * (1 + rate)' || !driver.rationale.includes('研究假设') || !driver.rationale.includes('不证明经济合理性') || !driver.derivation.trim() || !driver.falsificationTrigger.trim() || !driver.limitations.trim()) add('ASSUMPTION_RATIONALE_OR_BRIDGE_MISSING')
        if (driver.counterevidence.length !== 1 || driver.dependencies.length !== 3 || driver.sensitivityRange.lowRate !== envelope[0] || driver.sensitivityRange.highRate !== envelope[2]) add('COUNTEREVIDENCE_DEPENDENCY_OR_RANGE_INVALID')
        for (const evidence of [...driver.counterevidence, ...driver.dependencies]) {
          const isAnnual = driver.dependencies.includes(evidence)
          const resolved = resolveParagraph(evidence, input.sources, input.company, asOfTime, isAnnual)
          if (!resolved) add('EVIDENCE_REF_UNRESOLVED_OR_UNAUTHORIZED')
        }
      }
    }
    for (const metric of METRICS) {
      const driver = ordered[0]!.drivers.find(item => item.id === metric.id)
      const cross = metric.key === 'revenue' ? plan.h1CrossCheck.revenue : plan.h1CrossCheck.parentNetProfit
      if (!driver || driver.counterevidence[0]?.sourceCandidateId !== cross.evidence.sourceCandidateId || driver.counterevidence[0]?.location !== cross.evidence.location) add('H1_COUNTEREVIDENCE_NOT_LINKED')
      const resolved = resolveParagraph(cross.evidence, input.sources, input.company, asOfTime, false)
      if (!resolved) { add('H1_SOURCE_UNRESOLVED_OR_UNAUTHORIZED'); continue }
      const rows = parseHalfYearMetricRow({ ...resolved.source, content: resolved.lines.join('\n') }, metric)
      const row = rows.find(item => item.line === resolved.line)
      if (!row || row.valuesByYear.get(2026) !== cross.current || row.valuesByYear.get(2025) !== cross.prior) add('H1_YEAR_VALUE_PAIR_MISMATCH')
      if (metric.key === 'revenue' && plan.h1CrossCheck.publishedAt !== resolved.source.candidate.publishedAt) add('H1_PUBLICATION_DATE_MISMATCH')
      const currentRows = input.observations.filter(item => item.periodEnd === '2026-06-30' && item.metrics[metric.key] !== undefined)
      const priorRows = input.observations.filter(item => item.periodEnd === '2025-06-30' && item.metrics[metric.key] !== undefined)
      if (currentRows.length !== 1 || priorRows.length !== 1 || !close(currentRows[0]?.metrics[metric.key] ?? Number.NaN, cross.current) || !close(priorRows[0]?.metrics[metric.key] ?? Number.NaN, cross.prior) || !close(cross.yoy, cross.current / cross.prior - 1)) add('H1_OBSERVATION_CROSS_CHECK_MISMATCH')
    }
    const revenueDriver = ordered[0]!.drivers.find(item => item.id === 'revenue')
    const profitDriver = ordered[0]!.drivers.find(item => item.id === 'parent-net-profit')
    const revenueEnvelope = revenueDriver ? rateEnvelope(revenueDriver.historical) : undefined
    const profitEnvelope = profitDriver ? rateEnvelope(profitDriver.historical) : undefined
    if (!revenueDriver || !profitDriver || !revenueEnvelope || !profitEnvelope) add('SENSITIVITY_BASELINE_UNAVAILABLE')
    else {
      const expected = makeSensitivityGrid(revenueDriver.historical[2]!.value, profitDriver.historical[2]!.value, revenueEnvelope, profitEnvelope)
      if (!expected || JSON.stringify(expected) !== JSON.stringify(plan.sensitivityGrid)) add('SENSITIVITY_GRID_ARITHMETIC_OR_MONOTONICITY_INVALID')
      for (const scenario of ordered) {
        const revenue = scenario.drivers.find(item => item.id === 'revenue')?.proposal.targetValue ?? Number.NaN
        const profit = scenario.drivers.find(item => item.id === 'parent-net-profit')?.proposal.targetValue ?? Number.NaN
        if (!close(scenario.impliedParentNetMargin.value, profit / revenue) || scenario.impliedParentNetMargin.originKind !== 'DERIVED') add('SCENARIO_MARGIN_NOT_DERIVED')
      }
    }
  }
  const structurallyValid = errors.size === 0
  return {
    valid: false,
    structurallyValid,
    reportEligible: false,
    diagnostics: [...new Set([...errors, 'ECONOMIC_RATIONALE_REQUIRES_INDEPENDENT_SEMANTIC_REVIEW'])].sort(),
  }
}
