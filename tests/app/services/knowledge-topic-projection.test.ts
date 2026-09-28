import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { KnowledgeTopicProjectionService } from '../../../app/services/knowledge-topic-projection.ts'

const at = '2026-09-20T10:00:00.000Z'
const active = { status: 'active', validFrom: null, validUntil: null }
const inactive = { status: 'superseded', validFrom: null, validUntil: null }

async function fixture(): Promise<{ root: string; service: KnowledgeTopicProjectionService }> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-topic-projection-'))
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-topic-fixture', now: at })
  const objects: Array<{ type: string; value: Record<string, unknown> }> = [
    { type: 'entity', value: { id: 'entity:theme-a', type: 'investment_theme', name: 'AI Hardware', aliases: ['AI芯片'], description: 'Accelerator supply chain', definition: 'Theme definition', inclusionCriteria: ['AI accelerators'], exclusionCriteria: ['consumer devices'], themeGroupRef: 'theme-group:technology', lifecycle: active } },
    { type: 'entity', value: { id: 'entity:theme-b', type: 'investment_theme', name: 'Robotics', lifecycle: active } },
    { type: 'entity', value: { id: 'entity:industry', type: 'industry', name: 'Semiconductors', lifecycle: active } },
    { type: 'entity', value: { id: 'entity:chipmaker', type: 'company', name: 'Chipmaker', lifecycle: active } },
    { type: 'relation', value: { id: 'relation:theme-a-industry', type: 'theme_exposure', sourceRef: 'entity:theme-a', targetRef: 'entity:industry', contextRefs: ['entity:theme-a'], sourceRefs: ['source:public'], asOf: at, lifecycle: active } },
    { type: 'relation', value: { id: 'relation:theme-b-industry', type: 'theme_exposure', sourceRef: 'entity:theme-b', targetRef: 'entity:industry', lifecycle: active } },
    { type: 'relation', value: { id: 'relation:industry-company', type: 'upstream_of', sourceRef: 'entity:chipmaker', targetRef: 'entity:industry', asOf: at, lifecycle: active } },
    { type: 'relation', value: { id: 'relation:unrelated', type: 'theme_exposure', sourceRef: 'entity:theme-a', targetRef: 'entity:chipmaker', lifecycle: inactive } },
    { type: 'claim', value: { id: 'claim:theme-a', claimType: 'viewpoint', subjectRefs: ['entity:theme-a'], statement: 'Accelerator demand is broadening.', sourceRefs: ['source:public'], createdAt: at, lifecycle: active } },
    { type: 'claim', value: { id: 'claim:theme-b', claimType: 'fact', subjectRefs: ['entity:theme-b'], statement: 'Robotics claim.', sourceRefs: ['source:public'], lifecycle: active } },
    { type: 'claim', value: { id: 'claim:old', claimType: 'fact', subjectRefs: ['entity:theme-a'], statement: 'Historical statement.', lifecycle: inactive } },
    { type: 'observation', value: { id: 'observation:industry-metric', observationType: 'metric', subjectRef: 'entity:industry', metricRef: 'market_size', value: 42, unit: 'USD bn', observedAt: at, sourceRef: 'source:public', provenance: [{ sourceRef: 'source:public', rawRef: 'raw-sha256-secret', locator: 'C:\\private\\local.pdf' }], lifecycle: active } },
    { type: 'observation', value: { id: 'observation:estimate', observationType: 'estimate', subjectRef: 'entity:industry', metricRef: 'revenue', fiscalPeriod: 'FY2027', estimateValue: 100, institutionRef: 'entity:chipmaker', publishedAt: at, sourceRef: 'source:restricted', lifecycle: active } },
    { type: 'observation', value: { id: 'observation:consensus', observationType: 'consensus', subjectRef: 'entity:industry', metricRef: 'revenue', fiscalPeriod: 'FY2027', asOf: at, mean: 100, count: 5, contributingObservationRefs: ['observation:estimate'], sourceRef: 'source:restricted', lifecycle: active } },
    { type: 'observation', value: { id: 'observation:company-metric', observationType: 'metric', subjectRef: 'entity:chipmaker', metricRef: 'capacity', value: 12, unit: 'fab lines', sourceRef: 'source:public', lifecycle: active } },
    { type: 'event', value: { id: 'event:theme', eventType: 'capacity_expansion', title: 'New fab capacity', subjectRefs: ['entity:theme-a'], temporal: { occurredAt: at }, sourceRefs: ['source:restricted'], lifecycle: active } },
    { type: 'thesis', value: { id: 'thesis:theme', subjectRefs: ['entity:theme-a'], title: 'Thesis title', statement: 'Thesis statement.', status: 'invalidated', lastReviewedAt: at, lifecycle: active } },
    { type: 'reasoning_edge', value: { id: 'reasoning-edge:thesis-claim', type: 'challenges', sourceRef: 'claim:theme-a', targetRef: 'thesis:theme', sourceRefs: ['source:public'], lifecycle: active } },
    { type: 'module', value: { id: 'module:theme', type: 'comparison', targetEntity: 'entity:theme-a', schemaId: 'comparison-v1', columns: [{ name: 'company' }], rows: [{ company: 'Chipmaker' }] } },
    { type: 'source', value: { id: 'source:public', title: 'Public filing', publisher: 'Exchange', sourceType: 'filing', canonicalUrl: 'https://example.test/filing', publishedAt: at, rights: { accessScope: 'public', providerTermsKnown: true, redistributionAllowed: false }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, rawRefs: ['raw-sha256-secret'], lifecycle: active } },
    { type: 'source', value: { id: 'source:restricted', title: 'Restricted report', publisher: 'Broker', sourceType: 'broker_research', canonicalUrl: 'https://private.example.test/report', rights: { accessScope: 'restricted', providerTermsKnown: false, redistributionAllowed: false }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: false, allowDerivedKnowledge: false, redistributionAllowed: false }, rawRefs: ['raw-sha256-private'], lifecycle: active } },
    { type: 'source', value: { id: 'source:unsafe', title: 'Unsafe URL', sourceType: 'other', canonicalUrl: 'file:///private/report.pdf', rights: { accessScope: 'public', providerTermsKnown: true }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: false, allowAiProcessing: false, allowDerivedKnowledge: false, redistributionAllowed: false }, lifecycle: active } },
  ]
  const registry: Record<string, { type: string; storageRef: string }> = {}
  for (const { type, value } of objects) {
    const id = String(value.id)
    const directory = ({ entity: 'entities', relation: 'relations', claim: 'claims', observation: 'observations', event: 'events', thesis: 'theses', reasoning_edge: 'reasoning-edges', module: 'modules', source: 'sources' } as Record<string, string>)[type]!
    const storageRef = `${directory}/${id.replaceAll(':', '-')}.json`
    await writeFile(join(root, storageRef), `${JSON.stringify(value)}\n`)
    registry[id] = { type, storageRef }
  }
  await writeFile(join(root, 'registry', 'assets.yaml'), `${JSON.stringify(registry)}\n`)
  return { root, service: new KnowledgeTopicProjectionService(root) }
}

test('topic projection separates direct membership from related industry records and retains actual paths', async (t) => {
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const summary = await service.getSummary('entity:theme-a', 2)
  assert.equal(summary.theme.name, 'AI Hardware')
  assert.equal(summary.theme.definition, 'Theme definition')
  assert.equal(summary.counts.direct.claim.total, 1)
  assert.equal(summary.counts.direct.observation.total, 0)
  assert.equal(summary.counts.direct.event.total, 1)
  assert.equal(summary.counts.direct.thesis.total, 1)
  assert.equal(summary.counts.direct.reasoning_edge.total, 1)
  assert.equal(summary.counts.direct.module.total, 1)
  assert.equal(summary.counts.connected.observation.total, 4)
  assert.equal(summary.counts.connected.observation.totalExact, true)
  assert.equal((await service.getSummary('entity:theme-a', 1)).counts.connected.observation.total, 3)

  const connected = await service.listItems({ themeRef: 'entity:theme-a', kind: 'observation', scope: 'connected', depth: 2 })
  assert.deepEqual(connected.items.map((item) => item.ref), ['observation:consensus', 'observation:estimate', 'observation:industry-metric', 'observation:company-metric'])
  const metric = connected.items.find((item) => item.ref === 'observation:industry-metric')!
  assert.deepEqual(metric.associationPaths?.[0]?.hops.map((hop) => [hop.sourceRef, hop.targetRef]), [['entity:theme-a', 'entity:industry']])
  assert.equal(metric.scope, 'connected')

  assert.equal(connected.total, 4)
  const companyMetric = connected.items.find((item) => item.ref === 'observation:company-metric')!
  assert.deepEqual(companyMetric.associationPaths?.[0]?.hops.map((hop) => [hop.sourceRef, hop.targetRef]), [
    ['entity:theme-a', 'entity:industry'],
    ['entity:chipmaker', 'entity:industry'],
  ])

  const noThemeB = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim' })
  assert.deepEqual(noThemeB.items.map((item) => item.ref), ['claim:theme-a'])
})

test('summary and items honor lifecycle, thesis state, source rights, and allowlisted privacy fields', async (t) => {
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))

  const activeClaims = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim' })
  assert.deepEqual(activeClaims.items.map((item) => item.ref), ['claim:theme-a'])
  const history = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', filters: { lifecycle: 'all' } })
  assert.equal(history.total, 2)

  const thesis = await service.listItems({ themeRef: 'entity:theme-a', kind: 'thesis' })
  assert.equal(thesis.items[0]?.fields.status, 'invalidated')
  assert.equal(thesis.items[0]?.lifecycleStatus, 'active')

  const sources = await service.listItems({ themeRef: 'entity:theme-a', kind: 'source' })
  assert.deepEqual(sources.items.map((item) => item.ref), ['source:public', 'source:restricted'])
  assert.equal(sources.items[0]?.fields.canonicalUrl, 'https://example.test/filing')
  assert.equal(sources.items[1]?.fields.canonicalUrl, undefined)
  const serialized = JSON.stringify(sources)
  assert.doesNotMatch(serialized, /private\.example|file:\/\/|raw-sha256|private\\local|rawRefs|locator/)
  const observations = await service.listItems({ themeRef: 'entity:theme-a', kind: 'observation', scope: 'connected' })
  assert.doesNotMatch(JSON.stringify(observations), /C:\\\\private|raw-sha256-secret|locator/)
})

test('pagination is deterministic and rejects changed revisions and parameter bindings', async (t) => {
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', filters: { lifecycle: 'all' }, limit: 1 })
  assert.equal(first.items[0]?.ref, 'claim:theme-a')
  assert.ok(first.nextCursor)
  const second = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', filters: { lifecycle: 'all' }, limit: 1, cursor: first.nextCursor })
  assert.equal(second.items[0]?.ref, 'claim:old')
  await assert.rejects(service.listItems({ themeRef: 'entity:theme-a', kind: 'event', filters: { lifecycle: 'all' }, limit: 1, cursor: first.nextCursor }), { code: 'conflict' })

  const manifest = JSON.parse(await readFile(join(root, 'manifest.yaml'), 'utf8')) as Record<string, unknown>
  manifest.revision = 1
  await writeFile(join(root, 'manifest.yaml'), `${JSON.stringify(manifest)}\n`)
  await assert.rejects(service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', filters: { lifecycle: 'all' }, limit: 1, cursor: first.nextCursor }), { code: 'conflict' })
})

test('bounded input and root validation return identifiable errors', async (t) => {
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(service.listItems({ themeRef: 'not-a-ref', kind: 'claim' }), { code: 'invalid_input' })
  await assert.rejects(service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', limit: 101 }), { code: 'invalid_input' })
  await assert.rejects(service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', cursor: 'forged' }), { code: 'invalid_input' })
  await assert.rejects(service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', filters: { claimType: 'made_up' } }), { code: 'invalid_input' })
  await assert.rejects(service.getSummary('entity:industry'), { code: 'invalid_input' })
  await assert.rejects(service.getSummary('entity:missing'), { code: 'not_found' })
  await assert.rejects(new KnowledgeTopicProjectionService().getSummary('entity:theme-a'), { code: 'no_kb_mounted' })
})

test('projection rejects a mounted Schema 0.3 base with an explicit unsupported schema error', async (t) => {
  const { root } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const manifest = JSON.parse(await readFile(join(root, 'manifest.yaml'), 'utf8')) as Record<string, unknown>
  manifest.schemaVersion = '0.3'
  await writeFile(join(root, 'manifest.yaml'), `${JSON.stringify(manifest)}\n`)
  await assert.rejects(new KnowledgeTopicProjectionService(root).getSummary('entity:theme-a'), /schema_not_supported/)
})

test('broken references fail closed for included records', async (t) => {
  const { root } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'claims', 'claim-theme-a.json')
  const claim = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  claim.sourceRefs = ['source:missing']
  await writeFile(path, `${JSON.stringify(claim)}\n`)
  await assert.rejects(new KnowledgeTopicProjectionService(root).listItems({ themeRef: 'entity:theme-a', kind: 'claim' }), /broken_reference/)
})
