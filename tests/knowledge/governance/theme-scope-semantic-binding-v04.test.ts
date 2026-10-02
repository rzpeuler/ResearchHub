import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { archiveRaw } from '../../../knowledge/raw/raw-archive.ts'
import {
  createThemeScopeDecisionV04,
  fingerprintThemeScopeCandidateV04,
  type ThemeScopeCandidateV04,
  type ThemeScopeDecisionBatchV04,
  type ThemeScopeDecisionDraftV04,
  type ThemeScopeDecisionV04,
  type ThemeScopeEvidenceV04,
} from '../../../knowledge/governance/theme-scope-v04.ts'
import { ThemeManagementGatewayV04 } from '../../../knowledge/production/theme-management-v04.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import type { KnowledgeAssetV04, KnowledgeClaimV04, KnowledgeIndustryV04, KnowledgeRelationV04, KnowledgeSourceV04 } from '../../../knowledge/schema/domain-v04.ts'
import type { KnowledgeChangeSetV04, KnowledgeOperationV04 } from '../../../knowledge/schema/mutation-v04.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { hashKnowledgeObject } from '../../../knowledge/storage/canonical-hash.ts'
import { validateKnowledgeChangeSetV04 } from '../../../knowledge/validation/v04-change-set-validator.ts'
import { writeKnowledgeBase } from '../../../knowledge/writer/writer.ts'

const NOW = '2026-10-02T00:00:00.000Z'
const clock = () => NOW
const SOURCE_REF = 'source:theme-scope-evidence' as const

async function withFreshKb(name: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), `rhl-theme-scope-semantic-${name}-`))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: `kb-theme-scope-semantic-${name}`, now: NOW })
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function mount(root: string) {
  return new KnowledgeBaseRegistry().mount(root)
}

async function createTheme(root: string, name: string): Promise<string> {
  const result = await new ThemeManagementGatewayV04({ clock }).createTheme(await mount(root), { name })
  assert.equal(result.status, 'committed', result.errors.map((error) => error.message).join('; '))
  assert.ok(result.themeRef)
  return result.themeRef
}

async function commitOperations(root: string, runId: string, operations: readonly KnowledgeOperationV04[], scope?: ThemeScopeDecisionBatchV04): Promise<void> {
  const handle = await mount(root)
  const changeSet: KnowledgeChangeSetV04 = {
    changeSetId: `changeset-${runId}`,
    workflowRunId: runId,
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations,
    ...(scope === undefined ? {} : { ingestionContext: { producerType: 'theme_framework', themeScope: scope } }),
  }
  const validation = await validateKnowledgeChangeSetV04(handle, changeSet, { mode: 'commit', now: clock })
  assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  const result = await writeKnowledgeBase(handle, validation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock })
  assert.equal(result.status, 'committed', result.error?.message)
}

async function seedEvidence(root: string): Promise<{ readonly rawRef: `raw-sha256-${string}`; readonly evidence: ThemeScopeEvidenceV04 }> {
  const handle = await mount(root)
  const raw = await archiveRaw(handle, { bytes: Buffer.from(`theme scope evidence ${root}`), originalFilename: 'scope.txt', mediaType: 'text/plain' }, { clock })
  const source: KnowledgeSourceV04 = {
    id: SOURCE_REF,
    title: 'Theme scope evidence source',
    sourceType: 'official_disclosure',
    provider: 'test-fixture',
    canonicalUrl: 'https://example.com/theme-scope',
    retrievedAt: NOW,
    contentHash: raw.manifest.contentHash.slice('sha256:'.length),
    rawRefs: [raw.manifest.rawRef as `raw-sha256-${string}`],
    rights: {
      accessScope: 'public',
      providerTermsKnown: true,
      retentionAllowed: true,
      aiProcessingAllowed: true,
      derivativeKnowledgeAllowed: true,
      redistributionAllowed: false,
    },
    usagePolicy: {
      mode: 'personal_noncommercial_research',
      retainRaw: true,
      allowAiProcessing: true,
      allowDerivedKnowledge: true,
      redistributionAllowed: false,
    },
    lifecycle: { status: 'active' },
  }
  await commitOperations(root, 'seed-theme-scope-source', [{ operationId: 'create-theme-scope-source', type: 'create', object: source }])
  return {
    rawRef: raw.manifest.rawRef as `raw-sha256-${string}`,
    evidence: { sourceRef: SOURCE_REF, rawRef: raw.manifest.rawRef as `raw-sha256-${string}`, locator: 'page 1, paragraph 2' },
  }
}

function industry(id: string, name = id, aliases?: readonly string[]): KnowledgeIndustryV04 {
  return { id: `entity:${id}`, type: 'industry', name, ...(aliases === undefined ? {} : { aliases: [...aliases] }), lifecycle: { status: 'active' } }
}

function exposure(id: string, themeRef: string, industryRef: string, sourceRefs: readonly string[] = [SOURCE_REF]): KnowledgeRelationV04 {
  return {
    id: `relation:${id}`,
    type: 'theme_exposure',
    sourceRef: themeRef as `entity:${string}`,
    targetRef: industryRef as `entity:${string}`,
    sourceRefs: [...sourceRefs] as `source:${string}`[],
    lifecycle: { status: 'active' },
  }
}

function industryCandidate(name: string, canonicalRef?: string): ThemeScopeCandidateV04 {
  return { kind: 'industry', name, ...(canonicalRef === undefined ? {} : { canonicalRef: canonicalRef as `entity:${string}` }) }
}

function relationCandidate(
  relationType: 'upstream_of' | 'depends_on',
  sourceFingerprint: string,
  targetFingerprint: string,
  canonicalRef?: string,
): ThemeScopeCandidateV04 {
  return {
    kind: 'relation',
    relationType,
    sourceFingerprint: sourceFingerprint as `sha256:${string}`,
    targetFingerprint: targetFingerprint as `sha256:${string}`,
    ...(canonicalRef === undefined ? {} : { canonicalRef: canonicalRef as `relation:${string}` }),
  }
}

function decision(
  themeRef: string,
  revision: number,
  candidate: ThemeScopeCandidateV04,
  value: 'include' | 'exclude' | 'pending',
  evidence: readonly ThemeScopeEvidenceV04[],
  previousDecisionId?: ThemeScopeDecisionDraftV04['previousDecisionId'],
): ThemeScopeDecisionV04 {
  return createThemeScopeDecisionV04({
    version: '0.4',
    themeRef: themeRef as ThemeScopeDecisionDraftV04['themeRef'],
    candidate,
    candidateFingerprint: fingerprintThemeScopeCandidateV04(candidate),
    decision: value,
    rationale: `Reviewed ${candidate.kind} scope decision.`,
    evidence,
    coverageGaps: [],
    review: { status: 'human_confirmed', confirmedAt: NOW },
    basedOnRevision: revision,
    affectedBranchKeys: ['theme-scope'],
    ...(previousDecisionId === undefined ? {} : { previousDecisionId }),
  })
}

function batch(themeRef: string, revision: number, decisions: readonly ThemeScopeDecisionV04[]): ThemeScopeDecisionBatchV04 {
  return { version: '0.4', themeRef: themeRef as ThemeScopeDecisionBatchV04['themeRef'], basedOnRevision: revision, decisions }
}

function makeChangeSet(
  handle: Awaited<ReturnType<typeof mount>>,
  runId: string,
  scope: ThemeScopeDecisionBatchV04,
  operations: readonly KnowledgeOperationV04[],
): KnowledgeChangeSetV04 {
  return {
    changeSetId: `changeset-${runId}`,
    workflowRunId: runId,
    knowledgeBaseId: handle.knowledgeBaseId,
    schemaVersion: '0.4',
    storageFormatVersion: '1',
    expectedBaseRevision: handle.revision,
    operations,
    ingestionContext: { producerType: 'theme_framework', themeScope: scope },
  }
}

function createOperation(operationId: string, object: KnowledgeAssetV04): KnowledgeOperationV04 {
  return { operationId, type: 'create', object }
}

async function validateScope(
  root: string,
  themeRef: string,
  decisions: readonly ThemeScopeDecisionV04[],
  operations: readonly KnowledgeOperationV04[] = [],
  runId = 'semantic-scope-validation',
) {
  const handle = await mount(root)
  return validateKnowledgeChangeSetV04(handle, makeChangeSet(handle, runId, batch(themeRef, handle.revision, decisions), operations), { mode: 'commit', now: clock })
}

test('human-confirmed Industry include binds active canonical exposure evidence and allows independent/cross-linked scope nodes', async () => {
  await withFreshKb('positive-network', async (root) => {
    const themeRef = await createTheme(root, 'AI Compute')
    const { evidence } = await seedEvidence(root)
    const handle = await mount(root)
    const unresolvedIndustry = decision(themeRef, handle.revision, industryCandidate('Missing canonical Industry', 'entity:semantic-missing-industry'), 'pending', [evidence])
    const unresolvedIndustryValidation = await validateScope(root, themeRef, [unresolvedIndustry], [], 'missing-canonical-industry')
    assert.equal(unresolvedIndustryValidation.validatedChangeSet, undefined)
    assert.ok(unresolvedIndustryValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_INDUSTRY_CANONICAL_REF_INVALID'))
    const accelerator = industry('semantic-accelerator', 'Compute accelerators', ['AI Accelerators'])
    const packaging = industry('semantic-packaging', 'Advanced packaging')
    const infrastructure = industry('semantic-infrastructure', 'Data center infrastructure')
    const acceleratorCandidate = industryCandidate(' ai   accelerators ', accelerator.id)
    const packagingCandidate = industryCandidate(packaging.name, packaging.id)
    const infrastructureCandidate = industryCandidate(infrastructure.name, infrastructure.id)
    const wrongName = decision(themeRef, handle.revision, industryCandidate('Unrelated candidate name', infrastructure.id), 'pending', [evidence])
    const wrongNameValidation = await validateScope(root, themeRef, [wrongName], [createOperation('create-name-mismatch-industry', infrastructure)], 'industry-name-mismatch')
    assert.equal(wrongNameValidation.validatedChangeSet, undefined)
    assert.ok(wrongNameValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_INDUSTRY_NAME_MISMATCH'))
    const edge = relationCandidate(
      'upstream_of',
      fingerprintThemeScopeCandidateV04(acceleratorCandidate),
      fingerprintThemeScopeCandidateV04(packagingCandidate),
      'relation:semantic-accelerator-packaging',
    )
    const decisions = [
      decision(themeRef, handle.revision, acceleratorCandidate, 'include', [evidence]),
      decision(themeRef, handle.revision, packagingCandidate, 'include', [evidence]),
      decision(themeRef, handle.revision, infrastructureCandidate, 'include', [evidence]),
      decision(themeRef, handle.revision, edge, 'include', [evidence]),
    ]
    const relation: KnowledgeRelationV04 = {
      id: 'relation:semantic-accelerator-packaging',
      type: 'upstream_of',
      sourceRef: accelerator.id,
      targetRef: packaging.id,
      sourceRefs: [SOURCE_REF],
      lifecycle: { status: 'active' },
    }
    const operations = [
      createOperation('create-accelerator', accelerator),
      createOperation('create-packaging', packaging),
      createOperation('create-infrastructure', infrastructure),
      createOperation('expose-accelerator', exposure('semantic-expose-accelerator', themeRef, accelerator.id)),
      createOperation('expose-packaging', exposure('semantic-expose-packaging', themeRef, packaging.id)),
      createOperation('expose-infrastructure', exposure('semantic-expose-infrastructure', themeRef, infrastructure.id)),
      createOperation('create-cross-link', relation),
    ]
    const validation = await validateKnowledgeChangeSetV04(handle, makeChangeSet(handle, 'semantic-positive-network', batch(themeRef, handle.revision, decisions), operations), { mode: 'commit', now: clock })
    assert.ok(validation.validatedChangeSet, JSON.stringify(validation.report.errors))
  })
})

test('a Relation cannot borrow overlapping Source evidence from an unrelated supporting Claim', async () => {
  await withFreshKb('unrelated-supporting-claim', async (root) => {
    const themeRef = await createTheme(root, 'Claim Link Theme')
    const { evidence } = await seedEvidence(root)
    const handle = await mount(root)
    const item = industry('semantic-claim-link-industry', 'Claim link industry')
    const candidate = industryCandidate(item.name, item.id)
    const unrelatedClaim: KnowledgeClaimV04 = {
      id: 'claim:unrelated-theme-exposure-evidence',
      claimType: 'fact',
      statement: 'A fact about the Industry that does not support its Theme exposure.',
      subjectRefs: [item.id],
      sourceRefs: [evidence.sourceRef],
      provenance: [{ sourceRef: evidence.sourceRef, rawRef: evidence.rawRef, locator: evidence.locator, chunkRef: null }],
      lifecycle: { status: 'active' },
    }
    const exposureWithUnrelatedClaim: KnowledgeRelationV04 = {
      id: 'relation:semantic-claim-link-exposure',
      type: 'theme_exposure',
      sourceRef: themeRef as `entity:${string}`,
      targetRef: item.id,
      supportingClaimRefs: [unrelatedClaim.id],
      lifecycle: { status: 'active' },
    }
    const scopeDecision = decision(themeRef, handle.revision, candidate, 'include', [evidence])
    const validation = await validateKnowledgeChangeSetV04(handle, makeChangeSet(handle, 'unrelated-supporting-claim', batch(themeRef, handle.revision, [scopeDecision]), [
      createOperation('create-claim-link-industry', item),
      createOperation('create-unrelated-theme-claim', unrelatedClaim),
      createOperation('create-exposure-with-unrelated-claim', exposureWithUnrelatedClaim),
    ]), { mode: 'commit', now: clock })
    assert.equal(validation.validatedChangeSet, undefined)
    assert.ok(validation.report.errors.some((error) => error.code === 'THEME_SCOPE_INDUSTRY_EXPOSURE_EVIDENCE_REQUIRED'), JSON.stringify(validation.report.errors))
  })
})

test('scope decisions bind canonical identity across versions and an Industry exclude preserves global and other-Theme facts', async () => {
  await withFreshKb('exclude-preserves-global', async (root) => {
    const themeRef = await createTheme(root, 'Theme A')
    const otherThemeRef = await createTheme(root, 'Theme B')
    const { evidence } = await seedEvidence(root)
    const item = industry('semantic-preserved-industry', 'Preserved industry')
    const themeExposure = exposure('semantic-preserved-theme-a-exposure', themeRef, item.id)
    const otherExposure = exposure('semantic-preserved-theme-b-exposure', otherThemeRef, item.id)
    await commitOperations(root, 'seed-preserved-industry', [
      createOperation('create-preserved-industry', item),
      createOperation('create-theme-a-exposure', themeExposure),
      createOperation('create-theme-b-exposure', otherExposure),
    ])

    const firstHandle = await mount(root)
    const candidate = industryCandidate(item.name, item.id)
    const included = decision(themeRef, firstHandle.revision, candidate, 'include', [evidence])
    await commitOperations(root, 'include-preserved-industry', [], batch(themeRef, firstHandle.revision, [included]))

    const nextHandle = await mount(root)
    const excluded = decision(themeRef, nextHandle.revision, candidate, 'exclude', [evidence], included.id)
    const actualExposure = (await readCanonicalV04Assets(root)).objects.find((entry) => entry.value.id === themeExposure.id)!.value as KnowledgeRelationV04
    const archivedExposure: KnowledgeRelationV04 = { ...actualExposure, lifecycle: { status: 'archived' } }
    const updateExposure: KnowledgeOperationV04 = {
      operationId: 'archive-theme-a-exposure',
      type: 'update',
      knowledgeId: actualExposure.id,
      expectedBeforeHash: hashKnowledgeObject(actualExposure),
      object: archivedExposure,
    }
    await commitOperations(root, 'exclude-preserved-industry', [updateExposure], batch(themeRef, nextHandle.revision, [excluded]))

    const objects = (await readCanonicalV04Assets(root)).objects.map((entry) => entry.value)
    assert.ok(objects.some((object) => object.id === item.id && object.type === 'industry'))
    assert.equal((objects.find((object) => object.id === themeExposure.id) as KnowledgeRelationV04).lifecycle.status, 'archived')
    assert.equal((objects.find((object) => object.id === otherExposure.id) as KnowledgeRelationV04).lifecycle.status, 'active')

    const latest = await mount(root)
    const omittedBinding = decision(themeRef, latest.revision, industryCandidate(item.name), 'exclude', [evidence], excluded.id)
    const omittedValidation = await validateScope(root, themeRef, [omittedBinding], [], 'omit-canonical-binding')
    assert.equal(omittedValidation.validatedChangeSet, undefined)
    assert.ok(omittedValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_CANONICAL_BINDING_CHANGED'))

    const rebound = decision(themeRef, latest.revision, industryCandidate(item.name, 'entity:semantic-other-industry'), 'exclude', [evidence], excluded.id)
    const rebindValidation = await validateScope(root, themeRef, [rebound], [], 'rebind-canonical-binding')
    assert.equal(rebindValidation.validatedChangeSet, undefined)
    assert.ok(rebindValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_CANONICAL_BINDING_CHANGED'))
  })
})

test('an edge may be included in a later scope batch and excluded without archiving the global Relation', async () => {
  await withFreshKb('incremental-edge', async (root) => {
    const themeRef = await createTheme(root, 'Incremental Theme')
    const { evidence } = await seedEvidence(root)
    const firstHandle = await mount(root)
    const upstream = industry('semantic-incremental-upstream', 'Upstream industry')
    const downstream = industry('semantic-incremental-downstream', 'Downstream industry')
    const upstreamCandidate = industryCandidate(upstream.name, upstream.id)
    const downstreamCandidate = industryCandidate(downstream.name, downstream.id)
    const upstreamDecision = decision(themeRef, firstHandle.revision, upstreamCandidate, 'include', [evidence])
    const downstreamDecision = decision(themeRef, firstHandle.revision, downstreamCandidate, 'include', [evidence])
    await commitOperations(root, 'incremental-first-nodes', [
      createOperation('create-incremental-upstream', upstream),
      createOperation('create-incremental-downstream', downstream),
      createOperation('expose-incremental-upstream', exposure('incremental-upstream-exposure', themeRef, upstream.id)),
      createOperation('expose-incremental-downstream', exposure('incremental-downstream-exposure', themeRef, downstream.id)),
    ], batch(themeRef, firstHandle.revision, [upstreamDecision, downstreamDecision]))

    const secondHandle = await mount(root)
    const relation: KnowledgeRelationV04 = {
      id: 'relation:semantic-incremental-edge',
      type: 'depends_on',
      sourceRef: upstream.id,
      targetRef: downstream.id,
      sourceRefs: [SOURCE_REF],
      lifecycle: { status: 'active' },
    }
    const edgeCandidate = relationCandidate(
      'depends_on',
      fingerprintThemeScopeCandidateV04(upstreamCandidate),
      fingerprintThemeScopeCandidateV04(downstreamCandidate),
      relation.id,
    )
    const includedEdge = decision(themeRef, secondHandle.revision, edgeCandidate, 'include', [evidence])
    const edgeValidation = await validateKnowledgeChangeSetV04(secondHandle, makeChangeSet(secondHandle, 'incremental-edge-include', batch(themeRef, secondHandle.revision, [includedEdge]), [createOperation('create-incremental-edge', relation)]), { mode: 'commit', now: clock })
    assert.ok(edgeValidation.validatedChangeSet, JSON.stringify(edgeValidation.report.errors))
    const edgeWrite = await writeKnowledgeBase(secondHandle, edgeValidation.validatedChangeSet, { registry: new KnowledgeBaseRegistry(), clock })
    assert.equal(edgeWrite.status, 'committed', edgeWrite.error?.message)

    const thirdHandle = await mount(root)
    const excludedEdge = decision(themeRef, thirdHandle.revision, edgeCandidate, 'exclude', [evidence], includedEdge.id)
    await commitOperations(root, 'incremental-edge-exclude', [], batch(themeRef, thirdHandle.revision, [excludedEdge]))
    const retained = (await readCanonicalV04Assets(root)).objects.find((entry) => entry.value.id === relation.id)?.value as KnowledgeRelationV04
    assert.equal(retained.lifecycle.status, 'active')
  })
})

test('wrong directed endpoints and endpoints outside the Theme block relation inclusion', async () => {
  await withFreshKb('edge-boundaries', async (root) => {
    const themeRef = await createTheme(root, 'Boundary Theme')
    const otherThemeRef = await createTheme(root, 'Other Boundary Theme')
    const { evidence } = await seedEvidence(root)
    const handle = await mount(root)
    const left = industry('semantic-boundary-left', 'Left industry')
    const right = industry('semantic-boundary-right', 'Right industry')
    const leftCandidate = industryCandidate(left.name, left.id)
    const rightCandidate = industryCandidate(right.name, right.id)
    const canonicalEdge: KnowledgeRelationV04 = {
      id: 'relation:semantic-boundary-edge',
      type: 'upstream_of',
      sourceRef: right.id,
      targetRef: left.id,
      sourceRefs: [SOURCE_REF],
      lifecycle: { status: 'active' },
    }
    const edgeCandidate = relationCandidate(
      'upstream_of',
      fingerprintThemeScopeCandidateV04(leftCandidate),
      fingerprintThemeScopeCandidateV04(rightCandidate),
      canonicalEdge.id,
    )
    const objects = [
      createOperation('create-boundary-left', left),
      createOperation('create-boundary-right', right),
      createOperation('expose-boundary-left', exposure('boundary-left-exposure', themeRef, left.id)),
      createOperation('expose-boundary-right', exposure('boundary-right-exposure', themeRef, right.id)),
      createOperation('create-reversed-boundary-edge', canonicalEdge),
    ]
    const wrongDirection = await validateScope(root, themeRef, [
      decision(themeRef, handle.revision, leftCandidate, 'include', [evidence]),
      decision(themeRef, handle.revision, rightCandidate, 'include', [evidence]),
      decision(themeRef, handle.revision, edgeCandidate, 'include', [evidence]),
    ], objects, 'wrong-edge-direction')
    assert.equal(wrongDirection.validatedChangeSet, undefined)
    assert.ok(wrongDirection.report.errors.some((error) => error.code === 'THEME_SCOPE_RELATION_ENDPOINT_OUTSIDE_THEME'))

    const rightOnlyInOtherTheme = exposure('boundary-right-other-theme-exposure', otherThemeRef, right.id)
    const outsideThemeEdge: KnowledgeRelationV04 = { ...canonicalEdge, id: 'relation:semantic-outside-theme-edge', sourceRef: left.id, targetRef: right.id }
    const outsideCandidate = relationCandidate(
      'upstream_of',
      fingerprintThemeScopeCandidateV04(leftCandidate),
      fingerprintThemeScopeCandidateV04(rightCandidate),
      outsideThemeEdge.id,
    )
    await commitOperations(root, 'edge-outside-theme-nodes', [
      createOperation('create-outside-left', left),
      createOperation('create-outside-right', right),
      createOperation('expose-outside-left', exposure('outside-left-exposure', themeRef, left.id)),
      createOperation('expose-right-other-theme', rightOnlyInOtherTheme),
    ], batch(themeRef, handle.revision, [
      decision(themeRef, handle.revision, leftCandidate, 'include', [evidence]),
      decision(themeRef, handle.revision, rightCandidate, 'pending', [evidence]),
    ]))
    const outsideHandle = await mount(root)
    const outsideValidation = await validateScope(root, themeRef, [
      decision(themeRef, outsideHandle.revision, outsideCandidate, 'include', [evidence]),
    ], [createOperation('create-outside-edge', outsideThemeEdge)], 'edge-outside-theme')
    assert.equal(outsideValidation.validatedChangeSet, undefined)
    assert.ok(outsideValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_RELATION_ENDPOINT_OUTSIDE_THEME'), JSON.stringify(outsideValidation.report.errors))
    assert.ok(outsideValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_RELATION_THEME_EXPOSURE_REQUIRED'), JSON.stringify(outsideValidation.report.errors))

    const reversedPendingRelation: KnowledgeRelationV04 = {
      id: 'relation:semantic-reversed-pending-edge',
      type: 'upstream_of',
      sourceRef: right.id,
      targetRef: left.id,
      sourceRefs: [SOURCE_REF],
      lifecycle: { status: 'active' },
    }
    const reversedPendingCandidate = relationCandidate(
      'upstream_of',
      fingerprintThemeScopeCandidateV04(leftCandidate),
      fingerprintThemeScopeCandidateV04(rightCandidate),
      reversedPendingRelation.id,
    )
    for (const decisionValue of ['pending', 'exclude'] as const) {
      const misboundRelation = decision(themeRef, outsideHandle.revision, reversedPendingCandidate, decisionValue, [evidence])
      const misboundValidation = await validateScope(root, themeRef, [misboundRelation], [createOperation(`create-${decisionValue}-reversed-edge`, reversedPendingRelation)], `reversed-edge-${decisionValue}`)
      assert.equal(misboundValidation.validatedChangeSet, undefined)
      assert.ok(misboundValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_RELATION_ENDPOINT_BINDING_INVALID'), JSON.stringify(misboundValidation.report.errors))
    }
  })
})

test('include evidence fails closed for missing bindings, unowned Raw, and ineligible Source policy', async () => {
  await withFreshKb('evidence-boundary', async (root) => {
    const themeRef = await createTheme(root, 'Evidence Boundary Theme')
    const { rawRef, evidence } = await seedEvidence(root)
    const secondRaw = await archiveRaw(await mount(root), { bytes: Buffer.from(`unowned theme scope evidence ${root}`), originalFilename: 'other.txt', mediaType: 'text/plain' }, { clock })
    const handle = await mount(root)
    const item = industry('semantic-evidence-industry', 'Evidence industry')
    const candidate = industryCandidate(item.name, item.id)
    const exposureRelation = exposure('semantic-evidence-exposure', themeRef, item.id)
    const operations = [createOperation('create-evidence-industry', item), createOperation('create-evidence-exposure', exposureRelation)]

    const missingEvidence = decision(themeRef, handle.revision, candidate, 'include', [])
    const missingValidation = await validateScope(root, themeRef, [missingEvidence], operations, 'missing-scope-evidence')
    assert.equal(missingValidation.validatedChangeSet, undefined)
    assert.ok(missingValidation.report.errors.some((error) => error.message.includes('THEME_SCOPE_INCLUDE_EVIDENCE')))

    const unownedRawEvidence = { ...evidence, rawRef: secondRaw.manifest.rawRef as `raw-sha256-${string}` }
    const unownedRawDecision = decision(themeRef, handle.revision, candidate, 'include', [unownedRawEvidence])
    const rawValidation = await validateScope(root, themeRef, [unownedRawDecision], operations, 'unowned-scope-raw')
    assert.equal(rawValidation.validatedChangeSet, undefined)
    assert.ok(rawValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_EVIDENCE_RAW_INVALID'))
    assert.notEqual(rawRef, secondRaw.manifest.rawRef)

    const assets = await readCanonicalV04Assets(root)
    const source = assets.objects.find((entry) => entry.value.id === SOURCE_REF)?.value as KnowledgeSourceV04
    const ineligibleSource: KnowledgeSourceV04 = { ...source, usagePolicy: { ...source.usagePolicy, allowDerivedKnowledge: false } }
    const updateSource: KnowledgeOperationV04 = {
      operationId: 'disable-derived-source-policy',
      type: 'update',
      knowledgeId: source.id,
      expectedBeforeHash: hashKnowledgeObject(source),
      object: ineligibleSource,
    }
    const rightsDecision = decision(themeRef, handle.revision, candidate, 'include', [evidence])
    const rightsValidation = await validateScope(root, themeRef, [rightsDecision], [...operations, updateSource], 'ineligible-scope-source')
    assert.equal(rightsValidation.validatedChangeSet, undefined)
    assert.ok(rightsValidation.report.errors.some((error) => error.code === 'THEME_SCOPE_EVIDENCE_SOURCE_POLICY_INELIGIBLE'))
  })
})
