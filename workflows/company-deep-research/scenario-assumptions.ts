import type { CompanyFinancialObservation } from '../../data/company-research-contracts.ts'
import type { NormalizedResearchSource, ResearchCompanyIdentity } from '../../plugins/research-acquisition/contracts.ts'

export type CompanyScenarioName = 'bull' | 'base' | 'bear'
export interface ScenarioEvidenceRef { readonly sourceCandidateId: string; readonly location: `paragraph:${number}` }

export interface CompanyScenarioHistoryPoint {
  readonly value: number
  readonly periodEnd: string
  readonly publishedAt: string
  readonly evidence: ScenarioEvidenceRef
}

export interface CompanyScenarioDriver {
  readonly id: string
  readonly metricKey: string
  readonly metricLabel: string
  readonly unit: string
  readonly currency: string
  readonly basis: NonNullable<CompanyFinancialObservation['metricMetadata']>[string]['basis']
  readonly historical: readonly CompanyScenarioHistoryPoint[]
  readonly proposal: {
    readonly rateOriginKind: 'RESEARCH_ASSUMPTION' | 'DERIVED'
    readonly rate: number
    readonly targetValue: number
    readonly targetValueOriginKind: 'DERIVED'
    readonly targetPeriod: string
  }
  readonly rationale: string
  readonly derivation: string
  readonly counterevidence: readonly ScenarioEvidenceRef[]
  readonly falsificationTrigger: string
  readonly limitations: string
  readonly forecastBridge: { readonly formula: 'last_observation * (1 + rate)' }
  readonly sensitivityRange: { readonly lowRate: number; readonly highRate: number }
  readonly dependencies: readonly ScenarioEvidenceRef[]
}

export interface CompanyScenarioAssumptionsPlan {
  readonly workflowRunId: string
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly targetFiscalYear: number
  readonly method: { readonly name: string; readonly outputMetric: string; readonly outputUnit: string; readonly outputBasis: string }
  readonly scenarios: readonly { readonly name: CompanyScenarioName; readonly drivers: readonly CompanyScenarioDriver[] }[]
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

export interface CompanyScenarioValidationResult { readonly valid: boolean; readonly diagnostics: readonly string[] }

const dateOnly = (value: string): number => {
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return Number.NaN
  return Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value)
}
const close = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-9)
const containsExactNumber = (text: string, value: number): boolean => [...text.matchAll(/(?<![\p{L}\d])[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\p{L}\d])/gu)]
  .some(match => close(Number(match[0]!.replace(/,/g, '')), value))

function sourceParagraph(ref: ScenarioEvidenceRef, sources: readonly NormalizedResearchSource[], asOfTime: number): { source: NormalizedResearchSource; text: string } | undefined {
  if (!/^paragraph:[1-9]\d*$/.test(ref.location)) return undefined
  const source = sources.find(item => item.candidate.candidateId === ref.sourceCandidateId)
  if (!source || dateOnly(source.candidate.publishedAt ?? '') > asOfTime || !Number.isFinite(dateOnly(source.candidate.publishedAt ?? ''))) return undefined
  const paragraph = Number(ref.location.slice('paragraph:'.length))
  const text = source.content.split(/\r?\n/)[paragraph - 1]
  return text === undefined ? undefined : { source, text }
}

/**
 * Fail-closed validator for run-scoped operational scenario assumptions.
 * It proves numeric/source bindings and arithmetic; it does not claim that a
 * research assumption is economically correct or substitute for semantic review.
 */
export function validateCompanyScenarioAssumptions(input: CompanyScenarioValidationInput): CompanyScenarioValidationResult {
  const { plan } = input
  const errors = new Set<string>()
  const add = (code: string) => errors.add(code)
  const asOfTime = dateOnly(input.asOf)
  if (!plan.workflowRunId || plan.workflowRunId !== input.currentRunId) add('RUN_ID_MISMATCH')
  if (plan.company.symbol !== input.company.symbol || plan.company.exchange !== input.company.exchange) add('COMPANY_MISMATCH')
  if (plan.asOf !== input.asOf || !Number.isFinite(asOfTime)) add('AS_OF_MISMATCH_OR_INVALID')
  const asOfYear = Number.isFinite(asOfTime) ? new Date(asOfTime).getUTCFullYear() : Number.NaN
  if (plan.targetFiscalYear !== input.targetFiscalYear || !Number.isInteger(plan.targetFiscalYear) || plan.targetFiscalYear < asOfYear || plan.targetFiscalYear > asOfYear + 5) add('TARGET_FISCAL_YEAR_INVALID')
  if (!plan.method.name.trim() || !plan.method.outputMetric.trim() || !plan.method.outputUnit.trim() || !plan.method.outputBasis.trim()) add('METHOD_BASIS_INCOMPLETE')
  const names = plan.scenarios.map(item => item.name)
  if (names.length !== 3 || new Set(names).size !== 3 || !(['bull', 'base', 'bear'] as const).every(name => names.includes(name))) add('SCENARIO_SET_INVALID')
  const sourceIds = new Set(input.sources.map(source => source.candidate.candidateId))
  const validateRef = (ref: ScenarioEvidenceRef, relevantMetricLabel?: string): string | undefined => {
    const resolved = sourceParagraph(ref, input.sources, asOfTime)
    if (!resolved || !sourceIds.has(ref.sourceCandidateId)) { add('EVIDENCE_REF_UNRESOLVED_OR_OUT_OF_SCOPE'); return undefined }
    if (resolved.source.rights.accessScope === 'restricted' || resolved.source.rights.accessScope === 'unknown' || resolved.source.rights.aiProcessingAllowed !== true || resolved.source.rights.retentionAllowed !== true) add('SOURCE_RIGHTS_UNAUTHORIZED_FOR_RUN_EVIDENCE')
    if (relevantMetricLabel && !resolved.text.toLocaleLowerCase().includes(relevantMetricLabel.toLocaleLowerCase())) add('EVIDENCE_REF_IRRELEVANT_TO_METRIC')
    return resolved.text
  }
  const ratesByDriver = new Map<string, Partial<Record<CompanyScenarioName, number>>>()
  const canonicalDriverContracts = new Map<string, string>()
  const scenarioDriverIds = new Map<CompanyScenarioName, Set<string>>()
  for (const scenario of plan.scenarios) {
    if (!scenario.drivers.length) add('SCENARIO_HAS_NO_DRIVERS')
    const ids = new Set<string>()
    for (const driver of scenario.drivers) {
      if (!driver.id || ids.has(driver.id)) add('DRIVER_ID_MISSING_OR_DUPLICATE')
      ids.add(driver.id)
      const contractSignature = JSON.stringify({ metricKey: driver.metricKey, metricLabel: driver.metricLabel, unit: driver.unit, currency: driver.currency, basis: driver.basis, historical: [...driver.historical].sort((a, b) => dateOnly(a.periodEnd) - dateOnly(b.periodEnd)) })
      const existingContract = canonicalDriverContracts.get(driver.id)
      if (existingContract !== undefined && existingContract !== contractSignature) add('DRIVER_CONTRACT_INCONSISTENT_ACROSS_SCENARIOS')
      else canonicalDriverContracts.set(driver.id, contractSignature)
      if (!driver.metricKey.trim() || !driver.metricLabel.trim() || !driver.unit.trim() || !driver.currency.trim() || !driver.basis) add('DRIVER_CONTRACT_INCOMPLETE')
      if (driver.historical.length < 2) add('HISTORICAL_CALIBRATION_INSUFFICIENT')
      const history = [...driver.historical].sort((a, b) => dateOnly(a.periodEnd) - dateOnly(b.periodEnd))
      if (!history.length) continue
      for (let index = 0; index < history.length; index++) {
        const point = history[index]!
        const periodTime = dateOnly(point.periodEnd)
        const publishedTime = dateOnly(point.publishedAt)
        if (!Number.isFinite(periodTime) || !Number.isFinite(publishedTime) || periodTime >= asOfTime || publishedTime > asOfTime || new Date(point.periodEnd).getUTCFullYear() >= plan.targetFiscalYear) add('HISTORICAL_PERIOD_STALE_FUTURE_OR_OUT_OF_SCOPE')
        if (index && dateOnly(history[index - 1]!.periodEnd) === periodTime) add('HISTORICAL_PERIOD_DUPLICATED')
        const periodRows = input.observations.filter(observation => observation.periodEnd === point.periodEnd && observation.metrics[driver.metricKey as keyof CompanyFinancialObservation['metrics']] !== undefined)
        const signatures = new Set(periodRows.map(observation => JSON.stringify({ value: observation.metrics[driver.metricKey as keyof CompanyFinancialObservation['metrics']], unit: observation.metricMetadata?.[driver.metricKey]?.unit, currency: observation.metricMetadata?.[driver.metricKey]?.currency, basis: observation.metricMetadata?.[driver.metricKey]?.basis })))
        if (signatures.size > 1) add('CONFLICTING_OBSERVATION_ROWS_FOR_PERIOD')
        const row = periodRows.find(observation => observation.publishedAt === point.publishedAt && close(observation.metrics[driver.metricKey as keyof CompanyFinancialObservation['metrics']] ?? Number.NaN, point.value))
        const metadata = row?.metricMetadata?.[driver.metricKey]
        if (!row || metadata?.unit !== driver.unit || metadata.basis !== driver.basis || typeof metadata.currency !== 'string' || !metadata.currency.trim() || metadata.currency !== driver.currency) add('OBSERVATION_VALUE_PERIOD_UNIT_CURRENCY_OR_BASIS_MISMATCH')
        if (row?.sourceConflicts?.some(conflict => conflict.metric === driver.metricKey)) add('OBSERVATION_SOURCE_CONFLICT_FOR_METRIC')
        const text = validateRef(point.evidence, driver.metricLabel)
        if (text !== undefined && (!containsExactNumber(text, Number(point.periodEnd.slice(0, 4))) || !containsExactNumber(text, point.value))) add('SOURCE_LOCATOR_VALUE_OR_PERIOD_MISMATCH')
      }
      const last = history.at(-1)!
      const rates = history.slice(1).map((point, index) => {
        const previous = history[index]!
        return previous.value === 0 ? Number.NaN : point.value / previous.value - 1
      })
      const minRate = Math.min(...rates)
      const maxRate = Math.max(...rates)
      const proposal = driver.proposal
      if (!['RESEARCH_ASSUMPTION', 'DERIVED'].includes(proposal.rateOriginKind)) add('ASSUMPTION_ORIGIN_INVALID')
      if (!Number.isFinite(proposal.rate) || proposal.rate < minRate - 1e-9 || proposal.rate > maxRate + 1e-9) add('ASSUMPTION_RATE_OUTSIDE_HISTORICAL_CALIBRATION')
      if (proposal.rateOriginKind === 'DERIVED' && !rates.some(rate => close(rate, proposal.rate))) add('DERIVED_RATE_NOT_HISTORICALLY_REPRODUCIBLE')
      if (proposal.targetValueOriginKind !== 'DERIVED') add('FORECAST_VALUE_ORIGIN_INVALID')
      if (!Number.isFinite(proposal.targetValue) || !close(proposal.targetValue, last.value * (1 + proposal.rate))) add('FORECAST_BRIDGE_ARITHMETIC_MISMATCH')
      if (proposal.targetPeriod !== `${plan.targetFiscalYear}-12-31`) add('TARGET_PERIOD_MISMATCH')
      if (driver.forecastBridge.formula !== 'last_observation * (1 + rate)' || !driver.derivation.trim()) add('DERIVATION_OR_FORECAST_BRIDGE_MISSING')
      if (!driver.rationale.trim()) add('RATIONALE_MISSING')
      if (!driver.counterevidence.length) add('COUNTEREVIDENCE_MISSING')
      for (const ref of driver.counterevidence) validateRef(ref)
      if (!driver.falsificationTrigger.trim()) add('FALSIFICATION_TRIGGER_MISSING')
      if (!driver.limitations.trim()) add('LIMITATIONS_MISSING')
      if (!Number.isFinite(driver.sensitivityRange.lowRate) || !Number.isFinite(driver.sensitivityRange.highRate) || driver.sensitivityRange.lowRate > proposal.rate || driver.sensitivityRange.highRate < proposal.rate || driver.sensitivityRange.lowRate < minRate - 1e-9 || driver.sensitivityRange.highRate > maxRate + 1e-9) add('SENSITIVITY_RANGE_INVALID_OR_UNCALIBRATED')
      for (const dependency of driver.dependencies) validateRef(dependency)
      const byScenario = ratesByDriver.get(driver.id) ?? {}
      byScenario[scenario.name] = proposal.rate
      ratesByDriver.set(driver.id, byScenario)
    }
    scenarioDriverIds.set(scenario.name, ids)
  }
  const expectedDriverIds = scenarioDriverIds.get('bear')
  for (const name of ['base', 'bull'] as const) {
    const actual = scenarioDriverIds.get(name)
    if (!expectedDriverIds || !actual || expectedDriverIds.size !== actual.size || [...expectedDriverIds].some(id => !actual.has(id))) add('SCENARIO_DRIVER_SET_INCONSISTENT')
  }
  for (const rates of ratesByDriver.values()) {
    if (rates.bear === undefined || rates.base === undefined || rates.bull === undefined || !(rates.bear <= rates.base && rates.base <= rates.bull)) add('SCENARIO_ASSUMPTIONS_NOT_ORDERED')
  }
  return { valid: errors.size === 0, diagnostics: [...errors].sort() }
}
