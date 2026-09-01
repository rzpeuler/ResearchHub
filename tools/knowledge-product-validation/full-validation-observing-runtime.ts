import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";

type JsonRecord = Record<string, unknown>;

export type FullValidationRuntimeObservation = JsonRecord & {
  operation: string | null;
  reasoningEffort: string | null;
  maxTokens: number | null;
  temperature: number | null;
  startedAt: string;
  firstReasoningDeltaMs: number | null;
  firstTextDeltaMs: number | null;
  finishMs: number | null;
  durationMs: number | null;
  reasoningDeltaCount: number;
  textDeltaCount: number;
  finishReason: string | null;
};

/**
 * Passive instrumentation for full validation. It forwards the exact upstream
 * GenerateOptions object and never adds a cancellation source or timer.
 */
export class FullValidationObservingRuntime {
  readonly calls: FullValidationRuntimeObservation[] = [];
  readonly observerCreatedTimeout = false;
  readonly observerCreatedAbortController = false;
  readonly originalSignalPreserved = true;

  constructor(private readonly delegate: { stream(options: GenerateOptions): AsyncIterable<StreamChunk> }) {}

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.observe(options);
  }

  private async *observe(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const started = performance.now();
    const observation: FullValidationRuntimeObservation = {
      operation: operationFromPrompt(options),
      reasoningEffort: options.reasoningEffort === undefined ? null : String(options.reasoningEffort),
      maxTokens: options.maxTokens ?? null,
      temperature: options.temperature ?? null,
      startedAt: new Date().toISOString(),
      firstReasoningDeltaMs: null,
      firstTextDeltaMs: null,
      finishMs: null,
      durationMs: null,
      reasoningDeltaCount: 0,
      textDeltaCount: 0,
      finishReason: null,
    };
    this.calls.push(observation);
    try {
      for await (const chunk of this.delegate.stream(options)) {
        const elapsed = Math.round(performance.now() - started);
        if (chunk.type === "reasoning-delta") {
          observation.reasoningDeltaCount += 1;
          if (observation.firstReasoningDeltaMs === null) observation.firstReasoningDeltaMs = elapsed;
        }
        if (chunk.type === "text-delta") {
          observation.textDeltaCount += 1;
          if (observation.firstTextDeltaMs === null) observation.firstTextDeltaMs = elapsed;
        }
        if (chunk.type === "finish") {
          observation.finishMs = elapsed;
          observation.finishReason = chunk.reason.kind;
        }
        yield chunk;
      }
    } catch (error) {
      observation.upstreamError = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
      throw error;
    } finally {
      observation.durationMs = Math.round(performance.now() - started);
    }
  }
}

function operationFromPrompt(options: GenerateOptions): string | null {
  for (const message of options.messages) {
    for (const content of message.content) {
      if (content.type === "text") return content.text.match(/Operation: (understandReport|extractKnowledge|reconcileKnowledge|analyzeSchemaGaps)/)?.[1] ?? null;
    }
  }
  return null;
}
