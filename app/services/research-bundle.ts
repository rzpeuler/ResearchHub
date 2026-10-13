import { link, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { ResearchDispatchDecision, ResearchExecutionSummary, ResearchRequest } from './research-dispatch-contracts.ts'
import type { SourceLibraryHit } from './source-library.ts'
import { ApplicationServiceError, type WorkflowExecutionResultProjection } from './contracts.ts'

export interface ResearchBundleProposal {
  readonly proposalId: string
  readonly kind?: string
  readonly sourceCandidateIds?: readonly string[]
  readonly payload: Readonly<Record<string, unknown>>
}

export interface ResearchSessionResult {
  readonly status: 'completed' | 'failed'
  readonly executionBoundary: 'session'
  readonly answer?: string
  readonly error?: string
  readonly selectedSkills: readonly ResearchBundle['decision']['skills'][number][]
  readonly sourceLibraryHits: readonly SourceLibraryHit[]
  readonly entities: readonly ResearchBundle['decision']['entities'][number][]
  readonly evidenceRefs: readonly string[]
  readonly proposalCandidates: readonly ResearchBundleProposal[]
}

export interface ResearchBundle {
  readonly bundleId: string
  readonly workflowRunId: string
  readonly createdAt: string
  readonly request: ResearchRequest
  readonly decision: ResearchDispatchDecision
  readonly summary: ResearchExecutionSummary
  readonly status: string
  readonly structuredResult: unknown
  readonly executionResult?: WorkflowExecutionResultProjection
  readonly report?: { readonly reportId: string; readonly reportPath?: string }
  readonly proposals: readonly ResearchBundleProposal[]
  readonly sourceLibraryHits: readonly SourceLibraryHit[]
}

export interface ResearchBundleStore {
  put(bundle: ResearchBundle): Promise<void>
  get(bundleId: string): Promise<ResearchBundle | undefined>
  list(limit?: number): Promise<readonly ResearchBundle[]>
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
function safeId(value: string, label: string): string { if (!SAFE_ID.test(value)) throw new TypeError(`${label} must be safe`); return value }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function collectProposals(value: unknown, result: ResearchBundleProposal[] = [], seen = new Set<unknown>()): ResearchBundleProposal[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return result
  seen.add(value)
  if (Array.isArray(value)) { for (const item of value) collectProposals(item, result, seen); return result }
  const item = value as Record<string, unknown>
  if (typeof item.proposalId === 'string' && SAFE_ID.test(item.proposalId)) {
    const payload = { ...item }; delete payload.proposalId
    result.push({ proposalId: item.proposalId, ...(typeof item.kind === 'string' ? { kind: item.kind } : {}), ...(Array.isArray(item.sourceCandidateIds) ? { sourceCandidateIds: item.sourceCandidateIds.filter((id): id is string => typeof id === 'string') } : {}), payload })
  }
  for (const child of Object.values(item)) collectProposals(child, result, seen)
  return result
}

export function createResearchBundle(input: { readonly request: ResearchRequest; readonly decision: ResearchDispatchDecision; readonly summary: ResearchExecutionSummary; readonly workflowRunId: string; readonly result: unknown; readonly executionResult?: WorkflowExecutionResultProjection; readonly verifiedReportId?: string; readonly sourceLibraryHits?: readonly SourceLibraryHit[]; readonly createdAt?: string }): ResearchBundle {
  const workflowRunId = safeId(input.workflowRunId, 'workflowRunId')
  const report = input.verifiedReportId !== undefined && SAFE_ID.test(input.verifiedReportId) ? { reportId: input.verifiedReportId } : undefined
  const proposals = [...new Map(collectProposals(input.result).map((proposal) => [proposal.proposalId, proposal])).values()]
  const status = record(input.result) && typeof input.result.status === 'string' ? input.result.status : 'unknown'
  return { bundleId: `research-bundle-${workflowRunId}`, workflowRunId, createdAt: input.createdAt ?? new Date().toISOString(), request: input.request, decision: input.decision, summary: input.summary, status, structuredResult: input.result, ...(input.executionResult === undefined ? {} : { executionResult: input.executionResult }), ...(report === undefined ? {} : { report }), proposals, sourceLibraryHits: input.sourceLibraryHits ?? [] }
}

function validateBundle(value: unknown): ResearchBundle {
  if (!record(value) || typeof value.bundleId !== 'string' || !SAFE_ID.test(value.bundleId) || typeof value.workflowRunId !== 'string' || !SAFE_ID.test(value.workflowRunId) || typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)) || !record(value.request) || !record(value.decision) || !record(value.summary) || typeof value.status !== 'string' || !('structuredResult' in value) || !Array.isArray(value.proposals) || !Array.isArray(value.sourceLibraryHits)) throw new TypeError('Invalid ResearchBundle')
  if (value.bundleId !== `research-bundle-${value.workflowRunId}`) throw new TypeError('ResearchBundle identity does not match its Workflow run')
  if (value.executionResult !== undefined) {
    const result = value.executionResult
    const workflow = record(value.decision.workflow) ? value.decision.workflow : undefined
    if (!record(result) || result.runId !== value.workflowRunId || typeof result.workflowId !== 'string' || !SAFE_ID.test(result.workflowId) || (workflow !== undefined && result.workflowId !== workflow.id) || typeof result.executionStatus !== 'string' || !Array.isArray(result.diagnostics) || typeof result.bundleStatus !== 'string') throw new TypeError('ResearchBundle execution result identity is invalid')
  }
  return value as unknown as ResearchBundle
}

function bundleEquivalent(left: ResearchBundle, right: ResearchBundle): boolean {
  const { createdAt: _leftCreatedAt, ...leftValue } = left
  const { createdAt: _rightCreatedAt, ...rightValue } = right
  return isDeepStrictEqual(leftValue, rightValue)
}

function isSessionPendingStatus(value: string): value is 'free_research_pending' | 'skill_plan_pending' { return value === 'free_research_pending' || value === 'skill_plan_pending' }

function isSessionCompletion(existing: ResearchBundle, incoming: ResearchBundle): boolean {
  if (!isSessionPendingStatus(existing.status) || (incoming.status !== 'completed' && incoming.status !== 'failed')) return false
  const prior = record(existing.structuredResult) ? existing.structuredResult : undefined
  const result = record(incoming.structuredResult) ? incoming.structuredResult : undefined
  if (!prior || !result || prior.status !== existing.status || prior.executionBoundary !== 'session') return false
  if (result.status !== incoming.status || result.executionBoundary !== 'session') return false
  const expectedMode = existing.status === 'free_research_pending' ? 'free_research' : 'skill_plan'
  if (existing.decision.mode !== expectedMode) return false

  const expectedKeys = ['executionBoundary', 'status', 'selectedSkills', 'sourceLibraryHits', 'entities', 'evidenceRefs', 'proposalCandidates']
  const terminalKeys = incoming.status === 'completed' ? [...expectedKeys, 'answer'] : [...expectedKeys, 'error']
  if (Object.keys(result).some((key) => !terminalKeys.includes(key))) return false
  if (incoming.status === 'completed') {
    if (typeof result.answer !== 'string' || result.answer.length === 0 || result.answer.length > 50_000 || 'error' in result) return false
  } else if (result.error !== 'No assistant output was captured for the Free Research session.' || 'answer' in result) return false

  const evidenceRefs = existing.sourceLibraryHits.map((hit) => hit.sourceLibraryRef)
  if (!isDeepStrictEqual(result.selectedSkills, existing.decision.skills)
    || !isDeepStrictEqual(result.sourceLibraryHits, existing.sourceLibraryHits)
    || !isDeepStrictEqual(result.entities, existing.decision.entities)
    || !isDeepStrictEqual(result.evidenceRefs, evidenceRefs)
    || !isDeepStrictEqual(result.proposalCandidates, existing.proposals)) return false

  const { status: _existingStatus, structuredResult: _existingResult, ...existingIdentity } = existing
  const { status: _incomingStatus, structuredResult: _incomingResult, ...incomingIdentity } = incoming
  return isDeepStrictEqual(existingIdentity, incomingIdentity)
}

export class FileResearchBundleStore implements ResearchBundleStore {
  private static readonly writeTails = new Map<string, Promise<void>>()
  private readonly root: string
  constructor(root: string) { this.root = resolve(root) }
  async put(bundle: ResearchBundle): Promise<void> {
    validateBundle(bundle)
    await mkdir(this.root, { recursive: true })
    const target = join(this.root, `${bundle.bundleId}.json`)
    await this.withWriteLock(target, async () => {
      const existing = await this.get(bundle.bundleId)
      if (existing !== undefined) {
        if (bundleEquivalent(existing, bundle)) return
        if (!isSessionCompletion(existing, bundle)) throw new ApplicationServiceError('conflict', `ResearchBundle run identity conflict: ${bundle.workflowRunId}`)
        await this.writeAtomic(target, bundle, true)
        return
      }
      await this.writeAtomic(target, bundle, false)
    })
  }
  async get(bundleId: string): Promise<ResearchBundle | undefined> { safeId(bundleId, 'bundleId'); try { return validateBundle(JSON.parse(await readFile(join(this.root, `${bundleId}.json`), 'utf8'))) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } }
  async list(limit = 50): Promise<readonly ResearchBundle[]> { const bounded = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50; let names: string[] = []; try { names = await readdir(this.root) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return [] } const bundles: ResearchBundle[] = []; for (const name of names.filter((item) => item.endsWith('.json')).sort().reverse().slice(0, bounded)) { try { bundles.push(validateBundle(JSON.parse(await readFile(join(this.root, name), 'utf8')))) } catch { /* malformed derived records are skipped; raw workflow output remains authoritative */ } } return bundles.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }

  private async withWriteLock<T>(target: string, operation: () => Promise<T>): Promise<T> {
    const previous = FileResearchBundleStore.writeTails.get(target) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveCurrent) => { release = resolveCurrent })
    const tail = previous.catch(() => undefined).then(() => current)
    FileResearchBundleStore.writeTails.set(target, tail)
    await previous.catch(() => undefined)
    try { return await operation() }
    finally {
      release()
      if (FileResearchBundleStore.writeTails.get(target) === tail) FileResearchBundleStore.writeTails.delete(target)
    }
  }

  protected async writeAtomic(target: string, bundle: ResearchBundle, replace: boolean): Promise<void> {
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporary, 'wx')
      await handle.writeFile(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
      await handle.sync()
      await handle.close()
      handle = undefined
      if (replace) await rename(temporary, target)
      else await link(temporary, target)
    } finally {
      if (handle !== undefined) await handle.close().catch(() => undefined)
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
}
