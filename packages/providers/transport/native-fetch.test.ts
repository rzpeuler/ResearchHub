import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createNativeFetchTransport,
  type NativeFetchImplementation,
} from './native-fetch.ts'

test('native fetch transport delegates requests to an injected implementation', async () => {
  let receivedInput: unknown
  let receivedInit: unknown
  const response = new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  const fakeFetch: NativeFetchImplementation = async (input, init) => {
    receivedInput = input
    receivedInit = init
    return response
  }

  const transport = createNativeFetchTransport(fakeFetch)
  const init = { method: 'POST', body: JSON.stringify({ symbol: '600519' }) }
  const result = await transport.request('https://provider.example.test/quote', init)

  assert.equal(receivedInput, 'https://provider.example.test/quote')
  assert.deepEqual(receivedInit, init)
  assert.strictEqual(result, response)
  assert.deepEqual(await result.json(), { ok: true })
})

test('native fetch transport propagates injected transport failures', async () => {
  const failure = new Error('fixture transport failure')
  const transport = createNativeFetchTransport(async () => {
    throw failure
  })

  await assert.rejects(transport.request('https://provider.example.test/quote'), (error: unknown) => error === failure)
})
