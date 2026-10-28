import { sha256 } from './hash.ts'

/**
 * Plugin-local evidence that an EstimatePoint was projected from one exact
 * currently observed provider row. This is not historical value-version proof.
 */
export interface EarningsEstimatePointProof {
  readonly estimateId: string
  readonly sourceCandidateId: string
  readonly provider: 'eastmoney-reportapi' | 'akshare-eastmoney-research-report' | 'akshare-ths-institution-forecast'
  readonly providerObjectId?: string
  readonly matchedField: string
  readonly matchedMetric: string
  readonly matchedValue: number
  readonly matchedUnit: string
  readonly matchedPeriod: string
  readonly matchedInstitutionKey: string
  readonly matchedPublishedAt: string
  readonly observedRowHash: string
  readonly pointFingerprint: string
  readonly basisStatus: 'UNVERIFIED'
  readonly valueVersionStatus: 'UNVERIFIED'
  readonly correctionStatus: 'UNVERIFIED'
}

export function createEarningsEstimatePointProof(input: Omit<EarningsEstimatePointProof, 'observedRowHash' | 'pointFingerprint' | 'basisStatus' | 'valueVersionStatus' | 'correctionStatus'> & {
  readonly observedRow: unknown
}): EarningsEstimatePointProof {
  const observedRowHash = sha256(stable(input.observedRow))
  const pointFingerprint = sha256(stable({
    estimateId: input.estimateId,
    sourceCandidateId: input.sourceCandidateId,
    provider: input.provider,
    providerObjectId: input.providerObjectId ?? null,
    matchedField: input.matchedField,
    matchedValue: input.matchedValue,
    matchedPeriod: input.matchedPeriod,
    matchedInstitutionKey: input.matchedInstitutionKey,
    matchedPublishedAt: input.matchedPublishedAt,
    metric: input.matchedMetric,
    unit: input.matchedUnit,
    observedRowHash,
  }))
  return {
    estimateId: input.estimateId,
    sourceCandidateId: input.sourceCandidateId,
    provider: input.provider,
    ...(input.providerObjectId === undefined ? {} : { providerObjectId: input.providerObjectId }),
    matchedField: input.matchedField,
    matchedMetric: input.matchedMetric,
    matchedValue: input.matchedValue,
    matchedUnit: input.matchedUnit,
    matchedPeriod: input.matchedPeriod,
    matchedInstitutionKey: input.matchedInstitutionKey,
    matchedPublishedAt: input.matchedPublishedAt,
    observedRowHash,
    pointFingerprint,
    basisStatus: 'UNVERIFIED',
    valueVersionStatus: 'UNVERIFIED',
    correctionStatus: 'UNVERIFIED',
  }
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
