import { sha256 } from './hash.ts'
import type { NormalizedResearchSource, ResearchProviderOutcome } from './contracts.ts'
import type { EastmoneyReportAcquisitionResult, EastmoneyResearchReportRecord } from './expectations/contracts.ts'
import { validateEstimatePoint } from '../../skills/earnings-review/expectations/matching.ts'
import type { EstimatePoint } from '../../skills/earnings-review/expectations/contracts.ts'

export const EASTMONEY_EPS_UNIT = 'CNY_per_share' as const

export interface EstimateProjectionResult {
  readonly sources: readonly NormalizedResearchSource[]
  readonly estimates: readonly EstimatePoint[]
  readonly institutions: readonly {
    readonly institutionKey: string
    readonly name: string
    readonly providerCode: string
  }[]
  readonly diagnostics: readonly string[]
  readonly providerOutcome: ResearchProviderOutcome
  readonly forecastBaseYear?: number
  readonly truncated: boolean
}

export type EastmoneyEstimateProjectionResult = EstimateProjectionResult

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function sourceCandidateId(infoCode: string): string {
  return `eastmoney-report-${sha256(infoCode)}`
}

function estimateId(infoCode: string, fiscalYear: number): string {
  return `eastmoney-estimate-${sha256(`${infoCode}|eps|${fiscalYear}`)}`
}

function institutionName(record: EastmoneyResearchReportRecord): string {
  return record.orgName ?? record.orgShortName
}

export function projectEastmoneyEstimatePoints(input: { readonly acquisition: EastmoneyReportAcquisitionResult; readonly targetFiscalYear: number }): EstimateProjectionResult {
  const diagnostics: string[] = [...input.acquisition.diagnostics]
  const sourcesByCandidateId = new Set(input.acquisition.sources.map((source) => source.candidate.candidateId))
  const estimates: EstimatePoint[] = []
  const institutions = new Map<string, { readonly institutionKey: string; readonly name: string; readonly providerCode: string }>()
  const records = input.acquisition.records.slice().sort((left, right) => left.infoCode.localeCompare(right.infoCode))
  if (input.acquisition.forecastBaseYear !== undefined && (input.targetFiscalYear < input.acquisition.forecastBaseYear || input.targetFiscalYear > input.acquisition.forecastBaseYear + 2)) diagnostics.push(`eastmoney_unsupported_target_fiscal_year:${input.targetFiscalYear}`)
  for (const record of records) {
    const candidateId = sourceCandidateId(record.infoCode)
    if (!sourcesByCandidateId.has(candidateId)) { diagnostics.push(`eastmoney_source_missing:${record.infoCode}`); continue }
    for (const forecast of record.epsForecasts.filter((item) => item.fiscalYear === input.targetFiscalYear)) {
      const point: EstimatePoint = {
        estimateId: estimateId(record.infoCode, forecast.fiscalYear),
        metric: 'eps',
        fiscalPeriod: `${forecast.fiscalYear}-FY`,
        value: forecast.value,
        unit: EASTMONEY_EPS_UNIT,
        institutionKey: `eastmoney-org:${record.orgCode}`,
        publishedAt: record.publishedAt,
        sourceCandidateIds: [candidateId],
      }
      const validation = validateEstimatePoint(point)
      if (validation.length > 0) { diagnostics.push(...validation.map((item) => `${point.estimateId}:${item}`)); continue }
      estimates.push(point)
      institutions.set(point.institutionKey, { institutionKey: point.institutionKey, name: institutionName(record), providerCode: record.orgCode })
    }
  }
  estimates.sort((left, right) => left.estimateId.localeCompare(right.estimateId))
  return {
    sources: input.acquisition.sources.slice().sort((left, right) => left.candidate.candidateId.localeCompare(right.candidate.candidateId)),
    estimates,
    institutions: [...institutions.values()].sort((left, right) => left.institutionKey.localeCompare(right.institutionKey)),
    diagnostics: uniqueSorted(diagnostics),
    providerOutcome: input.acquisition.providerOutcome,
    ...(input.acquisition.forecastBaseYear === undefined ? {} : { forecastBaseYear: input.acquisition.forecastBaseYear }),
    truncated: input.acquisition.truncated,
  }
}
