export interface PluginExecutionErrorOptions {
  operationName: string
  pluginName: string
  input: unknown
  cause: unknown
}

/** Adds stable operation/plugin context to an underlying plugin failure. */
export class PluginExecutionError extends Error {
  readonly operationName: string
  readonly pluginName: string
  readonly input: unknown

  constructor(options: PluginExecutionErrorOptions) {
    super(`Plugin operation ${options.operationName} failed in plugin ${options.pluginName}`, { cause: options.cause })
    this.name = 'PluginExecutionError'
    this.operationName = options.operationName
    this.pluginName = options.pluginName
    this.input = options.input
  }
}
