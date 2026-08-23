import { PluginError } from '../../core/index.ts'

export class MediaPluginError extends PluginError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'MediaPluginError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
