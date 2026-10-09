import type { SourceCandidate, SourcePolicy } from './contracts.ts'

const workflowIds = ['company_research', 'valuation', 'earnings_review'] as const

function candidate(): SourceCandidate {
  return {
    sourceId: 'akshare-security-identity-directory',
    fallbackLevel: 'PRIMARY',
    originAuthority: 'S3_AGGREGATOR',
    originPublisher: 'AKShare A-share directory aggregation',
    operationId: 'akshare.securityDirectory',
    supports: { dataKinds: ['evidence'], metricIds: ['security_identity_directory'] },
  }
}

/** One exact policy per target Workflow; all share the same bounded AKShare operation. */
export const SECURITY_IDENTITY_SOURCE_POLICIES: readonly SourcePolicy[] = workflowIds.map((workflow): SourcePolicy => ({
  policyId: `security-identity-directory-${workflow}`,
  requirementMatch: { workflow, dataKind: 'evidence', metricId: 'security_identity_directory' },
  selectionMode: 'FIRST_VALID',
  candidates: [candidate()],
}))
