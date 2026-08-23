import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AKSHARE_BRIDGE_CHANGE_AMOUNT_FIXTURE, AKSHARE_BRIDGE_RESPONSE_FIXTURE } from './fixtures.ts'
import { AkShareMarketPlugin } from './akshare-market-plugin.ts'

function createResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('AkShare normalizes documented Chinese bridge fields and attaches metadata', async () => {
  let requestUrl: unknown
  let requestInit: RequestInit | undefined
  const plugin = new AkShareMarketPlugin({
    endpoint: 'https://akshare.example.test/bridge',
    clock: () => new Date('2026-08-23T09:00:00.000Z'),
    transport: {
      async request(input, init) {
        requestUrl = input
        requestInit = init
        return createResponse(AKSHARE_BRIDGE_RESPONSE_FIXTURE)
      },
    },
  })

  const result = await plugin.fetch({ symbol: '600519' })

  assert.equal(requestUrl, 'https://akshare.example.test/bridge')
  assert.equal(requestInit?.method, 'POST')
  assert.deepEqual(JSON.parse(String(requestInit?.body)), { symbol: '600519' })
  assert.deepEqual(result, {
    data: {
      symbol: '600519',
      price: 1680.5,
      change: 0.75,
      volume: 123456.7,
      source: 'akshare-bridge',
    },
    metadata: {
      plugin: 'akshare-market',
      source: 'akshare-bridge',
      timestamp: '2026-08-21T00:00:00.000Z',
      quality: 'medium',
      confidence: 0.8,
    },
  })
})

test('AkShare supports English aliases and falls back from Chinese change amount', async () => {
  const plugin = new AkShareMarketPlugin({
    endpoint: 'http://akshare.example.test/bridge',
    transport: { request: async () => createResponse(AKSHARE_BRIDGE_CHANGE_AMOUNT_FIXTURE) },
  })

  const result = await plugin.fetch({ symbol: '000001' })

  assert.deepEqual(result.data, {
    symbol: '000001',
    price: 12.34,
    change: -0.12,
    volume: 250000,
    source: 'akshare-bridge',
  })
  assert.match(result.metadata.timestamp, /^\d{4}-\d{2}-\d{2}T/)
})

test('AkShare uses the injected clock when the bridge omits a timestamp', async () => {
  const plugin = new AkShareMarketPlugin({
    endpoint: 'http://akshare.example.test/bridge',
    clock: () => new Date('2026-08-23T09:00:00.000Z'),
    transport: {
      request: async () => createResponse({ code: '600519', close: 1680.5, pct_chg: 0.75, volume: 1 }),
    },
  })

  const result = await plugin.fetch({ symbol: '600519' })

  assert.equal(result.metadata.timestamp, '2026-08-23T09:00:00.000Z')
})

test('AkShare is explicitly disabled when no bridge endpoint is configured', async () => {
  let requestCount = 0
  const plugin = new AkShareMarketPlugin({
    transport: {
      async request() {
        requestCount += 1
        return createResponse(AKSHARE_BRIDGE_RESPONSE_FIXTURE)
      },
    },
  })

  await assert.rejects(plugin.fetch({ symbol: '600519' }), /akshare-market plugin is disabled: endpoint is not configured/)
  assert.equal(requestCount, 0)
})

test('AkShare endpoint errors reject userinfo without exposing raw endpoint credentials', async () => {
  const plugin = new AkShareMarketPlugin({
    endpoint: 'http://endpoint-user:endpoint-password@akshare.example.test/bridge',
  })

  await assert.rejects(plugin.fetch({ symbol: '600519' }), (error: unknown) => {
    assert.match(String(error), /must not include username\/password credentials/)
    assert.doesNotMatch(String(error), /endpoint-user|endpoint-password|http:\/\//)
    return true
  })
})

test('AkShare transport errors redact the endpoint from the error cause chain', async () => {
  const endpoint = 'https://akshare.example.test/bridge'
  const plugin = new AkShareMarketPlugin({
    endpoint,
    transport: {
      async request() {
        throw new Error(`request failed for ${endpoint}`)
      },
    },
  })

  await assert.rejects(plugin.fetch({ symbol: '600519' }), (error: unknown) => {
    assert(error instanceof Error)
    assert.doesNotMatch(error.message, /akshare\.example\.test/)
    const cause = (error as { cause?: unknown }).cause
    assert(cause instanceof Error)
    assert.doesNotMatch(cause.message, /akshare\.example\.test/)
    return true
  })
})

test('AkShare sanitizes JSON read failures in both the error and cause', async () => {
  const endpoint = 'https://akshare.example.test/bridge?credential=query-secret'
  const plugin = new AkShareMarketPlugin({
    endpoint,
    transport: {
      async request() {
        return {
          ok: true,
          status: 200,
          async json() {
            throw new Error(`invalid JSON from ${endpoint}`)
          },
        } as unknown as Response
      },
    },
  })

  await assert.rejects(plugin.fetch({ symbol: '600519' }), (error: unknown) => {
    assert(error instanceof Error)
    assert.doesNotMatch(error.message, /query-secret|akshare\.example\.test/)
    const cause = (error as { cause?: unknown }).cause
    assert(cause instanceof Error)
    assert.doesNotMatch(cause.message, /query-secret|akshare\.example\.test/)
    return true
  })
})

test('AkShare handles HTTP, malformed, empty, and invalid responses', async () => {
  const cases: Array<{ response: Response; expected: RegExp }> = [
    { response: createResponse({}, 503), expected: /HTTP 503/ },
    { response: createResponse({ data: { unexpected: true } }), expected: /missing row/ },
    { response: createResponse({ data: [] }), expected: /empty or malformed/ },
    {
      response: createResponse({ data: [{ code: '600519', close: 'bad', pct_chg: 0.75, volume: 1 }] }),
      expected: /invalid numeric field: price/,
    },
  ]

  for (const current of cases) {
    const plugin = new AkShareMarketPlugin({
      endpoint: 'http://akshare.example.test/bridge',
      transport: { request: async () => current.response },
    })
    await assert.rejects(plugin.fetch({ symbol: '600519' }), current.expected)
  }
})
