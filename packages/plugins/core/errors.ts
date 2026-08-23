/** Base error for financial data Plugin framework failures. */
export class PluginError extends Error {
  override readonly cause: unknown

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'PluginError'
    this.cause = cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Raised when a Plugin value or Plugin result violates its runtime contract. */
export class PluginValidationError extends PluginError {
  readonly path: string

  constructor(message: string, path = '$') {
    super(path === '$' ? message : `${path}: ${message}`)
    this.name = 'PluginValidationError'
    this.path = path
  }
}

/** Base error for Plugin Registry operations. */
export class PluginRegistryError extends PluginError {
  readonly pluginName: string

  constructor(message: string, pluginName: string) {
    super(message)
    this.name = 'PluginRegistryError'
    this.pluginName = pluginName
  }
}

/** Raised when a Plugin name is already registered. */
export class PluginDuplicateError extends PluginRegistryError {
  constructor(pluginName: string) {
    super(`plugin already registered: ${pluginName}`, pluginName)
    this.name = 'PluginDuplicateError'
  }
}

/** Raised when a requested Plugin name is not registered. */
export class PluginNotFoundError extends PluginRegistryError {
  constructor(pluginName: string) {
    super(`plugin not found: ${pluginName}`, pluginName)
    this.name = 'PluginNotFoundError'
  }
}

// Descriptive aliases for callers that prefer registry-oriented names.
export { PluginDuplicateError as DuplicatePluginError }
export { PluginNotFoundError as UnknownPluginError }
