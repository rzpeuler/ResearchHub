import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { runCompanyDeepResearch } from '../../workflows/company-deep-research/index.ts'
import { COMPANY_RESEARCH_METHOD_IDS } from '../../skills/company-research/methods.ts'
import { COMPANY_CORE_SECTION_IDS } from '../../workflows/company-deep-research/content-quality.ts'
import type { ResearchAcquisitionPlugin } from '../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import { completeResearchExecutor, fixtureCompanyDataResolverFactory } from '../fixtures/company-quality.ts'

async function fingerprint(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) result[relative(root, path)] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  await visit(root); return result
}

async function fixture(mode: 'repair' | 'malformed' | 'still_insufficient' | 'exhausted_method' | 'format_repair_then_substantive' | 'synthesis_blocked', options: {structured?: 'late_all'|'profile_present';conflict?: boolean;extraLocator?: boolean;onFirstMethod?:()=>void;onFirstAcquisitionCompleted?:()=>void} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'company-quality-loop-kb-'))
  const reports = await mkdtemp(join(tmpdir(), 'company-quality-loop-reports-'))
  try {
    const asOf = '2026-09-08T00:00:00.000Z'
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-quality-loop', now: asOf })
    const handle = await new KnowledgeBaseRegistry().mount(root)
    const seeded = await new KnowledgeProductionGateway().submit({ handle, producerType: 'fixture_identity', producerRunId: 'fixture-identity', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: 'Fixture Company', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SH' } }, proposals: [], evidenceBindings: [], asOf, now: () => asOf })
    assert.equal(seeded.status, 'committed')
    const before = await fingerprint(root)
    let acquisitions = 0
    let discoveries = 0
    let basicCalls = 0
    const requirementsByRound: {metricId?:string;period?:unknown}[][] = []
    const akshare: AkshareDataClient | undefined = options.structured ? {
      companyBasic: async () => {basicCalls++;return acquisitions > 1 || options.structured === 'profile_present' ? [{item:'company_name',value:'Fixture Company'}] : []},
      financialData: async () => acquisitions > 1 ? [{report_date:'2026-06-30',publication_date:'2026-08-01',operating_revenue:1000000000,net_profit:100000000,unit:'CNY',currency:'CNY'}] : [],
      historicalMarketData: async () => acquisitions > 1 ? [{date:'2026-09-07',close:100}] : [],
    } : undefined
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async () => {
        discoveries++
        assert.deepEqual(await fingerprint(root), before, 'Supplemental source callback cannot mutate readonly KB')
        const candidate = { candidateId: 'loop-filing', kind: 'official_disclosure' as const, tier: 1 as const, title: 'Fixture company operating disclosure', provider: 'cninfo', url: 'https://example.com/quality-loop-filing', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: '600519' } }
        return options.conflict ? [{...candidate,candidateId:'changing-filing',url:'https://example.com/changing-filing',publishedAt:acquisitions===1 ? undefined : candidate.publishedAt},candidate] : [candidate]
      },
      fetch: async candidate => {const content = candidate.candidateId==='changing-filing' ? acquisitions===1 ? '原始来源正文：不可覆盖。' : '冲突来源正文：变更内容。' : '公司披露经营业务与战略演变，战略转型影响产品定位与资金投入。\n补充披露说明战略调整的背景、结果、反证和验证限制。';return {candidate,retrievedAt:asOf,content,contentHash:createHash('sha256').update(content).digest('hex')}},
      normalize: async fetched => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, canonicalUrl: fetched.candidate.url, publisher: 'CNINFO', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const baseFactory = fixtureCompanyDataResolverFactory(plugin,undefined,akshare)
    const calls = new Map<string, number>()
    let reviewCalls = 0
    let synthesisCalls = 0
    let originalFinancialEvidence: unknown
    const base = completeResearchExecutor()
    const reasoningExecutor: ReasoningExecutor = { capabilities: () => base.capabilities(), execute: async (request, signal) => {
      if (request.metadata?.stage === 'tam_operand_extraction') return base.execute(request, signal)
      if (request.metadata?.stage === 'content_quality_review') {
        reviewCalls++
        if (mode === 'malformed' || mode === 'format_repair_then_substantive' && reviewCalls === 1) return { operation: request.operation, output: { sectionChecks: [] } }
        const failHistory = reviewCalls === 1 || mode === 'still_insufficient' || mode === 'format_repair_then_substantive' && reviewCalls === 2
        return { operation: request.operation, output: { sectionChecks: COMPANY_CORE_SECTION_IDS.map(sectionId => ({ sectionId, questionAnswered: !(failHistory && sectionId === 'company-overview'), evidenceSupportsConclusion: true, numericReproducible: true, riskTransmission: true, reasons: failHistory && sectionId === 'company-overview' ? ['战略演变未解释阶段转折与结果，请补采并通过历史方法修订。'] : [] })) } }
      }
      if (request.operation === 'company_research_method') {
        const id = request.metadata!.skillId as string
        calls.set(id, (calls.get(id) ?? 0) + 1)
        if(id==='company_history_strategy' && calls.get(id)===1) options.onFirstMethod?.()
        if (id === 'financial_quality_analysis' && calls.get(id) === 1) originalFinancialEvidence = JSON.parse(JSON.stringify((request.input as any).evidence))
        if (id === 'company_history_strategy' && calls.get(id) === 2 && mode === 'repair') {
          const methodology = (request.input as any).canonicalMethodology as string
          assert.match(methodology, /未出现在本方法输入中，不得照抄、引用/)
          assert.match(methodology, /不得引用其他方法专属材料/)
          assert.match(methodology, /即使只想标记为“待核实”或说明“本方法没有原文”/)
        }
        const response = await base.execute(request, signal)
        if (id === 'company_history_strategy' && calls.get(id) === 1 && mode === 'exhausted_method') {
          const output = response.output as any
          return { ...response, output: { ...output, sections: [] } }
        }
        if (id === 'company_history_strategy' && calls.get(id) === 2) {
          const output = response.output as any
          if (mode !== 'exhausted_method') {
            assert.equal(reviewCalls, mode === 'format_repair_then_substantive' ? 2 : 1, 'History rerun must follow substantive review failure')
            assert.ok(acquisitions >= 2, 'History repair must receive supplemental acquisition')
          }
          if (options.structured) {
            const input = request.input as any
            assert.ok(input.structuredProfileData.fields.length)
            assert.equal(input.structuredFinancialData[0].metrics.revenue,1000000000)
            assert.ok(input.preparedAnalysis.financial.financialReadableTable)
          }
          return mode === 'exhausted_method' ? response : { ...response, output: { ...output, answer: '修订历史研究：说明战略转折的背景、结果及反证。', sections: output.sections.map((section: any) => ({ ...section, markdown: `${section.markdown}\n修订历史研究明确阶段演变及验证限制。` })) } }
        }
        if (options.extraLocator && id==='product_technology_analysis') {
          const output=response.output as any
          return {...response,output:{...output,sections:output.sections.map((section:any)=>({...section,markdown:`${section.markdown} 额外正文支持验证限制。[loop-filing@paragraph:2]`}))}}
        }
        return response
      }
      if (request.operation === 'company_research_synthesis') {
        synthesisCalls++
        if (synthesisCalls > 1 && mode !== 'malformed') {
          assert.ok((request.input as any).qualityFeedback.length > 0, 'A review-driven assembly receives the concrete section failures')
        }
        if (mode === 'synthesis_blocked' && synthesisCalls > 1) return { operation: request.operation, output: { sections: [] } }
        if (mode === 'exhausted_method' && synthesisCalls === 2) {
          assert.ok((request.input as any).qualityFeedback.length > 0, 'Synthesis still receives the review feedback after an owner exhausts its method attempts')
          return base.execute(request, signal)
        }
      }
      return base.execute(request, signal)
    } }
    const result = await runCompanyDeepResearch({ workflowRunId: `quality-loop-${mode}`, handle: await new KnowledgeBaseRegistry().mount(root), company: { symbol: '600519', name: 'Fixture Company', exchange: 'SH' }, writeKnowledge: false, reportRoot: reports, now: () => asOf, dataResolverFactory: context => { acquisitions++;const resolver=baseFactory(context);const resolve=resolver.resolve.bind(resolver);resolver.resolve=async requirements=>{requirementsByRound.push(requirements.map(({metricId,period})=>({metricId,period})));const result=await resolve(requirements);if(acquisitions===1) options.onFirstAcquisitionCompleted?.();return result};return resolver }, reasoningExecutor })
    assert.deepEqual(await fingerprint(root), before, 'Readonly semantic repair preserves every KB file')
    assert.ok(discoveries >= 1)
    assert.ok(acquisitions <= 3, 'Initial acquisition plus at most two supplemental rounds')
    assert.ok(reviewCalls <= 4, 'At most two review operations each receive the bounded two-attempt semantic budget')
    assert.ok(synthesisCalls <= 6, 'At most three bounded assembly rounds may each make two semantic attempts')
    const analysis = JSON.parse(await readFile(join(reports, `company-research-600519-quality-loop-${mode}.analysis.json`), 'utf8'))
    for (const id of COMPANY_RESEARCH_METHOD_IDS) assert.equal(calls.get(id), id === 'company_history_strategy' && mode !== 'malformed' && !options.onFirstAcquisitionCompleted ? 2 : 1, `Only history receives the remaining method attempt: ${id}; ${JSON.stringify(analysis.methodResults.find((method: any) => method.skillId === id)?.diagnostics)}`)
    assert.ok(result.report, result.errors.join(';'))
    const report = JSON.parse(await readFile(`${result.report.outputPath}.json`, 'utf8'))
    assert.equal(analysis.reviewAttempts, reviewCalls)
    assert.equal(analysis.synthesisAttempts, synthesisCalls)
    if(options.onFirstMethod) assert.ok(analysis.acquisitionBudget.spentMs<600000,'Semantic execution time cannot consume the acquisition-only budget')
    if (options.structured) {
      const financialMethod = analysis.methodResults.find((method:any) => method.skillId === 'financial_quality_analysis')
      assert.deepEqual(financialMethod.executionEvidence, originalFinancialEvidence, 'Supplemental deterministic summary preserves the semantic operation original input evidence')
      const summaryEvidence = financialMethod.deterministicEvidence.find((packet:any) => packet.sourceCandidateId === 'akshare-financial-600519')
      assert.ok(summaryEvidence, 'New financial summary records its independently acquired source rather than inventing a semantic input')
      const actualSource = analysis.sourceSummaries.find((source:any) => source.candidateId === summaryEvidence.sourceCandidateId)
      assert.ok(actualSource?.content.trim(), 'Deterministic financial evidence must be backed by retained source body')
      assert.equal(summaryEvidence.excerpts[0].location, 'paragraph:1')
      assert.equal(summaryEvidence.excerpts[0].text, actualSource.content.split(/\r?\n/)[0])
      assert.ok(!financialMethod.executionEvidence.some((packet:any) => packet.sourceCandidateId === summaryEvidence.sourceCandidateId), 'Late financial source was not supplied to the earlier semantic operation')
    }
    if (mode !== 'malformed' && mode !== 'exhausted_method' && mode !== 'synthesis_blocked' && !options.onFirstAcquisitionCompleted) {
      assert.deepEqual(analysis.methodResults.find((method: any) => method.skillId === 'company_history_strategy').attemptOutputs.map((attempt: any) => attempt.attempt), [1, 2])
      assert.equal(analysis.qualityReviewHistory.length, 2, JSON.stringify({status:result.status,errors:result.errors,contentQuality:analysis.contentQuality,synthesisDiagnostics:analysis.synthesisDiagnostics,methods:analysis.methodResults.map((item:any)=>({id:item.skillId,status:item.status,diagnostics:item.diagnostics}))}))
      assert.equal(analysis.qualityReviewHistory[0].review.passed, false, 'Preserve initial substantive rejection in diagnostic history')
      assert.equal(analysis.qualityReviewHistory[1].review.passed, mode === 'repair' || mode === 'format_repair_then_substantive')
      assert.doesNotMatch(analysis.qualityReviewHistory[0].sections.find((section: any) => section.id === 'company-overview').markdown, /修订历史研究/)
      assert.match(analysis.qualityReviewHistory[1].sections.find((section: any) => section.id === 'company-overview').markdown, /修订历史研究/)
    }
    return { result, report, analysis, acquisitions, reviewCalls, synthesisCalls, requirementsByRound,basicCalls }
  } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) }
}

test('substantive review routes one history gap through supplemental acquisition and its remaining atomic attempt', async () => {
  const { result, report, acquisitions, reviewCalls, synthesisCalls } = await fixture('repair')
  assert.equal(result.status, 'completed', result.errors.join(';'))
  assert.equal(report.researchQuality.passed, true)
  assert.equal(report.researchQuality.semanticReview.passed, true)
  assert.equal(report.researchQuality.semanticReview.attempts, 2, 'Persist total review attempts across the repair loop')
  assert.equal(reviewCalls, 2)
  assert.ok(acquisitions >= 2)
  assert.ok(synthesisCalls >= 1)
  assert.match(report.sections.find((section: any) => section.id === 'company-overview').markdown, /修订历史研究/)
  assert.equal(report.methodExecutions.find((method: any) => method.skillId === 'company_history_strategy').attempts, 2)
})

test('an exhausted method owner does not block feedback repair through the remaining synthesis attempt', async () => {
  const { result, analysis, reviewCalls, synthesisCalls } = await fixture('exhausted_method')
  assert.equal(result.status, 'completed', result.errors.join(';'))
  assert.equal(reviewCalls, 2)
  assert.equal(synthesisCalls, 2)
  assert.equal(analysis.methodResults.find((method: any) => method.skillId === 'company_history_strategy').attempts, 2)
  assert.equal(analysis.qualityReviewHistory.length, 2)
  assert.equal(analysis.qualityReviewHistory[0].review.passed, false)
  assert.equal(analysis.qualityReviewHistory[1].review.passed, true)
  assert.ok(analysis.qualityReviewHistory[1].sections.find((section: any) => section.id === 'company-overview').markdown)
})

test('format repair in the first review does not consume the final review reserved after method revision', async () => {
  const { result, report, analysis, reviewCalls } = await fixture('format_repair_then_substantive')
  assert.equal(result.status, 'completed', result.errors.join(';'))
  assert.equal(report.researchQuality.passed, true)
  assert.equal(reviewCalls, 3, 'Two attempts repair the first review; the second review independently verifies the revised report')
  assert.equal(analysis.reviewRounds, 2)
  assert.equal(analysis.reviewAttempts, 3)
  assert.equal(analysis.qualityReviewHistory.length, 2)
  assert.equal(analysis.qualityReviewHistory[0].review.passed, false)
  assert.equal(analysis.qualityReviewHistory[1].review.passed, true)
})

test('supplemental acquisition requests only missing structured fields, retains market period, and refreshes analysis inputs',async()=>{
  for(const structured of ['late_all','profile_present'] as const){
    const {result,analysis,requirementsByRound,basicCalls}=await fixture('repair',{structured})
    assert.equal(result.status,'completed',result.errors.join(';'))
    const supplemental=requirementsByRound[1]!
    assert.deepEqual(supplemental.map(item=>item.metricId),[...(structured==='late_all'?['company_basic_profile']:[]),'company_financial_history','company_market_history','company_research_evidence'])
    assert.deepEqual(supplemental.find(item=>item.metricId==='company_market_history')!.period,{end:'2026-09-08T00:00:00.000Z'})
    assert.equal(basicCalls,structured==='late_all'?2:1)
    assert.match(analysis.preparedAnalysis.financial.financialReadableTable,/营业收入.*10\.00/)
  }
})

test('conflicting supplemental content retains original source and never promotes its unknown date',async()=>{
  const {result,analysis}=await fixture('repair',{conflict:true})
  assert.equal(result.status,'completed',result.errors.join(';'))
  assert.equal(analysis.sourceConflicts.length,1)
  const conflict=analysis.sourceConflicts[0]
  assert.equal(conflict.candidateId,'changing-filing')
  assert.match(conflict.retainedSource.content,/原始来源正文/)
  assert.match(conflict.incomingSource.content,/冲突来源正文/)
  assert.notEqual(conflict.retainedSource.contentHash,conflict.incomingSource.contentHash)
  assert.match(analysis.sourceSummaries.find((source:any)=>source.candidateId==='changing-filing').content,/原始来源正文/)
  assert.ok(analysis.sourceDiagnostics.some((item:any)=>item.reason.startsWith('SOURCE_CONTENT_CONFLICT:')))
  assert.ok(!result.research!.sourceCandidateIds.includes('changing-filing'))
})

test('report resolves valid extra section locators beyond method finding references',async()=>{
  const {result,report}=await fixture('malformed',{extraLocator:true})
  assert.equal(result.status,'blocked')
  assert.match(report.methodology,/已有证据及部分研究结果/)
  assert.ok(report.sections.find((section:any)=>section.id==='products').evidenceLocations.some((ref:any)=>ref.sourceCandidateId==='loop-filing' && ref.locator==='paragraph:2'))
})

test('malformed independent review exhausts two attempts and blocks without further acquisition or method reruns', async () => {
  const { result, report, acquisitions, reviewCalls } = await fixture('malformed')
  assert.equal(result.status, 'blocked')
  assert.equal(report.researchQuality.passed, false)
  assert.equal(reviewCalls, 2)
  assert.equal(acquisitions, 1)
  assert.equal(report.researchQuality.semanticReview.attempts, 2)
})

test('persistent substantive history gap cannot reset method or review budgets after the bounded repair', async () => {
  const { result, report, acquisitions, reviewCalls } = await fixture('still_insufficient')
  assert.equal(result.status, 'blocked')
  assert.equal(report.researchQuality.passed, false)
  assert.equal(reviewCalls, 2)
  assert.equal(acquisitions, 2)
  assert.equal(report.researchQuality.semanticReview.attempts, 2)
  assert.equal(report.methodExecutions.find((method: any) => method.skillId === 'company_history_strategy').attempts, 2)
})
test('long semantic work does not exhaust the shared acquisition-only budget before a required supplement',async context=>{
  const actualNow=Date.now
  let semanticElapsedMs=0
  context.mock.method(Date,'now',()=>actualNow()+semanticElapsedMs)
  const {result,acquisitions,reviewCalls}=await fixture('repair',{onFirstMethod:()=>{semanticElapsedMs=11*60_000}})
  assert.equal(result.status,'completed')
  assert.equal(acquisitions,2)
  assert.equal(reviewCalls,2)
})


test('exhausted acquisition budget preserves diagnostics and cannot mark otherwise populated research complete',async context=>{
  const actualNow=Date.now
  let acquisitionElapsedMs=0
  context.mock.method(Date,'now',()=>actualNow()+acquisitionElapsedMs)
  const {result,report,analysis,acquisitions,reviewCalls}=await fixture('repair',{onFirstAcquisitionCompleted:()=>{acquisitionElapsedMs=11*60_000}})
  assert.equal(result.status,'blocked')
  assert.equal(report.researchQuality.passed,false)
  assert.ok(report.researchQuality.issues.includes('ACQUISITION_BUDGET_EXHAUSTED'))
  assert.equal(analysis.acquisitionBudget.remainingMs,0)
  assert.equal(analysis.acquisitionBudget.spentMs,600000)
  assert.equal(acquisitions,1)
  assert.equal(reviewCalls,1)
})


test('bounded synthesis failure retains the prior validated synthesis only while its cited evidence remains resolvable', async () => {
  const { result, report, analysis } = await fixture('synthesis_blocked')
  assert.equal(report.researchQuality.passed, false, 'A failed independent review remains blocking after prior prose is retained')
  assert.equal(analysis.synthesisSnapshotStatus, 'retained_after_block')
  assert.equal(analysis.qualityReviewHistory.length, 1)
  assert.equal(analysis.qualityReviewHistory[0].review.passed, false)
  for (const id of ['investment-thesis', 'monitoring-checklist']) {
    const section = report.sections.find((item: any) => item.id === id)
    assert.ok(section?.markdown.trim().length > 40, `${id} retains the prior non-empty validated synthesis: ${section?.markdown}`)
    assert.doesNotMatch(section.markdown, /研究缺口：.*(?:尚未完成|缺失对应方法结果)/)
  }
  assert.ok(result.report)
})
