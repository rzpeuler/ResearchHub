import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const fixtureRoot = await mkdtemp(join(tmpdir(), 'rhl-ux-ia-browser-'))
const profileRoot = join(fixtureRoot, 'edge-profile')
const edgePath = process.env['ProgramFiles(x86)']
  ? join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const evidencePath = join(repositoryRoot, 'tests', 'validation', 'evidence', 'RHL-UX-IA-001-BROWSER-E2E.json')
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

const allApiResponses = []
async function browserConnection(port) {
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item => item.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  let sequence = 0
  const pending = new Map()
  const responses = []
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.method === 'Network.responseReceived' && message.params.response.url.includes('/api/')) {
      const response = { path: new URL(message.params.response.url).pathname, status: message.params.response.status }
      responses.push(response); allApiResponses.push(response)
    }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result)
  })
  await new Promise((resolveOpen, reject) => { ws.addEventListener('open', resolveOpen, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  const cdp = (method, params = {}) => new Promise((resolveCall, reject) => { const id = ++sequence; pending.set(id, { resolve: resolveCall, reject }); ws.send(JSON.stringify({ id, method, params })) })
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result?.value }
  const until = (expression, description = expression) => waitUntil(() => evaluate(expression), Boolean, description, 20_000)
  const click = async selector => assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`), `missing ${selector}`)
  const key = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`); await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }) }
  const navigate = async url => { await cdp('Page.navigate', { url }); await until(`document.readyState==='complete'&&!!document.querySelector('.app-shell')`) }
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable')
  return { cdp, evaluate, until, click, key, navigate, responses, close: () => ws.close() }
}

let edge
let currentRuntime
let browser
const evidence = { taskId: 'RHL-UX-IA-001', status: 'RUNNING', capturedAt: new Date().toISOString(), browser: 'Microsoft Edge headless via CDP', productionClient: true, providerFixture: 'Isolated CNINFO/GDELT and faux Pi provider; real Runtime services, Workflow, persisted Pi SessionManager, Report/Bundle stores and APIs', knowledgeBaseIsolation: true, runtimeProcesses: [], artifacts: [], checkpoints: [] }
const record = (id, data) => evidence.checkpoints.push({ id, passed: true, ...data })
const bundlePath = runId => join(fixtureRoot, 'cwd', 'runtime-data', 'research-bundles', `research-bundle-${runId}.json`)
async function artifact(origin, runId) {
  const response = await fetch(`${origin}/api/research/bundles/by-run/${runId}`)
  assert.equal(response.status, 200)
  const bundle = await response.json()
  assert.equal(bundle.workflowRunId, runId)
  const reportId = bundle.report?.reportId
  assert.ok(reportId)
  const reportResponse = await fetch(`${origin}/api/research-reports/${reportId}`)
  assert.equal(reportResponse.status, 200)
  const report = await reportResponse.json()
  assert.equal(report.workflowRunId, runId)
  return { runId, bundleId: bundle.bundleId, reportId, report, bundle }
}
async function selectReport(origin, reportId) {
  await browser.navigate(`${origin}/reports`)
  await browser.until(`!![...document.querySelectorAll('.reports-page .result-item')].find(e=>e.textContent.includes(${JSON.stringify(reportId)}))`)
  await browser.evaluate(`[...document.querySelectorAll('.reports-page .result-item')].find(e=>e.textContent.includes(${JSON.stringify(reportId)})).click()`)
  await browser.until(`document.querySelector('.report-detail h2')?.textContent===${JSON.stringify(reportId)}`)
}
async function open(index, useKeyboard = false) {
  const selector = `.report-appendix > details:nth-of-type(${index}) > summary`
  if (useKeyboard) await browser.key(selector); else await browser.click(selector)
}
const sectionText = index => `document.querySelector('.report-appendix > details:nth-of-type(${index})')?.innerText`
try {
  const first = startRuntime('report-centric-artifacts')
  currentRuntime = first
  const ready1 = await first.ready()
  assert.equal(ready1.persistentPiSessionManager, true)
  evidence.runtimeProcesses.push({ phase: 'before restart', pid: first.child.pid, persistentPiSessionManager: true })
  const port = await freePort(); edge = await startEdge(port)
  runBrowser(port, ready1.origin, 'workflow')
  const firstSnapshot = await waitUntil(() => first.snapshot(), value => value.workflows.some(item => item?.status === 'completed'), 'completed Company Research')
  const run1 = firstSnapshot.started[0].workflowRunId
  const a = await waitUntil(() => artifact(ready1.origin, run1).catch(() => null), Boolean, 'persisted Report and Bundle')
  evidence.artifacts.push({ runId: run1, reportId: a.reportId, bundleId: a.bundleId })
  record('E2E-01', { ...evidence.artifacts[0], workflow: firstSnapshot.workflows[0], actualCompanyResearch: true })
  browser = await browserConnection(port)
  await selectReport(ready1.origin, a.reportId)
  assert.equal(await browser.evaluate(`document.querySelectorAll('.report-appendix > details[open]').length`), 0)
  assert.ok(await browser.evaluate(`document.querySelectorAll('.report-detail .brief-section').length>0`))
  await open(2)
  await browser.until(`${sectionText(2)}?.includes(${JSON.stringify(run1)})`)
  assert.equal(await browser.evaluate(`!!document.querySelector('.report-appendix > details:nth-of-type(2) details[open]')`), false)
  record('E2E-02', { reportId: a.reportId, runId: run1, dom: await browser.evaluate(sectionText(2)), jsonCollapsed: true })
  await open(1)
  await browser.until(`${sectionText(1)}?.includes('暂无来源库命中')||${sectionText(1)}?.includes('来源库候选证据')`)
  record('E2E-03', { sourceDom: await browser.evaluate(sectionText(1)), proposalDom: await browser.evaluate(sectionText(2)), sourceHitCount: a.bundle.sourceLibraryHits.length, proposalCount: a.bundle.proposals.length })
  // Produce a second genuine report to test isolation between distinct run IDs.
  browser.close(); browser = undefined
  runBrowser(port, ready1.origin, 'workflow-new')
  const secondSnapshot = await waitUntil(() => first.snapshot(), value => value.started.length >= 2 && value.workflows[1]?.status === 'completed', 'second Company Research report')
  const run2 = secondSnapshot.started[1].workflowRunId
  const b = await waitUntil(() => artifact(ready1.origin, run2).catch(() => null), Boolean, 'second persisted artifacts')
  evidence.artifacts.push({ runId: run2, reportId: b.reportId, bundleId: b.bundleId })
  browser = await browserConnection(port)
  await selectReport(ready1.origin, a.reportId)
  const original = await readFile(bundlePath(run1), 'utf8')
  // Genuine file absence, malformed JSON, and a valid second-run Bundle transplanted to the first path.
  for (const [kind, contents, expected] of [['missing', null, '没有可用研究资料包'], ['corrupt', '{broken', '附录暂时无法读取'], ['transplanted', JSON.stringify(b.bundle), '附录暂时无法读取']]) {
    if (contents === null) await rm(bundlePath(run1)); else await writeFile(bundlePath(run1), contents)
    await selectReport(ready1.origin, a.reportId); await open(2)
    await browser.until(`${sectionText(2)}?.includes(${JSON.stringify(expected)})`)
    assert.equal(await browser.evaluate(`${sectionText(2)}?.includes(${JSON.stringify(run2)})`), false)
    record('E2E-06', { kind, reportId: a.reportId, dom: await browser.evaluate(sectionText(2)), reportBodyPreserved: await browser.evaluate(`document.querySelectorAll('.report-detail .brief-section').length>0`) })
    await writeFile(bundlePath(run1), original)
    if (kind === 'corrupt') {
      await browser.cdp('Emulation.setDeviceMetricsOverride', { width: 375, height: 900, deviceScaleFactor: 1, mobile: true })
      await browser.click('.report-appendix > details:nth-of-type(2) button')
      await browser.until(`${sectionText(2)}?.includes(${JSON.stringify(run1)})`)
      await open(2, true)
      await browser.until(`document.querySelector('.report-appendix > details:nth-of-type(2)').open===false`)
      await open(2, true)
      await browser.until(`${sectionText(2)}?.includes(${JSON.stringify(run1)})`)
      const dimensions = await browser.evaluate(`({width:innerWidth,scrollWidth:document.documentElement.scrollWidth})`)
      assert.ok(dimensions.scrollWidth <= dimensions.width + 1, JSON.stringify(dimensions))
      record('E2E-08', { ...dimensions, keyboardCollapseAndExpand: true, retryAfterRealFileRepair: true })
      await browser.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
    }
  }
  await selectReport(ready1.origin, a.reportId)
  await first.command('delay-next-bundle', 'BUNDLE_DELAY_ARMED')
  await open(2)
  await first.waitFor(line => line.startsWith('BUNDLE_RESPONSE_HELD'))
  await browser.evaluate(`[...document.querySelectorAll('.reports-page .result-item')].find(e=>e.textContent.includes(${JSON.stringify(b.reportId)})).click()`)
  await browser.until(`document.querySelector('.report-detail h2')?.textContent===${JSON.stringify(b.reportId)}`)
  await open(2)
  await browser.until(`${sectionText(2)}?.includes(${JSON.stringify(run2)})`)
  await sleep(2_400)
  assert.equal(await browser.evaluate(`${sectionText(2)}?.includes(${JSON.stringify(run1)})`), false)
  record('E2E-09', { delayedRun: run1, currentRun: run2, delayMs: 2000, dom: await browser.evaluate(sectionText(2)), delayedActualBackendResponse: true })
  await browser.navigate(`${ready1.origin}/bundles`)
  await browser.until(`!!document.querySelector('[aria-labelledby="bundles-title"]')&&document.querySelectorAll('[aria-labelledby="bundles-title"] .result-item').length>=2`)
  const primaryNavigationCount = await browser.evaluate(`document.querySelectorAll('.primary-nav a').length`)
  assert.ok(primaryNavigationCount > 0)
  const topNavBundleAbsent = await browser.evaluate(`![...document.querySelectorAll('.primary-nav a')].some(e=>e.getAttribute('href')==='/bundles')`)
  assert.equal(topNavBundleAbsent, true)
  record('E2E-07', { legacyPath: '/bundles', dom: await browser.evaluate(`document.querySelector('[aria-labelledby="bundles-title"]').innerText.slice(0,1500)`), primaryNavigationCount, topNavBundleAbsent })
  browser.close(); browser = undefined
  // An actual cancelled Company Research run, retained in its original persisted conversation.
  await first.command('hold-acquisition', 'ACQUISITION_HELD')
  runBrowser(port, ready1.origin, 'workflow-new')
  const heldSnapshot = await first.snapshot()
  const noReportRun = heldSnapshot.started[2].workflowRunId
  browser = await browserConnection(port)
  const cancelButton = await browser.until(`(()=>{const e=[...document.querySelectorAll('button')].find(x=>/取消工作流|Cancel Workflow/.test(x.textContent));if(!e)return false;e.click();return true})()`)
  assert.ok(cancelButton)
  await first.command('release-acquisition', 'ACQUISITION_RELEASED')
  const cancelledBundle = await waitUntil(async () => { const response = await fetch(`${ready1.origin}/api/research/bundles/by-run/${noReportRun}`); return response.ok ? response.json() : null }, value => value && !value.report, 'cancelled no-report Bundle')
  await browser.until(`!![...document.querySelectorAll('[data-activity-id] button')].find(x=>/查看研究资料包|View Research Bundle/.test(x.textContent))`)
  await browser.evaluate(`[...document.querySelectorAll('[data-activity-id] button')].find(x=>/查看研究资料包|View Research Bundle/.test(x.textContent)).click()`)
  await browser.until(`document.querySelector('.report-detail')?.innerText.includes(${JSON.stringify(noReportRun)})`)
  record('E2E-05', { runId: noReportRun, bundleId: cancelledBundle.bundleId, reportAbsent: true, originalConversationActivity: true, dom: await browser.evaluate(`document.querySelector('.report-detail').innerText.slice(0,1800)`) })
  browser.close(); browser = undefined
  const beforeRestart = await first.snapshot()
  await first.stop(); currentRuntime = undefined
  const second = startRuntime('report-history-after-restart'); currentRuntime = second
  const ready2 = await second.ready()
  evidence.runtimeProcesses.push({ phase: 'after graceful restart', pid: second.child.pid, persistentPiSessionManager: ready2.persistentPiSessionManager })
  assert.notEqual(first.child.pid, second.child.pid)
  assert.equal(ready2.knowledgeBaseSha256, beforeRestart.knowledgeBaseSha256)
  browser = await browserConnection(port)
  await selectReport(ready2.origin, a.reportId); await open(3)
  await browser.until(`${sectionText(3)}?.includes('historical')`)
  const historical = await (await fetch(`${ready2.origin}/api/workflows/${run1}`)).json()
  assert.equal(historical.observationSource, 'historical'); assert.equal(historical.status, 'completed')
  assert.equal(historical.stages.length, firstSnapshot.workflows[0].stages.length)
  assert.equal(historical.stages.length, 7)
  for (const field of ['stages', 'providerObservations', 'skillObservations']) assert.deepEqual(historical[field], firstSnapshot.workflows[0][field])
  assert.equal((await second.snapshot()).started.length, 0)
  record('E2E-04', { runId: run1, reportId: a.reportId, bundleId: a.bundleId, historicalApi: historical, dom: await browser.evaluate(sectionText(3)), noExecutionReplay: true, knowledgeBaseUnchanged: true })
  evidence.apiResponses = allApiResponses
  evidence.status = 'PASS'
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({ status: evidence.status, checkpoints: evidence.checkpoints.length, artifacts: evidence.artifacts, evidencePath })}\n`)
} catch (error) {
  evidence.status = 'FAIL'; evidence.failure = error instanceof Error ? error.message : String(error)
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  throw error
} finally {
  browser?.close()
  await currentRuntime?.stop().catch(() => currentRuntime.child.kill())
  if (edge && edge.exitCode === null) { spawnSync('taskkill.exe', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }) }
  await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined)
}
