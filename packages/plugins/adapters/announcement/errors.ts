import { PluginError } from '../../core/index.ts'

export class AnnouncementPluginError extends PluginError {
  constructor(message: string, cause?: unknown) {
    super(message, cause)
    this.name = 'AnnouncementPluginError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
