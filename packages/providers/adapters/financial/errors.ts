import { ProviderError } from '../../core/index.ts'

export class FinancialProviderError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'FinancialProviderError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
