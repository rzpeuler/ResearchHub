import { PluginError } from '../../core/index.ts'

export class FinancialPluginError extends PluginError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'FinancialPluginError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
