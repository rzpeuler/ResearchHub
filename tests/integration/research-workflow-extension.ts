import { type Context } from '@deepseek-ai/cordis'
import * as SkillFilesystem from '@deepseek-ai/dsh-skill-filesystem'
import * as SkillTool from '@deepseek-ai/dsh-tool-skill'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { FinancialCapability } from '../../packages/capabilities/financial/index.ts'
import { MarketCapability } from '../../packages/capabilities/market/index.ts'
import { NewsCapability } from '../../packages/capabilities/news/index.ts'
import { ResearchManager } from '../../packages/agents/research-manager/index.ts'
import { EventAnalysisWorkflow } from '../../packages/skills/event-analysis/index.ts'
import { createMockProviderComposition } from '../../packages/providers/index.ts'
import { registerAnnouncementProvider, registerMediaProvider } from '../../packages/providers/adapters/index.ts'
import { buildFinancialData, validateFinancialData, type NormalizedFinancialRow } from '../../packages/providers/adapters/financial/normalization.ts'
import type { FinancialData, FinancialProvider } from '../../packages/providers/adapters/financial/types.ts'
import { eventAnalysisWorkflowDefinition, EventAnalysisWorkflowExecutor, WorkflowRegistry } from '../../packages/workflows/index.ts'
import ResearchManagerExtension, { type ResearchManagerHarnessConfig } from '../../packages/agents/research-manager/harness.ts'

export interface Config {
  skillRoot: string
  createdAt?: string
}

export const name = 'researchhub-research-workflow-validation-extension'
export const inject = ['llm', 'skills', 'tools', 'agents']

function toolCallResponse(toolName: string, args: string, callId: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: CallId(callId), name: toolName, argumentsDelta: args },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: CallId(callId), name: toolName, arguments: args } },
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

export class ResearchWorkflowMockAdapter extends LlmAdapter {
  private readonly script = [
    toolCallResponse('skill', '{"name":"event-analysis"}', 'research-workflow-skill-call'),
    toolCallResponse('run_research_workflow', JSON.stringify({
      workflowId: 'event-analysis',
      symbol: '600519',
      question: 'What evidence explains the current event?',
      evaluationPeriod: { start: '2026-08-24T00:00:00.000Z', end: '2026-09-24T00:00:00.000Z' },
    }), 'research-workflow-run-call'),
    textResponse('Research workflow completed with a structured report view'),
  ]

  override providerInfo(provider: string) {
    if (provider !== 'researchhub-research-workflow-validation') throw new Error(`unknown research workflow provider: ${provider}`)
    return { id: provider, name: 'ResearchHub Research Workflow Validation Mock' }
  }

  override listModels(provider: string) {
    return Promise.resolve(provider === 'researchhub-research-workflow-validation'
      ? [{ provider, id: 'research-workflow-validation-model', name: 'ResearchHub Research Workflow Validation Model', inputModalities: ['text'] as const }]
      : [])
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    const response = this.script.shift()
    if (response === undefined) throw new Error('research workflow mock response script exhausted')
    yield* response
  }
}

function financialFixture(): FinancialProvider {
  const rows: NormalizedFinancialRow[] = [{
    statementType: 'income', symbol: '600519', period: '2025-12-31',
    values: { total_revenue: 1000, operate_profit: 300, n_income: 250 },
    provider: 'fixture-financial', source: 'financial-fixture', retrievedAt: '2026-08-24T00:00:00.000Z', quality: 'high', confidence: 0.9,
  }]
  const data = buildFinancialData(rows)
  return {
    name: 'fixture-financial',
    async fetch() { return { data, metadata: { provider: 'fixture-financial', source: 'financial-fixture', timestamp: '2026-08-24T00:00:00.000Z', quality: 'high' as const, confidence: 0.9 } } },
    validate(value: unknown): asserts value is FinancialData { validateFinancialData(value) },
  }
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.plugin(SkillFilesystem, { includeDefaultRoots: false, customSkillDirs: [config.skillRoot], watch: false })
  await ctx.plugin(SkillTool)

  const providers = createMockProviderComposition()
  const announcement = registerAnnouncementProvider(providers.registry, {
    sourceAdapter: {
      name: 'workflow-official-fixture',
      async fetch() {
        return [{
          title: 'Official announcement fixture',
          content: 'Official company announcement content.',
          publishedAt: '2026-08-24T00:00:00.000Z',
          source: 'official-fixture',
          securityCode: '600519.SH',
          confidence: 0.95,
        }]
      },
    },
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    sourceName: 'official-fixture',
  })
  const media = registerMediaProvider(providers.registry, {
    sourceAdapter: {
      name: 'workflow-media-fixture',
      async fetch() {
        return [{
          title: 'Professional media fixture',
          content: 'Professional media interpretation content.',
          publishedAt: '2026-08-24T00:00:00.000Z',
          source: 'media-fixture',
          publisher: 'Research Media',
          tier: 'tier-1' as const,
          securityCode: '600519.SH',
          confidence: 0.85,
        }]
      },
    },
    clock: () => new Date('2026-08-24T00:00:00.000Z'),
    sourceName: 'media-fixture',
  })
  const financial = providers.registry.register(financialFixture())
  const eventWorkflow = new EventAnalysisWorkflow({
    marketCapability: new MarketCapability(providers.registry, providers.market),
    newsCapability: new NewsCapability(providers.registry, announcement.news),
    announcementCapability: new NewsCapability(providers.registry, announcement.news),
    mediaCapability: new NewsCapability(providers.registry, media.news),
    financialCapability: new FinancialCapability(providers.registry, financial),
    artifactIdFactory: (type, ordinal) => `research-workflow-${type}-${ordinal}`,
  })
  const workflows = new WorkflowRegistry()
  workflows.register(eventAnalysisWorkflowDefinition)
  const manager = new ResearchManager(workflows, new Map([
    ['event-analysis', new EventAnalysisWorkflowExecutor(eventWorkflow)],
  ]))
  const managerConfig: ResearchManagerHarnessConfig = { manager, createdAt: config.createdAt }
  await ctx.plugin(ResearchManagerExtension, managerConfig)
  ctx.llm.registerAdapter(['researchhub-research-workflow-validation'], new ResearchWorkflowMockAdapter())
}

export default { name, inject, apply }
