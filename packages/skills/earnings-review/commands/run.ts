import { assertNonEmptyString, assertTimestamp, createEvidence, normalizeSymbol } from '../../shared/research-report.ts'
import type { EarningsMetricSet, EarningsReviewInput, EarningsReviewPlugins, EarningsReviewResult, EarningsReviewSection, EarningsSnapshot, EarningsVariance } from '../types.ts'

const metrics: (keyof EarningsMetricSet)[] = ['revenue', 'eps', 'grossMargin', 'operatingMargin']

export async function runEarningsReviewCommand(input: EarningsReviewInput, plugins: EarningsReviewPlugins): Promise<EarningsReviewResult> {
  const normalized = validateInput(input)
  const snapshot = await plugins.earnings.get_earnings_snapshot({ symbol: normalized.symbol, period: normalized.period })
  validateSnapshot(snapshot, normalized.symbol, normalized.period)
  const variances = metrics.map((metric) => compareMetric(metric, snapshot.actual, snapshot.consensus))
  const evidence = [createEvidence('earnings-snapshot-1', snapshot.source, snapshot.asOf, `${normalized.companyName} ${normalized.period} earnings snapshot`, snapshot)]
  const sections: EarningsReviewSection[] = [
    makeSection('results-snapshot', 'Results Snapshot', ['Show actual revenue, EPS, margins, and the reporting period before interpretation.']),
    makeSection('beat-miss', 'Beat / Miss Analysis', ['Quantify each available variance and explain which operating factor caused it.']),
    makeSection('guidance', 'Guidance and Estimates', [`Guidance was ${snapshot.guidance}; record any change to forward estimates and the reason for it.`]),
    makeSection('thesis-impact', 'Thesis Impact', ['State whether the new evidence strengthens, weakens, leaves unchanged, or fails to determine the existing thesis.']),
    makeSection('sources', 'Sources', ['Every metric and chart must retain the earnings source and as-of date.']),
  ]
  const available = variances.filter((item) => item.status !== 'unavailable')
  const beatCount = available.filter((item) => item.status === 'beat').length
  const missCount = available.filter((item) => item.status === 'miss').length
  const thesisImpact = beatCount > missCount ? 'positive' : missCount > beatCount ? 'negative' : available.length === 0 ? 'undetermined' : 'neutral'
  return {
    skillId: 'earnings-review',
    subject: `${normalized.companyName} ${normalized.period}`,
    asOf: normalized.asOf,
    template: 'earnings-review-report',
    sections: sections.map((section) => ({ ...section, evidenceIds: evidence.map((item) => item.id) })),
    evidence,
    keyRisks: ['Consensus data may be incomplete or stale.', 'A single quarter does not by itself establish a durable change in the thesis.'],
    openQuestions: ['Which guidance, estimate, or operating assumption should be reviewed next?'],
    variances,
    guidance: snapshot.guidance,
    thesisImpact,
  }
}

function compareMetric(metric: keyof EarningsMetricSet, actual: EarningsMetricSet, consensus?: EarningsMetricSet): EarningsVariance {
  const actualValue = actual[metric]
  const consensusValue = consensus?.[metric]
  if (actualValue === undefined || consensusValue === undefined) return { metric, actual: actualValue, consensus: consensusValue, status: 'unavailable' }
  const variance = actualValue - consensusValue
  return { metric, actual: actualValue, consensus: consensusValue, variance, status: Math.abs(variance) < 1e-9 ? 'inline' : variance > 0 ? 'beat' : 'miss' }
}

function makeSection(id: EarningsReviewSection['id'], title: string, findings: string[]): EarningsReviewSection {
  return { id, title, findings, evidenceIds: [] }
}

function validateInput(input: EarningsReviewInput): EarningsReviewInput & { symbol: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('earnings review input must be an object')
  const value = input as unknown as Record<string, unknown>
  assertNonEmptyString(value.companyName, '$.companyName')
  assertNonEmptyString(value.period, '$.period')
  assertTimestamp(value.asOf, '$.asOf')
  return { symbol: normalizeSymbol(value.symbol, '$.symbol'), companyName: value.companyName.trim(), period: value.period.trim(), asOf: value.asOf }
}

function validateSnapshot(snapshot: EarningsSnapshot, symbol: string, period: string): void {
  if (snapshot === null || typeof snapshot !== 'object') throw new TypeError('earnings Plugin returned an invalid snapshot')
  if (snapshot.symbol !== symbol || snapshot.period !== period) throw new TypeError('earnings snapshot does not match the request')
  assertTimestamp(snapshot.asOf, '$.snapshot.asOf')
  if (!['raised', 'maintained', 'lowered', 'not-provided'].includes(snapshot.guidance)) throw new TypeError('earnings snapshot guidance is invalid')
}
