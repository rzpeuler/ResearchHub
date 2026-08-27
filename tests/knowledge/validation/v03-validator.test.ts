import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import test from 'node:test'
import { archiveRaw } from '../../../packages/shared/knowledge-base/raw-archive.ts'
import { KnowledgeBaseLoader } from '../../../packages/shared/knowledge-base/knowledge-base-loader.ts'
import { KnowledgeBaseRegistry } from '../../../packages/shared/knowledge-base/registry.ts'
import { KnowledgeValidationSkill } from '../../../packages/skills/knowledge-validation/index.ts'

async function put(root: string, path: string, value: unknown): Promise<void> { const file = join(root, path); await mkdir(dirname(file), { recursive: true }); await writeFile(file, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`, 'utf8') }
async function createV03(): Promise<{ root: string; rawRef: string }> {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-v03-validator-'))
  await put(root, 'manifest.yaml', { knowledgeBaseId: 'kb-v03-validator', name: 'v0.3 validator fixture', schemaVersion: '0.2', storageFormatVersion: '1', revision: 1, status: 'active', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' })
  await put(root, 'theme-groups/technology.yaml', { id: 'theme-group:technology', name: 'Technology', aliases: ['Tech'], lifecycle: { status: 'active' }, metadata: { source: 'fixture' } })
  await put(root, 'entities/theme.yaml', { id: 'entity:ai-compute', type: 'investment_theme', name: 'AI Compute', themeGroupRef: 'theme-group:technology', definition: null, inclusionCriteria: ['accelerators'], exclusionCriteria: [], taxonomyRefs: ['taxonomy:hardware'], lifecycle: { status: 'active' } })
  await put(root, 'entities/industry.yaml', { id: 'entity:semiconductor', type: 'industry', name: 'Semiconductor', lifecycle: { status: 'active' } })
  await put(root, 'entities/company.yaml', { id: 'entity:example-company', type: 'company', name: 'Example Company', ticker: 'EXM', exchange: 'NYSE', legalName: null, lifecycle: { status: 'active' } })
  await put(root, 'sources/report.yaml', { id: 'source:report', title: 'Annual Report', sourceType: 'official_disclosure', sourceReliability: 'high', publisher: 'Example Company', publishedAt: '2026-08-27T00:00:00.000Z', lifecycle: { status: 'active' } })
  await put(root, 'sources/other.yaml', { id: 'source:other', title: 'Other Report', sourceType: 'professional_media', lifecycle: { status: 'active' } })
  await put(root, 'relations/exposure.yaml', { id: 'relation:exposure', type: 'business_exposure', sourceRef: 'entity:example-company', targetRef: 'entity:semiconductor', attributes: { exposureBasis: 'direct_operation', realizationStage: 'reported', materiality: 'core', financialContribution: { period: '2026', revenueAmount: 10, revenueShare: 0.4, profitAmount: null, profitShare: null, currency: 'USD', separatelyReported: true } }, sourceRefs: ['source:report'], contextRefs: ['entity:ai-compute'], lifecycle: { status: 'active' }, asOf: null })
  await put(root, 'claims/revenue.yaml', { id: 'claim:revenue', claimType: 'fact', statement: 'Example Company reports semiconductor revenue.', subjectRefs: ['entity:example-company'], primarySubjectRef: 'relation:exposure', sourceRefs: ['source:report'], temporal: { asOf: '2026-08-27T00:00:00.000Z', scope: { type: 'point', start: null, end: null, label: null } }, structuredValue: { metric: 'revenueShare', value: 0.4, unit: 'ratio', comparator: 'eq' }, provenance: [], lifecycle: { status: 'active' } })
  await put(root, 'modules/comparison.yaml', { id: 'module:comparison', type: 'comparison', targetEntity: 'entity:example-company', sourceRefs: ['source:report'], schemaId: null, columns: ['metric'], rows: [['revenueShare', 0.4]] })
  await put(root, 'taxonomy/catalog.yaml', { id: 'taxonomy:catalog', items: [{ id: 'taxonomy:hardware', name: 'Hardware' }] })
  await put(root, 'views/overview.yaml', { targetEntity: 'entity:example-company', displayText: 'entity:example-company is shown here' })
  const registry: Record<string, { type: string; storageRef: string }> = {
    'theme-group:technology': { type: 'theme_group', storageRef: 'theme-groups/technology.yaml' },
    'entity:ai-compute': { type: 'entity', storageRef: 'entities/theme.yaml' },
    'entity:semiconductor': { type: 'entity', storageRef: 'entities/industry.yaml' },
    'entity:example-company': { type: 'entity', storageRef: 'entities/company.yaml' },
    'source:report': { type: 'source', storageRef: 'sources/report.yaml' },
    'source:other': { type: 'source', storageRef: 'sources/other.yaml' },
    'relation:exposure': { type: 'relation', storageRef: 'relations/exposure.yaml' },
    'claim:revenue': { type: 'claim', storageRef: 'claims/revenue.yaml' },
    'module:comparison': { type: 'module', storageRef: 'modules/comparison.yaml' },
  }
  await put(root, 'registry/assets.yaml', registry); await put(root, 'registry/raw.yaml', {})
  const mounted = new KnowledgeBaseRegistry(); const handle = await mounted.mount(root)
  const raw = await archiveRaw(handle, { bytes: new TextEncoder().encode('validator raw bytes'), originalFilename: 'report.txt', mediaType: 'text/plain' })
  await put(root, 'manifest.yaml', { knowledgeBaseId: 'kb-v03-validator', name: 'v0.3 validator fixture', schemaVersion: '0.3', storageFormatVersion: '1', revision: 1, status: 'active', createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z' })
  const source = JSON.parse(await readFile(join(root, 'sources/report.yaml'), 'utf8')) as Record<string, unknown>; source.rawRefs = [raw.manifest.rawRef]; await writeFile(join(root, 'sources/report.yaml'), `${JSON.stringify(source)}\n`, 'utf8')
  const claim = JSON.parse(await readFile(join(root, 'claims/revenue.yaml'), 'utf8')) as Record<string, unknown>; claim.provenance = [{ sourceRef: 'source:report', rawRef: raw.manifest.rawRef, locator: null, chunkRef: null }]; await writeFile(join(root, 'claims/revenue.yaml'), `${JSON.stringify(claim)}\n`, 'utf8')
  return { root, rawRef: raw.manifest.rawRef }
}
async function report(root: string) { const registry = new KnowledgeBaseRegistry(); const handle = await registry.mount(root); return new KnowledgeValidationSkill({ loader: new KnowledgeBaseLoader({ registry }) }).validateKnowledgeBase(handle) }
async function mutate(root: string, path: string, change: (value: Record<string, unknown>) => void): Promise<void> { const file = join(root, path); const value = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>; change(value); await writeFile(file, `${JSON.stringify(value)}\n`, 'utf8') }

test('v0.3 validator accepts legal subtype fields, nested taxonomy ids, nested Claim structures, valid relations, and real Raw provenance', async () => {
  const { root } = await createV03(); try { const result = await report(root); assert.equal(result.status, 'passed', JSON.stringify(result.errors)) } finally { await rm(root, { recursive: true, force: true }) }
})

for (const label of ['FY2026', '长期', '2026E', null]) test(`v0.3 validator accepts temporal scope label ${String(label)}`, async () => {
  const { root } = await createV03(); try {
    await mutate(root, 'claims/revenue.yaml', (value) => { (value.temporal as Record<string, unknown>).scope = { type: 'period', start: '2026-01-01T00:00:00.000Z', end: '2026-12-31T23:59:59.000Z', label } })
    const result = await report(root)
    assert.equal(result.status, 'passed', JSON.stringify(result.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})

for (const ownershipPct of [null, 0, 1]) test(`v0.3 validator accepts ownershipPct ${String(ownershipPct)}`, async () => {
  const { root } = await createV03(); try {
    await mutate(root, 'relations/exposure.yaml', (value) => { value.type = 'owns_stake_in'; value.targetRef = 'entity:example-company'; value.attributes = { ownershipPct, controlType: 'minority' } })
    const result = await report(root)
    assert.equal(result.status, 'passed', JSON.stringify(result.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})

const invalidCases: Array<[string, string, (value: Record<string, unknown>) => void, string]> = [
  ['company investment-theme field', 'entities/company.yaml', (value) => { value.themeGroupRef = 'theme-group:technology' }, 'V03_UNDECLARED_FIELD'],
  ['entity unknown field', 'entities/company.yaml', (value) => { value.unknown = true }, 'V03_UNDECLARED_FIELD'],
  ['invalid entity type', 'entities/company.yaml', (value) => { value.type = 'segment' }, 'V03_ENUM_INVALID'],
  ['entity name type', 'entities/company.yaml', (value) => { value.name = 7 }, 'V03_FIELD_TYPE'],
  ['invalid entity namespace', 'entities/company.yaml', (value) => { value.id = 'company:wrong-namespace' }, 'V03_REGISTRY_INVALID'],
  ['investment theme missing group', 'entities/theme.yaml', (value) => { delete value.themeGroupRef }, 'V03_REQUIRED_FIELD_MISSING'],
  ['investment theme unresolved group', 'entities/theme.yaml', (value) => { value.themeGroupRef = 'theme-group:missing' }, 'V03_THEME_GROUP_REF_INVALID'],
  ['nested taxonomy missing', 'entities/theme.yaml', (value) => { value.taxonomyRefs = ['taxonomy:missing'] }, 'V03_TAXONOMY_REF_INVALID'],
  ['illegal relation type', 'relations/exposure.yaml', (value) => { value.type = 'contains' }, 'V03_ENUM_INVALID'],
  ['relation missing endpoint', 'relations/exposure.yaml', (value) => { delete value.sourceRef }, 'V03_REQUIRED_FIELD_MISSING'],
  ['relation endpoint kind', 'relations/exposure.yaml', (value) => { value.sourceRef = 'source:report' }, 'V03_RELATION_ENDPOINT_INVALID'],
  ['relation endpoint subtype', 'relations/exposure.yaml', (value) => { value.sourceRef = 'entity:semiconductor' }, 'V03_RELATION_SEMANTICS'],
  ['relation dangling context', 'relations/exposure.yaml', (value) => { value.contextRefs = ['entity:missing'] }, 'V03_CONTEXT_REF_INVALID'],
  ['relation supporting claim kind', 'relations/exposure.yaml', (value) => { value.supportingClaimRefs = ['source:report'] }, 'V03_CLAIM_REF_INVALID'],
  ['relation source ref kind', 'relations/exposure.yaml', (value) => { value.sourceRefs = ['entity:example-company'] }, 'V03_SOURCE_REF_INVALID'],
  ['theme exposure enum', 'relations/exposure.yaml', (value) => { value.type = 'theme_exposure'; value.sourceRef = 'entity:ai-compute'; (value.attributes as Record<string, unknown>).importance = 'invalid' }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['business exposure enum', 'relations/exposure.yaml', (value) => { (value.attributes as Record<string, unknown>).materiality = 'invalid' }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['financial contribution unknown child', 'relations/exposure.yaml', (value) => { (value.attributes as Record<string, unknown>).financialContribution = { unknown: true } }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['financial revenue share below range', 'relations/exposure.yaml', (value) => { (value.attributes as Record<string, unknown>).financialContribution = { revenueShare: -1 } }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['financial revenue share above range', 'relations/exposure.yaml', (value) => { (value.attributes as Record<string, unknown>).financialContribution = { revenueShare: 2 } }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['financial profit share below range', 'relations/exposure.yaml', (value) => { (value.attributes as Record<string, unknown>).financialContribution = { profitShare: -1 } }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['financial profit share above range', 'relations/exposure.yaml', (value) => { (value.attributes as Record<string, unknown>).financialContribution = { profitShare: 2 } }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['financial contribution child type', 'relations/exposure.yaml', (value) => { (value.attributes as Record<string, unknown>).financialContribution = { revenueAmount: '10' } }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['ownership percentage range', 'relations/exposure.yaml', (value) => { value.type = 'owns_stake_in'; value.targetRef = 'entity:example-company'; value.attributes = { ownershipPct: 2 } }, 'V03_NUMERIC_CONSTRAINT'],
  ['ownership percentage negative', 'relations/exposure.yaml', (value) => { value.type = 'owns_stake_in'; value.targetRef = 'entity:example-company'; value.attributes = { ownershipPct: -1 } }, 'V03_NUMERIC_CONSTRAINT'],
  ['ownership percentage NaN sentinel', 'relations/exposure.yaml', (value) => { value.type = 'owns_stake_in'; value.targetRef = 'entity:example-company'; value.attributes = { ownershipPct: 'NaN' } }, 'V03_NUMERIC_CONSTRAINT'],
  ['ownership percentage positive Infinity sentinel', 'relations/exposure.yaml', (value) => { value.type = 'owns_stake_in'; value.targetRef = 'entity:example-company'; value.attributes = { ownershipPct: 'Infinity' } }, 'V03_NUMERIC_CONSTRAINT'],
  ['ownership percentage negative Infinity sentinel', 'relations/exposure.yaml', (value) => { value.type = 'owns_stake_in'; value.targetRef = 'entity:example-company'; value.attributes = { ownershipPct: '-Infinity' } }, 'V03_NUMERIC_CONSTRAINT'],
  ['ownership control enum', 'relations/exposure.yaml', (value) => { value.type = 'owns_stake_in'; value.targetRef = 'entity:example-company'; value.attributes = { controlType: 'invalid' } }, 'V03_RELATION_ATTRIBUTE_INVALID'],
  ['claim temporal extra field', 'claims/revenue.yaml', (value) => { (value.temporal as Record<string, unknown>).extra = true }, 'V03_TEMPORAL_INVALID'],
  ['invalid claim type', 'claims/revenue.yaml', (value) => { value.claimType = 'unsupported' }, 'V03_ENUM_INVALID'],
  ['empty claim statement', 'claims/revenue.yaml', (value) => { value.statement = '' }, 'V03_REQUIRED_FIELD_MISSING'],
  ['claim subject source', 'claims/revenue.yaml', (value) => { value.subjectRefs = ['source:report'] }, 'V03_CLAIM_SUBJECT_INVALID'],
  ['claim dangling subject', 'claims/revenue.yaml', (value) => { value.subjectRefs = ['entity:missing'] }, 'V03_CLAIM_SUBJECT_INVALID'],
  ['claim primary subject source', 'claims/revenue.yaml', (value) => { value.primarySubjectRef = 'source:report' }, 'V03_CLAIM_SUBJECT_INVALID'],
  ['claim malformed temporal', 'claims/revenue.yaml', (value) => { (value.temporal as Record<string, unknown>).asOf = 'not-a-date' }, 'V03_TEMPORAL_INVALID'],
  ['claim temporal label number', 'claims/revenue.yaml', (value) => { ((value.temporal as Record<string, unknown>).scope as Record<string, unknown>).label = 123 }, 'V03_TEMPORAL_INVALID'],
  ['claim temporal label object', 'claims/revenue.yaml', (value) => { ((value.temporal as Record<string, unknown>).scope as Record<string, unknown>).label = {} }, 'V03_TEMPORAL_INVALID'],
  ['claim temporal label array', 'claims/revenue.yaml', (value) => { ((value.temporal as Record<string, unknown>).scope as Record<string, unknown>).label = [] }, 'V03_TEMPORAL_INVALID'],
  ['claim temporal start malformed', 'claims/revenue.yaml', (value) => { ((value.temporal as Record<string, unknown>).scope as Record<string, unknown>).start = 'not-a-date' }, 'V03_TEMPORAL_INVALID'],
  ['claim temporal end malformed', 'claims/revenue.yaml', (value) => { ((value.temporal as Record<string, unknown>).scope as Record<string, unknown>).end = 'not-a-date' }, 'V03_TEMPORAL_INVALID'],
  ['claim structured extra field', 'claims/revenue.yaml', (value) => { (value.structuredValue as Record<string, unknown>).extra = true }, 'V03_STRUCTURED_VALUE_INVALID'],
  ['claim structured malformed value', 'claims/revenue.yaml', (value) => { (value.structuredValue as Record<string, unknown>).value = { nested: true } }, 'V03_STRUCTURED_VALUE_INVALID'],
  ['claim provenance locator type', 'claims/revenue.yaml', (value) => { (value.provenance as Array<Record<string, unknown>>)[0]!.locator = 7 }, 'V03_PROVENANCE_INVALID'],
  ['claim provenance missing source', 'claims/revenue.yaml', (value) => { (value.provenance as Array<Record<string, unknown>>)[0]!.sourceRef = 'source:missing' }, 'V03_PROVENANCE_INVALID'],
  ['claim provenance missing raw', 'claims/revenue.yaml', (value) => { (value.provenance as Array<Record<string, unknown>>)[0]!.rawRef = 'raw-sha256-' + '0'.repeat(64) }, 'V03_PROVENANCE_INVALID'],
  ['claim provenance raw belongs to another source', 'claims/revenue.yaml', (value) => { (value.provenance as Array<Record<string, unknown>>)[0]!.sourceRef = 'source:other' }, 'V03_PROVENANCE_INVALID'],
  ['claim supersession wrong kind', 'claims/revenue.yaml', (value) => { value.supersedes = ['entity:example-company'] }, 'V03_CLAIM_REF_INVALID'],
  ['source type enum', 'sources/report.yaml', (value) => { value.sourceType = 'unsupported' }, 'V03_ENUM_INVALID'],
  ['source reliability enum', 'sources/report.yaml', (value) => { value.sourceReliability = 'unsupported' }, 'V03_ENUM_INVALID'],
  ['source title type', 'sources/report.yaml', (value) => { value.title = 9 }, 'V03_FIELD_TYPE'],
  ['source wrong raw format', 'sources/report.yaml', (value) => { value.rawRefs = ['raw:legacy'] }, 'V03_RAW_REF_MISSING'],
  ['module missing target entity', 'modules/comparison.yaml', (value) => { value.targetEntity = 'relation:exposure' }, 'V03_MODULE_TARGET_INVALID'],
  ['module schema id type', 'modules/comparison.yaml', (value) => { value.schemaId = 9 }, 'V03_FIELD_TYPE'],
  ['module source ref kind', 'modules/comparison.yaml', (value) => { value.sourceRefs = ['entity:example-company'] }, 'V03_SOURCE_REF_INVALID'],
  ['module columns container', 'modules/comparison.yaml', (value) => { value.columns = 'metric' }, 'V03_FIELD_TYPE'],
  ['module rows container', 'modules/comparison.yaml', (value) => { value.rows = { not: 'an array' } }, 'V03_FIELD_TYPE'],
  ['module targetRefs forbidden', 'modules/comparison.yaml', (value) => { value.targetRefs = ['entity:example-company'] }, 'V03_UNDECLARED_FIELD'],
  ['view relation target forbidden', 'views/overview.yaml', (value) => { value.targetEntity = 'relation:exposure' }, 'V03_VIEW_REF_INVALID'],
]
for (const [name, path, change, code] of invalidCases) test(`v0.3 validator rejects ${name}`, async () => {
  const { root } = await createV03(); try { await mutate(root, path, change); const result = await report(root); assert.equal(result.status, 'failed'); assert.equal(result.errors.some((error) => error.code === code), true, JSON.stringify(result.errors)) } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 validator rejects missing physical Raw even when registry/raw.yaml has an entry', async () => {
  const { root, rawRef } = await createV03(); try { await mutate(root, 'registry/raw.yaml', (value) => { value[rawRef] = { contentHash: 'sha256:bad', storageRef: 'raw/missing.bin' } }); const result = await report(root); assert.equal(result.status, 'failed'); assert.equal(result.errors.some((error) => error.code === 'V03_RAW_INTEGRITY_ERROR'), true, JSON.stringify(result.errors)) } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 validator rejects a missing Raw registry entry', async () => {
  const { root, rawRef } = await createV03(); try {
    await mutate(root, 'registry/raw.yaml', (value) => { delete value[rawRef] })
    const result = await report(root)
    assert.equal(result.status, 'failed')
    assert.equal(result.errors.some((error) => error.code === 'V03_RAW_REF_MISSING' || error.code === 'V03_PROVENANCE_INVALID'), true, JSON.stringify(result.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 validator rejects Raw manifest/hash mismatch through verifyRaw', async () => {
  const { root, rawRef } = await createV03(); try {
    await put(root, `raw/${rawRef}/manifest.yaml`, { rawRef, originalFilename: 'report.txt', mediaType: 'text/plain', contentHash: 'sha256:' + '0'.repeat(64), sizeBytes: 18, receivedAt: '2026-08-27T00:00:00.000Z', suppliedMetadata: { title: null, institution: null, author: null, publishedAt: null, sourceUrl: null } })
    const result = await report(root)
    assert.equal(result.status, 'failed')
    assert.equal(result.errors.some((error) => error.code === 'V03_RAW_INTEGRITY_ERROR'), true, JSON.stringify(result.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 validator resolves nested taxonomy graphRefs and rejects dangling nested graphRefs', async () => {
  const { root } = await createV03(); try {
    await mutate(root, 'taxonomy/catalog.yaml', (value) => { (value.items as Array<Record<string, unknown>>)[0]!.graphRefs = ['entity:example-company'] })
    assert.equal((await report(root)).status, 'passed')
    await mutate(root, 'taxonomy/catalog.yaml', (value) => { (value.items as Array<Record<string, unknown>>)[0]!.graphRefs = ['entity:missing'] })
    const result = await report(root)
    assert.equal(result.status, 'failed')
    assert.equal(result.errors.some((error) => error.code === 'V03_AUXILIARY_REF_INVALID'), true, JSON.stringify(result.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 validator ignores opaque View strings but validates nested View references', async () => {
  const { root } = await createV03(); try {
    await mutate(root, 'views/overview.yaml', (value) => { value.template = 'relation:exposure is display text'; value.config = { targetEntity: 'entity:example-company', graphRefs: ['relation:exposure'] } })
    assert.equal((await report(root)).status, 'passed')
    await mutate(root, 'views/overview.yaml', (value) => { (value.config as Record<string, unknown>).targetEntity = 'relation:exposure' })
    const result = await report(root)
    assert.equal(result.status, 'failed')
    assert.equal(result.errors.some((error) => error.code === 'V03_VIEW_REF_INVALID'), true, JSON.stringify(result.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 validator enforces ThemeGroup field types and active business exposure cardinality', async () => {
  const { root } = await createV03(); try {
    await mutate(root, 'theme-groups/technology.yaml', (value) => { value.sortOrder = 'first' })
    let result = await report(root)
    assert.equal(result.status, 'failed')
    assert.equal(result.errors.some((error) => error.code === 'V03_FIELD_TYPE'), true, JSON.stringify(result.errors))
    await mutate(root, 'theme-groups/technology.yaml', (value) => { value.sortOrder = 1 })
    await put(root, 'relations/exposure-duplicate.yaml', { id: 'relation:exposure-duplicate', type: 'business_exposure', sourceRef: 'entity:example-company', targetRef: 'entity:semiconductor', lifecycle: { status: 'active' } })
    await mutate(root, 'registry/assets.yaml', (value) => { value['relation:exposure-duplicate'] = { type: 'relation', storageRef: 'relations/exposure-duplicate.yaml' } })
    result = await report(root)
    assert.equal(result.status, 'failed')
    assert.equal(result.errors.some((error) => error.code === 'V03_RELATION_CARDINALITY'), true, JSON.stringify(result.errors))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('v0.3 orphan detection rejects canonical-looking files left outside the registry', async () => {
  const { root } = await createV03(); try { await put(root, 'entities/orphan.yaml', { id: 'entity:orphan', type: 'company', name: 'Orphan', lifecycle: { status: 'active' } }); const result = await report(root); assert.equal(result.status, 'failed'); assert.equal(result.errors.some((error) => error.code === 'V03_ORPHAN_CANONICAL_ASSET'), true) } finally { await rm(root, { recursive: true, force: true }) }
})
