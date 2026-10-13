const [portText, url, expression, screenshotPath, widthText, heightText] = process.argv.slice(2)
const port = Number(portText)
if (!Number.isInteger(port) || !url) throw new Error('usage: node ux004-browser-driver.mjs <cdp-port> <url> [expression] [screenshot-path] [width] [height]')
const width = Number(widthText) || 1440
const height = Number(heightText) || 1000
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target?.webSocketDebuggerUrl) throw new Error('No Edge page target found')
const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id === undefined) return
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  if (message.error) waiter.reject(new Error(JSON.stringify(message.error)))
  else waiter.resolve(message.result)
})
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  socket.send(JSON.stringify({ id, method, params }))
})
const evaluate = async (source) => {
  const result = await command('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails)}\nExpression: ${source}`)
  return result.result?.value
}
await command('Page.enable')
await command('Runtime.enable')
await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 768 })
await command('Page.navigate', { url })
const deadline = Date.now() + 20_000
let snapshot
do {
  await new Promise((resolve) => setTimeout(resolve, 200))
  snapshot = await evaluate(`JSON.stringify({ready:document.readyState,url:location.href,title:document.title,text:document.querySelector('main')?.innerText?.slice(-2500),width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,controls:[...document.querySelectorAll('button,input,textarea,select')].map(e=>({tag:e.tagName,text:e.innerText?.trim().slice(0,90),aria:e.getAttribute('aria-label'),type:e.type,placeholder:e.placeholder,value:e.value,disabled:e.disabled})).slice(-35)})`)
} while (Date.now() < deadline && JSON.parse(snapshot).ready !== 'complete')
if (expression) {
  const result = await evaluate(expression)
  process.stdout.write(`ACTION ${JSON.stringify(result)}\n`)
  await new Promise((resolve) => setTimeout(resolve, 900))
  snapshot = await evaluate(`JSON.stringify({url:location.href,title:document.title,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,mainText:document.querySelector('main')?.innerText?.slice(-3000),activeElement:document.activeElement?.outerHTML?.slice(0,300),dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>({name:e.getAttribute('aria-label'),visible:!!(e.offsetWidth||e.offsetHeight)})),buttons:[...document.querySelectorAll('button')].map(e=>({text:e.innerText.trim().slice(0,80),aria:e.getAttribute('aria-label'),disabled:e.disabled})).slice(-35)})`)
}
let result = JSON.parse(snapshot)
if (screenshotPath) {
  const captured = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, fromSurface: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(screenshotPath, Buffer.from(captured.data, 'base64'))
  result.screenshot = screenshotPath
}
process.stdout.write(`${JSON.stringify(result)}\n`)
socket.close()
