import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type {
  BearBaseBullSet,
  EconomicDriverObservation,
  EquityMarketInput,
  ResearchAssumptionProposal,
  ScenarioHorizon,
  ScenarioMethodContractInput,
  ValueVersionProof,
} from '../../workflows/company-deep-research/scenario-method-contracts.ts'
import {
  getHistoricalTrustAnchorStatus,
  hashCanonicalScenarioValue,
  preserveIndependentStatusDimensions,
  scenarioMethodReviewPacketHash,
  validateEnterpriseValueBridgeConsistency,
  validateEquityMarketInput,
  validateReviewFreshness,
  validateScenarioMethodContract,
} from '../../workflows/company-deep-research/scenario-method-validation.ts'

const hashText = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')
const asOf = '2026-02-15T12:00:00Z'
const horizon: ScenarioHorizon = {
  analysisAsOf: asOf, asOfMode: 'FROZEN_T0', targetFiscalYear: 2028,
  targetPeriodStart: '2028-01-01', targetPeriodEnd: '2028-12-31', targetPeriodBasis: 'FY',
  baseFiscalYear: 2025, basePeriodEnd: '2025-12-31', basePeriodBasis: 'FY',
  financialScope: 'CONSOLIDATED', currency: 'CNY', methodId: 'fixture-method-v1',
  requiredDriverIds: ['revenue-growth'], sourceSnapshotHash: 'a'.repeat(64),
}

function missingObservation(overrides: Partial<Extract<EconomicDriverObservation, { kind: 'MISSING' }>> = {}): Extract<EconomicDriverObservation, { kind: 'MISSING' }> {
  return {
    kind: 'MISSING', originKind: 'FACT', observationId: 'obs-revenue', companySymbol: 'FIXTURE_ONLY', driverId: 'revenue-growth', metricId: 'revenue', atomicSkillOwner: 'scenario_valuation', consumer: 'OPERATING_DRIVER',
    economicScope: 'fixture consolidated operations', financialScope: 'CONSOLIDATED', periodStart: null, periodEnd: null, fiscalYear: null, periodBasis: null,
    flowOrStock: 'FLOW', unit: null, currency: null, shareBasis: null, observedAt: null, sourcePublishedAt: null, retrievedAt: null,
    analysisAsOf: asOf, asOfMode: 'FROZEN_T0', evidenceManifestHash: '0'.repeat(64), sourceConflicts: [],
    claimedValueVersionStatus: 'UNAVAILABLE', claimedEligibility: 'UNAVAILABLE', missingFields: ['revenue', 'periodEnd'], rejectionReasons: ['FIXTURE_ONLY: not supplied'],
    evidence: null, rights: null, valueVersionProof: null, normalizedValue: null,
    ...overrides,
  }
}

function proposal(scenario: ResearchAssumptionProposal['scenario']): ResearchAssumptionProposal {
  return {
    proposalId: `proposal-${scenario}`, companySymbol: 'FIXTURE_ONLY', scenario, driverId: 'revenue-growth', originKind: 'RESEARCH_ASSUMPTION', authorId: 'fixture-author',
    targetFiscalYear: 2028, targetPeriodStart: '2028-01-01', targetPeriodEnd: '2028-12-31', financialScope: 'CONSOLIDATED', unit: 'percent', currency: 'CNY',
    proposedValue: null, mechanism: 'FIXTURE_ONLY mechanism', calibrationRefs: ['obs-revenue'], counterEvidenceRefs: ['obs-revenue'], falsifiableTrigger: 'FIXTURE_ONLY trigger', inputObservationRefs: ['obs-revenue'], proposalVersion: 'fixture-v1',
  }
}

function scenarioSet(): BearBaseBullSet {
  const scenarios = (['BEAR', 'BASE', 'BULL'] as const).map((scenario) => ({
    scenario, horizon, companySymbol: 'FIXTURE_ONLY', financialScope: 'CONSOLIDATED', currency: 'CNY', methodId: 'fixture-method-v1',
    requiredDriverIds: ['revenue-growth'], driverProposalRefs: [`proposal-${scenario}`], driverObservationRefs: ['obs-revenue'],
    residualPolicy: 'NOT_REQUIRED' as const, residualDescription: null, adjustments: [],
  })) as unknown as BearBaseBullSet['scenarios']
  return { scenarios, proposals: [proposal('BEAR'), proposal('BASE'), proposal('BULL')], requiredDriverIds: ['revenue-growth'] }
}

function inputWith(observation: EconomicDriverObservation = missingObservation()): ScenarioMethodContractInput {
  return bindManifest({ horizon, observations: [observation], scenarioSet: scenarioSet(), methodVersion: 'fixture-method-v1', rubricVersion: 'fixture-rubric-v1' })
}

function bindManifest(input: ScenarioMethodContractInput): ScenarioMethodContractInput {
  const provisional = validateScenarioMethodContract(input)
  const observations = input.observations.map((observation) => {
    if (observation.kind !== 'FACT' || observation.valueVersionProof === null) return { ...observation, evidenceManifestHash: provisional.evidenceManifestHash } as EconomicDriverObservation
    const valueVersionProof: ValueVersionProof = { ...observation.valueVersionProof, evidenceManifestHash: provisional.evidenceManifestHash }
    return { ...observation, evidenceManifestHash: provisional.evidenceManifestHash, valueVersionProof } as EconomicDriverObservation
  })
  return { ...input, observations }
}

function factObservation(options: { availableAt?: string; retrievedAt?: string; method?: ValueVersionProof['method']; sourceText?: string } = {}): Extract<EconomicDriverObservation, { kind: 'FACT' }> {
  const sourceText = options.sourceText ?? 'FIXTURE_ONLY filing paragraph 3: Revenue 100.0 CNY for FY2025.'
  const contentHash = hashText(sourceText)
  const rightsText = 'FIXTURE_ONLY synthetic rights record allows OPERATING_DRIVER use.'
  const rightsHash = hashText(rightsText)
  const evidence = {
    sourceCandidateId: 'fixture-source', sourceLocation: 'paragraph:p3', immutableSourceContentHash: contentHash, immutableSourceContent: sourceText,
    sourceExcerptText: sourceText, rawValueToken: '100.0', normalizedValue: 100, normalizationRule: { kind: 'IDENTITY' as const, formulaVersion: 'identity-v1' as const },
    unit: 'CNY', currency: 'CNY', metricId: 'revenue', periodStart: '2025-01-01', periodEnd: '2025-12-31', periodBasis: 'FY', financialScope: 'CONSOLIDATED', shareBasis: null,
    rowBindingHash: '', sourceRetrievedAt: options.retrievedAt ?? '2026-02-20T10:00:00Z',
  }
  evidence.rowBindingHash = hashCanonicalScenarioValue({
    sourceCandidateId: evidence.sourceCandidateId, sourceLocation: evidence.sourceLocation, immutableSourceContentHash: evidence.immutableSourceContentHash,
    rawValueToken: evidence.rawValueToken, normalizedValue: evidence.normalizedValue, normalizationRule: evidence.normalizationRule, unit: evidence.unit,
    currency: evidence.currency, metricId: evidence.metricId, periodStart: evidence.periodStart, periodEnd: evidence.periodEnd, periodBasis: evidence.periodBasis,
    financialScope: evidence.financialScope, shareBasis: evidence.shareBasis,
  })
  const rights = { recordId: 'fixture-rights', evidenceHash: rightsHash, intendedUse: 'OPERATING_DRIVER' as const, decision: 'ALLOWED' as const, evidenceTextHash: rightsHash, evidenceText: rightsText }
  const proofBase = {
    proofId: 'fixture-proof', evidenceManifestHash: '0'.repeat(64), claimedProofStatus: 'VERIFIED' as const,
    sourceCandidateId: evidence.sourceCandidateId, sourceLocation: evidence.sourceLocation, immutableSourceContentHash: contentHash, rawValueToken: evidence.rawValueToken,
    normalizedValue: evidence.normalizedValue, normalizationRule: evidence.normalizationRule, unit: evidence.unit, currency: evidence.currency, epsBasis: null,
    metricId: evidence.metricId, periodStart: evidence.periodStart, periodEnd: evidence.periodEnd, periodBasis: evidence.periodBasis, financialScope: evidence.financialScope,
    rowBindingHash: evidence.rowBindingHash, valueVersionId: 'caller-claimed-version', valueVersionAvailableAt: options.availableAt ?? '2026-01-15T09:00:00Z',
    sourcePublishedAt: '2026-01-15T09:00:00Z', observedAt: '2026-01-15T09:00:00Z', retrievedAt: options.retrievedAt ?? '2026-02-20T10:00:00Z',
    revisionStatus: 'COMPLETE' as const, revisionChainHash: 'b'.repeat(64), rights, analysisAsOf: asOf, trustRoot: 'caller-claimed-root', proofReference: 'caller-claimed-ref',
  }
  const proof: ValueVersionProof = options.method === 'TRUSTED_SEALED_SNAPSHOT'
    ? { ...proofBase, method: 'TRUSTED_SEALED_SNAPSHOT', publicationRecordReference: null, snapshotCapturedAt: '2026-01-15T09:00:00Z', snapshotSealedAt: '2026-01-15T09:01:00Z', signatureVerificationReference: 'caller-claimed-signature' }
    : options.method === 'IMMUTABLE_PROVIDER_VINTAGE'
      ? { ...proofBase, method: 'IMMUTABLE_PROVIDER_VINTAGE', publicationRecordReference: null, snapshotCapturedAt: null, snapshotSealedAt: null, signatureVerificationReference: null }
      : { ...proofBase, method: 'OFFICIAL_PUBLISHED_DOCUMENT', publicationRecordReference: 'caller-claimed-publication-record', snapshotCapturedAt: null, snapshotSealedAt: null, signatureVerificationReference: null }
  return {
    kind: 'FACT', originKind: 'FACT', observationId: 'obs-revenue', companySymbol: 'FIXTURE_ONLY', driverId: 'revenue-growth', metricId: 'revenue', atomicSkillOwner: 'scenario_valuation', consumer: 'OPERATING_DRIVER',
    economicScope: 'fixture consolidated operations', financialScope: 'CONSOLIDATED', periodStart: '2025-01-01', periodEnd: '2025-12-31', fiscalYear: 2025, periodBasis: 'FY', flowOrStock: 'FLOW', unit: 'CNY', currency: 'CNY', shareBasis: null,
    observedAt: proof.observedAt, sourcePublishedAt: proof.sourcePublishedAt, retrievedAt: proof.retrievedAt, analysisAsOf: asOf, asOfMode: 'FROZEN_T0', evidenceManifestHash: '0'.repeat(64), sourceConflicts: [],
    claimedValueVersionStatus: 'VERIFIED', claimedEligibility: 'QUALIFIED', evidence, rights, valueVersionProof: proof,
  }
}

test('T1 missing zero is explicit and does not fabricate a fact', () => {
  const result = validateScenarioMethodContract(inputWith())
  assert.equal(result.observationAssessments[0]?.valueVersionStatus, 'UNAVAILABLE')
  assert.equal(result.observationAssessments[0]?.eligibility, 'UNAVAILABLE')
  const invalid = missingObservation({ missingFields: [], rejectionReasons: [] })
  assert.equal(validateScenarioMethodContract(inputWith(invalid)).structuralStatus, 'STRUCTURAL_INVALID')
})

test('T2 status axes remain independent; valid structure never trusts caller VERIFIED', () => {
  const dimensions = preserveIndependentStatusDimensions({ originKind: 'FACT', valueVersionStatus: 'VERIFIED', scopeMatchesConsumer: false })
  assert.deepEqual(dimensions, { originKind: 'FACT', valueVersionStatus: 'VERIFIED', eligibility: 'UNAVAILABLE' })
  const result = validateScenarioMethodContract(bindManifest(inputWith(factObservation())))
  assert.equal(result.structuralStatus, 'STRUCTURALLY_VALID', JSON.stringify(result.diagnostics))
  assert.equal(result.observationAssessments[0]?.claimedValueVersionStatus, 'VERIFIED')
  assert.equal(result.observationAssessments[0]?.valueVersionStatus, 'UNVERIFIED')
  assert.equal(result.reportEligible, false)
})

test('T3 report date and locally hashed late retrieval cannot prove pre-cutoff availability', () => {
  const late = factObservation({ availableAt: '2026-02-16T00:00:00Z', retrievedAt: '2026-02-20T10:00:00Z' })
  const result = validateScenarioMethodContract(bindManifest(inputWith(late)))
  assert.ok(result.diagnostics.some((item) => item.code === 'HISTORICAL_CUTOFF_VIOLATION'))
  assert.equal(result.observationAssessments[0]?.valueVersionStatus, 'UNVERIFIED')
})

test('T3 forged early seal after late capture is rejected', () => {
  const lateCaptured = factObservation({ method: 'TRUSTED_SEALED_SNAPSHOT', retrievedAt: '2026-02-20T10:00:00Z' })
  const proof = lateCaptured.valueVersionProof
  assert.ok(proof?.method === 'TRUSTED_SEALED_SNAPSHOT')
  const forged = { ...lateCaptured, valueVersionProof: { ...proof, snapshotCapturedAt: '2026-02-16T00:00:00Z', snapshotSealedAt: '2026-02-14T00:00:00Z' } }
  const result = validateScenarioMethodContract(bindManifest(inputWith(forged)))
  assert.ok(result.diagnostics.some((item) => item.code === 'HISTORICAL_CUTOFF_VIOLATION'))
})

test('T4 source raw token, content and rights bindings reject mismatched evidence', () => {
  const fact = factObservation()
  const changed = { ...fact, evidence: { ...fact.evidence, rawValueToken: '99.0' } }
  const result = validateScenarioMethodContract(bindManifest(inputWith(changed)))
  assert.ok(result.diagnostics.some((item) => item.code === 'SOURCE_BINDING_MISMATCH'))
  const denied = { ...fact, rights: { ...fact.rights, decision: 'DENIED' as const } }
  assert.ok(validateScenarioMethodContract(bindManifest(inputWith(denied))).diagnostics.some((item) => item.code === 'SOURCE_RIGHTS_UNVERIFIED'))
})

test('T5 H1 annualization and FY relabeling are blocked', () => {
  const mislabeledH1 = { ...horizon, targetPeriodStart: '2028-01-01', targetPeriodEnd: '2028-06-30', targetPeriodBasis: 'FY' as const }
  const invalidHorizon = validateScenarioMethodContract({ ...inputWith(), horizon: mislabeledH1 })
  assert.ok(invalidHorizon.diagnostics.some((item) => item.code === 'PERIOD_MISMATCH'))
})

test('T7 parameterized target year and exact scenario driver set', () => {
  const base = validateScenarioMethodContract(inputWith())
  assert.equal(base.structuralStatus, 'STRUCTURALLY_VALID', JSON.stringify(base.diagnostics))
  const set = scenarioSet()
  const incomplete = { ...set, proposals: set.proposals.filter((item) => item.scenario !== 'BASE') }
  assert.ok(validateScenarioMethodContract({ ...inputWith(), scenarioSet: incomplete }).diagnostics.some((item) => item.code === 'MISSING_REQUIRED_DRIVER'))
})

test('T8 canonical hash is key-order stable and changed inputs stale the review', () => {
  assert.equal(hashCanonicalScenarioValue({ a: 1, b: 2 }), hashCanonicalScenarioValue({ b: 2, a: 1 }))
  const input = inputWith()
  const original = scenarioMethodReviewPacketHash(input)
  assert.equal(validateReviewFreshness({ state: 'REVIEW_REQUIRED', authorId: 'fixture', reviewerId: null, reviewPacketHash: original, reviewerDecisionReference: null, independentOfAuthorClaim: false }, original).state, 'REVIEW_REQUIRED')
  const changed = scenarioMethodReviewPacketHash({ ...input, methodVersion: 'fixture-method-v2' })
  assert.notEqual(original, changed)
  assert.equal(validateReviewFreshness({ state: 'REVIEW_REQUIRED', authorId: 'fixture', reviewerId: null, reviewPacketHash: original, reviewerDecisionReference: null, independentOfAuthorClaim: true }, changed).state, 'STALE_REVIEW')
})

function marketInput(overrides: Partial<EquityMarketInput> = {}): EquityMarketInput {
  const klass = (classId: string, date: string) => ({
    classId, listedSecurityUnit: '1 share', underlyingSharesPerListedUnit: 1, quoteCurrency: 'CNY', closePrice: 10,
    closeAvailableAt: `${date}T07:00:00Z`, closeTradingDate: date, closeTimeZone: 'Asia/Shanghai', fxToReportingCurrency: 1,
    fxAvailableAt: `${date}T08:00:00Z`, fxTradingDate: date, fxTimeZone: 'Asia/Shanghai', issuedShares: 1000, issuedShareBasis: 'POST_CANCELLATION_ISSUED' as const,
    cancelledShares: null, cancellationEffectiveAt: null, treasuryShares: 10, repurchasedHeldShares: 10, treasuryIncludesRepurchasedShares: true,
    shareCountAvailableAt: `${date}T00:00:00Z`, shareCountAsOf: date, targetDateDilutedShares: 1100, dilutedShareTargetDate: '2028-12-31', dilutedSharesAvailableAt: '2026-02-01T00:00:00Z', classRightsReference: `fixture-${classId}`,
  })
  return {
    mode: 'FIXTURE_ONLY', analysisAsOf: asOf, marketDate: '2026-02-13', targetDate: '2028-12-31', reportingCurrency: 'CNY',
    classes: [klass('A', '2026-02-13'), klass('H', '2026-02-13')], companyRightsAllocationReference: 'FIXTURE_ONLY allocation', expectedClassIds: ['A', 'H'], ...overrides,
  }
}

test('T9 multi-class market inputs reject missing class and post-cutoff quote', () => {
  const missingH = validateEquityMarketInput(marketInput({ classes: marketInput().classes.slice(0, 1) }))
  assert.deepEqual(missingH.missingClassIds, ['H'])
  const late = marketInput({ classes: marketInput().classes.map((item) => item.classId === 'H' ? { ...item, closeAvailableAt: '2026-02-16T07:00:00Z' } : item) })
  assert.ok(validateEquityMarketInput(late).diagnostics.some((item) => item.code === 'CLASS_PRICE_MISSING'))
  const valid = validateEquityMarketInput(marketInput())
  assert.equal(valid.status, 'STRUCTURALLY_VALID_FIXTURE_ONLY')
  assert.equal(valid.shareCountTreatments[0]?.issuedSharesRule, 'USE_POST_CANCELLATION_AS_IS')
  assert.equal(valid.shareCountTreatments[0]?.heldSharesRule, 'SUBTRACT_TREASURY_ONCE')
})

test('T9 EV bridge rejects net debt plus separately subtracted cash', () => {
  const known = (amount: number) => ({ status: 'KNOWN' as const, amount, evidenceRefs: ['fixture-evidence'] as const })
  const notApplicable = { status: 'NOT_APPLICABLE' as const, reason: 'not used on net debt basis', evidenceRefs: ['fixture-basis'] as const }
  const diagnostics = validateEnterpriseValueBridgeConsistency({
    mode: 'FIXTURE_ONLY', debtBasis: 'NET_DEBT', grossDebt: notApplicable, netDebt: known(50), separatelySubtractedCash: known(10), grossDebtIncludesLeases: false,
    leaseClaimsIncluded: false, leaseAmount: notApplicable, leaseInEarningsBasis: false, preferredAndConvertibleClaims: notApplicable, nonControllingClaims: notApplicable,
    otherSeniorClaims: notApplicable, adjustments: [], classAllocationReference: 'fixture-allocation', allocatedClassEquityValues: { A: 5, H: 5 }, totalEquityValue: known(10), market: marketInput(),
  })
  assert.ok(diagnostics.some((item) => item.code === 'STRUCTURAL_INVALID'))
})

test('T10 caller proof/reviewer claims never grant report eligibility; no trust anchor is configured', () => {
  const result = validateScenarioMethodContract(bindManifest(inputWith(factObservation())))
  assert.equal(result.reportEligible, false)
  assert.equal(result.observationAssessments[0]?.eligibility, 'UNVERIFIED')
  assert.equal(getHistoricalTrustAnchorStatus().configured, false)
})
