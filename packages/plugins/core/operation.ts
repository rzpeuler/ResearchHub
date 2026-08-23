/**
 * Plugin operation boundary for an external data function.
 *
 * A Plugin operation only adapts a source into a typed domain output. It must
 * not own research planning, methodology, or tool orchestration.
 */
export interface PluginOperation<TInput, TOutput> {
  readonly name: string
  execute(input: TInput): Promise<TOutput>
}
