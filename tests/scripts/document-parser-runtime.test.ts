import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { execPath } from 'node:process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
// @ts-expect-error The implementation is intentionally a project-local .mjs CLI.
import { bootstrapPlan, candidatePlan, configuredWindowsProxy, CPU_TORCH_INDEX, CPU_TORCH_PACKAGES, DOCLING_VERSION, MODEL_FAMILIES, preflight, PYPI_INDEX, runCommand, setup, STAGE_TIMEOUTS } from '../../scripts/document-parser-runtime.mjs'

type Candidate = { executable: string; args: string[] }
type CommandOptions = { cwd?: string; env?: Record<string, string | undefined>; timeoutMs?: number }
type Result = { ok: boolean; stdout: string; stderr: string; timedOut?: boolean }
type Execute = (executable: string, args: string[], options?: CommandOptions) => Promise<Result>
const probePayload = (docling = true, torch = true, torchvision = true) => JSON.stringify({ version: '3.12.0', venv: true, pip: true, docling, doclingVersion: docling ? DOCLING_VERSION : null, pypdf: true, pypdfVersion: '6.12.1', torch, torchVersion: torch ? '2.14.0+cpu' : null, torchCuda: null, torchCudaAvailable: false, torchCpuOnly: torch, torchvision, torchvisionVersion: torchvision ? '0.29.0+cpu' : null })

async function fixture(options: { finalVenv?: boolean; finalModels?: boolean; finalDocling?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rhl-runtime-test-')); const runtime = join(root, '.researchhub-document-parser')
  if (options.finalVenv) { await mkdir(join(runtime, 'venv', 'bin'), { recursive: true }); await writeFile(join(runtime, 'venv', 'bin', 'python'), 'managed') } else if (options.finalVenv === false) await mkdir(join(runtime, 'venv'), { recursive: true })
  if (options.finalModels) { await mkdir(join(runtime, 'models'), { recursive: true }); await writeFile(join(runtime, 'models', 'layout.bin'), 'model') }
  let finalDocling = options.finalDocling !== false
  const calls: Array<{ executable: string; args: string[]; options?: CommandOptions }> = []
  const execute = async (executable: string, args: string[], commandOptions?: CommandOptions): Promise<Result> => {
    calls.push({ executable, args, options: commandOptions })
    if (args.includes('-c')) { const isFinal = executable.includes(join('.researchhub-document-parser', 'venv')) && !executable.includes(join('.staging', '')); return { ok: true, stdout: probePayload(isFinal ? finalDocling : true), stderr: '' } }
    if (args.includes('-m') && args.includes('venv')) { finalDocling = true; await mkdir(join(args[args.length - 1], 'bin'), { recursive: true }); await writeFile(join(args[args.length - 1], 'bin', 'python'), 'staged'); return { ok: true, stdout: '', stderr: '' } }
    if (args.includes('pip')) return { ok: true, stdout: '', stderr: '' }
    if (args.includes('models') && args.includes('download')) { await mkdir(args[args.indexOf('--output-dir') + 1], { recursive: true }); await writeFile(join(args[args.indexOf('--output-dir') + 1], 'layout.bin'), 'model'); return { ok: true, stdout: '', stderr: '' } }
    if (commandOptions?.env?.HF_HUB_OFFLINE !== '1') return { ok: false, stdout: '', stderr: 'offline flag missing' }
    return { ok: true, stdout: '{}', stderr: '' }
  }
  return { root, calls, execute, setFinalDocling: (value: boolean) => { finalDocling = value } }
}

test('dependency is pinned, model families are fixed, and bootstrap uses a base candidate', async () => {
  const requirements = await (await import('node:fs/promises')).readFile('config/document-parser/requirements.txt', 'utf8')
  assert.deepEqual(requirements.trim().split(/\r?\n/).sort(), [`docling==${DOCLING_VERSION}`, 'pypdf==6.12.1'].sort()); assert.deepEqual(MODEL_FAMILIES, ['layout', 'tableformer'])
  const plan = bootstrapPlan('win32', { venv: 'managed-venv', models: 'managed-models' }, { executable: 'py', args: ['-3'], platform: 'win32' })
  assert.deepEqual(plan.venv, { executable: 'py', args: ['-3', '-m', 'venv', 'managed-venv'], systemSitePackages: false }); assert.deepEqual(bootstrapPlan('linux').models.args.slice(0, 3), ['models', 'download', 'layout']); assert.equal(bootstrapPlan('linux').models.args.includes('tableformer'), true)
})

test('managed dependency contract includes official CPU Torch packages', () => {
  assert.equal(CPU_TORCH_INDEX, 'https://download.pytorch.org/whl/cpu')
  assert.deepEqual(CPU_TORCH_PACKAGES, ['torch==2.14.0+cpu', 'torchvision==0.29.0+cpu'])
})

test('Windows proxy detection selects SOCKS5 for the configured local proxy', async () => {
  const proxy = await configuredWindowsProxy('win32', async () => ({ ok: true, stdout: '    ProxyServer    REG_SZ    127.0.0.1:7892\n', stderr: '' }))
  assert.equal(proxy, 'socks5h://127.0.0.1:7892')
})

test('pip install budget and command policy are bounded and explicit', async () => {
  assert.equal(STAGE_TIMEOUTS.pipInstall, 1_800_000)
  assert.deepEqual({ ...STAGE_TIMEOUTS, pipInstall: undefined }, { basePythonProbe: 30_000, venvCreation: 120_000, pipInstall: undefined, dependencyVerify: 30_000, modelDownload: 900_000, bridgeSmoke: 180_000, finalVerification: 180_000 })
  const args = bootstrapPlan('linux').install.args
  for (const value of ['--no-input', '--progress-bar', 'off', '--timeout', '30', '--retries', '2', '--prefer-binary', '--disable-pip-version-check', '-r', 'config/document-parser/requirements.txt']) assert.ok(args.includes(value), `missing ${value}`)
  for (const value of ['--no-deps', '--only-binary', '--extra-index-url']) assert.equal(args.includes(value), false, `unexpected ${value}`)
  const f = await fixture(); try { await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: f.execute }); const installs = f.calls.filter((call) => call.args.includes('pip')); assert.equal(installs.length, 2); const cpu = installs[0].args; assert.equal(cpu[cpu.indexOf('--index-url') + 1], CPU_TORCH_INDEX); assert.deepEqual(cpu.slice(-CPU_TORCH_PACKAGES.length), CPU_TORCH_PACKAGES); const docling = installs[1].args; assert.deepEqual(docling.slice(0, 3), ['-m', 'pip', 'install']); for (const value of ['--no-input', '--progress-bar', 'off', '--timeout', '30', '--retries', '2', '--prefer-binary', '--disable-pip-version-check']) assert.ok(docling.includes(value), `actual command missing ${value}`); assert.equal(docling[docling.indexOf('--index-url') + 1], PYPI_INDEX); assert.equal(docling[docling.indexOf('-r') + 1], join(f.root, 'config/document-parser/requirements.txt')) } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('candidate selection is bounded and explicit Python takes precedence', () => {
  assert.deepEqual(candidatePlan('win32').map((candidate: Candidate) => [candidate.executable, candidate.args]), [['py', ['-3']], ['python', []]]); assert.deepEqual(candidatePlan('linux').map((candidate: Candidate) => [candidate.executable, candidate.args]), [['python3', []], ['python', []]]); assert.deepEqual(candidatePlan('win32', 'C:\\tools\\python.exe').map((candidate: Candidate) => candidate.executable), ['C:\\tools\\python.exe'])
})

test('check mode is read-only and never installs or downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-runtime-test-')); const calls: string[][] = []
  try { const result = await preflight({ root, platform: 'linux', execute: async (executable: string, args: string[]) => { calls.push([executable, ...args]); return { ok: false, stdout: '', stderr: '' } } }); assert.equal(result.status, 'MANAGED_PYTHON_MISSING'); assert.equal(calls.some((call) => call.includes('pip') || call.includes('docling_tools')), false); assert.deepEqual(await readdir(root), []) } finally { await rm(root, { recursive: true, force: true }) }
})

test('setup failures are bounded and do not expose stderr', async (t) => {
  for (const [name, expected, failAt] of [['base', 'BASE_PYTHON_MISSING', 'base'], ['venv', 'VENV_CREATION_FAILED', 'venv'], ['pip', 'CPU_TORCH_INSTALL_FAILED: token=[redacted]', 'pip'], ['models', 'MODEL_DOWNLOAD_FAILED', 'models'], ['bridge', 'BRIDGE_SMOKE_FAILED', 'bridge']] as const) await t.test(name, async () => {
    const f = await fixture(); try { const result = await setup({ root: f.root, platform: 'linux', explicitPython: failAt === 'base' ? 'missing-python' : 'fixture-python', execute: (async (executable: string, args: string[], options?: CommandOptions) => { if (failAt === 'base' || (failAt === 'venv' && args.includes('venv')) || (failAt === 'pip' && args.includes('pip')) || (failAt === 'models' && args.includes('models')) || (failAt === 'bridge' && !args.includes('-c') && !args.includes('venv') && !args.includes('pip') && !args.includes('models'))) return { ok: false, stdout: '', stderr: 'private-token' }; return f.execute(executable, args, options) }) as Execute }); assert.equal(result.status, 'INCONCLUSIVE'); assert.equal(result.reason, expected); assert.doesNotMatch(JSON.stringify(result), /private-token|[A-Za-z]:\\Users\\/i) } finally { await rm(f.root, { recursive: true, force: true }) }
  })
})

test('partial final venv, missing Docling, and missing models are repaired to READY', async (t) => {
  for (const state of [{ finalVenv: false }, { finalVenv: true, finalDocling: false }, { finalVenv: true, finalModels: false }] as const) await t.test(JSON.stringify(state), async () => { const f = await fixture(state); try { assert.equal((await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: f.execute })).status, 'READY') } finally { await rm(f.root, { recursive: true, force: true }) } })
})

test('missing Torch is not reported as dependency-ready', async () => {
  const f = await fixture({ finalVenv: true, finalModels: true });
  try {
    f.setFinalDocling(false)
    const result = await preflight({ root: f.root, platform: 'linux', execute: (async (executable: string, args: string[], options?: CommandOptions) => {
      const value = await f.execute(executable, args, options)
      if (args.includes('-c')) return { ...value, stdout: probePayload(true, false, false) }
      return value
    }) as Execute })
    assert.equal(result.dependencyReady, false)
    assert.equal(result.status, 'DOCLING_OR_CPU_TORCH_DEPENDENCY_MISSING')
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('arbitrary non-empty models do not bypass a failed production bridge smoke', async () => {
  const f = await fixture({ finalVenv: true, finalModels: true }); try { const result = await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: (async (executable: string, args: string[], options?: CommandOptions) => { const value = await f.execute(executable, args, options); if (!args.includes('-c') && !args.includes('venv') && !args.includes('pip') && !args.includes('models')) return { ok: false, stdout: '', stderr: 'bridge-failed' }; return value }) as Execute }); assert.equal(result.reason, 'BRIDGE_SMOKE_FAILED') } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('verified READY setup performs no creation, install, download, or promotion', async () => {
  const f = await fixture({ finalVenv: true, finalModels: true }); try { f.calls.length = 0; assert.equal((await setup({ root: f.root, platform: 'linux', execute: f.execute })).status, 'READY'); assert.equal(f.calls.every((call) => !call.args.includes('pip') && !call.args.includes('models') && !call.args.includes('venv')), true) } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('staged bridge smoke is offline and failed staging preserves final runtime; stale staging is ignored', async () => {
  const f = await fixture({ finalVenv: true, finalModels: true }); const marker = join(f.root, '.researchhub-document-parser', 'venv', 'bin', 'python')
  try { await mkdir(join(f.root, '.researchhub-document-parser', '.staging', 'stale', 'venv'), { recursive: true }); const result = await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: (async (executable: string, args: string[], options?: CommandOptions) => { const value = await f.execute(executable, args, options); if (!args.includes('-c') && !args.includes('venv') && !args.includes('pip') && !args.includes('models')) return { ok: false, stdout: '', stderr: '' }; return value }) as Execute }); assert.equal(result.reason, 'BRIDGE_SMOKE_FAILED'); assert.equal(await (await import('node:fs/promises')).readFile(marker, 'utf8'), 'managed'); assert.equal(f.calls.some((call) => call.options?.env?.HF_HUB_OFFLINE === '1'), true); assert.deepEqual(await readdir(join(f.root, '.researchhub-document-parser', '.staging')), ['stale']) } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('promotion and final verification failures are bounded and recoverable', async (t) => {
  await t.test('promotion failure', async () => { const f = await fixture({ finalVenv: true, finalModels: true, finalDocling: false }); let failed = false; try { const result = await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: f.execute, move: async (source: string, destination: string) => { if (!failed && destination === join(f.root, '.researchhub-document-parser', 'models')) { failed = true; throw new Error('simulated promotion failure') }; await (await import('node:fs/promises')).rename(source, destination) } }); assert.equal(result.reason, 'PROMOTION_FAILED'); assert.equal((await (await import('node:fs/promises')).readFile(join(f.root, '.researchhub-document-parser', 'venv', 'bin', 'python'), 'utf8')), 'managed'); f.setFinalDocling(false); assert.equal((await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: f.execute })).status, 'READY') } finally { await rm(f.root, { recursive: true, force: true }) } })
  await t.test('final verification failure', async () => { const f = await fixture({ finalVenv: true, finalModels: true, finalDocling: false }); try { const result = await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: (async (executable: string, args: string[], options?: CommandOptions) => { const value = await f.execute(executable, args, options); if (args.includes('-c') && executable.includes(join('.researchhub-document-parser', 'venv')) && !executable.includes(join('.staging', ''))) return { ok: true, stdout: probePayload(false), stderr: '' }; return value }) as Execute }); assert.equal(result.reason, 'PROMOTION_FAILED') } finally { await rm(f.root, { recursive: true, force: true }) } })
})

test('every external subprocess receives a finite stage timeout', async () => {
  const f = await fixture(); try { await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: f.execute }); assert.ok(f.calls.length > 0); assert.equal(f.calls.every((call) => Number.isFinite(call.options?.timeoutMs) && (call.options?.timeoutMs ?? 0) > 0), true); assert.ok(f.calls.some((call) => call.options?.timeoutMs === STAGE_TIMEOUTS.pipInstall)); assert.ok(f.calls.some((call) => call.options?.timeoutMs === STAGE_TIMEOUTS.modelDownload)) } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('short injected pip timeout overrides the default without changing other budgets', async () => {
  const f = await fixture(); try { await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: f.execute, timeouts: { pipInstall: 7 } }); const pip = f.calls.find((call) => call.args.includes('pip')); assert.equal(pip?.options?.timeoutMs, 7); assert.equal(f.calls.find((call) => call.args.includes('venv'))?.options?.timeoutMs, STAGE_TIMEOUTS.venvCreation); assert.equal(f.calls.find((call) => call.args.includes('models'))?.options?.timeoutMs, STAGE_TIMEOUTS.modelDownload) } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('real child timeout resolves with timedOut and does not hang', async () => {
  const result = await runCommand(execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 20 }); assert.equal(result.ok, false); assert.equal(result.timedOut, true)
})

test('base probe, venv, and final verification timeouts are explicit and bounded', async (t) => {
  for (const [name, expected, marker] of [['base', 'BASE_PYTHON_PROBE_TIMEOUT', 'base'], ['venv', 'VENV_CREATION_TIMEOUT', 'venv']] as const) await t.test(name, async () => { const f = await fixture(); try { const execute = (async (executable: string, args: string[], options?: CommandOptions) => { if ((marker === 'base' && args.includes('-c') && executable === 'fixture-python') || (marker === 'venv' && args.includes('venv'))) return { ok: false, stdout: '', stderr: '', timedOut: true }; return f.execute(executable, args, options) }) as Execute; assert.equal((await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute, timeouts: { basePythonProbe: 5, venvCreation: 5 } })).reason, expected) } finally { await rm(f.root, { recursive: true, force: true }) } })
  await t.test('final verification', async () => { const f = await fixture({ finalVenv: true, finalModels: true, finalDocling: false }); let finalProbeCount = 0; const marker = join('.researchhub-document-parser', 'venv'); try { const execute = (async (executable: string, args: string[], options?: CommandOptions) => { if (args.includes('-c') && executable.includes(marker) && !executable.includes(join('.staging', ''))) { finalProbeCount += 1; if (finalProbeCount > 1) return { ok: false, stdout: '', stderr: '', timedOut: true } } return f.execute(executable, args, options) }) as Execute; assert.equal((await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute, timeouts: { basePythonProbe: 5, bridgeSmoke: 5 } })).reason, 'FINAL_VERIFICATION_TIMEOUT'); assert.equal(await (await import('node:fs/promises')).readFile(join(f.root, '.researchhub-document-parser', 'venv', 'bin', 'python'), 'utf8'), 'managed') } finally { await rm(f.root, { recursive: true, force: true }) } })
})

test('timeout classifications stop setup before downstream stages and persist bounded telemetry', async (t) => {
  for (const [name, expected, marker, downstream] of [
    ['pip', 'PIP_INSTALL_TIMEOUT', 'pip', ['models', 'bridge']],
    ['models', 'MODEL_DOWNLOAD_TIMEOUT', 'models', ['bridge']],
    ['bridge', 'BRIDGE_SMOKE_TIMEOUT', 'bridge', ['promotion']]
  ] as const) await t.test(name, async () => {
    const f = await fixture(); try {
      const execute = (async (executable: string, args: string[], options?: CommandOptions) => { if ((marker === 'pip' && args.includes('pip')) || (marker === 'models' && args.includes('models')) || (marker === 'bridge' && !args.includes('-c') && !args.includes('venv') && !args.includes('pip') && !args.includes('models'))) return { ok: false, stdout: 'raw-output', stderr: 'token=private', timedOut: true }; return f.execute(executable, args, options) }) as Execute
      const result = await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute, timeouts: { pipInstall: 5, modelDownload: 5, bridgeSmoke: 5 } }); assert.equal(result.reason, expected); const state = JSON.parse(await readFile(join(f.root, '.researchhub-document-parser', 'setup-state.json'), 'utf8')); assert.deepEqual({ stage: state.stage, status: state.status, reason: state.reason }, { stage: marker === 'pip' ? 'PIP_INSTALL' : marker === 'models' ? 'MODEL_DOWNLOAD' : 'BRIDGE_SMOKE', status: 'TIMED_OUT', reason: expected }); if (marker === 'pip') assert.equal(state.lastCompletedStage, 'VENV_CREATE'); assert.equal(f.calls.some((call) => downstream.some((value) => call.args.join(' ').toLowerCase().includes(value))), false)
    } finally { await rm(f.root, { recursive: true, force: true }) }
  })
})

test('pip failure remains distinct from pip timeout', async () => {
  const f = await fixture(); try { const result = await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: (async (executable: string, args: string[], options?: CommandOptions) => args.includes('pip') ? { ok: false, stdout: '', stderr: 'index failure' } : f.execute(executable, args, options)) as Execute }); assert.equal(result.reason, 'CPU_TORCH_INSTALL_FAILED: index failure'); const state = JSON.parse(await readFile(join(f.root, '.researchhub-document-parser', 'setup-state.json'), 'utf8')); assert.deepEqual({ stage: state.stage, status: state.status, reason: state.reason }, { stage: 'PIP_INSTALL', status: 'FAILED', reason: 'CPU_TORCH_INSTALL_FAILED: index failure' }) } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('setup telemetry records running stages, ordered completion, READY, and interruption safely', async (t) => {
  await t.test('running before pip and ordered completion', async () => {
    const f = await fixture(); const observed: string[] = []; try { const execute = (async (executable: string, args: string[], options?: CommandOptions) => { if ((args.includes('pip') && args.includes('-r')) || args.includes('models')) { const state = JSON.parse(await readFile(join(f.root, '.researchhub-document-parser', 'setup-state.json'), 'utf8')); observed.push(`${args.includes('pip') ? 'PIP_INSTALL' : 'MODEL_DOWNLOAD'}:${state.stage}:${state.status}:${state.lastCompletedStage}`) } return f.execute(executable, args, options) }) as Execute; const result = await setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute }); assert.equal(result.status, 'READY'); assert.deepEqual(observed.slice(0, 2), ['PIP_INSTALL:PIP_INSTALL:RUNNING:VENV_CREATE', 'MODEL_DOWNLOAD:MODEL_DOWNLOAD:RUNNING:DEPENDENCY_VERIFY']); const state = JSON.parse(await readFile(join(f.root, '.researchhub-document-parser', 'setup-state.json'), 'utf8')); assert.deepEqual({ stage: state.stage, status: state.status, lastCompletedStage: state.lastCompletedStage }, { stage: 'READY', status: 'SUCCEEDED', lastCompletedStage: 'READY' }); assert.equal(JSON.stringify(state).includes('raw-output'), false) } finally { await rm(f.root, { recursive: true, force: true }) }
  })
  await t.test('external interruption leaves active stage RUNNING', async () => { const f = await fixture(); try { await assert.rejects(() => setup({ root: f.root, platform: 'linux', explicitPython: 'fixture-python', execute: (async (executable: string, args: string[], options?: CommandOptions) => { if (args.includes('pip')) throw new Error('simulated external interruption'); return f.execute(executable, args, options) }) as Execute })); const state = JSON.parse(await readFile(join(f.root, '.researchhub-document-parser', 'setup-state.json'), 'utf8')); assert.deepEqual({ stage: state.stage, status: state.status }, { stage: 'PIP_INSTALL', status: 'RUNNING' }) } finally { await rm(f.root, { recursive: true, force: true }) } })
})

test('READY setup records telemetry without reinstalling or redownloading', async () => {
  const f = await fixture({ finalVenv: true, finalModels: true }); try { f.calls.length = 0; assert.equal((await setup({ root: f.root, platform: 'linux', execute: f.execute })).status, 'READY'); assert.equal(f.calls.every((call) => !call.args.includes('pip') && !call.args.includes('models') && !call.args.includes('venv')), true); await access(join(f.root, '.researchhub-document-parser', 'setup-state.json')); } finally { await rm(f.root, { recursive: true, force: true }) }
})
