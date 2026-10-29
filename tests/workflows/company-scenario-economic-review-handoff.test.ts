import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  EconomicBridgeInput, EconomicDriverObservation, EconomicValueEvidence, ResearchAssumptionProposal,
  ScenarioEconomicReviewFinding, ScenarioEconomicReviewPacketBuildInput, ScenarioEconomicReviewReceipt,
  ScenarioMethodContractInput, ScenarioName, ValueVersionProof,
} from '../../workflows/company-deep-research/scenario-method-contracts.ts'
import { calculateEconomicBridge } from '../../workflows/company-deep-research/scenario-economic-bridge.ts'
import { buildScenarioEconomicReviewPacket, validateScenarioEconomicReviewReceipt } from '../../workflows/company-deep-research/scenario-economic-review-handoff.ts'
import { hashCanonicalScenarioValue, validateScenarioMethodContract } from '../../workflows/company-deep-research/scenario-method-validation.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'

const cases = ['BEAR', 'BASE', 'BULL'] as const
const dimensions = ['ECONOMIC_CAUSALITY', 'EVIDENCE_RELEVANCE', 'CALIBRATION', 'COUNTEREVIDENCE', 'FALSIFIABLE_TRIGGER', 'RESIDUAL', 'PERIOD', 'UNIT'] as const
const asOf = '2026-07-01T00:00:00Z'
const horizon = {
  analysisAsOf: asOf, asOfMode: 'FROZEN_T0' as const, targetFiscalYear: 2028,
  targetPeriodStart: '2028-01-01', targetPeriodEnd: '2028-12-31', targetPeriodBasis: 'FY' as const,
  baseFiscalYear: 2025, basePeriodEnd: '2025-12-31', basePeriodBasis: 'FY' as const,
  financialScope: 'CONSOLIDATED', currency: 'CNY', methodId: 'fixture-method-v1',
  requiredDriverIds: ['operating-cash'], sourceSnapshotHash: 'a'.repeat(64),
}
const known = (value: number) => ({ status: 'KNOWN' as const, value, evidenceRefs: ['fixture-synthetic-ref'] as const })
const numericValue = (evidence: EconomicValueEvidence): number => {
  if (evidence.status !== 'KNOWN' && evidence.status !== 'KNOWN_ZERO') throw new Error(`Expected a known fixture value, received ${evidence.status}`)
  return evidence.value
}
const scalar = (id: string, value: number, options: Record<string, unknown> = {}) => ({
  value: known(value), companySymbol: 'FICTIONAL-CO', metricId: id, dimension: 'CURRENCY_AMOUNT', unit: 'CNY', currency: 'CNY',
  periodStart: '2028-01-01', periodEnd: '2028-12-31', periodBasis: 'FY', flowOrStock: 'FLOW',
  financialScope: 'CONSOLIDATED', economicScope: 'fictional operations', sourceId: id,
  accountId: id, mappingRole: 'OPERATING', signConvention: 'SIGNED_AMOUNT', ...options,
}) as EconomicBridgeInput['fcff']['unleveredEbit']

function factObservation(): Extract<EconomicDriverObservation, { kind: 'FACT' }> {
  const content = 'FICTIONAL-CO synthetic historical base observation: operating cash 10 CNY FY2025.'
  const contentHash = sha256(content)
  const rightsText = 'FICTIONAL-CO synthetic fixture rights claim.'
  const rightsHash = sha256(rightsText)
  const rights = { recordId: 'fixture-rights', evidenceHash: rightsHash, intendedUse: 'OPERATING_DRIVER' as const, decision: 'ALLOWED' as const, evidenceTextHash: rightsHash, evidenceText: rightsText }
  const evidence = {
    sourceCandidateId: 'fixture-source-operating-cash', sourceLocation: 'paragraph:1', immutableSourceContentHash: contentHash,
    immutableSourceContent: content, sourceExcerptText: content, rawValueToken: '10', normalizedValue: 10,
    normalizationRule: { kind: 'IDENTITY' as const, formulaVersion: 'identity-v1' as const }, unit: 'CNY', currency: 'CNY', metricId: 'operating-cash',
    periodStart: '2025-01-01', periodEnd: '2025-12-31', periodBasis: 'FY', financialScope: 'CONSOLIDATED', shareBasis: null,
    rowBindingHash: '', sourceRetrievedAt: '2026-07-02T00:00:00Z',
  }
  evidence.rowBindingHash = hashCanonicalScenarioValue({
    sourceCandidateId: evidence.sourceCandidateId, sourceLocation: evidence.sourceLocation,
    immutableSourceContentHash: evidence.immutableSourceContentHash, rawValueToken: evidence.rawValueToken,
    normalizedValue: evidence.normalizedValue, normalizationRule: evidence.normalizationRule, unit: evidence.unit,
    currency: evidence.currency, metricId: evidence.metricId, periodStart: evidence.periodStart, periodEnd: evidence.periodEnd,
    periodBasis: evidence.periodBasis, financialScope: evidence.financialScope, shareBasis: evidence.shareBasis,
  })
  const proof: ValueVersionProof = {
    proofId: 'fixture-proof', evidenceManifestHash: '0'.repeat(64), claimedProofStatus: 'VERIFIED',
    sourceCandidateId: evidence.sourceCandidateId, sourceLocation: evidence.sourceLocation,
    immutableSourceContentHash: evidence.immutableSourceContentHash, rawValueToken: evidence.rawValueToken,
    normalizedValue: evidence.normalizedValue, normalizationRule: evidence.normalizationRule, unit: evidence.unit,
    currency: evidence.currency, epsBasis: null, metricId: evidence.metricId, periodStart: evidence.periodStart,
    periodEnd: evidence.periodEnd, periodBasis: evidence.periodBasis, financialScope: evidence.financialScope,
    rowBindingHash: evidence.rowBindingHash, valueVersionId: 'fixture-version-claim',
    valueVersionAvailableAt: '2026-06-30T00:00:00Z', sourcePublishedAt: '2026-06-30T00:00:00Z',
    observedAt: '2026-06-30T00:00:00Z', retrievedAt: '2026-07-02T00:00:00Z', revisionStatus: 'COMPLETE',
    revisionChainHash: 'c'.repeat(64), rights, analysisAsOf: asOf, trustRoot: 'fixture-trust-claim', proofReference: 'fixture-proof-ref',
    method: 'OFFICIAL_PUBLISHED_DOCUMENT', publicationRecordReference: 'fixture-publication-claim',
    snapshotCapturedAt: null, snapshotSealedAt: null, signatureVerificationReference: null,
  }
  return {
    kind: 'FACT', originKind: 'FACT', observationId: 'obs-operating-cash', companySymbol: 'FICTIONAL-CO',
    driverId: 'operating-cash', metricId: 'operating-cash', atomicSkillOwner: 'scenario_valuation', consumer: 'OPERATING_DRIVER',
    economicScope: 'fictional operations', financialScope: 'CONSOLIDATED', periodStart: '2025-01-01', periodEnd: '2025-12-31',
    fiscalYear: 2025, periodBasis: 'FY', flowOrStock: 'FLOW', unit: 'CNY', currency: 'CNY', shareBasis: null,
    observedAt: proof.observedAt, sourcePublishedAt: proof.sourcePublishedAt, retrievedAt: proof.retrievedAt,
    analysisAsOf: asOf, asOfMode: 'FROZEN_T0', evidenceManifestHash: '0'.repeat(64), sourceConflicts: [],
    claimedValueVersionStatus: 'VERIFIED', claimedEligibility: 'QUALIFIED', evidence, rights, valueVersionProof: proof,
  }
}

function assumption(scenario: ScenarioName, authorId = `${scenario.toLowerCase()}-author`, patch: Partial<ResearchAssumptionProposal> = {}): ResearchAssumptionProposal {
  return {
    proposalId: `proposal-${scenario.toLowerCase()}-operating-cash`, companySymbol: 'FICTIONAL-CO', scenario,
    driverId: 'operating-cash', originKind: 'RESEARCH_ASSUMPTION', authorId, targetFiscalYear: 2028,
    targetPeriodStart: '2028-01-01', targetPeriodEnd: '2028-12-31', financialScope: 'CONSOLIDATED', unit: 'CNY', currency: 'CNY',
    proposedValue: 19.5, mechanism: `synthetic ${scenario.toLowerCase()} operating mechanism`, calibrationRefs: ['obs-operating-cash'],
    counterEvidenceRefs: ['obs-operating-cash'], falsifiableTrigger: `synthetic ${scenario.toLowerCase()} trigger`,
    inputObservationRefs: ['obs-operating-cash'], proposalVersion: 'fixture-proposal-v1', ...patch,
  }
}

function methodInput(options: { missingObservation?: boolean; proposals?: readonly ResearchAssumptionProposal[]; methodVersion?: string; rubricVersion?: string } = {}): ScenarioMethodContractInput {
  const observed = factObservation()
  let observations: readonly EconomicDriverObservation[] = options.missingObservation ? [{
    ...observed, kind: 'MISSING', originKind: 'FACT', claimedValueVersionStatus: 'UNAVAILABLE', claimedEligibility: 'UNAVAILABLE',
    missingFields: ['valueVersionProof'], rejectionReasons: ['synthetic version proof missing'], evidence: null, rights: null,
    valueVersionProof: null, normalizedValue: null,
  } as unknown as EconomicDriverObservation] : [observed]
  const proposals = [...(options.proposals ?? cases.map((name) => assumption(name)))]
  const scenarios = cases.map((scenario) => ({
    scenario, horizon, companySymbol: 'FICTIONAL-CO', financialScope: 'CONSOLIDATED', currency: 'CNY', methodId: 'fixture-method-v1',
    requiredDriverIds: ['operating-cash'], driverProposalRefs: [`proposal-${scenario.toLowerCase()}-operating-cash`],
    driverObservationRefs: ['obs-operating-cash'], residualPolicy: 'NOT_REQUIRED' as const, residualDescription: null, adjustments: [],
  })) as unknown as ScenarioMethodContractInput['scenarioSet']['scenarios']
  const provisional: ScenarioMethodContractInput = {
    horizon, observations, scenarioSet: { scenarios, proposals, requiredDriverIds: ['operating-cash'] },
    methodVersion: options.methodVersion ?? 'fixture-method-version-1', rubricVersion: options.rubricVersion ?? 'fixture-phase1-rubric-v1',
  }
  const manifestHash = validateScenarioMethodContract(provisional).evidenceManifestHash
  observations = observations.map((item) => item.kind === 'FACT' ? {
    ...item, evidenceManifestHash: manifestHash,
    valueVersionProof: item.valueVersionProof ? { ...item.valueVersionProof, evidenceManifestHash: manifestHash } : null,
  } as EconomicDriverObservation : { ...item, evidenceManifestHash: manifestHash })
  return { ...provisional, observations }
}

function rebindMethodInput(input: ScenarioMethodContractInput): ScenarioMethodContractInput {
  const manifestHash = validateScenarioMethodContract(input).evidenceManifestHash
  return {
    ...input,
    observations: input.observations.map((item) => item.kind === 'FACT' ? {
      ...item, evidenceManifestHash: manifestHash,
      valueVersionProof: item.valueVersionProof ? { ...item.valueVersionProof, evidenceManifestHash: manifestHash } : null,
    } as EconomicDriverObservation : { ...item, evidenceManifestHash: manifestHash }),
  }
}

function economicInput(scenario: ScenarioName, proposal: ResearchAssumptionProposal): EconomicBridgeInput {
  const line = {
    lineId: 'synthetic-line', economicLineKey: 'synthetic-revenue', bridgeId: `bridge-${scenario.toLowerCase()}`,
    companySymbol: 'FICTIONAL-CO', scenario, fromMetric: 'segmentRevenue', toMetric: 'revenue', operation: 'ADD' as const,
    inputRefs: ['synthetic-revenue-ref'], amount: known(100), dimension: 'CURRENCY_AMOUNT' as const, unit: 'CNY', currency: 'CNY',
    periodStart: '2028-01-01', periodEnd: '2028-12-31', periodBasis: 'FY', flowOrStock: 'FLOW' as const,
    financialScope: 'CONSOLIDATED', economicScope: 'fictional operations', originKind: 'FACT' as const,
    formulaVersion: 'fixture-economic-formula-v1', evidenceRefs: ['synthetic-revenue-ref'], adjustmentRefs: [], disposition: 'INCLUDED_ONCE' as const,
  }
  const nwc = (id: string, value: number, periodEnd: string, role: string, periodBasis: string) => scalar(id, value, {
    periodStart: periodEnd === '2027-12-31' ? '2027-01-01' : '2028-01-01', periodEnd, periodBasis,
    flowOrStock: 'STOCK', mappingRole: role,
  })
  const calibration = {
    calibrationId: `cal-${scenario.toLowerCase()}`, lower: known(10), upper: known(30), dimension: 'CURRENCY_AMOUNT' as const,
    unit: 'CNY', currency: 'CNY', periodBasis: 'FY', financialScope: 'CONSOLIDATED', economicScope: 'fictional operations',
    method: 'synthetic operational mechanism', evidenceRefs: ['synthetic-calibration-ref', 'synthetic-calibration-ref-b'], category: 'OPERATIONAL_MECHANISM' as const, status: 'UNVERIFIED' as const,
  }
  return {
    mode: 'FIXTURE_ONLY', companySymbol: 'FICTIONAL-CO', bridgeId: `bridge-${scenario.toLowerCase()}`, analysisAsOf: asOf,
    horizon: { scenario, periodStart: '2028-01-01', periodEnd: '2028-12-31', periodBasis: 'FY' },
    formulaVersion: 'fixture-economic-formula-v1', rightsVersionClaim: 'UNVERIFIED_SYNTHETIC_RIGHTS', valueVersionClaim: 'UNVERIFIED_SYNTHETIC_VERSION',
    sourceTimeClaims: { sourcePublishedAt: '2026-06-30T00:00:00Z', retrievedAt: '2026-07-02T00:00:00Z', valueVersionAvailableAt: '2026-06-30T00:00:00Z', snapshotCapturedAt: null, snapshotSealedAt: null },
    revenue: { lines: [line], selectedRoute: 'DISCLOSED_SEGMENT_REVENUE', volume: null, realizedNetAsp: null, reportedConsolidatedRevenue: scalar('reported-revenue', 100), adjustments: [] },
    profit: {
      cogs: scalar('cogs', 60), operatingExpenses: [scalar('sga', 10, { signConvention: 'POSITIVE_EXPENSE', mappingRole: 'SG&A' })],
      otherOperatingIncome: [scalar('other-income', 2, { mappingRole: 'OTHER_OPERATING_INCOME' })], signedNetFinanceItems: scalar('finance', -2),
      signedNonOperatingItems: scalar('nonop', 0), incomeTaxExpense: scalar('tax-expense', 5, { signConvention: 'POSITIVE_EXPENSE' }),
      profitAttributableToNci: scalar('nci', 3), nciBasis: 'CONSOLIDATED_TO_PARENT', ebit: scalar('reported-ebit', 32), nonRecurringItems: [],
    },
    fcff: {
      unleveredEbit: scalar('unlevered-ebit', 30), taxRate: scalar('tax-rate', 0.25, { dimension: 'RATE', unit: 'fraction', currency: null, flowOrStock: 'RATE' }),
      taxConvention: 'synthetic effective rate', da: scalar('da', 4), capex: scalar('capex', 6, { signConvention: 'POSITIVE_CASH_OUTFLOW' }),
      nwcStart: [nwc('inventory', 10, '2027-12-31', 'OPERATING_CURRENT_ASSET', 'FY'), nwc('payables', 4, '2027-12-31', 'OPERATING_CURRENT_LIABILITY', 'FY')],
      nwcEnd: [nwc('inventory', 12, '2028-12-31', 'OPERATING_CURRENT_ASSET', 'FY'), nwc('payables', 5, '2028-12-31', 'OPERATING_CURRENT_LIABILITY', 'FY')],
      nwcComplete: true, excludedOperatingCapitalIds: ['cash', 'debt'], leaseTreatment: 'synthetic explicit exclusion',
      acquisitionTreatment: 'synthetic none', taxTreatment: 'FY unchanged', cfo: null, purchasesOfLongTermAssets: null,
    },
    calibrationProposals: [{ scenario, driverId: proposal.driverId, baseline: 'synthetic baseline', proposedValue: proposal.proposedValue,
      mechanism: proposal.mechanism, calibration, strongestCounterevidence: 'synthetic counterevidence', trigger: proposal.falsifiableTrigger, author: proposal.authorId }],
  }
}

function fixture(options: { missingObservation?: boolean; proposals?: readonly ResearchAssumptionProposal[]; methodVersion?: string; rubricVersion?: string } = {}) {
  const scenarioMethodInput = methodInput(options)
  const proposals = options.proposals ?? scenarioMethodInput.scenarioSet.proposals
  const bridges = cases.map((scenario) => {
    const proposal = proposals.find((item) => item.scenario === scenario)!
    const input = economicInput(scenario, proposal)
    return { input, result: calculateEconomicBridge(input) }
  })
  const buildInput: ScenarioEconomicReviewPacketBuildInput = {
    mode: 'FIXTURE_ONLY', scenarioMethodInput, bridges,
    rubricVersion: 'fixture-economic-review-rubric-v1', reviewContractVersion: 'fixture-review-contract-v1',
  }
  return { scenarioMethodInput, bridges, buildInput, packet: buildScenarioEconomicReviewPacket(buildInput) }
}

function receiptFor(packetResult = fixture().packet): ScenarioEconomicReviewReceipt {
  assert.ok(packetResult.packet)
  const findings: ScenarioEconomicReviewFinding[] = packetResult.packet.cases.flatMap((item) => item.proposals.map((proposal) => ({
    scenario: item.scenario, driverId: proposal.driverId, proposalId: proposal.proposalId, rationale: 'Synthetic reviewer claim only.',
    rubric: Object.fromEntries(dimensions.map((dimension) => [dimension, { judgment: 'QUALIFIED_CLAIM', reason: 'Synthetic rubric claim only.' }])) as ScenarioEconomicReviewFinding['rubric'],
  })))
  return {
    reviewerId: 'fixture-reviewer', reviewerRoleClaim: 'INDEPENDENT_ECONOMIC_REVIEWER_CLAIM', reviewerSessionClaim: 'fixture-session',
    reviewerExecutionIdClaim: 'fixture-execution', decisionClaim: 'ACCEPT_CLAIM', packetHash: packetResult.economicReviewPacketHash!,
    rubricVersion: packetResult.packet.economicReviewRubricVersion, reviewContractVersion: packetResult.packet.reviewContractVersion,
    authorIds: [...packetResult.packet.authorIds], authorSetHash: packetResult.packet.authorSetHash, findings,
    identityAttestationReferenceClaim: 'fake-attestation-ref', independentOfAuthorClaim: true, identityVerifiedClaim: true,
    signatureClaim: 'fake-signature', authorityReferenceClaim: 'fake-authority',
  }
}

test('C01 packet freezes the three cases deterministically and permanently denies dispatch/qualification', () => {
  const one = fixture().packet, two = fixture().packet
  assert.equal(one.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY', JSON.stringify({ handoff: one.diagnostics, method: one.phase1Result?.diagnostics, bridges: fixture().bridges.map((pair) => pair.result.diagnostics) }))
  assert.equal(one.economicReviewPacketHash, two.economicReviewPacketHash)
  assert.deepEqual(one.packet?.cases.map((item) => item.scenario), cases)
  assert.equal(one.dispatchAuthorized, false); assert.equal(one.reportEligible, false); assert.equal(one.reviewRequired, true)
  assert.equal(one.packet?.dispatchAuthorized, false); assert.equal(one.packet?.reportEligible, false)
  assert.equal(one.packet?.phase1Hashes.reviewPacketHash, one.phase1Result?.reviewPacketHash)
})

test('C02 missing receipt remains REVIEW_REQUIRED with no identity or dispatch authority', () => {
  const built = fixture().packet
  const result = validateScenarioEconomicReviewReceipt(built, null)
  assert.equal(result.reviewRecordStatus, 'REVIEW_REQUIRED'); assert.equal(result.identityVerified, false)
  assert.equal(result.independenceVerified, false); assert.equal(result.qualificationGranted, false); assert.equal(result.reportEligible, false)
})

test('C03 any proposer author self-review is rejected; a different string is still unverified', () => {
  const built = fixture().packet, receipt = receiptFor(built)
  const self = validateScenarioEconomicReviewReceipt(built, { ...receipt, reviewerId: 'base-author' })
  assert.equal(self.reviewRecordStatus, 'REJECTED'); assert.equal(self.independenceConflict, true)
  const empty = validateScenarioEconomicReviewReceipt(built, { ...receipt, reviewerId: '' })
  assert.equal(empty.reviewRecordStatus, 'REJECTED')
  const sessionSelf = validateScenarioEconomicReviewReceipt(built, { ...receipt, reviewerSessionClaim: 'bear-author' })
  assert.equal(sessionSelf.reviewRecordStatus, 'REJECTED'); assert.equal(sessionSelf.independenceConflict, true)
  const other = validateScenarioEconomicReviewReceipt(built, receipt)
  assert.equal(other.reviewRecordStatus, 'REVIEW_REQUIRED'); assert.equal(other.identityVerified, false)
})

test('C04 caller independent/identity/signature/authority claims cannot establish trust', () => {
  const built = fixture().packet, receipt = receiptFor(built)
  const result = validateScenarioEconomicReviewReceipt(built, { ...receipt, independentOfAuthorClaim: true, identityVerifiedClaim: true, signatureClaim: 'forged', authorityReferenceClaim: 'unregistered' })
  assert.equal(result.reviewRecordStatus, 'REVIEW_REQUIRED'); assert.equal(result.independenceVerified, false); assert.equal(result.qualificationGranted, false)
  assert.ok(result.diagnostics.some((item) => item.code === 'IDENTITY_UNVERIFIED'))
})

test('C05 ACCEPT_CLAIM with all rubric claims qualified remains non-qualifying', () => {
  const built = fixture().packet
  const result = validateScenarioEconomicReviewReceipt(built, receiptFor(built))
  assert.equal(result.reviewRecordStatus, 'REVIEW_REQUIRED'); assert.equal(result.qualificationGranted, false); assert.equal(result.reportEligible, false)
  assert.ok(result.diagnostics.some((item) => item.code === 'SEMANTIC_REVIEW_REQUIRED'))
})

test('C06 any newly frozen method/proposal/author/version/bridge/rights/asOf input stales old receipt', () => {
  const base = fixture(), oldReceipt = receiptFor(base.packet)
  const variants: ScenarioEconomicReviewPacketBuildInput[] = []
  variants.push({ ...base.buildInput, scenarioMethodInput: { ...base.scenarioMethodInput, methodVersion: 'fixture-method-version-2' } })
  variants.push({ ...base.buildInput, scenarioMethodInput: { ...base.scenarioMethodInput, rubricVersion: 'fixture-phase1-rubric-v2' } })
  const revisedProposals = base.scenarioMethodInput.scenarioSet.proposals.map((item) => ({ ...item, proposalVersion: 'fixture-proposal-v2' }))
  variants.push({ ...base.buildInput, scenarioMethodInput: { ...base.scenarioMethodInput, scenarioSet: { ...base.scenarioMethodInput.scenarioSet, proposals: revisedProposals } } })
  const revisedValues = base.scenarioMethodInput.scenarioSet.proposals.map((item) => ({ ...item, proposedValue: 21 }))
  variants.push({ ...base.buildInput, scenarioMethodInput: { ...base.scenarioMethodInput, scenarioSet: { ...base.scenarioMethodInput.scenarioSet, proposals: revisedValues } }, bridges: base.bridges.map((pair) => {
    const input = { ...pair.input, calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, proposedValue: 21 })) }
    return { input, result: calculateEconomicBridge(input) }
  }) })
  const revisedAuthors = base.scenarioMethodInput.scenarioSet.proposals.map((item) => ({ ...item, authorId: `revised-${item.authorId}` }))
  variants.push({ ...base.buildInput, scenarioMethodInput: { ...base.scenarioMethodInput, scenarioSet: { ...base.scenarioMethodInput.scenarioSet, proposals: revisedAuthors } }, bridges: base.bridges.map((pair) => {
    const input = { ...pair.input, calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, author: `revised-${item.author}` })) }
    return { input, result: calculateEconomicBridge(input) }
  }) })
  variants.push({ ...base.buildInput, bridges: base.bridges.map((pair) => {
    const input = { ...pair.input, formulaVersion: 'fixture-economic-formula-v2', revenue: { ...pair.input.revenue, lines: pair.input.revenue.lines.map((line) => ({ ...line, formulaVersion: 'fixture-economic-formula-v2' })) } }
    return { input, result: calculateEconomicBridge(input) }
  }) })
  variants.push({ ...base.buildInput, bridges: base.bridges.map((pair) => {
    const input = { ...pair.input, calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, calibration: { ...item.calibration!, lower: known(11) } })) }
    return { input, result: calculateEconomicBridge(input) }
  }) })
  const revisedProof = rebindMethodInput({ ...base.scenarioMethodInput, observations: base.scenarioMethodInput.observations.map((item) => item.kind === 'FACT' && item.valueVersionProof
    ? { ...item, valueVersionProof: { ...item.valueVersionProof, valueVersionId: 'fixture-version-claim-v2' } } as EconomicDriverObservation : item) })
  variants.push({ ...base.buildInput, scenarioMethodInput: revisedProof })
  variants.push({ ...base.buildInput, bridges: base.bridges.map((pair) => ({ input: { ...pair.input, rightsVersionClaim: 'changed-unverified-rights-claim' }, result: calculateEconomicBridge({ ...pair.input, rightsVersionClaim: 'changed-unverified-rights-claim' }) })) })
  variants.push({ ...base.buildInput, bridges: base.bridges.map((pair) => ({ input: { ...pair.input, valueVersionClaim: 'changed-unverified-version-claim' }, result: calculateEconomicBridge({ ...pair.input, valueVersionClaim: 'changed-unverified-version-claim' }) })) })
  const laterHorizon = { ...base.scenarioMethodInput.horizon, analysisAsOf: '2026-07-02T00:00:00Z' }
  const laterMethodInput = rebindMethodInput({
    ...base.scenarioMethodInput, horizon: laterHorizon,
    observations: base.scenarioMethodInput.observations.map((item) => item.kind === 'FACT' ? {
      ...item, analysisAsOf: laterHorizon.analysisAsOf,
      valueVersionProof: item.valueVersionProof ? { ...item.valueVersionProof, analysisAsOf: laterHorizon.analysisAsOf } : null,
    } as EconomicDriverObservation : { ...item, analysisAsOf: laterHorizon.analysisAsOf }),
    scenarioSet: { ...base.scenarioMethodInput.scenarioSet, scenarios: base.scenarioMethodInput.scenarioSet.scenarios.map((item) => ({ ...item, horizon: laterHorizon })) as unknown as ScenarioMethodContractInput['scenarioSet']['scenarios'] },
  })
  variants.push({ ...base.buildInput, scenarioMethodInput: laterMethodInput, bridges: base.bridges.map((pair) => {
    const input = { ...pair.input, analysisAsOf: laterHorizon.analysisAsOf }
    return { input, result: calculateEconomicBridge(input) }
  }) })
  for (const [index, nextInput] of variants.entries()) {
    const next = buildScenarioEconomicReviewPacket(nextInput)
    assert.equal(next.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY', `${index}: ${JSON.stringify(next.diagnostics)}`)
    assert.notEqual(next.economicReviewPacketHash, base.packet.economicReviewPacketHash)
    assert.equal(validateScenarioEconomicReviewReceipt(next, oldReceipt).reviewRecordStatus, 'STALE_REVIEW')
  }
})

test('C07 bridge mutation changes the frozen hash and caller-supplied stale calculation is rejected', () => {
  const base = fixture(), first = base.bridges[0]!
  const changedInput = { ...first.input, fcff: { ...first.input.fcff, capex: { ...first.input.fcff.capex, value: known(7) } } }
  const changedResult = calculateEconomicBridge(changedInput)
  const changed = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: [{ input: changedInput, result: changedResult }, ...base.bridges.slice(1)] })
  assert.equal(changed.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  assert.notEqual(changed.economicReviewPacketHash, base.packet.economicReviewPacketHash)
  assert.equal(validateScenarioEconomicReviewReceipt(changed, receiptFor(base.packet)).reviewRecordStatus, 'STALE_REVIEW')
  const forged = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: [{ input: changedInput, result: first.result }, ...base.bridges.slice(1)] })
  assert.equal(forged.packetStatus, 'UNAVAILABLE')
  assert.ok(forged.diagnostics.some((item) => item.code === 'BRIDGE_RESULT_MISMATCH'))
  const tamperedPacket = { ...changed, packet: { ...changed.packet!, companySymbol: 'TAMPERED-FICTIONAL' } }
  assert.equal(validateScenarioEconomicReviewReceipt(tamperedPacket, receiptFor(base.packet)).reviewRecordStatus, 'UNAVAILABLE')
})

test('C08 missing, duplicate, wrong-order, mixed-company and mixed-period case sets are unavailable', () => {
  const base = fixture()
  const variants = [
    { ...base.buildInput, bridges: base.bridges.slice(0, 2) },
    { ...base.buildInput, bridges: [base.bridges[0]!, base.bridges[1]!, base.bridges[1]!] },
    { ...base.buildInput, bridges: [base.bridges[1]!, base.bridges[0]!, base.bridges[2]!] },
    { ...base.buildInput, bridges: base.bridges.map((pair, index) => index === 2 ? { input: { ...pair.input, companySymbol: 'OTHER-FICTIONAL' }, result: calculateEconomicBridge({ ...pair.input, companySymbol: 'OTHER-FICTIONAL' }) } : pair) },
    { ...base.buildInput, bridges: base.bridges.map((pair, index) => index === 0 ? { input: { ...pair.input, horizon: { ...pair.input.horizon, periodEnd: '2028-06-30' } }, result: calculateEconomicBridge({ ...pair.input, horizon: { ...pair.input.horizon, periodEnd: '2028-06-30' } }) } : pair) },
    { ...base.buildInput, bridges: base.bridges.map((pair, index) => index === 0 ? { input: { ...pair.input, fcff: { ...pair.input.fcff, unleveredEbit: { ...pair.input.fcff.unleveredEbit, financialScope: 'PARENT' } } }, result: calculateEconomicBridge({ ...pair.input, fcff: { ...pair.input.fcff, unleveredEbit: { ...pair.input.fcff.unleveredEbit, financialScope: 'PARENT' } } }) } : pair) },
    { ...base.buildInput, bridges: base.bridges.map((pair, index) => index === 0 ? { input: { ...pair.input, fcff: { ...pair.input.fcff, unleveredEbit: { ...pair.input.fcff.unleveredEbit, currency: 'USD' } } }, result: calculateEconomicBridge({ ...pair.input, fcff: { ...pair.input.fcff, unleveredEbit: { ...pair.input.fcff.unleveredEbit, currency: 'USD' } } }) } : pair) },
  ]
  for (const value of variants) assert.equal(buildScenarioEconomicReviewPacket(value).packetStatus, 'UNAVAILABLE')
})

test('C09 missing source version proof or incomplete FCFF/NWC cannot be repaired by a reviewer claim', () => {
  const noSource = fixture({ missingObservation: true }).packet
  assert.equal(noSource.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  assert.equal(noSource.phase1Result?.methodStatus, 'UNAVAILABLE')
  const sourceAssessment = validateScenarioEconomicReviewReceipt(noSource, receiptFor(noSource))
  assert.equal(sourceAssessment.reviewRecordStatus, 'REVIEW_REQUIRED')
  assert.equal(sourceAssessment.qualificationGranted, false)
  const base = fixture(), broken = base.bridges.map((pair, index) => {
    if (index !== 0) return pair
    const input = { ...pair.input, fcff: { ...pair.input.fcff, nwcComplete: false } }
    return { input, result: calculateEconomicBridge(input) }
  })
  const noNwc = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: broken })
  assert.equal(noNwc.packetStatus, 'UNAVAILABLE')
  assert.equal(validateScenarioEconomicReviewReceipt(noNwc, receiptFor(base.packet)).reviewRecordStatus, 'UNAVAILABLE')
})

test('C10 author collection spans all cases and rejects a reviewer matching the BEAR author', () => {
  const distinct = cases.map((scenario) => assumption(scenario, `${scenario.toLowerCase()}-specific-author`))
  const built = fixture({ proposals: distinct }).packet
  assert.deepEqual(built.packet?.authorIds, ['base-specific-author', 'bear-specific-author', 'bull-specific-author'])
  const result = validateScenarioEconomicReviewReceipt(built, { ...receiptFor(built), reviewerId: 'bear-specific-author' })
  assert.equal(result.reviewRecordStatus, 'REJECTED'); assert.equal(result.independenceConflict, true)
})

test('C11 receipt requires exactly one complete finding per frozen proposal and every rubric reason', () => {
  const built = fixture().packet, complete = receiptFor(built)
  const missing = validateScenarioEconomicReviewReceipt(built, { ...complete, findings: [] })
  assert.equal(missing.reviewRecordStatus, 'REVIEW_REQUIRED')
  assert.ok(missing.diagnostics.some((item) => item.code === 'REVIEW_REQUIRED'))
  const duplicate = validateScenarioEconomicReviewReceipt(built, { ...complete, findings: [...complete.findings, complete.findings[0]!] })
  assert.equal(duplicate.reviewRecordStatus, 'REVIEW_REQUIRED')
  const unknown = { ...complete.findings[0]!, proposalId: 'not-in-packet' }
  const outside = validateScenarioEconomicReviewReceipt(built, { ...complete, findings: [unknown, ...complete.findings.slice(1)] })
  assert.equal(outside.reviewRecordStatus, 'REVIEW_REQUIRED')
  const incompleteRubric = { ...complete.findings[0]!, rubric: { ...complete.findings[0]!.rubric, UNIT: { judgment: 'QUALIFIED_CLAIM' as const, reason: '' } } }
  const noReason = validateScenarioEconomicReviewReceipt(built, { ...complete, findings: [incompleteRubric, ...complete.findings.slice(1)] })
  assert.equal(noReason.reviewRecordStatus, 'REVIEW_REQUIRED')
  const extraRubric = { ...complete.findings[0]!, rubric: { ...complete.findings[0]!.rubric, INVENTED_DIMENSION: { judgment: 'QUALIFIED_CLAIM', reason: 'Not part of the frozen rubric.' } } as ScenarioEconomicReviewFinding['rubric'] }
  assert.equal(validateScenarioEconomicReviewReceipt(built, { ...complete, findings: [extraRubric, ...complete.findings.slice(1)] }).reviewRecordStatus, 'REVIEW_REQUIRED')
})

test('C12 historical extrema or unsupported EML causal prose remain unreviewed caller claims', () => {
  const base = fixture()
  const unsupportedMechanism = base.scenarioMethodInput.scenarioSet.proposals.map((item) => ({ ...item, mechanism: 'EML certification equals future revenue without an attributable causal chain.' }))
  const proposalBound = { ...base.buildInput, scenarioMethodInput: { ...base.scenarioMethodInput, scenarioSet: { ...base.scenarioMethodInput.scenarioSet, proposals: unsupportedMechanism } }, bridges: base.bridges.map((pair) => ({
    input: { ...pair.input, calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, mechanism: 'EML certification equals future revenue without an attributable causal chain.' })) },
    result: calculateEconomicBridge({ ...pair.input, calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, mechanism: 'EML certification equals future revenue without an attributable causal chain.' })) }),
  })) }
  const unsupported = buildScenarioEconomicReviewPacket(proposalBound)
  assert.equal(unsupported.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  const result = validateScenarioEconomicReviewReceipt(unsupported, { ...receiptFor(unsupported), decisionClaim: 'ACCEPT_CLAIM' })
  assert.equal(result.reviewRecordStatus, 'REVIEW_REQUIRED'); assert.equal(result.qualificationGranted, false)
  assert.ok(unsupported.packet?.cases[0]?.diagnostics.some((item) => item.code === 'REVIEW_REQUIRED'))
  const historic = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: base.bridges.map((pair) => {
    const input = { ...pair.input, calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, calibration: { ...item.calibration!, category: 'HISTORICAL_OR_INDUSTRY_ENVELOPE' as const } })) }
    return { input, result: calculateEconomicBridge(input) }
  }) })
  assert.equal(historic.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  assert.ok(historic.packet?.cases[0]?.diagnostics.some((item) => item.code === 'HISTORICAL_ENVELOPE_NOT_CALIBRATION'))
  assert.equal(validateScenarioEconomicReviewReceipt(historic, receiptFor(historic)).reviewRecordStatus, 'REVIEW_REQUIRED')
})

test('C13 object keys and declared unordered proposal/ref traversals are stable; semantic case order is rejected', () => {
  const base = fixture()
  const proposalsReordered = [...base.scenarioMethodInput.scenarioSet.proposals].reverse()
  const inputReordered = {
    ...base.buildInput,
    scenarioMethodInput: { ...base.scenarioMethodInput, scenarioSet: { ...base.scenarioMethodInput.scenarioSet, proposals: proposalsReordered } },
    bridges: base.bridges.map((pair) => {
      const input = {
        ...pair.input,
        calibrationProposals: [...pair.input.calibrationProposals].map((item) => ({ ...item, calibration: { ...item.calibration!, evidenceRefs: [...item.calibration!.evidenceRefs].reverse() } })).reverse(),
        fcff: { ...pair.input.fcff, excludedOperatingCapitalIds: [...pair.input.fcff.excludedOperatingCapitalIds].reverse(), nwcStart: [...pair.input.fcff.nwcStart].reverse() },
      }
      return { input, result: calculateEconomicBridge(input) }
    }),
  }
  const normalized = buildScenarioEconomicReviewPacket(inputReordered)
  assert.equal(normalized.economicReviewPacketHash, base.packet.economicReviewPacketHash)
  const reverseKeys = (value: unknown): unknown => Array.isArray(value) ? value.map(reverseKeys) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)])) : value
  const keyOrder = buildScenarioEconomicReviewPacket(reverseKeys(base.buildInput) as ScenarioEconomicReviewPacketBuildInput)
  assert.equal(keyOrder.economicReviewPacketHash, base.packet.economicReviewPacketHash)
  const semanticOrder = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: [...base.bridges].reverse() })
  assert.equal(semanticOrder.packetStatus, 'UNAVAILABLE')
})

test('C14 malformed null, non-finite, invalid-period and cyclic inputs fail closed without throwing', () => {
  assert.equal(buildScenarioEconomicReviewPacket(null as unknown as ScenarioEconomicReviewPacketBuildInput).packetStatus, 'UNAVAILABLE')
  const base = fixture()
  const nonFinite = base.bridges.map((pair, index) => index === 0
    ? { input: { ...pair.input, fcff: { ...pair.input.fcff, unleveredEbit: { ...pair.input.fcff.unleveredEbit, value: { status: 'KNOWN', value: Number.NaN, evidenceRefs: ['x'] } } } } as EconomicBridgeInput, result: pair.result }
    : pair)
  assert.equal(buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: nonFinite }).packetStatus, 'UNAVAILABLE')
  const invalidDate = base.bridges.map((pair, index) => index === 0 ? { input: { ...pair.input, horizon: { ...pair.input.horizon, periodEnd: '2028-02-30' } }, result: calculateEconomicBridge({ ...pair.input, horizon: { ...pair.input.horizon, periodEnd: '2028-02-30' } }) } : pair)
  assert.equal(buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: invalidDate }).packetStatus, 'UNAVAILABLE')
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  const malformed = buildScenarioEconomicReviewPacket({ ...base.buildInput, scenarioMethodInput: cyclic as unknown as ScenarioMethodContractInput })
  assert.equal(malformed.packetStatus, 'UNAVAILABLE')
  const cycleReceipt = receiptFor(base.packet) as unknown as Record<string, unknown>; cycleReceipt.loop = cycleReceipt
  assert.equal(validateScenarioEconomicReviewReceipt(base.packet, cycleReceipt as unknown as ScenarioEconomicReviewReceipt).reviewRecordStatus, 'UNAVAILABLE')
})

test('C15 receipt replay is deterministic and validation never mutates packet, receipt or frozen source objects', () => {
  const base = fixture(), receipt = receiptFor(base.packet)
  const packetBefore = structuredClone(base.packet), receiptBefore = structuredClone(receipt), inputsBefore = structuredClone(base.buildInput)
  const first = validateScenarioEconomicReviewReceipt(base.packet, receipt)
  const replay = validateScenarioEconomicReviewReceipt(base.packet, receipt)
  assert.deepEqual(first, replay)
  assert.deepEqual(base.packet, packetBefore); assert.deepEqual(receipt, receiptBefore); assert.deepEqual(base.buildInput, inputsBefore)
})

test('C16 known synthetic FCFF arithmetic remains separate from reviewer, rights, PIT and publication qualification', () => {
  const base = fixture(), packet = base.packet.packet
  assert.ok(packet)
  assert.equal(packet.cases[1]?.components.fcff?.value, 19.5)
  const assessment = validateScenarioEconomicReviewReceipt(base.packet, receiptFor(base.packet))
  assert.equal(assessment.reviewRecordStatus, 'REVIEW_REQUIRED')
  assert.equal(assessment.qualificationGranted, false); assert.equal(assessment.reportEligible, false)
  assert.equal(packet.dispatchAuthorized, false); assert.equal(packet.phase1MethodStatus, 'REVIEW_REQUIRED')
  assert.equal(packet.observations[0]?.sourceAndRightsClaimsTrusted, false)
})

test('P1-01 one driver with one economic scope is reviewable and remains unqualified', () => {
  const built = fixture().packet
  assert.equal(built.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  assert.deepEqual(built.packet?.cases.map((item) => item.scopeBindings[0]?.relationshipStatus), ['FIXTURE_SCOPE_MATCH', 'FIXTURE_SCOPE_MATCH', 'FIXTURE_SCOPE_MATCH'])
  assert.equal(built.packet?.cases[1]?.scopeBindings[0]?.calibrationEconomicScope, 'fictional operations')
  assert.equal(built.dispatchAuthorized, false); assert.equal(built.reportEligible, false)
  assert.equal(validateScenarioEconomicReviewReceipt(built, receiptFor(built)).qualificationGranted, false)
})

test('P1-02 calibration scope alone fails at the explicit cross-layer scope gate', () => {
  const base = fixture()
  const bridges = base.bridges.map((pair, index) => {
    if (index !== 1) return pair
    const input = { ...pair.input, calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, calibration: { ...item.calibration!, economicScope: 'fictional product line B' } })) }
    const result = calculateEconomicBridge(input)
    assert.equal(result.status, 'STRUCTURALLY_VALID_FIXTURE_ONLY', 'bridge arithmetic remains independently valid')
    return { input, result }
  })
  assert.equal(validateScenarioMethodContract(base.scenarioMethodInput).structuralStatus, 'STRUCTURALLY_VALID')
  const rejected = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges })
  assert.equal(rejected.packetStatus, 'UNAVAILABLE')
  assert.ok(rejected.diagnostics.some((item) => item.code === 'CROSS_BINDING_MISMATCH' && item.subjectId === 'BASE.operating-cash.inputObservationRefs.obs-operating-cash' && item.reason.includes('fictional operations') && item.reason.includes('fictional product line B')))
})

test('P1-03 changing calibration and bridge numeric scopes together cannot bypass the Phase 1 observation scope', () => {
  const base = fixture()
  const bridges = base.bridges.map((pair, index) => {
    if (index !== 1) return pair
    const rewrite = <T extends { economicScope: string }>(item: T): T => ({ ...item, economicScope: 'fictional product line B' })
    const input = {
      ...pair.input,
      revenue: { ...pair.input.revenue, lines: pair.input.revenue.lines.map(rewrite), reportedConsolidatedRevenue: rewrite(pair.input.revenue.reportedConsolidatedRevenue), adjustments: pair.input.revenue.adjustments.map((item) => ({ ...item, signedAmount: rewrite(item.signedAmount) })) },
      profit: { ...pair.input.profit, cogs: rewrite(pair.input.profit.cogs), operatingExpenses: pair.input.profit.operatingExpenses.map(rewrite), otherOperatingIncome: pair.input.profit.otherOperatingIncome.map(rewrite), signedNetFinanceItems: rewrite(pair.input.profit.signedNetFinanceItems), signedNonOperatingItems: rewrite(pair.input.profit.signedNonOperatingItems), incomeTaxExpense: rewrite(pair.input.profit.incomeTaxExpense), profitAttributableToNci: rewrite(pair.input.profit.profitAttributableToNci), ebit: rewrite(pair.input.profit.ebit) },
      fcff: { ...pair.input.fcff, unleveredEbit: rewrite(pair.input.fcff.unleveredEbit), taxRate: rewrite(pair.input.fcff.taxRate), da: rewrite(pair.input.fcff.da), capex: rewrite(pair.input.fcff.capex), nwcStart: pair.input.fcff.nwcStart.map(rewrite), nwcEnd: pair.input.fcff.nwcEnd.map(rewrite) },
      calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, calibration: { ...item.calibration!, economicScope: 'fictional product line B' } })),
    }
    const result = calculateEconomicBridge(input)
    assert.equal(result.status, 'STRUCTURALLY_VALID_FIXTURE_ONLY', 'all bridge amounts were consistently re-scoped')
    return { input, result }
  })
  const rejected = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges })
  assert.equal(rejected.packetStatus, 'UNAVAILABLE')
  assert.ok(rejected.diagnostics.some((item) => item.code === 'CROSS_BINDING_MISMATCH' && item.subjectId.includes('BASE.operating-cash') && item.reason.includes('observation=fictional operations') && item.reason.includes('calibration=fictional product line B')))
})

test('P1-04 a re-frozen Phase 1 observation with changed scope conflicts with unchanged calibration', () => {
  const base = fixture()
  const changed = rebindMethodInput({ ...base.scenarioMethodInput, observations: base.scenarioMethodInput.observations.map((item) => ({ ...item, economicScope: 'fictional product line B' } as EconomicDriverObservation)) })
  assert.equal(validateScenarioMethodContract(changed).structuralStatus, 'STRUCTURALLY_VALID')
  const rejected = buildScenarioEconomicReviewPacket({ ...base.buildInput, scenarioMethodInput: changed })
  assert.equal(rejected.packetStatus, 'UNAVAILABLE')
  assert.ok(rejected.diagnostics.some((item) => item.code === 'CROSS_BINDING_MISMATCH' && item.subjectId.includes('operating-cash') && item.reason.includes('observation=fictional product line B') && item.reason.includes('calibration=fictional operations')))
})

test('P1-05 same driver with a different scope in one scenario is unavailable with localized diagnosis', () => {
  const base = fixture()
  const bridges = base.bridges.map((pair, index) => index === 0 ? pair : index === 1 ? (() => {
    const input = { ...pair.input, calibrationProposals: pair.input.calibrationProposals.map((item) => ({ ...item, calibration: { ...item.calibration!, economicScope: 'fictional product line B' } })) }
    return { input, result: calculateEconomicBridge(input) }
  })() : pair)
  const rejected = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges })
  assert.equal(rejected.packetStatus, 'UNAVAILABLE')
  assert.ok(rejected.diagnostics.some((item) => item.code === 'CROSS_BINDING_MISMATCH' && item.subjectId === 'BASE.operating-cash.calibration.economicScope'))
})

test('P1-06 distinct drivers may retain distinct scopes; driver-to-bridge ownership remains explicitly unverified', () => {
  const base = fixture()
  const secondObservation = { ...base.scenarioMethodInput.observations[0]!, observationId: 'obs-other-driver', driverId: 'other-driver', economicScope: 'fictional other product line' } as EconomicDriverObservation
  const proposals = [...base.scenarioMethodInput.scenarioSet.proposals, ...cases.map((scenario) => ({
    ...assumption(scenario, `${scenario.toLowerCase()}-other-author`), proposalId: `proposal-${scenario.toLowerCase()}-other-driver`, driverId: 'other-driver',
    calibrationRefs: ['obs-other-driver'], inputObservationRefs: ['obs-other-driver'], counterEvidenceRefs: ['obs-operating-cash'],
  }))]
  const scenarioMethodInput = rebindMethodInput({ ...base.scenarioMethodInput,
    observations: [...base.scenarioMethodInput.observations, secondObservation],
    scenarioSet: { ...base.scenarioMethodInput.scenarioSet, requiredDriverIds: ['operating-cash', 'other-driver'], proposals,
      scenarios: base.scenarioMethodInput.scenarioSet.scenarios.map((item) => ({ ...item, requiredDriverIds: ['operating-cash', 'other-driver'], driverObservationRefs: ['obs-operating-cash', 'obs-other-driver'], driverProposalRefs: [...item.driverProposalRefs, `proposal-${item.scenario.toLowerCase()}-other-driver`] })) as unknown as ScenarioMethodContractInput['scenarioSet']['scenarios'] },
  })
  const bridges = base.bridges.map((pair) => {
    const source = pair.input.calibrationProposals[0]!
    const other = { ...source, driverId: 'other-driver', author: `${pair.input.horizon.scenario.toLowerCase()}-other-author`, calibration: { ...source.calibration!, economicScope: 'fictional other product line' } }
    const input = { ...pair.input, calibrationProposals: [...pair.input.calibrationProposals, other] }
    return { input, result: calculateEconomicBridge(input) }
  })
  const built = buildScenarioEconomicReviewPacket({ ...base.buildInput, scenarioMethodInput, bridges })
  assert.equal(built.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY', JSON.stringify(built.diagnostics))
  assert.equal(built.packet?.cases[0]?.scopeBindings.find((item) => item.driverId === 'operating-cash')?.calibrationEconomicScope, 'fictional operations')
  assert.equal(built.packet?.cases[0]?.scopeBindings.find((item) => item.driverId === 'other-driver')?.calibrationEconomicScope, 'fictional other product line')
  assert.ok(built.packet?.adapterLimits.some((item) => item.includes('no explicit driverId-to-revenue-line/scalar ownership refs')))
})

test('P2-01 disclosed segment snapshot exposes the complete route, values, refs, residual and adjustments', () => {
  const packetCase = fixture().packet.packet?.cases[1]!
  const snapshot = packetCase.economicInputSnapshot
  assert.equal(snapshot.revenue.selectedRoute, 'DISCLOSED_SEGMENT_REVENUE')
  assert.equal(numericValue(snapshot.revenue.lines[0]!.amount), 100)
  assert.deepEqual(snapshot.revenue.lines[0]?.evidenceRefs, ['synthetic-revenue-ref'])
  assert.equal(numericValue(snapshot.revenue.reportedConsolidatedRevenue.value), 100)
  assert.equal(packetCase.residual.value, 0)
  assert.deepEqual(snapshot.revenue.adjustments, [])
})

test('P2-02 volume times realized net ASP snapshot preserves algebraic units and non-additive rows', () => {
  const base = fixture()
  const bridges = base.bridges.map((pair) => {
    const volume = scalar('recognized-volume', 10, { dimension: 'COUNT', unit: 'unit', currency: null, flowOrStock: 'COUNT', mappingRole: 'RECOGNIZED_REVENUE_VOLUME' })
    const asp = scalar('realized-net-asp', 10, { dimension: 'CURRENCY_PER_UNIT', unit: 'CNY/unit', flowOrStock: 'FLOW', mappingRole: 'REALIZED_NET_ASP' })
    const line = { ...pair.input.revenue.lines[0]!, disposition: 'CROSS_CHECK_ONLY' as const }
    const input = { ...pair.input, revenue: { ...pair.input.revenue, selectedRoute: 'RECOGNIZED_VOLUME_TIMES_REALIZED_NET_ASP' as const, lines: [line], volume, realizedNetAsp: asp } }
    return { input, result: calculateEconomicBridge(input) }
  })
  const built = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges })
  assert.equal(built.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY', JSON.stringify(built.diagnostics))
  const revenue = built.packet?.cases[1]?.economicInputSnapshot.revenue
  assert.equal(revenue?.volume?.dimension, 'COUNT'); assert.equal(revenue?.volume?.unit, 'unit')
  assert.equal(revenue?.realizedNetAsp?.dimension, 'CURRENCY_PER_UNIT'); assert.equal(revenue?.realizedNetAsp?.unit, 'CNY/unit')
  assert.equal(revenue?.selectedRoute, 'RECOGNIZED_VOLUME_TIMES_REALIZED_NET_ASP')
  assert.equal(revenue?.lines[0]?.disposition, 'CROSS_CHECK_ONLY')
})

test('P2-03 revenue content changes are visible, hash-bound, and stale the previous receipt', () => {
  const base = fixture(), pair = base.bridges[1]!
  const input = { ...pair.input, revenue: { ...pair.input.revenue, reportedConsolidatedRevenue: { ...pair.input.revenue.reportedConsolidatedRevenue, value: known(105) } } }
  const changed = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: [base.bridges[0]!, { input, result: calculateEconomicBridge(input) }, base.bridges[2]!] })
  assert.equal(changed.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  assert.equal(numericValue(changed.packet!.cases[1]!.economicInputSnapshot.revenue.reportedConsolidatedRevenue.value), 105)
  assert.notEqual(changed.economicReviewPacketHash, base.packet.economicReviewPacketHash)
  assert.equal(validateScenarioEconomicReviewReceipt(changed, receiptFor(base.packet)).reviewRecordStatus, 'STALE_REVIEW')
})

test('P2-04 profit, tax and NCI amounts and sign conventions remain inspectable and hash-bound', () => {
  const base = fixture(), pair = base.bridges[1]!
  const input = { ...pair.input, profit: { ...pair.input.profit,
    cogs: { ...pair.input.profit.cogs, value: known(61) }, incomeTaxExpense: { ...pair.input.profit.incomeTaxExpense, value: known(6) },
    profitAttributableToNci: { ...pair.input.profit.profitAttributableToNci, value: known(-3) },
  } }
  const changed = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: [base.bridges[0]!, { input, result: calculateEconomicBridge(input) }, base.bridges[2]!] })
  assert.equal(changed.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  const profit = changed.packet?.cases[1]?.economicInputSnapshot.profit
  assert.equal(numericValue(profit!.cogs.value), 61); assert.equal(profit?.cogs.signConvention, 'SIGNED_AMOUNT')
  assert.equal(numericValue(profit!.incomeTaxExpense.value), 6); assert.equal(profit?.incomeTaxExpense.signConvention, 'POSITIVE_EXPENSE')
  assert.equal(numericValue(profit!.profitAttributableToNci.value), -3); assert.equal(profit?.nciBasis, 'CONSOLIDATED_TO_PARENT')
  assert.notEqual(changed.economicReviewPacketHash, base.packet.economicReviewPacketHash)
})

test('P2-05 FCFF CapEx and paired NWC balances remain visible and independently hash-bound', () => {
  const base = fixture(), pair = base.bridges[1]!
  const input = { ...pair.input, fcff: { ...pair.input.fcff, capex: { ...pair.input.fcff.capex, value: known(7) }, nwcEnd: pair.input.fcff.nwcEnd.map((item) => item.accountId === 'inventory' ? { ...item, value: known(13) } : item) } }
  const changed = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges: [base.bridges[0]!, { input, result: calculateEconomicBridge(input) }, base.bridges[2]!] })
  assert.equal(changed.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  const fcff = changed.packet?.cases[1]?.economicInputSnapshot.fcff
  assert.equal(numericValue(fcff!.capex.value), 7); assert.equal(numericValue(fcff!.nwcEnd.find((item) => item.accountId === 'inventory')!.value), 13)
  assert.equal(fcff?.nwcComplete, true); assert.equal(fcff?.cfo, null); assert.equal(fcff?.purchasesOfLongTermAssets, null)
  assert.notEqual(changed.economicReviewPacketHash, base.packet.economicReviewPacketHash)
})

test('P2-06 source, rights, version and time claims are visible, untrusted and hash-bound', () => {
  const base = fixture()
  const bridges = base.bridges.map((pair) => {
    const input = { ...pair.input, rightsVersionClaim: 'changed fixture rights claim', valueVersionClaim: 'changed fixture value claim', sourceTimeClaims: { ...pair.input.sourceTimeClaims, sourcePublishedAt: '2026-06-29T00:00:00Z' } }
    return { input, result: calculateEconomicBridge(input) }
  })
  const changed = buildScenarioEconomicReviewPacket({ ...base.buildInput, bridges })
  assert.equal(changed.packetStatus, 'STRUCTURALLY_PREPARED_FIXTURE_ONLY')
  const snapshot = changed.packet?.cases[1]?.economicInputSnapshot
  assert.equal(snapshot?.rightsVersionClaim, 'changed fixture rights claim'); assert.equal(snapshot?.valueVersionClaim, 'changed fixture value claim')
  assert.equal(snapshot?.sourceTimeClaims.sourcePublishedAt, '2026-06-29T00:00:00Z')
  assert.notEqual(changed.economicReviewPacketHash, base.packet.economicReviewPacketHash)
  assert.equal(validateScenarioEconomicReviewReceipt(changed, receiptFor(base.packet)).reviewRecordStatus, 'STALE_REVIEW')
})

test('P2-07 mutating caller bridge input after build cannot mutate the frozen packet snapshot', () => {
  const base = fixture(), built = base.packet, frozen = structuredClone(built.packet?.cases[1]?.economicInputSnapshot)
  const mutable = base.bridges[1]!.input as unknown as { revenue: { lines: { amount: { value: number } }[] }; fcff: { nwcEnd: { value: { value: number } }[] }; calibrationProposals: { calibration: { lower: { value: number } } }[] }
  mutable.revenue.lines[0]!.amount.value = 999
  mutable.fcff.nwcEnd[0]!.value.value = 999
  mutable.calibrationProposals[0]!.calibration.lower.value = 999
  assert.deepEqual(built.packet?.cases[1]?.economicInputSnapshot, frozen)
  assert.equal(built.packet?.cases[1]?.calibrationProposals[0]?.calibration?.lower.status, 'KNOWN')
  assert.equal(numericValue(built.packet!.cases[1]!.calibrationProposals[0]!.calibration!.lower), 10)
  assert.equal(validateScenarioEconomicReviewReceipt(built, receiptFor(built)).reviewRecordStatus, 'REVIEW_REQUIRED')
})

test('P2-08 tampering with a reviewer-visible snapshot while retaining its old packet hash is unavailable', () => {
  const built = fixture().packet, receipt = receiptFor(built)
  const packet = built.packet!
  const tampered = { ...built, packet: { ...packet, cases: packet.cases.map((item, index) => index === 1 ? { ...item, economicInputSnapshot: { ...item.economicInputSnapshot, revenue: { ...item.economicInputSnapshot.revenue, reportedConsolidatedRevenue: { ...item.economicInputSnapshot.revenue.reportedConsolidatedRevenue, value: known(999) } } } } : item) as unknown as typeof packet.cases } }
  const assessment = validateScenarioEconomicReviewReceipt(tampered, receipt)
  assert.equal(assessment.reviewRecordStatus, 'UNAVAILABLE')
  assert.ok(assessment.diagnostics.some((item) => item.code === 'HASH_UNAVAILABLE'))
})
