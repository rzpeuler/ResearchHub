import type { EntityRefV04, RawRefV04, RelationRefV04, SourceRefV04 } from '../schema/domain-v04.ts'
import { normalizeSemanticText } from '../registry/id-allocation.ts'
import { hashKnowledgeObject } from '../storage/canonical-hash.ts'

export const THEME_SCOPE_V04_LIMITS = {
  maxDecisionsPerBatch: 100,
  maxHistoryDecisions: 1000,
  maxBranchKeysPerDecision: 16,
  maxEvidencePerDecision: 16,
  maxCoverageGaps: 32,
  maxCoverageGapLength: 1024,
  maxJsonCharacters: 1_000_000,
  maxJsonUtf8Bytes: 1_000_000,
  maxJsonObjectKeyLength: 256,
  maxIndustryNameLength: 256,
  maxIdentityContextLength: 256,
  maxRationaleLength: 4000,
  maxLocatorLength: 2048,
} as const

export type ThemeScopeDecisionValueV04 = 'include' | 'exclude' | 'pending'
export type ThemeScopeIndustryRelationTypeV04 = 'upstream_of' | 'depends_on'
export type ThemeScopeFingerprintV04 = `sha256:${string}`
export type ThemeScopeDecisionIdV04 = `theme-scope-decision:${string}`

export interface ThemeScopeIndustryCandidateV04 {
  readonly kind: 'industry'
  readonly name: string
  /** Stable semantic qualifier for same-named industries, such as a market or taxonomy scope. */
  readonly identityContext?: string
  readonly canonicalRef?: EntityRefV04
}

export interface ThemeScopeRelationCandidateV04 {
  readonly kind: 'relation'
  readonly relationType: ThemeScopeIndustryRelationTypeV04
  readonly sourceFingerprint: ThemeScopeFingerprintV04
  readonly targetFingerprint: ThemeScopeFingerprintV04
  readonly canonicalRef?: RelationRefV04
}

export type ThemeScopeCandidateV04 = ThemeScopeIndustryCandidateV04 | ThemeScopeRelationCandidateV04

export interface ThemeScopeEvidenceV04 {
  readonly sourceRef: SourceRefV04
  readonly rawRef: RawRefV04
  readonly locator: string
}

export type ThemeScopeReviewV04 =
  | { readonly status: 'suggested' }
  | { readonly status: 'human_confirmed'; readonly confirmedAt: string }

export interface ThemeScopeReopenBasisV04 {
  readonly rationale: string
  /** New, source-backed evidence that is also present in the decision's evidence list. */
  readonly evidence: readonly ThemeScopeEvidenceV04[]
}

export interface ThemeScopeDecisionDraftV04 {
  readonly version: '0.4'
  readonly themeRef: EntityRefV04
  readonly candidate: ThemeScopeCandidateV04
  readonly candidateFingerprint: ThemeScopeFingerprintV04
  readonly decision: ThemeScopeDecisionValueV04
  readonly rationale: string
  readonly evidence: readonly ThemeScopeEvidenceV04[]
  readonly coverageGaps: readonly string[]
  readonly review: ThemeScopeReviewV04
  readonly basedOnRevision: number
  readonly previousDecisionId?: ThemeScopeDecisionIdV04
  readonly reopenBasis?: ThemeScopeReopenBasisV04
  readonly affectedBranchKeys: readonly string[]
}

export interface ThemeScopeDecisionV04 extends ThemeScopeDecisionDraftV04 {
  readonly id: ThemeScopeDecisionIdV04
}

export interface ThemeScopeDecisionBatchV04 {
  readonly version: '0.4'
  readonly themeRef: EntityRefV04
  readonly basedOnRevision: number
  readonly decisions: readonly ThemeScopeDecisionV04[]
}

export interface ThemeScopeValidationOptionsV04 {
  /** Complete, bounded append-only decision history needed to validate version/reopen links. */
  readonly previousDecisions?: readonly ThemeScopeDecisionV04[]
}

export interface ThemeScopeValidationIssueV04 {
  readonly code: string
  readonly message: string
  readonly decisionId?: string
}

export interface ThemeScopeValidationResultV04 {
  readonly valid: boolean
  readonly errors: readonly ThemeScopeValidationIssueV04[]
}

const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/
const DECISION_ID_PATTERN = /^theme-scope-decision:[a-f0-9]{64}$/
const SOURCE_REF_PATTERN = /^source:[A-Za-z0-9][A-Za-z0-9._-]{0,250}$/
const ENTITY_REF_PATTERN = /^entity:[A-Za-z0-9][A-Za-z0-9._-]{0,247}$/
const RELATION_REF_PATTERN = /^relation:[A-Za-z0-9][A-Za-z0-9._-]{0,246}$/
const RAW_REF_PATTERN = /^raw-sha256-[a-f0-9]{64}$/
const BRANCH_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/
const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isJsonOnly(value: unknown): boolean {
  const ancestors = new Set<object>()
  let nodes = 0
  let jsonCharacters = 0
  let jsonUtf8Bytes = 0
  const accountText = (text: string): boolean => {
    jsonCharacters += text.length
    jsonUtf8Bytes += Buffer.byteLength(text, 'utf8')
    return jsonCharacters <= THEME_SCOPE_V04_LIMITS.maxJsonCharacters
      && jsonUtf8Bytes <= THEME_SCOPE_V04_LIMITS.maxJsonUtf8Bytes
  }
  const visit = (item: unknown, depth: number): boolean => {
    nodes += 1
    if (nodes > 100000 || depth > 8) return false
    if (item === null || typeof item === 'boolean') return true
    if (typeof item === 'string') return item.length <= 8192 && accountText(item)
    if (typeof item === 'number') return Number.isFinite(item)
    if (typeof item !== 'object') return false
    if (ancestors.has(item)) return false
    ancestors.add(item)
    try {
      if (Array.isArray(item)) {
        if (item.length > 2048 || Reflect.ownKeys(item).some((key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key)))) return false
        if (Object.keys(item).length !== item.length) return false
        for (let index = 0; index < item.length; index += 1) {
          if (!(index in item) || !visit(item[index], depth + 1)) return false
        }
        return true
      }
      if (!isRecord(item) || Reflect.ownKeys(item).some((key) => typeof key !== 'string')) return false
      const keys = Reflect.ownKeys(item) as string[]
      for (const key of keys) {
        if (key.length > THEME_SCOPE_V04_LIMITS.maxJsonObjectKeyLength || !accountText(key)) return false
        const descriptor = Object.getOwnPropertyDescriptor(item, key)
        if (!descriptor?.enumerable || !('value' in descriptor) || !visit(descriptor.value, depth + 1)) return false
      }
      return true
    } finally {
      ancestors.delete(item)
    }
  }
  try {
    return visit(value, 0)
  } catch {
    return false
  }
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  const keys = Object.keys(value)
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => allowed.has(key))
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
}

function validIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_TIMESTAMP_PATTERN.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return false
  const [, year, month, day, hour, minute, second, zone] = match
  const parsedYear = Number(year)
  const parsedMonth = Number(month)
  const parsedDay = Number(day)
  const parsedHour = Number(hour)
  const parsedMinute = Number(minute)
  const parsedSecond = Number(second)
  const calendar = new Date(Date.UTC(parsedYear, parsedMonth - 1, parsedDay))
  if (calendar.getUTCFullYear() !== parsedYear || calendar.getUTCMonth() + 1 !== parsedMonth || calendar.getUTCDate() !== parsedDay) return false
  if (parsedHour > 23 || parsedMinute > 59 || parsedSecond > 59) return false
  if (zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3))
    const offsetMinute = Number(zone.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return false
  }
  return true
}

function evidenceKey(evidence: ThemeScopeEvidenceV04): string {
  return `${evidence.sourceRef}\u0000${evidence.rawRef}\u0000${evidence.locator}`
}

function fingerprint(value: unknown): value is ThemeScopeFingerprintV04 {
  return typeof value === 'string' && HASH_PATTERN.test(value)
}

function normalizeOptionalContext(value: string | undefined): string | null {
  return value === undefined ? null : normalizeSemanticText(value)
}

export function fingerprintThemeIndustryCandidateV04(input: Pick<ThemeScopeIndustryCandidateV04, 'name' | 'identityContext'>): ThemeScopeFingerprintV04 {
  return hashKnowledgeObject({
    version: '0.4',
    kind: 'industry',
    name: normalizeSemanticText(input.name),
    identityContext: normalizeOptionalContext(input.identityContext),
  }) as ThemeScopeFingerprintV04
}

export function fingerprintThemeRelationCandidateV04(input: Pick<ThemeScopeRelationCandidateV04, 'relationType' | 'sourceFingerprint' | 'targetFingerprint'>): ThemeScopeFingerprintV04 {
  return hashKnowledgeObject({
    version: '0.4',
    kind: 'relation',
    relationType: input.relationType,
    sourceFingerprint: input.sourceFingerprint,
    targetFingerprint: input.targetFingerprint,
  }) as ThemeScopeFingerprintV04
}

export function fingerprintThemeScopeCandidateV04(candidate: ThemeScopeCandidateV04): ThemeScopeFingerprintV04 {
  return candidate.kind === 'industry'
    ? fingerprintThemeIndustryCandidateV04(candidate)
    : fingerprintThemeRelationCandidateV04(candidate)
}

export function hashThemeScopeDecisionV04(draft: ThemeScopeDecisionDraftV04): string {
  return hashKnowledgeObject(draft)
}

export function createThemeScopeDecisionIdV04(draft: ThemeScopeDecisionDraftV04): ThemeScopeDecisionIdV04 {
  const digest = hashThemeScopeDecisionV04(draft).slice('sha256:'.length)
  return `theme-scope-decision:${digest}` as ThemeScopeDecisionIdV04
}

export function createThemeScopeDecisionV04(draft: ThemeScopeDecisionDraftV04): ThemeScopeDecisionV04 {
  return { ...draft, id: createThemeScopeDecisionIdV04(draft) }
}

function addIssue(errors: ThemeScopeValidationIssueV04[], code: string, message: string, decisionId?: string): void {
  errors.push(decisionId === undefined ? { code, message } : { code, message, decisionId })
}

function validateEvidenceList(value: unknown, label: string, errors: ThemeScopeValidationIssueV04[], decisionId?: string): value is ThemeScopeEvidenceV04[] {
  if (!Array.isArray(value) || value.length > THEME_SCOPE_V04_LIMITS.maxEvidencePerDecision) {
    addIssue(errors, 'THEME_SCOPE_EVIDENCE_BOUNDS', `${label} must be an array of at most ${THEME_SCOPE_V04_LIMITS.maxEvidencePerDecision} evidence items`, decisionId)
    return false
  }
  const seen = new Set<string>()
  let valid = true
  value.forEach((item, index) => {
    const path = `${label}[${index}]`
    if (!isRecord(item) || !hasExactKeys(item, ['sourceRef', 'rawRef', 'locator'])) {
      addIssue(errors, 'THEME_SCOPE_EVIDENCE_SHAPE', `${path} must contain only sourceRef, rawRef, and locator`, decisionId)
      valid = false
      return
    }
    if (typeof item.sourceRef !== 'string' || !SOURCE_REF_PATTERN.test(item.sourceRef) || item.sourceRef.includes('..')) {
      addIssue(errors, 'THEME_SCOPE_SOURCE_REF', `${path}.sourceRef is not a canonical Source reference`, decisionId)
      valid = false
    }
    if (typeof item.rawRef !== 'string' || !RAW_REF_PATTERN.test(item.rawRef)) {
      addIssue(errors, 'THEME_SCOPE_RAW_REF', `${path}.rawRef is not a canonical Raw reference`, decisionId)
      valid = false
    }
    if (!boundedText(item.locator, THEME_SCOPE_V04_LIMITS.maxLocatorLength)) {
      addIssue(errors, 'THEME_SCOPE_LOCATOR', `${path}.locator must be non-empty and at most ${THEME_SCOPE_V04_LIMITS.maxLocatorLength} characters`, decisionId)
      valid = false
    }
    if (typeof item.sourceRef === 'string' && typeof item.rawRef === 'string' && typeof item.locator === 'string') {
      const key = `${String(item.sourceRef)}\u0000${String(item.rawRef)}\u0000${String(item.locator)}`
      if (seen.has(key)) {
        addIssue(errors, 'THEME_SCOPE_EVIDENCE_DUPLICATE', `${path} duplicates an evidence binding`, decisionId)
        valid = false
      }
      seen.add(key)
    }
  })
  return valid
}

function validateCandidate(value: unknown, label: string, errors: ThemeScopeValidationIssueV04[], decisionId?: string): value is ThemeScopeCandidateV04 {
  if (!isRecord(value)) {
    addIssue(errors, 'THEME_SCOPE_CANDIDATE_SHAPE', `${label} must be an object`, decisionId)
    return false
  }
  if (value.kind === 'industry') {
    if (!hasExactKeys(value, ['kind', 'name'], ['identityContext', 'canonicalRef'])) {
      addIssue(errors, 'THEME_SCOPE_CANDIDATE_SHAPE', `${label} Industry candidate has unexpected or missing fields`, decisionId)
      return false
    }
    if (!boundedText(value.name, THEME_SCOPE_V04_LIMITS.maxIndustryNameLength)) {
      addIssue(errors, 'THEME_SCOPE_INDUSTRY_NAME', `${label}.name must be non-empty and at most ${THEME_SCOPE_V04_LIMITS.maxIndustryNameLength} characters`, decisionId)
      return false
    }
    if (Object.hasOwn(value, 'identityContext') && !boundedText(value.identityContext, THEME_SCOPE_V04_LIMITS.maxIdentityContextLength)) {
      addIssue(errors, 'THEME_SCOPE_IDENTITY_CONTEXT', `${label}.identityContext must be non-empty and at most ${THEME_SCOPE_V04_LIMITS.maxIdentityContextLength} characters`, decisionId)
      return false
    }
    if (Object.hasOwn(value, 'canonicalRef') && (typeof value.canonicalRef !== 'string' || !ENTITY_REF_PATTERN.test(value.canonicalRef) || value.canonicalRef.includes('..'))) {
      addIssue(errors, 'THEME_SCOPE_CANONICAL_REF', `${label}.canonicalRef must be a canonical Entity reference`, decisionId)
      return false
    }
    return true
  }
  if (value.kind === 'relation') {
    if (!hasExactKeys(value, ['kind', 'relationType', 'sourceFingerprint', 'targetFingerprint'], ['canonicalRef'])) {
      addIssue(errors, 'THEME_SCOPE_CANDIDATE_SHAPE', `${label} Relation candidate has unexpected or missing fields`, decisionId)
      return false
    }
    if (value.relationType !== 'upstream_of' && value.relationType !== 'depends_on') {
      addIssue(errors, 'THEME_SCOPE_RELATION_TYPE', `${label}.relationType must be a directed Industry-to-Industry relation type`, decisionId)
      return false
    }
    if (!fingerprint(value.sourceFingerprint) || !fingerprint(value.targetFingerprint) || value.sourceFingerprint === value.targetFingerprint) {
      addIssue(errors, 'THEME_SCOPE_RELATION_ENDPOINT', `${label} must have distinct, valid directed Industry endpoint fingerprints`, decisionId)
      return false
    }
    if (Object.hasOwn(value, 'canonicalRef') && (typeof value.canonicalRef !== 'string' || !RELATION_REF_PATTERN.test(value.canonicalRef) || value.canonicalRef.includes('..'))) {
      addIssue(errors, 'THEME_SCOPE_CANONICAL_REF', `${label}.canonicalRef must be a canonical Relation reference`, decisionId)
      return false
    }
    return true
  }
  addIssue(errors, 'THEME_SCOPE_CANDIDATE_KIND', `${label}.kind must be industry or relation`, decisionId)
  return false
}

function validateBranchKeys(value: unknown, label: string, errors: ThemeScopeValidationIssueV04[], decisionId?: string): value is string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > THEME_SCOPE_V04_LIMITS.maxBranchKeysPerDecision || value.some((item) => typeof item !== 'string' || !BRANCH_KEY_PATTERN.test(item) || item.includes('..'))) {
    addIssue(errors, 'THEME_SCOPE_BRANCH_KEYS', `${label} must contain 1 to ${THEME_SCOPE_V04_LIMITS.maxBranchKeysPerDecision} safe branch keys`, decisionId)
    return false
  }
  if ([...value].sort().some((key, index) => key !== value[index])) {
    addIssue(errors, 'THEME_SCOPE_BRANCH_ORDER', `${label} must be sorted in lexical order`, decisionId)
    return false
  }
  if (new Set(value).size !== value.length) {
    addIssue(errors, 'THEME_SCOPE_BRANCH_DUPLICATE', `${label} must not contain duplicate keys`, decisionId)
    return false
  }
  return true
}

function validateCoverageGaps(value: unknown, label: string, errors: ThemeScopeValidationIssueV04[], decisionId?: string): value is string[] {
  if (!Array.isArray(value) || value.length > THEME_SCOPE_V04_LIMITS.maxCoverageGaps) {
    addIssue(errors, 'THEME_SCOPE_COVERAGE_GAPS_BOUNDS', `${label} must be an array of at most ${THEME_SCOPE_V04_LIMITS.maxCoverageGaps} gap descriptions`, decisionId)
    return false
  }
  let valid = true
  value.forEach((gap, index) => {
    if (!boundedText(gap, THEME_SCOPE_V04_LIMITS.maxCoverageGapLength)) {
      addIssue(errors, 'THEME_SCOPE_COVERAGE_GAP', `${label}[${index}] must be non-empty and at most ${THEME_SCOPE_V04_LIMITS.maxCoverageGapLength} characters`, decisionId)
      valid = false
    }
  })
  return valid
}

function validateDecisionShape(value: unknown, label: string, errors: ThemeScopeValidationIssueV04[]): value is ThemeScopeDecisionV04 {
  if (!isRecord(value) || !hasExactKeys(value,
    ['id', 'version', 'themeRef', 'candidate', 'candidateFingerprint', 'decision', 'rationale', 'evidence', 'coverageGaps', 'review', 'basedOnRevision', 'affectedBranchKeys'],
    ['previousDecisionId', 'reopenBasis'])) {
    addIssue(errors, 'THEME_SCOPE_DECISION_SHAPE', `${label} has unexpected or missing fields`)
    return false
  }
  const id = typeof value.id === 'string' ? value.id : undefined
  const at = (code: string, message: string) => addIssue(errors, code, message, id)
  let valid = true
  if (typeof value.id !== 'string' || !DECISION_ID_PATTERN.test(value.id)) { at('THEME_SCOPE_DECISION_ID', `${label}.id must be a content-derived Theme scope decision ID`); valid = false }
  if (value.version !== '0.4') { at('THEME_SCOPE_VERSION', `${label}.version must be 0.4`); valid = false }
  if (typeof value.themeRef !== 'string' || !ENTITY_REF_PATTERN.test(value.themeRef) || value.themeRef.includes('..')) { at('THEME_SCOPE_THEME_REF', `${label}.themeRef must be a canonical Theme Entity reference`); valid = false }
  const candidateValid = validateCandidate(value.candidate, `${label}.candidate`, errors, id)
  valid &&= candidateValid
  if (typeof value.candidateFingerprint !== 'string' || !fingerprint(value.candidateFingerprint)) {
    at('THEME_SCOPE_FINGERPRINT', `${label}.candidateFingerprint must be a sha256 fingerprint`)
    valid = false
  } else if (candidateValid && fingerprintThemeScopeCandidateV04(value.candidate as ThemeScopeCandidateV04) !== value.candidateFingerprint) {
    at('THEME_SCOPE_FINGERPRINT_MISMATCH', `${label}.candidateFingerprint does not match the candidate's semantic identity`)
    valid = false
  }
  if (value.decision !== 'include' && value.decision !== 'exclude' && value.decision !== 'pending') { at('THEME_SCOPE_DECISION_VALUE', `${label}.decision must be include, exclude, or pending`); valid = false }
  if (!boundedText(value.rationale, THEME_SCOPE_V04_LIMITS.maxRationaleLength)) { at('THEME_SCOPE_RATIONALE', `${label}.rationale must be non-empty and at most ${THEME_SCOPE_V04_LIMITS.maxRationaleLength} characters`); valid = false }
  const evidenceValid = validateEvidenceList(value.evidence, `${label}.evidence`, errors, id)
  valid &&= evidenceValid
  if (value.decision === 'include' && Array.isArray(value.evidence) && value.evidence.length === 0) { at('THEME_SCOPE_INCLUDE_EVIDENCE', `${label} include decision requires source-backed evidence`); valid = false }
  const coverageGapsValid = validateCoverageGaps(value.coverageGaps, `${label}.coverageGaps`, errors, id)
  valid &&= coverageGapsValid
  if (!isRecord(value.review)) {
    at('THEME_SCOPE_REVIEW', `${label}.review must be an object`)
    valid = false
  } else if (value.review.status === 'suggested') {
    if (!hasExactKeys(value.review, ['status'])) { at('THEME_SCOPE_REVIEW', `${label}.review suggested status cannot have confirmation metadata`); valid = false }
  } else if (value.review.status === 'human_confirmed') {
    if (!hasExactKeys(value.review, ['status', 'confirmedAt']) || !validIsoTimestamp(value.review.confirmedAt)) { at('THEME_SCOPE_REVIEW_TIME', `${label}.review human confirmation requires a valid ISO timestamp`); valid = false }
  } else { at('THEME_SCOPE_REVIEW', `${label}.review.status must be suggested or human_confirmed`); valid = false }
  if (!Number.isSafeInteger(value.basedOnRevision) || Number(value.basedOnRevision) < 0) { at('THEME_SCOPE_REVISION', `${label}.basedOnRevision must be a non-negative safe integer`); valid = false }
  if (Object.hasOwn(value, 'previousDecisionId') && (typeof value.previousDecisionId !== 'string' || !DECISION_ID_PATTERN.test(value.previousDecisionId) || value.previousDecisionId === value.id)) { at('THEME_SCOPE_PREVIOUS_ID', `${label}.previousDecisionId must reference a different Theme scope decision ID`); valid = false }
  if (Object.hasOwn(value, 'reopenBasis')) {
    const basis = value.reopenBasis
    if (!isRecord(basis) || !hasExactKeys(basis, ['rationale', 'evidence']) || !boundedText(basis.rationale, THEME_SCOPE_V04_LIMITS.maxRationaleLength)) {
      at('THEME_SCOPE_REOPEN_BASIS', `${label}.reopenBasis requires a bounded rationale and evidence list`)
      valid = false
    } else {
      const reopenEvidenceValid = validateEvidenceList(basis.evidence, `${label}.reopenBasis.evidence`, errors, id)
      valid &&= reopenEvidenceValid
      if (!Array.isArray(basis.evidence) || basis.evidence.length === 0) { at('THEME_SCOPE_REOPEN_BASIS', `${label}.reopenBasis must contain new evidence`); valid = false }
    }
  }
  const branchesValid = validateBranchKeys(value.affectedBranchKeys, `${label}.affectedBranchKeys`, errors, id)
  valid &&= branchesValid
  if (valid) {
    const { id: _id, ...draft } = value as unknown as ThemeScopeDecisionV04
    if (createThemeScopeDecisionIdV04(draft) !== value.id) { at('THEME_SCOPE_DECISION_ID_MISMATCH', `${label}.id does not match the decision content`); valid = false }
  }
  return valid
}

function sortedUnion(...keys: readonly (readonly string[])[]): string[] {
  return [...new Set(keys.flat())].sort()
}

function validateHistory(history: unknown, errors: ThemeScopeValidationIssueV04[]): history is ThemeScopeDecisionV04[] {
  if (!Array.isArray(history) || history.length > THEME_SCOPE_V04_LIMITS.maxHistoryDecisions) {
    addIssue(errors, 'THEME_SCOPE_HISTORY_SHAPE', `previousDecisions must be an array of at most ${THEME_SCOPE_V04_LIMITS.maxHistoryDecisions} records`)
    return false
  }
  const ids = new Set<string>()
  let valid = true
  for (const [index, item] of history.entries()) {
    if (!validateDecisionShape(item, `previousDecisions[${index}]`, errors)) valid = false
    if (isRecord(item) && typeof item.id === 'string') {
      if (ids.has(item.id)) { addIssue(errors, 'THEME_SCOPE_HISTORY_DUPLICATE_ID', `previousDecisions contains duplicate ID ${item.id}`, item.id); valid = false }
      ids.add(item.id)
    }
  }
  const byId = new Map(history.filter(isRecord).filter((item) => typeof item.id === 'string').map((item) => [String(item.id), item]))
  const children = new Set<string>()
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const item of history) {
    if (!isRecord(item) || typeof item.themeRef !== 'string' || typeof item.candidateFingerprint !== 'string') continue
    const key = `${item.themeRef}\u0000${item.candidateFingerprint}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }
  for (const item of history) {
    if (!isRecord(item)) continue
    if (typeof item.previousDecisionId !== 'string') continue
    const previous = byId.get(item.previousDecisionId)
    if (!previous) {
      addIssue(errors, 'THEME_SCOPE_HISTORY_PREVIOUS_MISSING', `previousDecisions entry ${String(item.id)} points outside the supplied complete history`, typeof item.id === 'string' ? item.id : undefined)
      valid = false
      continue
    }
    if (children.has(item.previousDecisionId)) { addIssue(errors, 'THEME_SCOPE_HISTORY_FORK', `previousDecisions contains multiple successors for ${item.previousDecisionId}`, item.previousDecisionId); valid = false }
    children.add(item.previousDecisionId)
    if (item.themeRef !== previous.themeRef || item.candidateFingerprint !== previous.candidateFingerprint || Number(item.basedOnRevision) < Number(previous.basedOnRevision)) {
      addIssue(errors, 'THEME_SCOPE_HISTORY_LINK', `previousDecisions contains a cross-candidate, cross-theme, or backward-revision link`, typeof item.id === 'string' ? item.id : undefined)
      valid = false
    }
  }
  for (const [key, group] of groups) {
    const roots = group.filter((item) => item.previousDecisionId === undefined)
    if (roots.length !== 1) {
      addIssue(errors, 'THEME_SCOPE_HISTORY_ROOT_COUNT', `Complete history for ${key.replace('\u0000', '/')} must have exactly one root decision`)
      valid = false
      continue
    }
    const root = roots[0]
    if (!root || typeof root.id !== 'string') continue
    const reached = new Set<string>([root.id])
    let changed = true
    while (changed) {
      changed = false
      for (const item of group) {
        if (typeof item.id !== 'string' || typeof item.previousDecisionId !== 'string' || reached.has(item.id)) continue
        if (reached.has(item.previousDecisionId)) { reached.add(item.id); changed = true }
      }
    }
    if (group.some((item) => typeof item.id === 'string' && !reached.has(item.id))) {
      addIssue(errors, 'THEME_SCOPE_HISTORY_ORPHAN', `Complete history for ${key.replace('\u0000', '/')} contains a disconnected decision`)
      valid = false
    }
  }
  return valid
}

function validateHistoryTransition(decision: ThemeScopeDecisionV04, history: readonly ThemeScopeDecisionV04[], errors: ThemeScopeValidationIssueV04[]): void {
  const id = decision.id
  const candidateHistory = history.filter((prior) => prior.themeRef === decision.themeRef && prior.candidateFingerprint === decision.candidateFingerprint)
  const previousId = decision.previousDecisionId
  if (candidateHistory.length === 0 && previousId === undefined) {
    if (decision.reopenBasis !== undefined) addIssue(errors, 'THEME_SCOPE_REOPEN_WITHOUT_HISTORY', 'reopenBasis requires a previous excluded decision', id)
    return
  }
  if (previousId === undefined) {
    addIssue(errors, 'THEME_SCOPE_PREVIOUS_REQUIRED', 'A versioned decision must link to the current prior decision for this candidate', id)
    return
  }
  const prior = history.find((item) => item.id === previousId)
  if (!prior) {
    addIssue(errors, 'THEME_SCOPE_PREVIOUS_MISSING', 'previousDecisionId must resolve in the supplied decision history', id)
    if (decision.reopenBasis !== undefined) addIssue(errors, 'THEME_SCOPE_REOPEN_WITHOUT_HISTORY', 'reopenBasis requires a previous excluded decision', id)
    return
  }
  if (prior.themeRef !== decision.themeRef || prior.candidateFingerprint !== decision.candidateFingerprint) {
    addIssue(errors, 'THEME_SCOPE_PREVIOUS_CANDIDATE', 'previousDecisionId must reference the same Theme and candidate', id)
  }
  if (decision.basedOnRevision < prior.basedOnRevision) addIssue(errors, 'THEME_SCOPE_REVISION_REGRESSION', 'basedOnRevision cannot precede the prior decision revision', id)
  if (candidateHistory.some((item) => item.id !== prior.id && item.previousDecisionId === prior.id)) addIssue(errors, 'THEME_SCOPE_PREVIOUS_NOT_HEAD', 'previousDecisionId must reference the current decision head', id)
  if (prior.decision === 'exclude') {
    if (decision.decision === 'exclude') {
      if (decision.reopenBasis !== undefined) addIssue(errors, 'THEME_SCOPE_REOPEN_STILL_EXCLUDED', 'An excluded candidate can be reopened only by an include or pending decision', id)
      return
    }
    const basis = decision.reopenBasis
    if (!basis) {
      addIssue(errors, 'THEME_SCOPE_REOPEN_BASIS_REQUIRED', 'Changing an excluded decision requires an explicit new-evidence reopenBasis', id)
      return
    }
    if (basis.evidence.some((item) => !decision.evidence.some((current) => evidenceKey(current) === evidenceKey(item)))) {
      addIssue(errors, 'THEME_SCOPE_REOPEN_EVIDENCE_MISSING', 'Every reopenBasis evidence item must be present in decision evidence', id)
    }
    if (!basis.evidence.some((item) => !prior.evidence.some((old) => evidenceKey(old) === evidenceKey(item)))) {
      addIssue(errors, 'THEME_SCOPE_REOPEN_NO_NEW_EVIDENCE', 'reopenBasis must cite at least one evidence binding absent from the excluded decision', id)
    }
  } else if (decision.reopenBasis !== undefined) {
    addIssue(errors, 'THEME_SCOPE_REOPEN_NOT_EXCLUDED', 'reopenBasis is only valid when the previous decision excluded the candidate', id)
  }
}

export function validateThemeScopeDecisionBatchV04(value: unknown, options: ThemeScopeValidationOptionsV04 = {}): ThemeScopeValidationResultV04 {
  const errors: ThemeScopeValidationIssueV04[] = []
  if (!isJsonOnly(value) || !isJsonOnly(options)) {
    addIssue(errors, 'THEME_SCOPE_JSON_ONLY', 'Theme scope batch and validation context must contain bounded JSON values only')
    return { valid: false, errors }
  }
  if (!isRecord(options) || !hasExactKeys(options, [], ['previousDecisions'])) {
    addIssue(errors, 'THEME_SCOPE_OPTIONS_SHAPE', 'Validation options may contain only previousDecisions')
    return { valid: false, errors }
  }
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'themeRef', 'basedOnRevision', 'decisions'])) {
    addIssue(errors, 'THEME_SCOPE_BATCH_SHAPE', 'Batch must contain only version, themeRef, basedOnRevision, and decisions')
    return { valid: false, errors }
  }
  if (value.version !== '0.4') addIssue(errors, 'THEME_SCOPE_VERSION', 'Batch version must be 0.4')
  if (typeof value.themeRef !== 'string' || !ENTITY_REF_PATTERN.test(value.themeRef) || value.themeRef.includes('..')) addIssue(errors, 'THEME_SCOPE_THEME_REF', 'Batch themeRef must be a canonical Theme Entity reference')
  if (!Number.isSafeInteger(value.basedOnRevision) || Number(value.basedOnRevision) < 0) addIssue(errors, 'THEME_SCOPE_REVISION', 'Batch basedOnRevision must be a non-negative safe integer')
  if (!Array.isArray(value.decisions) || value.decisions.length < 1 || value.decisions.length > THEME_SCOPE_V04_LIMITS.maxDecisionsPerBatch) {
    addIssue(errors, 'THEME_SCOPE_BATCH_BOUNDS', `Batch must contain 1 to ${THEME_SCOPE_V04_LIMITS.maxDecisionsPerBatch} decisions`)
    return { valid: false, errors }
  }

  const history = options.previousDecisions ?? []
  const historyValid = validateHistory(history, errors)
  const decisions: ThemeScopeDecisionV04[] = []
  value.decisions.forEach((item, index) => {
    if (!validateDecisionShape(item, `decisions[${index}]`, errors)) return
    const decision = item as unknown as ThemeScopeDecisionV04
    decisions.push(decision)
    if (decision.themeRef !== value.themeRef) addIssue(errors, 'THEME_SCOPE_BATCH_THEME_MISMATCH', 'Every decision in a batch must use the batch themeRef', decision.id)
    if (decision.basedOnRevision !== value.basedOnRevision) addIssue(errors, 'THEME_SCOPE_BATCH_REVISION_MISMATCH', 'Every decision in a batch must use the batch basedOnRevision', decision.id)
  })

  const fingerprints = new Set<string>()
  const canonicalRefs = new Set<string>()
  const industries = new Map<string, ThemeScopeDecisionV04>()
  for (const decision of decisions) {
    if (fingerprints.has(decision.candidateFingerprint)) addIssue(errors, 'THEME_SCOPE_FINGERPRINT_DUPLICATE', 'Batch contains an ambiguous duplicate candidate fingerprint', decision.id)
    fingerprints.add(decision.candidateFingerprint)
    const canonicalRef = decision.candidate.canonicalRef
    if (canonicalRef !== undefined) {
      if (canonicalRefs.has(canonicalRef)) addIssue(errors, 'THEME_SCOPE_CANONICAL_REF_DUPLICATE', 'Batch binds one canonical ref to multiple candidates', decision.id)
      canonicalRefs.add(canonicalRef)
    }
    if (decision.candidate.kind === 'industry') industries.set(decision.candidateFingerprint, decision)
    if (historyValid) validateHistoryTransition(decision, history, errors)
  }

  for (const decision of decisions) {
    if (decision.candidate.kind !== 'relation') continue
    const source = industries.get(decision.candidate.sourceFingerprint)
    const target = industries.get(decision.candidate.targetFingerprint)
    const presentEndpoints = [source, target].filter((node): node is ThemeScopeDecisionV04 => node !== undefined)
    const endpointBranches = sortedUnion(...presentEndpoints.map((node) => node.affectedBranchKeys))
    if (endpointBranches.length > 0 && !endpointBranches.every((key) => decision.affectedBranchKeys.includes(key))) {
      addIssue(errors, 'THEME_SCOPE_RELATION_BRANCH_MISMATCH', 'Relation affectedBranchKeys must include every branch of same-batch endpoints', decision.id)
    }
    if (decision.decision === 'include' && presentEndpoints.some((node) => node.decision !== 'include')) {
      addIssue(errors, 'THEME_SCOPE_RELATION_ENDPOINT_DECISION', 'An included relation requires both endpoint Industry decisions to be included', decision.id)
    }
    if (decision.decision === 'include' && decision.review.status === 'human_confirmed' && presentEndpoints.some((node) => node.review.status !== 'human_confirmed')) {
      addIssue(errors, 'THEME_SCOPE_RELATION_ENDPOINT_REVIEW', 'A human-confirmed relation include requires human-confirmed included endpoints', decision.id)
    }
  }

  if (!historyValid) {
    // Keep the detailed history diagnostics already collected.
  }
  return { valid: errors.length === 0, errors }
}
