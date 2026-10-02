import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import { RawDocumentKnowledgeGatewayV04 } from '../../../knowledge/production/raw-document-gateway-v04.ts'
import type { KnowledgeProductionInput } from '../../../knowledge/production/contracts.ts'
import type { SourceRefV04 } from '../../../knowledge/schema/domain-v04.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-gateway-root-fields-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-root-fields-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function mount(root: string) { return new KnowledgeBaseRegistry().mount(root) }

async function persistDocumentEvidence(root: string) {
  const result = await new RawDocumentKnowledgeGatewayV04({ clock }).submit({
    handle: await mount(root), workflowRunId: 'root-fields-source-001',
    bytes: Buffer.from('%PDF-1.7\nroot entity field evidence\n%%EOF\n'), filename: 'entity-research.pdf', mediaType: 'application/pdf',
    source: { title: 'Entity Research', sourceType: 'sell_side_research', sourceReliability: 'high', publisher: 'Example Research', institution: 'Example Research', publishedAt: NOW },
    rights: { accessScope: 'authenticated', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'User provided this document for personal research.' },
  })
  assert.equal(result.status, 'committed', result.errors.map((error) => error.message).join('; '))
  assert.ok(result.sourceRef)
  assert.ok(result.rawRef)
  return { sourceRef: result.sourceRef as SourceRefV04, rawRef: result.rawRef as `raw-sha256-${string}` }
}

function input(root: string, rootEntity: KnowledgeProductionInput['entity'], proposals: KnowledgeProductionInput['proposals'], producerRunId = 'root-fields-write-001'): Promise<KnowledgeProductionInput> {
  return mount(root).then((handle) => ({
    handle, producerType: 'raw_document_knowledge_ingestion', producerRunId,
    schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
    entity: rootEntity, proposals, evidenceBindings: [], now: clock,
  }))
}

test('Gateway persists evidence-backed root Company description and legalName through isolated Schema 0.4 storage', async () => {
  await withFreshKb('company', async (root) => {
    const evidence = await persistDocumentEvidence(root)
    const localKey = 'root-company'
    const proposal = {
      proposalId: 'root-company-proposal', kind: 'entity' as const, subjectKey: localKey,
      entityType: 'company' as const, entityName: 'Alpha Systems',
      structuredValue: { description: 'A specialist semiconductor manufacturer.', legalName: 'Alpha Systems Holdings Co., Ltd.' },
      existingEvidenceBindings: [{ ...evidence, locator: 'block-0004' }],
    }
    const rootEntity = { localKey, entityType: 'company' as const, name: 'Alpha Systems', aliases: ['Alpha'], semanticFields: { ticker: '600001', exchange: 'SSE' } }
    const gateway = new KnowledgeProductionGateway()
    const created = await gateway.submit(await input(root, rootEntity, []))
    assert.equal(created.status, 'committed', created.errors.join('; '))
    const submitted = await gateway.submit(await input(root, rootEntity, [proposal], 'root-fields-write-002'))

    assert.equal(submitted.status, 'committed', submitted.errors.join('; '))
    assert.ok(submitted.updatedIds.some((id) => id.startsWith('entity:')))
    const assets = await readCanonicalV04Assets(root)
    const company = assets.objects.map((item) => item.value as unknown as Record<string, unknown>).find((item) => item.type === 'company')
    assert.equal(company?.name, 'Alpha Systems')
    assert.equal(company?.description, 'A specialist semiconductor manufacturer.')
    assert.equal(company?.legalName, 'Alpha Systems Holdings Co., Ltd.')
    assert.deepEqual(company?.aliases, ['Alpha'])
  })
})

test('Gateway permits evidence-backed root Industry description but rejects Company-only legalName semantics', async () => {
  await withFreshKb('industry', async (root) => {
    const evidence = await persistDocumentEvidence(root)
    const localKey = 'root-industry'
    const submitted = await new KnowledgeProductionGateway().submit(await input(root, {
      localKey, entityType: 'industry', name: 'AI Computing', semanticFields: { description: 'Unapproved description must not bypass the proposal.' },
    }, [{
      proposalId: 'root-industry-proposal', kind: 'entity', subjectKey: localKey,
      entityType: 'industry', entityName: 'AI Computing',
      structuredValue: { description: 'Semiconductor and infrastructure activities serving AI workloads.', legalName: 'Not valid for an Industry.' },
      existingEvidenceBindings: [{ ...evidence, locator: 'block-0005' }],
    }]))

    assert.equal(submitted.status, 'committed', submitted.errors.join('; '))
    assert.ok(submitted.resolutionIntents.some((item) => item.disposition === 'review_required' && item.reason.includes('legalName is supported only for Company')))
    const industry = (await readCanonicalV04Assets(root)).objects.map((item) => item.value as unknown as Record<string, unknown>).find((item) => item.type === 'industry')
    assert.equal(industry?.description, 'Semiconductor and infrastructure activities serving AI workloads.')
    assert.equal('legalName' in (industry ?? {}), false)
  })
})

test('root description and legalName keep prior behavior when there is no evidence-backed matching Entity proposal', async () => {
  await withFreshKb('without-evidence', async (root) => {
    const localKey = 'root-company'
    const submitted = await new KnowledgeProductionGateway().submit(await input(root, {
      localKey, entityType: 'company', name: 'Alpha Systems', semanticFields: { ticker: '600001', exchange: 'SSE', description: 'Unverified input description', legalName: 'Unverified input legal name' },
    }, [{
      proposalId: 'root-company-proposal', kind: 'entity', subjectKey: localKey,
      entityType: 'company', entityName: 'Alpha Systems',
      structuredValue: { description: 'Proposal description without source proof.', legalName: 'Proposal legal name without source proof.' },
    }]))

    assert.equal(submitted.status, 'committed', submitted.errors.join('; '))
    const company = (await readCanonicalV04Assets(root)).objects.map((item) => item.value as unknown as Record<string, unknown>).find((item) => item.type === 'company')
    assert.equal(company?.ticker, '600001')
    assert.equal(company?.exchange, 'SH')
    assert.equal('description' in (company ?? {}), false)
    assert.equal('legalName' in (company ?? {}), false)
  })
})

test('non-root Companies bind and allocate by normalized ticker plus exchange, and merge evidence-backed aliases and descriptions safely', async () => {
  await withFreshKb('non-root-company-identity', async (root) => {
    const gateway = new KnowledgeProductionGateway()
    const seedRoot = { localKey: 'seed-root-company', entityType: 'company' as const, name: 'Root Company', semanticFields: { ticker: '600000', exchange: 'SH' } }
    const seeded = await gateway.submit(await input(root, seedRoot, [
      {
        proposalId: 'company-a-seed', kind: 'entity', subjectKey: 'company-a', entityType: 'company', entityName: 'Company Alpha',
        structuredValue: { ticker: '600001', exchange: 'SSE', aliases: ['Alpha Seed Alias'] },
      },
      {
        proposalId: 'company-b-seed', kind: 'entity', subjectKey: 'company-b', entityType: 'company', entityName: 'Company Beta',
        structuredValue: { ticker: '000002', exchange: 'SZSE', aliases: ['Beta Seed Alias'] },
      },
    ], 'non-root-company-seed'))

    assert.equal(seeded.status, 'committed', seeded.errors.join('; '))
    const companyARef = seeded.entityRefsByLocalKey['company-a']
    const companyBRef = seeded.entityRefsByLocalKey['company-b']
    assert.ok(companyARef)
    assert.ok(companyBRef)
    assert.notEqual(companyARef, companyBRef, 'different ticker/exchange pairs must allocate distinct Company IDs, independent of the root ticker')
    assert.notEqual(companyARef, seeded.entityRefsByLocalKey['seed-root-company'])
    assert.notEqual(companyBRef, seeded.entityRefsByLocalKey['seed-root-company'])

    const evidence = await persistDocumentEvidence(root)
    const rootCompanyB = {
      localKey: 'root-company-b', entityType: 'company' as const, name: 'Company Beta', aliases: ['Beta Root Alias'],
      semanticFields: { ticker: '000002', exchange: 'SZSE' },
    }
    const variant = await gateway.submit(await input(root, rootCompanyB, [{
      proposalId: 'company-a-variant', kind: 'entity', subjectKey: 'company-a-variant', entityType: 'company', entityName: 'Company Alpha Group',
      structuredValue: { ticker: '600001', exchange: 'SH', aliases: ['Alpha New Alias'], description: 'Evidence-backed profile for Company A.' },
      existingEvidenceBindings: [{ ...evidence, locator: 'company-a-profile-block' }],
    }], 'non-root-company-variant'))

    assert.equal(variant.status, 'committed', variant.errors.join('; '))
    assert.equal(variant.entityRefsByLocalKey['company-a-variant'], companyARef, 'normalized exchange and ticker must bind despite a name variant')
    let assets = await readCanonicalV04Assets(root)
    let companyA = assets.objects.find((item) => item.value.id === companyARef)?.value as unknown as Record<string, unknown>
    assert.equal(companyA?.description, 'Evidence-backed profile for Company A.')
    assert.deepEqual(companyA?.aliases, ['Alpha New Alias', 'Alpha Seed Alias', 'Company Alpha Group'])
    assert.equal(companyA?.exchange, 'SH')

    const unverifiedUpdate = await gateway.submit(await input(root, rootCompanyB, [{
      proposalId: 'company-a-unverified-supplement', kind: 'entity', subjectKey: 'company-a-unverified-supplement', entityType: 'company', entityName: 'Company Alpha Unverified',
      structuredValue: { ticker: '600001', exchange: 'SSE', aliases: ['Unverified Alias'], description: 'Unverified description must not be applied.' },
    }], 'non-root-company-unverified-supplement'))

    assert.equal(unverifiedUpdate.entityRefsByLocalKey['company-a-unverified-supplement'], companyARef)
    assert.ok(unverifiedUpdate.resolutionIntents.some((item) => item.disposition === 'review_required' && item.reason.includes('require validated Source/Raw evidence')))
    assets = await readCanonicalV04Assets(root)
    companyA = assets.objects.find((item) => item.value.id === companyARef)?.value as unknown as Record<string, unknown>
    assert.equal(companyA?.description, 'Evidence-backed profile for Company A.')
    assert.equal((companyA?.aliases as string[]).includes('Unverified Alias'), false)
    assert.equal((companyA?.aliases as string[]).includes('Company Alpha Unverified'), false)

    const resolverCalls: string[] = []
    const conflictGateway = new KnowledgeProductionGateway(undefined, async ({ proposal }) => {
      resolverCalls.push(proposal.proposalId)
      return { outcome: 'equivalent', reason: 'This resolver must not decide Company hard-key conflicts.' }
    })
    const conflict = await conflictGateway.submit(await input(root, rootCompanyB, [
      {
        proposalId: 'company-conflicting-hard-key', kind: 'entity', subjectKey: 'company-conflict', entityType: 'company', entityName: 'Company Alpha',
        structuredValue: { ticker: '600009', exchange: 'SSE' },
      },
      {
        proposalId: 'company-missing-hard-key', kind: 'entity', subjectKey: 'company-missing', entityType: 'company', entityName: 'Unidentified Components',
        structuredValue: { ticker: '688001' },
      },
    ], 'non-root-company-conflict'))

    assert.ok(['committed', 'no_changes'].includes(conflict.status), conflict.errors.join('; '))
    assert.equal(conflict.entityRefsByLocalKey['company-conflict'], undefined)
    assert.equal(conflict.entityRefsByLocalKey['company-missing'], undefined)
    assert.ok(conflict.resolutionIntents.some((item) => item.disposition === 'review_required' && item.localKey === 'company-conflict' && item.reason.includes('different hard identity')))
    assert.ok(conflict.resolutionIntents.some((item) => item.disposition === 'review_required' && item.localKey === 'company-missing' && item.reason.includes('ticker and exchange')))
    assert.deepEqual(resolverCalls, [], 'a name resolver must not equate a non-root Company across a hard-key conflict')

    const descriptionConflict = await gateway.submit(await input(root, rootCompanyB, [{
      proposalId: 'company-a-description-conflict', kind: 'entity', subjectKey: 'company-a-description-conflict', entityType: 'company', entityName: 'Company Alpha Alternative',
      structuredValue: { ticker: '600001', exchange: 'SSE', aliases: ['Alias Added Despite Description Conflict'], description: 'Conflicting alternate description.' },
      existingEvidenceBindings: [{ ...evidence, locator: 'company-a-conflicting-profile-block' }],
    }], 'non-root-company-description-conflict'))

    assert.equal(descriptionConflict.status, 'committed', descriptionConflict.errors.join('; '))
    assert.equal(descriptionConflict.entityRefsByLocalKey['company-a-description-conflict'], companyARef)
    assert.ok(descriptionConflict.resolutionIntents.some((item) => item.disposition === 'review_required' && item.reason.includes('description conflicts')))
    assets = await readCanonicalV04Assets(root)
    companyA = assets.objects.find((item) => item.value.id === companyARef)?.value as unknown as Record<string, unknown>
    assert.equal(companyA?.description, 'Evidence-backed profile for Company A.', 'conflicting description must not overwrite the canonical value')
    assert.ok((companyA?.aliases as string[]).includes('Alias Added Despite Description Conflict'))
    assert.ok((companyA?.aliases as string[]).includes('Company Alpha Alternative'))
    assert.equal(assets.objects.filter((item) => (item.value as unknown as Record<string, unknown>).type === 'company').length, 3)
  })
})
