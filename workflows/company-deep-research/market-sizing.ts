import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { ReasoningExecutorError } from '../../plugins/reasoning/errors.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'
import { selectCompanyEvidence } from '../../skills/company-research/evidence.ts'
import { calculateCompanyTam, type CompanyTamInput } from '../../skills/company-research/methods.ts'

export interface CompanyMarketSizingResult {
  readonly calculations: readonly ReturnType<typeof calculateCompanyTam>[]
  readonly gaps: readonly string[]
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly attempt: number }[]
  readonly attempts: number
}
const refSchema = { type: 'object', additionalProperties: false, required: ['sourceCandidateId', 'location'], properties: { sourceCandidateId: { type: 'string' }, location: { type: 'string' } } }
const schema = {
  type: 'object', additionalProperties: false, required: ['estimates', 'gaps'], properties: {
    gaps: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 1200 } },
    estimates: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['marketBoundary', 'asOf', 'formula', 'outputUnit', 'overlapPolicy', 'operands'], properties: {
      marketBoundary: { type: 'string', minLength: 1, maxLength: 1200 }, asOf: { type: 'string' }, formula: { type: 'string', enum: ['multiply', 'sum'] }, outputUnit: { type: 'string', minLength: 1, maxLength: 100 }, overlapPolicy: { type: 'string', enum: ['single_market', 'non_overlapping_segments'] },
      operands: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['name', 'value', 'unit', 'kind', 'evidence'], properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, value: { type: 'number', minimum: 0 }, unit: { type: 'string', minLength: 1, maxLength: 100 }, kind: { type: 'string', enum: ['fact'] }, evidence: { type: 'array', minItems: 1, maxItems: 8, items: refSchema } } } },
    } } },
  },
}

/** Workflow prepares arithmetic before the market-method narrative, using already acquired full text. */
export async function prepareCompanyMarketSizing(input: CompanyResearchInput & { readonly reasoningExecutor?: ReasoningExecutor; readonly signal?: AbortSignal; readonly maxAttempts?: 1 | 2 }): Promise<CompanyMarketSizingResult> {
  const packets = selectCompanyEvidence(input.sources, input.reportSourceCandidateIds ?? input.durableSourceCandidateIds ?? [], ['市场规模', '市场空间', 'TAM', '需求量', '销量', '销售额', 'market size', 'addressable'], { maxSources: 12, maxCharacters: 22000 })
  const diagnostics: { code: string; message: string; attempt: number }[] = []
  const unavailable = (gap: string, attempts = 0): CompanyMarketSizingResult => ({ calculations: [], gaps: [gap], diagnostics, attempts })
  if (input.signal?.aborted) return unavailable('市场规模准备已取消。')
  if (!input.reasoningExecutor || !packets.length) return unavailable('没有可验证市场规模正文或语义执行器；不得估算替代。')
  for (let attempt = 1; attempt <= (input.maxAttempts ?? 1); attempt++) {
    try {
      const response = await input.reasoningExecutor.execute({ operation: 'company_research_method', instruction: '仅从提供正文提取有来源的市场规模或可计算 TAM 输入，不写研报。每个数值必须原样出现在引用的 sourceCandidateId/location 正文中，不发明假设、数量或价格，不做单位缩放，value 保留正文数字，unit 保留单位(亿/万等)。对于已披露规模使用一个 operand 的 sum，声明 non_overlapping_segments；销量只能作为销量口径，不能冒充 TAM。多项相加必须明确互不重叠、单位完全相同；只有明确数量×单价才 multiply，并准确给出乘积单位。界定产品/地域/客户/年份边界，asOf 是估计的适用时期，不能把历史规模视为当前规模。无合格输入则 estimates=[] 且 gaps 说明缺失口径或证据。不输出目标价，不调用其他方法。', input: { company: input.company, researchAsOf: input.asOf, evidence: packets, repairErrors: diagnostics.slice(-1) }, outputContract: schema, metadata: { operationFamily: 'company-research-quality', skillId: 'market_structure_analysis', stage: 'tam_operand_extraction', companySymbol: input.company.symbol } }, input.signal)
      if (input.signal?.aborted) return unavailable('市场规模准备已取消。', attempt)
      let raw = response.output
      if (typeof raw === 'string') raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
      const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FORMAT: object required'); return value as Record<string, unknown> }
      const exact = (value: Record<string, unknown>, keys: readonly string[]) => { if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) throw new Error('FORMAT: fields do not match schema') }
      const text = (value: unknown, max: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('FORMAT: invalid bounded string'); return value.trim() }
      const array = (value: unknown, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) throw new Error('FORMAT: bounded array required'); return value }
      const value = object(raw); exact(value, ['estimates', 'gaps'])
      const gaps = array(value.gaps, 10).map((gap) => text(gap, 1200))
      const calculations = array(value.estimates, 4).map((item) => {
        const row = object(item); exact(row, ['marketBoundary', 'asOf', 'formula', 'outputUnit', 'overlapPolicy', 'operands'])
        if (row.formula !== 'multiply' && row.formula !== 'sum') throw new Error('FORMAT: invalid formula')
        if (row.overlapPolicy !== 'single_market' && row.overlapPolicy !== 'non_overlapping_segments') throw new Error('FORMAT: invalid overlap policy')
        const operands = array(row.operands, 10).map((item) => { const operand = object(item); exact(operand, ['name', 'value', 'unit', 'kind', 'evidence']); if (operand.kind !== 'fact' || typeof operand.value !== 'number') throw new Error('FORMAT: only disclosed numeric operands'); const evidence = array(operand.evidence, 8).map((item) => { const ref = object(item); exact(ref, ['sourceCandidateId', 'location']); return { sourceCandidateId: text(ref.sourceCandidateId, 300), location: text(ref.location, 100) } }); return { name: text(operand.name, 200), value: operand.value, unit: text(operand.unit, 100), kind: 'fact' as const, evidence } })
        const calculationInput: CompanyTamInput = { marketBoundary: text(row.marketBoundary, 1200), asOf: text(row.asOf, 100), formula: row.formula, outputUnit: text(row.outputUnit, 100), overlapPolicy: row.overlapPolicy, operands }
        if (calculationInput.asOf.slice(0, 10) > input.asOf.slice(0, 10)) throw new Error('TAM: Market estimate date exceeds research cutoff')
        return calculateCompanyTam(calculationInput, packets)
      })
      if (!calculations.length && !gaps.length) throw new Error('FORMAT: Empty estimates require explicit gaps')
      return { calculations, gaps, diagnostics, attempts: attempt }
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return unavailable('市场规模准备已取消。', attempt)
      const message = error instanceof Error ? error.message : String(error)
      const failureClass = error instanceof ReasoningExecutorError ? error.failureClass : undefined
      const accountFailure = failureClass === 'rate_limit_or_quota' || /usage limit|quota|rate limit/i.test(message) ? 'RATE_LIMIT_OR_QUOTA' : failureClass === 'authentication_or_account' || /unauthorized|authentication|invalid api key/i.test(message) ? 'AUTHENTICATION_OR_ACCOUNT' : undefined
      if (accountFailure) { diagnostics.push({code:accountFailure,message:message.slice(0,1000),attempt}); return unavailable('语义执行受账户或额度限制，市场规模准备未完成。',attempt) }
      diagnostics.push({ code: /TAM:/.test(message) ? 'TAM_INPUT_REJECTED' : /FORMAT:|JSON/.test(message) ? 'FORMAT_ERROR' : 'CALL_FAILED', message: message.slice(0, 1000), attempt })
    }
  }
  return unavailable('市场规模输入未通过来源、数值、单位或市场重叠验证；不能生成 TAM。', diagnostics.length)
}
