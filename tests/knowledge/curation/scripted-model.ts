import type { KnowledgeCurationModel, KnowledgeCurationModelRequest } from '../../../packages/skills/knowledge-curation/index.ts'
import type { CurationOperation } from '../../../packages/skills/knowledge-curation/types.ts'

export class ScriptedKnowledgeCurationModel implements KnowledgeCurationModel {
  readonly requests: KnowledgeCurationModelRequest[] = []
  private readonly outputs = new Map<CurationOperation, unknown[]>()

  set(operation: CurationOperation, output: unknown): this {
    this.outputs.set(operation, [output])
    return this
  }

  queue(operation: CurationOperation, outputs: unknown[]): this {
    this.outputs.set(operation, [...outputs])
    return this
  }

  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> {
    this.requests.push(request)
    const outputs = this.outputs.get(request.operation)
    if (!outputs || outputs.length === 0) throw new Error(`No scripted output for ${request.operation}`)
    return structuredClone(outputs.length === 1 ? outputs[0] : outputs.shift())
  }
}
