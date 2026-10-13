import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rhl-wf-persist-browser-'))
const profileRoot = join(fixtureRoot, 'edge-profile')
const edgePath = process.env['ProgramFiles(x86)']
  ? join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const evidencePath = join(repositoryRoot, 'tests', 'validation', 'evidence', 'RHL-WF-PERSIST-001-BROWSER-E2E-001.json')
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

async function freePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen) })
  const port = server.address().port
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

function startRuntime(phase) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/validation/ux004-browser-fixture.ts'], {
    cwd: repositoryRoot,
    env: { ...process.env, RHL_UX004_FIXTURE_ROOT: fixtureRoot, RHL_WF_PERSIST_ACCEPTANCE: '1', RHL_WF_PERSIST_PHASE: phase },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const lines = []
  const waiters = []
  let snapshotCursor = 0
  const stdout = createInterface({ input: child.stdout })
  const stderr = createInterface({ input: child.stderr })
  let stderrText = ''
  stdout.on('line', (line) => {
    lines.push(line)
    const lineIndex = lines.length - 1
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (lineIndex >= waiters[i].afterIndex && waiters[i].test(line)) { const [waiter] = waiters.splice(i, 1); waiter.resolve(line) }
    }
  })
  stderr.on('line', (line) => { stderrText += `${line}\n` })
  const waitFor = (test, timeoutMs = 30_000, afterIndex = 0) => new Promise((resolveWait, rejectWait) => {
    const existing = lines.find((line, index) => index >= afterIndex && test(line))
    if (existing) return resolveWait(existing)
    const waiter = { test, afterIndex, resolve: resolveWait, reject: rejectWait }
    waiters.push(waiter)
    const timer = setTimeout(() => { const index = waiters.indexOf(waiter); if (index >= 0) waiters.splice(index, 1); rejectWait(new Error(`Runtime fixture timed out. stderr=${stderrText}`)) }, timeoutMs)
    timer.unref?.()
  })
  child.once('exit', (code, signal) => {
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`Runtime fixture exited before response (${code ?? signal}). stderr=${stderrText}`))
  })
  return {
    child,
    lines,
    waitFor,
    stderr: () => stderrText,
    async ready() { return JSON.parse((await waitFor((line) => line.startsWith('READY '))).slice('READY '.length)) },
    async snapshot() { child.stdin.write('snapshot\n'); const line = await waitFor((value) => value.startsWith('SNAPSHOT '), 30_000, snapshotCursor); snapshotCursor = lines.indexOf(line) + 1; return JSON.parse(line.slice('SNAPSHOT '.length)) },
    async command(value, prefix) { child.stdin.write(`${value}\n`); return waitFor((line) => line.startsWith(prefix)) },
    async stop() { child.stdin.write('stop\n'); await new Promise((resolveExit, rejectExit) => { const timer = setTimeout(() => rejectExit(new Error(`Graceful Runtime stop timed out. stderr=${stderrText}`)), 15_000); child.once('exit', () => { clearTimeout(timer); resolveExit() }) }) },
  }
}

async function waitUntil(read, predicate, description, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs
  let last
  while (Date.now() < end) {
    last = await read()
    if (predicate(last)) return last
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${description}; last=${JSON.stringify(last)}`)
}

async function startEdge(port) {
  const edge = spawn(edgePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${profileRoot}`, 'about:blank',
  ], { stdio: 'ignore', windowsHide: true })
  const end = Date.now() + 30_000
  while (Date.now() < end) {
    try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); if (response.ok) return edge }
    catch { /* Edge is still starting. */ }
    if (edge.exitCode !== null) throw new Error(`Edge exited during startup with code ${edge.exitCode}`)
    await sleep(200)
  }
  throw new Error('Edge DevTools endpoint did not become ready')
}

function runBrowser(port, origin, mode, runId, expectedStatus) {
  const args = ['tests/validation/ux004-browser-acceptance.mjs', String(port), origin, mode]
  if (runId !== undefined) args.push(runId, expectedStatus)
  const result = spawnSync(process.execPath, args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 45_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Browser ${mode} acceptance failed. stdout=${result.stdout}\nstderr=${result.stderr}`)
  return JSON.parse(result.stdout)
}

let edge
let currentRuntime
const evidence = {
  taskId: 'RHL-WF-PERSIST-001',
  browser: 'Microsoft Edge headless via CDP',
  fixture: 'isolated Company Research providers and Knowledge Base; model network disabled',
  runtimeProcesses: [],
  checkpoints: [],
}

try {
  const first = startRuntime('terminal-company-research')
  currentRuntime = first
  const ready1 = await first.ready()
  const cdpPort = await freePort()
  edge = await startEdge(cdpPort)
  const browserRun = runBrowser(cdpPort, ready1.origin, 'workflow')
  evidence.checkpoints.push(...browserRun.checkpoints)
  const completedSnapshot = await waitUntil(() => first.snapshot(), (value) => value.started.length > 0 && value.workflows.some((item) => ['completed', 'blocked', 'failed'].includes(item?.status)), 'Company Research terminal result')
  const runId = completedSnapshot.started[0]?.workflowRunId
  const terminal = completedSnapshot.workflows.find((item) => item?.runId === runId)
  assert.ok(runId, 'the real browser Company Research request must create a Workflow run')
  assert.equal(terminal.status, 'completed', `fixture Company Research should complete rather than only record a blocked result: ${JSON.stringify(terminal)}`)
  assert.ok(terminal.stages.length >= 6, 'the terminal snapshot must retain the actually observed Company Research stages')
  assert.equal(terminal.historyPersistence.status, 'saved')
  const snapshotPath = join(fixtureRoot, 'cwd', 'runtime-data', 'workflow-observations', `${runId}.json`)
  const durable1 = JSON.parse(await readFile(snapshotPath, 'utf8'))
  assert.equal(durable1.workflow.status, 'completed')
  assert.deepEqual(durable1.workflow.stages.map((stage) => stage.stageId), terminal.stages.map((stage) => stage.stageId))
  evidence.runtimeProcesses.push({ phase: 'complete-company-research', pid: first.child.pid, runtimeOrigin: ready1.runtimeOrigin, browserOrigin: ready1.origin, exit: 'graceful' })
  evidence.completedRun = { runId, workflowType: terminal.workflowType, status: terminal.status, observationRevision: terminal.observationRevision, stageIds: terminal.stages.map((stage) => stage.stageId), providerIds: terminal.providerObservations.map((provider) => provider.providerId), skillIds: terminal.skillObservations.map((skill) => skill.skillId), executionResult: terminal.executionResult, knowledgeBaseSha256: completedSnapshot.knowledgeBaseSha256 }
  evidence.checkpoints.push({ name: 'full Company Research snapshot persisted before graceful Runtime shutdown', passed: true, schemaVersion: durable1.schemaVersion, observationRevision: durable1.observationRevision, workflowStatus: durable1.workflow.status, stageCount: durable1.workflow.stages.length })
  await first.stop()
  currentRuntime = undefined

  const second = startRuntime('terminal-recovery')
  currentRuntime = second
  const ready2 = await second.ready()
  assert.notEqual(second.child.pid, first.child.pid)
  const http2 = await fetch(`${ready2.origin}/api/workflows/${encodeURIComponent(runId)}`)
  assert.equal(http2.status, 200)
  const restored2 = await http2.json()
  assert.equal(restored2.status, 'completed')
  assert.equal(restored2.observationSource, 'historical')
  assert.equal(restored2.historyPersistence.status, 'saved')
  assert.deepEqual(restored2.stages.map((stage) => stage.stageId), evidence.completedRun.stageIds)
  const idle2 = await second.snapshot()
  assert.deepEqual(idle2.started, [], 'restart must not re-run Company Research')
  assert.deepEqual(idle2.providerDiscovery, {}, 'restart must not call acquisition providers')
  assert.equal(idle2.knowledgeBaseSha256, evidence.completedRun.knowledgeBaseSha256, 'history recovery must not write to Knowledge')
  evidence.runtimeProcesses.push({ phase: 'terminal-recovery', pid: second.child.pid, runtimeOrigin: ready2.runtimeOrigin, browserOrigin: ready2.origin, exit: 'killed-for-next-crash-case' })
  evidence.checkpoints.push({ name: 'second independent Runtime restores terminal Company Research over the existing HTTP API', passed: true, status: restored2.status, observationSource: restored2.observationSource, stageCount: restored2.stages.length, executionsAfterRestart: idle2.started.length, providerCallsAfterRestart: Object.keys(idle2.providerDiscovery).length, knowledgeBaseSha256Unchanged: true })
  const browserRecovery = runBrowser(cdpPort, ready2.origin, 'recover', runId, 'completed')
  evidence.checkpoints.push(...browserRecovery.checkpoints)

  await second.command('hold-acquisition', 'ACQUISITION_HELD')
  const interruptedBrowser = runBrowser(cdpPort, ready2.origin, 'workflow-new')
  process.stderr.write(`IN_FLIGHT_BROWSER ${JSON.stringify(interruptedBrowser.checkpoints)}\n`)
  evidence.checkpoints.push(...interruptedBrowser.checkpoints)
  const inFlight = await waitUntil(() => second.snapshot(), (value) => value.started.length > 0 && value.workflows.some((item) => item?.status === 'running' && item.stages.some((stage) => stage.stageId === 'data_acquisition' && stage.status === 'running')), 'persisted in-flight Company Research stage')
  const crashRunId = inFlight.started[0]?.workflowRunId
  assert.ok(crashRunId)
  const crashSnapshotPath = join(fixtureRoot, 'cwd', 'runtime-data', 'workflow-observations', `${crashRunId}.json`)
  const crashDurable = JSON.parse(await readFile(crashSnapshotPath, 'utf8'))
  assert.equal(crashDurable.workflow.status, 'running')
  assert.equal(crashDurable.workflow.stages.find((stage) => stage.stageId === 'data_acquisition')?.status, 'running')
  second.child.kill('SIGKILL')
  await new Promise((resolveExit, rejectExit) => { const timer = setTimeout(() => rejectExit(new Error('Unexpected Runtime termination did not finish')), 10_000); second.child.once('exit', (code, signal) => { clearTimeout(timer); if (code === 0) rejectExit(new Error('Crash fixture exited gracefully instead of by unexpected termination')); else resolveExit({ code, signal }) }) })
  currentRuntime = undefined
  evidence.runtimeProcesses.push({ phase: 'in-flight-company-research-crash', pid: second.child.pid, runtimeOrigin: ready2.runtimeOrigin, exit: 'SIGKILL', runId: crashRunId })
  evidence.inFlightRun = { runId: crashRunId, snapshotStatusBeforeCrash: crashDurable.workflow.status, lastObservedStage: crashDurable.workflow.stages.find((stage) => stage.stageId === 'data_acquisition'), observationRevision: crashDurable.observationRevision }

  const third = startRuntime('interrupted-recovery')
  currentRuntime = third
  const ready3 = await third.ready()
  assert.notEqual(third.child.pid, second.child.pid)
  const response3 = await fetch(`${ready3.origin}/api/workflows/${encodeURIComponent(crashRunId)}`)
  assert.equal(response3.status, 200)
  const restored3 = await response3.json()
  assert.equal(restored3.status, 'interrupted')
  assert.equal(restored3.recoveryState.kind, 'interrupted')
  assert.equal(restored3.recoveryState.lastObservedStatus, 'running')
  assert.equal(restored3.executionResult?.executionStatus, 'interrupted')
  assert.equal(restored3.executionResult?.terminalStatus, undefined)
  assert.equal(restored3.completedAt, undefined)
  assert.equal(restored3.stages.find((stage) => stage.stageId === 'data_acquisition')?.status, 'interrupted')
  assert.equal(restored3.stages.find((stage) => stage.stageId === 'data_acquisition')?.completedAt, undefined)
  assert.equal(restored3.stages.find((stage) => stage.stageId === 'data_acquisition')?.durationMs, undefined)
  const idle3 = await third.snapshot()
  assert.deepEqual(idle3.started, [])
  assert.deepEqual(idle3.providerDiscovery, {})
  assert.equal(idle3.knowledgeBaseSha256, evidence.completedRun.knowledgeBaseSha256)
  evidence.runtimeProcesses.push({ phase: 'interrupted-recovery', pid: third.child.pid, runtimeOrigin: ready3.runtimeOrigin, browserOrigin: ready3.origin, exit: 'graceful' })
  evidence.checkpoints.push({ name: 'third independent Runtime restores an in-flight run as interrupted without replay', passed: true, status: restored3.status, lastObservedStatus: restored3.recoveryState.lastObservedStatus, stage: restored3.stages.find((stage) => stage.stageId === 'data_acquisition'), completedAt: restored3.completedAt, replayedExecutions: idle3.started.length, providerCallsAfterRestart: Object.keys(idle3.providerDiscovery).length })
  const interruptedRecoveryBrowser = runBrowser(cdpPort, ready3.origin, 'recover', crashRunId, 'interrupted')
  evidence.checkpoints.push(...interruptedRecoveryBrowser.checkpoints)
  evidence.knowledgeBase = { beforeResearchSha256: ready1.knowledgeBaseSha256, afterCompletedResearchSha256: evidence.completedRun.knowledgeBaseSha256, afterCrashRecoverySha256: idle3.knowledgeBaseSha256 }
  evidence.completedAt = new Date().toISOString()
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  await third.stop()
  currentRuntime = undefined
  process.stdout.write(`${JSON.stringify({ status: 'PASS', evidencePath, runId, crashRunId, processCount: new Set(evidence.runtimeProcesses.map((item) => item.pid)).size, checkpoints: evidence.checkpoints.length }, null, 2)}\n`)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  if (currentRuntime?.child.exitCode === null) currentRuntime.child.kill('SIGKILL')
  if (edge?.exitCode === null) edge.kill()
  await sleep(500)
  await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)
}
