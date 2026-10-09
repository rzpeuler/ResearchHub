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
  if (isRecord(requirement?.consumer) && requirement.consumer.capability !== undefined && (typeof requirement.consumer.capability !== 'string' || requirement.consumer.capability.trim() === '')) errors.push('consumer.capability must be a non-empty string when provided')
  if (typeof requirement?.asOf !== 'string' || Number.isNaN(Date.parse(requirement.asOf))) errors.push('asOf must be a valid date')
  if (requirement?.analysisAsOf !== undefined && (Number.isNaN(Date.parse(requirement.analysisAsOf)) || requirement.analysisAsOf !== requirement.asOf)) errors.push('analysisAsOf must match asOf')
  if (requirement?.asOfMode !== undefined && !['CURRENT_VALUE_ONLY', 'HISTORICAL'].includes(requirement.asOfMode)) errors.push('asOfMode must be CURRENT_VALUE_ONLY or HISTORICAL')
  if (requirement?.period?.fiscalYear !== undefined && (!Number.isInteger(requirement.period.fiscalYear) || requirement.period.fiscalYear < 1900)) errors.push('period.fiscalYear must be a valid year')
  if (requirement?.period?.start !== undefined && Number.isNaN(Date.parse(requirement.period.start))) errors.push('period.start must be a valid date')
  if (requirement?.period?.end !== undefined && Number.isNaN(Date.parse(requirement.period.end))) errors.push('period.end must be a valid date')
  if (requirement?.dataKind === 'metric' && !requirement.metricId && !requirement.metricFamily) errors.push('metric requirements need metricId or metricFamily')
  if (requirement?.industryEvidenceQueryContext !== undefined) {
    const context = requirement.industryEvidenceQueryContext as unknown as Record<string, unknown>
    const allowedKeys = new Set(['displayTarget', 'searchTerms', 'purpose', 'start', 'end'])
    if (requirement.metricId !== 'industry_research_evidence' || requirement.dataKind !== 'evidence') errors.push('industryEvidenceQueryContext is only valid for industry_research_evidence evidence requirements')
    if (Object.keys(context).some((key) => !allowedKeys.has(key))) errors.push('industryEvidenceQueryContext contains provider-specific or unknown fields')
    if (typeof context.displayTarget !== 'string' || context.displayTarget.trim() === '' || context.displayTarget.length > 160) errors.push('industryEvidenceQueryContext.displayTarget must be 1-160 characters')
    if (typeof context.purpose !== 'string' || context.purpose.trim() === '' || context.purpose.length > 240) errors.push('industryEvidenceQueryContext.purpose must be 1-240 characters')
    if (!Array.isArray(context.searchTerms) || context.searchTerms.length < 1 || context.searchTerms.length > 8 || context.searchTerms.some((term) => typeof term !== 'string' || term.trim() === '' || term.length > 120)) errors.push('industryEvidenceQueryContext.searchTerms must contain 1-8 strings of at most 120 characters')
    for (const field of ['start', 'end'] as const) if (context[field] !== undefined && (typeof context[field] !== 'string' || Number.isNaN(Date.parse(context[field] as string)))) errors.push(`industryEvidenceQueryContext.${field} must be a valid date`)
    if (typeof context.start === 'string' && typeof context.end === 'string' && Date.parse(context.start) > Date.parse(context.end)) errors.push('industryEvidenceQueryContext.end must not precede start')
  }
  if (requirement?.securityIdentityQueryContext !== undefined) {
    const context = requirement.securityIdentityQueryContext as unknown as Record<string, unknown>
    const allowedKeys = new Set(['requestedName', 'requestedSymbol', 'requestedExchange'])
    if (requirement.metricId !== 'security_identity_directory' || requirement.dataKind !== 'evidence') errors.push('securityIdentityQueryContext is only valid for security_identity_directory evidence requirements')
    if (Object.keys(context).some((key) => !allowedKeys.has(key))) errors.push('securityIdentityQueryContext contains provider-specific or unknown fields')
    if (context.requestedName !== undefined && (typeof context.requestedName !== 'string' || context.requestedName.trim() === '' || context.requestedName.length > 120)) errors.push('securityIdentityQueryContext.requestedName must be 1-120 characters')
    if (context.requestedSymbol !== undefined && (typeof context.requestedSymbol !== 'string' || !/^\d{6}$/u.test(context.requestedSymbol))) errors.push('securityIdentityQueryContext.requestedSymbol must be a six-digit security code')
    if (context.requestedExchange !== undefined && (typeof context.requestedExchange !== 'string' || !/^(?:SH|SZ|BJ)$/u.test(context.requestedExchange))) errors.push('securityIdentityQueryContext.requestedExchange must be SH, SZ, or BJ')
    if (context.requestedName === undefined && context.requestedSymbol === undefined) errors.push('securityIdentityQueryContext requires a name or symbol candidate')
  }
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
