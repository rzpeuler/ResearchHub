import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { ResearchDispatchStart } from '../services/research-dispatch-service.ts'

export const CONVERSATION_STATE_SCHEMA_VERSION = 3 as const
export const DEFAULT_CONVERSATION_TITLE = '新对话'

const MAX_TITLE_CODE_POINTS = 200
const FIRST_MESSAGE_TITLE_CODE_POINTS = 24
const MAX_REQUEST_TEXT_LENGTH = 50_000
const MAX_ACCEPTED_REQUESTS = 1_000
const MAX_STATE_BYTES = 64 * 1024 * 1024
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u
const WORKFLOW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u
const FAILURE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,79}$/u
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const SECRET_PATTERNS = [
  /\b(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|password|passwd)\s*[:=]\s*\S+/iu,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/iu,
  /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/u,
  /\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._~!$&'()*+,;=-]{12,}@[A-Za-z0-9.-]+\b/u,
]
const PII_TITLE_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?<!\d)(?:\+?86[ -]?)?1[3-9](?:[ -]?\d){9}(?!\d)/u,
  /(?<!\d)(?:\d[ -]?){9,17}[\dXx](?!\d)/u,
]

export type ConversationTitleSource = 'DEFAULT' | 'FIRST_MESSAGE' | 'WORKFLOW' | 'USER'
export type ConversationRequestKind = 'chat' | 'workflow'
export type AcceptedRequestLifecycle = 'accepted' | 'submitting' | 'needs_clarification' | 'ready_for_chat' | 'started' | 'completed' | 'cancelled' | 'not_started' | 'failed' | 'interrupted'
export interface LinkedConversationWorkflow { readonly runId: string; readonly workflowRegistryId: string; readonly toolCallId?: string; readonly subject?: string }
export interface ConversationToolActivity { readonly toolCallId: string; readonly name: string; readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'; readonly summary?: string; readonly startedAt: string; readonly completedAt?: string }
export type ConversationSubmissionOutcome =
  | { readonly kind: 'chat'; readonly outcome: 'started' }
  | { readonly kind: 'chat'; readonly outcome: 'completed' | 'cancelled' | 'failed'; readonly failureCode?: string }
  | { readonly kind: 'chat' | 'workflow'; readonly outcome: 'not_started'; readonly reasonCode: string }

export interface AcceptedConversationRequest {
  readonly kind: ConversationRequestKind
  readonly operation: 'prompt' | 'steer' | 'follow_up'
  readonly operationId: string
  readonly requestDigest: string
  readonly requestText: string
  readonly acceptedAt: string
  /** Caller-supplied dispatch target, immutable even when automatic routing resolves later. */
  readonly acceptedWorkflowRegistryId?: string
  readonly workflowRegistryId?: string
  readonly workflowRunId?: string
  readonly researchBundleRunId?: string
  readonly reservedWorkflowRunId?: string
  readonly workflowSubject?: string
  readonly workflowTitleCandidate?: string
  readonly lifecycle: AcceptedRequestLifecycle
  readonly dispatchAttemptedAt?: string
  readonly startedAt?: string
  readonly failureCode?: string
  readonly outcome?: 'chat_started' | 'chat_completed' | 'chat_cancelled' | 'workflow_started' | 'workflow_completed' | 'workflow_blocked' | 'workflow_failed' | 'workflow_cancelled' | 'not_started'
  readonly outcomeReasonCode?: string
  readonly dispatchStatus?: 'started' | 'needs_input' | 'invalid_input' | 'unresolved_reference' | 'executor_unavailable' | 'free_research' | 'skill_plan'
  readonly finishedAt?: string
  readonly piMessageId?: string
  readonly linkedWorkflows?: readonly LinkedConversationWorkflow[]
  readonly toolActivities?: readonly ConversationToolActivity[]
  /** Internal normalized dispatch envelope. Source excerpts and raw tool results are never stored here. */
  readonly dispatchEnvelope?: Omit<ResearchDispatchStart, 'completion' | 'sourceLibraryHits'>
  readonly confirmedClarificationId?: string
}

export interface ConversationStateFlags {
  readonly firstMessageTitleConsumed: boolean
  readonly firstWorkflowNamingOpportunityConsumed: boolean
}

export interface ConversationState {
  readonly schemaVersion: typeof CONVERSATION_STATE_SCHEMA_VERSION
  readonly conversationId: string
  readonly piTranscriptObserved: boolean
  readonly title: string
  readonly titleSource: ConversationTitleSource
  readonly flags: ConversationStateFlags
  readonly archived: boolean
  readonly archivedAt?: string
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly acceptedRequests: readonly AcceptedConversationRequest[]
}

export interface AcceptConversationRequestInput {
  readonly kind?: ConversationRequestKind
  readonly operation?: 'prompt' | 'steer' | 'follow_up'
  readonly operationId: string
  readonly requestText: string
  readonly workflowRegistryId?: string
}

export interface AcceptConversationRequestResult {
  readonly state: ConversationState
  readonly request: AcceptedConversationRequest
  readonly duplicate: boolean
}

export interface BeginConversationDispatchResult {
  readonly state: ConversationState
  /** Only the successful accepted -> submitting transition may start the request. */
  readonly mayDispatch: boolean
}

export interface ConversationStateStoreOptions {
  /** Injected Runtime-owned `runtime-data/conversation-state` directory. */
  readonly rootDir: string
  /** Injectable UTC clock for deterministic behavior and tests. */
  readonly now?: () => string
}

export type ConversationStateErrorCode = 'invalid_input' | 'not_found' | 'conflict' | 'corrupt' | 'unsupported_version' | 'io' | 'capacity'

export class ConversationStateStoreError extends Error {
  constructor(readonly code: ConversationStateErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ConversationStateStoreError'
  }
}

/** Pi IDs are case-sensitive; accept only safe filename characters, without rewriting them. */
export function normalizeConversationId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) throw invalid('conversationId is not a safe Pi session ID')
  return value
}

export function normalizeConversationTitle(value: unknown): string {
  if (typeof value !== 'string') throw invalid('conversation title must be text')
  const title = value.trim().replace(/\s+/gu, ' ')
  if (title.length === 0) throw invalid('conversation title cannot be empty')
  if (Array.from(title).length > MAX_TITLE_CODE_POINTS) throw invalid(`conversation title must be at most ${MAX_TITLE_CODE_POINTS} Unicode characters`)
  if (SECRET_PATTERNS.some((pattern) => pattern.test(title)) || PII_TITLE_PATTERNS.some((pattern) => pattern.test(title))) throw invalid('conversation title is not safe to persist')
  return title
}

/** First 24 Unicode code points, followed by an ellipsis when more text remains. */
export function firstMessageTitleFromText(value: unknown): string {
  if (typeof value !== 'string') throw invalid('first message text must be text')
  const text = value.trim().replace(/\s+/gu, ' ')
  if (text === '') return DEFAULT_CONVERSATION_TITLE
  if (PII_TITLE_PATTERNS.some((pattern) => pattern.test(text)) || SECRET_PATTERNS.some((pattern) => pattern.test(text))) return DEFAULT_CONVERSATION_TITLE
  const characters = Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment)
  return characters.length <= FIRST_MESSAGE_TITLE_CODE_POINTS ? text : `${characters.slice(0, FIRST_MESSAGE_TITLE_CODE_POINTS).join('')}…`
}

/** Digest the exact request text. Workflow intent is compared separately for idempotency. */
export function conversationRequestDigest(requestText: string): string {
  return createHash('sha256').update(requestText, 'utf8').digest('hex')
}

const perSessionTails = new Map<string, Promise<void>>()

/**
 * Application metadata store; Pi remains the only transcript authority. Files are
 * atomically replaced and each conversation is serialized within this Runtime
 * process. No transaction with Pi's JSONL file or cross-process lock is provided.
 */
export class ConversationStateStore {
  private readonly rootDir: string
  private readonly now: () => string
  private readonly activeConversationPath: string

  constructor(options: ConversationStateStoreOptions) {
    if (typeof options.rootDir !== 'string' || options.rootDir.trim() === '') throw invalid('rootDir is required')
    this.rootDir = resolve(options.rootDir)
    this.now = options.now ?? (() => new Date().toISOString())
    this.activeConversationPath = join(this.rootDir, 'active-conversation.pointer')
  }

  async getActiveConversationId(): Promise<string | undefined> {
    await this.ensureRoot()
    try {
      const info = await lstat(this.activeConversationPath)
      if (!info.isFile() || info.isSymbolicLink() || info.size > 512) throw corrupt('active conversation pointer is not a safe regular file')
      const value: unknown = JSON.parse(await readFile(this.activeConversationPath, 'utf8'))
      if (!plainObject(value) || value.schemaVersion !== 1 || Object.keys(value).length !== 2 || !Object.hasOwn(value, 'conversationId')) throw corrupt('active conversation pointer is invalid')
      try { return normalizeConversationId(value.conversationId) } catch (error) { throw corrupt('active conversation ID is invalid', error) }
    } catch (error) {
      if (isNotFound(error)) return undefined
      if (error instanceof ConversationStateStoreError) throw error
      throw io('active conversation pointer could not be read', error)
    }
  }

  async setActiveConversationId(conversationId: string): Promise<void> {
    const id = normalizeConversationId(conversationId)
    await this.ensureRoot()
    const temporary = join(this.rootDir, `.active-conversation.${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(`${JSON.stringify({ schemaVersion: 1, conversationId: id })}\n`, 'utf8')
      await handle.sync()
      await handle.close(); handle = undefined
      await chmod(temporary, 0o600)
      await rename(temporary, this.activeConversationPath)
      if (process.platform !== 'win32') {
        const directory = await open(this.rootDir, 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw io('active conversation pointer could not be saved', error)
    }
  }

  async ensure(conversationId: string, options: { readonly piTranscriptObserved?: boolean } = {}): Promise<ConversationState> {
    const id = normalizeConversationId(conversationId)
    return this.serialized(id, async () => {
      const current = await this.read(id)
      if (current !== undefined) {
        if (options.piTranscriptObserved === true && !current.piTranscriptObserved) {
          const observed = this.nextState(current, { piTranscriptObserved: true })
          await this.write(observed)
          return cloneState(observed)
        }
        return cloneState(current)
      }
      const state = initialState(id, this.timestamp(), options.piTranscriptObserved === true)
      await this.write(state)
      return cloneState(state)
    })
  }

  async get(conversationId: string): Promise<ConversationState | undefined> {
    const id = normalizeConversationId(conversationId)
    return this.serialized(id, async () => {
      const state = await this.read(id)
      return state === undefined ? undefined : cloneState(state)
    })
  }

  /** Fails closed on malformed filenames, corrupt records, or unsupported schemas. */
  async list(): Promise<readonly ConversationState[]> {
    await this.ensureRoot()
    const names = await readdir(this.rootDir)
    const ids = names.filter((name) => name.endsWith('.json')).map((name) => {
      const id = name.slice(0, -5)
      if (!SESSION_ID_PATTERN.test(id)) throw corrupt(`unexpected conversation state filename: ${name}`)
      return id
    }).sort((left, right) => left.localeCompare(right))
    const states: ConversationState[] = []
    for (const id of ids) {
      const state = await this.get(id)
      if (state === undefined) throw corrupt(`conversation state disappeared while listing: ${id}`)
      states.push(state)
    }
    return states
  }

  /** Serialized compare-and-swap-like update. The store owns revision and updatedAt. */
  async transact(conversationId: string, update: (current: ConversationState) => ConversationState, expectedRevision?: number): Promise<ConversationState> {
    const id = normalizeConversationId(conversationId)
    if (typeof update !== 'function') throw invalid('transaction callback is required')
    validateExpectedRevision(expectedRevision)
    return this.serialized(id, async () => {
      const current = await this.read(id)
      if (current === undefined) throw notFound(`Conversation state not found: ${id}`)
      assertRevision(current, expectedRevision)
      const changed = update(cloneState(current))
      return this.commitUpdate(current, changed)
    })
  }

  async setFirstMessageTitle(conversationId: string, firstMessageText: string, expectedRevision?: number): Promise<ConversationState> {
    const candidate = firstMessageTitleFromText(firstMessageText)
    return this.updateMetadata(conversationId, (current) => {
      if (current.flags.firstMessageTitleConsumed) return current
      return {
        ...current,
        ...(current.titleSource === 'DEFAULT' ? { title: candidate, titleSource: 'FIRST_MESSAGE' as const } : {}),
        flags: { ...current.flags, firstMessageTitleConsumed: true },
      }
    }, expectedRevision)
  }

  async renameConversation(conversationId: string, title: string, expectedRevision?: number): Promise<ConversationState> {
    const candidate = normalizeConversationTitle(title)
    return this.updateMetadata(conversationId, (current) => current.titleSource === 'USER' && current.title === candidate
      ? current
      : { ...current, title: candidate, titleSource: 'USER' }, expectedRevision, true)
  }

  async archiveConversation(conversationId: string, archived: boolean, expectedRevision?: number): Promise<ConversationState> {
    if (typeof archived !== 'boolean') throw invalid('archived must be a boolean')
    return this.updateMetadata(conversationId, (current) => {
      if (current.archived === archived) return current
      if (archived) return { ...current, archived: true, archivedAt: this.timestamp() }
      const { archivedAt: _archivedAt, ...state } = current
      return { ...state, archived: false }
    }, expectedRevision)
  }

  /** Saves the request and first-message title in one write, before any dispatch. */
  async acceptRequest(conversationId: string, input: AcceptConversationRequestInput): Promise<AcceptConversationRequestResult> {
    const id = normalizeConversationId(conversationId)
    const normalized = normalizeRequestInput(input)
    const digest = conversationRequestDigest(normalized.requestText)
    return this.serialized(id, async () => {
      const current = await this.read(id) ?? initialState(id, this.timestamp())
      const duplicate = current.acceptedRequests.find((request) => request.operationId === normalized.operationId)
      if (duplicate !== undefined) {
        if (duplicate.requestDigest !== digest || duplicate.requestText !== normalized.requestText || duplicate.acceptedWorkflowRegistryId !== normalized.workflowRegistryId || duplicate.operation !== normalized.operation) throw conflict('operationId was accepted with a different payload')
        return { state: cloneState(current), request: { ...duplicate }, duplicate: true }
      }
      if (current.acceptedRequests.length >= MAX_ACCEPTED_REQUESTS) throw capacity('conversation accepted-request history is full')
      const request: AcceptedConversationRequest = {
        kind: normalized.kind,
        operation: normalized.operation,
        operationId: normalized.operationId,
        requestDigest: digest,
        requestText: normalized.requestText,
        acceptedAt: this.timestamp(),
        ...(normalized.workflowRegistryId === undefined ? {} : { acceptedWorkflowRegistryId: normalized.workflowRegistryId }),
        ...(normalized.workflowRegistryId === undefined ? {} : { workflowRegistryId: normalized.workflowRegistryId }),
        lifecycle: 'accepted',
      }
      const titleCandidate = firstMessageTitleFromText(normalized.requestText)
      const consumeFirstMessage = !current.flags.firstMessageTitleConsumed
      const next = this.nextState(current, {
        acceptedRequests: [...current.acceptedRequests, request],
        flags: { ...current.flags, ...(consumeFirstMessage ? { firstMessageTitleConsumed: true } : {}) },
        ...(consumeFirstMessage && current.titleSource === 'DEFAULT' ? { title: titleCandidate, titleSource: 'FIRST_MESSAGE' as const } : {}),
      })
      await this.write(next)
      return { state: cloneState(next), request: { ...request }, duplicate: false }
    })
  }

  /** Only the first accepted->submitting claim may start a Pi prompt or Workflow. */
  async claimSubmission(conversationId: string, operationId: string, reservedWorkflowRunId?: string): Promise<BeginConversationDispatchResult> {
    const id = normalizeConversationId(conversationId)
    const opId = normalizeOperationId(operationId)
    return this.serialized(id, async () => {
      const current = await this.read(id)
      if (current === undefined) throw notFound(`Conversation state not found: ${id}`)
      const index = current.acceptedRequests.findIndex((request) => request.operationId === opId)
      if (index < 0) throw notFound(`Accepted request not found: ${opId}`)
      const request = current.acceptedRequests[index]!
      if (request.lifecycle !== 'accepted') return { state: cloneState(current), mayDispatch: false }
      const reserved = reservedWorkflowRunId === undefined ? undefined : normalizeReservedRunId(reservedWorkflowRunId)
      const acceptedRequests = current.acceptedRequests.slice()
      acceptedRequests[index] = { ...request, lifecycle: 'submitting', dispatchAttemptedAt: this.timestamp(), ...(reserved === undefined ? {} : { reservedWorkflowRunId: reserved }) }
      const next = this.nextState(current, { acceptedRequests })
      await this.write(next)
      return { state: cloneState(next), mayDispatch: true }
    })
  }

  /** A free-research/skill-plan dispatch may hand its accepted prompt to Pi exactly once. */
  async markReadyForChat(conversationId: string, operationId: string, dispatchStatus: 'free_research' | 'skill_plan', researchBundleRunId?: string): Promise<ConversationState> {
    const bundleRunId = researchBundleRunId === undefined ? undefined : sessionBundleRunId(researchBundleRunId, dispatchStatus)
    return this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), (request) => {
      if (request.operation !== 'prompt') throw conflict('only prompt requests can be handed to chat')
      if (request.lifecycle === 'ready_for_chat') {
        if (request.dispatchStatus !== dispatchStatus || request.researchBundleRunId !== bundleRunId) throw conflict('session research association cannot change')
        return request
      }
      if (request.lifecycle !== 'submitting') throw conflict(`cannot hand ${request.lifecycle} request to chat`)
      const { reservedWorkflowRunId: _reservedWorkflowRunId, ...ready } = request
      return { ...ready, lifecycle: 'ready_for_chat', dispatchStatus, ...(bundleRunId === undefined ? {} : { researchBundleRunId: bundleRunId }) }
    })
  }

  async markNotStarted(conversationId: string, operationId: string, status: 'needs_input' | 'invalid_input' | 'unresolved_reference' | 'executor_unavailable'): Promise<ConversationState> {
    return this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), (request) => {
      if (request.lifecycle === 'not_started' && request.dispatchStatus === status) return request
      if (request.lifecycle !== 'submitting') throw conflict(`cannot mark ${request.lifecycle} request not_started`)
      const { reservedWorkflowRunId: _reservedWorkflowRunId, ...notStarted } = request
      return { ...notStarted, lifecycle: 'not_started', outcome: 'not_started', outcomeReasonCode: status, dispatchStatus: status, finishedAt: this.timestamp() }
    })
  }

  async recordWorkflowCandidate(conversationId: string, operationId: string, candidate: { readonly workflowRegistryId: string; readonly workflowSubject?: string; readonly titleCandidate?: string }): Promise<ConversationState> {
    const registryId = workflowId(candidate.workflowRegistryId, 'workflowRegistryId')
    const workflowSubject = candidate.workflowSubject === undefined ? undefined : normalizeConversationTitle(candidate.workflowSubject)
    const titleCandidate = candidate.titleCandidate === undefined ? undefined : normalizeConversationTitle(candidate.titleCandidate)
    return this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), (request) => {
      if (request.lifecycle !== 'submitting' || request.operation !== 'prompt') throw conflict(`cannot record Workflow candidate for ${request.lifecycle} request`)
      if (request.acceptedWorkflowRegistryId !== undefined && request.acceptedWorkflowRegistryId !== registryId) throw conflict('Workflow candidate differs from accepted Workflow intent')
      if (request.workflowRegistryId !== undefined && request.workflowRegistryId !== registryId) throw conflict('Workflow candidate differs from resolved Workflow identity')
      if (request.workflowSubject !== undefined && request.workflowSubject !== workflowSubject) throw conflict('Workflow candidate subject changed')
      if (request.workflowTitleCandidate !== undefined && request.workflowTitleCandidate !== titleCandidate) throw conflict('Workflow title candidate changed')
      if (request.workflowRegistryId === registryId && request.workflowSubject === workflowSubject && request.workflowTitleCandidate === titleCandidate) return request
      return { ...request, kind: 'workflow', workflowRegistryId: registryId, ...(workflowSubject === undefined ? {} : { workflowSubject }), ...(titleCandidate === undefined ? {} : { workflowTitleCandidate: titleCandidate }) }
    })
  }

  /** Claims a direct accepted command, or the one permitted ready_for_chat prompt. */
  async claimChatCommand(conversationId: string, operationId: string): Promise<BeginConversationDispatchResult> {
    const id = normalizeConversationId(conversationId); const opId = normalizeOperationId(operationId)
    return this.serialized(id, async () => {
      const current = await this.read(id); if (!current) throw notFound(`Conversation state not found: ${id}`)
      const index = current.acceptedRequests.findIndex((request) => request.operationId === opId); if (index < 0) throw notFound(`Accepted request not found: ${opId}`)
      const request = current.acceptedRequests[index]!
      if (request.lifecycle === 'accepted' && (request.kind === 'workflow' || request.acceptedWorkflowRegistryId !== undefined)) throw conflict('Workflow prompts must pass dispatch validation before they can start Pi chat')
      if (request.lifecycle === 'ready_for_chat' && request.operation !== 'prompt') throw conflict('only prompt requests can claim ready_for_chat')
      if (request.lifecycle !== 'accepted' && request.lifecycle !== 'ready_for_chat') return { state: cloneState(current), mayDispatch: false }
      const acceptedRequests = current.acceptedRequests.slice(); acceptedRequests[index] = { ...request, lifecycle: 'submitting', dispatchAttemptedAt: request.dispatchAttemptedAt ?? this.timestamp() }
      const next = this.nextState(current, { acceptedRequests }); await this.write(next); return { state: cloneState(next), mayDispatch: true }
    })
  }

  /** Compatibility alias for call sites that name the submission target a dispatch. */
  async beginDispatch(conversationId: string, operationId: string): Promise<BeginConversationDispatchResult> { return this.claimSubmission(conversationId, operationId) }

  /** Completes Pi chat or records a known non-start without consuming Workflow naming. */
  async completeSubmission(conversationId: string, operationId: string, outcome: ConversationSubmissionOutcome): Promise<ConversationState> {
    const id = normalizeConversationId(conversationId)
    const opId = normalizeOperationId(operationId)
    const reasonCode = outcome.outcome === 'not_started' ? validateFailureCode(outcome.reasonCode) : undefined
    return this.updateRequest(id, opId, (request) => {
      if (outcome.kind !== request.kind && !(outcome.kind === 'workflow' && request.operation === 'prompt')) throw conflict('submission kind does not match the accepted request')
      if (outcome.kind === 'chat' && outcome.outcome === 'started') {
        if (request.lifecycle === 'started' && request.outcome === 'chat_started') return request
        if (request.kind === 'chat' && ['completed', 'cancelled', 'failed', 'interrupted'].includes(request.lifecycle)) return request
        if (request.lifecycle !== 'submitting') throw conflict(`cannot complete ${request.lifecycle} request as started`)
        return { ...request, lifecycle: 'started', outcome: 'chat_started', startedAt: this.timestamp() }
      }
      if (outcome.kind === 'chat' && ['completed', 'cancelled', 'failed'].includes(outcome.outcome)) {
        const lifecycle = outcome.outcome
        const code = lifecycle === 'failed' ? validateFailureCode(outcome.failureCode ?? 'agent_error') : undefined
        const matchingTerminal = (lifecycle === 'completed' && request.lifecycle === 'completed' && request.outcome === 'chat_completed')
          || (lifecycle === 'cancelled' && request.lifecycle === 'cancelled' && request.outcome === 'chat_cancelled')
          || (lifecycle === 'failed' && request.lifecycle === 'failed' && request.failureCode === code)
        if (matchingTerminal) return request
        if (request.kind !== 'chat' || request.lifecycle !== 'started' || request.outcome !== 'chat_started') throw conflict(`cannot complete ${request.lifecycle} request as ${lifecycle}`)
        if (lifecycle === 'failed') {
          const { outcome: _outcome, ...failedRequest } = request
          return { ...failedRequest, lifecycle, failureCode: code!, finishedAt: this.timestamp() }
        }
        return { ...request, lifecycle, outcome: lifecycle === 'completed' ? 'chat_completed' : 'chat_cancelled', finishedAt: this.timestamp() }
      }
      if (outcome.outcome === 'not_started') {
        if (request.lifecycle === 'not_started' && request.outcomeReasonCode === reasonCode) return request
        if (request.lifecycle !== 'submitting') throw conflict(`cannot complete ${request.lifecycle} request as not_started`)
        return { ...request, lifecycle: 'not_started', outcome: 'not_started', outcomeReasonCode: reasonCode, finishedAt: this.timestamp() }
      }
      throw conflict('Workflow starts must be recorded through markWorkflowStarted')
    })
  }

  /** Records a Pi user-message identity only after Runtime matched the public SessionEntry to its originating user event object. */
  async recordPiUserMessageId(conversationId: string, operationId: string, piMessageId: string): Promise<ConversationState> {
    const id = normalizeConversationId(conversationId)
    const opId = normalizeOperationId(operationId)
    const messageId = normalizePiMessageId(piMessageId)
    return this.updateRequest(id, opId, (request) => {
      if (request.piMessageId === messageId) return request
      if (request.piMessageId !== undefined) throw conflict('operation is already associated with a different Pi message')
      return { ...request, piMessageId: messageId }
    })
  }

  /** Records a successful Workflow start and consumes the first naming opportunity exactly once. */
  async markWorkflowStarted(
    conversationId: string,
    operationId: string,
    result: { readonly workflowRegistryId: string; readonly workflowRunId: string; readonly workflowSubject?: string; readonly startedAt?: string; readonly titleCandidate?: string },
    expectedRevision?: number,
  ): Promise<ConversationState> {
    const id = normalizeConversationId(conversationId)
    const opId = normalizeOperationId(operationId)
    const registryId = workflowId(result.workflowRegistryId, 'workflowRegistryId')
    const runId = workflowId(result.workflowRunId, 'workflowRunId')
    const startedAt = result.startedAt === undefined ? this.timestamp() : timestamp(result.startedAt, 'startedAt')
    const titleCandidate = result.titleCandidate === undefined ? undefined : normalizeConversationTitle(result.titleCandidate)
    const workflowSubject = result.workflowSubject === undefined ? undefined : normalizeConversationTitle(result.workflowSubject)
    validateExpectedRevision(expectedRevision)
    return this.serialized(id, async () => {
      const current = await this.read(id)
      if (current === undefined) throw notFound(`Conversation state not found: ${id}`)
      assertRevision(current, expectedRevision)
      const index = current.acceptedRequests.findIndex((request) => request.operationId === opId)
      if (index < 0) throw notFound(`Accepted request not found: ${opId}`)
      const request = current.acceptedRequests[index]!
      if (request.operation !== 'prompt') throw conflict('only prompt requests may be associated with a Workflow run')
      if (request.lifecycle === 'started') {
        if (request.workflowRegistryId !== registryId || request.workflowRunId !== runId) throw conflict('operationId is associated with a different Workflow run')
        if (request.outcome !== 'workflow_started') throw corrupt('started Workflow request has an invalid outcome')
        return cloneState(current)
      }
      if (request.lifecycle !== 'submitting') throw conflict(`cannot mark ${request.lifecycle} request as started`)
      if (request.acceptedWorkflowRegistryId !== undefined && request.acceptedWorkflowRegistryId !== registryId) throw conflict('started Workflow differs from accepted Workflow intent')
      if (request.workflowRegistryId !== undefined && request.workflowRegistryId !== registryId) throw conflict('started Workflow differs from resolved Workflow identity')
      const acceptedRequests = current.acceptedRequests.slice()
      const { workflowTitleCandidate: _workflowTitleCandidate, reservedWorkflowRunId: _reservedWorkflowRunId, ...startedRequest } = request
      acceptedRequests[index] = { ...startedRequest, kind: 'workflow', workflowRegistryId: registryId, workflowRunId: runId, ...((workflowSubject ?? request.workflowSubject) === undefined ? {} : { workflowSubject: workflowSubject ?? request.workflowSubject }), lifecycle: 'started', outcome: 'workflow_started', startedAt }
      const consumeNaming = !current.flags.firstWorkflowNamingOpportunityConsumed
      const next: ConversationState = {
        ...current,
        acceptedRequests,
        flags: { ...current.flags, ...(consumeNaming ? { firstWorkflowNamingOpportunityConsumed: true } : {}) },
      ...(consumeNaming && (titleCandidate ?? request.workflowTitleCandidate) !== undefined && current.titleSource !== 'USER' ? { title: titleCandidate ?? request.workflowTitleCandidate, titleSource: 'WORKFLOW' as const } : {}),
        revision: current.revision + 1,
        updatedAt: this.timestamp(),
      }
      validateState(next, id)
      await this.write(next)
      return cloneState(next)
    })
  }

  /** Reconciles the accepted-request ledger with WorkflowService's confirmed terminal state. */
  async completeWorkflowRequest(conversationId: string, operationId: string, status: 'completed' | 'completed_with_review' | 'blocked' | 'failed' | 'cancelled'): Promise<ConversationState> {
    const lifecycle = status === 'completed' || status === 'completed_with_review' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed'
    const outcome = status === 'completed' || status === 'completed_with_review' ? 'workflow_completed' : status === 'blocked' ? 'workflow_blocked' : status === 'cancelled' ? 'workflow_cancelled' : 'workflow_failed'
    const failureCode = status === 'blocked' ? 'workflow_blocked' : status === 'failed' ? 'workflow_failed' : undefined
    return this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), (request) => {
      if (request.lifecycle === lifecycle && request.outcome === outcome) return request
      if (request.kind !== 'workflow' || request.lifecycle !== 'started' || request.outcome !== 'workflow_started' || request.workflowRegistryId === undefined || request.workflowRunId === undefined || request.startedAt === undefined) throw conflict(`cannot record Workflow terminal state for ${request.lifecycle} request`)
      const { reservedWorkflowRunId: _reservedWorkflowRunId, ...started } = request
      return { ...started, lifecycle, outcome, ...(failureCode === undefined ? {} : { failureCode }), finishedAt: this.timestamp() }
    })
  }

  async markDispatchFailed(conversationId: string, operationId: string, failureCode: string): Promise<ConversationState> {
    const id = normalizeConversationId(conversationId)
    const opId = normalizeOperationId(operationId)
    const code = validateFailureCode(failureCode)
    return this.updateRequest(id, opId, (request) => {
      if (request.lifecycle === 'failed') {
        if (request.failureCode !== code) throw conflict('operationId already has a different dispatch failure')
        return request
      }
      if (request.lifecycle !== 'accepted' && request.lifecycle !== 'submitting') throw conflict(`cannot mark ${request.lifecycle} request as failed`)
      return { ...request, lifecycle: 'failed', failureCode: code, finishedAt: this.timestamp() }
    })
  }

  /** A leftover submitting state is ambiguous and is permanently non-dispatchable. */
  async recoverInterruptedDispatches(): Promise<number> {
    const states = await this.list()
    let changedConversations = 0
    for (const listed of states) {
      const changed = await this.serialized(listed.conversationId, async () => {
        const current = await this.read(listed.conversationId)
        if (!current || !current.acceptedRequests.some((request) => request.lifecycle === 'submitting' || request.toolActivities?.some(activity => activity.status === 'running') || (request.lifecycle === 'started' && (request.outcome === 'workflow_started' || request.outcome === 'chat_started')))) return false
        const acceptedRequests = current.acceptedRequests.map((original) => {
          const request = { ...original, ...(original.toolActivities === undefined ? {} : { toolActivities: original.toolActivities.map(activity => activity.status === 'running' ? { ...activity, status: 'interrupted' as const, completedAt: this.timestamp() } : activity) }) }
          if (request.lifecycle === 'submitting') return { ...request, lifecycle: 'interrupted' as const, finishedAt: this.timestamp() }
          if (request.lifecycle === 'started' && (request.outcome === 'workflow_started' || request.outcome === 'chat_started')) {
            const { outcome: _outcome, ...interrupted } = request
            return { ...interrupted, lifecycle: 'interrupted' as const, finishedAt: this.timestamp() }
          }
          return request
        })
        await this.write(this.nextState(current, { acceptedRequests }))
        return true
      })
      if (changed) changedConversations += 1
    }
    return changedConversations
  }

  private async updateMetadata(idInput: string, update: (state: ConversationState) => ConversationState, expectedRevision?: number, allowUserRename = false): Promise<ConversationState> {
    const id = normalizeConversationId(idInput)
    validateExpectedRevision(expectedRevision)
    return this.serialized(id, async () => {
      const current = await this.read(id)
      if (current === undefined) throw notFound(`Conversation state not found: ${id}`)
      assertRevision(current, expectedRevision)
      const changed = update(cloneState(current))
      if (JSON.stringify(current) === JSON.stringify(changed)) return cloneState(current)
      return this.commitUpdate(current, changed, allowUserRename)
    })
  }

  async markPreparationCancelled(conversationId: string, operationId: string): Promise<ConversationState> {
    return this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), request => {
      if (request.lifecycle !== 'submitting') return request
      const { reservedWorkflowRunId: _reserved, ...rest } = request
      return { ...rest, lifecycle: 'not_started', outcome: 'not_started', outcomeReasonCode: 'cancelled', finishedAt: this.timestamp() }
    })
  }

  async recordDispatchEnvelope(conversationId: string, operationId: string, envelope: ResearchDispatchStart): Promise<ConversationState> {
    const { completion: _completion, sourceLibraryHits: _hits, ...serializable } = envelope
    assertSafeEnvelope(serializable)
    return this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), (request) => {
      if (request.lifecycle !== 'submitting') throw conflict('dispatch result requires a submitting request')
      return { ...request, dispatchEnvelope: serializable, ...(envelope.status === 'needs_clarification' ? { lifecycle: 'needs_clarification' as const } : {}) }
    })
  }

  async claimClarification(conversationId: string, operationId: string, confirmationId: string, reservedRunId: string): Promise<BeginConversationDispatchResult> {
    let mayDispatch = false
    const state = await this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), (request) => {
      if (request.lifecycle !== 'needs_clarification') return request
      if (request.dispatchEnvelope?.clarification?.confirmationId !== confirmationId) throw conflict('clarification is expired or does not belong to this request')
      mayDispatch = true
      return { ...request, lifecycle: 'submitting', confirmedClarificationId: confirmationId, reservedWorkflowRunId: normalizeReservedRunId(reservedRunId) }
    })
    return { state, mayDispatch }
  }

  async linkToolWorkflow(conversationId: string, operationId: string, linked: LinkedConversationWorkflow): Promise<ConversationState> {
    workflowId(linked.runId, 'runId'); workflowId(linked.workflowRegistryId, 'workflowRegistryId')
    if (linked.toolCallId !== undefined) normalizePiMessageId(linked.toolCallId)
    return this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), (request) => {
      const previous = request.linkedWorkflows ?? []
      const duplicate = previous.find((entry) => entry.runId === linked.runId)
      if (duplicate !== undefined) {
        if (duplicate.workflowRegistryId !== linked.workflowRegistryId || duplicate.toolCallId !== linked.toolCallId) throw conflict('Workflow association cannot change')
        return request
      }
      if (previous.length >= 100) throw capacity('too many associated workflows')
      return { ...request, linkedWorkflows: [...previous, linked] }
    })
  }

  async recordToolActivity(conversationId: string, operationId: string, activity: Omit<ConversationToolActivity, 'startedAt'> & { readonly startedAt?: string }): Promise<ConversationState> {
    normalizePiMessageId(activity.toolCallId); workflowId(activity.name, 'name')
    return this.updateRequest(normalizeConversationId(conversationId), normalizeOperationId(operationId), (request) => {
      const activities = [...(request.toolActivities ?? [])]
      const index = activities.findIndex((entry) => entry.toolCallId === activity.toolCallId)
      const previous = index < 0 ? undefined : activities[index]
      if (previous && previous.status !== 'running' && activity.status === 'running') return request
      const next = { ...previous, ...activity, startedAt: previous?.startedAt ?? activity.startedAt ?? this.timestamp() }
      if (index < 0) { if (activities.length >= 1000) throw capacity('too many tool activities'); activities.push(next) } else activities[index] = next
      return { ...request, toolActivities: activities }
    })
  }

  private async updateRequest(id: string, operationId: string, update: (request: AcceptedConversationRequest) => AcceptedConversationRequest): Promise<ConversationState> {
    return this.serialized(id, async () => {
      const current = await this.read(id)
      if (current === undefined) throw notFound(`Conversation state not found: ${id}`)
      const index = current.acceptedRequests.findIndex((request) => request.operationId === operationId)
      if (index < 0) throw notFound(`Accepted request not found: ${operationId}`)
      const before = current.acceptedRequests[index]!
      const after = update({ ...before })
      if (JSON.stringify(before) === JSON.stringify(after)) return cloneState(current)
      const acceptedRequests = current.acceptedRequests.slice()
      acceptedRequests[index] = after
      const next = this.nextState(current, { acceptedRequests })
      await this.write(next)
      return cloneState(next)
    })
  }

  private async commitUpdate(current: ConversationState, changed: ConversationState, allowUserRename = false): Promise<ConversationState> {
    if (!changed || typeof changed !== 'object' || changed.conversationId !== current.conversationId || changed.schemaVersion !== CONVERSATION_STATE_SCHEMA_VERSION || changed.createdAt !== current.createdAt) throw invalid('update cannot change conversation identity, schema version, or creation time')
    if (current.titleSource === 'USER' && (changed.titleSource !== 'USER' || (changed.title !== current.title && !allowUserRename))) throw conflict('a USER title can only be changed by another explicit rename')
    const next: ConversationState = { ...changed, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: this.timestamp() }
    try { validateState(next, current.conversationId) } catch (error) {
      if (error instanceof ConversationStateStoreError && error.code === 'corrupt') throw invalid(`conversation state update is invalid: ${error.message}`)
      throw error
    }
    await this.write(next)
    return cloneState(next)
  }

  private nextState(current: ConversationState, update: Partial<ConversationState>): ConversationState {
    const next = { ...current, ...update, revision: current.revision + 1, createdAt: current.createdAt, updatedAt: this.timestamp() }
    validateState(next, current.conversationId)
    return next
  }

  private async serialized<T>(id: string, action: () => Promise<T>): Promise<T> {
    const key = `${this.rootDir}\u0000${id}`
    const previous = perSessionTails.get(key) ?? Promise.resolve()
    let release!: () => void
    const tail = new Promise<void>((resolveTail) => { release = resolveTail })
    perSessionTails.set(key, tail)
    await previous
    try { return await action() } finally {
      release()
      if (perSessionTails.get(key) === tail) perSessionTails.delete(key)
    }
  }

  private timestamp(): string { return timestamp(this.now(), 'Runtime clock') }

  private async ensureRoot(): Promise<void> {
    try {
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 })
      const info = await lstat(this.rootDir)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('sidecar root is not a real directory')
      await chmod(this.rootDir, 0o700)
    } catch (error) { throw io('conversation state directory is unavailable', error) }
  }

  private path(id: string): string { return join(this.rootDir, `${id}.json`) }

  private async read(id: string): Promise<ConversationState | undefined> {
    await this.ensureRoot()
    const path = this.path(id)
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink()) throw corrupt(`sidecar is not a regular file: ${id}`)
      if (info.size > MAX_STATE_BYTES) throw corrupt(`sidecar exceeds size limit: ${id}`)
      await chmod(path, 0o600)
      const text = await readFile(path, 'utf8')
      if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) throw corrupt(`sidecar exceeds size limit: ${id}`)
      let value: unknown
      try { value = JSON.parse(text) as unknown } catch (error) { throw corrupt(`sidecar JSON is corrupt: ${id}`, error) }
      if (!plainObject(value)) throw corrupt(`sidecar must contain an object: ${id}`)
      if (value.schemaVersion === 2) {
        value.schemaVersion = 3
        if (Array.isArray(value.acceptedRequests)) for (const request of value.acceptedRequests) if (plainObject(request) && typeof request.workflowRunId === 'string' && typeof request.workflowRegistryId === 'string') request.linkedWorkflows = [{ runId: request.workflowRunId, workflowRegistryId: request.workflowRegistryId }]
      }
      if (value.schemaVersion !== CONVERSATION_STATE_SCHEMA_VERSION) throw new ConversationStateStoreError('unsupported_version', `unsupported conversation sidecar version: ${String(value.schemaVersion)}`)
      validateState(value, id)
      return value
    } catch (error) {
      if (isNotFound(error)) return undefined
      if (error instanceof ConversationStateStoreError) throw error
      throw io(`conversation state could not be read: ${id}`, error)
    }
  }

  private async write(state: ConversationState): Promise<void> {
    validateState(state, state.conversationId)
    await this.ensureRoot()
    const destination = this.path(state.conversationId)
    const temporary = join(dirname(destination), `.${state.conversationId}.${randomUUID()}.tmp`)
    const text = `${JSON.stringify(state)}\n`
    if (Buffer.byteLength(text, 'utf8') > MAX_STATE_BYTES) throw capacity('conversation sidecar exceeds size limit')
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(text, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await chmod(temporary, 0o600)
      await rename(temporary, destination)
      if (process.platform !== 'win32') {
        const directory = await open(dirname(destination), 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await unlink(temporary).catch(() => undefined)
      throw io(`conversation state could not be saved: ${state.conversationId}`, error)
    }
  }
}

function initialState(id: string, now: string, piTranscriptObserved = false): ConversationState {
  return { schemaVersion: CONVERSATION_STATE_SCHEMA_VERSION, conversationId: id, piTranscriptObserved, title: DEFAULT_CONVERSATION_TITLE, titleSource: 'DEFAULT', flags: { firstMessageTitleConsumed: false, firstWorkflowNamingOpportunityConsumed: false }, archived: false, revision: 0, createdAt: now, updatedAt: now, acceptedRequests: [] }
}

function normalizeRequestInput(input: AcceptConversationRequestInput): AcceptConversationRequestInput & { readonly kind: ConversationRequestKind; readonly operation: 'prompt' | 'steer' | 'follow_up' } {
  if (!plainObject(input)) throw invalid('accepted request must be an object')
  const operation = input.operation ?? 'prompt'
  if (!['prompt', 'steer', 'follow_up'].includes(operation)) throw invalid('request operation is invalid')
  const kind = input.kind ?? (input.workflowRegistryId === undefined ? 'chat' : 'workflow')
  if (kind !== 'chat' && kind !== 'workflow') throw invalid('request kind must be chat or workflow')
  const operationId = normalizeOperationId(input.operationId)
  if (typeof input.requestText !== 'string' || input.requestText.length > MAX_REQUEST_TEXT_LENGTH) throw invalid(`requestText must be text of at most ${MAX_REQUEST_TEXT_LENGTH} characters`)
  if (input.requestText.trim() === '') throw invalid('requestText cannot be empty')
  if (SECRET_PATTERNS.some((pattern) => pattern.test(input.requestText))) throw invalid('requestText appears to contain a credential and cannot be persisted')
  const workflowRegistryId = input.workflowRegistryId === undefined ? undefined : workflowId(input.workflowRegistryId, 'workflowRegistryId')
  if (kind === 'chat' && workflowRegistryId !== undefined) throw invalid('chat requests cannot include workflowRegistryId')
  return { kind, operation, operationId, requestText: input.requestText, ...(workflowRegistryId === undefined ? {} : { workflowRegistryId }) }
}

function validateState(value: unknown, expectedId: string): asserts value is ConversationState {
  if (!plainObject(value)) throw corrupt('conversation sidecar must be an object')
  exactKeys(value, ['schemaVersion', 'conversationId', 'piTranscriptObserved', 'title', 'titleSource', 'flags', 'archived', 'archivedAt', 'revision', 'createdAt', 'updatedAt', 'acceptedRequests'], ['schemaVersion', 'conversationId', 'piTranscriptObserved', 'title', 'titleSource', 'flags', 'archived', 'revision', 'createdAt', 'updatedAt', 'acceptedRequests'])
  if (value.schemaVersion !== CONVERSATION_STATE_SCHEMA_VERSION) throw new ConversationStateStoreError('unsupported_version', 'unsupported conversation sidecar version')
  try { if (normalizeConversationId(value.conversationId) !== expectedId) throw corrupt('sidecar conversation ID does not match its filename') } catch (error) { if (error instanceof ConversationStateStoreError && error.code === 'corrupt') throw error; throw corrupt('sidecar conversation ID is invalid', error) }
  if (typeof value.piTranscriptObserved !== 'boolean') throw corrupt('sidecar Pi transcript observation flag is invalid')
  try { if (typeof value.title !== 'string' || normalizeConversationTitle(value.title) !== value.title) throw corrupt('sidecar title is invalid or not normalized') } catch (error) { if (error instanceof ConversationStateStoreError && error.code === 'corrupt') throw error; throw corrupt('sidecar title is invalid', error) }
  if (!['DEFAULT', 'FIRST_MESSAGE', 'WORKFLOW', 'USER'].includes(String(value.titleSource))) throw corrupt('sidecar titleSource is invalid')
  if (typeof value.archived !== 'boolean' || value.archived !== (value.archivedAt !== undefined)) throw corrupt('sidecar archive state is inconsistent')
  if (value.archivedAt !== undefined) checkedTimestamp(value.archivedAt, 'archivedAt')
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0) throw corrupt('sidecar revision is invalid')
  checkedTimestamp(value.createdAt, 'createdAt'); checkedTimestamp(value.updatedAt, 'updatedAt')
  if (Date.parse(value.updatedAt as string) < Date.parse(value.createdAt as string)) throw corrupt('sidecar updatedAt precedes createdAt')
  if (!plainObject(value.flags)) throw corrupt('sidecar flags are invalid')
  exactKeys(value.flags, ['firstMessageTitleConsumed', 'firstWorkflowNamingOpportunityConsumed'])
  if (typeof value.flags.firstMessageTitleConsumed !== 'boolean' || typeof value.flags.firstWorkflowNamingOpportunityConsumed !== 'boolean') throw corrupt('sidecar one-shot flags are invalid')
  if (!Array.isArray(value.acceptedRequests) || value.acceptedRequests.length > MAX_ACCEPTED_REQUESTS) throw corrupt('accepted request list is invalid or over capacity')
  const operationIds = new Set<string>()
  for (const request of value.acceptedRequests) {
    validateRequest(request)
    if (operationIds.has(request.operationId)) throw corrupt('duplicate accepted operationId')
    operationIds.add(request.operationId)
  }
}

function validateRequest(value: unknown): asserts value is AcceptedConversationRequest {
  if (!plainObject(value)) throw corrupt('accepted request record must be an object')
  exactKeys(value, ['kind', 'operation', 'operationId', 'requestDigest', 'requestText', 'acceptedAt', 'acceptedWorkflowRegistryId', 'workflowRegistryId', 'workflowRunId', 'researchBundleRunId', 'reservedWorkflowRunId', 'workflowSubject', 'workflowTitleCandidate', 'lifecycle', 'dispatchAttemptedAt', 'startedAt', 'failureCode', 'outcome', 'outcomeReasonCode', 'dispatchStatus', 'finishedAt', 'piMessageId', 'linkedWorkflows', 'toolActivities', 'dispatchEnvelope', 'confirmedClarificationId'], ['kind', 'operation', 'operationId', 'requestDigest', 'requestText', 'acceptedAt', 'lifecycle'])
  if (value.kind !== 'chat' && value.kind !== 'workflow') throw corrupt('accepted request kind is invalid')
  if (!['prompt', 'steer', 'follow_up'].includes(String(value.operation))) throw corrupt('accepted request operation is invalid')
  try { normalizeOperationId(value.operationId) } catch (error) { throw corrupt('accepted operationId is invalid', error) }
  if (typeof value.requestText !== 'string') throw corrupt('accepted request text is invalid')
  const requestText = value.requestText
  if (requestText.length > MAX_REQUEST_TEXT_LENGTH || SECRET_PATTERNS.some((pattern) => pattern.test(requestText))) throw corrupt('accepted request text is invalid or contains a credential')
  if (typeof value.requestDigest !== 'string' || !DIGEST_PATTERN.test(value.requestDigest) || value.requestDigest !== conversationRequestDigest(requestText)) throw corrupt('accepted request digest does not match the request text')
  if (value.workflowRegistryId !== undefined) { try { workflowId(value.workflowRegistryId, 'workflowRegistryId') } catch (error) { throw corrupt('workflowRegistryId is invalid', error) } }
  if (value.acceptedWorkflowRegistryId !== undefined) { try { workflowId(value.acceptedWorkflowRegistryId, 'acceptedWorkflowRegistryId') } catch (error) { throw corrupt('acceptedWorkflowRegistryId is invalid', error) } }
  if (value.workflowRunId !== undefined) { try { workflowId(value.workflowRunId, 'workflowRunId') } catch (error) { throw corrupt('workflowRunId is invalid', error) } }
  if (value.researchBundleRunId !== undefined) {
    try { sessionBundleRunId(value.researchBundleRunId, value.dispatchStatus as 'free_research' | 'skill_plan') } catch (error) { throw corrupt('researchBundleRunId is invalid', error) }
    if (value.kind !== 'chat' || value.operation !== 'prompt' || ['accepted', 'not_started'].includes(String(value.lifecycle)) || value.workflowRunId !== undefined || value.reservedWorkflowRunId !== undefined) throw corrupt('session research association has invalid lifecycle fields')
  }
  if (value.reservedWorkflowRunId !== undefined) { try { normalizeReservedRunId(value.reservedWorkflowRunId) } catch (error) { throw corrupt('reservedWorkflowRunId is invalid', error) } }
  if (value.workflowSubject !== undefined) { try { if (normalizeConversationTitle(value.workflowSubject) !== value.workflowSubject) throw corrupt('workflowSubject is not normalized') } catch (error) { if (error instanceof ConversationStateStoreError && error.code === 'corrupt') throw error; throw corrupt('workflowSubject is invalid', error) } }
  if (value.workflowTitleCandidate !== undefined) { try { if (normalizeConversationTitle(value.workflowTitleCandidate) !== value.workflowTitleCandidate) throw corrupt('workflowTitleCandidate is not normalized') } catch (error) { if (error instanceof ConversationStateStoreError && error.code === 'corrupt') throw error; throw corrupt('workflowTitleCandidate is invalid', error) } }
  if (!['accepted', 'submitting', 'needs_clarification', 'ready_for_chat', 'started', 'completed', 'cancelled', 'not_started', 'failed', 'interrupted'].includes(String(value.lifecycle))) throw corrupt('accepted request lifecycle is invalid')
  for (const field of ['acceptedAt', 'dispatchAttemptedAt', 'startedAt', 'finishedAt'] as const) if (value[field] !== undefined) checkedTimestamp(value[field], field)
  if (value.failureCode !== undefined) { try { validateFailureCode(value.failureCode) } catch (error) { throw corrupt('failureCode is invalid', error) } }
  if (value.outcome !== undefined && !['chat_started', 'chat_completed', 'chat_cancelled', 'workflow_started', 'workflow_completed', 'workflow_blocked', 'workflow_failed', 'workflow_cancelled', 'not_started'].includes(String(value.outcome))) throw corrupt('accepted request outcome is invalid')
  if (value.outcomeReasonCode !== undefined) { try { validateFailureCode(value.outcomeReasonCode) } catch (error) { throw corrupt('outcomeReasonCode is invalid', error) } }
  if (value.dispatchStatus !== undefined && !['started', 'needs_input', 'invalid_input', 'unresolved_reference', 'executor_unavailable', 'free_research', 'skill_plan'].includes(String(value.dispatchStatus))) throw corrupt('dispatchStatus is invalid')
  if (value.piMessageId !== undefined) { try { normalizePiMessageId(value.piMessageId) } catch (error) { throw corrupt('piMessageId is invalid', error) } }
  if (value.dispatchEnvelope !== undefined) { if (!plainObject(value.dispatchEnvelope)) throw corrupt('dispatch envelope is invalid'); assertSafeEnvelope(value.dispatchEnvelope) }
  if (value.linkedWorkflows !== undefined) {
    if (!Array.isArray(value.linkedWorkflows) || value.linkedWorkflows.length > 100) throw corrupt('workflow associations are invalid')
    for (const item of value.linkedWorkflows) { if (!plainObject(item)) throw corrupt('workflow association is invalid'); exactKeys(item, ['runId','workflowRegistryId','toolCallId','subject'], ['runId','workflowRegistryId']); workflowId(item.runId, 'runId'); workflowId(item.workflowRegistryId, 'workflowRegistryId'); if (item.toolCallId !== undefined) normalizePiMessageId(item.toolCallId); if (item.subject !== undefined && (typeof item.subject !== 'string' || item.subject.length > 240 || SECRET_PATTERNS.some(pattern => pattern.test(item.subject as string)))) throw corrupt('workflow subject is invalid') }
  }
  if (value.toolActivities !== undefined) {
    if (!Array.isArray(value.toolActivities) || value.toolActivities.length > 1000) throw corrupt('tool activities are invalid')
    for (const item of value.toolActivities) { if (!plainObject(item)) throw corrupt('tool activity is invalid'); exactKeys(item,['toolCallId','name','status','summary','startedAt','completedAt'],['toolCallId','name','status','startedAt']); normalizePiMessageId(item.toolCallId); workflowId(item.name,'name'); if (!['running','completed','failed','cancelled','interrupted'].includes(String(item.status))) throw corrupt('tool status is invalid'); checkedTimestamp(item.startedAt,'startedAt'); if (item.completedAt !== undefined) checkedTimestamp(item.completedAt,'completedAt'); if (item.summary !== undefined && (typeof item.summary !== 'string' || item.summary.length > 240 || SECRET_PATTERNS.some(pattern => pattern.test(item.summary as string)))) throw corrupt('tool summary is invalid') }
  }
  const state = value.lifecycle as AcceptedRequestLifecycle
  if (state === 'needs_clarification' && (!plainObject(value.dispatchEnvelope) || !plainObject(value.dispatchEnvelope.clarification) || value.workflowRunId !== undefined || value.startedAt !== undefined)) throw corrupt('clarification state is invalid')
  if (state === 'accepted' && (value.dispatchAttemptedAt !== undefined || value.workflowRunId !== undefined || value.reservedWorkflowRunId !== undefined || value.workflowSubject !== undefined || value.workflowTitleCandidate !== undefined || value.startedAt !== undefined || value.failureCode !== undefined || value.outcome !== undefined || value.outcomeReasonCode !== undefined || value.dispatchStatus !== undefined || value.finishedAt !== undefined)) throw corrupt('accepted request has invalid lifecycle fields')
  if (state === 'submitting' && (value.dispatchAttemptedAt === undefined || value.workflowRunId !== undefined || value.startedAt !== undefined || value.failureCode !== undefined || value.outcome !== undefined || value.outcomeReasonCode !== undefined || value.finishedAt !== undefined)) throw corrupt('submitting request has invalid lifecycle fields')
  if (state === 'ready_for_chat' && (value.operation !== 'prompt' || value.dispatchAttemptedAt === undefined || value.workflowRunId !== undefined || value.reservedWorkflowRunId !== undefined || value.startedAt !== undefined || value.failureCode !== undefined || value.outcome !== undefined || value.outcomeReasonCode !== undefined || !['free_research', 'skill_plan'].includes(String(value.dispatchStatus)) || value.finishedAt !== undefined)) throw corrupt('ready_for_chat request has invalid lifecycle fields')
  if (state === 'started' && (value.dispatchAttemptedAt === undefined || value.startedAt === undefined || value.failureCode !== undefined || value.finishedAt !== undefined || (value.kind === 'chat' && (value.outcome !== 'chat_started' || value.workflowRegistryId !== undefined || value.workflowRunId !== undefined || value.reservedWorkflowRunId !== undefined)) || (value.kind === 'workflow' && (value.outcome !== 'workflow_started' || value.workflowRegistryId === undefined || value.workflowRunId === undefined)))) throw corrupt('started request has invalid lifecycle fields')
  if (state === 'completed' && ((value.kind === 'chat' && (value.outcome !== 'chat_completed' || value.workflowRegistryId !== undefined || value.workflowRunId !== undefined || value.reservedWorkflowRunId !== undefined)) || (value.kind === 'workflow' && (value.outcome !== 'workflow_completed' || value.workflowRegistryId === undefined || value.workflowRunId === undefined || value.reservedWorkflowRunId !== undefined)) || value.startedAt === undefined || value.finishedAt === undefined || value.failureCode !== undefined)) throw corrupt('completed request has invalid lifecycle fields')
  if (state === 'cancelled' && ((value.kind === 'chat' && (value.outcome !== 'chat_cancelled' || value.workflowRegistryId !== undefined || value.workflowRunId !== undefined || value.reservedWorkflowRunId !== undefined)) || (value.kind === 'workflow' && (value.outcome !== 'workflow_cancelled' || value.workflowRegistryId === undefined || value.workflowRunId === undefined || value.reservedWorkflowRunId !== undefined)) || value.startedAt === undefined || value.finishedAt === undefined || value.failureCode !== undefined)) throw corrupt('cancelled request has invalid lifecycle fields')
  if (state === 'not_started' && (value.outcome !== 'not_started' || value.outcomeReasonCode === undefined || value.finishedAt === undefined || value.workflowRunId !== undefined || value.reservedWorkflowRunId !== undefined || value.startedAt !== undefined)) throw corrupt('not_started request has invalid lifecycle fields')
  if (state === 'failed' && (value.failureCode === undefined || value.finishedAt === undefined || value.outcomeReasonCode !== undefined || (value.kind === 'chat' && (value.workflowRunId !== undefined || value.outcome !== undefined || value.workflowRegistryId !== undefined)) || (value.kind === 'workflow' && (!['workflow_blocked', 'workflow_failed'].includes(String(value.outcome)) || value.failureCode !== value.outcome || value.workflowRegistryId === undefined || value.workflowRunId === undefined || value.startedAt === undefined || value.reservedWorkflowRunId !== undefined)))) throw corrupt('failed request has invalid lifecycle fields')
  if (state === 'interrupted' && (value.dispatchAttemptedAt === undefined || value.failureCode !== undefined || value.outcome !== undefined || value.outcomeReasonCode !== undefined || (value.workflowRunId !== undefined && value.reservedWorkflowRunId !== undefined))) throw corrupt('interrupted request has invalid lifecycle fields')
  if (value.kind === 'chat' && value.workflowRegistryId !== undefined) throw corrupt('chat request cannot store a Workflow registry ID')
}

function normalizeOperationId(value: unknown): string {
  if (typeof value !== 'string' || !OPERATION_ID_PATTERN.test(value)) throw invalid('operationId is invalid')
  return value
}
function normalizePiMessageId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw invalid('Pi message ID is invalid')
  return value
}
function sessionBundleRunId(value: unknown, mode: 'free_research' | 'skill_plan'): string {
  const prefix = mode === 'free_research' ? 'free-' : mode === 'skill_plan' ? 'skill-' : undefined
  if (prefix === undefined || typeof value !== 'string' || !value.startsWith(prefix)) throw invalid('researchBundleRunId does not match session dispatch mode')
  normalizeReservedRunId(value.slice(prefix.length))
  return value
}
function normalizeReservedRunId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) throw invalid('reservedWorkflowRunId must be a valid UUID')
  return value
}
function workflowId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !WORKFLOW_ID_PATTERN.test(value)) throw invalid(`${field} is invalid`)
  return value
}
function validateFailureCode(value: unknown): string {
  if (typeof value !== 'string' || !FAILURE_CODE_PATTERN.test(value)) throw invalid('failureCode is invalid')
  return value
}
function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw invalid(`${field} must be an ISO UTC timestamp`)
  return value
}
function checkedTimestamp(value: unknown, field: string): string {
  try { return timestamp(value, field) } catch (error) { throw corrupt(`${field} is invalid`, error) }
}
function validateExpectedRevision(value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw invalid('expectedRevision must be a non-negative safe integer')
}
function assertRevision(current: ConversationState, expected: number | undefined): void {
  if (expected !== undefined && current.revision !== expected) throw conflict(`conversation revision conflict: expected ${expected}, current ${current.revision}`)
}
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
  const accepted = new Set(allowed)
  if (Object.keys(value).some((key) => !accepted.has(key)) || required.some((key) => !Object.hasOwn(value, key))) throw corrupt('sidecar contains missing or unknown fields')
}
function cloneState(value: ConversationState): ConversationState { return { ...value, flags: { ...value.flags }, acceptedRequests: value.acceptedRequests.map((request) => ({ ...request })) } }
function plainObject(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function invalid(message: string): ConversationStateStoreError { return new ConversationStateStoreError('invalid_input', message) }
function notFound(message: string): ConversationStateStoreError { return new ConversationStateStoreError('not_found', message) }
function conflict(message: string): ConversationStateStoreError { return new ConversationStateStoreError('conflict', message) }
function corrupt(message: string, cause?: unknown): ConversationStateStoreError { return new ConversationStateStoreError('corrupt', message, cause === undefined ? undefined : { cause }) }
function io(message: string, cause: unknown): ConversationStateStoreError { return new ConversationStateStoreError('io', message, { cause }) }
function capacity(message: string): ConversationStateStoreError { return new ConversationStateStoreError('capacity', message) }
function isNotFound(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT' }

function assertSafeEnvelope(value: unknown): void {
  const text = JSON.stringify(value)
  if (text.length > 1000000 || SECRET_PATTERNS.some(pattern => pattern.test(text))) throw invalid('dispatch envelope is oversized or contains credentials')
}
