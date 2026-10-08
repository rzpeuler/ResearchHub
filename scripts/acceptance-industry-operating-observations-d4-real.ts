import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../knowledge/storage/create-v04.ts'
import { createIndustryDataCatalog } from '../data/industry-catalog.ts'
import type { IndustryDataResolverFactory } from '../workflows/industry-deep-research/contracts.ts'
import { IndustryOperatingObservationAcquisition } from '../plugins/research-acquisition/industry-operating-observations.ts'
import { MiitIndustryResearchPlugin } from '../plugins/research-acquisition/miit-industry.ts'
import { GovCnIndustryResearchPlugin } from '../plugins/research-acquisition/govcn-industry.ts'
import { CpcaIndustryResearchPlugin } from '../plugins/research-acquisition/cpca-industry.ts'
import { EastmoneyIndustryResearchPlugin } from '../plugins/research-acquisition/eastmoney-industry.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../plugins/reasoning/contracts.ts'
import type { ResearchAcquisitionPlugin } from '../plugins/research-acquisition/contracts.ts'
import { createRuntimeIndustryDataResolverFactory } from '../app/services/industry-data-resolver-factory.ts'
import { ResearchService } from '../app/services/research-service.ts'
import { WorkflowService } from '../app/services/workflow-service.ts'

type Dict = Record<string, unknown>
const enabled = process.env.RESEARCHHUB_RUN_REAL_INDUSTRY_OBSERVATIONS === '1'
const requestedAsOf = process.env.RESEARCHHUB_INDUSTRY_ANALYSIS_AS_OF
const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 20_000, structuredOutputSupport: true, maxConcurrency: 2 }

export function industryAcceptanceTimestamps(startedAt: string, explicitAsOf?: string): { readonly startedAt: string; readonly asOf: string } {
  return { startedAt, asOf: explicitAsOf ?? startedAt }
}

class DeterministicIndustryReasoningExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> {
    const input = request.input as Dict
    if (request.operation === 'industry_research_design') {
      const target = String((input.target as Dict | undefined)?.name ?? '')
      return { operation: request.operation, output: { definitionHypothesis: target, targetKind: 'industry', scope: { included: [target], excluded: [] }, moduleQuestions: { industry_definition: 'Define the industry.', market_size_growth: 'Measure market size and growth.', supply_demand_analysis: 'Assess supply, demand, and operating metrics.', industry_chain_analysis: 'Map the chain.', competitive_landscape: 'Assess competition.', technology_evolution: 'Assess technology.', company_mapping: 'Map companies.', risk_analysis: 'Assess risks.' }, keyMetrics: ['production', 'trade', 'price'], evidenceRequirements: ['official operating evidence'], searchTerms: [target], knownGaps: [], verificationCandidates: [] } }
    }
    const evidence = Array.isArray(input.evidence) ? input.evidence.filter((item): item is Dict => typeof item === 'object' && item !== null).map((item) => String(item.evidenceId)).filter(Boolean) : []
    if (request.operation === 'industry_module_analysis') return { operation: request.operation, output: { module: String(input.module), status: evidence.length ? 'supported' : 'partial', analysis: 'Deterministic live-source acceptance reasoning; numeric truth remains code-owned.', evidenceIds: evidence, proposals: [], gaps: evidence.length ? [] : [{ gapId: `${String(input.module)}-missing-evidence`, module: String(input.module), question: 'What source evidence is available?', reason: 'No qualified source was available.', actionable: false }], reportMaterial: { markdown: evidence.length ? 'Qualified source evidence was supplied.' : 'No qualified source evidence was available.', evidenceIds: evidence, proposalIds: [] } } }
    return { operation: request.operation, output: { executiveView: 'Deterministic product-path acceptance view.', analysis: 'This run uses only normal resolver outputs.', evidenceIds: evidence, proposals: [], gaps: [], alternativeViews: [], reportMaterial: { markdown: 'Industry Data Layer live acceptance.', evidenceIds: evidence, proposalIds: [] } } }
  }
}

function errorText(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 500) }

async function main(): Promise<void> {
  const { startedAt, asOf } = industryAcceptanceTimestamps(new Date().toISOString(), requestedAsOf)
  if (!enabled) {
    console.log(JSON.stringify({ classification: 'REAL_INDUSTRY_ACCEPTANCE_NOT_RUN', reason: 'Set RESEARCHHUB_RUN_REAL_INDUSTRY_OBSERVATIONS=1 to enable external transport.', networkCalls: 0, startedAt, asOf, generatedAt: new Date().toISOString() }))
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'rhl-d4-real-'))
  const reports = join(root, 'reports')
  const network: Array<{ host: string; status: number | 'ERROR'; elapsedMs: number }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const start = Date.now()
    let host = 'invalid-url'
    try { host = new URL(String(input)).hostname } catch { /* keep bounded diagnostic */ }
    try {
      const response = await fetch(input, init)
      network.push({ host, status: response.status, elapsedMs: Date.now() - start })
      return response
    } catch (error) {
      network.push({ host, status: 'ERROR', elapsedMs: Date.now() - start })
      throw error
    }
  }
  try {
    const plugins: ResearchAcquisitionPlugin[] = [
      new MiitIndustryResearchPlugin({ fetchImpl }),
      new GovCnIndustryResearchPlugin({ fetchImpl }),
      new CpcaIndustryResearchPlugin({ fetchImpl }),
      new EastmoneyIndustryResearchPlugin({ fetchImpl }),
    ]
    const metricAcquisition = new IndustryOperatingObservationAcquisition({ fetchImpl, now: () => new Date().toISOString(), timeoutMs: 30_000 })
    const industryDataResolverFactory: IndustryDataResolverFactory = createRuntimeIndustryDataResolverFactory({ plugins, metricAcquisition, catalog: createIndustryDataCatalog() })
    const targets = ['锂电池', '家用空调']
    const results: Dict[] = []
    for (const [index, name] of targets.entries()) {
      try {
        const targetRoot = join(root, `kb-${index + 1}`)
        const targetReports = join(reports, `target-${index + 1}`)
        await createFreshKnowledgeBaseV04(targetRoot, { knowledgeBaseId: `kb-d4-real-${index + 1}`, now: startedAt })
        const service = new ResearchService({ mountedKnowledgeBaseRoot: targetRoot, reportRoot: targetReports, acquisitionPlugins: plugins, workflowService: new WorkflowService(), reasoningExecutor: new DeterministicIndustryReasoningExecutor(), industryDataResolverFactory })
        const result = await service.startIndustryResearch({ workflowRunId: `d4-real-${index + 1}`, name, asOf, maxSources: 8, maxEvidencePerModule: 2 }).completion
        let reportSummary: Dict = { sourceRefs: 0, sections: 0 }
        if (result.reportPath) {
          const report = JSON.parse(await readFile(join(targetReports, `${result.reportPath}.json`), 'utf8')) as { sections?: readonly { sourceRefs?: readonly string[] }[]; sourceRefs?: readonly string[] }
          const sourceRefs = [...new Set((report.sections ?? []).flatMap((section) => section.sourceRefs ?? []).concat(report.sourceRefs ?? []))]
          reportSummary = { sourceRefs: sourceRefs.length, canonicalSourceRefs: sourceRefs.every((ref) => ref.startsWith('source:')), sections: report.sections?.length ?? 0 }
        }
        results.push({ target: name, status: result.status, errorSummary: result.errorSummary ?? null, requirementCoverage: result.requirementCoverage, dataRequirementGaps: result.dataRequirementGaps, acquisitionDiagnostics: result.acquisitionDiagnostics.slice(0, 32), reportId: result.reportId ?? null, report: reportSummary, operatingObservationCount: result.operatingObservations.length })
      } catch (error) { results.push({ target: name, status: 'UNAVAILABLE', error: errorText(error) }) }
    }
    const metricGapsOnly = results.length === 2 && results.every((result) => Array.isArray(result.dataRequirementGaps) && result.dataRequirementGaps.length > 0)
    const classification = results.every((result) => result.status === 'completed') && metricGapsOnly
      ? 'REAL_APPLICATION_RESOLVER_PATH_COMPLETED_WITH_EXPLICIT_NONCANONICAL_METRIC_GAPS'
      : network.length === 0 ? 'REAL_INDUSTRY_TRANSPORT_UNAVAILABLE' : 'REAL_APPLICATION_RESOLVER_PATH_PARTIAL'
    const networkSummary: Record<string, { calls: number; elapsedMs: number }> = {}
    for (const item of network) {
      const key = `${item.host}:${item.status}`
      const previous = networkSummary[key] ?? { calls: 0, elapsedMs: 0 }
      networkSummary[key] = { calls: previous.calls + 1, elapsedMs: previous.elapsedMs + item.elapsedMs }
    }
    console.log(JSON.stringify({ classification, startedAt, generatedAt: new Date().toISOString(), asOf, networkCalls: network.length, networkSummary, metricCatalog: 'empty production catalog; no audited metric is promoted by this acceptance run', targets: results, secretsIncluded: false, rawBodiesIncluded: false }, null, 2))
  } finally { await rm(root, { recursive: true, force: true }) }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
