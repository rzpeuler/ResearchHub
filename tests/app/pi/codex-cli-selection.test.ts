import test from 'node:test'
import assert from 'node:assert/strict'
import { createCodexCliLunaReasoningExecutor, createIndustryProductionReasoningExecutor, createRawDocumentPreviewProductionReasoningExecutor, INDUSTRY_PRODUCTION_REASONING_SELECTION, PRIMARY_PRODUCTION_REASONING_MODEL, RAW_DOCUMENT_PREVIEW_PRODUCTION_REASONING_SELECTION } from '../../../app/pi/model-selection.ts'

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
  const executor = await createRawDocumentPreviewProductionReasoningExecutor({ capabilities, executable: process.execPath })
  assert.deepEqual(executor.runtimeMetadata(), { provider: 'pi-coding-agent', backend: 'codex-cli', requestedModel: 'gpt-6-luna', requestedReasoningEffort: 'high', invocationMode: 'exec-stdin-json-output-read-only', structuredOutputEnabled: true })
})
