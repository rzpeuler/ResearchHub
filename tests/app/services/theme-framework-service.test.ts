import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveRaw } from '../../../knowledge/raw/raw-archive.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import type { KnowledgeChangeSetV04 } from '../../../knowledge/schema/mutation-v04.ts'
import type { KnowledgeSourceV04 } from '../../../knowledge/schema/domain-v04.ts'
import { createFreshKnowledgeBaseV04, loadKnowledgeBaseManifest, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { validateKnowledgeChangeSetV04 } from '../../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../../../knowledge/writer/writer.ts'
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'
import type { ThemeFrameworkInput } from '../../../skills/theme-framework/contracts.ts'
import { ThemeFrameworkService } from '../../../app/services/theme-framework-service.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-theme-framework-service-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-theme-framework-service-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function persistSource(root: string, registry: KnowledgeBaseRegistry, sourceId: string, title: string): Promise<{ sourceRef: string; rawRef: string }> {
  const handle = await registry.refresh(root)
  const raw = await archiveRaw(handle, { bytes: Buffer.from(`${title} evidence payload`), originalFilename: `${sourceId}.txt`, mediaType: 'text/plain' }, { clock })
  const source: KnowledgeSourceV04 = {
    id: `source:${sourceId}`,
    title,
    sourceType: 'official_disclosure',
    publisher: 'Fixture publisher',
    publishedAt: NOW,
    rawRefs: [raw.manifest.rawRef as `raw-sha256-${string}`],
    rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' },
    usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false },
    lifecycle: { status: 'active' },
  }
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: `changeset-${sourceId}`,
    workflowRunId: `writer-${sourceId}`,
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations: [{ operationId: `create-${sourceId}`, type: 'create', object: source }],
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  const result = await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry, clock })
  assert.equal(result.status, 'committed', result.error?.message)
  return { sourceRef: source.id, rawRef: raw.manifest.rawRef }
}

async function persistSourceBatch(root: string, registry: KnowledgeBaseRegistry, count: number): Promise<void> {
  const handle = await registry.refresh(root)
  const sources: KnowledgeSourceV04[] = []
  for (let index = 0; index < count; index += 1) {
    const sourceId = `existing-${String(index).padStart(2, '0')}`
    const raw = await archiveRaw(handle, { bytes: Buffer.from(`Existing retained source ${index}`), originalFilename: `${sourceId}.txt`, mediaType: 'text/plain' }, { clock })
    sources.push({
      id: `source:${sourceId}`,
      title: `Existing source ${index}`,
      sourceType: 'official_disclosure',
      publisher: 'Fixture publisher',
      rawRefs: [raw.manifest.rawRef as `raw-sha256-${string}`],
      rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' },
      usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false },
      lifecycle: { status: 'active' },
    })
  }
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: 'changeset-existing-source-batch',
    workflowRunId: 'writer-existing-source-batch',
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations: sources.map((source, index) => ({ operationId: `create-existing-source-${index}`, type: 'create' as const, object: source })),
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  const result = await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry, clock })
  assert.equal(result.status, 'committed', result.error?.message)
}

function frameworkExecutor(): ReasoningExecutor {
  return {
    capabilities: () => ({ maxContextTokens: 8000, maxOutputTokens: 4000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (request: ReasoningRequest): Promise<ReasoningResult> => {
      const input = request.input as ThemeFrameworkInput
      const evidence = input.evidence.find((item) => item.origin === 'external') ?? input.evidence[0]
      const evidenceRefs = evidence ? [evidence.evidenceId] : []
      const included = evidence !== undefined
      const output = {
        proposedDefinition: { statement: 'A bounded compute supply chain.', status: included ? 'supported' : 'provisional', evidenceRefs },
        inclusionPrinciples: ['Include distinct compute supply-chain activities.'],
        exclusionPrinciples: ['Exclude unrelated activities.'],
        industryCandidates: [
          {
            candidateId: 'member-a', name: 'Compute Packaging', description: 'Packages compute accelerators.',
            independentlyResearchableRationale: 'It is a distinct activity.', themeRelevanceRationale: 'It can affect compute availability.',
            boundaryRationale: 'Evidence supports this scope decision.', recommendation: included ? 'include' : 'pending',
            decisionChange: 'new', evidenceRefs, coverageGaps: included ? [] : ['No retained evidence is available.'],
          },
          {
            candidateId: 'member-b', name: 'Accelerator Manufacturing', description: 'Manufactures compute accelerators.',
            independentlyResearchableRationale: 'It is a distinct activity.', themeRelevanceRationale: 'It can affect compute availability.',
            boundaryRationale: 'The user may defer this scope decision.', recommendation: included ? 'include' : 'pending',
            decisionChange: 'new', evidenceRefs, coverageGaps: included ? [] : ['No retained evidence is available.'],
          },
        ],
        relationCandidates: [],
        coverageGaps: included ? [] : [{ gapId: 'gap-evidence', question: 'Which activities belong?', reason: 'No eligible retained Source/Raw evidence.', affectedCandidateIds: ['member-a', 'member-b'] }],
      }
      return { operation: request.operation, output }
    },
  }
}

function service(root: string, registry: KnowledgeBaseRegistry, workflowService = new WorkflowService(), acquisition?: ConstructorParameters<typeof ThemeFrameworkService>[0]['acquisition']): ThemeFrameworkService {
  return new ThemeFrameworkService({ mountedKnowledgeBaseRoot: root, registry, workflowService, reasoningExecutor: frameworkExecutor(), clock, ...(acquisition ? { acquisition } : {}) })
}

test('persists a privacy-safe review candidate, reloads it after restart, and commits partial user decisions through Writer', async () => {
  await withFreshKb('restart-accept', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const source = await persistSource(root, registry, 'service-evidence', 'Compute supply evidence')
    const first = service(root, registry)
    const started = first.start({ workflowRunId: 'theme-service-restart', name: 'AI Compute' })
    const completed = await started.completion
    assert.equal(completed.status, 'awaiting_review')
    const candidatePath = join(root, 'logs', 'theme-framework', 'reviews', 'theme-service-restart.candidate.json')
    const candidateBytes = await readFile(candidatePath)
    assert.ok(candidateBytes.byteLength < 1_000_000)

    const restarted = service(root, new KnowledgeBaseRegistry())
    const view = await restarted.getReviewCandidate('theme-service-restart')
    assert.equal(view.status, 'awaiting_review')
    assert.equal(view.candidate?.evidence[0]?.sourceRef, source.sourceRef)
    const serialized = JSON.stringify(view)
    assert.equal(serialized.includes(source.rawRef), false)
    assert.equal(serialized.includes(root), false)
    assert.equal(serialized.includes('service-evidence evidence payload'), false)

    const baseRevision = (await loadKnowledgeBaseManifest(root)).revision
    const result = await restarted.accept({ workflowRunId: 'theme-service-restart', decisions: { 'member-b': 'pending' } })
    assert.equal(result.status, 'committed')
    assert.equal(result.decisionCount, 2)
    const assets = await readCanonicalV04Assets(root)
    const entities = assets.objects.filter((item) => item.kind === 'entity').map((item) => item.value as { readonly id: string; readonly type?: string })
    assert.ok(entities.some((item) => item.id === result.themeRef && item.type === 'investment_theme'))
    assert.equal(entities.filter((item) => item.type === 'industry').length, 1)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, baseRevision + 1)
    const committed = await restarted.getReviewCandidate('theme-service-restart')
    assert.equal(committed.status, 'committed')
    assert.equal(committed.receipt?.decisionCount, 2)
  })
})

test('refreshes after acquisition persists Source/Raw and allows acceptance at the new revision', async () => {
  await withFreshKb('acquisition-refresh', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    let persisted: { sourceRef: string; rawRef: string } | undefined
    const acquisition = {
      acquire: async ({ knowledgeBaseRevision }: { knowledgeBaseRevision: number }) => {
        assert.equal((await loadKnowledgeBaseManifest(root)).revision, knowledgeBaseRevision)
        persisted = await persistSource(root, registry, 'acquired-source', 'Acquired compute evidence')
        const evidenceId = `external-${createHash('sha256').update('external fixture evidence').digest('hex').slice(0, 32)}`
        return {
          status: 'available' as const,
          evidence: [{ evidenceId, origin: 'external' as const, description: 'Acquired compute evidence summary', sourceRef: persisted.sourceRef }],
          durableEvidenceBindings: [{ evidenceId, sourceRef: persisted.sourceRef as `source:${string}`, rawRef: persisted.rawRef as `raw-sha256-${string}`, locator: 'whole source document' }],
        }
      },
    }
    const target = service(root, registry, new WorkflowService(), acquisition)
    const outcome = await target.start({ workflowRunId: 'theme-service-acquisition-refresh', name: 'AI Compute' }).completion
    assert.equal(outcome.status, 'awaiting_review')
    const revisionAfterAcquisition = (await loadKnowledgeBaseManifest(root)).revision
    const view = await target.getReviewCandidate('theme-service-acquisition-refresh')
    assert.equal(view.status, 'awaiting_review')
    assert.equal(view.candidate?.basedOnRevision, revisionAfterAcquisition)
    assert.equal(view.candidate?.evidence.some((item) => item.sourceRef === persisted?.sourceRef), true)
    const accepted = await target.accept({ workflowRunId: 'theme-service-acquisition-refresh' })
    assert.equal(accepted.status, 'committed')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, revisionAfterAcquisition + 1)
  })
})

test('candidate acquisition bindings are verified independently of the bounded snapshot evidence projection', async () => {
  await withFreshKb('acquisition-over-budget', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSourceBatch(root, registry, 24)
    let acquiredSource: { sourceRef: string; rawRef: string } | undefined
    const acquisition = {
      acquire: async () => {
        acquiredSource = await persistSource(root, registry, 'zzz-acquired-source', 'New acquired source')
        const evidenceId = `external-${createHash('sha256').update('over budget acquired evidence').digest('hex').slice(0, 32)}`
        return {
          status: 'available' as const,
          evidence: [{ evidenceId, origin: 'external' as const, description: 'New acquired source summary', sourceRef: acquiredSource.sourceRef }],
          durableEvidenceBindings: [{ evidenceId, sourceRef: acquiredSource.sourceRef as `source:${string}`, rawRef: acquiredSource.rawRef as `raw-sha256-${string}`, locator: 'whole source document' }],
        }
      },
    }
    const target = service(root, registry, new WorkflowService(), acquisition)
    const outcome = await target.start({ workflowRunId: 'theme-service-acquisition-over-budget', name: 'AI Compute' }).completion
    assert.equal(outcome.status, 'awaiting_review')
    const view = await target.getReviewCandidate('theme-service-acquisition-over-budget')
    assert.equal(view.status, 'awaiting_review')
    assert.ok(view.candidate?.evidence.some((item) => item.sourceRef === acquiredSource?.sourceRef))
    const accepted = await target.accept({ workflowRunId: 'theme-service-acquisition-over-budget' })
    assert.equal(accepted.status, 'committed')
  })
})

test('a changed revision marks the candidate stale; altered sidecars fail checksum validation', async () => {
  await withFreshKb('stale-tamper', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'stale-base', 'Base evidence')
    const target = service(root, registry)
    await target.start({ workflowRunId: 'theme-service-stale', name: 'AI Compute' }).completion
    await persistSource(root, registry, 'unrelated-change', 'Unrelated evidence')
    const stale = await target.accept({ workflowRunId: 'theme-service-stale' })
    assert.equal(stale.status, 'conflict')
    assert.equal((await target.getReviewCandidate('theme-service-stale')).status, 'stale')

    const second = service(root, registry)
    await second.start({ workflowRunId: 'theme-service-tamper', name: 'Other Compute' }).completion
    const path = join(root, 'logs', 'theme-framework', 'reviews', 'theme-service-tamper.candidate.json')
    const value = JSON.parse(await readFile(path, 'utf8')) as { payload: { candidate: { theme: { name: string } } }; checksum: string }
    value.payload.candidate.theme.name = 'Tampered theme'
    await writeFile(path, JSON.stringify(value), 'utf8')
    await assert.rejects(() => second.getReviewCandidate('theme-service-tamper'), /checksum/u)
  })
})

test('a source-free build stays pending and rejection records no canonical write', async () => {
  await withFreshKb('no-source-reject', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const target = service(root, registry)
    const baseRevision = (await loadKnowledgeBaseManifest(root)).revision
    const outcome = await target.start({ workflowRunId: 'theme-service-reject', name: 'Unverified Theme' }).completion
    assert.equal(outcome.status, 'awaiting_review')
    const view = await target.getReviewCandidate('theme-service-reject')
    assert.equal(view.candidate?.evidence.length, 0)
    assert.ok(view.candidate?.framework.industryCandidates.every((item) => item.recommendation === 'pending'))
    assert.equal((await target.reject('theme-service-reject')).status, 'rejected')
    assert.equal((await target.getReviewCandidate('theme-service-reject')).status, 'rejected')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, baseRevision)
  })
})
