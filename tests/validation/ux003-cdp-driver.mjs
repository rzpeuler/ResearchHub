const port = Number(process.argv[2])
const url = process.argv[3]
const action = process.argv[4]
const reloadAfterAction = process.argv[5] === '--reload-after'
if (!Number.isInteger(port) || !url) throw new Error('usage: node ux003-cdp-driver.mjs <port> <url>')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target?.webSocketDebuggerUrl) throw new Error('No page target in Edge DevTools')
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
const evaluate = async (expression) => {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? JSON.stringify(result.exceptionDetails))
  return result.result?.value
}
await command('Page.enable')
await command('Runtime.enable')
await command('Page.navigate', { url })
const deadline = Date.now() + 15_000
let snapshot
do {
  await new Promise((resolve) => setTimeout(resolve, 200))
  snapshot = await evaluate('JSON.stringify({ready:document.readyState,title:document.title,text:document.body?.innerText?.slice(-4000),controls:[...document.querySelectorAll("button,input,textarea,select")].map((el)=>({tag:el.tagName,type:el.type,label:el.getAttribute("aria-label"),text:el.innerText?.slice(0,100),value:el.value,placeholder:el.placeholder})).slice(-40)})')
} while (Date.now() < deadline && JSON.parse(snapshot).ready !== 'complete')
if (action) {
  const output = await evaluate(action)
  process.stdout.write(`ACTION ${JSON.stringify(output)}\n`)
  if (reloadAfterAction) {
    await command('Page.reload', { ignoreCache: true })
    const reloadDeadline = Date.now() + 15_000
    do {
      await new Promise((resolve) => setTimeout(resolve, 200))
      snapshot = await evaluate('JSON.stringify({ready:document.readyState})')
    } while (Date.now() < reloadDeadline && JSON.parse(snapshot).ready !== 'complete')
  }
  await new Promise((resolve) => setTimeout(resolve, 750))
  snapshot = await evaluate('JSON.stringify({url:location.href,mainText:document.querySelector("main")?.innerText?.slice(-1500),pending:[...document.querySelectorAll(".optimistic-request")].map((el)=>el.innerText),runRows:[...document.querySelectorAll(".workflow-progress-panel")].map((el)=>el.innerText)})')
}
process.stdout.write(`${snapshot}\n`)
socket.close()
