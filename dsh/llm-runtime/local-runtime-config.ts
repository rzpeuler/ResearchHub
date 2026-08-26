import { isAbsolute, resolve } from 'node:path'

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_LLM_PROVIDER = 'deepseek-official'
export const DEFAULT_LLM_MODEL = 'deepseek-v4-pro'
export const DEFAULT_CURATION_MAX_TOKENS = 16_384
export const DEFAULT_DATA_ROOT = '../ResearchHubData'
export const DEFAULT_REPORTS_DIR = '../ResearchHubData/input/ai-hardware-reports'
export const DEFAULT_KNOWLEDGE_BASE_ID = 'ai-hardware-real'

export interface LocalKnowledgeProductValidationConfig {
  readonly realLlmEnabled: boolean
  readonly apiKey?: string
  readonly baseUrl: string
  readonly provider: string
  readonly model: string
  readonly curationMaxTokens: number
  readonly dataRoot: string
  readonly reportsDir: string
  readonly knowledgeBaseId: string
}

export class LocalRuntimeConfigError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LocalRuntimeConfigError'
    this.code = code
  }
}

export function loadLocalRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  options: { requireRealLlm?: boolean } = {},
): LocalKnowledgeProductValidationConfig {
  const realLlmEnabled = parseBoolean(environment.RESEARCHHUB_REAL_LLM_ENABLED, false, 'RESEARCHHUB_REAL_LLM_ENABLED')
  const apiKey = clean(environment.DEEPSEEK_API_KEY)
  const baseUrl = clean(environment.DEEPSEEK_BASE_URL) ?? DEFAULT_DEEPSEEK_BASE_URL
  const provider = clean(environment.RESEARCHHUB_LLM_PROVIDER) ?? DEFAULT_LLM_PROVIDER
  const model = clean(environment.RESEARCHHUB_LLM_MODEL) ?? DEFAULT_LLM_MODEL
  const curationMaxTokens = parsePositiveInteger(environment.RESEARCHHUB_CURATION_MAX_TOKENS, DEFAULT_CURATION_MAX_TOKENS, 'RESEARCHHUB_CURATION_MAX_TOKENS')
  const dataRoot = resolveFromCwd(environment.RESEARCHHUB_DATA_ROOT ?? DEFAULT_DATA_ROOT, cwd, 'RESEARCHHUB_DATA_ROOT')
  const reportsDir = resolveFromCwd(environment.RESEARCHHUB_REPORTS_DIR ?? DEFAULT_REPORTS_DIR, cwd, 'RESEARCHHUB_REPORTS_DIR')
  const knowledgeBaseId = clean(environment.RESEARCHHUB_KB_ID) ?? DEFAULT_KNOWLEDGE_BASE_ID
  if (!provider) throw new LocalRuntimeConfigError('invalid_provider', 'RESEARCHHUB_LLM_PROVIDER must be non-empty')
  if (!model) throw new LocalRuntimeConfigError('invalid_model', 'RESEARCHHUB_LLM_MODEL must be non-empty')
  if (!knowledgeBaseId || knowledgeBaseId.includes('/') || knowledgeBaseId.includes('\\')) throw new LocalRuntimeConfigError('invalid_knowledge_base_id', 'RESEARCHHUB_KB_ID must be a path-safe non-empty ID')
  if (options.requireRealLlm && !realLlmEnabled) throw new LocalRuntimeConfigError('real_llm_disabled', 'RESEARCHHUB_REAL_LLM_ENABLED must be true for real LLM execution')
  if ((options.requireRealLlm || realLlmEnabled) && !apiKey) throw new LocalRuntimeConfigError('missing_deepseek_api_key', 'DEEPSEEK_API_KEY is required when real LLM execution is enabled')
  if ((options.requireRealLlm || realLlmEnabled) && provider !== 'deepseek-official') throw new LocalRuntimeConfigError('unsupported_llm_provider', 'Real validation requires the official deepseek-official provider')
  return { realLlmEnabled, apiKey, baseUrl, provider, model, curationMaxTokens, dataRoot, reportsDir, knowledgeBaseId }
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function parseBoolean(value: string | undefined, fallback: boolean, field: string): boolean {
  const normalized = clean(value)?.toLowerCase()
  if (normalized === undefined) return fallback
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new LocalRuntimeConfigError('invalid_boolean', `${field} must be true or false`)
}

function parsePositiveInteger(value: string | undefined, fallback: number, field: string): number {
  const normalized = clean(value)
  if (normalized === undefined) return fallback
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new LocalRuntimeConfigError('invalid_positive_integer', `${field} must be a positive integer`)
  return parsed
}

function resolveFromCwd(value: string, cwd: string, field: string): string {
  if (!value.trim()) throw new LocalRuntimeConfigError('invalid_path', `${field} must be non-empty`)
  const result = isAbsolute(value) ? resolve(value) : resolve(cwd, value)
  return result
}
