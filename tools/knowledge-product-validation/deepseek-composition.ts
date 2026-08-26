import { Context } from '@deepseek-ai/cordis'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { apply as applyDeepSeek } from '@deepseek-ai/dsh-llm-deepseek'
import type { HarnessLlmRuntime } from '../../dsh/llm-runtime/types.ts'
import { createKnowledgeCurationModelAdapter } from '../../dsh/llm-runtime/knowledge-curation-model-adapter.ts'
import type { KnowledgeCurationModel } from '../../packages/skills/knowledge-curation/index.ts'
import type { LocalKnowledgeProductValidationConfig } from '../../dsh/llm-runtime/local-runtime-config.ts'

export async function createRealKnowledgeCurationModel(config: LocalKnowledgeProductValidationConfig, injectedLlm?: HarnessLlmRuntime): Promise<{ model: KnowledgeCurationModel; close: () => Promise<void> }> {
  if (injectedLlm) return { model: createKnowledgeCurationModelAdapter({ llm: injectedLlm, provider: config.provider, model: config.model, maxTokens: config.curationMaxTokens }), close: async () => undefined }
  if (!config.apiKey) throw new Error('missing_deepseek_api_key')
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { persona: 'ResearchHub real Knowledge Product Validation runtime.' } })
  applyDeepSeek(ctx, { apiKeyEnv: 'DEEPSEEK_API_KEY', baseURL: config.baseUrl, maxTokens: config.curationMaxTokens, models: [{ id: config.model, name: config.model }] })
  return {
    model: createKnowledgeCurationModelAdapter({ llm: ctx.llm, provider: config.provider, model: config.model, maxTokens: config.curationMaxTokens }),
    close: async () => { await ctx.fiber.dispose() },
  }
}
