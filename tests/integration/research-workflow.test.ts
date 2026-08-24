import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { MessageId } from '@deepseek-ai/dsh-llm'
import extension from './research-workflow-extension.ts'

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await filesUnder(path))
    else files.push(path)
  }
  return files
}

test('Research Workflow runs through Harness Agent, Plugins, Artifacts, Report View, and Session persistence', async () => {
  const ctx = new Context()
  const sessionRoot = await mkdtemp(join(tmpdir(), 'researchhub-research-workflow-session-'))
  const sessionId = 'researchhub-research-workflow-session'

  try {
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: 'ResearchHub research workflow validation agent.' } })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SessionPersistenceJsonl, { root: sessionRoot, compression: 'none', packChunks: false })
    await ctx.plugin(AgentLoop, { agents: [] })
    const extensionFiber = await ctx.plugin(extension, {
      skillRoot: join(process.cwd(), 'packages/skills'),
      createdAt: '2026-08-24T00:00:00.000Z',
    })
    const service = extensionFiber.ctx.reflect.get('researchHubResearchManager') as import('../../dsh/research-manager/index.ts').ResearchManagerService
    const handle = await service.createAgent(sessionId, 'researchhub-research-workflow-validation', 'research-workflow-validation-model')

    await handle.agent.followup({
      id: MessageId('research-workflow-prompt'),
      role: 'user',
      content: [{ type: 'text', text: 'Run the event-analysis research workflow for 600519.' }],
      source: { kind: 'user' },
    })
    await handle.agent.whenIdle()
    await ctx.sessions.flush(handle.agent.session)

    const events = service.sessionEvents(handle.agent)
    const toolCalls = events.filter(event => event.type === 'tool/call')
    const toolResults = events.filter(event => event.type === 'tool/result')
    const finalAssistant = events.find(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text' && block.text.includes('structured report view')))
    const turnEnd = [...events].reverse().find(event => event.type === 'turn/end')
    assert.deepEqual(toolCalls.map(event => event.data.name), ['skill', 'run_research_workflow'])
    assert.equal(toolResults.length, 2)

    const resultBlock = toolResults[1]?.data.message.content[0]
    assert.equal(resultBlock?.type, 'tool-result')
    const resultText = resultBlock?.content.find(block => block.type === 'text')
    assert.ok(resultText && resultText.type === 'text')
    const result = JSON.parse(resultText.text) as {
      status: string
      workflowId: string
      report: { evidenceIds: string[]; thesisIds: string[]; predictionIds: string[]; sessionId: string }
    }
    assert.equal(result.status, 'completed')
    assert.equal(result.workflowId, 'event-analysis')
    assert.equal(result.report.evidenceIds.length, 6)
    assert.equal(result.report.thesisIds.length, 1)
    assert.equal(result.report.predictionIds.length, 1)
    assert.equal(result.report.sessionId, sessionId)
    assert.ok(finalAssistant)
    assert.equal(turnEnd?.data.reason.kind, 'completed')

    const persistedFiles = await filesUnder(sessionRoot)
    const persistedPath = persistedFiles.find(file => file.endsWith('.jsonl'))
    assert.ok(persistedPath)
    const persisted = await readFile(persistedPath!, 'utf8')
    assert.match(persisted, /run_research_workflow/)
    assert.match(persisted, /research-workflow-evidence-0/)
    assert.match(persisted, /research-workflow-thesis-0/)
    assert.match(persisted, /research-workflow-prediction-0/)
    assert.match(persisted, /structured report view/)

    await handle.dispose()
  } finally {
    await ctx.fiber.dispose()
  }
})
