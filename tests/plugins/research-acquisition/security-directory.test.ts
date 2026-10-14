import assert from 'node:assert/strict'
import test from 'node:test'
import { AkshareDataAdapter } from '../../../plugins/research-acquisition/akshare.ts'

test('AKShare directory snapshot returns all entries beyond the exact-query cap and includes BJ 9-series', async () => {
  const rows = Array.from({ length: 80 }, (_, index) => ({ symbol: String(200000 + index).replace(/^2/u, '0'), name: `公司${index}`, exchange: 'SZ' }))
  rows.push({ symbol: '920001', name: '北交所证券', exchange: 'BJ' })
  let passedArgs: readonly string[] = []
  const adapter = new AkshareDataAdapter({ runner: async (_, args) => { passedArgs = args; return JSON.stringify(rows) } })
  const snapshot = await adapter.securityDirectory({ snapshot: true })
  assert.equal(snapshot.length, 81)
  assert.equal(passedArgs[4], 'snapshot')
  assert.equal(snapshot.at(-1)?.exchange, 'BJ')
})

test('AKShare structured acquisition forwards cancellation into the subprocess runner', async () => {
  const controller = new AbortController()
  let runnerSignal: AbortSignal | undefined
  const adapter = new AkshareDataAdapter({ runner: async (_, __, ___, signal) => {
    runnerSignal = signal
    return new Promise((_, reject) => signal!.addEventListener('abort', () => reject(new Error('abort')), { once: true }))
  } })
  const pending = adapter.financialData({ symbol: '002384', signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, /WORKFLOW_CANCELLED/u)
  assert.equal(runnerSignal, controller.signal)
})
