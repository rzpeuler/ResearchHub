import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent'

const MAX_SUMMARY_LENGTH = 240
const MAX_TEXT_DELTA_LENGTH = 2_000
const MAX_IDENTIFIER_LENGTH = 120

export type ClientEvent =
  | ClientAgentEvent
  | ClientMessageEvent
  | ClientToolEvent
  | ClientQueueEvent
  | ClientSessionEvent
  | ClientThinkingEvent
  | ClientErrorEvent
  | (ClientEventBase & { readonly type: 'activity.updated'; readonly summary: 'Activity updated' })

export interface ClientEventBase {
  readonly eventId: string
  readonly conversationId: string
  readonly timestamp: string
  readonly operationId?: string
}

export interface ClientAgentEvent extends ClientEventBase {
  readonly type: 'agent.started' | 'agent.completed'
  readonly status?: 'completed' | 'failed' | 'aborted'
  readonly summary: string
}

export interface ClientMessageEvent extends ClientEventBase {
  readonly type: 'message.started' | 'message.delta' | 'message.completed'
  readonly role: 'user' | 'assistant'
  readonly summary?: string
}

export interface ClientToolEvent extends ClientEventBase {
  readonly type: 'tool.started' | 'tool.updated' | 'tool.completed'
  readonly toolCallId: string
  readonly name: string
  readonly status: 'started' | 'updated' | 'completed'
  readonly isError?: boolean
  readonly summary: string
}

export interface ClientQueueEvent extends ClientEventBase {
  readonly type: 'queue.updated'
  readonly steeringCount: number
  readonly followUpCount: number
}

export interface ClientSessionEvent extends ClientEventBase {
  readonly type: 'session.changed'
  readonly summary: 'Session changed'
}

export interface ClientThinkingEvent extends ClientEventBase {
  readonly type: 'thinking.status'
  readonly summary: 'Thinking…'
}

export interface ClientErrorEvent extends ClientEventBase {
  readonly type: 'error'
  readonly code: 'agent_error' | 'agent_aborted' | 'runtime_error'
  readonly summary: string
}

export type ClientEventListener = (event: ClientEvent) => void

const PRODUCT_TOOL_SUMMARIES: Readonly<Record<string, string>> = {
  researchhub_status: 'ResearchHub status',
  search_knowledge: 'Knowledge search',
  get_knowledge_object: 'Knowledge object lookup',
  ingest_document: 'Document ingestion',
  get_workflow_status: 'Workflow status',
  cancel_workflow: 'Workflow cancellation',
  list_review_cases: 'Review case list',
  get_review_case: 'Review case detail',
}

function now(): string { return new Date().toISOString() }

export function safeIdentifier(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value.length === 0) return fallback
  if (/(?:api[_-]?key|key|token|password|secret|bearer|authorization)/i.test(value)) return fallback
  const sanitized = value.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, MAX_IDENTIFIER_LENGTH)
  return sanitized || fallback
}

export function safeSummary(value: unknown, maxLength = MAX_SUMMARY_LENGTH, options: { readonly preserveWhitespace?: boolean } = {}): string {
  if (typeof value !== 'string') return '[redacted]'
  if (/(?:\bsk-[A-Za-z0-9][A-Za-z0-9._-]*|\bghp_[A-Za-z0-9_]+|\bAKIA[0-9A-Z]{16}\b|-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----|\bbearer\s+[^\s,;]+|\b(?:api[_-]?key|token|password|secret|authorization)\s*(?:[:=]|\bis\b)\s*[^\s,;]+)/i.test(value)
    || /\b(?:key|api[_-]?key|token|password|secret|authorization)\s*[:=]\s*[^\s,;]+/i.test(value)
    || /(^|[\s("'=:\[])(?:\/(?:[A-Za-z0-9._-]+)?)(?=$|[\s"'`,;)}\]])/i.test(value)
    || /(^|[\s("'=:\[])(?:[\\/](?:[A-Za-z0-9._-]+)?)(?=$|[\s"'`,;)}\]])/i.test(value)
    || /(^|[\s("'=:\[])(?:[A-Za-z0-9_.-]+[\\/])?(?:\.\.?[\\/])+(?:[^\s"'`,;)}\]]+)?/i.test(value)
    || /(^|[\s("'=:\[])[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+){1,}/i.test(value)
    || /(?:^|[\s;|])(?:rm|read|cat|type|del|erase|curl|wget|bash|sh|powershell|pwsh|chmod|cp|mv|mkdir|find|grep)\b(?:\s+|$)/i.test(value)) return '[redacted]'
  const sanitized = value
    .replace(/(?:[A-Za-z]:[\\/]|\\\\)[^\s"']+/g, '[path]')
    .replace(/(^|[\s("'=:\[])(?:\.\.?[\\/])+(?:[^\s"'`,;)}\]]+)?/g, '$1[path]')
    .replace(/(^|[\s("'=:\[])[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+){1,}/g, '$1[path]')
    .replace(/\/(?:[^\s/"'`,;)}\]]+\/)+[^\s/"'`,;)}\]]+/g, '[path]')
    .replace(/\b(?:command|cmd)\s*[:=]\s*[^\r\n]+/gi, '[redacted]')
    .replace(/\b(?:authorization\s*:\s*bearer|api[_-]?key|token|password|secret|authorization)\s*[:=]?\s*[^\s,;]+/gi, '[redacted]')
  return (options.preserveWhitespace ? sanitized : sanitized.replace(/\s+/g, ' ').trim()).slice(0, maxLength)
}

function messageRole(message: unknown): 'user' | 'assistant' | undefined {
  if (!message || typeof message !== 'object') return undefined
  const role = (message as { readonly role?: unknown }).role
  return role === 'user' || role === 'assistant' ? role : undefined
}

function assistantFailure(messages: readonly unknown[]): 'failed' | 'aborted' | undefined {
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue
    const stopReason = (message as { readonly stopReason?: unknown }).stopReason
    if (stopReason === 'aborted') return 'aborted'
    if (stopReason === 'error') return 'failed'
  }
  return undefined
}

/**
 * One-way, client-safe projection of the public Pi AgentSession event stream.
 * It intentionally never serializes or forwards the source event object.
 */
export class ClientEventAdapter {
  private readonly listeners = new Set<ClientEventListener>()
  private unsubscribeSession?: () => void
  private boundSession?: AgentSession
  private bindingGeneration = 0
  private sequence = 0
  private activeOperationId?: string
  private currentRunOperationId?: string
  private abortRequested = false
  private readonly operationForUserMessage = new WeakMap<object, string>()
  private readonly pendingUserOperations: Array<{ readonly operationId: string }> = []

  constructor(private readonly onUserMessagePersisted?: (conversationId: string, operationId: string, piMessageId: string) => void) {}

  markAbortRequested(): void { this.abortRequested = true }

  setActiveOperationId(operationId?: string): void {
    this.activeOperationId = operationId === undefined ? undefined : safeIdentifier(operationId, '') || undefined
  }

  queueUserOperation(operationId: string): () => void {
    const pending = { operationId: safeIdentifier(operationId, '') }
    if (pending.operationId === '') return () => undefined
    this.pendingUserOperations.push(pending)
    return () => {
      const index = this.pendingUserOperations.indexOf(pending)
      if (index >= 0) this.pendingUserOperations.splice(index, 1)
    }
  }

  notifyActivity(conversationId: string, operationId: string): void {
    this.emit({ eventId: `${conversationId}:${++this.sequence}`, conversationId, operationId, timestamp: now(), type: 'activity.updated', summary: 'Activity updated' })
  }

  subscribe(listener: ClientEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  bind(session: AgentSession): void {
    this.bindSession(session, false)
  }

  rebind(session: AgentSession): void {
    this.bindSession(session, true)
  }

  unbind(): void {
    this.bindingGeneration += 1
    this.unsubscribeSession?.()
    this.unsubscribeSession = undefined
    this.boundSession = undefined
  }

  dispose(): void {
    this.unbind()
    this.listeners.clear()
  }

  get listenerCount(): number { return this.listeners.size }

  private bindSession(session: AgentSession, emitChanged: boolean): void {
    this.unbind()
    this.activeOperationId = undefined
    this.currentRunOperationId = undefined
    this.abortRequested = false
    this.pendingUserOperations.length = 0
    const generation = this.bindingGeneration
    this.boundSession = session
    this.unsubscribeSession = session.subscribe((event) => {
      if (generation !== this.bindingGeneration || this.boundSession !== session) return
      this.handle(event)
    })
    if (emitChanged) {
      const conversationId = safeIdentifier(session.sessionId, 'conversation')
      this.emit({ eventId: `${conversationId}:${++this.sequence}`, conversationId, timestamp: now(), type: 'session.changed', summary: 'Session changed' })
    }
  }

  private handle(event: AgentSessionEvent): void {
    const conversationId = safeIdentifier(this.boundSession?.sessionId, 'conversation')
    const baseOperationId = this.activeOperationId ?? this.currentRunOperationId
    const base = { eventId: `${conversationId}:${++this.sequence}`, conversationId, timestamp: now(), ...(baseOperationId === undefined ? {} : { operationId: baseOperationId }) }

    if (!event || typeof event !== 'object' || typeof (event as { readonly type?: unknown }).type !== 'string') return

    switch (event.type) {
      case 'agent_start':
        this.abortRequested = false
        this.emit({ ...base, type: 'agent.started', summary: 'Agent started' })
        return
      case 'agent_end': {
        // Pi emits an intermediate agent_end before an automatic retry. It is
        // not a terminal outcome and must not be projected as completed/error.
        if (event.willRetry === true) return
        if (!Array.isArray(event.messages)) {
          this.emit({ ...base, type: 'error', code: 'runtime_error', summary: 'Malformed agent event' })
          return
        }
        const failure = this.abortRequested ? 'aborted' : assistantFailure(event.messages)
        this.emit({ ...base, type: 'agent.completed', ...(failure ? { status: failure } : { status: 'completed' }), summary: failure ? `Agent ${failure}` : 'Agent completed' })
        if (failure) this.emit({ ...base, eventId: `${conversationId}:${++this.sequence}`, type: 'error', code: failure === 'aborted' ? 'agent_aborted' : 'agent_error', summary: failure === 'aborted' ? 'Agent request aborted' : 'Agent request failed' })
        this.currentRunOperationId = undefined
    this.abortRequested = false
        return
      }
      case 'message_start': {
        const role = messageRole(event.message)
        if (role) {
          const operation = role === 'user' ? this.pendingUserOperations.shift()?.operationId ?? this.activeOperationId ?? this.currentRunOperationId : this.currentRunOperationId ?? this.activeOperationId
          if (role === 'user' && operation !== undefined) {
            this.currentRunOperationId = operation
            this.operationForUserMessage.set(event.message as object, operation)
          }
          this.emit({ ...base, ...(operation === undefined ? {} : { operationId: operation }), type: 'message.started', role })
        }
        return
      }
      case 'message_update': {
        if (!event.assistantMessageEvent || typeof event.assistantMessageEvent !== 'object') {
          this.emit({ ...base, type: 'error', code: 'runtime_error', summary: 'Malformed message event' })
          return
        }
        const updateType = (event.assistantMessageEvent as { readonly type?: unknown }).type
        if (updateType === 'thinking_start' || updateType === 'thinking_delta' || updateType === 'thinking_end') {
          this.emit({ ...base, type: 'thinking.status', summary: 'Thinking…' })
          return
        }
        if (updateType === 'text_delta' && typeof (event.assistantMessageEvent as { readonly delta?: unknown }).delta === 'string') {
          const summary = safeSummary((event.assistantMessageEvent as { readonly delta: string }).delta, MAX_TEXT_DELTA_LENGTH, { preserveWhitespace: true })
          if (summary) this.emit({ ...base, type: 'message.delta', role: 'assistant', summary })
        }
        return
      }
      case 'message_end': {
        const role = messageRole(event.message)
        if (!role) return
        if (role === 'user') this.persistUserMessageIdentity(event.message as object)
        this.emit({ ...base, type: 'message.completed', role })
        const stopReason = (event.message as { readonly stopReason?: unknown }).stopReason
        if (role === 'assistant' && (stopReason === 'error' || stopReason === 'aborted')) {
          const aborted = this.abortRequested || stopReason === 'aborted'
          this.emit({ ...base, eventId: `${conversationId}:${++this.sequence}`, type: 'error', code: aborted ? 'agent_aborted' : 'agent_error', summary: aborted ? 'Agent request aborted' : 'Agent request failed' })
        }
        return
      }
      case 'tool_execution_start':
        this.emitTool(base, event.toolCallId, event.toolName, 'started', undefined)
        return
      case 'tool_execution_update':
        this.emitTool(base, event.toolCallId, event.toolName, 'updated', undefined)
        return
      case 'tool_execution_end':
        this.emitTool(base, event.toolCallId, event.toolName, 'completed', event.isError === true)
        return
      case 'queue_update':
        if (!Array.isArray(event.steering) || !Array.isArray(event.followUp)) {
          this.emit({ ...base, type: 'error', code: 'runtime_error', summary: 'Malformed queue event' })
          return
        }
        this.emit({ ...base, type: 'queue.updated', steeringCount: event.steering.length, followUpCount: event.followUp.length })
        return
      case 'session_info_changed':
        this.emit({ ...base, type: 'session.changed', summary: 'Session changed' })
        return
      case 'thinking_level_changed':
        this.emit({ ...base, type: 'thinking.status', summary: 'Thinking…' })
        return
      case 'auto_retry_end':
        if (!event.success) this.emit({ ...base, type: 'error', code: 'runtime_error', summary: 'Agent retry failed' })
        return
      case 'entry_appended': {
        const entry = event.entry
        if (!entry || entry.type !== 'message' || entry.message.role !== 'user') return
        const operationId = this.operationForUserMessage.get(entry.message as object)
        if (operationId !== undefined && isSafePiMessageId(entry.id)) this.onUserMessagePersisted?.(conversationId, operationId, entry.id)
        return
      }
      default:
        return
    }
  }

  private emitTool(base: ClientEventBase, toolCallId: unknown, toolName: unknown, status: ClientToolEvent['status'], isError: boolean | undefined): void {
    const name = safeIdentifier(toolName, 'tool')
    const productSummary = PRODUCT_TOOL_SUMMARIES[name]
    const summary = productSummary === undefined ? 'Tool execution' : `${productSummary} ${status}`
    this.emit({ ...base, type: `tool.${status}`, toolCallId: safeIdentifier(toolCallId, 'tool-call'), name, status, ...(isError === undefined ? {} : { isError }), summary })
  }

  private persistUserMessageIdentity(message: object): void {
    const operationId = this.operationForUserMessage.get(message)
    const session = this.boundSession
    if (operationId === undefined || session === undefined) return
    const conversationId = safeIdentifier(session.sessionId, 'conversation')
    // Pi emits message_end before its public listener returns to appendMessage().
    // Defer one microtask, then bind only through the exact public message object.
    queueMicrotask(() => {
      const entries = session.sessionManager.getEntries().filter((entry) => entry.type === 'message' && entry.message === message)
      if (entries.length === 1 && isSafePiMessageId(entries[0]!.id)) this.onUserMessagePersisted?.(conversationId, operationId, entries[0]!.id)
    })
  }

  private emit(event: ClientEvent): void {
    for (const listener of [...this.listeners]) {
      try { listener(event) } catch { /* client observers must not affect Pi event delivery */ }
    }
  }
}

function isSafePiMessageId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)
}
