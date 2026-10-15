import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { ReasoningExecutorError } from '../../plugins/reasoning/errors.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'
import { COMPANY_CORE_SECTION_IDS, type CompanyContentSection } from './content-quality.ts'
import { selectCompanyEvidence } from '../../skills/company-research/evidence.ts'

export interface CompanySemanticSectionCheck {
  readonly sectionId: string
  readonly questionAnswered: boolean
  readonly evidenceSupportsConclusion: boolean
  readonly numericReproducible: boolean
  readonly riskTransmission: boolean
  readonly reasons: readonly string[]
}
export interface CompanySemanticQuality {
  readonly passed: boolean
  readonly status: 'passed' | 'failed' | 'cancelled'
  readonly sectionChecks: readonly CompanySemanticSectionCheck[]
  readonly issues: readonly string[]
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly attempt: number }[]
  readonly attempts: number
  readonly attemptOutputs?: readonly { readonly attempt: number; readonly output: unknown }[]
}
export type CompanySemanticQualityResult = CompanySemanticQuality
export interface CompanySemanticQualityInput extends CompanyResearchInput {
  readonly sections: readonly CompanyContentSection[]
  readonly reasoningExecutor?: ReasoningExecutor
  readonly maxAttempts?: 1 | 2
}
const rubric: Readonly<Record<string, string>> = {
  'company-overview': '说明公司发展阶段和战略转折，区分成立、开始经营、共同注册成立与股份改制的主体和口径。实际证据出现不同年份时必须并列解释，不能只选官网或法定注册一个年份而忽略冲突。区分披露事实与影响判断。',
  'business-model': '回答谁付费、购买什么、如何形成收入利润，解释经济机制。',
  'business-segments': '区分主要业务及收入角色、客户应用、各分部关系与已知边界。',
  'revenue-profit-drivers': '解释收入利润变化及量价、组合、成本链路；未知贡献明确限制。',
  products: '解释主要产品、客户需求、差异、替代与商业化约束。',
  technologies: '说明技术路线如何带来产品/成本差异及验证限制；宣传不冒充独立验证。',
  'industry-exposure': '界定公司所处市场、产业链、需求趋势和适用边界；TAM缺数不能伪造。',
  'supply-chain': '说明关键供应链角色、依赖、整合程度及经营影响；缺少集中度可以局部缺口。关键数字段必须绑定精确source@paragraph引用，仅称结构化摘要/代码结果而无可定位引用不通过；不能用其他章节的引用代替。',
  competition: '比较有证据的具体竞争企业/产品或具体技术替代路线，解释可比范围、优势条件和反证。只有行业集合泛称、一般替代品、竞争激烈表述或竞争资料缺口，不算回答竞争分析问题。',
  'financial-quality': '解释财务趋势、利润与现金、资产负债及营运资本风险；不是重复数据。',
  'growth-drivers': '解释增长条件、证据、限制及可验证信号，不将未经验证预测当事实。',
  'management-capital-allocation': '说明关键管理背景、治理/激励及资金配置目的、结果与归因限制。',
  catalysts: '列公司特定事件、时间或条件、影响路径及需要验证的结果。',
  risks: '公司特定触发条件→经营/财务影响→观察信号→缓解及残余风险，避免泛泛风险名词。',
  'investment-thesis': '综合核心判断、支持证据、最强反证、条件与失效信号，结论范围与证据相称。',
  'monitoring-checklist': '给可观察指标、频率/触发条件、与判断的联系；频率是研究建议不是公司披露事实。',
}
export const COMPANY_SEMANTIC_QUALITY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['sectionChecks'], properties: {
    sectionChecks: { type: 'array', minItems: 16, maxItems: 16, items: { type: 'object', additionalProperties: false,
      required: ['sectionId', 'questionAnswered', 'evidenceSupportsConclusion', 'numericReproducible', 'riskTransmission', 'reasons'],
      properties: { sectionId: { type: 'string', enum: COMPANY_CORE_SECTION_IDS }, questionAnswered: { type: 'boolean' }, evidenceSupportsConclusion: { type: 'boolean' }, numericReproducible: { type: 'boolean' }, riskTransmission: { type: 'boolean' }, reasons: { type: 'array', maxItems: 10, items: { type: 'string', minLength: 1, maxLength: 1200 } } },
    } },
  },
} as const

/** Independent Workflow review of substantive coverage and evidence entailment; formatting/number guards remain separate. */
export async function reviewCompanyResearchSemantics(input: CompanySemanticQualityInput): Promise<CompanySemanticQuality> {
  const diagnostics: { code: string; message: string; attempt: number }[] = []
  const attemptOutputs: {attempt:number;output:unknown}[] = []
  const fail = (issue: string, attempts = 0, status: CompanySemanticQuality['status'] = 'failed'): CompanySemanticQuality => ({ passed: false, status, sectionChecks: [], issues: [issue], diagnostics, attempts, attemptOutputs })
  if (input.signal?.aborted) return fail('SEMANTIC_QUALITY_CANCELLED', 0, 'cancelled')
  if (!input.reasoningExecutor) return fail('SEMANTIC_QUALITY_EXECUTOR_UNAVAILABLE')
  const sections = COMPANY_CORE_SECTION_IDS.map((id) => input.sections.find((section) => section.id === id))
  if (sections.some((section) => !section)) return fail('SEMANTIC_QUALITY_MISSING_CORE_SECTION')
  const sourceMap = new Map(input.sources.map((source) => [source.candidate.candidateId, source]))
  const citedParagraphs = new Map<string, { sourceCandidateId: string; location: string; sourceTitle: string; publishedAt?: string; observedPublicationDate?: string; historicalSourceContext?: unknown; text: string }>()
  for (const section of sections) {
    const matches = [...section!.markdown.matchAll(/\[([^\]\s]+)@(paragraph:(\d+))\]/g)]
    if (!matches.length) return fail(`SEMANTIC_QUALITY_NO_LOCATED_EVIDENCE:${section!.id}`)
    for (const match of matches) {
    const source = sourceMap.get(match[1]!)
    const text = source?.content.split(/\r?\n/)[Number(match[3]) - 1]
    if (!source || text === undefined || !text.trim()) return fail(`SEMANTIC_QUALITY_UNRESOLVED_REFERENCE:${section!.id}:${match[1]}@${match[2]}`)
    const metadata = source.candidate.metadata
    citedParagraphs.set(`${match[1]}@${match[2]}`, { sourceCandidateId: match[1]!, location: match[2]!, sourceTitle: source.title, publishedAt: source.candidate.publishedAt, ...(typeof metadata?.observedPublicationDate === 'string' ? {observedPublicationDate:metadata.observedPublicationDate} : {}), ...(metadata?.historicalSourceContext ? {historicalSourceContext:metadata.historicalSourceContext} : {}), text })
    }
  }
  const outputExample = { sectionChecks: COMPANY_CORE_SECTION_IDS.map((sectionId) => ({ sectionId, questionAnswered: true, evidenceSupportsConclusion: true, numericReproducible: true, riskTransmission: true, reasons: [] })) }
  const actualSources = new Set(input.sources.map((source) => source.candidate.candidateId))
  const eligibleIds = (input.reportSourceCandidateIds ?? input.durableSourceCandidateIds ?? []).filter((id) => actualSources.has(id))
  // Independently inspect available but uncited evidence before accepting claims of missing material.
  const gapCheckEvidence = selectCompanyEvidence(input.sources, eligibleIds, ['分行业', '分产品', '毛利率', '收入构成', '前五大客户', '前五名客户', '前五客户', '客户集中度', '专业背景', '主要工作经历', '管理层履历', '员工持股计划', '现金分红', '股份回购', '股本变动', '研发资本化', '共同注册', '注册成立', '成立日期'], { purpose: 'company_content_review', maxCharacters: 12000, maxSources: 8 }).map((packet) => {
    const source = sourceMap.get(packet.sourceCandidateId)!
    const provenance = source.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined
    return { ...packet, retrievedAt: source.retrievedAt, dateStatus: provenance?.dateStatus ?? null, pointInTimeStatus: provenance?.pointInTimeStatus ?? null, pointInTimeSafe: provenance?.pointInTimeSafe ?? null }
  })
  for (let attempt = 1; attempt <= (input.maxAttempts ?? 2); attempt++) {
    if (input.signal?.aborted) return fail('SEMANTIC_QUALITY_CANCELLED', attempt - 1, 'cancelled')
    try {
      const response = await input.reasoningExecutor.execute({ operation: 'company_research_synthesis', instruction: '独立审查公司研报实质质量，不改写报告、不调用其他Skill。只逐条审查指定16个核心章节，输出与示例相同字段形状的完整JSON，示例true只是字段类型说明，必须独立核验每项，不可默认通过；估值/三情景/预期差缺口不阻塞首次覆盖。不能因字数、段落数量或引用存在就判通过。questionAnswered检查rubric主要问题是否被实质回答；evidenceSupportsConclusion逐项核对关键论点与引用原文是否相符、范围和时间是否一致、推断是否有支撑，不能只检查链接。gapCheckEvidence来自同一研究实际可引用来源的独立限额检索，专用于核查“未提供分部收入、客户集中度、管理履历”等缺口是否虚假；若已有相应证据却宣称没有，必须指出具体段落及缺口对分析的影响并判相关问题/依据不通过。这些未引用证据只可用来拒绝虚假缺口，不可直接替报告补写结论或使未引用论点自动通过；尊重其发布日期、历史口径及PIT限制。竞争章节只有厂商名单或商业报告目录、无实际产品/技术/客户等可比信息，不算完成竞争分析。numericReproducible核对金额/百分比/期间/单位/累计与单季、公式及已给代码计算结果；逐列核对表头与数据，产量不能借用销量、研发费用不能借用研发投入、匿名客户姓名未披露不等于其销售比例未披露。未经输入计算的新增数值不能放行。风险节riskTransmission检查公司特定触发条件、影响路径、观察信号、缓解及残余风险；其他15节riskTransmission固定true。主要问题已回答时，补充比率、全部人物履历、独立技术验证、目标价或TAM缺数可保留具体限制，不因此否定整节。无关键数字时numericReproducible=true。所有true时reasons=[]；有任何false时reasons中文指出具体问题、错误论点/引用及影响，不能笼统写质量不足。资料不足、事实冲突未交代或原文不支持关键结论必须false，不猜测外部事实。', input: { company: input.company, asOf: input.asOf, requiredCoreSectionIds: COMPANY_CORE_SECTION_IDS, rubric, sections, methods: (input.methodResults ?? []).map((method) => ({ skillId: method.skillId, status: method.status, answer: method.answer, findings: method.findings, limitations: method.limitations, risks: method.risks })), preparedAnalysis: input.preparedAnalysis ?? null, citedParagraphs: [...citedParagraphs.values()], gapCheckEvidence, outputExample, repairErrors: diagnostics.slice(-1), repairPreviousOutput:attemptOutputs.at(-1)?.output ?? null }, outputContract: COMPANY_SEMANTIC_QUALITY_SCHEMA, metadata: { operationFamily: 'company-research-quality', stage: 'content_quality_review', companySymbol: input.company.symbol } }, input.signal)
      attemptOutputs.push({attempt,output:response.output})
      if (input.signal?.aborted) return fail('SEMANTIC_QUALITY_CANCELLED', attempt, 'cancelled')
      const sectionChecks = validateCompanySemanticQualityOutput(response.output)
      const issues = sectionChecks.flatMap((check) => {
        const failed = ['questionAnswered', 'evidenceSupportsConclusion', 'numericReproducible', 'riskTransmission'].filter((key) => !check[key as keyof CompanySemanticSectionCheck])
        return failed.length ? [`${check.sectionId}:${failed.join(',')}:${check.reasons.join('; ')}`] : []
      })
      return { passed: issues.length === 0, status: issues.length ? 'failed' : 'passed', sectionChecks, issues, diagnostics, attempts: attempt, attemptOutputs }
    } catch (error) {
      if (input.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) return fail('SEMANTIC_QUALITY_CANCELLED', attempt, 'cancelled')
      const message = error instanceof Error ? error.message : String(error)
      const failureClass = error instanceof ReasoningExecutorError ? error.failureClass : undefined
      const quota = failureClass === 'rate_limit_or_quota' || /usage limit|quota|rate limit/i.test(message)
      const auth = failureClass === 'authentication_or_account' || /unauthorized|authentication|invalid api key/i.test(message)
      diagnostics.push({ code: quota ? 'RATE_LIMIT_OR_QUOTA' : auth ? 'AUTHENTICATION_OR_ACCOUNT' : message.startsWith('FORMAT:') || (error instanceof ReasoningExecutorError && error.code === 'reasoning_output_invalid') ? 'FORMAT_ERROR' : /timeout/i.test(message) ? 'TIMEOUT' : 'CALL_FAILED', message: message.slice(0, 1500), attempt })
      if (quota || auth) return fail('SEMANTIC_QUALITY_EXECUTION_FAILED', attempt)
    }
  }
  return fail('SEMANTIC_QUALITY_EXECUTION_FAILED', diagnostics.length)
}

export function validateCompanySemanticQualityOutput(output: unknown): CompanySemanticSectionCheck[] {
  let raw = output
  if (typeof raw === 'string') { try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { throw new Error('FORMAT: Invalid semantic quality JSON') } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('FORMAT: Semantic quality object required')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).length !== 1 || !Array.isArray(value.sectionChecks) || value.sectionChecks.length !== COMPANY_CORE_SECTION_IDS.length) throw new Error('FORMAT: Exact core check array required')
  const keys = ['sectionId', 'questionAnswered', 'evidenceSupportsConclusion', 'numericReproducible', 'riskTransmission', 'reasons']
  const checks = value.sectionChecks.map((item): CompanySemanticSectionCheck => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('FORMAT: Check object required')
    const row = item as Record<string, unknown>
    if (Object.keys(row).length !== keys.length || keys.some((key) => !(key in row)) || typeof row.sectionId !== 'string' || !(COMPANY_CORE_SECTION_IDS as readonly string[]).includes(row.sectionId)) throw new Error('FORMAT: Exact section check fields required')
    for (const key of keys.slice(1, 5)) if (typeof row[key] !== 'boolean') throw new Error('FORMAT: Boolean review flags required')
    if (!Array.isArray(row.reasons) || row.reasons.length > 10 || row.reasons.some((reason) => typeof reason !== 'string' || !reason.trim() || reason.length > 1200)) throw new Error('FORMAT: Bounded Chinese reasons required')
    const allPassed = keys.slice(1, 5).every((key) => row[key] === true)
    if (allPassed ? row.reasons.length > 0 : row.reasons.length === 0) throw new Error('FORMAT: Failed checks need reasons; passed checks must have no blocking reasons')
    if (row.sectionId !== 'risks' && row.riskTransmission !== true) throw new Error('FORMAT: Risk transmission flag is only evaluated for risks')
    return row as unknown as CompanySemanticSectionCheck
  })
  if (new Set(checks.map((check) => check.sectionId)).size !== COMPANY_CORE_SECTION_IDS.length) throw new Error('FORMAT: Duplicate or missing core section IDs')
  return COMPANY_CORE_SECTION_IDS.map((id) => checks.find((check) => check.sectionId === id)!)
}
