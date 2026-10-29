import assert from 'node:assert/strict'
import test from 'node:test'
import { completeResearchExecutor, fixtureCompanyDataResolverFactory } from '../../fixtures/company-quality.ts'
import { verifyCompanyResearchKnowledge } from '../../../scripts/company-quality-knowledge-verification.ts'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createResearchHubTools } from '../../../app/pi/tools.ts'
import { ResearchService } from '../../../app/services/research-service.ts'
import { SecurityIdentityResolver } from '../../../app/services/security-identity-resolver.ts'
import { WorkflowService } from '../../../app/services/workflow-service.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { KnowledgeProductionGateway } from '../../../knowledge/production/gateway.ts'
import { createFreshKnowledgeBaseV04, readCanonicalV04Assets } from '../../../knowledge/storage/index.ts'
import { createSecurityIdentityDataResolver } from '../../../plugins/research-acquisition/security-identity-data.ts'
import type { AkshareDataClient } from '../../../plugins/research-acquisition/akshare.ts'
import type { ResearchAcquisitionPlugin } from '../../../plugins/research-acquisition/contracts.ts'

const AS_OF = '2026-10-09T08:00:00.000Z'

async function snapshotTree(root: string): Promise<readonly string[]> {
  const entries: string[] = []
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        entries.push(`dir:${absolute.slice(root.length)}`)
        await visit(absolute)
      } else if (entry.isFile()) {
        entries.push(`file:${absolute.slice(root.length)}:${createHash('sha256').update(await readFile(absolute)).digest('hex')}`)
      }
    }
  }
  await visit(root)
  return entries.sort()
}

async function snapshotTreeSha256(root: string): Promise<string> {
  return createHash('sha256').update(JSON.stringify(await snapshotTree(root))).digest('hex')
}

test('Pi research_company Application Tool persists a P0-19-blocked report without Knowledge writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'researchhub-pi-company-tool-kb-'))
  const reports = await mkdtemp(join(tmpdir(), 'researchhub-pi-company-tool-reports-'))
  try {
    await createFreshKnowledgeBaseV04(root, { knowledgeBaseId: 'kb-pi-company-tool', now: AS_OF })
    const seeded = await new KnowledgeProductionGateway().submit({ handle: await new KnowledgeBaseRegistry().mount(root), producerType: 'fixture_identity', producerRunId: 'identity-600519', schemaProfile: { schemaVersion: '0.4', storageFormatVersion: '1', requiresRawProvenance: true }, entity: { localKey: 'company', entityType: 'company', name: '贵州茅台', aliases: ['600519'], semanticFields: { ticker: '600519', exchange: 'SH' } }, proposals: [], evidenceBindings: [], asOf: AS_OF, now: () => AS_OF })
    assert.equal(seeded.status, 'committed')
    const akshare = {
      async securityDirectory() { return [{ symbol: '600519', name: '贵州茅台', exchange: 'SH' as const }] },
      async companyBasic() { return [{ item: 'industry', value: 'distilled spirits' }] },
      async financialData() { return [{ report_date: '2025-12-31', publication_date: '2026-03-10', operating_revenue: 100, net_profit: 20, basic_eps: 5 }] },
      async historicalMarketData() { return [] },
    } as unknown as AkshareDataClient
    const identityResolver = new SecurityIdentityResolver({
      mountedKnowledgeBaseRoot: root,
      now: () => new Date(AS_OF),
      dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare, now, ...(signal === undefined ? {} : { signal }) }),
    })
    const candidate = { candidateId: 'pi-company-filing', kind: 'official_disclosure' as const, tier: 1 as const, title: 'Company filing fixture', url: 'https://example.test/company-filing', provider: 'cninfo', publishedAt: '2026-03-10T00:00:00.000Z', metadata: { companySymbol: '600519' } }
    const rights = { accessScope: 'public' as const, retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false }
    const cninfo: ResearchAcquisitionPlugin = {
      name: 'pi-company-tool-fixture',
      discover: async () => [candidate],
      fetch: async (sourceCandidate) => ({ candidate: sourceCandidate, retrievedAt: AS_OF, content: 'Fixture disclosure: revenue was 100 and net profit was 20.', contentHash: 'a'.repeat(64) }),
      normalize: async (source) => ({ candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: 'CNINFO fixture', rights }),
    }
    const workflowService = new WorkflowService()
    const reasoningExecutor = completeResearchExecutor()
    const researchService = new ResearchService({
      mountedKnowledgeBaseRoot: root,
      reportRoot: reports,
      acquisitionPlugins: [cninfo],
      researchEvidenceProviders: { cninfo },
      akshare,
      workflowService,
      securityIdentityResolver: identityResolver,
      reasoningExecutor: reasoningExecutor as never,
      companyDataResolverFactory: fixtureCompanyDataResolverFactory(cninfo, undefined, akshare),
    })
    const tools = createResearchHubTools({
      knowledgeService: {} as never,
      reviewService: {} as never,
      productionService: {} as never,
      workflowService,
      researchService,
      policyContext: {},
    })
    const before = await snapshotTree(root)
    const beforeSha256 = await snapshotTreeSha256(root)
    const tool = tools.find((item) => item.name === 'research_company')
    assert.ok(tool)
    const response = await tool.execute('pi-company-tool-call', { workflowRunId: 'pi-company-tool-run', symbol: '600519', name: '贵州茅台', exchange: 'SH', writeKnowledge: true }, undefined, undefined, {} as never)
    const result = JSON.parse(response.content[0]!.type === 'text' ? response.content[0]!.text : '{}') as { status: string; runId: string; reportId?: string }
    assert.equal(result.status, 'blocked')
    assert.equal(result.runId, 'pi-company-tool-run')
    assert.ok(result.reportId)
    const run = workflowService.getWorkflowStatus(result.runId)
    assert.equal(run?.status, 'blocked')
    const report = await researchService.getResearchReport(result.reportId!)
    assert.equal(report.workflowRunId, result.runId)
    assert.equal(report.reportType, 'company_research')
    assert.equal(report.verifiedSecurityIdentity?.symbol, '600519')
    assert.ok(report.sections.some((section) => section.evidenceLinks?.includes('https://example.test/company-filing')))
    assert.equal(report.researchQuality?.passed, false)
    assert.deepEqual(report.subjectRefs, ['entity:company-600519'])
    assert.deepEqual(report.sourceRefs, [])
    assert.deepEqual(report.claimRefs, [])
    assert.ok(report.sections.every((section) => (section.sourceRefs?.length ?? 0) === 0 && (section.claimRefs?.length ?? 0) === 0))
    assert.equal(workflowService.getWorkflowStatus(result.runId)?.status, 'blocked')
    assert.deepEqual(await snapshotTree(root), before, 'Pi Tool read-only policy must preserve the entire Knowledge file tree')
    const defaultReadonlySha256 = await snapshotTreeSha256(root)
    assert.equal(defaultReadonlySha256, beforeSha256, 'Canonical, Raw Archive, registry, and ReviewCase tree SHA-256 must remain unchanged')
    const readonlyPolicy = { current: { structuredKnowledge: true, sourceLibrary: true, writeKnowledge: false } }
    const readonlyTools = createResearchHubTools({ knowledgeService: {} as never, reviewService: {} as never, productionService: {} as never, workflowService, researchService, policyContext: readonlyPolicy })
    const readonlyTool = readonlyTools.find((item) => item.name === 'research_company')!
    const readonlyResponse = await readonlyTool.execute('pi-company-tool-readonly', { workflowRunId: 'pi-company-tool-readonly', symbol: '600519', name: '贵州茅台', exchange: 'SH' }, undefined, undefined, {} as never)
    const readonlyResult = JSON.parse(readonlyResponse.content[0]!.type === 'text' ? readonlyResponse.content[0]!.text : '{}') as { status: string; reportId?: string }
    assert.equal(readonlyResult.status, 'blocked')
    assert.deepEqual(await snapshotTree(root), before, 'Explicit read-only policy must preserve the existing Canonical Company and complete Knowledge tree')
    const explicitReadonlySha256 = await snapshotTreeSha256(root)
    assert.equal(explicitReadonlySha256, beforeSha256)
    const authorizedTools = createResearchHubTools({ knowledgeService: {} as never, reviewService: {} as never, productionService: {} as never, workflowService, researchService, policyContext: { current: { structuredKnowledge: true, sourceLibrary: true, writeKnowledge: true } } })
    const authorizedTool = authorizedTools.find((item) => item.name === 'research_company')!
    const authorizedResponse = await authorizedTool.execute('pi-company-tool-authorized', { workflowRunId: 'pi-company-tool-authorized', symbol: '600519', name: '贵州茅台', exchange: 'SH' }, undefined, undefined, {} as never)
    const authorizedResult = JSON.parse(authorizedResponse.content[0]!.type === 'text' ? authorizedResponse.content[0]!.text : '{}') as { status: string; committedIds?: string[]; reportId?: string }
    assert.equal(authorizedResult.status, 'blocked')
    assert.ok(authorizedResult.reportId)
    assert.deepEqual(authorizedResult.committedIds, [], 'Explicit write authorization cannot bypass the P0-19 quality gate')
    const persisted = await readCanonicalV04Assets(root)
    assert.equal(persisted.objects.some((item) => item.kind === 'claim'), false)
    const authorizedReport = await researchService.getResearchReport(authorizedResult.reportId!)
    const registeredRefs = new Set(persisted.registry.map((entry) => entry.id))
    const reportRefs = [...authorizedReport.subjectRefs, ...authorizedReport.sourceRefs, ...authorizedReport.claimRefs]
    assert.ok(reportRefs.every((ref) => registeredRefs.has(ref)), 'authorized report references must resolve through the persisted registry')
    await assert.rejects(
      () => verifyCompanyResearchKnowledge(root, authorizedReport, '600519'),
      /Write acceptance requires durable sources and qualified claims/,
      'A blocked report cannot be treated as accepted write evidence',
    )
    const rawBackedVerification = { verifiedRaw: [] }
    const evidenceDirectory = join(process.cwd(), 'tests', 'validation', 'evidence')
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(join(evidenceDirectory, 'company-quality-pi-default-deny.json'), `${JSON.stringify({
      taskId: 'RHL-EXEC-003-A-004-FIX-001',
      generatedAt: AS_OF,
      execution: 'Pi research_company Application Tool -> ResearchService -> Company Research Workflow -> DataResolver -> Acquisition Plugin -> Skill -> Gateway/Writer when explicitly authorized',
      knowledgeBaseSchema: '0.4',
      existingCompanyRef: 'entity:company-600519',
      modelGeneratedProposalIds: authorizedReport.claimRefs,
      defaultPolicy: { writeKnowledge: false, workflowStatus: result.status, reportId: result.reportId, sourceRefs: report.sourceRefs, claimRefs: report.claimRefs, beforeTreeSha256: beforeSha256, afterTreeSha256: defaultReadonlySha256 },
      explicitReadOnlyPolicy: { writeKnowledge: false, reportId: readonlyResult.reportId ?? null, beforeTreeSha256: beforeSha256, afterTreeSha256: explicitReadonlySha256 },
      explicitlyAuthorizedPolicy: { writeKnowledge: true, workflowStatus: authorizedResult.status, reportId: authorizedReport.reportId, committedIds: authorizedResult.committedIds, registryResolvedReportRefs: reportRefs },
      httpSessionPolicyInputs: { omitted: false, explicitReadOnly: false, explicitAuthorized: true, followUpDuringAuthorizedPrompt: 'conflict', subsequentOrdinaryPrompt: false },
      secretsIncluded: false,
      rawBackedVerification,
    }, null, 2)}\n`, 'utf8')
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(reports, { recursive: true, force: true })
  }
})
