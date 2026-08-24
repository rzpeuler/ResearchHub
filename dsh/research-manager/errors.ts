export class ResearchManagerValidationError extends Error {
  readonly path: string | undefined

  constructor(message: string, path?: string) {
    super(path === undefined ? message : `${message} at ${path}`)
    this.name = 'ResearchManagerValidationError'
    this.path = path
    Object.setPrototypeOf(this, new.target.prototype)
  }
}
