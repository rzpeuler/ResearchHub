import assert from 'node:assert/strict'
import test from 'node:test'
import { assembleCompanyResearch } from '../../workflows/company-deep-research/assembly.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'

const method: CompanyResearchMethodResult = { skillId: 'company_history_strategy', status: 'complete', answer: '历史披露支持分析', markdown: '历史披露 [annual@paragraph:1]', sections: [{ id: 'company-overview', markdown: '历史披露 [annual@paragraph:1]' }], findings: [{ text: '公司披露历史', kind: 'fact', evidence: [{ sourceCandidateId: 'annual', location: 'paragraph:1' }] }], limitations: [], risks: [], sourceCandidateIds: ['annual'], diagnostics: [], attempts: 1 }
const input = { company: { symbol: '002594', name: '比亚迪', exchange: 'SZ' }, asOf: '2026-10-14T00:00:00Z', sources: [], reportSourceCandidateIds: ['annual'], durableSourceCandidateIds: ['annual'] }
const ids = ['valuation', 'bull-base-bear', 'variant-perception', 'investment-thesis', 'monitoring-checklist']
const capabilities = () => ({ maxContextTokens: 100000, maxOutputTokens: 16000, structuredOutputSupport: true, maxConcurrency: 1 })

test('invalid final section cannot leak a partially accepted synthesis into report', async () => {
  let calls = 0
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => {
    calls++
    if(calls===2) {
      const repair=request.input as {repairPreviousOutput:unknown;repairInstruction:string}
      assert.match(JSON.stringify(repair.repairPreviousOutput),/无引用的跟踪结论/)
      assert.match(repair.repairInstruction,/保留/)
    }
    return { operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: id === 'monitoring-checklist' ? '无引用的跟踪结论' : '部分拒绝内容 [annual@paragraph:1]', sourceCandidateIds: ['annual'] })) } }
  } }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(calls, 2)
  assert.equal(result.synthesisMode, 'deterministic_fallback')
  assert.ok(result.sections.filter((section) => ids.includes(section.id)).every((section) => !section.markdown.includes('部分拒绝内容')))
})

test('final synthesis cannot cite an allowed source missing from actual method findings', async () => {
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => ({ operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: '结论 [other@paragraph:1]', sourceCandidateIds: ['other'] })) } }) }
  const result = await assembleCompanyResearch({ ...input, reportSourceCandidateIds: ['annual', 'other'] }, [method], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'deterministic_fallback')
  assert.ok(result.synthesisDiagnostics.every((code) => code.includes('REFERENCE_ERROR')))
  assert.equal(result.synthesisAttemptOutputs.length, 2)
  assert.match(result.synthesisDiagnostics[0]!,/other@paragraph:1/)
  assert.ok(JSON.stringify(result.synthesisAttemptOutputs[0]!.output).includes('other@paragraph:1'))
  assert.deepEqual(result.synthesisAttemptOutputs[0]!.allowedCitations,['annual@paragraph:1'])
})

test('unsupported optional valuation numbers are replaced by explicit basis gaps', async () => {
  const executor: ReasoningExecutor = { capabilities, execute: async (request) => ({ operation: request.operation, output: { sections: ids.map((id) => ({ id, markdown: ['valuation','bull-base-bear','variant-perception'].includes(id) ? '目标价 9999 元 [annual@paragraph:1]' : '定性研究结论 [annual@paragraph:1]', sourceCandidateIds: ['annual'] })) } }) }
  const result = await assembleCompanyResearch(input, [method], executor, () => input.asOf)
  assert.equal(result.synthesisMode, 'reasoning_executor')
  for (const section of result.sections.filter((section) => ['valuation', 'bull-base-bear', 'variant-perception'].includes(section.id))) { assert.match(section.markdown, /^研究缺口/); assert.ok(!section.markdown.includes('9999')); assert.deepEqual(section.sourceCandidateIds, []) }
})
test('final synthesis can reuse a validated section locator absent from concise findings', async () => {
  const contextualMethod: CompanyResearchMethodResult = { ...method, sections: [{id:'company-overview',markdown:'注册与重组口径不同 [annual@paragraph:2]'}], executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'历史披露'},{sourceCandidateId:'annual',location:'paragraph:2',text:'注册与重组口径不同'}]}] }
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:'注册与重组口径应分别监控 [annual@paragraph:2]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch(input,[contextualMethod],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'reasoning_executor')
  assert.match(result.sections.find(section=>section.id==='investment-thesis')!.markdown,/paragraph:2/)
  const invalid = { ...contextualMethod, sections: [{id:'company-overview',markdown:'未供给位置 [annual@paragraph:999]'}] }
  const invalidExecutor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:'未供给位置 [annual@paragraph:999]',sourceCandidateIds:['annual']}))}})}
  assert.equal((await assembleCompanyResearch(input,[invalid],invalidExecutor,()=>input.asOf)).synthesisMode,'deterministic_fallback')
})
test('unsupported numbers in core final conclusions block synthesis rather than enter a completed report', async () => {
  const executor:ReasoningExecutor={capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:'确认收入 9999 元 [annual@paragraph:1]',sourceCandidateIds:['annual']}))}})}
  const result=await assembleCompanyResearch(input,[method],executor,()=>input.asOf)
  assert.equal(result.synthesisMode,'deterministic_fallback')
  assert.ok(result.synthesisDiagnostics.every(d=>d.includes('NUMERIC_GROUNDING_ERROR')))
})
test('final synthesis preserves verified split-line dates only when both supplied paragraphs are cited', async () => {
  const datedMethod:CompanyResearchMethodResult={...method,executionEvidence:[{sourceCandidateId:'annual',title:'年报',publisher:'公司',excerpts:[{sourceCandidateId:'annual',location:'paragraph:1',text:'公司于二'},{sourceCandidateId:'annual',location:'paragraph:2',text:'零零二年六月十一日变更。'}]}],sections:[{id:'company-overview',markdown:'2002年变更 [annual@paragraph:1] [annual@paragraph:2]'}]}
  const executor=(both:boolean):ReasoningExecutor=>({capabilities,execute:async request=>({operation:request.operation,output:{sections:ids.map(id=>({id,markdown:`2002年变更影响历史口径 [annual@paragraph:1]${both?' [annual@paragraph:2]':''}`,sourceCandidateIds:['annual']}))}})})
  assert.equal((await assembleCompanyResearch(input,[datedMethod],executor(true),()=>input.asOf)).synthesisMode,'reasoning_executor')
  assert.equal((await assembleCompanyResearch(input,[datedMethod],executor(false),()=>input.asOf)).synthesisMode,'deterministic_fallback')
})
