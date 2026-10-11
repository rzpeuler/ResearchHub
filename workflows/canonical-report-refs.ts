import type { ResearchReport } from '../app/services/research-report.ts'
import type { KnowledgeAssetCollectionV04 } from '../knowledge/storage/v04-types.ts'

export function canonicalReferenceSet(assets: KnowledgeAssetCollectionV04): ReadonlySet<string> {
  return new Set(assets.registry.map((entry) => entry.id))
}

export function filterCanonicalRefs(refs: readonly string[], canonical: ReadonlySet<string>): string[] {
  return [...new Set(refs.filter((ref) => canonical.has(ref)))]
}

export function filterCanonicalRefMap(refs: Readonly<Record<string, string>>, canonical: ReadonlySet<string>): Record<string, string> {
  return Object.fromEntries(Object.entries(refs).filter(([, ref]) => canonical.has(ref)))
}

export function filterCanonicalReferenceTargets<T extends { readonly targetRef?: string }>(items: readonly T[], canonical: ReadonlySet<string>): T[] {
  return items.map((item) => item.targetRef !== undefined && !canonical.has(item.targetRef)
    ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'targetRef')) as T
    : item)
}

export function resolveResearchReportRefs<T extends ResearchReport>(report: T, assets: KnowledgeAssetCollectionV04): T {
  const canonical = canonicalReferenceSet(assets)
  return {
    ...report,
    subjectRefs: filterCanonicalRefs(report.subjectRefs, canonical),
    sourceRefs: filterCanonicalRefs(report.sourceRefs, canonical),
    claimRefs: filterCanonicalRefs(report.claimRefs, canonical),
    sections: report.sections.map((section) => ({
      ...section,
      ...(section.sourceRefs === undefined ? {} : { sourceRefs: filterCanonicalRefs(section.sourceRefs, canonical) }),
      ...(section.claimRefs === undefined ? {} : { claimRefs: filterCanonicalRefs(section.claimRefs, canonical) }),
      ...(section.relationRefs === undefined ? {} : { relationRefs: filterCanonicalRefs(section.relationRefs, canonical) }),
    })),
  }
}
