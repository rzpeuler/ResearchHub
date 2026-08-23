/** Base error for financial data Provider framework failures. */
export class ProviderError extends Error {
  override readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'ProviderError'
    this.cause = cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Raised when a Provider value or Provider result violates its runtime contract. */
export class ProviderValidationError extends ProviderError {
  readonly path: string

  constructor(message: string, path = '$') {
    super(path === '$' ? message : `${path}: ${message}`)
    this.name = 'ProviderValidationError'
    this.path = path
  }
}

/** Base error for Provider Registry operations. */
export class ProviderRegistryError extends ProviderError {
  readonly providerName: string

  constructor(message: string, providerName: string) {
    super(message)
    this.name = 'ProviderRegistryError'
    this.providerName = providerName
  }
}

/** Raised when a Provider name is already registered. */
export class ProviderDuplicateError extends ProviderRegistryError {
  constructor(providerName: string) {
    super(`provider already registered: ${providerName}`, providerName)
    this.name = 'ProviderDuplicateError'
  }
}

/** Raised when a requested Provider name is not registered. */
export class ProviderNotFoundError extends ProviderRegistryError {
  constructor(providerName: string) {
    super(`provider not found: ${providerName}`, providerName)
    this.name = 'ProviderNotFoundError'
  }
}

// Descriptive aliases for callers that prefer registry-oriented names.
export { ProviderDuplicateError as DuplicateProviderError }
export { ProviderNotFoundError as UnknownProviderError }
