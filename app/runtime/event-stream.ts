import { safeIdentifier, safeSummary, type ClientEvent, type ClientEventBase } from './client-events.ts'

export type ClientEventStreamSubscriber = (frame: string, event: ClientEvent) => void

const MAX_SUBSCRIBERS = 64
const MAX_FRAME_LENGTH = 16_384

function safeBase(event: unknown): ClientEventBase {
  const candidate = event !== null && typeof event === 'object' ? event as Record<string, unknown> : {}
  const timestamp = typeof candidate.timestamp === 'string' && /^\d{4}-\d{2}-\d{2}T[^\s]+Z$/.test(candidate.timestamp) ? candidate.timestamp.slice(0, 40) : new Date(0).toISOString()
  const operationId = typeof candidate.operationId === 'string' ? safeIdentifier(candidate.operationId, '') : ''
  return {
    eventId: safeIdentifier(candidate.eventId, 'event'),
    conversationId: safeIdentifier(candidate.conversationId, 'conversation'),
    timestamp,
    ...(operationId === '' ? {} : { operationId }),
  }
}

function normalizeClientEvent(event: unknown): ClientEvent {
  const candidate = event !== null && typeof event === 'object' ? event as Record<string, unknown> : {}
  const base = safeBase(event)
  switch (candidate.type) {
    case 'agent.started':
    case 'agent.completed': {
      const status = candidate.status === 'completed' || candidate.status === 'failed' || candidate.status === 'aborted' ? candidate.status : undefined
      return { ...base, type: candidate.type, ...(status === undefined ? {} : { status }), summary: safeSummary(candidate.summary) }
    }
    case 'message.started':
    case 'message.completed':
    case 'message.delta': {
      const role = candidate.role === 'user' || candidate.role === 'assistant' ? candidate.role : 'assistant'
      const summary = candidate.summary === undefined ? undefined : safeSummary(candidate.summary, candidate.type === 'message.delta' ? 2_000 : undefined, candidate.type === 'message.delta' ? { preserveWhitespace: true } : undefined)
      return { ...base, type: candidate.type, role, ...(summary === undefined ? {} : { summary }) }
    }
    case 'tool.started':
    case 'tool.updated':
    case 'tool.completed': {
      const status = candidate.status === 'started' || candidate.status === 'updated' || candidate.status === 'completed' ? candidate.status : 'updated'
      const isError = typeof candidate.isError === 'boolean' ? candidate.isError : undefined
      return { ...base, type: candidate.type, toolCallId: safeIdentifier(candidate.toolCallId, 'tool-call'), name: safeIdentifier(candidate.name, 'tool'), status, ...(isError === undefined ? {} : { isError }), summary: safeSummary(candidate.summary) }
    }
    case 'queue.updated':
      return { ...base, type: 'queue.updated', steeringCount: boundedCount(candidate.steeringCount), followUpCount: boundedCount(candidate.followUpCount) }
    case 'session.changed':
      return { ...base, type: 'session.changed', summary: 'Session changed' }
    case 'thinking.status':
      return { ...base, type: 'thinking.status', summary: 'Thinking…' }
    case 'error': {
      const code = candidate.code === 'agent_error' || candidate.code === 'agent_aborted' || candidate.code === 'runtime_error' ? candidate.code : 'runtime_error'
      return { ...base, type: 'error', code, summary: safeSummary(candidate.summary) }
    }
    default:
      return { ...base, type: 'error', code: 'runtime_error', summary: 'Runtime event rejected' }
  }
}

function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000) : 0
}

export function serializeClientEvent(event: unknown): string {
  const normalized = normalizeClientEvent(event)
  return serializeNormalizedClientEvent(normalized)
}

function serializeNormalizedClientEvent(normalized: ClientEvent): string {
  const eventName = normalized.type
  const eventId = normalized.eventId
  const data = JSON.stringify(normalized)
  const frame = `id: ${eventId}\nevent: ${eventName}\ndata: ${data}\n\n`
  if (frame.length > MAX_FRAME_LENGTH) throw new Error('Client event exceeds the SSE frame limit')
  return frame
}

/** Small normalized-event broadcaster intended for a future HTTP SSE adapter. */
export class ClientEventStream {
  private readonly subscribers = new Set<ClientEventStreamSubscriber>()
  private readonly maxSubscribers: number

  constructor(maxSubscribers = MAX_SUBSCRIBERS) {
    if (!Number.isInteger(maxSubscribers) || maxSubscribers < 1 || maxSubscribers > MAX_SUBSCRIBERS) throw new RangeError('maxSubscribers is outside the supported bound')
    this.maxSubscribers = maxSubscribers
  }

  subscribe(subscriber: ClientEventStreamSubscriber): () => void {
    if (this.subscribers.size >= this.maxSubscribers) throw new Error('Client event subscriber limit reached')
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  publish(event: unknown): void {
    const normalized = normalizeClientEvent(event)
    const frame = serializeNormalizedClientEvent(normalized)
    for (const subscriber of [...this.subscribers]) {
      try {
        subscriber(frame, normalized)
      } catch {
        // A broken client connection must not interrupt delivery to other clients.
        this.subscribers.delete(subscriber)
      }
    }
  }

  clear(): void { this.subscribers.clear() }

  get subscriberCount(): number { return this.subscribers.size }
}
