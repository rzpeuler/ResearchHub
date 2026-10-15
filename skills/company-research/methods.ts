import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { ReasoningExecutorError } from '../../plugins/reasoning/errors.ts'
import type { CompanyResearchInput } from './contracts.ts'
import { selectCompanyEvidence, companyCitedSplitDateText, withCompanyEvidenceDateContext, type CompanyEvidencePacket } from './evidence.ts'
import { validateCompanyNumericGrounding } from './numeric-grounding.ts'
import { repairCompanyMethodCitations, type CompanyCitationRepair } from './citation-repair.ts'

export const COMPANY_RESEARCH_METHOD_IDS = ['company_history_strategy', 'business_model_map', 'product_technology_analysis', 'business_driver_analysis', 'financial_quality_analysis', 'market_structure_analysis', 'competitive_market_map', 'management_governance_analysis', 'capital_allocation_review', 'company_risk_analysis'] as const
export type CompanyResearchMethodId = typeof COMPANY_RESEARCH_METHOD_IDS[number]
export const COMPANY_METHOD_SECTION_IDS: Readonly<Record<CompanyResearchMethodId, readonly string[]>> = {
  company_history_strategy: ['company-overview'], business_model_map: ['business-model', 'business-segments', 'supply-chain'], product_technology_analysis: ['products', 'technologies'], business_driver_analysis: ['revenue-profit-drivers', 'growth-drivers', 'catalysts'], financial_quality_analysis: ['financial-quality'], market_structure_analysis: ['industry-exposure'], competitive_market_map: ['competition'], management_governance_analysis: ['management-capital-allocation'], capital_allocation_review: ['management-capital-allocation'], company_risk_analysis: ['risks'],
}
export interface CompanyMethodEvidenceRef { readonly sourceCandidateId: string; readonly location: string }
export interface CompanyMethodFinding { readonly text: string; readonly kind: 'fact' | 'inference' | 'assumption'; readonly evidence: readonly CompanyMethodEvidenceRef[] }
export interface CompanyResearchMethodResult {
  readonly skillId: CompanyResearchMethodId
  readonly status: 'complete' | 'insufficient_evidence' | 'failed' | 'cancelled'
  readonly answer: string
  readonly markdown: string
  readonly sections: readonly { readonly id: string; readonly markdown: string }[]
  readonly findings: readonly CompanyMethodFinding[]
  readonly limitations: readonly string[]
  readonly risks: readonly string[]
  readonly sourceCandidateIds: readonly string[]
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly attempt: number }[]
  readonly attempts: number
  readonly executionEvidence?: readonly CompanyEvidencePacket[]
  /** Workflow-generated calculations may add evidence without rewriting the semantic operation's input. */
  readonly deterministicEvidence?: readonly CompanyEvidencePacket[]
  readonly attemptOutputs?: readonly { readonly attempt: number; readonly output: unknown; readonly executionEvidence?: readonly CompanyEvidencePacket[]; readonly preparedAnalysis?: unknown }[]
  readonly citationRepairs?: readonly (CompanyCitationRepair & { readonly attempt: number })[]
}
export interface ExecuteCompanyResearchMethodInput extends CompanyResearchInput {
  readonly skillId: CompanyResearchMethodId
  readonly reasoningExecutor?: ReasoningExecutor
  readonly signal?: AbortSignal
  /** Deterministic arithmetic/validation results prepared by Workflow; model may explain, never overwrite. */
  readonly preparedAnalysis?: unknown
  /** Workflow supplies its retry budget; the semantic adapter never exceeds two calls. */
  readonly maxAttempts?: 1 | 2
  /** Loaded by Workflow from the canonical method SKILL.md; never file I/O within the Skill. */
  readonly methodology?: string
}

export interface CompanyTamInput {
  readonly marketBoundary: string
  readonly asOf: string
  readonly formula: 'multiply' | 'sum'
  readonly outputUnit: string
  readonly overlapPolicy: 'single_market' | 'non_overlapping_segments'
  readonly operands: readonly { readonly name: string; readonly value: number; readonly unit: string; readonly kind: 'fact' | 'assumption'; readonly evidence: readonly CompanyMethodEvidenceRef[] }[]
}
/** Arithmetic belongs to code; extraction/market definitions and explicit assumptions are supplied by Workflow. */
export function calculateCompanyTam(input: CompanyTamInput, packets: readonly CompanyEvidencePacket[]): { readonly status: 'calculated'; readonly value: number; readonly unit: string; readonly formula: string; readonly marketBoundary: string; readonly asOf: string; readonly assumptions: readonly string[]; readonly evidence: readonly CompanyMethodEvidenceRef[] } {
  if (!['multiply', 'sum'].includes(input.formula) || !['single_market', 'non_overlapping_segments'].includes(input.overlapPolicy)) throw new Error('TAM: Invalid formula or overlap policy')
  if (!input.marketBoundary.trim() || !input.outputUnit.trim() || !/^\d{4}-\d{2}-\d{2}/.test(input.asOf) || !input.operands.length || input.operands.length > 10) throw new Error('TAM: Explicit market boundary, date, output unit and bounded operands required')
  if (input.formula === 'sum' && input.overlapPolicy !== 'non_overlapping_segments') throw new Error('TAM: Addition requires explicitly non-overlapping segments')
  if (input.formula === 'sum' && input.operands.some((operand) => operand.unit !== input.outputUnit)) throw new Error('TAM: Additive operands require identical units')
  const excerpts = new Map(packets.flatMap((packet) => packet.excerpts.map((excerpt) => [`${excerpt.sourceCandidateId}@${excerpt.location}`, excerpt.text] as const)))
  for (const operand of input.operands) {
    if (!['fact', 'assumption'].includes(operand.kind) || !operand.name.trim() || !operand.unit.trim() || !Number.isFinite(operand.value) || operand.value < 0 || !operand.evidence.length) throw new Error('TAM: Invalid operand or missing attributable evidence')
    const texts = operand.evidence.map((ref) => { const text = excerpts.get(`${ref.sourceCandidateId}@${ref.location}`); if (!text) throw new Error('TAM: Unresolved evidence location'); return text.replace(/[,，]/g, '') })
    if (operand.kind === 'fact' && !texts.some((text) => [...text.matchAll(/(?<![\d.])-?\d+(?:\.\d+)?(?![\d.])/g)].some((match) => Number(match[0]) === operand.value))) throw new Error(`TAM: Disclosed operand number not found in excerpt: ${operand.name}`)
  }
  const value = input.formula === 'sum' ? input.operands.reduce((total, operand) => total + operand.value, 0) : input.operands.reduce((total, operand) => total * operand.value, 1)
  if (!Number.isFinite(value)) throw new Error('TAM: Non-finite result')
  return { status: 'calculated', value, unit: input.outputUnit, formula: input.operands.map((operand) => `${operand.name}(${operand.value} ${operand.unit})`).join(input.formula === 'sum' ? ' + ' : ' × '), marketBoundary: input.marketBoundary, asOf: input.asOf, assumptions: input.operands.filter((operand) => operand.kind === 'assumption').map((operand) => `${operand.name}: ${operand.value} ${operand.unit}`), evidence: input.operands.flatMap((operand) => operand.evidence) }
}

export const COMPANY_METHOD_OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'answer', 'markdown', 'sections', 'findings', 'limitations', 'risks'],
  properties: {
    status: { type: 'string', enum: ['complete', 'insufficient_evidence'] },
    answer: { type: 'string', minLength: 1, maxLength: 3000 },
    markdown: { type: 'string', minLength: 1, maxLength: 16000 },
    sections: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['id', 'markdown'], properties: { id: { type: 'string' }, markdown: { type: 'string', minLength: 1, maxLength: 16000 } } } },
    findings: { type: 'array', maxItems: 24, items: { type: 'object', additionalProperties: false, required: ['text', 'kind', 'evidence'], properties: { text: { type: 'string', minLength: 1, maxLength: 1800 }, kind: { type: 'string', enum: ['fact', 'inference', 'assumption'] }, evidence: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['sourceCandidateId', 'location'], properties: { sourceCandidateId: { type: 'string' }, location: { type: 'string' } } } } } } },
    limitations: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1200 } },
    risks: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 1200 } },
  },
} as const

/** Bind semantic output to this operation's exact source/locator pairs and owned report IDs. */
export function companyMethodOutputSchema(skillId: CompanyResearchMethodId, packets: readonly CompanyEvidencePacket[]) {
  const ids = COMPANY_METHOD_SECTION_IDS[skillId]
  const findings = COMPANY_METHOD_OUTPUT_SCHEMA.properties.findings
  const evidence = findings.items.properties.evidence
  return { ...COMPANY_METHOD_OUTPUT_SCHEMA, properties: { ...COMPANY_METHOD_OUTPUT_SCHEMA.properties,
    sections: { ...COMPANY_METHOD_OUTPUT_SCHEMA.properties.sections, minItems: ids.length, maxItems: ids.length, items: { ...COMPANY_METHOD_OUTPUT_SCHEMA.properties.sections.items, properties: { ...COMPANY_METHOD_OUTPUT_SCHEMA.properties.sections.items.properties, id: { type: 'string', enum: ids } } } },
    findings: { ...findings, items: { ...findings.items, properties: { ...findings.items.properties, evidence: { ...evidence, items: { ...evidence.items, anyOf: packets.map((packet) => ({ properties: { sourceCandidateId: { const: packet.sourceCandidateId }, location: { enum: packet.excerpts.map((excerpt) => excerpt.location) } } })) } } } } },
  } }
}

export const COMPANY_METHOD_METHODOLOGY: Readonly<Record<CompanyResearchMethodId, { readonly questions: string; readonly terms: readonly string[] }>> = {
  company_history_strategy: { questions: '解释公司成立、主要发展阶段、关键产品/并购/市场转折及战略如何改变收入和风险。已给材料出现不同成立、共同注册、股份改制年份时，须并列解释对应主体、事件与口径，保留真实原文，不能静默忽略或将不同事件统一为单一成立年份。历史事件绑定其紧邻且适用的年份，不得借用上一事件或其他产品的年份。逐项给出时间和证据；总结路径依赖、战略兑现及后续监控信号。', terms: ['历史', '成立', '发展', '战略', '收购', '上市', '转型', 'history', 'strategy'] },
  business_model_map: { questions: '回答谁付费、买什么、如何定价交付和确认收入。分别展开主要分部、客户类型、渠道、供应链、成本与利润来源；解释规模优势及约束。不得把典型行业惯例当作公司事实。', terms: ['主营', '业务', '收入', '客户', '分部', '销售', '供应商', '成本', 'business', 'segment'] },
  product_technology_analysis: { questions: '用产品矩阵比较客户需求、应用场景、技术路线、差异、竞争替代及商业化阶段。区分公司宣称和独立验证；说明研发投入如何形成竞争力、专利数量不能单独证明护城河。', terms: ['产品', '技术', '研发', '专利', '工艺', '量产', '电池', 'PCB', 'product', 'technology'] },
  business_driver_analysis: { questions: '解释收入和利润变化的量、价、组合、分部、产能与成本链路。总成本率或毛利率变化不能直接推断单位成本变化；没有同口径数量及成本数据时，明确单位成本不可分解。已披露的贡献与定性推断分开；使用 preparedAnalysis 计算结果，缺少数量/价格时不能伪造分解。提出增长条件、催化剂及可监控指标。', terms: ['收入', '利润', '销量', '产量', '价格', '增长', '产能', '毛利', 'revenue', 'growth'] },
  financial_quality_analysis: { questions: '比较可比期间收入、利润、利润率、经营现金流、营运资本、债务、资本开支和分部。解释现金转化、一次性项目、资本化和应收/存货风险。只引用输入中口径与期间明确的数字；preparedAnalysis 为计算权威。', terms: ['现金', '负债', '资产', '利润', '应收', '存货', '资本', '财务', 'cash', 'financial'] },
  market_structure_analysis: { questions: '分别界定主要市场的产品、地区、客户和时间边界、产业链角色、需求变化和监管。TAM 仅引用有口径的披露或 preparedAnalysis 中带来源的公式计算结果；避免多个重叠市场相加。缺规模仍须解释行业结构及市场驱动。', terms: ['行业', '市场', '需求', '规模', '政策', '产业', '销量', 'market', 'industry'] },
  competitive_market_map: { questions: '比较至少两个有证据的实际竞争者或替代路线，列产品、客户、成本/技术、渠道、定位与差异。不同市场分别比较；不得把无口径销量当市场份额。解释优势持续条件及最强反证。', terms: ['竞争', '市场', '份额', '优势', '客户', '成本', '同行', '对手', '厂商', '格局', 'PCB', 'FPC', '光模块', '汽车', '电池', '毛利', '销量', '营收', '产能', '产品', 'competitor', 'competition'] },
  management_governance_analysis: { questions: '介绍关键管理人员职责、背景和任职变动、股权控制、治理安排及激励；评估战略一致性、利益冲突和承诺兑现，缺履历则明确缺口。不能仅以头衔或宣传推断管理能力。', terms: ['董事', '管理', '治理', '股东', '实际控制', '薪酬', '激励', 'management', 'governance'] },
  capital_allocation_review: { questions: '分析研发、资本开支、并购、融资、分红和回购的目的、规模、资金来源与后续结果。区分投资宣布和实现回报；只有可归因收益与资本基数才谈价值创造。解释现金需求与资本配置风险。', terms: ['研发', '投资', '收购', '融资', '分红', '回购', '资本', 'capital', 'acquisition'] },
  company_risk_analysis: { questions: '形成公司特定的风险矩阵，覆盖经营、客户、技术、竞争、财务、治理和政策。每项说明触发条件→影响路径→可监控指标→缓解因素及残余风险；优先公司证据，避免泛泛宏观清单。综合支持研究结论及其失效条件。', terms: ['风险', '客户', '竞争', '政策', '负债', '汇率', '诉讼', 'risk'] },
}

/** Pure semantic adapter: no acquisition, persistence, or invocation of peer Skills. */
export async function executeCompanyResearchMethod(input: ExecuteCompanyResearchMethodInput): Promise<CompanyResearchMethodResult> {
  const methodology = COMPANY_METHOD_METHODOLOGY[input.skillId]
  const packets = selectCompanyEvidence(input.sources, input.reportSourceCandidateIds ?? input.durableSourceCandidateIds ?? [], methodology.terms, { purpose: input.skillId })
  const diagnostics: { code: string; message: string; attempt: number }[] = []
  const attemptOutputs: { attempt: number; output: unknown; executionEvidence: readonly CompanyEvidencePacket[]; preparedAnalysis?: unknown }[] = []
  const citationRepairs: (CompanyCitationRepair & { attempt: number })[] = []
  let numericRepairIssues: { id: string; token: string; context: string }[] = []
  let repairTargets: { id: string; fieldPath: string; originalText?: string; issues: readonly { token: string; context: string }[] }[] = []
  // Raw period rows already travel as structuredFinancialData. Avoid sending that
  // same table twice, while keeping all observations and derived calculations.
  let semanticPreparedAnalysis = input.preparedAnalysis
  if (input.financialData?.length && input.preparedAnalysis && typeof input.preparedAnalysis === 'object' && !Array.isArray(input.preparedAnalysis)) {
    const prepared = input.preparedAnalysis as Record<string, unknown>
    if (prepared.financial && typeof prepared.financial === 'object' && !Array.isArray(prepared.financial)) {
      const financial = { ...prepared.financial as Record<string, unknown> }
      delete financial.table
      // The readable table contains these exact display values and source locator.
      if (typeof financial.financialReadableTable === 'string') delete financial.financialDisplayAmounts
      semanticPreparedAnalysis = { ...prepared, financial }
    }
  }
  const empty = (status: CompanyResearchMethodResult['status'], attempts: number): CompanyResearchMethodResult => ({ skillId: input.skillId, status, answer: '', markdown: '', sections: [], findings: [], limitations: [status === 'cancelled' ? '研究已取消。' : '该方法未获得经过验证的分析结果，不能宣称完成。'], risks: [], sourceCandidateIds: [], diagnostics, attempts, executionEvidence: packets, attemptOutputs, citationRepairs })
  if (input.signal?.aborted) return empty('cancelled', 0)
  if (!input.reasoningExecutor || !packets.length) { diagnostics.push({ code: !input.reasoningExecutor ? 'EXECUTOR_UNAVAILABLE' : 'INSUFFICIENT_EVIDENCE', message: !input.reasoningExecutor ? 'No reasoning executor configured' : 'No citation-eligible full-text evidence', attempt: 0 }); return empty('insufficient_evidence', 0) }
  const exampleRef = packets[0]!.excerpts[0]!
  const outputExample = { status: 'complete', answer: '<中文方法结论>', markdown: `<实质分析> [${exampleRef.sourceCandidateId}@${exampleRef.location}]`, sections: COMPANY_METHOD_SECTION_IDS[input.skillId].map((id) => ({ id, markdown: `<此节独立分析> [${exampleRef.sourceCandidateId}@${exampleRef.location}]` })), findings: [{ text: '<已由证据支持的具体论点>', kind: 'fact', evidence: [{ sourceCandidateId: exampleRef.sourceCandidateId, location: exampleRef.location }] }], limitations: ['<仅实际缺失的补充信息与影响；没有则空数组>'], risks: ['<仅证据支持的风险；没有则空数组>'] }
  for (let attempt = 1; attempt <= (input.maxAttempts ?? 2); attempt++) {
    if (input.signal?.aborted) return empty('cancelled', attempt - 1)
    try {
      const response = await input.reasoningExecutor.execute({ operation: 'company_research_method', instruction: `执行单个原子研究方法 ${input.skillId}，不调用其他方法。${methodology.questions} 使用中文。最终报告只发布 sections，因此每个 owned section 必须包含完整可发布正文，分别展开问题、证据、解释、比较、反证及限制；产品、竞品和财务等适合比较的内容须包含可读表格。多个 sections 合计以约 800–1200 中文字的实质深度为参考，质量优先。markdown 仅为不超过约200中文字的定性总结，answer 也是定性方法结论；年份、金额、数量和比率保留在 sections/findings 并逐条引用，不要在这两个摘要新增无引用数字。不能把重要矩阵、论证或数字分析只写在 markdown 后让 sections 变成摘要。历史网页的 observedPublicationDate/historicalSourceContext 仅表示页面时间背景，不能将旧文排名当作当前事实；文章发表年份与其中统计年份须区分并各自引用实际依据。仅使用提供的正文和结构化数据，区分事实、推断、假设，不编造数字、市场份额、公司人员或预测。findings 精选6–12条覆盖主要研究问题的关键论点，总数最多24条；不要逐句拆成冗余findings。每条只写一个可核对事实、同一科目的可比期间或一个代码计算结果；不要将跨科目数据、不同成立口径、多个时间线事件合并一条。正文可组合多个事实，但分别绑定各自 finding 的精确引用。客户或供应商前五名合计占比与单一主体占比须分别说明；仅缺单一客户明细时，不得宣称没有已披露的前五名合计集中度。金额优先采用 preparedAnalysis.financial.financialReadableTable 或顶层 financialReadableTable 的代码元→亿元转换，不自行心算大数；未有代码单位转换的在建工程等指标可保留原文元单位，不得凭心算缩放金额；研发费用、研发投入及资本化支出必须按原文口径区分。同比改善/恶化必须比较同一累计期间，不能用上半年对全年毛利率直接判断趋势；优先采用代码的同期对照及百分点变化。已提供分部毛利、客户集中度、研发资本化或持股数据时必须使用，不得把遗漏阅读写成资料未提供。每项 finding 必须原样复制提供的 sourceCandidateId 和精确 location，禁止拼接或猜测段落编号。paragraph 编号是正文原始行号，不是 PDF 页码。每个金额、百分比、数量和年份必须出现在该论点引用的实际正文行中或 preparedAnalysis 确定性结果中；上下相邻行不是同一证据位置，跨行数字必须增加对应行的引用。历史事件的年份在独立行时同时引用年份行和事件行，不能只引用事件行。excerpt.contextLocations 为代码验证并提供的时间/表格单位上下文行，可一并引用；每个表格数据行必须引用自己的原文数字行，不能仅引用另一行或产品表头。不要添加没有输入依据的研发人数、市场份额、成立年月日或预测增长。sections 必须包含 ownedSectionIds 全部且仅这些 ID，每节写独立内容，不重复整段 markdown。每节和 markdown 的关键论点使用 [sourceCandidateId@location] 标记。正文不能增加 findings 未包含的事实。complete 表示主要研究问题已用可追溯论点和各节实质内容回答；补充财务比率、全部履历、目标价或增量收益归因等缺失写 limitations，不应使已有核心研究整体 insufficient_evidence。只有主要问题没有证据支持时才 insufficient_evidence；不以字数判断完成。成立、开始经营、法定注册等不同日期口径分别解释，保留来源冲突，不静默统一日期。严格照 outputExample 的字段和数组形状输出，不复制占位内容。缺失输入、获取需求及结论影响写入 limitations。不得输出 canonical ID、写入动作或评级目标价。`, input: { company: input.company, asOf: input.asOf, outputExample, canonicalMethodology: input.methodology ?? null, ownedSectionIds: COMPANY_METHOD_SECTION_IDS[input.skillId], evidence: packets, structuredProfileData: input.profileData ?? null, structuredFinancialData: input.financialData ? [...input.financialData].sort((a,b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? "")).slice(0,12) : null, preparedAnalysis: semanticPreparedAnalysis ?? null, ...(diagnostics.length ? { repairErrors: diagnostics.slice(-1), repairNumericIssues: numericRepairIssues, repairTargets, ...(attemptOutputs.at(-1)?.output !== undefined ? { repairPreviousOutput: attemptOutputs.at(-1)!.output } : {}), repairInstruction: '若提供repairPreviousOutput，它是上次真实输出。以该输出为底稿重新输出完整JSON，逐字保留未报错的sections、findings及其他字段，只修复已报错字段的格式、精确引用或单位；不得新增其他数字或主张，不要整篇重生成。repairTargets给出精确fieldPath及原报错字段，原稿全文见repairPreviousOutput；优先修正报错数字所在表行/句子的实际引用，不能靠删掉整张表或专业分析回避错误。依据repairNumericIssues一次修复所有列出的字段。未报错的finding不要扩写或重组；并列金额每个数值各写明完整单位（如甲125.30亿元、乙65.81亿元），不要仅在列表末尾写共享单位。若没有上次真实输出则依据错误与当前证据重新输出，不虚构旧稿。' } : {}) }, outputContract: companyMethodOutputSchema(input.skillId, packets), metadata: { operationFamily: 'personal-research-v1', skillId: input.skillId, companySymbol: input.company.symbol } }, input.signal)
      if (input.signal?.aborted) return empty('cancelled', attempt)
      attemptOutputs.push({attempt,output:response.output,executionEvidence:packets,preparedAnalysis:semanticPreparedAnalysis})
      const bounded = bindCompanyMethodEvidenceContext(validateCompanyMethodOutput(response.output, packets, COMPANY_METHOD_SECTION_IDS[input.skillId]), packets)
      const repaired = repairCompanyMethodCitations(bounded, packets, input)
      citationRepairs.push(...repaired.repairs.map((repair) => ({ ...repair, attempt })))
      const parsed = repaired.output
      if (input.skillId === 'company_risk_analysis' && parsed.status === 'complete' && !parsed.risks.length) throw new Error('FORMAT: Complete company risk method requires risk transmission findings')
      const attributableFindings = parsed.findings.map((finding, index) => ({ id: `finding-${index + 1}`, markdown: `${finding.text} ${finding.evidence.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}` }))
      numericRepairIssues = []
      for (const item of [...parsed.sections, { id: 'method-summary', markdown: parsed.markdown }, { id: 'method-answer', markdown: parsed.answer }, ...attributableFindings]) {
        const numeric = validateCompanyNumericGrounding({ markdown: item.markdown, sources: input.sources, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf, ...companyCitedSplitDateText(item.markdown, packets)] })
        for (const issue of numeric.diagnostics) if (numericRepairIssues.length < 12) numericRepairIssues.push({ id: item.id, token: issue.token.slice(0, 24), context: issue.context.replace(/\s+/g, ' ').slice(0, 32) })
      }
      let targetTextBudget = 8000
      repairTargets = [...new Set(numericRepairIssues.map((issue) => issue.id))].map((id) => {
        const sectionIndex = parsed.sections.findIndex((section) => section.id === id)
        const findingIndex = /^finding-(\d+)$/.exec(id)
        const fieldPath = sectionIndex >= 0 ? `sections[${sectionIndex}].markdown` : findingIndex ? `findings[${Number(findingIndex[1]) - 1}].text` : id === 'method-summary' ? 'markdown' : 'answer'
        const text = sectionIndex >= 0 ? parsed.sections[sectionIndex]!.markdown : findingIndex ? parsed.findings[Number(findingIndex[1]) - 1]!.text : id === 'method-summary' ? parsed.markdown : parsed.answer
        const originalText = text.length <= targetTextBudget ? text : undefined
        if (originalText !== undefined) targetTextBudget -= originalText.length
        return { id, fieldPath, ...(originalText !== undefined ? { originalText } : {}), issues: numericRepairIssues.filter((issue) => issue.id === id).map(({ token, context }) => ({ token, context })) }
      })
      if (numericRepairIssues.length) throw new Error(`NUMERIC: ${numericRepairIssues.map((issue) => `${issue.id}:${issue.token} (${issue.context.slice(0, 16)})`).join('; ')}`)
      const inlineSourceIds = [parsed.markdown, ...parsed.sections.map((section) => section.markdown)].flatMap((text) => [...text.matchAll(/\[([^\]\s]+)@[^\]\s]+\]/g)].map((match) => match[1]!))
      return { skillId: input.skillId, ...parsed, sourceCandidateIds: [...new Set([...parsed.findings.flatMap((finding) => finding.evidence.map((ref) => ref.sourceCandidateId)), ...inlineSourceIds])], diagnostics, attempts: attempt, executionEvidence: packets, attemptOutputs, citationRepairs }
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) { diagnostics.push({ code: 'CANCELLED', message: 'Semantic execution cancelled', attempt }); return empty('cancelled', attempt) }
      const message = error instanceof Error ? error.message : String(error)
      const failureClass = error instanceof ReasoningExecutorError ? error.failureClass : undefined
      const quota = failureClass === 'rate_limit_or_quota' || /usage limit|quota|rate limit|余额不足|额度/.test(message.toLowerCase())
      const auth = failureClass === 'authentication_or_account' || /unauthorized|authentication|invalid api key|sign.?in required/i.test(message)
      diagnostics.push({ code: quota ? 'RATE_LIMIT_OR_QUOTA' : auth ? 'AUTHENTICATION_OR_ACCOUNT' : message.startsWith('NUMERIC:') ? 'NUMERIC_GROUNDING_ERROR' : message.startsWith('REFERENCE:') ? 'REFERENCE_ERROR' : message.startsWith('FORMAT:') || (error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid') ? 'FORMAT_ERROR' : /timeout|timed out/i.test(message) ? 'TIMEOUT' : 'CALL_FAILED', message: message.slice(0, 1000), attempt })
      if (quota || auth) return empty('failed', attempt)
    }
  }
  return empty('failed', diagnostics.length)
}

/** Add only explicit context rows selected and supplied in this exact operation's packet. */
export function bindCompanyMethodEvidenceContext(result: ReturnType<typeof validateCompanyMethodOutput>, packets: readonly CompanyEvidencePacket[]): ReturnType<typeof validateCompanyMethodOutput> {
  const excerpts = new Map(packets.map(withCompanyEvidenceDateContext).flatMap((packet) => packet.excerpts.map((excerpt) => [`${packet.sourceCandidateId}@${excerpt.location}`, excerpt] as const)))
  const expand = (ref: CompanyMethodEvidenceRef): CompanyMethodEvidenceRef[] => [ref, ...(excerpts.get(`${ref.sourceCandidateId}@${ref.location}`)?.contextLocations ?? []).filter((location) => excerpts.has(`${ref.sourceCandidateId}@${location}`)).map((location) => ({ sourceCandidateId: ref.sourceCandidateId, location }))]
  const markdown = (text: string) => text.replace(/\[([^\]\s]+)@(paragraph:\d+)\]/g, (_match, sourceCandidateId: string, location: string) => expand({ sourceCandidateId, location }).map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' '))
  return { ...result, markdown: markdown(result.markdown), sections: result.sections.map((section) => ({ ...section, markdown: markdown(section.markdown) })), findings: result.findings.map((finding) => ({ ...finding, evidence: [...new Map(finding.evidence.flatMap(expand).map((ref) => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()] })) }
}

export function validateCompanyMethodOutput(output: unknown, packets: readonly CompanyEvidencePacket[], ownedSectionIds?: readonly string[]): Pick<CompanyResearchMethodResult, 'status' | 'answer' | 'markdown' | 'sections' | 'findings' | 'limitations' | 'risks'> {
  let raw: unknown = output
  if (typeof raw === 'string') { try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw new Error('FORMAT: Invalid JSON') } }
  const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('FORMAT: Expected object'); return value as Record<string, unknown> }
  const value = object(raw)
  const exact = (row: Record<string, unknown>, keys: readonly string[]) => { if (Object.keys(row).some((key) => !keys.includes(key)) || keys.some((key) => !(key in row))) throw new Error('FORMAT: Unexpected or missing fields') }
  exact(value, ['status', 'answer', 'markdown', 'sections', 'findings', 'limitations', 'risks'])
  const string = (value: unknown, max: number): string => { if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('FORMAT: Invalid bounded string'); return value.trim() }
  const array = (value: unknown, max: number): unknown[] => { if (!Array.isArray(value) || value.length > max) throw new Error('FORMAT: Invalid bounded array'); return value }
  if (value.status !== 'complete' && value.status !== 'insufficient_evidence') throw new Error('FORMAT: Invalid status')
  const allowed = new Set(packets.flatMap((packet) => packet.excerpts.map((excerpt) => `${excerpt.sourceCandidateId}@${excerpt.location}`)))
  const findings = array(value.findings, 24).map((item): CompanyMethodFinding => {
    const row = object(item); exact(row, ['text', 'kind', 'evidence'])
    if (!['fact', 'inference', 'assumption'].includes(String(row.kind))) throw new Error('FORMAT: Invalid finding kind')
    const evidence = array(row.evidence, 12).map((item): CompanyMethodEvidenceRef => { const ref = object(item); exact(ref, ['sourceCandidateId', 'location']); const sourceCandidateId = string(ref.sourceCandidateId, 300); const location = string(ref.location, 100); if (!allowed.has(`${sourceCandidateId}@${location}`)) throw new Error(`REFERENCE: Evidence location not supplied: ${sourceCandidateId}@${location}`); return { sourceCandidateId, location } })
    if (!evidence.length) throw new Error('REFERENCE: Findings require attributable evidence')
    return { text: string(row.text, 1800), kind: row.kind as CompanyMethodFinding['kind'], evidence }
  })
  const markdown = string(value.markdown, 16000)
  const sections = array(value.sections, 3).map((item) => { const row = object(item); exact(row, ['id', 'markdown']); return { id: string(row.id, 100), markdown: string(row.markdown, 16000) } })
  if (!sections.length || new Set(sections.map((section) => section.id)).size !== sections.length || (ownedSectionIds && (sections.some((section) => !ownedSectionIds.includes(section.id)) || ownedSectionIds.some((id) => !sections.some((section) => section.id === id))))) throw new Error('FORMAT: Sections must match exact owned section IDs')
  for (const text of [markdown, ...sections.map((section) => section.markdown)]) for (const match of text.matchAll(/\[([^\]\s]+@[^\]\s]+)\]/g)) if (!allowed.has(match[1]!)) throw new Error(`REFERENCE: Unknown markdown citation ${match[1]}`)
  const hasLocatedCitation = (text: string) => [...text.matchAll(/\[([^\]\s]+@[^\]\s]+)\]/g)].some((match) => allowed.has(match[1]!))
  if (value.status === 'complete' && (!findings.length || !hasLocatedCitation(markdown))) throw new Error('FORMAT: Complete method requires findings and explicit markdown citations')
  if (value.status === 'complete' && sections.some((section) => !hasLocatedCitation(section.markdown))) throw new Error('FORMAT: Each complete owned section requires an inline citation from supplied evidence')
  const limitations = array(value.limitations, 20).map((item) => string(item, 1200))
  if (value.status === 'insufficient_evidence' && !limitations.length) throw new Error('FORMAT: Insufficient evidence requires specific limitations')
  return { status: value.status, answer: string(value.answer, 3000), markdown, sections, findings, limitations, risks: array(value.risks, 20).map((item) => string(item, 1200)) }
}
