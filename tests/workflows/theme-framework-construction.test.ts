import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../plugins/reasoning/contracts.ts'
import type { ThemeFrameworkInput } from '../../skills/theme-framework/contracts.ts'
import {
  runThemeFrameworkConstruction,
  reviewThemeFrameworkConstruction,
  type ThemeFrameworkAtomicCommitPort,
  type ThemeFrameworkConstructionPorts,
  type ThemeFrameworkKnowledgeSnapshot,
} from '../../workflows/theme-framework-construction/index.ts'

const frameworkOutput = {
  proposedDefinition: { statement: 'Industries materially enabling AI compute capacity.', status: 'supported', evidenceRefs: ['e-kb'] },
  inclusionPrinciples: ['Materially enables AI compute capacity.'],
  exclusionPrinciples: ['Exclude unrelated downstream markets.'],
  industryCandidates: [
    {
      candidateId: 'accelerators', name: 'Compute accelerators', description: 'Design and supply compute accelerators.',
      independentlyResearchableRationale: 'Has distinct supply and competition.', themeRelevanceRationale: 'Determines compute capacity.',
      boundaryRationale: 'Directly relevant to the stated Theme.', recommendation: 'include', decisionChange: 'new', evidenceRefs: ['e-kb'], coverageGaps: [],
    },
    {
      candidateId: 'consumer', name: 'Consumer electronics', description: 'End-user electronic devices.',
      independentlyResearchableRationale: 'Has distinct downstream markets.', themeRelevanceRationale: 'Indirect demand relation only.',
      boundaryRationale: 'Outside the compute infrastructure scope.', recommendation: 'exclude', decisionChange: 'new', evidenceRefs: ['e-kb'], coverageGaps: [],
    },
    {
      candidateId: 'packaging', name: 'Advanced packaging', description: 'Package technologies for accelerators.',
      independentlyResearchableRationale: 'Has distinct capacity and qualification.', themeRelevanceRationale: 'May constrain accelerator supply.',
      boundaryRationale: 'Need evidence to establish present relevance.', recommendation: 'pending', decisionChange: 'new', evidenceRefs: [], coverageGaps: ['Qualification data unavailable.'],
    },
  ],
  relationCandidates: [],
  coverageGaps: [{ gapId: 'gap-packaging', question: 'What is qualified package capacity?', reason: 'No validated capacity evidence.', affectedCandidateIds: ['packaging'] }],
}

const snapshot: ThemeFrameworkKnowledgeSnapshot = {
  knowledgeBaseId: 'kb-test',
  revision: 7,
  summary: 'Existing canonical Industry and evidence summary.',
  industries: [],
  evidence: [{ evidenceId: 'e-kb', origin: 'existing_kb', description: 'Existing KB evidence', sourceRef: 'claim:existing' }],
  durableEvidenceBindings: [{ evidenceId: 'e-kb', sourceRef: 'source:existing', rawRef: `raw-sha256-${'a'.repeat(64)}` }],
  priorDecisions: [],
}

function executor(outputs: unknown[] = [frameworkOutput], requests: ReasoningRequest[] = []): ReasoningExecutor {
  return {
    capabilities: () => ({ maxContextTokens: 8000, maxOutputTokens: 4000, structuredOutputSupport: true, maxConcurrency: 1 }),
    execute: async (request): Promise<ReasoningResult> => {
      requests.push(request)
      return { operation: request.operation, output: outputs.shift() }
    },
  }
}

function ports(overrides: Partial<ThemeFrameworkConstructionPorts> = {}): ThemeFrameworkConstructionPorts {
  return {
    readKnowledgeSnapshot: async () => snapshot,
    reasoningExecutor: executor(),
    ...overrides,
  }
}

async function candidateOrFail(portsValue = ports()) {
  const result = await runThemeFrameworkConstruction({ workflowRunId: 'theme-run-1', themeName: 'AI Compute' }, portsValue)
  assert.equal(result.status, 'awaiting_review', JSON.stringify(result))
  if (result.status !== 'awaiting_review') throw new Error('expected review candidate')
  return result.candidate
}

test('construction reads Knowledge first, bounds Plugin acquisition, and returns a reviewable candidate', async () => {
  const order: string[] = []
  let requestedBudget = 0
  const requests: ReasoningRequest[] = []
  const acquisitionEvidence: ThemeFrameworkInput['evidence'][number][] = Array.from({ length: 30 }, (_, index) => ({
    evidenceId: `e-ext-${index}`, origin: 'external', description: `Source ${index}`, sourceRef: `source:${index}`,
  }))
  const result = await runThemeFrameworkConstruction({ workflowRunId: 'theme-run-1', themeName: ' AI   Compute ' }, ports({
    readKnowledgeSnapshot: async () => { order.push('knowledge'); return snapshot },
    acquisition: { acquire: async ({ maxSources }) => { order.push('acquisition'); requestedBudget = maxSources; return { status: 'partial', evidence: acquisitionEvidence } } },
    reasoningExecutor: executor([frameworkOutput], requests),
  }))
  assert.equal(result.status, 'awaiting_review')
  assert.deepEqual(order, ['knowledge', 'acquisition', 'knowledge'])
  assert.equal(requestedBudget, 24)
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.operation, 'theme_framework_semantic')
  if (result.status === 'awaiting_review') {
    assert.equal(result.candidate.theme.name, 'AI Compute')
    assert.equal(result.candidate.basedOnRevision, 7)
    assert.equal(result.candidate.acquisitionStatus, 'partial')
    assert.equal(result.candidate.framework.industryCandidates.length, 3)
  }
})

test('unavailable external sources are visible while the Workflow can still use existing KB evidence', async () => {
  const result = await runThemeFrameworkConstruction({ workflowRunId: 'theme-run-1', themeName: 'AI Compute' }, ports({
    acquisition: { acquire: async () => ({ status: 'unavailable', reason: 'provider offline' }) },
  }))
  assert.equal(result.status, 'awaiting_review')
  if (result.status === 'awaiting_review') {
    assert.equal(result.candidate.acquisitionStatus, 'unavailable')
    assert.ok(result.candidate.diagnostics.some((item) => item.includes('provider offline')))
  }
})

test('name-only Theme can be accepted with pending scope when acquisition is unavailable and no durable evidence exists', async () => {
  const noEvidenceSnapshot: ThemeFrameworkKnowledgeSnapshot = {
    ...snapshot,
    summary: '',
    industries: [],
    evidence: [],
    durableEvidenceBindings: [],
  }
  const pendingOutput = {
    proposedDefinition: { statement: 'Provisional definition pending evidence.', status: 'provisional', evidenceRefs: [] },
    inclusionPrinciples: [],
    exclusionPrinciples: [],
    industryCandidates: [{
      candidateId: 'compute', name: 'Compute infrastructure', description: 'Compute infrastructure industry.',
      independentlyResearchableRationale: 'A coherent research area.', themeRelevanceRationale: 'Potentially relevant to the requested Theme.',
      boundaryRationale: 'Needs source confirmation before inclusion.', recommendation: 'pending', decisionChange: 'new',
      evidenceRefs: [], coverageGaps: ['No eligible sources were available.'],
    }],
    relationCandidates: [],
    coverageGaps: [{ gapId: 'gap-sources', question: 'Which industries belong?', reason: 'No eligible sources.', affectedCandidateIds: ['compute'] }],
  }
  const candidate = await candidateOrFail(ports({
    readKnowledgeSnapshot: async () => noEvidenceSnapshot,
    acquisition: { acquire: async () => ({ status: 'unavailable', reason: 'provider offline' }) },
    reasoningExecutor: executor([pendingOutput]),
  }))
  let committedDecisions = 0
  const result = await reviewThemeFrameworkConstruction({ candidate, disposition: 'accept' }, {
    commitThemeFrameworkAtomically: async ({ decisions }) => {
      committedDecisions = decisions.length
      return { status: 'committed', themeRef: 'entity:theme', committedRevision: 8 }
    },
  })
  assert.equal(result.status, 'committed')
  assert.equal(committedDecisions, 1)
  if (result.status === 'committed') assert.equal(result.decisions[0]?.decision, 'pending')
})

test('rejecting the Chat review makes no canonical commit', async () => {
  const candidate = await candidateOrFail()
  let commitCalls = 0
  const commit: ThemeFrameworkAtomicCommitPort = { commitThemeFrameworkAtomically: async () => { commitCalls += 1; return { status: 'committed', themeRef: 'entity:theme', committedRevision: 8 } } }
  const result = await reviewThemeFrameworkConstruction({ candidate, disposition: 'reject' }, commit)
  assert.equal(result.status, 'rejected')
  assert.equal(commitCalls, 0)
})

test('partial human decisions preserve excluded and pending candidates, passing only durable evidence to atomic writer', async () => {
  const partialOutput = structuredClone(frameworkOutput)
  partialOutput.industryCandidates[1]!.evidenceRefs = ['e-web']
  const candidate = await candidateOrFail(ports({
    acquisition: { acquire: async () => ({ status: 'available', evidence: [{ evidenceId: 'e-web', origin: 'external', description: 'Web evidence', sourceRef: 'https://example.test' }] }) },
    reasoningExecutor: executor([partialOutput]),
  }))
  let committedInput: Parameters<ThemeFrameworkAtomicCommitPort['commitThemeFrameworkAtomically']>[0] | undefined
  const commit: ThemeFrameworkAtomicCommitPort = { commitThemeFrameworkAtomically: async (input) => { committedInput = input; return { status: 'committed', themeRef: 'entity:theme', committedRevision: 8 } } }
  const result = await reviewThemeFrameworkConstruction({ candidate, disposition: 'accept', decisions: { consumer: 'pending' }, decisionRationales: { consumer: 'Reassess this boundary because accelerator demand makes the downstream segment relevant.' } }, commit)
  assert.equal(result.status, 'committed')
  assert.ok(committedInput)
  assert.equal(committedInput.decisions.length, 3)
  assert.deepEqual(committedInput.decisions.map((decision) => [decision.candidateId, decision.decision]), [
    ['accelerators', 'include'], ['consumer', 'pending'], ['packaging', 'pending'],
  ])
  assert.deepEqual(committedInput.decisions[0]?.evidenceBindings.map((binding) => binding.sourceRef), ['source:existing'])
  assert.equal(committedInput.decisions[1]?.evidenceRefs.length, 0)
  assert.equal(committedInput.decisions[1]?.rationale, 'Reassess this boundary because accelerator demand makes the downstream segment relevant.')
})

test('a human decision override requires its own bounded rationale', async () => {
  const candidate = await candidateOrFail()
  let commitCalls = 0
  const commit: ThemeFrameworkAtomicCommitPort = { commitThemeFrameworkAtomically: async () => { commitCalls += 1; return { status: 'committed', themeRef: 'entity:theme', committedRevision: 8 } } }
  const missing = await reviewThemeFrameworkConstruction({ candidate, disposition: 'accept', decisions: { consumer: 'pending' } }, commit)
  assert.equal(missing.status, 'blocked')
  if (missing.status === 'blocked') assert.deepEqual(missing.diagnostics, ['review_decision_override_requires_rationale'])
  assert.equal(commitCalls, 0)

  const unnecessary = await reviewThemeFrameworkConstruction({ candidate, disposition: 'accept', decisionRationales: { consumer: 'No decision was changed.' } }, commit)
  assert.equal(unnecessary.status, 'blocked')
  if (unnecessary.status === 'blocked') assert.deepEqual(unnecessary.diagnostics, ['review_rationale_without_decision_override'])
  assert.equal(commitCalls, 0)
})

test('canonical include is blocked when cited evidence has no persisted Source/Raw binding', async () => {
  const candidate = await candidateOrFail(ports({
    readKnowledgeSnapshot: async () => ({ ...snapshot, durableEvidenceBindings: [] }),
  }))
  let commitCalls = 0
  const result = await reviewThemeFrameworkConstruction({ candidate, disposition: 'accept' }, {
    commitThemeFrameworkAtomically: async () => { commitCalls += 1; return { status: 'committed', themeRef: 'entity:theme', committedRevision: 8 } },
  })
  assert.equal(result.status, 'blocked')
  if (result.status === 'blocked') assert.deepEqual(result.diagnostics, ['included_scope_decision_requires_persisted_source_raw_evidence'])
  assert.equal(commitCalls, 0)
})

test('an included relation cannot outlive a node the user leaves pending', async () => {
  const withEdge = {
    ...frameworkOutput,
    relationCandidates: [{
    candidateId: 'accelerators-packaging', sourceIndustryRef: 'accelerators', targetIndustryRef: 'packaging',
    relationType: 'upstream_of', topologyRole: 'main_chain', directionRationale: 'Packaging supplies accelerators.',
    themeRelevanceRationale: 'May constrain compute supply.', boundaryRationale: 'Both endpoints matter.',
    recommendation: 'pending', decisionChange: 'new', evidenceRefs: ['e-kb'], coverageGaps: ['Endpoint value needs confirmation.'],
    }],
  }
  const candidate = await candidateOrFail(ports({ reasoningExecutor: executor([withEdge]) }))
  let commitCalls = 0
  const result = await reviewThemeFrameworkConstruction({ candidate, disposition: 'accept', decisions: { packaging: 'pending', 'accelerators-packaging': 'include' }, decisionRationales: { 'accelerators-packaging': 'The edge should be reconsidered after including its endpoints.' } }, {
    commitThemeFrameworkAtomically: async () => { commitCalls += 1; return { status: 'committed', themeRef: 'entity:theme', committedRevision: 8 } },
  })
  assert.equal(result.status, 'blocked')
  if (result.status === 'blocked') assert.deepEqual(result.diagnostics, ['included_relation_requires_included_endpoints'])
  assert.equal(commitCalls, 0)
})

test('atomic commit replay reports already_committed and returns the same Theme/revision receipt', async () => {
  const candidate = await candidateOrFail()
  let calls = 0
  const commit: ThemeFrameworkAtomicCommitPort = {
    commitThemeFrameworkAtomically: async () => {
      calls += 1
      return calls === 1
        ? { status: 'committed', themeRef: 'entity:theme', committedRevision: 8 }
        : { status: 'already_committed', themeRef: 'entity:theme', committedRevision: 8 }
    },
  }
  const request = { candidate, disposition: 'accept' as const }
  assert.equal((await reviewThemeFrameworkConstruction(request, commit)).status, 'committed')
  const replay = await reviewThemeFrameworkConstruction(request, commit)
  assert.equal(replay.status, 'already_committed')
  if (replay.status === 'already_committed') {
    assert.equal(replay.themeRef, 'entity:theme')
    assert.equal(replay.committedRevision, 8)
    assert.equal(replay.decisions.find((decision) => decision.candidateId === 'packaging')?.decision, 'pending')
  }
  assert.equal(calls, 2)
})

test('stale snapshot conflict is returned without claiming successful Theme creation', async () => {
  const candidate = await candidateOrFail()
  const result = await reviewThemeFrameworkConstruction({ candidate, disposition: 'accept' }, {
    commitThemeFrameworkAtomically: async ({ expectedBaseRevision }) => {
      assert.equal(expectedBaseRevision, 7)
      return { status: 'conflict', errors: ['Knowledge revision changed'] }
    },
  })
  assert.equal(result.status, 'conflict')
})

test('industry snapshot is bounded to the Skill limit and reports truncation', async () => {
  const manyIndustries: ThemeFrameworkKnowledgeSnapshot = {
    ...snapshot,
    industries: Array.from({ length: 44 }, (_, index) => ({ ref: `entity:industry-${index}`, name: `Industry ${index}` })),
  }
  const requests: ReasoningRequest[] = []
  const result = await runThemeFrameworkConstruction({ workflowRunId: 'theme-run-industry-limit', themeName: 'AI Compute' }, ports({
    readKnowledgeSnapshot: async () => manyIndustries,
    reasoningExecutor: executor([frameworkOutput], requests),
  }))

  assert.equal(result.status, 'awaiting_review')
  assert.equal((requests[0]?.input as ThemeFrameworkInput).existingKnowledge.industries.length, 40)
  if (result.status === 'awaiting_review') assert.ok(result.candidate.diagnostics.includes('knowledge_industries_truncated:44:40'))
})

test('refreshes after acquisition and binds the candidate to the latest persisted KB revision', async () => {
  const acquired = {
    evidenceId: 'e-acquisition-written-to-kb',
    origin: 'existing_kb' as const,
    description: 'Acquisition persisted this source before returning.',
    sourceRef: 'source:acquisition-written-to-kb',
  }
  const binding = {
    evidenceId: acquired.evidenceId,
    sourceRef: 'source:acquisition-written-to-kb' as const,
    rawRef: `raw-sha256-${'b'.repeat(64)}` as const,
    locator: 'whole document',
  }
  const latest: ThemeFrameworkKnowledgeSnapshot = {
    ...snapshot,
    revision: 8,
    evidence: [...snapshot.evidence, acquired],
    durableEvidenceBindings: [...(snapshot.durableEvidenceBindings ?? []), binding],
  }
  let reads = 0
  const requests: ReasoningRequest[] = []
  const result = await runThemeFrameworkConstruction({ workflowRunId: 'theme-run-acquisition-revision', themeName: 'AI Compute' }, ports({
    readKnowledgeSnapshot: async () => ++reads === 1 ? snapshot : latest,
    acquisition: {
      acquire: async ({ knowledgeBaseRevision }) => {
        assert.equal(knowledgeBaseRevision, 7)
        return { status: 'available', evidence: [acquired], durableEvidenceBindings: [binding] }
      },
    },
    reasoningExecutor: executor([frameworkOutput], requests),
  }))

  assert.equal(reads, 2)
  assert.equal(result.status, 'awaiting_review')
  if (result.status === 'awaiting_review') {
    assert.equal(result.candidate.basedOnRevision, 8)
    assert.ok(result.candidate.durableEvidenceBindings.some((item) => item.evidenceId === acquired.evidenceId && item.rawRef === binding.rawRef))
  }
  const input = requests[0]?.input as ThemeFrameworkInput
  assert.equal(input.evidence.filter((item) => item.evidenceId === acquired.evidenceId).length, 1)
})

test('blocks acquisition-time KB identity changes, same-ID evidence changes, and concurrent Theme creation', async () => {
  let identityReads = 0
  const identityChanged = await runThemeFrameworkConstruction({ workflowRunId: 'theme-run-kb-identity-change', themeName: 'AI Compute' }, ports({
    readKnowledgeSnapshot: async () => ++identityReads === 1 ? snapshot : { ...snapshot, knowledgeBaseId: 'kb-replaced' },
    acquisition: { acquire: async () => ({ status: 'unavailable', reason: 'offline' }) },
  }))
  assert.equal(identityChanged.status, 'failed')
  if (identityChanged.status === 'failed') assert.ok(identityChanged.diagnostics.includes('knowledge_snapshot_identity_changed_during_acquisition'))

  let evidenceReads = 0
  const conflictingEvidence = await runThemeFrameworkConstruction({ workflowRunId: 'theme-run-evidence-id-change', themeName: 'AI Compute' }, ports({
    readKnowledgeSnapshot: async () => ({
      ...(++evidenceReads === 1 ? snapshot : {
        ...snapshot,
        evidence: [{ ...snapshot.evidence[0]!, description: 'Changed evidence under a reused ID.' }],
      }),
    }),
    acquisition: { acquire: async () => ({ status: 'unavailable', reason: 'offline' }) },
  }))
  assert.equal(conflictingEvidence.status, 'failed')
  if (conflictingEvidence.status === 'failed') assert.ok(conflictingEvidence.diagnostics[0]?.startsWith('theme_framework_evidence_identity_conflict:'))

  let themeReads = 0
  const themeAppeared = await runThemeFrameworkConstruction({ workflowRunId: 'theme-run-theme-created-during-acquisition', themeName: 'AI Compute' }, ports({
    readKnowledgeSnapshot: async () => ++themeReads === 1 ? snapshot : { ...snapshot, existingThemeRef: 'entity:investment_theme-ai-compute' },
    acquisition: { acquire: async () => ({ status: 'unavailable', reason: 'offline' }) },
  }))
  assert.equal(themeAppeared.status, 'blocked')
  if (themeAppeared.status === 'blocked') assert.ok(themeAppeared.diagnostics.includes('theme_already_exists:use_framework_update_workflow'))
})
