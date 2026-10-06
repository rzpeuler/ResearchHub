import type { DataRequirement, SourceAuthority } from './contracts.ts'

const AUTHORITY_RANK: Readonly<Record<SourceAuthority, number>> = {
  S0_STATUTORY: 0,
  S1_OFFICIAL: 1,
  S2_PROFESSIONAL: 2,
  S3_AGGREGATOR: 3,
  S4_COMMUNITY: 4,
}

export function authorityRank(authority: SourceAuthority): number {
  return AUTHORITY_RANK[authority]
}

export function meetsMinimumAuthority(actual: SourceAuthority, minimum: SourceAuthority | undefined): boolean {
  return minimum === undefined || authorityRank(actual) <= authorityRank(minimum)
}

export function validateDataRequirement(requirement: DataRequirement): readonly string[] {
  const errors: string[] = []
  if (!isRecord(requirement) || typeof requirement.id !== 'string' || requirement.id.trim() === '') errors.push('id is required')
  if (!isRecord(requirement?.consumer) || typeof requirement.consumer.workflow !== 'string' || requirement.consumer.workflow.trim() === '') errors.push('consumer.workflow is required')
  if (!isRecord(requirement?.consumer) || typeof requirement.consumer.capability !== 'string' || requirement.consumer.capability.trim() === '') errors.push('consumer.capability is required')
  if (typeof requirement?.asOf !== 'string' || Number.isNaN(Date.parse(requirement.asOf))) errors.push('asOf must be a valid date')
  if (requirement?.dataKind === 'metric' && !requirement.metricId && !requirement.metricFamily) errors.push('metric requirements need metricId or metricFamily')
  if (requirement?.determinismClass === 'AUTHORITATIVE_NUMERIC' && requirement.llmWebFallback === 'FULL_EVIDENCE_RESEARCH') errors.push('AUTHORITATIVE_NUMERIC cannot use FULL_EVIDENCE_RESEARCH')
  return errors
}

export function assertValidDataRequirement(requirement: DataRequirement): void {
  const errors = validateDataRequirement(requirement)
  if (errors.length > 0) throw new Error(`INVALID_DATA_REQUIREMENT: ${errors.join('; ')}`)
}

export function validateAcquisitionData(requirement: DataRequirement, data: unknown): readonly string[] {
  if (!requirement.requiredFields || requirement.requiredFields.length === 0) return []
  const errors: string[] = []
  for (const field of requirement.requiredFields) {
    if (!hasPresentPath(data, field)) errors.push(field)
  }
  return errors
}

export function hasPresentPath(value: unknown, path: string): boolean {
  if (!path.trim()) return false
  let current: unknown = value
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) return false
    current = current[segment]
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
