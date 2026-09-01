import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { loadLocalRuntimeConfig, LocalRuntimeConfigError } from '../../../dsh/llm-runtime/local-runtime-config.ts'
import { ISOLATED_RUNTIME_ENV_KEYS, isolatedEnvironment } from '../../../tools/knowledge-product-validation/preflight-isolated-env.ts'
import { applyPhaseCheckpoint, summarizeCandidateValidation, writeEvidenceAtomically } from '../../../tools/knowledge-product-validation/run-post-c12-extraction-smoke.ts'

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

test('isolated preflight removes inherited runtime overrides without mutating the parent environment', () => {
  const parent = {
    DEEPSEEK_API_KEY: 'fake-parent-key',
    DEEPSEEK_BASE_URL: 'https://fake-parent.example',
    RESEARCHHUB_REAL_LLM_ENABLED: 'true',
    RESEARCHHUB_LLM_PROVIDER: 'fake-parent-provider',
    RESEARCHHUB_LLM_MODEL: 'fake-parent-model',
    RESEARCHHUB_CURATION_MAX_TOKENS: '999',
    UNRELATED_VALUE: 'preserved',
  }
  const isolated = isolatedEnvironment(parent)
  for (const key of ISOLATED_RUNTIME_ENV_KEYS) assert.equal(isolated[key], undefined)
  assert.equal(isolated.UNRELATED_VALUE, 'preserved')
  assert.equal(parent.DEEPSEEK_API_KEY, 'fake-parent-key')
  assert.equal(parent.RESEARCHHUB_LLM_MODEL, 'fake-parent-model')
})

test('smoke checkpoints preserve phase history and elapsed time', () => {
  const startedAt = '2026-09-01T00:00:00.000Z'
  const initialized = applyPhaseCheckpoint({ startedAt }, 'initialized', Date.parse(startedAt) + 1000)
  const baseline = applyPhaseCheckpoint(initialized, 'baseline_verified', Date.parse(startedAt) + 2000)
  assert.equal(initialized.phase, 'initialized')
  assert.equal(initialized.elapsedMs, 1000)
  assert.equal(baseline.phase, 'baseline_verified')
  assert.equal(baseline.elapsedMs, 2000)
  assert.equal((baseline.phaseTimestamps as Record<string, string>).initialized, '2026-09-01T00:00:01.000Z')
  assert.equal((baseline.phaseTimestamps as Record<string, string>).baseline_verified, '2026-09-01T00:00:02.000Z')
})

test('smoke evidence projects nested candidate-validation attempts safely', () => {
  const summary = summarizeCandidateValidation(
    { entities: 2, relations: 3, claims: 1 },
    {
      attempts: [{
        accepted: { entity: 1, relation: 2, claim: 1 },
        rejected: { entity: 1, relation: 1, claim: 0 },
        rejectionCountsByCode: { invalid_semantics: 1 },
        rejections: [{ candidateKind: 'relation', originalOrdinal: 2, code: 'invalid_semantics', message: 'bounded' }],
      }],
    },
  )
  assert.deepEqual(summary?.acceptedCandidateCounts, { entity: 1, relation: 2, claim: 1 })
  assert.deepEqual(summary?.rejectedCandidateCounts, { entity: 1, relation: 1, claim: 0 })
  assert.deepEqual(summary?.rejectionCodeCounts, { invalid_semantics: 1 })
  assert.deepEqual(summary?.rejections, [{ candidateKind: 'relation', originalOrdinal: 2, code: 'invalid_semantics', relationType: null }])
})

test('smoke evidence replacement is atomic on interrupted writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-evidence-atomic-test-'))
  const evidencePath = join(root, 'evidence.json')
  try {
    await writeEvidenceAtomically(evidencePath, { phase: 'initialized' })
    await assert.rejects(
      writeEvidenceAtomically(evidencePath, { phase: 'baseline_verified' }, {
        beforeReplace: () => { throw new Error('simulated interruption') },
      }),
      /simulated interruption/,
    )
    assert.deepEqual(JSON.parse(await readFile(evidencePath, 'utf8')), { phase: 'initialized' })
    await writeEvidenceAtomically(evidencePath, { phase: 'baseline_verified' })
    assert.deepEqual(JSON.parse(await readFile(evidencePath, 'utf8')), { phase: 'baseline_verified' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
