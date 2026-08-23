import { type Context } from '@deepseek-ai/cordis'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { EventAnalysisWorkflow, registerEventAnalysisTool } from '../../packages/skills/event-analysis/index.ts'
import { MarketPlugin } from '../../packages/plugins/market/plugin.ts'
import { NewsPlugin } from '../../packages/plugins/news/plugin.ts'
import { createMockPluginComposition } from '../../packages/plugins/index.ts'
import { ResearchManager } from './packages/dsh/research-manager/index.ts'

export interface Config {
  skillRoot: string
  createdAt?: string
}

export const name = 'researchhub-event-analysis-validation-extension'
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

export class EventAnalysisMockAdapter extends LlmAdapter {
  private readonly script = [
    toolCallResponse('skill', '{"name":"event-analysis"}', 'event-analysis-skill-call'),
    toolCallResponse(
      'run_event_analysis',
      '{"symbol":"600519","evaluationPeriod":{"start":"2026-08-23T00:00:00.000Z","end":"2026-09-23T00:00:00.000Z"}}',
      'event-analysis-workflow-call',
    ),
    textResponse('Event analysis artifact workflow completed'),
  ]

  override providerInfo(provider: string) {
    if (provider !== 'researchhub-event-analysis-validation') throw new Error(`unknown event analysis provider: ${provider}`)
    return { id: provider, name: 'ResearchHub Event Analysis Validation Mock' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === 'researchhub-event-analysis-validation'
      ? [{ provider, id: 'event-analysis-validation-model', name: 'ResearchHub Event Analysis Validation Model', inputModalities: ['text'] as const }]
      : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = this.script.shift()
    if (response === undefined) throw new Error('event analysis mock response script exhausted')
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

  const plugins = createMockPluginComposition()
  const workflow = new EventAnalysisWorkflow({
    marketPlugin: new MarketPlugin(plugins.registry, plugins.market),
    newsPlugin: new NewsPlugin(plugins.registry, plugins.news),
    artifactIdFactory: (type, ordinal) => `event-${type}-${ordinal}`,
  })
  registerEventAnalysisTool(ctx, workflow, () => config.createdAt ?? '2026-08-23T00:00:00.000Z')
  new ResearchManager(ctx)
  ctx.llm.registerAdapter(['researchhub-event-analysis-validation'], new EventAnalysisMockAdapter())
}

export default { name, inject, apply }
