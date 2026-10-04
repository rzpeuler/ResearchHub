import type { IndustryAcquisitionWaveRequest } from '../../workflows/industry-deep-research/contracts.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchProviderOutcome, ResearchSourceCandidate } from './contracts.ts'

export interface IndustryAcquisitionRun { readonly sources: readonly NormalizedResearchSource[]; readonly outcomes: readonly ResearchProviderOutcome[]; readonly diagnostics: readonly string[] }
const CANDIDATE_CONCURRENCY = 4
async function acquireCandidates(plugin: ResearchAcquisitionPlugin, candidates: readonly ResearchSourceCandidate[], signal?: AbortSignal): Promise<readonly { readonly normalized?: NormalizedResearchSource; readonly error?: unknown }[]> {
  const results: Array<{ normalized?: NormalizedResearchSource; error?: unknown }> = Array.from({ length: candidates.length }, () => ({}))
  let next = 0
  const worker = async () => { while (true) { if (signal?.aborted) return; const index = next++; if (index >= candidates.length) return; try { const fetched = await plugin.fetch(candidates[index]!, signal); if (signal?.aborted) return; results[index] = { normalized: await plugin.normalize(fetched, signal) } } catch (error) { results[index] = { error } } } }
  await Promise.all(Array.from({ length: Math.min(CANDIDATE_CONCURRENCY, candidates.length) }, () => worker()))
  return results
}
export class IndustryAcquisitionComposition {
  constructor(private readonly plugins: readonly ResearchAcquisitionPlugin[], private readonly maxCandidatesPerProvider = 12, private readonly maxSources = 24) {}
  async acquire(request: IndustryAcquisitionWaveRequest, options: { readonly signal?: AbortSignal } = {}): Promise<IndustryAcquisitionRun> {
    const sources: NormalizedResearchSource[] = []; const outcomes: ResearchProviderOutcome[] = []; const diagnostics: string[] = []; const seen = new Set<string>()
    const terms = [...new Set(request.searchTerms.map((x) => x.trim()).filter(Boolean))].slice(0, 8).map((x) => x.slice(0, 120))
    const target = { name: request.target.name, aliases: (request.target.aliases ?? []).slice(0, 8), canonicalRef: request.target.canonicalRef, searchTerms: terms }
    for (const plugin of this.plugins.slice(0, 8)) {
      if (options.signal?.aborted) break
      let candidates: readonly ResearchSourceCandidate[] = []; let failed = false; let attempted = 0; let usable = 0
      try { candidates = (await plugin.discover({ industry: target, asOf: request.target.asOf, limitPerKind: this.maxCandidatesPerProvider }, options.signal)).slice(0, this.maxCandidatesPerProvider) } catch { failed = true; diagnostics.push(`${plugin.name}: discovery_failed`) }
      if (options.signal?.aborted) break
      const remaining = Math.max(0, this.maxSources - sources.length); const attemptedCandidates = candidates.slice(0, remaining); attempted += attemptedCandidates.length
      const results = await acquireCandidates(plugin, attemptedCandidates, options.signal)
      if (options.signal?.aborted) break
      for (let index = 0; index < results.length; index++) { const result = results[index]!; const candidate = attemptedCandidates[index]!; if (result.error !== undefined) { failed = true; diagnostics.push(`${plugin.name}:${candidate.candidateId}: candidate_failed`); continue } const normalized = result.normalized!; const key = normalized.canonicalUrl ? `url:${normalized.canonicalUrl}` : `hash:${normalized.contentHash}`; if (!normalized.content.trim() || seen.has(key)) continue; seen.add(key); sources.push(normalized); usable++ }
      outcomes.push({ provider: plugin.name, providerAttempted: true, providerSucceeded: usable > 0, providerEmpty: !failed && attempted > 0 && usable === 0 || !failed && attempted === 0, providerFailed: failed, usableSourceCount: usable })
    }
    return { sources, outcomes, diagnostics: diagnostics.slice(0, 32) }
  }
}
