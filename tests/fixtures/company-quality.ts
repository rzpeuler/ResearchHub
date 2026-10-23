import assert from 'node:assert/strict'
import { COMPANY_METHOD_SECTION_IDS } from '../../skills/company-research/methods.ts'
import type { CompanyResearchMethodId } from '../../skills/company-research/methods.ts'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import { createCompanyResearchDataResolver } from '../../plugins/research-acquisition/company-research-data.ts'
import type { CompanyDeepResearchResolverOptions } from '../../workflows/company-deep-research/contracts.ts'
import type { ResearchAcquisitionPlugin } from '../../plugins/research-acquisition/contracts.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import { COMPANY_CORE_SECTION_IDS } from '../../workflows/company-deep-research/content-quality.ts'

/** No implicit public-network adapters in unit fixtures. Production uses its normal data factory. */
export function fixtureCompanyDataResolverFactory(officialDisclosure?: ResearchAcquisitionPlugin, gdelt?: ResearchAcquisitionPlugin, akshare?: AkshareDataClient) {
  return (context: CompanyDeepResearchResolverOptions) => createCompanyResearchDataResolver({ ...context, officialDisclosure, gdelt, akshare })
}

/** Semantic fixtures exercise all peer adapters and final assembly; they are not live quality acceptance. */
export function completeResearchExecutor(calls: string[] = []): ReasoningExecutor {
  return { capabilities: () => ({ maxContextTokens: 100000, maxOutputTokens: 16000, structuredOutputSupport: true, maxConcurrency: 1 }), execute: async (request) => {
    const input = request.input as any
    if (request.metadata?.stage === 'content_quality_review') return { operation: request.operation, output: { sectionChecks: COMPANY_CORE_SECTION_IDS.map((sectionId) => ({ sectionId, questionAnswered: true, evidenceSupportsConclusion: true, numericReproducible: true, riskTransmission: true, reasons: [] })) } }
    if (request.metadata?.stage === 'tam_operand_extraction') return { operation: request.operation, output: { estimates: [], gaps: ['Fixture evidence contains no disclosed market scale inputs.'] } }
    if (request.operation === 'company_research_method') {
      const skillId = request.metadata!.skillId as CompanyResearchMethodId
      calls.push(skillId)
      const excerpt = input.evidence[0]?.excerpts[0]
      assert.ok(excerpt, 'Complete fixture requires actually supplied evidence')
      const citation = `[${excerpt.sourceCandidateId}@${excerpt.location}]`
      const markdown = skillId === 'market_structure_analysis'
        ? `公司产品对应具体细分市场与产业链环节；行业需求及市场预测提供背景，但缺少公司可服务边界和份额，因此不能据行业总量推算公司TAM。${citation}`
        : skillId === 'competitive_market_map'
          ? `与中际旭创相比，公司产品及技术路线存在差异；目前缺少同口径成本、价格及份额数据，因此不能推断竞争胜负。${citation}`
          : `${skillId} 的研究问题回答：披露材料说明经营背景，分析其中的经营机制及竞争约束；若需求变化则应重新审视结论。${citation}`
      return { operation: request.operation, output: { status: 'complete', answer: `${skillId} 的证据支持研究结论，并存在经营风险。`, markdown, sections: COMPANY_METHOD_SECTION_IDS[skillId].map((id) => ({ id, markdown: `${id}：${markdown}` })), findings: [{ text: `${input.company.symbol} ${skillId} 研究判断。`, kind: 'inference', evidence: [{ sourceCandidateId: excerpt.sourceCandidateId, location: excerpt.location }] }], limitations: ['仅为接口与持久化测试，不代表真实公司质量验收。'], risks: ['需求下降会降低收入并压缩经营现金流；跟踪销量验证。'] } }
    }
    calls.push('company_research_synthesis')
    const ref = input.methods[0].findings[0].evidence[0]
    return { operation: request.operation, output: { sections: input.requiredSectionIds.map((id: string) => ({ id, markdown: ['valuation', 'bull-base-bear', 'variant-perception'].includes(id) ? '研究缺口：缺少有来源的估值输入；已尝试配置来源；影响：不作数值估值。' : id === 'industry-exposure' ? `公司产品对应具体细分市场与产业链环节；行业需求及市场预测提供背景，但缺少公司可服务边界和份额，因此不能据行业总量推算公司TAM。[${ref.sourceCandidateId}@${ref.location}]` : id === 'competition' ? `与具名同业相比，公司产品及技术路线存在差异；目前缺少同口径成本、价格及份额数据，因此不能推断竞争胜负。[${ref.sourceCandidateId}@${ref.location}]` : `${id}：证据支持经营分析，最强反证为需求下降。按季度跟踪销量与现金流，低于披露基准则复核论点。[${ref.sourceCandidateId}@${ref.location}]`, sourceCandidateIds: [ref.sourceCandidateId] })) } }
  } }
}
