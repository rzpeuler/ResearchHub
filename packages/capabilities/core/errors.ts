export interface CapabilityExecutionErrorOptions {
  capabilityName: string
  providerName: string
  input: unknown
  cause: unknown
}

/** Adds stable capability/provider context to an underlying provider failure. */
export class CapabilityExecutionError extends Error {
  readonly capabilityName: string
  readonly providerName: string
  readonly input: unknown

  constructor(options: CapabilityExecutionErrorOptions) {
    super(`Capability ${options.capabilityName} failed in provider ${options.providerName}`, { cause: options.cause })
    this.name = 'CapabilityExecutionError'
    this.capabilityName = options.capabilityName
    this.providerName = options.providerName
    this.input = options.input
  }
}
