import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveRaw } from '../../../knowledge/raw/raw-archive.ts'
import { createThemeScopeDecisionV04, fingerprintThemeScopeCandidateV04, type ThemeScopeCandidateV04, type ThemeScopeDecisionDraftV04 } from '../../../knowledge/governance/theme-scope-v04.ts'
import { ThemeManagementGatewayV04 } from '../../../knowledge/production/theme-management-v04.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import type { KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeEventV04, KnowledgeIndustryV04, KnowledgeModuleV04, KnowledgeRelationV04, KnowledgeSourceV04 } from '../../../knowledge/schema/domain-v04.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04 } from '../../../knowledge/schema/mutation-v04.ts'
import { COMPETITION_MODULE_SCHEMA_ID_V1, type CompetitionModuleV1 } from '../../../knowledge/schema/competition-module-v04.ts'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/index.ts'
import { validateKnowledgeChangeSetV04 } from '../../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../../../knowledge/writer/writer.ts'
import type { ReasoningExecutor } from '../../../plugins/reasoning/contracts.ts'
import { ThemeWorkspaceProjectionService } from '../../../app/services/theme-workspace-projection.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW
const SOURCE = 'source:theme-workspace-fixture' as const
type ThemeRef = `entity:${string}`

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-theme-workspace-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-theme-workspace-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function mount(root: string) { return new KnowledgeBaseRegistry().mount(root) }

async function write(root: string, runId: string, operations: readonly KnowledgeOperationV04[], scope?: unknown): Promise<void> {
  const handle = await mount(root)
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: `changeset-${runId}`,
    workflowRunId: runId,
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations,
    ...(scope === undefined ? {} : { ingestionContext: { producerType: 'theme_framework', themeScope: scope } }),
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  const committed = await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock })
  assert.equal(committed.status, 'committed', committed.error?.message)
}

async function prepare(root: string): Promise<{ readonly themeRef: ThemeRef; readonly rawRef: `raw-sha256-${string}` }> {
  const theme = await new ThemeManagementGatewayV04({ clock }).createTheme(await mount(root), { name: 'AI Compute' })
  assert.equal(theme.status, 'committed')
  const themeRef = theme.themeRef as ThemeRef
  const handle = await mount(root)
  const raw = await archiveRaw(handle, { bytes: Buffer.from('Evidence for the confirmed AI compute scope.'), originalFilename: 'scope.txt', mediaType: 'text/plain' }, { clock })
  const rawRef = raw.manifest.rawRef as `raw-sha256-${string}`
  const source: KnowledgeSourceV04 = {
    id: SOURCE,
    title: 'Public scope evidence',
    sourceType: 'official_disclosure',
    provider: 'fixture',
    publishedAt: '2026-09-30T00:00:00.000Z',
    retrievedAt: NOW,
    contentHash: raw.manifest.contentHash.slice('sha256:'.length),
    rawRefs: [rawRef],
    rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, expiresAt: '2026-10-03T00:00:00.000Z' },
    usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false },
    lifecycle: { status: 'active' },
  }
  const restricted: KnowledgeSourceV04 = {
    ...source,
    id: 'source:restricted',
    title: 'Restricted source',
    rights: { ...source.rights, accessScope: 'restricted' },
  }
  const expired: KnowledgeSourceV04 = {
    ...source,
    id: 'source:expired',
    title: 'Expired source',
  }
  await write(root, 'theme-workspace-source', [
    { operationId: 'source', type: 'create', object: source },
    { operationId: 'restricted-source', type: 'create', object: restricted },
    { operationId: 'expired-source', type: 'create', object: expired },
  ])
  return { themeRef, rawRef }
}

function industry(ref: string, name: string): KnowledgeIndustryV04 {
  return { id: ref as `entity:${string}`, type: 'industry', name, lifecycle: { status: 'active' } }
}
function relation(ref: string, type: KnowledgeRelationV04['type'], sourceRef: string, targetRef: string, attributes?: KnowledgeRelationV04['attributes']): KnowledgeRelationV04 {
  return { id: ref as `relation:${string}`, type, sourceRef: sourceRef as `entity:${string}`, targetRef: targetRef as `entity:${string}`, sourceRefs: [SOURCE], lifecycle: { status: 'active' }, ...(attributes === undefined ? {} : { attributes }) } as KnowledgeRelationV04
}

function industryCandidate(name: string, canonicalRef: string): ThemeScopeCandidateV04 {
  return { kind: 'industry', name, canonicalRef: canonicalRef as `entity:${string}` }
}
function scopeDecision(themeRef: string, revision: number, candidate: ThemeScopeCandidateV04, decision: 'include' | 'exclude' | 'pending', rawRef: `raw-sha256-${string}`) {
  return createThemeScopeDecisionV04({
    version: '0.4',
    themeRef: themeRef as ThemeScopeDecisionDraftV04['themeRef'],
    candidate,
    candidateFingerprint: fingerprintThemeScopeCandidateV04(candidate),
    decision,
    rationale: `${decision} is the confirmed test scope.`,
    evidence: decision === 'include' ? [{ sourceRef: SOURCE, rawRef, locator: 'page 1, line 1' }] : [],
    coverageGaps: decision === 'pending' ? ['Need additional evidence.'] : [],
    review: { status: 'human_confirmed', confirmedAt: NOW },
    basedOnRevision: revision,
    affectedBranchKeys: ['ai-compute'],
  })
}

async function seedWorkspace(root: string): Promise<{ readonly themeRef: ThemeRef; readonly service: ThemeWorkspaceProjectionService }> {
  const { themeRef, rawRef } = await prepare(root)
  const handle = await mount(root)
  const serversRef = 'entity:industry-servers'
  const pcbRef = 'entity:industry-pcb'
  const consumerRef = 'entity:industry-consumer'
  const pendingRef = 'entity:industry-pending'
  const tvRef = 'entity:industry-tv'
  const companyRef = 'entity:company-fixture'
  const companyTwoRef = 'entity:company-fixture-two'
  const restrictedCompanyRef = 'entity:company-restricted-exposure'
  const includeServers = scopeDecision(themeRef, handle.revision, industryCandidate('Server industry', serversRef), 'include', rawRef)
  const includePcb = scopeDecision(themeRef, handle.revision, industryCandidate('PCB industry', pcbRef), 'include', rawRef)
  const excludeConsumer = scopeDecision(themeRef, handle.revision, industryCandidate('Consumer electronics', consumerRef), 'exclude', rawRef)
  const pendingIndustry = scopeDecision(themeRef, handle.revision, industryCandidate('Pending industry', pendingRef), 'pending', rawRef)
  const pcbFingerprint = fingerprintThemeScopeCandidateV04(industryCandidate('PCB industry', pcbRef))
  const serversFingerprint = fingerprintThemeScopeCandidateV04(industryCandidate('Server industry', serversRef))
  const edgeCandidate: ThemeScopeCandidateV04 = { kind: 'relation', relationType: 'upstream_of', sourceFingerprint: pcbFingerprint, targetFingerprint: serversFingerprint, canonicalRef: 'relation:pcb-server' }
  const includeEdge = scopeDecision(themeRef, handle.revision, edgeCandidate, 'include', rawRef)
  const businessExposure = relation('relation:company-servers', 'business_exposure', companyRef, serversRef)
  const businessExposureTwo = relation('relation:company-two-servers', 'business_exposure', companyTwoRef, serversRef)
  const restrictedBusinessExposure = { ...relation('relation:company-restricted-servers', 'business_exposure', restrictedCompanyRef, serversRef), sourceRefs: ['source:restricted'] } as KnowledgeRelationV04
  const expiredBusinessExposure = { ...relation('relation:company-expired-servers', 'business_exposure', 'entity:company-expired-exposure', serversRef), sourceRefs: ['source:expired'] } as KnowledgeRelationV04
  const themeServers = relation('relation:theme-servers', 'theme_exposure', themeRef, serversRef, { importance: 'core' })
  const themePcb = relation('relation:theme-pcb', 'theme_exposure', themeRef, pcbRef, { importance: 'material' })
  const facts = [
    { id: 'claim:server-view', claimType: 'viewpoint', statement: 'Server capacity is the current bottleneck.', subjectRefs: [serversRef], primarySubjectRef: serversRef, sourceRefs: [SOURCE], confidence: 0.9, lifecycle: { status: 'active' } },
    { id: 'claim:server-view-secondary', claimType: 'viewpoint', statement: 'Power availability may constrain expansion.', subjectRefs: [serversRef], primarySubjectRef: serversRef, sourceRefs: [SOURCE], confidence: 0.7, lifecycle: { status: 'active' } },
    { id: 'claim:future-catalyst', claimType: 'catalyst', statement: 'A new server hall may enter service.', subjectRefs: [serversRef], primarySubjectRef: serversRef, temporal: { asOf: NOW, scope: { type: 'period', start: '2027-02-01', end: null, label: 'expected' } }, sourceRefs: [SOURCE], lifecycle: { status: 'active' } },
    { id: 'claim:restricted', claimType: 'fact', statement: 'Restricted fact must not be shown.', subjectRefs: [serversRef], sourceRefs: ['source:restricted'], lifecycle: { status: 'active' } },
  ] as unknown as KnowledgeAssetV04[]
  const companyClaims: KnowledgeClaimV04[] = [
    { id: 'claim:company-products', claimType: 'fact', statement: 'Fixture Corp sells server systems.', subjectRefs: [companyRef as `entity:${string}`], primarySubjectRef: companyRef as `entity:${string}`, sourceRefs: [SOURCE], provenance: [{ sourceRef: SOURCE, rawRef, locator: 'page 1', chunkRef: null }], lifecycle: { status: 'active' } },
    { id: 'claim:company-market-cap', claimType: 'fact', statement: 'Fixture Corp market capitalization.', subjectRefs: [companyRef as `entity:${string}`], primarySubjectRef: companyRef as `entity:${string}`, temporal: { asOf: '2026-09-30', scope: { type: 'point', start: '2026-09-30', end: '2026-09-30', label: 'quote date' } }, structuredValue: { metric: 'metric:market_cap', value: 100, unit: 'CNY', comparator: 'eq' }, sourceRefs: [SOURCE], provenance: [{ sourceRef: SOURCE, rawRef, locator: 'page 1', chunkRef: null }], lifecycle: { status: 'active' } },
    { id: 'claim:company-revenue', claimType: 'fact', statement: 'Fixture Corp FY2025 annual revenue.', subjectRefs: [companyRef as `entity:${string}`], primarySubjectRef: companyRef as `entity:${string}`, structuredValue: { metric: 'metric:revenue', value: 20, unit: 'CNY', comparator: 'eq', fiscalPeriod: 'FY2025' }, sourceRefs: [SOURCE], provenance: [{ sourceRef: SOURCE, rawRef, locator: 'page 1', chunkRef: null }], lifecycle: { status: 'active' } },
    { id: 'claim:company-two-products-restricted', claimType: 'fact', statement: 'Fixture Two sells products.', subjectRefs: [companyTwoRef as `entity:${string}`], primarySubjectRef: companyTwoRef as `entity:${string}`, sourceRefs: [SOURCE], provenance: [{ sourceRef: SOURCE, rawRef, locator: 'page 1', chunkRef: null }], lifecycle: { status: 'active' } },
    { id: 'claim:company-two-market-cap', claimType: 'fact', statement: 'Fixture Two market capitalization.', subjectRefs: [companyTwoRef as `entity:${string}`], primarySubjectRef: companyTwoRef as `entity:${string}`, temporal: { asOf: '2026-09-29', scope: { type: 'point', start: '2026-09-29', end: '2026-09-29', label: 'quote date' } }, structuredValue: { metric: 'metric:market_cap', value: 200, unit: 'CNY', comparator: 'eq' }, sourceRefs: [SOURCE], provenance: [{ sourceRef: SOURCE, rawRef, locator: 'page 1', chunkRef: null }], lifecycle: { status: 'active' } },
  ]
  const rawBackedFacts = facts.map((item) => ({ ...item, provenance: [{ sourceRef: SOURCE, rawRef, locator: 'page 1', chunkRef: null }] })) as unknown as KnowledgeAssetV04[]
  const event: KnowledgeEventV04 = {
    id: 'event:past-capacity', eventType: 'capacity_expansion', title: 'Server capacity expansion announced', subjectRefs: [serversRef as `entity:${string}`],
    temporal: { announcedAt: '2026-09-28T00:00:00.000Z' }, sourceRefs: [SOURCE], lifecycle: { status: 'active' },
  }
  const module: CompetitionModuleV1 = {
    id: 'module:server-competition', type: 'competition', targetEntity: serversRef as `entity:${string}`, schemaId: COMPETITION_MODULE_SCHEMA_ID_V1,
    columns: [
      { id: 'company', label: '公司', role: 'company' },
      { id: 'products', label: '主要产品', role: 'main_products' },
      { id: 'market_cap', label: '最新市值', role: 'market_cap' },
      { id: 'annual_revenue', label: '最新年报营收', role: 'annual_revenue' },
    ],
    rows: [{
      companyRef: companyRef as `entity:${string}`,
      cells: {
        products: { status: 'available', displayValue: 'Server systems', knowledgeRefs: ['claim:company-products'] },
        market_cap: { status: 'available', displayValue: '100', knowledgeRefs: ['claim:company-market-cap'], asOf: '2026-09-30', unit: 'CNY', currency: 'CNY' },
        annual_revenue: { status: 'available', displayValue: '20', knowledgeRefs: ['claim:company-revenue'], fiscalYear: 2025, unit: 'CNY', currency: 'CNY' },
      },
    }, {
      companyRef: companyTwoRef as `entity:${string}`,
      cells: {
        products: { status: 'available', displayValue: 'Restricted product', knowledgeRefs: ['claim:company-two-products-restricted'] },
        market_cap: { status: 'available', displayValue: '200', knowledgeRefs: ['claim:company-two-market-cap'], asOf: '2026-09-29', unit: 'CNY', currency: 'CNY' },
        annual_revenue: { status: 'unavailable', reason: 'No verified annual revenue.' },
      },
    }],
    sourceRefs: [SOURCE],
  }
  const canonicalObjects: KnowledgeAssetV04[] = [
    industry(serversRef, 'Server industry'), industry(pcbRef, 'PCB industry'), industry(consumerRef, 'Consumer electronics'), industry(pendingRef, 'Pending industry'), industry(tvRef, 'Televisions'),
    { id: companyRef, type: 'company', name: 'Fixture Corp', ticker: 'FIX', exchange: 'SSE', lifecycle: { status: 'active' } } as KnowledgeAssetV04,
    { id: companyTwoRef, type: 'company', name: 'Fixture Two', ticker: 'FIX2', exchange: 'SSE', lifecycle: { status: 'active' } } as KnowledgeAssetV04,
    { id: restrictedCompanyRef, type: 'company', name: 'Restricted Exposure Co', ticker: 'REX', exchange: 'SSE', lifecycle: { status: 'active' } } as KnowledgeAssetV04,
    { id: 'entity:company-expired-exposure', type: 'company', name: 'Expired Exposure Co', ticker: 'EEX', exchange: 'SSE', lifecycle: { status: 'active' } } as KnowledgeAssetV04,
    themeServers, themePcb, relation('relation:pcb-server', 'upstream_of', pcbRef, serversRef), relation('relation:server-consumer', 'upstream_of', serversRef, consumerRef), relation('relation:consumer-tv', 'upstream_of', consumerRef, tvRef), businessExposure, businessExposureTwo, restrictedBusinessExposure, expiredBusinessExposure,
    ...rawBackedFacts, ...companyClaims, event, module as unknown as KnowledgeModuleV04,
  ]
  const objects: KnowledgeOperationV04[] = canonicalObjects.map((object, index) => ({ operationId: `object-${index}`, type: 'create', object }))
  const scope = { version: '0.4', themeRef, basedOnRevision: handle.revision, decisions: [includeServers, includePcb, excludeConsumer, pendingIndustry, includeEdge] }
  await write(root, 'theme-workspace-data', objects, scope)
  return { themeRef, service: new ThemeWorkspaceProjectionService(root, clock) }
}

test('Theme graph includes only human-confirmed scope refs, preserves direction, and never expands global edges', async () => {
  await withFreshKb('graph-scope', async (root) => {
    const { themeRef, service } = await seedWorkspace(root)
    const result = await service.getThemeProjection({ themeRef })
    assert.deepEqual(result.graph.nodes.map((node) => node.ref), ['entity:industry-servers', 'entity:industry-pcb'])
    assert.deepEqual(result.graph.edges, [{ ref: 'relation:pcb-server', relationType: 'upstream_of', sourceRef: 'entity:industry-pcb', targetRef: 'entity:industry-servers' }])
    assert.equal(result.graph.nodes.some((node) => node.ref.startsWith('entity:company')), false)
    assert.equal(result.scope.pendingCount, 1)
    assert.equal(result.scope.excludedCount, 1)
    assert.equal(result.scope.basedOnRevision, result.revision)
    const bounded = await service.getThemeProjection({ themeRef, maxNodes: 1 })
    assert.equal(bounded.graph.nodes.length, 1)
    assert.equal(bounded.graph.nodeTotal, 2)
    assert.equal(bounded.graph.truncated, true)
  })
})

test('Industry projection returns bounded facts, deterministic core views, publication-labeled dates, future catalysts and competition units', async () => {
  await withFreshKb('industry-content', async (root) => {
    const { themeRef, service } = await seedWorkspace(root)
    const graph = await service.getThemeProjection({ themeRef })
    const industry = await service.getIndustryProjection({ themeRef, expectedRevision: graph.revision }, 'entity:industry-servers')
    assert.equal(industry.sections.coreViews.items[0]?.ref, 'claim:server-view')
    assert.equal(industry.sections.coreViews.defaultCount, 3)
    assert.equal(industry.sections.timeline.historicalEvents[0]?.dateBasis, 'publication')
    assert.equal(industry.sections.timeline.historicalEvents[0]?.dateLabel, '资料发布日期')
    assert.equal(industry.sections.timeline.futureCatalysts[0]?.dateBasis, 'expected')
    assert.equal(industry.sections.competition?.rows[0]?.cells.find((cell) => cell.columnId === 'market_cap')?.value.status, 'available')
    assert.equal(industry.sections.omittedRestrictedCount, 1)
    assert.deepEqual(industry.companies.map((company) => company.ref), ['entity:company-expired-exposure', 'entity:company-fixture', 'entity:company-fixture-two'])
    const secondRow = industry.sections.competition?.rows.find((row) => row.companyRef === 'entity:company-fixture-two')
    assert.equal(secondRow?.cells.find((cell) => cell.columnId === 'products')?.value.status, 'available')
    assert.equal(secondRow?.cells.find((cell) => cell.columnId === 'market_cap')?.notComparable, true)
    const bounded = await service.getIndustryProjection({ themeRef, maxItemsPerSection: 1 }, 'entity:industry-servers')
    assert.equal(bounded.sections.limited.viewpoint?.truncated, true)
    const byteBounded = await service.getIndustryProjection({ themeRef, maxResponseBytes: 4_096 }, 'entity:industry-servers')
    assert.equal(byteBounded.responseBounds.truncated, true)
    assert.ok(byteBounded.responseBounds.serializedBytes <= byteBounded.responseBounds.maxBytes)
  })
})

test('semantic section classification receives only readable facts and cannot block the base projection', async () => {
  await withFreshKb('section-classification', async (root) => {
    const { themeRef } = await seedWorkspace(root)
    let receivedFacts: readonly { factRef: string }[] = []
    const executor: ReasoningExecutor = {
      capabilities: () => ({ maxContextTokens: 1000, maxOutputTokens: 1000, structuredOutputSupport: true, maxConcurrency: 1 }),
      execute: async (request) => {
        receivedFacts = (request.input as { facts: readonly { factRef: string }[] }).facts
        return { operation: request.operation, output: { assignments: [{ factRef: 'claim:server-view', sectionId: 'industry_chain_analysis' }] } }
      },
    }
    const service = new ThemeWorkspaceProjectionService(root, clock, executor)
    const result = await service.getIndustryProjection({ themeRef }, 'entity:industry-servers')
    const sectionRefs = Object.values(result.sections.factsBySection).flat().map((item) => item.ref)

    assert.equal(receivedFacts.some((item) => item.factRef === 'claim:restricted'), false)
    assert.ok(sectionRefs.includes('claim:server-view'))
    assert.equal(sectionRefs.includes('claim:restricted'), false)
    assert.ok(result.sections.unclassifiedFacts.some((item) => item.ref === 'claim:future-catalyst'))
    assert.equal(sectionRefs.length + result.sections.unclassifiedFacts.length, receivedFacts.length)
    assert.equal(new Set([...sectionRefs, ...result.sections.unclassifiedFacts.map((item) => item.ref)]).size, receivedFacts.length)
    assert.equal(result.sections.classification.status, 'partial')

    const failingExecutor: ReasoningExecutor = {
      ...executor,
      execute: async () => { throw new Error('provider details must not escape') },
    }
    const fallback = await new ThemeWorkspaceProjectionService(root, clock, failingExecutor).getIndustryProjection({ themeRef }, 'entity:industry-servers')
    assert.ok(fallback.sections.factsByType.viewpoint?.length)
    assert.equal(fallback.sections.classification.status, 'llm_failed')
    assert.equal(fallback.sections.classification.reason?.includes('provider details'), false)
  })
})

test('current restricted or expired source rights suppress company exposures and dependent competition data', async () => {
  await withFreshKb('rights-filtering', async (root) => {
    const { themeRef, service } = await seedWorkspace(root)
    const industry = await service.getIndustryProjection({ themeRef }, 'entity:industry-servers')
    assert.deepEqual(industry.companies.map((company) => company.ref), ['entity:company-expired-exposure', 'entity:company-fixture', 'entity:company-fixture-two'])
    await assert.rejects(service.getCompanyProjection({ themeRef }, 'entity:industry-servers', 'entity:company-restricted-exposure'), { code: 'not_found' })
    const afterRightsExpiry = new ThemeWorkspaceProjectionService(root, () => '2026-10-04T00:00:00.000Z')
    const expired = await afterRightsExpiry.getIndustryProjection({ themeRef, asOf: NOW }, 'entity:industry-servers')
    assert.deepEqual(expired.companies, [])
    assert.equal(expired.sections.competition, undefined)
    assert.ok(expired.responseBounds.serializedBytes <= expired.responseBounds.maxBytes)
  })
})

test('company projection is readable through a canonical business exposure without adding a company graph node', async () => {
  await withFreshKb('company-content', async (root) => {
    const { themeRef, service } = await seedWorkspace(root)
    const result = await service.getCompanyProjection({ themeRef }, 'entity:industry-servers', 'entity:company-fixture')
    assert.equal(result.company.name, 'Fixture Corp')
    assert.equal(result.industryRef, 'entity:industry-servers')
  })
})

test('stale expected revision and a corrupt scope ledger fail closed', async () => {
  await withFreshKb('stale', async (root) => {
    const { themeRef, service } = await seedWorkspace(root)
    const graph = await service.getThemeProjection({ themeRef })
    await assert.rejects(service.getThemeProjection({ themeRef, expectedRevision: graph.revision - 1 }), { code: 'conflict' })
    await writeFile(join(root, 'logs', 'research', 'theme-workspace-data.yaml'), '%%%\n')
    await assert.rejects(service.getThemeProjection({ themeRef }), { code: 'failed' })
  })
})
