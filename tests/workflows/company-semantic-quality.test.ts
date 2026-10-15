import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewCompanyResearchSemantics, validateCompanySemanticQualityOutput } from '../../workflows/company-deep-research/semantic-quality.ts'
import { COMPANY_CORE_SECTION_IDS } from '../../workflows/company-deep-research/content-quality.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'

const source = { candidate: { candidateId: 'filing', publishedAt: '2026-03-28' }, title: '2025年年度报告', content: '实际经营正文，产品销售给客户，现金回流；订单下降会导致收入减少。\n未引用的正文不应进入审查。' } as NormalizedResearchSource
const sections = [...COMPANY_CORE_SECTION_IDS.map((id) => ({ id, markdown: `${id} 实质分析与反证。[filing@paragraph:1]` })), { id: 'valuation', markdown: '研究缺口：缺少估值输入。' }]
const output = { sectionChecks: COMPANY_CORE_SECTION_IDS.map((sectionId) => ({ sectionId, questionAnswered: true, evidenceSupportsConclusion: true, numericReproducible: true, riskTransmission: true, reasons: [] as string[] })) }
const executor = (run: (request: any) => Promise<unknown>): ReasoningExecutor => ({ capabilities: () => ({ maxContextTokens: 100000, maxOutputTokens: 4000, maxConcurrency: 1, structuredOutputSupport: true }), execute: async (request) => ({ operation: request.operation, output: await run(request) }) })
const input = { company: { symbol: '002594' }, asOf: '2026-10-14', sources: [source], sections }

test('independent semantic review sends actual cited paragraphs and evaluates exact core sections, leaving optional gaps', async () => {
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async (request) => {
    assert.equal(request.metadata.stage, 'content_quality_review')
    assert.equal(request.operation, 'company_research_synthesis')
    assert.equal(request.input.sections.length, 16)
    assert.equal(request.input.citedParagraphs.length, 1)
    assert.equal(request.input.citedParagraphs[0].text, source.content.split('\n')[0])
    return output
  }) })
  assert.equal(result.passed, true)
  assert.equal(result.sectionChecks.length, 16)
})

test('semantic review rejects cited but unsupported conclusions and missing risk transmission despite complete prose', async () => {
  const rejected = { sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'risks' ? { ...check, riskTransmission: false, reasons: ['风险只列名称，没有说明订单下降如何影响收入、观察信号和缓解因素。'] } : check.sectionId === 'financial-quality' ? { ...check, evidenceSupportsConclusion: false, reasons: ['引用经营概况不能支持财务现金转化结论。'] } : check) }
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async () => rejected) })
  assert.equal(result.passed, false)
  assert.equal(result.issues.length, 2)
  assert.equal(result.attempts, 1)
})

test('independent gap check includes eligible uncited late evidence within its own budget and rejects false gaps', async () => {
  const lateSource = {
    ...source,
    retrievedAt: '2026-04-01T00:00:00Z',
    candidate: { ...source.candidate, metadata: { dataProvenance: { dateStatus: 'explicit', pointInTimeStatus: 'within_cutoff', pointInTimeSafe: true } } },
    content: [source.content.split('\n')[0], ...Array.from({ length: 600 }, () => '公司业务模式与经营活动说明。'.repeat(20)), '分产品收入构成：汽车业务收入占比80.68%，电子业务占比19.31%。', '前五大客户销售占比12.34%，客户集中度下降。', '管理层履历：董事长此前从事电池研发，主要工作经历包括产品制造管理。'].join('\n'),
  } as NormalizedResearchSource
  const excluded = { ...lateSource, candidate: { ...lateSource.candidate, candidateId: 'not-report-eligible' } } as NormalizedResearchSource
  const result = await reviewCompanyResearchSemantics({ ...input, sources: [lateSource, excluded], reportSourceCandidateIds: ['filing', 'nonexistent'], durableSourceCandidateIds: ['not-report-eligible'], reasoningExecutor: executor(async (request) => {
    assert.equal(request.input.citedParagraphs.length, 1)
    assert.equal(request.input.citedParagraphs[0].location, 'paragraph:1')
    const packets = request.input.gapCheckEvidence
    assert.deepEqual(packets.map((packet: any) => packet.sourceCandidateId), ['filing'])
    assert.equal(packets[0].publishedAt, '2026-03-28')
    assert.equal(packets[0].retrievedAt, '2026-04-01T00:00:00Z')
    assert.equal(packets[0].pointInTimeSafe, true)
    assert.equal(packets[0].pointInTimeStatus, 'within_cutoff')
    const excerpts = packets.flatMap((packet: any) => packet.excerpts)
    assert.ok(excerpts.reduce((sum: number, excerpt: any) => sum + excerpt.text.length, 0) <= 12000)
    assert.ok(excerpts.some((excerpt: any) => excerpt.location === 'paragraph:602' && excerpt.text.includes('分产品收入构成')))
    assert.ok(excerpts.some((excerpt: any) => excerpt.location === 'paragraph:603' && excerpt.text.includes('前五大客户')))
    assert.ok(excerpts.some((excerpt: any) => excerpt.location === 'paragraph:604' && excerpt.text.includes('管理层履历')))
    assert.match(request.instruction, /未引用证据只可用来拒绝虚假缺口/)
    return { sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'business-segments' ? { ...check, questionAnswered: false, reasons: ['声称缺少分产品收入构成，但实际可用年报paragraph:602已披露，未据此分析分部角色。'] } : check) }
  }) })
  assert.equal(result.passed, false)
  assert.match(result.issues[0]!, /paragraph:602/)
})

test('semantic review format repair is bounded to two calls and does not treat malformed checks as passing', async () => {
  let calls = 0
  const result = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async (request) => { calls++; if(calls===2) assert.equal(request.input.repairPreviousOutput.sectionChecks.length,15); return calls === 1 ? { sectionChecks: output.sectionChecks.slice(0, 15) } : output }) })
  assert.equal(result.passed, true)
  assert.equal(result.attempts, 2)
  assert.equal(result.diagnostics[0]?.code, 'FORMAT_ERROR')
  assert.equal(result.attemptOutputs?.length,2)
  const failed = await reviewCompanyResearchSemantics({ ...input, reasoningExecutor: executor(async () => 'malformed') })
  assert.equal(failed.passed, false)
  assert.equal(failed.attempts, 2)
})

test('semantic review fails closed for missing executor, missing paragraph, and cancellation', async () => {
  assert.equal((await reviewCompanyResearchSemantics(input)).passed, false)
  const bad = await reviewCompanyResearchSemantics({ ...input, sections: sections.map((section) => section.id === 'products' ? { ...section, markdown: '产品分析。[filing@paragraph:999]' } : section), reasoningExecutor: executor(async () => output) })
  assert.match(bad.issues[0]!, /UNRESOLVED_REFERENCE/)
  const controller = new AbortController(); controller.abort()
  assert.equal((await reviewCompanyResearchSemantics({ ...input, signal: controller.signal, reasoningExecutor: executor(async () => output) })).status, 'cancelled')
})

test('semantic review output requires all distinct core IDs, failure reasons and risk-only risk flag', () => {
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: [...output.sectionChecks.slice(0, 15), output.sectionChecks[0]] }), /Duplicate/)
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'products' ? { ...check, questionAnswered: false } : check) }), /need reasons/)
  assert.throws(() => validateCompanySemanticQualityOutput({ sectionChecks: output.sectionChecks.map((check) => check.sectionId === 'products' ? { ...check, riskTransmission: false, reasons: ['不适用字段。'] } : check) }), /only evaluated/)
})
