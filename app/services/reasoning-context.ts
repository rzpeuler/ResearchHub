import type { ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../plugins/reasoning/contracts.ts'
import type { SourceLibraryHit } from './source-library.ts'

function inject(input: unknown, hits: readonly SourceLibraryHit[]): unknown {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) return { ...(input as Record<string, unknown>), sourceLibraryContext: hits }
  return { boundedInput: input, sourceLibraryContext: hits }
}

/** Adds pre-retrieved Source Library evidence to every semantic call in one Workflow execution. */
export function withSourceLibraryContext(executor: ReasoningExecutor | undefined, hits: readonly SourceLibraryHit[] | undefined): ReasoningExecutor | undefined {
  if (executor === undefined || hits === undefined || hits.length === 0) return executor
  const candidate = executor as ReasoningExecutor & { runtimeMetadata?: () => unknown }
  const wrapped: ReasoningExecutor & { runtimeMetadata?: () => unknown } = {
    capabilities: () => executor.capabilities(),
    execute: async (request: ReasoningRequest, signal?: AbortSignal): Promise<ReasoningResult> => executor.execute({ ...request, input: inject(request.input, hits), metadata: { ...(request.metadata ?? {}), sourceLibraryHitCount: String(hits.length) } }, signal),
  }
  if (typeof candidate.runtimeMetadata === 'function') wrapped.runtimeMetadata = () => candidate.runtimeMetadata!()
  return wrapped
}
