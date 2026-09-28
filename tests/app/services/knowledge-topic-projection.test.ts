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
  const root = await mkdtemp(join(tmpdir(), 'rhl-tp-'))
  await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-topic-fixture', now: at })
  const objects: Array<{ type: string; value: Record<string, unknown> }> = [
    { type: 'entity', value: { id: 'entity:theme-a', type: 'investment_theme', name: 'AI Hardware', aliases: ['AI芯片'], description: 'Accelerator supply chain /home/research/private.txt', definition: 'Theme definition', inclusionCriteria: ['AI accelerators'], exclusionCriteria: ['consumer devices'], themeGroupRef: 'theme-group:technology', lifecycle: active } },
    { type: 'entity', value: { id: 'entity:theme-b', type: 'investment_theme', name: 'Robotics', lifecycle: active } },
    { type: 'entity', value: { id: 'entity:industry', type: 'industry', name: 'Semiconductors', lifecycle: active } },
    { type: 'entity', value: { id: 'entity:chipmaker', type: 'company', name: 'Chipmaker', lifecycle: active } },
    { type: 'relation', value: { id: 'relation:theme-a-industry', type: 'theme_exposure', sourceRef: 'entity:theme-a', targetRef: 'entity:industry', contextRefs: ['entity:theme-a'], sourceRefs: ['source:public'], asOf: at, lifecycle: active } },
    { type: 'relation', value: { id: 'relation:theme-b-industry', type: 'theme_exposure', sourceRef: 'entity:theme-b', targetRef: 'entity:industry', lifecycle: active } },
    { type: 'relation', value: { id: 'relation:industry-company', type: 'upstream_of', sourceRef: 'entity:chipmaker', targetRef: 'entity:industry', asOf: at, lifecycle: active } },
    { type: 'relation', value: { id: 'relation:unrelated', type: 'theme_exposure', sourceRef: 'entity:theme-a', targetRef: 'entity:chipmaker', lifecycle: inactive } },
    { type: 'claim', value: { id: 'claim:theme-a', claimType: 'viewpoint', subjectRefs: ['entity:theme-a'], statement: 'Accelerator demand is broadening.', sourceRefs: ['source:public'], supportsClaimRefs: ['claim:theme-b'], createdAt: '2026-09-20T11:00:00+02:00', lifecycle: active } },
    { type: 'claim', value: { id: 'claim:theme-b', claimType: 'fact', subjectRefs: ['entity:theme-b'], statement: 'Robotics claim.', sourceRefs: ['source:public'], lifecycle: active } },
    { type: 'claim', value: { id: 'claim:old', claimType: 'fact', subjectRefs: ['entity:theme-a'], statement: 'Historical statement.', createdAt: '2026-09-20T10:30:00Z', lifecycle: inactive } },
    { type: 'observation', value: { id: 'observation:industry-metric', observationType: 'metric', subjectRef: 'entity:industry', metricRef: 'market_size', value: 42, unit: 'USD bn', period: 'FY2026', dimensions: { region: 'global', product: 'accelerators', unsafe: { path: '/private/nope' } }, observedAt: at, sourceRef: 'source:public', provenance: [{ sourceRef: 'source:public', rawRef: 'raw-sha256-secret', locator: 'C:\\private\\local.pdf' }], lifecycle: active } },
    { type: 'observation', value: { id: 'observation:estimate', observationType: 'estimate', subjectRef: 'entity:industry', metricRef: 'revenue', fiscalPeriod: 'FY2027', estimateValue: 100, unit: 'USD bn', currency: 'USD', institutionRef: 'entity:chipmaker', analystRef: 'entity:chipmaker', estimateHorizon: '12m', revisionOf: 'observation:estimate-old', publishedAt: at, sourceRef: 'source:restricted', lifecycle: active } },
    { type: 'observation', value: { id: 'observation:estimate-old', observationType: 'estimate', subjectRef: 'entity:industry', metricRef: 'revenue', fiscalPeriod: 'FY2027', estimateValue: 90, institutionRef: 'entity:chipmaker', publishedAt: '2026-09-01T10:00:00.000Z', sourceRef: 'source:restricted', lifecycle: inactive } },
    { type: 'observation', value: { id: 'observation:consensus', observationType: 'consensus', subjectRef: 'entity:industry', metricRef: 'revenue', fiscalPeriod: 'FY2027', asOf: at, mean: 100, median: 99, high: 120, low: 80, count: 5, dispersion: 12, contributingObservationRefs: ['observation:estimate'], sourceRef: 'source:restricted', lifecycle: active } },
    { type: 'observation', value: { id: 'observation:company-metric', observationType: 'metric', subjectRef: 'entity:chipmaker', metricRef: 'capacity', value: 'C:\\private\\users\\research\\capacity.csv', unit: 'fab lines', sourceRef: 'source:public', lifecycle: active } },
    { type: 'event', value: { id: 'event:theme', eventType: 'capacity_expansion', title: 'New fab capacity', subjectRefs: ['entity:theme-a'], participantRefs: ['entity:chipmaker'], temporal: { occurredAt: '2026-09-21T10:00:00.000Z' }, sourceRefs: ['source:restricted'], lifecycle: active } },
    { type: 'thesis', value: { id: 'thesis:theme', subjectRefs: ['entity:theme-a'], title: 'Thesis title', statement: 'Thesis statement.', status: 'invalidated', lastReviewedAt: at, lifecycle: active } },
    { type: 'thesis', value: { id: 'thesis:theme-b', subjectRefs: ['entity:theme-b'], title: 'Robotics thesis', statement: 'Private theme thesis.', status: 'active', lifecycle: active } },
    { type: 'reasoning_edge', value: { id: 'reasoning-edge:thesis-claim', type: 'challenges', sourceRef: 'claim:theme-a', targetRef: 'thesis:theme', sourceRefs: ['source:public'], lifecycle: active } },
    { type: 'module', value: { id: 'module:theme', type: 'comparison', targetEntity: 'entity:theme-a', schemaId: 'comparison-v1', columns: [{ name: 'company' }], rows: [{ company: 'Chipmaker' }] } },
    { type: 'source', value: { id: 'source:public', title: 'Public filing', publisher: 'Exchange', provider: 'exchange-feed', sourceType: 'filing', canonicalUrl: 'https://example.test/filing', publishedAt: '2026-09-22T10:00:00.000Z', rights: { accessScope: 'public', providerTermsKnown: true, redistributionAllowed: false, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, expiresAt: '2027-01-01T00:00:00.000Z', policyBasis: 'Public filing terms' }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, rawRefs: ['raw-sha256-secret'], lifecycle: active } },
    { type: 'source', value: { id: 'source:restricted', title: 'Restricted report', publisher: 'Broker', sourceType: 'broker_research', canonicalUrl: 'https://private.example.test/report', rights: { accessScope: 'restricted', providerTermsKnown: false, redistributionAllowed: 'conditional', retentionAllowed: false, aiProcessingAllowed: false, derivativeKnowledgeAllowed: false }, usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: false, allowDerivedKnowledge: false, redistributionAllowed: false }, rawRefs: ['raw-sha256-private'], lifecycle: active } },
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
  assert.equal(summary.theme.themeGroupRef, 'theme-group:technology')
  assert.equal(summary.theme.definition, 'Theme definition')
  assert.equal(summary.theme.description, 'Accelerator supply chain [local path omitted]')
  assert.equal(summary.overview.direct.latestDatedRecord?.ref, 'source:public')
  assert.equal(summary.overview.direct.latestDatedRecord?.dateField, 'publishedAt')
  assert.equal(summary.overview.direct.nonSourceRecordsWithoutExplicitSourceRef, 2)
  assert.equal(summary.overview.direct.totalExact, true)
  assert.equal(summary.overview.connected.latestDatedRecord?.ref, 'observation:consensus')
  assert.equal(summary.overview.connected.nonSourceRecordsWithoutExplicitSourceRef, 1)
  assert.equal(summary.overview.connected.totalExact, true)
  assert.equal(summary.overview.connected.truncated, false)
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
  assert.equal(metric.fields.value, 42)
  assert.deepEqual(metric.fields.dimensions, ['product=accelerators', 'region=global'])
  assert.equal(metric.fields.period, 'FY2026')
  assert.equal(metric.fields.raw, undefined)

  const estimate = connected.items.find((item) => item.ref === 'observation:estimate')!
  assert.equal(estimate.fields.institutionRef, 'entity:chipmaker')
  assert.equal(estimate.fields.analystRef, 'entity:chipmaker')
  assert.equal(estimate.fields.currency, 'USD')
  assert.equal(estimate.fields.estimateHorizon, '12m')
  assert.equal(estimate.fields.revisionOf, 'observation:estimate-old')
  const consensus = connected.items.find((item) => item.ref === 'observation:consensus')!
  assert.equal(consensus.fields.median, 99)
  assert.equal(consensus.fields.high, 120)
  assert.equal(consensus.fields.low, 80)
  assert.equal(consensus.fields.dispersion, 12)
  assert.deepEqual(consensus.fields.contributingObservationRefs, ['observation:estimate'])

  assert.equal(connected.total, 4)
  const companyMetric = connected.items.find((item) => item.ref === 'observation:company-metric')!
  assert.deepEqual(companyMetric.associationPaths?.[0]?.hops.map((hop) => [hop.sourceRef, hop.targetRef]), [
    ['entity:theme-a', 'entity:industry'],
    ['entity:chipmaker', 'entity:industry'],
  ])
  assert.equal(companyMetric.fields.value, '[local path omitted]')
  assert.doesNotMatch(JSON.stringify(connected), /C:\\\\private\\\\users\\\\research/)

  const noThemeB = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim' })
  assert.deepEqual(noThemeB.items.map((item) => item.ref), ['claim:theme-a'])
  const connectedClaims = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', scope: 'connected', depth: 2 })
  assert.deepEqual(connectedClaims.items.map((item) => item.ref), [])
  const connectedTheses = await service.listItems({ themeRef: 'entity:theme-a', kind: 'thesis', scope: 'connected', depth: 2 })
  assert.deepEqual(connectedTheses.items.map((item) => item.ref), [])
  const connectedRelations = await service.listItems({ themeRef: 'entity:theme-a', kind: 'relation', scope: 'connected', depth: 2 })
  assert.ok(!connectedRelations.items.some((item) => item.ref === 'relation:theme-b-industry'))
  assert.ok(!connectedRelations.items.some((item) => item.ref === 'relation:theme-a-industry'))
  const directRelations = await service.listItems({ themeRef: 'entity:theme-a', kind: 'relation', scope: 'direct', depth: 2 })
  assert.ok(directRelations.items.some((item) => item.ref === 'relation:theme-a-industry'))
  assert.equal(directRelations.total, summary.counts.direct.relation.total)
  assert.equal(connectedRelations.total, summary.counts.connected.relation.total)
  const directSources = await service.listItems({ themeRef: 'entity:theme-a', kind: 'source', scope: 'direct', depth: 2 })
  const connectedSources = await service.listItems({ themeRef: 'entity:theme-a', kind: 'source', scope: 'connected', depth: 2 })
  assert.equal(directSources.total, summary.counts.direct.source.total)
  assert.equal(connectedSources.total, summary.counts.connected.source.total)
  assert.equal(connectedSources.total, 0)
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
  assert.equal(sources.items[0]?.fields.provider, 'exchange-feed')
  assert.equal(sources.items[0]?.fields.rightsAiProcessingAllowed, true)
  assert.equal(sources.items[0]?.fields.rightsDerivativeKnowledgeAllowed, true)
  assert.equal(sources.items[0]?.fields.rightsRetentionAllowed, true)
  assert.equal(sources.items[0]?.fields.rightsRedistributionAllowed, false)
  assert.equal(sources.items[0]?.fields.rightsExpiresAt, '2027-01-01T00:00:00.000Z')
  assert.equal(sources.items[0]?.fields.usagePolicyRetainRaw, true)
  assert.equal(sources.items[0]?.fields.usagePolicyAllowAiProcessing, true)
  assert.equal(sources.items[0]?.fields.usagePolicyAllowDerivedKnowledge, true)
  assert.equal(sources.items[0]?.fields.usagePolicyRedistributionAllowed, false)
  assert.deepEqual(sources.items[0]?.fields.referencedByRefs, ['claim:theme-a', 'reasoning-edge:thesis-claim', 'relation:theme-a-industry'])
  assert.equal(sources.items[0]?.fields.referencedByTotal, 3)
  assert.equal(sources.items[0]?.fields.referencedByTruncated, false)
  assert.equal(sources.items[1]?.fields.canonicalUrl, undefined)
  assert.equal(sources.items[1]?.fields.rightsRedistributionAllowed, 'conditional')
  assert.equal(sources.items[1]?.fields.rightsAiProcessingAllowed, false)
  assert.equal(sources.items[1]?.fields.usagePolicyAllowAiProcessing, false)
  const serialized = JSON.stringify(sources)
  assert.doesNotMatch(serialized, /private\.example|file:\/\/|raw-sha256|private\\local|rawRefs|locator/)
  const observations = await service.listItems({ themeRef: 'entity:theme-a', kind: 'observation', scope: 'connected' })
  assert.doesNotMatch(JSON.stringify(observations), /C:\\\\private|raw-sha256-secret|locator/)
  assert.doesNotMatch(JSON.stringify(observations), /\/private\/nope/)
})

test('source reverse references are deduplicated and bounded with explicit truncation metadata', async (t) => {
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registryPath = join(root, 'registry', 'assets.yaml')
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, { type: string; storageRef: string }>
  for (let index = 0; index < 65; index += 1) {
    const id = `claim:backlink-${String(index).padStart(3, '0')}`
    const storageRef = `claims/${id.replaceAll(':', '-')}.json`
    await writeFile(join(root, storageRef), JSON.stringify({ id, claimType: 'fact', statement: 'Backlink fixture', subjectRefs: ['entity:theme-a'], sourceRefs: ['source:public'], lifecycle: active }))
    registry[id] = { type: 'claim', storageRef }
  }
  await writeFile(registryPath, `${JSON.stringify(registry)}\n`)
  const sources = await service.listItems({ themeRef: 'entity:theme-a', kind: 'source' })
  const publicSource = sources.items.find((item) => item.ref === 'source:public')!
  assert.ok(Array.isArray(publicSource.fields.referencedByRefs))
  assert.equal(publicSource.fields.referencedByRefs.length, 64)
  assert.equal(publicSource.fields.referencedByTotal, 68)
  assert.equal(publicSource.fields.referencedByTruncated, true)
})

test('focus suggestions are capped with total metadata in summary and item pages', async (t) => {
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registryPath = join(root, 'registry', 'assets.yaml')
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, { type: string; storageRef: string }>
  for (let target = 0; target < 65; target += 1) {
    const targetRef = `entity:focus-${String(target).padStart(3, '0')}`
    const entityStorageRef = `entities/${targetRef.replaceAll(':', '-')}.json`
    await writeFile(join(root, entityStorageRef), JSON.stringify({ id: targetRef, type: 'company', name: `Focus ${target}`, lifecycle: active }))
    registry[targetRef] = { type: 'entity', storageRef: entityStorageRef }
    for (let path = 0; path < 33; path += 1) {
      const relationRef = `relation:focus-${String(target).padStart(3, '0')}-${String(path).padStart(2, '0')}`
      const relationStorageRef = `relations/${relationRef.replaceAll(':', '-')}.json`
      await writeFile(join(root, relationStorageRef), JSON.stringify({ id: relationRef, type: 'theme_exposure', sourceRef: 'entity:theme-a', targetRef, lifecycle: active }))
      registry[relationRef] = { type: 'relation', storageRef: relationStorageRef }
    }
  }
  await writeFile(registryPath, `${JSON.stringify(registry)}\n`)
  const summary = await service.getSummary('entity:theme-a')
  assert.equal(summary.connected.focusRefs.length, 64)
  assert.equal(summary.connected.focusRefsTotal, 65)
  assert.equal(summary.connected.focusRefsTruncated, true)
  const page = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', scope: 'connected' })
  assert.equal(page.focusRefs.length, 64)
  assert.equal(page.focusRefsTotal, 65)
  assert.equal(page.focusRefsTruncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(summary), 'utf8') <= 1024 * 1024)
  assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') <= 1024 * 1024)
})

test('large topic pages honor the byte cap and cursor through every source without duplicates', async (t) => {
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const registryPath = join(root, 'registry', 'assets.yaml')
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, { type: string; storageRef: string }>
  const sourceRefs = Array.from({ length: 100 }, (_, index) => `source:large-${String(index).padStart(3, '0')}`)
  for (const [index, sourceRef] of sourceRefs.entries()) {
    const storageRef = `sources/${sourceRef.replaceAll(':', '-')}.json`
    await writeFile(join(root, storageRef), JSON.stringify({ id: sourceRef, title: `Large source ${index}`, publisher: 'Fixture', sourceType: 'filing', rights: { accessScope: 'restricted', providerTermsKnown: false }, lifecycle: active }))
    registry[sourceRef] = { type: 'source', storageRef }
  }
  for (let index = 0; index < 64; index += 1) {
    const id = `claim:${'c'.repeat(150)}${String(index).padStart(2, '0')}`
    const storageRef = `claims/${id.replaceAll(':', '-')}.json`
    await writeFile(join(root, storageRef), JSON.stringify({ id, claimType: 'fact', statement: 'Large page fixture', subjectRefs: ['entity:theme-a'], sourceRefs, lifecycle: active }))
    registry[id] = { type: 'claim', storageRef }
  }
  await writeFile(registryPath, `${JSON.stringify(registry)}\n`)

  const refsSeen: string[] = []
  let cursor: string | undefined
  let firstPageBounded = false
  do {
    const page = await service.listItems({ themeRef: 'entity:theme-a', kind: 'source', limit: 100, ...(cursor === undefined ? {} : { cursor }) })
    assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') <= 1024 * 1024)
    assert.equal(page.total, 102)
    if (refsSeen.length === 0) firstPageBounded = page.responseBounded
    refsSeen.push(...page.items.map((item) => item.ref))
    cursor = page.nextCursor
  } while (cursor)

  assert.equal(firstPageBounded, true)
  assert.equal(refsSeen.length, 102)
  assert.equal(new Set(refsSeen).size, 102)
  assert.equal(refsSeen.filter((ref) => sourceRefs.includes(ref)).length, 100)
})

test('pagination is deterministic and rejects changed revisions and parameter bindings', async (t) => {
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const first = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', filters: { lifecycle: 'all' }, limit: 1 })
  assert.equal(first.items[0]?.ref, 'claim:old')
  assert.ok(first.nextCursor)
  const second = await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', filters: { lifecycle: 'all' }, limit: 1, cursor: first.nextCursor })
  assert.equal(second.items[0]?.ref, 'claim:theme-a')
  await assert.rejects(service.listItems({ themeRef: 'entity:theme-a', kind: 'event', filters: { lifecycle: 'all' }, limit: 1, cursor: first.nextCursor }), { code: 'conflict' })
  await assert.rejects(service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', expectedRevision: 1 }), { code: 'conflict' })
  await assert.rejects(service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', expectedRevision: Number.MAX_SAFE_INTEGER + 1 }), { code: 'invalid_input' })
  assert.equal((await service.listItems({ themeRef: 'entity:theme-a', kind: 'claim', expectedRevision: 0 })).revision, 0)

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
  const { root, service } = await fixture()
  t.after(() => rm(root, { recursive: true, force: true }))
  const brokenFields: Array<{ readonly path: string; readonly field: string; readonly value: unknown; readonly request: () => Promise<unknown> }> = [
    { path: 'claims/claim-theme-a.json', field: 'sourceRefs', value: ['source:missing'], request: () => service.listItems({ themeRef: 'entity:theme-a', kind: 'claim' }) },
    { path: 'claims/claim-theme-a.json', field: 'supportsClaimRefs', value: ['claim:missing'], request: () => service.listItems({ themeRef: 'entity:theme-a', kind: 'claim' }) },
    { path: 'observations/observation-estimate.json', field: 'revisionOf', value: 'observation:missing', request: () => service.listItems({ themeRef: 'entity:theme-a', kind: 'observation', scope: 'connected' }) },
    { path: 'observations/observation-estimate.json', field: 'institutionRef', value: 'entity:missing', request: () => service.listItems({ themeRef: 'entity:theme-a', kind: 'observation', scope: 'connected' }) },
    { path: 'observations/observation-consensus.json', field: 'contributingObservationRefs', value: ['observation:missing'], request: () => service.listItems({ themeRef: 'entity:theme-a', kind: 'observation', scope: 'connected' }) },
    { path: 'events/event-theme.json', field: 'participantRefs', value: ['entity:missing'], request: () => service.listItems({ themeRef: 'entity:theme-a', kind: 'event' }) },
  ]
  for (const item of brokenFields) {
    const path = join(root, item.path)
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    value[item.field] = item.value
    await writeFile(path, `${JSON.stringify(value)}\n`)
    await assert.rejects(item.request(), /broken_reference/, `${item.path} ${item.field}`)
    delete value[item.field]
    await writeFile(path, `${JSON.stringify(value)}\n`)
  }
})
