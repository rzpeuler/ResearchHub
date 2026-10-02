import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveRaw } from '../../../knowledge/raw/raw-archive.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import type { KnowledgeChangeSetV04 } from '../../../knowledge/schema/mutation-v04.ts'
import type { KnowledgeSourceV04 } from '../../../knowledge/schema/domain-v04.ts'
import { createFreshKnowledgeBaseV04, loadKnowledgeBaseManifest, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { validateKnowledgeChangeSetV04 } from '../../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../../../knowledge/writer/writer.ts'
import { ThemeFrameworkAcceptanceV04 } from '../../../knowledge/production/theme-framework-acceptance-v04.ts'
import type { ThemeFrameworkDecision, ThemeFrameworkDurableEvidenceBinding } from '../../../workflows/theme-framework-construction/contracts.ts'
import type { ThemeFrameworkResult } from '../../../skills/theme-framework/contracts.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-theme-framework-acceptance-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-theme-framework-acceptance-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function mount(root: string, registry = new KnowledgeBaseRegistry()) {
  return { registry, handle: await registry.mount(root) }
}

async function seedEvidence(root: string): Promise<ThemeFrameworkDurableEvidenceBinding> {
  const { handle, registry } = await mount(root)
  const raw = await archiveRaw(handle, { bytes: Buffer.from('Evidence for the accepted Theme Framework fixture.'), originalFilename: 'theme-evidence.txt', mediaType: 'text/plain' }, { clock })
  const source: KnowledgeSourceV04 = {
    id: 'source:theme-framework-acceptance-evidence',
    title: 'Theme Framework acceptance evidence',
    sourceType: 'official_disclosure',
    provider: 'test-fixture',
    canonicalUrl: 'https://example.test/theme-framework-evidence',
    retrievedAt: NOW,
    contentHash: raw.manifest.contentHash.slice('sha256:'.length),
    rawRefs: [raw.manifest.rawRef as `raw-sha256-${string}`],
    rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
    usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false },
    lifecycle: { status: 'active' },
  }
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: 'changeset-theme-framework-seed-evidence',
    workflowRunId: 'theme-framework-seed-evidence',
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations: [{ operationId: 'create-theme-framework-evidence-source', type: 'create', object: source }],
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  const result = await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry, clock })
  assert.equal(result.status, 'committed', result.error?.message)
  return { evidenceId: 'evidence-1', sourceRef: source.id, rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, locator: 'page 1, paragraph 1' }
}

function candidate(input: {
  candidateId: string
  semanticFingerprint: string
  name: string
  recommendation: 'include' | 'exclude' | 'pending'
  evidenceRefs?: readonly string[]
  coverageGaps?: readonly string[]
}): ThemeFrameworkResult['industryCandidates'][number] {
  return {
    candidateId: input.candidateId,
    semanticFingerprint: input.semanticFingerprint,
    name: input.name,
    description: `${input.name} activity`,
    independentlyResearchableRationale: 'A distinct activity that can be researched independently.',
    themeRelevanceRationale: 'Material to the accepted investment theme.',
    boundaryRationale: `Reviewed boundary for ${input.name}.`,
    recommendation: input.recommendation,
    decisionChange: 'new',
    evidenceRefs: input.evidenceRefs ?? [],
    coverageGaps: input.coverageGaps ?? [],
  }
}

function framework(evidenceId: string): ThemeFrameworkResult {
  return {
    proposedDefinition: { statement: 'A bounded AI compute supply-chain theme.', status: 'supported', evidenceRefs: [evidenceId] },
    inclusionPrinciples: ['Include distinct, researchable AI compute supply-chain activities.'],
    exclusionPrinciples: ['Exclude unrelated end markets.'],
    industryCandidates: [
      candidate({ candidateId: 'industry-upstream', semanticFingerprint: 'industry-name:upstream', name: 'Advanced Packaging Materials', recommendation: 'include', evidenceRefs: [evidenceId] }),
      candidate({ candidateId: 'industry-downstream', semanticFingerprint: 'industry-name:downstream', name: 'AI Accelerator Manufacturing', recommendation: 'include', evidenceRefs: [evidenceId] }),
      candidate({ candidateId: 'industry-pending', semanticFingerprint: 'industry-name:pending', name: 'Liquid Cooling Services', recommendation: 'pending', coverageGaps: ['Need a durable source establishing current commercial scale.'] }),
    ],
    relationCandidates: [{
      candidateId: 'relation-upstream-downstream',
      semanticFingerprint: 'relation:upstream-downstream',
      sourceIndustryRef: 'industry-upstream',
      targetIndustryRef: 'industry-downstream',
      relationType: 'upstream_of',
      topologyRole: 'main_chain',
      directionRationale: 'Packaging materials are an upstream input to accelerator manufacturing.',
      themeRelevanceRationale: 'This relationship affects supply availability.',
      boundaryRationale: 'The directed relation is supported by the cited source.',
      recommendation: 'include',
      decisionChange: 'new',
      evidenceRefs: [evidenceId],
      coverageGaps: [],
    }],
    coverageGaps: [],
  }
}

function reviewedDecisions(result: ThemeFrameworkResult, binding: ThemeFrameworkDurableEvidenceBinding): ThemeFrameworkDecision[] {
  return [
    ...result.industryCandidates.map((item): ThemeFrameworkDecision => ({
      candidateId: item.candidateId,
      kind: 'industry',
      decision: item.recommendation,
      rationale: item.boundaryRationale,
      evidenceRefs: item.evidenceRefs,
      evidenceBindings: item.evidenceRefs.map((evidenceId) => ({ ...binding, evidenceId })),
      coverageGaps: item.coverageGaps,
    })),
    ...result.relationCandidates.map((item): ThemeFrameworkDecision => ({
      candidateId: item.candidateId,
      kind: 'relation',
      decision: item.recommendation,
      rationale: item.boundaryRationale,
      evidenceRefs: item.evidenceRefs,
      evidenceBindings: item.evidenceRefs.map((evidenceId) => ({ ...binding, evidenceId })),
      coverageGaps: item.coverageGaps,
    })),
  ]
}

test('acceptance writes Theme, multiple Industries, global Relation, exposures, and every scope decision in one Writer revision', async () => {
  await withFreshKb('multi-node-commit', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const mounted = await registry.mount(root)
    const binding = await seedEvidence(root)
    const startRevision = (await loadKnowledgeBaseManifest(root)).revision
    const resultFramework = framework(binding.evidenceId)
    const result = await new ThemeFrameworkAcceptanceV04({ registry, clock }).commitThemeFrameworkAtomically({
      workflowRunId: 'theme-framework-acceptance-run',
      knowledgeBaseId: mounted.knowledgeBaseId,
      expectedBaseRevision: startRevision,
      theme: { name: 'AI Compute Supply Chain' },
      framework: resultFramework,
      decisions: reviewedDecisions(resultFramework, binding),
    })
    assert.equal(result.status, 'committed', result.errors?.join('; '))
    assert.ok(result.themeRef)
    assert.equal(result.committedRevision, startRevision + 1)

    const reloaded = await readCanonicalV04Assets(root)
    const objects = reloaded.objects.map((item) => item.value)
    const industries = objects.filter((object) => object.id.startsWith('entity:') && (object as { type?: string }).type === 'industry')
    const globalRelations = objects.filter((object) => object.id.startsWith('relation:') && ['upstream_of', 'depends_on'].includes((object as { type?: string }).type ?? ''))
    const exposures = objects.filter((object) => object.id.startsWith('relation:') && (object as { type?: string }).type === 'theme_exposure' && (object as { sourceRef?: string }).sourceRef === result.themeRef)
    assert.equal(industries.length, 2)
    assert.equal(globalRelations.length, 1)
    assert.equal(exposures.length, 2)
    assert.equal(objects.some((object) => object.id.startsWith('entity:') && (object as { name?: string }).name === 'Liquid Cooling Services'), false)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, startRevision + 1)
    assert.ok(objects.some((object) => object.id === result.themeRef && (object as { type?: string }).type === 'investment_theme'))
    assert.ok(reloaded.objects.some((item) => item.value.id === 'theme-group:default'))

    const retry = await new ThemeFrameworkAcceptanceV04({ registry, clock }).commitThemeFrameworkAtomically({
      workflowRunId: 'theme-framework-acceptance-run',
      knowledgeBaseId: mounted.knowledgeBaseId,
      expectedBaseRevision: startRevision,
      theme: { name: 'AI Compute Supply Chain' },
      framework: resultFramework,
      decisions: reviewedDecisions(resultFramework, binding),
    })
    assert.equal(retry.status, 'already_committed')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, startRevision + 1)

    const changedDecision = reviewedDecisions(resultFramework, binding).map((decision) => decision.candidateId === 'industry-pending' ? { ...decision, decision: 'exclude' as const } : decision)
    const conflictingRetry = await new ThemeFrameworkAcceptanceV04({ registry, clock }).commitThemeFrameworkAtomically({
      workflowRunId: 'theme-framework-acceptance-run',
      knowledgeBaseId: mounted.knowledgeBaseId,
      expectedBaseRevision: startRevision,
      theme: { name: 'AI Compute Supply Chain' },
      framework: resultFramework,
      decisions: changedDecision,
    })
    assert.equal(conflictingRetry.status, 'conflict')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, startRevision + 1)
  })
})

test('first acceptance with no includes commits Theme and pending/exclude decisions without creating an Industry', async () => {
  await withFreshKb('no-includes', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const resultFramework = {
      proposedDefinition: { statement: 'A bounded theme with no confirmed members yet.', status: 'provisional' as const, evidenceRefs: [] },
      inclusionPrinciples: ['Include only evidence-backed members.'],
      exclusionPrinciples: ['Exclude outside activities.'],
      industryCandidates: [
        candidate({ candidateId: 'industry-excluded', semanticFingerprint: 'industry-name:excluded', name: 'Unrelated Devices', recommendation: 'exclude' }),
        candidate({ candidateId: 'industry-pending', semanticFingerprint: 'industry-name:pending', name: 'Unverified Services', recommendation: 'pending', coverageGaps: ['Evidence is not yet durable.'] }),
      ],
      relationCandidates: [],
      coverageGaps: [],
    }
    const decisions: ThemeFrameworkDecision[] = resultFramework.industryCandidates.map((item) => ({
      candidateId: item.candidateId,
      kind: 'industry',
      decision: item.recommendation,
      rationale: item.boundaryRationale,
      evidenceRefs: [],
      evidenceBindings: [],
      coverageGaps: item.coverageGaps,
    }))
    const result = await new ThemeFrameworkAcceptanceV04({ registry, clock }).commitThemeFrameworkAtomically({
      workflowRunId: 'theme-framework-no-includes-run',
      knowledgeBaseId: handle.knowledgeBaseId,
      expectedBaseRevision: handle.revision,
      theme: { name: 'Unconfirmed Theme' },
      framework: resultFramework,
      decisions,
    })
    assert.equal(result.status, 'committed', result.errors?.join('; '))
    const assets = await readCanonicalV04Assets(root)
    const objects = assets.objects.map((item) => item.value)
    assert.ok(objects.some((object) => object.id === result.themeRef && (object as { type?: string }).type === 'investment_theme'))
    assert.equal(objects.filter((object) => object.id.startsWith('entity:') && (object as { type?: string }).type === 'industry').length, 0)
    assert.equal(objects.filter((object) => object.id.startsWith('relation:') && (object as { type?: string }).type === 'theme_exposure').length, 0)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})

test('stale accepted revisions conflict before committing Theme or canonical candidates', async () => {
  await withFreshKb('stale-revision', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const staleHandle = await registry.mount(root)
    const binding = await seedEvidence(root)
    const staleRevision = (await loadKnowledgeBaseManifest(root)).revision
    const otherHandle = await new KnowledgeBaseRegistry().mount(root)
    const extraIndustry = { id: 'entity:unrelated-revision-change' as `entity:${string}`, type: 'industry' as const, name: 'Unrelated Revision Change', lifecycle: { status: 'active' as const } }
    const changeSet: KnowledgeChangeSetV04 = {
      changeSetId: 'changeset-theme-framework-unrelated-update',
      workflowRunId: 'theme-framework-unrelated-update',
      knowledgeBaseId: otherHandle.knowledgeBaseId,
      schemaVersion: '0.4',
      storageFormatVersion: '1',
      expectedBaseRevision: otherHandle.revision,
      operations: [{ operationId: 'create-unrelated-industry', type: 'create', object: extraIndustry }],
    }
    const validation = await validateKnowledgeChangeSetV04(otherHandle, changeSet, { mode: 'commit', now: clock })
    assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
    const written = await writeKnowledgeBase(otherHandle, validation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock })
    assert.equal(written.status, 'committed', written.error?.message)
    const resultFramework = {
      ...framework(binding.evidenceId),
      industryCandidates: [candidate({ candidateId: 'industry-only', semanticFingerprint: 'industry-name:only', name: 'Accelerator Subsystems', recommendation: 'include', evidenceRefs: [binding.evidenceId] })],
      relationCandidates: [],
    }
    const result = await new ThemeFrameworkAcceptanceV04({ registry, clock }).commitThemeFrameworkAtomically({
      workflowRunId: 'theme-framework-stale-run',
      knowledgeBaseId: staleHandle.knowledgeBaseId,
      expectedBaseRevision: staleRevision,
      theme: { name: 'Stale Framework' },
      framework: resultFramework,
      decisions: reviewedDecisions(resultFramework, binding),
    })
    assert.equal(result.status, 'conflict')
    assert.ok(result.errors?.some((message) => message.includes('revision changed')))
    const objects = (await readCanonicalV04Assets(root)).objects.map((item) => item.value)
    assert.equal(objects.some((object) => (object as { type?: string }).type === 'investment_theme'), false)
    assert.equal(objects.some((object) => (object as { name?: string }).name === 'Accelerator Subsystems'), false)
  })
})

test('failed A2 resolution and invalid Source/Raw evidence leave no half-created Theme or Industry', async () => {
  await withFreshKb('failed-resolution', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const handle = await registry.mount(root)
    const binding = await seedEvidence(root)
    const baseFramework = framework(binding.evidenceId)
    const failedFramework: ThemeFrameworkResult = {
      ...baseFramework,
      industryCandidates: [
        { ...baseFramework.industryCandidates.find((item) => item.candidateId === 'industry-upstream')!, existingIndustryRef: 'entity:missing-explicit-industry' },
        baseFramework.industryCandidates.find((item) => item.candidateId === 'industry-downstream')!,
      ],
      relationCandidates: [],
    }
    const failed = await new ThemeFrameworkAcceptanceV04({ registry, clock }).commitThemeFrameworkAtomically({
      workflowRunId: 'theme-framework-resolution-failure',
      knowledgeBaseId: handle.knowledgeBaseId,
      expectedBaseRevision: (await loadKnowledgeBaseManifest(root)).revision,
      theme: { name: 'No Partial Resolution' },
      framework: failedFramework,
      decisions: reviewedDecisions(failedFramework, binding),
    })
    assert.equal(failed.status, 'blocked')
    assert.ok(failed.errors?.some((message) => message.includes('explicit canonical Industry identity')))
    let objects = (await readCanonicalV04Assets(root)).objects.map((item) => item.value)
    assert.equal(objects.some((object) => (object as { type?: string }).type === 'investment_theme'), false)
    assert.equal(objects.some((object) => (object as { type?: string }).type === 'industry'), false)

    const oneIndustry: ThemeFrameworkResult = {
      ...baseFramework,
      industryCandidates: [baseFramework.industryCandidates.find((item) => item.candidateId === 'industry-upstream')!],
      relationCandidates: [],
    }
    const invalidBinding = { ...binding, rawRef: `raw-sha256-${'f'.repeat(64)}` as `raw-sha256-${string}` }
    const invalidDecision = reviewedDecisions(oneIndustry, binding).map((decision) => ({
      ...decision,
      evidenceBindings: decision.evidenceBindings.map((item) => ({ ...item, rawRef: invalidBinding.rawRef })),
    }))
    const invalid = await new ThemeFrameworkAcceptanceV04({ registry, clock }).commitThemeFrameworkAtomically({
      workflowRunId: 'theme-framework-invalid-evidence',
      knowledgeBaseId: handle.knowledgeBaseId,
      expectedBaseRevision: (await loadKnowledgeBaseManifest(root)).revision,
      theme: { name: 'No Invalid Evidence' },
      framework: oneIndustry,
      decisions: invalidDecision,
    })
    assert.equal(invalid.status, 'blocked')
    assert.ok(invalid.errors?.some((message) => message.includes('unavailable, inactive, or policy-ineligible')))
    objects = (await readCanonicalV04Assets(root)).objects.map((item) => item.value)
    assert.equal(objects.some((object) => (object as { type?: string }).type === 'investment_theme'), false)
    assert.equal(objects.some((object) => (object as { type?: string }).type === 'industry'), false)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, 1)
  })
})
