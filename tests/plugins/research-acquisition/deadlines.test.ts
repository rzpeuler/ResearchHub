import assert from 'node:assert/strict'
import test from 'node:test'
import { acquisitionStep } from '../../../plugins/research-acquisition/deadlines.ts'
import { CninfoOfficialDisclosureClient } from '../../../plugins/research-acquisition/official.ts'
import { createCompanyResearchDataResolver } from '../../../plugins/research-acquisition/company-research-data.ts'
import { materializePhase3CommonRequirement } from '../../../data/requirements.ts'
import type { WorkflowAcquisitionActivity } from '../../../workflows/observation-contracts.ts'
import type { ResearchAcquisitionPlugin } from '../../../plugins/research-acquisition/contracts.ts'

test('download deadline remains active after headers and aborts body consumption', async () => {
  let aborted = false
  const activities: WorkflowAcquisitionActivity[] = []
  const client = new CninfoOfficialDisclosureClient({ fetchImpl: (async (_url, init) => new Response(new ReadableStream({
    start(controller) { init?.signal?.addEventListener('abort', () => { aborted = true; controller.error(new Error('aborted')) }, { once: true }) },
  }), { headers: { 'content-type': 'application/pdf' } })) as typeof fetch })
  await assert.rejects(client.fetchDocument({ title: 'Annual report', url: 'https://static.cninfo.com.cn/report.pdf', publishedAt: '2026-10-01' }, undefined,
    { downloadTimeoutMs: 25, onProgress: (activity) => { activities.push(activity) } }), /SOURCE_DOWNLOAD_TIMEOUT/)
  assert.equal(aborted, true)
  assert.ok(activities.some((activity) => activity.step === 'body_read' && activity.status === 'running'))
  assert.ok(activities.some((activity) => activity.step === 'download' && activity.status === 'timeout'))
  assert.ok(activities.some((activity) => activity.step === 'body_read' && activity.status === 'timeout'))
})

test('Company parser deadline aborts parser signal without changing other workflow defaults', async () => {
  let parserAborted = false
  const parser = { parse: async (_input: unknown, options?: { signal?: AbortSignal }): Promise<never> => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { parserAborted = true; reject(new Error('parser cancelled')) }, { once: true })
  }) }
  const client = new CninfoOfficialDisclosureClient({ documentResolver: parser, fetchImpl: (async () => new Response('pdf', { headers: { 'content-type': 'application/pdf' } })) as typeof fetch })
  await assert.rejects(client.fetchDocument({ title: 'Annual report', url: 'https://static.cninfo.com.cn/report.pdf', publishedAt: '2026-10-01' }, undefined,
    { parseTimeoutMs: 25 }), /DOCUMENT_PARSE_TIMEOUT/)
  assert.equal(parserAborted, true)
})

test('caller cancellation is distinct from timeout and reaches the active operation', async () => {
  const controller = new AbortController()
  let observedSignal: AbortSignal | undefined
  const promise = acquisitionStep({ activityId: 'source:parse', providerId: 'cninfo', step: 'parsing', timeoutMs: 5000, signal: controller.signal },
    async (signal) => { observedSignal = signal; controller.abort(); return new Promise<never>(() => {}) })
  await assert.rejects(promise, /WORKFLOW_CANCELLED/)
  assert.equal(observedSignal?.aborted, true)
})

test('whole acquisition budget retains evidence already fetched when another document stalls', async () => {
  const date = '2026-10-14T00:00:00.000Z'
  let aborted = false
  const candidates = ['first', 'slow'].map((candidateId) => ({ candidateId, provider: 'cninfo', title: candidateId, kind: 'official_disclosure' as const, tier: 1 as const, url: `https://static.cninfo.com.cn/${candidateId}.pdf`, publishedAt: '2026-10-13T00:00:00.000Z' }))
  const plugin: ResearchAcquisitionPlugin = {
    name: 'cninfo', async discover() { return candidates },
    async fetch(candidate, signal) {
      if (candidate.candidateId === 'slow') return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')) }, { once: true }))
      return { candidate, content: 'Evidence already fetched', contentHash: 'first-hash', retrievedAt: date }
    },
    async normalize(source) { return { ...source, title: source.candidate.title, contentHash: source.contentHash!, canonicalUrl: source.candidate.url, publisher: 'CNINFO', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false } } },
  }
  const resolver = createCompanyResearchDataResolver({ company: { symbol: '002384', name: '东山精密' }, officialDisclosure: plugin, now: () => date, acquisitionDeadlineAt: Date.now() + 65 })
  const result = await resolver.resolveOne(materializePhase3CommonRequirement('company_research_evidence', { workflowId: 'company-deep-research', ticker: '002384', asOf: date, asOfMode: 'CURRENT_VALUE_ONLY' }))
  const batches = result.acquisition.observations?.map((observation) => observation.data).filter((data) => data.kind === 'evidence') ?? []
  assert.equal(batches.flatMap((batch) => batch.documents).length, 1)
  assert.equal(aborted, true)
  assert.ok(batches.some((batch) => batch.outcome.diagnostics.some((diagnostic) => diagnostic.includes('ACQUISITION_BUDGET_EXCEEDED'))))
})
