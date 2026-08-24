import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { EquityResearchSkillAdapters } from '../../packages/workflows/equity-research/types.ts'

export interface HarnessLlmRuntime {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

export interface LlmSkillRuntimeOptions {
  llm: HarnessLlmRuntime
  provider: string
  model: string
  skillRoot?: string
  maxTokens?: number
  temperature?: number
}

export interface LlmSkillEvidence {
  id: string
  source: string
  asOf: string
  claim: string
  details: Record<string, unknown>
  confidence: number
}

export interface LlmSkillResponse {
  skillId: string
  subject: string
  asOf: string
  summary: string
  findings: string[]
  keyRisks: string[]
  openQuestions: string[]
  evidence: LlmSkillEvidence[]
  data?: Record<string, unknown>
}

export interface LlmProviderAdapterOptions {
  apiKey: string
  baseUrl?: string
  requestTimeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface LlmProviderAdapterStats {
  requests: number
  lastRequest?: GenerateOptions
}

export type LlmSkillAdapters = EquityResearchSkillAdapters

export type ResolvedModel = LlmResolvedModelInfo
