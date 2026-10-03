import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveRaw } from '../../knowledge/raw/raw-archive.ts'
import { ThemeFrameworkAcceptanceV04 } from '../../knowledge/production/theme-framework-acceptance-v04.ts'
import { ThemeManagementGatewayV04 } from '../../knowledge/production/theme-management-v04.ts'
import { ThemeScopeImpactAcceptanceV04 } from '../../knowledge/production/theme-scope-impact-acceptance-v04.ts'
import { ThemeScopeImpactService, type ThemeScopeImpactWriteReceipt } from '../../app/services/theme-scope-impact-service.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import type { KnowledgeIndustryV04, KnowledgeSourceV04, KnowledgeRelationV04 } from '../../knowledge/schema/domain-v04.ts'
import type { KnowledgeChangeSetV04, KnowledgeWriteResultV04 } from '../../knowledge/schema/mutation-v04.ts'
import { fingerprintThemeIndustryCandidateV04 } from '../../knowledge/governance/theme-scope-v04.ts'
import { readThemeScopeLedgerV04 as readLedger } from '../../knowledge/governance/theme-scope-ledger-v04.ts'
import { createFreshKnowledgeBaseV04, loadKnowledgeBaseManifest, readCanonicalV04Assets } from '../../knowledge/storage/index.ts'
import { hashKnowledgeObject } from '../../knowledge/storage/canonical-hash.ts'
import { validateKnowledgeChangeSetV04 } from '../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../../knowledge/writer/writer.ts'
import type { ThemeScopeImpactCandidate, ThemeScopeImpactCheckResult } from '../../workflows/theme-scope-impact-check/workflow.ts'
import type { ThemeFrameworkDecision } from '../../workflows/theme-framework-construction/contracts.ts'
import type { ThemeFrameworkResult } from '../../skills/theme-framework/contracts.ts'
import { ApplicationServiceError } from '../../app/services/contracts.ts'

const NOW = '2026-10-03T00:00:00.000Z'
const clock = () => NOW
const THEME_NAME = 'Impact Test Theme'
const NEW_INDUSTRY_REF = 'entity:impact-new-industry' as const
const GLOBAL_RELATION_REF = 'relation:impact-global-edge' as const

async function withKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-theme-impact-accept-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-theme-impact-${name}`, now: NOW })
    await run(root)
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function commit(root: string, input: Omit<KnowledgeChangeSetV04, 'knowledgeBaseId' | 'schemaVersion' | 'storageFormatVersion' | 'expectedBaseRevision'>, registry = new KnowledgeBaseRegistry()) {
  const handle = await registry.refresh(root)
  const changeSet: KnowledgeChangeSetV04 = { ...input, knowledgeBaseId: handle.knowledgeBaseId, schemaVersion: '0.4', storageFormatVersion: '1', expectedBaseRevision: handle.revision }
  const validated = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validated.validatedChangeSet, validated.report.errors.map((error) => error.message).join('; '))
  const written = await writeKnowledgeBase(handle, validated.validatedChangeSet, { registry, clock })
  assert.equal(written.status, 'committed', written.error?.message)
  return { handle: await registry.refresh(root), result: written as KnowledgeWriteResultV04 }
}

async function seedBase(root: string): Promise<{ registry: KnowledgeBaseRegistry; sourceRef: `source:${string}`; rawRef: `raw-sha256-${string}`; themeRef: string; existingIndustryRef: string }> {
  const registry = new KnowledgeBaseRegistry()
  let handle = await registry.mount(root)
  const raw = await archiveRaw(handle, { bytes: Buffer.from('Source evidence establishes impact scope.'), originalFilename: 'impact-evidence.txt', mediaType: 'text/plain' }, { clock })
  const source: KnowledgeSourceV04 = {
    id: 'source:impact-evidence-one', title: 'Impact evidence one', sourceType: 'official_disclosure', provider: 'fixture', canonicalUrl: 'https://example.test/impact-one', retrievedAt: NOW,
    contentHash: raw.manifest.contentHash.slice('sha256:'.length), rawRefs: [raw.manifest.rawRef as `raw-sha256-${string}`],
    rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
    usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: { status: 'active' },
  }
  await commit(root, { changeSetId: 'changeset-impact-seed-source', workflowRunId: 'impact-seed-source', operations: [{ operationId: 'create-impact-source', type: 'create', object: source }] }, registry)
  handle = await registry.refresh(root)
  const evidenceId = 'impact-evidence-one'
  const framework: ThemeFrameworkResult = {
    proposedDefinition: { statement: 'A test Theme used to verify A4 decisions.', status: 'supported', evidenceRefs: [evidenceId] },
    inclusionPrinciples: ['Include relevant industry nodes.'], exclusionPrinciples: ['Exclude irrelevant nodes.'],
    industryCandidates: [{ candidateId: 'impact-existing-industry', semanticFingerprint: 'industry:existing', name: 'Existing Industry', description: 'Existing node.', independentlyResearchableRationale: 'Independent.', themeRelevanceRationale: 'Relevant.', boundaryRationale: 'Reviewed.', recommendation: 'include', decisionChange: 'new', evidenceRefs: [evidenceId], coverageGaps: [] }],
    relationCandidates: [], coverageGaps: [],
  }
  const reviewed: ThemeFrameworkDecision[] = [{ candidateId: 'impact-existing-industry', kind: 'industry', decision: 'include', rationale: 'Seed existing in-scope Industry.', evidenceRefs: [evidenceId], evidenceBindings: [{ evidenceId, sourceRef: source.id, rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, locator: 'page 1' }], coverageGaps: [] }]
  const acceptance = await new ThemeFrameworkAcceptanceV04({ registry, clock }).commitThemeFrameworkAtomically({
    workflowRunId: 'impact-seed-theme', knowledgeBaseId: handle.knowledgeBaseId, expectedBaseRevision: handle.revision,
    theme: { name: THEME_NAME }, framework, decisions: reviewed,
  })
  assert.equal(acceptance.status, 'committed', acceptance.errors?.join('; '))
  assert.ok(acceptance.themeRef)
  const scope = await readLedger(await registry.refresh(root))
  assert.equal(scope.status, 'available')
  const existingIndustryRef = scope.status === 'available'
    ? scope.themes.find((item) => item.themeRef === acceptance.themeRef)?.currentByCandidateFingerprint[fingerprintThemeIndustryCandidateV04({ name: 'Existing Industry', identityContext: 'industry:existing' })]?.decision.candidate.canonicalRef
    : undefined
  assert.ok(existingIndustryRef?.startsWith('entity:'))

  const created = await commit(root, {
    changeSetId: 'changeset-impact-seed-global-node', workflowRunId: 'impact-seed-global-node', operations: [
      { operationId: 'create-impact-new-industry', type: 'create', object: { id: NEW_INDUSTRY_REF, type: 'industry', name: 'New Industry', lifecycle: { status: 'active' } } },
      { operationId: 'create-impact-global-edge', type: 'create', object: { id: GLOBAL_RELATION_REF, type: 'upstream_of', sourceRef: existingIndustryRef as `entity:${string}`, targetRef: NEW_INDUSTRY_REF, sourceRefs: [source.id], lifecycle: { status: 'active' } } },
    ],
  }, registry)
  assert.equal(created.result.status, 'committed')
  return { registry, sourceRef: source.id, rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, themeRef: acceptance.themeRef, existingIndustryRef: existingIndustryRef! }
}

function impactCandidate(input: { themeRef: string; sourceRef: string; basedOnRevision: number; prior?: { id: string; decision: 'include' | 'exclude' | 'pending' }; extraEvidenceRefs?: readonly string[]; changedRef?: string; includeRelationEvidence?: boolean }): ThemeScopeImpactCandidate {
  const candidate = { kind: 'industry' as const, name: 'New Industry', canonicalRef: NEW_INDUSTRY_REF }
  const candidateFingerprint = fingerprintThemeIndustryCandidateV04({ name: candidate.name })
  const evidenceRefs = [...new Set([sourceRefOr(input.sourceRef), ...(input.includeRelationEvidence === false ? [] : [GLOBAL_RELATION_REF]), NEW_INDUSTRY_REF, ...(input.extraEvidenceRefs ?? [])])].sort()
  const proposalId = `theme-scope-impact:${createHash('sha256').update(`${input.themeRef}|${candidateFingerprint}|${evidenceRefs.join('|')}`, 'utf8').digest('hex').slice(0, 40)}`
  return {
    proposalId, themeRef: input.themeRef, candidate, candidateFingerprint,
    changeKind: input.prior?.decision === 'exclude' ? 'excluded_candidate_new_evidence' : 'new_theme_node',
    ...(input.prior ? { priorDecision: input.prior } : {}),
    rationale: 'New canonical evidence may justify adding New Industry to this Theme.',
    observed: [{ ref: input.changedRef ?? GLOBAL_RELATION_REF, type: 'upstream_of', sourceRef: input.sourceRef, targetRef: NEW_INDUSTRY_REF, sourceRefs: [input.sourceRef], lifecycleStatus: 'active' }],
    evidenceRefs, changedRefs: [input.changedRef ?? GLOBAL_RELATION_REF], basedOnRevision: input.basedOnRevision,
  }
}
function sourceRefOr(value: string): string { return value }

function serviceFor(root: string, registry: KnowledgeBaseRegistry, candidate: (revision: number) => ThemeScopeImpactCandidate, acceptance?: ThemeScopeImpactAcceptanceV04) {
  return new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, registry, ...(acceptance ? { acceptance } : {}), impactRunner: async (input): Promise<ThemeScopeImpactCheckResult> => ({ status: 'completed', basedOnRevision: input.committedRevision, candidates: [candidate(input.committedRevision)], diagnostics: [] }) })
}

async function inboxProposal(root: string, fixture: Awaited<ReturnType<typeof seedBase>>, prior?: { id: string; decision: 'include' | 'exclude' | 'pending' }, acceptance?: ThemeScopeImpactAcceptanceV04) {
  const registry = fixture.registry
  const relation = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === GLOBAL_RELATION_REF)!.value as KnowledgeRelationV04
  const writerRunId = prior ? 'impact-delivery-new-evidence' : 'impact-delivery-one'
  const changeSetId = prior ? 'changeset-impact-delivery-new-evidence' : 'changeset-impact-delivery-one'
  const updated = await commit(root, {
    changeSetId, workflowRunId: writerRunId,
    operations: [{ operationId: `touch-impact-edge-${writerRunId}`, type: 'update', knowledgeId: GLOBAL_RELATION_REF, expectedBeforeHash: hashKnowledgeObject(relation), object: { ...relation, updatedAt: NOW } }],
  }, registry)
  const currentSource = prior ? 'source:impact-evidence-two' : fixture.sourceRef
  const candidate = impactCandidate({ themeRef: fixture.themeRef, sourceRef: currentSource, basedOnRevision: updated.handle.revision, ...(prior ? { prior } : {}) })
  const service = serviceFor(root, registry, () => candidate, acceptance)
  const receipt: ThemeScopeImpactWriteReceipt = {
    knowledgeBaseRoot: root, knowledgeBaseId: updated.handle.knowledgeBaseId,
    writerRunId, changeSetId, status: 'committed', baseRevision: updated.result.baseRevision, committedRevision: updated.result.committedRevision,
    createdRefs: updated.result.createdIds, updatedRefs: updated.result.updatedIds,
  }
  const record = await service.check(receipt)
  return { service, proposal: record.proposals[0]!, proposals: record.proposals, baseRevision: record.committedRevision }
}

async function decideInbox(service: ThemeScopeImpactService, receiptKey: string, proposalId: string, decision: 'include' | 'exclude' | 'pending', workflowRunId: string) {
  const record = await service.get(receiptKey)
  const result = await service.decideBatch({ receiptKey, workflowRunId, decisions: record.proposals.filter((proposal) => proposal.status !== 'rejected').map((proposal) => ({ proposalId: proposal.proposalId, decision: proposal.proposalId === proposalId ? decision : 'pending' })) })
  return result.proposals.find((proposal) => proposal.proposalId === proposalId)!
}

test('include commits A4 and Theme exposure together; exact retry recovers the Writer decision', async () => {
  await withKb('include-replay', async (root) => {
    const fixture = await seedBase(root)
    const inbox = await inboxProposal(root, fixture)
    const before = inbox.baseRevision
    const receiptKey = (await inbox.service.list()).items[0]!.receiptKey
    const accepted = await decideInbox(inbox.service, receiptKey, inbox.proposal.proposalId, 'include', 'impact-human-include')
    assert.equal(accepted.status, 'accepted')
    assert.equal(accepted.decision, 'include')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, before + 1)
    const ledger = await readLedger(await fixture.registry.refresh(root))
    assert.equal(ledger.status, 'available')
    const decision = ledger.status === 'available' ? ledger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[accepted.candidateFingerprint]?.decision : undefined
    assert.equal(decision?.decision, 'include')
    assert.equal(decision?.review.status, 'human_confirmed')
    const objects = (await readCanonicalV04Assets(root)).objects.map((item) => item.value)
    assert.ok(objects.some((item) => item.id.startsWith('relation:') && (item as KnowledgeRelationV04).type === 'theme_exposure' && (item as KnowledgeRelationV04).sourceRef === fixture.themeRef && (item as KnowledgeRelationV04).targetRef === NEW_INDUSTRY_REF && (item as KnowledgeRelationV04).lifecycle.status === 'active'))
    const replay = await decideInbox(inbox.service, receiptKey, inbox.proposal.proposalId, 'include', 'impact-human-include')
    assert.equal(replay.status, 'accepted')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, before + 1)
    assert.equal((await inbox.service.get((await inbox.service.list()).items[0]!.receiptKey)).proposals[0]?.decision, 'include')
    await assert.rejects(inbox.service.decide({ receiptKey, proposalId: inbox.proposal.proposalId, decision: 'exclude', workflowRunId: 'impact-human-include' }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
  })
})

test('one decideBatch commits proposals for multiple Themes at one revision', async () => {
  await withKb('multi-theme-atomic', async (root) => {
    const fixture = await seedBase(root)
    const gateway = new ThemeManagementGatewayV04({ clock })
    const secondThemeResult = await gateway.createTheme(await fixture.registry.refresh(root), { name: 'Impact Second Theme' })
    assert.equal(secondThemeResult.status, 'committed')
    const relation = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === GLOBAL_RELATION_REF)!.value as KnowledgeRelationV04
    const updated = await commit(root, { changeSetId: 'changeset-impact-multi-receipt', workflowRunId: 'impact-multi-receipt', operations: [{ operationId: 'touch-impact-multi-receipt', type: 'update', knowledgeId: GLOBAL_RELATION_REF, expectedBeforeHash: hashKnowledgeObject(relation), object: { ...relation, updatedAt: NOW } }] }, fixture.registry)
    const candidates = [
      impactCandidate({ themeRef: fixture.themeRef, sourceRef: fixture.sourceRef, basedOnRevision: updated.handle.revision }),
      impactCandidate({ themeRef: secondThemeResult.themeRef!, sourceRef: fixture.sourceRef, basedOnRevision: updated.handle.revision }),
    ]
    const service = new ThemeScopeImpactService({ mountedKnowledgeBaseRoot: root, registry: fixture.registry,
      lookupAffectedThemes: async (handle) => ({ status: 'available', knowledgeBaseRevision: handle.revision, themes: [] }),
      impactRunner: async (input) => ({ status: 'completed', basedOnRevision: input.committedRevision, candidates, diagnostics: [] }),
    })
    const receipt: ThemeScopeImpactWriteReceipt = { knowledgeBaseRoot: root, knowledgeBaseId: updated.handle.knowledgeBaseId, writerRunId: 'impact-multi-receipt', changeSetId: 'changeset-impact-multi-receipt', status: 'committed', baseRevision: updated.result.baseRevision, committedRevision: updated.result.committedRevision, createdRefs: updated.result.createdIds, updatedRefs: updated.result.updatedIds }
    const record = await service.check(receipt)
    assert.equal(record.proposals.length, 2)
    const revision = record.committedRevision
    const accepted = await service.decideBatch({ receiptKey: record.receiptKey, workflowRunId: 'impact-human-multi-theme', decisions: record.proposals.map((proposal) => ({ proposalId: proposal.proposalId, decision: 'include' })) })
    assert.ok(accepted.proposals.every((proposal) => proposal.status === 'accepted' && proposal.decision === 'include'))
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, revision + 1)
    const replay = await service.decideBatch({ receiptKey: record.receiptKey, workflowRunId: 'impact-human-multi-theme', decisions: record.proposals.map((proposal) => ({ proposalId: proposal.proposalId, decision: 'include' })) })
    assert.ok(replay.proposals.every((proposal) => proposal.status === 'accepted' && proposal.decision === 'include'))
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, revision + 1)
    await assert.rejects(service.decideBatch({ receiptKey: record.receiptKey, workflowRunId: 'impact-human-multi-theme', decisions: record.proposals.map((proposal, index) => ({ proposalId: proposal.proposalId, decision: index === 0 ? 'exclude' : 'include' })) }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
    const ledger = await readLedger(await fixture.registry.refresh(root))
    assert.equal(ledger.status, 'available')
    if (ledger.status === 'available') {
      assert.equal(ledger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.history.at(-1)?.committedRevision, revision + 1)
      assert.equal(ledger.themes.find((theme) => theme.themeRef === secondThemeResult.themeRef)?.history.at(-1)?.committedRevision, revision + 1)
    }
  })
})

test('exclude and pending are durable A4 decisions without active Theme exposure', async () => {
  for (const selected of ['exclude', 'pending'] as const) {
    await withKb(selected, async (root) => {
      const fixture = await seedBase(root)
      const inbox = await inboxProposal(root, fixture)
      const record = (await inbox.service.list()).items[0]!
      const result = await decideInbox(inbox.service, record.receiptKey, inbox.proposal.proposalId, selected, `impact-human-${selected}`)
      assert.equal(result.status, 'accepted')
      assert.equal(result.decision, selected)
      const ledger = await readLedger(await fixture.registry.refresh(root))
      assert.equal(ledger.status, 'available')
      const decision = ledger.status === 'available' ? ledger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[result.candidateFingerprint]?.decision : undefined
      assert.equal(decision?.decision, selected)
      assert.equal((await readCanonicalV04Assets(root)).objects.some((item) => item.value.id.startsWith('relation:') && (item.value as KnowledgeRelationV04).type === 'theme_exposure' && (item.value as KnowledgeRelationV04).sourceRef === fixture.themeRef && (item.value as KnowledgeRelationV04).targetRef === NEW_INDUSTRY_REF && (item.value as KnowledgeRelationV04).lifecycle.status === 'active'), false)
    })
  }
})

test('reopening an excluded candidate records new Source/Raw evidence in reopenBasis', async () => {
  await withKb('reopen', async (root) => {
    const fixture = await seedBase(root)
    const initial = await inboxProposal(root, fixture)
    const initialReceiptKey = (await initial.service.list()).items[0]!.receiptKey
    const excluded = await decideInbox(initial.service, initialReceiptKey, initial.proposal.proposalId, 'exclude', 'impact-human-exclude')
    const afterExclude = await readLedger(await fixture.registry.refresh(root))
    assert.equal(afterExclude.status, 'available')
    const prior = afterExclude.status === 'available' ? afterExclude.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[excluded.candidateFingerprint]?.decision : undefined
    assert.equal(prior?.decision, 'exclude')
    assert.ok(prior)

    const registry = fixture.registry
    const handle = await registry.refresh(root)
    const raw = await archiveRaw(handle, { bytes: Buffer.from('A distinct new source that supports reconsideration.'), originalFilename: 'impact-evidence-two.txt', mediaType: 'text/plain' }, { clock })
    const secondSource: KnowledgeSourceV04 = {
      id: 'source:impact-evidence-two', title: 'Impact evidence two', sourceType: 'official_disclosure', provider: 'fixture', canonicalUrl: 'https://example.test/impact-two', retrievedAt: NOW,
      contentHash: raw.manifest.contentHash.slice('sha256:'.length), rawRefs: [raw.manifest.rawRef as `raw-sha256-${string}`],
      rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false },
      usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: { status: 'active' },
    }
    const relation = (await readCanonicalV04Assets(root)).objects.find((item) => item.value.id === GLOBAL_RELATION_REF)!.value as KnowledgeRelationV04
    const updated = await commit(root, { changeSetId: 'changeset-impact-source-two', workflowRunId: 'impact-source-two', operations: [
      { operationId: 'create-impact-source-two', type: 'create', object: secondSource },
      { operationId: 'attach-impact-source-two', type: 'update', knowledgeId: GLOBAL_RELATION_REF, expectedBeforeHash: hashKnowledgeObject(relation), object: { ...relation, sourceRefs: [fixture.sourceRef, secondSource.id] } },
    ] }, registry)
    const reopenedProposal = impactCandidate({ themeRef: fixture.themeRef, sourceRef: secondSource.id, basedOnRevision: updated.handle.revision, prior: { id: prior.id, decision: prior.decision } })
    const service = serviceFor(root, registry, () => reopenedProposal)
    const receipt: ThemeScopeImpactWriteReceipt = { knowledgeBaseRoot: root, knowledgeBaseId: updated.handle.knowledgeBaseId, writerRunId: 'impact-source-two', changeSetId: 'changeset-impact-source-two', status: 'committed', baseRevision: updated.result.baseRevision, committedRevision: updated.result.committedRevision, createdRefs: updated.result.createdIds, updatedRefs: updated.result.updatedIds }
    const record = await service.check(receipt)
    const accepted = await decideInbox(service, record.receiptKey, reopenedProposal.proposalId, 'include', 'impact-human-reopen')
    const finalLedger = await readLedger(await registry.refresh(root))
    const finalDecision = finalLedger.status === 'available' ? finalLedger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[accepted.candidateFingerprint]?.decision : undefined
    assert.equal(finalDecision?.decision, 'include')
    assert.ok(finalDecision?.reopenBasis)
    assert.deepEqual(finalDecision?.reopenBasis?.evidence.map((item) => item.sourceRef), [secondSource.id])
  })
})

test('excluded reopening without a new Source/Raw binding is blocked', async () => {
  await withKb('reopen-no-new-evidence', async (root) => {
    const fixture = await seedBase(root)
    const initial = await inboxProposal(root, fixture)
    const initialKey = (await initial.service.list()).items[0]!.receiptKey
    const excluded = await decideInbox(initial.service, initialKey, initial.proposal.proposalId, 'exclude', 'impact-human-exclude-no-new')
    const ledger = await readLedger(await fixture.registry.refresh(root))
    const prior = ledger.status === 'available' ? ledger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[excluded.candidateFingerprint]?.decision : undefined
    assert.equal(prior?.decision, 'exclude')
    assert.ok(prior)

    const registry = fixture.registry
    const thirdIndustry: KnowledgeIndustryV04 = { id: 'entity:impact-third-industry', type: 'industry', name: 'Third Industry', lifecycle: { status: 'active' } }
    const relatedEdge: KnowledgeRelationV04 = { id: 'relation:impact-related-edge', type: 'upstream_of', sourceRef: fixture.existingIndustryRef as `entity:${string}`, targetRef: thirdIndustry.id, sourceRefs: [fixture.sourceRef as `source:${string}`], lifecycle: { status: 'active' } }
    const created = await commit(root, { changeSetId: 'changeset-impact-unrelated-new-edge', workflowRunId: 'impact-unrelated-new-edge', operations: [
      { operationId: 'create-impact-third-industry', type: 'create', object: thirdIndustry },
      { operationId: 'create-impact-related-edge', type: 'create', object: relatedEdge },
    ] }, registry)
    const candidate = impactCandidate({ themeRef: fixture.themeRef, sourceRef: fixture.sourceRef, basedOnRevision: created.handle.revision, prior: { id: prior.id, decision: prior.decision }, extraEvidenceRefs: [relatedEdge.id], changedRef: relatedEdge.id })
    const service = serviceFor(root, registry, () => candidate)
    const receipt: ThemeScopeImpactWriteReceipt = { knowledgeBaseRoot: root, knowledgeBaseId: created.handle.knowledgeBaseId, writerRunId: 'impact-unrelated-new-edge', changeSetId: 'changeset-impact-unrelated-new-edge', status: 'committed', baseRevision: created.result.baseRevision, committedRevision: created.result.committedRevision, createdRefs: created.result.createdIds, updatedRefs: created.result.updatedIds }
    const proposalRecord = await service.check(receipt)
    const beforeDecisionRevision = (await loadKnowledgeBaseManifest(root)).revision
    await assert.rejects(service.decide({ receiptKey: proposalRecord.receiptKey, proposalId: candidate.proposalId, decision: 'include', workflowRunId: 'impact-human-reopen-without-new-evidence' }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, beforeDecisionRevision)
    const finalLedger = await readLedger(await registry.refresh(root))
    const finalHead = finalLedger.status === 'available' ? finalLedger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[excluded.candidateFingerprint]?.decision : undefined
    assert.equal(finalHead?.decision, 'exclude')
    assert.equal(finalHead?.id, prior.id)
  })
})

test('expired or unavailable Raw evidence cannot create an included decision', async () => {
  for (const mode of ['expired-rights', 'missing-raw'] as const) {
    await withKb(mode, async (root) => {
      const fixture = await seedBase(root)
      const registry = fixture.registry
      const handle = await registry.refresh(root)
      const raw = mode === 'expired-rights'
        ? await archiveRaw(handle, { bytes: Buffer.from('Expired evidence.'), originalFilename: 'expired.txt', mediaType: 'text/plain' }, { clock })
        : undefined
      const sourceRef = `source:impact-${mode}` as const
      const source: KnowledgeSourceV04 = {
        id: sourceRef, title: `Evidence ${mode}`, sourceType: 'official_disclosure', provider: 'fixture', canonicalUrl: `https://example.test/${mode}`, retrievedAt: NOW,
        contentHash: raw?.manifest.contentHash.slice('sha256:'.length) ?? 'b'.repeat(64),
        rawRefs: raw ? [raw.manifest.rawRef as `raw-sha256-${string}`] : [],
        rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, ...(mode === 'expired-rights' ? { expiresAt: '2020-01-01T00:00:00.000Z' } : {}) },
        usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: { status: 'active' },
      }
      const created = await commit(root, { changeSetId: `changeset-${mode}`, workflowRunId: `writer-${mode}`, operations: [{ operationId: `create-${mode}`, type: 'create', object: source }] }, registry)
      const candidate = impactCandidate({ themeRef: fixture.themeRef, sourceRef, basedOnRevision: created.handle.revision, includeRelationEvidence: false })
      const service = serviceFor(root, registry, () => candidate)
      const receipt: ThemeScopeImpactWriteReceipt = { knowledgeBaseRoot: root, knowledgeBaseId: created.handle.knowledgeBaseId, writerRunId: `writer-${mode}`, changeSetId: `changeset-${mode}`, status: 'committed', baseRevision: created.result.baseRevision, committedRevision: created.result.committedRevision, createdRefs: created.result.createdIds, updatedRefs: created.result.updatedIds }
      const proposalRecord = await service.check(receipt)
      await assert.rejects(service.decide({ receiptKey: proposalRecord.receiptKey, proposalId: candidate.proposalId, decision: 'include', workflowRunId: `impact-human-${mode}` }), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
      assert.equal((await loadKnowledgeBaseManifest(root)).revision, created.handle.revision)
      const ledger = await readLedger(await registry.refresh(root))
      assert.equal(ledger.status, 'available')
      assert.equal(ledger.status === 'available' && ledger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[candidate.candidateFingerprint], undefined)
    })
  }
})

test('Writer success with inbox sidecar failure is recovered by exact workflowRunId replay', async () => {
  await withKb('sidecar-recovery', async (root) => {
    const fixture = await seedBase(root)
    let blockedDecisionPath = ''
    const acceptance = new ThemeScopeImpactAcceptanceV04({ registry: fixture.registry, clock, writer: async (handle, receipt, options) => {
      const result = await writeKnowledgeBase(handle, receipt, options)
      if (result.status === 'committed') await writeFile(blockedDecisionPath, 'temporary obstruction', 'utf8')
      return result
    } })
    const inbox = await inboxProposal(root, fixture, undefined, acceptance)
    const receiptKey = (await inbox.service.list()).items[0]!.receiptKey
    blockedDecisionPath = join(root, 'logs', 'theme-scope-impact', 'proposals', `${receiptKey}.decisions`)
    const before = (await loadKnowledgeBaseManifest(root)).revision
    await assert.rejects(decideInbox(inbox.service, receiptKey, inbox.proposal.proposalId, 'include', 'impact-human-sidecar-recovery'), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'failed')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, before + 1)
    const ledger = await readLedger(await fixture.registry.refresh(root))
    assert.equal(ledger.status, 'available')
    assert.ok(ledger.status === 'available' && ledger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[inbox.proposal.candidateFingerprint]?.decision)
    await rm(blockedDecisionPath)
    const replay = await decideInbox(inbox.service, receiptKey, inbox.proposal.proposalId, 'include', 'impact-human-sidecar-recovery')
    assert.equal(replay.status, 'accepted')
    assert.equal(replay.decision, 'include')
    assert.equal((await loadKnowledgeBaseManifest(root)).revision, before + 1)
    assert.equal((await inbox.service.get(receiptKey)).proposals[0]?.status, 'accepted')
  })
})

test('stale proposal and failed Writer never produce accepted sidecar or partial A4 state', async () => {
  await withKb('stale-fail', async (root) => {
    const fixture = await seedBase(root)
    const staleInbox = await inboxProposal(root, fixture)
    await commit(root, { changeSetId: 'changeset-impact-unrelated', workflowRunId: 'impact-unrelated', operations: [{ operationId: 'create-impact-unrelated', type: 'create', object: { id: 'entity:impact-unrelated', type: 'industry', name: 'Unrelated Industry', lifecycle: { status: 'active' } } }] }, fixture.registry)
    const record = (await staleInbox.service.list()).items[0]!
    await assert.rejects(decideInbox(staleInbox.service, record.receiptKey, staleInbox.proposal.proposalId, 'include', 'impact-human-stale'), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'conflict')
    const staleLedger = await readLedger(await fixture.registry.refresh(root))
    assert.equal(staleLedger.status, 'available')
    assert.equal(staleLedger.status === 'available' && staleLedger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[staleInbox.proposal.candidateFingerprint], undefined)
  })

  await withKb('writer-fail', async (root) => {
    const fixture = await seedBase(root)
    const failedAcceptance = new ThemeScopeImpactAcceptanceV04({ registry: fixture.registry, clock, writer: async () => { throw new Error('injected Writer failure') } })
    const inbox = await inboxProposal(root, fixture, undefined, failedAcceptance)
    const record = (await inbox.service.list()).items[0]!
    await assert.rejects(decideInbox(inbox.service, record.receiptKey, inbox.proposal.proposalId, 'include', 'impact-human-writer-failure'), (error: unknown) => error instanceof ApplicationServiceError && error.code === 'failed')
    assert.equal((await inbox.service.get(record.receiptKey)).proposals[0]?.status, 'pending')
    assert.equal((await readCanonicalV04Assets(root)).objects.some((item) => item.value.id.startsWith('relation:') && (item.value as KnowledgeRelationV04).type === 'theme_exposure' && (item.value as KnowledgeRelationV04).sourceRef === fixture.themeRef && (item.value as KnowledgeRelationV04).targetRef === NEW_INDUSTRY_REF), false)
    const ledger = await readLedger(await fixture.registry.refresh(root))
    assert.equal(ledger.status, 'available')
    assert.equal(ledger.status === 'available' && ledger.themes.find((theme) => theme.themeRef === fixture.themeRef)?.currentByCandidateFingerprint[inbox.proposal.candidateFingerprint], undefined)
  })
})
