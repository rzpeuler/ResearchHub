import type { InferArgs, InferValue, ParameterSchemaSpec, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** JSON-schema-shaped metadata exposed by a capability to its consumers. */
export type CapabilityInputSchema = ParameterSchemaSpec
export type CapabilityOutputSchema = ValueSchemaSpec

/**
 * Describes a reusable domain capability independently of its provider.
 *
 * The type parameters keep the domain input/output contract separate from
 * the schema representation, so the same shape can be reused by News,
 * Financial, Institution, and future capabilities.
 */
export interface CapabilityDefinition<
  TInput,
  TOutput,
  TInputSchema extends CapabilityInputSchema = CapabilityInputSchema,
  TOutputSchema extends CapabilityOutputSchema = CapabilityOutputSchema,
> {
  /** Phantom links keep the runtime schema and domain contract paired in TypeScript. */
  readonly __input?: TInput
  readonly __output?: TOutput
  readonly name: string
  readonly description: string
  readonly inputSchema: TInputSchema
  readonly outputSchema: TOutputSchema
}

export type CapabilityInput<D extends CapabilityDefinition<any, any, any, any>> = D extends CapabilityDefinition<infer TInput, any, any, any> ? TInput : never
export type CapabilityOutput<D extends CapabilityDefinition<any, any, any, any>> = D extends CapabilityDefinition<any, infer TOutput, any, any> ? TOutput : never

/** Creates a capability whose domain types are derived from its Harness schemas. */
export function defineCapability<const TInputSchema extends ParameterSchemaSpec, const TOutputSchema extends ValueSchemaSpec>(
  definition: {
    readonly name: string
    readonly description: string
    readonly inputSchema: TInputSchema
    readonly outputSchema: TOutputSchema
  },
): CapabilityDefinition<InferArgs<TInputSchema>, InferValue<TOutputSchema>, TInputSchema, TOutputSchema> {
  return definition
}
