import assert from 'node:assert/strict'
import test from 'node:test'
import type { Api, Model } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { ModelRuntime as PiModelRuntime } from '@earendil-works/pi-coding-agent'
import { listReasoningModelCandidates, ReasoningModelSelectionError, validateReasoningModelSelection } from '../../../app/pi/model-selection.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const model = { provider: 'openai-codex', id: 'gpt-6-luna', name: 'GPT-6 Luna', api: 'openai-codex-responses', input: ['text', 'image'], compat: { supportsOpenAIGrammarTools: true } } as Model<Api>

function runtime(available: readonly Model<Api>[]): ModelRuntime {
  return {
    getModels: () => [model],
    getModel: (provider: string, modelId: string) => provider === model.provider && modelId === model.id ? model : undefined,
    getAvailable: async (provider: string) => available.filter((candidate) => candidate.provider === provider),
  } as unknown as ModelRuntime
}

test('Pi candidate catalog exposes gpt-6-luna only when Pi authentication is available', async () => {
  const candidates = await listReasoningModelCandidates(runtime([model]))
  assert.deepEqual(candidates, [{ provider: 'openai-codex', modelId: 'gpt-6-luna', name: 'GPT-6 Luna', available: true }])

  const unauthenticated = await listReasoningModelCandidates(runtime([]))
  assert.equal(unauthenticated[0]?.available, false)
  assert.match(unauthenticated[0]?.unavailableReason ?? '', /authentication/i)
})

test('Pi model selection rejects missing catalog entries and missing authentication', async () => {
  assert.equal(await validateReasoningModelSelection(runtime([model]), { provider: 'openai-codex', modelId: 'gpt-6-luna' }), model)
  await assert.rejects(() => validateReasoningModelSelection(runtime([]), { provider: 'openai-codex', modelId: 'gpt-6-luna' }), (error: unknown) => error instanceof ReasoningModelSelectionError && error.code === 'model_unavailable')
  await assert.rejects(() => validateReasoningModelSelection(runtime([model]), { provider: 'missing', modelId: 'model' }), (error: unknown) => error instanceof ReasoningModelSelectionError && error.code === 'model_unavailable')
})

test('installed Pi model catalog includes gpt-6-luna', async () => {
  const agentDir = await mkdtemp(join(tmpdir(), 'researchhub-pi-catalog-'))
  try {
    const runtime = await PiModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false })
    assert.equal(runtime.getModel('openai-codex', 'gpt-6-luna')?.name, 'GPT-6 Luna')
  } finally {
    await rm(agentDir, { recursive: true, force: true })
  }
})
