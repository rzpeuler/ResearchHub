import type { EquityResearchStepState } from './types.ts'

export class EquityResearchWorkflowError extends Error {
  readonly stepId: string
  readonly states: readonly EquityResearchStepState[]

  constructor(stepId: string, message: string, states: readonly EquityResearchStepState[], cause?: unknown) {
    super(`equity-research step ${stepId} failed: ${message}`, { cause })
    this.name = 'EquityResearchWorkflowError'
    this.stepId = stepId
    this.states = states.map((state) => ({ ...state }))
  }
}
