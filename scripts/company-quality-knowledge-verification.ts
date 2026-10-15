import assert from 'node:assert/strict'
import { KnowledgeBaseRegistry } from '../knowledge/registry/registry.ts'
import { readCanonicalV04Assets } from '../knowledge/storage/canonical-v04-loader.ts'
import { verifyRaw } from '../knowledge/raw/raw-archive.ts'
import type { ResearchReport } from '../app/services/research-report.ts'

/** Independently reload persisted Schema 0.4 assets and verify their archived original bytes. */
export async function verifyCompanyResearchKnowledge(root: string, report: ResearchReport, symbol: string) {
  const handle = await new KnowledgeBaseRegistry().mount(root)
  const assets = await readCanonicalV04Assets(root)
  const byId = new Map<string, Record<string, unknown>>(assets.objects.map((asset) => [asset.value.id, asset.value as unknown as Record<string, unknown>]))
  const refs = [...new Set([...report.subjectRefs, ...report.sourceRefs, ...report.claimRefs, ...report.sections.flatMap((section) => [...section.sourceRefs ?? [], ...section.claimRefs ?? [], ...section.relationRefs ?? []])])]
  assert.ok(report.subjectRefs.some((ref) => byId.get(ref)?.type === 'company' && byId.get(ref)?.ticker === symbol), 'Company subject must resolve to the persisted verified security')
  assert.ok(report.sourceRefs.length > 0 && report.claimRefs.length > 0, 'Write acceptance requires durable sources and qualified claims')
  for (const ref of refs) assert.ok(byId.has(ref), `Persisted report reference does not resolve: ${ref}`)
  const rawRefs = new Set<string>()
  for (const ref of report.sourceRefs) {
    const raw = byId.get(ref)!.rawRefs
    assert.ok(Array.isArray(raw) && raw.length > 0, `Source lacks Raw-backed evidence: ${ref}`)
    for (const rawRef of raw) { assert.ok(typeof rawRef === 'string' && /^raw-sha256-[0-9a-f]{64}$/.test(rawRef)); rawRefs.add(rawRef) }
  }
  for (const ref of report.claimRefs) {
    const provenance = byId.get(ref)!.provenance
    assert.ok(Array.isArray(provenance) && provenance.length > 0, `Claim lacks Raw-backed provenance: ${ref}`)
    for (const binding of provenance) {
      assert.ok(binding && typeof binding.rawRef === 'string' && typeof binding.sourceRef === 'string', `Claim has incomplete provenance: ${ref}`)
      const source = byId.get(binding.sourceRef)
      assert.ok(source && Array.isArray(source.rawRefs) && source.rawRefs.includes(binding.rawRef), `Claim Raw binding does not resolve through its Source: ${ref}`)
      rawRefs.add(binding.rawRef)
    }
  }
  const verifiedRaw = []
  for (const rawRef of rawRefs) { const checked = await verifyRaw(handle, rawRef); verifiedRaw.push({ rawRef, contentHash: checked.contentHash, sizeBytes: checked.sizeBytes, valid: checked.valid }) }
  return { knowledgeBaseId: handle.knowledgeBaseId, revision: handle.revision, registryReferences: refs, sourceCount: report.sourceRefs.length, claimCount: report.claimRefs.length, verifiedRaw }
}
