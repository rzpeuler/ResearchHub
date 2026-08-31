import { createUserMessage, ReasoningEffortId, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { KnowledgeCurationModel, KnowledgeCurationModelRequest } from '../../packages/skills/knowledge-curation/index.ts'
import type { ActiveCurationOperation } from '../../packages/skills/knowledge-curation/types.ts'
import { LlmSkillAdapterError } from './errors.ts'
import type { HarnessLlmRuntime } from './types.ts'

export interface KnowledgeCurationModelAdapterOptions {
  llm: HarnessLlmRuntime
  provider: string
  model: string
  maxTokens?: number
  temperature?: number
}

const KNOWLEDGE_CURATION_REASONING_POLICY = {
  understandReport: ReasoningEffortId('off'),
  extractKnowledge: ReasoningEffortId('off'),
  reconcileKnowledge: ReasoningEffortId('low'),
  analyzeSchemaGaps: ReasoningEffortId('low'),
} satisfies Record<ActiveCurationOperation, ReturnType<typeof ReasoningEffortId>>

/** DSH-only composition adapter. The Curation Skill remains the authoritative validator. */
export class KnowledgeCurationModelAdapter implements KnowledgeCurationModel {
  constructor(private readonly options: KnowledgeCurationModelAdapterOptions) {}

  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> {
    if (!request?.schemaContext) throw new LlmSkillAdapterError('Knowledge Curation request requires schemaContext')
    if (!request?.outputContract) throw new LlmSkillAdapterError('Knowledge Curation request requires outputContract')
    const prompt = [
      'You are a ResearchHub Knowledge Curation model.',
      'Return JSON only and follow the supplied Output Contract exactly.',
      'Property names must exactly match the Output Contract; do not add undeclared properties.',
      'Treat canonical enum values in the Schema Context as authoritative.',
      'Do not invent references, durable IDs, sourceRefs, or rawRefs.',
      `Operation: ${request.operation}`,
      `Schema Context:\n${JSON.stringify(request.schemaContext)}`,
      `Output Contract:\n${JSON.stringify(request.outputContract)}`,
      `Instruction:\n${request.instruction}`,
      `Input:\n${JSON.stringify(request.input)}`,
    ].join('\n\n')
    const options: GenerateOptions = {
      provider: this.options.provider,
      model: this.options.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
      reasoningEffort: KNOWLEDGE_CURATION_REASONING_POLICY[request.operation],
      temperature: this.options.temperature ?? 0,
      maxTokens: this.options.maxTokens ?? 4096,
    }
    let output = ''
    let finished = false
    for await (const chunk of this.options.llm.stream(options)) {
      if (chunk.type === 'text-delta') output += chunk.text
      if (chunk.type === 'finish') {
        finished = true
        if (chunk.reason.kind !== 'stop') throw new LlmSkillAdapterError(`Knowledge Curation did not finish normally: ${chunk.reason.kind}`)
      }
    }
    if (!finished || output.trim() === '') throw new LlmSkillAdapterError('Knowledge Curation returned no JSON output')
    return parseJson(output)
  }
}

export function createKnowledgeCurationModelAdapter(options: KnowledgeCurationModelAdapterOptions): KnowledgeCurationModel { return new KnowledgeCurationModelAdapter(options) }

function parseJson(value: string): unknown {
  const normalized = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(normalized) as unknown } catch (error) {
    const start = normalized.indexOf('{')
    if (start >= 0) {
      let depth = 0; let inString = false; let escaped = false
      for (let index = start; index < normalized.length; index += 1) {
        const character = normalized[index]
        if (inString) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') inString = false; continue }
        if (character === '"') inString = true
        else if (character === '{') depth += 1
        else if (character === '}' && --depth === 0) { try { return JSON.parse(normalized.slice(start, index + 1)) as unknown } catch { break } }
      }
    }
    throw new LlmSkillAdapterError('Knowledge Curation returned invalid JSON', { cause: error })
  }
}
