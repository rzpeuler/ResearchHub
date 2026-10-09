import type { AcquisitionExecutor, DataRequirement, SourceExecutionResult } from '../../data/contracts.ts'
import { DataResolver } from '../../data/resolver.ts'
import { SECURITY_IDENTITY_SOURCE_POLICIES } from '../../data/security-identity-policies.ts'
import type { AkshareDataClient } from './akshare.ts'

export interface SecurityDirectoryRequest {
  readonly symbol?: string
  readonly name?: string
  readonly exchange?: string
}

export interface AkshareSecurityDirectoryClient extends AkshareDataClient {
  securityDirectory?(request: SecurityDirectoryRequest): Promise<unknown>
}

export interface SecurityIdentityDataResolverOptions {
  readonly akshare?: AkshareSecurityDirectoryClient
  readonly now: () => string
  readonly signal?: AbortSignal
}

/** Executes only the registered security-directory SourcePolicy operation. */
export function createSecurityIdentityDataResolver(options: SecurityIdentityDataResolverOptions): DataResolver<unknown> {
  const executor: AcquisitionExecutor<unknown> = async (requirement: DataRequirement, candidate): Promise<SourceExecutionResult<unknown>> => {
    if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    if (requirement.metricId !== 'security_identity_directory' || candidate.operationId !== 'akshare.securityDirectory') {
      return { status: 'UNSUPPORTED', diagnostic: 'SECURITY_IDENTITY_OPERATION_REQUIREMENT_MISMATCH' }
    }
    const directory = options.akshare
    if (!directory?.securityDirectory) return { status: 'UNSUPPORTED', diagnostic: 'AKSHARE_SECURITY_DIRECTORY_UNAVAILABLE' }
    const query = requirement.securityIdentityQueryContext
    if (!query) return { status: 'UNSUPPORTED', diagnostic: 'SECURITY_IDENTITY_QUERY_CONTEXT_REQUIRED' }
    let data: unknown
    try {
      data = await directory.securityDirectory({
        ...(query.requestedSymbol ? { symbol: query.requestedSymbol } : {}),
        ...(query.requestedName ? { name: query.requestedName } : {}),
        ...(query.requestedExchange ? { exchange: query.requestedExchange } : {}),
      })
    } catch (error) {
      if (options.signal?.aborted || (error instanceof Error && error.message === 'WORKFLOW_CANCELLED')) throw new Error('WORKFLOW_CANCELLED')
      return { status: 'SOURCE_ERROR', diagnostic: `AKSHARE_SECURITY_DIRECTORY_FAILED:${error instanceof Error ? error.name : 'unknown error'}` }
    }
    if (options.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    if (!Array.isArray(data)) return { status: 'PARSE_ERROR', diagnostic: 'AKSHARE_SECURITY_DIRECTORY_RETURNED_INVALID_ROWS' }
    if (data.length === 0) return { status: 'NO_DATA', diagnostic: 'AKSHARE_SECURITY_DIRECTORY_RETURNED_NO_ROWS' }
    const retrievedAt = options.now()
    return {
      status: 'SUCCESS',
      data,
      source: {
        originPublisher: 'AKShare A-share directory aggregation',
        retrievalProvider: 'AKShare',
        sourceUrl: 'https://github.com/akfamily/akshare',
        retrievedAt,
      },
    }
  }
  return new DataResolver({ policies: SECURITY_IDENTITY_SOURCE_POLICIES, now: options.now, signal: options.signal, executor })
}
