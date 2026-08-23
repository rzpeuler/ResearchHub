import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DuplicatePluginError,
  PluginValidationError,
  PluginNotFoundError,
  PLUGIN_HANDLE,
  PLUGIN_HANDLE_MARKER,
  type DataPlugin,
  type PluginHandle,
  type UnknownDataPlugin,
} from '../core/index.ts'
import { PluginRegistry } from './index.ts'

function createPlugin<TRequest, TData>(name: string, data: TData): DataPlugin<TRequest, TData> {
  return {
    name,
    async fetch() {
      return {
        data,
        metadata: {
          plugin: 'fixture-plugin',
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

test('PluginRegistry registers and retrieves a typed Plugin', async () => {
  const registry = new PluginRegistry()
  const plugin = createPlugin<{ symbol: string }, { price: number }>('market-fixture', { price: 1680 })

  const handle: PluginHandle<{ symbol: string }, { price: number }> = registry.register(plugin)
  const resolved = registry.get(handle)
  const byName: UnknownDataPlugin = registry.get('market-fixture')
  // @ts-expect-error Name-only lookup must not allow callers to invent data types.
  registry.get<{ symbol: string }, { price: number }>('market-fixture')
  const result = await resolved.fetch({ symbol: '600519' })
  const unknownResult = await byName.fetch({ symbol: '600519' })

  assert.equal(resolved.name, plugin.name)
  assert.deepEqual(result.data, { price: 1680 })
  assert.deepEqual(unknownResult.data, { price: 1680 })
})

test('PluginRegistry rejects duplicate names without replacing the original', async () => {
  const registry = new PluginRegistry()
  const first = createPlugin('same-name', { version: 1 })
  const second = createPlugin('same-name', { version: 2 })

  const firstHandle = registry.register(first)
  assert.throws(() => registry.register(second), DuplicatePluginError)
  const resolved = registry.get(firstHandle)
  assert.equal(resolved.name, first.name)
  await assert.doesNotReject(async () => {
    const result = await resolved.fetch({})
    assert.deepEqual(result.data, { version: 1 })
  })
})

test('PluginRegistry supports has/list without exposing mutable registry state', () => {
  const registry = new PluginRegistry()
  registry.register(createPlugin('first', 1))
  registry.register(createPlugin('second', 2))

  assert.equal(registry.has('first'), true)
  assert.equal(registry.has('missing'), false)

  const names = registry.list()
  assert.deepEqual(names, ['first', 'second'])
  names.reverse()
  assert.deepEqual(registry.list(), ['first', 'second'])
})

test('PluginRegistry reports unknown names and malformed registrations', () => {
  const registry = new PluginRegistry()

  assert.throws(() => registry.get('missing'), PluginNotFoundError)
  assert.throws(
    () => registry.register({ name: 'invalid', fetch: async () => ({}) } as never),
    /validate function/,
  )
})

test('PluginRegistry validates metadata and calls the underlying data validator at fetch boundary', async () => {
  const registry = new PluginRegistry()
  let validateCalls = 0
  const plugin: DataPlugin<{ symbol: string }, { price: number }> = {
    name: 'validated-plugin',
    async fetch() {
      return {
        data: { price: 1680 },
        metadata: {
          plugin: 'fixture-plugin',
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

  const handle = registry.register(plugin)
  const result = await registry.get(handle).fetch({ symbol: '600519' })

  assert.deepEqual(result.data, { price: 1680 })
  assert.equal(validateCalls, 1)
})

test('PluginRegistry rejects malformed metadata before calling plugin.validate', async () => {
  const registry = new PluginRegistry()
  let validateCalls = 0
  const plugin: DataPlugin<undefined, { price: number }> = {
    name: 'bad-metadata-plugin',
    async fetch() {
      return {
        data: { price: 1680 },
        metadata: {
          plugin: 'fixture-plugin',
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

  const handle = registry.register(plugin)
  await assert.rejects(
    registry.get(handle).fetch(undefined),
    PluginValidationError,
  )
  assert.equal(validateCalls, 0)
})

test('PluginRegistry preserves malformed data validation errors and underlying fetch errors', async () => {
  const registry = new PluginRegistry()
  const dataError = new Error('invalid market data')
  const dataPlugin: DataPlugin<undefined, { price: number }> = {
    name: 'bad-data-plugin',
    async fetch() {
      return {
        data: { price: 'not-a-number' } as unknown as { price: number },
        metadata: {
          plugin: 'fixture-plugin',
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
  const fetchPlugin: DataPlugin<undefined, { price: number }> = {
    name: 'failing-plugin',
    async fetch() {
      throw fetchError
    },
    validate(_value: unknown): asserts _value is { price: number } {
      throw new Error('must not be called')
    },
  }

  const dataHandle = registry.register(dataPlugin)
  const fetchHandle = registry.register(fetchPlugin)

  await assert.rejects(
    registry.get(dataHandle).fetch(undefined),
    (error: unknown) => error === dataError,
  )

  const resolved = registry.get(fetchHandle)
  assert.equal(resolved.name, 'failing-plugin')
  await assert.rejects(resolved.fetch(undefined), (error: unknown) => error === fetchError)
})

test('PluginRegistry snapshots the Plugin name at registration', () => {
  const registry = new PluginRegistry()
  let currentName = 'stable-plugin'
  let nameReads = 0
  const plugin: DataPlugin<undefined, { ok: boolean }> = {
    get name() {
      nameReads += 1
      return currentName
    },
    async fetch() {
      return {
        data: { ok: true },
        metadata: {
          plugin: 'fixture-plugin',
          source: 'fixture',
          timestamp: '2026-08-23T09:00:00.000Z',
          quality: 'high',
          confidence: 1,
        },
      }
    },
    validate(_value: unknown): asserts _value is { ok: boolean } {},
  }

  const handle = registry.register(plugin)
  currentName = 'changed-plugin'

  assert.equal(nameReads, 1)
  assert.equal(handle.name, 'stable-plugin')
  assert.equal(registry.get(handle).name, 'stable-plugin')
  assert.equal(registry.get('stable-plugin').name, 'stable-plugin')
  assert.equal(registry.has('stable-plugin'), true)
  assert.equal(registry.has('changed-plugin'), false)
  assert.deepEqual(registry.list(), ['stable-plugin'])

  assert.throws(
    () => registry.register(createPlugin('stable-plugin', { ok: false })),
    (error: unknown) => error instanceof DuplicatePluginError && error.pluginName === 'stable-plugin',
  )
})

test('PluginHandle exposes the real runtime marker used by its public brand', () => {
  const registry = new PluginRegistry()
  const handle = registry.register(createPlugin('marked-plugin', { ok: true }))

  assert.strictEqual(handle[PLUGIN_HANDLE], PLUGIN_HANDLE_MARKER)
  assert.equal(typeof handle[PLUGIN_HANDLE].request, 'function')
  assert.equal(typeof handle[PLUGIN_HANDLE].data, 'function')
  assert.equal(Object.isFrozen(handle[PLUGIN_HANDLE]), true)
})

test('PluginRegistry validates invalid non-string lookups before WeakMap access', () => {
  const registry = new PluginRegistry()
  registry.register(createPlugin('valid-plugin', { ok: true }))

  for (const lookup of [null, undefined, 42, true, Symbol('invalid'), {}, []]) {
    assert.throws(
      () => registry.get(lookup as never),
      (error: unknown) => error instanceof PluginValidationError,
    )
  }
})

test('PluginRegistry rejects non-JSON-safe TData at the runtime boundary', async () => {
  const registry = new PluginRegistry()
  let validateCalls = 0
  const plugin: DataPlugin<undefined, Date> = {
    name: 'unsafe-data-plugin',
    async fetch() {
      return {
        data: new Date('2026-08-23T09:00:00.000Z'),
        metadata: {
          plugin: 'fixture-plugin',
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

  const handle = registry.register(plugin)
  await assert.rejects(registry.get(handle).fetch(undefined), /JSON-safe object/)
  assert.equal(validateCalls, 0)
})
