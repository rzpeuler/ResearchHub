import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { apply as applyDeepSeek } from '@deepseek-ai/dsh-llm-deepseek'
import type { HarnessLlmRuntime } from '../../dsh/llm-runtime/types.ts'
import { createKnowledgeCurationModelAdapter } from '../../dsh/llm-runtime/knowledge-curation-model-adapter.ts'
import type { KnowledgeCurationModel } from '../../packages/skills/knowledge-curation/index.ts'
import type { LocalKnowledgeProductValidationConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'

export type HarnessLlmRuntimeDecorator = (runtime: HarnessLlmRuntime) => HarnessLlmRuntime

export async function createRealKnowledgeCurationModel(config: LocalKnowledgeProductValidationConfig, injectedLlm?: HarnessLlmRuntime, decorateRuntime?: HarnessLlmRuntimeDecorator): Promise<{ model: KnowledgeCurationModel; close: () => Promise<void> }> {
  if (injectedLlm) {
    const runtime = decorateRuntime ? decorateRuntime(injectedLlm) : injectedLlm
    return { model: createKnowledgeCurationModelAdapter({ llm: runtime, provider: config.provider, model: config.model, maxTokens: config.curationMaxTokens }), close: async () => undefined }
  }
  if (!config.apiKey) throw new Error('missing_deepseek_api_key')
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  applyDeepSeek(ctx, { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: config.baseUrl, maxTokens: config.curationMaxTokens, models: [{ id: config.model, name: config.model }] })
  const runtime = decorateRuntime ? decorateRuntime(ctx.llm) : ctx.llm
  return {
    model: createKnowledgeCurationModelAdapter({ llm: runtime, provider: config.provider, model: config.model, maxTokens: config.curationMaxTokens }),
    close: async () => { await ctx.fiber.dispose() },
  }
}
