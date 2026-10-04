import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getAgentDir, ModelRuntime } from '@earendil-works/pi-coding-agent'
import { PiReasoningExecutor } from '../plugins/reasoning/pi/executor.ts'
import { selectProductionReasoningModel, validateReasoningModelSelection } from '../app/pi/model-selection.ts'
import { createDailyIntelligenceComposition } from '../app/services/daily-intelligence-composition.ts'
import { WorkflowService } from '../app/services/workflow-service.ts'
import { readRuntimeSettings } from '../app/runtime/runtime-settings.ts'

const type = process.argv[2] === 'evening' ? 'evening' : process.argv[2] === 'morning' ? 'morning' : undefined
if (!type) throw new Error('usage: npm run brief:morning | npm run brief:evening')
const root = resolve(process.cwd())
const agentDir = resolve(getAgentDir())
const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), allowModelNetwork: false, refreshOnCreate: false })
const settings = await readRuntimeSettings(root)
const model = settings.model === undefined
  ? selectProductionReasoningModel(modelRuntime)
  : await validateReasoningModelSelection(modelRuntime, settings.model)
const reasoningExecutor = new PiReasoningExecutor({ modelRuntime, model })
const composition = await createDailyIntelligenceComposition({ cwd: root, workflowService: new WorkflowService(), reasoningExecutor, modelRuntime, mountedKnowledgeBaseRoot: process.env.RESEARCHHUB_KNOWLEDGE_BASE_ROOT })
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const started = composition.service.startBrief({ workflowRunId: `brief-${type}-${date}-${randomUUID().slice(0, 8)}`, briefType: type, tradeDate: date })
try { console.log(JSON.stringify(await started.completion, null, 2)) } finally {
  const disposable = modelRuntime as unknown as { dispose?: () => void | Promise<void> }
  if (typeof disposable.dispose === 'function') await disposable.dispose()
}
