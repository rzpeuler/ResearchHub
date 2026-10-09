import type { SecurityIdentityWorkflow, VerifiedSecurityIdentity } from '../../data/security-identity-contracts.ts'

/** In-process handoff for the result verified by Dispatch before it assigned a runId. */
export interface VerifiedSecurityIdentityHandoff {
  readonly workflowId: SecurityIdentityWorkflow
  readonly runId: string
  readonly asOf?: string
  readonly structuredKnowledge: boolean
  readonly identity: VerifiedSecurityIdentity
}

const trustedHandoffs = new WeakSet<object>()

export function createVerifiedSecurityIdentityHandoff(input: VerifiedSecurityIdentityHandoff): VerifiedSecurityIdentityHandoff {
  const handoff = Object.freeze({
    ...input,
    identity: Object.freeze({ ...input.identity }),
  })
  trustedHandoffs.add(handoff)
  return handoff
}

export function consumeVerifiedSecurityIdentityHandoff(
  value: unknown,
  expected: {
    readonly workflowId: SecurityIdentityWorkflow
    readonly runId: string
    readonly symbol: string
    readonly name?: string
    readonly exchange?: string
    readonly asOf?: string
    readonly structuredKnowledge: boolean
  },
): VerifiedSecurityIdentity {
  if (value === null || typeof value !== 'object' || !trustedHandoffs.has(value)) {
    throw new Error('UNTRUSTED_SECURITY_IDENTITY_HANDOFF')
  }
  trustedHandoffs.delete(value)
  const handoff = value as VerifiedSecurityIdentityHandoff
  const identity = handoff.identity
  if (handoff.workflowId !== expected.workflowId
    || handoff.runId !== expected.runId
    || handoff.asOf !== expected.asOf
    || handoff.structuredKnowledge !== expected.structuredKnowledge
    || identity.symbol !== expected.symbol
    || identity.verifiedName !== expected.name
    || identity.exchange !== expected.exchange) {
    throw new Error('SECURITY_IDENTITY_HANDOFF_CONTEXT_MISMATCH')
  }
  return identity
}
