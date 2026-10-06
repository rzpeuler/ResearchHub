import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadKnowledgeBaseManifest } from '../knowledge/storage/manifest-loader.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'

const root = 'C:/Users/Administrator/Desktop/ResearchHubData/knowledge-bases/ai-compute-theme-v04-verified'
const runId = 'tf-ai-compute-20261003-58894667-0e32-4fb7-a751-331049874d61'
const path = join(root, 'logs', 'theme-framework', 'reviews', `${runId}.candidate.json`)
const envelope = JSON.parse(await readFile(path, 'utf8'))
const candidate = envelope.payload.candidate
const safeEvidence = new Map(envelope.payload.evidence.map((item: any) => [item.evidenceId, item]))
const bindings = new Map(candidate.durableEvidenceBindings.map((item: any) => [item.evidenceId, item]))
const evidenceInfo = (refs: string[]) => refs.map((evidenceId) => {
  const item = safeEvidence.get(evidenceId) as any
  const binding = bindings.get(evidenceId) as any
  const match = item?.summary?.match(/block=([^;]+); page=([^;]+);/u)
  return { evidenceId, sourceRef: binding?.sourceRef ?? item?.sourceRef ?? null, kind: binding?.locator && binding.locator !== 'retained source document' ? 'body_excerpt' : 'title_or_external', blockId: binding?.locator && binding.locator !== 'retained source document' ? binding.locator : match?.[1] ?? null, page: match?.[2] ?? null }
})
const framework = candidate.framework
const industries = framework.industryCandidates.map((item: any) => ({ candidateId: item.candidateId, name: item.name, recommendation: item.recommendation, evidence: evidenceInfo(item.evidenceRefs ?? []), coverageGaps: item.coverageGaps ?? [] }))
const relations = framework.relationCandidates.map((item: any) => ({ candidateId: item.candidateId, source: item.sourceIndustryRef, target: item.targetIndustryRef, relationType: item.relationType, recommendation: item.recommendation, evidence: evidenceInfo(item.evidenceRefs ?? []), coverageGaps: item.coverageGaps ?? [] }))
const manifest = await loadKnowledgeBaseManifest(root)
const assets = await readCanonicalV04Assets(root)
const sources = assets.objects.filter((item) => item.kind === 'source').map((item) => item.value as any)
const sourceMetadata = [...new Set(candidate.durableEvidenceBindings.map((binding: any) => binding.sourceRef))].map((sourceRef) => {
  const source = sources.find((item) => item.id === sourceRef)
  return source ? { sourceRef: source.id, title: source.title, publisher: source.publisher ?? null, publishedAt: source.publishedAt ?? null } : { sourceRef, title: null, publisher: null }
})
console.log(JSON.stringify({ runId, reviewStatus: 'awaiting_review', kb: { id: manifest.knowledgeBaseId, basedOnRevision: candidate.basedOnRevision, currentRevision: manifest.revision }, theme: candidate.theme, proposedDefinition: framework.proposedDefinition, recommendationCounts: Object.fromEntries(['include', 'exclude', 'pending'].map((key) => [key, industries.filter((item: any) => item.recommendation === key).length])), sourceMetadata, industries, relations, overallCoverageGaps: framework.coverageGaps, acquisitionStatus: candidate.acquisitionStatus, canonicalCounts: Object.fromEntries(['entity', 'relation', 'source'].map((kind) => [kind, assets.objects.filter((item) => item.kind === kind).length])) }))
