import { PluginError } from '../../core/index.ts'

export type NewsAcquisitionStage = 'search' | 'fetch' | 'normalize' | 'evidence'

export class NewsAcquisitionError extends PluginError {
  readonly stage: NewsAcquisitionStage

  constructor(stage: NewsAcquisitionStage, message: string, cause?: unknown) {
    super(`${stage}: ${message}`, cause)
    this.name = 'NewsAcquisitionError'
    this.stage = stage
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

