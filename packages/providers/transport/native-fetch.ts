export type NativeFetchInput = Parameters<typeof fetch>[0]
export type NativeFetchInit = Parameters<typeof fetch>[1]
export type NativeFetchResponse = Awaited<ReturnType<typeof fetch>>
export type NativeFetchImplementation = typeof fetch

/** Generic injectable boundary around the platform's native fetch implementation. */
export interface NativeFetchTransport {
  request(input: NativeFetchInput, init?: NativeFetchInit): Promise<NativeFetchResponse>
}

/** Creates a transport using native fetch, or a caller-supplied implementation in tests/adapters. */
export function createNativeFetchTransport(
  fetchImplementation: NativeFetchImplementation = globalThis.fetch.bind(globalThis),
): NativeFetchTransport {
  if (typeof fetchImplementation !== 'function') {
    throw new TypeError('a fetch implementation is required')
  }

  return Object.freeze({
    request(input: NativeFetchInput, init?: NativeFetchInit): Promise<NativeFetchResponse> {
      return fetchImplementation(input, init)
    },
  })
}
