import { type Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { EventAnalysisWorkflow } from './workflow.ts'
import type { EventAnalysisClock, EventAnalysisInput } from './types.ts'

const parameters = {
  symbol: { type: 'string', required: true, description: 'Stock symbol.' },
  evaluationPeriod: {
    type: 'object',
    required: true,
    additionalProperties: false,
    properties: {
      start: { type: 'string', required: true, description: 'Evaluation period start in ISO format.' },
      end: { type: 'string', required: true, description: 'Evaluation period end in ISO format.' },
    },
  },
} as const

const evidenceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    type: { type: 'string', required: true, enum: ['evidence'] },
    createdAt: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    metadata: { type: 'object', required: true, additionalProperties: true },
    source: { type: 'string', required: true },
    content: { type: 'string', required: true },
    timestamp: { type: 'string', required: true },
    confidence: { type: 'number', required: true },
  },
} as const

const thesisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    type: { type: 'string', required: true, enum: ['thesis'] },
    createdAt: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    metadata: { type: 'object', required: true, additionalProperties: true },
    statement: { type: 'string', required: true },
    evidenceIds: { type: 'array', required: true, items: { type: 'string' } },
    confidence: { type: 'number', required: true },
    risks: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const predictionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    type: { type: 'string', required: true, enum: ['prediction'] },
    createdAt: { type: 'string', required: true },
    sessionId: { type: 'string', required: true },
    metadata: { type: 'object', required: true, additionalProperties: true },
    thesisId: { type: 'string', required: true },
    expectation: { type: 'string', required: true },
    evaluationPeriod: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        start: { type: 'string', required: true },
        end: { type: 'string', required: true },
      },
    },
    metrics: { type: 'object', required: true, additionalProperties: true },
  },
} as const

const outputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['success'] },
    symbol: { type: 'string', required: true },
    artifacts: {
      type: 'object',
      required: true,
      additionalProperties: false,
      properties: {
        evidence: { type: 'array', required: true, items: evidenceSchema },
        thesis: { ...thesisSchema, required: true },
        prediction: { ...predictionSchema, required: true },
      },
    },
  },
} as const

export interface EventAnalysisToolOptions {
  workflow: EventAnalysisWorkflow
  clock?: EventAnalysisClock
}

export function createEventAnalysisToolDefinition(
  workflow: EventAnalysisWorkflow,
  clock: EventAnalysisClock = () => new Date().toISOString(),
) {
  return defineTool({
    name: 'run_event_analysis',
    description: 'Run a neutral event analysis workflow and return structured research artifacts.',
    parameters,
    output: {
      schema: outputSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const sessionId = exec.agent?.id
      if (sessionId === undefined) throw new Error('run_event_analysis requires an agent execution context')

      const input: EventAnalysisInput = {
        symbol: args.symbol,
        sessionId,
        createdAt: clock(),
        evaluationPeriod: args.evaluationPeriod,
      }
      const result = await workflow.run(input)
      return {
        status: result.status,
        symbol: result.symbol,
        artifacts: {
          evidence: result.artifacts.evidence.map((item) => ({ ...item })),
          thesis: { ...result.artifacts.thesis },
          prediction: { ...result.artifacts.prediction },
        },
      }
    },
  })
}

/** Register the Event Analysis Workflow at the Harness Agent-facing Tool boundary. */
export function registerEventAnalysisTool(
  ctx: Context,
  workflow: EventAnalysisWorkflow,
  clock?: EventAnalysisClock,
): () => void {
  return ctx.tools.register(createEventAnalysisToolDefinition(workflow, clock))
}

export type EventAnalysisToolExecution = ToolRunContext
