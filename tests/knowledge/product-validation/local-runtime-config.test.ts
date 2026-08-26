import assert from 'node:assert/strict'
import test from 'node:test'
import { loadLocalRuntimeConfig, LocalRuntimeConfigError } from '../../../dsh/llm-runtime/local-runtime-config.ts'

const base = { RESEARCHHUB_REAL_LLM_ENABLED: 'false' }

test('local product validation config is deterministic and resolves external paths', () => {
  const config = loadLocalRuntimeConfig(base, 'C:\\ResearchHub')
  assert.equal(config.realLlmEnabled, false)
  assert.equal(config.provider, 'deepseek-official')
  assert.equal(config.model, 'deepseek-v4-pro')
  assert.equal(config.dataRoot, 'C:\\ResearchHubData')
  assert.equal(config.reportsDir, 'C:\\ResearchHubData\\input\\ai-hardware-reports')
  assert.equal(config.knowledgeBaseId, 'ai-hardware-real')
})

test('real execution fails fast without exposing a key', () => {
  assert.throws(() => loadLocalRuntimeConfig({ ...base, RESEARCHHUB_REAL_LLM_ENABLED: 'true' }, 'C:\\ResearchHub', { requireRealLlm: true }), (error: unknown) => {
    assert.ok(error instanceof LocalRuntimeConfigError)
    assert.equal(error.code, 'missing_deepseek_api_key')
    assert.doesNotMatch(error.message, /DEEPSEEK_API_KEY=.*/)
    return true
  })
})

test('real execution cannot be enabled by an inherited key while the project flag is false', () => {
  assert.throws(() => loadLocalRuntimeConfig({ ...base, DEEPSEEK_API_KEY: 'inherited-secret' }, 'C:\\ResearchHub', { requireRealLlm: true }), (error: unknown) => {
    assert.ok(error instanceof LocalRuntimeConfigError)
    assert.equal(error.code, 'real_llm_disabled')
    assert.doesNotMatch(error.message, /inherited-secret/)
    return true
  })
})
