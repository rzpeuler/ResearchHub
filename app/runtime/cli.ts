import { createResearchHubRuntimeServer } from './server.ts'

const mountedKnowledgeBaseRoot = process.env.RESEARCHHUB_KNOWLEDGE_BASE_ROOT?.trim() || undefined
const knowledgeBaseCatalogRoot = process.env.RESEARCHHUB_KNOWLEDGE_BASES_ROOT?.trim() || undefined
const server = await createResearchHubRuntimeServer({ cwd: process.cwd(), mountedKnowledgeBaseRoot, knowledgeBaseCatalogRoot })
const info = server.address!
process.stdout.write(`${info.origin}\n`)

const shutdown = () => { void server.close().catch((error) => { process.stderr.write('ResearchHub runtime shutdown failed\n'); process.exitCode = 1; if (error instanceof Error) process.stderr.write(`${error.message}\n`) }) }
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
