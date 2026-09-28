import { lstat, mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { ModelRuntime, getAgentDir } from '@earendil-works/pi-coding-agent'
import type { Api, Model } from '@earendil-works/pi-ai'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../knowledge/production/gateway.ts'
import { verifyRaw } from '../knowledge/raw/raw-archive.ts'
import { hashKnowledgeObject } from '../knowledge/storage/canonical-hash.ts'
import { getMetricDefinitionV04 } from '../knowledge/schema/metric-registry.ts'
import { CninfoOfficialDisclosureClient, OfficialDisclosureResearchPlugin } from '../plugins/research-acquisition/official.ts'
import { selectProductionReasoningModel } from '../app/pi/model-selection.ts'
import { PiReasoningExecutor } from '../plugins/reasoning/pi/executor.ts'
import { createResearchHubApplicationRuntime } from '../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../app/runtime/server.ts'
import { ThesisCriterionService } from '../app/services/thesis-criterion-service.ts'
import { loadKnowledgeBaseManifest } from '../knowledge/storage/manifest-loader.ts'

const repoRoot = resolve(import.meta.dirname, '..')
const evidencePath = resolve(repoRoot, 'tests/validation/evidence/RHL_TL001_THESIS_KILL_CRITERION_REAL_E2E.json')
const reportPath = resolve(repoRoot, 'tests/validation/evidence/RHL_TL001_THESIS_KILL_CRITERION_REAL_E2E.md')
const symbol = process.env.RHL_TL001_SYMBOL ?? '600519'
const companyName = process.env.RHL_TL001_COMPANY_NAME ?? '贵州茅台'
const exchange = process.env.RHL_TL001_EXCHANGE ?? 'SSE'
const safeError = (error: unknown): string => String(error instanceof Error ? error.message : error)
  .replace(/[A-Za-z]:\\[^\s;,]*/gu, '<path>')
  .replace(/(authorization|cookie|api[-_]?key|token|secret)\s*[:=]\s*[^,;\s]+/giu, '$1=<redacted>')
  .slice(0, 300)
const objectHash = (assets: Awaited<ReturnType<typeof readCanonicalV04Assets>>) => assets.objects.map((item) => [item.value.id, hashKnowledgeObject(item.value)]).sort(([a], [b]) => String(a).localeCompare(String(b)))
const canonicalFingerprint = (assets: Awaited<ReturnType<typeof readCanonicalV04Assets>>) => createHash('sha256').update(JSON.stringify(objectHash(assets))).digest('hex')
const jsonObject = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const normalizedText = (value: string): string => value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
const samePath = (left: string, right: string): boolean => process.platform === 'win32' ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US') : left === right
const quoteLocator = (quote: string): string => `quote:${Buffer.from(quote, 'utf8').toString('base64url')}`
function exactTokenSpan(text: string, token: string): { start: number; end: number } | undefined {
  if (!token) return undefined
  if (/\p{Script=Han}/u.test(token)) {
    const start = text.indexOf(token)
    return start >= 0 && text.indexOf(token, start + token.length) < 0 ? { start, end: start + token.length } : undefined
  }
  const isWord = (character: string | undefined): boolean => character !== undefined && /[\p{L}\p{N}_]/u.test(character)
  const spans: Array<{ start: number; end: number }> = []
  let from = 0
  while (from < text.length) {
    const start = text.indexOf(token, from)
    if (start < 0) break
    const end = start + token.length
    if (!isWord(text[start - 1]) && !isWord(text[end])) spans.push({ start, end })
    from = start + Math.max(1, token.length)
  }
  return spans.length === 1 ? spans[0] : undefined
}
function exactQuoteProvesValue(quote: string, metricLabel: string, unit: string, period: string, value: number): boolean {
  const spans = [metricLabel, unit, period].map((token) => exactTokenSpan(quote, token))
  if (spans.some((span) => span === undefined)) return false
  let remainder = quote
  for (const span of (spans as Array<{ start: number; end: number }>).sort((left, right) => right.start - left.start)) remainder = remainder.slice(0, span.start) + remainder.slice(span.end)
  const numericTokens = remainder.match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g) ?? []
  return numericTokens.length === 1 && numericTokens[0] === String(value)
}

async function removeVerifiedMkdtemp(targetRoot: string, prefix: string): Promise<void> {
  const configuredTemp = resolve(tmpdir())
  const candidate = resolve(targetRoot)
  if (!samePath(dirname(candidate), configuredTemp) || !basename(candidate).startsWith(prefix)) throw new Error('TEMP_CLEANUP_CONTAINMENT_REJECTED')
  const rootStat = await lstat(candidate)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('TEMP_CLEANUP_REPARSE_ROOT_REJECTED')
  const tempReal = await realpath(configuredTemp)
  const candidateReal = await realpath(candidate)
  if (!samePath(dirname(candidateReal), tempReal) || !basename(candidateReal).startsWith(prefix)) throw new Error('TEMP_CLEANUP_REALPATH_REJECTED')
  const inspect = async (directory: string): Promise<void> => {
    for (const name of await readdir(directory)) {
      const child = join(directory, name)
      const info = await lstat(child)
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('TEMP_CLEANUP_REPARSE_ENTRY_REJECTED')
      const actual = await realpath(child)
      const rel = relative(candidateReal, actual)
      if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('TEMP_CLEANUP_ENTRY_ESCAPE_REJECTED')
      if (info.isDirectory()) await inspect(child)
    }
  }
  await inspect(candidateReal)
  await rm(candidateReal, { recursive: true })
}

interface Stage { readonly status: 'PASS' | 'BLOCKED' | 'FAIL'; readonly detail: string }
interface AcceptanceEvidence {
  readonly generatedAt: string
  readonly taskId: 'RHL-TL-001'
  readonly classification: 'NOT EXECUTED / BLOCKED' | 'EXECUTED / GATE_NOT_MET' | 'EXECUTED / PASS GATE'
  readonly processExitCode: number
  readonly pathClassification: 'isolated_v04_acceptance_harness_real_cninfo_pdf_http_prepare_confirm_refresh_decision'
  readonly userKnowledgeBaseTouched: false
  readonly thesisAndCriterionAreAcceptanceFixtures: true
  readonly criterionConfirmationClock: 'simulated_historical_test_clock'
  readonly reasoning: { readonly provider: string; readonly model: string; readonly executor: 'PiReasoningExecutor'; readonly operations: readonly string[]; readonly numericExtraction: 'deterministic_verified_source' | 'not_completed'; readonly refresh: 'real_model' | 'not_completed' }
  readonly source?: { readonly publisher: 'CNINFO'; readonly provider: string; readonly title: string; readonly urlHost: string; readonly publishedAt: string; readonly retrievedAt: string; readonly mediaType: string; readonly rightsEligible: boolean; readonly rawVerified: boolean; readonly rawBytes: number; readonly quoteLocatorSha256: string; readonly sourceBodyIncluded: false }
  readonly thesis?: { readonly thesisRef: string; readonly targetClaimRef: string; readonly evidenceClaimRef: string; readonly conditionId: string; readonly criterionRevision?: number; readonly metricRef: string; readonly period: string; readonly unit: string; readonly value: number; readonly baselineRevision: number; readonly criterionCommittedRevision?: number; readonly refreshReviewCaseId?: string; readonly revisionAfterDefer?: number; readonly committedRevision?: number; readonly revisionAfterReplay?: number; readonly finalStatus?: string; readonly decisionState?: string; readonly replay?: boolean }
  readonly stages: Readonly<Record<string, Stage>>
  readonly errors: readonly string[]
  readonly secretsIncluded: false
  readonly sourceBodyIncluded: false
}

const stages: Record<string, Stage> = {}
const errors: string[] = []
const operations: string[] = []
let modelRuntime: ModelRuntime | undefined
let appRuntime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> | undefined
let server: ResearchHubRuntimeServer | undefined
let tempRoot: string | undefined
let modelProvider = 'unavailable'
let modelName = 'unavailable'
let numericExtraction: 'deterministic_verified_source' | 'not_completed' = 'not_completed'
let refreshReasoning: 'real_model' | 'not_completed' = 'not_completed'
let sourceEvidence: AcceptanceEvidence['source']
let thesisEvidence: AcceptanceEvidence['thesis']

async function writeEvidence(classification: AcceptanceEvidence['classification'], processExitCode: number): Promise<void> {
  const evidence: AcceptanceEvidence = {
    generatedAt: new Date().toISOString(), taskId: 'RHL-TL-001', classification, processExitCode,
    pathClassification: 'isolated_v04_acceptance_harness_real_cninfo_pdf_http_prepare_confirm_refresh_decision',
    userKnowledgeBaseTouched: false, thesisAndCriterionAreAcceptanceFixtures: true, criterionConfirmationClock: 'simulated_historical_test_clock',
    reasoning: { provider: modelProvider, model: modelName, executor: 'PiReasoningExecutor', operations: [...operations], numericExtraction, refresh: refreshReasoning },
    ...(sourceEvidence === undefined ? {} : { source: sourceEvidence }), ...(thesisEvidence === undefined ? {} : { thesis: thesisEvidence }),
    stages: { ...stages }, errors: [...new Set(errors)].slice(0, 20), secretsIncluded: false, sourceBodyIncluded: false,
  }
  await mkdir(dirname(evidencePath), { recursive: true })
  const json = `${JSON.stringify(evidence, null, 2)}\n`
  await writeFile(evidencePath, json, 'utf8')
  const stageRows = Object.entries(evidence.stages).map(([name, stage]) => `| ${name} | ${stage.status} | ${stage.detail.replace(/\|/gu, '\\|')} |`).join('\n')
  const errorRows = evidence.errors.length ? evidence.errors.map((error) => `- ${error}`).join('\n') : '- None.'
  await writeFile(reportPath, `# TL-001 real kill-criterion invalidation acceptance\n\nGenerated: ${evidence.generatedAt}\n\nClassification: **${classification}** (process exit ${processExitCode}).\n\nThis run uses a disposable Schema 0.4 Knowledge Base, a live original-publisher CNINFO PDF with archived PDF bytes, and the real configured Pi executor. The Thesis and the human-rule criterion are explicitly acceptance harness records, not an investor-approved judgment. Criterion confirmation uses a simulated historical test clock so the already-published original evidence is temporally eligible; the Source publishedAt value is retained unchanged. The mounted user Knowledge Base is not used. The artifacts omit source body text, exact quote text, Raw bytes, credentials, and tokens.\n\n## Evidence stages\n\n| Stage | Status | Evidence |\n| --- | --- | --- |\n${stageRows || '| None | BLOCKED | No stages completed |'}\n\n## Errors and blockers\n\n${errorRows}\n\n## Machine evidence\n\n- \`${evidencePath}\`\n- Script: \`scripts/acceptance-thesis-lifecycle-invalidation-real.ts\`\n- User Knowledge Base touched: \`false\`\n- Secrets included: \`false\`\n- Source body included: \`false\`\n`, 'utf8')
  console.log(json)
}

async function waitForWorkflow(origin: string, runId: string, headers: Record<string, string>): Promise<{ readonly status: string }> {
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const response = await fetch(`${origin}/api/workflows/${encodeURIComponent(runId)}`, { headers })
    if (!response.ok) throw new Error(`HTTP workflow read failed: ${response.status}`)
    const workflow = await response.json() as { readonly status: string }
    if (['completed', 'completed_with_review', 'blocked', 'failed', 'cancelled'].includes(workflow.status)) return workflow
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000))
  }
  throw new Error(`THESIS_REFRESH_WORKFLOW_TIMEOUT:${runId}`)
}

async function main(): Promise<void> {
  const asOf = new Date().toISOString()
  tempRoot = await mkdtemp(join(tmpdir(), 'rhl-tl001-invalidation-real-'))
  const kbRoot = join(tempRoot, 'kb')
  const cwd = join(tempRoot, 'runtime')
  const workspaceRoot = join(tempRoot, 'workspace')
  const agentDir = getAgentDir()
  await Promise.all([mkdir(cwd), mkdir(workspaceRoot)])

  const officialClient = new CninfoOfficialDisclosureClient({ timeoutMs: 20_000, pageSize: 100 })
  const officialPlugin = new OfficialDisclosureResearchPlugin(officialClient)
  let candidate: Awaited<ReturnType<OfficialDisclosureResearchPlugin['discover']>>[number] | undefined
  let fetched: Awaited<ReturnType<OfficialDisclosureResearchPlugin['fetch']>> | undefined
  let normalized: Awaited<ReturnType<OfficialDisclosureResearchPlugin['normalize']>> | undefined
  try {
    const records = await officialClient.list({ company: { symbol, name: companyName, exchange }, asOf })
    const shortQuantitativeRecord = records.find((item) => item.title.includes('关于调整2025年年度利润分配方案每股分红金额的公告') && item.url.toLowerCase().endsWith('.pdf'))
    const selected = shortQuantitativeRecord ?? records.find((item) => /(季度报告|业绩快报)/u.test(item.title) && item.url.toLowerCase().endsWith('.pdf'))
    candidate = selected && {
      candidateId: `official-${createHash('sha256').update(selected.url).digest('hex').slice(0, 16)}`,
      kind: 'official_disclosure', tier: 1, title: selected.title, url: selected.url, provider: 'cninfo', publishedAt: selected.publishedAt,
      metadata: { companySymbol: symbol, sourceAccountRef: 'cninfo:official-disclosure', issuer: selected.issuer },
    }
    if (!candidate) throw new Error(`CNINFO_LIVE_ORIGINAL_PUBLISHER_PDF_NOT_FOUND:${symbol}`)
    stages.originalPublisherDiscovery = { status: 'PASS', detail: `${candidate.provider}; short original CNINFO PDF disclosure; publishedAt ${candidate.publishedAt}` }
    console.log(`CNINFO_SOURCE_SELECTED:${candidate.title}:${candidate.publishedAt}`)
    fetched = await officialPlugin.fetch(candidate)
    normalized = await officialPlugin.normalize(fetched)
    if (fetched.mediaType?.toLowerCase().split(';', 1)[0] !== 'application/pdf' || !fetched.rawBytes?.length || normalized.content.trim().length < 100) throw new Error('CNINFO_ORIGINAL_PDF_BYTES_OR_TEXT_UNAVAILABLE')
    const rightsEligible = normalized.rights.accessScope === 'public' && normalized.rights.retentionAllowed && normalized.rights.aiProcessingAllowed && normalized.rights.derivativeKnowledgeAllowed
    sourceEvidence = { publisher: 'CNINFO', provider: candidate.provider, title: candidate.title.slice(0, 300), urlHost: new URL(candidate.url!).hostname, publishedAt: candidate.publishedAt!, retrievedAt: normalized.retrievedAt, mediaType: fetched.mediaType!, rightsEligible, rawVerified: false, rawBytes: fetched.rawBytes.length, quoteLocatorSha256: 'not-computed', sourceBodyIncluded: false }
    if (!rightsEligible) throw new Error('CNINFO_SOURCE_RIGHTS_NOT_ADMITTED')
    stages.liveOriginalPublisherPdf = { status: 'PASS', detail: `CNINFO PDF fetched and normalized; ${fetched.rawBytes.length} original bytes; public rights admit Raw retention, AI processing and derived Knowledge` }
  } catch (error) {
    stages.originalPublisherPdf = { status: 'BLOCKED', detail: safeError(error) }
    errors.push(`CNINFO_SOURCE_ORIGINAL_PDF_BLOCKED:${safeError(error)}`)
    await writeEvidence('NOT EXECUTED / BLOCKED', 1)
    return
  }

  try {
    modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json'), allowModelNetwork: true, refreshOnCreate: false })
    const model = selectProductionReasoningModel(modelRuntime) as Model<Api>
    modelProvider = model.provider
    modelName = model.id
    const executor = new PiReasoningExecutor({ modelRuntime, model, timeoutMs: 900_000, maxOutputChars: 400_000 })
    const metricRef = '每股派发现金红利'
    const unit = '元'
    const period = '2025 年年度'
    let sourceSpan = ''
    let value = Number.NaN
    let searchFrom = 0
    while (searchFrom < normalized.content.length && !sourceSpan) {
      const periodAt = normalized.content.indexOf(period, searchFrom)
      if (periodAt < 0) break
      const metricAt = normalized.content.indexOf(metricRef, periodAt + period.length)
      const unitAt = metricAt < 0 ? -1 : normalized.content.indexOf(unit, metricAt + metricRef.length)
      if (metricAt >= 0 && unitAt > metricAt && metricAt - (periodAt + period.length) < 600) {
        const quote = normalized.content.slice(periodAt, unitAt + unit.length)
        const valueToken = quote.match(/[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/gu)?.at(-1)
        const parsedValue = valueToken === undefined ? Number.NaN : Number(valueToken)
        if (Number.isFinite(parsedValue) && exactQuoteProvesValue(quote, metricRef, unit, period, parsedValue)) {
          sourceSpan = quote
          value = parsedValue
        }
      }
      searchFrom = periodAt + period.length
    }
    if (!sourceSpan) throw new Error('LIVE_CNINFO_QUOTE_CONTEXT_NOT_FOUND')
    const statement = `CNINFO reports the ${period} ${metricRef} amount.`
    const registeredMetric = getMetricDefinitionV04(metricRef)
    const metricLabel = registeredMetric?.label ?? metricRef
    if (!statement || sourceSpan.length < 20 || !normalized.content.includes(sourceSpan) || !Number.isFinite(value) || !unit.trim() || !period.trim() || !metricRef.trim() || (metricRef.startsWith('metric:') && !registeredMetric) || !exactQuoteProvesValue(sourceSpan, metricLabel, unit, period, value)) throw new Error('LIVE_NUMERIC_SOURCE_EXTRACTION_NOT_VERIFIABLE')
    numericExtraction = 'deterministic_verified_source'
    const locator = quoteLocator(sourceSpan)
    sourceEvidence = { ...sourceEvidence!, quoteLocatorSha256: createHash('sha256').update(locator).digest('hex') }
    stages.deterministicExactQuoteExtraction = { status: 'PASS', detail: `Programmatic source scan selected the exact CNINFO metric, period, unit and sole numeric token ${value}; quote and source body withheld from output` }

    const publishedAtMs = Date.parse(candidate.publishedAt!)
    if (!Number.isFinite(publishedAtMs) || publishedAtMs > Date.parse(asOf)) throw new Error('CNINFO_PUBLICATION_OUTSIDE_ASOF')
    const simulatedConfirmationAt = new Date(publishedAtMs - 1000).toISOString()
    const baselineAt = new Date(publishedAtMs - 86_400_000).toISOString()
    await createFreshKnowledgeBaseV04(kbRoot, { knowledgeBaseId: `kb-tl001-kill-${Date.now()}`, name: 'Disposable TL-001 kill criterion acceptance Knowledge Base', now: baselineAt })
    const registry = new KnowledgeBaseRegistry()
    const seeded = await new KnowledgeProductionGateway(registry).submit({
      handle: await registry.mount(kbRoot), producerType: 'tl001_invalidation_acceptance_setup', producerRunId: `tl001-kill-seed-${Date.now()}`,
      schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true },
      entity: { localKey: 'issuer', entityType: 'company', name: companyName, aliases: [symbol], semanticFields: { ticker: symbol, exchange } },
      proposals: [
        { proposalId: 'falsifiable-acceptance-proposition', kind: 'claim', claimType: 'assumption', subjectKey: 'issuer', statement: `ACCEPTANCE HARNESS ONLY: the ${period} ${metricRef} value triggers review when it equals ${value} ${unit}. This synthetic proposition is not an investor-approved judgment.`, sourceCandidateIds: [candidate.candidateId], structuredValue: { metric: metricRef, value: 0, unit, comparator: 'eq', fiscalPeriod: period } },
        { proposalId: 'live-numeric-evidence', kind: 'claim', claimType: 'fact', subjectKey: 'issuer', statement: `Original-publisher numeric evidence for ${period}: ${metricRef} ${value} ${unit}.`, sourceCandidateIds: [candidate.candidateId], structuredValue: { metric: metricRef, value, unit, comparator: 'eq', fiscalPeriod: period } },
        { proposalId: 'acceptance-thesis', kind: 'thesis', subjectKey: 'issuer', thesisTitle: `ACCEPTANCE HARNESS ONLY: ${companyName} numeric criterion test ${symbol}`, statement: 'Synthetic lifecycle test record. Its confirmed rule and status are not an investor-approved thesis judgment.', thesisStatus: 'active' },
        { proposalId: 'qualifies-falsifiable-proposition', kind: 'reasoning_edge', sourceProposalId: 'falsifiable-acceptance-proposition', targetKey: 'acceptance-thesis', edgeType: 'qualifies' },
      ],
      evidenceBindings: [{ localSourceId: candidate.candidateId, source: normalized, originalFilename: `${candidate.candidateId}.pdf`, mediaType: fetched.mediaType, locator }],
      asOf, now: () => baselineAt,
    })
    if (seeded.status !== 'committed') throw new Error(`ISOLATED_GATEWAY_SEED_FAILED:${seeded.errors.join('; ')}`)
    const thesisRef = seeded.thesisRefsByProposalId?.['acceptance-thesis']
    const targetClaimRef = seeded.claimRefsByProposalId['falsifiable-acceptance-proposition']
    const evidenceClaimRef = seeded.claimRefsByProposalId['live-numeric-evidence']
    const sourceRef = seeded.sourceRefsByLocalId[candidate.candidateId]
    if (!thesisRef || !targetClaimRef || !evidenceClaimRef || !sourceRef) throw new Error('ISOLATED_GATEWAY_SEED_RESULT_INCOMPLETE')
    const seededAssets = await readCanonicalV04Assets(kbRoot)
    const sourceAsset = seededAssets.objects.find((item) => item.kind === 'source' && item.value.id === sourceRef)?.value as { id: string; rawRefs?: readonly string[]; rights: { accessScope: string; retentionAllowed: boolean; aiProcessingAllowed: boolean; derivativeKnowledgeAllowed: boolean }; publishedAt?: string } | undefined
    const rawRef = sourceAsset?.rawRefs?.[0]
    if (!sourceAsset || !rawRef || sourceAsset.publishedAt !== candidate.publishedAt || sourceAsset.rights.accessScope !== 'public' || !sourceAsset.rights.retentionAllowed || !sourceAsset.rights.aiProcessingAllowed || !sourceAsset.rights.derivativeKnowledgeAllowed) throw new Error('PERSISTED_SOURCE_RIGHTS_PIT_OR_RAW_BINDING_INVALID')
    await verifyRaw(await registry.mount(kbRoot), rawRef as `raw-sha256-${string}`)
    sourceEvidence = { ...sourceEvidence!, rawVerified: true }
    const initialRevision = (await registry.mount(kbRoot)).revision
    const initialFingerprint = canonicalFingerprint(seededAssets)
    thesisEvidence = { thesisRef, targetClaimRef, evidenceClaimRef, conditionId: 'acceptance-dividend-threshold', metricRef, period, unit, value, baselineRevision: initialRevision }
    stages.isolatedGatewaySeedWithOriginalPdfRaw = { status: 'PASS', detail: `Disposable v0.4 KB has a synthetic Thesis, member Claim, structured numeric evidence Claim, CNINFO Source and verified archived PDF Raw (${rawRef})` }

    const reasoningCalls: string[] = []
    const observedExecutor = { capabilities: () => executor.capabilities(), execute: async (request: Parameters<typeof executor.execute>[0]) => { reasoningCalls.push(request.operation); operations.push(request.operation); const response = await executor.execute(request); if (request.operation === 'thesis_refresh_semantic') refreshReasoning = 'real_model'; return response } }
    appRuntime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: kbRoot, workspaceRoot, modelRuntime, model: model as Model<Api>, reasoningExecutor: observedExecutor })
    const runtimeServices = appRuntime.services as unknown as { thesisCriterionService?: unknown }
    runtimeServices.thesisCriterionService = new ThesisCriterionService({ mountedKnowledgeBaseRoot: kbRoot, now: () => simulatedConfirmationAt })
    server = new ResearchHubRuntimeServer({ runtime: appRuntime, clientRoot: join(tempRoot, 'missing-client'), port: 0 })
    const serverInfo = await server.start()
    const headers = { origin: serverInfo.origin, 'x-researchhub-runtime-token': serverInfo.runtimeToken, 'content-type': 'application/json' }

    const beforePrepare = canonicalFingerprint(await readCanonicalV04Assets(kbRoot))
    const prepareResponse = await fetch(`${serverInfo.origin}/api/production/thesis-lifecycle/criteria/prepare`, { method: 'POST', headers, body: JSON.stringify({ thesisRef, conditionId: 'acceptance-dividend-threshold', type: 'numeric_threshold', definitionVersion: 1, definition: { metricRef, operator: 'eq', threshold: value, unit, period }, targetClaimRefs: [targetClaimRef], origin: { kind: 'human_rule' } }) })
    const preview = await prepareResponse.json() as { knowledgeBaseId?: string; expectedKnowledgeBaseRevision?: number; thesisRef?: string; conditionId?: string; definitionHash?: string; previewHash?: string; revision?: number }
    if (!prepareResponse.ok || !preview.previewHash || preview.thesisRef !== thesisRef || preview.expectedKnowledgeBaseRevision !== initialRevision) throw new Error(`HTTP_CRITERION_PREPARE_FAILED:${prepareResponse.status}`)
    if (canonicalFingerprint(await readCanonicalV04Assets(kbRoot)) !== beforePrepare) throw new Error('CRITERION_PREPARE_MUTATED_CANONICAL_KNOWLEDGE')
    stages.httpHumanRulePrepareNoWrite = { status: 'PASS', detail: `POST /api/production/thesis-lifecycle/criteria/prepare returned a preview and hash; canonical fingerprint stayed unchanged` }

    const confirmBody = { preview, previewHash: preview.previewHash, expectedKnowledgeBaseRevision: preview.expectedKnowledgeBaseRevision, workflowRunId: `tl001-kill-confirm-${Date.now()}` }
    const confirmResponse = await fetch(`${serverInfo.origin}/api/production/thesis-lifecycle/criteria/confirm`, { method: 'POST', headers, body: JSON.stringify(confirmBody) })
    const confirmed = await confirmResponse.json() as { status?: string; replay?: boolean; criterionRevision?: number; committedRevision?: number; writerRunId?: string; definitionHash?: string }
    if (!confirmResponse.ok || confirmed.status !== 'confirmed' || confirmed.replay !== false || !confirmed.writerRunId || !confirmed.committedRevision || confirmed.definitionHash !== preview.definitionHash) throw new Error(`HTTP_CRITERION_CONFIRM_FAILED:${confirmResponse.status}:${JSON.stringify(confirmed)}`)
    const confirmedAssets = await readCanonicalV04Assets(kbRoot)
    const confirmationRevision = (await loadKnowledgeBaseManifest(kbRoot)).revision
    if (confirmationRevision !== initialRevision + 1 || confirmed.committedRevision !== confirmationRevision || !confirmedAssets.objects.find((item) => item.kind === 'thesis' && item.value.id === thesisRef)?.value) throw new Error(`CRITERION_CONFIRM_WRITER_RELOAD_INVALID:${initialRevision}->${confirmationRevision}; committed=${confirmed.committedRevision}; thesisFound=${Boolean(confirmedAssets.objects.find((item) => item.kind === 'thesis' && item.value.id === thesisRef)?.value)}`)
    const confirmReplayResponse = await fetch(`${serverInfo.origin}/api/production/thesis-lifecycle/criteria/confirm`, { method: 'POST', headers, body: JSON.stringify(confirmBody) })
    const confirmReplay = await confirmReplayResponse.json() as { status?: string; replay?: boolean; committedRevision?: number }
    if (!confirmReplayResponse.ok || confirmReplay.status !== 'replayed' || confirmReplay.replay !== true || confirmReplay.committedRevision !== confirmationRevision || (await loadKnowledgeBaseManifest(kbRoot)).revision !== confirmationRevision) throw new Error('CRITERION_CONFIRM_REPLAY_GATE_FAILED')
    thesisEvidence = { ...thesisEvidence!, criterionRevision: confirmed.criterionRevision, criterionCommittedRevision: confirmationRevision }
    stages.httpHumanRuleConfirmGatewayWriterReplay = { status: 'PASS', detail: `Human-rule criterion revision ${confirmed.criterionRevision} confirmed through the actual HTTP route; Writer ${confirmed.writerRunId} and reload revision ${confirmationRevision}; identical confirm replay did not advance revision` }
    stages.simulatedConfirmationClock = { status: 'PASS', detail: `Harness confirmation time ${simulatedConfirmationAt} was injected only into the isolated human criterion service; source publishedAt ${candidate.publishedAt} was retained unchanged` }

    const refreshAsOf = new Date().toISOString()
    const launchResponse = await fetch(`${serverInfo.origin}/api/production/thesis-lifecycle/refresh`, { method: 'POST', headers, body: JSON.stringify({ thesisRef, asOf: refreshAsOf, evidenceRefs: [evidenceClaimRef] }) })
    if (launchResponse.status !== 202) throw new Error(`REFRESH_HTTP_START_FAILED:${launchResponse.status}`)
    const launch = await launchResponse.json() as { accepted?: boolean; runId?: string }
    if (!launch.accepted || !launch.runId) throw new Error('REFRESH_HTTP_START_NOT_ACCEPTED')
    const workflow = await waitForWorkflow(serverInfo.origin, launch.runId, headers)
    if (workflow.status !== 'completed_with_review') throw new Error(`INVALIDATION_REFRESH_WORKFLOW_NOT_REVIEWABLE:${workflow.status}`)
    if (!reasoningCalls.includes('thesis_refresh_semantic') || refreshReasoning !== 'real_model') throw new Error('REAL_PI_REFRESH_REASONING_NOT_CALLED')
    const reviewListResponse = await fetch(`${serverInfo.origin}/api/review-cases?producerRunId=${encodeURIComponent(launch.runId)}`, { headers })
    const reviewList = await reviewListResponse.json() as { cases?: readonly { reviewCaseId: string }[] }
    if (!reviewListResponse.ok || reviewList.cases?.length !== 1) throw new Error(`INVALIDATION_REVIEW_CASE_COUNT_INVALID:${reviewList.cases?.length ?? 'missing'}`)
    const reviewCaseId = reviewList.cases[0]!.reviewCaseId
    const detailResponse = await fetch(`${serverInfo.origin}/api/review-cases/${encodeURIComponent(reviewCaseId)}`, { headers })
    const detail = await detailResponse.json() as { thesisScope?: { candidateTransition?: string; proposedThesisStatus?: string; evidenceRefs?: readonly string[]; killCriterionBindings?: readonly { conditionId: string; revision: number; definitionHash: string; evaluatedValueIdentity: string; evidenceRef: string; value: number; unit: string; period: string; sourceRef: string; rawRef: string; numericValueVersionVerified: boolean }[]; reviewedEvidence?: readonly { evidenceRef: string; relation: string; targetClaimRefs: readonly string[] }[] } }
    const binding = detail.thesisScope?.killCriterionBindings?.[0]
    if (!detailResponse.ok || detail.thesisScope?.candidateTransition !== 'invalidation_condition_met' || detail.thesisScope.proposedThesisStatus !== 'invalidated' || !binding || binding.conditionId !== 'acceptance-dividend-threshold' || binding.value !== value || binding.unit !== unit || binding.period !== period || binding.sourceRef !== sourceRef || binding.rawRef !== rawRef || binding.numericValueVersionVerified !== true || !binding.evaluatedValueIdentity) throw new Error('INVALIDATION_REVIEW_CASE_OR_NUMERIC_BINDING_INVALID')
    if (!detail.thesisScope.reviewedEvidence?.some((item) => item.evidenceRef === evidenceClaimRef && item.targetClaimRefs.includes(targetClaimRef))) throw new Error('INVALIDATION_REVIEW_EVIDENCE_SCOPE_INVALID')
    const afterRefreshAssets = await readCanonicalV04Assets(kbRoot)
    const afterRefreshRevision = (await loadKnowledgeBaseManifest(kbRoot)).revision
    if (afterRefreshRevision !== confirmationRevision) throw new Error('REFRESH_CHANGED_CANONICAL_REVISION_BEFORE_DECISION')
    const refreshReport = await appRuntime.services.researchService?.getResearchReport(`thesis-lifecycle-${launch.runId}`)
    const reportText = refreshReport?.sections.map((section) => section.markdown).join('\n') ?? ''
    if (!refreshReport || !reportText.includes(reviewCaseId) || !reportText.includes('invalidation_condition_met') || !reportText.includes(binding.definitionHash)) throw new Error('REFRESH_REPORT_LINKAGE_OR_CRITERION_BINDING_MISSING')
    thesisEvidence = { ...thesisEvidence!, refreshReviewCaseId: reviewCaseId }
    stages.httpRefreshMetReviewCase = { status: 'PASS', detail: `POST /api/production/thesis-lifecycle/refresh called real Pi refresh; deterministic evaluator proved the exact CNINFO PDF numeric value and created ReviewCase ${reviewCaseId} without canonical writes` }
    stages.numericVersionAndSourceRawBinding = { status: 'PASS', detail: `ReviewCase binds ${metricRef}=${value} ${unit}, ${period}, exact locator hash, Source ${sourceRef}, verified archived PDF Raw ${rawRef}, and numericValueVersionVerified=true` }
    stages.refreshReportLinkage = { status: 'PASS', detail: `Durable thesis_lifecycle report ${refreshReport.reportId} includes ReviewCase, invalidation transition and criterion definition hash` }

    const beforeDeferFingerprint = canonicalFingerprint(afterRefreshAssets)
    const deferResponse = await fetch(`${serverInfo.origin}/api/review-cases/${encodeURIComponent(reviewCaseId)}/decision`, { method: 'POST', headers, body: JSON.stringify({ decision: 'DEFER', note: 'Record the acceptance harness no-write DEFER before the explicit test ACCEPT.' }) })
    const deferred = await deferResponse.json() as { status?: string; decisionState?: string }
    const afterDeferAssets = await readCanonicalV04Assets(kbRoot)
    const afterDeferRevision = (await loadKnowledgeBaseManifest(kbRoot)).revision
    if (!deferResponse.ok || deferred.status !== 'deferred' || deferred.decisionState !== 'DEFERRED' || afterDeferRevision !== confirmationRevision || canonicalFingerprint(afterDeferAssets) !== beforeDeferFingerprint) throw new Error('INVALIDATION_DEFER_MUTATED_CANONICAL_KNOWLEDGE')
    thesisEvidence = { ...thesisEvidence!, revisionAfterDefer: afterDeferRevision }
    stages.invalidationDeferNoWrite = { status: 'PASS', detail: 'HTTP DEFER persisted DEFERRED state while the KB revision and every canonical object hash stayed unchanged' }

    const acceptNote = 'Accept the synthetic TL-001 numeric kill-criterion acceptance case.'
    const acceptResponse = await fetch(`${serverInfo.origin}/api/review-cases/${encodeURIComponent(reviewCaseId)}/decision`, { method: 'POST', headers, body: JSON.stringify({ decision: 'ACCEPT', note: acceptNote }) })
    const accepted = await acceptResponse.json() as { status?: string; decisionState?: string; writerRunId?: string; committedRevision?: number; reportUpdate?: { status?: string } }
    if (!acceptResponse.ok || accepted.status !== 'accepted' || accepted.decisionState !== 'ACCEPTED' || !accepted.writerRunId || !accepted.committedRevision || accepted.reportUpdate?.status !== 'updated') throw new Error(`INVALIDATION_ACCEPT_FAILED:${acceptResponse.status}:${JSON.stringify(accepted)}`)
    const finalAssets = await readCanonicalV04Assets(kbRoot)
    const finalRevision = (await loadKnowledgeBaseManifest(kbRoot)).revision
    const finalThesis = finalAssets.objects.find((item) => item.kind === 'thesis' && item.value.id === thesisRef)?.value as { status?: string } | undefined
    if (finalThesis?.status !== 'invalidated' || finalRevision !== accepted.committedRevision || finalRevision <= afterDeferRevision) throw new Error('INVALIDATION_ACCEPT_CANONICAL_STATUS_OR_REVISION_INVALID')
    const finalReport = await appRuntime.services.researchService?.getResearchReport(`thesis-lifecycle-${launch.runId}`)
    const decisionSection = finalReport?.sections.find((section) => section.id === 'decision-outcome')?.markdown ?? ''
    if (!finalReport || !decisionSection.includes('ACCEPTED') || !decisionSection.includes(accepted.writerRunId)) throw new Error('INVALIDATION_DECISION_REPORT_WRITER_LINKAGE_MISSING')
    const acceptReplayResponse = await fetch(`${serverInfo.origin}/api/review-cases/${encodeURIComponent(reviewCaseId)}/decision`, { method: 'POST', headers, body: JSON.stringify({ decision: 'ACCEPT', note: acceptNote }) })
    const replay = await acceptReplayResponse.json() as { status?: string; decisionState?: string; replay?: boolean; writerRunId?: string }
    const replayRevision = (await loadKnowledgeBaseManifest(kbRoot)).revision
    if (!acceptReplayResponse.ok || replay.status !== 'accepted' || replay.decisionState !== 'ACCEPTED' || replay.replay !== true || replay.writerRunId !== accepted.writerRunId || replayRevision !== finalRevision || canonicalFingerprint(await readCanonicalV04Assets(kbRoot)) !== canonicalFingerprint(finalAssets)) throw new Error('INVALIDATION_ACCEPT_REPLAY_IDEMPOTENCY_FAILED')
    const actionableAfterAccept = await fetch(`${serverInfo.origin}/api/review-cases?producerRunId=${encodeURIComponent(launch.runId)}`, { headers }).then((response) => response.json()) as { cases?: readonly unknown[] }
    if (actionableAfterAccept.cases?.length !== 0) throw new Error('INVALIDATED_CASE_REMAINS_ACTIONABLE')
    thesisEvidence = { ...thesisEvidence!, committedRevision: accepted.committedRevision, revisionAfterReplay: replayRevision, finalStatus: finalThesis.status, decisionState: accepted.decisionState, replay: replay.replay }
    stages.invalidationAcceptWriterReloadReplay = { status: 'PASS', detail: `HTTP ACCEPT revalidated current criterion/evidence, committed invalidated through Gateway/Writer ${accepted.writerRunId}, reloaded revision ${finalRevision}; identical replay added no write` }
    stages.decisionReportAndActionability = { status: 'PASS', detail: 'Durable report records ACCEPTED and Writer run; terminal case is absent from actionable ReviewCase listing' }

    const required = ['originalPublisherDiscovery', 'liveOriginalPublisherPdf', 'deterministicExactQuoteExtraction', 'isolatedGatewaySeedWithOriginalPdfRaw', 'httpHumanRulePrepareNoWrite', 'httpHumanRuleConfirmGatewayWriterReplay', 'simulatedConfirmationClock', 'httpRefreshMetReviewCase', 'numericVersionAndSourceRawBinding', 'refreshReportLinkage', 'invalidationDeferNoWrite', 'invalidationAcceptWriterReloadReplay', 'decisionReportAndActionability']
    const passed = required.every((key) => stages[key]?.status === 'PASS') && numericExtraction === 'deterministic_verified_source' && refreshReasoning === 'real_model' && sourceEvidence?.rawVerified === true && canonicalFingerprint(await readCanonicalV04Assets(kbRoot)) !== beforeDeferFingerprint && finalThesis.status === 'invalidated'
    await writeEvidence(passed ? 'EXECUTED / PASS GATE' : 'EXECUTED / GATE_NOT_MET', passed ? 0 : 1)
    if (!passed) process.exitCode = 1
  } catch (error) {
    errors.push(safeError(error))
    stages.invalidationAcceptance = { status: 'FAIL', detail: safeError(error) }
    await writeEvidence('EXECUTED / GATE_NOT_MET', 1)
    process.exitCode = 1
  }
}

try {
  await main()
} catch (error) {
  errors.push(safeError(error))
  stages.acceptanceSetup = { status: 'BLOCKED', detail: safeError(error) }
  await writeEvidence('NOT EXECUTED / BLOCKED', 1)
  process.exitCode = 1
} finally {
  await Promise.resolve((server as unknown as { close?: () => void | Promise<void> } | undefined)?.close?.()).catch(() => undefined)
  await Promise.resolve(appRuntime?.close()).catch(() => undefined)
  await Promise.resolve((modelRuntime as unknown as { dispose?: () => void | Promise<void> } | undefined)?.dispose?.()).catch(() => undefined)
  if (tempRoot !== undefined) await removeVerifiedMkdtemp(tempRoot, 'rhl-tl001-invalidation-real-').catch((error) => console.error(`TEMP_CLEANUP_RETAINED:${safeError(error)}`))
}
