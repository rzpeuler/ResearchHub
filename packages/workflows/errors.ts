export class WorkflowValidationError extends Error {
  readonly path: string | undefined

  constructor(message: string, path?: string) {
    super(path === undefined ? message : `${message} at ${path}`)
    this.name = 'WorkflowValidationError'
    this.path = path
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class WorkflowNotFoundError extends Error {
  constructor(workflowId: string) {
    super(`workflow not found: ${workflowId}`)
    this.name = 'WorkflowNotFoundError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class WorkflowDuplicateError extends Error {
  constructor(workflowId: string) {
    super(`workflow already registered: ${workflowId}`)
    this.name = 'WorkflowDuplicateError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
