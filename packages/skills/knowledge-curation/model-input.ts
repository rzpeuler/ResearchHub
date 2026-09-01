import type { ExtractKnowledgeInput, ExtractionBatch, KnowledgeContext, ReconcileKnowledgeInput, ReconciliationGroup, ReportUnderstanding } from './types.ts'

export interface ExtractKnowledgeModelInput {
  batch: ExtractionBatch
  reportUnderstanding: ReportUnderstanding
  knowledgeContext: Pick<KnowledgeContext, 'schemaVersion' | 'existingRefs' | 'themeGroups' | 'themes' | 'entities'>
}

/**
 * Project the authoritative extraction input to the least-privilege model view.
 * The caller must retain the original input for deterministic validation.
 */
export function projectExtractKnowledgeModelInput(input: ExtractKnowledgeInput): ExtractKnowledgeModelInput {
  const batchChunkIds = new Set(input.batch.chunks.map((chunk) => chunk.chunkId))
  return {
    batch: {
      batchId: input.batch.batchId,
      sections: input.batch.sections.map((section) => ({ ...structuredClone(section), chunkIds: section.chunkIds.filter((chunkId) => batchChunkIds.has(chunkId)) })),
      chunks: structuredClone(input.batch.chunks),
    },
    reportUnderstanding: projectReportUnderstanding(input.reportUnderstanding, batchChunkIds),
    knowledgeContext: {
      schemaVersion: input.knowledgeContext.schemaVersion,
      existingRefs: structuredClone(input.knowledgeContext.existingRefs),
      themeGroups: structuredClone(input.knowledgeContext.themeGroups),
      themes: structuredClone(input.knowledgeContext.themes),
      entities: structuredClone(input.knowledgeContext.entities),
    },
  }
}

export interface ReconcileKnowledgeModelInput {
  groups: ReconciliationGroup[]
  sourceAssessment: ReconcileKnowledgeInput['sourceAssessment']
}

/**
 * Project reconciliation to candidate groups and precise context only. The
 * authoritative input remains available to the deterministic validator.
 */
export function projectReconcileKnowledgeModelInput(input: ReconcileKnowledgeInput): ReconcileKnowledgeModelInput {
  return {
    groups: structuredClone(input.groups),
    sourceAssessment: structuredClone(input.sourceAssessment),
  }
}

function projectReportUnderstanding(input: ReportUnderstanding, batchChunkIds: ReadonlySet<string>): ReportUnderstanding {
  return {
    sourceAssessment: structuredClone(input.sourceAssessment),
    researchScope: structuredClone(input.researchScope),
    majorTopics: structuredClone(input.majorTopics),
    majorEntityMentions: input.majorEntityMentions.map((mention) => ({ ...structuredClone(mention), evidenceChunkRefs: mention.evidenceChunkRefs.filter((chunkId) => batchChunkIds.has(chunkId)) })),
    themeHypotheses: input.themeHypotheses.map((hypothesis) => ({ ...structuredClone(hypothesis), evidenceChunkRefs: hypothesis.evidenceChunkRefs.filter((chunkId) => batchChunkIds.has(chunkId)) })),
    ...(input.newThemeProposal === undefined ? {} : { newThemeProposal: structuredClone(input.newThemeProposal) }),
    uncertainty: structuredClone(input.uncertainty),
  }
}
