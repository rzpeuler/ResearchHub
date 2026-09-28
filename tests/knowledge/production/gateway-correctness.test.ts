import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import type { KnowledgeProductionInput, KnowledgeProductionOutcome } from '../../../knowledge/production/contracts.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'
import { validateUsableAcquisitionPayload } from '../../../plugins/research-acquisition/payload-validation.ts'
import { listReviewCases } from '../../../knowledge/review/store.ts'
import { loadKnowledgeBaseManifest } from '../../../knowledge/storage/manifest-loader.ts'
import { hashKillCriterionDefinitionV04 } from '../../../knowledge/schema/kill-criterion-v04.ts'

const clock = () => '2026-09-08T00:00:00.000Z'
function source(symbol: string, candidateId = `structured-${symbol}`, value = 'same bytes'): NormalizedResearchSource { return { candidate: { candidateId, kind: 'structured_data', tier: 2, title: 'Financial fixture', provider: 'akshare', metadata: { companySymbol: symbol, dataKind: 'financial', period: 'FY2027' } }, retrievedAt: clock(), title: 'Financial fixture', content: value, contentHash: 'a'.repeat(64), publisher: 'AKShare', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } } }
async function input(root: string, run: string, symbol = '600519', proposals: KnowledgeProductionInput['proposals'] = [], evidence: readonly NormalizedResearchSource[] = [source(symbol)]): Promise<KnowledgeProductionInput> { return { handle: await new KnowledgeBaseRegistry().mount(root), producerType: 'company_deep_research', producerRunId: run, schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: symbol, aliases: [symbol], semanticFields: { ticker: symbol, exchange: symbol.startsWith('6') ? 'SSE' : 'SZSE' } }, proposals, evidenceBindings: evidence.map((item) => ({ localSourceId: item.candidate.candidateId, source: item })), asOf: '2026-09-08T00:00:00.000Z', now: clock } }
function claim(proposalId: string, value: unknown, temporal?: unknown, resolution?: 'supersede' | 'contradict' | 'review') { return { proposalId, kind: 'claim' as const, subjectKey: 'company', claimType: 'forecast' as const, statement: `EPS is ${String(value)}`, sourceCandidateIds: ['structured-600519'], structuredValue: { metric: 'eps', value, unit: 'CNY', comparator: null, period: 'FY2027' }, ...(temporal === undefined ? {} : { temporal }), ...(resolution === undefined ? {} : { resolution }), probability: 0.7 } }

test('usable acquisition validation excludes empty, null, error, and all-empty payloads', () => {
  for (const value of [[], {}, null, undefined, '', { data: [] }, { success: false, error: 'quota' }, { a: null, b: '' }]) assert.notEqual(validateUsableAcquisitionPayload(value).status, 'usable')
  assert.equal(validateUsableAcquisitionPayload([{ row: 1 }]).status, 'usable')
})

test('same Raw bytes can back distinct provenance-context Sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-source-identity-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-source-identity', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const first = await gateway.submit(await input(root, 'source-600519', '600519'))
    const second = await gateway.submit(await input(root, 'source-000858', '000858', [], [source('000858', 'structured-000858')]))
    assert.equal(first.status, 'committed'); assert.equal(second.status, 'committed')
    const assets = await readCanonicalV04Assets(root); const sources = assets.objects.filter((item) => item.kind === 'source'); const raws = new Set(sources.flatMap((item) => (item.value as { rawRefs?: string[] }).rawRefs ?? []))
    assert.equal(sources.length, 2); assert.equal(raws.size, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('writeKnowledge false resolves proposals without changing canonical revision or review cases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-dry-run-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-dry-run', now: clock() })
    const gateway = new KnowledgeProductionGateway()
    const before = await readCanonicalV04Assets(root); const beforeManifest = await loadKnowledgeBaseManifest(root)
    const result = await gateway.submit({ ...(await input(root, 'dry-run')), proposals: [claim('dry-claim', 42)], writeKnowledge: false })
    const after = await readCanonicalV04Assets(root)
    assert.equal(result.status, 'no_changes')
    assert.equal(result.knowledgeBaseRevision, beforeManifest.revision)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, beforeManifest.revision)
    assert.deepEqual(after.objects.map((item) => item.value.id), before.objects.map((item) => item.value.id))
    assert.deepEqual(await listReviewCases(root), [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Claim identity ignores Research AsOf but preserves explicit Claim temporal observations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-temporal-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-temporal', now: clock() }); const gateway = new KnowledgeProductionGateway(); const firstInput = await input(root, 'temporal-1'); const first = await gateway.submit({ ...firstInput, proposals: [claim('eps-1', 42)] }); assert.equal(first.status, 'committed')
    const second = await gateway.submit({ ...(await input(root, 'temporal-2')), asOf: '2026-09-09T00:00:00.000Z', proposals: [claim('eps-2', 42)] }); assert.equal(second.status, 'no_changes', second.errors.join('; '))
    const priceClaim = (id: string, day: string) => ({ ...claim(id, 1), statement: `Price is observed on ${day}`, structuredValue: { metric: 'market_price', value: 1, unit: 'CNY', comparator: null }, temporal: { asOf: day, scope: { type: 'point_in_time', start: day, end: day, label: day } } })
    const third = await gateway.submit({ ...(await input(root, 'temporal-3')), proposals: [priceClaim('price-1', '2026-09-08'), priceClaim('price-2', '2026-09-09')] }); assert.equal(third.status, 'committed', third.errors.join('; '))
    const assets = await readCanonicalV04Assets(root); assert.equal(assets.objects.filter((item) => item.kind === 'claim').length, 3)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Company Relation proposals are validated, canonicalized, and deduplicated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-relation-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-relation', now: clock() }); const gateway = new KnowledgeProductionGateway(); const industry = { proposalId: 'industry', kind: 'entity' as const, subjectKey: 'industry', entityType: 'industry' as const, entityName: 'Beverage Industry' }; const relation = { proposalId: 'belongs', kind: 'relation' as const, subjectKey: 'company', targetKey: 'industry', relationType: 'belongs_to_industry', sourceCandidateIds: ['structured-600519'] }
    const first = await gateway.submit({ ...(await input(root, 'relation-1')), proposals: [industry, relation] }); assert.equal(first.status, 'committed', first.errors.join('; ')); const second = await gateway.submit({ ...(await input(root, 'relation-2')), proposals: [industry, relation] }); assert.equal(second.status, 'no_changes', second.errors.join('; '))
    const assets = await readCanonicalV04Assets(root); assert.equal(assets.objects.filter((item) => item.kind === 'relation').length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Changed semantic slot can supersede or persist a durable ReviewCase', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhl-resolution-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-resolution', now: clock() }); const gateway = new KnowledgeProductionGateway(); const temporal = { asOf: '2026-09-08', scope: { type: 'point_in_time', start: '2026-09-08', end: '2026-09-08', label: '2026-09-08' } }; const first = await gateway.submit({ ...(await input(root, 'resolution-1')), proposals: [claim('old', 42, temporal)] }); assert.equal(first.status, 'committed', first.errors.join('; '))
    const superseded = await gateway.submit({ ...(await input(root, 'resolution-2')), proposals: [claim('new', 38, temporal, 'supersede')] }); assert.equal(superseded.status, 'committed', superseded.errors.join('; ')); let assets = await readCanonicalV04Assets(root); assert.equal(assets.objects.filter((item) => item.kind === 'claim').length, 2); assert.ok(assets.objects.some((item) => item.kind === 'claim' && (item.value as { lifecycle: { status: string } }).lifecycle.status === 'superseded'))
    const review = await gateway.submit({ ...(await input(root, 'resolution-3')), proposals: [claim('ambiguous', 37, temporal, 'review')] }); assert.equal(review.status, 'no_changes'); const cases = await listReviewCases(root, { producerRunId: 'resolution-3' }); assert.equal(cases.length, 1); assets = await readCanonicalV04Assets(root); assert.equal(assets.objects.filter((item) => item.kind === 'claim').length, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('producer-neutral Industry Relation mapping resolves Relation-subject Claims without root fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-producer-neutral-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-producer-neutral', now: clock() })
    const gateway = new KnowledgeProductionGateway()
    const evidence = source('INDUSTRY', 'structured-INDUSTRY')
    const result = await gateway.submit({
      handle: await new KnowledgeBaseRegistry().mount(root), producerType: 'company_deep_research', producerRunId: 'producer-neutral-1',
      schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
      entity: { localKey: 'root-industry', entityType: 'industry', name: 'Battery Cells' },
      proposals: [
        { proposalId: 'peer-industry', kind: 'entity', subjectKey: 'peer-industry', entityType: 'industry', entityName: 'Battery Materials' },
        { proposalId: 'chain-link', kind: 'relation', subjectKey: 'root-industry', targetKey: 'peer-industry', relationType: 'upstream_of', sourceCandidateIds: ['structured-INDUSTRY'] },
        { proposalId: 'relation-claim', kind: 'claim', subjectKey: 'chain-link', claimType: 'fact', statement: 'The chain link is structurally material', sourceCandidateIds: ['structured-INDUSTRY'] }
      ],
      evidenceBindings: [{ localSourceId: 'structured-INDUSTRY', source: evidence }], now: clock
    })
    assert.equal(result.status, 'committed', result.errors.join('; '))
    assert.ok(result.relationRefsByProposalId['chain-link'])
    assert.ok(result.claimRefsByProposalId['relation-claim'])
    const assets = await readCanonicalV04Assets(root)
    const claimAsset = assets.objects.find((item) => (item.value as { id: string }).id === result.claimRefsByProposalId['relation-claim'])
    assert.ok(claimAsset, JSON.stringify(result))
    assert.equal((claimAsset.value as { subjectRefs: string[] }).subjectRefs[0], result.relationRefsByProposalId['chain-link'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('non-Company roots are conservative, repeatable, and resolver-bound', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-industry-root-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-industry-root', now: clock() })
    const gateway = new KnowledgeProductionGateway()
    const first = await gateway.submit({ ...(await input(root, 'industry-1')), entity: { localKey: 'industry', entityType: 'industry', name: 'Copper Foil' }, proposals: [], evidenceBindings: [ { localSourceId: 'industry-source', source: source('INDUSTRY', 'industry-source') } ] })
    assert.equal(first.status, 'committed')
    const second = await gateway.submit({ ...(await input(root, 'industry-2')), entity: { localKey: 'industry', entityType: 'industry', name: 'Copper Foil' }, proposals: [], evidenceBindings: [ { localSourceId: 'industry-source', source: source('INDUSTRY', 'industry-source') } ], semanticResolver: () => ({ outcome: 'equivalent', reason: 'same canonical industry' }) })
    assert.equal(second.status, 'no_changes')
    assert.equal(second.entityRefsByLocalKey.industry, first.entityRefsByLocalKey.industry)
    const assets = await readCanonicalV04Assets(root)
    assert.equal(assets.objects.filter((x) => x.kind === 'entity' && (x.value as { type?: string }).type === 'industry').length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Company explicit ref cannot bypass ticker identity and root keys cannot be replaced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-root-guards-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-root-guards', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const first = await gateway.submit(await input(root, 'root-company-1', '600519')); assert.equal(first.status, 'committed')
    const wrong = await gateway.submit({ ...(await input(root, 'root-company-2', '000858')), entity: { localKey: 'company', entityType: 'company', name: '000858', aliases: ['000858'], semanticFields: { ticker: '000858', exchange: 'SZSE' }, existingEntityRef: first.entityRefsByLocalKey.company }, proposals: [] })
    assert.equal(wrong.status, 'blocked'); assert.equal(wrong.entityRefsByLocalKey.company, undefined)
    const conflicting = await gateway.submit({ ...(await input(root, 'root-company-3')), proposals: [{ proposalId: 'company', kind: 'entity', subjectKey: 'company', entityType: 'company', entityName: 'Other Company' }] as never[] })
    assert.equal(conflicting.status, 'blocked'); assert.match(conflicting.errors.join('; '), /overwrite authoritative root/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('distinct evidence keeps Source-to-Raw Claim provenance and replay merges it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-provenance-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-provenance', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const a = source('600519', 'evidence-a', 'bytes-a'); const b = { ...source('600519', 'evidence-b', 'bytes-b'), title: 'Second fixture', candidate: { ...source('600519', 'evidence-b', 'bytes-b').candidate, title: 'Second fixture' } }; const p = (id: string) => ({ proposalId: id, kind: 'claim' as const, subjectKey: 'company', claimType: 'fact' as const, statement: 'Revenue was observed', sourceCandidateIds: ['evidence-a', 'evidence-b'] })
    const result = await gateway.submit({ ...(await input(root, 'prov-1')), proposals: [p('claim-1')], evidenceBindings: [{ localSourceId: 'evidence-a', source: a }, { localSourceId: 'evidence-b', source: b }] })
    assert.equal(result.status, 'committed'); const assets = await readCanonicalV04Assets(root); const c = assets.objects.find((x) => x.kind === 'claim')!.value as { provenance: Array<{ sourceRef: string; rawRef: string; locator: string | null }>; sourceRefs: string[] }
    assert.equal(c.provenance.length, 2); assert.equal(new Set(c.provenance.map((x) => x.rawRef)).size, 2); assert.deepEqual(new Set(c.provenance.map((x) => x.sourceRef)), new Set(c.sourceRefs)); assert.ok(c.provenance.every((item) => item.locator === null))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('semantic equivalent changed slot keeps the existing canonical Claim ID and update invariant', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-equivalent-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-equivalent', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const first = await gateway.submit({ ...(await input(root, 'equivalent-1')), proposals: [claim('old', 42)] }); assert.equal(first.status, 'committed')
    const second = await gateway.submit({ ...(await input(root, 'equivalent-2')), proposals: [{ ...claim('changed', 43), statement: 'EPS is revised', resolution: undefined }], semanticResolver: () => ({ outcome: 'equivalent', reason: 'same canonical semantic slot' }) })
    assert.equal(second.status, 'no_changes'); assert.equal(second.claimRefsByProposalId.changed, first.claimRefsByProposalId.old)
    const assets = await readCanonicalV04Assets(root); const claims = assets.objects.filter((item) => item.kind === 'claim'); assert.equal(claims.length, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Claim proposal links materialize to canonical Claim references and frozen update fields fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-claim-links-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-claim-links', now: clock() }); const gateway = new KnowledgeProductionGateway(); const a = claim('a', 1); const b = { ...claim('b', 2), supportsProposalIds: ['a'], dependsOnProposalIds: ['a'], contradictsProposalIds: ['a'] }; const first = await gateway.submit({ ...(await input(root, 'claim-links-1')), proposals: [a, b] }); assert.equal(first.status, 'committed')
    const assets = await readCanonicalV04Assets(root); const bAsset = assets.objects.find((item) => (item.value as { id: string }).id === first.claimRefsByProposalId.b)!.value as { supportsClaimRefs?: string[]; dependsOnClaimRefs?: string[]; contradictsClaimRefs?: string[] }; assert.deepEqual(bAsset.supportsClaimRefs, [first.claimRefsByProposalId.a]); assert.deepEqual(bAsset.dependsOnClaimRefs, [first.claimRefsByProposalId.a]); assert.deepEqual(bAsset.contradictsClaimRefs, [first.claimRefsByProposalId.a])
    const rejected = await gateway.submit({ ...(await input(root, 'claim-links-2')), proposals: [{ ...claim('bad-update', 3), statement: 'Different statement', existingKnowledgeRefs: [first.claimRefsByProposalId.a], resolution: 'update' }] }); assert.equal(rejected.status, 'no_changes'); assert.equal(rejected.claimRefsByProposalId['bad-update'], undefined); assert.ok(rejected.resolutionIntents.some((item) => item.disposition === 'review_required'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('all terminal Gateway outcomes expose a Relation mapping object', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-outcome-shape-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-outcome-shape', now: clock() }); const gateway = new KnowledgeProductionGateway(); const committed = await gateway.submit(await input(root, 'shape-1')); const replay = await gateway.submit(await input(root, 'shape-2')); const blocked = await gateway.submit({ ...(await input(root, 'shape-3')), proposals: [{ proposalId: 'bad id', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'bad' }] as never[] });
    await gateway.submit({ ...(await input(root, 'shape-seed')), entity: { localKey: 'industry', entityType: 'industry', name: 'Failing Industry' }, proposals: [], evidenceBindings: [] })
    const failed = await gateway.submit({ ...(await input(root, 'shape-4')), entity: { localKey: 'industry', entityType: 'industry', name: 'Failing Industry' }, proposals: [], evidenceBindings: [], semanticResolver: () => { throw new Error('injected semantic resolver failure') } })
    for (const result of [committed, replay, blocked, failed]) assert.equal(typeof result.relationRefsByProposalId, 'object')
    assert.equal(failed.status, 'failed')
  } finally { await rm(root, { recursive: true, force: true }) }
})

// Compile-time contract fixture: omitting relationRefsByProposalId must remain a type error.
const requireOutcomeContract = (value: KnowledgeProductionOutcome) => value
// @ts-expect-error Required producer-neutral Relation mapping must not be omitted.
requireOutcomeContract({ status: 'no_changes', knowledgeBaseId: 'kb', knowledgeBaseRevision: 0, baseRevision: 0, createdIds: [], updatedIds: [], sourceRefsByLocalId: {}, claimRefsByProposalId: {}, entityRefsByLocalKey: {}, resolutionIntents: [], errors: [] })

test('Product and Technology roots fail closed without proof, then replay exactly one resolver-approved canonical root', async () => {
  for (const entityType of ['product', 'technology'] as const) {
    const root = await mkdtemp(join(tmpdir(), `rhl-${entityType}-root-`))
    try {
      await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-${entityType}-root`, now: clock() }); const gateway = new KnowledgeProductionGateway()
      const base = await input(root, `${entityType}-1`)
      const first = await gateway.submit({ ...base, entity: { localKey: entityType, entityType, name: entityType === 'product' ? 'Atlas Engine' : 'Atlas Runtime' }, proposals: [], evidenceBindings: [] })
      assert.equal(first.status, 'committed')
      const replay = await gateway.submit({ ...base, producerRunId: `${entityType}-2`, entity: { localKey: entityType, entityType, name: entityType === 'product' ? 'Atlas Engine' : 'Atlas Runtime' }, proposals: [], evidenceBindings: [], semanticResolver: () => ({ outcome: 'equivalent', reason: 'exact deterministic root equivalence' }) })
      assert.equal(replay.status, 'no_changes'); assert.equal(replay.entityRefsByLocalKey[entityType], first.entityRefsByLocalKey[entityType])
      const assets = await readCanonicalV04Assets(root); assert.equal(assets.objects.filter((x) => x.kind === 'entity' && (x.value as { type?: string }).type === entityType).length, 1)
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('explicit non-Company root refs and mismatched Entity types fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-explicit-root-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-explicit-root', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const industry = await gateway.submit({ ...(await input(root, 'explicit-industry-1')), entity: { localKey: 'industry', entityType: 'industry', name: 'Battery Industry' }, proposals: [], evidenceBindings: [] }); assert.equal(industry.status, 'committed')
    const invalid = await gateway.submit({ ...(await input(root, 'explicit-industry-2')), entity: { localKey: 'industry', entityType: 'industry', name: 'Different Name', existingEntityRef: 'entity:does-not-exist' }, proposals: [], evidenceBindings: [] }); assert.equal(invalid.status, 'blocked'); assert.equal(invalid.entityRefsByLocalKey.industry, undefined)
    const mismatch = await gateway.submit({ ...(await input(root, 'explicit-industry-3')), entity: { localKey: 'industry', entityType: 'product', name: 'Battery Industry', existingEntityRef: industry.entityRefsByLocalKey.industry }, proposals: [], evidenceBindings: [] }); assert.equal(mismatch.status, 'blocked'); assert.equal(mismatch.entityRefsByLocalKey.industry, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('multiple plausible non-Company candidates do not first-match merge', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-multiple-plausible-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-multiple-plausible', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const seeded = await gateway.submit({ ...(await input(root, 'plausible-seed')), entity: { localKey: 'product', entityType: 'product', name: 'Alpha Product' }, proposals: [{ proposalId: 'beta', kind: 'entity', subjectKey: 'beta', entityType: 'product', entityName: 'Beta Product' }], evidenceBindings: [] }); assert.equal(seeded.status, 'committed')
    const ambiguous = await gateway.submit({ ...(await input(root, 'plausible-ambiguous')), entity: { localKey: 'product', entityType: 'product', name: 'Unresolved Product', aliases: ['Alpha Product', 'Beta Product'] }, proposals: [], evidenceBindings: [] }); assert.equal(ambiguous.status, 'blocked'); assert.equal(ambiguous.entityRefsByLocalKey.product, undefined); assert.ok(ambiguous.resolutionIntents.some((x) => x.reason.includes('Multiple plausible')))
    const assets = await readCanonicalV04Assets(root); assert.equal(assets.objects.filter((x) => x.kind === 'entity' && (x.value as { type?: string }).type === 'product').length, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('exact Relation replay preserves the canonical ref and unions prior evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-relation-replay-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-relation-replay', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const firstSource = source('INDUSTRY', 'relation-a', 'relation-bytes-a'); const secondSource = { ...source('INDUSTRY', 'relation-b', 'relation-bytes-b'), title: 'Relation second fixture', candidate: { ...source('INDUSTRY', 'relation-b', 'relation-bytes-b').candidate, title: 'Relation second fixture' } }
    const proposal = { proposalId: 'belongs', kind: 'relation' as const, subjectKey: 'company', targetKey: 'industry', relationType: 'belongs_to_industry', sourceCandidateIds: ['relation-a'] }
    const industry = { proposalId: 'industry', kind: 'entity' as const, subjectKey: 'industry', entityType: 'industry' as const, entityName: 'Beverage Industry' }
    const first = await gateway.submit({ ...(await input(root, 'relation-replay-1')), proposals: [industry, proposal], evidenceBindings: [{ localSourceId: 'relation-a', source: firstSource }] }); assert.equal(first.status, 'committed')
    const second = await gateway.submit({ ...(await input(root, 'relation-replay-2')), proposals: [{ ...industry }, { ...proposal, sourceCandidateIds: ['relation-b'] }], evidenceBindings: [{ localSourceId: 'relation-b', source: secondSource }], semanticResolver: () => ({ outcome: 'equivalent', reason: 'same canonical industry' }) }); assert.equal(second.status, 'committed'); assert.equal(second.relationRefsByProposalId.belongs, first.relationRefsByProposalId.belongs)
    const relation = (await readCanonicalV04Assets(root)).objects.find((x) => (x.value as { id: string }).id === first.relationRefsByProposalId.belongs)!.value as { sourceRefs: string[] }; assert.equal(relation.sourceRefs.length, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('existing Source replay persists both Raw refs and Claim replay merges prior provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhl-source-claim-replay-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-source-claim-replay', now: clock() }); const gateway = new KnowledgeProductionGateway(); const a = source('600519', 'replay-a', 'raw-a'); const b = { ...source('600519', 'replay-a', 'raw-b'), contentHash: 'b'.repeat(64) }; const p = (id: string, evidence: string) => ({ proposalId: id, kind: 'claim' as const, subjectKey: 'company', claimType: 'fact' as const, statement: 'Revenue replay fact', sourceCandidateIds: [evidence] })
    const first = await gateway.submit({ ...(await input(root, 'source-claim-1')), proposals: [p('claim-a', 'replay-a')], evidenceBindings: [{ localSourceId: 'replay-a', source: a }] }); assert.equal(first.status, 'committed')
    const second = await gateway.submit({ ...(await input(root, 'source-claim-2')), proposals: [p('claim-b', 'replay-a')], evidenceBindings: [{ localSourceId: 'replay-a', source: b }] }); assert.equal(second.status, 'committed'); assert.equal(second.claimRefsByProposalId['claim-b'], first.claimRefsByProposalId['claim-a'])
    const assets = await readCanonicalV04Assets(root); const sourceAsset = assets.objects.find((x) => x.kind === 'source')!.value as { rawRefs: string[] }; const claimAsset = assets.objects.find((x) => (x.value as { id: string }).id === first.claimRefsByProposalId['claim-a'])!.value as { provenance: Array<{ rawRef: string }> }; assert.equal(sourceAsset.rawRefs.length, 2); assert.equal(new Set(claimAsset.provenance.map((x) => x.rawRef)).size, 2)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('runtime-invalid proposals fail closed before canonical mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-invalid-runtime-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-invalid-runtime', now: clock() }); const gateway = new KnowledgeProductionGateway(); const before = await readCanonicalV04Assets(root)
    for (const bad of [{ proposalId: 'bad id', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'bad' }, { proposalId: 'unsafe-subject', kind: 'claim', subjectKey: 'bad/key', claimType: 'fact', statement: 'bad' }, { proposalId: 'unsupported', kind: 'unknown', subjectKey: 'company' }] as unknown[]) { const result = await gateway.submit({ ...(await input(root, `invalid-${String((bad as { proposalId?: unknown }).proposalId)}`)), proposals: [bad] as never[] }); assert.equal(result.status, 'blocked'); assert.equal((await readCanonicalV04Assets(root)).objects.length, before.objects.length) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ReviewCase is never fabricated without usable archived Raw evidence, and forecast defaults to 0.5', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-review-forecast-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-review-forecast', now: clock() }); const gateway = new KnowledgeProductionGateway(); const empty = { ...source('600519', 'empty-review', ''), content: '' }
    const review = await gateway.submit({ ...(await input(root, 'review-empty')), proposals: [claim('review-empty', 42, undefined, 'review')], evidenceBindings: [{ localSourceId: 'empty-review', source: empty }] }); assert.equal(review.status, 'committed'); assert.equal((await listReviewCases(root, { producerRunId: 'review-empty' })).length, 0)
    const forecast = await gateway.submit({ ...(await input(root, 'forecast-default')), proposals: [{ ...claim('forecast-default', 42), probability: undefined }] }); assert.equal(forecast.status, 'committed'); const c = (await readCanonicalV04Assets(root)).objects.find((x) => (x.value as { id: string }).id === forecast.claimRefsByProposalId['forecast-default'])!.value as { probability: number }; assert.equal(c.probability, 0.5)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('producer-declared contradiction creates a distinct Claim with a link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-resolution-links-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-resolution-links', now: clock() }); const gateway = new KnowledgeProductionGateway(); const first = await gateway.submit({ ...(await input(root, 'contradict-1')), proposals: [claim('base', 42)] }); assert.equal(first.status, 'committed')
    const producer = await gateway.submit({ ...(await input(root, 'contradict-2')), proposals: [claim('producer-contradiction', 41, undefined, 'contradict')] }); assert.equal(producer.status, 'committed'); const producerClaim = (await readCanonicalV04Assets(root)).objects.find((x) => (x.value as { id: string }).id === producer.claimRefsByProposalId['producer-contradiction'])!.value as { contradictsClaimRefs: string[] }; assert.deepEqual(producerClaim.contradictsClaimRefs, [first.claimRefsByProposalId.base])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('resolver-returned contradiction creates a distinct linked Claim, preserves the prior Claim, and replays idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-resolver-contradiction-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-resolver-contradiction', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const base = await gateway.submit({ ...(await input(root, 'resolver-contradiction-base')), proposals: [claim('base', 42)] }); assert.equal(base.status, 'committed', base.errors.join('; '))
    const baseId = base.claimRefsByProposalId.base
    const before = (await readCanonicalV04Assets(root)).objects.find((x) => (x.value as { id: string }).id === baseId)!.value
    const decisions: Array<{ outcome: string; reason: string }> = []
    const resolver = () => { if (decisions.length > 0) throw new Error('exact Claim replay must bypass SemanticResolver'); const decision = { outcome: 'contradicts' as const, reason: 'deterministic semantic contradiction' }; decisions.push(decision); return decision }
    const incoming = { ...claim('resolver-contradiction', 41), statement: 'EPS is revised by resolver evidence' }
    const first = await gateway.submit({ ...(await input(root, 'resolver-contradiction-1')), proposals: [incoming], semanticResolver: resolver }); assert.equal(first.status, 'committed', first.errors.join('; ')); assert.deepEqual(decisions, [{ outcome: 'contradicts', reason: 'deterministic semantic contradiction' }])
    const firstAssets = await readCanonicalV04Assets(root); const firstId = first.claimRefsByProposalId['resolver-contradiction']; assert.notEqual(firstId, baseId); assert.deepEqual(first.createdIds, [firstId]); assert.equal(first.createdIds.includes(baseId), false)
    const firstClaim = firstAssets.objects.find((x) => (x.value as { id: string }).id === firstId)!.value as { id: string; contradictsClaimRefs: string[] }; assert.deepEqual(firstClaim.contradictsClaimRefs, [baseId])
    const afterFirst = firstAssets.objects.find((x) => (x.value as { id: string }).id === baseId)!.value; assert.deepEqual(afterFirst, before)
    assert.equal(firstAssets.objects.filter((x) => x.kind === 'claim').length, 2)
    const replay = await gateway.submit({ ...(await input(root, 'resolver-contradiction-2')), proposals: [incoming], semanticResolver: resolver }); assert.equal(replay.status, 'no_changes', replay.errors.join('; ')); assert.equal(replay.knowledgeBaseRevision, first.knowledgeBaseRevision); assert.equal(replay.claimRefsByProposalId['resolver-contradiction'], firstId); assert.deepEqual(decisions, [{ outcome: 'contradicts', reason: 'deterministic semantic contradiction' }])
    const replayAssets = await readCanonicalV04Assets(root); assert.equal(replayAssets.objects.filter((x) => x.kind === 'claim').length, 2); assert.deepEqual(replayAssets.objects.find((x) => (x.value as { id: string }).id === baseId)!.value, before); assert.deepEqual(replayAssets.objects.find((x) => (x.value as { id: string }).id === firstId)!.value, firstClaim)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('exact non-contradiction Claim replay bypasses SemanticResolver', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-exact-claim-replay-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-exact-claim-replay', now: clock() }); const gateway = new KnowledgeProductionGateway()
    const proposal = { ...claim('exact-first', 42), claimType: 'fact' as const, statement: 'Revenue is observed', probability: undefined }
    const first = await gateway.submit({ ...(await input(root, 'exact-claim-1')), proposals: [proposal] }); assert.equal(first.status, 'committed', first.errors.join('; '))
    const replay = await gateway.submit({ ...(await input(root, 'exact-claim-2')), proposals: [{ ...proposal, proposalId: 'exact-replay' }], semanticResolver: () => { throw new Error('exact Claim replay must bypass SemanticResolver') } }); assert.equal(replay.status, 'no_changes', replay.errors.join('; ')); assert.equal(replay.claimRefsByProposalId['exact-replay'], first.claimRefsByProposalId['exact-first']); assert.equal(replay.knowledgeBaseRevision, first.knowledgeBaseRevision)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('resolver-approved supersession preserves linkage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-resolver-supersede-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-resolver-supersede', now: clock() }); const gateway = new KnowledgeProductionGateway(); const supersedeBase = await gateway.submit({ ...(await input(root, 'resolver-base')), proposals: [claim('base', 42)] }); assert.equal(supersedeBase.status, 'committed')
    const resolver = await gateway.submit({ ...(await input(root, 'resolver-1')), proposals: [{ ...claim('resolver-supersession', 40), statement: 'EPS is resolver revision', resolution: 'supersede' }], semanticResolver: () => ({ outcome: 'supersedes', reason: 'deterministic supersession' }) }); assert.equal(resolver.status, 'committed', resolver.errors.join('; ')); const assets = await readCanonicalV04Assets(root); const incoming = assets.objects.find((x) => (x.value as { id: string }).id === resolver.claimRefsByProposalId['resolver-supersession'])!.value as { supersedes: string[] }; const prior = assets.objects.find((x) => (x.value as { id: string }).id === supersedeBase.claimRefsByProposalId.base)!.value as { supersedes?: string[], lifecycle: { status: string }, supersededBy: string[] }; assert.equal(incoming.supersedes.includes(supersedeBase.claimRefsByProposalId.base), true); assert.equal(prior.lifecycle.status, 'superseded'); assert.equal(prior.supersededBy.includes(resolver.claimRefsByProposalId['resolver-supersession']), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('frozen explicit Claim fields reject updates while mutable structured values and links remain deterministic', async () => {
  const fields = ['subject', 'claimType', 'statement', 'temporal', 'metric', 'unit', 'comparator', 'period', 'fiscalPeriod'] as const
  const root = await mkdtemp(join(tmpdir(), 'rhl-frozen-fields-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-frozen-fields', now: clock() }); const gateway = new KnowledgeProductionGateway(); const first = await gateway.submit({ ...(await input(root, 'frozen-base')), proposals: [claim('base', 1)] }); assert.equal(first.status, 'committed')
    for (const field of fields) { const p: Record<string, unknown> = { ...claim(`bad-${field}`, 2), existingKnowledgeRefs: [first.claimRefsByProposalId.base], resolution: 'update' }; if (field === 'subject') p.subjectKey = 'other'; if (field === 'claimType') p.claimType = 'fact'; if (field === 'statement') p.statement = 'different'; if (field === 'temporal') p.temporal = { asOf: '2026-09-09' }; if (field === 'metric') p.structuredValue = { ...(p.structuredValue as Record<string, unknown>), metric: 'other' }; if (field === 'unit') p.structuredValue = { ...(p.structuredValue as Record<string, unknown>), unit: 'USD' }; if (field === 'comparator') p.structuredValue = { ...(p.structuredValue as Record<string, unknown>), comparator: '>' }; if (field === 'period') p.structuredValue = { ...(p.structuredValue as Record<string, unknown>), period: 'FY2028' }; if (field === 'fiscalPeriod') p.structuredValue = { ...(p.structuredValue as Record<string, unknown>), fiscalPeriod: 'Q1' }; const result = await gateway.submit({ ...(await input(root, `frozen-${field}`)), proposals: [p] as never[] }); assert.equal(result.status, 'no_changes'); assert.equal(result.claimRefsByProposalId[`bad-${field}`], undefined); assert.ok(result.resolutionIntents.some((x) => x.disposition === 'review_required')) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('one submit commits at most one ChangeSet and replay does not advance revision', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-one-commit-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-one-commit', now: clock() }); const gateway = new KnowledgeProductionGateway(); const first = await gateway.submit({ ...(await input(root, 'one-commit-1')), proposals: [claim('one', 1)] }); assert.equal(first.status, 'committed'); assert.equal(first.knowledgeBaseRevision, first.baseRevision + 1); assert.equal(first.changeSetId !== undefined, true)
    const replay = await gateway.submit({ ...(await input(root, 'one-commit-2')), proposals: [claim('one-replay', 1)] }); assert.equal(replay.status, 'no_changes'); assert.equal(replay.knowledgeBaseRevision, first.knowledgeBaseRevision); assert.equal(replay.changeSetId, undefined)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('confirmed Thesis criteria append immutable revisions and ordinary updates preserve them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-thesis-criterion-gateway-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-thesis-criterion-gateway', now: clock() })
    const gateway = new KnowledgeProductionGateway()
    const publishedAt = '2026-09-01T00:00:00.000Z'
    const admitted = { ...source('600519', 'criterion-source', 'Threshold source bytes'), candidate: { ...source('600519', 'criterion-source', 'Threshold source bytes').candidate, publishedAt } }
    const seed = await gateway.submit({ ...(await input(root, 'criterion-seed', '600519', [], [admitted])), evidenceBindings: [{ localSourceId: 'criterion-source', source: admitted, locator: 'table:FY2027/revenue_growth' }], proposals: [
      { proposalId: 'criterion-thesis', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Durable growth', thesisStatus: 'active', statement: 'Revenue growth remains durable.' },
      { proposalId: 'criterion-target', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'FY2027 revenue growth was reported.', sourceCandidateIds: ['criterion-source'], existingEvidenceBindings: [] }
    ] })
    assert.equal(seed.status, 'committed', seed.errors.join('; '))
    const thesisRef = seed.thesisRefsByProposalId?.['criterion-thesis']
    const claimRef = seed.claimRefsByProposalId['criterion-target']
    assert.ok(thesisRef && claimRef)
    let assets = await readCanonicalV04Assets(root)
    const sourceAsset = assets.objects.find((asset) => asset.kind === 'source')!.value as { id: `source:${string}`; rawRefs: `raw-sha256-${string}`[] }
    const membership = await gateway.submit({ ...(await input(root, 'criterion-membership')), proposals: [{ proposalId: 'criterion-qualifies', kind: 'reasoning_edge', edgeType: 'qualifies', existingSourceRef: claimRef as `claim:${string}`, existingTargetRef: thesisRef as `thesis:${string}` }] as never[] })
    assert.equal(membership.status, 'committed', membership.errors.join('; '))
    assets = await readCanonicalV04Assets(root)
    const claimAsset = assets.objects.find((asset) => asset.value.id === claimRef)!.value as { provenance?: Array<{ locator: string | null }> }
    assert.equal(claimAsset.provenance?.[0]?.locator, 'table:FY2027/revenue_growth')

    const makeRevision = (revision: number, threshold: number) => {
      const origin = { kind: 'source_derived' as const, sourceRef: sourceAsset.id, rawRef: sourceAsset.rawRefs[0]!, locator: 'table:FY2027/revenue_growth', publishedAt }
      const definition = { metricRef: 'revenue_growth', operator: 'lt' as const, threshold, unit: 'percent', period: 'FY2027' }
      return { conditionId: 'growth-floor', revision, state: 'active' as const, type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs: [claimRef as `claim:${string}`], effectiveAt: '2026-09-08T00:00:00.000Z', definitionHash: hashKillCriterionDefinitionV04({ type: 'numeric_threshold', definitionVersion: 1, definition, targetClaimRefs: [claimRef], origin }), authority: { workflowRunId: `criterion-confirm-${revision}`, confirmedAt: '2026-09-08T00:00:00.000Z', origin } }
    }
    const beforeConfirmation = await new KnowledgeBaseRegistry().mount(root)
    const binding = { sourceRef: sourceAsset.id, rawRef: sourceAsset.rawRefs[0]!, locator: 'table:FY2027/revenue_growth' }
    const withBinding = async (run: string, criterionRevision: unknown, handle?: KnowledgeProductionInput['handle']) => gateway.submit({ ...(await input(root, run)), ...(handle ? { handle } : {}), producerType: 'thesis_criterion_confirmed', proposals: [{ proposalId: `confirm-${run}`, kind: 'thesis', subjectKey: 'company', thesisTitle: 'Durable growth', thesisStatus: 'active', statement: 'Revenue growth remains durable.', criterionRevision, existingEvidenceBindings: [binding] } as never], evidenceBindings: [] })
    const revisionOne = makeRevision(1, 0.1)
    const first = await withBinding('criterion-confirm-1', revisionOne, beforeConfirmation)
    assert.equal(first.status, 'committed', first.errors.join('; '))
    const duplicate = await withBinding('criterion-duplicate', revisionOne)
    assert.equal(duplicate.status, 'blocked')
    const badProducer = await gateway.submit({ ...(await input(root, 'criterion-unauthorized')), proposals: [{ proposalId: 'unauthorized-criterion', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Durable growth', thesisStatus: 'active', statement: 'Revenue growth remains durable.', criterionRevision: makeRevision(2, 0.1) } as never] })
    assert.equal(badProducer.status, 'blocked')
    const malformed = await withBinding('criterion-malformed', { ...makeRevision(2, 0.1), definitionHash: 'sha256:bad' })
    assert.equal(malformed.status, 'blocked')
    const unknown = await withBinding('criterion-unknown', { ...makeRevision(2, 0.1), type: 'future_condition' })
    assert.equal(unknown.status, 'blocked')
    const nextHandle = await new KnowledgeBaseRegistry().mount(root)
    const revisionTwo = makeRevision(2, 0.15)
    const second = await withBinding('criterion-confirm-2', revisionTwo, nextHandle)
    assert.equal(second.status, 'committed', second.errors.join('; '))
    assets = await readCanonicalV04Assets(root)
    const thesis = assets.objects.find((asset) => asset.value.id === thesisRef)!.value as { killCriteria?: Array<{ revision: number; state: string; definitionHash: string }> }
    assert.deepEqual(thesis.killCriteria?.map((item) => [item.revision, item.state]), [[1, 'superseded'], [2, 'active']])
    assert.notEqual(thesis.killCriteria?.[0]?.definitionHash, thesis.killCriteria?.[1]?.definitionHash)
    const staleHandle = await withBinding('criterion-confirm-3', makeRevision(3, 0.2), nextHandle)
    assert.notEqual(staleHandle.status, 'committed')
    const third = await withBinding('criterion-confirm-3', makeRevision(3, 0.2))
    assert.equal(third.status, 'committed', third.errors.join('; '))
    const changedReplayValue = makeRevision(4, 0.25)
    const changedReplay = await withBinding('criterion-confirm-3', { ...changedReplayValue, authority: { ...changedReplayValue.authority, workflowRunId: 'criterion-confirm-3' } })
    assert.notEqual(changedReplay.status, 'committed')
    assets = await readCanonicalV04Assets(root)
    const beforeOrdinaryUpdate = assets.objects.find((asset) => asset.value.id === thesisRef)!.value as { killCriteria?: unknown[] }
    const ordinary = await gateway.submit({ ...(await input(root, 'criterion-ordinary-update')), proposals: [{ proposalId: 'ordinary-thesis-update', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Durable growth', thesisStatus: 'weakening', statement: 'Revenue growth remains durable.' }] })
    assert.equal(ordinary.status, 'committed', ordinary.errors.join('; '))
    assets = await readCanonicalV04Assets(root)
    const preserved = assets.objects.find((asset) => asset.value.id === thesisRef)!.value as { status: string; killCriteria?: unknown[] }
    assert.equal(preserved.status, 'weakening')
    assert.deepEqual(preserved.killCriteria, beforeOrdinaryUpdate.killCriteria)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ReasoningEdges bind existing canonical Observation, Claim, and Thesis endpoints', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-existing-reasoning-endpoints-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-existing-reasoning-endpoints', now: clock() })
    const gateway = new KnowledgeProductionGateway()
    const seeded = await gateway.submit({ ...(await input(root, 'reasoning-endpoint-seed')), proposals: [
      { proposalId: 'revenue-observation', kind: 'observation', subjectKey: 'company', observationType: 'metric', metricRef: 'metric:revenue', value: 100, sourceCandidateIds: ['structured-600519'] },
      { proposalId: 'revenue-claim', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'Revenue reached 100 CNY', sourceCandidateIds: ['structured-600519'] },
      { proposalId: 'revenue-thesis', kind: 'thesis', subjectKey: 'company', thesisTitle: 'Revenue growth thesis', statement: 'Revenue growth is durable', thesisStatus: 'active' }
    ] })
    assert.equal(seeded.status, 'committed', seeded.errors.join('; '))
    const result = await gateway.submit({ ...(await input(root, 'reasoning-endpoint-bind')), proposals: [
      { proposalId: 'observation-challenges-claim', kind: 'reasoning_edge', existingSourceRef: seeded.observationRefsByProposalId?.['revenue-observation'] as `observation:${string}`, existingTargetRef: seeded.claimRefsByProposalId['revenue-claim'] as `claim:${string}`, edgeType: 'challenges' },
      { proposalId: 'claim-qualifies-thesis', kind: 'reasoning_edge', existingSourceRef: seeded.claimRefsByProposalId['revenue-claim'] as `claim:${string}`, existingTargetRef: seeded.thesisRefsByProposalId?.['revenue-thesis'] as `thesis:${string}`, edgeType: 'qualifies' }
    ] })
    assert.equal(result.status, 'committed', result.errors.join('; '))
    const edges = (await readCanonicalV04Assets(root)).objects.filter((item) => item.kind === 'reasoning_edge').map((item) => item.value as { type: string; sourceRef: string; targetRef: string })
    assert.deepEqual(edges.map((edge) => [edge.sourceRef, edge.type, edge.targetRef]).sort(), [
      [seeded.observationRefsByProposalId?.['revenue-observation'], 'challenges', seeded.claimRefsByProposalId['revenue-claim']],
      [seeded.claimRefsByProposalId['revenue-claim'], 'qualifies', seeded.thesisRefsByProposalId?.['revenue-thesis']]
    ].sort())
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ReasoningEdge selectors and invalid canonical endpoints fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-invalid-reasoning-endpoints-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-invalid-reasoning-endpoints', now: clock() })
    const gateway = new KnowledgeProductionGateway()
    const seeded = await gateway.submit({ ...(await input(root, 'invalid-reasoning-seed')), proposals: [
      { proposalId: 'valid-claim', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'A canonical fact', sourceCandidateIds: ['structured-600519'] },
      { proposalId: 'valid-thesis', kind: 'thesis', subjectKey: 'company', thesisTitle: 'An archived thesis', statement: 'Old thesis', thesisStatus: 'archived' },
      { proposalId: 'valid-observation', kind: 'observation', subjectKey: 'company', observationType: 'metric', metricRef: 'metric:revenue', value: 100, sourceCandidateIds: ['structured-600519'] }
    ] })
    assert.equal(seeded.status, 'committed', seeded.errors.join('; '))
    const observationRef = seeded.observationRefsByProposalId?.['valid-observation'] as `observation:${string}`
    const claimRef = seeded.claimRefsByProposalId['valid-claim']
    const priorClaim = await gateway.submit({ ...(await input(root, 'invalid-reasoning-prior-claim')), proposals: [claim('prior-eps', 42)] })
    assert.equal(priorClaim.status, 'committed', priorClaim.errors.join('; '))
    const supersededClaim = await gateway.submit({ ...(await input(root, 'invalid-reasoning-superseding-claim')), proposals: [claim('new-eps', 41, undefined, 'supersede')] })
    assert.equal(supersededClaim.status, 'committed', supersededClaim.errors.join('; '))
    const priorClaimRef = priorClaim.claimRefsByProposalId['prior-eps'] as `claim:${string}`
    const invalids = [
      { proposalId: 'missing-source-selector', kind: 'reasoning_edge' as const, existingTargetRef: claimRef, edgeType: 'challenges' as const },
      { proposalId: 'missing-target-selector', kind: 'reasoning_edge' as const, existingSourceRef: observationRef, edgeType: 'challenges' as const },
      { proposalId: 'missing-source', kind: 'reasoning_edge' as const, existingSourceRef: 'observation:missing' as `observation:${string}`, existingTargetRef: claimRef, edgeType: 'challenges' as const },
      { proposalId: 'missing-target', kind: 'reasoning_edge' as const, existingSourceRef: observationRef, existingTargetRef: 'claim:missing' as `claim:${string}`, edgeType: 'challenges' as const },
      { proposalId: 'wrong-source-kind', kind: 'reasoning_edge' as const, existingSourceRef: seeded.thesisRefsByProposalId?.['valid-thesis'] as `thesis:${string}`, existingTargetRef: claimRef, edgeType: 'qualifies' as const },
      { proposalId: 'inactive-thesis', kind: 'reasoning_edge' as const, existingSourceRef: claimRef, existingTargetRef: seeded.thesisRefsByProposalId?.['valid-thesis'] as `thesis:${string}`, edgeType: 'qualifies' as const },
      { proposalId: 'superseded-claim', kind: 'reasoning_edge' as const, existingSourceRef: observationRef, existingTargetRef: priorClaimRef, edgeType: 'challenges' as const },
      { proposalId: 'both-source-modes', kind: 'reasoning_edge' as const, subjectKey: 'valid-claim', existingSourceRef: claimRef, existingTargetRef: seeded.thesisRefsByProposalId?.['valid-thesis'] as `thesis:${string}`, edgeType: 'qualifies' as const },
      { proposalId: 'conflicting-local-source-aliases', kind: 'reasoning_edge' as const, sourceProposalId: 'valid-claim', subjectKey: 'different-local-source', existingTargetRef: seeded.thesisRefsByProposalId?.['valid-thesis'] as `thesis:${string}`, edgeType: 'qualifies' as const },
      { proposalId: 'both-target-modes', kind: 'reasoning_edge' as const, existingSourceRef: claimRef, targetKey: 'valid-claim', existingTargetRef: claimRef, edgeType: 'qualifies' as const },
      { proposalId: 'invalid-edge-type', kind: 'reasoning_edge' as const, existingSourceRef: claimRef, existingTargetRef: claimRef, edgeType: 'made_up' }
    ]
    const before = (await readCanonicalV04Assets(root)).objects.filter((item) => item.kind === 'reasoning_edge').length
    for (const proposal of invalids) {
      const result = await gateway.submit({ ...(await input(root, `invalid-${proposal.proposalId}`)), proposals: [proposal] as never[] })
      assert.ok(result.status === 'blocked' || result.status === 'no_changes', `${proposal.proposalId}: ${result.status}`)
      assert.equal(result.reasoningEdgeRefsByProposalId?.[proposal.proposalId], undefined)
    }
    const after = (await readCanonicalV04Assets(root)).objects.filter((item) => item.kind === 'reasoning_edge').length
    assert.equal(after, before)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('existing canonical Source/Raw bindings merge into Claim provenance and ReasoningEdge source refs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-existing-evidence-reuse-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-existing-evidence-reuse', now: clock() })
    const gateway = new KnowledgeProductionGateway()
    const original = { ...source('600519', 'evidence-original', 'original archived bytes'), rights: { ...source('600519', 'evidence-original', 'original archived bytes').rights, policyBasis: 'personal_noncommercial_research' as const } }
    const current = { ...source('600519', 'evidence-current', 'current archived bytes'), title: 'Secondary financial fixture', candidate: { ...source('600519', 'evidence-current', 'current archived bytes').candidate, title: 'Secondary financial fixture' } }
    const seeded = await gateway.submit({ ...(await input(root, 'existing-evidence-seed', '600519', [], [original, current])) })
    assert.equal(seeded.status, 'committed', seeded.errors.join('; '))
    const sourceAssets = (await readCanonicalV04Assets(root)).objects.filter((item) => item.kind === 'source').map((item) => item.value as unknown as { id: string; rawRefs: string[]; rights: Record<string, unknown>; usagePolicy: Record<string, unknown> })
    const originalAsset = sourceAssets.find((item) => item.id === seeded.sourceRefsByLocalId['evidence-original'])!
    const currentAsset = sourceAssets.find((item) => item.id === seeded.sourceRefsByLocalId['evidence-current'])!
    assert.equal(originalAsset.rights.retentionAllowed, true)
    assert.equal(originalAsset.rights.aiProcessingAllowed, true)
    assert.equal(originalAsset.rights.derivativeKnowledgeAllowed, true)
    assert.equal(originalAsset.rights.policyBasis, 'personal_noncommercial_research')
    assert.equal(originalAsset.usagePolicy.retainRaw, true)
    assert.equal(originalAsset.usagePolicy.allowAiProcessing, true)
    assert.equal(originalAsset.usagePolicy.allowDerivedKnowledge, true)
    const claimResult = await gateway.submit({ ...(await input(root, 'existing-evidence-claim', '600519', [
      { proposalId: 'combined-provenance', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'Claim with reused and current evidence', sourceCandidateIds: ['evidence-current'], existingEvidenceBindings: [{ sourceRef: originalAsset.id as `source:${string}`, rawRef: originalAsset.rawRefs[0] as `raw-sha256-${string}` }] }
    ], [current])) })
    assert.equal(claimResult.status, 'committed', claimResult.errors.join('; '))
    const claimRef = claimResult.claimRefsByProposalId['combined-provenance']
    const claimAsset = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === claimRef)!.value as { sourceRefs: string[]; provenance: Array<{ sourceRef: string; rawRef: string }> }
    assert.deepEqual(claimAsset.sourceRefs, [originalAsset.id, currentAsset.id].sort())
    assert.deepEqual(claimAsset.provenance.map((item) => `${item.sourceRef}|${item.rawRef}`).sort(), [`${originalAsset.id}|${originalAsset.rawRefs[0]}`, `${currentAsset.id}|${currentAsset.rawRefs[0]}`].sort())

    const secondClaim = await gateway.submit({ ...(await input(root, 'existing-evidence-second-claim')), proposals: [
      { proposalId: 'edge-target-claim', kind: 'claim', subjectKey: 'company', claimType: 'fact', statement: 'Separate claim for evidence edge', sourceCandidateIds: ['structured-600519'] }
    ] })
    assert.equal(secondClaim.status, 'committed', secondClaim.errors.join('; '))
    const edgeResult = await gateway.submit({ ...(await input(root, 'existing-evidence-edge', '600519', [
      { proposalId: 'reused-evidence-edge', kind: 'reasoning_edge', existingSourceRef: claimRef as `claim:${string}`, existingTargetRef: secondClaim.claimRefsByProposalId['edge-target-claim'] as `claim:${string}`, edgeType: 'supports', sourceCandidateIds: ['evidence-current'], existingEvidenceBindings: [{ sourceRef: originalAsset.id as `source:${string}`, rawRef: originalAsset.rawRefs[0] as `raw-sha256-${string}` }] }
    ], [current])) })
    assert.equal(edgeResult.status, 'committed', edgeResult.errors.join('; '))
    const edge = (await readCanonicalV04Assets(root)).objects.find((item) => item.kind === 'reasoning_edge')!.value as { sourceRefs: string[] }
    assert.deepEqual(edge.sourceRefs, [originalAsset.id, currentAsset.id].sort())
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('invalid existing canonical Source/Raw evidence blocks semantic writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-invalid-existing-evidence-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-invalid-existing-evidence', now: clock() })
    const gateway = new KnowledgeProductionGateway()
    const original = source('600519', 'existing-evidence-a', 'archived bytes a')
    const secondaryBase = source('600519', 'existing-evidence-b', 'archived bytes b')
    const secondary = { ...secondaryBase, title: 'Secondary archived source', candidate: { ...secondaryBase.candidate, title: 'Secondary archived source' } }
    const seeded = await gateway.submit({ ...(await input(root, 'invalid-existing-evidence-seed', '600519', [], [original, secondary])) })
    assert.equal(seeded.status, 'committed', seeded.errors.join('; '))
    const assets = await readCanonicalV04Assets(root)
    const sourceAsset = assets.objects.find((item) => item.value.id === seeded.sourceRefsByLocalId['existing-evidence-a'])!
    const otherSource = assets.objects.find((item) => item.value.id === seeded.sourceRefsByLocalId['existing-evidence-b'])!
    const sourceValue = sourceAsset.value as unknown as { id: string; rawRefs: string[]; lifecycle: Record<string, unknown>; rights: Record<string, unknown>; usagePolicy: Record<string, unknown> }
    const otherRawRef = (otherSource.value as { rawRefs: string[] }).rawRefs[0]
    const originalText = await readFile(sourceAsset.filePath, 'utf8')
    const originalValue = structuredClone(sourceValue)
    const noClaimsBefore = assets.objects.filter((item) => item.kind === 'claim').length
    const rawRegistryBefore = await readFile(join(root, 'registry', 'raw.yaml'), 'utf8')
    for (const [run, rights] of [
      ['new-retention-denied', { ...original.rights, retentionAllowed: false }],
      ['new-ai-denied', { ...original.rights, aiProcessingAllowed: false }],
      ['new-derivative-denied', { ...original.rights, derivativeKnowledgeAllowed: false }],
      ['new-access-restricted', { ...original.rights, accessScope: 'restricted' as const }]
    ] as const) {
      const forbidden = { ...original, candidate: { ...original.candidate, candidateId: run }, rights }
      const result = await gateway.submit({ ...(await input(root, run, '600519', [], [forbidden])) })
      assert.equal(result.status, 'blocked', `${run}: ${result.errors.join('; ')}`)
      assert.equal(await readFile(join(root, 'registry', 'raw.yaml'), 'utf8'), rawRegistryBefore)
    }
    const inputFor = (run: string, sourceRef = sourceValue.id, rawRef = sourceValue.rawRefs[0]) => input(root, run, '600519', [
      { proposalId: `claim-${run}`, kind: 'claim' as const, subjectKey: 'company', claimType: 'fact' as const, statement: `Must not write ${run}`, existingEvidenceBindings: [{ sourceRef: sourceRef as `source:${string}`, rawRef: rawRef as `raw-sha256-${string}` }] }
    ], [])
    const assertBlocked = async (run: string, sourceRef = sourceValue.id, rawRef = sourceValue.rawRefs[0]) => {
      const beforeRevision = (await new KnowledgeBaseRegistry().mount(root)).revision
      const result = await gateway.submit(await inputFor(run, sourceRef, rawRef))
      assert.equal(result.status, 'blocked', `${run}: ${result.errors.join('; ')}`)
      assert.deepEqual(result.createdIds, [])
      const afterAssets = await readCanonicalV04Assets(root)
      assert.equal((await new KnowledgeBaseRegistry().mount(root)).revision, beforeRevision)
      assert.equal(afterAssets.objects.filter((item) => item.kind === 'claim').length, noClaimsBefore)
    }
    await assertBlocked('missing-source', 'source:missing')
    await assertBlocked('wrong-source-raw', sourceValue.id, otherRawRef)
    const mutateSource = async (mutate: (value: typeof originalValue) => void) => {
      const updated = structuredClone(originalValue)
      mutate(updated)
      await writeFile(sourceAsset.filePath, `${JSON.stringify(updated)}\n`, 'utf8')
    }
    const unregisteredRaw = `raw-sha256-${'f'.repeat(64)}`
    await mutateSource((value) => { value.rawRefs.push(unregisteredRaw) })
    await assertBlocked('unregistered-raw', sourceValue.id, unregisteredRaw)
    await mutateSource((value) => { value.lifecycle.status = 'expired' })
    await assertBlocked('inactive-source')
    await mutateSource((value) => { value.lifecycle.validUntil = '2026-09-07T00:00:00.000Z' })
    await assertBlocked('expired-lifecycle-window')
    await mutateSource((value) => { value.rights.expiresAt = '2026-09-07T00:00:00.000Z' })
    await assertBlocked('expired-rights-window')
    await mutateSource((value) => { value.rights.retentionAllowed = false })
    await assertBlocked('retention-denied')
    await mutateSource((value) => { value.rights.aiProcessingAllowed = false })
    await assertBlocked('ai-denied')
    await mutateSource((value) => { value.rights.derivativeKnowledgeAllowed = false })
    await assertBlocked('derivative-denied')
    await mutateSource((value) => { value.usagePolicy.allowDerivedKnowledge = false })
    await assertBlocked('usage-policy-denied')
    await mutateSource((value) => { value.rights.derivativeKnowledgeAllowed = false; value.usagePolicy.allowDerivedKnowledge = false })
    const reingested = { ...original, content: 'new bytes must not relax an old explicit denial' }
    const reacquisition = await gateway.submit({ ...(await input(root, 'reacquire-denied-source', '600519', [], [reingested])) })
    assert.equal(reacquisition.status, 'committed', reacquisition.errors.join('; '))
    const retainedDenial = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === sourceValue.id)!.value as unknown as { rights: { derivativeKnowledgeAllowed: boolean }; usagePolicy: { allowDerivedKnowledge: boolean } }
    assert.equal(retainedDenial.rights.derivativeKnowledgeAllowed, false)
    assert.equal(retainedDenial.usagePolicy.allowDerivedKnowledge, false)
    await writeFile(sourceAsset.filePath, originalText, 'utf8')
  } finally { await rm(root, { recursive: true, force: true }) }
})
