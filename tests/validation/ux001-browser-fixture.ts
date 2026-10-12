import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createInterface } from 'node:readline'
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createResearchHubApplicationRuntime } from '../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../app/runtime/server.ts'
import type { WorkflowService } from '../../app/services/workflow-service.ts'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/create-v04.ts'
import type { ReasoningCapabilities, ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
const repositoryRoot = resolve(import.meta.dirname, '../..')
const clientRoot = join(repositoryRoot, 'dist', 'client')
const root = await mkdtemp(join(tmpdir(), 'researchhub-ux001-browser-'))
const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const sessionDir = join(root, 'sessions'); const workspaceRoot = join(root, 'workspace'); const knowledgeBaseRoot = join(root, 'knowledge-base')
await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true }); await mkdir(workspaceRoot, { recursive: true })
await createFreshKnowledgeBaseV04(knowledgeBaseRoot, { knowledgeBaseId: `ux001-browser-${Date.now()}` })
await writeFile(join(knowledgeBaseRoot, 'entities', 'fixture-002640.yaml'), JSON.stringify({ id: 'entity:fixture-002640', type: 'company', name: '跨境通', aliases: ['跨境通'], ticker: '002640', exchange: 'SZSE', lifecycle: { status: 'active' } }) + '\n')
await writeFile(join(knowledgeBaseRoot, 'registry', 'assets.yaml'), JSON.stringify({ 'entity:fixture-002640': { type: 'entity', storageRef: 'entities/fixture-002640.yaml' } }) + '\n')

async function snapshotKnowledge(): Promise<string> {
  const files: Array<[string, string]> = []
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name); const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(path, relative)
      else if (entry.isFile()) files.push([relative, createHash('sha256').update(await readFile(path)).digest('hex')])
      else throw new Error(`Unexpected Knowledge Base entry: ${relative}`)
    }
  }
  await visit(knowledgeBaseRoot, '')
  return createHash('sha256').update(JSON.stringify(files.sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}

class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: Parameters<ReasoningExecutor['execute']>[0]) { return { operation: request.operation, output: {} } as never }
}

const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
const faux = fauxProvider({ provider: `researchhub-ux001-browser-${Date.now()}`, models: [{ id: 'fixture-model' }] })
modelRuntime.registerNativeProvider(faux.provider)
faux.setResponses(Array.from({ length: 30 }, (_, index) => fauxAssistantMessage(`Fixture response ${index + 1}.`)))

let workflowService: WorkflowService | undefined
const releaseByRunId = new Map<string, () => void>()
const completionByRunId = new Map<string, Promise<unknown>>()
const startInputs: Array<{ workflowRunId: string; symbol: string; name?: string; writeKnowledge: boolean }> = []
const researchService = {
  startResearchCompany(input: { workflowRunId: string; symbol: string; name?: string; writeKnowledge: boolean }) {
    startInputs.push(input)
    const service = workflowService!
    service.register({ runId: input.workflowRunId, workflowType: 'company_research', objective: `Company Research ${input.symbol}` })
    let release!: () => void
    const gate = new Promise<void>((resolveGate) => { release = resolveGate })
    releaseByRunId.set(input.workflowRunId, release)
    const completion = service.start(input.workflowRunId, async () => { await gate; return { status: 'completed' as const, summary: 'Isolated browser acceptance fixture.' } })
    completionByRunId.set(input.workflowRunId, completion)
    process.stdout.write(`WORKFLOW_STARTED ${JSON.stringify({ ...input })}\n`)
    return { runId: input.workflowRunId, completion }
  },
}

const options = { cwd, agentDir, sessionDir, mountedKnowledgeBaseRoot: knowledgeBaseRoot, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor(), researchService: researchService as never }
let runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
let server: ResearchHubRuntimeServer | undefined
let closed = false

async function start(): Promise<void> {
  runtime = await createResearchHubApplicationRuntime(options)
  workflowService = runtime.workflowService
  server = new ResearchHubRuntimeServer({ runtime, clientRoot, port: 0 })
  const info = await server.start()
  process.stdout.write(`READY ${JSON.stringify({ origin: info.origin, persistentPiSessionManager: runtime.sessionManager.isPersisted(), provider: 'faux', knowledgeBaseSha256: await snapshotKnowledge() })}\n`)
}

async function releaseRuns(): Promise<void> {
  for (const release of releaseByRunId.values()) release()
  await Promise.all(completionByRunId.values())
  releaseByRunId.clear(); completionByRunId.clear()
}

async function stop(): Promise<void> {
  if (server) await server.close()
  server = undefined
  if (runtime) await runtime.close()
  runtime = undefined
}

async function shutdown(removeFixture: boolean): Promise<void> {
  if (closed) return
  closed = true
  await releaseRuns().catch(() => undefined)
  await stop().catch(() => undefined)
  if (removeFixture) await rm(root, { recursive: true, force: true }).catch(() => undefined)
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
input.on('line', (line) => {
  void (async () => {
    const command = line.trim()
    if (command === 'release') { await releaseRuns(); process.stdout.write(`RELEASED ${JSON.stringify(startInputs)}\n`); return }
    if (command === 'restart') { await releaseRuns(); await stop(); await start(); return }
    if (command === 'stop') { await shutdown(true); input.close(); process.exitCode = 0; return }
    if (command === 'snapshot') process.stdout.write(`SNAPSHOT ${JSON.stringify({ started: startInputs, knowledgeBaseSha256: await snapshotKnowledge() })}\n`)
  })().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`) })
})
process.on('SIGINT', () => { void shutdown(true).finally(() => process.exit(0)) })
process.on('SIGTERM', () => { void shutdown(true).finally(() => process.exit(0)) })

await start()
