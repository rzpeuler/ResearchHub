import assert from 'node:assert/strict'
import test from 'node:test'
import {
  THEME_SCOPE_V04_LIMITS,
  createThemeScopeDecisionV04,
  fingerprintThemeIndustryCandidateV04,
  fingerprintThemeRelationCandidateV04,
  fingerprintThemeScopeCandidateV04,
  hashThemeScopeDecisionV04,
  validateThemeScopeDecisionBatchV04,
} from '../../../knowledge/governance/theme-scope-v04.ts'
import type {
  ThemeScopeCandidateV04,
  ThemeScopeDecisionDraftV04,
  ThemeScopeDecisionValueV04,
  ThemeScopeEvidenceV04,
  ThemeScopeReviewV04,
} from '../../../knowledge/governance/theme-scope-v04.ts'

const THEME = 'entity:investment-theme-ai-compute' as const
const REVISION = 12
const EVIDENCE: ThemeScopeEvidenceV04 = {
  sourceRef: 'source:industry-report-1',
  rawRef: `raw-sha256-${'a'.repeat(64)}`,
  locator: 'page 4, section 2',
}
const NEW_EVIDENCE: ThemeScopeEvidenceV04 = {
  sourceRef: 'source:industry-report-2',
  rawRef: `raw-sha256-${'b'.repeat(64)}`,
  locator: 'page 8, paragraph 3',
}

function industry(name: string, extra: Partial<Extract<ThemeScopeCandidateV04, { kind: 'industry' }>> = {}): Extract<ThemeScopeCandidateV04, { kind: 'industry' }> {
  return { kind: 'industry', name, ...extra }
}

function makeDecision(options: {
  candidate: ThemeScopeCandidateV04
  decision?: ThemeScopeDecisionValueV04
  rationale?: string
  evidence?: readonly ThemeScopeEvidenceV04[]
  review?: ThemeScopeReviewV04
  revision?: number
  previousDecisionId?: ThemeScopeDecisionDraftV04['previousDecisionId']
  reopenBasis?: ThemeScopeDecisionDraftV04['reopenBasis']
  branches?: readonly string[]
  themeRef?: ThemeScopeDecisionDraftV04['themeRef']
}) {
  const draft: ThemeScopeDecisionDraftV04 = {
    version: '0.4',
    themeRef: options.themeRef ?? THEME,
    candidate: options.candidate,
    candidateFingerprint: fingerprintThemeScopeCandidateV04(options.candidate),
    decision: options.decision ?? 'pending',
    rationale: options.rationale ?? 'A bounded reason for this decision.',
    evidence: options.evidence ?? [],
    review: options.review ?? { status: 'suggested' },
    basedOnRevision: options.revision ?? REVISION,
    affectedBranchKeys: options.branches ?? ['ai-compute'],
    ...(options.previousDecisionId === undefined ? {} : { previousDecisionId: options.previousDecisionId }),
    ...(options.reopenBasis === undefined ? {} : { reopenBasis: options.reopenBasis }),
  }
  return createThemeScopeDecisionV04(draft)
}

function batch(decisions: ReturnType<typeof makeDecision>[], revision = REVISION) {
  return { version: '0.4' as const, themeRef: THEME, basedOnRevision: revision, decisions }
}

function codes(value: unknown, options?: Parameters<typeof validateThemeScopeDecisionBatchV04>[1]): string[] {
  return validateThemeScopeDecisionBatchV04(value, options).errors.map((error) => error.code)
}

test('Industry and directed relation fingerprints are stable across runs and preserve edge direction', () => {
  const first = industry('  AI   Accelerators ', { identityContext: '  Data-center  ' })
  const equivalent = industry('ai accelerators', { identityContext: 'data-center', canonicalRef: 'entity:industry-ai-accelerators' })
  const source = industry('AI Accelerators')
  const target = industry('Advanced Packaging')
  const otherTarget = industry('Data Center Power')
  const sourceFingerprint = fingerprintThemeIndustryCandidateV04(source)
  const targetFingerprint = fingerprintThemeIndustryCandidateV04(target)
  const otherTargetFingerprint = fingerprintThemeIndustryCandidateV04(otherTarget)

  assert.equal(fingerprintThemeIndustryCandidateV04(first), fingerprintThemeIndustryCandidateV04(equivalent))
  assert.equal(fingerprintThemeScopeCandidateV04(source), sourceFingerprint)
  assert.notEqual(
    fingerprintThemeRelationCandidateV04({ relationType: 'upstream_of', sourceFingerprint, targetFingerprint }),
    fingerprintThemeRelationCandidateV04({ relationType: 'upstream_of', sourceFingerprint: targetFingerprint, targetFingerprint: sourceFingerprint }),
  )
  assert.notEqual(
    fingerprintThemeRelationCandidateV04({ relationType: 'upstream_of', sourceFingerprint, targetFingerprint }),
    fingerprintThemeRelationCandidateV04({ relationType: 'upstream_of', sourceFingerprint, targetFingerprint: otherTargetFingerprint }),
  )
  assert.notEqual(
    fingerprintThemeRelationCandidateV04({ relationType: 'upstream_of', sourceFingerprint, targetFingerprint }),
    fingerprintThemeRelationCandidateV04({ relationType: 'depends_on', sourceFingerprint, targetFingerprint }),
  )
})

test('valid batch supports cross-link relations and standalone Industry candidates', () => {
  const accelerator = industry('AI Accelerator')
  const packaging = industry('Advanced Packaging')
  const power = industry('Data Center Power')
  const acceleratorFingerprint = fingerprintThemeScopeCandidateV04(accelerator)
  const packagingFingerprint = fingerprintThemeScopeCandidateV04(packaging)
  const relation: ThemeScopeCandidateV04 = {
    kind: 'relation',
    relationType: 'upstream_of',
    sourceFingerprint: acceleratorFingerprint,
    targetFingerprint: packagingFingerprint,
  }
  const decisions = [
    makeDecision({ candidate: accelerator, decision: 'include', evidence: [EVIDENCE], branches: ['accelerators'] }),
    makeDecision({ candidate: packaging, decision: 'include', evidence: [EVIDENCE], branches: ['packaging'] }),
    makeDecision({ candidate: power, decision: 'include', evidence: [NEW_EVIDENCE], branches: ['infrastructure'] }),
    makeDecision({ candidate: relation, decision: 'include', evidence: [EVIDENCE], branches: ['accelerators', 'packaging'] }),
  ]
  const result = validateThemeScopeDecisionBatchV04(batch(decisions))

  assert.equal(result.valid, true, JSON.stringify(result.errors))
  assert.deepEqual(result.errors, [])

  const inconsistentEdge = makeDecision({ candidate: relation, decision: 'include', evidence: [EVIDENCE], branches: ['accelerators'] })
  const inconsistent = validateThemeScopeDecisionBatchV04(batch([
    decisions[0]!, decisions[1]!, decisions[2]!, inconsistentEdge,
  ]))
  assert.ok(inconsistent.errors.some((error) => error.code === 'THEME_SCOPE_RELATION_BRANCH_MISMATCH'))
})

test('incremental relation decision may point at Industries from a prior batch', () => {
  const sourceFingerprint = fingerprintThemeScopeCandidateV04(industry('Existing Upstream'))
  const targetFingerprint = fingerprintThemeScopeCandidateV04(industry('Existing Downstream'))
  const edge: ThemeScopeCandidateV04 = {
    kind: 'relation',
    relationType: 'depends_on',
    sourceFingerprint,
    targetFingerprint,
  }
  const decision = makeDecision({ candidate: edge, decision: 'include', evidence: [EVIDENCE], branches: ['branch-a', 'branch-b'] })

  assert.equal(validateThemeScopeDecisionBatchV04(batch([decision])).valid, true)
})

test('batch rejects ambiguous candidates, malformed refs, missing include evidence, and unbounded data', () => {
  const duplicateA = makeDecision({ candidate: industry('Same Industry'), decision: 'pending' })
  const duplicateB = makeDecision({ candidate: industry(' same   industry ', { canonicalRef: 'entity:industry-same' }), decision: 'pending' })
  assert.ok(codes(batch([duplicateA, duplicateB])).includes('THEME_SCOPE_FINGERPRINT_DUPLICATE'))

  const noEvidence = makeDecision({ candidate: industry('Evidence Required'), decision: 'include' })
  assert.ok(codes(batch([noEvidence])).includes('THEME_SCOPE_INCLUDE_EVIDENCE'))

  const malformedEvidence = { ...EVIDENCE, sourceRef: 'source:../escape' } as ThemeScopeEvidenceV04
  const badEvidence = makeDecision({ candidate: industry('Bad Source'), decision: 'include', evidence: [malformedEvidence] })
  assert.ok(codes(batch([badEvidence])).includes('THEME_SCOPE_SOURCE_REF'))

  const badCanonical = makeDecision({ candidate: industry('Bad Canonical Ref', { canonicalRef: 'source:wrong-kind' as never }), decision: 'pending' })
  assert.ok(codes(batch([badCanonical])).includes('THEME_SCOPE_CANONICAL_REF'))

  const tooManyEvidence = makeDecision({
    candidate: industry('Evidence Bound'),
    decision: 'pending',
    evidence: Array.from({ length: THEME_SCOPE_V04_LIMITS.maxEvidencePerDecision + 1 }, (_, index) => ({ ...EVIDENCE, locator: `section ${index}` })),
  })
  assert.ok(codes(batch([tooManyEvidence])).includes('THEME_SCOPE_EVIDENCE_BOUNDS'))

  const tooManyDecisions = Array.from({ length: THEME_SCOPE_V04_LIMITS.maxDecisionsPerBatch + 1 }, (_, index) => makeDecision({ candidate: industry(`Industry ${index}`) }))
  assert.ok(codes(batch(tooManyDecisions)).includes('THEME_SCOPE_BATCH_BOUNDS'))

  const nonJson = { ...batch([makeDecision({ candidate: industry('Non JSON') })]), extra: BigInt(1) }
  assert.ok(codes(nonJson).includes('THEME_SCOPE_JSON_ONLY'))
})

test('decision ID and hash helpers are stable and reviewed timestamps must be valid ISO instants', () => {
  const candidate = industry('Timestamp Review')
  const confirmed = makeDecision({ candidate, decision: 'pending', review: { status: 'human_confirmed', confirmedAt: '2026-10-02T11:40:00+08:00' } })
  const { id, ...draft } = confirmed
  assert.equal(id, createThemeScopeDecisionV04(draft).id)
  assert.equal(hashThemeScopeDecisionV04(draft), hashThemeScopeDecisionV04(draft))
  assert.equal(validateThemeScopeDecisionBatchV04(batch([confirmed])).valid, true)

  const invalidTimestamp = makeDecision({ candidate, decision: 'pending', review: { status: 'human_confirmed', confirmedAt: '2026-02-30T11:40:00Z' } })
  assert.ok(codes(batch([invalidTimestamp])).includes('THEME_SCOPE_REVIEW_TIME'))
})

test('reopening an excluded candidate requires an explicit basis with genuinely new evidence', () => {
  const candidate = industry('Previously Excluded Industry')
  const excluded = makeDecision({ candidate, decision: 'exclude', evidence: [EVIDENCE], revision: 8 })
  const reopened = makeDecision({
    candidate,
    decision: 'pending',
    evidence: [EVIDENCE, NEW_EVIDENCE],
    revision: 9,
    previousDecisionId: excluded.id,
    reopenBasis: { rationale: 'New primary evidence may change the boundary assessment.', evidence: [NEW_EVIDENCE] },
  })
  assert.equal(validateThemeScopeDecisionBatchV04(batch([reopened], 9), { previousDecisions: [excluded] }).valid, true)

  const noBasis = makeDecision({ candidate, decision: 'include', evidence: [EVIDENCE, NEW_EVIDENCE], revision: 9, previousDecisionId: excluded.id })
  assert.ok(codes(batch([noBasis], 9), { previousDecisions: [excluded] }).includes('THEME_SCOPE_REOPEN_BASIS_REQUIRED'))

  const repeatedEvidence = makeDecision({
    candidate,
    decision: 'include',
    evidence: [EVIDENCE],
    revision: 9,
    previousDecisionId: excluded.id,
    reopenBasis: { rationale: 'No new evidence actually supports a reconsideration.', evidence: [EVIDENCE] },
  })
  assert.ok(codes(batch([repeatedEvidence], 9), { previousDecisions: [excluded] }).includes('THEME_SCOPE_REOPEN_NO_NEW_EVIDENCE'))
})

test('history links must match candidate identity and cannot move backward or fork', () => {
  const candidate = industry('History Subject')
  const otherCandidate = industry('Different History Subject')
  const prior = makeDecision({ candidate, decision: 'pending', revision: 5 })
  const wrongPrior = makeDecision({ candidate: otherCandidate, decision: 'pending', revision: 5 })
  const linked = makeDecision({ candidate, decision: 'include', evidence: [EVIDENCE], revision: 4, previousDecisionId: wrongPrior.id })
  const result = codes(batch([linked], 4), { previousDecisions: [wrongPrior] })
  assert.ok(result.includes('THEME_SCOPE_PREVIOUS_CANDIDATE'))
  assert.ok(result.includes('THEME_SCOPE_REVISION_REGRESSION'))

  const firstSuccessor = makeDecision({ candidate, decision: 'pending', revision: 6, previousDecisionId: prior.id })
  const competingSuccessor = makeDecision({ candidate, decision: 'exclude', evidence: [EVIDENCE], revision: 6, previousDecisionId: prior.id })
  const next = makeDecision({ candidate, decision: 'include', evidence: [EVIDENCE], revision: 7, previousDecisionId: firstSuccessor.id })
  const forkResult = codes(batch([next], 7), { previousDecisions: [prior, firstSuccessor, competingSuccessor] })
  assert.ok(forkResult.includes('THEME_SCOPE_HISTORY_FORK'))

  const stale = makeDecision({ candidate, decision: 'include', evidence: [EVIDENCE], revision: 7, previousDecisionId: prior.id })
  assert.ok(codes(batch([stale], 7), { previousDecisions: [prior, firstSuccessor] }).includes('THEME_SCOPE_PREVIOUS_NOT_HEAD'))
})
