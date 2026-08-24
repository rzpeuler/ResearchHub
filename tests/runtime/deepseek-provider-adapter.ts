import { attributionHeaders, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { LlmProviderAdapterOptions } from '../../dsh/llm-runtime/types.ts'

const provider = 'researchhub-deepseek-runtime'

export class DeepSeekProviderAdapter extends LlmAdapter {
  readonly stats = { requests: 0, lastRequest: undefined as GenerateOptions | undefined }
  readonly requestHistory: GenerateOptions[] = []
  private readonly baseUrl: string
  private readonly requestTimeoutMs: number
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: LlmProviderAdapterOptions) {
    super()
    this.baseUrl = (options.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '')
    this.requestTimeoutMs = options.requestTimeoutMs ?? 90_000
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  override providerInfo(route: string) {
    if (route !== provider) throw new Error(`unknown runtime provider: ${route}`)
    return { id: route, name: 'DeepSeek Runtime Validation Provider' }
  }

  override listModels(route: string) {
    return Promise.resolve(route === provider
      ? [{ provider: route, id: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat', name: 'DeepSeek Chat', inputModalities: ['text'] as const }]
      : [])
  }

  override resolveModel(route: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider: route, id: model, name: model, inputModalities: ['text'] as const })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.stats.requests += 1
    this.stats.lastRequest = options
    this.requestHistory.push(options)
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...attributionHeaders(),
        authorization: `Bearer ${this.options.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          ...(options.system === undefined ? [] : [{ role: 'system', content: options.system }]),
          ...options.messages.map((message) => ({ role: message.role, content: message.content.map((block) => block.type === 'text' ? block.text : JSON.stringify(block)).join('') })),
        ],
        temperature: options.temperature ?? 0,
        max_tokens: options.maxTokens ?? 4096,
        response_format: { type: 'json_object' },
      }),
      signal: timeoutSignal(options.signal, this.requestTimeoutMs),
    })
    const payload = await parsePayload(response)
    const content = extractContent(payload)
    const usage = extractUsage(payload)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: content }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: content } }
    if (usage !== undefined) yield { type: 'usage', usage }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export { provider as DEEPSEEK_RUNTIME_PROVIDER }

async function parsePayload(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`DeepSeek runtime request failed with HTTP ${response.status}`)
  try {
    return await response.json() as unknown
  } catch (error) {
    throw new Error('DeepSeek runtime returned a non-JSON response', { cause: error })
  }
}

function extractContent(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) throw new Error('DeepSeek runtime response has no choices')
  const message = value.choices[0].message
  if (!isRecord(message) || typeof message.content !== 'string' || message.content.trim().length === 0) throw new Error('DeepSeek runtime response has no text content')
  return message.content
}

function extractUsage(value: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (!isRecord(value) || !isRecord(value.usage) || typeof value.usage.prompt_tokens !== 'number' || typeof value.usage.completion_tokens !== 'number') return undefined
  return { inputTokens: value.usage.prompt_tokens, outputTokens: value.usage.completion_tokens }
}

function timeoutSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return parent === undefined ? timeout : AbortSignal.any([parent, timeout])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
