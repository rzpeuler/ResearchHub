import { join } from 'node:path'
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { loadKnowledgeBaseManifest } from '../knowledge/storage/manifest-loader.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'
import { KnowledgeBaseRegistry } from '../knowledge/registry/registry.ts'
import { PiReasoningExecutor } from '../plugins/reasoning/pi/executor.ts'
import { selectProductionReasoningModel, createThemeFrameworkProductionReasoningExecutor } from '../app/pi/model-selection.ts'
import { ThemeFrameworkService } from '../app/services/theme-framework-service.ts'
import { WorkflowService } from '../app/services/workflow-service.ts'
import { ThemeFrameworkAcquisitionAdapter } from '../plugins/research-acquisition/theme-framework-acquisition.ts'
import { AkshareDataAdapter } from '../plugins/research-acquisition/akshare.ts'
import { AkshareIndustryResearchPlugin } from '../plugins/research-acquisition/industry.ts'
import { EastmoneyIndustryResearchPlugin } from '../plugins/research-acquisition/eastmoney-industry.ts'
import { GovCnIndustryResearchPlugin } from '../plugins/research-acquisition/govcn-industry.ts'
import { MiitIndustryResearchPlugin } from '../plugins/research-acquisition/miit-industry.ts'
import { CpcaIndustryResearchPlugin } from '../plugins/research-acquisition/cpca-industry.ts'
import type { ReasoningExecutor } from '../plugins/reasoning/contracts.ts'
const root='C:/Users/Administrator/Desktop/ResearchHubData/knowledge-bases/ai-compute-theme-v04-verified'
const runId='tf-ai-compute-20261003-f62e3544-8d0f-408b-9792-196f945ce94f'
let modelRuntime: ModelRuntime | undefined
const startedAt=Date.now()
const say=(stage:string,extra:Record<string,unknown>={})=>process.stdout.write(JSON.stringify({runId,stage,elapsedMs:Date.now()-startedAt,...extra})+'\n')
try {
  say('initializing_production_executor')
  modelRuntime=await ModelRuntime.create({authPath:join(getAgentDir(),'auth.json'),modelsPath:join(getAgentDir(),'models.json'),allowModelNetwork:false,refreshOnCreate:false})
  const model=selectProductionReasoningModel(modelRuntime)
  const capabilityOwner=new PiReasoningExecutor({modelRuntime,model})
  const delegate=await createThemeFrameworkProductionReasoningExecutor({capabilities:capabilityOwner.capabilities()})
  const modelMetadata=delegate.runtimeMetadata()
  let modelCalls=0
  const executor:ReasoningExecutor={
    capabilities:()=>delegate.capabilities(),
    execute:async(request,signal)=>{
      modelCalls++
      say('model_call_started',{callNumber:modelCalls,operation:request.operation,model:modelMetadata})
      try { const result=await delegate.execute(request,signal); say('model_call_completed',{callNumber:modelCalls,elapsedMs:Date.now()-startedAt}); return result }
      catch(error){ const code=typeof (error as any)?.code==='string'?(error as any).code:'executor_error'; say('model_call_failed',{callNumber:modelCalls,errorCode:code}); throw error }
    },
  }
  const workflowService=new WorkflowService()
  const akshare=new AkshareDataAdapter()
  const acquisition=new ThemeFrameworkAcquisitionAdapter({knowledgeBaseRoot:root,plugins:[new MiitIndustryResearchPlugin(),new GovCnIndustryResearchPlugin(),new EastmoneyIndustryResearchPlugin(),new CpcaIndustryResearchPlugin(),new AkshareIndustryResearchPlugin(akshare)]})
  const service=new ThemeFrameworkService({mountedKnowledgeBaseRoot:root,workflowService,reasoningExecutor:executor,acquisition,registry:new KnowledgeBaseRegistry()})
  const before=await loadKnowledgeBaseManifest(root)
  const assetsBefore=await readCanonicalV04Assets(root)
  const sourceCountBefore=assetsBefore.objects.filter(x=>x.kind==='source').length
  const run=service.start({workflowRunId:runId,name:'AI 算力'})
  say('workflow_started',{kbRevisionBefore:before.revision,sourceCountBefore,modelMetadata})
  const heartbeat=setInterval(()=>{ const status=workflowService.getWorkflowStatus(runId); say('workflow_wait',{status:status?.status??'unknown',progress:status?.progressSummary??'not_reported',modelCalls}) },30_000)
  let completion
  try { completion=await run.completion } finally { clearInterval(heartbeat) }
  say('workflow_completed',{completionStatus:completion.status,workflowStatus:workflowService.getWorkflowStatus(runId)?.status,diagnostics:completion.diagnostics??[],modelCalls})
  const review=await service.getReviewCandidate(runId)
  const after=await loadKnowledgeBaseManifest(root)
  const assetsAfter=await readCanonicalV04Assets(root)
  const newSources=assetsAfter.objects.filter(x=>x.kind==='source').map(x=>x.value).filter(s=>!assetsBefore.objects.some(x=>x.kind==='source'&&x.value.id===s.id)).map(s=>({sourceRef:s.id,title:s.title,publisher:s.publisher??null,publishedAt:s.publishedAt??null}))
  if(!review.candidate){ say('review_read_completed',{reviewStatus:review.status,kbRevisionAfter:after.revision,newSourceCount:newSources.length,newSources,diagnostics:[],modelCalls}); process.exitCode=completion.status==='awaiting_review'?1:0; }
  else {
    const c=review.candidate
    const evidenceById=new Map(c.evidence.map(e=>[e.evidenceId,e]))
    const project=(items:any[])=>items.map(item=>({candidateId:item.candidateId,name:item.name??undefined,sourceIndustryRef:item.sourceIndustryRef??undefined,targetIndustryRef:item.targetIndustryRef??undefined,relationType:item.relationType??undefined,recommendation:item.recommendation,decisionChange:item.decisionChange??undefined,existingIndustryRef:item.existingIndustryRef??undefined,rationale:item.boundaryRationale,themeRelevanceRationale:item.themeRelevanceRationale??undefined,independentlyResearchableRationale:item.independentlyResearchableRationale??undefined,evidence:(item.evidenceRefs??[]).map((id:string)=>{const e=evidenceById.get(id);return {evidenceId:id,sourceRef:e?.sourceRef??null,summary:e?.summary??null}}),coverageGaps:item.coverageGaps??[]}))
    const result={stage:'review_candidate_persisted',runId,reviewStatus:review.status,kb:{id:c.knowledgeBaseId,basedOnRevision:c.basedOnRevision,revisionAfter:after.revision},theme:c.theme,modelMetadata,modelCalls,acquisitionStatus:c.acquisitionStatus,diagnostics:c.diagnostics,sourceCountBefore,sourceCountAfter:assetsAfter.objects.filter(x=>x.kind==='source').length,newSources,proposedDefinition:c.framework.proposedDefinition,industryCount:c.framework.industryCandidates.length,relationCount:c.framework.relationCandidates.length,overallGaps:c.framework.coverageGaps,industries:project(c.framework.industryCandidates as any[]),relations:project(c.framework.relationCandidates as any[]),evidenceCatalog:c.evidence}
    process.stdout.write(JSON.stringify(result)+'\n')
  }
} catch(error) {
  const code=typeof (error as any)?.code==='string'?(error as any).code:'workflow_execution_error'
  say('workflow_error',{errorCode:code,modelCalls:typeof (globalThis as any).modelCalls==='number'?(globalThis as any).modelCalls:null})
  process.exitCode=1
} finally {
  if(modelRuntime) await (modelRuntime as any).dispose?.()
}

