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
