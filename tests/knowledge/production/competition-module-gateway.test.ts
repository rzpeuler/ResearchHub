import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import type { CompetitionModuleProductionProposal, KnowledgeProductionInput } from '../../../knowledge/production/contracts.ts'
import { COMPETITION_MODULE_SCHEMA_ID_V1, type CompetitionColumnV1, type CompetitionModuleV1 } from '../../../knowledge/schema/competition-module-v04.ts'
import type { EntityRefV04, RelationRefV04 } from '../../../knowledge/schema/domain-v04.ts'
import type { NormalizedResearchSource } from '../../../plugins/research-acquisition/contracts.ts'

const clock = () => '2026-09-08T00:00:00.000Z'
const columns: readonly CompetitionColumnV1[] = [
  { id: 'company', role: 'company', label: 'Company' },
  { id: 'main-products', role: 'main_products', label: 'Main Products' },
  { id: 'market-cap', role: 'market_cap', label: 'Market Cap' },
  { id: 'annual-revenue', role: 'annual_revenue', label: 'Annual Revenue' },
]

interface RowFixture {
  readonly key: string
  readonly name: string
  readonly sourceId: string
  readonly currency: string
  readonly marketDisplay: string
  readonly marketClaimId?: string
  readonly marketStatement?: string
  readonly marketReference?: { readonly proposalId: string } | { readonly existingRef: `claim:${string}` | `observation:${string}` | `relation:${string}` }
  readonly unavailableMarket?: boolean
}

function fixtureSource(candidateId: string): NormalizedResearchSource {
  return {
    candidate: { candidateId, kind: 'structured_data', tier: 2, title: `Financial fixture ${candidateId}`, provider: 'fixture', metadata: { dataKind: 'competition' } },
    retrievedAt: clock(),
    title: `Financial fixture ${candidateId}`,
    content: `Evidence for competition row ${candidateId}`,
    contentHash: 'b'.repeat(64),
    publisher: 'Fixture Publisher',
    rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
  }
}

function rowProposals(rows: readonly RowFixture[], options: { columns?: readonly CompetitionColumnV1[]; displayOverride?: string } = {}): KnowledgeProductionInput['proposals'] {
  const proposals: KnowledgeProductionInput['proposals'][number][] = []
  for (const row of rows) {
    const marketClaimId = row.marketClaimId ?? `market-${row.key}`
    proposals.push({ proposalId: `entity-${row.key}`, kind: 'entity', subjectKey: row.key, entityType: 'company', entityName: row.name })
    proposals.push({ proposalId: `exposure-${row.key}`, kind: 'relation', subjectKey: row.key, targetKey: 'industry', relationType: 'business_exposure', sourceCandidateIds: [row.sourceId] })
    proposals.push({ proposalId: `products-${row.key}`, kind: 'claim', subjectKey: row.key, claimType: 'fact', statement: `${row.name} makes industrial valves`, sourceCandidateIds: [row.sourceId] })
    proposals.push({ proposalId: marketClaimId, kind: 'claim', subjectKey: row.key, claimType: 'fact', statement: row.marketStatement ?? `${row.name} market value is ${row.marketDisplay}`, sourceCandidateIds: [row.sourceId] })
    proposals.push({ proposalId: `revenue-${row.key}`, kind: 'claim', subjectKey: row.key, claimType: 'fact', statement: `${row.name} FY2025 revenue is documented`, sourceCandidateIds: [row.sourceId] })
  }
  const moduleRows: CompetitionModuleProductionProposal['rows'][number][] = rows.map((row) => {
    const marketClaimId = row.marketClaimId ?? `market-${row.key}`
    return {
      company: { localKey: row.key },
      businessExposure: { proposalId: `exposure-${row.key}` },
      cells: {
        'main-products': { status: 'available', displayValue: 'Industrial valves', knowledgeRefs: [{ proposalId: `products-${row.key}` }] },
        'market-cap': row.unavailableMarket
          ? { status: 'unavailable', reason: 'No current verified quote' }
          : { status: 'available', displayValue: options.displayOverride ?? row.marketDisplay, asOf: '2026-09-01', unit: 'billion', currency: row.currency, knowledgeRefs: [row.marketReference ?? { proposalId: marketClaimId }] },
        'annual-revenue': { status: 'available', displayValue: '8.2', fiscalYear: 2025, unit: 'billion', currency: row.currency, knowledgeRefs: [{ proposalId: `revenue-${row.key}` }] },
      },
    }
  })
  proposals.push({ proposalId: 'competition', kind: 'module', targetIndustry: { localKey: 'industry' }, schemaId: COMPETITION_MODULE_SCHEMA_ID_V1, columns: options.columns ?? columns, rows: moduleRows })
  return proposals
}

async function makeInput(root: string, run: string, rows: readonly RowFixture[], overrides: Partial<KnowledgeProductionInput> = {}): Promise<KnowledgeProductionInput> {
  const evidence = rows.map((row) => fixtureSource(row.sourceId))
  return {
    handle: await new KnowledgeBaseRegistry().mount(root),
    producerType: 'industry_deep_research',
    producerRunId: run,
    schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
    entity: { localKey: 'industry', entityType: 'industry', name: 'Battery Materials' },
    proposals: rowProposals(rows),
    evidenceBindings: evidence.map((source) => ({ localSourceId: source.candidate.candidateId, source })),
    now: clock,
    ...overrides,
  }
}

function equivalentResolver() { return () => ({ outcome: 'equivalent' as const, reason: 'Fixture Company and Industry identities match' }) }

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-${name}`, now: clock() })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('Gateway creates a competition Module and maps its local proposal ID', async () => {
  await withFreshKb('competition-module-create', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const result = await gateway.submit(await makeInput(root, 'competition-create', [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-a', currency: 'CNY', marketDisplay: 'CNY 10bn' }]))
    assert.equal(result.status, 'committed', result.errors.join('; '))
    const moduleRef = result.moduleRefsByProposalId?.competition
    if (typeof moduleRef !== 'string' || !moduleRef.startsWith('module:')) throw new Error('Gateway did not map the competition Module proposal')
    assert.ok(result.createdIds.includes(moduleRef))
    const moduleAsset = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === moduleRef)
    assert.ok(moduleAsset)
    const module = moduleAsset.value as unknown as { type: string; targetEntity: string; rows: Array<{ companyRef: string; cells: Record<string, { displayValue?: string }> }> }
    assert.equal(module.type, 'competition')
    assert.equal(module.targetEntity, result.entityRefsByLocalKey.industry)
    assert.equal(module.rows[0]?.companyRef, result.entityRefsByLocalKey['company-a'])
    assert.equal(module.rows[0]?.cells['market-cap']?.displayValue, 'CNY 10bn')
  })
})

test('same Industry table replays idempotently with the same canonical Module ref', async () => {
  await withFreshKb('competition-module-replay', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const row = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-replay', currency: 'CNY', marketDisplay: 'CNY 10bn' }]
    const first = await gateway.submit(await makeInput(root, 'competition-replay-1', row))
    const second = await gateway.submit(await makeInput(root, 'competition-replay-2', row, { semanticResolver: equivalentResolver() }))
    assert.equal(first.status, 'committed', first.errors.join('; '))
    assert.equal(second.status, 'no_changes', second.errors.join('; '))
    assert.equal(second.moduleRefsByProposalId?.competition, first.moduleRefsByProposalId?.competition)
    assert.equal((await readCanonicalV04Assets(root)).objects.filter((asset) => asset.kind === 'module').length, 1)

    const stored = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as CompetitionModuleV1
    const storedRow = stored.rows[0]!
    const existingSelectors = Object.fromEntries(Object.entries(storedRow.cells).map(([columnId, cell]) => [columnId, cell.status === 'available'
      ? { ...cell, knowledgeRefs: cell.knowledgeRefs.map((existingRef) => ({ existingRef })) }
      : cell])) as CompetitionModuleProductionProposal['rows'][number]['cells']
    const explicitExistingProposal: CompetitionModuleProductionProposal = {
      proposalId: 'competition-existing-refs',
      kind: 'module',
      targetIndustry: { existingRef: first.entityRefsByLocalKey.industry as EntityRefV04 },
      schemaId: stored.schemaId,
      columns: stored.columns,
      rows: [{
        company: { existingRef: storedRow.companyRef },
        businessExposure: { existingRef: first.relationRefsByProposalId['exposure-company-a'] as RelationRefV04 },
        cells: existingSelectors,
      }],
    }
    const explicit = await gateway.submit(await makeInput(root, 'competition-replay-existing-refs', row, {
      entity: { localKey: 'industry', entityType: 'industry', name: 'Battery Materials', existingEntityRef: first.entityRefsByLocalKey.industry },
      proposals: [explicitExistingProposal],
      evidenceBindings: [],
    }))
    assert.equal(explicit.status, 'no_changes', explicit.errors.join('; '))
    assert.equal(explicit.moduleRefsByProposalId?.['competition-existing-refs'], first.moduleRefsByProposalId?.competition)
  })
})

test('evidence-backed cell update commits, and an unavailable update preserves the prior usable value', async () => {
  await withFreshKb('competition-module-update', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const firstRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-update-1', currency: 'CNY', marketDisplay: 'CNY 10bn' }]
    const first = await gateway.submit(await makeInput(root, 'competition-update-1', firstRow))
    const updatedRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-update-2', currency: 'CNY', marketDisplay: 'CNY 11bn', marketClaimId: 'market-company-a-v2' }]
    const update = await gateway.submit(await makeInput(root, 'competition-update-2', updatedRow, { semanticResolver: equivalentResolver() }))
    assert.equal(update.status, 'committed', update.errors.join('; '))
    assert.equal(update.moduleRefsByProposalId?.competition, first.moduleRefsByProposalId?.competition)
    const assetsAfterUpdate = await readCanonicalV04Assets(root)
    const moduleAfterUpdate = assetsAfterUpdate.objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { displayValue?: string }> }> }
    assert.equal(moduleAfterUpdate.rows[0]?.cells['market-cap']?.displayValue, 'CNY 11bn')

    const unavailable = rowProposals([{ ...updatedRow[0]!, unavailableMarket: true }])
    const preserved = await gateway.submit({ ...(await makeInput(root, 'competition-update-3', updatedRow, { semanticResolver: equivalentResolver() })), proposals: unavailable })
    assert.equal(preserved.status, 'no_changes', preserved.errors.join('; '))
    const moduleAfterUnavailable = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { displayValue?: string }> }> }
    assert.equal(moduleAfterUnavailable.rows[0]?.cells['market-cap']?.displayValue, 'CNY 11bn')
  })
})

test('Module blocks the whole submit when a cell reference cannot resolve', async () => {
  await withFreshKb('competition-module-bad-ref', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const valid = await makeInput(root, 'competition-bad-ref', [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-bad-ref', currency: 'CNY', marketDisplay: 'CNY 10bn' }])
    const proposals = rowProposals([{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-bad-ref', currency: 'CNY', marketDisplay: 'CNY 10bn', marketReference: { existingRef: 'claim:missing' } }])
    const beforeRevision = valid.handle.revision
    const result = await gateway.submit({ ...valid, proposals })
    assert.equal(result.status, 'blocked')
    assert.ok(result.errors.some((error) => error.includes('unresolved canonical knowledge reference')))
    assert.deepEqual(result.moduleRefsByProposalId, {})
    assert.equal(result.knowledgeBaseRevision, beforeRevision)
    assert.equal((await readCanonicalV04Assets(root)).objects.some((asset) => asset.kind === 'module'), false)
  })
})

test('Module blocks when the row Source payload is unusable', async () => {
  await withFreshKb('competition-module-unusable-source', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const invalid = { ...fixtureSource('source-unusable'), content: 'null' }
    const goodInput = await makeInput(root, 'competition-unusable-source', [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-unusable', currency: 'CNY', marketDisplay: 'CNY 10bn' }])
    const result = await gateway.submit({ ...goodInput, evidenceBindings: [{ localSourceId: 'source-unusable', source: invalid }] })
    assert.equal(result.status, 'blocked')
    assert.ok(result.errors.some((error) => error.includes('business_exposure Relation')))
    assert.equal((await readCanonicalV04Assets(root)).objects.some((asset) => asset.kind === 'module'), false)
  })
})

test('same knowledge references cannot justify a changed display value', async () => {
  await withFreshKb('competition-module-same-refs', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const row = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-same-refs', currency: 'CNY', marketDisplay: 'CNY 10bn' }]
    const first = await gateway.submit(await makeInput(root, 'competition-same-refs-1', row))
    const changed = { ...(await makeInput(root, 'competition-same-refs-2', row, { semanticResolver: equivalentResolver() })), proposals: rowProposals(row, { displayOverride: 'CNY 99bn' }) }
    const rejected = await gateway.submit(changed)
    assert.equal(rejected.status, 'blocked')
    assert.ok(rejected.errors.some((error) => error.includes('same knowledge references')))
    const module = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { displayValue?: string }> }> }
    assert.equal(module.rows[0]?.cells['market-cap']?.displayValue, 'CNY 10bn')
  })
})

test('Writer rejection does not report success or overwrite the prior Module', async () => {
  await withFreshKb('competition-module-writer-failure', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const firstRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-writer-1', currency: 'CNY', marketDisplay: 'CNY 10bn' }]
    const runId = 'competition-writer-same-run'
    const first = await gateway.submit(await makeInput(root, runId, firstRow))
    assert.equal(first.status, 'committed', first.errors.join('; '))

    const changedRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-writer-2', currency: 'CNY', marketDisplay: 'CNY 11bn', marketClaimId: 'market-company-a-writer-v2' }]
    const rejected = await gateway.submit(await makeInput(root, runId, changedRow, { semanticResolver: equivalentResolver() }))
    assert.equal(rejected.status, 'failed')
    assert.ok(rejected.errors.some((error) => error.includes('Workflow run was already used')))
    assert.equal(rejected.moduleRefsByProposalId?.competition, first.moduleRefsByProposalId?.competition)
    const module = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { displayValue?: string }> }> }
    assert.equal(module.rows[0]?.cells['market-cap']?.displayValue, 'CNY 10bn')
  })
})

test('different rows may retain different currencies and a changed column schema blocks for review', async () => {
  await withFreshKb('competition-module-schema-currency', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const rows = [
      { key: 'company-cny', name: 'Acme China', sourceId: 'source-cny', currency: 'CNY', marketDisplay: 'CNY 10bn' },
      { key: 'company-usd', name: 'Acme Global', sourceId: 'source-usd', currency: 'USD', marketDisplay: 'USD 2bn' },
    ]
    const firstInput = await makeInput(root, 'competition-currency-1', rows)
    const first = await gateway.submit(firstInput)
    assert.equal(first.status, 'committed', first.errors.join('; '))
    const module = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { currency?: string }> }> }
    assert.deepEqual(module.rows.map((row) => row.cells['market-cap']?.currency).sort(), ['CNY', 'USD'])

    const partial = await gateway.submit(await makeInput(root, 'competition-currency-partial', [rows[0]!], { semanticResolver: equivalentResolver() }))
    assert.equal(partial.status, 'no_changes', partial.errors.join('; '))
    const preservedModule = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ companyRef: string }> }
    assert.equal(preservedModule.rows.length, 2)

    const changedColumns = columns.map((column) => column.id === 'market-cap' ? { ...column, label: 'Valuation' } : column)
    const incompatible = { ...(await makeInput(root, 'competition-currency-2', rows, { semanticResolver: equivalentResolver() })), proposals: rowProposals(rows, { columns: changedColumns }) }
    const blocked = await gateway.submit(incompatible)
    assert.equal(blocked.status, 'blocked')
    assert.ok(blocked.errors.some((error) => error.includes('columns differ; schema changes require review')))
  })
})
