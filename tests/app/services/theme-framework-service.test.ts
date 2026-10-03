import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveRaw } from '../../../knowledge/raw/raw-archive.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import type { KnowledgeChangeSetV04 } from '../../../knowledge/schema/mutation-v04.ts'
import type { KnowledgeEntityV04, KnowledgeSourceV04 } from '../../../knowledge/schema/domain-v04.ts'
import { createFreshKnowledgeBaseV04, loadKnowledgeBaseManifest, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { validateKnowledgeChangeSetV04 } from '../../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../../../knowledge/writer/writer.ts'
import { getRaw } from '../../../knowledge/raw/raw-archive.ts'
import { RawDocumentKnowledgeGatewayV04 } from '../../../knowledge/production/raw-document-gateway-v04.ts'
import { readThemeScopeLedgerV04 } from '../../../knowledge/governance/theme-scope-ledger-v04.ts'
import { DocumentInputResolver } from '../../../plugins/document/input-resolver.ts'
import type { DocumentParser, DocumentParserInput, StructuredDocument } from '../../../plugins/document/contracts.ts'
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

async function gatewaySource(root: string, registry: KnowledgeBaseRegistry, workflowRunId = 'raw-gateway-source'): Promise<void> {
  const handle = await registry.refresh(root)
  const result = await new RawDocumentKnowledgeGatewayV04({ registry, clock }).submit({
    handle,
    workflowRunId,
    bytes: Buffer.from('Official compute infrastructure source body for refresh verification.'),
    filename: `${workflowRunId}.txt`,
    mediaType: 'text/plain',
    source: { title: 'Official compute infrastructure source', sourceType: 'official_disclosure', publisher: 'Fixture publisher', publishedAt: NOW },
    rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'fixture test' },
  })
  assert.equal(result.status, 'committed', JSON.stringify(result.errors))
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
      if (input.theme.name === 'Name Only Theme') {
        output.industryCandidates = []
        output.relationCandidates = []
        output.coverageGaps = []
      }
      return { operation: request.operation, output }
    },
  }
}

function fixtureDocumentParser(options: { readonly onParse?: () => void; readonly fail?: boolean; readonly sectionCounts?: readonly number[]; readonly blockTextLength?: number } = {}): DocumentParser {
  return {
    id: 'theme-framework-fixture-parser',
    supports: () => true,
    parse: async (input: DocumentParserInput): Promise<StructuredDocument> => {
      options.onParse?.()
      if (options.fail) throw new Error('fixture parser failed at C:\\private\\source.pdf')
      const counts = options.sectionCounts ?? [2, 2]
      const sections = counts.map((_, sectionIndex) => ({
        sectionId: `section-${sectionIndex}`,
        title: `Fixture section ${sectionIndex}`,
        level: 1,
        parentSectionRef: null,
        blockRefs: Array.from({ length: counts[sectionIndex] ?? 0 }, (_, blockIndex) => `fixture-block-${sectionIndex}-${blockIndex}`),
        pageStart: sectionIndex + 1,
        pageEnd: sectionIndex + 1,
      }))
      const blocks = counts.flatMap((count, sectionIndex) => Array.from({ length: count }, (_, blockIndex) => ({
        blockId: `fixture-block-${sectionIndex}-${blockIndex}`,
        type: blockIndex === 0 ? 'heading' as const : 'paragraph' as const,
        text: `section ${sectionIndex} paragraph ${blockIndex}: ${'body '.repeat(Math.ceil((options.blockTextLength ?? 100) / 5))}`.slice(0, options.blockTextLength ?? 100),
        sectionRef: `section-${sectionIndex}`,
        page: sectionIndex + 1,
        locator: { page: sectionIndex + 1, sectionPath: [`Fixture section ${sectionIndex}`], sourceOrder: blockIndex },
        order: counts.slice(0, sectionIndex).reduce((sum, value) => sum + value, 0) + blockIndex,
      })))
      return {
        documentId: input.documentId ?? 'theme-framework-fixture-document',
        parser: { id: 'theme-framework-fixture-parser' },
        metadata: { originalFilename: input.filename, mediaType: input.mediaType, pageCount: counts.length },
        normalizedText: `FULL-ORIGINAL-DOCUMENT-SENTINEL ${blocks.map((block) => block.text).join('\n')}`,
        sections,
        blocks,
        stats: { pageCount: counts.length, sectionCount: sections.length, blockCount: blocks.length, normalizedCharacters: blocks.reduce((sum, block) => sum + block.text.length, 0), tableCount: 0, headingCount: sections.length, listCount: 0, captionCount: 0 },
        warnings: [],
      }
    },
  }
}

function observingExecutor(capture: (input: ThemeFrameworkInput) => void): ReasoningExecutor {
  const delegate = frameworkExecutor()
  return {
    capabilities: () => delegate.capabilities(),
    execute: async (request, signal) => {
      capture(request.input as ThemeFrameworkInput)
      return delegate.execute(request, signal)
    },
  }
}

function evidenceService(root: string, registry: KnowledgeBaseRegistry, resolver: DocumentInputResolver, capture: (input: ThemeFrameworkInput) => void): ThemeFrameworkService {
  return new ThemeFrameworkService({ mountedKnowledgeBaseRoot: root, registry, workflowService: new WorkflowService(), reasoningExecutor: observingExecutor(capture), documentInputResolver: resolver, clock })
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
    const inbox = await restarted.listReviews(10)
    assert.deepEqual(inbox.items, [{ runId: 'theme-service-restart', themeName: 'AI Compute', basedOnRevision: view.candidate?.basedOnRevision, status: 'awaiting_review' }])
    assert.equal(JSON.stringify(inbox).includes('rawRef'), false)
    assert.equal(JSON.stringify(inbox).includes(root), false)
    assert.equal(view.candidate?.evidence[0]?.sourceRef, source.sourceRef)
    const serialized = JSON.stringify(view)
    assert.equal(serialized.includes(source.rawRef), false)
    assert.equal(serialized.includes(root), false)
    assert.equal(serialized.includes('service-evidence evidence payload'), false)

    const baseRevision = (await loadKnowledgeBaseManifest(root)).revision
    const humanRationale = 'Keep accelerator manufacturing under review until wafer supply boundaries are independently established.'
    await assert.rejects(
      () => restarted.accept({ workflowRunId: 'theme-service-restart', decisions: { 'member-b': 'pending' } }),
      /decisionRationales must include a rationale/u,
    )
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, baseRevision)
    const result = await restarted.accept({ workflowRunId: 'theme-service-restart', decisions: { 'member-b': 'pending' }, decisionRationales: { 'member-b': `  ${humanRationale}  ` } })
    assert.equal(result.status, 'committed')
    assert.equal(result.decisionCount, 2)
    const assets = await readCanonicalV04Assets(root)
    const entities = assets.objects.filter((item) => item.kind === 'entity').map((item) => item.value as { readonly id: string; readonly type?: string })
    assert.ok(entities.some((item) => item.id === result.themeRef && item.type === 'investment_theme'))
    assert.equal(entities.filter((item) => item.type === 'industry').length, 1)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, baseRevision + 1)
    const ledger = await readThemeScopeLedgerV04(await registry.refresh(root))
    assert.equal(ledger.status, 'available')
    if (ledger.status === 'available') {
      const humanDecision = ledger.themes.flatMap((theme) => theme.history).find((entry) => entry.decision.candidate.kind === 'industry' && entry.decision.candidate.name === 'Accelerator Manufacturing')
      assert.equal(humanDecision?.decision.decision, 'pending')
      assert.equal(humanDecision?.decision.rationale, humanRationale)
    }
    const normalizedRationaleReplay = await restarted.accept({ workflowRunId: 'theme-service-restart', decisions: { 'member-b': 'pending' }, decisionRationales: { 'member-b': humanRationale } })
    assert.equal(normalizedRationaleReplay.status, 'already_committed')

    // Simulate a committed accept-intent written by the previous implementation:
    // it stored only decisions and hashed that map, even when it contained overrides.
    const intentPath = join(root, 'logs', 'theme-framework', 'reviews', 'theme-service-restart.accept-intent.json')
    const legacyDecisions: Record<string, 'include' | 'exclude' | 'pending'> = { 'member-b': 'pending' }
    const legacyPayload = { digest: createHash('sha256').update(JSON.stringify(legacyDecisions), 'utf8').digest('hex'), decisions: legacyDecisions }
    const legacyBody = { version: 1, type: 'accept-intent', runId: 'theme-service-restart', payload: legacyPayload }
    await writeFile(intentPath, JSON.stringify({ ...legacyBody, checksum: createHash('sha256').update(JSON.stringify(legacyBody), 'utf8').digest('hex') }))
    const legacyReplay = await restarted.accept({ workflowRunId: 'theme-service-restart', decisions: legacyDecisions })
    assert.equal(legacyReplay.status, 'already_committed')
    const differentRationaleReplay = await restarted.accept({ workflowRunId: 'theme-service-restart', decisions: { 'member-b': 'pending' }, decisionRationales: { 'member-b': 'Use a different human reason.' } })
    assert.equal(differentRationaleReplay.status, 'conflict')
    const committed = await restarted.getReviewCandidate('theme-service-restart')
    assert.equal(committed.status, 'committed')
    assert.equal(committed.receipt?.decisionCount, 2)
    assert.deepEqual((await restarted.listReviews()).items, [{ runId: 'theme-service-restart', themeName: 'AI Compute', basedOnRevision: view.candidate?.basedOnRevision, status: 'committed' }])
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

test('fetches and accepts a name-only Theme, then returns the same receipt on retry', async () => {
  await withFreshKb('name-only-accept', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const target = service(root, registry)
    const started = await target.start({ workflowRunId: 'theme-service-name-only', name: 'Name Only Theme' }).completion
    assert.equal(started.status, 'awaiting_review')
    const view = await target.getReviewCandidate('theme-service-name-only')
    assert.equal(view.status, 'awaiting_review')
    assert.deepEqual(view.candidate?.framework.industryCandidates, [])
    assert.deepEqual(view.candidate?.framework.relationCandidates, [])
    const baseRevision = (await loadKnowledgeBaseManifest(root)).revision

    const accepted = await target.accept({ workflowRunId: 'theme-service-name-only' })
    assert.equal(accepted.status, 'committed')
    if (accepted.status !== 'committed') return
    assert.equal(accepted.decisionCount, 0)
    const replay = await target.accept({ workflowRunId: 'theme-service-name-only' })
    assert.equal(replay.status, 'already_committed')
    assert.equal(replay.themeRef, accepted.themeRef)
    assert.equal(replay.decisionCount, 0)

    const assets = await readCanonicalV04Assets(root)
    const objects = assets.objects.map((item) => item.value)
    assert.ok(objects.some((object) => object.id === accepted.themeRef && (object as { type?: string }).type === 'investment_theme'))
    assert.ok(objects.some((object) => object.id === 'theme-group:default' && (object as { name?: string }).name === 'Default'))
    assert.equal(objects.filter((object) => object.id.startsWith('entity:') && (object as { type?: string }).type === 'industry').length, 0)
    assert.equal(objects.filter((object) => object.id.startsWith('relation:')).length, 0)
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, baseRevision + 1)
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
    assert.deepEqual((await target.listReviews()).items, [{ runId: 'theme-service-stale', themeName: 'AI Compute', basedOnRevision: (await loadKnowledgeBaseManifest(root)).revision - 1, status: 'stale' }])

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

test('projects bounded document body evidence with real block locators and reuses verified excerpts', async () => {
  await withFreshKb('raw-body-evidence', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const source = await persistSource(root, registry, 'body-evidence', 'Compute materials report')
    let parserCalls = 0
    const resolver = new DocumentInputResolver({ documentParser: fixtureDocumentParser({ onParse: () => { parserCalls += 1 } }) })
    const inputs: ThemeFrameworkInput[] = []
    const target = evidenceService(root, registry, resolver, (input) => inputs.push(input))
    const runId = 'theme-service-raw-body-evidence'
    const result = await target.start({ workflowRunId: runId, name: 'AI Compute' }).completion
    assert.equal(result.status, 'awaiting_review')
    assert.equal(parserCalls, 1)

    const input = inputs[0]
    assert.ok(input)
    const bodyEvidence = input.evidence.filter((item) => item.evidenceId.startsWith('raw-evidence-'))
    assert.equal(bodyEvidence.length, 4)
    assert.ok(bodyEvidence.every((item) => item.excerpt !== undefined && item.excerpt.length <= 2_400))
    assert.ok(bodyEvidence.every((item) => /block=fixture-block-\d-\d; page=\d; section=Fixture section \d/u.test(item.description)))
    assert.ok(bodyEvidence.every((item) => item.sourceRef === source.sourceRef))
    assert.equal(JSON.stringify(input).includes('FULL-ORIGINAL-DOCUMENT-SENTINEL'), false)

    const candidatePath = join(root, 'logs', 'theme-framework', 'reviews', `${runId}.candidate.json`)
    const persisted = JSON.parse(await readFile(candidatePath, 'utf8')) as { payload: { candidate: { durableEvidenceBindings: { evidenceId: string; locator: string }[] } } }
    const bodyBindings = persisted.payload.candidate.durableEvidenceBindings.filter((binding) => binding.evidenceId.startsWith('raw-evidence-'))
    assert.equal(bodyBindings.length, 4)
    assert.deepEqual(new Set(bodyBindings.map((binding) => binding.locator)), new Set(['fixture-block-0-0', 'fixture-block-0-1', 'fixture-block-1-0', 'fixture-block-1-1']))
    const review = await target.getReviewCandidate(runId)
    assert.equal(review.status, 'awaiting_review')
    assert.ok(review.candidate?.evidence.filter((item) => item.evidenceId.startsWith('raw-evidence-')).every((item) => item.summary.length <= 500 && item.summary.includes('block=fixture-block-')))
    assert.equal(JSON.stringify(review).includes('FULL-ORIGINAL-DOCUMENT-SENTINEL'), false)
    const canonical = await readCanonicalV04Assets(root)
    assert.equal(canonical.objects.filter((item) => item.kind === 'entity' || item.kind === 'relation').length, 0)
    assert.equal(canonical.objects.filter((item) => item.kind === 'source').length, 1)

    const handle = await registry.refresh(root)
    const raw = await getRaw(handle, source.rawRef)
    await writeFile(raw.originalPath, 'tampered bytes')
    assert.equal((await target.getReviewCandidate(runId)).status, 'stale')
    assert.equal(parserCalls, 1)
  })
})

test('parse failure keeps title evidence, marks body unavailable, and caches the failure without paths', async () => {
  await withFreshKb('raw-body-fallback', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const source = await persistSource(root, registry, 'body-fallback', 'Compute report title')
    let parserCalls = 0
    const resolver = new DocumentInputResolver({ documentParser: fixtureDocumentParser({ fail: true, onParse: () => { parserCalls += 1 } }) })
    const inputs: ThemeFrameworkInput[] = []
    const target = evidenceService(root, registry, resolver, (input) => inputs.push(input))
    const runId = 'theme-service-body-fallback'
    const result = await target.start({ workflowRunId: runId, name: 'AI Compute' }).completion

    assert.equal(result.status, 'awaiting_review')
    assert.equal(parserCalls, 1)
    const input = inputs[0]
    assert.ok(input)
    assert.ok(input.existingKnowledge.summary.includes('Body excerpts unavailable for 1 retained Source/Raw pair'))
    assert.equal(input.evidence.filter((item) => item.sourceRef === source.sourceRef && item.excerpt !== undefined).length, 0)
    assert.ok(input.evidence.some((item) => item.sourceRef === source.sourceRef && item.description.includes('retained body unavailable')))
    assert.equal(JSON.stringify(input).includes('C:\\private'), false)
    assert.equal((await target.getReviewCandidate(runId)).status, 'awaiting_review')
    assert.equal(parserCalls, 1)
  })
})

test('Raw integrity failure is rejected before parsing', async () => {
  await withFreshKb('raw-body-invalid', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    const source = await persistSource(root, registry, 'body-invalid', 'Invalid Raw title')
    const handle = await registry.refresh(root)
    const raw = await getRaw(handle, source.rawRef)
    await writeFile(raw.originalPath, 'tampered before parse')
    let parserCalls = 0
    const resolver = new DocumentInputResolver({ documentParser: fixtureDocumentParser({ onParse: () => { parserCalls += 1 } }) })
    const inputs: ThemeFrameworkInput[] = []
    const target = evidenceService(root, registry, resolver, (input) => inputs.push(input))
    const result = await target.start({ workflowRunId: 'theme-service-body-invalid', name: 'AI Compute' }).completion

    assert.equal(result.status, 'awaiting_review')
    assert.equal(parserCalls, 0)
    assert.equal(inputs[0]?.evidence.some((item) => item.sourceRef === source.sourceRef), false)
  })
})

test('caps retained inputs at 24 Source/Raw pairs and 48 existing KB evidence items', async () => {
  await withFreshKb('raw-body-budget', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSourceBatch(root, registry, 25)
    let parserCalls = 0
    const resolver = new DocumentInputResolver({ documentParser: fixtureDocumentParser({ sectionCounts: [8, 8], onParse: () => { parserCalls += 1 } }) })
    const inputs: ThemeFrameworkInput[] = []
    const target = evidenceService(root, registry, resolver, (input) => inputs.push(input))
    const result = await target.start({ workflowRunId: 'theme-service-body-budget', name: 'AI Compute' }).completion

    assert.equal(result.status, 'awaiting_review')
    assert.equal(parserCalls, 24)
    const existing = inputs[0]?.evidence.filter((item) => item.origin === 'existing_kb') ?? []
    assert.equal(existing.length, 48)
    assert.equal(new Set(existing.map((item) => item.sourceRef)).size, 24)
    assert.equal(existing.filter((item) => item.excerpt !== undefined).length, 24)
    assert.ok(existing.every((item) => item.excerpt === undefined || item.excerpt.length <= 2_400))
  })
})

test('refreshes a stale candidate after one Source/Raw-only Writer revision and replays the exact new run', async () => {
  await withFreshKb('refresh-success', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'refresh-base', 'Compute supply evidence')
    const target = service(root, registry)
    const sourceRunId = 'theme-refresh-source'
    assert.equal((await target.start({ workflowRunId: sourceRunId, name: 'AI Compute' }).completion).status, 'awaiting_review')
    const originalBytes = await readFile(join(root, 'logs', 'theme-framework', 'reviews', `${sourceRunId}.candidate.json`))
    await gatewaySource(root, registry)
    assert.equal((await target.getReviewCandidate(sourceRunId)).status, 'stale')
    const beforeRevision = (await loadKnowledgeBaseManifest(root)).revision

    const refreshed = await target.refresh(sourceRunId)
    assert.equal(refreshed.status, 'awaiting_review')
    assert.ok(refreshed.workflowRunId.startsWith('tf-refresh-'))
    assert.equal(refreshed.refreshedFromRunId, sourceRunId)
    assert.equal(refreshed.basedOnRevision, beforeRevision)
    assert.deepEqual(await readFile(join(root, 'logs', 'theme-framework', 'reviews', `${sourceRunId}.candidate.json`)), originalBytes)
    const review = await target.getReviewCandidate(refreshed.workflowRunId)
    assert.equal(review.status, 'awaiting_review')
    assert.equal(review.candidate?.refresh?.refreshedFromRunId, sourceRunId)
    assert.equal(review.candidate?.basedOnRevision, beforeRevision)
    assert.equal((await target.refresh(sourceRunId)).status, 'already_refreshed')
    const rawSource = (await readCanonicalV04Assets(root)).objects.find((item) => item.kind === 'source' && (item.value as KnowledgeSourceV04).title === 'Official compute infrastructure source')?.value as KnowledgeSourceV04
    const raw = await getRaw(await registry.refresh(root), rawSource.rawRefs![0]!)
    await writeFile(raw.originalPath, 'tampered after successful refresh')
    assert.equal((await target.refresh(sourceRunId)).status, 'blocked')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, beforeRevision)
  })
})

test('blocks refresh when a required revision receipt is missing, duplicated, forged, or records a non-Source write', async (t) => {
  for (const scenario of ['missing', 'duplicate', 'forged', 'non-source'] as const) {
    await t.test(scenario, async () => withFreshKb(`refresh-${scenario}`, async (root) => {
      const registry = new KnowledgeBaseRegistry()
      await persistSource(root, registry, `refresh-${scenario}-base`, 'Compute supply evidence')
      const target = service(root, registry)
      const runId = `theme-refresh-${scenario}`
      assert.equal((await target.start({ workflowRunId: runId, name: 'AI Compute' }).completion).status, 'awaiting_review')
      await gatewaySource(root, registry, `raw-${scenario}`)
      const logDir = join(root, 'logs', 'research')
      const writerPath = join(logDir, `raw-${scenario}.yaml`)
      const writerLog = await readFile(writerPath, 'utf8')
      if (scenario === 'missing') await rm(writerPath)
      if (scenario === 'duplicate') await writeFile(join(logDir, 'duplicate-receipt.yaml'), writerLog)
      if (scenario === 'forged') await writeFile(writerPath, writerLog.replace('raw_document_source_gateway', 'unverified_producer'))
      if (scenario === 'non-source') {
        const handle = await registry.refresh(root)
        const changeSet: KnowledgeChangeSetV04 = {
          changeSetId: 'refresh-nonsource-changeset', workflowRunId: 'refresh-nonsource-writer', knowledgeBaseId: handle.knowledgeBaseId,
          schemaVersion: '0.4', storageFormatVersion: '1', expectedBaseRevision: handle.revision,
          operations: [{ operationId: 'create-nonsource', type: 'create', object: {
            id: 'entity:refresh-nonsource', type: 'industry', name: 'Non-source change', description: 'Changes the canonical graph.', lifecycle: { status: 'active' },
          } as unknown as KnowledgeEntityV04 }],
        }
        const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
        assert.ok(validation.validatedChangeSet)
        assert.equal((await writeKnowledgeBase(handle, validation.validatedChangeSet!, { registry, clock })).status, 'committed')
      }
      assert.equal((await target.refresh(runId)).status, 'blocked')
      assert.equal((await target.listReviews(10)).items.some((item) => item.runId.startsWith('tf-refresh-')), false)
    }))
  }
})

test('revalidates the Writer revision chain before returning an exact refresh replay', async () => {
  await withFreshKb('refresh-replay-receipt-tamper', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'refresh-replay-base', 'Compute supply evidence')
    const target = service(root, registry)
    const runId = 'theme-refresh-replay-receipt'
    assert.equal((await target.start({ workflowRunId: runId, name: 'AI Compute' }).completion).status, 'awaiting_review')
    await gatewaySource(root, registry)
    assert.equal((await target.refresh(runId)).status, 'awaiting_review')
    assert.equal((await target.refresh(runId)).status, 'already_refreshed')
    const receiptPath = join(root, 'logs', 'research', 'raw-gateway-source.yaml')
    const receipt = await readFile(receiptPath, 'utf8')
    await writeFile(receiptPath, receipt.replace('raw_document_source_gateway', 'unverified_producer'))
    assert.equal((await target.refresh(runId)).status, 'blocked')
  })
})

test('does not return a refresh candidate as reviewable when a Writer advances the KB during candidate persistence', async () => {
  await withFreshKb('refresh-write-race', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'refresh-race-base', 'Compute supply evidence')
    const target = service(root, registry)
    const sourceRunId = 'theme-refresh-write-race'
    assert.equal((await target.start({ workflowRunId: sourceRunId, name: 'AI Compute' }).completion).status, 'awaiting_review')
    await gatewaySource(root, registry, 'raw-race-before-refresh')

    const instrumented = target as unknown as { writeEvent: (runId: string, type: string, payload: unknown) => Promise<void> }
    const writeEvent = instrumented.writeEvent.bind(target)
    let raced = false
    instrumented.writeEvent = async (runId, type, payload) => {
      await writeEvent(runId, type, payload)
      if (!raced && runId.startsWith('tf-refresh-') && type === 'candidate') {
        raced = true
        await gatewaySource(root, registry, 'raw-race-after-candidate')
      }
    }

    const result = await target.refresh(sourceRunId)
    assert.equal(result.status, 'blocked')
    assert.equal(raced, true)
    assert.equal((await target.getReviewCandidate(result.workflowRunId)).status, 'stale')
    assert.equal((await target.accept({ workflowRunId: result.workflowRunId })).status, 'conflict')
  })
})

test('conflicts when the deterministic refresh run ID already contains different candidate content', async () => {
  await withFreshKb('refresh-content-conflict', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'refresh-content-conflict-base', 'Compute supply evidence')
    const target = service(root, registry)
    const sourceRunId = 'theme-refresh-content-conflict'
    assert.equal((await target.start({ workflowRunId: sourceRunId, name: 'AI Compute' }).completion).status, 'awaiting_review')
    await gatewaySource(root, registry, 'raw-content-conflict')
    const handle = await registry.refresh(root)
    const deterministicRunId = `tf-refresh-${createHash('sha256').update(JSON.stringify({ sourceRunId, knowledgeBaseId: handle.knowledgeBaseId, targetRevision: handle.revision }), 'utf8').digest('hex').slice(0, 40)}`
    assert.equal((await target.start({ workflowRunId: deterministicRunId, name: 'Conflicting candidate' }).completion).status, 'awaiting_review')
    assert.equal((await target.refresh(sourceRunId)).status, 'conflict')
    assert.equal((await target.getReviewCandidate(deterministicRunId)).candidate?.theme.name, 'Conflicting candidate')
  })
})

test('rejects a replay whose candidate payload claims a different Workflow run ID', async () => {
  await withFreshKb('refresh-payload-run-id', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'refresh-payload-run-id-base', 'Compute supply evidence')
    const target = service(root, registry)
    const sourceRunId = 'theme-refresh-payload-run-id'
    assert.equal((await target.start({ workflowRunId: sourceRunId, name: 'AI Compute' }).completion).status, 'awaiting_review')
    await gatewaySource(root, registry, 'raw-payload-run-id')
    const refreshed = await target.refresh(sourceRunId)
    assert.equal(refreshed.status, 'awaiting_review')
    const candidatePath = join(root, 'logs', 'theme-framework', 'reviews', `${refreshed.workflowRunId}.candidate.json`)
    const envelope = JSON.parse(await readFile(candidatePath, 'utf8')) as { version: 1; type: 'candidate'; runId: string; payload: { candidate: { workflowRunId: string } }; checksum: string }
    envelope.payload.candidate.workflowRunId = 'tf-refresh-impostor'
    const body = { version: envelope.version, type: envelope.type, runId: envelope.runId, payload: envelope.payload }
    envelope.checksum = createHash('sha256').update(JSON.stringify(body), 'utf8').digest('hex')
    await writeFile(candidatePath, JSON.stringify(envelope))
    assert.equal((await target.refresh(sourceRunId)).status, 'conflict')
  })
})

test('blocks refresh when bound Source/Raw evidence has been tampered with', async () => {
  await withFreshKb('refresh-evidence-invalid', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'refresh-evidence-base', 'Compute supply evidence')
    const target = service(root, registry)
    const runId = 'theme-refresh-evidence'
    assert.equal((await target.start({ workflowRunId: runId, name: 'AI Compute' }).completion).status, 'awaiting_review')
    await gatewaySource(root, registry)
    const assets = await readCanonicalV04Assets(root)
    const source = assets.objects.find((item) => item.kind === 'source' && (item.value as KnowledgeSourceV04).title === 'Official compute infrastructure source')?.value as KnowledgeSourceV04
    assert.ok(source?.rawRefs?.[0])
    const raw = await getRaw(await registry.refresh(root), source.rawRefs![0]!)
    await writeFile(raw.originalPath, 'tampered body invalidates the Raw content hash')
    assert.equal((await target.refresh(runId)).status, 'blocked')
  })
})

test('blocks refresh when a persisted body-block locator no longer resolves', async () => {
  await withFreshKb('refresh-locator-invalid', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'refresh-locator-base', 'Compute supply evidence')
    const firstResolver = new DocumentInputResolver({ documentParser: fixtureDocumentParser({ sectionCounts: [2, 2] }) })
    const first = evidenceService(root, registry, firstResolver, () => undefined)
    const runId = 'theme-refresh-locator'
    assert.equal((await first.start({ workflowRunId: runId, name: 'AI Compute' }).completion).status, 'awaiting_review')
    await gatewaySource(root, registry)
    const changedResolver = new DocumentInputResolver({ documentParser: fixtureDocumentParser({ sectionCounts: [1] }) })
    const restarted = evidenceService(root, new KnowledgeBaseRegistry(), changedResolver, () => undefined)
    assert.equal((await restarted.refresh(runId)).status, 'blocked')
  })
})

test('blocks refresh of rejected and committed source runs', async () => {
  await withFreshKb('refresh-terminal', async (root) => {
    const registry = new KnowledgeBaseRegistry()
    await persistSource(root, registry, 'refresh-terminal-base', 'Compute supply evidence')
    const target = service(root, registry)
    const rejected = 'theme-refresh-rejected'
    assert.equal((await target.start({ workflowRunId: rejected, name: 'AI Compute' }).completion).status, 'awaiting_review')
    await target.reject(rejected)
    await gatewaySource(root, registry, 'raw-after-reject')
    assert.equal((await target.refresh(rejected)).status, 'blocked')

    await withFreshKb('refresh-committed-inner', async (innerRoot) => {
      const innerRegistry = new KnowledgeBaseRegistry()
      await persistSource(innerRoot, innerRegistry, 'refresh-committed-base', 'Compute supply evidence')
      const inner = service(innerRoot, innerRegistry)
      const committed = 'theme-refresh-committed'
      assert.equal((await inner.start({ workflowRunId: committed, name: 'AI Compute' }).completion).status, 'awaiting_review')
      assert.equal((await inner.accept({ workflowRunId: committed })).status, 'committed')
      await gatewaySource(innerRoot, innerRegistry, 'raw-after-commit')
      assert.equal((await inner.refresh(committed)).status, 'blocked')
    })
  })
})
