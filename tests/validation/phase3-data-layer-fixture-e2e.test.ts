import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { COMMON_DATA_CATALOG } from '../../data/common-catalog.ts'
import { readCanonicalV04Assets, createFreshKnowledgeBaseV04 } from '../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { runThesisRedTeam } from '../../workflows/thesis-red-team/workflow.ts'
import { createCompanyResearchDataResolver } from '../../plugins/research-acquisition/company-research-data.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'
import type { DailyResearchSignal } from '../../plugins/daily-intelligence/contracts.ts'
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../plugins/reasoning/contracts.ts'
import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import { classifyPhase3ConsumerEvidence, countQualifiedPitSafeEvidenceDocuments } from './phase3-live-acceptance-runner.ts'

const NOW = '2026-09-10T00:00:00.000Z'
const rights = { accessScope: 'public' as const, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false }

function candidate(candidateId: string, provider: 'cninfo' | 'gdelt', publishedAt?: string): ResearchSourceCandidate {
  return { candidateId, kind: provider === 'cninfo' ? 'official_disclosure' : 'news', tier: provider === 'cninfo' ? 1 : 3, title: `Fixture ${candidateId}`, provider, url: `https://example.test/${candidateId}`, ...(publishedAt ? { publishedAt } : {}), metadata: { companySymbol: '600519' } }
}

function plugin(name: string, values: readonly ResearchSourceCandidate[]): ResearchAcquisitionPlugin {
  return {
    name,
    discover: async () => values,
    fetch: async (value) => {
      const content = value.candidateId === 'qualified-dated-relevant-official'
        ? 'Dated official disclosure: premium-channel shipment volume declined year over year, while dealer inventory rose.'
        : `Evidence for ${value.candidateId}`
      return { candidate: value, retrievedAt: NOW, content, contentHash: sha256(content) }
    },
    normalize: async (fetched): Promise<NormalizedResearchSource> => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash ?? sha256(fetched.content), canonicalUrl: fetched.candidate.url, publisher: fetched.candidate.provider, rights }),
  }
}

function signal(): DailyResearchSignal {
  const source = candidate('daily-signal-context', 'gdelt', '2026-09-08T00:00:00.000Z')
  return { signalId: 'daily-signal-context', kind: 'news', category: 'news', provider: 'fixture', source, publishedAt: source.publishedAt, discoveredAt: NOW, entities: ['600519'], themes: [], title: source.title, contentHash: sha256(source.title), excerpt: 'Context only', relevance: 1, novelty: 1, importance: 1, sourceTier: 3 }
}

class FixtureThesisExecutor implements ReasoningExecutor {
  readonly operations: string[] = []
  readonly requests: ReasoningRequest[] = []
  constructor(private readonly thesisRef: string) {}
  capabilities() { return { maxContextTokens: 10_000, maxOutputTokens: 4_000, structuredOutputSupport: true, maxConcurrency: 1 } }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> {
    this.operations.push(request.operation)
    this.requests.push(request)
    if (request.operation === 'thesis_attack_design') return { operation: request.operation, output: {
      attackVectors: [{ vectorId: 'vector-fixture', vectorType: 'assumption_failure', priority: 'high', targetExistingClaimRefs: [this.thesisRef], falsificationQuestion: 'What would falsify demand resilience?', failureMechanism: 'Demand weakens.', evidenceNeeded: 'Dated external evidence.', searchTerms: ['demand'] }],
      implicitAssumptions: [], invalidationConditions: [{ conditionId: 'condition-fixture', statement: 'Demand collapses.', severity: 'high', targetExistingClaimRefs: [this.thesisRef] }],
    } }
    return { operation: request.operation, output: {
      evidenceAssessments: [
        { sourceCandidateId: 'qualified-dated-relevant-official', attackVectorRefs: ['vector-fixture'], relation: 'disconfirms', strength: 'high', rationale: 'The dated official filing directly reports declining premium-channel demand, challenging the durable demand leadership thesis.' },
        { sourceCandidateId: 'unknown-date-official', attackVectorRefs: ['vector-fixture'], relation: 'irrelevant', strength: 'high', rationale: 'The unknown-date fixture is irrelevant and cannot support the Thesis.' },
        { sourceCandidateId: 'irrelevant-office-document', attackVectorRefs: ['vector-fixture'], relation: 'irrelevant', strength: 'high', rationale: 'This dated fixture is irrelevant to the Thesis.' },
      ],
      challengeAssessments: [
        { challengeId: 'c-qualified', challengeType: 'thesis_contradiction', basis: 'verified_evidence', status: 'supported', severity: 'high', timeHorizon: 'near_term', targetExistingClaimRefs: [this.thesisRef], attackVectorRefs: ['vector-fixture'], sourceCandidateIds: ['qualified-dated-relevant-official'], causalChain: 'Premium-channel demand falls -> durable demand leadership weakens.', rationale: 'The official dated filing directly supports the challenge.' },
        { challengeId: 'c1', challengeType: 'thesis_contradiction', basis: 'hypothesis', status: 'unresolved', severity: 'medium', timeHorizon: 'near_term', targetExistingClaimRefs: [this.thesisRef], attackVectorRefs: ['vector-fixture'], sourceCandidateIds: [], causalChain: 'Demand weakens -> growth slows.', rationale: 'No qualified contradiction.' },
        { challengeId: 'c2', challengeType: 'alternative_explanation', basis: 'inference', status: 'unresolved', severity: 'low', timeHorizon: 'medium_term', targetExistingClaimRefs: [], attackVectorRefs: ['vector-fixture'], sourceCandidateIds: [], causalChain: 'Mix changes -> growth changes.', rationale: 'No alternative is evidenced.' },
        { challengeId: 'c3', challengeType: 'failure_case', basis: 'hypothesis', status: 'unresolved', severity: 'medium', timeHorizon: 'long_term', targetExistingClaimRefs: [], attackVectorRefs: ['vector-fixture'], sourceCandidateIds: [], causalChain: 'Competition rises -> margins fall.', rationale: 'This remains a scenario.' },
        { challengeId: 'c4', challengeType: 'invalidation_condition', basis: 'hypothesis', status: 'not_supported', severity: 'high', timeHorizon: 'near_term', targetExistingClaimRefs: [this.thesisRef], attackVectorRefs: ['vector-fixture'], sourceCandidateIds: [], conditionRef: 'condition-fixture', causalChain: 'Demand collapse -> thesis failure.', rationale: 'No qualifying evidence shows this condition.' },
      ],
      thesisVerdict: 'materially_challenged', interpretations: [], proposals: [
        { proposalId: 'fixture-risk-proposal', kind: 'claim', claimType: 'risk', subjectKey: 'company', statement: 'Premium-channel demand deterioration may weaken durable demand leadership.', sourceCandidateIds: ['qualified-dated-relevant-official'], challengeRefs: ['c-qualified'], structuredValue: { metric: 'fixture_demand_risk', value: true, unit: 'assessment', comparator: 'eq', period: 'current' } },
      ],
    } }
  }
}

test('Phase 3 fixture E2E preserves the single external-evidence identity and keeps Daily Signals outside the catalog', () => {
  const evidence = COMMON_DATA_CATALOG.filter((item) => item.metricId === 'company_research_evidence')
  assert.equal(evidence.length, 1)
  assert.deepEqual(evidence[0]?.consumers, ['company-deep-research', 'event-research', 'thesis-red-team'])
  assert.equal(COMMON_DATA_CATALOG.some((item) => /daily.?signal|event_verified|thesis_disconfirming/i.test(item.metricId)), false)
})

test('Phase 3 live evidence classification separates provider diagnostics from consumer acceptance', () => {
  const availableEvidenceAcquisition = { observations: [{ data: { kind: 'evidence', documents: [{ record: { candidate: { candidateId: 'qualified-source' } }, dateStatus: 'QUALIFIED', pointInTimeSafe: true }] } }] }
  const unknownDateAcquisition = { observations: [{ data: { kind: 'evidence', documents: [{ record: {}, dateStatus: 'UNKNOWN', pointInTimeSafe: false }] } }] }
  const availableCount = countQualifiedPitSafeEvidenceDocuments(availableEvidenceAcquisition)
  assert.equal(availableCount, 1)
  assert.equal(classifyPhase3ConsumerEvidence(availableCount), 'REAL_SOURCE_AVAILABLE_WORKFLOW_NOT_EXECUTED')
  assert.equal(countQualifiedPitSafeEvidenceDocuments(unknownDateAcquisition), 0)
  assert.equal(countQualifiedPitSafeEvidenceDocuments({ observations: [{ data: { kind: 'evidence', documents: [
    { record: null, dateStatus: 'QUALIFIED', pointInTimeSafe: true },
    { record: 'not-a-record', dateStatus: 'QUALIFIED', pointInTimeSafe: true },
    { record: [], dateStatus: 'QUALIFIED', pointInTimeSafe: true },
  ] } }] }), 0)
  assert.equal(classifyPhase3ConsumerEvidence(countQualifiedPitSafeEvidenceDocuments({ observations: [] })), 'REAL_SOURCE_BLOCKED')
})

test('Thesis Red Team fixture E2E acquires through Data while preserving target Thesis, Company, and signal durability boundaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-phase3-thesis-e2e-'))
  const reportRoot = join(root, 'reports')
  try {
    const kbRoot = join(root, 'kb')
    await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: 'kb-phase3-thesis-e2e', now: NOW })
    const registry = new KnowledgeBaseRegistry()
    let handle = await registry.mount(kbRoot)
    const seedCandidate = candidate('thesis-seed', 'cninfo', '2026-09-01T00:00:00.000Z')
    const seedSource: NormalizedResearchSource = { candidate: seedCandidate, retrievedAt: NOW, title: seedCandidate.title, content: 'Seed fixture for active Thesis.', canonicalUrl: seedCandidate.url, contentHash: sha256('Seed fixture for active Thesis.'), rawBytes: new TextEncoder().encode('Seed fixture for active Thesis.'), publisher: 'CNINFO', rights }
    const seeded = await new KnowledgeProductionGateway(registry).submit({
      handle, producerType: 'fixture_seed', producerRunId: 'phase3-thesis-seed',
      schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
      entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SSE' } },
      proposals: [{ proposalId: 'seed-assumption', kind: 'claim', claimType: 'assumption', subjectKey: 'company', statement: 'Demand remains resilient.', sourceCandidateIds: ['seed-source'] }],
      evidenceBindings: [{ localSourceId: 'seed-source', source: seedSource }], asOf: NOW, now: () => NOW,
    })
    assert.equal(seeded.status, 'committed', JSON.stringify(seeded.errors))
    const thesisRef = 'claim:fixture-thesis'
    const companyRef = seeded.entityRefsByLocalKey.company!
    const registryPath = join(kbRoot, 'registry', 'assets.yaml')
    const registryAssets = JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, { type: string; storageRef: string }>
    const assumptionRef = seeded.claimRefsByProposalId['seed-assumption']!
    const assumptionStorage = registryAssets[assumptionRef]!.storageRef
    const legacyClaim = JSON.parse(await readFile(join(kbRoot, assumptionStorage), 'utf8')) as Record<string, unknown>
    const fixtureThesis = { ...legacyClaim, id: thesisRef, claimType: 'thesis', statement: 'Durable demand leadership will sustain profitable growth.', lifecycle: { status: 'active' } }
    const thesisStorage = 'claims/fixture-thesis.yaml'
    await writeFile(join(kbRoot, thesisStorage), `${JSON.stringify(fixtureThesis)}\n`, 'utf8')
    registryAssets[thesisRef] = { type: 'claim', storageRef: thesisStorage }
    await writeFile(registryPath, `${JSON.stringify(registryAssets)}\n`, 'utf8')
    handle = await registry.mount(kbRoot)
    const before = await readCanonicalV04Assets(kbRoot)
    const thesisBefore = before.objects.find((item) => item.value.id === thesisRef)!.value
    const companyBefore = before.objects.find((item) => item.value.id === companyRef)!.value
    const plugins = [
      plugin('fixture-official-cninfo', [candidate('qualified-dated-relevant-official', 'cninfo', '2026-09-07T00:00:00.000Z'), candidate('unknown-date-official', 'cninfo'), candidate('irrelevant-office-document', 'cninfo', '2026-09-07T00:00:00.000Z')]),
      plugin('fixture-gdelt', [candidate('dated-news-context', 'gdelt', '2026-09-08T00:00:00.000Z')]),
    ]
    const signalValue = signal()
    const reasoningExecutor = new FixtureThesisExecutor(thesisRef)
    const result = await runThesisRedTeam({
      workflowRunId: 'phase3-thesis-e2e-run', handle, company: { symbol: '600519', name: 'Fixture Company', exchange: 'SSE' }, thesisRef,
      acquisitionPlugins: plugins, reportRoot, now: () => NOW, reasoningExecutor,
      dailySignalStore: { appendMany: async () => ({ appended: 0, skipped: 0 }), listWindow: async () => [signalValue], getById: async () => signalValue },
      dataResolverFactory: (context) => {
        assert.deepEqual(reasoningExecutor.operations, ['thesis_attack_design'], 'Stage A must complete before external evidence acquisition')
        return createCompanyResearchDataResolver({ company: context.company, officialDisclosure: plugins[0], gdelt: plugins[1], now: () => NOW, signal: context.signal })
      },
    })
    const after = await readCanonicalV04Assets(kbRoot)
    const thesisAfter = after.objects.find((item) => item.value.id === thesisRef)!.value
    const companyAfter = after.objects.find((item) => item.value.id === companyRef)!.value
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.deepEqual(reasoningExecutor.operations, ['thesis_attack_design', 'thesis_red_team_synthesis'])
    assert.equal(result.telemetry.recentSignalCount, 1)
    assert.equal(result.telemetry.acquisition.unknownDateCount, 1)
    assert.equal(result.telemetry.targetThesisChanged, false)
    assert.equal(result.telemetry.targetThesisHashBefore, result.telemetry.targetThesisHashAfter)
    assert.equal(result.telemetry.targetThesisLifecycleBefore, result.telemetry.targetThesisLifecycleAfter)
    assert.equal((thesisAfter as { id?: string }).id, thesisRef)
    assert.deepEqual((thesisAfter as { lifecycle?: unknown }).lifecycle, (thesisBefore as { lifecycle?: unknown }).lifecycle)
    assert.deepEqual((thesisAfter as { sourceRefs?: unknown }).sourceRefs ?? [], (thesisBefore as { sourceRefs?: unknown }).sourceRefs ?? [])
    assert.equal(hashKnowledgeObject((thesisBefore as { sourceRefs?: unknown }).sourceRefs ?? []), hashKnowledgeObject((thesisAfter as { sourceRefs?: unknown }).sourceRefs ?? []))
    assert.equal(hashKnowledgeObject(thesisBefore), hashKnowledgeObject(thesisAfter))
    assert.equal(hashKnowledgeObject(companyBefore), hashKnowledgeObject(companyAfter))
    assert.equal(result.telemetry.signalCanonicalized, false)
    assert.equal(result.telemetry.unknownDateCanonicalized, false)
    assert.equal(result.telemetry.irrelevantSourceCanonicalized, false)
    assert.equal(after.objects.filter((item) => item.kind === 'source').length, before.objects.filter((item) => item.kind === 'source').length + 1, 'Only the qualified evidence source should be canonicalized')
    assert.equal(result.telemetry.qualifiedDisconfirmingEvidenceCount, 1)
    assert.equal(result.telemetry.verdictConsistency?.valid, true)
    assert.equal(result.telemetry.thesisVerdict, 'materially_challenged')
    const stageBSources = (reasoningExecutor.requests[1]!.input as { sources: { provider: string; dataProvenance?: Record<string, unknown> }[] }).sources
    assert.ok(stageBSources.some((item) => item.provider === 'cninfo' && item.dataProvenance?.originAuthority === 'S0_STATUTORY' && item.dataProvenance?.pointInTimeSafe === true && item.dataProvenance?.retrievedAt === NOW && typeof item.dataProvenance?.contentHash === 'string'))
    assert.equal(result.telemetry.gatewayCreatedClaimCount, 2, 'Gateway should commit a deterministic verdict and the valid Stage B risk proposal')
    assert.equal(result.telemetry.durableAppliedProposalCount, 2)
    assert.ok(result.sourceIds.length >= 1)
    assert.ok(result.claimIds.length >= 1)
    const writtenSourceRefs = result.sourceIds
    const writtenClaims = after.objects.filter((item) => result.claimIds.includes(String(item.value.id)))
    assert.equal(writtenClaims.length, 2)
    assert.ok(writtenClaims.some((item) => (item.value as { statement?: string }).statement?.includes('Premium-channel demand deterioration')))
    assert.ok(writtenClaims.every((item) => (item.value as { sourceRefs?: string[] }).sourceRefs?.some((ref) => writtenSourceRefs.includes(ref))))
    const writtenSource = after.objects.find((item) => item.kind === 'source' && result.sourceIds.includes(String(item.value.id)))?.value as { provider?: string; publisher?: string; canonicalUrl?: string; publishedAt?: string; retrievedAt?: string; contentHash?: string; metadata?: { dataProvenance?: Record<string, unknown> } } | undefined
    assert.ok(writtenSource)
    assert.equal(writtenSource.provider, 'cninfo')
    assert.equal(writtenSource.publisher, 'CNINFO')
    assert.equal(writtenSource.publishedAt, '2026-09-07T00:00:00.000Z')
    assert.ok(writtenSource.contentHash)
    assert.deepEqual(writtenSource.metadata?.dataProvenance, {
      originAuthority: 'S0_STATUTORY', retrievalProvider: 'CNINFO', sourceUrl: 'https://example.test/qualified-dated-relevant-official',
      publishedAt: writtenSource.publishedAt,
      dateStatus: 'QUALIFIED', pointInTimeSafe: true,
    })
    assert.equal(writtenSource.retrievedAt, NOW)
    assert.equal(after.objects.some((item) => item.kind === 'source' && ['unknown-date-official', 'irrelevant-office-document', 'dated-news-context', 'daily-signal-context'].some((candidateId) => JSON.stringify(item.value).includes(candidateId))), false)
    assert.deepEqual(result.providerOutcomes.map((item) => [item.provider, item.providerAttempted]), [['CNINFO', true], ['GDELT', true]])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
