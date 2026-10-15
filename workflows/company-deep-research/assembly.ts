import type { CompanyResearchInput, CompanyResearchResult, SemanticKnowledgeProposal } from '../../skills/company-research/contracts.ts'
import { COMPANY_RESEARCH_SECTIONS } from '../../skills/company-research/skill.ts'
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { validateCompanyNumericGrounding } from '../../skills/company-research/numeric-grounding.ts'
import { companyCitedSplitDateText } from '../../skills/company-research/evidence.ts'

const idFor = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')
const finalIds = ['valuation','bull-base-bear','variant-perception','investment-thesis','monitoring-checklist']
const optionalGaps: Record<string, string> = {
  valuation: '研究缺口：本轮尚未建立同一基准日股价、股本、盈利预测和可比公司估值的完整可复算组合。已尝试配置行情、公司财报与公开业务资料；历史财务及行情不能代替预测盈利和可比口径。影响：不作目标价或估值安全边际判断。',
  'bull-base-bear': '研究缺口：缺少分部销量、价格、利润率与资本需求的来源绑定预测假设及情景概率。已尝试定期报告和公开产品、行业材料；定性增长条件尚不能计算三种情景的盈利与回报。影响：保留增长和风险条件，不提供虚构的情景收益率。',
  'variant-perception': '研究缺口：未取得有日期、样本覆盖和统一期间口径的市场一致预期，以及可比的公司指引。已尝试配置来源、公司披露与公开投资者材料；搜索摘要和个别观点不能代表一致预期。影响：不能量化预期差，不能据此声称市场已充分或未充分定价。',
}
const schema = {type:'object',additionalProperties:false,required:['sections'],properties:{sections:{type:'array',minItems:5,maxItems:5,items:{type:'object',additionalProperties:false,required:['id','markdown','sourceCandidateIds'],properties:{id:{type:'string',enum:finalIds},markdown:{type:'string',minLength:1,maxLength:8000},sourceCandidateIds:{type:'array',items:{type:'string'}}}}}}} as const

/** Final synthesis assembles conclusions from peer results; it never runs peer Skills. */
export async function assembleCompanyResearch(input: CompanyResearchInput, methods: readonly CompanyResearchMethodResult[], executor: ReasoningExecutor | undefined, now: () => string, maxAttempts: number = 2): Promise<CompanyResearchResult & { synthesisMode: string; synthesisDiagnostics: readonly string[]; synthesisAttempts: number }> {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 2) throw new Error('Invalid synthesis attempt budget')
  const diagnostics: string[] = []
  const sections = COMPANY_RESEARCH_SECTIONS.map(title => {
    const id=idFor(title)
    const owners=methods.filter(method=>method.sections.some(section=>section.id===id))
    return {id,title,markdown:owners.map(method=>method.sections.find(section=>section.id===id)!.markdown).join('\n\n') || `研究缺口：${title} 尚未完成。缺失对应方法结果；已尝试本轮配置来源。影响：不能据此作出结论。`,sourceCandidateIds:[...new Set(owners.flatMap(method=>method.sourceCandidateIds))],proposalIds:[] as string[]}
  })
  const available=methods.filter(method=>method.status==='complete')
  const allowed=new Set(input.reportSourceCandidateIds ?? input.durableSourceCandidateIds ?? [])
  let synthesisMode='deterministic_fallback'
  let synthesisAttempts=0
  if(executor && available.length) for(let attempt=1;attempt<=maxAttempts;attempt++) {
    synthesisAttempts=attempt
    if(input.signal?.aborted) throw new Error('WORKFLOW_CANCELLED')
    try {
      const response=await executor.execute({operation:'company_research_synthesis',instruction:'用中文整合已完成的独立研究方法，只输出指定五节。investment-thesis 给出核心判断、支持证据、最强反证和失效条件；monitoring-checklist 给出指标、观察频率、触发条件和论点关联。每个主要判断使用提供方法中的 [sourceCandidateId@paragraph:N] 引用。不可重新编造基础事实或计算数值。估值、情景和预期差仅当材料包含可复算输入时分析，否则明确缺失输入、已尝试来源、影响。不要把无一致预期说成不存在预期差。',input:{company:input.company,asOf:input.asOf,methods:available.map(method=>({skillId:method.skillId,answer:method.answer,markdown:method.markdown,sections:method.sections,findings:method.findings,limitations:method.limitations,risks:method.risks,sourceCandidateIds:method.sourceCandidateIds})),preparedAnalysis:input.preparedAnalysis,requiredSectionIds:finalIds,qualityFeedback:input.qualityFeedback ?? [],repair:attempt>1?diagnostics.at(-1):null},outputContract:schema,metadata:{operationFamily:'company-research-quality'}},input.signal)
      const value=(typeof response.output==='string'?JSON.parse(response.output):response.output) as {sections?: {id:string;markdown:string;sourceCandidateIds:string[]}[]}
      if(!Array.isArray(value.sections)||value.sections.length!==5||new Set(value.sections.map(s=>s.id)).size!==5) throw new Error('FORMAT_ERROR: final section set must be exact')
      const locations=new Set(available.flatMap(method=>method.findings.flatMap(f=>f.evidence.map(e=>`${e.sourceCandidateId}@${e.location}`))))
      for (const method of available) {
        const supplied = new Set([...(method.executionEvidence ?? []), ...(method.deterministicEvidence ?? [])].flatMap(packet => packet.excerpts.map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`)))
        for (const text of [method.markdown, ...method.sections.map(section => section.markdown)]) for (const match of text.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)) if (supplied.has(match[1]!)) locations.add(match[1]!)
      }
      const validated: {id:string;markdown:string;sourceCandidateIds:string[]}[]=[]
      for(const section of value.sections) {
        if(!finalIds.includes(section.id)||typeof section.markdown!=='string'||!section.markdown.trim()||!Array.isArray(section.sourceCandidateIds)||section.sourceCandidateIds.some(id=>!allowed.has(id))) throw new Error('REFERENCE_ERROR: final section contract or source invalid')
        for(const match of section.markdown.matchAll(/\[([^\]\s]+@[^\]]+)\]/g)) if(!locations.has(match[1]!)) throw new Error('REFERENCE_ERROR: final synthesis locator unavailable')
        if(['investment-thesis','monitoring-checklist'].includes(section.id)&&(!section.sourceCandidateIds.length||![...section.markdown.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].length)) throw new Error('REFERENCE_ERROR: conclusion requires located evidence')
        const citationIds=[...new Set([...section.markdown.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(match=>match[1]!))]
        if(citationIds.some(id=>!section.sourceCandidateIds.includes(id))) throw new Error('REFERENCE_ERROR: citation source absent from section attribution')
        const optional= !['investment-thesis','monitoring-checklist'].includes(section.id)
        if (!optional) {
          const grounding=validateCompanyNumericGrounding({markdown:section.markdown,sources:input.sources,preparedAnalysis:input.preparedAnalysis,trustedText:[input.company.symbol,input.asOf,...companyCitedSplitDateText(section.markdown,available.flatMap(method=>method.executionEvidence ?? []))]})
          if(grounding.status!=='grounded') throw new Error(`NUMERIC_GROUNDING_ERROR:${grounding.diagnostics.map(d=>d.token).join(',')}`)
        }
        validated.push({id:section.id,markdown:optional?optionalGaps[section.id]!:section.markdown.trim(),sourceCandidateIds:optional?[]:citationIds})
      }
      for(const section of validated) Object.assign(sections.find(s=>s.id===section.id)!,section)
      synthesisMode='reasoning_executor';break
    } catch(error) {if(input.signal?.aborted) throw new Error('WORKFLOW_CANCELLED');diagnostics.push(`${attempt}:${error instanceof Error?error.message:String(error)}`)}
  }
  const durable=new Set(input.durableSourceCandidateIds ?? [])
  const proposals:SemanticKnowledgeProposal[]=[{proposalId:'proposal-company',kind:'entity',subjectKey:'company',entityType:'company',entityName:input.company.name ?? input.company.symbol}]
  for(const method of available) for(const [index,finding] of method.findings.entries()) {
    const refs=[...new Set(finding.evidence.map(e=>e.sourceCandidateId))]
    if(!refs.length||refs.some(id=>!durable.has(id))) continue
    const proposalId=`${method.skillId}-${index+1}`
    proposals.push({proposalId,kind:'claim',subjectKey:'company',claimType:finding.kind==='fact'?'fact':finding.kind==='assumption'?'assumption':'viewpoint',statement:finding.text,sourceCandidateIds:refs})
    for(const section of sections) if(method.sections.some(s=>s.id===section.id)) section.proposalIds.push(proposalId)
  }
  return {company:input.company,generatedAt:now(),asOf:input.asOf,sections,proposals,sourceCandidateIds:[...durable],contextOnlySourceCandidateIds:input.sources.filter(s=>!durable.has(s.candidate.candidateId)).map(s=>s.candidate.candidateId),synthesisMode,synthesisDiagnostics:diagnostics,synthesisAttempts}
}
