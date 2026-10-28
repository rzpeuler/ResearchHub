import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import {
  SCENARIO_METHOD_CONTRACT_VERSION,
  SCENARIO_METHOD_HASH_SCHEMA,
  type AssumptionReviewRecord,
  type BearBaseBullSet,
  type EconomicDriverObservation,
  type EquityMarketAssessment,
  type EquityMarketInput,
  type EnterpriseValueBridgeConsistencyInput,
  type EvidenceConsumer,
  type IsoDate,
  type IsoInstant,
  type NonEmptyString,
  type ObservationAssessment,
  type ScenarioHorizon,
  type ScenarioMethodContractInput,
  type ScenarioMethodDiagnostic,
  type ScenarioMethodDiagnosticCode,
  type ScenarioMethodResult,
  type ScenarioReviewFreshness,
  type Sha256,
  type ValueVersionProof,
} from './scenario-method-contracts.ts'

/**
 * This slice has no approved historical-proof trust registry or verification key.
 * Keep the list closed and empty until a separately approved trust adapter exists.
 */
const APPROVED_HISTORICAL_TRUST_ROOT_IDS: readonly string[] = Object.freeze([])
const FIXED_SCENARIO_ORDER = ['BEAR', 'BASE', 'BULL'] as const
const HASH_PREFIX = `${SCENARIO_METHOD_HASH_SCHEMA}\n`

type PlainRecord = Record<string, unknown>
type ProofAssessment = {
  readonly structuralValid: boolean
  readonly valueVersionStatus: 'UNVERIFIED' | 'UNAVAILABLE' | 'CONFLICTED'
  readonly diagnostics: readonly ScenarioMethodDiagnostic[]
}

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const diagnostic = (code: ScenarioMethodDiagnosticCode, subjectId: string, reason: string, downstream: readonly EvidenceConsumer[] = ['OPERATING_DRIVER', 'BULL_BASE_BEAR']): ScenarioMethodDiagnostic => ({ code, subjectId, reason, downstream })

function asRecord(value: unknown): PlainRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? value as PlainRecord : undefined
}

function canonicalJson(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical hash rejects non-finite numbers')
    return Object.is(value, -0) ? '0' : JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new TypeError(`canonical hash rejects ${typeof value}`)
  if (ancestors.has(value)) throw new TypeError('canonical hash rejects cycles')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, ancestors)).join(',')}]`
    const record = asRecord(value)
    if (!record) throw new TypeError('canonical hash accepts only plain objects')
    const keys = Object.keys(record).sort(compareText)
    const fields: string[] = []
    for (const key of keys) {
      if (record[key] === undefined) throw new TypeError(`canonical hash rejects undefined field ${key}`)
      fields.push(`${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`)
    }
    return `{${fields.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

/** Canonical UTF-8 SHA-256. Object keys sort recursively; array ordering remains semantic. */
export function hashCanonicalScenarioValue(value: unknown): Sha256 {
  return sha256(`${HASH_PREFIX}${canonicalJson(value)}`) as Sha256
}

export function parseScenarioNonEmptyString(value: unknown): NonEmptyString | undefined {
  return nonEmpty(value) ? value.trim() as NonEmptyString : undefined
}

export function parseScenarioSha256(value: unknown): Sha256 | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value) ? value as Sha256 : undefined
}

export function parseScenarioIsoDate(value: unknown): IsoDate | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0)
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month! >= 1 && month! <= 12 && day! >= 1 && day! <= monthDays[month! - 1]! ? value as IsoDate : undefined
}

/** Accepts only real UTC instants with an explicit Z and at most millisecond precision. */
export function parseScenarioIsoInstant(value: unknown): IsoInstant | undefined {
  if (typeof value !== 'string') return undefined
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u.exec(value)
  if (!match || !parseScenarioIsoDate(match[1])) return undefined
  const hour = Number(match[2]); const minute = Number(match[3]); const second = Number(match[4])
  if (hour > 23 || minute > 59 || second > 59) return undefined
  const millis = (match[5] ?? '').padEnd(3, '0')
  const canonical = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${millis || '000'}Z`
  return Number.isFinite(Date.parse(canonical)) ? canonical as IsoInstant : undefined
}

function instant(value: unknown): number | undefined {
  const parsed = parseScenarioIsoInstant(value)
  return parsed === undefined ? undefined : Date.parse(parsed)
}

function date(value: unknown): number | undefined {
  const parsed = parseScenarioIsoDate(value)
  return parsed === undefined ? undefined : Date.parse(`${parsed}T00:00:00.000Z`)
}

function sameJson(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left) === canonicalJson(right) } catch { return false }
}

function rawNumericValue(token: string): number | undefined {
  const cleaned = token.trim().replace(/,/gu, '').replace(/[%％]\s*$/u, '').trim()
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(cleaned)) return undefined
  const result = Number(cleaned)
  return Number.isFinite(result) ? result : undefined
}

function rowBindingPayload(evidence: NonNullable<Extract<EconomicDriverObservation, { kind: 'FACT' }>['evidence']>): PlainRecord {
  return {
    sourceCandidateId: evidence.sourceCandidateId,
    sourceLocation: evidence.sourceLocation,
    immutableSourceContentHash: evidence.immutableSourceContentHash,
    rawValueToken: evidence.rawValueToken,
    normalizedValue: evidence.normalizedValue,
    normalizationRule: evidence.normalizationRule,
    unit: evidence.unit,
    currency: evidence.currency,
    metricId: evidence.metricId,
    periodStart: evidence.periodStart,
    periodEnd: evidence.periodEnd,
    periodBasis: evidence.periodBasis,
    financialScope: evidence.financialScope,
    shareBasis: evidence.shareBasis,
  }
}

function verifySourceExcerptLocation(evidence: NonNullable<Extract<EconomicDriverObservation, { kind: 'FACT' }>['evidence']>): { readonly verified: boolean; readonly reason: string } {
  const match = /^(paragraph|line):([1-9]\d*)$/u.exec(evidence.sourceLocation)
  if (!match) return { verified: false, reason: 'Only canonical paragraph:N and line:N locators can be checked against the supplied plain-text payload; page/table/cell locators need an absent structured coordinate map.' }
  const kind = match[1]
  const ordinal = Number(match[2])
  const normalizedLines = evidence.immutableSourceContent.replace(/\r\n?/gu, '\n')
  const segments = kind === 'line'
    ? normalizedLines.split('\n')
    : normalizedLines.split(/\n(?:[ \t]*\n)+/u).filter((segment) => segment.trim().length > 0)
  const segment = segments[ordinal - 1]
  if (segment === undefined) return { verified: false, reason: `${evidence.sourceLocation} is outside the deterministic ${kind} index for the supplied source content.` }
  if (!segment.includes(evidence.sourceExcerptText) || !evidence.sourceExcerptText.includes(evidence.rawValueToken)) return { verified: false, reason: `The exact sourceExcerptText and raw token do not occur inside the segment addressed by ${evidence.sourceLocation}.` }
  return { verified: true, reason: '' }
}

function structuralProofAssessment(proof: ValueVersionProof | null, observation: Extract<EconomicDriverObservation, { kind: 'FACT' }>, horizon: ScenarioHorizon, expectedEvidenceManifestHash: Sha256): ProofAssessment {
  const failures: ScenarioMethodDiagnostic[] = []
  const evidence = observation.evidence
  let structuralValid = true
  const fail = (code: ScenarioMethodDiagnosticCode, reason: string): void => {
    structuralValid = false
    failures.push(diagnostic(code, observation.observationId, reason, [observation.consumer]))
  }
  if (!proof) {
    return {
      structuralValid: false,
      valueVersionStatus: 'UNAVAILABLE',
      diagnostics: [diagnostic('VALUE_VERSION_UNPROVEN', observation.observationId, 'No per-value version proof was supplied.', [observation.consumer])],
    }
  }
  if (proof.evidenceManifestHash !== expectedEvidenceManifestHash || observation.evidenceManifestHash !== expectedEvidenceManifestHash) fail('SOURCE_BINDING_MISMATCH', 'Proof and observation must bind the exact canonical evidenceManifestHash frozen for this packet.')

  const requiredStrings: [unknown, string][] = [
    [proof.proofId, 'proofId'], [proof.sourceCandidateId, 'sourceCandidateId'], [proof.sourceLocation, 'sourceLocation'],
    [proof.immutableSourceContentHash, 'immutableSourceContentHash'], [proof.rawValueToken, 'rawValueToken'],
    [proof.unit, 'unit'], [proof.metricId, 'metricId'], [proof.periodEnd, 'periodEnd'],
    [proof.periodBasis, 'periodBasis'], [proof.financialScope, 'financialScope'], [proof.rowBindingHash, 'rowBindingHash'],
  ]
  for (const [value, field] of requiredStrings) if (!nonEmpty(value)) fail('STRUCTURAL_INVALID', `ValueVersionProof.${field} must be a non-empty string.`)
  if (!parseScenarioSha256(proof.immutableSourceContentHash) || !parseScenarioSha256(proof.rowBindingHash)) fail('SOURCE_BINDING_MISMATCH', 'Proof hashes must be lowercase SHA-256 values.')
  if (proof.sourceCandidateId !== evidence.sourceCandidateId || proof.sourceLocation !== evidence.sourceLocation) fail('SOURCE_BINDING_MISMATCH', 'Proof source identity or exact locator differs from the observation.')
  if (proof.immutableSourceContentHash !== evidence.immutableSourceContentHash || proof.rawValueToken !== evidence.rawValueToken || !sameJson(proof.normalizedValue, evidence.normalizedValue) || !sameJson(proof.normalizationRule, evidence.normalizationRule)) fail('SOURCE_BINDING_MISMATCH', 'Proof content hash or raw/normalized value/conversion differs from the observation.')
  if (proof.unit !== evidence.unit || proof.currency !== evidence.currency || proof.metricId !== evidence.metricId || proof.periodStart !== evidence.periodStart || proof.periodEnd !== evidence.periodEnd || proof.periodBasis !== evidence.periodBasis || proof.financialScope !== evidence.financialScope || proof.epsBasis !== evidence.shareBasis) fail('SOURCE_BINDING_MISMATCH', 'Proof metric, period, scope, unit, currency, or share basis differs from the observation.')
  if (proof.sourcePublishedAt !== observation.sourcePublishedAt || proof.observedAt !== observation.observedAt || proof.retrievedAt !== observation.retrievedAt || evidence.sourceRetrievedAt !== observation.retrievedAt) fail('SOURCE_BINDING_MISMATCH', 'Publication, observation and retrieval times must remain distinct and bind to the same preserved observation record.')
  try {
    if (proof.rowBindingHash !== hashCanonicalScenarioValue(rowBindingPayload(evidence))) fail('SOURCE_BINDING_MISMATCH', 'Per-value row binding hash does not reproduce from the canonical row identity.')
  } catch {
    fail('STRUCTURAL_INVALID', 'Per-value row binding contains a non-canonical field.')
  }
  if (typeof evidence.immutableSourceContent !== 'string' || sha256(evidence.immutableSourceContent) !== evidence.immutableSourceContentHash) fail('SOURCE_BINDING_MISMATCH', 'The supplied original source content does not match its immutable content hash.')
  if (typeof evidence.sourceExcerptText !== 'string' || !evidence.sourceExcerptText.trim() || !evidence.immutableSourceContent.includes(evidence.sourceExcerptText) || !evidence.sourceExcerptText.includes(evidence.rawValueToken)) fail('SOURCE_BINDING_MISMATCH', 'The located excerpt is not present in the supplied source content or does not contain the exact raw token.')
  const location = verifySourceExcerptLocation(evidence)
  if (!location.verified) failures.push(diagnostic('SOURCE_LOCATION_UNVERIFIED', observation.observationId, location.reason, [observation.consumer]))

  const asOfTime = instant(horizon.analysisAsOf)
  const availableAt = instant(proof.valueVersionAvailableAt)
  const publishedAt = instant(proof.sourcePublishedAt)
  const proofAsOf = instant(proof.analysisAsOf)
  if (proofAsOf === undefined || asOfTime === undefined || proofAsOf !== asOfTime) fail('HISTORICAL_CUTOFF_VIOLATION', 'Proof analysisAsOf must equal the immutable horizon analysisAsOf.')
  if (availableAt === undefined) fail('VALUE_VERSION_UNPROVEN', 'A valid valueVersionAvailableAt is required; report date and retrieval time are not substitutes.')
  else if (asOfTime !== undefined && availableAt > asOfTime) fail('HISTORICAL_CUTOFF_VIOLATION', 'The exact value version became available after analysisAsOf.')
  if (publishedAt === undefined) fail('VALUE_VERSION_UNPROVEN', 'A valid carrier sourcePublishedAt is required as a separate timestamp.')
  else if (asOfTime !== undefined && publishedAt > asOfTime) fail('HISTORICAL_CUTOFF_VIOLATION', 'The carrier was published after analysisAsOf.')
  for (const [value, field] of [[proof.observedAt, 'observedAt'], [proof.retrievedAt, 'retrievedAt']] as const) {
    if (value !== null && instant(value) === undefined) fail('STRUCTURAL_INVALID', `${field} must be a valid UTC ISO instant or null.`)
  }
  if (proof.revisionStatus !== 'COMPLETE' || !parseScenarioSha256(proof.revisionChainHash)) fail('VALUE_VERSION_UNPROVEN', 'A complete, hash-bound correction/revision chain is required.')
  if (!nonEmpty(proof.valueVersionId) || !nonEmpty(proof.trustRoot) || !nonEmpty(proof.proofReference)) fail('VALUE_VERSION_UNPROVEN', 'Version ID, trust root and external proof reference must be present; caller strings alone remain claims.')

  if (proof.method === 'OFFICIAL_PUBLISHED_DOCUMENT') {
    if (!nonEmpty(proof.publicationRecordReference)) fail('VALUE_VERSION_UNPROVEN', 'Official-document proof requires an independent publication record reference.')
  } else if (proof.method === 'IMMUTABLE_PROVIDER_VINTAGE') {
    if (!nonEmpty(proof.valueVersionId) || !nonEmpty(proof.proofReference)) fail('VALUE_VERSION_UNPROVEN', 'Provider vintage requires immutable version identity and a verifiable vintage record.')
    if (proof.snapshotCapturedAt !== null || proof.snapshotSealedAt !== null) fail('STRUCTURAL_INVALID', 'Provider-vintage proof must not mislabel itself as a sealed snapshot.')
  } else {
    const capturedAt = instant(proof.snapshotCapturedAt)
    const sealedAt = instant(proof.snapshotSealedAt)
    const retrievedAt = instant(proof.retrievedAt)
    if (!nonEmpty(proof.signatureVerificationReference) || capturedAt === undefined || sealedAt === undefined) fail('VALUE_VERSION_UNPROVEN', 'Sealed snapshot requires a verifiable signature reference and capture/seal instants.')
    if (capturedAt !== undefined && sealedAt !== undefined && capturedAt > sealedAt) fail('HISTORICAL_CUTOFF_VIOLATION', 'Snapshot capture must not occur after its seal.')
    if (sealedAt !== undefined && asOfTime !== undefined && sealedAt > asOfTime) fail('HISTORICAL_CUTOFF_VIOLATION', 'Snapshot seal occurred after analysisAsOf.')
    if (capturedAt !== undefined && retrievedAt !== undefined && capturedAt > retrievedAt) fail('HISTORICAL_CUTOFF_VIOLATION', 'Snapshot retrieval cannot precede its claimed capture.')
  }
  if (proof.rights.decision !== 'ALLOWED' || proof.rights.intendedUse !== observation.consumer || !nonEmpty(proof.rights.recordId) || !parseScenarioSha256(proof.rights.evidenceHash) || !proof.rights.evidenceText || !parseScenarioSha256(proof.rights.evidenceTextHash) || sha256(proof.rights.evidenceText) !== proof.rights.evidenceTextHash || proof.rights.evidenceHash !== proof.rights.evidenceTextHash) fail('SOURCE_RIGHTS_UNVERIFIED', 'Rights must bind an exact use-specific evidence record; authorization authority is not configured in this slice.')
  if (proof.rights.recordId !== observation.rights.recordId || proof.rights.evidenceHash !== observation.rights.evidenceHash || proof.rights.evidenceTextHash !== observation.rights.evidenceTextHash || proof.rights.decision !== observation.rights.decision || proof.rights.intendedUse !== observation.rights.intendedUse) fail('SOURCE_RIGHTS_UNVERIFIED', 'Observation and value-version proof refer to different rights evidence.')

  // Status and trustRoot are caller claims. No approved trust root or signature verifier exists here.
  const trustRootApproved = typeof proof.trustRoot === 'string' && APPROVED_HISTORICAL_TRUST_ROOT_IDS.includes(proof.trustRoot)
  if (!trustRootApproved) failures.push(diagnostic('VALUE_VERSION_UNPROVEN', observation.observationId, 'No approved historical trust root/verifier is configured; self-asserted proofStatus, sourcePublishedAt, IDs and local hashes cannot establish historical availability.', [observation.consumer]))
  if (proof.claimedProofStatus === 'CONFLICTED' || proof.revisionStatus === 'CONFLICTED') return { structuralValid, valueVersionStatus: 'CONFLICTED', diagnostics: failures }
  return { structuralValid, valueVersionStatus: 'UNVERIFIED', diagnostics: failures }
}

function validateHorizon(horizon: ScenarioHorizon): ScenarioMethodDiagnostic[] {
  const errors: ScenarioMethodDiagnostic[] = []
  const subject = 'horizon'
  const add = (reason: string, code: ScenarioMethodDiagnosticCode = 'STRUCTURAL_INVALID'): void => { errors.push(diagnostic(code, subject, reason)) }
  const asOf = instant(horizon.analysisAsOf)
  const targetStart = date(horizon.targetPeriodStart)
  const targetEnd = date(horizon.targetPeriodEnd)
  const baseEnd = date(horizon.basePeriodEnd)
  if (asOf === undefined) add('analysisAsOf must be a real UTC ISO instant.')
  if (!Number.isInteger(horizon.targetFiscalYear) || !Number.isInteger(horizon.baseFiscalYear) || horizon.targetFiscalYear <= horizon.baseFiscalYear) add('Target fiscal year must be explicit and later than the reported base fiscal year.')
  if (targetStart === undefined || targetEnd === undefined || targetStart > targetEnd) add('Target period dates must be valid, ordered calendar dates.')
  if (baseEnd === undefined || (asOf !== undefined && baseEnd > asOf)) add('Base period end must be valid and no later than analysisAsOf.')
  if (!nonEmpty(horizon.financialScope) || !nonEmpty(horizon.currency) || !nonEmpty(horizon.methodId) || !parseScenarioSha256(horizon.sourceSnapshotHash)) add('Horizon scope, currency, method and snapshot SHA-256 are required.')
  if (!Array.isArray(horizon.requiredDriverIds) || horizon.requiredDriverIds.length === 0 || horizon.requiredDriverIds.some((item) => !nonEmpty(item)) || new Set(horizon.requiredDriverIds).size !== horizon.requiredDriverIds.length) add('requiredDriverIds must be a non-empty set of unique non-empty IDs.')
  if (horizon.targetPeriodBasis === 'FY' && targetStart !== undefined && targetEnd !== undefined) {
    const expectedStart = Date.UTC(horizon.targetFiscalYear, 0, 1)
    const expectedEnd = Date.UTC(horizon.targetFiscalYear, 11, 31)
    if (targetStart !== expectedStart || targetEnd !== expectedEnd) add('FY target dates must match targetFiscalYear exactly.', 'PERIOD_MISMATCH')
  }
  if (horizon.basePeriodBasis === 'FY' && baseEnd !== undefined && new Date(baseEnd).getUTCFullYear() !== horizon.baseFiscalYear) add('FY base period end must match baseFiscalYear.', 'PERIOD_MISMATCH')
  return errors
}

function validateObservation(observation: EconomicDriverObservation, horizon: ScenarioHorizon, byId: ReadonlyMap<string, EconomicDriverObservation>, expectedEvidenceManifestHash: Sha256): ObservationAssessment {
  const failures: ScenarioMethodDiagnostic[] = []
  const add = (code: ScenarioMethodDiagnosticCode, reason: string): void => { failures.push(diagnostic(code, observation.observationId, reason, [observation.consumer])) }
  let valueVersionStatus: ObservationAssessment['valueVersionStatus'] = 'UNAVAILABLE'
  let eligibility: ObservationAssessment['eligibility'] = 'UNAVAILABLE'
  if (!nonEmpty(observation.observationId) || !nonEmpty(observation.companySymbol) || !nonEmpty(observation.driverId) || !nonEmpty(observation.metricId) || !nonEmpty(observation.atomicSkillOwner)) add('STRUCTURAL_INVALID', 'Observation identity fields must be non-empty.')
  if (observation.analysisAsOf !== horizon.analysisAsOf || observation.asOfMode !== horizon.asOfMode) add('HISTORICAL_CUTOFF_VIOLATION', 'Observation and horizon must share the exact asOf value and mode.')
  if (!nonEmpty(observation.economicScope) || !nonEmpty(observation.financialScope)) add('STRUCTURAL_INVALID', 'Requested economic and financial scope must be explicit.')
  if (observation.kind !== 'MISSING' && (!nonEmpty(observation.periodBasis) || !nonEmpty(observation.unit))) add('STRUCTURAL_INVALID', 'Observed values require explicit period basis and unit.')
  if (observation.sourceConflicts.length > 0) add('CONFLICTED_EVIDENCE', 'Observation has unresolved source conflicts.')
  const periodEnd = observation.periodEnd === null ? undefined : date(observation.periodEnd)
  const periodStart = observation.periodStart === null ? null : date(observation.periodStart)
  if (observation.kind !== 'MISSING' && (periodEnd === undefined || (observation.periodStart !== null && (periodStart === undefined || periodStart === null || periodStart > periodEnd)))) add('PERIOD_MISMATCH', 'Observed value period must contain valid, ordered dates.')
  if (observation.kind === 'MISSING' && observation.periodEnd === null && !observation.missingFields.includes('periodEnd')) add('STRUCTURAL_INVALID', 'A missing periodEnd must be named explicitly in missingFields.')
  if (Number.isInteger(observation.fiscalYear) && periodEnd !== undefined && new Date(periodEnd).getUTCFullYear() !== observation.fiscalYear && observation.periodBasis === 'FY') add('PERIOD_MISMATCH', 'FY observation year does not match periodEnd.')
  if (observation.kind !== 'MISSING' && observation.periodBasis === 'FY' && periodStart !== null && periodStart !== undefined && periodEnd !== undefined) {
    if (new Date(periodStart).getUTCMonth() !== 0 || new Date(periodStart).getUTCDate() !== 1 || new Date(periodEnd).getUTCMonth() !== 11 || new Date(periodEnd).getUTCDate() !== 31) add('PERIOD_MISMATCH', 'FY basis must cover January 1 through December 31; H1 YTD cannot be doubled or relabeled as FY.')
  }
  if (observation.kind !== 'MISSING' && observation.periodBasis === 'H1_YTD' && periodStart !== null && periodStart !== undefined && periodEnd !== undefined) {
    if (new Date(periodStart).getUTCMonth() !== 0 || new Date(periodStart).getUTCDate() !== 1 || new Date(periodEnd).getUTCMonth() !== 5 || new Date(periodEnd).getUTCDate() !== 30) add('PERIOD_MISMATCH', 'H1_YTD basis must cover January 1 through June 30.')
  }
  if (periodEnd !== undefined && instant(horizon.analysisAsOf) !== undefined && periodEnd > instant(horizon.analysisAsOf)!) add('HISTORICAL_CUTOFF_VIOLATION', 'Observed period ends after analysisAsOf.')
  if (observation.observedAt !== null && instant(observation.observedAt) === undefined) add('STRUCTURAL_INVALID', 'observedAt must be a valid UTC instant or null.')
  if (observation.sourcePublishedAt !== null && instant(observation.sourcePublishedAt) === undefined) add('STRUCTURAL_INVALID', 'sourcePublishedAt must be a valid UTC instant or null.')
  if (observation.retrievedAt !== null && instant(observation.retrievedAt) === undefined) add('STRUCTURAL_INVALID', 'retrievedAt must be a valid UTC instant or null.')
  if (!parseScenarioSha256(observation.evidenceManifestHash)) add('STRUCTURAL_INVALID', 'evidenceManifestHash must be a lowercase SHA-256.')
  if (observation.evidenceManifestHash !== expectedEvidenceManifestHash) add('SOURCE_BINDING_MISMATCH', 'Observation does not bind the exact canonical evidence manifest.')

  if (observation.kind === 'MISSING') {
    if (!observation.missingFields.length || observation.missingFields.some((field) => !nonEmpty(field)) || !observation.rejectionReasons.length || observation.rejectionReasons.some((reason) => !nonEmpty(reason))) add('STRUCTURAL_INVALID', 'Missing observations require exact non-empty missingFields and rejectionReasons.')
    if (observation.evidence !== null || observation.rights !== null || observation.valueVersionProof !== null || observation.normalizedValue !== null) add('STRUCTURAL_INVALID', 'Missing observations must not fabricate source, rights, proof, or value fields.')
    valueVersionStatus = observation.claimedValueVersionStatus === 'CONFLICTED' ? 'CONFLICTED' : 'UNAVAILABLE'
    eligibility = observation.claimedEligibility === 'CONFLICTED' ? 'CONFLICTED' : 'UNAVAILABLE'
  } else if (observation.kind === 'FACT') {
    const proofAssessment = structuralProofAssessment(observation.valueVersionProof, observation, horizon, expectedEvidenceManifestHash)
    failures.push(...proofAssessment.diagnostics)
    valueVersionStatus = proofAssessment.valueVersionStatus
    const evidence = observation.evidence
    if (!nonEmpty(evidence.sourceCandidateId) || !/^(page|paragraph|table|cell|line):\S+$/u.test(evidence.sourceLocation) || !parseScenarioSha256(evidence.immutableSourceContentHash) || !nonEmpty(evidence.rawValueToken) || !nonEmpty(evidence.unit) || !nonEmpty(evidence.metricId) || !nonEmpty(evidence.financialScope) || !parseScenarioSha256(evidence.rowBindingHash)) add('STRUCTURAL_INVALID', 'Fact evidence requires an exact source locator, content hash, raw token, unit, scope and row-binding hash.')
    if (evidence.metricId !== observation.metricId || evidence.periodEnd !== observation.periodEnd || evidence.periodStart !== observation.periodStart || evidence.periodBasis !== observation.periodBasis || evidence.financialScope !== observation.financialScope || evidence.unit !== observation.unit || evidence.currency !== observation.currency || evidence.shareBasis !== observation.shareBasis) add('SOURCE_BINDING_MISMATCH', 'Fact identity, period, scope, unit or share basis differs from its observation.')
    if (typeof evidence.normalizedValue === 'number' && !finiteNumber(evidence.normalizedValue)) add('STRUCTURAL_INVALID', 'Normalized numeric value must be finite; zero is a valid observed value.')
    if (typeof evidence.normalizedValue === 'number') {
      const raw = rawNumericValue(evidence.rawValueToken)
      let converted: number | undefined
      if (raw !== undefined && evidence.normalizationRule.kind === 'IDENTITY' && evidence.normalizationRule.formulaVersion === 'identity-v1') converted = raw
      if (raw !== undefined && evidence.normalizationRule.kind === 'MULTIPLY' && finiteNumber(evidence.normalizationRule.factor) && nonEmpty(evidence.normalizationRule.formulaVersion)) converted = raw * evidence.normalizationRule.factor
      if (raw !== undefined && evidence.normalizationRule.kind === 'DIVIDE' && finiteNumber(evidence.normalizationRule.divisor) && evidence.normalizationRule.divisor !== 0 && nonEmpty(evidence.normalizationRule.formulaVersion)) converted = raw / evidence.normalizationRule.divisor
      if (converted === undefined || !close(converted, evidence.normalizedValue)) add('SOURCE_BINDING_MISMATCH', 'Raw token, declared deterministic conversion rule and normalized value do not reproduce exactly.')
    } else if (evidence.normalizedValue !== evidence.rawValueToken || evidence.normalizationRule.kind !== 'IDENTITY') add('SOURCE_BINDING_MISMATCH', 'Text facts must preserve the literal token without numeric conversion.')
    const scopeMatches = evidence.financialScope === horizon.financialScope
    if (!scopeMatches) {
      add('SCOPE_MISMATCH', 'A correctly located fact in another scope is not eligible for this consumer; its version status remains independent.')
      eligibility = 'UNAVAILABLE'
    } else if (valueVersionStatus === 'CONFLICTED') eligibility = 'CONFLICTED'
    else eligibility = 'UNVERIFIED'
    if (observation.rights.decision === 'DENIED') { add('SOURCE_RIGHTS_UNVERIFIED', 'Source rights explicitly deny this intended use.'); eligibility = 'UNAVAILABLE' }
    else if (observation.rights.decision !== 'ALLOWED' || observation.rights.intendedUse !== observation.consumer) add('SOURCE_RIGHTS_UNVERIFIED', 'Source rights are unknown or not bound to the requested consumer.')
    if (failures.some((item) => item.code === 'SOURCE_LOCATION_UNVERIFIED')) eligibility = 'UNAVAILABLE'
  } else if (observation.kind === 'INFERENCE') {
    valueVersionStatus = observation.claimedValueVersionStatus === 'CONFLICTED' ? 'CONFLICTED' : 'UNVERIFIED'
    if (!observation.inferenceInputRefs.length || observation.inferenceInputRefs.some((ref) => !byId.has(ref)) || !nonEmpty(observation.inferenceRule)) add('STRUCTURAL_INVALID', 'Inference requires a named rule and existing input observation refs.')
    eligibility = 'UNVERIFIED'
    failures.push(diagnostic('VALUE_VERSION_UNPROVEN', observation.observationId, 'An inference is not a source fact and remains unqualified until its input lineage and independent method review are authorized.', [observation.consumer]))
  } else {
    valueVersionStatus = 'NOT_APPLICABLE'
    const refs = observation.derivation.inputObservationIds
    if (observation.derivation.purpose !== 'OBSERVED_ARITHMETIC_ONLY') add('STRUCTURAL_INVALID', 'This Phase 1 validator accepts observed arithmetic only; it cannot implement or qualify a financial forecast bridge.')
    if (refs.length === 0 || refs.some((ref) => !byId.has(ref)) || !nonEmpty(observation.derivation.formulaVersion) || !finiteNumber(observation.derivation.result)) add('STRUCTURAL_INVALID', 'Derived value requires existing qualified input refs, a formula version and a finite supplied result.')
    const resolvedInputs = refs.map((ref) => byId.get(ref)).filter((value): value is EconomicDriverObservation => value !== undefined)
    if (resolvedInputs.some((value) => value.periodBasis !== observation.periodBasis || value.periodStart !== observation.periodStart || value.periodEnd !== observation.periodEnd || value.financialScope !== observation.financialScope || value.currency !== observation.currency)) add('PERIOD_MISMATCH', 'Observed arithmetic cannot silently annualize H1 YTD, mix currencies, periods or financial scopes.')
    const inputValues = refs.map((ref) => {
      const input = byId.get(ref)
      return input?.kind === 'FACT' ? input.evidence.normalizedValue : input?.kind === 'DERIVED' ? input.derivation.result : null
    })
    if (inputValues.some((value) => typeof value !== 'number' || !Number.isFinite(value))) add('DERIVATION_MISMATCH', 'Every arithmetic derivation input must be numeric and present.')
    else {
      const nums = inputValues as number[]
      const expected = recomputeDerived(observation.derivation.operation, nums)
      if (expected === undefined || !close(expected, observation.derivation.result)) add('DERIVATION_MISMATCH', 'Supplied derived result does not reproduce from the declared operation and inputs.')
    }
    const inputsEligible = refs.length > 0 && refs.every((ref) => {
      const assessment = byId.get(ref)
      return assessment?.kind === 'DERIVED' || assessment?.kind === 'FACT'
    })
    eligibility = inputsEligible ? 'UNVERIFIED' : 'UNAVAILABLE'
    if (inputsEligible) failures.push(diagnostic('VALUE_VERSION_UNPROVEN', observation.observationId, 'Derived arithmetic is structurally reproducible, but its source inputs are not independently historically verified.', [observation.consumer]))
  }

  return { observationId: observation.observationId, originKind: observation.originKind, claimedValueVersionStatus: observation.claimedValueVersionStatus, valueVersionStatus, claimedEligibility: observation.claimedEligibility, eligibility, diagnostics: failures }
}

function close(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= Math.max(1e-10, Math.max(Math.abs(left), Math.abs(right)) * 1e-12)
}

function localTradingDate(value: string | null, timeZone: string | null): string | undefined {
  const timestamp = instant(value)
  if (timestamp === undefined || !nonEmpty(timeZone)) return undefined
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(timestamp)
    const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    return `${fields.year}-${fields.month}-${fields.day}`
  } catch { return undefined }
}

function recomputeDerived(operation: Extract<EconomicDriverObservation, { kind: 'DERIVED' }>['derivation']['operation'], values: readonly number[]): number | undefined {
  if (values.some((value) => !Number.isFinite(value))) return undefined
  switch (operation) {
    case 'ADD': return values.length >= 2 ? values.reduce((sum, value) => sum + value, 0) : undefined
    case 'SUBTRACT': return values.length === 2 ? values[0]! - values[1]! : undefined
    case 'MULTIPLY': return values.length >= 2 ? values.reduce((product, value) => product * value, 1) : undefined
    case 'DIVIDE': return values.length === 2 && values[1] !== 0 ? values[0]! / values[1]! : undefined
    case 'PERCENT_CHANGE': return values.length === 2 && values[0] !== 0 ? (values[1]! - values[0]!) / Math.abs(values[0]!) : undefined
  }
}

function validateScenarioSet(set: BearBaseBullSet, horizon: ScenarioHorizon, observations: ReadonlyMap<string, EconomicDriverObservation>): ScenarioMethodDiagnostic[] {
  const errors: ScenarioMethodDiagnostic[] = []
  const add = (code: ScenarioMethodDiagnosticCode, subject: string, reason: string): void => { errors.push(diagnostic(code, subject, reason)) }
  const actualOrder = set.scenarios.map((scenario) => scenario.scenario)
  if (!sameJson(actualOrder, FIXED_SCENARIO_ORDER)) add('STRUCTURAL_INVALID', 'scenarioSet', 'Scenarios must be exactly ordered BEAR, BASE, BULL.')
  const required = [...set.requiredDriverIds].sort()
  if (!sameJson([...horizon.requiredDriverIds].sort(), required) || new Set(required).size !== required.length) add('MISSING_REQUIRED_DRIVER', 'scenarioSet', 'Set-level required drivers must exactly match the frozen horizon driver set.')
  const proposalKeys = new Set<string>()
  for (const proposal of set.proposals) {
    const key = `${proposal.scenario}|${proposal.driverId}`
    if (proposalKeys.has(key)) add('STRUCTURAL_INVALID', key, 'Duplicate proposal for scenario and driver.')
    proposalKeys.add(key)
    if (!nonEmpty(proposal.proposalId) || !nonEmpty(proposal.authorId) || !nonEmpty(proposal.mechanism) || !nonEmpty(proposal.falsifiableTrigger) || !nonEmpty(proposal.proposalVersion)) add('STRUCTURAL_INVALID', key, 'Proposal identity, mechanism, trigger and version must be explicit.')
    if (proposal.originKind !== 'RESEARCH_ASSUMPTION' || !Number.isInteger(proposal.targetFiscalYear) || proposal.targetFiscalYear !== horizon.targetFiscalYear || proposal.targetPeriodStart !== horizon.targetPeriodStart || proposal.targetPeriodEnd !== horizon.targetPeriodEnd || proposal.financialScope !== horizon.financialScope || proposal.currency !== horizon.currency) add('PERIOD_MISMATCH', key, 'Proposal must be an explicit research assumption on the common horizon, scope, currency and target period.')
    if (proposal.proposedValue !== null && !finiteNumber(proposal.proposedValue)) add('STRUCTURAL_INVALID', key, 'A supplied assumption value must be finite; validator never supplies a missing value.')
    if (!proposal.inputObservationRefs.length || proposal.inputObservationRefs.some((ref) => !observations.has(ref))) add('MISSING_REQUIRED_DRIVER', key, 'Proposal must reference existing observations; no value may be filled from adjacent evidence.')
    const driverInputs = proposal.inputObservationRefs.map((ref) => observations.get(ref)).filter((item): item is EconomicDriverObservation => item !== undefined)
    if (driverInputs.some((item) => item.companySymbol !== proposal.companySymbol || item.driverId !== proposal.driverId)) add('SCOPE_MISMATCH', key, 'Assumption inputs must belong to the same company and exact driver; source-ID presence alone does not prove relevance.')
    if (!proposal.counterEvidenceRefs.length || proposal.counterEvidenceRefs.some((ref) => !observations.has(ref))) add('MISSING_REQUIRED_DRIVER', key, 'Proposal must preserve located counter-evidence refs or remain incomplete.')
    if (!proposal.calibrationRefs.length || proposal.calibrationRefs.some((ref) => !observations.has(ref))) add('MISSING_REQUIRED_DRIVER', key, 'Calibration refs must resolve to explicit observations; historical envelope alone does not qualify a forecast.')
  }
  for (const scenario of set.scenarios) {
    if (scenario.companySymbol.length === 0 || scenario.companySymbol !== set.proposals[0]?.companySymbol || set.proposals.some((proposal) => proposal.companySymbol !== scenario.companySymbol) || !sameJson(scenario.horizon, horizon) || scenario.financialScope !== horizon.financialScope || scenario.currency !== horizon.currency || scenario.methodId !== horizon.methodId) add('SCOPE_MISMATCH', scenario.scenario, 'All cases must bind to the identical company, horizon, scope, currency and method.')
    if (!sameJson([...scenario.requiredDriverIds].sort(), required)) add('MISSING_REQUIRED_DRIVER', scenario.scenario, 'Every scenario must carry the complete same required driver set.')
    const expectedProposalRefs = [...set.proposals.filter((proposal) => proposal.scenario === scenario.scenario).map((proposal) => proposal.proposalId)].sort()
    if (!sameJson([...scenario.driverProposalRefs].sort(), expectedProposalRefs)) add('MISSING_REQUIRED_DRIVER', scenario.scenario, 'Bridge proposal refs must exactly cover this case’s proposal set.')
    const proposalDriverIds = set.proposals.filter((proposal) => proposal.scenario === scenario.scenario).map((proposal) => proposal.driverId).sort()
    if (!sameJson(proposalDriverIds, required)) add('MISSING_REQUIRED_DRIVER', scenario.scenario, 'Each case needs exactly one proposal for each required driver.')
    if (!scenario.driverObservationRefs.length || scenario.driverObservationRefs.some((ref) => !observations.has(ref))) add('MISSING_REQUIRED_DRIVER', scenario.scenario, 'Bridge observation refs must resolve; missing required inputs remain unavailable.')
    const bridgeDriverIds = scenario.driverObservationRefs.map((ref) => observations.get(ref)?.driverId).filter((id): id is string => id !== undefined).sort()
    if (!sameJson(bridgeDriverIds, required)) add('MISSING_REQUIRED_DRIVER', scenario.scenario, 'Bridge observation refs must cover each required driver exactly once.')
    if (scenario.residualPolicy === 'EXPLICIT' && !nonEmpty(scenario.residualDescription)) add('STRUCTURAL_INVALID', scenario.scenario, 'Explicit residual policy requires a description.')
    if (scenario.residualPolicy === 'UNAVAILABLE') errors.push(diagnostic('MISSING_REQUIRED_DRIVER', scenario.scenario, 'Unresolved bridge residual keeps this scenario unavailable.'))
    if (scenario.adjustments.some((item) => item.disposition === 'UNRESOLVED' || !item.evidenceRefs.length)) add('MISSING_REQUIRED_DRIVER', scenario.scenario, 'Every consolidation/non-recurring adjustment needs evidence refs and a resolved disposition.')
  }
  return errors
}

function normalizeObservationForHash(observation: EconomicDriverObservation): EconomicDriverObservation {
  const sourceConflicts = [...observation.sourceConflicts].sort(compareText)
  if (observation.kind === 'INFERENCE') return { ...observation, sourceConflicts, inferenceInputRefs: [...observation.inferenceInputRefs].sort(compareText) }
  // Operand refs preserve their original sequence for every operation. Even ADD/MULTIPLY
  // arithmetic commutes, but source identity/order is part of the reviewed evidence packet.
  if (observation.kind === 'DERIVED') return { ...observation, sourceConflicts, derivation: { ...observation.derivation, inputObservationIds: [...observation.derivation.inputObservationIds] } }
  if (observation.kind === 'MISSING') return { ...observation, sourceConflicts, missingFields: [...observation.missingFields].sort(compareText), rejectionReasons: [...observation.rejectionReasons].sort(compareText) }
  return { ...observation, sourceConflicts }
}

function normalizeScenarioSetForHash(set: BearBaseBullSet): BearBaseBullSet {
  const proposals = [...set.proposals].map((proposal) => ({
    ...proposal,
    calibrationRefs: [...proposal.calibrationRefs].sort(compareText),
    counterEvidenceRefs: [...proposal.counterEvidenceRefs].sort(compareText),
    inputObservationRefs: [...proposal.inputObservationRefs].sort(compareText),
  })).sort((left, right) => compareText(left.proposalId, right.proposalId))
  const scenarios = set.scenarios.map((scenario) => ({
    ...scenario,
    horizon: { ...scenario.horizon, requiredDriverIds: [...scenario.horizon.requiredDriverIds].sort(compareText) },
    requiredDriverIds: [...scenario.requiredDriverIds].sort(compareText),
    driverProposalRefs: [...scenario.driverProposalRefs].sort(compareText),
    driverObservationRefs: [...scenario.driverObservationRefs].sort(compareText),
    adjustments: [...scenario.adjustments].map((adjustment) => ({ ...adjustment, evidenceRefs: [...adjustment.evidenceRefs].sort(compareText) })).sort((left, right) => compareText(left.adjustmentId, right.adjustmentId)),
  })) as unknown as BearBaseBullSet['scenarios']
  return { scenarios, proposals, requiredDriverIds: [...set.requiredDriverIds].sort(compareText) }
}

function manifestPayload(observation: EconomicDriverObservation): PlainRecord {
  const normalized = normalizeObservationForHash(observation)
  const result: PlainRecord = { ...normalized }
  delete result.evidenceManifestHash
  if (normalized.kind === 'FACT' && normalized.valueVersionProof) {
    const proof: PlainRecord = { ...normalized.valueVersionProof }
    delete proof.evidenceManifestHash
    result.valueVersionProof = proof
  }
  return result
}

function makeInputHashes(input: ScenarioMethodContractInput): { evidenceManifestHash: Sha256; valueVersionProofSetHash: Sha256; reviewPacketHash: Sha256 } {
  const observations = [...input.observations].map(normalizeObservationForHash).sort((left, right) => compareText(left.observationId, right.observationId))
  const normalizedSet = normalizeScenarioSetForHash(input.scenarioSet)
  const proofSet = observations.flatMap((observation) => observation.kind === 'FACT' && observation.valueVersionProof ? [observation.valueVersionProof] : []).sort((left, right) => compareText(left.proofId, right.proofId))
  const proposals = normalizedSet.proposals
  const horizon = { ...input.horizon, requiredDriverIds: [...input.horizon.requiredDriverIds].sort(compareText) }
  const evidenceManifestHash = hashCanonicalScenarioValue({ schema: SCENARIO_METHOD_HASH_SCHEMA, horizon, observations: observations.map(manifestPayload) })
  const valueVersionProofSetHash = hashCanonicalScenarioValue({ schema: SCENARIO_METHOD_HASH_SCHEMA, proofSet })
  const reviewPacketHash = hashCanonicalScenarioValue({ schema: SCENARIO_METHOD_HASH_SCHEMA, contractVersion: SCENARIO_METHOD_CONTRACT_VERSION, horizon, observations, proposals, scenarioSet: normalizedSet, evidenceManifestHash, valueVersionProofSetHash, methodVersion: input.methodVersion, rubricVersion: input.rubricVersion })
  return { evidenceManifestHash, valueVersionProofSetHash, reviewPacketHash }
}

function validateScenarioMethodContractUnsafe(input: ScenarioMethodContractInput): ScenarioMethodResult {
  const diagnostics: ScenarioMethodDiagnostic[] = []
  diagnostics.push(...validateHorizon(input.horizon))
  if (!nonEmpty(input.methodVersion) || !nonEmpty(input.rubricVersion)) diagnostics.push(diagnostic('STRUCTURAL_INVALID', 'method', 'Method and rubric versions are required.'))
  let hashes: ReturnType<typeof makeInputHashes>
  try { hashes = makeInputHashes(input) } catch {
    diagnostics.push(diagnostic('STRUCTURAL_INVALID', 'hashes', 'Input contains a non-canonical value; review packet cannot be frozen.'))
    const invalidHash = hashCanonicalScenarioValue({ schema: SCENARIO_METHOD_HASH_SCHEMA, invalid: true })
    hashes = { evidenceManifestHash: invalidHash, valueVersionProofSetHash: invalidHash, reviewPacketHash: invalidHash }
  }
  const byId = new Map<string, EconomicDriverObservation>()
  for (const observation of input.observations) {
    if (byId.has(observation.observationId)) diagnostics.push(diagnostic('STRUCTURAL_INVALID', observation.observationId, 'Observation IDs must be unique.'))
    byId.set(observation.observationId, observation)
  }
  const assessments = input.observations.map((observation) => validateObservation(observation, input.horizon, byId, hashes.evidenceManifestHash))
  diagnostics.push(...assessments.flatMap((assessment) => assessment.diagnostics))
  diagnostics.push(...validateScenarioSet(input.scenarioSet, input.horizon, byId))
  const structuralInvalid = diagnostics.some((item) => item.code === 'STRUCTURAL_INVALID' || item.code === 'SOURCE_BINDING_MISMATCH' || item.code === 'DERIVATION_MISMATCH' || item.code === 'SCOPE_MISMATCH' || item.code === 'PERIOD_MISMATCH' || item.code === 'UNIT_MISMATCH')
  const hasUnavailable = diagnostics.some((item) => item.code === 'MISSING_REQUIRED_DRIVER' || item.code === 'HISTORICAL_CUTOFF_VIOLATION' || item.code === 'SOURCE_RIGHTS_UNVERIFIED' || item.code === 'SOURCE_LOCATION_UNVERIFIED' || item.code === 'CONFLICTED_EVIDENCE' || item.code === 'CLASS_PRICE_MISSING') || assessments.some((item) => item.eligibility === 'UNAVAILABLE' || item.valueVersionStatus === 'UNAVAILABLE' || item.valueVersionStatus === 'CONFLICTED')
  return {
    contractVersion: SCENARIO_METHOD_CONTRACT_VERSION,
    structuralStatus: structuralInvalid ? 'STRUCTURAL_INVALID' : 'STRUCTURALLY_VALID',
    methodStatus: structuralInvalid ? 'REJECTED' : hasUnavailable ? 'UNAVAILABLE' : 'REVIEW_REQUIRED',
    ...hashes,
    reportEligible: false,
    diagnostics,
    observationAssessments: assessments,
  }
}

/** Malformed runtime objects fail closed instead of escaping as exceptions. */
export function validateScenarioMethodContract(input: ScenarioMethodContractInput): ScenarioMethodResult {
  try {
    return validateScenarioMethodContractUnsafe(input)
  } catch {
    const invalidHash = hashCanonicalScenarioValue({ schema: SCENARIO_METHOD_HASH_SCHEMA, malformed: true })
    return {
      contractVersion: SCENARIO_METHOD_CONTRACT_VERSION,
      structuralStatus: 'STRUCTURAL_INVALID',
      methodStatus: 'REJECTED',
      evidenceManifestHash: invalidHash,
      valueVersionProofSetHash: invalidHash,
      reviewPacketHash: invalidHash,
      reportEligible: false,
      diagnostics: [diagnostic('STRUCTURAL_INVALID', 'input', 'Malformed runtime contract object rejected by fail-closed boundary.')],
      observationAssessments: [],
    }
  }
}

/** No independent reviewer is called here; only packet-hash freshness can be evaluated. */
export function validateReviewFreshness(review: AssumptionReviewRecord | null, currentReviewPacketHash: string): ScenarioReviewFreshness {
  const expected = parseScenarioSha256(currentReviewPacketHash) ?? hashCanonicalScenarioValue({ invalidReviewPacketHash: currentReviewPacketHash })
  if (!review) return { state: 'REVIEW_REQUIRED', staleFields: [], expectedReviewPacketHash: expected, actualReviewPacketHash: null }
  const actual = parseScenarioSha256(review.reviewPacketHash) ?? null
  const staleFields: string[] = []
  if (actual !== expected) staleFields.push('reviewPacketHash')
  if (review.state !== 'REVIEW_REQUIRED' && review.state !== 'UNAVAILABLE' && review.state !== 'REJECTED' && review.state !== 'STALE_REVIEW') staleFields.push('reviewState')
  if (staleFields.length || review.state === 'STALE_REVIEW') return { state: 'STALE_REVIEW', staleFields: staleFields.length ? staleFields : ['reviewState'], expectedReviewPacketHash: expected, actualReviewPacketHash: actual }
  return { state: 'REVIEW_REQUIRED', staleFields: [], expectedReviewPacketHash: expected, actualReviewPacketHash: actual }
}

export function getHistoricalTrustAnchorStatus(): { readonly configured: false; readonly reason: string } {
  return { configured: false, reason: 'No approved source-version or rights trust-anchor registry/verifier exists for this private Phase 1 slice.' }
}

function validateEquityMarketInputUnsafe(input: EquityMarketInput): EquityMarketAssessment {
  const diagnostics: ScenarioMethodDiagnostic[] = []
  const shareCountTreatments: EquityMarketAssessment['shareCountTreatments'][number][] = []
  const expected = [...input.expectedClassIds].sort()
  const actual = input.classes.map((item) => item.classId).sort()
  const missingClassIds = expected.filter((classId) => !actual.includes(classId))
  if (!sameJson(expected, actual) || new Set(actual).size !== actual.length) diagnostics.push(diagnostic('CLASS_PRICE_MISSING', 'equityMarket', `Every required share class must be represented exactly once; missing=${missingClassIds.join(',') || 'none'}.`, ['VALUATION', 'VARIANT_PERCEPTION']))
  if (input.mode !== 'FIXTURE_ONLY') diagnostics.push(diagnostic('STRUCTURAL_INVALID', 'equityMarket', 'Market value consistency checks accept fixture-only inputs in this phase.'))
  const asOf = instant(input.analysisAsOf)
  const marketDate = date(input.marketDate)
  const targetDate = date(input.targetDate)
  if (asOf === undefined || marketDate === undefined || targetDate === undefined) diagnostics.push(diagnostic('HISTORICAL_CUTOFF_VIOLATION', 'equityMarket', 'Fixture market, trading and target dates must be valid.', ['VALUATION', 'VARIANT_PERCEPTION']))
  for (const shareClass of input.classes) {
    const subject = shareClass.classId
    const issuedSharesRule = shareClass.issuedShareBasis === 'POST_CANCELLATION_ISSUED'
      ? 'USE_POST_CANCELLATION_AS_IS'
      : shareClass.issuedShareBasis === 'PRE_CANCELLATION_ISSUED' ? 'SUBTRACT_PROVEN_CANCELLATIONS' : 'UNAVAILABLE'
    const heldSharesRule = shareClass.treasuryIncludesRepurchasedShares === true
      ? 'SUBTRACT_TREASURY_ONCE'
      : shareClass.treasuryIncludesRepurchasedShares === false ? 'SUBTRACT_TREASURY_PLUS_NONOVERLAPPING_REPURCHASES' : 'UNAVAILABLE'
    shareCountTreatments.push({ classId: subject, issuedSharesRule, heldSharesRule, listedUnitConversionAppliedOnce: true, targetDilutedDenominatorSeparate: true })
    const quoteAt = instant(shareClass.closeAvailableAt)
    const fxAt = instant(shareClass.fxAvailableAt)
    const sharesAt = instant(shareClass.shareCountAvailableAt)
    if (shareClass.closePrice === null || !finiteNumber(shareClass.closePrice) || shareClass.closePrice <= 0 || quoteAt === undefined || (asOf !== undefined && quoteAt > asOf)) diagnostics.push(diagnostic('CLASS_PRICE_MISSING', subject, 'Same-cutoff positive class quote and availableAt are required.', ['VALUATION', 'VARIANT_PERCEPTION']))
    if (shareClass.closeTradingDate !== input.marketDate || localTradingDate(shareClass.closeAvailableAt, shareClass.closeTimeZone) !== input.marketDate) diagnostics.push(diagnostic('HISTORICAL_CUTOFF_VIOLATION', subject, 'Class quote must bind to the selected local exchange trading date and valid time zone.', ['VALUATION', 'VARIANT_PERCEPTION']))
    if (!nonEmpty(shareClass.listedSecurityUnit) || !finiteNumber(shareClass.underlyingSharesPerListedUnit) || shareClass.underlyingSharesPerListedUnit <= 0) diagnostics.push(diagnostic('CLASS_PRICE_MISSING', subject, 'Listed security unit and its underlying-share conversion ratio are required exactly once.', ['VALUATION', 'VARIANT_PERCEPTION']))
    if (!nonEmpty(shareClass.quoteCurrency) || !finiteNumber(shareClass.fxToReportingCurrency) || shareClass.fxToReportingCurrency <= 0 || fxAt === undefined || (asOf !== undefined && fxAt > asOf)) diagnostics.push(diagnostic('CLASS_PRICE_MISSING', subject, 'Same-cutoff FX quote, currency and availableAt are required.', ['VALUATION', 'VARIANT_PERCEPTION']))
    if (shareClass.fxTradingDate !== input.marketDate || localTradingDate(shareClass.fxAvailableAt, shareClass.fxTimeZone) !== input.marketDate) diagnostics.push(diagnostic('HISTORICAL_CUTOFF_VIOLATION', subject, 'FX point must bind to the selected market date and its declared time zone.', ['VALUATION', 'VARIANT_PERCEPTION']))
    if (!finiteNumber(shareClass.issuedShares) || shareClass.issuedShares <= 0 || shareClass.issuedShareBasis === 'UNKNOWN' || sharesAt === undefined || (asOf !== undefined && sharesAt > asOf) || shareClass.shareCountAsOf !== input.marketDate) diagnostics.push(diagnostic('CLASS_PRICE_MISSING', subject, 'As-of issued share count and its pre/post-cancellation basis are required.', ['VALUATION', 'VARIANT_PERCEPTION']))
    if (shareClass.issuedShareBasis === 'PRE_CANCELLATION_ISSUED' && (!finiteNumber(shareClass.cancelledShares) || shareClass.cancelledShares < 0 || shareClass.cancelledShares > (shareClass.issuedShares ?? 0) || instant(shareClass.cancellationEffectiveAt) === undefined || (asOf !== undefined && instant(shareClass.cancellationEffectiveAt)! > asOf))) diagnostics.push(diagnostic('CLASS_PRICE_MISSING', subject, 'Pre-cancellation issued share counts require proven cancellation quantity and effective time.', ['VALUATION', 'VARIANT_PERCEPTION']))
    if (!finiteNumber(shareClass.treasuryShares) || shareClass.treasuryShares < 0 || !finiteNumber(shareClass.repurchasedHeldShares) || shareClass.repurchasedHeldShares < 0 || shareClass.treasuryIncludesRepurchasedShares === null) diagnostics.push(diagnostic('CLASS_PRICE_MISSING', subject, 'Treasury and repurchased-held shares need explicit, non-overlapping statuses.', ['VALUATION', 'VARIANT_PERCEPTION']))
    if (!finiteNumber(shareClass.targetDateDilutedShares) || shareClass.targetDateDilutedShares <= 0 || shareClass.dilutedShareTargetDate !== input.targetDate || instant(shareClass.dilutedSharesAvailableAt) === undefined || (asOf !== undefined && instant(shareClass.dilutedSharesAvailableAt)! > asOf)) diagnostics.push(diagnostic('CLASS_PRICE_MISSING', subject, 'Target-date diluted EPS shares require a matching target date and cutoff-available basis; they remain separate from market-cap shares.', ['VALUATION']))
    if (!nonEmpty(shareClass.classRightsReference)) diagnostics.push(diagnostic('SCOPE_MISMATCH', subject, 'Share-class rights/conversion reference is missing.', ['VALUATION', 'VARIANT_PERCEPTION']))
  }
  if (!nonEmpty(input.reportingCurrency) || !nonEmpty(input.companyRightsAllocationReference)) diagnostics.push(diagnostic('SCOPE_MISMATCH', 'equityMarket', 'Reporting currency and company-level class allocation reference are required.', ['VALUATION', 'VARIANT_PERCEPTION']))
  const blocked = diagnostics.length > 0
  return { status: blocked ? 'UNAVAILABLE' : 'STRUCTURALLY_VALID_FIXTURE_ONLY', reportEligible: false, missingClassIds, shareCountTreatments, diagnostics }
}

export function validateEquityMarketInput(input: EquityMarketInput): EquityMarketAssessment {
  try { return validateEquityMarketInputUnsafe(input) } catch {
    return { status: 'UNAVAILABLE', reportEligible: false, missingClassIds: [], shareCountTreatments: [], diagnostics: [diagnostic('STRUCTURAL_INVALID', 'equityMarket', 'Malformed market/share object rejected by fail-closed boundary.', ['VALUATION', 'VARIANT_PERCEPTION'])] }
  }
}

function validateEnterpriseValueBridgeConsistencyUnsafe(input: EnterpriseValueBridgeConsistencyInput): readonly ScenarioMethodDiagnostic[] {
  const errors: ScenarioMethodDiagnostic[] = [...validateEquityMarketInput(input.market).diagnostics]
  const add = (code: ScenarioMethodDiagnosticCode, subject: string, reason: string): void => { errors.push(diagnostic(code, subject, reason, ['VALUATION'])) }
  const amount = (value: EnterpriseValueBridgeConsistencyInput['grossDebt']): number | undefined => {
    if (value.status === 'KNOWN' && finiteNumber(value.amount)) return value.amount
    if (value.status === 'KNOWN_ZERO') return 0
    return undefined
  }
  const amountValid = (value: EnterpriseValueBridgeConsistencyInput['grossDebt'], allowNegative = false): boolean => {
    if (value.status === 'KNOWN') return finiteNumber(value.amount) && (allowNegative || value.amount >= 0) && value.evidenceRefs.length > 0 && value.evidenceRefs.every(nonEmpty)
    if (value.status === 'KNOWN_ZERO') return value.evidenceRefs.length > 0 && value.evidenceRefs.every(nonEmpty)
    if (value.status === 'NOT_APPLICABLE') return nonEmpty(value.reason) && value.evidenceRefs.length > 0 && value.evidenceRefs.every(nonEmpty)
    return value.status === 'UNAVAILABLE' && nonEmpty(value.reason)
  }
  if (input.mode !== 'FIXTURE_ONLY') add('STRUCTURAL_INVALID', 'evBridge', 'EV consistency validation is fixture-only in this private phase.')
  const components = [input.grossDebt, input.netDebt, input.separatelySubtractedCash, input.leaseAmount, input.preferredAndConvertibleClaims, input.nonControllingClaims, input.otherSeniorClaims, input.totalEquityValue]
  if (components.some((item) => !amountValid(item))) add('MISSING_REQUIRED_DRIVER', 'evBridge', 'Every debt, cash and senior-claim component must be explicitly known, evidenced, not applicable, or unavailable; null is not zero.')
  const namedComponents = [
    ['grossDebt', input.grossDebt], ['netDebt', input.netDebt], ['separatelySubtractedCash', input.separatelySubtractedCash],
    ['leaseAmount', input.leaseAmount], ['preferredAndConvertibleClaims', input.preferredAndConvertibleClaims],
    ['nonControllingClaims', input.nonControllingClaims], ['otherSeniorClaims', input.otherSeniorClaims], ['totalEquityValue', input.totalEquityValue],
  ] as const
  for (const [name, value] of namedComponents) {
    if (value.status === 'UNAVAILABLE') add('MISSING_REQUIRED_DRIVER', name, `Required EV component ${name} is unavailable: ${value.reason}`)
  }
  if (input.debtBasis === 'GROSS_DEBT' && (amount(input.grossDebt) === undefined || input.netDebt.status !== 'NOT_APPLICABLE')) add('STRUCTURAL_INVALID', 'evBridge', 'Gross-debt EV basis requires known grossDebt and explicit netDebt NOT_APPLICABLE.')
  if (input.debtBasis === 'NET_DEBT' && (amount(input.netDebt) === undefined || input.grossDebt.status !== 'NOT_APPLICABLE' || input.separatelySubtractedCash.status !== 'NOT_APPLICABLE')) add('STRUCTURAL_INVALID', 'evBridge', 'Net-debt basis forbids adding gross debt or separately subtracting cash a second time.')
  if (input.leaseClaimsIncluded && (amount(input.leaseAmount) === undefined || input.leaseInEarningsBasis !== true)) add('STRUCTURAL_INVALID', 'evBridge', 'Lease claims require a matching lease-inclusive earnings basis and explicit amount.')
  if (input.leaseClaimsIncluded && input.grossDebtIncludesLeases !== false) add('STRUCTURAL_INVALID', 'evBridge', 'Lease liabilities already inside gross debt must not be counted as a separate lease claim.')
  if (!input.leaseClaimsIncluded && (input.leaseAmount.status !== 'NOT_APPLICABLE' || input.leaseInEarningsBasis !== false)) add('STRUCTURAL_INVALID', 'evBridge', 'Lease exclusion must be explicitly not applicable and consistent with the earnings basis.')
  if (new Set(input.adjustments.map((adjustment) => adjustment.adjustmentId)).size !== input.adjustments.length || input.adjustments.some((adjustment) => adjustment.disposition === 'UNRESOLVED' || !nonEmpty(adjustment.adjustmentId) || !nonEmpty(adjustment.description) || adjustment.evidenceRefs.length === 0 || adjustment.evidenceRefs.some((ref) => !nonEmpty(ref)))) add('MISSING_REQUIRED_DRIVER', 'evBridge', 'EV adjustments must be unique, evidenced and resolved exactly once.')
  const totalEquityValue = amount(input.totalEquityValue)
  if (!nonEmpty(input.classAllocationReference) || !input.allocatedClassEquityValues || totalEquityValue === undefined) add('SCOPE_MISMATCH', 'evBridge', 'Company equity must be explicitly allocated by class and reconciled to a known total equity value.')
  else {
    const classIds = input.market.expectedClassIds.slice().sort()
    const allocatedIds = Object.keys(input.allocatedClassEquityValues).sort()
    if (!sameJson(classIds, allocatedIds)) add('SCOPE_MISMATCH', 'evBridge', 'Allocated class equity values must cover the complete expected share-class set.')
    const allocations = Object.values(input.allocatedClassEquityValues)
    const numericAllocations = allocations.filter((value): value is number => finiteNumber(value))
    if (numericAllocations.length !== allocations.length || !close(numericAllocations.reduce((sum, value) => sum + value, 0), totalEquityValue)) add('SCOPE_MISMATCH', 'evBridge', 'Class equity allocations must reconcile to total company equity value.')
  }
  return errors
}

export function validateEnterpriseValueBridgeConsistency(input: EnterpriseValueBridgeConsistencyInput): readonly ScenarioMethodDiagnostic[] {
  try { return validateEnterpriseValueBridgeConsistencyUnsafe(input) } catch {
    return [diagnostic('STRUCTURAL_INVALID', 'evBridge', 'Malformed EV bridge rejected by fail-closed boundary.', ['VALUATION'])]
  }
}

/** Helper used by tests/review tooling to return stable, explicit status dimensions. */
export function preserveIndependentStatusDimensions(input: {
  readonly originKind: EconomicDriverObservation['originKind']
  readonly valueVersionStatus: 'VERIFIED' | 'UNVERIFIED' | 'UNAVAILABLE' | 'CONFLICTED' | 'NOT_APPLICABLE'
  readonly scopeMatchesConsumer: boolean
}): { readonly originKind: EconomicDriverObservation['originKind']; readonly valueVersionStatus: typeof input.valueVersionStatus; readonly eligibility: 'UNAVAILABLE' | 'UNVERIFIED' } {
  return {
    originKind: input.originKind,
    valueVersionStatus: input.valueVersionStatus,
    eligibility: input.scopeMatchesConsumer ? 'UNVERIFIED' : 'UNAVAILABLE',
  }
}

export function scenarioMethodReviewPacketHash(input: ScenarioMethodContractInput): Sha256 {
  return makeInputHashes(input).reviewPacketHash
}
