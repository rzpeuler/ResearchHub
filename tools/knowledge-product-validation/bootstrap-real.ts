import { loadLocalRuntimeConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'
import { ensureRealKnowledgeBase } from './runtime.ts'

const config = loadLocalRuntimeConfig()
const root = await ensureRealKnowledgeBase(config)
console.log(JSON.stringify({ status: 'ready', knowledgeBaseId: config.knowledgeBaseId, root, dataScope: 'real-research-validation', evidenceAssets: 0 }))
