import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadKnowledgeBaseManifest } from '../knowledge/storage/manifest-loader.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'
const root='C:/Users/Administrator/Desktop/ResearchHubData/knowledge-bases/ai-compute-theme-v04-verified'
const runId='tf-ai-compute-20261003-4e2af1f8-5515-42bf-9ed1-be2a1b638ad3'
const env=JSON.parse(await readFile(join(root,'logs','theme-framework','reviews',`${runId}.candidate.json`),'utf8'))
const c=env.payload.candidate, evidence=env.payload.evidence
const refs=new Set(c.framework.industryCandidates.flatMap((item:any)=>item.evidenceRefs??[]))
const relRefs=new Set(c.framework.relationCandidates.flatMap((item:any)=>item.evidenceRefs??[]))
const bindings=new Map(c.durableEvidenceBindings.map((item:any)=>[item.evidenceId,item]))
const nodes=c.framework.industryCandidates.map((item:any)=>({candidateId:item.candidateId,name:item.name,recommendation:item.recommendation,evidenceRefs:item.evidenceRefs??[],coverageGaps:item.coverageGaps??[]}))
const relations=c.framework.relationCandidates.map((item:any)=>({candidateId:item.candidateId,sourceIndustryRef:item.sourceIndustryRef,targetIndustryRef:item.targetIndustryRef,relationType:item.relationType,topologyRole:item.topologyRole,recommendation:item.recommendation,evidenceRefs:item.evidenceRefs??[],coverageGaps:item.coverageGaps??[]}))
const catalog=evidence.filter((item:any)=>refs.has(item.evidenceId)||relRefs.has(item.evidenceId)).map((item:any)=>{const b=bindings.get(item.evidenceId) as any; const m=item.summary.match(/block=([^;]+); page=([^;]+);/u); return {evidenceId:item.evidenceId,sourceRef:item.sourceRef,kind:m?'body_excerpt':'source_title',blockId:b?.locator&&b.locator!=='retained source document'?b.locator:(m?.[1]??null),page:m?.[2]??null}})
const manifest=await loadKnowledgeBaseManifest(root)
const assets=await readCanonicalV04Assets(root)
const sources=assets.objects.filter((item)=>item.kind==='source').map((item:any)=>({sourceRef:item.value.id,title:item.value.title,publisher:item.value.publisher??null,publishedAt:item.value.publishedAt??null}))
console.log(JSON.stringify({runId,reviewStatus:'awaiting_review',knowledgeBase:{id:manifest.knowledgeBaseId,revision:manifest.revision,basedOnRevision:c.basedOnRevision},recommendations:Object.fromEntries(['include','exclude','pending'].map((value)=>[value,nodes.filter((node:any)=>node.recommendation===value).length])),nodes,relationCount:relations.length,relations,evidenceCatalog:catalog,overallCoverageGaps:c.framework.coverageGaps,sources,canonical:Object.fromEntries(['entity','relation','source'].map((kind)=>[kind,assets.objects.filter((item)=>item.kind===kind).length]))}))
