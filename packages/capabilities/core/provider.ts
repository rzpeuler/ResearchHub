/**
 * Provider boundary for a capability.
 *
 * A provider only adapts a source into the capability's domain output. It
 * must not own Agent orchestration, investment reasoning, or tool concerns.
 */
export interface CapabilityProvider<TInput, TOutput> {
  readonly name: string
  execute(input: TInput): Promise<TOutput>
}
