import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { loadLocalRuntimeConfig, LocalRuntimeConfigError } from '../../../dsh/llm-runtime/local-runtime-config.ts'

const base = { RESEARCHHUB_REAL_LLM_ENABLED: 'false' }

test('local product validation config is deterministic and resolves external paths', () => {
  const config = loadLocalRuntimeConfig(base, 'C:\\ResearchHub')
  assert.equal(config.realLlmEnabled, false)
  assert.equal(config.provider, 'deepseek-official')
  assert.equal(config.model, 'deepseek-v4-flash')
  assert.equal(config.dataRoot, 'C:\\ResearchHubData')
  assert.equal(config.reportsDir, 'C:\\ResearchHubData\\input\\ai-hardware-reports')
  assert.equal(config.knowledgeBaseId, 'ai-hardware-real')
})

test('explicit Flash and Pro model overrides remain supported', () => {
  assert.equal(loadLocalRuntimeConfig({ ...base, RESEARCHHUB_LLM_MODEL: 'deepseek-v4-flash' }, 'C:\\ResearchHub').model, 'deepseek-v4-flash')
  assert.equal(loadLocalRuntimeConfig({ ...base, RESEARCHHUB_LLM_MODEL: 'deepseek-v4-pro' }, 'C:\\ResearchHub').model, 'deepseek-v4-pro')
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

test('native Node env-file bootstrap populates process.env and parent values take precedence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-env-bootstrap-test-'))
  const envPath = join(root, '.env.fake')
  try {
    await writeFile(envPath, [
      'BOOTSTRAP_FILE_VALUE=fake-file-value',
      'RESEARCHHUB_REAL_LLM_ENABLED=false',
      'DEEPSEEK_API_KEY=fake-file-key',
      'RESEARCHHUB_LLM_PROVIDER=deepseek-official',
      'RESEARCHHUB_LLM_MODEL=fake-file-model',
      'RESEARCHHUB_CURATION_MAX_TOKENS=777',
    ].join('\n') + '\n', 'utf8')
    const child = spawnSync(process.execPath, [
      `--env-file=${envPath}`,
      '-e',
      'process.stdout.write(JSON.stringify({ file: process.env.BOOTSTRAP_FILE_VALUE, parent: process.env.BOOTSTRAP_PARENT_VALUE, model: process.env.RESEARCHHUB_LLM_MODEL }))',
    ], {
      env: {
        BOOTSTRAP_PARENT_VALUE: 'fake-parent-value',
        RESEARCHHUB_LLM_MODEL: 'fake-parent-model',
      },
      encoding: 'utf8',
    })
    assert.equal(child.status, 0, child.stderr)
    const bootstrapped = JSON.parse(child.stdout) as Record<string, string>
    assert.equal(bootstrapped.file, 'fake-file-value')
    assert.equal(bootstrapped.parent, 'fake-parent-value')
    assert.equal(bootstrapped.model, 'fake-parent-model')

    const config = loadLocalRuntimeConfig({
      RESEARCHHUB_REAL_LLM_ENABLED: 'false',
      DEEPSEEK_API_KEY: 'fake-file-key',
      RESEARCHHUB_LLM_PROVIDER: 'deepseek-official',
      RESEARCHHUB_LLM_MODEL: bootstrapped.model,
      RESEARCHHUB_CURATION_MAX_TOKENS: '777',
    }, 'C:\\ResearchHub')
    assert.equal(config.model, 'fake-parent-model')
    assert.equal(config.curationMaxTokens, 777)
    assert.equal(config.apiKey, 'fake-file-key')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('DSH runtime config consumes process.env-shaped input without .env parsing', async () => {
  const source = await readFile('dsh/llm-runtime/local-runtime-config.ts', 'utf8')
  assert.doesNotMatch(source, /(?:readFile|dotenv|--env-file)/)
  const config = loadLocalRuntimeConfig({
    RESEARCHHUB_REAL_LLM_ENABLED: 'false',
    RESEARCHHUB_LLM_MODEL: 'fake-process-model',
  }, 'C:\\ResearchHub')
  assert.equal(config.model, 'fake-process-model')
})
