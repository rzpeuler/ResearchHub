import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { hashKnowledgeObject } from '../../../knowledge/storage/canonical-hash.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import type { CompetitionModuleProductionProposal, KnowledgeProductionInput } from '../../../knowledge/production/contracts.ts'
import { COMPETITION_MODULE_SCHEMA_ID_V1, type CompetitionColumnV1, type CompetitionModuleV1 } from '../../../knowledge/schema/competition-module-v04.ts'
import type { EntityRefV04, KnowledgeAssetV04, RelationRefV04 } from '../../../knowledge/schema/domain-v04.ts'
import type { KnowledgeChangeSetV04 } from '../../../knowledge/schema/mutation-v04.ts'
import { validateKnowledgeChangeSetV04 } from '../../../knowledge/validation/v04-change-set-validator.ts'
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
  readonly marketAsOf?: string
  readonly marketValue?: number
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

function marketValueForCell(row: RowFixture): number {
  return row.marketValue ?? Number(row.marketDisplay)
}

function rowProposals(rows: readonly RowFixture[], options: { columns?: readonly CompetitionColumnV1[]; displayOverride?: string } = {}): KnowledgeProductionInput['proposals'] {
  const proposals: KnowledgeProductionInput['proposals'][number][] = []
  for (const row of rows) {
    const marketClaimId = row.marketClaimId ?? `market-${row.key}`
    proposals.push({ proposalId: `entity-${row.key}`, kind: 'entity', subjectKey: row.key, entityType: 'company', entityName: row.name })
    proposals.push({ proposalId: `exposure-${row.key}`, kind: 'relation', subjectKey: row.key, targetKey: 'industry', relationType: 'business_exposure', sourceCandidateIds: [row.sourceId] })
    proposals.push({ proposalId: `products-${row.key}`, kind: 'claim', subjectKey: row.key, claimType: 'fact', statement: `${row.name} makes industrial valves`, sourceCandidateIds: [row.sourceId] })
    const marketValue = marketValueForCell(row)
    proposals.push({ proposalId: marketClaimId, kind: 'claim', subjectKey: row.key, claimType: 'fact', statement: row.marketStatement ?? `${row.name} market capitalization`, temporal: { asOf: row.marketAsOf ?? '2026-09-01' }, structuredValue: { metric: 'metric:market_cap', value: marketValue, unit: row.currency, comparator: 'eq' }, sourceCandidateIds: [row.sourceId] })
    proposals.push({ proposalId: `revenue-${row.key}`, kind: 'observation', subjectKey: row.key, observationType: 'metric', metricRef: 'metric:revenue', value: 8200000000, unit: row.currency, period: 'FY2025', sourceCandidateIds: [row.sourceId] })
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
          : { status: 'available', displayValue: options.displayOverride ?? String(marketValueForCell(row)), asOf: row.marketAsOf ?? '2026-09-01', unit: row.currency, currency: row.currency, knowledgeRefs: [row.marketReference ?? { proposalId: marketClaimId }] },
        'annual-revenue': { status: 'available', displayValue: '8200000000', fiscalYear: 2025, unit: row.currency, currency: row.currency, knowledgeRefs: [{ proposalId: `revenue-${row.key}` }] },
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

function explicitModuleProposal(module: CompetitionModuleV1, industryRef: string, relationRef: string, proposalId = 'competition-existing'): CompetitionModuleProductionProposal {
  return {
    proposalId,
    kind: 'module',
    targetIndustry: { existingRef: industryRef as EntityRefV04 },
    schemaId: module.schemaId,
    columns: module.columns,
    rows: module.rows.map((row) => ({
      company: { existingRef: row.companyRef },
      businessExposure: { existingRef: relationRef as RelationRefV04 },
      cells: Object.fromEntries(Object.entries(row.cells).map(([columnId, cell]) => [columnId, cell.status === 'available'
        ? { ...cell, knowledgeRefs: cell.knowledgeRefs.map((existingRef) => ({ existingRef })) }
        : cell])) as CompetitionModuleProductionProposal['rows'][number]['cells'],
    })),
  }
}

async function moduleOnlyInput(root: string, run: string, module: CompetitionModuleV1, industryRef: string, relationRef: string, proposalId = 'competition-existing'): Promise<KnowledgeProductionInput> {
  return {
    handle: await new KnowledgeBaseRegistry().mount(root),
    producerType: 'industry_deep_research',
    producerRunId: run,
    schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
    entity: { localKey: 'industry', entityType: 'industry', name: 'Battery Materials', existingEntityRef: industryRef },
    proposals: [explicitModuleProposal(module, industryRef, relationRef, proposalId)],
    evidenceBindings: [],
    now: clock,
  }
}

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
    const result = await gateway.submit(await makeInput(root, 'competition-create', [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-a', currency: 'CNY', marketDisplay: '10000000000' }]))
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
    assert.equal(module.rows[0]?.cells['market-cap']?.displayValue, '10000000000')
  })
})

test('Gateway blocks numeric Module cells that disagree with their canonical facts', async () => {
  for (const scenario of ['display', 'fiscal-year'] as const) {
    await withFreshKb(`competition-module-numeric-${scenario}`, async (root) => {
      const gateway = new KnowledgeProductionGateway()
      const rows = [{ key: 'company-a', name: 'Acme Valves', sourceId: `source-numeric-${scenario}`, currency: 'CNY', marketDisplay: '10000000000' }]
      const input = await makeInput(root, `competition-numeric-${scenario}`, rows)
      const proposals = structuredClone(rowProposals(rows)) as unknown as Array<Record<string, unknown>>
      const moduleProposal = proposals.find((proposal) => proposal.kind === 'module')!
      const moduleRows = moduleProposal.rows as Array<{ cells: Record<string, Record<string, unknown>> }>
      if (scenario === 'display') moduleRows[0]!.cells['market-cap']!.displayValue = 'CNY 10bn'
      else moduleRows[0]!.cells['annual-revenue']!.fiscalYear = 2026

      const beforeRevision = input.handle.revision
      const result = await gateway.submit({ ...input, proposals: proposals as unknown as KnowledgeProductionInput['proposals'] })
      assert.equal(result.status, 'blocked')
      assert.ok(result.errors.some((error) => error.includes(scenario === 'display' ? 'V04_COMPETITION_MODULE_NUMERIC_DISPLAY' : 'V04_COMPETITION_MODULE_NUMERIC_FISCAL_PERIOD')))
      assert.equal(result.knowledgeBaseRevision, beforeRevision)
      assert.equal((await readCanonicalV04Assets(root)).objects.some((asset) => asset.kind === 'module'), false)
    })
  }
})

test('same Industry table replays idempotently with the same canonical Module ref', async () => {
  await withFreshKb('competition-module-replay', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const row = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-replay', currency: 'CNY', marketDisplay: '10000000000' }]
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
    const firstRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-update-1', currency: 'CNY', marketDisplay: '10000000000' }]
    const first = await gateway.submit(await makeInput(root, 'competition-update-1', firstRow))
    const priorModule = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as CompetitionModuleV1
    const priorMarketRef = (priorModule.rows[0]!.cells['market-cap'] as Extract<CompetitionModuleV1['rows'][number]['cells'][string], { status: 'available' }>).knowledgeRefs[0] as `claim:${string}`
    const updatedRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-update-2', currency: 'CNY', marketDisplay: '11000000000', marketClaimId: 'market-company-a', marketValue: 11000000000 }]
    const updateInput = await makeInput(root, 'competition-update-2', updatedRow, {
      entity: { localKey: 'industry', entityType: 'industry', name: 'Battery Materials', existingEntityRef: first.entityRefsByLocalKey.industry },
      semanticResolver: equivalentResolver(),
    })
    const updateProposals = updateInput.proposals.map((proposal) => proposal.kind === 'claim' && proposal.proposalId === 'market-company-a'
      ? { ...proposal, resolution: 'update' as const, existingKnowledgeRefs: [priorMarketRef] }
      : proposal)
    const update = await gateway.submit({ ...updateInput, proposals: updateProposals })
    assert.equal(update.status, 'committed', update.errors.join('; '))
    assert.equal(update.moduleRefsByProposalId?.competition, first.moduleRefsByProposalId?.competition)
    const assetsAfterUpdate = await readCanonicalV04Assets(root)
    const moduleAfterUpdate = assetsAfterUpdate.objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { displayValue?: string }> }> }
    assert.equal(moduleAfterUpdate.rows[0]?.cells['market-cap']?.displayValue, '11000000000')

    const unavailable = rowProposals([{ ...updatedRow[0]!, unavailableMarket: true }])
    const preserved = await gateway.submit({ ...(await makeInput(root, 'competition-update-3', updatedRow, { semanticResolver: equivalentResolver() })), proposals: unavailable })
    assert.equal(preserved.status, 'no_changes', preserved.errors.join('; '))
    const moduleAfterUnavailable = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { displayValue?: string }> }> }
    assert.equal(moduleAfterUnavailable.rows[0]?.cells['market-cap']?.displayValue, '11000000000')
  })
})

test('same Claim may support a canonical numeric display update after new provenance is admitted', async () => {
  await withFreshKb('competition-module-same-claim-evidence', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const statement = 'Acme Valves market capitalization'
    const firstRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-same-claim-1', currency: 'CNY', marketDisplay: '10000000000', marketStatement: statement, marketValue: 10000000000 }]
    const first = await gateway.submit(await makeInput(root, 'competition-same-claim-1', firstRow))
    assert.equal(first.status, 'committed', first.errors.join('; '))
    const initialAssets = await readCanonicalV04Assets(root)
    const initialModule = initialAssets.objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as CompetitionModuleV1
    const initialMarketCell = initialModule.rows[0]!.cells['market-cap'] as Extract<CompetitionModuleV1['rows'][number]['cells'][string], { status: 'available' }>
    const updatedRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-same-claim-2', currency: 'CNY', marketDisplay: '11000000000', marketClaimId: 'market-company-a', marketStatement: statement, marketValue: 11000000000 }]
    const updateInput = await makeInput(root, 'competition-same-claim-2', updatedRow, { semanticResolver: equivalentResolver() })
    const priorMarketClaimRef = initialMarketCell.knowledgeRefs[0]
    const updateProposals = updateInput.proposals.map((proposal) => proposal.kind === 'claim' && proposal.proposalId === 'market-company-a'
      ? { ...proposal, resolution: 'update' as const, existingKnowledgeRefs: [priorMarketClaimRef as `claim:${string}`] }
      : proposal)
    const updated = await gateway.submit({ ...updateInput, proposals: updateProposals })
    assert.equal(updated.status, 'committed', updated.errors.join('; '))
    assert.equal(updated.moduleRefsByProposalId?.competition, first.moduleRefsByProposalId?.competition)

    const assets = await readCanonicalV04Assets(root)
    const module = assets.objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as CompetitionModuleV1
    const firstAssets = assets.objects.filter((asset) => asset.kind === 'claim')
    const marketClaim = firstAssets.find((asset) => (asset.value as { statement?: string }).statement === statement)!.value as { id: string; provenance?: unknown[]; structuredValue?: { value?: unknown } }
    assert.equal(module.rows[0]?.cells['market-cap']?.status, 'available')
    const cell = module.rows[0]!.cells['market-cap'] as Extract<CompetitionModuleV1['rows'][number]['cells'][string], { status: 'available' }>
    assert.equal(cell.displayValue, '11000000000')
    assert.equal('asOf' in cell ? cell.asOf : undefined, '2026-09-01')
    assert.deepEqual(cell.knowledgeRefs, initialMarketCell.knowledgeRefs)
    assert.deepEqual(cell.knowledgeRefs, [marketClaim.id])
    assert.equal(marketClaim.provenance?.length, 2)
    assert.equal(marketClaim.structuredValue?.value, 11000000000)
  })
})

test('Module blocks the whole submit when a cell reference cannot resolve', async () => {
  await withFreshKb('competition-module-bad-ref', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const valid = await makeInput(root, 'competition-bad-ref', [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-bad-ref', currency: 'CNY', marketDisplay: '10000000000' }])
    const proposals = rowProposals([{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-bad-ref', currency: 'CNY', marketDisplay: '10000000000', marketReference: { existingRef: 'claim:missing' } }])
    const beforeRevision = valid.handle.revision
    const result = await gateway.submit({ ...valid, proposals })
    assert.equal(result.status, 'blocked')
    assert.ok(result.errors.some((error) => error.includes('unresolved canonical knowledge reference')))
    assert.deepEqual(result.moduleRefsByProposalId, {})
    assert.equal(result.knowledgeBaseRevision, beforeRevision)
    assert.equal((await readCanonicalV04Assets(root)).objects.some((asset) => asset.kind === 'module'), false)
  })
})

test('ChangeSet validation rejects denied or missing Raw evidence listed by a competition Module', async () => {
  await withFreshKb('competition-module-validator-source-policy', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const row = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-direct-main', currency: 'CNY', marketDisplay: '10000000000' }]
    const base = await makeInput(root, 'competition-direct-module-source', row)
    const extraSource = fixtureSource('source-direct-extra')
    const first = await gateway.submit({ ...base, evidenceBindings: [...base.evidenceBindings, { localSourceId: 'source-direct-extra', source: extraSource }] })
    assert.equal(first.status, 'committed', first.errors.join('; '))

    const assets = await readCanonicalV04Assets(root)
    const moduleAsset = assets.objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!
    const module = moduleAsset.value as unknown as CompetitionModuleV1
    const extraSourceRef = first.sourceRefsByLocalId['source-direct-extra']!
    const extraSourceAsset = assets.objects.find((asset) => asset.value.id === extraSourceRef)!
    const originalSource = structuredClone(extraSourceAsset.value) as unknown as { rawRefs: string[]; rights: Record<string, unknown>; usagePolicy: Record<string, unknown> }

    const validateModuleChange = async (run: string, changedModule: Record<string, unknown>) => {
      const handle = await new KnowledgeBaseRegistry().mount(root)
      const changeSet: KnowledgeChangeSetV04 = {
        changeSetId: `direct-module-${run}`,
        workflowRunId: `direct-module-${run}`,
        knowledgeBaseId: handle.knowledgeBaseId,
        schemaVersion: '0.4',
        storageFormatVersion: '1',
        expectedBaseRevision: handle.revision,
        operations: [{ operationId: 'update-competition-module', type: 'update', knowledgeId: module.id, expectedBeforeHash: hashKnowledgeObject(module), object: changedModule as unknown as KnowledgeAssetV04 }],
      }
      return validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
    }

    const deniedSource = structuredClone(originalSource)
    deniedSource.rights.derivativeKnowledgeAllowed = false
    deniedSource.usagePolicy.allowDerivedKnowledge = false
    await writeFile(extraSourceAsset.filePath, `${JSON.stringify(deniedSource)}\n`, 'utf8')
    const denied = await validateModuleChange('denied', { ...module, sourceRefs: [...new Set([...(module.sourceRefs ?? []), extraSourceRef as `source:${string}`])] })
    assert.equal(denied.report.status, 'failed')
    assert.ok(denied.report.errors.some((error) => error.code === 'V04_MODULE_SOURCE_POLICY_INELIGIBLE'))
    assert.equal(denied.validatedChangeSet, undefined)

    const missingRawSource = structuredClone(originalSource)
    missingRawSource.rawRefs = []
    await writeFile(extraSourceAsset.filePath, `${JSON.stringify(missingRawSource)}\n`, 'utf8')
    const missingRaw = await validateModuleChange('missing-raw', { ...module, sourceRefs: [...new Set([...(module.sourceRefs ?? []), extraSourceRef as `source:${string}`])] })
    assert.equal(missingRaw.report.status, 'failed')
    assert.ok(missingRaw.report.errors.some((error) => error.code === 'V04_MODULE_SOURCE_RAW_REQUIRED'))
    assert.equal(missingRaw.validatedChangeSet, undefined)

    const mainSourceRef = first.sourceRefsByLocalId['source-direct-main']!
    const mainSourceAsset = assets.objects.find((asset) => asset.value.id === mainSourceRef)!
    const restrictedSource = structuredClone(mainSourceAsset.value) as unknown as { rights: Record<string, unknown> }
    restrictedSource.rights.accessScope = 'restricted'
    await writeFile(mainSourceAsset.filePath, `${JSON.stringify(restrictedSource)}\n`, 'utf8')
    const moduleWithoutListedSources = structuredClone(module) as unknown as Record<string, unknown>
    delete moduleWithoutListedSources.sourceRefs
    const omitted = await validateModuleChange('omitted-sources', moduleWithoutListedSources)
    assert.equal(omitted.report.status, 'failed')
    assert.ok(omitted.report.errors.some((error) => error.code === 'V04_MODULE_SOURCE_POLICY_INELIGIBLE'))
    assert.equal(omitted.validatedChangeSet, undefined)
  })
})

test('Module blocks when the row Source payload is unusable', async () => {
  await withFreshKb('competition-module-unusable-source', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const invalid = { ...fixtureSource('source-unusable'), content: 'null' }
    const goodInput = await makeInput(root, 'competition-unusable-source', [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-unusable', currency: 'CNY', marketDisplay: '10000000000' }])
    const result = await gateway.submit({ ...goodInput, evidenceBindings: [{ localSourceId: 'source-unusable', source: invalid }] })
    assert.equal(result.status, 'blocked')
    assert.ok(result.errors.some((error) => error.includes('business_exposure Relation')))
    assert.equal((await readCanonicalV04Assets(root)).objects.some((asset) => asset.kind === 'module'), false)
  })
})

test('Module blocks unusable Source evidence inherited from an existing business_exposure Relation', async () => {
  for (const scenario of ['denied', 'missing-raw'] as const) {
    await withFreshKb(`competition-module-inherited-${scenario}`, async (root) => {
      const gateway = new KnowledgeProductionGateway()
      const row = [{ key: 'company-a', name: 'Acme Valves', sourceId: `source-inherited-${scenario}`, currency: 'CNY', marketDisplay: '10000000000' }]
      const first = await gateway.submit(await makeInput(root, `competition-inherited-${scenario}`, row))
      assert.equal(first.status, 'committed', first.errors.join('; '))
      const assets = await readCanonicalV04Assets(root)
      const module = assets.objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as CompetitionModuleV1
      const sourceRef = first.sourceRefsByLocalId[row[0]!.sourceId]!
      const sourceAsset = assets.objects.find((asset) => asset.value.id === sourceRef)!
      const source = structuredClone(sourceAsset.value) as unknown as { rights: Record<string, unknown>; rawRefs: string[]; usagePolicy: Record<string, unknown> }
      if (scenario === 'denied') {
        source.rights.derivativeKnowledgeAllowed = false
        source.usagePolicy.allowDerivedKnowledge = false
        await writeFile(sourceAsset.filePath, `${JSON.stringify(source)}\n`, 'utf8')
      } else {
        const registryPath = join(root, 'registry', 'raw.yaml')
        const rawRegistry = JSON.parse(await readFile(registryPath, 'utf8')) as Record<string, unknown>
        delete rawRegistry[source.rawRefs[0]!]
        await writeFile(registryPath, `${JSON.stringify(rawRegistry, null, 2)}\n`, 'utf8')
      }

      const beforeRevision = (await new KnowledgeBaseRegistry().mount(root)).revision
      const moduleOnly = await moduleOnlyInput(root, `competition-inherited-check-${scenario}`, module, first.entityRefsByLocalKey.industry!, first.relationRefsByProposalId['exposure-company-a']!)
      const result = await gateway.submit(moduleOnly)
      assert.equal(result.status, 'blocked')
      assert.ok(result.errors.some((error) => error.includes(scenario === 'denied' ? 'does not permit retained derived Knowledge' : 'Raw evidence failed registry or integrity verification')))
      assert.equal((await new KnowledgeBaseRegistry().mount(root)).revision, beforeRevision)
      assert.equal((await readCanonicalV04Assets(root)).objects.filter((asset) => asset.kind === 'module').length, 1)
    })
  }
})

test('new Claim provenance alone cannot justify a contradictory same-reference display value', async () => {
  await withFreshKb('competition-module-same-refs', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const statement = 'Acme Valves market capitalization'
    const row = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-same-refs-1', currency: 'CNY', marketDisplay: '10000000000', marketStatement: statement, marketValue: 10000000000 }]
    const first = await gateway.submit(await makeInput(root, 'competition-same-refs-1', row))
    const assetsBeforeUpdate = await readCanonicalV04Assets(root)
    const beforeModule = assetsBeforeUpdate.objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as CompetitionModuleV1
    const priorClaimRef = (beforeModule.rows[0]!.cells['market-cap'] as Extract<CompetitionModuleV1['rows'][number]['cells'][string], { status: 'available' }>).knowledgeRefs[0]
    const changedRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-same-refs-2', currency: 'CNY', marketDisplay: '99000000000', marketClaimId: 'market-company-a', marketStatement: statement, marketValue: 10000000000 }]
    const changedInput = await makeInput(root, 'competition-same-refs-2', changedRow, { semanticResolver: equivalentResolver() })
    const changedProposals = rowProposals(changedRow, { displayOverride: '99000000000' }).map((proposal) => proposal.kind === 'claim' && proposal.proposalId === 'market-company-a'
      ? { ...proposal, resolution: 'update' as const, existingKnowledgeRefs: [priorClaimRef as `claim:${string}`] }
      : proposal)
    const changed = { ...changedInput, proposals: changedProposals }
    const rejected = await gateway.submit(changed)
    assert.equal(rejected.status, 'blocked')
    assert.ok(rejected.errors.some((error) => error.includes('numeric Claim value change')))
    const module = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { displayValue?: string }> }> }
    assert.equal(module.rows[0]?.cells['market-cap']?.displayValue, '10000000000')
  })
})

test('Writer rejection does not report success or overwrite the prior Module', async () => {
  await withFreshKb('competition-module-writer-failure', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const firstRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-writer-1', currency: 'CNY', marketDisplay: '10000000000' }]
    const runId = 'competition-writer-same-run'
    const first = await gateway.submit(await makeInput(root, runId, firstRow))
    assert.equal(first.status, 'committed', first.errors.join('; '))
    const priorModule = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as CompetitionModuleV1
    const priorMarketRef = (priorModule.rows[0]!.cells['market-cap'] as Extract<CompetitionModuleV1['rows'][number]['cells'][string], { status: 'available' }>).knowledgeRefs[0] as `claim:${string}`

    const changedRow = [{ key: 'company-a', name: 'Acme Valves', sourceId: 'source-writer-2', currency: 'CNY', marketDisplay: '11000000000', marketClaimId: 'market-company-a', marketValue: 11000000000 }]
    const changedInput = await makeInput(root, runId, changedRow, {
      entity: { localKey: 'industry', entityType: 'industry', name: 'Battery Materials', existingEntityRef: first.entityRefsByLocalKey.industry },
      semanticResolver: equivalentResolver(),
    })
    const changedProposals = changedInput.proposals.map((proposal) => proposal.kind === 'claim' && proposal.proposalId === 'market-company-a'
      ? { ...proposal, resolution: 'update' as const, existingKnowledgeRefs: [priorMarketRef] }
      : proposal)
    const rejected = await gateway.submit({ ...changedInput, proposals: changedProposals })
    assert.equal(rejected.status, 'failed')
    assert.ok(rejected.errors.some((error) => error.includes('Workflow run was already used')))
    assert.equal(rejected.moduleRefsByProposalId?.competition, first.moduleRefsByProposalId?.competition)
    const module = (await readCanonicalV04Assets(root)).objects.find((asset) => asset.value.id === first.moduleRefsByProposalId?.competition)!.value as unknown as { rows: Array<{ cells: Record<string, { displayValue?: string }> }> }
    assert.equal(module.rows[0]?.cells['market-cap']?.displayValue, '10000000000')
  })
})

test('different rows may retain different currencies and a changed column schema blocks for review', async () => {
  await withFreshKb('competition-module-schema-currency', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const rows = [
      { key: 'company-cny', name: 'Acme China', sourceId: 'source-cny', currency: 'CNY', marketDisplay: '10000000000' },
      { key: 'company-usd', name: 'Acme Global', sourceId: 'source-usd', currency: 'USD', marketDisplay: '2000000000' },
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
