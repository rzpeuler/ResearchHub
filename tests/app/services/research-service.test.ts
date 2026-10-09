import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import type { ThemeScopeImpactChecker } from '../../../workflows/theme-scope-impact-check/post-write.ts'
import type { ThemeScopeImpactWriteReceipt } from '../../../app/services/theme-scope-impact-service.ts'
import { ResearchService } from '../../../app/services/research-service.ts'
import { SecurityIdentityResolver } from '../../../app/services/security-identity-resolver.ts'
import { writeResearchReport, type ResearchReport } from '../../../app/services/research-report.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import type { ResearchAcquisitionPlugin, ResearchSourceCandidate, ResearchSignal, ResearchSignalStore } from '../../../plugins/research-acquisition/contracts.ts'
import { OfficialDisclosureResearchPlugin, type OfficialDisclosureClient } from '../../../plugins/research-acquisition/official.ts'
import { GdeltResearchPlugin } from '../../../plugins/research-acquisition/gdelt.ts'
import { createSecurityIdentityDataResolver, type AkshareSecurityDirectoryClient } from '../../../plugins/research-acquisition/security-identity-data.ts'

function fixtureEvidenceAdapter(route: 'cninfo' | 'gdelt', calls: { discovered: number; fetched: number; normalized: number }): Pick<ResearchAcquisitionPlugin, 'discover' | 'fetch' | 'normalize'> {
  const candidate: ResearchSourceCandidate = {
    candidateId: `legacy-${route}-candidate`, kind: route === 'cninfo' ? 'official_disclosure' : 'news', tier: route === 'cninfo' ? 1 : 3,
    title: `${route} legacy route fixture`, url: `https://${route}.example.test/article`, provider: route,
    publishedAt: new Date().toISOString(), metadata: { companySymbol: '600519' },
  }
  return {
    discover: async () => { calls.discovered += 1; return [candidate] },
    fetch: async (sourceCandidate) => { calls.fetched += 1; return { candidate: sourceCandidate, retrievedAt: new Date().toISOString(), content: `${route} evidence`, contentHash: (route === 'cninfo' ? 'c' : 'd').repeat(64) } },
    normalize: async (fetched) => { calls.normalized += 1; return { candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, publisher: route, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } } },
  }
}

class CapturingResearchSignalStore implements ResearchSignalStore {
  readonly providers: string[] = []
  async append(signal: ResearchSignal): Promise<void> { this.providers.push(signal.source.provider) }
  async listForCompany(): Promise<readonly ResearchSignal[]> { return [] }
}

test('Application Service exposes research_company through one Workflow path', async () => { const root = await mkdtemp(join(tmpdir(), 'researchhub-service-kb-')); const reports = await mkdtemp(join(tmpdir(), 'researchhub-service-reports-')); try { await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-service' }); const plugin: ResearchAcquisitionPlugin = { name: 'fixture-official', discover: async () => [], fetch: async (candidate) => ({ candidate, retrievedAt: new Date().toISOString(), content: '' }), normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: 'a'.repeat(64), publisher: source.candidate.provider, rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }) }; const workflowService = new WorkflowService(); const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [plugin], workflowService }); const started = service.startResearchCompany({ workflowRunId: 'service-run', symbol: '600519' }); const result = await started.completion; assert.equal(result.status, 'completed'); assert.equal(workflowService.getWorkflowStatus('service-run')?.status, 'completed'); assert.match(result.reportId ?? '', /600519/); assert.equal((await service.getResearchReport(result.reportId!)).reportId, result.reportId) } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) } })

test('legacy ResearchService constructor routes explicit CNINFO and GDELT adapter instances through Data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-legacy-evidence-kb-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-legacy-evidence-reports-'))
  const calls = { cninfo: { discovered: 0, fetched: 0, normalized: 0 }, gdelt: { discovered: 0, fetched: 0, normalized: 0 } }
  const signalStore = new CapturingResearchSignalStore()
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-legacy-evidence' })
    const cninfo = Object.assign(new OfficialDisclosureResearchPlugin({} as OfficialDisclosureClient), fixtureEvidenceAdapter('cninfo', calls.cninfo))
    const gdelt = Object.assign(new GdeltResearchPlugin(), fixtureEvidenceAdapter('gdelt', calls.gdelt))
    assert.equal(cninfo.name, 'official-disclosure-research-acquisition')
    const directory = { async securityDirectory() { return [{ symbol: '600519', name: 'Fixture Company', exchange: 'SH' }] } } as unknown as AkshareSecurityDirectoryClient
    const securityIdentityResolver = new SecurityIdentityResolver({ mountedKnowledgeBaseRoot: root, dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare: directory, now, ...(signal ? { signal } : {}) }) })
    const service = new ResearchService({
      mountedKnowledgeBaseRoot: root,
      reportRoot: reports,
      // This is the pre-Phase-3 constructor shape; no researchEvidenceProviders option.
      acquisitionPlugins: [cninfo, gdelt],
      signalStore,
      workflowService: new WorkflowService(),
      securityIdentityResolver,
    })
    const result = await service.startResearchCompany({ workflowRunId: 'legacy-evidence-run', symbol: '600519', name: 'Fixture Company', writeKnowledge: false }).completion
    assert.equal(result.status, 'completed')
    assert.deepEqual(calls, {
      cninfo: { discovered: 1, fetched: 1, normalized: 1 },
      gdelt: { discovered: 1, fetched: 1, normalized: 1 },
    })
    assert.deepEqual(new Set(signalStore.providers), new Set(['cninfo', 'gdelt']))
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})

test('Company Deep Research triggers scope impact only after its committed Writer log is verified', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-company-impact-kb-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-impact-reports-'))
  const receipts: ThemeScopeImpactWriteReceipt[] = []
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-impact' })
    const plugin: ResearchAcquisitionPlugin = {
      name: 'fixture-official',
      discover: async () => [{ candidateId: 'company-impact-source', kind: 'official_disclosure', tier: 1, title: 'Company fixture filing', provider: 'fixture', publishedAt: '2026-09-07T00:00:00.000Z', metadata: { companySymbol: '600519' } }],
      fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-08T00:00:00.000Z', content: 'The company reported stable revenue.', contentHash: 'b'.repeat(64) }),
      normalize: async (fetched) => ({ candidate: fetched.candidate, retrievedAt: fetched.retrievedAt, title: fetched.candidate.title, content: fetched.content, contentHash: fetched.contentHash!, publisher: 'Fixture Official', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }),
    }
    const checker: ThemeScopeImpactChecker = { check: async (input) => {
      const receipt = input as ThemeScopeImpactWriteReceipt
      receipts.push(receipt)
      return { receiptKey: 'c'.repeat(64), knowledgeBaseId: receipt.knowledgeBaseId, baseRevision: receipt.baseRevision, committedRevision: receipt.committedRevision, status: 'ready', proposals: [], diagnostics: [] }
    } }
    const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [plugin], workflowService: new WorkflowService(), themeScopeImpactChecker: checker })
    const result = await service.startResearchCompany({ workflowRunId: 'company-impact-run', symbol: '600519', name: 'Fixture Company' }).completion
    assert.equal(result.status, 'completed')
    assert.ok(result.committedIds.length > 0)
    assert.equal(result.themeScopeImpact.status, 'ready')
    assert.equal(receipts.length, 1)
    assert.equal(receipts[0]?.writerRunId, 'company-impact-run')
    assert.equal(receipts[0]?.knowledgeBaseId, 'kb-company-impact')
    assert.deepEqual(new Set([...receipts[0]!.createdRefs, ...receipts[0]!.updatedRefs]), new Set(result.committedIds))
    const withoutWrite = await service.startResearchCompany({ workflowRunId: 'company-impact-no-write', symbol: '600519', name: 'Fixture Company', writeKnowledge: false }).completion
    assert.equal(withoutWrite.status, 'completed')
    assert.equal(withoutWrite.themeScopeImpact.status, 'not_triggered')
    assert.equal(receipts.length, 1)
  } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) }
})

test('Application Service exposes event_research with telemetry and provider outcome mapping', async () => { const root = await mkdtemp(join(tmpdir(), 'researchhub-event-service-kb-')); const reports = await mkdtemp(join(tmpdir(), 'researchhub-event-service-reports-')); try { await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-event-service' }); const workflowService = new WorkflowService(); const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [], workflowService }); const started = service.startEventResearch({ workflowRunId: 'event-service-run', symbol: '600519', anchor: { kind: 'user_event', title: 'Fixture event', description: 'A bounded fixture event.' } }); assert.equal(workflowService.getWorkflowStatus(started.runId)?.workflowType, 'event_research'); const result = await started.completion; assert.equal(result.status, 'blocked'); assert.equal(result.telemetry !== undefined, true); assert.deepEqual(result.providerOutcome, []); assert.equal(result.reportId, undefined); assert.equal(result.reportPath, undefined) } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) } })

test('Industry Service rejects a missing ReasoningExecutor before Workflow registration', async () => { const root = await mkdtemp(join(tmpdir(), 'researchhub-industry-missing-executor-')); const reports = await mkdtemp(join(tmpdir(), 'researchhub-industry-missing-reports-')); try { await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-industry-missing-executor' }); const workflowService = new WorkflowService(); const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [], workflowService }); assert.throws(() => service.startIndustryResearch({ workflowRunId: 'industry-missing-executor', name: 'PCB' }), /ReasoningExecutor/); assert.equal(workflowService.getWorkflowStatus('industry-missing-executor'), undefined) } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) } })

test('Company Research never invokes an Industry-only provider', async () => { const root = await mkdtemp(join(tmpdir(), 'researchhub-company-industry-seam-')); const reports = await mkdtemp(join(tmpdir(), 'researchhub-company-industry-seam-reports-')); let calls = 0; try { await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-company-industry-seam' }); const industryOnly: ResearchAcquisitionPlugin = { name: 'industry-only-fixture', discover: async () => { calls++; return [] }, fetch: async (candidate) => ({ candidate, retrievedAt: '2026-09-13T00:00:00.000Z', content: '' }), normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: 'a'.repeat(64), publisher: 'fixture', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } }) }; const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [], industryAcquisitionPlugins: [industryOnly], workflowService: new WorkflowService() }); await service.startResearchCompany({ workflowRunId: 'company-industry-seam', symbol: '600519' }).completion; assert.equal(calls, 0) } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) } })

test('Research Service lists validated non-brief reports in newest-first order', async () => { const root = await mkdtemp(join(tmpdir(), 'researchhub-report-catalog-kb-')); const reports = await mkdtemp(join(tmpdir(), 'researchhub-report-catalog-reports-')); try { const service = new ResearchService({ mountedKnowledgeBaseRoot: root, reportRoot: reports, acquisitionPlugins: [], workflowService: new WorkflowService() }); const report = (reportId: string, reportType: ResearchReport['reportType'], generatedAt: string): ResearchReport => ({ reportId, reportType, subjectRefs: reportType === 'daily_brief' ? [] : ['entity:subject'], generatedAt, asOf: generatedAt, workflowRunId: `run-${reportId}`, knowledgeBaseRevision: 3, sourceRefs: ['source:fixture'], claimRefs: ['claim:fixture'], methodology: 'bounded fixture', sections: [{ id: 'summary', title: 'Summary', markdown: 'Fixture report.', sourceRefs: ['source:fixture'], claimRefs: ['claim:fixture'] }], outputPath: `${reportId}.md` }); await writeResearchReport(report('older', 'company_research', '2026-09-14T00:00:00.000Z'), reports); await writeResearchReport(report('newer', 'industry_research', '2026-09-15T00:00:00.000Z'), reports); await writeResearchReport(report('brief', 'daily_brief', '2026-09-16T00:00:00.000Z'), reports); await writeResearchReport(report('same-time-a', 'valuation', '2026-09-14T00:00:00.000Z'), reports); await writeResearchReport(report('same-time-b', 'event_research', '2026-09-14T00:00:00.000Z'), reports); await writeFile(join(reports, 'broken.md.json'), '{not json', 'utf8'); const listed = await service.listResearchReports(2); assert.deepEqual(listed.map((item) => item.reportId), ['newer', 'older']); assert.equal(listed[0]?.sourceCount, 1); assert.equal((await service.listResearchReports(50)).some((item) => item.reportId === 'brief'), false); await assert.rejects(() => service.listResearchReports(Number.NaN), /positive integer/) } finally { await rm(root, { recursive: true, force: true }); await rm(reports, { recursive: true, force: true }) } })
