import { readdir, lstat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { runCompanyDeepResearch } from '../../workflows/company-deep-research/workflow.ts'
import { runIndustryDeepResearch } from '../../workflows/industry-deep-research/workflow.ts'
import { runEarningsReview } from '../../workflows/earnings-review/workflow.ts'
import { runValuation } from '../../workflows/valuation/workflow.ts'
import { runEventResearch } from '../../workflows/event-research/workflow.ts'
import { runThesisRedTeam } from '../../workflows/thesis-red-team/workflow.ts'
import type { EventResearchSignalStore } from '../../plugins/daily-intelligence/contracts.ts'
import type { ResearchAcquisitionPlugin, ResearchCompanyIdentity, ResearchProviderOutcome, ResearchSignalStore } from '../../plugins/research-acquisition/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import type { OfficialDisclosureClient } from '../../plugins/research-acquisition/official.ts'
import { AkshareIndustryResearchPlugin } from '../../plugins/research-acquisition/industry.ts'
import { IndustryAcquisitionComposition } from '../../plugins/research-acquisition/industry-composition.ts'
import { ApplicationServiceError, type ApplicationEarningsReviewResult, type ApplicationEventResearchResult, type ApplicationResearchResult, type ApplicationValuationResult, type ApplicationThesisRedTeamResult, type ApplicationIndustryResearchResult, type EarningsReviewInput, type EventResearchInput, type IndustryResearchInput, type ResearchCompanyInput, type ThesisRedTeamInput, type ValuationInput } from './contracts.ts'
import { WorkflowService } from './workflow-service.ts'
import { readResearchReport, summarizeResearchReport, validateResearchReport, writeResearchReport, type ResearchReport, type ResearchReportSummary } from './research-report.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { withSourceLibraryContext } from './reasoning-context.ts'
import type { ManagementCommunicationAcquisitionSources } from '../../workflows/management-communication-acquisition/contracts.ts'
import type { IndustryOperatingObservationAcquisitionPort } from '../../plugins/research-acquisition/industry-operating-observations.ts'
import { ThesisLifecycleService, type ThesisLifecycleRefreshInput, type ApplicationThesisLifecycleResult, type ThesisLifecycleDecisionReportInput, type ThesisLifecycleDecisionReportResult } from './thesis-lifecycle-service.ts'
import { ThesisCreateService, type ThesisCreateInput, type ThesisCreateServiceResult } from './thesis-create-service.ts'
import { triggerThemeScopeImpactPostWrite, type ThemeScopeImpactChecker, type ThemeScopeImpactTriggerResult } from '../../workflows/theme-scope-impact-check/post-write.ts'

export type ThesisLifecycleCreateInput = ThesisCreateInput
export interface ApplicationThesisLifecycleCreateResult extends ThesisCreateServiceResult {
  readonly summary?: string
  readonly errorSummary?: string
  readonly reportId?: string
  readonly reportPath?: string
}

interface PersistedThesisCreateResult { readonly inputFingerprint: string; readonly result: ApplicationThesisLifecycleCreateResult }

const CREATE_RESULT_MARKER = /<!-- THESIS_LIFECYCLE_CREATE_RESULT_V1:([A-Za-z0-9_-]+) -->/
const createFingerprint = (input: ThesisLifecycleCreateInput): string => createHash('sha256').update(JSON.stringify({ ...input, thesisTitle: input.thesisTitle.trim(), narrative: input.narrative.trim(), evidenceRefs: [...input.evidenceRefs].sort() })).digest('hex')
const encodeCreateResult = (value: PersistedThesisCreateResult): string => `<!-- THESIS_LIFECYCLE_CREATE_RESULT_V1:${Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')} -->`

function decodeCreateResult(report: ResearchReport): PersistedThesisCreateResult | undefined {
  const markdown = report.sections.find((section) => section.id === 'create-run-result')?.markdown
  const match = markdown?.match(CREATE_RESULT_MARKER)
  if (!match) return undefined
  try {
    const value = JSON.parse(Buffer.from(match[1]!, 'base64url').toString('utf8')) as PersistedThesisCreateResult
    return value && typeof value.inputFingerprint === 'string' && value.result?.mode === 'CREATE' && value.result.status === 'completed' && value.result.runId === report.workflowRunId ? value : undefined
  } catch { return undefined }
}

function buildThesisCreateReport(input: ThesisLifecycleCreateInput, result: ThesisCreateServiceResult, fingerprint: string, generatedAt: string): ResearchReport {
  const reportId = `thesis-lifecycle-${input.workflowRunId}`
  const sourceRefs = [...new Set(result.evidenceDecisions.flatMap((decision) => decision.sourceBindings.map((binding) => binding.sourceRef)))].sort()
  const claimRefs = [...new Set(Object.values(result.claimRefsByPropositionRef))].sort()
  const evidence = result.evidenceDecisions.map((decision) => `- ${decision.evidenceRef}: ${decision.decision}${decision.publishedAt ? `; published ${decision.publishedAt}` : ''}${decision.reason ? `; ${decision.reason}` : ''}${decision.sourceBindings.length ? `; ${decision.sourceBindings.map((binding) => `${binding.sourceRef} -> ${binding.rawRef}`).join(', ')}` : ''}`).join('\n') || 'No canonical evidence decisions were recorded.'
  const propositions = Object.entries(result.claimRefsByPropositionRef).sort(([a], [b]) => a.localeCompare(b)).map(([propositionRef, claimRef]) => `- ${propositionRef} -> ${claimRef}${result.qualifiesEdgeRefsByPropositionRef[propositionRef] ? ` via ${result.qualifiesEdgeRefsByPropositionRef[propositionRef]}` : ''}; evidence ${(result.evidenceRefsByPropositionRef[propositionRef] ?? []).join(', ') || 'none'}`).join('\n') || 'No canonical propositions were committed.'
  const gaps = result.researchGaps.map((gap) => `- ${gap.gapId}: ${gap.statement}${gap.affectedPropositionRefs.length ? ` (affects ${gap.affectedPropositionRefs.join(', ')})` : ''}`).join('\n') || 'No research gaps were identified.'
  const runResult: ApplicationThesisLifecycleCreateResult = { ...result, reportId, reportPath: `${reportId}.md`, summary: `Thesis CREATE ${result.status} for ${input.companyRef}` }
  return validateResearchReport({
    reportId, reportType: 'thesis_lifecycle', subjectRefs: [input.companyRef], generatedAt, asOf: input.asOf, workflowRunId: input.workflowRunId,
    knowledgeBaseRevision: result.committedRevision ?? result.baseRevision ?? 0, sourceRefs, claimRefs,
    methodology: 'Thesis CREATE uses Thesis Formalize semantic reasoning over explicitly selected canonical, active, company-scoped, source-bound evidence at the requested point in time. Canonical Thesis, Claim, and qualifies membership writes are validated and committed through Knowledge Production Gateway and Writer.',
    sections: [
      { id: 'thesis-created', title: 'Thesis Created', markdown: `Company: ${result.companyRef}\n\nTitle: ${result.thesisTitle}\n\nThesis: ${result.thesisRef ?? 'Not created'}\n\nInitial status: ${result.thesisInitialStatus ?? 'Not created'}\n\nSummary: ${result.thesisSummary ?? 'No canonical Thesis summary was produced.'}` },
      { id: 'propositions', title: 'Canonical Propositions and Membership', markdown: propositions, claimRefs },
      { id: 'evidence-pit', title: 'Evidence and Point-in-Time Bindings', markdown: evidence, sourceRefs },
      { id: 'research-gaps', title: 'Research Gaps', markdown: gaps },
      { id: 'writer-state', title: 'Gateway and Writer State', markdown: `Knowledge Base: ${result.knowledgeBaseId ?? 'unavailable'}\n\nBase revision: ${result.baseRevision ?? 'unavailable'}\n\nCommitted revision: ${result.committedRevision ?? 'no canonical write'}\n\nWriter run: ${result.writerRunId ?? 'no canonical write'}\n\nMembership convention: ${result.membershipBindingConvention}` },
      { id: 'create-run-result', title: 'CREATE Result Metadata', markdown: encodeCreateResult({ inputFingerprint: fingerprint, result: runResult }) },
      { id: 'diagnostics', title: 'Diagnostics', markdown: result.diagnostics.length ? result.diagnostics.slice(0, 24).map((item) => `- ${item}`).join('\n') : 'None.' },
    ], outputPath: `${reportId}.md`,
  })
}

export interface ResearchServiceOptions {
  readonly mountedKnowledgeBaseRoot: string
  readonly reportRoot?: string
  readonly acquisitionPlugins: readonly ResearchAcquisitionPlugin[]
  readonly industryAcquisitionPlugins?: readonly ResearchAcquisitionPlugin[]
  readonly akshare?: AkshareDataClient
  readonly officialDisclosure?: OfficialDisclosureClient
  readonly signalStore?: ResearchSignalStore
  readonly dailySignalStore?: EventResearchSignalStore
  readonly workflowService: WorkflowService
  readonly cwd?: string
  readonly reasoningExecutor?: ReasoningExecutor
  readonly managementCommunicationSources?: ManagementCommunicationAcquisitionSources
  readonly industryReasoningExecutorFactory?: () => Promise<ReasoningExecutor>
  readonly industryOperatingObservationAcquisition?: IndustryOperatingObservationAcquisitionPort
  readonly themeScopeImpactChecker?: ThemeScopeImpactChecker
}

export class ResearchService {
  private readonly registry = new KnowledgeBaseRegistry()
  private readonly thesisLifecycleService: ThesisLifecycleService
  private readonly thesisCreateService: ThesisCreateService
  private readonly thesisCreateStarts = new Map<string, { readonly fingerprint: string; readonly completion: Promise<ApplicationThesisLifecycleCreateResult> }>()

  constructor(private readonly options: ResearchServiceOptions) {
    this.thesisLifecycleService = new ThesisLifecycleService({ mountedKnowledgeBaseRoot: options.mountedKnowledgeBaseRoot, reportRoot: options.reportRoot, cwd: options.cwd, workflowService: options.workflowService, reasoningExecutor: options.reasoningExecutor })
    this.thesisCreateService = new ThesisCreateService({ mountedKnowledgeBaseRoot: options.mountedKnowledgeBaseRoot, reasoningExecutor: options.reasoningExecutor })
  }

  startThesisLifecycleRefresh(input: ThesisLifecycleRefreshInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationThesisLifecycleResult> } {
    return this.thesisLifecycleService.startRefresh(input, callerSignal)
  }

  startThesisLifecycleCreate(input: ThesisLifecycleCreateInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationThesisLifecycleCreateResult> } {
    if (!input || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(input.workflowRunId) || input.workflowRunId.includes('..') || !/^entity:[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.companyRef) || typeof input.thesisTitle !== 'string' || !input.thesisTitle.trim() || typeof input.narrative !== 'string' || !input.narrative.trim() || !Array.isArray(input.evidenceRefs) || input.evidenceRefs.length === 0 || input.evidenceRefs.length > 40 || input.evidenceRefs.some((ref) => typeof ref !== 'string' || !/^(claim|observation):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(ref)) || new Set(input.evidenceRefs).size !== input.evidenceRefs.length || !Number.isFinite(Date.parse(input.asOf))) throw new ApplicationServiceError('invalid_input', 'Thesis CREATE requires a safe run ID, company Entity, title, narrative, canonical Claim/Observation refs, and valid asOf')
    const normalized: ThesisLifecycleCreateInput = { ...input, thesisTitle: input.thesisTitle.trim(), narrative: input.narrative.trim(), evidenceRefs: [...input.evidenceRefs].sort() }
    const fingerprint = createFingerprint(normalized)
    const previous = this.thesisCreateStarts.get(normalized.workflowRunId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new ApplicationServiceError('conflict', 'runId is already bound to a different Thesis CREATE input')
      return { runId: normalized.workflowRunId, completion: previous.completion }
    }

    const runId = normalized.workflowRunId
    this.options.workflowService.register({ runId, workflowType: 'thesis_lifecycle', objective: `Create Thesis ${normalized.thesisTitle}` })
    const completion = this.options.workflowService.start(runId, async (signal) => {
      if (signal.aborted || callerSignal?.aborted) throw new ApplicationServiceError('cancelled', `Thesis CREATE cancelled: ${runId}`)
      const reportRoot = resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports'))
      const reportId = `thesis-lifecycle-${runId}`
      const reportPath = join(reportRoot, `${reportId}.md.json`)
      try {
        const existing = await readResearchReport(reportPath)
        const persisted = decodeCreateResult(existing)
        if (existing.reportId !== reportId || existing.reportType !== 'thesis_lifecycle' || existing.workflowRunId !== runId || existing.subjectRefs[0] !== normalized.companyRef || existing.asOf !== normalized.asOf || !persisted) return this.thesisCreateFailure(normalized, ['THESIS_CREATE_REPLAY_REPORT_INVALID'])
        if (persisted.inputFingerprint !== fingerprint) return this.thesisCreateFailure(normalized, ['THESIS_CREATE_REPLAY_INPUT_CONFLICT'])
        await writeResearchReport(existing, reportRoot)
        return persisted.result
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          if (error instanceof ApplicationServiceError) return this.thesisCreateFailure(normalized, [`THESIS_CREATE_REPLAY_${error.code.toUpperCase()}`])
          return this.thesisCreateFailure(normalized, ['THESIS_CREATE_REPLAY_REPORT_UNREADABLE'])
        }
      }

      // A Writer log without its CREATE report means the canonical write may
      // have committed. Fail closed before Pi formalization to avoid a new
      // semantic result being compared against or duplicating that write.
      try {
        await lstat(join(resolve(this.options.mountedKnowledgeBaseRoot), 'logs', 'research', `${runId}.yaml`))
        return this.thesisCreateFailure(normalized, ['THESIS_CREATE_COMMITTED_WITHOUT_DURABLE_REPORT'])
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return this.thesisCreateFailure(normalized, ['THESIS_CREATE_WRITER_LOG_STATE_UNAVAILABLE'])
      }

      const result = await this.thesisCreateService.create(normalized)
      if (result.status !== 'completed') return { ...result, summary: `Thesis CREATE ${result.status} for ${normalized.companyRef}`, ...(result.status === 'failed' ? { errorSummary: result.diagnostics.join('; ').slice(0, 500) } : {}) }
      const report = buildThesisCreateReport(normalized, result, fingerprint, new Date().toISOString())
      try {
        const writtenPath = await writeResearchReport(report, reportRoot)
        // JSON is the catalog's durable record. Validate it after writing
        // before allowing WorkflowService to publish a completed outcome.
        const persisted = await readResearchReport(`${writtenPath}.json`)
        const decoded = decodeCreateResult(persisted)
        if (persisted.reportId !== reportId || decoded?.inputFingerprint !== fingerprint || decoded.result.status !== 'completed') return this.thesisCreateFailure(normalized, ['THESIS_CREATE_REPORT_COMMIT_VERIFY_FAILED'], result)
        return decoded.result
      } catch {
        return this.thesisCreateFailure(normalized, ['THESIS_CREATE_REPORT_PERSISTENCE_FAILED'], result)
      }
    }).then((outcome) => outcome as ApplicationThesisLifecycleCreateResult)
    completion.catch(() => undefined)
    this.thesisCreateStarts.set(runId, { fingerprint, completion })
    return { runId, completion }
  }

  private thesisCreateFailure(input: ThesisLifecycleCreateInput, diagnostics: readonly string[], prior?: ThesisCreateServiceResult): ApplicationThesisLifecycleCreateResult {
    return { mode: 'CREATE', runId: input.workflowRunId, asOf: input.asOf, status: 'failed', companyRef: input.companyRef, thesisTitle: input.thesisTitle, claimRefsByPropositionRef: prior?.claimRefsByPropositionRef ?? {}, qualifiesEdgeRefsByPropositionRef: prior?.qualifiesEdgeRefsByPropositionRef ?? {}, evidenceRefsByPropositionRef: prior?.evidenceRefsByPropositionRef ?? {}, membershipBindingConvention: 'claim_to_thesis_qualifies', evidenceDecisions: prior?.evidenceDecisions ?? [], researchGaps: prior?.researchGaps ?? [], ...(prior?.knowledgeBaseId === undefined ? {} : { knowledgeBaseId: prior.knowledgeBaseId }), ...(prior?.baseRevision === undefined ? {} : { baseRevision: prior.baseRevision }), ...(prior?.committedRevision === undefined ? {} : { committedRevision: prior.committedRevision }), ...(prior?.writerRunId === undefined ? {} : { writerRunId: prior.writerRunId }), diagnostics, summary: `Thesis CREATE failed for ${input.companyRef}`, errorSummary: diagnostics.join('; ').slice(0, 500) }
  }

  recordThesisLifecycleDecision(input: ThesisLifecycleDecisionReportInput): Promise<ThesisLifecycleDecisionReportResult> {
    return this.thesisLifecycleService.updateDecisionReport(input)
  }

  startResearchCompany(input: ResearchCompanyInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationResearchResult & { readonly themeScopeImpact: ThemeScopeImpactTriggerResult }> } {
    if (!input || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.workflowRunId) || !/^\d{6}$/.test(input.symbol)) {
      throw new ApplicationServiceError('invalid_input', 'workflowRunId and A-share symbol are invalid')
    }
    const company: ResearchCompanyIdentity = {
      symbol: input.symbol,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.exchange === undefined ? {} : { exchange: input.exchange }),
    }
    this.options.workflowService.register({
      runId: input.workflowRunId,
      workflowType: 'company_deep_research',
      objective: `Company research ${input.symbol}`,
    })
    const completion = this.options.workflowService.start(input.workflowRunId, async (signal) => {
      const combined = new AbortController()
      const abort = () => combined.abort()
      signal.addEventListener('abort', abort, { once: true })
      callerSignal?.addEventListener('abort', abort, { once: true })
      try {
        const handle = await this.registry.mount(resolve(this.options.mountedKnowledgeBaseRoot))
        const result = await runCompanyDeepResearch({
          workflowRunId: input.workflowRunId,
          handle,
          company,
          acquisitionPlugins: this.options.acquisitionPlugins,
          akshare: this.options.akshare,
          asOf: input.asOf,
          reportRoot: resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports')),
          signal: combined.signal,
          signalStore: this.options.signalStore,
          reasoningExecutor: withSourceLibraryContext(this.options.reasoningExecutor, input.sourceLibraryContext), writeKnowledge: input.writeKnowledge, useStructuredKnowledge: input.useStructuredKnowledge,
        })
        if (result.status === 'completed') {
          this.options.workflowService.markAuthoritativeTerminal(input.workflowRunId, 'completed', { summary: `Company research completed for ${input.symbol}` })
        }
        return {
          status: result.status,
          summary: result.status === 'completed' ? `Company research completed for ${input.symbol}` : 'Company research did not complete',
          errorSummary: result.errors.join('; ').slice(0, 500),
          workflow: result,
        }
      } finally {
        signal.removeEventListener('abort', abort)
        callerSignal?.removeEventListener('abort', abort)
      }
    }).then(async (outcome) => {
      const impact = outcome.workflow.status === 'completed' && (outcome.workflow.createdIds.length + outcome.workflow.updatedIds.length > 0)
        ? await triggerThemeScopeImpactPostWrite({ mountedKnowledgeBaseRoot: resolve(this.options.mountedKnowledgeBaseRoot), writerRunId: input.workflowRunId, expectedKnowledgeBaseId: outcome.workflow.knowledgeBaseId, ...(outcome.workflow.knowledgeBaseRevision === undefined ? {} : { expectedCommittedRevision: outcome.workflow.knowledgeBaseRevision }), expectedCreatedIds: outcome.workflow.createdIds, expectedUpdatedIds: outcome.workflow.updatedIds, checker: this.options.themeScopeImpactChecker })
        : { status: 'not_triggered' as const, diagnostics: [outcome.workflow.status !== 'completed' ? 'Company Research did not complete successfully.' : 'Company Research completed without canonical writes.'] }
      return ({
      runId: input.workflowRunId,
      status: outcome.status,
      knowledgeBaseId: outcome.workflow.knowledgeBaseId,
      ...(outcome.workflow.report === undefined ? {} : {
        reportId: outcome.workflow.report.reportId,
        // Keep the application/API contract relative; the server owns report storage.
        reportPath: `${outcome.workflow.report.reportId}.md`,
      }),
      committedIds: outcome.workflow.committedIds,
      proposalCount: outcome.workflow.proposalIds.length,
      summary: outcome.summary,
      ...(outcome.errorSummary ? { errorSummary: outcome.errorSummary } : {}),
      themeScopeImpact: impact,
    })
    })
    completion.catch(() => undefined)
    return { runId: input.workflowRunId, completion }
  }

  startIndustryResearch(input: IndustryResearchInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationIndustryResearchResult & { readonly themeScopeImpact: ThemeScopeImpactTriggerResult }> } {
    if (!input || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.workflowRunId) || typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > 200) throw new ApplicationServiceError('invalid_input', 'workflowRunId and Industry name are invalid')
    if (input.canonicalRef !== undefined && !/^entity:[A-Za-z0-9._-]+$/.test(input.canonicalRef)) throw new ApplicationServiceError('invalid_input', 'canonicalRef is invalid')
    if (input.aliases !== undefined && (!Array.isArray(input.aliases) || input.aliases.length > 8 || input.aliases.some((x) => typeof x !== 'string' || !x.trim() || x.length > 120))) throw new ApplicationServiceError('invalid_input', 'aliases are invalid')
    if (input.searchTerms !== undefined && (!Array.isArray(input.searchTerms) || input.searchTerms.length > 8 || input.searchTerms.some((x) => typeof x !== 'string' || !x.trim() || x.length > 120))) throw new ApplicationServiceError('invalid_input', 'searchTerms are invalid')
    if (input.maxSources !== undefined && (!Number.isSafeInteger(input.maxSources) || input.maxSources < 1 || input.maxSources > 50)) throw new ApplicationServiceError('invalid_input', 'maxSources is invalid')
    if (input.maxEvidencePerModule !== undefined && (!Number.isSafeInteger(input.maxEvidencePerModule) || input.maxEvidencePerModule < 1 || input.maxEvidencePerModule > 12)) throw new ApplicationServiceError('invalid_input', 'maxEvidencePerModule is invalid')
    if (input.useStructuredKnowledge === false) throw new ApplicationServiceError('conflict', 'Industry Research requires structured Knowledge context and cannot run with it disabled')
    const target = { name: input.name.trim(), ...(input.aliases === undefined ? {} : { aliases: input.aliases.map((x) => x.trim()) }), ...(input.canonicalRef === undefined ? {} : { canonicalRef: input.canonicalRef }), ...(input.asOf === undefined ? {} : { asOf: input.asOf }) }
    const industryReasoningExecutorFactory = this.options.industryReasoningExecutorFactory
      ?? (this.options.reasoningExecutor === undefined ? undefined : async () => this.options.reasoningExecutor!)
    if (!industryReasoningExecutorFactory) throw new ApplicationServiceError('failed', 'Industry Research requires a configured ReasoningExecutor')
    const plugins = [...this.options.acquisitionPlugins, ...(this.options.industryAcquisitionPlugins ?? [])]; if (this.options.akshare) plugins.push(new AkshareIndustryResearchPlugin(this.options.akshare))
    const composition = new IndustryAcquisitionComposition(plugins)
    this.options.workflowService.register({ runId: input.workflowRunId, workflowType: 'industry_deep_research', objective: `Industry research ${target.name}` })
    const completion = this.options.workflowService.start(input.workflowRunId, async (signal) => {
      const combined = new AbortController(); const abort = () => combined.abort(); signal.addEventListener('abort', abort, { once: true }); callerSignal?.addEventListener('abort', abort, { once: true }); let diagnostics: readonly string[] = []; let outcomes: readonly ResearchProviderOutcome[] = []
      try { const reasoningExecutor = withSourceLibraryContext(await industryReasoningExecutorFactory(), input.sourceLibraryContext); const handle = await this.registry.mount(resolve(this.options.mountedKnowledgeBaseRoot)); const result = await runIndustryDeepResearch({ workflowRunId: input.workflowRunId, handle, target, reportRoot: resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports')), reasoningExecutor: reasoningExecutor!, maxSources: input.maxSources, maxEvidencePerModule: input.maxEvidencePerModule, writeKnowledge: input.writeKnowledge, useStructuredKnowledge: input.useStructuredKnowledge, signal: combined.signal, operatingObservationAcquisition: this.options.industryOperatingObservationAcquisition, acquisitionWave: async (request) => { const baseSearchTerms = input.searchTerms ?? request.searchTerms; const searchTerms = request.wave === 1 ? baseSearchTerms : [...new Set([...request.searchTerms, ...baseSearchTerms])].slice(0, 8); const acquired = await composition.acquire({ ...request, searchTerms }); diagnostics = [...diagnostics, ...acquired.diagnostics].slice(0, 32); const prior = new Map<string, ResearchProviderOutcome>(outcomes.map((outcome) => [outcome.provider, outcome])); for (const outcome of acquired.outcomes) { const previous = prior.get(outcome.provider); prior.set(outcome.provider, previous === undefined ? outcome : { provider: previous.provider, providerAttempted: previous.providerAttempted || outcome.providerAttempted, providerSucceeded: previous.providerSucceeded || outcome.providerSucceeded, providerEmpty: previous.providerEmpty && outcome.providerEmpty, providerFailed: previous.providerFailed || outcome.providerFailed, usableSourceCount: Math.min(24, previous.usableSourceCount + outcome.usableSourceCount) }) } outcomes = [...prior.values()].slice(0, 8); return acquired.sources } }); return { status: result.status, workflow: result, diagnostics, outcomes } } finally { signal.removeEventListener('abort', abort); callerSignal?.removeEventListener('abort', abort) }
    }).then(async (outcome) => {
      const impact = outcome.workflow.status === 'completed' && (outcome.workflow.createdIds.length + outcome.workflow.updatedIds.length > 0)
        ? await triggerThemeScopeImpactPostWrite({ mountedKnowledgeBaseRoot: resolve(this.options.mountedKnowledgeBaseRoot), writerRunId: input.workflowRunId, expectedKnowledgeBaseId: outcome.workflow.knowledgeBaseId, expectedCommittedRevision: outcome.workflow.knowledgeBaseRevision, expectedCreatedIds: outcome.workflow.createdIds, expectedUpdatedIds: outcome.workflow.updatedIds, checker: this.options.themeScopeImpactChecker })
        : { status: 'not_triggered' as const, diagnostics: [outcome.workflow.status !== 'completed' ? 'Industry Research did not complete successfully.' : 'Industry Research completed without canonical writes.'] }
      return { runId: input.workflowRunId, status: outcome.status, knowledgeBaseId: outcome.workflow.knowledgeBaseId, ...(outcome.workflow.report === undefined ? {} : { reportId: outcome.workflow.report.reportId, reportPath: `${outcome.workflow.report.reportId}.md` }), committedIds: outcome.workflow.committedIds, proposalCount: outcome.workflow.proposalIds.length, summary: outcome.workflow.status === 'completed' ? `Industry research completed for ${target.name}` : `Industry research ${outcome.workflow.status} for ${target.name}`, ...(outcome.workflow.errors.length ? { errorSummary: outcome.workflow.errors.join('; ').slice(0, 500) } : {}), providerOutcomes: outcome.outcomes, acquisitionDiagnostics: outcome.diagnostics, operatingObservations: outcome.workflow.operatingObservations, operatingObservationStatus: outcome.workflow.operatingObservationStatus, operatingObservationDiagnostics: outcome.workflow.operatingObservationDiagnostics, themeScopeImpact: impact }
    })
    completion.catch(() => undefined); return { runId: input.workflowRunId, completion }
  }

  startEarningsReview(input: EarningsReviewInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationEarningsReviewResult> } {
    if (!input || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.workflowRunId) || !/^\d{6}$/.test(input.symbol) || !Number.isInteger(input.fiscalYear) || !['Q1', 'H1', 'Q3', 'FY'].includes(input.period)) throw new ApplicationServiceError('invalid_input', 'workflowRunId, A-share symbol, fiscalYear, and period are invalid')
    const company: ResearchCompanyIdentity = { symbol: input.symbol, ...(input.name === undefined ? {} : { name: input.name }), ...(input.exchange === undefined ? {} : { exchange: input.exchange }) }
    this.options.workflowService.register({ runId: input.workflowRunId, workflowType: 'earnings_review', objective: `Earnings review ${input.symbol} ${input.fiscalYear}-${input.period}` })
    const completion = this.options.workflowService.start(input.workflowRunId, async (signal) => {
      const combined = new AbortController(); const abort = () => combined.abort(); signal.addEventListener('abort', abort, { once: true }); callerSignal?.addEventListener('abort', abort, { once: true })
      try {
        const handle = await this.registry.mount(resolve(this.options.mountedKnowledgeBaseRoot)); const result = await runEarningsReview({ workflowRunId: input.workflowRunId, handle, company, fiscalYear: input.fiscalYear, period: input.period, asOf: input.asOf, reportRoot: resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports')), acquisitionPlugins: this.options.acquisitionPlugins, akshare: this.options.akshare, managementCommunicationSources: this.options.managementCommunicationSources, reasoningExecutor: withSourceLibraryContext(this.options.reasoningExecutor, input.sourceLibraryContext), writeKnowledge: input.writeKnowledge, useStructuredKnowledge: input.useStructuredKnowledge, signal: combined.signal })
        return { runId: input.workflowRunId, status: result.status, knowledgeBaseId: result.knowledgeBaseId, ...(result.report === undefined ? {} : { reportId: result.report.reportId, reportPath: `${result.report.reportId}.md` }), committedIds: result.committedIds, proposalCount: result.proposalIds.length, summary: result.status === 'completed' ? `Earnings review completed for ${input.symbol} ${input.fiscalYear}-${input.period}` : `Earnings review ${result.status} for ${input.symbol}`, ...(result.errors.length ? { errorSummary: result.errors.join('; ').slice(0, 500) } : {}), telemetry: result.telemetry, ...(result.blockedReason === undefined ? {} : { blockedReason: result.blockedReason }) }
      } finally { signal.removeEventListener('abort', abort); callerSignal?.removeEventListener('abort', abort) }
    }).then((outcome) => outcome as ApplicationEarningsReviewResult)
    completion.catch(() => undefined); return { runId: input.workflowRunId, completion }
  }

  startValuation(input: ValuationInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationValuationResult> } {
    if (!input || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.workflowRunId) || !/^\d{6}$/.test(input.symbol) || (input.methods !== undefined && (!Array.isArray(input.methods) || input.methods.some((method) => !['PE', 'PB', 'EV_EBITDA'].includes(method))))) throw new ApplicationServiceError('invalid_input', 'workflowRunId, A-share symbol, and valuation methods are invalid')
    if (input.targetFiscalYear !== undefined && !Number.isInteger(input.targetFiscalYear)) throw new ApplicationServiceError('invalid_input', 'targetFiscalYear must be an integer')
    const company: ResearchCompanyIdentity = { symbol: input.symbol, ...(input.name === undefined ? {} : { name: input.name }), ...(input.exchange === undefined ? {} : { exchange: input.exchange }) }
    this.options.workflowService.register({ runId: input.workflowRunId, workflowType: 'valuation', objective: `Valuation ${input.symbol}` })
    const completion = this.options.workflowService.start(input.workflowRunId, async (signal) => {
      const combined = new AbortController(); const abort = () => combined.abort(); signal.addEventListener('abort', abort, { once: true }); callerSignal?.addEventListener('abort', abort, { once: true })
      try {
        const handle = await this.registry.mount(resolve(this.options.mountedKnowledgeBaseRoot)); const result = await runValuation({ workflowRunId: input.workflowRunId, handle, company, asOf: input.asOf, methods: input.methods, targetFiscalYear: input.targetFiscalYear, reportRoot: resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports')), akshare: this.options.akshare, officialDisclosure: this.options.officialDisclosure, reasoningExecutor: withSourceLibraryContext(this.options.reasoningExecutor, input.sourceLibraryContext), writeKnowledge: input.writeKnowledge, useStructuredKnowledge: input.useStructuredKnowledge, signal: combined.signal })
        return { runId: input.workflowRunId, status: result.status, knowledgeBaseId: result.knowledgeBaseId, ...(result.report === undefined ? {} : { reportId: result.report.reportId, reportPath: `${result.report.reportId}.md` }), committedIds: result.committedIds, proposalCount: result.proposalIds.length, summary: result.status === 'completed' ? `Valuation completed for ${input.symbol}` : `Valuation ${result.status} for ${input.symbol}`, ...(result.errors.length ? { errorSummary: result.errors.join('; ').slice(0, 500) } : {}), telemetry: result.telemetry, providerOutcome: result.providerOutcome, ...(result.automaticCompsResult === undefined ? {} : { automaticCompsResult: result.automaticCompsResult }), ...(result.crosscheck === undefined ? {} : { crosscheck: result.crosscheck }), ...(result.blockedReason === undefined ? {} : { blockedReason: result.blockedReason }) }
      } finally { signal.removeEventListener('abort', abort); callerSignal?.removeEventListener('abort', abort) }
    }).then((outcome) => outcome as ApplicationValuationResult)
    completion.catch(() => undefined); return { runId: input.workflowRunId, completion }
  }

  startEventResearch(input: EventResearchInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationEventResearchResult & { readonly providerOutcome?: unknown }> } {
    if (!input || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.workflowRunId) || !/^\d{6}$/.test(input.symbol)) throw new ApplicationServiceError('invalid_input', 'workflowRunId and A-share symbol are invalid')
    const company: ResearchCompanyIdentity = { symbol: input.symbol, ...(input.name === undefined ? {} : { name: input.name }), ...(input.exchange === undefined ? {} : { exchange: input.exchange }) }
    this.options.workflowService.register({ runId: input.workflowRunId, workflowType: 'event_research', objective: `Event research ${input.symbol}` })
    const completion = this.options.workflowService.start(input.workflowRunId, async (signal) => {
      const combined = new AbortController(); const abort = () => combined.abort(); signal.addEventListener('abort', abort, { once: true }); callerSignal?.addEventListener('abort', abort, { once: true })
      try {
        const handle = await this.registry.mount(resolve(this.options.mountedKnowledgeBaseRoot)); const result = await runEventResearch({ workflowRunId: input.workflowRunId, handle, company, anchor: input.anchor, asOf: input.asOf, reportRoot: resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports')), acquisitionPlugins: this.options.acquisitionPlugins, dailySignalStore: this.options.dailySignalStore, reasoningExecutor: withSourceLibraryContext(this.options.reasoningExecutor, input.sourceLibraryContext), writeKnowledge: input.writeKnowledge, useStructuredKnowledge: input.useStructuredKnowledge, signal: combined.signal })
        return { runId: input.workflowRunId, status: result.status, knowledgeBaseId: result.knowledgeBaseId, ...(result.report === undefined ? {} : { reportId: result.report.reportId, reportPath: `${result.report.reportId}.md` }), committedIds: result.committedIds, proposalCount: result.proposalIds.length, summary: result.status === 'completed' ? `Event research completed for ${input.symbol}` : `Event research ${result.status} for ${input.symbol}`, ...(result.errors.length ? { errorSummary: result.errors.join('; ').slice(0, 500) } : {}), telemetry: result.telemetry, providerOutcome: result.providerOutcomes, ...(result.blockedReason === undefined ? {} : { blockedReason: result.blockedReason }) }
      } finally { signal.removeEventListener('abort', abort); callerSignal?.removeEventListener('abort', abort) }
    }).then((outcome) => outcome as ApplicationEventResearchResult & { readonly providerOutcome?: unknown })
    completion.catch(() => undefined); return { runId: input.workflowRunId, completion }
  }

  startThesisRedTeam(input: ThesisRedTeamInput, callerSignal?: AbortSignal): { readonly runId: string; readonly completion: Promise<ApplicationThesisRedTeamResult> } {
    if (!input || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input.workflowRunId) || !/^\d{6}$/.test(input.symbol) || !/^claim:[^\s]+$/.test(input.thesisRef)) throw new ApplicationServiceError('invalid_input', 'workflowRunId, A-share symbol, and thesisRef are invalid')
    if (input.lookbackDays !== undefined && (!Number.isInteger(input.lookbackDays) || input.lookbackDays < 30 || input.lookbackDays > 1095)) throw new ApplicationServiceError('invalid_input', 'lookbackDays must be between 30 and 1095')
    const company: ResearchCompanyIdentity = { symbol: input.symbol, ...(input.name === undefined ? {} : { name: input.name }), ...(input.exchange === undefined ? {} : { exchange: input.exchange }) }
    this.options.workflowService.register({ runId: input.workflowRunId, workflowType: 'thesis_red_team', objective: `Thesis Red Team ${input.symbol}` })
    const completion = this.options.workflowService.start(input.workflowRunId, async (signal) => {
      const combined = new AbortController(); const abort = () => combined.abort(); signal.addEventListener('abort', abort, { once: true }); callerSignal?.addEventListener('abort', abort, { once: true })
      try { const handle = await this.registry.mount(resolve(this.options.mountedKnowledgeBaseRoot)); const result = await runThesisRedTeam({ workflowRunId: input.workflowRunId, handle, company, thesisRef: input.thesisRef, lookbackDays: input.lookbackDays, reportRoot: resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports')), acquisitionPlugins: this.options.acquisitionPlugins, dailySignalStore: this.options.dailySignalStore, reasoningExecutor: withSourceLibraryContext(this.options.reasoningExecutor, input.sourceLibraryContext), writeKnowledge: input.writeKnowledge, signal: combined.signal }); return { runId: input.workflowRunId, status: result.status, knowledgeBaseId: result.knowledgeBaseId, ...(result.report === undefined ? {} : { reportId: result.report.reportId, reportPath: `${result.report.reportId}.md` }), committedIds: result.committedIds, proposalCount: result.proposalIds.length, summary: result.status === 'completed' ? `Thesis Red Team completed for ${input.symbol}` : `Thesis Red Team ${result.status} for ${input.symbol}`, ...(result.errors.length ? { errorSummary: result.errors.join('; ').slice(0, 500) } : {}), telemetry: result.telemetry }
      } finally { signal.removeEventListener('abort', abort); callerSignal?.removeEventListener('abort', abort) }
    }).then((outcome) => outcome as ApplicationThesisRedTeamResult)
    completion.catch(() => undefined); return { runId: input.workflowRunId, completion }
  }

  async getResearchReport(reportId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(reportId)) throw new ApplicationServiceError('invalid_input', 'reportId is invalid')
    const reportRoot = resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports'))
    try { return await readResearchReport(join(reportRoot, `${reportId}.md.json`)) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ApplicationServiceError('not_found', 'Research report not found', { cause: error })
      throw error
    }
  }

  async listResearchReports(limit = 50): Promise<readonly ResearchReportSummary[]> {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new ApplicationServiceError('invalid_input', 'limit must be a positive integer')
    const reportRoot = resolve(this.options.reportRoot ?? join(this.options.cwd ?? process.cwd(), 'runtime-data', 'reports'))
    let names: string[]
    try { names = await readdir(reportRoot) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const summaries: ResearchReportSummary[] = []
    for (const name of names.filter((item) => item.endsWith('.md.json'))) {
      const reportId = name.slice(0, -'.md.json'.length)
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(reportId)) continue
      try {
        const report = await readResearchReport(join(reportRoot, name))
        if (report.reportType !== 'daily_brief') summaries.push(summarizeResearchReport(report))
      } catch {
        // A malformed or partially-written report must not make the read-only catalog unavailable.
      }
    }
    return summaries.sort((left, right) => right.generatedAt.localeCompare(left.generatedAt) || left.reportId.localeCompare(right.reportId)).slice(0, Math.min(limit, 200))
  }
}
