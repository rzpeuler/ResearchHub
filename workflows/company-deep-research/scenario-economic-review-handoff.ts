/** Private fixture-only freeze and receipt checks. No I/O, reviewer, or qualification authority. */
import {
  hashCanonicalScenarioValue,
  validateScenarioMethodContract,
} from './scenario-method-validation.ts'
import { calculateEconomicBridge } from './scenario-economic-bridge.ts'
import type {
  EconomicBridgeComponent,
  EconomicBridgeInput,
  EconomicBridgeResult,
  EconomicDriverObservation,
  ScenarioEconomicReviewAssessment,
  ScenarioEconomicReviewCasePacket,
  ScenarioEconomicReviewComponentSummary,
  ScenarioEconomicReviewDiagnostic,
  ScenarioEconomicReviewObservationSummary,
  ScenarioEconomicReviewPacket,
  ScenarioEconomicReviewPacketBuildInput,
  ScenarioEconomicReviewPacketBuildResult,
  ScenarioEconomicReviewProposalSummary,
  ScenarioEconomicReviewReceipt,
  ScenarioEconomicReviewRubricDimension,
  ScenarioMethodContractInput,
  ScenarioMethodResult,
  Sha256,
} from './scenario-method-contracts.ts'

const SCENARIOS = ['BEAR', 'BASE', 'BULL'] as const
const RUBRIC_DIMENSIONS: readonly ScenarioEconomicReviewRubricDimension[] = [
  'ECONOMIC_CAUSALITY', 'EVIDENCE_RELEVANCE', 'CALIBRATION', 'COUNTEREVIDENCE',
  'FALSIFIABLE_TRIGGER', 'RESIDUAL', 'PERIOD', 'UNIT',
]
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
type AnyRecord = Record<string, unknown>
const isRecord = (value: unknown): value is AnyRecord => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const sortedUnique = (values: readonly string[]): boolean => values.every(nonEmpty) && new Set(values).size === values.length
const tryHash = (value: unknown): Sha256 | undefined => {
  try { return hashCanonicalScenarioValue(value) } catch { return undefined }
}

function diagnostic(code: ScenarioEconomicReviewDiagnostic['code'], subjectId: string, reason: string): ScenarioEconomicReviewDiagnostic {
  return { code, subjectId, reason }
}

function unavailableBuild(
  diagnostics: readonly ScenarioEconomicReviewDiagnostic[],
  phase1Result: ScenarioMethodResult | null = null,
): ScenarioEconomicReviewPacketBuildResult {
  return {
    packetStatus: 'UNAVAILABLE', packet: null, economicReviewPacketHash: null, phase1Result,
    diagnostics: [...diagnostics].sort((a, b) => compare(a.code, b.code) || compare(a.subjectId, b.subjectId) || compare(a.reason, b.reason)),
    dispatchAuthorized: false, reportEligible: false, reviewRequired: true,
  }
}

function summarizeComponent(component: EconomicBridgeComponent): ScenarioEconomicReviewComponentSummary {
  return {
    status: component.status,
    ...(typeof component.value === 'number' && Number.isFinite(component.value) ? { value: component.value } : {}),
    formulaVersion: component.formulaVersion,
    lineageIds: [...component.lineageIds],
    ...(component.reason ? { reason: component.reason } : {}),
  }
}

function summarizeObservation(
  observation: EconomicDriverObservation,
  phase1: ScenarioMethodResult,
): ScenarioEconomicReviewObservationSummary {
  const assessment = phase1.observationAssessments.find((item) => item.observationId === observation.observationId)
  const fact = observation.kind === 'FACT' ? observation : undefined
  const proof = fact?.valueVersionProof ?? undefined
  const missingFields = observation.kind === 'MISSING' ? [...observation.missingFields].sort(compare) : []
  const rejectionReasons = observation.kind === 'MISSING' ? [...observation.rejectionReasons].sort(compare) : []
  return {
    observationId: observation.observationId,
    driverId: observation.driverId,
    originKind: observation.originKind,
    atomicSkillOwner: observation.atomicSkillOwner,
    metricId: observation.metricId,
    economicScope: observation.economicScope,
    financialScope: observation.financialScope,
    periodStart: observation.periodStart,
    periodEnd: observation.periodEnd,
    periodBasis: observation.periodBasis,
    fiscalYear: observation.fiscalYear,
    flowOrStock: observation.flowOrStock,
    unit: observation.unit,
    currency: observation.currency,
    shareBasis: observation.shareBasis,
    observedAt: observation.observedAt,
    sourcePublishedAt: observation.sourcePublishedAt,
    retrievedAt: observation.retrievedAt,
    analysisAsOf: observation.analysisAsOf,
    asOfMode: observation.asOfMode,
    evidenceManifestHash: observation.evidenceManifestHash,
    claimedValueVersionStatus: observation.claimedValueVersionStatus,
    assessedValueVersionStatus: assessment?.valueVersionStatus ?? 'UNAVAILABLE',
    claimedEligibility: observation.claimedEligibility,
    assessedEligibility: assessment?.eligibility ?? 'UNAVAILABLE',
    sourceConflicts: [...observation.sourceConflicts].sort(compare),
    missingFields,
    rejectionReasons,
    sourceCandidateId: fact?.evidence.sourceCandidateId ?? null,
    sourceLocation: fact?.evidence.sourceLocation ?? null,
    immutableSourceContentHash: fact?.evidence.immutableSourceContentHash ?? null,
    rawValueToken: fact?.evidence.rawValueToken ?? null,
    normalizedValue: fact ? fact.evidence.normalizedValue : null,
    valueVersionIdClaim: proof?.valueVersionId ?? null,
    valueVersionAvailableAtClaim: proof?.valueVersionAvailableAt ?? null,
    sourcePublishedAtClaim: proof?.sourcePublishedAt ?? observation.sourcePublishedAt,
    rightsDecisionClaim: fact?.rights.decision ?? null,
    rightsEvidenceHashClaim: fact?.rights.evidenceHash ?? null,
    rightsEvidenceTextHashClaim: fact?.rights.evidenceTextHash ?? null,
    valueVersionProofMethodClaim: proof?.method ?? null,
    revisionStatusClaim: proof?.revisionStatus ?? null,
    snapshotCapturedAtClaim: proof?.method === 'OFFICIAL_PUBLISHED_DOCUMENT' ? null : proof?.snapshotCapturedAt ?? null,
    snapshotSealedAtClaim: proof?.method === 'OFFICIAL_PUBLISHED_DOCUMENT' ? null : proof?.snapshotSealedAt ?? null,
    inferenceInputRefs: observation.kind === 'INFERENCE' ? [...observation.inferenceInputRefs].sort(compare) : [],
    derivationOperation: observation.kind === 'DERIVED' ? observation.derivation.operation : null,
    derivationPurpose: observation.kind === 'DERIVED' ? observation.derivation.purpose : null,
    derivationInputObservationIds: observation.kind === 'DERIVED' ? [...observation.derivation.inputObservationIds] : [],
    derivationResult: observation.kind === 'DERIVED' ? observation.derivation.result : null,
    derivationFormulaVersion: observation.kind === 'DERIVED' ? observation.derivation.formulaVersion : null,
    sourceAndRightsClaimsTrusted: false,
  }
}

function packetHash(packet: ScenarioEconomicReviewPacket): Sha256 | undefined {
  const bridgeBindings = packet.cases.map((item) => ({ scenario: item.scenario, inputHash: item.inputHash, bridgeHash: item.bridgeHash }))
  return tryHash({
    schema: 'scenario-economic-review-handoff-hash-v1',
    phase1Hashes: packet.phase1Hashes,
    bridgeBindings,
    payload: packet,
  })
}

function canonicalEconomicInput(input: EconomicBridgeInput): EconomicBridgeInput {
  const byId = <T extends { readonly sourceId?: string; readonly accountId?: string; readonly adjustmentId?: string }>(a: T, b: T): number =>
    compare(a.adjustmentId ?? a.accountId ?? a.sourceId ?? '', b.adjustmentId ?? b.accountId ?? b.sourceId ?? '')
  return {
    ...input,
    revenue: {
      ...input.revenue,
      lines: [...input.revenue.lines].map((line) => ({ ...line, evidenceRefs: [...line.evidenceRefs].sort(compare), adjustmentRefs: [...line.adjustmentRefs].sort(compare) })).sort((a, b) => compare(a.lineId, b.lineId)),
      adjustments: [...input.revenue.adjustments].map((item) => ({ ...item, evidenceRefs: [...item.evidenceRefs].sort(compare) })).sort((a, b) => compare(a.adjustmentId, b.adjustmentId)),
    },
    profit: {
      ...input.profit,
      operatingExpenses: [...input.profit.operatingExpenses].sort(byId),
      otherOperatingIncome: [...input.profit.otherOperatingIncome].sort(byId),
      nonRecurringItems: [...input.profit.nonRecurringItems].sort((a, b) => compare(a.adjustmentId, b.adjustmentId)),
    },
    fcff: {
      ...input.fcff,
      nwcStart: [...input.fcff.nwcStart].sort(byId), nwcEnd: [...input.fcff.nwcEnd].sort(byId),
      excludedOperatingCapitalIds: [...input.fcff.excludedOperatingCapitalIds].sort(compare),
    },
    calibrationProposals: [...input.calibrationProposals].map((item) => ({
      ...item, calibration: item.calibration ? { ...item.calibration, evidenceRefs: [...item.calibration.evidenceRefs].sort(compare) } : null,
    })).sort((a, b) => compare(`${a.scenario}|${a.driverId}`, `${b.scenario}|${b.driverId}`)),
  }
}

function exactStringSet(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort(compare).every((value, index) => value === [...right].sort(compare)[index]) && left.length === right.length
}

function buildUnsafe(input: ScenarioEconomicReviewPacketBuildInput): ScenarioEconomicReviewPacketBuildResult {
  const errors: ScenarioEconomicReviewDiagnostic[] = []
  if (!isRecord(input) || input.mode !== 'FIXTURE_ONLY' || !nonEmpty(input.rubricVersion) || !nonEmpty(input.reviewContractVersion) || !isRecord(input.scenarioMethodInput) || !Array.isArray(input.bridges)) {
    return unavailableBuild([diagnostic('STRUCTURAL_INVALID', 'input', 'A plain FIXTURE_ONLY handoff input with method contract, bridges, rubric and review-contract versions is required.')])
  }
  const methodInput = input.scenarioMethodInput
  const phase1 = validateScenarioMethodContract(methodInput)
  if (phase1.structuralStatus !== 'STRUCTURALLY_VALID' || phase1.reportEligible !== false) {
    errors.push(diagnostic('STRUCTURAL_INVALID', 'phase1', `Phase 1 is not structurally reviewable (structuralStatus=${phase1.structuralStatus}, methodStatus=${phase1.methodStatus}); source/method gaps remain represented as unavailable claims.`))
  }
  const required = methodInput.scenarioSet.requiredDriverIds
  if (!Array.isArray(required) || required.length === 0 || !sortedUnique(required)) errors.push(diagnostic('MISSING_REQUIRED_DRIVER', 'requiredDriverIds', 'Required driver IDs must be a non-empty unique set.'))
  if (input.bridges.length !== 3) errors.push(diagnostic('STRUCTURAL_INVALID', 'bridges', 'Exactly three bridges in fixed BEAR, BASE, BULL order are required.'))
  const companyIds = [...new Set(methodInput.scenarioSet.proposals.map((proposal) => proposal.companySymbol))]
  if (companyIds.length !== 1 || !nonEmpty(companyIds[0])) errors.push(diagnostic('CROSS_BINDING_MISMATCH', 'companySymbol', 'All required driver proposals must belong to one non-empty company identity.'))
  const proposalIds = new Set<string>()
  const proposalByCaseDriver = new Map<string, ScenarioMethodContractInput['scenarioSet']['proposals'][number]>()
  for (const proposal of methodInput.scenarioSet.proposals) {
    const key = `${proposal.scenario}|${proposal.driverId}`
    if (!nonEmpty(proposal.proposalId) || proposalIds.has(proposal.proposalId) || proposalByCaseDriver.has(key)) errors.push(diagnostic('STRUCTURAL_INVALID', key, 'Proposal IDs and scenario/driver pairs must each be unique.'))
    proposalIds.add(proposal.proposalId)
    proposalByCaseDriver.set(key, proposal)
  }
  for (const scenario of SCENARIOS) {
    for (const driverId of required) {
      if (!proposalByCaseDriver.has(`${scenario}|${driverId}`)) errors.push(diagnostic('MISSING_REQUIRED_DRIVER', `${scenario}.${driverId}`, 'Every required driver needs exactly one explicit proposal; no adjacent case or default is substituted.'))
    }
  }

  const observationById = new Map(methodInput.observations.map((item) => [item.observationId, item]))
  const cases: ScenarioEconomicReviewCasePacket[] = []
  const bridgeIds = new Set<string>()
  const expectedCompany = companyIds[0]
  const commonFormula = input.bridges[0]?.input?.formulaVersion
  for (let index = 0; index < Math.min(input.bridges.length, 3); index++) {
    const rawPair = input.bridges[index]!
    const expectedScenario = SCENARIOS[index]!
    if (!isRecord(rawPair) || !isRecord(rawPair.input) || !isRecord(rawPair.result)) {
      errors.push(diagnostic('STRUCTURAL_INVALID', expectedScenario, 'Bridge input and caller result must be plain objects.'))
      continue
    }
    const pair = rawPair as { readonly input: EconomicBridgeInput; readonly result: EconomicBridgeResult }
    const bridgeInput = pair.input
    const frozenInput = canonicalEconomicInput(bridgeInput)
    const callerInputResult = calculateEconomicBridge(bridgeInput)
    const suppliedResultHash = tryHash(pair.result)
    const recalculatedResultHash = tryHash(callerInputResult)
    if (!suppliedResultHash || !recalculatedResultHash || suppliedResultHash !== recalculatedResultHash) errors.push(diagnostic('BRIDGE_RESULT_MISMATCH', expectedScenario, 'Caller bridge result differs from a fresh full-result deterministic calculation.'))
    if (bridgeInput.mode !== 'FIXTURE_ONLY' || bridgeInput.horizon.scenario !== expectedScenario || bridgeInput.companySymbol !== expectedCompany || bridgeInput.analysisAsOf !== methodInput.horizon.analysisAsOf || bridgeInput.horizon.periodStart !== methodInput.horizon.targetPeriodStart || bridgeInput.horizon.periodEnd !== methodInput.horizon.targetPeriodEnd || bridgeInput.horizon.periodBasis !== methodInput.horizon.targetPeriodBasis || bridgeInput.fcff.unleveredEbit.financialScope !== methodInput.horizon.financialScope || bridgeInput.fcff.unleveredEbit.currency !== methodInput.horizon.currency || !nonEmpty(bridgeInput.formulaVersion) || bridgeInput.formulaVersion !== commonFormula) {
      errors.push(diagnostic('CROSS_BINDING_MISMATCH', expectedScenario, 'Bridge company, scenario, asOf, horizon, FCFF scope/currency, or common formula does not match the frozen method horizon.'))
    }
    const bridgeId = bridgeInput.bridgeId
    if (!nonEmpty(bridgeId) || bridgeIds.has(bridgeId)) errors.push(diagnostic('STRUCTURAL_INVALID', expectedScenario, 'Bridge IDs must be non-empty and unique.'))
    bridgeIds.add(bridgeId)
    const recalculated = calculateEconomicBridge(frozenInput)
    if (recalculated.status !== 'STRUCTURALLY_VALID_FIXTURE_ONLY' || recalculated.reportEligible !== false || recalculated.assumptionReviewStatus !== 'REVIEW_REQUIRED') errors.push(diagnostic('MISSING_REQUIRED_DRIVER', expectedScenario, 'Unavailable economic bridge (including incomplete FCFF/NWC) cannot enter a prepared review packet.'))

    const economicByDriver = new Map<string, EconomicBridgeInput['calibrationProposals'][number]>()
    for (const economicProposal of frozenInput.calibrationProposals) {
      if (economicByDriver.has(economicProposal.driverId) || economicProposal.scenario !== expectedScenario) errors.push(diagnostic('STRUCTURAL_INVALID', `${expectedScenario}.${economicProposal.driverId}`, 'Economic calibration proposals must have unique driver IDs and match their case.'))
      economicByDriver.set(economicProposal.driverId, economicProposal)
    }
    if (!exactStringSet([...economicByDriver.keys()], required)) errors.push(diagnostic('MISSING_REQUIRED_DRIVER', expectedScenario, 'Economic calibration proposals must exactly cover the frozen required-driver set.'))
    const proposalSummaries: ScenarioEconomicReviewProposalSummary[] = []
    for (const driverId of [...required].sort(compare)) {
      const proposal = proposalByCaseDriver.get(`${expectedScenario}|${driverId}`)
      const economicProposal = economicByDriver.get(driverId)
      if (!proposal || !economicProposal) continue
      if (economicProposal.author !== proposal.authorId || economicProposal.proposedValue !== proposal.proposedValue || economicProposal.mechanism !== proposal.mechanism || economicProposal.trigger !== proposal.falsifiableTrigger || economicProposal.calibration?.unit !== proposal.unit || economicProposal.calibration?.currency !== proposal.currency || economicProposal.calibration?.financialScope !== proposal.financialScope || economicProposal.calibration?.periodBasis !== methodInput.horizon.targetPeriodBasis) {
        errors.push(diagnostic('CROSS_BINDING_MISMATCH', `${expectedScenario}.${driverId}`, 'Economic calibration author/value/mechanism/trigger/unit/currency/scope/basis does not bind to its Phase 1 proposal.'))
      }
      if (proposal.inputObservationRefs.some((ref) => !observationById.has(ref))) errors.push(diagnostic('MISSING_REQUIRED_DRIVER', `${expectedScenario}.${driverId}`, 'Proposal observation refs must resolve to frozen Phase 1 observations.'))
      proposalSummaries.push({
        proposalId: proposal.proposalId, driverId, authorId: proposal.authorId, originKind: proposal.originKind,
        proposalVersion: proposal.proposalVersion, proposedValue: proposal.proposedValue, unit: proposal.unit,
        currency: proposal.currency, financialScope: proposal.financialScope, mechanism: proposal.mechanism,
        calibrationRefs: [...proposal.calibrationRefs].sort(compare), counterEvidenceRefs: [...proposal.counterEvidenceRefs].sort(compare),
        falsifiableTrigger: proposal.falsifiableTrigger, inputObservationRefs: [...proposal.inputObservationRefs].sort(compare), economicSummary: economicProposal,
      })
    }
    const components: Record<string, ScenarioEconomicReviewComponentSummary> = {}
    for (const [name, component] of Object.entries(recalculated.components)) components[name] = summarizeComponent(component)
    const methodCase = methodInput.scenarioSet.scenarios[index]!
    cases.push({
      scenario: expectedScenario, bridgeId, inputHash: recalculated.inputHash, bridgeHash: recalculated.bridgeHash,
      formulaVersion: bridgeInput.formulaVersion, bridgeStatus: recalculated.status,
      driverProposalRefs: [...methodCase.driverProposalRefs].sort(compare), driverObservationRefs: [...methodCase.driverObservationRefs].sort(compare),
      residualPolicy: methodCase.residualPolicy, residualDescription: methodCase.residualDescription, components,
      diagnostics: [...recalculated.diagnostics], residual: summarizeComponent(recalculated.residual),
      cashFlowDifference: summarizeComponent(recalculated.cashFlowDifference),
      calibrationProposals: [...frozenInput.calibrationProposals],
      proposals: proposalSummaries, adjustments: [...methodInput.scenarioSet.scenarios[index]!.adjustments].sort((a, b) => compare(a.adjustmentId, b.adjustmentId)),
    })
  }
  if (cases.length !== 3 || cases.some((item, index) => item.scenario !== SCENARIOS[index])) errors.push(diagnostic('STRUCTURAL_INVALID', 'cases', 'Case order is semantic and must be exactly BEAR, BASE, BULL.'))
  if (errors.length) return unavailableBuild(errors, phase1)

  const authorIds = [...new Set(methodInput.scenarioSet.proposals.map((proposal) => proposal.authorId))].sort(compare)
  const authorSetHash = hashCanonicalScenarioValue({ schema: 'scenario-economic-review-authors-v1', authorIds })
  const observations = [...methodInput.observations]
    .sort((a, b) => compare(a.observationId, b.observationId))
    .map((observation) => summarizeObservation(observation, phase1))
  const packet: ScenarioEconomicReviewPacket = {
    schemaVersion: 'scenario-economic-review-packet-v1', mode: 'FIXTURE_ONLY',
    companySymbol: expectedCompany!, analysisAsOf: methodInput.horizon.analysisAsOf, asOfMode: methodInput.horizon.asOfMode,
    targetFiscalYear: methodInput.horizon.targetFiscalYear, targetPeriodStart: methodInput.horizon.targetPeriodStart,
    targetPeriodEnd: methodInput.horizon.targetPeriodEnd, targetPeriodBasis: methodInput.horizon.targetPeriodBasis,
    financialScope: methodInput.horizon.financialScope, currency: methodInput.horizon.currency, methodId: methodInput.horizon.methodId,
    methodVersion: methodInput.methodVersion, phase1RubricVersion: methodInput.rubricVersion,
    economicReviewRubricVersion: input.rubricVersion, reviewContractVersion: input.reviewContractVersion,
    phase1MethodStatus: phase1.methodStatus, phase1StructuralStatus: phase1.structuralStatus,
    phase1Diagnostics: [...phase1.diagnostics].sort((a, b) => compare(a.code, b.code) || compare(a.subjectId, b.subjectId) || compare(a.reason, b.reason)),
    phase1Hashes: { evidenceManifestHash: phase1.evidenceManifestHash, valueVersionProofSetHash: phase1.valueVersionProofSetHash, reviewPacketHash: phase1.reviewPacketHash },
    authorIds, authorSetHash, requiredDriverIds: [...required].sort(compare), observations,
    cases: cases as unknown as ScenarioEconomicReviewPacket['cases'],
    adapterLimits: ['EconomicBridgeInput has formulaVersion but no methodId or atomic-skill ownership field; no method identity is inferred from formulaVersion.'],
    dispatchAuthorized: false, reportEligible: false, reviewRequired: true,
  }
  const frozenHash = packetHash(packet)
  if (!frozenHash) return unavailableBuild([diagnostic('HASH_UNAVAILABLE', 'economicReviewPacketHash', 'Canonical packet hash could not be computed.')], phase1)
  return {
    packetStatus: 'STRUCTURALLY_PREPARED_FIXTURE_ONLY', packet, economicReviewPacketHash: frozenHash, phase1Result: phase1,
    diagnostics: [diagnostic('REVIEW_REQUIRED', 'reviewer', 'Packet is frozen for a future independent reviewer; no reviewer identity, semantic review, qualification, dispatch, or publication authority exists.')],
    dispatchAuthorized: false, reportEligible: false, reviewRequired: true,
  }
}

/** Builds a canonical frozen packet. All malformed runtime shapes fail closed. */
export function buildScenarioEconomicReviewPacket(input: ScenarioEconomicReviewPacketBuildInput): ScenarioEconomicReviewPacketBuildResult {
  try { return buildUnsafe(input) }
  catch { return unavailableBuild([diagnostic('STRUCTURAL_INVALID', 'input', 'Malformed or cyclic handoff input rejected without throwing.')]) }
}

function makeAssessment(
  status: ScenarioEconomicReviewAssessment['reviewRecordStatus'],
  currentPacketHash: string | null,
  claimedPacketHash: string | null,
  receiptHash: Sha256 | null,
  reviewerId: string | null,
  independenceConflict: boolean,
  diagnostics: readonly ScenarioEconomicReviewDiagnostic[],
): ScenarioEconomicReviewAssessment {
  return {
    reviewRecordStatus: status, currentPacketHash, claimedPacketHash, receiptHash, reviewerId,
    independenceConflict, identityVerified: false, independenceVerified: false,
    qualificationGranted: false, reportEligible: false,
    diagnostics: [...diagnostics].sort((a, b) => compare(a.code, b.code) || compare(a.subjectId, b.subjectId) || compare(a.reason, b.reason)),
  }
}

function receiptAssessmentUnsafe(
  packetResult: ScenarioEconomicReviewPacketBuildResult,
  receipt: ScenarioEconomicReviewReceipt | null,
): ScenarioEconomicReviewAssessment {
  const packet = packetResult.packet
  if (packetResult.packetStatus !== 'STRUCTURALLY_PREPARED_FIXTURE_ONLY' || !packet || !packetResult.economicReviewPacketHash) {
    return makeAssessment('UNAVAILABLE', null, isRecord(receipt) && typeof receipt.packetHash === 'string' ? receipt.packetHash : null, null, null, false,
      [diagnostic('STRUCTURAL_INVALID', 'packet', 'Receipt cannot be assessed against an unavailable or malformed frozen packet.')])
  }
  const current = packetResult.economicReviewPacketHash
  const verifiedPayloadHash = packetHash(packet)
  if (!verifiedPayloadHash || verifiedPayloadHash !== current || packet.dispatchAuthorized !== false || packet.reportEligible !== false || packetResult.dispatchAuthorized !== false || packetResult.reportEligible !== false) {
    return makeAssessment('UNAVAILABLE', current, isRecord(receipt) && typeof receipt.packetHash === 'string' ? receipt.packetHash : null, null, null, false,
      [diagnostic('HASH_UNAVAILABLE', 'packet', 'Frozen packet payload or permanent no-qualification guards failed integrity verification.')])
  }
  if (receipt === null) return makeAssessment('REVIEW_REQUIRED', current, null, null, null, false, [diagnostic('REVIEW_REQUIRED', 'receipt', 'No reviewer receipt was supplied; no reviewer execution is inferred.')])
  if (!isRecord(receipt)) return makeAssessment('UNAVAILABLE', current, null, null, null, false, [diagnostic('RECEIPT_INVALID', 'receipt', 'Receipt must be a plain object.')])
  const claimed = typeof receipt.packetHash === 'string' ? receipt.packetHash : null
  const reviewerId = typeof receipt.reviewerId === 'string' ? receipt.reviewerId : null
  if (!nonEmpty(claimed)) return makeAssessment('UNAVAILABLE', current, claimed, tryHash(receipt) ?? null, reviewerId, false, [diagnostic('RECEIPT_INVALID', 'packetHash', 'Receipt requires a non-empty packet hash claim.')])
  if (claimed !== current) return makeAssessment('STALE_REVIEW', current, claimed, tryHash(receipt) ?? null, reviewerId, false, [diagnostic('STALE_REVIEW', 'packetHash', 'Receipt packet hash does not match the current frozen packet; claimed decisions are ignored.')])
  const receiptHash = tryHash(receipt)
  if (!receiptHash) return makeAssessment('UNAVAILABLE', current, claimed, null, reviewerId, false, [diagnostic('RECEIPT_INVALID', 'receipt', 'Malformed or cyclic receipt cannot be canonically inspected.')])
  const errors: ScenarioEconomicReviewDiagnostic[] = []
  const allAuthors = packet.authorIds
  const identityTokens = [receipt.reviewerId, receipt.reviewerSessionClaim, receipt.reviewerExecutionIdClaim].filter((value): value is string => typeof value === 'string')
  const independenceConflict = !nonEmpty(receipt.reviewerId) || allAuthors.some((authorId) => identityTokens.includes(authorId))
  if (allAuthors.includes(receipt.reviewerId)) errors.push(diagnostic('SELF_REVIEW', 'reviewerId', 'Reviewer ID equals a proposer author across the frozen BEAR/BASE/BULL set.'))
  else if (!nonEmpty(receipt.reviewerId)) errors.push(diagnostic('RECEIPT_INVALID', 'reviewerId', 'Reviewer ID must be non-empty.'))
  if (independenceConflict && !errors.some((item) => item.code === 'SELF_REVIEW')) errors.push(diagnostic('SELF_REVIEW', 'reviewerIdentity', 'A supplied reviewer/session/execution claim matches a proposer author token.'))
  if (!nonEmpty(receipt.reviewerRoleClaim) || !nonEmpty(receipt.reviewerSessionClaim) || !nonEmpty(receipt.reviewerExecutionIdClaim)) errors.push(diagnostic('RECEIPT_INVALID', 'reviewerClaims', 'Reviewer role, session and execution claims are required as unverified metadata.'))
  if (receipt.rubricVersion !== packet.economicReviewRubricVersion || receipt.reviewContractVersion !== packet.reviewContractVersion) errors.push(diagnostic('RECEIPT_INVALID', 'versions', 'Receipt rubric or review-contract version does not match the frozen packet.'))
  if (!Array.isArray(receipt.authorIds) || !sortedUnique(receipt.authorIds) || !exactStringSet(receipt.authorIds, packet.authorIds) || receipt.authorSetHash !== packet.authorSetHash) errors.push(diagnostic('RECEIPT_INVALID', 'authorSet', 'Receipt must bind the exact unique frozen author set and its hash.'))
  const expectedFindings = packet.cases.flatMap((item) => item.proposals.map((proposal) => ({ scenario: item.scenario, driverId: proposal.driverId, proposalId: proposal.proposalId })))
  const expectedByKey = new Map(expectedFindings.map((item) => [`${item.scenario}|${item.driverId}|${item.proposalId}`, item]))
  const seen = new Set<string>()
  if (!Array.isArray(receipt.findings)) errors.push(diagnostic('RECEIPT_INVALID', 'findings', 'Finding list is required.'))
  else for (const finding of receipt.findings) {
    if (!isRecord(finding)) { errors.push(diagnostic('RECEIPT_INVALID', 'findings', 'Each finding must be a plain object.')); continue }
    const key = `${finding.scenario}|${finding.driverId}|${finding.proposalId}`
    if (seen.has(key)) errors.push(diagnostic('RECEIPT_INVALID', key, 'Duplicate scenario/driver/proposal finding.'))
    seen.add(key)
    if (!expectedByKey.has(key)) errors.push(diagnostic('RECEIPT_INVALID', key, 'Finding references a scenario, driver or proposal outside the frozen packet.'))
    if (!nonEmpty(finding.rationale) || !isRecord(finding.rubric)) { errors.push(diagnostic('RECEIPT_INVALID', key, 'Finding rationale and rubric object are required.')); continue }
    if (Object.keys(finding.rubric).some((dimension) => !RUBRIC_DIMENSIONS.includes(dimension as ScenarioEconomicReviewRubricDimension))) errors.push(diagnostic('RECEIPT_INVALID', key, 'Finding contains an unsupported rubric dimension.'))
    for (const dimension of RUBRIC_DIMENSIONS) {
      const claim = finding.rubric[dimension]
      if (!isRecord(claim) || !['QUALIFIED_CLAIM', 'REVIEW_REQUIRED_CLAIM', 'REJECT_CLAIM', 'NOT_ASSESSED_CLAIM'].includes(String(claim.judgment)) || !nonEmpty(claim.reason)) errors.push(diagnostic('RECEIPT_INVALID', `${key}.${dimension}`, 'Every required rubric dimension needs an allowed claim and non-empty reason.'))
    }
  }
  if (seen.size !== expectedByKey.size || [...expectedByKey.keys()].some((key) => !seen.has(key))) errors.push(diagnostic('REVIEW_REQUIRED', 'findings', 'Every frozen scenario/driver/proposal needs exactly one finding.'))
  if (!['ACCEPT_CLAIM', 'REVISION_REQUIRED_CLAIM', 'REJECT_CLAIM'].includes(String(receipt.decisionClaim))) errors.push(diagnostic('RECEIPT_INVALID', 'decisionClaim', 'Receipt decision must be a candidate claim.'))
  if (errors.some((item) => item.code === 'SELF_REVIEW')) return makeAssessment('REJECTED', current, claimed, receiptHash, reviewerId, true, errors)
  if (errors.some((item) => item.code === 'RECEIPT_INVALID')) return makeAssessment('REVIEW_REQUIRED', current, claimed, receiptHash, reviewerId, independenceConflict, errors)
  if (receipt.decisionClaim === 'REJECT_CLAIM') return makeAssessment('REJECTED', current, claimed, receiptHash, reviewerId, false, [...errors, diagnostic('SEMANTIC_REVIEW_REQUIRED', 'decisionClaim', 'A rejection is recorded only as an unverified reviewer claim.')])
  errors.push(diagnostic('IDENTITY_UNVERIFIED', 'reviewerIdentity', 'No approved identity registry, signature verifier or isolated execution attestation exists; supplied identity/signature claims are not trusted.'))
  errors.push(diagnostic('SEMANTIC_REVIEW_REQUIRED', 'reviewerFindings', 'Rubric findings are caller claims and cannot become a validated semantic review in this phase.'))
  return makeAssessment('REVIEW_REQUIRED', current, claimed, receiptHash, reviewerId, false, errors)
}

/** Checks receipt shape and freshness only; it never validates semantic independence or grants qualification. */
export function validateScenarioEconomicReviewReceipt(
  packet: ScenarioEconomicReviewPacketBuildResult,
  receipt: ScenarioEconomicReviewReceipt | null,
): ScenarioEconomicReviewAssessment {
  try { return receiptAssessmentUnsafe(packet, receipt) }
  catch { return makeAssessment('UNAVAILABLE', null, null, null, null, false, [diagnostic('RECEIPT_INVALID', 'receipt', 'Malformed packet/receipt rejected without throwing.')]) }
}
