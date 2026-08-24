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
import { isEvidence, isPrediction, isThesis } from '../../packages/artifacts/index.ts'
import extension from './event-analysis-extension.ts'

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

test('Event Analysis Skill loads, creates artifacts and persists the research Session', async () => {
  const ctx = new Context()
  const sessionRoot = await mkdtemp(join(tmpdir(), 'researchhub-event-analysis-session-'))
  const sessionId = 'researchhub-event-analysis-session'

  try {
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { persona: 'ResearchHub event analysis validation agent.' },
    })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SessionPersistenceJsonl, {
      root: sessionRoot,
      compression: 'none',
      packChunks: false,
    })
    await ctx.plugin(AgentLoop, { agents: [] })
    const extensionFiber = await ctx.plugin(extension, {
      skillRoot: join(process.cwd(), 'packages/skills'),
      createdAt: '2026-08-23T00:00:00.000Z',
    })
    const manager = extensionFiber.ctx.reflect.get('researchHubResearchManager') as import('./dsh/research-manager/index.ts').ResearchManager
    const handle = await manager.createValidationAgent(
      sessionId,
      'researchhub-event-analysis-validation',
      'event-analysis-validation-model',
    )

    await handle.agent.followup({
      id: MessageId('researchhub-event-analysis-prompt'),
      role: 'user',
      content: [{ type: 'text', text: 'Run the event analysis workflow for 600519.' }],
      source: { kind: 'user' },
    })
    await handle.agent.whenIdle()
    await ctx.sessions.flush(handle.agent.session)

    const events = manager.sessionEvents(handle.agent)
    const toolCalls = events.filter(event => event.type === 'tool/call')
    const toolResults = events.filter(event => event.type === 'tool/result')
    const finalAssistant = events.find(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text' && block.text.includes('Event analysis artifact workflow completed')))
    const turnEnd = [...events].reverse().find(event => event.type === 'turn/end')

    assert.deepEqual(toolCalls.map(event => event.data.name), ['skill', 'run_event_analysis'])
    assert.equal(toolResults.length, 2)
    const resultBlock = toolResults[1]?.data.message.content[0]
    assert.equal(resultBlock?.type, 'tool-result')
    const resultText = resultBlock?.content.find(block => block.type === 'text')
    assert.ok(resultText && resultText.type === 'text')
    const result = JSON.parse(resultText.text) as {
      status: string
      symbol: string
      artifacts: { evidence: unknown[]; thesis: unknown; prediction: unknown }
    }

    assert.equal(result.status, 'success')
    assert.equal(result.symbol, '600519')
    assert.equal(result.artifacts.evidence.length, 3)
    assert.ok(result.artifacts.evidence.every(isEvidence))
    assert.ok(isThesis(result.artifacts.thesis))
    assert.ok(isPrediction(result.artifacts.prediction))
    assert.ok(result.artifacts.evidence.every((artifact) => (artifact as { sessionId: string }).sessionId === sessionId))
    assert.equal((result.artifacts.thesis as { sessionId: string }).sessionId, sessionId)
    assert.equal((result.artifacts.prediction as { sessionId: string }).sessionId, sessionId)
    assert.deepEqual((result.artifacts.thesis as { evidenceIds: string[] }).evidenceIds, ['event-evidence-0', 'event-evidence-1', 'event-evidence-2'])
    assert.equal((result.artifacts.prediction as { thesisId: string }).thesisId, 'event-thesis-0')
    assert.ok(finalAssistant, 'Agent must produce a final response')
    assert.equal(turnEnd?.data.reason.kind, 'completed')

    const persistedFiles = await filesUnder(sessionRoot)
    const persistedPath = persistedFiles.find(file => file.endsWith('.jsonl'))
    assert.ok(persistedPath, 'Session persistence must write a JSONL file')
    const persisted = await readFile(persistedPath, 'utf8')
    assert.match(persisted, /event-analysis/)
    assert.match(persisted, /event-evidence-0/)
    assert.match(persisted, /event-thesis-0/)
    assert.match(persisted, /event-prediction-0/)
    assert.match(persisted, /Event analysis artifact workflow completed/)

    await handle.dispose()
  } finally {
    await ctx.fiber.dispose()
  }
})
