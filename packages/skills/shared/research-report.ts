export interface ResearchEvidence {
  id: string
  source: string
  asOf: string
  claim: string
  details: Record<string, unknown>
  confidence: number
}

export interface ResearchSection {
  id: string
  title: string
  findings: string[]
  evidenceIds: string[]
}

export interface ResearchReport {
  skillId: string
  subject: string
  asOf: string
  template: string
  sections: ResearchSection[]
  evidence: ResearchEvidence[]
  keyRisks: string[]
  openQuestions: string[]
}

export function createEvidence(
  id: string,
  source: string,
  asOf: string,
  claim: string,
  details: object,
  confidence = 0.7,
): ResearchEvidence {
  if (!id || !source || !asOf || !claim) throw new TypeError('research evidence requires id, source, asOf, and claim')
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new RangeError('research evidence confidence must be between 0 and 1')
  return { id, source, asOf, claim, details: details as Record<string, unknown>, confidence }
}

export function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${path} must be a non-empty string`)
}

export function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertNonEmptyString(value, path)
  if (!value.includes('T') || Number.isNaN(Date.parse(value))) throw new TypeError(`${path} must be an ISO timestamp`)
}

export function normalizeSymbol(value: unknown, path: string): string {
  assertNonEmptyString(value, path)
  const symbol = value.trim().toUpperCase()
  if (!/^\d{6}$/.test(symbol)) throw new TypeError(`${path} must be a six-digit symbol`)
  return symbol
}
