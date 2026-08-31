import { KnowledgeCurationError } from './errors.ts'
import type { KnowledgeCurationModel, KnowledgeCurationModelRequest, StructuredOutputContract } from './model.ts'
import { STRUCTURED_OUTPUT_CONTRACTS } from './contracts.ts'
import { UNDERSTAND_REPORT_PROMPT } from './prompts/understand-report.ts'
import { EXTRACT_KNOWLEDGE_PROMPT } from './prompts/extract-knowledge.ts'
import { RECONCILE_KNOWLEDGE_PROMPT } from './prompts/reconcile-knowledge.ts'
import { ANALYZE_SCHEMA_GAPS_PROMPT } from './prompts/analyze-schema-gaps.ts'
import { buildCurationSchemaContext } from './schema-context.ts'
import { projectExtractKnowledgeModelInput } from './model-input.ts'
import { validateAnalyzeSchemaGaps, validateExtractKnowledge, validateReconcileKnowledge, validateUnderstandReport } from './validation.ts'
import type { AnalyzeSchemaGapsOutput, ExtractKnowledgeInput, ExtractKnowledgeOutput, ReconcileKnowledgeInput, ReconcileKnowledgeOutput, ReportUnderstanding, SchemaGapInput, UnderstandReportInput } from './types.ts'

export interface KnowledgeCurationSkillOptions {
  model: KnowledgeCurationModel
}

const sliceByOperation = {
  understandReport: 'report_understanding',
  extractKnowledge: 'knowledge_extraction',
  reconcileKnowledge: 'reconciliation',
  analyzeSchemaGaps: 'schema_gap',
} as const

export class KnowledgeCurationSkill {
  constructor(private readonly options: KnowledgeCurationSkillOptions) {
    if (!options?.model || typeof options.model.invoke !== 'function') throw new KnowledgeCurationError('model_error', 'KnowledgeCurationSkill requires an injected KnowledgeCurationModel')
  }

  private async invoke(operation: keyof typeof sliceByOperation, instruction: string, input: unknown, outputContract: StructuredOutputContract): Promise<unknown> {
    const request: KnowledgeCurationModelRequest = { operation, instruction, input: structuredClone(input), schemaContext: buildCurationSchemaContext(sliceByOperation[operation]), outputContract: structuredClone(outputContract) }
    try { return await this.options.model.invoke(request) } catch (error) { if (error instanceof KnowledgeCurationError) throw error; throw new KnowledgeCurationError('model_error', error instanceof Error ? error.message : String(error), error) }
  }

  async understandReport(input: UnderstandReportInput): Promise<ReportUnderstanding> {
    const raw = await this.invoke('understandReport', UNDERSTAND_REPORT_PROMPT, input, STRUCTURED_OUTPUT_CONTRACTS.understandReport)
    return validateUnderstandReport(raw, input)
  }

  async extractKnowledge(input: ExtractKnowledgeInput): Promise<ExtractKnowledgeOutput> {
    const raw = await this.invoke('extractKnowledge', EXTRACT_KNOWLEDGE_PROMPT, projectExtractKnowledgeModelInput(input), STRUCTURED_OUTPUT_CONTRACTS.extractKnowledge)
    return validateExtractKnowledge(raw, input)
  }

  async reconcileKnowledge(input: ReconcileKnowledgeInput): Promise<ReconcileKnowledgeOutput> {
    const raw = await this.invoke('reconcileKnowledge', RECONCILE_KNOWLEDGE_PROMPT, input, STRUCTURED_OUTPUT_CONTRACTS.reconcileKnowledge)
    return validateReconcileKnowledge(raw, input)
  }

  async analyzeSchemaGaps(input: SchemaGapInput): Promise<AnalyzeSchemaGapsOutput> {
    const raw = await this.invoke('analyzeSchemaGaps', ANALYZE_SCHEMA_GAPS_PROMPT, input, STRUCTURED_OUTPUT_CONTRACTS.analyzeSchemaGaps)
    return validateAnalyzeSchemaGaps(raw, input)
  }
}
