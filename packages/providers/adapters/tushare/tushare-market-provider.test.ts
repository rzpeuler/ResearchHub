import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TUSHARE_DAILY_CHANGE_ONLY_FIXTURE, TUSHARE_DAILY_RESPONSE_FIXTURE } from './fixtures.ts'
import { TushareMarketProvider } from './tushare-market-provider.ts'

function createResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('Tushare normalizes a documented daily response and sends a POST request', async () => {
  let requestUrl: unknown
  let requestInit: RequestInit | undefined
  const provider = new TushareMarketProvider({
    endpoint: 'https://tushare.example.test/api',
    token: 'fixture-secret-token',
    clock: () => new Date('2026-08-23T09:00:00.000Z'),
    transport: {
      async request(input, init) {
        requestUrl = input
        requestInit = init
        return createResponse(TUSHARE_DAILY_RESPONSE_FIXTURE)
      },
    },
  })

  const result = await provider.fetch({ symbol: '600519' })

  assert.equal(requestUrl, 'https://tushare.example.test/api')
  assert.equal(requestInit?.method, 'POST')
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    api_name: 'daily',
    token: 'fixture-secret-token',
    params: { ts_code: '600519.SH' },
  })
  assert.deepEqual(result, {
    data: {
      symbol: '600519',
      price: 1680.5,
      change: 0.75,
      volume: 123456.7,
      source: 'tushare',
    },
    metadata: {
      provider: 'tushare-market',
      source: 'tushare',
      timestamp: '2026-08-21T00:00:00.000Z',
      quality: 'high',
      confidence: 0.9,
    },
  })
})

test('Tushare converts numeric strings and falls back from pct_chg to change', async () => {
  const provider = new TushareMarketProvider({
    token: 'fixture-token',
    transport: { request: async () => createResponse(TUSHARE_DAILY_CHANGE_ONLY_FIXTURE) },
  })

  const result = await provider.fetch({ symbol: '000001' })

  assert.equal(result.data.price, 12.34)
  assert.equal(result.data.change, -0.12)
  assert.equal(result.data.volume, 250000)
  assert.equal(result.metadata.timestamp, '2026-08-21T00:00:00.000Z')
})

test('Tushare uses the injected clock when the response has no trade date', async () => {
  const payload = {
    code: TUSHARE_DAILY_RESPONSE_FIXTURE.code,
    msg: TUSHARE_DAILY_RESPONSE_FIXTURE.msg,
    data: {
      fields: ['ts_code', 'close', 'pct_chg', 'vol'],
      items: [['600519.SH', 1680.5, 0.75, 123456.7]],
    },
  }
  const provider = new TushareMarketProvider({
    token: 'fixture-token',
    clock: () => new Date('2026-08-23T09:00:00.000Z'),
    transport: { request: async () => createResponse(payload) },
  })

  const result = await provider.fetch({ symbol: '600519' })

  assert.equal(result.metadata.timestamp, '2026-08-23T09:00:00.000Z')
})

test('Tushare reports missing credentials without making a request', async () => {
  let requestCount = 0
  const provider = new TushareMarketProvider({
    transport: {
      async request() {
        requestCount += 1
        return createResponse(TUSHARE_DAILY_RESPONSE_FIXTURE)
      },
    },
  })

  await assert.rejects(
    provider.fetch({ symbol: '600519' }),
    /TUSHARE_TOKEN is not configured/,
  )
  assert.equal(requestCount, 0)
})

test('Tushare endpoint errors reject userinfo without exposing endpoint credentials or token', async () => {
  const endpoint = 'https://endpoint-user:endpoint-password@tushare.example.test/api'
  const token = 'tushare-secret-token'

  assert.throws(() => new TushareMarketProvider({ endpoint, token }), (error: unknown) => {
    assert.match(String(error), /must not include username\/password credentials/)
    assert.doesNotMatch(String(error), /endpoint-user|endpoint-password|tushare-secret-token|https:\/\//)
    return true
  })
})

test('Tushare trims the endpoint once and redacts normalized query secrets from errors and causes', async () => {
  const endpoint = 'https://tushare.example.test/api?credential=query-secret'
  let requestUrl: unknown
  const provider = new TushareMarketProvider({
    endpoint: `  ${endpoint}  `,
    token: 'fixture-token',
    transport: {
      async request(input) {
        requestUrl = input
        throw new Error(`request failed for ${String(input)}`)
      },
    },
  })

  await assert.rejects(provider.fetch({ symbol: '600519' }), (error: unknown) => {
    assert.equal(requestUrl, endpoint)
    assert(error instanceof Error)
    assert.doesNotMatch(error.message, /query-secret|tushare\.example\.test/)
    const cause = (error as { cause?: unknown }).cause
    assert(cause instanceof Error)
    assert.doesNotMatch(cause.message, /query-secret|tushare\.example\.test/)
    return true
  })
})

test('Tushare transport errors redact endpoint and token from the error cause chain', async () => {
  const endpoint = 'https://tushare.example.test/api'
  const token = 'tushare-secret-token'
  const provider = new TushareMarketProvider({
    endpoint,
    token,
    transport: {
      async request() {
        throw new Error(`request failed for ${endpoint} with ${token}`)
      },
    },
  })

  await assert.rejects(provider.fetch({ symbol: '600519' }), (error: unknown) => {
    assert(error instanceof Error)
    assert.doesNotMatch(error.message, /tushare\.example\.test|tushare-secret-token/)
    const cause = (error as { cause?: unknown }).cause
    assert(cause instanceof Error)
    assert.doesNotMatch(cause.message, /tushare\.example\.test|tushare-secret-token/)
    return true
  })
})

test('Tushare handles HTTP, API, malformed, empty, and invalid responses without leaking the token', async () => {
  const token = 'secret-token-to-redact'
  const cases: Array<{ name: string; response: Response; expected: RegExp }> = [
    { name: 'HTTP', response: createResponse({ msg: token }, 500), expected: /HTTP 500/ },
    { name: 'API', response: createResponse({ code: 401, msg: `invalid ${token}` }), expected: /API error/ },
    { name: 'malformed', response: createResponse({ code: 0, data: null }), expected: /missing data envelope/ },
    { name: 'empty', response: createResponse({ code: 0, data: { fields: [], items: [] } }), expected: /response is empty/ },
    {
      name: 'invalid numeric value',
      response: createResponse({ code: 0, data: { fields: ['ts_code', 'close', 'pct_chg', 'vol'], items: [['600519.SH', 'bad', 0.75, 1]] } }),
      expected: /invalid numeric field: close/,
    },
  ]

  for (const current of cases) {
    const provider = new TushareMarketProvider({
      token,
      transport: { request: async () => current.response },
    })
    await assert.rejects(provider.fetch({ symbol: '600519' }), (error: unknown) => {
      assert.match(String(error), current.expected, current.name)
      assert.doesNotMatch(String(error), new RegExp(token), current.name)
      return true
    })
  }
})

test('Tushare validates normalized Market data through the DataProvider contract', () => {
  const provider = new TushareMarketProvider({ token: 'fixture-token' })
  assert.doesNotThrow(() => provider.validate({
    symbol: '600519',
    price: 1,
    change: 0,
    volume: 1,
    source: 'tushare',
  }))
  assert.throws(() => provider.validate({ symbol: '600519' }), /expected a finite number/)
})
