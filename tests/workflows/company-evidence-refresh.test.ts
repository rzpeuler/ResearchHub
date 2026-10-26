import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/index.ts'
import { runCompanyDeepResearch } from '../../workflows/company-deep-research/workflow.ts'
import { COMPANY_RESEARCH_METHOD_IDS, type CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import { completeResearchExecutor, fixtureCompanyDataResolverFactory } from '../fixtures/company-quality.ts'
import { createCompanyResearchDataResolver } from '../../plugins/research-acquisition/company-research-data.ts'
import type { ResearchAcquisitionPlugin } from '../../plugins/research-acquisition/contracts.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'

const now = '2026-09-08T00:00:00.000Z'
type Scenario = 'added-official' | 'conflict' | 'noncore' | 'initial-official' | 'exhausted' | 'public-page'
async function runScenario(scenario: Scenario) {
  const root = await mkdtemp(join(tmpdir(), 'company-refresh-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-refresh', now })
    const handle = await new KnowledgeBaseRegistry().mount(root)
    await new KnowledgeProductionGateway().submit({handle,producerType:'fixture_identity',producerRunId:'identity-refresh',schemaProfile:{schemaVersion:'0.4',storageFormatVersion:'1',requiresRawProvenance:true},entity:{localKey:'company',entityType:'company',name:'Fixture Company',aliases:['002384'],semanticFields:{ticker:'002384',exchange:'SZ'}},proposals:[],evidenceBindings:[],asOf:now,now:()=>now})
    const mounted = await new KnowledgeBaseRegistry().mount(root)
    let discoveries = 0
    let acquisitions = 0
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async () => {
        discoveries++
        const annual = scenario === 'initial-official' || acquisitions > 1 && scenario !== 'noncore' && scenario !== 'public-page'
        return [{candidateId: acquisitions > 1 && scenario !== 'conflict' && scenario !== 'initial-official' && scenario !== 'public-page' ? 'official-new' : 'official-original',kind:'official_disclosure',tier:1,title:annual?'2025年年度报告':'经营资料说明',provider:'cninfo',publishedAt:'2026-04-01T00:00:00.000Z',url:'https://example.com/filing',metadata:{companySymbol:'002384'}}]
      },
      fetch: async candidate => ({candidate,retrievedAt:now,content:`${candidate.title}\n${'公司业务与产品技术、经营财务、资本配置、竞争和管理层风险均有披露。'.repeat(5)}`,contentHash: candidate.provider === 'public-web' ? 'd'.repeat(64) : scenario === 'conflict' && acquisitions > 1 ? 'c'.repeat(64) : 'b'.repeat(64)}),
      normalize: async fetched => ({candidate:fetched.candidate,retrievedAt:fetched.retrievedAt,title:fetched.candidate.title,content:fetched.content,contentHash:fetched.contentHash!,publisher:'CNINFO',canonicalUrl:fetched.candidate.url,rights:{accessScope:'public',retentionAllowed:true,aiProcessingAllowed:true,derivativeKnowledgeAllowed:true,redistributionAllowed:false}}),
    }
    const publicWeb: ResearchAcquisitionPlugin = {...plugin,name:'fixture-public-web',discover:async()=>acquisitions > 1 ? [{candidateId:'public-web-new',kind:'web_article',tier:3,title:'2025年度报告公开讨论',provider:'public-web',publishedAt:'2026-04-01T00:00:00.000Z',url:'https://example.com/article',metadata:{companySymbol:'002384'}}] : []}
    const calls: {skillId:string; evidenceIds:string[]}[] = []
    let reviews = 0
    let historyCalls = 0
    const normal = completeResearchExecutor()
    const executor: ReasoningExecutor = {...normal,execute:async request => {
      const input = request.input as any
      if (request.operation === 'company_research_method' && request.metadata?.stage !== 'tam_operand_extraction') {
        const skillId = String(request.metadata?.skillId)
        calls.push({skillId,evidenceIds:input.evidence.map((packet:any)=>packet.sourceCandidateId)})
        if (scenario === 'exhausted' && skillId === 'company_history_strategy' && ++historyCalls === 1) return {operation:request.operation,output:{invalid:true}}
      }
      const result = await normal.execute(request)
      if (request.metadata?.stage === 'content_quality_review' && ++reviews === 1 && scenario !== 'initial-official') {
        const output = result.output as any
        return {...result,output:{...output,sectionChecks:output.sectionChecks.map((check:any)=>check.sectionId === 'risks' ? {...check,questionAnswered:false,reasons:['缺少定期报告中的具体风险传导资料。']} : check)}}
      }
      return result
    }}
    const runId = `refresh-${scenario}`
    const result = await runCompanyDeepResearch({workflowRunId:runId,handle:mounted,company:{symbol:'002384',name:'Fixture Company'},dataResolverFactory:options=>{acquisitions++;return scenario === 'public-page' ? createCompanyResearchDataResolver({...options,officialDisclosure:plugin,publicWeb}) : fixtureCompanyDataResolverFactory(plugin)(options)},reportRoot:join(root,'reports'),reasoningExecutor:executor,writeKnowledge:false,now:()=>now})
    assert.ok(result.report, result.errors.join(';'))
    const analysis = JSON.parse(await readFile(join(root,'reports',`company-research-002384-${runId}.analysis.json`),'utf8')) as {methodResults:CompanyResearchMethodResult[];sourceConflicts:unknown[]}
    return {result,analysis,calls,discoveries:acquisitions}
  } finally { await rm(root,{recursive:true,force:true}) }
}

test('new accepted statutory annual report refreshes every stale complete method within two attempts', async () => {
  const {result,analysis,calls} = await runScenario('added-official')
  assert.equal(result.status,'completed',result.errors.join(';'))
  for (const id of COMPANY_RESEARCH_METHOD_IDS) {
    const methodCalls = calls.filter(call=>call.skillId===id)
    assert.equal(methodCalls.length,2,id)
    assert.ok(!methodCalls[0]!.evidenceIds.includes('official-new'))
    assert.ok(methodCalls[1]!.evidenceIds.includes('official-new'),id)
    const method = analysis.methodResults.find(method=>method.skillId===id)!
    assert.equal(method.attempts,2)
    assert.equal(method.status,'complete')
    assert.ok(method.diagnostics.some(diagnostic=>diagnostic.code==='EVIDENCE_REFRESH_REQUIRED'))
  }
})

test('same candidate conflict cannot promote a new report or refresh unrelated completed methods', async () => {
  const {result,analysis,calls} = await runScenario('conflict')
  // The conflicted candidate is the only official source used by this fixture.
  // Since synthesis may not refill method citations from raw source text, the
  // report must remain blocked rather than reusing evidence whose body changed.
  assert.equal(result.status,'blocked',result.errors.join(';'))
  assert.match(result.errors.join(';'),/SYNTHESIS_DEGRADED/)
  assert.equal(analysis.sourceConflicts.length,1)
  assert.equal(calls.length,11)
  assert.ok(analysis.methodResults.every(method=>!method.diagnostics.some(d=>d.code.startsWith('EVIDENCE_REFRESH'))))
})

test('new nonperiodic evidence does not trigger official-report refresh', async () => {
  const {calls,analysis} = await runScenario('noncore')
  assert.equal(calls.length,11)
  assert.ok(analysis.methodResults.every(method=>!method.diagnostics.some(d=>d.code.startsWith('EVIDENCE_REFRESH'))))
})

test('new official evidence fails closed when an earlier complete method already spent two attempts', async () => {
  const {result,analysis,calls} = await runScenario('exhausted')
  assert.equal(result.status,'blocked')
  const history = analysis.methodResults.find(method=>method.skillId==='company_history_strategy')!
  assert.equal(history.attempts,2)
  assert.equal(history.status,'insufficient_evidence')
  assert.ok(history.sections.length,'Keep the previously produced analysis for inspection')
  assert.ok(history.diagnostics.some(d=>d.code==='EVIDENCE_REFRESH_BUDGET_EXHAUSTED'))
  assert.equal(calls.filter(call=>call.skillId==='company_history_strategy').length,2)
  assert.ok(analysis.methodResults.every(method=>method.attempts<=2))
})

test('official reports consumed in the first successful pass require no redundant refresh', async () => {
  const {result,analysis,calls,discoveries} = await runScenario('initial-official')
  assert.equal(result.status,'completed',result.errors.join(';'))
  assert.equal(discoveries,1)
  assert.equal(calls.length,10)
  assert.ok(analysis.methodResults.every(method=>method.attempts===1 && method.status==='complete'))
})

test('new public web page with an annual-report title does not trigger statutory refresh', async () => {
  const {calls,analysis} = await runScenario('public-page')
  assert.equal(calls.length,11)
  assert.ok(calls.at(-1)!.evidenceIds.includes('public-web-new'),'Public page was actually accepted and supplied')
  assert.ok(analysis.methodResults.every(method=>!method.diagnostics.some(d=>d.code.startsWith('EVIDENCE_REFRESH'))))
})
