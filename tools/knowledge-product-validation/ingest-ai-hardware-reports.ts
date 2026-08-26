import { createHash } from 'node:crypto'
import { access, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { KnowledgeCurationSkill } from '../../packages/skills/knowledge-curation/index.ts'
import { ResearchReportKnowledgeIngestionWorkflow } from '../../packages/workflows/research-report-knowledge-ingestion/index.ts'
import { LocalResearchReportInputResolver } from '../../packages/plugins/document/index.ts'
import { deriveRawIdentity } from '../../packages/shared/knowledge-base/index.ts'
import { loadLocalRuntimeConfig, LocalRuntimeConfigError } from '../../dsh/llm-runtime/local-runtime-config.ts'
import { createRealKnowledgeCurationModel } from './deepseek-composition.ts'
import { ensureRealKnowledgeBase, createRealKnowledgeTargetResolver } from './runtime.ts'

async function main(): Promise<void> {
  const config = loadLocalRuntimeConfig(process.env, process.cwd(), { requireRealLlm: true })
  const all = process.argv.includes('--all')
  const limitArg = process.argv.find((argument) => argument.startsWith('--limit='))
  const requestedLimit = limitArg === undefined ? 1 : Number(limitArg.slice('--limit='.length))
  if (!all && (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1)) throw new Error('--limit must be a positive integer')
  const limit = all ? Number.POSITIVE_INFINITY : requestedLimit
  const root = await ensureRealKnowledgeBase(config)
  const files = await scanReports(config.reportsDir)
  if (files.length === 0) { printAwaitingInputs(config); return }
  const selected = files.slice(0, limit)
  const runtime = await createRealKnowledgeCurationModel(config)
  try {
    const workflow = new ResearchReportKnowledgeIngestionWorkflow({ targetResolver: createRealKnowledgeTargetResolver(root), inputResolver: new LocalResearchReportInputResolver(), curation: new KnowledgeCurationSkill({ model: runtime.model }) })
    for (const file of selected) await ingestOne(workflow, file, config.knowledgeBaseId)
  } finally { await runtime.close() }
}

async function scanReports(directory: string): Promise<string[]> {
  try { await access(directory) } catch { return [] }
  const entries = await readdir(directory, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile() && /\.(pdf|txt|md)$/i.test(entry.name)).map((entry) => resolve(join(directory, entry.name))).sort((left, right) => left.localeCompare(right))
}

async function ingestOne(workflow: ResearchReportKnowledgeIngestionWorkflow, file: string, knowledgeBaseId: string): Promise<void> {
  const rawIdentity = deriveRawIdentity(new Uint8Array(await readFile(file)))
  const filename = file.split(/[\\/]/).pop() ?? file
  const identity = createHash('sha256').update(`${knowledgeBaseId}|${rawIdentity}|${filename}|validation-v0.1`).digest('hex').slice(0, 20)
  const result = await workflow.execute({ workflowRunId: `product-validation-${identity}`, knowledgeBaseId, report: { inputRef: { type: 'file', reference: file }, suppliedMetadata: { title: file.split(/[\\/]/).pop() ?? file, publisher: 'Local Research Input', institution: null, author: null, publishedAt: null, sourceUrl: null } }, options: { mode: 'commit', reprocess: false } })
  console.log(JSON.stringify({ filename, rawRef: result.raw.rawRef, workflowRunId: result.workflowRunId, status: result.status, candidateCounts: result.candidates, changes: result.changes, review: result.userReview.length, schemaGaps: result.schemaGaps.length, revisionBefore: result.baseRevision, revisionAfter: result.finalRevision }))
}

function printAwaitingInputs(config: ReturnType<typeof loadLocalRuntimeConfig>): void {
  console.log(JSON.stringify({ status: 'AWAITING LOCAL INPUTS', required: [`${resolve(process.cwd(), '.env')}`, config.reportsDir], reason: 'No local AI Hardware report files were found; no real ingestion was executed.' }))
}

try { await main() } catch (error) {
  if (error instanceof LocalRuntimeConfigError && ['missing_deepseek_api_key', 'real_llm_disabled'].includes(error.code)) {
    console.log(JSON.stringify({ status: 'AWAITING LOCAL INPUTS', required: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../ResearchHubData/input/ai-hardware-reports')], reason: error.code }))
  } else throw error
}
