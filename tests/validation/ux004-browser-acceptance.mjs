const [portText, url, mode = 'chat', screenshotDir = ''] = process.argv.slice(2)
const port = Number(portText)
if (!Number.isInteger(port) || !url) throw new Error('usage: node ux004-browser-acceptance.mjs <cdp-port> <url> [chat|workflow|drawer] [screenshot-dir]')
const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((item) => item.type === 'page')
if (!target?.webSocketDebuggerUrl) throw new Error('No Edge page target')
const ws = new WebSocket(target.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
const networkEvents = []
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.method === 'Network.responseReceived' && message.params?.response?.url?.includes('/api/events')) networkEvents.push({ kind: 'response', status: message.params.response.status, url: message.params.response.url, at: Date.now() })
  if (message.method === 'Network.loadingFailed' && message.params?.type === 'EventSource') networkEvents.push({ kind: 'failed', errorText: message.params.errorText, at: Date.now() })
  if (message.id === undefined) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
  else waiter.resolve(message.result)
})
await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
const evalInPage = async (expression) => {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const until = async (expression, timeout = 15_000) => {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await evalInPage(expression); if (value) return value; await wait(150) }
  throw new Error(`Timed out waiting for: ${expression}`)
}
const click = async (selector) => {
  const ok = await evalInPage(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.click();return true})()`)
  if (!ok) throw new Error(`Missing clickable selector: ${selector}`)
}
const mouseClick = async (selector) => {
  const point = await evalInPage(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)
  if (!point) throw new Error(`Missing pointer target: ${selector}`)
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
}
const type = async (selector, text) => {
  const focused = await evalInPage(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.focus();return true})()`)
  if (!focused) throw new Error(`Missing input selector: ${selector}`)
  await cdp('Input.insertText', { text })
  await wait(80)
}
const key = async (key, { shift = false, code = key } = {}) => {
  const modifiers = shift ? 8 : 0
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, text: key === 'Enter' && shift ? '\n' : undefined, unmodifiedText: key === 'Enter' && shift ? '\n' : undefined, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : undefined })
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: key === 'Enter' ? 13 : key === 'Escape' ? 27 : undefined })
}
const submitByEnter = async (text) => {
  await type('textarea[aria-label="消息"],textarea[aria-label="Message"]', text)
  await key('Enter')
  return await until(`(()=>[...document.querySelectorAll('article.message .message-body')].some(e=>e.textContent===${JSON.stringify(text)}))()`)
}
const submitByButton = async (text) => {
  await type('textarea[aria-label="消息"],textarea[aria-label="Message"]', text)
  await click('button.primary-action')
  return await until(`(()=>[...document.querySelectorAll('article.message .message-body')].some(e=>e.textContent===${JSON.stringify(text)}))()`)
}
const selectCompanyWorkflow = async () => {
  const found = await evalInPage(`(()=>{const s=document.querySelector('select[aria-label="Workflow"]');if(!s)return false;s.focus();return true})()`)
  if (!found) throw new Error('Workflow select not present')
  const selected = await evalInPage(`document.querySelector('select[aria-label="Workflow"]')?.value==='company_research'`)
  if (!selected) { await key('ArrowDown'); await key('Enter') }
  return await until(`document.querySelector('select[aria-label="Workflow"]')?.value==='company_research'`)
}
await cdp('Page.enable')
await cdp('Runtime.enable')
await cdp('Network.enable')
await cdp('Browser.grantPermissions', { origin: url, permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] }).catch(() => undefined)
await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await cdp('Page.navigate', { url })
await until(`document.readyState==='complete'&&!!document.querySelector('textarea[aria-label="消息"],textarea[aria-label="Message"]')`)
const evidence = { mode, origin: url, at: new Date().toISOString(), browser: 'Microsoft Edge via CDP', checkpoints: [] }
if (mode === 'drawer') {
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 900, deviceScaleFactor: 1, mobile: true })
  await click('button.workflow-panel-toggle')
  const opened = await until(`(()=>{const d=document.querySelector('[role="dialog"]');return d&&d.getAttribute('aria-modal')==='true'&&document.activeElement?.classList.contains('workflow-panel-close')})()`)
  const openedInfo = await evalInPage(`JSON.stringify({toggleExpanded:document.querySelector('button.workflow-panel-toggle')?.getAttribute('aria-expanded'),dialogLabel:document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),focus:document.activeElement?.getAttribute('aria-label'),viewport:innerWidth,scrollWidth:document.documentElement.scrollWidth})`)
  evidence.checkpoints.push({ name: '320px workflow drawer open', result: JSON.parse(openedInfo) })
  if (screenshotDir) { const shot = await cdp('Page.captureScreenshot', { format: 'png' }); const { writeFile, mkdir } = await import('node:fs/promises'); await mkdir(screenshotDir, { recursive: true }); await writeFile(`${screenshotDir}/drawer-320-open.png`, Buffer.from(shot.data, 'base64')) }
  await key('Escape')
  const restored = await until(`document.querySelector('button.workflow-panel-toggle')?.getAttribute('aria-expanded')==='false'&&document.activeElement?.classList.contains('workflow-panel-toggle')`)
  evidence.checkpoints.push({ name: 'Escape closes drawer and restores trigger focus', passed: Boolean(restored) })
}
if (mode === 'chat') {
  await click('button.new-conversation')
  await until(`document.querySelector('textarea[aria-label="消息"],textarea[aria-label="Message"]')&&document.querySelectorAll('.optimistic-request').length===0`)
  const prompt = `UX004 browser Enter submission ${Date.now()}`
  await submitByEnter(prompt)
  const answer = await until(`(()=>[...document.querySelectorAll('article.message.assistant:not(.streaming-message) .message-body')].some(e=>e.textContent?.includes('Fixture response')) )()`)
  const chatInfo = JSON.parse(await evalInPage(`JSON.stringify({prompt:${JSON.stringify(prompt)},assistant:[...document.querySelectorAll('article.message.assistant:not(.streaming-message) .message-body')].map(e=>e.textContent),activityCount:document.querySelectorAll('[data-activity-id]').length,optimisticCount:document.querySelectorAll('.optimistic-request').length,connection:document.querySelector('.session-pill')?.textContent})`))
  evidence.checkpoints.push({ name: 'Enter submits through real client/runtime and receives faux Pi response', result: chatInfo })
  const copyTarget = await evalInPage(`(()=>{const m=[...document.querySelectorAll('article.message.assistant:not(.streaming-message)')].at(-1);return m?.querySelector('button')?'.message.assistant:not(.streaming-message) button':null})()`)
  if (!copyTarget) throw new Error('Assistant copy button is absent')
  await mouseClick(copyTarget)
  await wait(100)
  const copyResult = JSON.parse(await evalInPage(`JSON.stringify({body:[...document.querySelectorAll('article.message.assistant:not(.streaming-message) .message-body')].at(-1)?.textContent,status:[...document.querySelectorAll('article.message.assistant:not(.streaming-message) [role=status]')].at(-1)?.textContent})`))
  evidence.checkpoints.push({ name: 'Assistant copy button activated by trusted CDP pointer; live-region result observed', result: copyResult, passed: copyResult.status === '已复制' || copyResult.status === 'Copied' })
  const textareaSelector = 'textarea[aria-label="消息"],textarea[aria-label="Message"]'
  await type(textareaSelector, 'line one')
  await evalInPage(`(()=>{window.__ux004ShiftPrevented=undefined;document.querySelector(${JSON.stringify(textareaSelector)})?.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.shiftKey)setTimeout(()=>window.__ux004ShiftPrevented=e.defaultPrevented,0)},{once:false})})()`)
  await key('Enter', { shift: true })
  // CDP emits the real Shift+Enter key event, but Edge headless does not synthesize textarea's newline default action.
  // Insert that unprevented default text via CDP and record the event's defaultPrevented result.
  await cdp('Input.insertText', { text: '\n' })
  await wait(50)
  const shiftText = await evalInPage(`document.querySelector(${JSON.stringify(textareaSelector)})?.value`)
  const shiftPrevented = await evalInPage('window.__ux004ShiftPrevented')
  evidence.checkpoints.push({ name: 'Shift+Enter is not prevented; textarea newline default inserted by CDP', textareaValue: shiftText, defaultPrevented: shiftPrevented, passed: shiftText === 'line one\n' && shiftPrevented === false, note: 'Headless Edge CDP did not synthesize the textarea newline default; Input.insertText supplied the browser default text after the genuine Shift+Enter key event.' })
  await type(textareaSelector, 'line two')
  await key('Enter')
  await until(`document.querySelectorAll('[data-activity-id]').length>=2`)
  evidence.checkpoints.push({ name: 'second keyboard submit accepted after Shift+Enter', passed: true })
  const composer = await evalInPage(`document.querySelector(${JSON.stringify(textareaSelector)})?.outerHTML`)
  await evalInPage(`document.querySelector(${JSON.stringify(textareaSelector)})?.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:'中'}))`)
  await type(textareaSelector, 'IME composition test')
  await key('Enter')
  const composing = await evalInPage(`JSON.stringify({requests:document.querySelectorAll('.optimistic-request').length,value:document.querySelector(${JSON.stringify(textareaSelector)})?.value})`)
  await evalInPage(`document.querySelector(${JSON.stringify(textareaSelector)})?.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中'}))`)
  evidence.checkpoints.push({ name: 'synthetic CompositionEvent guard (not native OS IME)', result: JSON.parse(composing), notNativeIme: true })
  void answer; void composer
}
if (mode === 'workflow' || mode === 'workflow-new') {
  if (mode === 'workflow-new') {
    await click('button.new-conversation')
    await until(`document.querySelector('textarea[aria-label="消息"],textarea[aria-label="Message"]')&&document.querySelectorAll('.optimistic-request').length===0`)
  }
  await selectCompanyWorkflow()
  const selected = await evalInPage(`JSON.stringify({selectedId:document.querySelector('select[aria-label="Workflow"]').value,selectedLabel:document.querySelector('select[aria-label="Workflow"] option:checked')?.textContent})`)
  const prompt = `请对跨境通（002640）进行公司深度研究 UX004 ${Date.now()}`
  await submitByEnter(prompt)
  const request = await until(`(()=>{const a=[...document.querySelectorAll('[data-activity-id]')];return a.some(e=>e.textContent?.includes('Workflow ·')||e.textContent?.includes('工作流 ·'))})()`)
  await wait(1000)
  evidence.checkpoints.push({ name: 'selected Workflow UI submit and runtime association', selection: JSON.parse(selected), visible: await evalInPage(`JSON.stringify({activity:[...document.querySelectorAll('[data-activity-id]')].map(e=>e.innerText),workflowCard:document.querySelector('[data-testid="workflow-progress-card"]')?.innerText,subject:document.querySelector('.workflow-subject')?.textContent,runId:document.querySelector('[data-testid="workflow-progress-card"]')?.getAttribute('data-run-id')})`) })
  void request
}
if (mode === 'recover') {
  const runId = process.argv[5]
  const expectedStatus = process.argv[6] ?? 'completed'
  if (!runId) throw new Error('recover mode requires <runId> [expected-status]')
  const api = await until(`fetch('/api/workflows/${encodeURIComponent(runId)}').then(async r=>r.ok?await r.json():null).then(value=>value&&value.runId===${JSON.stringify(runId)}?value:null)`, 20_000)
  const recovery = JSON.parse(await evalInPage(`(async()=>JSON.stringify({api:await fetch('/api/workflows/${encodeURIComponent(runId)}').then(r=>r.json()),card:(()=>{const e=document.querySelector('[data-testid="workflow-progress-card"]');return e?{runId:e.getAttribute('data-run-id'),text:e.innerText,historical:!!e.querySelector('[data-testid="workflow-historical-snapshot"]'),recovery:!!e.querySelector('[data-testid="workflow-recovery-notice"]'),stages:[...e.querySelectorAll('.workflow-stage-timeline li')].map(x=>x.innerText)}:null})()}))()`))
  if (!api || recovery.api.status !== expectedStatus || recovery.card?.runId !== runId || !recovery.card.historical) throw new Error(`Historical Workflow was not restored in the browser: ${JSON.stringify(recovery)}`)
  if (expectedStatus === 'interrupted' && !recovery.card.recovery) throw new Error(`Interrupted recovery notice is missing: ${JSON.stringify(recovery.card)}`)
  evidence.checkpoints.push({ name: 'real Runtime restart restores historical Workflow in the browser', result: recovery, passed: true })
}
if (mode === 'sse-monitor') {
  const samples = []
  const started = Date.now()
  let previous
  while (Date.now() - started < 30_000) {
    const current = JSON.parse(await evalInPage(`JSON.stringify({at:Date.now(),connection:document.querySelector('.session-pill')?.textContent,activeRun:document.querySelector('[data-testid="workflow-progress-card"]')?.getAttribute('data-run-id')})`))
    if (current.connection !== previous?.connection) samples.push(current)
    previous = current
    await wait(250)
  }
  evidence.checkpoints.push({ name: 'SSE interruption and automatic reconnect observations', samples, networkEvents })
}
if (mode === 'scroll') {
  await click('button.new-conversation')
  await until(`document.querySelectorAll('.optimistic-request').length===0`)
  await submitByButton(`UX004 long stream scroll test ${Date.now()}`)
  await until(`(()=>{const m=document.querySelector('.messages');const body=document.querySelector('.streaming-message .message-body');return body&&m&&m.scrollHeight>m.clientHeight+100})()`)
  const scrollElement = await evalInPage(`(()=>{const e=document.querySelector('.messages');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight,scrollTop:e.scrollTop}})()`)
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: scrollElement.x, y: scrollElement.y, deltaX: 0, deltaY: -1200 })
  await wait(250)
  const paused = JSON.parse(await evalInPage(`JSON.stringify({scrollTop:document.querySelector('.messages')?.scrollTop,scrollHeight:document.querySelector('.messages')?.scrollHeight,clientHeight:document.querySelector('.messages')?.clientHeight,jumpVisible:!!document.querySelector('.jump-to-latest'),streaming:!!document.querySelector('.streaming-message')})`))
  await wait(500)
  const held = JSON.parse(await evalInPage(`JSON.stringify({scrollTop:document.querySelector('.messages')?.scrollTop,jumpVisible:!!document.querySelector('.jump-to-latest'),streaming:!!document.querySelector('.streaming-message')})`))
  evidence.checkpoints.push({ name: 'Reader scroll pauses follow-tail and exposes jump-to-latest', initialScroll: scrollElement, afterWheel: paused, afterFurtherStreaming: held, passed: paused.jumpVisible && Math.abs(paused.scrollTop - held.scrollTop) < 5 })
  if (screenshotDir) { const shot = await cdp('Page.captureScreenshot', { format: 'png' }); const { writeFile, mkdir } = await import('node:fs/promises'); await mkdir(screenshotDir, { recursive: true }); await writeFile(`${screenshotDir}/scroll-paused.png`, Buffer.from(shot.data, 'base64')) }
  const jumpButton = await until(`!!document.querySelector('button.jump-to-latest')` , 5000)
  if (jumpButton) await click('button.jump-to-latest')
  const jumped = JSON.parse(await evalInPage(`JSON.stringify({scrollTop:document.querySelector('.messages')?.scrollTop,scrollHeight:document.querySelector('.messages')?.scrollHeight,clientHeight:document.querySelector('.messages')?.clientHeight,jumpVisible:!!document.querySelector('.jump-to-latest')})`))
  evidence.checkpoints.push({ name: 'Jump-to-latest returns reader to stream tail', result: jumped, passed: !jumped.jumpVisible && jumped.scrollTop + jumped.clientHeight >= jumped.scrollHeight - 5 })
}
if (mode === 'scroll-existing') {
  await until(`!!document.querySelector('.streaming-message .message-body')`)
  const initial = await evalInPage(`(()=>{const e=document.querySelector('.messages');if(!e)return null;const r=e.getBoundingClientRect();e.scrollTop=e.scrollHeight;return {x:r.x+r.width/2,y:r.y+r.height/2,scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}})()`)
  await wait(150)
  await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: initial.x, y: initial.y, deltaX: 0, deltaY: -1200 })
  await wait(300)
  const held = JSON.parse(await evalInPage(`JSON.stringify({scrollTop:document.querySelector('.messages')?.scrollTop,scrollHeight:document.querySelector('.messages')?.scrollHeight,clientHeight:document.querySelector('.messages')?.clientHeight,jumpVisible:!!document.querySelector('.jump-to-latest'),streaming:!!document.querySelector('.streaming-message')})`))
  await wait(500)
  const heldAfter = JSON.parse(await evalInPage(`JSON.stringify({scrollTop:document.querySelector('.messages')?.scrollTop,scrollHeight:document.querySelector('.messages')?.scrollHeight,clientHeight:document.querySelector('.messages')?.clientHeight,jumpVisible:!!document.querySelector('.jump-to-latest'),streaming:!!document.querySelector('.streaming-message')})`))
  evidence.checkpoints.push({ name: 'Active long stream: wheel-up pauses follow-tail and presents jump control', initial, afterWheel: held, afterMoreContent: heldAfter, passed: held.jumpVisible && Math.abs(held.scrollTop - heldAfter.scrollTop) < 5 })
  if (screenshotDir) { const shot = await cdp('Page.captureScreenshot', { format: 'png' }); const { writeFile, mkdir } = await import('node:fs/promises'); await mkdir(screenshotDir, { recursive: true }); await writeFile(`${screenshotDir}/scroll-existing-paused.png`, Buffer.from(shot.data, 'base64')) }
  const hasButton = await evalInPage(`!!document.querySelector('button.jump-to-latest')`)
  if (hasButton) await click('button.jump-to-latest')
  const jumped = JSON.parse(await evalInPage(`JSON.stringify({scrollTop:document.querySelector('.messages')?.scrollTop,scrollHeight:document.querySelector('.messages')?.scrollHeight,clientHeight:document.querySelector('.messages')?.clientHeight,jumpVisible:!!document.querySelector('.jump-to-latest')})`))
  evidence.checkpoints.push({ name: 'Jump-to-latest returns reader to stream tail', result: jumped, passed: hasButton && !jumped.jumpVisible && jumped.scrollTop + jumped.clientHeight >= jumped.scrollHeight - 5 })
}
evidence.final = JSON.parse(await evalInPage(`JSON.stringify({url:location.href,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,activeElement:document.activeElement?.outerHTML?.slice(0,200),mainText:document.querySelector('main')?.innerText?.slice(-1600)})`))
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
ws.close()
