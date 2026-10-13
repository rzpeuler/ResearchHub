import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeResearchRequest, validateResearchDispatchDecision } from '../../../app/services/research-dispatch-contracts.ts'

test('ResearchRequest applies safe context and persistence defaults', () => {
  assert.deepEqual(normalizeResearchRequest({ query: '研究贵州茅台' }), { query: '研究贵州茅台', mode: { type: 'free_research' }, contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false } })
})

test('ResearchRequest preserves explicit policies and explicit workflow', () => {
  const request = normalizeResearchRequest({ query: '研究 PCB', mode: { type: 'workflow', workflowId: 'industry_research' }, contextPolicy: { structuredKnowledge: false, sourceLibrary: true }, persistencePolicy: { writeKnowledge: true }, attachments: ['attachment-1'] })
  assert.deepEqual(request.mode, { type: 'workflow', workflowId: 'industry_research' })
  assert.deepEqual(request.contextPolicy, { structuredKnowledge: false, sourceLibrary: true })
  assert.deepEqual(request.persistencePolicy, { writeKnowledge: true })
})

test('ResearchRequest and decision validation fail closed', () => {
  assert.throws(() => normalizeResearchRequest({ query: '', mode: { type: 'free_research' } }), /non-empty/)
  assert.throws(() => normalizeResearchRequest({ query: 'x', mode: { type: 'workflow', workflowId: '../unsafe' } }), /unsafe/)
  assert.throws(() => normalizeResearchRequest({ query: 'x', contextPolicy: { structuredKnowledge: true, sourceLibrary: true, unexpected: true } }), /exactly/)
  assert.throws(() => validateResearchDispatchDecision({ mode: 'workflow', skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'x' }), /workflow is required/)
  assert.throws(() => validateResearchDispatchDecision({ mode: 'free_research', skills: [], entities: [{ type: 'company', value: 'x', confidence: 2 }], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'x' }), /between 0 and 1/)
  assert.throws(() => validateResearchDispatchDecision({ mode: 'free_research', workflow: { id: 'valuation', confidence: 1, arguments: {} }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'x' }), /only allowed/)
  const decision = validateResearchDispatchDecision({ mode: 'workflow', workflow: { id: 'valuation', confidence: 1, arguments: { symbol: 'bad' } }, skills: [], entities: [], missingRequiredInputs: [], contextPolicy: { structuredKnowledge: true, sourceLibrary: true }, persistencePolicy: { writeKnowledge: false }, rationale: 'x' })
  assert.equal(decision.workflow?.arguments.symbol, 'bad') // The selected Workflow JSON Schema is validated by ResearchDispatchService.
})
