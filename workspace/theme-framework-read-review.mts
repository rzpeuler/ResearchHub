import { ThemeFrameworkService } from '../app/services/theme-framework-service.ts'
import { WorkflowService } from '../app/services/workflow-service.ts'
import { KnowledgeBaseRegistry } from '../knowledge/registry/registry.ts'
import { loadKnowledgeBaseManifest } from '../knowledge/storage/manifest-loader.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'
import type { ReasoningExecutor } from '../plugins/reasoning/contracts.ts'
const root='C:/Users/Administrator/Desktop/ResearchHubData/knowledge-bases/ai-compute-theme-v04-verified'
const runId='tf-ai-compute-20261003-f62e3544-8d0f-408b-9792-196f945ce94f'
const noCall:ReasoningExecutor={capabilities:()=>({maxContextTokens:1_048_576,maxOutputTokens:131_072,structuredOutputSupport:true,maxConcurrency:4}),execute:async()=>{throw new Error('model_calls_disabled_in_review_reader')}}
const service=new ThemeFrameworkService({mountedKnowledgeBaseRoot:root,workflowService:new WorkflowService(),reasoningExecutor:noCall,registry:new KnowledgeBaseRegistry()})
const review=await service.getReviewCandidate(runId)
const manifest=await loadKnowledgeBaseManifest(root)
const assets=await readCanonicalV04Assets(root)
if(!review.candidate){console.log(JSON.stringify({status:review.status,revision:manifest.revision}));process.exit(0)}
const c=review.candidate
const evidenceMap=new Map(c.evidence.map(e=>[e.evidenceId,{summary:e.summary,sourceRef:e.sourceRef}]))
const item=(x:any)=>({candidateId:x.candidateId,name:x.name??null,relationType:x.relationType??null,sourceIndustryRef:x.sourceIndustryRef??null,targetIndustryRef:x.targetIndustryRef??null,recommendation:x.recommendation,decisionChange:x.decisionChange??null,existingIndustryRef:x.existingIndustryRef??null,rationale:x.boundaryRationale,themeRelevanceRationale:x.themeRelevanceRationale??null,independentlyResearchableRationale:x.independentlyResearchableRationale??null,evidence:(x.evidenceRefs??[]).map((id:string)=>({evidenceId:id,...(evidenceMap.get(id)??{summary:'unresolved_evidence',sourceRef:null})})),coverageGaps:x.coverageGaps??[]})
console.log(JSON.stringify({runId,reviewStatus:review.status,kbRevision:manifest.revision,basedOnRevision:c.basedOnRevision,theme:c.theme,acquisitionStatus:c.acquisitionStatus,diagnostics:c.diagnostics,proposedDefinition:c.framework.proposedDefinition,recommendationCounts:Object.fromEntries(['include','exclude','pending'].map(k=>[k,c.framework.industryCandidates.filter(x=>x.recommendation===k).length])),industryCandidates:c.framework.industryCandidates.map(item),relationCandidates:c.framework.relationCandidates.map(item),overallCoverageGaps:c.framework.coverageGaps,evidenceCatalog:c.evidence.map(e=>({evidenceId:e.evidenceId,sourceRef:e.sourceRef,summary:e.summary})),canonicalCounts:Object.fromEntries(['entity','relation','source'].map(k=>[k,assets.objects.filter(x=>x.kind===k).length]))}))
