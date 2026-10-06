import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { loadKnowledgeBaseManifest } from 'file:///C:/Users/Administrator/Desktop/ResearchHub/knowledge/storage/manifest-loader.ts'
import { createKnowledgeBaseHandle } from 'file:///C:/Users/Administrator/Desktop/ResearchHub/knowledge/storage/handle.ts'
import { KnowledgeBaseRegistry } from 'file:///C:/Users/Administrator/Desktop/ResearchHub/knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from 'file:///C:/Users/Administrator/Desktop/ResearchHub/knowledge/storage/canonical-v04-loader.ts'
import { getRaw, verifyRaw } from 'file:///C:/Users/Administrator/Desktop/ResearchHub/knowledge/raw/raw-archive.ts'
import { PiReasoningExecutor } from 'file:///C:/Users/Administrator/Desktop/ResearchHub/plugins/reasoning/pi/executor.ts'
import { selectProductionReasoningModel, createThemeFrameworkProductionReasoningExecutor, THEME_FRAMEWORK_PRODUCTION_REASONING_SELECTION } from 'file:///C:/Users/Administrator/Desktop/ResearchHub/app/pi/model-selection.ts'
import { discoverCodexCliExecutable } from 'file:///C:/Users/Administrator/Desktop/ResearchHub/app/pi/model-selection.ts'
const root='C:/Users/Administrator/Desktop/ResearchHubData/knowledge-bases/ai-compute-theme-v04-verified'
const manifest=await loadKnowledgeBaseManifest(root)
if(manifest.knowledgeBaseId!=='kb-ai-compute-theme-v04-verified'||manifest.schemaVersion!=='0.4'||manifest.revision!==1||manifest.status!=='active') throw new Error('kb_preflight_mismatch')
const handle=await new KnowledgeBaseRegistry().mount(root)
const assets=await readCanonicalV04Assets(root)
const sources=assets.objects.filter(x=>x.kind==='source').map(x=>x.value)
const source=sources.find(s=>s.id==='source:manual-f383b4ec6fa5347e4bc320e6')
if(!source) throw new Error('expected_source_missing')
const rawRef='raw-sha256-998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63'
if(!(source.rawRefs??[]).includes(rawRef)) throw new Error('expected_raw_not_bound')
const raw=await getRaw(handle,rawRef); const verified=await verifyRaw(handle,rawRef)
const themes=assets.objects.filter(x=>x.kind==='entity').map(x=>x.value).filter(x=>x.type==='investment_theme'&&x.name.normalize('NFKC').trim().replace(/\s+/gu,' ').toLocaleLowerCase('en-US')==='ai算力')
const modelRuntime=await ModelRuntime.create({authPath:join(getAgentDir(),'auth.json'),modelsPath:join(getAgentDir(),'models.json'),allowModelNetwork:false,refreshOnCreate:false})
const model=selectProductionReasoningModel(modelRuntime)
const base=new PiReasoningExecutor({modelRuntime,model})
const executor=await createThemeFrameworkProductionReasoningExecutor({capabilities:base.capabilities()})
const meta=executor.runtimeMetadata()
const cli=await discoverCodexCliExecutable()
console.log(JSON.stringify({stage:'preflight_ready',runId:`tf-ai-compute-20261003-${randomUUID()}`,kb:{id:manifest.knowledgeBaseId,revision:manifest.revision,schemaVersion:manifest.schemaVersion,status:manifest.status},source:{ref:source.id,rawRef,rawValid:verified.valid,rawSizeBytes:raw.manifest.sizeBytes,rights:{accessScope:source.rights.accessScope,retentionAllowed:source.rights.retentionAllowed,aiProcessingAllowed:source.rights.aiProcessingAllowed,derivativeKnowledgeAllowed:source.rights.derivativeKnowledgeAllowed,redistributionAllowed:source.rights.redistributionAllowed},usagePolicy:source.usagePolicy},sourceCount:sources.length,sameNameThemeExists:themes.length>0,reasoning:{...meta,capabilities:executor.capabilities()},codexExecutableAvailable:Boolean(cli)}))
;(modelRuntime as any).dispose?.()

