export type SecurityIdentityWorkflow = 'company_research' | 'valuation' | 'earnings_review'
export type SecurityIdentitySource = 'canonical_knowledge' | 'akshare_security_directory'

/** A deterministic identity result produced by the shared Application identity gate. */
export interface VerifiedSecurityIdentity {
  readonly symbol: string
  readonly exchange: 'SH' | 'SZ' | 'BJ'
  readonly verifiedName: string
  readonly verificationSource: SecurityIdentitySource
  readonly originAuthority: 'S3_AGGREGATOR' | 'CANONICAL_KNOWLEDGE'
  readonly verifiedAt: string
  readonly sourceId?: string
  readonly sourceUrl?: string
  readonly canonicalCompanyRef?: string
}
