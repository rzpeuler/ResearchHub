import { startKnowledgeServer } from '../../tests/knowledge/serve.ts'
import { loadLocalRuntimeConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'
import { ensureRealKnowledgeBase, realKnowledgeBaseRoot } from './runtime.ts'

const config = loadLocalRuntimeConfig()
const root = await ensureRealKnowledgeBase(config)
const port = Number(process.env.KNOWLEDGE_PROTOTYPE_PORT || 4173)
startKnowledgeServer(process.cwd(), port, realKnowledgeBaseRoot(config))
console.log(JSON.stringify({ status: 'ready', knowledgeBaseId: config.knowledgeBaseId, root, url: `http://localhost:${port}/tests/knowledge/` }))
