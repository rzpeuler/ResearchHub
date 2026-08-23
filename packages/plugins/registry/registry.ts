import { PluginDuplicateError, PluginNotFoundError, PluginValidationError } from '../core/errors.ts'
import { assertPluginName, inspectDataPlugin, validatePluginResult } from '../core/validation.ts'
import { PLUGIN_HANDLE, PLUGIN_HANDLE_MARKER, type DataPlugin, type PluginHandle, type PluginResult, type UnknownDataPlugin } from '../core/types.ts'

interface PluginRegistration {
  readonly name: string
  readonly plugin: DataPlugin<unknown, unknown>
  readonly fetch: DataPlugin<unknown, unknown>['fetch']
  readonly validate: DataPlugin<unknown, unknown>['validate']
}

/** In-process typed lookup boundary for named financial data Plugins. */
export class PluginRegistry {
  private readonly plugins = new Map<string, PluginRegistration>()
  private readonly handles = new WeakMap<object, PluginRegistration>()

  register<TRequest, TData>(plugin: DataPlugin<TRequest, TData>): PluginHandle<TRequest, TData> {
    const inspection = inspectDataPlugin(plugin)
    const existing = this.plugins.get(inspection.name)
    if (existing !== undefined) {
      throw new PluginDuplicateError(inspection.name)
    }

    const registration: PluginRegistration = {
      name: inspection.name,
      plugin: inspection.plugin,
      fetch: inspection.fetch,
      validate: inspection.validate,
    }
    const handle = Object.freeze({
      name: registration.name,
      [PLUGIN_HANDLE]: PLUGIN_HANDLE_MARKER,
    }) as PluginHandle<TRequest, TData>

    this.plugins.set(registration.name, registration)
    this.handles.set(handle, registration)
    return handle
  }

  get<TRequest, TData>(handle: PluginHandle<TRequest, TData>): DataPlugin<TRequest, TData>
  get(name: string): UnknownDataPlugin
  get<TRequest, TData>(lookup: PluginHandle<TRequest, TData> | string): DataPlugin<TRequest, TData> | UnknownDataPlugin {
    if (typeof lookup === 'string') {
      assertPluginName(lookup)
      const registration = this.plugins.get(lookup)
      if (registration === undefined) {
        throw new PluginNotFoundError(lookup)
      }

      return this.createPlugin<unknown, unknown>(registration)
    }

    assertPluginHandle(lookup)
    const registration = this.handles.get(lookup)
    if (registration === undefined) {
      throw new PluginNotFoundError(getHandleName(lookup))
    }

    return this.createPlugin<TRequest, TData>(registration)
  }

  has(name: string): boolean {
    assertPluginName(name)
    return this.plugins.has(name)
  }

  list(): string[] {
    return [...this.plugins.keys()]
  }

  private createPlugin<TRequest, TData>(registration: PluginRegistration): DataPlugin<TRequest, TData> {
    return {
      name: registration.name,
      async fetch(request: TRequest) {
        // Do not catch these errors: callers must receive the Plugin's original
        // fetch/validation failure while the Registry enforces the result boundary.
        const result = await registration.fetch.call(registration.plugin, request)
        validatePluginResult(result)
        registration.validate.call(registration.plugin, result.data)
        // Return an isolated snapshot so plugins cannot mutate Plugin-owned
        // data or affect a later result when a Plugin reuses its JSON-safe result.
        return structuredClone(result) as PluginResult<TData>
      },
      validate(value: unknown): asserts value is TData {
        registration.validate.call(registration.plugin, value)
      },
    }
  }
}

function getHandleName(handle: { readonly name: unknown }): string {
  return typeof handle.name === 'string' && handle.name.trim().length > 0
    ? handle.name
    : '<unknown>'
}

function assertPluginHandle(value: unknown): asserts value is PluginHandle<unknown, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PluginValidationError('expected a PluginHandle or plugin name')
  }

  let marker: unknown
  let name: unknown
  try {
    const handle = value as { readonly name?: unknown; readonly [PLUGIN_HANDLE]?: unknown }
    marker = handle[PLUGIN_HANDLE]
    name = handle.name
  } catch {
    throw new PluginValidationError('PluginHandle properties could not be read')
  }

  if (marker !== PLUGIN_HANDLE_MARKER) {
    throw new PluginValidationError('expected a PluginHandle or plugin name')
  }
  assertPluginName(name, '$.name')
}
