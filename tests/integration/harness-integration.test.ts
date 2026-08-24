import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SessionPersistenceJsonl from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MessageId } from '@deepseek-ai/dsh-llm'
import extension from './extension.ts'

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

test('ResearchHub integration validation runs through Harness and persists a Session', async () => {
  const ctx = new Context()
  const sessionRoot = await mkdtemp(join(tmpdir(), 'researchhub-harness-session-'))

  try {
    await mountAgentLoopTestDependencies(ctx, {
      systemPrompt: { persona: 'ResearchHub integration validation agent.' },
    })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SessionPersistenceJsonl, {
      root: sessionRoot,
      compression: 'none',
      packChunks: false,
    })
    await ctx.plugin(AgentLoop, { agents: [] })
    const extensionFiber = await ctx.plugin(extension, {
      skillRoot: join(process.cwd(), 'tests/integration/packages/skills'),
    })

    const extensionContext = extensionFiber.ctx
    const manager = extensionContext.reflect.get('researchHubResearchManager') as import('./dsh/research-manager/index.ts').ResearchManager
    const handle = await manager.createValidationAgent(
      'researchhub-validation-session',
      'researchhub-validation',
      'validation-model',
    )
    const agent = handle.agent
    await agent.followup({
      id: MessageId('researchhub-validation-prompt'),
      role: 'user',
      content: [{ type: 'text', text: 'Run the ResearchHub integration validation chain.' }],
      source: { kind: 'user' },
    })
    await agent.whenIdle()
    await ctx.sessions.flush(agent.session)

    const events = manager.sessionEvents(agent)
    const toolCalls = events.filter(event => event.type === 'tool/call')
    const toolResults = events.filter(event => event.type === 'tool/result')
    const finalAssistant = events.find(event => event.type === 'assistant/message' && event.data.message.content.some(block => block.type === 'text' && block.text.includes('integration validation completed')))
    const turnEnd = [...events].reverse().find(event => event.type === 'turn/end')
    const mock = ctx.llm.listProviders().some(provider => provider.id === 'researchhub-validation')

    assert.equal(mock, true, 'ResearchHub Extension must register the Harness LLM adapter')
    const plugin = extensionContext.reflect.get('researchHubValidationPlugin') as import('./packages/plugins/validation-plugin/index.ts').ValidationPlugin
    assert.equal(plugin.calls[0], 'validation-skill')
    assert.deepEqual(toolCalls.map(event => event.data.name), ['skill', 'researchhub_validation_plugin'])
    assert.equal(toolResults.length, 2)
    assert.ok(finalAssistant, 'Agent must produce a final response')
    assert.equal(turnEnd?.data.reason.kind, 'completed')

    const persistedFiles = await filesUnder(sessionRoot)
    assert.ok(persistedFiles.some(file => file.endsWith('.jsonl')), 'Session persistence must write a JSONL file')
    const persisted = await readFile(persistedFiles.find(file => file.endsWith('.jsonl'))!, 'utf8')
    assert.match(persisted, /researchhub_validation_plugin/)
    assert.match(persisted, /ResearchHub integration validation completed/)

    await handle.dispose()
  } finally {
    await ctx.fiber.dispose()
  }
})
