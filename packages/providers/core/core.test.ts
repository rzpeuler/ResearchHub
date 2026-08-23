import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ProviderValidationError,
  type DataProvider,
  type FinancialDataMetadata,
  type ProviderResult,
  validateFinancialDataMetadata,
  validateProviderResult,
} from './index.ts'

const validMetadata: FinancialDataMetadata = {
  provider: 'fixture-provider',
  source: 'fixture:market',
  timestamp: '2026-08-23T09:00:00.000Z',
  quality: 'high',
  confidence: 0.95,
}

test('valid metadata and Provider results satisfy the runtime contract', () => {
  const result: ProviderResult<{ symbol: string; price: number }> = {
    data: { symbol: '600519', price: 1680 },
    metadata: { ...validMetadata },
  }

  assert.doesNotThrow(() => validateFinancialDataMetadata(result.metadata))
  assert.doesNotThrow(() => validateProviderResult(result))
})

test('metadata validation rejects invalid quality, timestamps, and confidence', () => {
  for (const metadata of [
    { ...validMetadata, quality: 'unknown' },
    { ...validMetadata, timestamp: '2026-02-30T09:00:00.000Z' },
    { ...validMetadata, timestamp: '2026-08-23' },
    { ...validMetadata, confidence: Number.NaN },
    { ...validMetadata, confidence: 1.01 },
    { ...validMetadata, confidence: -0.01 },
  ]) {
    assert.throws(() => validateFinancialDataMetadata(metadata), ProviderValidationError)
  }
})

test('metadata validation requires a non-empty provider name', () => {
  assert.throws(
    () => validateFinancialDataMetadata({ ...validMetadata, provider: '' }),
    ProviderValidationError,
  )
  const metadataWithoutProvider = { ...validMetadata } as Record<string, unknown>
  delete metadataWithoutProvider.provider
  assert.throws(
    () => validateFinancialDataMetadata(metadataWithoutProvider),
    /\$\.provider: missing required field/,
  )
})

test('metadata and result validation reject unknown fields and unsafe JSON values', () => {
  assert.throws(
    () => validateFinancialDataMetadata({ ...validMetadata, extra: true }),
    /unknown field: extra/,
  )

  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  assert.throws(
    () => validateProviderResult({ data: cyclic, metadata: validMetadata }),
    /JSON-safe object/,
  )
})

test('DataProvider contract supports typed fetch results and provider-owned validation', async () => {
  type Request = { symbol: string }
  type Data = { symbol: string; price: number }

  const provider: DataProvider<Request, Data> = {
    name: 'typed-fixture',
    async fetch(request) {
      return {
        data: { symbol: request.symbol, price: 1680 },
        metadata: { ...validMetadata },
      }
    },
    validate(value: unknown): asserts value is Data {
      if (value === null || typeof value !== 'object' || (value as { symbol?: unknown }).symbol !== '600519') {
        throw new ProviderValidationError('unexpected fixture data', '$.data')
      }
    },
  }

  const result = await provider.fetch({ symbol: '600519' })
  provider.validate(result.data)
  assert.equal(result.data.price, 1680)
})
