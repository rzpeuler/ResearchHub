import type { CandidateValidationRejection } from "./types.ts";

export type KnowledgeCurationErrorCode =
  | "model_error"
  | "invalid_model_output"
  | "invalid_reference"
  | "invalid_confidence"
  | "invalid_semantics"
  | "ungrounded_candidate"
  | "candidate_set_exhausted";

export class KnowledgeCurationError extends Error {
  override readonly cause: unknown;

  constructor(
    public readonly code: KnowledgeCurationErrorCode,
    message: string,
    cause?: unknown,
    public readonly candidateValidationRejections?: CandidateValidationRejection[],
  ) {
    super(message);
    this.name = "KnowledgeCurationError";
    this.cause = cause;
  }
}
