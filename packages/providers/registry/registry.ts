import { ProviderDuplicateError, ProviderNotFoundError, ProviderValidationError } from '../core/errors.ts'
import { assertProviderName, inspectDataProvider, validateProviderResult } from '../core/validation.ts'
import { PROVIDER_HANDLE, PROVIDER_HANDLE_MARKER, type DataProvider, type ProviderHandle, type ProviderResult, type UnknownDataProvider } from '../core/types.ts'

interface ProviderRegistration {
  readonly name: string
  readonly provider: DataProvider<unknown, unknown>
  readonly fetch: DataProvider<unknown, unknown>['fetch']
  readonly validate: DataProvider<unknown, unknown>['validate']
}

/** In-process typed lookup boundary for named financial data Providers. */
export class ProviderRegistry {
  private readonly providers = new Map<string, ProviderRegistration>()
  private readonly handles = new WeakMap<object, ProviderRegistration>()

  register<TRequest, TData>(provider: DataProvider<TRequest, TData>): ProviderHandle<TRequest, TData> {
    const inspection = inspectDataProvider(provider)
    const existing = this.providers.get(inspection.name)
    if (existing !== undefined) {
      throw new ProviderDuplicateError(inspection.name)
    }

    const registration: ProviderRegistration = {
      name: inspection.name,
      provider: inspection.provider,
      fetch: inspection.fetch,
      validate: inspection.validate,
    }
    const handle = Object.freeze({
      name: registration.name,
      [PROVIDER_HANDLE]: PROVIDER_HANDLE_MARKER,
    }) as ProviderHandle<TRequest, TData>

    this.providers.set(registration.name, registration)
    this.handles.set(handle, registration)
    return handle
  }

  get<TRequest, TData>(handle: ProviderHandle<TRequest, TData>): DataProvider<TRequest, TData>
  get(name: string): UnknownDataProvider
  get<TRequest, TData>(lookup: ProviderHandle<TRequest, TData> | string): DataProvider<TRequest, TData> | UnknownDataProvider {
    if (typeof lookup === 'string') {
      assertProviderName(lookup)
      const registration = this.providers.get(lookup)
      if (registration === undefined) {
        throw new ProviderNotFoundError(lookup)
      }

      return this.createProvider<unknown, unknown>(registration)
    }

    assertProviderHandle(lookup)
    const registration = this.handles.get(lookup)
    if (registration === undefined) {
      throw new ProviderNotFoundError(getHandleName(lookup))
    }

    return this.createProvider<TRequest, TData>(registration)
  }

  has(name: string): boolean {
    assertProviderName(name)
    return this.providers.has(name)
  }

  list(): string[] {
    return [...this.providers.keys()]
  }

  private createProvider<TRequest, TData>(registration: ProviderRegistration): DataProvider<TRequest, TData> {
    return {
      name: registration.name,
      async fetch(request: TRequest) {
        // Do not catch these errors: callers must receive the Provider's original
        // fetch/validation failure while the Registry enforces the result boundary.
        const result = await registration.fetch.call(registration.provider, request)
        validateProviderResult(result)
        registration.validate.call(registration.provider, result.data)
        // Return an isolated snapshot so capabilities cannot mutate Provider-owned
        // data or affect a later result when a Provider reuses its JSON-safe result.
        return structuredClone(result) as ProviderResult<TData>
      },
      validate(value: unknown): asserts value is TData {
        registration.validate.call(registration.provider, value)
      },
    }
  }
}

function getHandleName(handle: { readonly name: unknown }): string {
  return typeof handle.name === 'string' && handle.name.trim().length > 0
    ? handle.name
    : '<unknown>'
}

function assertProviderHandle(value: unknown): asserts value is ProviderHandle<unknown, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProviderValidationError('expected a ProviderHandle or provider name')
  }

  let marker: unknown
  let name: unknown
  try {
    const handle = value as { readonly name?: unknown; readonly [PROVIDER_HANDLE]?: unknown }
    marker = handle[PROVIDER_HANDLE]
    name = handle.name
  } catch {
    throw new ProviderValidationError('ProviderHandle properties could not be read')
  }

  if (marker !== PROVIDER_HANDLE_MARKER) {
    throw new ProviderValidationError('expected a ProviderHandle or provider name')
  }
  assertProviderName(name, '$.name')
}
