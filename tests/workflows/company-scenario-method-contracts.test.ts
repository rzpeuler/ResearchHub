import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import type {
  BearBaseBullSet,
  EconomicDriverObservation,
  EnterpriseValueBridgeConsistencyInput,
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
  return inputWithObservations([observation])
}

function inputWithObservations(observations: readonly EconomicDriverObservation[]): ScenarioMethodContractInput {
  return bindManifest({ horizon, observations, scenarioSet: scenarioSet(), methodVersion: 'fixture-method-v1', rubricVersion: 'fixture-rubric-v1' })
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

function factObservation(options: {
  availableAt?: string
  retrievedAt?: string
  method?: ValueVersionProof['method']
  sourceText?: string
  sourceExcerptText?: string
  sourceLocation?: string
  sourceCandidateId?: string
  observationId?: string
  driverId?: string
} = {}): Extract<EconomicDriverObservation, { kind: 'FACT' }> {
  const sourceText = options.sourceText ?? 'FIXTURE_ONLY filing paragraph 3: Revenue 100.0 CNY for FY2025.'
  const contentHash = hashText(sourceText)
  const rightsText = 'FIXTURE_ONLY synthetic rights record allows OPERATING_DRIVER use.'
  const rightsHash = hashText(rightsText)
  const evidence = {
    sourceCandidateId: options.sourceCandidateId ?? 'fixture-source', sourceLocation: options.sourceLocation ?? 'paragraph:1', immutableSourceContentHash: contentHash, immutableSourceContent: sourceText,
    sourceExcerptText: options.sourceExcerptText ?? sourceText, rawValueToken: '100.0', normalizedValue: 100, normalizationRule: { kind: 'IDENTITY' as const, formulaVersion: 'identity-v1' as const },
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
    proofId: `fixture-proof-${evidence.sourceCandidateId}`, evidenceManifestHash: '0'.repeat(64), claimedProofStatus: 'VERIFIED' as const,
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
    kind: 'FACT', originKind: 'FACT', observationId: options.observationId ?? 'obs-revenue', companySymbol: 'FIXTURE_ONLY', driverId: options.driverId ?? 'revenue-growth', metricId: 'revenue', atomicSkillOwner: 'scenario_valuation', consumer: 'OPERATING_DRIVER',
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

test('FIX-001 locator validates exact paragraph and line segments, not full-text membership', () => {
  const sourceText = 'Revenue in the annual period was 100.0 CNY.\n\nFY2025 parent revenue: 100.0 CNY.'
  const wrongSegment = factObservation({ sourceText, sourceLocation: 'paragraph:2', sourceExcerptText: 'Revenue in the annual period was 100.0 CNY.' })
  const wrong = validateScenarioMethodContract(inputWith(wrongSegment))
  assert.ok(wrong.diagnostics.some((item) => item.code === 'SOURCE_LOCATION_UNVERIFIED'))
  assert.equal(wrong.observationAssessments[0]?.eligibility, 'UNAVAILABLE')

  const rightSegment = factObservation({ sourceText, sourceLocation: 'paragraph:2', sourceExcerptText: 'FY2025 parent revenue: 100.0 CNY.' })
  const right = validateScenarioMethodContract(inputWith(rightSegment))
  assert.ok(!right.diagnostics.some((item) => item.code === 'SOURCE_LOCATION_UNVERIFIED'))
  assert.equal(right.observationAssessments[0]?.valueVersionStatus, 'UNVERIFIED', 'correct local position cannot establish a trusted historical version')

  const lineText = 'Header without value.\nRevenue in FY2025: 100.0 CNY.'
  const line = factObservation({ sourceText: lineText, sourceLocation: 'line:2', sourceExcerptText: 'Revenue in FY2025: 100.0 CNY.' })
  assert.ok(!validateScenarioMethodContract(inputWith(line)).diagnostics.some((item) => item.code === 'SOURCE_LOCATION_UNVERIFIED'))
})

test('FIX-001 repeated tokens are disambiguated by exact locator; unsupported coordinates remain unverified', () => {
  const sourceText = 'FY2025 parent revenue: 100.0 CNY.\n\nFY2025 segment revenue: 100.0 CNY.'
  const secondParagraph = factObservation({ sourceText, sourceLocation: 'paragraph:2', sourceExcerptText: 'FY2025 segment revenue: 100.0 CNY.' })
  const exact = validateScenarioMethodContract(inputWith(secondParagraph))
  assert.ok(!exact.diagnostics.some((item) => item.code === 'SOURCE_LOCATION_UNVERIFIED'))
  for (const sourceLocation of ['page:1', 'table:1', 'cell:1']) {
    const unsupported = factObservation({ sourceText, sourceLocation, sourceExcerptText: 'FY2025 parent revenue: 100.0 CNY.' })
    const result = validateScenarioMethodContract(inputWith(unsupported))
    assert.ok(result.diagnostics.some((item) => item.code === 'SOURCE_LOCATION_UNVERIFIED'), sourceLocation)
    assert.equal(result.observationAssessments[0]?.eligibility, 'UNAVAILABLE')
  }
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

function derivedFixture(operation: 'SUBTRACT' | 'DIVIDE' | 'PERCENT_CHANGE', inputObservationIds: readonly string[]): Extract<EconomicDriverObservation, { kind: 'DERIVED' }> {
  const result = operation === 'DIVIDE' ? 1 : 0
  return {
    kind: 'DERIVED', originKind: 'DERIVED', observationId: 'obs-revenue', companySymbol: 'FIXTURE_ONLY', driverId: 'revenue-growth', metricId: 'derived-fixture', atomicSkillOwner: 'scenario_valuation', consumer: 'OPERATING_DRIVER',
    economicScope: 'fixture consolidated operations', financialScope: 'CONSOLIDATED', periodStart: '2025-01-01', periodEnd: '2025-12-31', fiscalYear: 2025, periodBasis: 'FY',
    flowOrStock: 'FLOW', unit: 'CNY', currency: 'CNY', shareBasis: null, observedAt: null, sourcePublishedAt: null, retrievedAt: null,
    analysisAsOf: asOf, asOfMode: 'FROZEN_T0', evidenceManifestHash: '0'.repeat(64), sourceConflicts: [], claimedValueVersionStatus: 'NOT_APPLICABLE', claimedEligibility: 'UNVERIFIED',
    derivation: { operation, purpose: 'OBSERVED_ARITHMETIC_ONLY', inputObservationIds, result, formulaVersion: `fixture-${operation}-v1` },
  }
}

test('FIX-001 ordered noncommutative operands change review hash and stale the prior review', () => {
  const leftInput = factObservation({ observationId: 'obs-a', driverId: 'input-a', sourceCandidateId: 'source-a' })
  const rightInput = factObservation({ observationId: 'obs-b', driverId: 'input-b', sourceCandidateId: 'source-b' })
  for (const operation of ['SUBTRACT', 'DIVIDE', 'PERCENT_CHANGE'] as const) {
    const forward = inputWithObservations([leftInput, rightInput, derivedFixture(operation, ['obs-a', 'obs-b'])])
    const reversed = inputWithObservations([leftInput, rightInput, derivedFixture(operation, ['obs-b', 'obs-a'])])
    const forwardDerived = validateScenarioMethodContract(forward)
    const reversedDerived = validateScenarioMethodContract(reversed)
    assert.ok(!forwardDerived.diagnostics.some((item) => item.code === 'DERIVATION_MISMATCH'), operation)
    assert.ok(!reversedDerived.diagnostics.some((item) => item.code === 'DERIVATION_MISMATCH'), operation)
    const forwardHash = scenarioMethodReviewPacketHash(forward)
    const reversedHash = scenarioMethodReviewPacketHash(reversed)
    assert.notEqual(forwardHash, reversedHash, `${operation} operand identity order must remain review-significant even when the numeric result is equal`)
    const oldReview = { state: 'REVIEW_REQUIRED' as const, authorId: 'fixture-author', reviewerId: null, reviewPacketHash: forwardHash, reviewerDecisionReference: null, independentOfAuthorClaim: false }
    assert.equal(validateReviewFreshness(oldReview, reversedHash).state, 'STALE_REVIEW', operation)
  }
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

const knownAmount = (amount: number) => ({ status: 'KNOWN' as const, amount, evidenceRefs: ['fixture-evidence'] as const })
const knownZero = { status: 'KNOWN_ZERO' as const, amount: 0 as const, evidenceRefs: ['fixture-zero-proof'] as const }
const notApplicable = { status: 'NOT_APPLICABLE' as const, reason: 'fixture method explicitly excludes this component', evidenceRefs: ['fixture-basis-proof'] as const }

function enterpriseValueInput(overrides: Partial<EnterpriseValueBridgeConsistencyInput> = {}): EnterpriseValueBridgeConsistencyInput {
  return {
    mode: 'FIXTURE_ONLY', debtBasis: 'GROSS_DEBT', grossDebt: knownAmount(50), netDebt: notApplicable, separatelySubtractedCash: knownAmount(10),
    grossDebtIncludesLeases: false, leaseClaimsIncluded: false, leaseAmount: notApplicable, leaseInEarningsBasis: false,
    preferredAndConvertibleClaims: notApplicable, nonControllingClaims: notApplicable, otherSeniorClaims: notApplicable, adjustments: [],
    classAllocationReference: 'fixture-allocation', allocatedClassEquityValues: { A: 5, H: 5 }, totalEquityValue: knownAmount(10), market: marketInput(),
    ...overrides,
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
  const diagnostics = validateEnterpriseValueBridgeConsistency(enterpriseValueInput({ debtBasis: 'NET_DEBT', grossDebt: notApplicable, netDebt: knownAmount(50), separatelySubtractedCash: knownAmount(10) }))
  assert.ok(diagnostics.some((item) => item.code === 'STRUCTURAL_INVALID'))
})

test('FIX-001 every unavailable required EV component blocks the fixture input', () => {
  const cases = [
    ['preferredAndConvertibleClaims', { preferredAndConvertibleClaims: { status: 'UNAVAILABLE' as const, reason: 'fixture: disclosure absent' } }],
    ['nonControllingClaims', { nonControllingClaims: { status: 'UNAVAILABLE' as const, reason: 'fixture: disclosure absent' } }],
    ['otherSeniorClaims', { otherSeniorClaims: { status: 'UNAVAILABLE' as const, reason: 'fixture: disclosure absent' } }],
    ['separatelySubtractedCash', { separatelySubtractedCash: { status: 'UNAVAILABLE' as const, reason: 'fixture: disclosure absent' } }],
  ] as const
  for (const [field, override] of cases) {
    const diagnostics = validateEnterpriseValueBridgeConsistency(enterpriseValueInput(override))
    assert.ok(diagnostics.some((item) => item.code === 'MISSING_REQUIRED_DRIVER' && item.subjectId === field), field)
  }
})

test('FIX-001 evidenced zero and basis-supported not-applicable claims differ from unknown', () => {
  const diagnostics = validateEnterpriseValueBridgeConsistency(enterpriseValueInput({ separatelySubtractedCash: knownZero }))
  assert.deepEqual(diagnostics, [])
  const unsupportedZeroValue = { status: 'KNOWN_ZERO', amount: 0, evidenceRefs: [] } as unknown as EnterpriseValueBridgeConsistencyInput['preferredAndConvertibleClaims']
  const unsupportedZero = validateEnterpriseValueBridgeConsistency(enterpriseValueInput({ preferredAndConvertibleClaims: unsupportedZeroValue }))
  assert.ok(unsupportedZero.some((item) => item.code === 'MISSING_REQUIRED_DRIVER'))
  const unsupportedNotApplicable = { status: 'NOT_APPLICABLE', reason: '', evidenceRefs: ['fixture-basis-proof'] } as EnterpriseValueBridgeConsistencyInput['preferredAndConvertibleClaims']
  const unsupportedBasis = validateEnterpriseValueBridgeConsistency(enterpriseValueInput({ preferredAndConvertibleClaims: unsupportedNotApplicable }))
  assert.ok(unsupportedBasis.some((item) => item.code === 'MISSING_REQUIRED_DRIVER'))
  const unavailable = validateEnterpriseValueBridgeConsistency(enterpriseValueInput({ otherSeniorClaims: { status: 'UNAVAILABLE', reason: 'fixture: unknown' } }))
  assert.ok(unavailable.some((item) => item.code === 'MISSING_REQUIRED_DRIVER' && item.subjectId === 'otherSeniorClaims'))
})

test('T10 caller proof/reviewer claims never grant report eligibility; no trust anchor is configured', () => {
  const result = validateScenarioMethodContract(bindManifest(inputWith(factObservation())))
  assert.equal(result.reportEligible, false)
  assert.equal(result.observationAssessments[0]?.eligibility, 'UNVERIFIED')
  assert.equal(getHistoricalTrustAnchorStatus().configured, false)
})
