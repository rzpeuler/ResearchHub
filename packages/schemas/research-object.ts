/**
 * Public, runtime-neutral envelope for a machine-readable Research Object.
 *
 * The payload belongs to the producing Skill and is intentionally opaque to
 * this shared contract. Runtime details, prompts, tokens, and reasoning are
 * not part of the envelope.
 */
export type ResearchObjectPayload = Record<string, unknown>

export interface ResearchObjectEnvelope<
  TPayload extends ResearchObjectPayload = ResearchObjectPayload,
> {
  objectId: string
  objectType: string
  createdAt: string
  sourceWorkflow: string
  sourceSkill: string
  version: number
  payload: TPayload
}
