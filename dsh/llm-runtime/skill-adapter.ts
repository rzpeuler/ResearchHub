import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { LlmSkillAdapterError } from './errors.ts'
import type { LlmSkillResponse, LlmSkillRuntimeOptions } from './types.ts'

const DEFAULT_SKILL_ROOT = resolve(process.cwd(), 'packages/skills')

export class LlmSkillAdapter {
  private readonly promptCache = new Map<string, string>()

  constructor(private readonly options: LlmSkillRuntimeOptions) {}

  async execute<TInput, TOutput>(
    skillId: string,
    input: TInput,
    context: unknown,
    map: (response: LlmSkillResponse, input: TInput) => TOutput,
  ): Promise<TOutput> {
    const response = await this.request(skillId, input, context)
    return map(response, input)
  }

  async request(skillId: string, input: unknown, context: unknown): Promise<LlmSkillResponse> {
    const prompt = await this.loadPrompt(skillId)
    const requestText = [
      `Skill ID: ${skillId}`,
      'You are executing one runtime-neutral ResearchHub Skill.',
      'Use only the supplied request and prior Workflow context. Do not invent Plugin data.',
      'Return one JSON object only, with no Markdown fences and no commentary.',
      'Required JSON shape:',
      '{"skillId":string,"subject":string,"asOf":ISO-8601 string,"summary":string,"findings":string[],"keyRisks":string[],"openQuestions":string[],"evidence":[{"id":string,"source":string,"asOf":ISO-8601 string,"claim":string,"details":object,"confidence":number}],"data":object}',
      'The data object must contain any Skill-specific fields required by the output contract.',
      skillOutputInstruction(skillId),
      `Skill methodology:\n${prompt}`,
      `Input:\n${stringifyForPrompt(input)}`,
      `Prior Workflow context:\n${stringifyForPrompt(context)}`,
    ].join('\n\n')

    const options: GenerateOptions = {
      provider: this.options.provider,
      model: this.options.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: requestText }], source: { kind: 'user' } })],
      temperature: this.options.temperature ?? 0,
      maxTokens: this.options.maxTokens ?? 4096,
    }

    let text = ''
    let finished = false
    for await (const chunk of this.options.llm.stream(options)) {
      if (chunk.type === 'text-delta') text += chunk.text
      if (chunk.type === 'finish') {
        finished = true
        if (chunk.reason.kind !== 'stop') throw new LlmSkillAdapterError(`LLM Skill ${skillId} did not finish normally: ${chunk.reason.kind}`)
      }
    }
    if (!finished) throw new LlmSkillAdapterError(`LLM Skill ${skillId} returned no finish signal`)
    if (text.trim().length === 0) throw new LlmSkillAdapterError(`LLM Skill ${skillId} returned empty output`)
    return validateResponse(skillId, parseJson(text))
  }

  private async loadPrompt(skillId: string): Promise<string> {
    const cached = this.promptCache.get(skillId)
    if (cached !== undefined) return cached
    const root = this.options.skillRoot ?? DEFAULT_SKILL_ROOT
    const promptPath = join(root, skillId, 'prompts', 'analysis.md')
    const fallbackPath = join(root, skillId, 'SKILL.md')
    let prompt: string
    try {
      prompt = await readFile(promptPath, 'utf8')
    } catch (error) {
      if (!isFileNotFound(error)) throw new LlmSkillAdapterError(`failed to load prompt for Skill ${skillId}`, { cause: error })
      try {
        prompt = await readFile(fallbackPath, 'utf8')
      } catch (fallbackError) {
        throw new LlmSkillAdapterError(`no prompt definition found for Skill ${skillId}`, { cause: fallbackError })
      }
    }
    if (prompt.trim().length === 0) throw new LlmSkillAdapterError(`prompt definition for Skill ${skillId} is empty`)
    this.promptCache.set(skillId, prompt)
    return prompt
  }
}

export function stringifyForPrompt(value: unknown): string {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? 'null' : serialized
}

function parseJson(text: string): unknown {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(normalized) as unknown
  } catch (error) {
    const object = extractFirstJsonObject(normalized)
    if (object !== undefined) return object
    throw new LlmSkillAdapterError('LLM Skill returned invalid JSON', { cause: error })
  }
}

function extractFirstJsonObject(value: string): unknown {
  const start = value.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(value.slice(start, index + 1)) as unknown
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

function validateResponse(skillId: string, value: unknown): LlmSkillResponse {
  if (!isRecord(value)) throw new LlmSkillAdapterError(`LLM Skill ${skillId} response must be an object`)
  if (value.skillId !== skillId) throw new LlmSkillAdapterError(`LLM Skill response id mismatch: expected ${skillId}`)
  assertString(value.subject, `${skillId}.subject`)
  assertTimestamp(value.asOf, `${skillId}.asOf`)
  assertString(value.summary, `${skillId}.summary`)
  assertStringArray(value.findings, `${skillId}.findings`)
  assertStringArray(value.keyRisks, `${skillId}.keyRisks`)
  assertStringArray(value.openQuestions, `${skillId}.openQuestions`)
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) throw new LlmSkillAdapterError(`${skillId}.evidence must contain at least one item`)
  const evidence = value.evidence.map((item, index) => validateEvidence(item, `${skillId}.evidence[${index}]`))
  const data = value.data === undefined ? undefined : validateRecord(value.data, `${skillId}.data`)
  return {
    skillId,
    subject: value.subject,
    asOf: value.asOf,
    summary: value.summary,
    findings: value.findings,
    keyRisks: value.keyRisks,
    openQuestions: value.openQuestions,
    evidence,
    data,
  }
}

function validateEvidence(value: unknown, path: string) {
  if (!isRecord(value)) throw new LlmSkillAdapterError(`${path} must be an object`)
  assertString(value.id, `${path}.id`)
  assertString(value.source, `${path}.source`)
  assertTimestamp(value.asOf, `${path}.asOf`)
  assertString(value.claim, `${path}.claim`)
  const details = validateRecord(value.details, `${path}.details`)
  if (typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) {
    throw new LlmSkillAdapterError(`${path}.confidence must be a finite number from 0 to 1`)
  }
  return { id: value.id, source: value.source, asOf: value.asOf, claim: value.claim, details, confidence: value.confidence }
}

function validateRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new LlmSkillAdapterError(`${path} must be an object`)
  return value
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new LlmSkillAdapterError(`${path} must be a non-empty string`)
}

function assertStringArray(value: unknown, path: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) throw new LlmSkillAdapterError(`${path} must be a string array`)
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  assertString(value, path)
  if (Number.isNaN(Date.parse(value))) throw new LlmSkillAdapterError(`${path} must be an ISO timestamp`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function skillOutputInstruction(skillId: string): string {
  switch (skillId) {
    case 'industry-research':
      return 'For industry-research, data.peerMetrics must be an array of objects with name, source, and asOf; optional numeric fields are revenueGrowth, ebitdaMargin, marketShare, and valuationMultiple.'
    case 'equity-research':
      return 'For equity-research, data may be an empty object; the top-level findings, risks, open questions, and evidence are the required research output.'
    case 'earnings-review':
      return 'For earnings-review, data must include guidance as one of raised, maintained, lowered, or not-provided; thesisImpact as one of positive, negative, neutral, or undetermined; and variances as an array.'
    case 'valuation':
      return 'For valuation, data must include peers, statistics, and dcf. dcf must include enterpriseValue, equityValue, impliedSharePrice, presentValueOfForecasts, presentValueOfTerminalValue, terminalValueShare, and sensitivity.'
    case 'company-research':
      return 'For company-research, data may be an empty object because the runtime maps the validated response into the existing Evidence, Thesis, and Prediction Artifacts.'
    default:
      return 'Keep data as an object.'
  }
}
