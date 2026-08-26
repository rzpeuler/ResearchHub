import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { KnowledgeCurationModel, KnowledgeCurationModelRequest } from '../../packages/skills/knowledge-curation/index.ts'
import { LlmSkillAdapterError } from './errors.ts'
import type { HarnessLlmRuntime } from './types.ts'

export interface KnowledgeCurationModelAdapterOptions {
  llm: HarnessLlmRuntime
  provider: string
  model: string
  maxTokens?: number
  temperature?: number
}

/** DSH-only composition adapter. The Curation Skill remains the authoritative validator. */
export class KnowledgeCurationModelAdapter implements KnowledgeCurationModel {
  constructor(private readonly options: KnowledgeCurationModelAdapterOptions) {}

  async invoke(request: KnowledgeCurationModelRequest): Promise<unknown> {
    const prompt = [
      'You are a ResearchHub Knowledge Curation model.',
      'Return JSON only. Do not invent references, IDs, sourceRefs, or rawRefs.',
      `Operation: ${request.operation}`,
      `Expected output contract: ${request.expectedOutputContract}`,
      `Instruction:\n${request.instruction}`,
      `Input:\n${JSON.stringify(request.input)}`,
    ].join('\n\n')
    const options: GenerateOptions = {
      provider: this.options.provider,
      model: this.options.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } })],
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
