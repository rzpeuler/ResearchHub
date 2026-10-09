import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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

export class FileResearchBundleStore implements ResearchBundleStore {
  private readonly root: string
  constructor(root: string) { this.root = resolve(root) }
  async put(bundle: ResearchBundle): Promise<void> {
    validateBundle(bundle)
    await mkdir(this.root, { recursive: true })
    const target = join(this.root, `${bundle.bundleId}.json`)
    try {
      const existing = validateBundle(JSON.parse(await readFile(target, 'utf8')))
      if (!bundleEquivalent(existing, bundle)) throw new Error(`ResearchBundle run identity conflict: ${bundle.workflowRunId}`)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    try { await writeFile(target, `${JSON.stringify(bundle, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' }) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await this.get(bundle.bundleId)
      if (existing !== undefined && bundleEquivalent(existing, bundle)) return
      throw new ApplicationServiceError('conflict', `ResearchBundle run identity conflict: ${bundle.workflowRunId}`, { cause: error })
    }
  }
  async get(bundleId: string): Promise<ResearchBundle | undefined> { safeId(bundleId, 'bundleId'); try { return validateBundle(JSON.parse(await readFile(join(this.root, `${bundleId}.json`), 'utf8'))) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error } }
  async list(limit = 50): Promise<readonly ResearchBundle[]> { const bounded = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50; let names: string[] = []; try { names = await readdir(this.root) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return [] } const bundles: ResearchBundle[] = []; for (const name of names.filter((item) => item.endsWith('.json')).sort().reverse().slice(0, bounded)) { try { bundles.push(validateBundle(JSON.parse(await readFile(join(this.root, name), 'utf8')))) } catch { /* malformed derived records are skipped; raw workflow output remains authoritative */ } } return bundles.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
}
