import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFreshKnowledgeBaseV04 } from '../../knowledge/storage/index.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import { materializePhase3CommonRequirement } from '../../data/requirements.ts'
import { createCompanyResearchDataResolver } from '../../plugins/research-acquisition/company-research-data.ts'
import { AkshareDataAdapter } from '../../plugins/research-acquisition/akshare.ts'
import { CninfoOfficialDisclosureClient, OfficialDisclosureResearchPlugin } from '../../plugins/research-acquisition/official.ts'
import { GdeltResearchPlugin } from '../../plugins/research-acquisition/gdelt.ts'

type Consumer = 'company-deep-research' | 'event-research' | 'thesis-red-team'
export type Phase3ConsumerEvidenceClassification = 'REAL_SOURCE_BLOCKED' | 'REAL_SOURCE_AVAILABLE_WORKFLOW_NOT_EXECUTED'
const company = { symbol: process.env.RESEARCHHUB_PHASE3_SYMBOL ?? '600519', name: process.env.RESEARCHHUB_PHASE3_COMPANY ?? '贵州茅台', exchange: 'SSE' }
const asOf = new Date().toISOString()
const timeoutMs = 20_000

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (/^Command failed:/u.test(raw)) return 'External helper process failed; command details suppressed.'
  return raw
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/(api[_-]?key|token|secret|password)=([^&\s]+)/gi, '$1=[redacted]')
    .slice(0, 400)
}

function timeoutFetch(): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try { return await fetch(input, { ...init, signal: controller.signal }) }
    finally { clearTimeout(timer) }
  }
}

export function classifyPhase3ConsumerEvidence(usableExternalEvidenceCount: number): Phase3ConsumerEvidenceClassification {
  return usableExternalEvidenceCount > 0 ? 'REAL_SOURCE_AVAILABLE_WORKFLOW_NOT_EXECUTED' : 'REAL_SOURCE_BLOCKED'
}

export async function runPhase3LiveAcceptance(consumer: Consumer): Promise<void> {
  if (process.env.RESEARCHHUB_PHASE3_LIVE !== '1') {
    console.log(JSON.stringify({ consumer, status: 'SKIPPED', reason: 'Set RESEARCHHUB_PHASE3_LIVE=1 to opt in; no network was used.' }))
    return
  }

  const isolatedRoot = await mkdtemp(join(tmpdir(), `researchhub-phase3-${consumer}-`))
  try {
    const knowledgeRoot = join(isolatedRoot, 'disposable-knowledge')
    await createFreshKnowledgeBaseV04(knowledgeRoot, { knowledgeBaseId: `phase3-${consumer}-${Date.now()}`, now: asOf })
    const handle = await new KnowledgeBaseRegistry().mount(knowledgeRoot)
    const fetchImpl = timeoutFetch()
    const officialDisclosure = new OfficialDisclosureResearchPlugin(new CninfoOfficialDisclosureClient({ fetchImpl, timeoutMs }))
    const gdelt = new GdeltResearchPlugin({ fetchImpl })
    const resolver = createCompanyResearchDataResolver({
      company,
      akshare: new AkshareDataAdapter(),
      officialDisclosure,
      gdelt,
      now: () => new Date().toISOString(),
    })
    const ids = consumer === 'company-deep-research'
      ? ['company_basic_profile', 'company_financial_history', 'company_market_history', 'company_research_evidence']
      : ['company_research_evidence']
    const requirements = ids.map((metricId) => materializePhase3CommonRequirement(metricId, {
      workflowId: consumer,
      ticker: company.symbol,
      asOf,
      ...(metricId === 'company_market_history' ? { period: { end: asOf } } : {}),
      ...(consumer === 'event-research' ? { period: { start: new Date(Date.parse(asOf) - 7 * 86_400_000).toISOString(), end: asOf } } : {}),
      ...(consumer === 'thesis-red-team' ? { period: { start: new Date(Date.parse(asOf) - 365 * 86_400_000).toISOString(), end: asOf } } : {}),
    }))
    const legs: Record<string, unknown>[] = []
    let consumerEvidenceCount = 0
    for (const requirement of requirements) {
      try {
        const item = await resolver.resolveOne(requirement)
        const documents = requirement.metricId === 'company_research_evidence'
          ? ((item.value as { documents?: readonly { dateStatus?: string; record?: unknown }[] } | undefined)?.documents ?? []).filter((document) => document.dateStatus === 'QUALIFIED' && document.record !== undefined)
          : []
        if (requirement.metricId === 'company_research_evidence') consumerEvidenceCount += documents.length
        const attempts = item.attempts.map((attempt) => ({ sourceId: attempt.sourceId, status: attempt.status, diagnostic: attempt.diagnostic ? safeError(attempt.diagnostic) : undefined }))
        const observations = (item.acquisition.observations ?? []).map((observation) => {
          const data = observation.data as { outcome?: { transportSucceeded?: boolean; fetchSucceeded?: boolean; discovered?: number; fetched?: number; failed?: number; empty?: number; rejected?: number; deduplicated?: number } } | undefined
          return { sourceId: observation.source.sourceId, outcome: data?.outcome }
        })
        legs.push({ requirementId: requirement.id, metricId: requirement.metricId, providerLegStatus: item.status, usableExternalEvidenceCount: documents.length, attempts, observations })
      } catch (error) {
        legs.push({ requirementId: requirement.id, metricId: requirement.metricId, providerLegStatus: 'ERROR', usableExternalEvidenceCount: 0, error: safeError(error) })
      }
    }
    const evidence = {
      generatedAt: new Date().toISOString(), consumer, optIn: true, company: { symbol: company.symbol, name: company.name }, asOf,
      knowledgeBase: { disposable: true, isolatedPath: knowledgeRoot, revision: handle.revision },
      providers: ['AKShare', 'CNINFO', 'GDELT'], providerLegs: legs,
      consumerAcceptance: { classification: classifyPhase3ConsumerEvidence(consumerEvidenceCount), usableExternalEvidenceCount: consumerEvidenceCount, consumerWorkflowExecuted: false, note: 'Provider leg outcomes are acquisition diagnostics; this script does not execute model reasoning or claim consumer acceptance.' },
      secretsIncluded: false, rawBodiesIncluded: false,
    }
    console.log(JSON.stringify(evidence, null, 2))
  } finally {
    await rm(isolatedRoot, { recursive: true, force: true })
  }
}
