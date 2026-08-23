import { type Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { ResearchManager } from './packages/agents/research-manager/index.ts'
import { registerMarketCapabilityTool } from '../../packages/capabilities/market/harness-tool.ts'
import { MarketCapability } from '../../packages/capabilities/market/provider.ts'
import { createMockProviderComposition } from '../../packages/providers/index.ts'

export const name = 'researchhub-market-capability-validation-extension'
export const inject = ['llm', 'tools', 'agents']

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

class MarketCapabilityMockAdapter extends LlmAdapter {
  private readonly script = [
    toolCallResponse('get_market_snapshot', '{"symbol":"600519"}', 'market-snapshot-call'),
    textResponse('Market capability integration validation completed'),
  ]

  override providerInfo(provider: string) {
    if (provider !== 'researchhub-market-validation') throw new Error(`unknown market validation provider: ${provider}`)
    return { id: provider, name: 'ResearchHub Market Validation Mock' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === 'researchhub-market-validation'
      ? [{ provider, id: 'market-validation-model', name: 'ResearchHub Market Validation Model', inputModalities: ['text'] as const }]
      : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = this.script.shift()
    if (response === undefined) throw new Error('market capability mock response script exhausted')
    yield* response
  }
}

export async function apply(ctx: Context): Promise<void> {
  const providers = createMockProviderComposition()
  const capability = new MarketCapability(providers.registry, providers.market)
  registerMarketCapabilityTool(ctx, capability)
  new ResearchManager(ctx)
  ctx.llm.registerAdapter(['researchhub-market-validation'], new MarketCapabilityMockAdapter())
}

export default { name, inject, apply }
