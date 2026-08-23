import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DuplicateProviderError,
  ProviderValidationError,
  ProviderNotFoundError,
  PROVIDER_HANDLE,
  PROVIDER_HANDLE_MARKER,
  type DataProvider,
  type ProviderHandle,
  type UnknownDataProvider,
} from '../core/index.ts'
import { ProviderRegistry } from './index.ts'

function createProvider<TRequest, TData>(name: string, data: TData): DataProvider<TRequest, TData> {
  return {
    name,
    async fetch() {
      return {
        data,
        metadata: {
          source: 'fixture',
          timestamp: '2026-08-23T09:00:00.000Z',
          quality: 'medium',
          confidence: 0.8,
        },
      }
    },
    validate(value: unknown): asserts value is TData {
      if (value === undefined) {
        throw new TypeError('fixture data is undefined')
      }
    },
  }
}

test('ProviderRegistry registers and retrieves a typed Provider', async () => {
  const registry = new ProviderRegistry()
  const provider = createProvider<{ symbol: string }, { price: number }>('market-fixture', { price: 1680 })

  const handle: ProviderHandle<{ symbol: string }, { price: number }> = registry.register(provider)
  const resolved = registry.get(handle)
  const byName: UnknownDataProvider = registry.get('market-fixture')
  // @ts-expect-error Name-only lookup must not allow callers to invent data types.
  registry.get<{ symbol: string }, { price: number }>('market-fixture')
  const result = await resolved.fetch({ symbol: '600519' })
  const unknownResult = await byName.fetch({ symbol: '600519' })

  assert.equal(resolved.name, provider.name)
  assert.deepEqual(result.data, { price: 1680 })
  assert.deepEqual(unknownResult.data, { price: 1680 })
})

test('ProviderRegistry rejects duplicate names without replacing the original', async () => {
  const registry = new ProviderRegistry()
  const first = createProvider('same-name', { version: 1 })
  const second = createProvider('same-name', { version: 2 })

  const firstHandle = registry.register(first)
  assert.throws(() => registry.register(second), DuplicateProviderError)
  const resolved = registry.get(firstHandle)
  assert.equal(resolved.name, first.name)
  await assert.doesNotReject(async () => {
    const result = await resolved.fetch({})
    assert.deepEqual(result.data, { version: 1 })
  })
})

test('ProviderRegistry supports has/list without exposing mutable registry state', () => {
  const registry = new ProviderRegistry()
  registry.register(createProvider('first', 1))
  registry.register(createProvider('second', 2))

  assert.equal(registry.has('first'), true)
  assert.equal(registry.has('missing'), false)

  const names = registry.list()
  assert.deepEqual(names, ['first', 'second'])
  names.reverse()
  assert.deepEqual(registry.list(), ['first', 'second'])
})

test('ProviderRegistry reports unknown names and malformed registrations', () => {
  const registry = new ProviderRegistry()

  assert.throws(() => registry.get('missing'), ProviderNotFoundError)
  assert.throws(
    () => registry.register({ name: 'invalid', fetch: async () => ({}) } as never),
    /validate function/,
  )
})

test('ProviderRegistry validates metadata and calls the underlying data validator at fetch boundary', async () => {
  const registry = new ProviderRegistry()
  let validateCalls = 0
  const provider: DataProvider<{ symbol: string }, { price: number }> = {
    name: 'validated-provider',
    async fetch() {
      return {
        data: { price: 1680 },
        metadata: {
          source: 'fixture',
          timestamp: '2026-08-23T09:00:00.000Z',
          quality: 'high',
          confidence: 0.99,
        },
      }
    },
    validate(value: unknown): asserts value is { price: number } {
      validateCalls += 1
      if (value === null || typeof value !== 'object' || typeof (value as { price?: unknown }).price !== 'number') {
        throw new TypeError('invalid market data')
      }
    },
  }

  const handle = registry.register(provider)
  const result = await registry.get(handle).fetch({ symbol: '600519' })

  assert.deepEqual(result.data, { price: 1680 })
  assert.equal(validateCalls, 1)
})

test('ProviderRegistry rejects malformed metadata before calling provider.validate', async () => {
  const registry = new ProviderRegistry()
  let validateCalls = 0
  const provider: DataProvider<undefined, { price: number }> = {
    name: 'bad-metadata-provider',
    async fetch() {
      return {
        data: { price: 1680 },
        metadata: {
          source: 'fixture',
          timestamp: 'not-a-timestamp',
          quality: 'high',
          confidence: 0.99,
        },
      }
    },
    validate(_value: unknown): asserts _value is { price: number } {
      validateCalls += 1
    },
  }

  const handle = registry.register(provider)
  await assert.rejects(
    registry.get(handle).fetch(undefined),
    ProviderValidationError,
  )
  assert.equal(validateCalls, 0)
})

test('ProviderRegistry preserves malformed data validation errors and underlying fetch errors', async () => {
  const registry = new ProviderRegistry()
  const dataError = new Error('invalid market data')
  const dataProvider: DataProvider<undefined, { price: number }> = {
    name: 'bad-data-provider',
    async fetch() {
      return {
        data: { price: 'not-a-number' } as unknown as { price: number },
        metadata: {
          source: 'fixture',
          timestamp: '2026-08-23T09:00:00.000Z',
          quality: 'high',
          confidence: 0.99,
        },
      }
    },
    validate(value: unknown): asserts value is { price: number } {
      if (typeof (value as { price?: unknown }).price !== 'number') {
        throw dataError
      }
    },
  }

  const fetchError = new Error('source unavailable')
  const fetchProvider: DataProvider<undefined, { price: number }> = {
    name: 'failing-provider',
    async fetch() {
      throw fetchError
    },
    validate(_value: unknown): asserts _value is { price: number } {
      throw new Error('must not be called')
    },
  }

  const dataHandle = registry.register(dataProvider)
  const fetchHandle = registry.register(fetchProvider)

  await assert.rejects(
    registry.get(dataHandle).fetch(undefined),
    (error: unknown) => error === dataError,
  )

  const resolved = registry.get(fetchHandle)
  assert.equal(resolved.name, 'failing-provider')
  await assert.rejects(resolved.fetch(undefined), (error: unknown) => error === fetchError)
})

test('ProviderRegistry snapshots the Provider name at registration', () => {
  const registry = new ProviderRegistry()
  let currentName = 'stable-provider'
  let nameReads = 0
  const provider: DataProvider<undefined, { ok: boolean }> = {
    get name() {
      nameReads += 1
      return currentName
    },
    async fetch() {
      return {
        data: { ok: true },
        metadata: {
          source: 'fixture',
          timestamp: '2026-08-23T09:00:00.000Z',
          quality: 'high',
          confidence: 1,
        },
      }
    },
    validate(_value: unknown): asserts _value is { ok: boolean } {},
  }

  const handle = registry.register(provider)
  currentName = 'changed-provider'

  assert.equal(nameReads, 1)
  assert.equal(handle.name, 'stable-provider')
  assert.equal(registry.get(handle).name, 'stable-provider')
  assert.equal(registry.get('stable-provider').name, 'stable-provider')
  assert.equal(registry.has('stable-provider'), true)
  assert.equal(registry.has('changed-provider'), false)
  assert.deepEqual(registry.list(), ['stable-provider'])

  assert.throws(
    () => registry.register(createProvider('stable-provider', { ok: false })),
    (error: unknown) => error instanceof DuplicateProviderError && error.providerName === 'stable-provider',
  )
})

test('ProviderHandle exposes the real runtime marker used by its public brand', () => {
  const registry = new ProviderRegistry()
  const handle = registry.register(createProvider('marked-provider', { ok: true }))

  assert.strictEqual(handle[PROVIDER_HANDLE], PROVIDER_HANDLE_MARKER)
  assert.equal(typeof handle[PROVIDER_HANDLE].request, 'function')
  assert.equal(typeof handle[PROVIDER_HANDLE].data, 'function')
  assert.equal(Object.isFrozen(handle[PROVIDER_HANDLE]), true)
})

test('ProviderRegistry validates invalid non-string lookups before WeakMap access', () => {
  const registry = new ProviderRegistry()
  registry.register(createProvider('valid-provider', { ok: true }))

  for (const lookup of [null, undefined, 42, true, Symbol('invalid'), {}, []]) {
    assert.throws(
      () => registry.get(lookup as never),
      (error: unknown) => error instanceof ProviderValidationError,
    )
  }
})

test('ProviderRegistry rejects non-JSON-safe TData at the runtime boundary', async () => {
  const registry = new ProviderRegistry()
  let validateCalls = 0
  const provider: DataProvider<undefined, Date> = {
    name: 'unsafe-data-provider',
    async fetch() {
      return {
        data: new Date('2026-08-23T09:00:00.000Z'),
        metadata: {
          source: 'fixture',
          timestamp: '2026-08-23T09:00:00.000Z',
          quality: 'low',
          confidence: 0.2,
        },
      }
    },
    validate(_value: unknown): asserts _value is Date {
      validateCalls += 1
    },
  }

  const handle = registry.register(provider)
  await assert.rejects(registry.get(handle).fetch(undefined), /JSON-safe object/)
  assert.equal(validateCalls, 0)
})
