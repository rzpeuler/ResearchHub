import { access, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { canonicalSerialize, KnowledgeBaseLoader, KnowledgeBaseRegistry, resolveKnowledgeBaseRoot } from '../../packages/shared/knowledge-base/index.ts'
import type { KnowledgeBaseTargetResolver } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import type { LocalKnowledgeProductValidationConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'

export function realKnowledgeBaseRoot(config: LocalKnowledgeProductValidationConfig): string {
  return resolveKnowledgeBaseRoot({ rootDir: config.dataRoot }, config.knowledgeBaseId)
}

export async function ensureRealKnowledgeBase(config: LocalKnowledgeProductValidationConfig): Promise<string> {
  const root = realKnowledgeBaseRoot(config)
  await mkdir(config.reportsDir, { recursive: true })
  try { await access(join(root, 'manifest.yaml')); return root } catch { /* initialize below */ }
  const dirs = [
    'taxonomy', 'entities/industries', 'entities/segments', 'entities/companies', 'entities/products', 'entities/technologies',
    'relations/supply-chain', 'relations/company', 'intelligence/facts', 'intelligence/forecasts', 'intelligence/viewpoints', 'intelligence/trends', 'intelligence/risks',
    'modules/comparison', 'modules/market', 'modules/roadmap', 'modules/competition', 'modules/capacity', 'modules/supply-chain', 'sources', 'views', 'registry', 'logs/ingestion', 'logs/migrations',
  ]
  await Promise.all(dirs.map((dir) => mkdir(join(root, dir), { recursive: true })))
  const timestamp = new Date().toISOString()
  await writeYaml(join(root, 'manifest.yaml'), { knowledgeBaseId: config.knowledgeBaseId, name: 'AI Hardware Real Validation Knowledge Base', schemaVersion: '0.2', storageFormatVersion: '1', revision: 0, status: 'active', createdAt: timestamp, updatedAt: timestamp, dataScope: 'real-research-validation', evidencePolicy: 'only locally ingested source documents' })
  await writeYaml(join(root, 'registry/assets.yaml'), { 'industry:ai-hardware': { type: 'entity', storageRef: 'entities/industries/ai-hardware.yaml' } })
  await writeYaml(join(root, 'registry/raw.yaml'), {})
  await writeYaml(join(root, 'entities/industries/ai-hardware.yaml'), { id: 'industry:ai-hardware', type: 'industry', name: 'AI Hardware', description: 'User-defined domain scope anchor for real research validation; not evidence-derived Knowledge.', metadata: { scopeKind: 'user_defined_domain_scope' } })
  await writeYaml(join(root, 'taxonomy/sw-level-1.yaml'), { id: 'taxonomy:sw-level-1', type: 'sw-level-1', name: '申万一级行业', version: 'v0.1', items: [{ id: 'sw:electronics', name: '电子', graphRefs: ['industry:ai-hardware'] }] })
  await writeYaml(join(root, 'views/ai-hardware-industry.yaml'), { id: 'view:ai-hardware-industry', type: 'industry-view', name: 'AI Hardware Industry View', targetEntity: 'industry:ai-hardware', sections: ['overview', 'industry-graph', 'market', 'forecast', 'comparison', 'companies', 'viewpoint', 'event-timeline', 'sources'] })
  return root
}

export function createRealKnowledgeTargetResolver(root: string): KnowledgeBaseTargetResolver {
  const loader = new KnowledgeBaseLoader({ registry: new KnowledgeBaseRegistry() })
  return { async resolve() { const { handle, index } = await loader.mountAndLoad(root); return { handle, index } } }
}

async function writeYaml(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${canonicalSerialize(value)}\n`, 'utf8')
}
