import { ProviderError } from '../../core/index.ts'

export class MediaProviderError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'MediaProviderError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
