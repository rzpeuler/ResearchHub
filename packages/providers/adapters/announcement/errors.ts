import { ProviderError } from '../../core/index.ts'

export class AnnouncementProviderError extends ProviderError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'AnnouncementProviderError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
