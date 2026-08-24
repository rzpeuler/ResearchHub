import { type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { ResearchManager } from './dsh/research-manager/index.ts'
import { registerValidationPlugin, ValidationPlugin } from './packages/plugins/validation-plugin/index.ts'

export interface Config {
  skillRoot: string
}

export const Config: z<Config> = z.object({
  skillRoot: z.string().required(),
})

export const name = 'researchhub-integration-validation-extension'
export const inject = ['llm', 'skills', 'tools', 'agents']

function toolCallResponse(name: string, args: string, callId: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId(callId), name, argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(callId), name, arguments: args } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 1, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

export class ValidationMockAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  private readonly script = [
    toolCallResponse('skill', '{"name":"validation-skill"}', 'validation-skill-call'),
    toolCallResponse('researchhub_validation_plugin', '{"skillName":"validation-skill"}', 'validation-plugin-call'),
    textResponse('ResearchHub integration validation completed'),
  ]

  override providerInfo(provider: string) {
    if (provider !== 'researchhub-validation') throw new Error(`unknown validation provider: ${provider}`)
    return { id: provider, name: 'ResearchHub Validation Mock' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === 'researchhub-validation'
      ? [{ provider, id: 'validation-model', name: 'ResearchHub Validation Model', inputModalities: ['text'] as const }]
      : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const response = this.script.shift()
    if (response === undefined) throw new Error('validation mock response script exhausted')
    yield* response
  }
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(SkillFilesystem, {
    includeDefaultRoots: false,
    customSkillDirs: [config.skillRoot],
    watch: false,
  })
  await ctx.plugin(SkillTool)
  registerValidationPlugin(ctx, new ValidationPlugin(ctx))
  new ResearchManager(ctx)
  ctx.llm.registerAdapter(['researchhub-validation'], new ValidationMockAdapter())
}

export default { name, Config, inject, apply }
