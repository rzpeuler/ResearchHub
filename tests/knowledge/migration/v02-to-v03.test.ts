import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/registry.ts'
import { archiveRaw } from '../../../packages/shared/knowledge-base/raw-archive.ts'
import { transformV02ToV03 } from '../../../packages/shared/knowledge-base/migration/v02-to-v03.ts'
import { parseYaml } from '../../../packages/shared/knowledge-base/yaml.ts'

type Asset = { type: string; value: Record<string, unknown>; path: string }

async function put(root: string, path: string, value: unknown): Promise<void> {
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`, 'utf8')
}

function lifecycle(): Record<string, unknown> { return { status: 'active' } }

function cleanAssets(): Asset[] {
  return [
    { type: 'entity', path: 'entities/industry.yaml', value: { id: 'industry:semiconductor', type: 'industry', name: 'Semiconductor', description: 'segment:gpu', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/gpu.yaml', value: { id: 'segment:gpu', type: 'segment', name: 'GPU', taxonomyRefs: ['taxonomy:hardware'], metadata: { opaque: 'company:nvidia' }, lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/network.yaml', value: { id: 'segment:network', type: 'segment', name: 'Network', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/nvidia.yaml', value: { id: 'company:nvidia', type: 'company', name: 'NVIDIA', ticker: 'NVDA', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/amd.yaml', value: { id: 'company:amd', type: 'company', name: 'AMD', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/board.yaml', value: { id: 'product:board', type: 'product', name: 'GPU Board', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/server.yaml', value: { id: 'product:server', type: 'product', name: 'AI Server', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/cuda.yaml', value: { id: 'technology:cuda', type: 'technology', name: 'CUDA', lifecycle: lifecycle() } },
    { type: 'source', path: 'sources/official.yaml', value: { id: 'source:official', type: 'official_disclosure', sourceType: 'official_disclosure', title: 'Official Report', publisher: 'NVIDIA', lifecycle: lifecycle() } },
    { type: 'intelligence', path: 'intelligence/fact.yaml', value: { id: 'fact:gpu', type: 'fact', entityRefs: ['segment:gpu'], sourceRefs: ['source:official'], statement: 'GPU provides compute.', lifecycle: lifecycle() } },
    { type: 'intelligence', path: 'intelligence/trend.yaml', value: { id: 'trend:accelerator', type: 'trend', entityRefs: ['segment:gpu'], sourceRefs: ['source:official'], description: 'Accelerator demand is rising.', lifecycle: lifecycle() } },
    { type: 'intelligence', path: 'intelligence/risk.yaml', value: { id: 'risk:export', type: 'risk', entityRefs: ['company:nvidia'], sourceRefs: ['source:official'], statement: 'Export controls may affect supply.', lifecycle: lifecycle() } },
    { type: 'module', path: 'modules/comparison/gpu.yaml', value: { id: 'module:gpu', type: 'comparison', targetEntity: 'segment:gpu', sourceRefs: ['source:official'], schemaId: 'gpu-comparison', columns: ['company'], rows: [['segment:gpu', 'company:nvidia']] } },
    { type: 'relation', path: 'relations/contains.yaml', value: { id: 'relation:contains', type: 'contains', source: 'industry:semiconductor', target: 'segment:gpu', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/operates.yaml', value: { id: 'relation:operates', type: 'operates_in', source: 'company:nvidia', target: 'segment:gpu', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/downstream.yaml', value: { id: 'relation:downstream', type: 'downstream_of', source: 'segment:gpu', target: 'segment:network', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/supplier.yaml', value: { id: 'relation:supplier', type: 'supplier_of', source: 'company:nvidia', target: 'company:amd', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/customer.yaml', value: { id: 'relation:customer', type: 'customer_of', source: 'company:amd', target: 'company:nvidia', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/competes-a.yaml', value: { id: 'relation:competes-a', type: 'competes_with', source: 'company:nvidia', target: 'company:amd', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/competes-b.yaml', value: { id: 'relation:competes-b', type: 'competes_with', source: 'company:amd', target: 'company:nvidia', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/substitute.yaml', value: { id: 'relation:substitute', type: 'substitute_for', source: 'product:server', target: 'product:board', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/depends.yaml', value: { id: 'relation:depends', type: 'depends_on', source: 'segment:gpu', target: 'technology:cuda', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/owns.yaml', value: { id: 'relation:owns', type: 'owns_stake_in', source: 'company:nvidia', target: 'company:amd', attributes: { ownershipPct: 0.2, controlType: 'minority' }, lifecycle: lifecycle() } },
  ]
}

async function createKb(assets: Asset[], options: { taxonomy?: unknown; view?: unknown; raw?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-v02-to-v03-'))
  await put(root, 'manifest.yaml', { knowledgeBaseId: 'kb-v02-to-v03', name: 'v0.2 migration fixture', schemaVersion: '0.2', storageFormatVersion: '1', revision: 7, status: 'active', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' })
  const registry: Record<string, { type: string; storageRef: string }> = {}
  for (const asset of assets) {
    await put(root, asset.path, asset.value)
    registry[String(asset.value.id)] = { type: asset.type, storageRef: asset.path }
  }
  await put(root, 'registry/assets.yaml', registry)
  if (options.taxonomy !== undefined) await put(root, 'taxonomy/catalog.yaml', options.taxonomy)
  if (options.view !== undefined) await put(root, 'views/overview.yaml', options.view)
  if (options.raw) {
    const handle = await new KnowledgeBaseRegistry().mount(root)
    const raw = await archiveRaw(handle, {
      bytes: new TextEncoder().encode('immutable raw bytes'),
      originalFilename: 'official.txt',
      mediaType: 'text/plain',
    })
    const sourcePath = join(root, 'sources/official.yaml')
    const source = parseYaml(await readFile(sourcePath, 'utf8'), sourcePath) as Record<string, unknown>
    source.rawRefs = [raw.manifest.rawRef]
    await writeFile(sourcePath, `${JSON.stringify(source)}\n`, 'utf8')
  }
  return root
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else result[path.slice(root.length + 1)] = (await readFile(path)).toString('base64')
    }
  }
  await visit(root)
  return result
}

async function stageCopy(root: string): Promise<string> {
  const staging = await mkdtemp(join(tmpdir(), 'researchhub-v03-staging-'))
  await cp(root, staging, { recursive: true })
  return staging
}

async function run(root: string, runId = 'fixture-run') {
  const registry = new KnowledgeBaseRegistry()
  const handle = await registry.mount(root)
  const staging = await stageCopy(root)
  const result = await transformV02ToV03(handle, staging, runId)
  return { result, staging }
}

test('B1 clean migration maps canonical assets, relations, auxiliaries, and Raw without mutating source', async () => {
  const root = await createKb(cleanAssets(), {
    taxonomy: { id: 'taxonomy:hardware', name: 'Hardware', graphRefs: ['segment:gpu'], label: 'segment:gpu' },
    view: { targetEntity: 'segment:gpu', displayText: 'segment:gpu remains opaque here' },
    raw: true,
  })
  try {
    const before = await snapshot(root)
    const { result, staging } = await run(root)
    try {
      assert.equal(result.reviewItems.length, 0, JSON.stringify(result.reviewItems))
      assert.equal(result.after.themeGroupIds[0], 'theme-group:unclassified')
      assert.equal(result.after.counts.claims, 3)
      assert.equal(result.changes.fallbackThemeGroupCreated, true)
      assert.deepEqual(result.warnings.map((warning) => warning.code), [
        'business_exposure_basis_unknown', 'business_exposure_materiality_unknown', 'business_exposure_stage_unknown',
        'theme_group_unclassified',
      ])
      assert.equal(result.idMappings.find((item) => item.from === 'industry:semiconductor')?.to, 'entity:semiconductor')
      assert.equal(result.idMappings.find((item) => item.from === 'fact:gpu')?.to, 'claim:gpu')
      assert.equal(result.idMappings.find((item) => item.from === 'source:official')?.to, 'source:official')
      const targetRegistry = parseYaml(await readFile(join(staging, 'registry/assets.yaml'), 'utf8')) as Record<string, { type: string; storageRef: string }>
      assert.equal(targetRegistry['theme-group:unclassified']?.type, 'theme_group')
      assert.equal(targetRegistry['entity:semiconductor']?.type, 'entity')
      assert.equal(targetRegistry['claim:gpu']?.type, 'claim')
      assert.equal(targetRegistry['module:gpu']?.type, 'module')
      assert.equal(Object.keys(targetRegistry).some((id) => id.startsWith('taxonomy:') || id.startsWith('view:') || id.startsWith('raw-sha256-')), false)
      const migratedOperate = parseYaml(await readFile(join(staging, 'relations/operates.yaml'), 'utf8')) as Record<string, unknown>
      assert.deepEqual(migratedOperate.attributes, { exposureBasis: 'unknown', realizationStage: 'unknown', materiality: 'unknown', financialContribution: null })
      assert.equal(migratedOperate.asOf, null)
      const migratedModule = parseYaml(await readFile(join(staging, 'modules/comparison/gpu.yaml'), 'utf8')) as Record<string, unknown>
      assert.equal(migratedModule.targetEntity, 'entity:gpu')
      assert.deepEqual(migratedModule.rows, [['segment:gpu', 'company:nvidia']])
      const taxonomy = parseYaml(await readFile(join(staging, 'taxonomy/catalog.yaml'), 'utf8')) as Record<string, unknown>
      assert.deepEqual(taxonomy.graphRefs, ['entity:gpu'])
      assert.equal(taxonomy.label, 'segment:gpu')
      const view = parseYaml(await readFile(join(staging, 'views/overview.yaml'), 'utf8')) as Record<string, unknown>
      assert.equal(view.targetEntity, 'entity:gpu')
      assert.equal(view.displayText, 'segment:gpu remains opaque here')
      assert.deepEqual(await snapshot(root), before)
      const sourceRawRegistry = parseYaml(await readFile(join(root, 'registry/raw.yaml'), 'utf8')) as Record<string, { storageRef: string }>
      const targetRawRegistry = parseYaml(await readFile(join(staging, 'registry/raw.yaml'), 'utf8')) as Record<string, { storageRef: string }>
      assert.deepEqual(targetRawRegistry, sourceRawRegistry)
      const rawRef = Object.keys(sourceRawRegistry)[0]!
      assert.equal(
        await readFile(join(staging, targetRawRegistry[rawRef]!.storageRef), 'utf8'),
        await readFile(join(root, sourceRawRegistry[rawRef]!.storageRef), 'utf8'),
      )
      assert.deepEqual(result.invariants, {
        sourceRootUnchanged: true,
        rawIdentityPreserved: true,
        rawRegistryPreserved: true,
        completeCanonicalIdMapping: true,
        targetCanonicalIdsUnique: true,
        noLegacyCanonicalNamespaceInDeclaredRefs: true,
        declaredCanonicalRefsUseV03Namespaces: true,
        declaredCanonicalRefsResolveToTarget: true,
        noMixedCanonicalSemanticRegistry: true,
        registryNamespaceKindConsistent: true,
        taxonomyPreserved: true,
        viewsPreserved: true,
        auxiliaryDeclaredRefsResolved: true,
        moduleDeclaredRefsResolved: true,
        relationEndpointsCanonical: true,
        noOrphanDeduplicatedRelationFiles: true,
        canonicalRegistryRebuilt: true,
      })
    } finally { await rm(staging, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B3 policy resolves compatibility fields without guessing semantic meaning', async () => {
  const root = await createKb([
    ...cleanAssets(),
    { type: 'entity', path: 'entities/policy-company.yaml', value: { id: 'company:policy', type: 'company', name: 'Policy Company', listingStatus: 'listed', tags: ['legacy'], sourceRefs: ['source:policy'] } },
    { type: 'source', path: 'sources/policy.yaml', value: { id: 'source:policy', type: 'custom_report', title: 'Policy Source', documentType: 'briefing' } },
    { type: 'relation', path: 'relations/policy.yaml', value: { id: 'relation:policy', type: 'depends_on', source: 'company:policy', target: 'segment:gpu' } },
    { type: 'intelligence', path: 'intelligence/policy-fact.yaml', value: { id: 'fact:policy', type: 'fact', affectedEntityRefs: ['company:policy'], sourceRefs: ['source:policy'], statement: 'A policy event occurred.', category: 'event', occurredAt: '2026', datePrecision: 'year', impact: 'material' } },
  ])
  try {
    const { result, staging } = await run(root, 'policy-run')
    try {
      assert.equal(result.reviewItems.some((item) => item.code === 'lifecycle_missing'), false)
      assert.equal(result.reviewItems.some((item) => item.code === 'unsupported_custom_legacy_type'), false)
      assert.equal(result.reviewItems.some((item) => item.code === 'event_impact_requires_decomposition' && item.assetId === 'fact:policy'), true)
      assert.deepEqual(parseYaml(await readFile(join(staging, 'entities/policy-company.yaml'), 'utf8')).metadata, { legacyV02: { listingStatus: 'listed', sourceRefs: ['source:policy'], tags: ['legacy'] } })
      assert.deepEqual(parseYaml(await readFile(join(staging, 'sources/policy.yaml'), 'utf8')).metadata, { legacyV02: { documentType: 'briefing' } })
      const claim = parseYaml(await readFile(join(staging, 'intelligence/policy-fact.yaml'), 'utf8')) as Record<string, unknown>
      assert.deepEqual(claim.subjectRefs, ['entity:policy'])
      assert.deepEqual(claim.temporal, { asOf: null, scope: { type: 'period', start: null, end: null, label: '2026' } })
      assert.equal(result.warnings.filter((warning) => warning.code === 'legacy_lifecycle_default_active').length, 3)
      assert.equal(result.warnings.some((warning) => warning.code === 'legacy_claim_category_discarded' && warning.assetId === 'fact:policy'), true)
    } finally { await rm(staging, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B3 accounts every legacy temporal candidate without silent loss', async () => {
  const cases = [
    { name: 'period-only', type: 'fact', fields: { period: 'FY2026' }, temporal: { asOf: null, scope: { type: 'period', start: null, end: null, label: 'FY2026' } } },
    { name: 'time-horizon-only', type: 'trend', fields: { timeHorizon: '2026-2030' }, temporal: { asOf: null, scope: { type: 'period', start: null, end: null, label: '2026-2030' } } },
    { name: 'occurred-day', type: 'fact', fields: { occurredAt: '2026-01-05', datePrecision: 'day' }, temporal: { asOf: null, scope: { type: 'point', start: null, end: null, label: '2026-01-05' } } },
    { name: 'occurred-year', type: 'fact', fields: { occurredAt: '2026', datePrecision: 'year' }, temporal: { asOf: null, scope: { type: 'period', start: null, end: null, label: '2026' } } },
    { name: 'equivalent-periods', type: 'trend', fields: { period: '2026-2030', timeHorizon: '2026-2030' }, temporal: { asOf: null, scope: { type: 'period', start: null, end: null, label: '2026-2030' } } },
    { name: 'conflicting-periods', type: 'trend', fields: { period: 'FY2026', timeHorizon: '2026-2030' }, conflict: true },
    { name: 'period-occurred-conflict', type: 'fact', fields: { period: 'FY2026', occurredAt: '2026-01-01', datePrecision: 'day' }, conflict: true },
    { name: 'explicit-match', type: 'fact', fields: { period: 'FY2026', temporal: { asOf: null, scope: { type: 'period', start: null, end: null, label: 'FY2026' } } }, temporal: { asOf: null, scope: { type: 'period', start: null, end: null, label: 'FY2026' } } },
    { name: 'explicit-null-label', type: 'fact', fields: { period: 'FY2026', temporal: { asOf: '2026-01-01T00:00:00.000Z', scope: { type: 'period', start: null, end: null, label: null } } }, temporal: { asOf: '2026-01-01T00:00:00.000Z', scope: { type: 'period', start: null, end: null, label: 'FY2026' } } },
    { name: 'explicit-label-mismatch', type: 'fact', fields: { period: 'FY2026', temporal: { asOf: null, scope: { type: 'period', start: null, end: null, label: 'FY2027' } } }, conflict: true },
    { name: 'explicit-type-mismatch', type: 'fact', fields: { period: 'FY2026', temporal: { asOf: null, scope: { type: 'point', start: null, end: null, label: 'FY2026' } } }, conflict: true },
    { name: 'numeric-period', type: 'fact', fields: { period: 2026 }, invalid: true },
    { name: 'numeric-time-horizon', type: 'trend', fields: { timeHorizon: 2026 }, invalid: true },
    { name: 'numeric-occurred-at', type: 'fact', fields: { occurredAt: 2026 }, invalid: true },
  ] as const
  for (const scenario of cases) {
    const id = `fact:temporal-${scenario.name}`
    const value = { id, type: scenario.type, entityRefs: ['segment:gpu'], sourceRefs: ['source:official'], statement: 'Temporal policy test.', ...scenario.fields, lifecycle: lifecycle() }
    const root = await createKb([...cleanAssets(), { type: 'intelligence', path: `intelligence/temporal-${scenario.name}.yaml`, value }])
    try {
      const { result, staging } = await run(root, `temporal-${scenario.name}`)
      try {
        const reviews = result.reviewItems.filter((item) => item.assetId === id)
        assert.equal(reviews.some((item) => item.code === 'temporal_semantic_conflict'), 'conflict' in scenario, scenario.name)
        assert.equal(reviews.some((item) => item.code === 'legacy_temporal_invalid'), 'invalid' in scenario, scenario.name)
        const claim = parseYaml(await readFile(join(staging, `intelligence/temporal-${scenario.name}.yaml`), 'utf8')) as Record<string, unknown>
        if ('temporal' in scenario) assert.deepEqual(claim.temporal, scenario.temporal, scenario.name)
      } finally { await rm(staging, { recursive: true, force: true }) }
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('B3 preserves metadata.legacyV02 collision values and reviews every collision form', async () => {
  const cases = [
    { id: 'company:metadata-collision-entity', type: 'entity', path: 'entities/metadata-collision-entity.yaml', value: { id: 'company:metadata-collision-entity', type: 'company', name: 'Collision Entity', metadata: { legacyV02: { listingStatus: 'existing' } }, listingStatus: 'listed' }, expected: { legacyV02: { listingStatus: 'existing' } } },
    { id: 'source:metadata-collision-source', type: 'source', path: 'sources/metadata-collision-source.yaml', value: { id: 'source:metadata-collision-source', type: 'custom_report', title: 'Collision Source', metadata: { legacyV02: { documentType: 'existing' } }, documentType: 'annual-report' }, expected: { legacyV02: { documentType: 'existing' } } },
    { id: 'company:metadata-collision-shape', type: 'entity', path: 'entities/metadata-collision-shape.yaml', value: { id: 'company:metadata-collision-shape', type: 'company', name: 'Collision Shape', metadata: { legacyV02: 'occupied' }, tags: ['legacy'] }, expected: { legacyV02: 'occupied' } },
  ] as const
  for (const scenario of cases) {
    const root = await createKb([...cleanAssets(), scenario])
    try {
      const { result, staging } = await run(root, `metadata-${scenario.type}-${scenario.id.replaceAll(':', '-')}`)
      try {
        assert.equal(result.reviewItems.some((item) => item.assetId === scenario.id && item.code === 'legacy_metadata_collision'), true, scenario.id)
        assert.deepEqual(parseYaml(await readFile(join(staging, scenario.path), 'utf8')).metadata, scenario.expected, scenario.id)
      } finally { await rm(staging, { recursive: true, force: true }) }
    } finally { await rm(root, { recursive: true, force: true }) }
  }
})

test('B1 emits deterministic Review items for collisions, ambiguity, unsupported semantics, and unresolved refs', async () => {
  const assets: Asset[] = [
    { type: 'entity', path: 'entities/industry.yaml', value: { id: 'industry:collision', type: 'industry', name: 'Industry', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/segment.yaml', value: { id: 'segment:collision', type: 'segment', name: 'Segment', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/theme-target.yaml', value: { id: 'industry:theme-target', type: 'industry', name: 'Theme Target', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/product-a.yaml', value: { id: 'product:a', type: 'product', name: 'A', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/product-b.yaml', value: { id: 'product:b', type: 'product', name: 'B', lifecycle: lifecycle() } },
    { type: 'entity', path: 'entities/company.yaml', value: { id: 'company:c', type: 'company', name: 'C', tags: ['legacy-tag'], lifecycle: lifecycle() } },
    { type: 'source', path: 'sources/bad.yaml', value: { id: 'source:bad', type: 'custom_report', sourceType: 'unsupported_custom', title: 'Bad Source' } },
    { type: 'intelligence', path: 'intelligence/missing.yaml', value: { id: 'viewpoint:missing', type: 'viewpoint', entityRefs: ['company:c'], sourceRefs: ['source:bad'], assumptions: ['opaque semantic'] } },
    { type: 'module', path: 'modules/unresolved.yaml', value: { id: 'module:unresolved', type: 'comparison', targetEntity: 'segment:missing', sourceRefs: ['source:missing'], rows: [['segment:missing']], extension: 'legacy module extension' } },
    { type: 'relation', path: 'relations/contains.yaml', value: { id: 'relation:contains', type: 'contains', source: 'product:a', target: 'product:b', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/operates.yaml', value: { id: 'relation:operates', type: 'operates_in', source: 'company:c', target: 'industry:theme-target', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/depends.yaml', value: { id: 'relation:depends', type: 'depends_on', source: 'company:c', target: 'company:c', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/partner.yaml', value: { id: 'relation:partner', type: 'partner_of', source: 'company:c', target: 'company:c', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/invested.yaml', value: { id: 'relation:invested', type: 'invested_in', source: 'company:c', target: 'company:c', lifecycle: lifecycle() } },
  ]
  const root = await createKb(assets, { taxonomy: { id: 'taxonomy:fixture', graphRefs: ['segment:missing'] }, view: { targetEntity: 'company:missing' } })
  try {
    const { result, staging } = await run(root, 'review-fixture')
    try {
      const codes = new Set(result.reviewItems.map((item) => item.code))
      for (const code of ['target_id_collision', 'ambiguous_contains_semantics', 'operates_in_theme_target', 'invalid_legacy_relation_endpoints', 'ambiguous_partner_relation', 'ambiguous_investment_state', 'claim_statement_missing', 'opaque_module_reference_unresolved', 'unresolved_auxiliary_declared_ref', 'legacy_semantic_field_unmapped']) assert.equal(codes.has(code), true, code)
      assert.equal(result.reviewItems.every((item) => item.migrationId === 'knowledge-schema-0.2-to-0.3'), true)
      assert.deepEqual(parseYaml(await readFile(join(staging, 'entities/company.yaml'), 'utf8')).metadata, { legacyV02: { tags: ['legacy-tag'] } })
      assert.equal(result.warnings.some((warning) => warning.code === 'legacy_metadata_preserved' && warning.assetId === 'company:c'), true)
      assert.equal(result.warnings.some((warning) => warning.code === 'legacy_source_type_unknown' && warning.assetId === 'source:bad'), true)
      assert.equal(parseYaml(await readFile(join(staging, 'sources/bad.yaml'), 'utf8')).sourceType, 'unknown')
      assert.equal(result.reviewItems.some((item) => item.assetId === 'module:unresolved' && item.code === 'legacy_semantic_field_unmapped'), true)
      assert.equal(result.invariants.completeCanonicalIdMapping, false)
      assert.equal(result.invariants.auxiliaryDeclaredRefsResolved, false)
      assert.equal(result.invariants.moduleDeclaredRefsResolved, false)
      const mappedCollision = result.idMappings.filter((item) => item.from === 'industry:collision' || item.from === 'segment:collision')
      assert.equal(mappedCollision.length, 0)
      assert.equal(await readFile(join(staging, 'modules/unresolved.yaml'), 'utf8').then((text) => text.includes('segment:missing')), true)
    } finally { await rm(staging, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B1 is deterministic and leaves opaque values and the source snapshot unchanged', async () => {
  const root = await createKb(cleanAssets(), {
    taxonomy: { id: 'taxonomy:hardware', graphRefs: ['segment:gpu'], label: 'segment:gpu' },
    view: { targetEntity: 'segment:gpu', label: 'segment:gpu', template: 'company:nvidia' },
  })
  try {
    const before = await snapshot(root)
    const first = await run(root, 'deterministic-run')
    const second = await run(root, 'deterministic-run')
    try {
      assert.deepEqual(first.result, second.result)
      assert.deepEqual(await snapshot(first.staging), await snapshot(second.staging))
      assert.deepEqual(await snapshot(root), before)
      const entity = parseYaml(await readFile(join(first.staging, 'entities/gpu.yaml'), 'utf8')) as Record<string, unknown>
      assert.equal(entity.metadata && (entity.metadata as Record<string, unknown>).opaque, 'company:nvidia')
      const module = parseYaml(await readFile(join(first.staging, 'modules/comparison/gpu.yaml'), 'utf8')) as Record<string, unknown>
      assert.deepEqual(module.rows, [['segment:gpu', 'company:nvidia']])
      const view = parseYaml(await readFile(join(first.staging, 'views/overview.yaml'), 'utf8')) as Record<string, unknown>
      assert.equal(view.label, 'segment:gpu')
      assert.equal(view.template, 'company:nvidia')
    } finally {
      await rm(first.staging, { recursive: true, force: true })
      await rm(second.staging, { recursive: true, force: true })
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B1 rewrites Relation refs after dedupe and removes only the staging loser file', async () => {
  const root = await createKb([...cleanAssets(), {
    type: 'relation', path: 'relations/context.yaml', value: {
      id: 'relation:context', type: 'depends_on', source: 'segment:gpu', target: 'technology:cuda',
      contextRefs: ['relation:competes-b'], lifecycle: lifecycle(),
    },
  }], { raw: true })
  try {
    const sourceRelation = join(root, 'relations/competes-b.yaml')
    const { result, staging } = await run(root, 'post-dedupe-ref-run')
    try {
      assert.equal(result.idMappings.find((item) => item.from === 'relation:competes-b')?.to, 'relation:competes-a')
      const context = parseYaml(await readFile(join(staging, 'relations/context.yaml'), 'utf8')) as Record<string, unknown>
      assert.deepEqual(context.contextRefs, ['relation:competes-a'])
      assert.equal(await readFile(join(staging, 'registry/assets.yaml'), 'utf8').then((value) => value.includes('relation:competes-b')), false)
      await assert.rejects(() => readFile(join(staging, 'relations/competes-b.yaml')))
      assert.equal(await readFile(sourceRelation, 'utf8').then(() => true), true)
      assert.equal(result.changes.removedStagingCanonicalFiles.includes('relations/competes-b.yaml'), true)
      assert.equal(result.changes.removedStagingCanonicalFiles.includes('relations/depends.yaml'), false)
      assert.equal(result.invariants.noOrphanDeduplicatedRelationFiles, true)
    } finally { await rm(staging, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B1 reviews conflicting and unmappable Relation attributes without silent loss', async () => {
  const root = await createKb([
    ...cleanAssets(),
    { type: 'relation', path: 'relations/upstream-conflict.yaml', value: { id: 'relation:upstream-conflict', type: 'upstream_of', source: 'segment:network', target: 'segment:gpu', attributes: { legacyMeaning: 'different' }, lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/depends-attributes.yaml', value: { id: 'relation:depends-attributes', type: 'depends_on', source: 'segment:gpu', target: 'technology:cuda', attributes: { legacyMeaning: 'preserve me' }, lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/owns-invalid.yaml', value: { id: 'relation:owns-invalid', type: 'owns_stake_in', source: 'company:nvidia', target: 'company:amd', attributes: { ownershipPct: 1.5, controlType: 'uncontrolled' }, lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/owns-missing.yaml', value: { id: 'relation:owns-missing', type: 'owns_stake_in', source: 'company:amd', target: 'company:nvidia', lifecycle: lifecycle() } },
    { type: 'relation', path: 'relations/theme-invalid.yaml', value: { id: 'relation:theme-invalid', type: 'contains', source: 'industry:semiconductor', target: 'segment:network', attributes: { importance: 'invalid', chainPosition: 'invalid' }, lifecycle: lifecycle() } },
  ])
  try {
    const { result, staging } = await run(root, 'relation-safety-run')
    try {
      const codes = new Set(result.reviewItems.map((item) => item.code))
      assert.equal(codes.has('relation_semantic_conflict'), true)
      assert.equal(codes.has('legacy_semantic_field_unmapped'), true)
      assert.equal(codes.has('invalid_relation_attribute'), true)
      const missing = parseYaml(await readFile(join(staging, 'relations/owns-missing.yaml'), 'utf8')) as Record<string, unknown>
      assert.deepEqual(missing.attributes, { ownershipPct: null, controlType: 'unknown' })
      assert.equal(await readFile(join(staging, 'relations/upstream-conflict.yaml'), 'utf8').then(() => true), true)
      assert.equal(await readFile(join(staging, 'relations/downstream.yaml'), 'utf8').then(() => true), true)
    } finally { await rm(staging, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B1 accounts all tested legacy Intelligence semantics and extensions', async () => {
  const root = await createKb([
    ...cleanAssets(),
    { type: 'intelligence', path: 'intelligence/fact-semantic.yaml', value: { id: 'fact:semantic', type: 'fact', entityRefs: ['segment:gpu'], sourceRefs: ['source:official'], statement: 'Fact statement.', category: 'financial_metric', value: { nested: true }, lifecycle: lifecycle() } },
    { type: 'intelligence', path: 'intelligence/forecast-semantic.yaml', value: { id: 'forecast:forecast-semantic', type: 'forecast', entityRefs: ['segment:gpu'], sourceRefs: ['source:official'], metric: 'market-size', period: '2030', values: { '2030': 500 }, assumptions: ['assumption'], lifecycle: lifecycle() } },
    { type: 'intelligence', path: 'intelligence/viewpoint-semantic.yaml', value: { id: 'viewpoint:viewpoint-semantic', type: 'viewpoint', entityRefs: ['segment:gpu'], sourceRefs: ['source:official'], statement: 'Viewpoint statement.', bullishPoints: ['bull'], bearishPoints: ['bear'], keyVariables: ['variable'], lifecycle: lifecycle() } },
    { type: 'intelligence', path: 'intelligence/trend-semantic.yaml', value: { id: 'trend:trend-semantic', type: 'trend', entityRefs: ['segment:gpu'], sourceRefs: ['source:official'], statement: 'Trend statement.', direction: 'increasing', timeHorizon: 'long', drivers: ['driver'], lifecycle: lifecycle() } },
    { type: 'intelligence', path: 'intelligence/risk-semantic.yaml', value: { id: 'risk:risk-semantic', type: 'risk', entityRefs: ['segment:gpu'], sourceRefs: ['source:official'], statement: 'Risk statement.', trigger: ['trigger'], impact: ['impact'], probability: 0.5, lifecycle: lifecycle() } },
  ])
  try {
    const { result, staging } = await run(root, 'intelligence-accounting-run')
    try {
      const fields = new Map<string, string[]>()
      for (const item of result.reviewItems.filter((candidate) => candidate.code === 'legacy_semantic_field_unmapped')) {
        const listed = item.details && Array.isArray(item.details.fields) ? item.details.fields.map(String) : []
        fields.set(item.assetId ?? '', [...(fields.get(item.assetId ?? '') ?? []), ...listed])
      }
      for (const [assetId, expected] of [
        ['fact:semantic', ['value']],
        ['forecast:forecast-semantic', ['assumptions', 'values']],
        ['viewpoint:viewpoint-semantic', ['bearishPoints', 'bullishPoints', 'keyVariables']],
        ['trend:trend-semantic', ['direction', 'drivers']],
        ['risk:risk-semantic', ['impact', 'probability', 'trigger']],
      ] as const) for (const field of expected) assert.equal(fields.get(assetId)?.includes(field), true, `${assetId}:${field}`)
      assert.equal(fields.get('fact:semantic')?.includes('category') ?? false, false)
      assert.equal(result.warnings.some((warning) => warning.code === 'legacy_claim_category_discarded' && warning.assetId === 'fact:semantic'), true)
      assert.deepEqual(parseYaml(await readFile(join(staging, 'intelligence/forecast-semantic.yaml'), 'utf8')).temporal, { asOf: null, scope: { type: 'period', start: null, end: null, label: '2030' } })
    } finally { await rm(staging, { recursive: true, force: true }) }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('B1 rejects a staging root nested with the source root', async () => {
  const root = await createKb(cleanAssets())
  try {
    const handle = await new KnowledgeBaseRegistry().mount(root)
    await assert.rejects(
      () => transformV02ToV03(handle, join(root, '.staging'), 'run-nested'),
      /non-nested staging root/,
    )
  } finally { await rm(root, { recursive: true, force: true }) }
})
