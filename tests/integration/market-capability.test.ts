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
import extension from './market-capability-extension.ts'

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

test('Market Capability Tool delegates to Mock Provider and persists its Session result', async () => {
  const ctx = new Context()
  const sessionRoot = await mkdtemp(join(tmpdir(), 'researchhub-market-session-'))

  try {
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { persona: 'ResearchHub market capability validation agent.' },
    })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SessionPersistenceJsonl, {
      root: sessionRoot,
      compression: 'none',
      packChunks: false,
    })
    await ctx.plugin(AgentLoop, { agents: [] })
    const extensionFiber = await ctx.plugin(extension)
    const manager = extensionFiber.ctx.reflect.get('researchHubResearchManager') as import('./packages/agents/research-manager/index.ts').ResearchManager
    const handle = await manager.createValidationAgent(
      'researchhub-market-capability-session',
      'researchhub-market-validation',
      'market-validation-model',
    )

    await handle.agent.followup({
      id: MessageId('researchhub-market-capability-prompt'),
      role: 'user',
      content: [{ type: 'text', text: 'Get the market snapshot for 600519.' }],
      source: { kind: 'user' },
    })
    await handle.agent.whenIdle()
    await ctx.sessions.flush(handle.agent.session)

    const events = manager.sessionEvents(handle.agent)
    const toolCalls = events.filter(event => event.type === 'tool/call')
    const toolResults = events.filter(event => event.type === 'tool/result')
    const finalAssistant = events.find(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text' && block.text.includes('Market capability integration validation completed')))
    const turnEnd = [...events].reverse().find(event => event.type === 'turn/end')

    assert.deepEqual(toolCalls.map(event => event.data.name), ['get_market_snapshot'])
    assert.equal(toolResults.length, 1)
    const resultBlock = toolResults[0].data.message.content[0]
    assert.equal(resultBlock.type, 'tool-result')
    const resultText = resultBlock.content.find(block => block.type === 'text')
    assert.ok(resultText && resultText.type === 'text')
    assert.deepEqual(JSON.parse(resultText.text), {
      symbol: '600519',
      price: 1680,
      change: 12.5,
      volume: 100000,
      source: 'mock',
    })
    assert.ok(finalAssistant, 'Agent must produce a final response')
    assert.equal(turnEnd?.data.reason.kind, 'completed')

    const persistedFiles = await filesUnder(sessionRoot)
    const persistedPath = persistedFiles.find(file => file.endsWith('.jsonl'))
    assert.ok(persistedPath, 'Session persistence must write a JSONL file')
    const persisted = await readFile(persistedPath, 'utf8')
    assert.match(persisted, /get_market_snapshot/)
    assert.match(persisted, /600519/)
    assert.match(persisted, /source.*mock/)
    assert.match(persisted, /Market capability integration validation completed/)

    await handle.dispose()
  } finally {
    await ctx.fiber.dispose()
  }
})
