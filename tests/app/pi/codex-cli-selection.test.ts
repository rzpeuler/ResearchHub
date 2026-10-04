import test from 'node:test'
import assert from 'node:assert/strict'
import { createCodexCliLunaReasoningExecutor, createIndustryProductionReasoningExecutor, createRawDocumentPreviewProductionReasoningExecutor, INDUSTRY_PRODUCTION_REASONING_SELECTION, PRIMARY_PRODUCTION_REASONING_MODEL, RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION, RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS, THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS } from '../../../app/pi/model-selection.ts'
import { CodexCliReasoningExecutor } from '../../../plugins/reasoning/codex-cli/executor.ts'

const capabilities = { maxContextTokens: 4_000, maxOutputTokens: 1_000, structuredOutputSupport: true, maxConcurrency: 1 }

test('explicit Codex CLI Luna factory is separate from unchanged production selection', async () => {
  assert.deepEqual(PRIMARY_PRODUCTION_REASONING_MODEL, { providerId: 'zhipu-openapi', modelId: 'glm-5.3-flash' })
  const executor = await createCodexCliLunaReasoningExecutor({ capabilities, executable: process.execPath })
  assert.deepEqual(executor.runtimeMetadata(), { provider: 'pi-coding-agent', backend: 'codex-cli', requestedModel: 'gpt-5.6-luna', requestedReasoningEffort: 'medium', invocationMode: 'exec-stdin-json-output-read-only', structuredOutputEnabled: true })
})

test('Industry production factory explicitly selects Codex CLI Luna medium', async () => {
  assert.deepEqual(INDUSTRY_PRODUCTION_REASONING_SELECTION, { backend: 'codex-cli', requestedModel: 'gpt-5.6-luna', requestedReasoningEffort: 'medium' })
  const executor = await createIndustryProductionReasoningExecutor({ capabilities, executable: process.execPath })
  assert.deepEqual(executor.runtimeMetadata(), { provider: 'pi-coding-agent', backend: 'codex-cli', requestedModel: 'gpt-5.6-luna', requestedReasoningEffort: 'medium', invocationMode: 'exec-stdin-json-output-read-only', structuredOutputEnabled: true })
})

test('Raw Document preview production factory explicitly selects Codex CLI Luna high', async () => {
  assert.deepEqual(RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION, { backend: 'codex-cli', requestedModel: 'gpt-6-luna', requestedReasoningEffort: 'high' })
  assert.equal(RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS, 600_000)
  assert.equal(THEME_FRAMEWORK_PRODUCTION_REASONING_TIMEOUT_MS, 180_000)
  const codexLayerTimeouts: number[] = []
  const originalComplete = CodexCliReasoningExecutor.prototype.complete
  CodexCliReasoningExecutor.prototype.complete = async function () {
    codexLayerTimeouts.push((this as unknown as { timeoutMs: number }).timeoutMs)
    return JSON.stringify({ ok: true })
  }
  try {
    const executor = await createRawDocumentPreviewProductionReasoningExecutor({ capabilities, executable: process.execPath })
    assert.equal((executor as unknown as { timeoutMs: number }).timeoutMs, RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS)
    assert.deepEqual(executor.runtimeMetadata(), { provider: 'pi-coding-agent', backend: 'codex-cli', requestedModel: 'gpt-6-luna', requestedReasoningEffort: 'high', invocationMode: 'exec-stdin-json-output-read-only', structuredOutputEnabled: true })
    const request = { operation: 'understandAndPlan' as const, instruction: 'fixture', input: {}, outputContract: { type: 'object' as const, properties: { ok: { type: 'boolean' as const } }, required: ['ok'], additionalProperties: false } }
    await executor.execute(request)
    const overriddenTimeoutMs = 45_000
    const overridden = await createRawDocumentPreviewProductionReasoningExecutor({ capabilities, executable: process.execPath, timeoutMs: overriddenTimeoutMs })
    assert.equal((overridden as unknown as { timeoutMs: number }).timeoutMs, overriddenTimeoutMs)
    await overridden.execute(request)
    assert.deepEqual(codexLayerTimeouts, [RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_TIMEOUT_MS, overriddenTimeoutMs])
  } finally {
    CodexCliReasoningExecutor.prototype.complete = originalComplete
  }
})
