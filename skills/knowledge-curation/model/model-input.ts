import type { ReasoningCapabilities } from '../../../plugins/reasoning/contracts.ts'
import type { ExtractKnowledgeInput, ResolveSemanticCaseInput, UnderstandAndPlanInput, DocumentContentRef } from '../contracts.ts'
import type { CurationSchemaContext } from './schema-context-types.ts'
import type { DocumentBlock, StructuredDocument } from '../../../plugins/document/contracts.ts'

export interface PreparedUnderstandAndPlanInput extends UnderstandAndPlanInput {
  readonly capabilities: ReasoningCapabilities
  readonly schemaContext: CurationSchemaContext
}
export interface PreparedExtractKnowledgeInput extends ExtractKnowledgeInput {
  readonly schemaContext: CurationSchemaContext
}
export interface PreparedResolveSemanticCaseInput extends ResolveSemanticCaseInput { readonly schemaContext: CurationSchemaContext }

export function projectUnderstandAndPlanModelInput(input: PreparedUnderstandAndPlanInput): unknown {
  return {
    document: projectUnderstandAndPlanDocument(input.document),
    capabilities: structuredClone(input.capabilities),
    schemaContext: structuredClone(input.schemaContext),
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    ...(input.planRepair === undefined ? {} : { planRepair: structuredClone(input.planRepair) }),
  }
}

function projectUnderstandAndPlanDocument(document: StructuredDocument): unknown {
  const orderedText = [...document.blocks].sort((a, b) => a.order - b.order).map((block) => block.text).join('\n\n').trim()
  const omitNormalizedText = document.normalizedText === orderedText
  return {
    documentId: document.documentId,
    parser: structuredClone(document.parser),
    metadata: structuredClone(document.metadata),
    ...(omitNormalizedText ? {} : { normalizedText: document.normalizedText }),
    sections: structuredClone(document.sections),
    blocks: document.blocks.map(projectUnderstandAndPlanBlock),
    stats: structuredClone(document.stats),
    warnings: structuredClone(document.warnings),
  }
}

function projectUnderstandAndPlanBlock(block: DocumentBlock): unknown {
  const omitStructuredContent = block.type === 'table' && isDuplicateTableContent(block.structuredContent, block.text)
  return {
    blockId: block.blockId,
    type: block.type,
    text: block.text,
    sectionRef: block.sectionRef,
    page: block.page,
    locator: Object.fromEntries(Object.entries(block.locator).filter(([key]) => key !== 'boundingBox' && key !== 'parserItemRef')),
    order: block.order,
    ...(block.metadata === undefined ? {} : { metadata: structuredClone(block.metadata) }),
    ...(block.structuredContent === undefined || omitStructuredContent ? {} : { structuredContent: structuredClone(block.structuredContent) }),
  }
}

function isDuplicateTableContent(content: DocumentBlock['structuredContent'], text: string): boolean {
  return content !== undefined
    && content.kind === 'table'
    && content.markdown === text
    && Object.keys(content).length === 2
    && Object.hasOwn(content, 'kind')
    && Object.hasOwn(content, 'markdown')
}

export function projectExtractKnowledgeModelInput(input: PreparedExtractKnowledgeInput): unknown {
  const primary = new Set(input.unit.primaryRefs.flatMap((ref) => blockIdsForRef(input.document, ref)))
  const context = new Set(input.unit.contextRefs.flatMap((ref) => blockIdsForRef(input.document, ref)))
  const allowed = new Set([...primary, ...context])
  return {
    reportMap: structuredClone(input.reportMap),
    unit: structuredClone(input.unit),
    blocks: input.document.blocks.filter((block) => allowed.has(block.blockId)).sort((a, b) => a.order - b.order).map((block) => ({
      ...structuredClone(block),
      role: primary.has(block.blockId) ? 'primary' : 'context',
    })),
    schemaContext: structuredClone(input.schemaContext),
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
    ...(input.validationFeedback === undefined ? {} : { validationFeedback: structuredClone(input.validationFeedback) }),
  }
}

export function projectResolveSemanticCaseModelInput(input: PreparedResolveSemanticCaseInput): unknown {
  return {
    resolutionCase: structuredClone(input.resolutionCase),
    schemaContext: structuredClone(input.schemaContext),
    ...(input.instructions === undefined ? {} : { instructions: input.instructions }),
  }
}

export function blockIdsForRef(document: UnderstandAndPlanInput['document'], ref: DocumentContentRef): string[] {
  if (ref.kind === 'block') return document.blocks.some((block) => block.blockId === ref.blockId) ? [ref.blockId] : []
  return document.sections.find((section) => section.sectionId === ref.sectionId)?.blockRefs.filter((id) => document.blocks.some((block) => block.blockId === id)) ?? []
}
