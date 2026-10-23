import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { ReasoningExecutorError } from '../../plugins/reasoning/errors.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'
import { selectCompanyEvidence } from '../../skills/company-research/evidence.ts'
import { calculateCompanyTam, type CompanyTamInput } from '../../skills/company-research/methods.ts'

export interface CompanyMarketSizingResult {
  readonly calculations: readonly (ReturnType<typeof calculateCompanyTam> & { readonly forecastTargetPeriod?: string })[]
  readonly gaps: readonly string[]
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly attempt: number }[]
  readonly attempts: number
}
const refSchema = { type: 'object', additionalProperties: false, required: ['sourceCandidateId', 'location'], properties: { sourceCandidateId: { type: 'string' }, location: { type: 'string' } } }
const schema = {
  type: 'object', additionalProperties: false, required: ['estimates', 'gaps'], properties: {
    gaps: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 1200 } },
    estimates: { type: 'array', maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['marketBoundary', 'asOf', 'formula', 'outputUnit', 'overlapPolicy', 'operands'], properties: {
      marketBoundary: { type: 'string', minLength: 1, maxLength: 1200 }, asOf: { type: 'string' }, forecastTargetPeriod: { type: ['string', 'null'], minLength: 1, maxLength: 100 }, formula: { type: 'string', enum: ['multiply', 'sum'] }, outputUnit: { type: 'string', minLength: 1, maxLength: 100 }, overlapPolicy: { type: 'string', enum: ['single_market', 'non_overlapping_segments'] },
      operands: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['name', 'value', 'unit', 'kind', 'evidence'], properties: { name: { type: 'string', minLength: 1, maxLength: 200 }, value: { type: 'number', minimum: 0 }, unit: { type: 'string', minLength: 1, maxLength: 100 }, kind: { type: 'string', enum: ['fact'] }, evidence: { type: 'array', minItems: 1, maxItems: 8, items: refSchema } } } },
    } } },
  },
}

/** Preserve narrowly-scoped annual vehicle-market volume disclosures without promoting them to company TAM. */
function disclosedAnnualIndustryVolumes(packets: ReturnType<typeof selectCompanyEvidence>, sources: CompanyResearchInput['sources']): ReturnType<typeof calculateCompanyTam>[] {
  const calculations: ReturnType<typeof calculateCompanyTam>[] = []
  const seen = new Set<string>()
  for (const packet of packets) {
    const source = sources.find(item => item.candidate.candidateId === packet.sourceCandidateId)
    if (!source) continue
    const reportYear = /(?:19|20)\d{2}/.exec(source.title)?.[0]
    if (!reportYear) continue
    for (const excerpt of packet.excerpts) {
      const expression = /(?<region>中国|全国|全球)\s*(?<market>新能源汽车|新能源乘用车|乘用车|汽车)(?:市场)?[^。；;|\n]{0,24}?(?<period>全年|年度)(?<measure>销量|销售量|出货量)[^。；;|\n]{0,12}?(?:达到|为|约为|约|录得|达)?\s*(?<value>[\d,，]+(?:\.\d+)?)\s*(?<unit>万辆|万台|辆|台)/g
      for (const match of excerpt.text.matchAll(expression)) {
        const groups = match.groups
        if (!groups) continue
        const value = Number(groups.value!.replace(/[,，]/g, ''))
        if (!Number.isFinite(value) || value < 0) continue
        const unit = groups.unit!
        const marketBoundary = `${reportYear}年${groups.region}${groups.market}全年${groups.measure}（历史行业销量规模，不代表比亚迪可服务市场或公司TAM）`
        const dedupeKey = `${reportYear}|${groups.region}|${groups.market}|${value}|${unit}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        calculations.push(calculateCompanyTam({ marketBoundary, asOf: `${reportYear}-12-31`, formula: 'sum', outputUnit: unit, overlapPolicy: 'non_overlapping_segments', operands: [{ name: `${reportYear}年${groups.region}${groups.market}全年${groups.measure}`, value, unit, kind: 'fact', evidence: [{ sourceCandidateId: packet.sourceCandidateId, location: excerpt.location }] }] }, packets))
        if (calculations.length >= 4) return calculations
      }
    }
  }
  return calculations
}

/** Workflow prepares arithmetic before the market-method narrative, using already acquired full text. */
export async function prepareCompanyMarketSizing(input: CompanyResearchInput & { readonly reasoningExecutor?: ReasoningExecutor; readonly signal?: AbortSignal; readonly maxAttempts?: 1 | 2 }): Promise<CompanyMarketSizingResult> {
  const packets = selectCompanyEvidence(input.sources, input.reportSourceCandidateIds ?? input.durableSourceCandidateIds ?? [], ['市场规模', '市场空间', 'TAM', '需求量', '销量', '销售额', 'market size', 'addressable'], { maxSources: 12, maxCharacters: 22000 })
  const diagnostics: { code: string; message: string; attempt: number }[] = []
  const unavailable = (gap: string, attempts = 0): CompanyMarketSizingResult => ({ calculations: [], gaps: [gap], diagnostics, attempts })
  const disclosedIndustryVolumes = disclosedAnnualIndustryVolumes(packets, input.sources)
  const companyTamGap = '现有材料未提供与比亚迪可服务地域、具体产品范围相匹配的行业金额规模或有来源的数量×单价；披露的行业年度销量仅作为单位口径规模，不能称作比亚迪公司TAM。'
  if (input.signal?.aborted) return unavailable('市场规模准备已取消。')
  if (!input.reasoningExecutor || !packets.length) return { calculations: disclosedIndustryVolumes, gaps: disclosedIndustryVolumes.length ? [companyTamGap] : ['没有可验证市场规模正文或语义执行器；不得估算替代。'], diagnostics, attempts: 0 }
  for (let attempt = 1; attempt <= (input.maxAttempts ?? 1); attempt++) {
    try {
      const response = await input.reasoningExecutor.execute({ operation: 'company_research_method', instruction: '仅从提供正文提取有来源的市场规模或可计算TAM输入，不写研报。每个数值必须原样出现在引用的sourceCandidateId/location正文中，不发明假设、数量或价格、不做单位缩放，value保留正文数字，unit保留原始数量/金额单位。接受具有明确产品、地域和年度边界的行业销量/出货量作为“单位口径行业规模”（例如万辆/年），不能因它不是金额而丢弃。对单一披露市场规模使用一个operand、formula=sum、overlapPolicy=non_overlapping_segments，outputUnit与operand单位相同；在marketBoundary中标注这只是该行业的历史销量或预测规模，不是公司的TAM。只有引用正文明确提供且口径一致的数量和单价才能multiply为金额TAM，并完整说明假设；不得以销量份额乘行业总量，除非来源明确确认两者同一分母、地域、产品定义和期间。不得把公司的销售收入、销量或份额本身误称行业规模或公司TAM。多项相加必须明确市场互不重叠且单位完全相同。界定产品/地域/客户/年份边界，asOf是估计或预测目标期，不是来源发布日期。若引用正文明确给出未来期间预测，标出forecastTargetPeriod（如“2026全年”）；只有来源publishedAt可验证且不晚于researchAsOf时，才能保留为当时已知的行业预测背景；未知发布日期不得视为当时已知。不要把相邻行业预测等同公司TAM，也不相加重叠市场。无合格输入则estimates=[]且gaps具体指出还缺哪项市场定义/来源。不得为填充输出臆造专家假设、数字或目标价，不调用其他方法。', input: { company: input.company, researchAsOf: input.asOf, evidence: packets, repairErrors: diagnostics.slice(-1) }, outputContract: schema, metadata: { operationFamily: 'company-research-quality', skillId: 'market_structure_analysis', stage: 'tam_operand_extraction', companySymbol: input.company.symbol } }, input.signal)
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
        const row = object(item); if (Object.keys(row).some((key) => !['marketBoundary', 'asOf', 'forecastTargetPeriod', 'formula', 'outputUnit', 'overlapPolicy', 'operands'].includes(key)) || ['marketBoundary', 'asOf', 'formula', 'outputUnit', 'overlapPolicy', 'operands'].some((key) => !(key in row))) throw new Error('FORMAT: fields do not match schema')
        if (row.formula !== 'multiply' && row.formula !== 'sum') throw new Error('FORMAT: invalid formula')
        if (row.overlapPolicy !== 'single_market' && row.overlapPolicy !== 'non_overlapping_segments') throw new Error('FORMAT: invalid overlap policy')
        const operands = array(row.operands, 10).map((item) => { const operand = object(item); exact(operand, ['name', 'value', 'unit', 'kind', 'evidence']); if (operand.kind !== 'fact' || typeof operand.value !== 'number') throw new Error('FORMAT: only disclosed numeric operands'); const evidence = array(operand.evidence, 8).map((item) => { const ref = object(item); exact(ref, ['sourceCandidateId', 'location']); return { sourceCandidateId: text(ref.sourceCandidateId, 300), location: text(ref.location, 100) } }); return { name: text(operand.name, 200), value: operand.value, unit: text(operand.unit, 100), kind: 'fact' as const, evidence } })
        const calculationInput: CompanyTamInput = { marketBoundary: text(row.marketBoundary, 1200), asOf: text(row.asOf, 100), formula: row.formula, outputUnit: text(row.outputUnit, 100), overlapPolicy: row.overlapPolicy, operands }
      const forecastTargetPeriod = row.forecastTargetPeriod == null ? undefined : text(row.forecastTargetPeriod, 100)
        if (calculationInput.asOf.slice(0, 10) > input.asOf.slice(0, 10) && !forecastTargetPeriod) throw new Error('TAM: Future target period requires an explicit forecast label')
        if (forecastTargetPeriod) {
          const targetYear = /^(\d{4})/.exec(forecastTargetPeriod)?.[1]
          if (!targetYear || targetYear !== calculationInput.asOf.slice(0, 4)) throw new Error('TAM: Forecast target period does not match the estimate period')
          const citedRows = operands.flatMap(operand => operand.evidence.map(ref => ({ sourceCandidateId: ref.sourceCandidateId, excerpt: packets.find(packet => packet.sourceCandidateId === ref.sourceCandidateId)?.excerpts.find(excerpt => excerpt.location === ref.location) })))
          const targetPattern = new RegExp(`(?:${targetYear}年|${targetYear}年度|${targetYear})`)
          if (!citedRows.some(row => row.excerpt && targetPattern.test(row.excerpt.text) && /预测|預測|预计|預計|展望|预期|project(?:ed|ion)?|forecast/i.test(row.excerpt.text))) throw new Error('TAM: Forecast label requires the target period and forecast wording in cited source text')
          for (const sourceId of new Set(citedRows.map(row => row.sourceCandidateId))) {
            const publishedAt = packets.find(packet => packet.sourceCandidateId === sourceId)?.publishedAt
            if (!publishedAt || !Number.isFinite(Date.parse(publishedAt)) || Date.parse(publishedAt) > Date.parse(input.asOf)) throw new Error(`TAM: Forecast source publication date is unknown or after research cutoff: ${sourceId}`)
          }
        }
        const calculated = calculateCompanyTam(calculationInput, packets)
        return forecastTargetPeriod ? { ...calculated, forecastTargetPeriod } : calculated
      })
      if (!calculations.length && !gaps.length) throw new Error('FORMAT: Empty estimates require explicit gaps')
      const mergedCalculations = [...disclosedIndustryVolumes, ...calculations.filter(item => !disclosedIndustryVolumes.some(disclosed => disclosed.marketBoundary === item.marketBoundary && disclosed.value === item.value && disclosed.unit === item.unit))]
      const mergedGaps = [...gaps]
      if (disclosedIndustryVolumes.length && !mergedGaps.some(gap => /公司TAM|可服务市场|公司级TAM/.test(gap))) mergedGaps.push(companyTamGap)
      return { calculations: mergedCalculations, gaps: mergedGaps, diagnostics, attempts: attempt }
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return unavailable('市场规模准备已取消。', attempt)
      const message = error instanceof Error ? error.message : String(error)
      const failureClass = error instanceof ReasoningExecutorError ? error.failureClass : undefined
      const accountFailure = failureClass === 'rate_limit_or_quota' || /usage limit|quota|rate limit/i.test(message) ? 'RATE_LIMIT_OR_QUOTA' : failureClass === 'authentication_or_account' || /unauthorized|authentication|invalid api key/i.test(message) ? 'AUTHENTICATION_OR_ACCOUNT' : undefined
      if (accountFailure) { diagnostics.push({code:accountFailure,message:message.slice(0,1000),attempt}); return unavailable('语义执行受账户或额度限制，市场规模准备未完成。',attempt) }
      diagnostics.push({ code: /TAM:/.test(message) ? 'TAM_INPUT_REJECTED' : /FORMAT:|JSON/.test(message) ? 'FORMAT_ERROR' : 'CALL_FAILED', message: message.slice(0, 1000), attempt })
    }
  }
  return { calculations: disclosedIndustryVolumes, gaps: disclosedIndustryVolumes.length ? [...diagnostics.map(item => `${item.code}: ${item.message}`), companyTamGap] : ['市场规模输入未通过来源、数值、单位或市场重叠验证；不能生成 TAM。'], diagnostics, attempts: diagnostics.length }
}
