import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  PluginValidationError,
  type DataPlugin,
  type FinancialDataMetadata,
  type PluginResult,
  validateFinancialDataMetadata,
  validatePluginResult,
} from './index.ts'

const validMetadata: FinancialDataMetadata = {
  plugin: 'fixture-plugin',
  source: 'fixture:market',
  timestamp: '2026-08-23T09:00:00.000Z',
  quality: 'high',
  confidence: 0.95,
}

test('valid metadata and Plugin results satisfy the runtime contract', () => {
  const result: PluginResult<{ symbol: string; price: number }> = {
    data: { symbol: '600519', price: 1680 },
    metadata: { ...validMetadata },
  }

  assert.doesNotThrow(() => validateFinancialDataMetadata(result.metadata))
  assert.doesNotThrow(() => validatePluginResult(result))
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
    assert.throws(() => validateFinancialDataMetadata(metadata), PluginValidationError)
  }
})

test('metadata validation requires a non-empty plugin name', () => {
  assert.throws(
    () => validateFinancialDataMetadata({ ...validMetadata, plugin: '' }),
    PluginValidationError,
  )
  const metadataWithoutPlugin = { ...validMetadata } as Record<string, unknown>
  delete metadataWithoutPlugin.plugin
  assert.throws(
    () => validateFinancialDataMetadata(metadataWithoutPlugin),
    /\$\.plugin: missing required field/,
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
    () => validatePluginResult({ data: cyclic, metadata: validMetadata }),
    /JSON-safe object/,
  )
})

test('DataPlugin contract supports typed fetch results and plugin-owned validation', async () => {
  type Request = { symbol: string }
  type Data = { symbol: string; price: number }

  const plugin: DataPlugin<Request, Data> = {
    name: 'typed-fixture',
    async fetch(request) {
      return {
        data: { symbol: request.symbol, price: 1680 },
        metadata: { ...validMetadata },
      }
    },
    validate(value: unknown): asserts value is Data {
      if (value === null || typeof value !== 'object' || (value as { symbol?: unknown }).symbol !== '600519') {
        throw new PluginValidationError('unexpected fixture data', '$.data')
      }
    },
  }

  const result = await plugin.fetch({ symbol: '600519' })
  plugin.validate(result.data)
  assert.equal(result.data.price, 1680)
})
