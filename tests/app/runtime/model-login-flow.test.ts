import assert from 'node:assert/strict'
import test from 'node:test'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { ModelLoginFlowManager } from '../../../app/runtime/model-login-flow.ts'

async function settle(): Promise<void> { await new Promise((resolve) => setImmediate(resolve)) }

test('subscription login exposes a bounded prompt and completes after an answer', async () => {
  const manager = new ModelLoginFlowManager()
  let answer: string | undefined
  const runtime = {
    getProvider: () => ({ auth: { oauth: {} } }),
    login: async (_provider: string, _type: string, interaction: { prompt: (input: { type: 'manual_code'; message: string }) => Promise<string> }) => {
      answer = await interaction.prompt({ type: 'manual_code', message: 'Enter code' })
    },
  } as unknown as ModelRuntime
  const started = manager.start(runtime, 'openai-codex')
  await settle()
  assert.equal(manager.get(started.id)?.state, 'prompt')
  assert.equal(manager.get(started.id)?.prompt?.message, 'Enter code')
  manager.answer(started.id, 'test-code')
  await settle()
  assert.equal(answer, 'test-code')
  assert.equal(manager.get(started.id)?.state, 'complete')
  assert.equal(manager.hasActiveFlow(), false)
  manager.close()
})

test('subscription login cancellation releases the settings lock', async () => {
  const manager = new ModelLoginFlowManager()
  const runtime = {
    getProvider: () => ({ auth: { oauth: {} } }),
    login: async (_provider: string, _type: string, interaction: { prompt: (input: { type: 'manual_code'; message: string }) => Promise<string> }) => {
      await interaction.prompt({ type: 'manual_code', message: 'Enter code' })
    },
  } as unknown as ModelRuntime
  const started = manager.start(runtime, 'openai-codex')
  await settle()
  assert.equal(manager.hasActiveFlow(), true)
  assert.equal(manager.cancel(started.id)?.state, 'cancelled')
  await settle()
  assert.equal(manager.hasActiveFlow(), false)
  assert.equal(manager.get(started.id)?.state, 'cancelled')
  manager.close()
})
