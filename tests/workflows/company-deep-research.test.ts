import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { runCompanyDeepResearch } from '../../workflows/company-deep-research/index.ts'
import { createCompanyResearchDataResolver } from '../../plugins/research-acquisition/company-research-data.ts'
import { DataResolver } from '../../data/resolver.ts'
import type { AcquisitionResult } from '../../data/contracts.ts'
import type { CompanyResearchDataPayload } from '../../plugins/research-acquisition/company-research-data.ts'
import type { CompanyDeepResearchResolverOptions } from '../../workflows/company-deep-research/contracts.ts'
import type { ResearchAcquisitionPlugin, ResearchSignal, ResearchSignalStore, ResearchSourceCandidate } from '../../plugins/research-acquisition/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { writeKnowledgeBase } from '../../knowledge/writer/writer.ts'
import { KnowledgeBaseRegistry as Registry } from '../../knowledge/registry/registry.ts'

function resolverFactory(plugins: readonly ResearchAcquisitionPlugin[], akshare?: AkshareDataClient) {
  return (options: CompanyDeepResearchResolverOptions) => createCompanyResearchDataResolver({
    ...options,
    ...(akshare ? { akshare } : {}),
    officialDisclosure: plugins.find((plugin) => /official|cninfo/i.test(plugin.name)),
    gdelt: plugins.find((plugin) => /gdelt/i.test(plugin.name)),
  })
}

test('Company Deep Research produces atomic canonical Knowledge and a linked report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-test', now: '2026-09-08T00:00:00.000Z' })
    const handle = await new KnowledgeBaseRegistry().mount(root)
    const signals: ResearchSignal[] = []
    const signalStore: ResearchSignalStore = { append: async (signal) => { signals.push(signal) }, listForCompany: async () => signals }
    let content = 'The company reported stable revenue and profit.'
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async () => [{ candidateId: 'official-1', kind: 'official_disclosure', tier: 1, title: 'Fixture filing', url: 'https://example.com/filing', provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: '600519' } }],
      fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content, contentHash: content.includes('improved') ? 'c'.repeat(64) : 'b'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: fetched.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const input = { workflowRunId: 'company-run-1', handle, company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([plugin]), signalStore, reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' }
    const result = await runCompanyDeepResearch(input)
    assert.equal(result.status, 'completed', result.errors.join('; '))
    const unsupportedGdelt = result.providerOutcomes?.find((outcome) => outcome.provider === 'gdelt')
    assert.deepEqual(unsupportedGdelt && [unsupportedGdelt.providerAttempted, unsupportedGdelt.providerSucceeded, unsupportedGdelt.providerEmpty, unsupportedGdelt.providerFailed], [false, false, true, false])
    assert.ok(result.report?.outputPath)
    assert.ok(result.committedIds.length >= 2)
    assert.equal(signals.length, 1)
    const loaded = await readCanonicalV04Assets(root)
    assert.ok(loaded.objects.some((item) => item.value.id === 'entity:company-600519'))
    assert.ok(loaded.objects.some((item) => item.value.id.startsWith('source:research-')))
    const canonicalSource = loaded.objects.find((item) => item.value.id === result.sourceIds[0])?.value as { provider?: string; publisher?: string; metadata?: { dataProvenance?: Record<string, unknown> } } | undefined
    assert.ok(canonicalSource)
    assert.equal(canonicalSource.provider, 'cninfo')
    assert.equal(canonicalSource.publisher, 'CNINFO')
    assert.deepEqual(canonicalSource.metadata?.dataProvenance, {
      originAuthority: 'S0_STATUTORY', retrievalProvider: 'CNINFO', sourceUrl: 'https://example.com/filing',
      publishedAt: '2026-09-07T00:00:00.000Z',
      dateStatus: 'QUALIFIED', pointInTimeSafe: true,
    })
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('claim:research-')).length, 0)
    assert.equal(result.knowledgeBaseRevision, 1)
    assert.ok(result.createdIds.includes('entity:company-600519'))
    assert.deepEqual(result.committedIds, [...result.createdIds, ...result.updatedIds])

    content = 'The company reported improved revenue and profit.'
    const replay = await runCompanyDeepResearch({ ...input, workflowRunId: 'company-run-2', handle: await new KnowledgeBaseRegistry().mount(root) })
    assert.equal(replay.status, 'completed')
    assert.equal(replay.knowledgeBaseRevision, 2)
    assert.deepEqual(replay.createdIds, [])
    assert.ok(replay.updatedIds.includes(result.sourceIds[0]))
    assert.deepEqual(replay.committedIds, [...replay.createdIds, ...replay.updatedIds])
    const replayLoaded = await readCanonicalV04Assets(root)
    assert.equal(replayLoaded.objects.filter((item) => item.value.id.startsWith('source:research-')).length, 1)
    assert.equal(replay.sourceIds[0], result.sourceIds[0])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company Deep Research binds two companies deterministically and is stable on a third run', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-multi-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-multi-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-multi-test', now: '2026-09-08T00:00:00.000Z' })
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async (request) => { if (!request.company) return []; return [{ candidateId: `official-${request.company.symbol}`, kind: 'official_disclosure', tier: 1, title: `${request.company.symbol} filing`, url: `https://example.com/${request.company.symbol}`, provider: 'cninfo', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: request.company.symbol } }] },
      fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content: `${candidate.candidateId} reported stable revenue.`, contentHash: candidate.candidateId.includes('600519') ? 'c'.repeat(64) : 'd'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: fetched.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const first = await runCompanyDeepResearch({ workflowRunId: 'multi-600519-1', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Company A' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    const second = await runCompanyDeepResearch({ workflowRunId: 'multi-000858-1', handle: await new Registry().mount(root), company: { symbol: '000858', name: 'Company B' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    const third = await runCompanyDeepResearch({ workflowRunId: 'multi-600519-2', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Company A' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, now: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(first.status, 'completed', first.errors.join('; '))
    assert.equal(second.status, 'completed', second.errors.join('; '))
    assert.equal(third.status, 'completed', third.errors.join('; '))
    assert.equal(first.knowledgeBaseRevision, 1)
    assert.equal(second.knowledgeBaseRevision, 2)
    assert.equal(third.knowledgeBaseRevision, 2)
    const loaded = await readCanonicalV04Assets(root)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('entity:')).length, 2)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('source:')).length, 2)
    assert.equal(loaded.objects.filter((item) => item.value.id.startsWith('claim:')).length, 0)
    assert.ok(loaded.objects.every((item) => !item.value.id.includes('proposal-')))
    assert.ok(third.resolutionIntents?.some((item) => item.disposition === 'bound_existing'))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Schema 0.4 shared Writer rejects a forged receipt without Validator runtime identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-writer-token-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-writer-token-test', now: '2026-09-08T00:00:00.000Z' })
    const handle = await new Registry().mount(root)
    const forged = { changeSet: { changeSetId: 'forged', workflowRunId: 'forged-run', knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.4', storageFormatVersion: '1', expectedBaseRevision: 0, operations: [] }, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.4', baseRevision: 0, changeSetId: 'forged', changeSetHash: '0'.repeat(64) }
    const result = await writeKnowledgeBase(handle, forged as never, { registry: new Registry(), clock: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(result.status, 'rejected')
    assert.equal(result.error?.code, 'validation_required')
    const imitation = Object.create(Object.getPrototypeOf(forged)) as unknown
    Object.assign(imitation as object, forged)
    const imitationResult = await writeKnowledgeBase(handle, imitation as never, { registry: new Registry(), clock: () => '2026-09-08T00:00:00.000Z' })
    assert.equal(imitationResult.error?.code, 'validation_required')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Company resolves neutral structured data and keeps signal append between discovery and fetch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-data-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-data-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-data-test', now: asOf })
    const signals: ResearchSignal[] = []
    const signalStore: ResearchSignalStore = { append: async (signal) => { signals.push(signal) }, listForCompany: async () => signals }
    const akshare: AkshareDataClient = {
      companyBasic: async () => [{ item: 'name', value: 'Fixture Company' }],
      financialData: async () => [{ report_date: '2026-06-30', publication_date: '2026-08-01', metric: 0 }],
      historicalMarketData: async () => [{ date: '2026-09-08', close: 0 }],
    }
    const fetched: string[] = []
    const makePlugin = (name: string, provider: string, candidate: ResearchSourceCandidate): ResearchAcquisitionPlugin => ({
      name,
      discover: async () => [candidate],
      fetch: async (source) => {
        assert.equal(signals.some((signal) => signal.signalId === `signal-${source.candidateId}`), true, 'signal append must finish before fetch starts')
        fetched.push(source.candidateId)
        if (provider === 'gdelt' && source.candidateId === 'news-unknown-date') throw new Error('fixture GDELT fetch failure')
        return { candidate: source, retrievedAt: asOf, content: 'Official company filing.', contentHash: provider === 'gdelt' ? 'c'.repeat(64) : 'a'.repeat(64) }
      },
      normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    })
    const officialCandidate: ResearchSourceCandidate = { candidateId: 'official-unknown-date', kind: 'official_disclosure', tier: 1, title: 'Official filing', url: 'https://example.com/filing', provider: 'cninfo' }
    const futureCandidate: ResearchSourceCandidate = { candidateId: 'news-future', kind: 'news', tier: 3, title: 'Future news', url: 'https://example.com/future', provider: 'gdelt', publishedAt: '2026-09-09T00:00:00.000Z' }
    const qualifiedCandidate: ResearchSourceCandidate = { candidateId: 'news-qualified', kind: 'news', tier: 3, title: 'Dated news', url: 'https://example.com/dated', provider: 'gdelt', publishedAt: '2026-09-07T00:00:00.000Z' }
    const official = makePlugin('fixture-official', 'cninfo', officialCandidate)
    const news: ResearchAcquisitionPlugin = {
      ...makePlugin('fixture-gdelt', 'gdelt', futureCandidate),
      discover: async () => [futureCandidate, { ...futureCandidate, candidateId: 'news-unknown-date', url: 'https://example.com/unknown', publishedAt: undefined }, qualifiedCandidate],
    }
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-data-run', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([official, news], akshare), signalStore, reportRoot: reports, now: () => asOf })
    const valuation = result.research?.valuation as { readonly status: string; readonly missingFields: readonly string[] }
    assert.equal(valuation.status, 'insufficient_data')
    assert.equal(valuation.missingFields.includes('verified earnings metric'), false, 'zero is a present financial metric')
    assert.deepEqual(fetched.sort(), ['news-qualified', 'news-unknown-date', 'official-unknown-date'])
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('official-unknown-date'), 'unknown-date evidence remains visible as non-PIT-safe context')
    assert.equal(result.research?.sourceCandidateIds.includes('news-future'), false, 'future evidence must not reach the Skill')
    assert.ok(result.research?.sourceCandidateIds.includes('news-qualified'))
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('official-unknown-date'))
    assert.equal(result.research?.sourceCandidateIds.includes('official-unknown-date'), false, 'unknown-date evidence is available as context but cannot be cited durably')
    assert.ok(result.research?.sections.every((section) => !section.sourceCandidateIds.includes('official-unknown-date')))
    assert.ok(result.research?.sections.some((section) => section.markdown.includes('Context only; this source is not eligible for durable citation')))
    assert.equal(signals.length, 3, 'signal compatibility projection retains the existing as-of, dedup, and cap rules before fetch')
    assert.equal(signals.some((signal) => signal.signalId === 'signal-news-future'), false)
    assert.ok(result.providerOutcomes?.some((outcome) => outcome.provider === 'gdelt' && outcome.providerSucceeded && outcome.providerFailed))
    assert.equal(result.providerOutcomes?.find((outcome) => outcome.provider === 'gdelt')?.providerEmpty, false)
    const akshareOutcome = result.providerOutcomes?.find((outcome) => outcome.provider === 'akshare')
    assert.deepEqual(akshareOutcome && [akshareOutcome.providerSucceeded, akshareOutcome.providerEmpty, akshareOutcome.providerFailed], [true, false, false])
    assert.ok(result.providerOutcomes?.some((outcome) => outcome.provider === 'akshare' && outcome.providerSucceeded))
    assert.ok(result.acquisitionDiagnostics?.some((diagnostic) => diagnostic.provider === 'gdelt' && diagnostic.status === 'failed'))
    assert.equal(result.qualityGate?.eligibleForGateway, true)
    const canonical = await readCanonicalV04Assets(root)
    const structuredProvenance = canonical.objects.filter((item) => item.kind === 'source').map((item) => (item.value as any).metadata?.dataProvenance).filter((record) => record?.metricId)
    assert.deepEqual(structuredProvenance.map((record) => record.metricId).sort(), ['company_basic_profile', 'company_financial_history', 'company_market_history'])
    assert.ok(structuredProvenance.every((record) => record.sourceId && record.originAuthority && record.retrievalProvider === 'AKShare' && record.attempts.length > 0 && record.quality))
    assert.ok(structuredProvenance.every((record) => record.pointInTimeStatus === 'CURRENT_VALUE_ONLY' && record.qualityStatus === 'CURRENT_VALUE_ONLY' && record.valueVersionStatus === 'UNVERIFIED' && record.valueVersion?.status === 'UNVERIFIED'))
    assert.equal(canonical.objects.some((item) => item.kind === 'source' && 'title' in item.value && item.value.title === 'Official filing'), false, 'unknown-date source must not be written to Knowledge Gateway')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company maxSources is a global cap when both or only one evidence provider returns candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-cap-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-cap-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-cap-test', now: asOf })
    const plugin = (name: string, provider: string, ids: readonly string[]): ResearchAcquisitionPlugin => ({
      name,
      discover: async () => ids.map((candidateId) => ({ candidateId, kind: provider === 'cninfo' ? 'official_disclosure' as const : 'news' as const, tier: provider === 'cninfo' ? 1 as const : 3 as const, title: candidateId, url: `https://example.com/${candidateId}`, provider, publishedAt: '2026-09-07T00:00:00.000Z' })),
      fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: `Evidence ${candidate.candidateId}`, contentHash: candidate.candidateId.padEnd(64, '0') }),
      normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    })
    const official = plugin('fixture-official', 'cninfo', ['official-a', 'official-b'])
    const news = plugin('fixture-gdelt', 'gdelt', ['news-a', 'news-b'])
    const partialAkshare: AkshareDataClient = { companyBasic: async () => [{ item: 'name', value: 'Fixture Company' }], financialData: async () => [], historicalMarketData: async () => [{ date: '2026-09-08', close: 1 }] }
    const both = await runCompanyDeepResearch({ workflowRunId: 'company-cap-both', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([official, news], partialAkshare), reportRoot: reports, maxSources: 1, asOf, now: () => asOf })
    assert.equal(both.research?.sourceCandidateIds.filter((id) => !id.startsWith('akshare-')).length, 1)
    assert.ok(both.providerOutcomes?.some((outcome) => outcome.provider === 'akshare' && outcome.providerSucceeded && !outcome.providerEmpty))

    const single = await runCompanyDeepResearch({ workflowRunId: 'company-cap-single', handle: await new Registry().mount(root), company: { symbol: '000858', name: 'Fixture Company B' }, dataResolverFactory: resolverFactory([official, { ...news, discover: async () => [] }]), reportRoot: reports, maxSources: 1, asOf, now: () => asOf })
    assert.equal(single.research?.sourceCandidateIds.filter((id) => !id.startsWith('akshare-')).length, 1)
    assert.ok(single.providerOutcomes?.some((outcome) => outcome.provider === 'cninfo' && outcome.providerSucceeded && !outcome.providerEmpty))
    assert.ok(single.providerOutcomes?.some((outcome) => outcome.provider === 'gdelt' && !outcome.providerSucceeded && outcome.providerEmpty))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('historical unversioned profile and financial snapshots stay context-only and never bind through Gateway', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-historical-data-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-historical-data-reports-'))
  try {
    const asOf = '2026-10-08T07:01:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-historical-data-test', now: asOf })
    const akshare: AkshareDataClient = {
      companyBasic: async () => [{ item: 'employees', value: 0 }],
      financialData: async () => [{ report_date: '2025-12-31', publication_date: '2026-03-01', basic_eps: 0 }],
      historicalMarketData: async () => [{ date: '2026-10-07', close: 7 }, { date: '2026-10-08', close: 8 }],
    }
    const filing: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async () => [{ candidateId: 'dated-filing', kind: 'official_disclosure', tier: 1, title: 'Dated filing', url: 'https://example.com/dated-filing', provider: 'cninfo', publishedAt: '2026-10-07T12:00:00.000Z' }],
      fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: 'A verified filing.', contentHash: 'a'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: 'CNINFO', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const reasoningExecutor = {
      capabilities: () => ({}),
      execute: async () => ({ operation: 'company_research_synthesis', output: { sections: [{ title: 'Company Overview', markdown: 'A mixed-source historical claim.', sourceCandidateIds: ['akshare-financial-600519', 'dated-filing'], proposalIds: ['historical-mixed-claim'] }], proposals: [{ proposalId: 'historical-mixed-claim', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'An unversioned historical EPS claim.', sourceCandidateIds: ['akshare-financial-600519', 'dated-filing'] }] } }),
    } as unknown as ReasoningExecutor
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-historical-data', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([filing], akshare), reportRoot: reports, asOf, now: () => asOf, reasoningExecutor })
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('akshare-basic-600519'))
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('akshare-financial-600519'))
    assert.ok(result.research?.sourceCandidateIds.includes('akshare-market-600519'))
    assert.ok(result.research?.sourceCandidateIds.includes('dated-filing'))
    const canonical = await readCanonicalV04Assets(root)
    const sourceTitles = canonical.objects.filter((item) => item.kind === 'source').map((item) => (item.value as { title?: string }).title)
    assert.equal(sourceTitles.includes('Company basic profile'), false)
    assert.equal(sourceTitles.includes('Company financial history'), false)
    assert.equal(sourceTitles.includes('Company market history'), true)
    assert.equal(canonical.objects.some((item) => item.kind === 'claim' && 'statement' in item.value && item.value.statement === 'An unversioned historical EPS claim.'), false, 'a mixed-source proposal citing unversioned financial data must be rejected before Gateway')
    const market = canonical.objects.find((item) => item.kind === 'source' && (item.value as { title?: string }).title === 'Company market history')?.value as { metadata?: { dataProvenance?: Record<string, unknown> } } | undefined
    assert.equal(market?.metadata?.dataProvenance?.pointInTimeStatus, 'PIT_VERIFIED')
    assert.equal(market?.metadata?.dataProvenance?.valueVersionStatus, 'UNVERIFIED')
    assert.equal(market?.metadata?.dataProvenance?.retrievalProvider, 'AKShare')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company provider outcome flags never combine empty with failure and unsupported remains empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-outcome-flags-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-outcome-flags-reports-'))
  try {
    const asOf = '2026-10-08T12:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-outcome-flags-test', now: asOf })
    const official: ResearchAcquisitionPlugin = { name: 'fixture-official', discover: async () => [], fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: '' }), normalize: async () => { throw new Error('must not normalize') } }
    const gdelt: ResearchAcquisitionPlugin = { name: 'fixture-gdelt', discover: async () => { throw new Error('fixture discovery failure') }, fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: '' }), normalize: async () => { throw new Error('must not normalize') } }
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-outcome-flags', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([official, gdelt]), reportRoot: reports, asOf, now: () => asOf })
    const outcomes = result.providerOutcomes ?? []
    const cninfo = outcomes.find((outcome) => outcome.provider === 'cninfo')
    const news = outcomes.find((outcome) => outcome.provider === 'gdelt')
    assert.deepEqual(cninfo && [cninfo.providerSucceeded, cninfo.providerEmpty, cninfo.providerFailed], [false, true, false])
    assert.deepEqual(news && [news.providerSucceeded, news.providerEmpty, news.providerFailed], [false, false, true])
    assert.ok(outcomes.every((outcome) => !(outcome.providerEmpty && outcome.providerFailed)))
    assert.ok(outcomes.every((outcome) => outcome.providerSucceeded === (outcome.usableSourceCount > 0)))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('POINT_IN_TIME_INVALID Company market attempt is empty rather than a provider failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-market-cutoff-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-market-cutoff-reports-'))
  try {
    const asOf = '2026-10-08T06:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-market-cutoff-test', now: asOf })
    const dataResolverFactory = () => new DataResolver<CompanyResearchDataPayload>({
      policies: [], executor: async () => ({ status: 'UNSUPPORTED' }),
      resolveAcquisition: async (requirement): Promise<AcquisitionResult<CompanyResearchDataPayload>> => ({
        requirementId: requirement.id, status: 'UNAVAILABLE', source: null,
        quality: { pointInTimeSafe: false, complete: false, crossChecked: false, pitDiagnostic: 'NO_ELIGIBLE_POINT_IN_TIME_DATA' },
        attempts: requirement.metricId === 'company_market_history' ? [{ sourceId: 'akshare-marketHistory', fallbackLevel: 'PRIMARY', status: 'POINT_IN_TIME_INVALID', startedAt: asOf, completedAt: asOf, diagnostic: 'daily close was after analysisAsOf' }] : [],
        unavailableReason: requirement.metricId === 'company_market_history' ? 'NO_ELIGIBLE_POINT_IN_TIME_DATA' : 'SOURCE_UNAVAILABLE',
      }),
    })
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-market-cutoff', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory, reportRoot: reports, asOf, now: () => asOf })
    const market = result.providerOutcomes?.find((outcome) => outcome.provider === 'akshare')
    assert.deepEqual(market && [market.providerAttempted, market.providerSucceeded, market.providerEmpty, market.providerFailed, market.usableSourceCount], [true, false, true, false, 0])
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company dedup never promotes an unknown-date duplicate candidate to a durable source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-duplicate-pit-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-duplicate-pit-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-duplicate-pit-test', now: asOf })
    const plugin = (name: string, provider: string, publishedAt: string | undefined, url: string): ResearchAcquisitionPlugin => ({
      name,
      discover: async () => [{ candidateId: 'shared-candidate', kind: provider === 'cninfo' ? 'official_disclosure' : 'news', tier: provider === 'cninfo' ? 1 : 3, title: provider === 'cninfo' ? 'Dated filing' : 'Unknown-date duplicate', url, provider, ...(publishedAt ? { publishedAt } : {}) }],
      fetch: async (candidate) => ({ candidate, retrievedAt: asOf, content: `${provider} unique content`, contentHash: provider === 'cninfo' ? '1'.repeat(64) : '2'.repeat(64) }),
      normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    })
    const dated = plugin('fixture-official', 'cninfo', '2026-09-07T00:00:00.000Z', 'https://example.com/dated-shared')
    const unknown = plugin('fixture-gdelt', 'gdelt', undefined, 'https://example.com/unknown-shared')
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-duplicate-pit', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([dated, unknown]), reportRoot: reports, asOf, now: () => asOf })
    assert.equal(result.status, 'completed', result.errors.join('; '))
    assert.ok(result.research?.contextOnlySourceCandidateIds?.includes('shared-candidate'))
    assert.equal(result.research?.sourceCandidateIds.includes('shared-candidate'), false)
    const canonical = await readCanonicalV04Assets(root)
    assert.equal(canonical.objects.some((item) => item.kind === 'source' && 'url' in item.value && item.value.url === 'https://example.com/unknown-shared'), false)
    assert.equal(canonical.objects.some((item) => item.kind === 'source' && 'url' in item.value && item.value.url === 'https://example.com/dated-shared'), false, 'last-record candidate-id dedup selects unknown context, so neither conflicting record is durable')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company Deep Research observes cancellation before acquisition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-cancel-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-cancel-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-cancel-test', now: '2026-09-08T00:00:00.000Z' })
    const controller = new AbortController()
    controller.abort()
    let called = false
    const plugin: ResearchAcquisitionPlugin = { name: 'fixture-gdelt', discover: async () => { called = true; return [] }, fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content: '' }), normalize: async () => { throw new Error('must not normalize') } }
    const result = await runCompanyDeepResearch({ workflowRunId: 'company-cancel-run', handle: await new Registry().mount(root), company: { symbol: '600519', name: 'Fixture Company' }, dataResolverFactory: resolverFactory([plugin]), reportRoot: reports, signal: controller.signal })
    assert.equal(result.status, 'cancelled')
    assert.equal(called, false)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})
