import assert from 'node:assert/strict'
import test from 'node:test'
import type { AcquisitionAttempt, AcquisitionSourceMetadata, DataRequirement } from '../../data/contracts.ts'
import type { ThesisRedTeamDataResolverContext, ThesisRedTeamWorkflowInput } from '../../workflows/thesis-red-team/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { qualifyRedTeamEvidenceSet } from '../../skills/thesis-red-team/skill.ts'
import { acquireThesisRedTeamEvidence } from '../../workflows/thesis-red-team/workflow.ts'

const NOW = '2026-09-10T00:00:00.000Z'
const sourceMetadata = (sourceId: string, provider: string): AcquisitionSourceMetadata => ({ sourceId, fallbackLevel: 'PRIMARY', originAuthority: provider === 'CNINFO' ? 'S0_STATUTORY' : 'S3_AGGREGATOR', retrievalProvider: provider, retrievedAt: NOW })
const attempt = (sourceId: string, status: AcquisitionAttempt['status']): AcquisitionAttempt => ({ sourceId, fallbackLevel: 'PRIMARY', status, startedAt: NOW, completedAt: NOW, ...(status === 'SOURCE_ERROR' ? { diagnostic: 'fixture failure' } : {}) })
function record(candidateId: string, publishedAt?: string): NormalizedResearchSource {
  const candidate = { candidateId, kind: candidateId.startsWith('cninfo') ? 'official_disclosure' as const : 'news' as const, tier: candidateId.startsWith('cninfo') ? 1 as const : 3 as const, title: candidateId, provider: candidateId.startsWith('cninfo') ? 'cninfo' : 'gdelt', url: `https://example.test/${candidateId}`, ...(publishedAt ? { publishedAt } : {}) }
  return { candidate, retrievedAt: NOW, title: candidate.title, content: `Evidence for ${candidateId}`, canonicalUrl: candidate.url, contentHash: candidateId, publisher: candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }
}

test('Thesis Red Team asks the Data resolver for its full bounded lookback and uses it without Plugin name filtering', async () => {
  const official = record('cninfo-current', '2026-08-01T00:00:00.000Z')
  const unknown = record('gdelt-unknown')
  const batch = {
    kind: 'evidence', documents: [
      { record: official, publishedAt: official.candidate.publishedAt, retrievedAt: NOW, sourceUrl: official.canonicalUrl, contentHash: official.contentHash, retrievalProvider: 'CNINFO', provenance: sourceMetadata('cninfo-company-research-evidence', 'CNINFO'), dateStatus: 'QUALIFIED', pointInTimeSafe: true },
      { record: unknown, retrievedAt: NOW, sourceUrl: unknown.canonicalUrl, contentHash: unknown.contentHash, retrievalProvider: 'GDELT', provenance: sourceMetadata('gdelt-company-research-evidence', 'GDELT'), dateStatus: 'UNKNOWN', pointInTimeSafe: false },
    ],
    outcome: { transportSucceeded: true, fetchSucceeded: true, discovered: 8, fetched: 2, failed: 0, empty: 0, rejected: 2, deduplicated: 1, diagnostics: ['future-item:FUTURE', 'outside-item:OUTSIDE_PERIOD'] },
  }
  let capturedRequirement: DataRequirement | undefined
  let factoryCalls = 0
  const resolver = {
    resolveOne: async (requirement: DataRequirement) => {
      capturedRequirement = requirement
      return {
        acquisition: {
          status: 'PARTIAL', source: sourceMetadata('cninfo-company-research-evidence', 'CNINFO'),
          attempts: [attempt('cninfo-company-research-evidence', 'SUCCESS'), attempt('gdelt-company-research-evidence', 'SOURCE_ERROR')],
          observations: [{ data: batch, source: sourceMetadata('cninfo-company-research-evidence', 'CNINFO') }],
        },
      }
    },
  }
  const input = {
    company: { symbol: '600519', name: 'Fixture Company', exchange: 'SSE' },
    acquisitionPlugins: [],
    dataResolverFactory: (context: ThesisRedTeamDataResolverContext) => { factoryCalls++; assert.equal(context.company.symbol, '600519'); return resolver as never },
  } as unknown as ThesisRedTeamWorkflowInput
  const result = await acquireThesisRedTeamEvidence(input, NOW, 365)

  assert.equal(factoryCalls, 1)
  assert.equal(capturedRequirement?.consumer.workflow, 'thesis-red-team')
  assert.equal(capturedRequirement?.metricId, 'company_research_evidence')
  assert.equal(capturedRequirement?.period?.start, '2025-09-10T00:00:00.000Z')
  assert.equal(capturedRequirement?.period?.end, NOW)
  assert.deepEqual(result.sources.map((item) => item.candidate.candidateId), ['cninfo-current', 'gdelt-unknown'])
  assert.equal(result.discovered, 8)
  assert.equal(result.future, 1)
  assert.equal(result.outside, 1)
  assert.equal(result.unknown, 1)
  assert.equal(result.deduplicated, 1)
  assert.deepEqual(result.outcomes.map(({ provider, providerAttempted, providerSucceeded, providerFailed }) => ({ provider, providerAttempted, providerSucceeded, providerFailed })), [
    { provider: 'CNINFO', providerAttempted: true, providerSucceeded: true, providerFailed: false },
    { provider: 'GDELT', providerAttempted: true, providerSucceeded: false, providerFailed: true },
  ])
  const qualified = qualifyRedTeamEvidenceSet([{ sourceCandidateId: 'gdelt-unknown', attackVectorRefs: ['vector'], relation: 'disconfirms', strength: 'high', rationale: 'fixture' }], [{ candidateId: 'gdelt-unknown', title: 'Unknown date', provider: 'gdelt', url: unknown.canonicalUrl, excerpt: unknown.content }])
  assert.equal(qualified[0]?.qualified, false)
  assert.equal(qualified[0]?.durableEligible, false)
})

test('Thesis Red Team does not fall back to direct acquisition plugins when resolver composition is absent', async () => {
  let called = 0
  const input = { company: { symbol: '600519' }, acquisitionPlugins: [], dataResolverFactory: () => { called++; return undefined } } as unknown as ThesisRedTeamWorkflowInput
  const result = await acquireThesisRedTeamEvidence(input, NOW, 365)
  assert.equal(called, 1)
  assert.deepEqual(result.sources, [])
  assert.equal(result.outcomes.every((item) => !item.providerAttempted && item.providerEmpty && !item.providerFailed), true)
})

test('Thesis provider outcomes separate usable evidence from transport, fetch, empty, and failure status', async () => {
  const acquired = record('cninfo-usable', '2026-09-01T00:00:00.000Z')
  const metadata = sourceMetadata('cninfo-company-research-evidence', 'CNINFO')
  const usableDocument = { record: acquired, publishedAt: acquired.candidate.publishedAt, retrievedAt: NOW, sourceUrl: acquired.canonicalUrl, contentHash: acquired.contentHash, retrievalProvider: 'CNINFO', provenance: metadata, dateStatus: 'QUALIFIED', pointInTimeSafe: true } as const
  const resolveOutcome = async (config: { readonly attemptStatus: AcquisitionAttempt['status']; readonly documents: readonly typeof usableDocument[]; readonly transportSucceeded: boolean; readonly fetchSucceeded: boolean; readonly fetched: number; readonly failed: number; readonly empty: number }) => {
    const data = { kind: 'evidence', documents: config.documents, outcome: { transportSucceeded: config.transportSucceeded, fetchSucceeded: config.fetchSucceeded, discovered: config.fetched + config.failed + config.empty, fetched: config.fetched, failed: config.failed, empty: config.empty, rejected: 0, deduplicated: 0, diagnostics: [] } }
    const resolver = { resolveOne: async () => ({ acquisition: { status: 'PARTIAL', source: metadata, attempts: [attempt('cninfo-company-research-evidence', config.attemptStatus)], observations: [{ data, source: metadata }] } }) }
    const input = { company: { symbol: '600519' }, acquisitionPlugins: [], dataResolverFactory: () => resolver } as unknown as ThesisRedTeamWorkflowInput
    return (await acquireThesisRedTeamEvidence(input, NOW, 365)).outcomes.find((item) => item.provider === 'CNINFO')
  }

  const partial = await resolveOutcome({ attemptStatus: 'SUCCESS', documents: [usableDocument], transportSucceeded: true, fetchSucceeded: true, fetched: 1, failed: 1, empty: 0 })
  assert.deepEqual([partial?.providerSucceeded, partial?.providerEmpty, partial?.providerFailed, partial?.usableSourceCount, partial?.transportSucceeded, partial?.fetchSucceeded], [true, false, true, 1, true, true])

  const empty = await resolveOutcome({ attemptStatus: 'NO_DATA', documents: [], transportSucceeded: true, fetchSucceeded: false, fetched: 0, failed: 0, empty: 1 })
  assert.deepEqual([empty?.providerSucceeded, empty?.providerEmpty, empty?.providerFailed, empty?.usableSourceCount, empty?.transportSucceeded, empty?.fetchSucceeded], [false, true, false, 0, true, false])

  const failed = await resolveOutcome({ attemptStatus: 'SOURCE_ERROR', documents: [], transportSucceeded: false, fetchSucceeded: false, fetched: 0, failed: 1, empty: 1 })
  assert.deepEqual([failed?.providerSucceeded, failed?.providerEmpty, failed?.providerFailed, failed?.usableSourceCount, failed?.transportSucceeded, failed?.fetchSucceeded], [false, false, true, 0, false, false])
})
