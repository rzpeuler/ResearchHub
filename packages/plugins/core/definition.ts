import type { InferArgs, InferValue, ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** JSON-schema-shaped metadata exposed by a Plugin operation to its consumers. */
export type PluginInputSchema = ParameterSchemaSpec
export type PluginOutputSchema = ValueSchemaSpec

/**
 * Describes a reusable domain operation independently of its Plugin.
 *
 * The type parameters keep the domain input/output contract separate from
 * the schema representation, so the same shape can be reused by News,
 * Financial, Institution, and future research operations.
 */
export interface PluginDefinition<
  TInput,
  TOutput,
  TInputSchema extends PluginInputSchema = PluginInputSchema,
  TOutputSchema extends PluginOutputSchema = PluginOutputSchema,
> {
  /** Phantom links keep the runtime schema and domain contract paired in TypeScript. */
  readonly __input?: TInput
  readonly __output?: TOutput
  readonly name: string
  readonly description: string
  readonly inputSchema: TInputSchema
  readonly outputSchema: TOutputSchema
}

export type PluginInput<D extends PluginDefinition<any, any, any, any>> = D extends PluginDefinition<infer TInput, any, any, any> ? TInput : never
export type PluginOutput<D extends PluginDefinition<any, any, any, any>> = D extends PluginDefinition<any, infer TOutput, any, any> ? TOutput : never

/** Creates a Plugin operation whose domain types are derived from its Harness schemas. */
export function definePlugin<const TInputSchema extends ParameterSchemaSpec, const TOutputSchema extends ValueSchemaSpec>(
  definition: {
    readonly name: string
    readonly description: string
    readonly inputSchema: TInputSchema
    readonly outputSchema: TOutputSchema
  },
): PluginDefinition<InferArgs<TInputSchema>, InferValue<TOutputSchema>, TInputSchema, TOutputSchema> {
  return definition
}
