import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifiedSecurityIdentityHandoff, consumeVerifiedSecurityIdentityHandoff } from '../../../app/services/verified-security-identity-handoff.ts'
import type { VerifiedSecurityIdentity } from '../../../data/security-identity-contracts.ts'

const identity: VerifiedSecurityIdentity = {
  symbol: '002487',
  exchange: 'SZ',
  verifiedName: '大金重工',
  verificationSource: 'akshare_security_directory',
  originAuthority: 'S3_AGGREGATOR',
  verifiedAt: '2026-10-08T12:00:00.000Z',
  sourceId: 'akshare-security-identity-directory',
}

const expected = {
  workflowId: 'valuation' as const,
  runId: 'verified-identity-run',
  symbol: '002487',
  name: '大金重工',
  exchange: 'SZ',
  asOf: '2026-10-08T12:00:00.000Z',
  structuredKnowledge: false,
}

test('verified identity handoff is one-run, workflow-bound, and preserves the Knowledge permission mode', () => {
  const handoff = createVerifiedSecurityIdentityHandoff({
    workflowId: expected.workflowId,
    runId: expected.runId,
    asOf: expected.asOf,
    structuredKnowledge: expected.structuredKnowledge,
    identity,
  })
  assert.deepEqual(consumeVerifiedSecurityIdentityHandoff(handoff, expected), identity)
  assert.throws(() => consumeVerifiedSecurityIdentityHandoff(handoff, expected), /UNTRUSTED_SECURITY_IDENTITY_HANDOFF/)
})

test('untrusted, cross-run, cross-Workflow, and permission-mismatched handoffs fail closed', () => {
  assert.throws(() => consumeVerifiedSecurityIdentityHandoff({ identity }, expected), /UNTRUSTED_SECURITY_IDENTITY_HANDOFF/)

  for (const mismatch of [
    { ...expected, runId: 'another-run' },
    { ...expected, workflowId: 'earnings_review' as const },
    { ...expected, structuredKnowledge: true },
    { ...expected, symbol: '002488' },
    { ...expected, name: 'Other Company' },
    { ...expected, exchange: 'SH' },
    { ...expected, asOf: '2025-10-08T12:00:00.000Z' },
  ]) {
    const handoff = createVerifiedSecurityIdentityHandoff({
      workflowId: expected.workflowId,
      runId: expected.runId,
      asOf: expected.asOf,
      structuredKnowledge: expected.structuredKnowledge,
      identity,
    })
    assert.throws(() => consumeVerifiedSecurityIdentityHandoff(handoff, mismatch), /SECURITY_IDENTITY_HANDOFF_CONTEXT_MISMATCH/)
  }
})
