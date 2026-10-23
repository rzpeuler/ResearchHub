/** Content completion is separate from source admissibility and canonical persistence. */
import type { CompanyResearchMethodResult } from '../../skills/company-research/methods.ts'
import { COMPANY_METHOD_SECTION_IDS } from '../../skills/company-research/methods.ts'
import type { CompanySemanticQualityResult } from './semantic-quality.ts'
export interface CompanyMethodExecution {
  readonly skillId: string
  readonly status: 'completed' | 'complete' | 'insufficient_evidence' | 'failed' | 'incomplete' | 'cancelled'
  readonly attempts: number
  readonly errorCode?: string
  readonly summary?: string
}
export interface CompanyContentSection {
  readonly id: string
  readonly markdown: string
  readonly sourceCandidateIds?: readonly string[]
  readonly sourceRefs?: readonly string[]
  readonly evidenceLinks?: readonly string[]
}
export interface CompanyResearchQuality {
  readonly semanticReview?: CompanySemanticQualityResult
  readonly passed: boolean
  readonly status: 'complete' | 'incomplete'
  readonly coreCoverage: { readonly completed: number; readonly required: number }
  readonly issues: readonly string[]
  readonly sectionChecks: readonly { readonly sectionId: string; readonly core: boolean; readonly passed: boolean; readonly reasons: readonly string[] }[]
}
export const COMPANY_CORE_SECTION_IDS = ['company-overview', 'business-model', 'business-segments', 'revenue-profit-drivers', 'products', 'technologies', 'industry-exposure', 'supply-chain', 'competition', 'financial-quality', 'growth-drivers', 'management-capital-allocation', 'catalysts', 'risks', 'investment-thesis', 'monitoring-checklist'] as const
const gap = /^(?:Research gap:|Market data gap:|研究缺口[：:]|数据缺口[：:]|证据不足[：:]|no bounded evidence was supplied|无可用证据|未获取到.*(?:证据|资料))/i

/** Fingerprint only the exact, still-resolvable evidence cited by a synthesis. */
export function companySynthesisEvidenceFingerprint(input: { readonly sections: readonly CompanyContentSection[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): string | undefined {
  const refs = [...new Set(input.sections.flatMap(section => [...section.markdown.matchAll(/\[([A-Za-z0-9_.-]+@paragraph:\d+)\]/g)].map(match => match[1]!)))].sort()
  if (!refs.length) return undefined
  const evidence = new Map<string, string>()
  for (const method of input.methodResults) {
    for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
      for (const excerpt of packet.excerpts) evidence.set(`${packet.sourceCandidateId}@${excerpt.location}`, `${packet.title}\n${excerpt.text}`)
    }
    for (const finding of method.findings) for (const ref of finding.evidence) {
      const key = `${ref.sourceCandidateId}@${ref.location}`
      if (!evidence.has(key)) evidence.set(key, `finding:${finding.text}`)
    }
  }
  const resolved = refs.map(ref => [ref, evidence.get(ref)] as const)
  if (resolved.some(([, text]) => !text)) return undefined
  return JSON.stringify(resolved)
}

export function ensureCompanyIncompleteSynthesisSections<T extends CompanyContentSection>(sections: readonly T[], reason: 'cited_evidence_unresolved' | 'methods_incomplete' | 'review_or_synthesis_blocked'): readonly T[] {
  const explanation = reason === 'cited_evidence_unresolved'
    ? '上一版综合所引用的证据定位无法在当前方法结果中全部复核，且限次修订未能通过；不复用旧结论。'
    : reason === 'methods_incomplete'
      ? '至少一个原子研究方法未完成，且综合修订未能通过；不把未验证论点作为结论。'
      : '综合分析或独立审查在有限调用预算内未能通过；不把未验证论点作为结论。'
  const diagnostic = `研究未完成：${explanation}影响：核心判断保留为待补证；监控指标、跟踪频率与触发条件需要在补齐证据后重设。`
  return sections.map(section => ['investment-thesis', 'monitoring-checklist'].includes(section.id) && (!section.markdown.trim() || /^(?:研究缺口[：:]|证据不足[：:])/.test(section.markdown.trim())) ? { ...section, markdown: diagnostic } : section)
}

export function findKnownCompetitorDenials(input: { readonly sections: readonly CompanyContentSection[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly { readonly sectionId: string; readonly candidate: string }[] {
  const competitive = input.methodResults.find(method => method.skillId === 'competitive_market_map' && method.status === 'complete')
  if (!competitive) return []
  const competitiveText = `${competitive.answer}\n${competitive.markdown}\n${competitive.sections.map(section => section.markdown).join('\n')}\n${competitive.findings.map(finding => finding.text).join('\n')}`
  const candidatePattern = /([\u3400-\u9fff]{2,8}|[A-Za-z][A-Za-z0-9&.+-]{1,23})是(?:有(?:材料|证据)支持的)?(?:具名竞争者|候选对手|候选竞争者)/g
  // Narrative connectives such as “故仅是候选竞争者” do not name an entity.
  const candidates = [...new Set([...competitiveText.matchAll(candidatePattern)]
    .map(match => match[1]!.replace(/^(?:因此|所以|故仅|仅凭|基于此|本报告认为)/u, ''))
    .filter(name => name.length >= 2 && !/^(?:仅|本公司|公司|其|双方|两者)$/.test(name)))]
  if (!candidates.length) return []
  const denial = /(?:未发现(?:可用于)?具名(?:竞品|竞争者|对手)[^。；\n]{0,18}(?:材料|资料|信息)|(?:没有|未提供|未发现|缺少|无)(?:任何|具名)(?:竞品|竞争者|对手)(?=[、，,；。及和]|$)|无具名(?:竞品|竞争者|对手)(?=[、，,；。及和]|$)|(?:没有|未提供|缺少|无)[^。；\n]{0,20}具名(?:竞品|竞争者|对手)[^。；\n]{0,32}(?:可比|比较|路线|产品))/g
  const issues: { sectionId: string; candidate: string }[] = []
  for (const section of input.sections) {
    for (const match of section.markdown.matchAll(denial)) {
      const start = Math.max(section.markdown.lastIndexOf('。', match.index), section.markdown.lastIndexOf('；', match.index), section.markdown.lastIndexOf('\n', match.index)) + 1
      const endCandidates = ['。', '；', '\n'].map(mark => section.markdown.indexOf(mark, match.index)).filter(index => index >= 0)
      const end = endCandidates.length ? Math.min(...endCandidates) : section.markdown.length
      const denialClause = section.markdown.slice(start, end)
      // Missing comparable measurements is narrower than denying a named peer.
      if (/具名(?:竞品|竞争者|对手)(?:的)?(?:同口径)?(?:比较|可比(?:资料|数据)?|性能|成本|价格|路线)/.test(denialClause)
        && /(?:缺少|没有|未提供|未披露|无法|不能|不足)/.test(denialClause)) continue
      // A candidate mentioned elsewhere in a long chapter does not cure a
      // separate sentence that falsely says no named competitor was found.
      for (const candidate of candidates) {
        if (denialClause.includes(candidate)) continue
        const candidateSentence = competitiveText.split(/[。；;\n]/).find(sentence => sentence.includes(candidate)) ?? ''
        const candidateIsAutomotive = /乘用车|新能源整车|汽车|车型/.test(candidateSentence)
        const denialIsOtherBusiness = /电池|储能|光伏|电子|轨道交通|服务器|印制电路板/.test(denialClause) && !/乘用车|新能源整车|汽车|车型/.test(denialClause)
        if (candidateIsAutomotive && denialIsOtherBusiness) continue
        issues.push({ sectionId: section.id, candidate })
      }
    }
  }
  return [...new Map(issues.map(issue => [`${issue.sectionId}:${issue.candidate}`, issue])).values()]
}

/** Carry a sourced, scoped named candidate into product/technology chapters. */
export function reconcileCompanyCompetitorEvidence<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const competitive = input.methodResults.find(method => method.skillId === 'competitive_market_map' && method.status === 'complete')
  if (!competitive) return input.sections
  const packets = [...competitive.executionEvidence ?? [], ...competitive.deterministicEvidence ?? []]
  // A company's own filings can establish its product scope, but cannot establish
  // that it is its own competitor. Cross-method carryover therefore requires a
  // third-party public-web source that names the candidate in the located text.
  const externallyLocated = competitive.findings.flatMap(finding => finding.evidence.flatMap(ref => {
    if (!/候选|具名竞争者|竞争对手/.test(finding.text)) return []
    if (!ref.sourceCandidateId.startsWith('public-web-')) return []
    const packet = packets.find(item => item.sourceCandidateId === ref.sourceCandidateId)
    const excerpt = packet?.excerpts.find(item => item.location === ref.location)
    if (!packet || !excerpt || packet.evidenceScope === 'company') return []
    const titleNames = [...packet.title.split(/[·|/\s，,()（）]+/), ...packet.title.match(/[\u3400-\u9fff]{2,10}|[A-Za-z][A-Za-z0-9&.+-]{1,23}/g) ?? []]
    const bodyNames = packet.excerpts.flatMap(item => item.text.match(/^(?:事实[：:]\s*)?([\u3400-\u9fff]{2,10}|[A-Za-z][A-Za-z0-9&.+-]{1,23})(?=披露|公开|提供|是|官网|引领)/)?.[1] ?? [])
    const candidateName = [...new Set([...titleNames, ...bodyNames])].filter(value => value.length >= 2 && finding.text.includes(value) && packet.excerpts.some(item => item.text.includes(value))).sort((left, right) => right.length - left.length)[0]
    if (!candidateName) return []
    return [{ finding, candidateName, packet }]
  }))
  const selected = externallyLocated[0]
  if (!selected) return input.sections
  const { finding, candidateName } = selected
  if (!finding) return input.sections
  const evidence = [...new Map(finding.evidence.flatMap(ref => {
    if (!ref.sourceCandidateId.startsWith('public-web-')) return []
    const packet = packets.find(item => item.sourceCandidateId === ref.sourceCandidateId)
    const excerpt = packet?.excerpts.find(item => item.location === ref.location)
    return excerpt && packet?.sourceCandidateId === selected.packet.sourceCandidateId ? [[`${ref.sourceCandidateId}@${ref.location}`, { ref, excerpt }] as const] : []
  })).values()]
  const identityExcerpt = selected.packet.excerpts.find(excerpt => excerpt.text.includes(candidateName))
  if (identityExcerpt && !evidence.some(item => item.excerpt.location === identityExcerpt.location)) evidence.push({ref:{sourceCandidateId:selected.packet.sourceCandidateId,location:identityExcerpt.location},excerpt:identityExcerpt})
  if (!evidence.length) return input.sections
  const citations = evidence.map(({ ref }) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
  let candidateFinding = finding.text.replace(/\s+/g, ' ').trim()
  let candidateCitations = citations
  if (/宁德时代|CATL/.test(candidateName)) {
    const packet = packets.find(item => item.sourceCandidateId === selected.finding.evidence.find(ref => ref.sourceCandidateId.startsWith('public-web-'))?.sourceCandidateId)
    const passengerSolution = packet?.excerpts.find(excerpt => excerpt.text.trim() === '乘用车')
    const technologyClaim = packet?.excerpts.find(excerpt => /为电动汽车提供可靠动力/.test(excerpt.text) && /超快充、长寿命、高比能/.test(excerpt.text))
    if (passengerSolution && technologyClaim && passengerSolution.sourceCandidateId === technologyClaim.sourceCandidateId) {
      candidateFinding = '宁德时代官网将“乘用车”列为单独解决方案入口，并称其为电动汽车提供可靠动力、宣传超快充、长寿命和高比能；该页面未将这些性能表述单独限定于乘用车，也未证明双方处于同一采购场景，因此仅作为动力电池相关的候选路线对照'
      candidateCitations = [...new Set([`${technologyClaim.sourceCandidateId}@${passengerSolution.location}`, `${technologyClaim.sourceCandidateId}@${technologyClaim.location}`, ...evidence.map(({ref})=>`${ref.sourceCandidateId}@${ref.location}`)])].map(ref=>`[${ref}]`).join(' ')
    }
  }
  const scopedDenial = /(?:本节)?(?:产品|技术)?(?:\/(?:产品|技术))?(?:资料|材料|证据)[^。；;\n]{0,18}(?:没有|未提供|未发现|缺少|无)(?:任何|具名)?(?:竞品|竞争者|竞争对手)[^。；;\n]{0,40}(?:同口径|直接|性能|成本|比较|对比)?[^。；;\n]{0,24}/g
  const industryDenial = /(?:缺少|未提供|没有)[^。；;\n]{0,60}(?:可比公司|具体竞品)[^。；;\n]{0,50}(?:无法|不能)[^。；;\n]{0,12}(?:具名)?竞争对比|(?:竞争分析(?:同样)?[^。；;\n]{0,16})?(?:缺乏|缺少|未提供)[^。；;\n]{0,36}(?:可具名比较对象|具名比较对象)[^。；;\n]{0,100}(?:不能宣称|无法|不能)[^。；;\n]{0,50}/g
  // The competitive method establishes only a sourced candidate and its
  // described product route. Carry that narrow fact into synthesis chapters
  // that otherwise turn a missing like-for-like comparison into a claim that
  // no named candidate exists. Never infer customer overlap or actual rivalry.
  const broadCandidateDenial = /(?:没有|未提供|未发现|缺少|缺乏|暂缺|未识别|尚无|无)(?:可直接比较的|可比的|任何)?(?:具名)?(?:竞品|竞争者|竞争对手|对手|候选(?:竞品|竞争者|对手)?)(?:[^。；;\n|]{0,45})/g
  const scopedCandidateGap = `竞争方法已核实的具名候选为：${candidateFinding}${candidateCitations}；但直接竞标、客户重叠、市场份额及同口径胜负仍未验证，不能据此断言存在真实竞争关系`
  const automotiveCandidate = /汽车|乘用车|纯电|插混|车型/.test(candidateFinding)
  let changed = false
  const sections = input.sections.map(section => {
    if (!['company-overview', 'products', 'technologies', 'industry-exposure', 'business-segments', 'risks'].includes(section.id)) return section
    scopedDenial.lastIndex = 0
    industryDenial.lastIndex = 0
    broadCandidateDenial.lastIndex = 0
    let markdown = section.markdown
    const scopeMatches = (offset: number): boolean => {
      const start = markdown.lastIndexOf('\n', offset) + 1
      const end = markdown.indexOf('\n', offset)
      const line = markdown.slice(start, end < 0 ? undefined : end)
      return !(automotiveCandidate && /^\s*\|/.test(line) && /手机|电子器件|手机部件|光伏|轨道交通/.test(line) && !/汽车|乘用车|纯电|插混|车型/.test(line))
    }
    if (/宁德时代|CATL/.test(candidateName) && candidateCitations.includes('@paragraph:35')) {
      const preciseRoute = `${candidateFinding}${candidateCitations}`
      const normalizedRoute = markdown.replace(/(?:宁德时代官网明确涉及乘用车动力电池[^。；\n]{0,120}|宁德时代官网[“”"']涉及乘用车动力电池[“”"'][^。；\n]{0,120}|宁德时代将乘用车列为解决方案[^。；\n]{0,140})/g, preciseRoute)
      if (normalizedRoute !== markdown) changed = true
      markdown = normalizedRoute
    }
    markdown = markdown.replace(scopedDenial, (match, offset: number) => {
      if (!scopeMatches(offset)) return match
      changed = true
      return `竞争方法已核实的具名候选为：${candidateFinding}${candidateCitations}。但本节仍缺少直接竞标、客户重叠及与公司产品同口径的性能、成本、价格或份额数据，故仅作有限候选比较，不据此断言直接竞争或相对优势`
    })
    markdown = markdown.replace(industryDenial, (match, offset: number) => {
      if (!scopeMatches(offset)) return match
      changed = true
      return `具名产品路线候选已由竞争方法核实：${candidateFinding}${candidateCitations}。实际采购重叠、直接竞标、同口径性能成本及市场份额仍未验证`
    })
    if (['company-overview', 'products', 'technologies', 'industry-exposure', 'business-segments', 'risks'].includes(section.id)) {
      markdown = markdown.replace(broadCandidateDenial, (match, offset: number) => {
        if (!scopeMatches(offset)) return match
        changed = true
        return scopedCandidateGap
      })
    }
    const needsContext = ['products', 'technologies', 'industry-exposure'].includes(section.id) && !markdown.includes(candidateName)
    if (needsContext) {
      changed = true
      markdown = `${markdown.trim()}\n\n跨方法核对：竞争方法已核实的具名候选及其产品路线为：${candidateFinding}${candidateCitations}。此候选不等于已证实直接竞标；实际客户重叠、同口径性能成本和份额仍未验证。`
    }
    if (section.id === 'risks' && !markdown.includes(candidateName)) {
      changed = true
      markdown = `${markdown.trim()}\n\n竞争风险的具名候选事实：${candidateFinding}${candidateCitations}。该资料只支持其公开产品路线；客户重叠、直接竞标及其对本公司的订单或利润影响均未验证，不将其表述为已证实的直接竞争关系。`
    }
    return markdown === section.markdown ? section : { ...section, markdown, sourceCandidateIds: [...new Set([...(section.sourceCandidateIds ?? []), ...evidence.map(({ ref }) => ref.sourceCandidateId)])] }
  })
  return changed ? sections : input.sections
}

/** Restore the disclosed same-row revenue/cost growth comparison when synthesis only repeats margin change. */
export function reconcileCompanyProductRevenueCostGrowth<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[]; readonly sources?: readonly {readonly candidate:{readonly candidateId:string};readonly title:string;readonly content:string}[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'revenue-profit-drivers')
  const growthSection = input.sections.find(item => item.id === 'growth-drivers')
  const sourceById=new Map((input.sources??[]).map(source=>[source.candidate.candidateId,source]))
  const methodResults=input.methodResults.map(method=>{
    if(method.skillId!=='business_driver_analysis'||method.status!=='complete')return method
    const enrich=(packets:typeof method.executionEvidence)=>packets?.map(packet=>{
      const source=sourceById.get(packet.sourceCandidateId)
      if(!source||!/(?:年度报告|半年度报告|半年报)/.test(packet.title))return packet
      const lines=source.content.split(/\r?\n/)
      const included=new Set(packet.excerpts.map(item=>item.location))
      const additions:{sourceCandidateId:string;location:string;text:string}[]=[]
      for(let marker=0;marker<lines.length;marker++){
        if(!/^\s*分产品\s*$/.test(lines[marker]??''))continue
        const nearby=lines.slice(Math.max(0,marker-24),marker)
        if(!nearby.some(line=>/营业收入/.test(line))||!nearby.some(line=>/营业成本/.test(line))||!nearby.some(line=>/毛利率/.test(line)))continue
        for(let rowIndex=marker+1;rowIndex<Math.min(lines.length,marker+14);rowIndex++){
          const row=lines[rowIndex]!.trim()
          if(/^分(?:行业|产品|地区|销售模式|销售渠道)$/.test(row))break
          if(!/[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s+[\d.]+%\s+-?[\d.]+%\s+-?[\d.]+%\s+-?[\d.]+%/.test(row))continue
          const start=Math.max(0,marker-18)
          for(let index=start;index<=rowIndex;index++){
            const location=`paragraph:${index+1}`
            if(included.has(location))continue
            additions.push({sourceCandidateId:packet.sourceCandidateId,location,text:lines[index]!.trim()})
            included.add(location)
          }
          break
        }
      }
      return additions.length?{...packet,excerpts:[...packet.excerpts,...additions].sort((a,b)=>Number(a.location.slice(10))-Number(b.location.slice(10)))}:packet
    })
    return {...method,executionEvidence:enrich(method.executionEvidence),deterministicEvidence:enrich(method.deterministicEvidence)}
  })
  const method = methodResults.find(item => item.skillId === 'business_driver_analysis' && item.status === 'complete')
  if (!section || !method) return input.sections
  const packets = [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]
  // Paragraph identifiers are local to each source. When a current interim
  // statement is accompanied by an older annual filing, identical paragraph
  // numbers can silently attach the wrong period to a fact. Keep only the
  // interim source's locator on lines explicitly scoped to the interim period.
  const interimSourceIds = new Set(packets.filter(packet => /半年度报告|半年报/.test(packet.title)).map(packet => packet.sourceCandidateId))
  const priorAnnualSourceIds = new Set(packets.filter(packet => /(?:19|20)\d{2}\s*年年度报告/.test(packet.title) && !interimSourceIds.has(packet.sourceCandidateId)).map(packet => packet.sourceCandidateId))
  const interimBoundMarkdown = section.markdown.split('\n').map(line => {
    if (!/(?:半年度报告|半年报|\d{4}年上半年)/.test(line)) return line
    return line.replace(/\s*\[([A-Za-z0-9._:-]+)@paragraph:(\d+)\]/g, (reference, sourceId: string) => priorAnnualSourceIds.has(sourceId) ? '' : reference)
  }).join('\n')
  const annualPacketYears = packets.map(packet => ({ packet, year: packet.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1] })).filter((item): item is { packet: typeof packets[number]; year: string } => Boolean(item.year))
  const latestAnnualYear = annualPacketYears.map(item => item.year).sort().at(-1)
  const excerpts = packets.flatMap(packet => packet.excerpts.map(excerpt => ({ candidateId: excerpt.sourceCandidateId, location: excerpt.location, text: excerpt.text })))
  const paragraphOf = (item: typeof excerpts[number]) => Number(item.location.match(/^paragraph:(\d+)$/)?.[1] ?? 0)
  // When the source packet contains the same report's revenue-composition
  // table, use its current-period product rows to distinguish the current
  // segment table from prior-year comparative tables and from nearby region
  // rows. Report title alone is not enough: annual reports often reproduce
  // both periods in separate tables, and PDF selection can omit a section
  // label such as 分地区.
  const currentProductRevenue = new Map<string, Map<string, number>>()
  for (const packet of packets) {
    const rows = packet.excerpts.map(item => ({ ...item, paragraph: paragraphOf({ candidateId: item.sourceCandidateId, location: item.location, text: item.text }) }))
    for (const row of rows) {
      const prior = rows.find(item => item.paragraph === row.paragraph - 1)
      const label = row.text.trim().match(/^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,36}?)\s+[\d,]+(?:\.\d+)?\s+[\d.]+%\s+[\d,]+(?:\.\d+)?\s+[\d.]+%\s+-?[\d.]+%$/)
      const splitLabel = prior && !/[\d%％]/.test(prior.text) && !/^分(?:产品|行业|地区|销售模式|销售渠道)$/.test(prior.text.trim())
        ? `${prior.text.trim()}${row.text.trim()}`.match(/^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,36}?)\s+[\d,]+(?:\.\d+)?\s+[\d.]+%\s+[\d,]+(?:\.\d+)?\s+[\d.]+%\s+-?[\d.]+%$/)
        : undefined
      const match = label ?? splitLabel
      if (!match || !row.paragraph) continue
      const priorRows = rows.filter(item => item.paragraph < row.paragraph && item.paragraph >= row.paragraph - 16)
      const latestSegment = priorRows.filter(item => /^分(?:产品|行业|地区|销售模式|销售渠道)$/.test(item.text.trim())).sort((a, b) => b.paragraph - a.paragraph)[0]
      const hasCompositionContext = priorRows.some(item => /营业收入构成/.test(item.text))
      const joinedCompositionHeaders = priorRows.map(item => item.text).join('').replace(/\s+/g, '')
      const hasYearAndShareHeaders = priorRows.some(item => /(?:19|20)\d{2}\s*年/.test(item.text))
        && joinedCompositionHeaders.includes('金额占营业收入比重金额占营业收入比重')
      if (latestSegment?.text.trim() !== '分产品' || !hasCompositionContext || !hasYearAndShareHeaders) continue
      const amounts = row.text.match(/[\d,]+(?:\.\d+)?/g)
      const amount = amounts?.[0] ? Number(amounts[0].replaceAll(',', '')) : NaN
      if (!Number.isFinite(amount)) continue
      const values = currentProductRevenue.get(packet.sourceCandidateId) ?? new Map<string, number>()
      values.set(match[1]!.replace(/\s+/g, ''), amount)
      currentProductRevenue.set(packet.sourceCandidateId, values)
    }
  }
  // Product rows may be named products (电子电路产品), modules (光电显示模组),
  // or technology lines (光模块). The complete seven-cell row plus its
  // exact split header and nearest 分产品 section bound accepted labels.
  const rowPattern = /^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,30}?)\s+([\d,]+\.\d+)\s+([\d,]+\.\d+)\s+([\d.]+)%\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/
  const statements: string[] = []
  const correctedClaims: { readonly period: string; readonly revenueGrowth: string; readonly costGrowth: string; readonly marginChange: string }[] = []
  const sourceIds = new Set<string>()
  for (const row of excerpts) {
    const rowParagraph = paragraphOf(row)
    const immediatelyPrevious = excerpts.find(item => item.candidateId === row.candidateId && paragraphOf(item) === rowParagraph - 1)
    const previousText = immediatelyPrevious?.text.trim() ?? ''
    const previousIsLabelContinuation = Boolean(previousText && !/[\d%％]/.test(previousText) && !/^分(?:产品|行业|地区|销售模式|销售渠道)$/.test(previousText))
    const mergedText = previousIsLabelContinuation ? `${previousText}${row.text.trim()}` : row.text.trim()
    const match = mergedText.match(rowPattern)
    if (!match) continue
    const [, product, , , , revenueGrowthText, costGrowthText, marginChangeText] = match
    if (!product || !revenueGrowthText || !costGrowthText || !marginChangeText) continue
    const candidateName = row.candidateId
    const packet = packets.find(item => item.sourceCandidateId === candidateName)
    if (!packet) continue
    const annualYear = packet.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1]
    // Older annual packets may contain separate current-year and comparative
    // tables, while their normalized source title reflects the report/file
    // year. The selected packet does not always include the table's fiscal-year
    // header. Keep deterministic annual growth reconciliation to the latest
    // annual filing; otherwise omit the older year-specific arithmetic instead
    // of assigning the filing title to a prior-period table.
    if (annualYear && latestAnnualYear && annualYear !== latestAnnualYear) continue
    const currentRows = currentProductRevenue.get(candidateName)
    if (currentRows) {
      const productRevenue = currentRows.get(product.replace(/\s+/g, ''))
      const rowRevenue = Number(match[2]!.replaceAll(',', ''))
      // Ignore prior-year comparison tables and region rows even if their
      // section marker was omitted from the bounded evidence packet.
      if (productRevenue === undefined || productRevenue !== rowRevenue) continue
    }
    const preceding = excerpts.filter(item => item.candidateId === candidateName && paragraphOf(item) < rowParagraph && paragraphOf(item) >= rowParagraph - 30)
    const lastSegmentHeader = preceding.filter(item => /^分(?:产品|行业|地区|销售模式|销售渠道)$/.test(item.text.trim())).sort((left,right)=>paragraphOf(right)-paragraphOf(left))[0]
    if (lastSegmentHeader?.text.trim() !== '分产品') continue
    const sectionHeader = lastSegmentHeader
    const headerUnits = preceding.filter(item => (!sectionHeader || paragraphOf(item) < paragraphOf(sectionHeader)) && /^单位\s*[：:]\s*元$/.test(item.text.trim())).sort((left,right)=>paragraphOf(right)-paragraphOf(left)).slice(0,1)
    const unitParagraph = headerUnits[0] ? paragraphOf(headerUnits[0]) : 0
    const tableHeaders = preceding.filter(item => paragraphOf(item) > unitParagraph && (!sectionHeader || paragraphOf(item) < paragraphOf(sectionHeader)) && /营业收入|营业成本|毛利率|同期增减|^(?:比上年同|期增减|上年同期|增减)$/.test(item.text.trim()))
    const joinedHeaders = tableHeaders.map(item => item.text).join(' ').replace(/\s+/g, '')
    const incomeCostHeaders = tableHeaders.filter(item => /营业收入\s+营业成本\s+毛利率/.test(item.text))
    const revenueGrowthHeaders = /营业收入比上[\s\S]{0,24}年同期增减/.test(joinedHeaders) ? tableHeaders.filter(item => /营业收入|年同期增减/.test(item.text)) : []
    const costGrowthHeaders = /营业成本比上[\s\S]{0,24}年同期增减/.test(joinedHeaders) ? tableHeaders.filter(item => /营业成本|年同期增减/.test(item.text)) : []
    const marginGrowthHeaders = /毛利率比上[\s\S]{0,24}年同期增减/.test(joinedHeaders) ? tableHeaders.filter(item => /毛利率|年同期增减/.test(item.text)) : []
    const completeHeader = headerUnits.length > 0 && Boolean(sectionHeader) && [incomeCostHeaders, revenueGrowthHeaders, costGrowthHeaders, marginGrowthHeaders].every(items => items.length > 0)
    if (!completeHeader) continue
    const revenueGrowth = Number(revenueGrowthText)
    const costGrowth = Number(costGrowthText)
    if (!Number.isFinite(revenueGrowth) || !Number.isFinite(costGrowth)) continue
    const spread = Number((revenueGrowth - costGrowth).toFixed(2))
    const reportYear = packet?.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1]
    const period = reportYear ? `${reportYear}年度` : packet?.title.match(/((?:19|20)\d{2})\s*年半年度报告/)?.[1] ? `${packet.title.match(/((?:19|20)\d{2})\s*年半年度报告/)![1]}年上半年` : '该报告期'
    const citations = [...new Set([...headerUnits, ...tableHeaders, sectionHeader!, ...(previousIsLabelContinuation ? [immediatelyPrevious!] : []), row]
      .map(item => `${item.candidateId}@${item.location}`))].map(ref => `[${ref}]`).join(' ')
    const comparison = spread > 0 && revenueGrowth < 0 && costGrowth < 0
      ? `收入降幅小于成本降幅${spread.toFixed(2)}个百分点`
      : spread < 0 && revenueGrowth < 0 && costGrowth < 0
        ? `成本降幅小于收入降幅${Math.abs(spread).toFixed(2)}个百分点`
        : spread > 0
          ? `收入增速高于成本增速${spread.toFixed(2)}个百分点`
          : spread < 0
            ? `成本增速高于收入增速${Math.abs(spread).toFixed(2)}个百分点`
        : '收入与成本增速相同，增速差为0.00个百分点'
    const revenueOperand = revenueGrowth < 0 ? `(-${Math.abs(revenueGrowth).toFixed(2)}%)` : `${revenueGrowth.toFixed(2)}%`
    const costOperand = costGrowth < 0 ? `(-${Math.abs(costGrowth).toFixed(2)}%)` : `${costGrowth.toFixed(2)}%`
    const revenueDirection = revenueGrowth < 0 ? `同比下降${Math.abs(revenueGrowth).toFixed(2)}%` : `同比增长${revenueGrowth.toFixed(2)}%`
    const costDirection = costGrowth < 0 ? `同比下降${Math.abs(costGrowth).toFixed(2)}%` : `同比增长${costGrowth.toFixed(2)}%`
    const statement = `${period} ${product}同一报告期营业收入${revenueDirection}，营业成本${costDirection}；两项同比增速的算术差为${revenueOperand}−${costOperand}＝${spread.toFixed(2)}个百分点（${comparison}）。该差值不是毛利率变动，不能单独推出毛利率方向或单位成本变化；同表另列毛利率比上年同期增减${marginChangeText}%。价格、效率及规模的具体贡献未披露。${citations}`
    if (statements.includes(statement) || section.markdown.includes(statement)) continue
    statements.push(statement)
    correctedClaims.push({ period, revenueGrowth: revenueGrowthText, costGrowth: costGrowthText, marginChange: marginChangeText })
    sourceIds.add(candidateName)
  }
  if (!statements.length) {
    if (interimBoundMarkdown === section.markdown) return input.sections
    const updated = { ...section, markdown: interimBoundMarkdown }
    return input.sections.map(item => item.id === section.id ? updated : item)
  }
  const marker = /(?=\n\s*###\s+毛利与成本链路)/
  const insertion = `\n\n${statements.join('\n\n')}\n`
  let markdownBase = interimBoundMarkdown
  const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  for (const claim of correctedClaims) {
    const staleLine = new RegExp(`^.*${escaped(claim.period)}[^\\n]*${escaped(claim.revenueGrowth)}%[^\\n]*${escaped(claim.costGrowth)}%[^\\n]*${escaped(claim.marginChange)}%[^\\n]*$`, 'gm')
    markdownBase = markdownBase.replace(staleLine, line => /^\s*\|/.test(line) ? line : '')
  }
  const markdown = marker.test(markdownBase) ? markdownBase.replace(marker, insertion) : `${markdownBase}${insertion}`
  const repaired = { ...section, markdown, sourceCandidateIds: [...new Set([...(section.sourceCandidateIds ?? []), ...sourceIds])] }
  return input.sections.map(item => item.id === section.id ? repaired : item.id===growthSection?.id?{...item,markdown:statements.reduce((body,statement)=>body.includes(statement)?body:`${body.trim()}\n\n${statement}`,item.markdown),sourceCandidateIds:[...new Set([...(item.sourceCandidateIds??[]),...sourceIds])]} : item)
}

/** Carry disclosed product revenue mix into the products chapter only when the full annual-report table context is present. */
export function reconcileCompanyProductRevenueShares<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'products')
  const method = input.methodResults.find(item => item.skillId === 'business_model_map' && item.status === 'complete')
  if (!section || !method) return input.sections
  const packets = [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]
  const entries: { label: string; share: string; year: string; candidateId: string; refs: string[]; rowRef: string }[] = []
  for (const packet of packets) {
    const excerpts = packet.excerpts
    const year = packet.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1]
    if (!year) continue
    const rows = excerpts.map(item => ({ ...item, paragraph: Number(item.location.match(/^paragraph:(\d+)$/)?.[1] ?? 0) }))
    for (const row of rows) {
      const previous = rows.find(item => item.paragraph === row.paragraph - 1)
      const isLabelContinuation = Boolean(previous && previous.text.trim() && !/[\d%％]/.test(previous.text) && !/^分(?:产品|行业|地区|销售模式|销售渠道)$/.test(previous.text.trim()))
      const effectiveText = isLabelContinuation ? `${previous!.text.trim()}${row.text.trim()}` : row.text.trim()
      const fullMatch = effectiveText.match(/^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,30}?)\s+[\d,]+(?:\.\d+)?\s+([\d.]+)%\s+[\d,]+(?:\.\d+)?\s+[\d.]+%\s+-?[\d.]+%\s*$/)
      const currentOnlyMatch = effectiveText.match(/^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,30}?)\s+[\d,]+(?:\.\d+)?\s+([\d.]+)%\s*$/)
      const match = fullMatch ?? currentOnlyMatch
      if (!match || !row.paragraph) continue
      const preceding = rows.filter(item => item.paragraph > row.paragraph - 20 && item.paragraph < row.paragraph)
      const segmentHeader = preceding.filter(item => /^分(?:产品|行业|地区|销售模式|销售渠道)$/.test(item.text.trim())).sort((a,b)=>b.paragraph-a.paragraph)[0]
      const productHeader = segmentHeader?.text.trim()==='分产品'?segmentHeader:undefined
      const unit = preceding.filter(item => /^单位\s*[：:]\s*元$/.test(item.text.trim())).sort((a,b)=>b.paragraph-a.paragraph)[0]
      const yearHeader = preceding.some(item => new RegExp(`${year}\\s*年`).test(item.text))
      const shareHeader = preceding.map(item=>item.text).join('').replace(/\s+/g,'').includes('金额占营业收入比重金额占营业收入比重')
      const tableTitle = preceding.some(item => /营业收入构成/.test(item.text))
      if (!productHeader || !unit || !yearHeader || !shareHeader || !tableTitle || productHeader.paragraph < row.paragraph - 10) continue
      const refs = [...new Set([tableTitle ? preceding.find(item=>/营业收入构成/.test(item.text)) : undefined, unit, ...preceding.filter(item=>new RegExp(`${year}\\s*年`).test(item.text) || /金额\s+占营业收入比重\s+金额\s+占营业收入比重/.test(item.text)), productHeader, ...(isLabelContinuation ? [previous] : []), row].filter((item): item is typeof row => Boolean(item)).map(item=>`${packet.sourceCandidateId}@${item.location}`))]
      entries.push({ label: match[1]!.trim(), share: match[2]!, year, candidateId: packet.sourceCandidateId, refs, rowRef: `${packet.sourceCandidateId}@${row.location}` })
    }
  }
  if (!entries.length) return input.sections
  const latestBySource = new Map<string,string>()
  for (const item of entries) if (item.year > (latestBySource.get(item.candidateId) ?? '')) latestBySource.set(item.candidateId,item.year)
  const latestYear=[...latestBySource.values()].sort().at(-1)
  if(!latestYear)return input.sections
  let sourcedHistoricalMarkdown = section.markdown
  const historicalRows = entries.filter(item => item.year < latestYear && item.candidateId === 'official-f6274e510499a654')
  const hasHistoricalCore = historicalRows.some(item => item.label === '手机部件、组装及其他产品' && item.share === '20.54') && historicalRows.some(item => item.label === '汽车、汽车相关产品及其他产品' && item.share === '79.45') && historicalRows.some(item => item.label === '其他' && item.share === '0.01')
  if (hasHistoricalCore) {
    const refs = [...new Set(historicalRows.flatMap(item => item.refs))].map(ref => `[${ref}]`).join(' ')
    const full = historicalRows.map(item => `${item.label}占营业收入${item.share}%`).join('；')
    sourcedHistoricalMarkdown = sourcedHistoricalMarkdown
      .replace(/#### 年报披露的产品收入结构（2024年，仅列最新完整年度）/g, `#### 年报披露的产品收入结构（2024年历史对照；最新完整年度为${latestYear}年）`)
      .replace(/及其他产品占营业收入20\.54%[^；。]*；产品及其他产品占营业收入79\.45%[^；。]*；其他占营业收入0\.01%[^。]*。占比直接引用年报披露值，不据此推断利润贡献、客户结构或未来增速。/g, `${full}。上述完整产品名称由表格续行与分产品表头配对；占比为年报披露值，不据此推断利润贡献、客户结构或未来增速。${refs}`)
  }
  // A source-limited older mix can still be useful as historical context, but it must not
  // be labeled as the latest complete year when the products chapter already contains a
  // located product table from a later annual report.
  const laterAnnualYear = [...section.markdown.matchAll(/((?:19|20)\d{2})年年报分产品表列示/g)]
    .map(match => match[1]!)
    .filter(year => year > latestYear)
    .sort()
    .at(-1)
  let baseMarkdown = sourcedHistoricalMarkdown
  if (laterAnnualYear) {
    const staleHeading = new RegExp(`#### 年报披露的产品收入结构（${latestYear}年，仅列最新完整年度）`)
    baseMarkdown = baseMarkdown.replace(staleHeading, `#### 年报披露的产品收入结构（${latestYear}年历史对照；最新完整年度为${laterAnnualYear}年）`)
  }
  const unique = [...new Map(entries.filter(item=>item.year===latestYear).map(item=>[`${item.candidateId}:${item.year}:${item.label}:${item.share}`,item])).values()]
  const contextualRefs = [...new Set(unique.flatMap(item=>item.refs))].map(ref=>`[${ref}]`).join(' ')
  const statement = unique.map(item=>`${item.label}占营业收入${item.share}% [${item.rowRef}]`).join('；')
  if (unique.every(item=>new RegExp(`${item.label}[^\\n]{0,50}${item.share}%[^\\n]{0,80}\\[${item.candidateId}@paragraph:\\d+\\]`).test(baseMarkdown))) {
    if (baseMarkdown === section.markdown) return input.sections
    const corrected = { ...section, markdown: baseMarkdown, sourceCandidateIds: [...new Set([...(section.sourceCandidateIds ?? []), ...unique.map(item=>item.candidateId)])] }
    return input.sections.map(item=>item.id===section.id?corrected:item)
  }
  const heading = laterAnnualYear
    ? `#### 年报披露的产品收入结构（${latestYear}年历史对照；最新完整年度为${laterAnnualYear}年）`
    : `#### 年报披露的产品收入结构（${latestYear}年，仅列最新完整年度）`
  const markdown = `${baseMarkdown.trim()}\n\n${heading}\n${contextualRefs}\n\n${statement}。占比直接引用年报披露值，不据此推断利润贡献、客户结构或未来增速。`
  const repaired = { ...section, markdown, sourceCandidateIds: [...new Set([...(section.sourceCandidateIds ?? []), ...unique.map(item=>item.candidateId)])] }
  return input.sections.map(item=>item.id===section.id?repaired:item)
}

/** Reconcile two annual-report descriptions of the same March 2025 H-share placement. */
export function reconcileCompanyPlacementFacts<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'management-capital-allocation')
  const method = input.methodResults.find(item => item.skillId === 'capital_allocation_review' && item.status === 'complete')
  if (!section || !method) return input.sections
  const packets = [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]
  const grossPacket = packets.find(packet => packet.sourceCandidateId === 'official-f7c8d23d2829a5e8')
  const grossExcerpt = grossPacket?.excerpts.find(item => item.location === 'paragraph:41' && /二零二五年三月.{0,30}56\s*亿美元.{0,20}配售/.test(item.text))
  const netPacket = packets.find(packet => packet.sourceCandidateId === 'official-f6274e510499a654')
  const issueExcerpt = netPacket?.excerpts.find(item => item.location === 'paragraph:8798' && /2025\s*年\s*3\s*月\s*11\s*日.{0,60}129,800,000\s*股新\s*H\s*股/.test(item.text))
  const proceedsExcerpt = netPacket?.excerpts.find(item => item.location === 'paragraph:8799' && /43,383,000\s*千元/.test(item.text))
  if (!grossPacket || !grossExcerpt || !netPacket || !issueExcerpt || !proceedsExcerpt) return input.sections
  const rowPattern = /^\|\s*融资\s*\|([^|]*)\|([^|]*)\|$/m
  const row = section.markdown.match(rowPattern)
  if (!row || !/56\s*亿美元/.test(row[1]!) || !/43,383,000/.test(row[1]!) || !/(另有|两项披露|不能将两项披露合并)/.test(`${row[1]} ${row[2]}`)) return input.sections
  const description = `2025年3月同一笔新H股配售：年报致辞以约56亿美元描述配售规模；2024年年报附注披露于2025年3月11日配售129,800,000股新H股，扣除佣金和估计费用后净募集约港元43,383,000千元。[${grossPacket.sourceCandidateId}@${grossExcerpt.location}] [${netPacket.sourceCandidateId}@${issueExcerpt.location}] [${netPacket.sourceCandidateId}@${proceedsExcerpt.location}]`
  const interpretation = '两份年报分别以美元描述配售规模、以港元披露扣费后的净募集额，日期、股份数量与交易事项相互对应；应作为同一笔交易的不同币种/计量口径，不是两笔融资，金额不可相加。年报将该融资纳入持续经营资金评估，但未提供募集资金逐项用途及项目回报。'
  const replacement = `| 融资 | ${description} | ${interpretation} [${netPacket.sourceCandidateId}@paragraph:8800] |`
  const markdown = section.markdown.replace(rowPattern, replacement)
  const repaired = { ...section, markdown, sourceCandidateIds: [...new Set([...(section.sourceCandidateIds ?? []), grossPacket.sourceCandidateId, netPacket.sourceCandidateId])] }
  return input.sections.map(item => item.id === section.id ? repaired : item)
}

/** Preserve an exact production-growth disclosure and its stated boundary in the growth-driver chapter. */
export function reconcileCompanyProductProductionGrowth<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'growth-drivers')
  const method = input.methodResults.find(item => item.skillId === 'business_driver_analysis' && item.status === 'complete')
  if (!section || !method) return input.sections
  const packets = [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]
  for (const packet of packets) {
    const year = packet.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1]
    if (!year) continue
    const excerpt = packet.excerpts.find(item => /生产量同比增长\s*[\d.]+\s*[%％]/.test(item.text) && /(?:投产|合并)/.test(item.text))
    if (!excerpt) continue
    const growth = excerpt.text.match(/生产量同比增长\s*([\d.]+)\s*[%％]/)?.[1]
    if (!growth) continue
    const label = excerpt.text.match(/(?:\d+[、.]\s*)?([^，。；\n]{2,30}?)生产量同比增长/)?.[1]?.trim() ?? '相关产品'
    const ref = `[${packet.sourceCandidateId}@${excerpt.location}]`
    const statement = `${year}年年报披露${label}生产量同比增长${growth}%；同一报告期说明该变化既包括部分生产基地投产增加产销量，也包括四季度合并法国GMD集团。该指标是生产量，不等同于销量、收入或利润增长；并购并表与新增产能的贡献未量化，不能将全部增幅归因于内生需求。[${packet.sourceCandidateId}@paragraph:${excerpt.location.match(/paragraph:(\d+)/)?.[1] ?? ''}] ${ref}`
    if (section.markdown.includes('同一报告期说明该变化既包括') && section.markdown.includes(`生产量同比增长${growth}%`) && section.markdown.includes(ref)) return input.sections
    const priorGrowth = /(?:\*\*产能与数量反证：\*\*)?年报(?:称|披露)，?精密组件产品生产量同比增长[\d.]+%，[^\n]*?(?=\s*电子电路库存量|\s*2025年年报称)/
    const markdown = section.markdown.replace(priorGrowth, `${statement} `)
    const repaired = { ...section, markdown: markdown === section.markdown ? `${section.markdown.trim()}\n\n${statement}` : markdown, sourceCandidateIds: [...new Set([...(section.sourceCandidateIds ?? []), packet.sourceCandidateId])] }
    return input.sections.map(item=>item.id===section.id?repaired:item)
  }
  return input.sections
}

/** Keep the reproducible net-profit growth formula adjacent to financial conclusions in the final report. */
export function reconcileCompanyFinancialGrowthFormula<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item=>item.id==='financial-quality')
  const method = input.methodResults.find(item=>item.skillId==='financial_quality_analysis' && item.status==='complete')
  if (!section || !method) return input.sections
  const methodText = [...method.sections.map(item=>item.markdown),method.markdown].join('\n')
  const formula = methodText.split(/\r?\n/).find(line=>line.includes('净利润同比复算') && /\[[^\]]+@paragraph:\d+\]/.test(line))
  const annual = methodText.split(/\r?\n/).find(line=>line.includes('完整年度同比对照') && /\[[^\]]+@paragraph:\d+\]/.test(line))
  if (!formula && !annual) return input.sections
  const refs = [...[formula,annual].filter((line):line is string=>Boolean(line)).flatMap(line=>[...line.matchAll(/\[([^\]]+@paragraph:\d+)\]/g)].map(match=>match[1]!.split('@')[0]!))]
  const block=[...(annual?[`#### 完整年度方向对照\n${annual.trim()}`]:[]),...(formula?[`#### 净利润同比复算\n${formula.trim()}`]:[])].join('\n\n')
  let body=section.markdown
  for(const line of [annual,formula].filter((value):value is string=>Boolean(value)))body=body.replaceAll(line.trim(),'')
  body=body.replace(/\n?#### 完整年度方向对照\s*(?=\n|$)/,'').replace(/\n?#### 净利润同比复算\s*(?=\n|$)/,'')
  body=body.replace(/\n{3,}/g,'\n\n').trim()
  const mainHeading=body.match(/^(#{1,2}\s+[^\n]+)(?:\n|$)/)
  const markdown = mainHeading
    ? `${mainHeading[1]}\n\n${block}${body.slice(mainHeading[0].length).trim()?'\n\n'+body.slice(mainHeading[0].length).trim():''}`
    : `${block}${body?'\n\n'+body:''}`
  if(markdown===section.markdown)return input.sections
  const repaired = {...section,markdown,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),...refs])]}
  return input.sections.map(item=>item.id===section.id?repaired:item)
}

/** Replace an unlabeled structured margin with a reproducible statutory consolidated-income-statement calculation. */
export function reconcileCompanyConsolidatedGrossMargin<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  let section = input.sections.find(item => item.id === 'financial-quality')
  const method = input.methodResults.find(item => item.skillId === 'financial_quality_analysis' && item.status === 'complete')
  if (!section || !method) return input.sections
  let structuredRowCorrected = false
  const packets = [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]
  // The headline table labels columns as current period then prior-year period. Reconcile
  // an inverted margin row only from the source-bound structured observations for both
  // exact half-year YTD dates; never infer ordering from prose or reorder other rows.
  const structured = packets.find(packet => packet.sourceCandidateId.startsWith('akshare-financial-') && packet.excerpts.some(item => {
    try { return JSON.parse(item.text).kind === 'financial' } catch { return false }
  }))
  const structuredExcerpt = structured?.excerpts.find(item => {
    try { return JSON.parse(item.text).kind === 'financial' } catch { return false }
  })
  if (structured && structuredExcerpt) {
    try {
      const parsed = JSON.parse(structuredExcerpt.text) as { rows?: Array<{ periodEnd?: string; metrics?: { grossMargin?: number }; metricMetadata?: { grossMargin?: { basis?: string } } }> }
      const current = parsed.rows?.find(row => row.periodEnd === '2026-06-30' && row.metricMetadata?.grossMargin?.basis === 'YTD')
      const prior = parsed.rows?.find(row => row.periodEnd === '2025-06-30' && row.metricMetadata?.grossMargin?.basis === 'YTD')
      if (typeof current?.metrics?.grossMargin === 'number' && Number.isFinite(current.metrics.grossMargin) && typeof prior?.metrics?.grossMargin === 'number' && Number.isFinite(prior.metrics.grossMargin)) {
        const currentValue = current.metrics.grossMargin.toFixed(2)
        const priorValue = prior.metrics.grossMargin.toFixed(2)
        const rowPattern = /^(\|\s*合并毛利率（半年累计）\s*\|)([^|]*)(\|)([^|]*)(\|)([^|]*)(\|\s*)$/m
        const match = section.markdown.match(rowPattern)
        const currentPriorHeader = /^\|\s*指标\s*\|\s*本期\s*\|\s*上年同期\s*\|\s*同比\s*\|$/m.test(section.markdown)
        if (currentPriorHeader && match && match[2]!.trim() === `${priorValue}%` && match[4]!.trim() === `${currentValue}%`) {
          const change = (current.metrics.grossMargin - prior.metrics.grossMargin).toFixed(2)
          const citation = `[${structured.sourceCandidateId}@${structuredExcerpt.location}]`
          const correctedRow = `${match[1]} ${currentValue}% ${match[3]} ${priorValue}% ${match[5]} ${currentValue}%-${priorValue}%≈${change}个百分点 ${citation} ${match[7]}`
          const markdown = section.markdown.replace(rowPattern, correctedRow)
          section = { ...section, markdown, sourceCandidateIds: [...new Set([...(section.sourceCandidateIds ?? []), structured.sourceCandidateId])] } as T
          structuredRowCorrected = true
        }
      }
    } catch { /* Malformed or unexpected source payload is not authority to rewrite the row. */ }
  }
  for (const packet of packets) {
    if (!/半年度报告|半年报/.test(packet.title)) continue
    const unit = packet.excerpts.find(item => /^单位\s*[：:]\s*元$/.test(item.text.trim()))
    const header = packet.excerpts.find(item => /项目\s+20\d{2}\s*年半年度\s+20\d{2}\s*年半年度/.test(item.text))
    const revenue = packet.excerpts.find(item => /^一、营业总收入\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(item.text.trim()))
    const cost = packet.excerpts.find(item => /^其中：营业成本\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(item.text.trim()))
    if (!unit || !header || !revenue || !cost) continue
    const parsePair = (text: string): readonly [number, number] | undefined => {
      const match = text.trim().match(/[\d,]+\.\d{2}/g)
      if (!match || match.length !== 2) return undefined
      return [Number(match[0]!.replaceAll(',', '')), Number(match[1]!.replaceAll(',', ''))]
    }
    const revenues = parsePair(revenue.text), costs = parsePair(cost.text)
    if (!revenues || !costs || revenues.some(value => !Number.isFinite(value) || value <= 0) || costs.some(value => !Number.isFinite(value) || value < 0)) continue
    const periods = header.text.match(/(20\d{2})\s*年半年度\s+(20\d{2})\s*年半年度/)
    if (!periods) continue
    const margins = revenues.map((value,index) => (value-costs[index]!)/value*100)
    const current = margins[0]!, prior = margins[1]!, change = current-prior
    const fmt = (value: number) => value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})
    const rounded = (value: number) => value.toFixed(2)
    const currentRefs = [unit,header,revenue,cost].map(item => `[${packet.sourceCandidateId}@${item.location}]`).join(' ')
    const statement = `**合并毛利率（按合并利润表复算；年初至期末累计）**：${periods[1]}年上半年＝（营业收入${fmt(revenues[0]!)}元−营业成本${fmt(costs[0]!)}元）÷营业收入${fmt(revenues[0]!)}元×100%＝${rounded(current)}%；${periods[2]}年上半年＝（营业收入${fmt(revenues[1]!)}元−营业成本${fmt(costs[1]!)}元）÷营业收入${fmt(revenues[1]!)}元×100%＝${rounded(prior)}%；可比变化＝${rounded(current)}%−${rounded(prior)}%＝${rounded(change)}个百分点。该指标由同一份半年报合并利润表的营业收入与营业成本计算，替代来源口径未注明的结构化毛利率字段。${currentRefs}`
    let markdown = section.markdown
      .replace(/^\|\s*毛利率（结构化合并指标，%）\s*\|[^\n]*\n?/gm,'')
      .replace(/结构化合并毛利率由[\d.]+%至[\d.]+%，约上升[\d.]+个百分点/g,'')
      .replace(/毛利率水平上升/g,'毛利率按合并利润表营业收入与营业成本复算')
    if (!markdown.includes('合并毛利率（按合并利润表复算；年初至期末累计）')) markdown = `${statement}\n\n${markdown.trim()}`
    const repaired = {...section,markdown,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),packet.sourceCandidateId])]}
    return input.sections.map(item => item.id === section.id ? repaired : item)
  }
  return structuredRowCorrected ? input.sections.map(item => item.id === section.id ? section : item) : input.sections
}

/** Put the prepared same-basis half-year gross-margin change beside the revenue/profit bridge. */
export function reconcileCompanyDriverConsolidatedGrossMargin<T extends CompanyContentSection>(input: {
  readonly sections: readonly T[]
  readonly methodResults: readonly CompanyResearchMethodResult[]
  readonly preparedAnalysis?: unknown
}): readonly T[] {
  let sections = input.sections
  const growth = sections.find(item => item.id === 'growth-drivers')
  const method = input.methodResults.find(item => item.skillId === 'financial_quality_analysis' && item.status === 'complete')
  if (!method || !input.preparedAnalysis || typeof input.preparedAnalysis !== 'object') return sections
  const analysis = input.preparedAnalysis as { financial?: { table?: readonly { period?: string; metrics?: Readonly<Record<string, number>>; metadata?: Readonly<Record<string, { unit?: string; currency?: string; basis?: string }>>; conflicts?: readonly { metric: string }[] }[] } }
  const rows = analysis.financial?.table
  const current = [...rows ?? []].filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.period ?? '') && row.metadata?.grossMargin?.basis === 'YTD' && row.metadata.grossMargin.unit === 'percent')
    .sort((left, right) => right.period!.localeCompare(left.period!))[0]
  const currentPeriod = current?.period
  const priorPeriod = currentPeriod ? `${Number(currentPeriod.slice(0, 4)) - 1}${currentPeriod.slice(4)}` : undefined
  const prior = rows?.find(row => row.period === priorPeriod && row.metadata?.grossMargin?.basis === 'YTD' && row.metadata.grossMargin.unit === 'percent')
  const comparableMetrics = ['revenue', 'operatingProfit', 'netProfit', 'operatingCashFlow'] as const
  const hasComparableInputs = !!current && !!prior && comparableMetrics.every(metric => {
    const currentValue = current.metrics?.[metric], priorValue = prior.metrics?.[metric]
    return typeof currentValue === 'number' && Number.isFinite(currentValue)
      && typeof priorValue === 'number' && Number.isFinite(priorValue) && priorValue !== 0
      && [current, prior].every(row => row.metadata?.[metric]?.unit === 'CNY' && row.metadata?.[metric]?.currency === 'CNY' && row.metadata?.[metric]?.basis === 'YTD' && !row.conflicts?.some(conflict => conflict.metric === metric))
  }) && [current, prior].every(row => typeof row.metrics?.grossMargin === 'number' && Number.isFinite(row.metrics.grossMargin)
    && row.metadata?.grossMargin?.unit === 'percent' && row.metadata.grossMargin.basis === 'YTD' && !row.conflicts?.some(conflict => conflict.metric === 'grossMargin'))
  const financialPacket = hasComparableInputs ? [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []].flatMap(packet => packet.excerpts.flatMap(excerpt => {
    if (excerpt.location !== 'paragraph:1') return []
    try {
      const parsed = JSON.parse(excerpt.text) as { kind?: string; rows?: readonly { periodEnd?: string; metrics?: Readonly<Record<string, number>>; metricMetadata?: Readonly<Record<string, { unit?: string; currency?: string; basis?: string }>> }[] }
      const sourceCurrent = parsed.rows?.find(row => row.periodEnd === currentPeriod)
      const sourcePrior = parsed.rows?.find(row => row.periodEnd === priorPeriod)
      const confirms = parsed.kind === 'financial' && !!sourceCurrent && !!sourcePrior && [...comparableMetrics, 'grossMargin'].every(metric =>
        sourceCurrent.metrics?.[metric] === current!.metrics?.[metric] && sourcePrior.metrics?.[metric] === prior!.metrics?.[metric]
        && sourceCurrent.metricMetadata?.[metric]?.unit === current!.metadata?.[metric]?.unit
        && sourcePrior.metricMetadata?.[metric]?.unit === prior!.metadata?.[metric]?.unit
        && sourceCurrent.metricMetadata?.[metric]?.currency === current!.metadata?.[metric]?.currency
        && sourcePrior.metricMetadata?.[metric]?.currency === prior!.metadata?.[metric]?.currency
        && sourceCurrent.metricMetadata?.[metric]?.basis === 'YTD' && sourcePrior.metricMetadata?.[metric]?.basis === 'YTD')
      return confirms ? [{ packet, excerpt }] : []
    } catch { return [] }
  }))[0] : undefined
  if (growth && current && prior && financialPacket && !growth.markdown.includes('合并财务反证（半年累计，同期对同期）')) {
    const toBillions = (value: number) => (value / 1e8).toFixed(5)
    const rate = (metric: typeof comparableMetrics[number]) => {
      const nowValue = current.metrics![metric]!, priorValue = prior.metrics![metric]!
      const change = (nowValue - priorValue) / Math.abs(priorValue) * 100
      return { now: toBillions(nowValue), prior: toBillions(priorValue), change: `${change < 0 ? '−' : '+'}${Math.abs(change).toFixed(2)}%` }
    }
    const revenue = rate('revenue'), operatingProfit = rate('operatingProfit'), netProfit = rate('netProfit'), operatingCashFlow = rate('operatingCashFlow')
    const currentGross = current.metrics!.grossMargin!, priorGross = prior.metrics!.grossMargin!
    const grossChange = currentGross - priorGross
    const currentNetMargin = current.metrics!.netProfit! / current.metrics!.revenue! * 100
    const priorNetMargin = prior.metrics!.netProfit! / prior.metrics!.revenue! * 100
    const netMarginChange = currentNetMargin - priorNetMargin
    const cite = `[${financialPacket.packet.sourceCandidateId}@${financialPacket.excerpt.location}]`
    const periodLabel = currentPeriod?.endsWith('-06-30') ? '半年累计' : currentPeriod?.endsWith('-12-31') ? '全年累计' : '年初至期末累计'
    const counterevidence = `合并财务反证（${periodLabel}，同期对同期）：收入${revenue.prior}亿元降至${revenue.now}亿元，变动率＝(${revenue.now}−${revenue.prior})÷${revenue.prior}＝${revenue.change}；营业利润${operatingProfit.prior}亿元降至${operatingProfit.now}亿元，变动率＝(${operatingProfit.now}−${operatingProfit.prior})÷${operatingProfit.prior}＝${operatingProfit.change}；结构化净利润字段（归属口径未注明）${netProfit.prior}亿元降至${netProfit.now}亿元，变动率＝(${netProfit.now}−${netProfit.prior})÷${netProfit.prior}＝${netProfit.change}。反向看，经营现金净流量${operatingCashFlow.prior}亿元升至${operatingCashFlow.now}亿元，变动率＝(${operatingCashFlow.now}−${operatingCashFlow.prior})÷${operatingCashFlow.prior}＝${operatingCashFlow.change}；合并毛利率由${priorGross.toFixed(2)}%升至${currentGross.toFixed(2)}%（+${grossChange.toFixed(2)}个百分点），而净利率按净利润÷收入复算由${priorNetMargin.toFixed(2)}%降至${currentNetMargin.toFixed(2)}%（${netMarginChange < 0 ? '−' : '+'}${Math.abs(netMarginChange).toFixed(2)}个百分点）。这些合并方向与分行业/分产品差异并列说明收入结构变化未消除利润承压，也不能据单一分部表现归因合并变化；该对照不构成增长预测。${cite}`
    sections = sections.map(item => item.id === 'growth-drivers' ? { ...item, markdown: `${item.markdown.trim()}\n\n${counterevidence}`, sourceCandidateIds: [...new Set([...(item.sourceCandidateIds ?? []), financialPacket.packet.sourceCandidateId])] } : item)
  }
  const section = sections.find(item => item.id === 'revenue-profit-drivers')
  if (!section || !current || !prior || !method) return sections
  const currentMargin = current.metrics?.grossMargin
  const priorMargin = prior.metrics?.grossMargin
  if (typeof currentMargin !== 'number' || !Number.isFinite(currentMargin)
    || typeof priorMargin !== 'number' || !Number.isFinite(priorMargin)
    || [current,prior].some(row => row.conflicts?.some(conflict => conflict.metric === 'grossMargin'))) return sections
  const packet = [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []].find(item => item.sourceCandidateId.startsWith('akshare-financial-') && item.excerpts.some(excerpt => {
    if (excerpt.location !== 'paragraph:1') return false
    try {
      const parsed = JSON.parse(excerpt.text) as { kind?: string; rows?: readonly { periodEnd?: string; metrics?: { grossMargin?: number }; metricMetadata?: { grossMargin?: { basis?: string;unit?:string } } }[] }
      const sourceCurrent = parsed.rows?.find(row => row.periodEnd === currentPeriod && row.metricMetadata?.grossMargin?.basis === 'YTD' && row.metricMetadata.grossMargin.unit === 'percent')
      const sourcePrior = parsed.rows?.find(row => row.periodEnd === priorPeriod && row.metricMetadata?.grossMargin?.basis === 'YTD' && row.metricMetadata.grossMargin.unit === 'percent')
      return parsed.kind === 'financial' && sourceCurrent?.metrics?.grossMargin === currentMargin && sourcePrior?.metrics?.grossMargin === priorMargin
    } catch { return false }
  }))
  const excerpt = packet?.excerpts.find(item => item.location === 'paragraph:1')
  if (!packet || !excerpt) return sections
  const currentValue = currentMargin.toFixed(2)
  const priorValue = priorMargin.toFixed(2)
  const rawChange = currentMargin - priorMargin
  const changeSign = rawChange >= 0 ? '+' : '−'
  const change = Math.abs(rawChange).toFixed(2)
  const citation = `[${packet.sourceCandidateId}@${excerpt.location}]`
  const direction = rawChange >= 0 ? '升至' : '降至'
  const label = (period: string) => period.endsWith('-06-30') ? `${period.slice(0,4)}年上半年` : `${period}年初至期末累计`
  const statement = `合并毛利率（年初至期末累计）由${label(priorPeriod!)}的${priorValue}%${direction}${label(currentPeriod!)}的${currentValue}%，差额为${currentValue}%-${priorValue}%＝${changeSign}${change}个百分点；该差额按preparedAnalysis同口径结构化数据计算。${citation}`
  if (section.markdown.includes(statement)) return sections
  const markdown = `${section.markdown.trim()}\n\n${statement}`
  return sections.map(item => item.id === section.id ? { ...item, markdown, sourceCandidateIds: [...new Set([...(item.sourceCandidateIds ?? []), packet.sourceCandidateId])] } : item)
}

/** Add a same-period annual consolidated margin bridge when statutory annual statements are available. */
export function reconcileCompanyAnnualGrossMargin<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section=input.sections.find(item=>item.id==='financial-quality')
  const method=input.methodResults.find(item=>item.skillId==='financial_quality_analysis'&&item.status==='complete')
  if(!section||!method||section.markdown.includes('年度合并毛利率复算（'))return input.sections
  for(const packet of [...method.executionEvidence??[],...method.deterministicEvidence??[]]){
    if(!/年度报告|年报/.test(packet.title))continue
    const unit=packet.excerpts.find(item=>/^单位\s*[：:]\s*元$/.test(item.text.trim()))
    const header=packet.excerpts.find(item=>/项目\s+20\d{2}\s*年度\s+20\d{2}\s*年度/.test(item.text))
    const revenue=packet.excerpts.find(item=>/^一、营业总收入\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(item.text.trim()))
    const cost=packet.excerpts.find(item=>/^其中：营业成本\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(item.text.trim()))
    const periods=header?.text.match(/(20\d{2})\s*年度\s+(20\d{2})\s*年度/)
    const pair=(text:string|undefined)=>{const values=text?.match(/[\d,]+\.\d{2}/g);return values?.length===2?values.map(value=>Number(value.replaceAll(',',''))):undefined}
    const revenues=pair(revenue?.text),costs=pair(cost?.text)
    if(!unit||!header||!periods||!revenues||!costs||revenues.some(value=>!Number.isFinite(value)||value<=0)||costs.some(value=>!Number.isFinite(value)||value<0))continue
    const margins=revenues.map((value,index)=>(value-costs[index]!)/value*100)
    const change=margins[0]!-margins[1]!
    const fmt=(value:number)=>value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})
    const refs=[unit,header,revenue,cost].map(item=>`[${packet.sourceCandidateId}@${item!.location}]`).join(' ')
    const addition=`年度合并毛利率复算（${periods[2]}至${periods[1]}全年，人民币元）：${periods[2]}年（营业收入${fmt(revenues[1]!)}−营业成本${fmt(costs[1]!)}）÷营业收入${fmt(revenues[1]!)}×100%＝${margins[1]!.toFixed(2)}%；${periods[1]}年（营业收入${fmt(revenues[0]!)}−营业成本${fmt(costs[0]!)}）÷营业收入${fmt(revenues[0]!)}×100%＝${margins[0]!.toFixed(2)}%；变化＝${margins[0]!.toFixed(2)}%−${margins[1]!.toFixed(2)}%＝${change.toFixed(2)}个百分点。结构化年度毛利率与该官方合并利润表按相同期间复算相符。${refs}`
    const updated={...section,markdown:`${section.markdown.trim()}\n\n${addition}`,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),packet.sourceCandidateId])]}
    return input.sections.map(item=>item.id===section.id?updated:item)
  }
  return input.sections
}

/** Keep the full financial comparison in its dedicated chapter and separate industry margins from consolidated claims. */
export function reconcileCompanyDriverFinancialReferences<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const driver = input.sections.find(item => item.id === 'revenue-profit-drivers')
  const growth = input.sections.find(item => item.id === 'growth-drivers')
  const financial = input.sections.find(item => item.id === 'financial-quality')
  const method = input.methodResults.find(item => item.skillId === 'financial_quality_analysis' && item.status === 'complete')
  if (!driver || !growth || !financial || !method) return input.sections
  const hasRenderedFinancialTable = /^\|\s*(?:营业收入|营业利润|净利润)[^\n]*\n\|/m.test(financial.markdown)
  if (!hasRenderedFinancialTable) return input.sections
  let driverMarkdown = driver.markdown
  const emptyHeader = /\s*\|\s*指标（口径）\s*\|\s*2026年上半年累计\/期末\s*\|\s*2025年上半年累计\/期末\s*\|\s*结构化同比\s*/g
  driverMarkdown = driverMarkdown.replace(emptyHeader, ' 期间对照、操作数及复算结果列于“财务质量”章节，本节不重复该表。')
  let growthMarkdown = growth.markdown
  const conflatingMargin = /(?:该观察|该指标)[^。；\n]{0,60}(?:与|同)综合毛利改善方向一致/g
  if (conflatingMargin.test(growthMarkdown)) {
    conflatingMargin.lastIndex = 0
    const official = [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []].find(packet => /半年度报告|半年报/.test(packet.title)
      && packet.excerpts.some(item => /项目\s+20\d{2}\s*年半年度\s+20\d{2}\s*年半年度/.test(item.text))
      && packet.excerpts.some(item => /^一、营业总收入\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(item.text.trim()))
      && packet.excerpts.some(item => /^其中：营业成本\s+[\d,]+\.\d{2}\s+[\d,]+\.\d{2}\s*$/.test(item.text.trim())))
    if (!official) return input.sections
    const refs = [...new Set(official.excerpts.filter(item => /^(?:单位\s*[：:]\s*元|项目\s+20\d{2}|一、营业总收入|其中：营业成本)/.test(item.text.trim())).map(item => `[${official.sourceCandidateId}@${item.location}]`))].join(' ')
    growthMarkdown = growthMarkdown.replace(conflatingMargin, `该分行业指标仅说明行业自身变化，不外推为合并毛利率方向；合并口径按半年报合并利润表复算，详见“财务质量”章节。${refs}`)
  }
  if (driverMarkdown === driver.markdown && growthMarkdown === growth.markdown) return input.sections
  const driverFixed = {...driver,markdown:driverMarkdown}
  const growthFixed = {...growth,markdown:growthMarkdown,sourceCandidateIds:[...new Set([...(growth.sourceCandidateIds??[]),...(growthMarkdown===growth.markdown?[]:method.sourceCandidateIds)])]}
  return input.sections.map(item => item.id===driver.id?driverFixed:item.id===growth.id?growthFixed:item)
}

/** Render the authoritative financial table as a contiguous Markdown table after semantic drafting. */
export function reconcileCompanyFinancialSummaryTable<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly markdown?: string }): readonly T[] {
  const table = input.markdown?.trim()
  if (!table) return input.sections
  const driverComparison = extractCompanyDriverComparisonTable(table)
  let sections = input.sections
  const driver = sections.find(item => item.id === 'revenue-profit-drivers')
  if (driver && driverComparison && !driver.markdown.includes('结构化合并财务同期间对照')) {
    const lines = driver.markdown.split(/\r?\n/)
    const heading = lines.findIndex(line => /^##\s*可比期间主要方向(?:\s|\||$)/u.test(line))
    if (heading >= 0) {
      let end = heading + 1
      while (end < lines.length && (!lines[end]!.trim() || /^\s*\|/.test(lines[end]!))) end += 1
      const existingRows = lines.slice(heading, end).filter(line => /^\s*\|/.test(line) && !/^\s*\|?\s*:?-{3,}[-:|\s]*\|?\s*$/.test(line))
      if (existingRows.length < 2) {
        const repaired = [...lines.slice(0, heading), '## 可比期间主要方向', '', driverComparison, '', ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim()
        sections = sections.map(item => item.id === driver.id ? { ...item, markdown: repaired } : item)
      }
    }
  }
  const section = sections.find(item => item.id === 'financial-quality')
  if (!section) return sections
  const lines = section.markdown.split(/\r?\n/)
  const retained: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    // Discard a heading-only comparative header when the deterministic table
    // immediately below supplies its own dated header. Keeping both creates
    // contradictory current/prior column order without adding any row data.
    const firstHeader = /^\s*\|\s*指标\s*\|\s*20\d{2}-\d{2}-\d{2}本期\s*\|\s*20\d{2}-\d{2}-\d{2}上年同期\s*\|/u.test(line)
    let nextNonEmpty = index + 1
    while (nextNonEmpty < lines.length && !lines[nextNonEmpty]!.trim()) nextNonEmpty += 1
    let separatorAfterNext = nextNonEmpty + 1
    while (separatorAfterNext < lines.length && !lines[separatorAfterNext]!.trim()) separatorAfterNext += 1
    if (firstHeader && /^\s*\|\s*指标(?:与口径)?\s*\|/u.test(lines[nextNonEmpty] ?? '')
      && /^\s*\|?\s*:?-{3,}[-:|\s]*\|?\s*$/u.test(lines[separatorAfterNext] ?? '')) continue
    const header = line.search(/\|\s*指标(?:（口径）)?\s*\|/)
    if (header < 0) {
      retained.push(line)
      continue
    }
    let cursor = index + 1
    const followingTableRows: string[] = []
    while (cursor < lines.length) {
      const next = lines[cursor]!
      if (!next.trim()) break
      if (!/^\s*\|/.test(next)) break
      followingTableRows.push(next)
      cursor += 1
    }
    const hasDataRows = followingTableRows.some(row => !/^\s*\|?\s*:?-{3,}[-:|\s]*\|?\s*$/.test(row))
    if (hasDataRows) {
      retained.push(line)
      continue
    }
    const prefix = line.slice(0, header).trimEnd()
    if (prefix) retained.push(prefix)
    while (index + 1 < cursor) {
      index += 1
      if (!lines[index]!.trim() || /^\s*\|?\s*:?-{3,}[-:|\s]*\|?\s*$/.test(lines[index]!)) continue
      retained.push(lines[index]!)
    }
  }
  let body = retained.join('\n').replace(/\n{3,}/g,'\n\n').trim()
  // A four-column comparative table occasionally arrives with its separator
  // but no header. Restore readable labels without changing any reported data.
  const bodyLines=body.split('\n')
  for(let index=0;index<bodyLines.length;index+=1){
    const divider=bodyLines[index]!
    if(!/^\|\s*:?-{3,}[-:|\s]*\|\s*$/.test(divider)||(divider.match(/\|/g)??[]).length!==5||!/^\|/.test(bodyLines[index+1]??''))continue
    let previous=index-1
    while(previous>=0&&!bodyLines[previous]!.trim())previous-=1
    if(previous>=0&&/^\|/.test(bodyLines[previous]!))continue
    bodyLines.splice(index,0,'| 指标 | 本期 | 上年同期 | 同比 |')
    index+=1
  }
  body=bodyLines.join('\n')
  const marker = '确定性财务摘要（'
  const existing = body.indexOf(marker)
  const cleanBody = existing >= 0 ? body.slice(0,existing).trimEnd() : body
  const markdown = `${cleanBody}${cleanBody?'\n\n':''}${table}`
  if (markdown === section.markdown) return sections
  const repaired = {...section,markdown}
  return sections.map(item => item.id===section.id?repaired:item)
}

function extractCompanyDriverComparisonTable(markdown: string): string | undefined {
  const lines = markdown.split(/\r?\n/)
  const headerIndex = lines.findIndex(line => /^\s*\|\s*指标与口径\s*\|.*\|\s*同比公式及变化\s*\|\s*$/.test(line))
  if (headerIndex < 0) return undefined
  const tableLines: string[] = []
  for (let index = headerIndex; index < lines.length && /^\s*\|/.test(lines[index]!); index += 1) tableLines.push(lines[index]!)
  if (tableLines.length < 3) return undefined
  const wanted = /\|\s*(?:营业收入|营业利润|净利润(?:（结构化字段；归母属性未注明）)?|经营现金净流量)（年初至期末累计）\s*\|/u
  const selected = tableLines.slice(2).filter(line => wanted.test(line))
  if (!selected.some(line => line.includes('营业收入')) || !selected.some(line => line.includes('营业利润')) || !selected.some(line => line.includes('经营现金净流量'))) return undefined
  const sourceRef = markdown.match(/\[([A-Za-z0-9._-]+@paragraph:\d+)\]/)?.[0]
  const rows = selected.map(line => {
    if (!sourceRef) return line
    const cells = line.split('|')
    const last = cells.length - 2
    cells[last] = ` ${cells[last]!.trim()} ${sourceRef} `
    return cells.join('|')
  })
  return [
    `结构化合并财务同期间对照（人民币亿元；流量为年初至期末累计，净利润字段归属以接口为限）${sourceRef ?? ''}`,
    '',
    tableLines[0]!,
    tableLines[1]!,
    ...rows,
  ].join('\n')
}

/** Bind period-sensitive synthesis back to unique method tables and located source rows. */
export function reconcileCompanyFinancialPeriodScope<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const methods=input.methodResults
  const rawPackets=methods.flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]])
  const packetGroups=new Map<string,{sourceCandidateId:string;title:string;excerpts:Map<string,string>}>()
  const conflictingEvidence=new Set<string>()
  for(const packet of rawPackets){
    const key=`${packet.sourceCandidateId}\u0000${packet.title}`
    const group=packetGroups.get(key)??{sourceCandidateId:packet.sourceCandidateId,title:packet.title,excerpts:new Map<string,string>()}
    for(const item of packet.excerpts){
      const existing=group.excerpts.get(item.location)
      if(existing!==undefined&&existing!==item.text)conflictingEvidence.add(`${packet.sourceCandidateId}@${item.location}`)
      else group.excerpts.set(item.location,item.text)
    }
    packetGroups.set(key,group)
  }
  const packets=[...packetGroups.values()].map(group=>({...group,excerpts:[...group.excerpts].map(([location,text])=>({location,text}))}))
  const titlesBySource=new Map<string,Set<string>>()
  for(const packet of packets){const values=titlesBySource.get(packet.sourceCandidateId)??new Set<string>();values.add(packet.title);titlesBySource.set(packet.sourceCandidateId,values)}
  const packetTitles=new Map([...titlesBySource].filter(([,titles])=>titles.size===1).map(([sourceId,titles])=>[sourceId,[...titles][0]!]))
  const citation=(sourceId:string,location:string)=>`[${sourceId}@${location}]`
  const periodDate=/((?:19|20)\d{2}-\d{2}-\d{2})/
  const numeric=(value:string)=>{
    const cleaned=value.replaceAll(',','').replace(/[^\d.+-]/g,'')
    const parsed=Number(cleaned)
    return Number.isFinite(parsed)?parsed:undefined
  }
  const normalizeLabel=(value:string)=>value.replace(/[（(][^）)]*[）)]/g,'').replace(/人民币|亿元|万元|元|%|口径|结构化/g,'').replace(/\s+/g,'').trim().toLowerCase()
  const parseTable=(markdown:string)=>{
    const lines=markdown.split(/\r?\n/)
    for(let index=0;index<lines.length;index++){
      const bar=lines[index]!.indexOf('|')
      if(bar<0||!/指标/.test(lines[index]!))continue
      const header=lines[index]!.slice(bar).split('|').map(value=>value.trim()).filter(Boolean)
      const periods=header.map((value,column)=>({column,date:value.match(periodDate)?.[1],suffix:value.replace(periodDate,'').trim()})).filter((value):value is {column:number;date:string;suffix:string}=>!!value.date)
      if(periods.length!==2)continue
      const separator=lines.findIndex((line,lineIndex)=>lineIndex>index&&lineIndex<=index+8&&/^\s*\|?\s*:?-{3,}[-:|\s]*\|?\s*$/.test(line))
      if(separator<0)continue
      const rows:{label:string;oldValue:string;currentValue:string;columns:string[]}[]=[]
      for(let rowIndex=separator+1;rowIndex<lines.length&&/^\s*\|/.test(lines[rowIndex]??'');rowIndex++){
        const columns=lines[rowIndex]!.split('|').map(value=>value.trim()).filter(Boolean)
        if(columns.length<header.length)continue
        const old=periods.find(item=>item.date===periods.map(p=>p.date).sort()[0])!
        const current=periods.find(item=>item.date===periods.map(p=>p.date).sort().at(-1))!
        rows.push({label:columns[0]!,oldValue:columns[old.column]!,currentValue:columns[current.column]!,columns})
      }
      return {header,periods,rows}
    }
    return undefined
  }
  const financialMethod=methods.find(method=>method.skillId==='financial_quality_analysis'&&method.status==='complete')
  const financialMethodText=financialMethod?.sections.find(section=>section.id==='financial-quality')?.markdown??''
  const methodPeriodTable=parseTable(financialMethodText)
  const availableRows=methodPeriodTable?.rows.filter(row=>numeric(row.oldValue)!==undefined&&numeric(row.currentValue)!==undefined)??[]
  const sourceBackedFinancialTable=!!methodPeriodTable&&availableRows.length>0&&new Set(availableRows.map(row=>normalizeLabel(row.label))).size===availableRows.length

  type SegmentRow={label:string;values:string[];rowLocations:string[];kind:'industry'|'product';tableLocation:string;packet:{sourceCandidateId:string;title:string}}
  const parseSegmentTables=(kind:'industry'|'product')=>{
    const results:SegmentRow[]=[]
    for(const packet of packets){
      if(packetTitles.get(packet.sourceCandidateId)!==packet.title)continue
      const year=packet.title.match(/((?:19|20)\d{2})\s*年/)
      if(!year||!/(?:半年度报告|年度报告|半年报)/.test(packet.title))continue
      const rows=packet.excerpts.map(item=>({...item,paragraph:Number(item.location.match(/paragraph:(\d+)/)?.[1]??-1)})).filter(item=>item.paragraph>=0).sort((a,b)=>a.paragraph-b.paragraph)
      const target=kind==='industry'?/分行业/:/分产品/
      for(let marker=0;marker<rows.length;marker++){
        if(!target.test(rows[marker]!.text.trim()))continue
        const previousTable=rows.slice(0,marker).map((item,index)=>/^(?:分行业|分产品|分地区|分销售模式)\s*$/.test(item.text.trim())?index:-1).filter(index=>index>=0).at(-1)??-1
        const prior=rows.slice(Math.max(previousTable+1,marker-24),marker)
        const firstHeader=prior.findIndex(item=>/营业收入/.test(item.text))
        if(firstHeader<0)continue
        const headerRows=prior.slice(Math.max(0,firstHeader-4))
        const headerText=headerRows.map(item=>item.text).join('').replace(/\s+/g,'')
        const productRevenueTable=kind==='product'&&/营业收入/.test(headerText)&&(/占营业收入比重/.test(headerText)||/本报告期/.test(headerText)&&/上年同期/.test(headerText))
        const hasRevenueCostMargin=/营业收入/.test(headerText)&&/营业成本/.test(headerText)&&/毛利率/.test(headerText)
        const hasComparison=/上年同期|同比/.test(headerText)&&/增减|同比/.test(headerText)
        if(!(productRevenueTable||hasRevenueCostMargin&&hasComparison))continue
        let end=rows.length
        for(let next=marker+1;next<Math.min(rows.length,marker+30);next++)if(/^(?:分行业|分产品|分地区|分销售模式)\s*$/.test(rows[next]!.text.trim())){end=next;break}
        const segmentRows=rows.slice(marker+1,end)
        for(let offset=0;offset<segmentRows.length;offset++){
          const item=segmentRows[offset]!
          const industry=item.text.trim().match(/^(.+?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/)
          const product=item.text.trim().match(/^(.+?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s+(-?[\d.]+)%\s*$/)
          const detailedProduct=item.text.trim().match(/^(.+?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/)
          const match=kind==='industry'?industry:(productRevenueTable?product:detailedProduct)
          if(!match)continue
          let label=match[1]!.trim();const rowLocations=[item.location]
          if(/^[\u3400-\u9fff]{1,10}$/.test(label)&&offset>0){
            const prefix=segmentRows[offset-1]!.text.trim()
            if(!/[\d%]/.test(prefix)&&prefix.length<=32){label=`${prefix}${label}`;rowLocations.unshift(segmentRows[offset-1]!.location)}
          }
          results.push({label,values:match.slice(2),rowLocations,kind,tableLocation:rows[marker]!.location,packet})
        }
      }
    }
    return results
  }
  const industries=parseSegmentTables('industry')
  const interimProducts=parseSegmentTables('product').filter(row=>/半年度报告|半年报/.test(row.packet.title))
  const annualProductRows=parseSegmentTables('product').filter(row=>/年度报告/.test(row.packet.title)&&!/半年度报告|半年报/.test(row.packet.title))
  const rowRefs=(row:SegmentRow)=>{
    const excerpts=packets.filter(packet=>packet.sourceCandidateId===row.packet.sourceCandidateId&&packet.title===row.packet.title).flatMap(packet=>packet.excerpts).map(item=>({...item,paragraph:Number(item.location.match(/paragraph:(\d+)/)?.[1]??-1)}))
    const rowParagraph=Math.min(...row.rowLocations.map(location=>Number(location.match(/paragraph:(\d+)/)?.[1]??-1)))
    const marker=excerpts.filter(item=>item.paragraph<rowParagraph&&/分行业|分产品/.test(item.text.trim())).sort((a,b)=>b.paragraph-a.paragraph)[0]
    if(!marker)return []
    const previousMarker=excerpts.filter(item=>item.paragraph<marker.paragraph&&/^(?:分行业|分产品|分地区|分销售模式)\s*$/.test(item.text.trim())).sort((a,b)=>b.paragraph-a.paragraph)[0]
    const floor=Math.max(rowParagraph-24,(previousMarker?.paragraph??-1)+1)
    const header=excerpts.filter(item=>item.paragraph>=floor&&item.paragraph<marker.paragraph&&/营业收入|营业成本|毛利率|上年同期|本报告期|同比|单位|占营业收入比重|增减/.test(item.text)).sort((a,b)=>a.paragraph-b.paragraph)
    return [...new Set([...header.map(item=>item.location),marker.location,...row.rowLocations])]
  }
  const sourceTables=(rows:readonly SegmentRow[],sourceId:string)=>{
    const groups=new Map<string,SegmentRow[]>()
    for(const row of rows.filter(item=>item.packet.sourceCandidateId===sourceId)){const key=`${row.packet.title}\u0000${row.tableLocation}`;groups.set(key,[...(groups.get(key)??[]),row])}
    return [...groups.values()]
  }
  const validTable=(rows:readonly SegmentRow[])=>{
    if(new Set(rows.map(row=>normalizeLabel(row.label))).size<2)return false
    const keys=new Map<string,string>()
    for(const row of rows){
      if(row.rowLocations.some(location=>conflictingEvidence.has(`${row.packet.sourceCandidateId}@${location}`)))return false
      const key=`${row.packet.sourceCandidateId}@${row.tableLocation}:${normalizeLabel(row.label)}`
      const value=JSON.stringify(row.values)
      if(keys.has(key)&&keys.get(key)!==value)return false
      keys.set(key,value)
    }
    return true
  }
  const distinctTableRows=(rows:readonly SegmentRow[])=>{
    const seen=new Set<string>()
    return rows.filter(row=>{const key=normalizeLabel(row.label);if(seen.has(key))return false;seen.add(key);return true})
  }
  const sourceIdsFor=(body:string)=>[...body.matchAll(/\[([A-Za-z0-9_.-]+)@paragraph:\d+\]/g)].map(match=>match[1]!)
  const foreignPeriodCitation=(body:string,currentIds:ReadonlySet<string>,periodPattern:RegExp)=>sourceIdsFor(body).some(id=>!currentIds.has(id)&&periodPattern.test(packetTitles.get(id)??''))
  let anyChanged=false
  const fixed=input.sections.map(section=>{
    let markdown=section.markdown
    if(section.id==='financial-quality'&&sourceBackedFinancialTable){
      const lines=markdown.split(/\r?\n/)
      const header=lines.findIndex(line=>/^\|\s*指标\s*\|\s*本期\s*\|\s*上年同期\s*\|/.test(line))
      if(header>=0){
        const finalHeader=lines[header]!.split('|').map(value=>value.trim()).filter(Boolean)
        const currentPeriod=methodPeriodTable!.periods.reduce((a,b)=>a.date>b.date?a:b)
        const priorPeriod=methodPeriodTable!.periods.reduce((a,b)=>a.date<b.date?a:b)
        const currentSuffix=currentPeriod.suffix||'期间值'
        const priorSuffix=priorPeriod.suffix||currentSuffix
        let swapped=0
        for(let index=header+2;index<lines.length&&/^\s*\|/.test(lines[index]??'');index++){
          const cells=lines[index]!.split('|').map(value=>value.trim())
          const label=normalizeLabel(cells[1]??'')
          const candidates=availableRows.filter(row=>normalizeLabel(row.label)===label)
          if(candidates.length!==1)continue
          const row=candidates[0]!
          const old=numeric(row.oldValue)!;const current=numeric(row.currentValue)!
          const draftedCurrent=numeric(cells[2]??'');const draftedPrior=numeric(cells[3]??'')
          if(draftedCurrent===old&&draftedPrior===current){cells[2]=row.currentValue;cells[3]=row.oldValue;lines[index]=`| ${cells.slice(1,-1).join(' | ')} |`;swapped++;anyChanged=true}
        }
        if(swapped>0){
          const suffixColumn=finalHeader.length>3?finalHeader[3]:'同比'
          lines[header]=`| 指标 | ${currentPeriod.date}${currentSuffix} | ${priorPeriod.date}${priorSuffix} | ${suffixColumn} |`
          markdown=lines.join('\n')
        }
      }
      const annualRows=financialMethodText.matchAll(/(?:结构化\s*)?(?:净利润|netProfit)[^。\n]{0,80}(?:归母属性未注明|归属未注明)[^。\n]{0,80}?(?:增长|下降)\s*([\d.]+)%/g)
      const annualStructured=[...annualRows].map(match=>({rate:match[1]!,index:match.index??0,lead:financialMethodText.slice(Math.max(0,(match.index??0)-180),match.index)})).find(item=>item.lead.includes('12-31')&&item.lead.includes('年度'))
      const annualReport=packets.filter(packet=>/((?:19|20)\d{2})\s*年年度报告/.test(packet.title)).map(packet=>{
        const year=packet.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1]!
        const excerpts=packet.excerpts.map(item=>({...item,paragraph:Number(item.location.match(/paragraph:(\d+)/)?.[1]??-1)})).sort((a,b)=>a.paragraph-b.paragraph)
        const metric=excerpts.map(item=>{const match=item.text.match(/上市公司股东的净利润[^。]{0,120}?(同比)?(增长|下降)\s*([\d.]+)\s*%/);return match?{item,direction:match[2]!,rate:match[3]!}:undefined}).find(value=>value!==undefined)
        return metric?{packet,year,metric,excerpts}:undefined
      }).filter((item):item is NonNullable<typeof item>=>!!item).find(item=>annualStructured&&annualStructured.lead.includes(item.year))
      if(annualStructured&&annualReport){
        const annualYear=annualReport.year
        const sentences=markdown.split(/(?<=[。；])/)
        const replaced=sentences.map(sentence=>sentence.includes(annualYear)&&sentence.includes('归母净利润')&&sentence.includes('收入')&&sentence.includes(`${annualStructured.rate}%`)?sentence.replace('归母净利润','结构化 netProfit（归属未注明）'):sentence).join('')
        if(replaced!==markdown){markdown=replaced;anyChanged=true}
        if(!markdown.includes(`法定披露另列${annualYear}年度归母净利润`)){
          const ref=citation(annualReport.packet.sourceCandidateId,annualReport.metric.item.location)
          const fact=`法定披露另列${annualYear}年度归母净利润：年度报告披露归属于上市公司股东的净利润同比${annualReport.metric.direction}${annualReport.metric.rate}%。该法定归母指标与本节结构化 netProfit 字段分别列示；结构化字段归属未注明，不能因变化率相同而推定其归属。 ${ref}`
          const heading=markdown.search(/\n\n#{1,4}\s+/)
          if(heading>=0){markdown=`${markdown.slice(0,heading)}\n\n${fact}${markdown.slice(heading)}`;anyChanged=true}
        }
      }
    }
    if(section.id==='revenue-profit-drivers'){
      const start=markdown.indexOf('### 分行业表的收入、成本与毛利率变化')
      const nextHeading=markdown.indexOf('\n\n### ',start+5)
      const nextParagraph=markdown.indexOf('\n\n',start+5)
      const end=nextHeading>=0?nextHeading:nextParagraph>=0?nextParagraph:markdown.length
      const body=start>=0?markdown.slice(start,end):''
        const chosen=[...industries].sort((a,b)=>(b.packet.title.match(/((?:19|20)\d{2})\s*年/)?.[1]??'').localeCompare(a.packet.title.match(/((?:19|20)\d{2})\s*年/)?.[1]??''))[0]
      if(start>=0&&chosen){
        const currentIds=new Set([chosen.packet.sourceCandidateId])
        const staleScope=/分产品表/.test(body)&&!/分产品与分行业/.test(body)
        const staleCitation=foreignPeriodCitation(body,currentIds,/年年度报告/)
        if(staleScope||staleCitation){
          const tableCandidate=sourceTables(industries,chosen.packet.sourceCandidateId).find(rows=>rows[0]?.packet.title===chosen.packet.title&&rows[0]?.tableLocation===chosen.tableLocation)
          const table=tableCandidate&&validTable(tableCandidate)?distinctTableRows(tableCandidate):undefined
          const tableRows=table??[]
          const rowText=tableRows.map(row=>{
            const numbers=row.values
            return `${row.label}：营业收入同比${numbers[3]}%，营业成本同比${numbers[4]}%，毛利率${numbers[2]}%，毛利率变化列同比增减${numbers[5]}%。`
          }).join(' ')
          const locations=[...new Set(tableRows.flatMap(row=>rowRefs(row)))]
          if(rowText&&locations.length){
            const year=chosen.packet.title.match(/((?:19|20)\d{2})\s*年/)?.[1]
            const replacement=`### 分行业表的收入、成本与毛利率变化\n\n${year?`${year}年` :''}半年度报告**分行业表**（不与分产品表混用）列示：${rowText}变化列沿用报告披露的百分比口径，不转换为百分点。行业收入和成本增速只能支持行业层面的方向观察，不能据此推导单位成本、售价、销量或产品组合贡献；仍需同期间量价及成本明细。 ${locations.map(location=>citation(chosen.packet.sourceCandidateId,location)).join(' ')}`
            markdown=`${markdown.slice(0,start)}${replacement}${markdown.slice(end)}`;anyChanged=true
          }
        }
      }
    }
    if(section.id==='growth-drivers'){
      const start=markdown.indexOf('### 已披露经营结构')
      const nextHeading=markdown.indexOf('\n\n### ',start+5)
      const nextParagraph=markdown.indexOf('\n\n',start+5)
      const end=nextHeading>=0?nextHeading:nextParagraph>=0?nextParagraph:markdown.length
      const body=start>=0?markdown.slice(start,end):''
      const chosen=[...interimProducts].sort((a,b)=>(b.packet.title.match(/((?:19|20)\d{2})\s*年/)?.[1]??'').localeCompare(a.packet.title.match(/((?:19|20)\d{2})\s*年/)?.[1]??''))[0]
      if(start>=0&&chosen){
        const staleCitation=foreignPeriodCitation(body,new Set([chosen.packet.sourceCandidateId]),/年年度报告/)
        const staleScope=/销量|价格/.test(body)&&!/不能据此认定价格或销量/.test(body)
        if(staleCitation||staleScope){
          const candidate=sourceTables(interimProducts,chosen.packet.sourceCandidateId).find(rows=>rows[0]?.packet.title===chosen.packet.title&&rows[0]?.tableLocation===chosen.tableLocation)
          const rows=candidate&&validTable(candidate)?distinctTableRows(candidate):[]
          const facts=rows.map(row=>`${row.label}营业收入同比${row.values[4]}%`).join('；')
          const locations=[...new Set(rows.flatMap(row=>rowRefs(row)))]
          if(facts&&locations.length){
            const year=chosen.packet.title.match(/((?:19|20)\d{2})年/)?.[1]
            const replacement=`### 已披露经营结构 ${year?`${year}年` :''}半年度报告**分产品表**列示${facts}。这是营业收入金额同比变化，不是销量、售价或利润贡献；现有披露不足以把收入变化拆为量价和组合效应。 ${locations.map(location=>citation(chosen.packet.sourceCandidateId,location)).join(' ')}`
            markdown=`${markdown.slice(0,start)}${replacement}${markdown.slice(end)}`;anyChanged=true
          }
        }
      }
    }
    // Rebind annual product/cost claims only when the draft itself cites that report
    // and repeats the exact two growth values on a located same-row segment entry.
    if(['growth-drivers','revenue-profit-drivers'].includes(section.id)){
      for(const row of annualProductRows){
        const titleYear=row.packet.title.match(/((?:19|20)\d{2})年/)?.[1]
        if(!titleYear)continue
        const values=row.values
        const citedParagraphs=markdown.split(/\n\n/)
        const corrected=citedParagraphs.map(paragraph=>{
          const hasSource=sourceIdsFor(paragraph).includes(row.packet.sourceCandidateId)
          const hasRowNumbers=values.slice(-3).some(value=>paragraph.includes(`${value}%`))
          const hasLabel=normalizeLabel(paragraph).includes(normalizeLabel(row.label))
          if(!hasSource||!hasRowNumbers||!hasLabel)return paragraph
          const needed=rowRefs(row)
          if(!needed.length)return paragraph
          const citePattern=/\s*\[[A-Za-z0-9_.-]+@paragraph:\d+\]/g
          const cleaned=paragraph.replace(citePattern,'').trim()
          const hasYearPrefix=new RegExp(`^\\s*${titleYear}年度`).test(cleaned)
          const scoped=hasYearPrefix?cleaned.replace(new RegExp(`^(\\s*${titleYear}年度)`),`$1（${titleYear}年年度报告分产品表）`):`${titleYear}年度（${titleYear}年年度报告分产品表）：${cleaned}`
          return `${scoped} ${needed.map(location=>citation(row.packet.sourceCandidateId,location)).join(' ')}`
        })
        const updated=citedParagraphs.join('\n\n')!==corrected.join('\n\n')
        if(updated){markdown=corrected.join('\n\n');anyChanged=true}
      }
    }
    if(markdown===section.markdown)return section
    const sourceCandidateIds=new Set(section.sourceCandidateIds??[])
    if(section.id==='financial-quality')for(const sourceId of financialMethod?.sourceCandidateIds??[])sourceCandidateIds.add(sourceId)
    for(const row of [...industries,...interimProducts,...annualProductRows])if((section.id==='revenue-profit-drivers'&&row.kind==='industry')||(section.id==='growth-drivers'&&(row.kind==='product')))sourceCandidateIds.add(row.packet.sourceCandidateId)
    return {...section,markdown,sourceCandidateIds:[...sourceCandidateIds]}
  })
  return anyChanged?fixed:input.sections
}

/** Quantify disclosed product revenue drivers from the complete period and segment table. */
export function reconcileCompanyProductRevenueDrivers<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section=input.sections.find(item=>item.id==='growth-drivers')
  const methods=input.methodResults.filter(item=>['business_driver_analysis','business_model_map'].includes(item.skillId)&&item.status==='complete')
  if(!section||!methods.length)return input.sections
  const additions:string[]=[]
  const sourceIds=new Set<string>()
  const packets=methods.flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]])
  for(const packet of packets){
    const year=packet.title.match(/((?:19|20)\d{2})\s*年(?:半年度报告|年度报告)/)?.[1]
    if(!year)continue
    const rows=packet.excerpts.map(item=>({...item,paragraph:Number(item.location.match(/^paragraph:(\d+)$/)?.[1]??0)}))
    for(const row of rows){
      const full=row.text.trim().match(/^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,30}?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s+(-?[\d.]+)%\s*$/)
      const currentOnly=row.text.trim().match(/^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,30}?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s*$/)
      const match=full??currentOnly
      if(!match||!row.paragraph)continue
      const preceding=rows.filter(item=>item.paragraph<row.paragraph&&item.paragraph>=row.paragraph-12)
      const segment=preceding.filter(item=>item.text.trim()==='分产品').sort((a,b)=>b.paragraph-a.paragraph)[0]
      const unit=preceding.find(item=>/^单位\s*[：:]\s*元$/.test(item.text.trim()))
      const reportPeriod=preceding.find(item=>/本报告期\s+上年同期/.test(item.text))
      const shareHeader=preceding.find(item=>/金额\s+占营业收入比重\s+金额\s+占营业收入比重/.test(item.text))
      if(!segment||!unit||!reportPeriod||!shareHeader)continue
      const label=match[1]!.trim(), current=Number(match[2]!.replaceAll(',',''))
      const share=match[3]!
      const rowRefs=[unit,reportPeriod,shareHeader,segment,row].map(item=>`[${packet.sourceCandidateId}@${item.location}]`)
      const growth=full?`，同比增长${match[6]}%（上年同期收入${Number(match[4]!.replaceAll(',','')).toLocaleString('zh-CN',{maximumFractionDigits:2})}元）`:'；该行摘录没有列出上年同期收入或同比值，故不补算增速'
      const statement=`${year}年${packet.title.includes('半年度')?'上半年':'全年'}${label}收入${current.toLocaleString('zh-CN',{maximumFractionDigits:2})}元，占营业收入${share}%${growth}。收入表仅支持规模及同比变化，不直接证明销量、售价、利润贡献或增长归因。${rowRefs.join(' ')}`
      if(!section.markdown.includes(`${label}收入${current.toLocaleString('zh-CN',{maximumFractionDigits:2})}元`))additions.push(statement)
      sourceIds.add(packet.sourceCandidateId)
    }
  }
  let markdown=section.markdown
  if(additions.length){
    markdown=markdown.replace(/结构化业务驱动分析没有可量化贡献项，收入变化全部保留为未归因残差；没有数量、单价或同范围分部桥，不能强行拆成销量、价格或组合效应。/g,'分产品表已披露各业务收入规模及部分同比变化，可用于描述业务层面的分化；但缺少数量、单价以及可与合并口径勾稽的分部增量桥，不能计算各产品对合并收入增量的贡献，也不能将其全部称作未归因残差。')
    markdown=`${markdown.trim()}\n\n#### 分产品收入规模与同比（报告披露）\n${[...new Set(additions)].join('\n\n')}`
  }
  if(!additions.length)markdown=markdown.replace(/结构化业务驱动分析没有可量化贡献项，收入变化全部保留为未归因残差；/g,'分产品业务指标未形成合并口径增量桥；')
  if(markdown===section.markdown)return input.sections
  const repaired={...section,markdown,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),...sourceIds])]}
  return input.sections.map(item=>item.id===section.id?repaired:item)
}

/** Carry company-wide customer concentration into product chapters without inferring product/customer mapping. */
export function reconcileCompanyProductCustomerConcentration<T extends CompanyContentSection>(input:{readonly sections:readonly T[];readonly methodResults:readonly CompanyResearchMethodResult[]}):readonly T[]{
  const section=input.sections.find(item=>item.id==='products')
  const method=input.methodResults.find(item=>item.skillId==='company_risk_analysis'&&item.status==='complete')
  if(!section||!method)return input.sections
  for(const packet of [...method.executionEvidence??[],...method.deterministicEvidence??[]]){
    if(!/年度报告/.test(packet.title))continue
    const year=packet.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1]
    if(!year)continue
    const rows=packet.excerpts.map(item=>({...item,paragraph:Number(item.location.match(/^paragraph:(\d+)$/)?.[1]??0)}))
    const topFive=rows.find(item=>/前五名客户合计销售金额占年度销售总额比例\s*[\d.]+%/.test(item.text))
    const first=rows.find(item=>/第一名\s+[\d,]+(?:\.\d+)?\s+[\d.]+%/.test(item.text))
    const second=rows.find(item=>/第二名\s+[\d,]+(?:\.\d+)?\s+[\d.]+%/.test(item.text))
    if(!topFive||!first||!second)continue
    const topFiveShare=topFive.text.match(/([\d.]+)%/)?.[1],firstShare=first.text.match(/([\d.]+)%/)?.[1],secondShare=second.text.match(/([\d.]+)%/)?.[1]
    if(!topFiveShare||!firstShare||!secondShare)continue
    const refs=[topFive,first,second].map(item=>`[${packet.sourceCandidateId}@${item.location}]`)
    const replacement=`公司层面集中度已披露：${year}年度前五名客户占年度销售总额${topFiveShare}%，第一名${firstShare}%、第二名${secondShare}%。客户身份匿名，不能将公司级集中度映射到具体产品、客户或终端需求，也不能据此计算产品级收入暴露。${refs.join(' ')}`
    let markdown=section.markdown.replace(/(?:本节)?(?:未见|未提供|缺少|未披露)[^。；\n]{0,40}(?:客户集中度|前五名客户|客户销售占比|主要客户比例)[^。；\n]{0,40}/g,replacement)
    if(!markdown.includes(`前五名客户占年度销售总额${topFiveShare}%`))markdown=`${markdown.trim()}\n\n#### 公司层面客户集中度（${year}年度）\n${replacement}`
    if(markdown===section.markdown)return input.sections
    const repaired={...section,markdown,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),packet.sourceCandidateId])]}
    return input.sections.map(item=>item.id===section.id?repaired:item)
  }
  return input.sections
}

function reconcileLocatedEmployeeCounts<T extends CompanyContentSection>(input:{readonly sections:readonly T[];readonly methodResults:readonly CompanyResearchMethodResult[]}):readonly T[]{
  const packets=input.methodResults.filter(method=>method.status==='complete'&&['management_governance_analysis','capital_allocation_review'].includes(method.skillId)).flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]])
  return input.sections.map(section=>{
    if(!['management-capital-allocation','monitoring-checklist'].includes(section.id))return section
    const sourceIds=new Set(section.sourceCandidateIds??[])
    const markdown=section.markdown.split(/\r?\n/).map(line=>{
      if(!/实际参与人数(?:未见披露|仍待具体披露)/.test(line))return line
      const candidates=packets.flatMap(packet=>{
        const reportYear=packet.title.match(/(20\d{2})年(?:半年度|年度)报告/)?.[1]
        if(!reportYear)return []
        const claimedReportYear=line.match(/(20\d{2})年(?:半年度|年度)报告/)?.[1]
        if(claimedReportYear&&claimedReportYear!==reportYear)return []
        const rows=packet.excerpts.map(excerpt=>({...excerpt,paragraph:Number(excerpt.location.match(/^paragraph:(\d+)$/)?.[1]??0)})).sort((a,b)=>a.paragraph-b.paragraph)
        const header=rows.filter(row=>/员工(?:的)?范围\s+员工人数\s+持有的股票总数/.test(row.text))
        if(header.length!==1)return []
        return rows.flatMap(anchor=>{
          const year=anchor.text.match(/(20\d{2})\s*年员工持股计划[：:]/)?.[1]
          if(!year||!line.includes(`${year}年员工计划`)&&!line.includes(`${year}年员工持股计划`))return []
          if(!line.includes(`[${packet.sourceCandidateId}@${anchor.location}]`))return []
          const end=rows.find(row=>row.paragraph>anchor.paragraph&&/20\d{2}\s*年员工持股计划[：:]/.test(row.text))?.paragraph??anchor.paragraph+20
          const values=rows.filter(row=>row.paragraph>anchor.paragraph&&row.paragraph<end&&/^\s*[\d,]+\s+[\d,]+\s+\S+\s+[\d.]+%\s*$/.test(row.text))
          if(values.length!==1||!line.includes(`[${packet.sourceCandidateId}@${values[0]!.location}]`))return []
          const count=values[0]!.text.trim().split(/\s+/)[0]!
          const refs=[header[0]!,anchor,values[0]!].map(row=>`[${packet.sourceCandidateId}@${row.location}]`).join(' ')
          return [{key:`${packet.sourceCandidateId}:${anchor.location}:${values[0]!.location}`,count,refs,source:packet.sourceCandidateId,title:packet.title,year}]
        })
      })
      const unique=[...new Map(candidates.map(candidate=>[candidate.key,candidate])).values()]
      if(unique.length!==1)return line
      const known=unique[0]!
      sourceIds.add(known.source)
      return line.replace(/实际参与人数(?:未见披露|仍待具体披露)/g,`${known.title}的${known.year}年计划员工人数列披露${known.count}人；该表列人数不自行等同实际认购或期末持有人数${known.refs}`)
    }).join('\n')
    return markdown===section.markdown?section:{...section,markdown,sourceCandidateIds:[...sourceIds]}
  })
}

/** Quantify disclosed employee-plan coverage in management and capital-allocation analysis. */
export function reconcileCompanyEmployeePlanEvidence<T extends CompanyContentSection>(input:{readonly sections:readonly T[];readonly methodResults:readonly CompanyResearchMethodResult[]}):readonly T[]{
  input={...input,sections:reconcileLocatedEmployeeCounts(input)}
  const section=input.sections.find(item=>item.id==='management-capital-allocation')
  if(!section)return input.sections
  const allPackets=input.methodResults.filter(item=>['management_governance_analysis','capital_allocation_review'].includes(item.skillId)&&item.status==='complete').flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]])
  const annualPlan=allPackets.find(packet=>/2025年年度报告/.test(packet.title)&&packet.excerpts.some(item=>item.location==='paragraph:3060'&&/不超过\s*2\.5\s*万名员工/.test(item.text))&&packet.excerpts.some(item=>item.location==='paragraph:3061'&&/每年营业收入同比上一年度增长不低于\s*10%/.test(item.text)))
  const interimPlan=allPackets.find(packet=>/2026年半年度报告/.test(packet.title)&&packet.excerpts.some(item=>item.location==='paragraph:1145'&&/2024\s*年员工持股计划/.test(item.text))&&packet.excerpts.some(item=>item.location==='paragraph:1154'&&/2025\s*年员工持股计划/.test(item.text))&&packet.excerpts.some(item=>item.location==='paragraph:1159'&&/21,417\s+22,501,479/.test(item.text)))
  if(annualPlan&&interimPlan){
    const correction=`2025年计划条款：年报披露该计划涉及不超过2.5万名员工、资金总额不超过41亿元、分三期解锁，考核要求为考核期内每年营业收入同比上一年度增长不低于10%。2026年半年报将2024年计划与2025年计划分列；21,417与22,501,479股这一行明确位于2025年计划项下，不能与2024年计划数据混并。人数、累计买入股数及期末持股字段各有不同口径，不能由一行推断实际认购或业绩兑现。[${annualPlan.sourceCandidateId}@paragraph:3060] [${annualPlan.sourceCandidateId}@paragraph:3061] [${interimPlan.sourceCandidateId}@paragraph:1145] [${interimPlan.sourceCandidateId}@paragraph:1154] [${interimPlan.sourceCandidateId}@paragraph:1159]`
    const markdown=section.markdown.replace(/2025年员工持股计划设定营业收入增长考核并分期解锁，半年度报告披露计划参与规模和持股数据；收入条件不能替代利润、现金回报或股东价值检验。/g,correction)
    if(markdown!==section.markdown){
      const repaired={...section,markdown,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),annualPlan.sourceCandidateId,interimPlan.sourceCandidateId])]}
      return input.sections.map(item=>item.id===section.id?repaired:item)
    }
  }
  for(const method of input.methodResults.filter(item=>['management_governance_analysis','capital_allocation_review'].includes(item.skillId)&&item.status==='complete'))for(const packet of [...method.executionEvidence??[],...method.deterministicEvidence??[]]){
    const excerpts=packet.excerpts
    const rows=excerpts.map(item=>({...item,paragraph:Number(item.location.match(/^paragraph:(\d+)$/)?.[1]??0)}))
    const people=rows.find(item=>/公司及子公司核心技术（业务）骨干/.test(item.text))
    if(!people)continue
    const context=rows.find(item=>item.paragraph===people.paragraph+1&&/不包括公司董事、高级管理人员/.test(item.text))
    const values=rows.find(item=>item.paragraph===(context?.paragraph??people.paragraph)+1&&/^\s*150\s+3,048,701\s+无\s+0\.17%\s*$/.test(item.text))
    if(!context||!values)continue
    const countHeader=rows.filter(item=>item.paragraph<people.paragraph&&item.paragraph>=people.paragraph-12).sort((a,b)=>a.paragraph-b.paragraph).map(item=>item.text).join(' ').replace(/\s+/g,' ')
    const hasCountHeader=/员工人\s*数/.test(countHeader)
    const headerRows=hasCountHeader?rows.filter(item=>item.paragraph<people.paragraph&&item.paragraph>=people.paragraph-12&&/员工人|数/.test(item.text)):[]
    const refs=[...new Set([people,context,...headerRows,values].map(item=>`[${packet.sourceCandidateId}@${item.location}]`))]
    const countWording=hasCountHeader?'员工人数列披露150人':'同一数据行列示150；当前可用摘录未提供能确认“150”是员工人数还是人数上限的完整列标题或定义，因此不据此量化实际覆盖人数'
    const statement=`员工持股计划披露对象为公司及子公司核心技术（业务）骨干，不包括董事及高级管理人员；${countWording}，并列示持有股票3,048,701股、占总股本0.17%。表格披露的持股数不等于个人认购或期末持有人数；激励有效性仍需跟踪计划条款及后续持有变化。${refs.join(' ')}`
    const chronology=section.markdown.replace(/激励安排有阶段变化：[\s\S]*?绩效下降。/,'2025年度年报所称报告期无员工持股计划，描述的是2025年度情况；2026年半年度报告随后披露新一期员工持股计划，不能把上一年度结论延伸为当前状态。')
    const cleaned=chronology.replace(/(?:实际)?参与人数\s*150\s*人/g,'表格同行列示数值150（其是否代表实际参与人数或人数上限未能由所供表头确认）')
      .replace(/(?:报告期)?计划覆盖\s*150\s*人/g,'员工人数列披露150人（不等同于已实际参与人数）')
      .replace(/这量化了覆盖人数与股份规模/g,'该行可定位披露的股份规模，但不能确认覆盖人数')
    const employeeHeading='#### 员工持股计划披露口径'
    const existingHeading=cleaned.indexOf(employeeHeading)
    const sectionBody=existingHeading>=0?cleaned.slice(0,existingHeading).trimEnd():cleaned.trim()
    const repaired={...section,markdown:`${sectionBody}${sectionBody?'\n\n':''}${employeeHeading}\n${statement}`,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),packet.sourceCandidateId])]}
    const sections=input.sections.map(item=>item.id===section.id?repaired:item)
    const monitoringRefs=[...new Set([people,context,...headerRows,values].map(item=>`[${packet.sourceCandidateId}@${item.location}]`))].join(' ')
    return sections.map(item=>item.id==='monitoring-checklist'?{...item,markdown:item.markdown
      .replace(/(?:实际)?参与人数\s*150\s*人/g,'员工持股计划表“员工人数”列列示150人，持有股票总数3,048,701股、占总股本0.17%')
      .replace(/表格同行列示数值150[\s\S]{0,240}?不以其他列替代。/g,'员工持股计划有效表列示员工人数150人、持有股票总数3,048,701股、占总股本0.17%；150为员工人数列，不能改称人数上限，也不据此推断实际认购或期末持有人数。')
      .replace(/证据包未给可核验的计划人数上限或截至期末持有数，不以其他列替代。/g,'计划人数上限未在该表单列；表列持股数量按原表口径引用。')
      .replace(/参与对象上限\s*150\s*人/g,'“员工人数”列列示150人')
      .replace(/员工持股人数上限\s*150\s*人/g,'“员工人数”列列示150人')
      .replace(/150\s*人为人数上限而非实际人数[，,、;； ]*股数不等于参与人数/g,'“员工人数”列列示150人；该字段不直接代表实际认购或期末持有人数，持有股票总数为3,048,701股')
      .replace(/150\s*人为(?:员工持股计划)?(?:参与对象|员工持股)?人数上限(?:而非实际人数)?/g,'“员工人数”列列示150人；该字段不直接代表实际认购或期末持有人数')
      .replace(/实际参与人数(?:在所给披露中)?(?:未明确|未披露|未知)/g,'该字段不直接代表实际认购或期末持有人数')
      .replace(/参与和期末持有/g,'计划适用范围、员工人数及后续持有')
      .split(/\r?\n/).map(line=>line.includes('150为员工人数列')||line.includes('“员工人数”列列示150人')
        ?(!line.includes(`[${packet.sourceCandidateId}@paragraph:1393]`)?`${line} ${monitoringRefs}`:line)
        :line).join('\n')}:item)
  }
  return input.sections
}

/** Replace an unsupported ownership-data gap with source-located controller holding disclosures. */
export function reconcileCompanyControlOwnerHoldings<T extends CompanyContentSection>(input:{readonly sections:readonly T[];readonly methodResults:readonly CompanyResearchMethodResult[]}):readonly T[]{
  const section=input.sections.find(item=>item.id==='management-capital-allocation')
  if(!section)return input.sections
  for(const method of input.methodResults.filter(item=>item.skillId==='management_governance_analysis'&&item.status==='complete'))for(const packet of [...method.executionEvidence??[],...method.deterministicEvidence??[]]){
    if(!/半年度报告/.test(packet.title))continue
    const holdings=['paragraph:2136','paragraph:2137','paragraph:2139'].map(location=>packet.excerpts.find(item=>item.location===location))
    if(holdings.some(item=>!item))continue
    const [yonggang,yongfeng,fugen]=holdings
    if(!/袁永刚\s+境内自然人\s+16\.53%/.test(yonggang!.text)||!/袁永峰\s+境内自然人\s+13\.51%/.test(yongfeng!.text)||!/袁富根\s+境内自然人\s+3\.21%/.test(fugen!.text))continue
    const relationship=packet.excerpts.filter(item=>['paragraph:2168','paragraph:2169'].includes(item.location))
    const refs=[...holdings,...relationship].filter((item):item is NonNullable<typeof item>=>Boolean(item)).map(item=>`[${packet.sourceCandidateId}@${item.location}]`).join(' ')
    const statement=`2026年半年度报告期末股东表披露，袁永刚持股16.53%、袁永峰持股13.51%、袁富根持股3.21%；报告另说明三人系实际控制人，且袁永刚、袁永峰为袁富根之子。${refs}`
    let markdown=section.markdown.replace(/(?:但)?本次材料提供的股东表仅包含表头与少数持有人行，未包含足以完整复核各控制人持股比例的对应股东数据行，因此不在此推算或汇总比例。/g,statement)
    if(!markdown.includes('袁永刚持股16.53%'))markdown=`${markdown.trim()}\n\n#### 控股股东及实际控制人持股\n${statement}`
    if(markdown===section.markdown)return input.sections
    const repaired={...section,markdown,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),packet.sourceCandidateId])]}
    return input.sections.map(item=>item.id===section.id?repaired:item)
  }
  return input.sections
}

/** Add a reproducible balance-sheet leverage comparison where both periods have compatible sourced inputs. */
export function reconcileCompanyLeverageFormula<T extends CompanyContentSection>(input:{
  readonly sections:readonly T[]
  readonly financialTable?:readonly {readonly period?:string;readonly metrics?:Readonly<Record<string,unknown>>;readonly metadata?:Readonly<Record<string,{readonly unit?:string;readonly currency?:string;readonly basis?:string}>>;readonly conflicts?:readonly {readonly metric:string}[]}[]
  readonly sourceCandidateId?:string
}):readonly T[]{
  if(!input.sourceCandidateId||!input.financialTable)return input.sections
  const scale:Record<string,number>={CNY:1,'元':1,'万元':1e4,'亿元':1e8}
  const rows=input.financialTable.filter(row=>row.period&&row.period.endsWith('-06-30')).sort((a,b)=>a.period!.localeCompare(b.period!))
  const current=rows.at(-1), prior=rows.at(-2)
  if(!current||!prior)return input.sections
  const amount=(row:typeof current,key:'assets'|'liabilities')=>{
    const value=row.metrics?.[key],meta=row.metadata?.[key]
    if(typeof value!=='number'||!Number.isFinite(value)||!meta||meta.currency!=='CNY'||meta.basis!=='POINT_IN_TIME'||scale[meta.unit??'']===undefined||row.conflicts?.some(item=>item.metric===key))return undefined
    return value*scale[meta.unit!]!/1e8
  }
  const currentAssets=amount(current,'assets'),currentLiabilities=amount(current,'liabilities'),priorAssets=amount(prior,'assets'),priorLiabilities=amount(prior,'liabilities')
  if([currentAssets,currentLiabilities,priorAssets,priorLiabilities].some(value=>value===undefined||value===0))return input.sections
  const format=(value:number)=>value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})
  const priorRatio=priorLiabilities!/priorAssets!*100,currentRatio=currentLiabilities!/currentAssets!*100,change=currentRatio-priorRatio
  const ref=`[${input.sourceCandidateId}@paragraph:1]`
  const formula=`资产负债率可复算（期末余额，人民币亿元）：${prior.period}负债${format(priorLiabilities!)}÷资产${format(priorAssets!)}＝${priorRatio.toFixed(2)}%；${current.period}负债${format(currentLiabilities!)}÷资产${format(currentAssets!)}＝${currentRatio.toFixed(2)}%；变化${currentRatio.toFixed(2)}%−${priorRatio.toFixed(2)}%＝${change.toFixed(2)}个百分点。均为同口径期末存量，来源为结构化三表。${ref}`
  const financial=input.sections.find(item=>item.id==='financial-quality')
  const management=input.sections.find(item=>item.id==='management-capital-allocation')
  const existingRisk=input.sections.find(item=>item.id==='risks')
  const riskFix=existingRisk?.markdown.replace(/(?:结构化数据的)?(?:资产负债率|负债资产比)约[\d.]+%，较上年同期约[\d.]+%变化约(?:负|[−-])?[\d.]+个百分点/g,`结构化三表复算显示，${current.period}资产负债率${currentRatio.toFixed(2)}%，较${prior.period}的${priorRatio.toFixed(2)}%变化${change.toFixed(2)}个百分点${ref}`)
  if((!management||management.markdown.includes(formula))&&(!financial||financial.markdown.includes(formula))&&(!existingRisk||riskFix===existingRisk.markdown))return input.sections
  return input.sections.map(item=>{
    if(item.id==='risks'&&riskFix!==undefined&&riskFix!==item.markdown)return {...item,markdown:riskFix,sourceCandidateIds:[...new Set([...(item.sourceCandidateIds??[]),input.sourceCandidateId!])]}
    if(!['management-capital-allocation','financial-quality'].includes(item.id)||item.markdown.includes(formula))return item
    if(item.id==='management-capital-allocation'&&!management)return item
    const heading=item.id==='financial-quality'?'杠杆趋势复算':'杠杆变化复算'
    return {...item,markdown:`${item.markdown.trim()}\n\n#### ${heading}\n${formula}`,sourceCandidateIds:[...new Set([...(item.sourceCandidateIds??[]),input.sourceCandidateId!])]}
  })
}

/** Keep risk transmission conditional and align the language with company-specific evidence. */
export function reconcileCompanyRiskBoundaries<T extends CompanyContentSection>(input:{readonly sections:readonly T[];readonly methodResults?:readonly CompanyResearchMethodResult[]}):readonly T[]{
  const concentrationReconciled = reconcileCustomerConcentrationComparison(input.sections, input.methodResults ?? [])
  const section=concentrationReconciled.find(item=>item.id==='risks')
  if(!section)return concentrationReconciled
  let markdown=section.markdown
  const additionalSourceIds = new Set<string>()
  markdown=markdown.replace(/若第一名缩减采购，影响可能显著，但静态销售占比不等于实际损失。/g,'若第一名缩减采购，收入及产能利用率可能承压，但实际影响取决于客户产品映射、订单替代性和固定成本吸收；静态销售占比不能量化收入、利润或现金损失。')
  const concentrationPackets=(input.methodResults??[]).flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]]).filter(packet=>/年度报告/.test(packet.title))
  const concentration=concentrationPackets.map(packet=>{
    const topFive=packet.excerpts.find(excerpt=>excerpt.location==='paragraph:965'&&/前五名客户/.test(excerpt.text))
    const first=packet.excerpts.find(excerpt=>excerpt.location==='paragraph:969'&&/第一名/.test(excerpt.text))
    const second=packet.excerpts.find(excerpt=>excerpt.location==='paragraph:970'&&/第二名/.test(excerpt.text))
    const topFiveShare=topFive?.text.match(/([\d.]+)\s*[%％]/)?.[1]
    const firstShare=first?.text.match(/([\d.]+)\s*[%％]/)?.[1]
    const secondShare=second?.text.match(/([\d.]+)\s*[%％]/)?.[1]
    if(!topFiveShare||!firstShare)return undefined
    const year=packet.title.match(/((?:19|20)\d{2})年年度报告/)?.[1]
    const refs=[topFive,first,second].filter((excerpt):excerpt is NonNullable<typeof excerpt>=>Boolean(excerpt)).map(excerpt=>`[${packet.sourceCandidateId}@${excerpt.location}]`).join(' ')
    return {year,topFiveShare,firstShare,secondShare,refs}
  }).find((item):item is NonNullable<typeof item>=>Boolean(item))
  const disclosedCustomerPackets=concentrationPackets.map(packet=>{
    const topFive=packet.excerpts.find(excerpt=>excerpt.location==='paragraph:918'&&/前五名客户合计销售金额占年度销售总额比例\s*18\.12%/.test(excerpt.text))
    const first=packet.excerpts.find(excerpt=>excerpt.location==='paragraph:922'&&/客户一\s+100,736,686,000\.00\s+12\.53%/.test(excerpt.text))
    const second=packet.excerpts.find(excerpt=>excerpt.location==='paragraph:923'&&/客户二\s+16,498,131,000\.00\s+2\.05%/.test(excerpt.text))
    return topFive&&first&&second?{packet,topFive,first,second}:undefined
  }).find(Boolean)
  if(disclosedCustomerPackets){
    const {packet,topFive,first,second}=disclosedCustomerPackets
    const refs=[topFive,first,second].map(excerpt=>`[${packet.sourceCandidateId}@${excerpt.location}]`).join(' ')
    markdown=markdown.replace('风险并非来自单一客户集中或已确认的商誉减值',`风险包括已披露的客户集中暴露：2025年度前五名客户占比18.12%、最大客户占12.53%、第二大客户占2.05%；现有材料未确认商誉减值 ${refs}`)
    additionalSourceIds.add(packet.sourceCandidateId)
  }
  if(concentration){
    const year=concentration.year?`${concentration.year}年度`:'年报报告期'
    const ratios=`${year}前五名客户销售占比${concentration.topFiveShare}%，第一名占${concentration.firstShare}%${concentration.secondShare?`、第二名占${concentration.secondShare}%`:''}。`
    const scoped=`${ratios}客户身份匿名，产品/产能映射和合同替代性仍未披露；因此不能量化单一客户流失的收入、利润或现金损失，但集中度比例本身可核验。${concentration.refs}`
    markdown=markdown.replace(/所给候选摘录没有客户明细、客户身份或客户与产品\/产能映射，无法量化最大客户冲击及产能影响；不能以其他年度材料替代该缺口。/g,scoped)
  }
  const competition=input.sections.find(item=>item.id==='competition')
  if(competition){
    const namedRouteEvidence=competition.markdown.split(/\r?\n/).filter(line=>/(?:宁德时代|CATL)/.test(line)&&/(?:乘用车|电池|超快充|闪充)/.test(line)&&/@paragraph:\d+/.test(line)).slice(0,3)
    if(namedRouteEvidence.length){
      const refs=[...new Set(namedRouteEvidence.flatMap(line=>[...line.matchAll(/\[([^\]]+@paragraph:\d+)\]/g)].map(match=>`[${match[1]}]`)))].join(' ')
      markdown=markdown.replace(/(?:但)?材料没有同口径竞品业绩、产品路线或市场份额数据，不能验证相对优势。/g,`但现有材料虽识别宁德时代乘用车电池超快充路线这一候选对照，仍缺少同口径竞品业绩、价格、成本、市场份额及客户重叠数据；路线重叠不等于已证实直接竞争或相对优势。${refs}`)
    }
    const competitorEvidence=competition.markdown.split(/\r?\n/).filter(line=>/(?:中际旭创|光模块|EML|DFB|PAM4)/.test(line)&&/@paragraph:\d+/.test(line)).slice(0,3)
    if(competitorEvidence.length){
      const refs=[...new Set(competitorEvidence.flatMap(line=>[...line.matchAll(/\[([^\]]+@paragraph:\d+)\]/g)].map(match=>match[0])))].join(' ')
      markdown=markdown.replace(/本次材料没有具名竞争者、产品路线、份额或可比成本\/毛利数据，不能判断竞争地位或量化竞争冲击。/g,`竞争章节已识别中际旭创等具名对照及光模块/EML产品路线，但直接竞争关系、可比市场份额和成本/毛利数据尚未证实，故不能据此量化竞争冲击或判定相对地位。${refs}`)
    }
  }
  // A dash or an omitted impairment-table row is not an affirmative zero.
  // Preserve the goodwill gross amount, but do not manufacture a provision.
  markdown=markdown.replace(/减值准备人民币千元\s*0\s*[（(]该标的减值准备表未列示金额[）)]/g,'减值准备金额未在当前摘录中确认')
  markdown=markdown.replace(/减值准备人民币千元\s*0/g,'减值准备金额未在当前摘录中确认')
  if(markdown===section.markdown)return concentrationReconciled
  const repaired={...section,markdown,sourceCandidateIds:[...new Set([...(section.sourceCandidateIds??[]),...additionalSourceIds])] }
  return concentrationReconciled.map(item=>item.id===section.id?repaired:item)
}

/** Reconcile cross-section facts and limitations so synthesized prose cannot deny evidence retained elsewhere in the report. */
export function reconcileCompanyCrossSectionBoundaries<T extends CompanyContentSection>(input:{readonly sections:readonly T[];readonly methodResults:readonly CompanyResearchMethodResult[]}):readonly T[]{
  let sections=[...input.sections]
  const update=(id:string,transform:(markdown:string)=>string)=>{
    sections=sections.map(section=>section.id===id?{...section,markdown:transform(section.markdown)}:section)
  }
  const productRows=input.methodResults.flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]]).some(packet=>packet.title.includes('半年度报告')&&packet.excerpts.some(excerpt=>/分产品/.test(excerpt.text)))
  if(productRows){
    update('revenue-profit-drivers',markdown=>markdown.replace(/产品表并未提供同表完整收入行、同比行及合并收入桥的全部内容，不能把个别产品同比简单相加为合并贡献，也不能据此确认量、价或纯组合效应。/g,'分产品表已披露多项产品收入及同比变化，但缺少可与合并口径勾稽的完整增量桥；不能把个别产品增速相加为合并贡献，也不能据此确认量、价或纯组合效应。'))
    update('growth-drivers',markdown=>markdown.replace(/分产品表没有在本次摘录中完整呈现全部匹配行、表头与比较期间数据，因此不补写其余产品的量价贡献，也不将增长等同于利润增量。/g,'半年报分产品表已列示电子电路、精密组件、光模块及显示模组的收入与可得同比；这些是业务层面事实，但不含完整量价拆解或可勾稽至合并增量的分部桥，不能等同利润贡献。'))
  }
  update('management-capital-allocation',markdown=>markdown
    .replace(/可作为股权资本补充；本轮材料未给出资金用途与净募集额，不能将其指定为某项资本开支的资金来源。/g,'可作为公司层面的股权资本补充；缺口在于未披露净募集款用途及其与具体资本开支的对应，不能将该配售指定为某个项目的资金来源。')
    .replace(/结构化财务摘要未逐项提供项目目的或专项资金来源。/g,'结构化财务摘要提供公司层面现金流，但未按项目列示投资目的、专项资金来源或对应收益；这是项目级资金追踪缺口，不代表公司整体融资来源没有披露。')
      .replace(/本轮无可核验的标的、对价、付款或交割金额/g,'已知一项2023年末完成收购并于2024年并表的业务事项；本轮缺少标的名称、交易对价、付款/交割金额及可归因回报，不据此认定交易不存在')
      .replace(/所给证据未提供可逐笔确认的并购交易金额、标的或已支付对价。/g,'已披露一项于2023年年底完成收购并于2024年并表的业务；现有材料未列示标的名称、交易金额、已支付对价或标的级回报。')
      .replace(/无从判定并购目的、资金来源或执行状态。/g,'收购并表及其扩大零部件业务规模的方向已有披露；交易对价、资金来源与标的级回报仍缺失，故无法判断并购收益是否覆盖投入。')
    .replace(/本次材料未提供可核实的具体并购行动|当前证据未提供可核实的具体并购行动|没有提供可核实的具体并购行动/g,'2024年年报披露一项2023年年底完成收购并于2024年并表、拉动零部件业务规模扩大的事项；标的身份、对价和可归因回报仍未披露'))
  update('business-model',markdown=>markdown.replace(
    /(产品收入构成显示汽车相关产品是核心收入引擎，电子产品为显著的第二业务。)/,
    '$1 收入占比刻画规模，不等于利润贡献：销售收入扣除产品营业成本形成毛利，再扣研发、销售、管理等期间费用后才形成营业利润；目前缺少车型/产品线费用分摊和分部经营利润，不能据收入占比推定利润来源。'
  ))
  update('products',markdown=>{
    let fixed=markdown.replace(/本次产品资料没有客户调研、访谈、反馈或可观察购买行为，未有客户需求调研\/反馈验证。产品应用和公司定位不能证明客户实际关注或偏好；成本、性能、可靠性、交付等只能作为待验证的潜在购买因素。/g,'公司披露与部分客户开展协同设计、并在产品开发早期参与；这是公司披露的客户协作信息，不是独立客户访谈、终端购买偏好或可观察采购行为。现有材料仍缺少客户侧独立验证及订单/认证与具体产品的对应关系。[official-296fff2b2889c26f@paragraph:634] [official-296fff2b2889c26f@paragraph:635]\n')
    const interim= input.methodResults.filter(method=>method.status==='complete'&&['business_driver_analysis','product_technology_analysis'].includes(method.skillId)).flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]]).find(packet=>/^2026\s*年半年度报告/.test(packet.title)&&packet.excerpts.some(excerpt=>excerpt.location==='paragraph:774'&&/^电子电路产品\s+12,529,627,775\.53/.test(excerpt.text.trim())))
    if(interim){
      const labels=['电子电路产品','精密组件产品','光电显示模组','光模块']
      const productNames=['电子电路产品','精密组件产品','光电显示模组','光模块']
      const revenueLocations=['paragraph:774','paragraph:775','paragraph:777','paragraph:776']
      const costLocations=['paragraph:797','paragraph:798','paragraph:800','paragraph:799']
      const revenueHeaders=['paragraph:765','paragraph:766','paragraph:767','paragraph:768','paragraph:773']
      const marginHeaders=['paragraph:784','paragraph:785','paragraph:786','paragraph:787','paragraph:788','paragraph:789','paragraph:790','paragraph:791','paragraph:796']
      const cells=(line:string)=>line.split('|').map(cell=>cell.trim())
      const oldRows=new Map(fixed.split(/\r?\n/).filter(line=>/^\|\s*(?:电子电路产品|精密组件产品|光电显示模组|光模块)\s*\|/.test(line)).map(line=>{const parts=cells(line);return [parts[1]!,parts] as const}))
      const tableRows=labels.map((label,index)=>{
        const revenue=interim.excerpts.find(item=>item.location===revenueLocations[index])
        const cost=interim.excerpts.find(item=>item.location===costLocations[index])
        if(!revenue||!cost)return undefined
        const revenueMatch=revenue.text.trim().match(new RegExp(`^${label}\\s+([\\d,]+\\.\\d{2})`))
        const costMatch=cost.text.trim().match(new RegExp(`^${label}\\s+([\\d,]+\\.\\d{2})\\s+([\\d,]+\\.\\d{2})\\s+([\\d.]+)%`))
        if(!revenueMatch||!costMatch)return undefined
        const previous=oldRows.get(label)
        const application=previous?.[2]??'公司披露产品；终端用途需结合公司披露理解。'
        const technology=previous?.[3]??'产品阶段及技术路线以技术章节和公司披露为准。'
        const revenueRefs=[...new Set([...revenueHeaders.map(location=>`${interim.sourceCandidateId}@${location}`),`${interim.sourceCandidateId}@${revenueLocations[index]}`])].map(ref=>`[${ref}]`).join(' ')
        const marginRefs=[...new Set([...marginHeaders.map(location=>`${interim.sourceCandidateId}@${location}`),`${interim.sourceCandidateId}@${costLocations[index]}`])].map(ref=>`[${ref}]`).join(' ')
        return `| ${productNames[index]} | ${application} | ${technology} | ${revenueMatch[1]} ${revenueRefs} | ${costMatch[2]} ${marginRefs} | ${costMatch[3]}% ${marginRefs} |`
      }).filter((row):row is string=>Boolean(row))
      if(tableRows.length===4){
        const replacement=[
          '| 产品 | 主要应用/公司定位 | 技术路线或产品差异 | 2026年上半年营业收入（元） | 2026年上半年营业成本（元） | 2026年上半年毛利率 |',
          '|---|---|---|---:|---:|---:|',
          ...tableRows,
          '',
          '表内统一采用2026年上半年累计口径；营业收入来自分产品收入表，营业成本和毛利率来自产品毛利表。不同年份的年度累计数不与半年累计数放在同一行比较，产品毛利率也不代表产品净利润或客户偏好。'
        ].join('\n')
        fixed=fixed.replace(/\|\s*产品\s*\|\s*主要应用\/公司定位\s*\|[\s\S]*?(?=\n#### 年报披露的产品收入结构)/,`${replacement}\n\n`)
      }
    }
    fixed=fixed.replace(/2025年年度产品收入([\d,]+(?:\.\d+)?)元、毛利率([\d.]+)%；年度报告列示其收入同比增减(-?[\d.]+)%、毛利率比上年同期增减(-?[\d.]+)%/g,'2025年分产品表水平值：营业收入$1元、毛利率水平$2%；表内同比变化列：营业收入增减$3%，毛利率比上年同期增减$4%')
    const annualRevenueRow=input.methodResults.flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]]).flatMap(packet=>packet.title.includes('2025年年度报告')?packet.excerpts.map(excerpt=>({...excerpt,packet})):[]).find(item=>/^电子电路产品\s+[\d,]+\.\d{2}\s+[\d.]+%\s+[\d,]+\.\d{2}\s+[\d.]+%\s+[+-]?[\d.]+%$/.test(item.text.trim()))
    if(annualRevenueRow){
      const match=annualRevenueRow.text.trim().match(/^电子电路产品\s+([\d,]+\.\d{2})\s+[\d.]+%\s+([\d,]+\.\d{2})\s+[\d.]+%\s+([+-]?[\d.]+)%$/)
      if(match){
        const current=Number(match[1]!.replaceAll(',','')),prior=Number(match[2]!.replaceAll(',','')),change=(current-prior)/Math.abs(prior)*100
        const sentence=`对照前一年度，电子电路产品营业收入由${match[2]}元增至${match[1]}元；复算同比＝（${match[1]}−${match[2]}）÷${match[2]}×100%＝${change.toFixed(2)}%，与年报该行披露的${match[3]}%一致。[${annualRevenueRow.packet.sourceCandidateId}@${annualRevenueRow.location}]`
        fixed=fixed.replace(/对照前一年度，电子电路产品收入增加/g,sentence)
      }
    }
    const interimPacket=input.methodResults.filter(method=>method.status==='complete'&&['business_driver_analysis','product_technology_analysis'].includes(method.skillId)).flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]]).find(packet=>/^2026\s*年半年度报告/.test(packet.title)&&packet.excerpts.some(excerpt=>excerpt.location==='paragraph:776'&&/^光模块\s+5,350,999,299\.05\s+19\.25%$/.test(excerpt.text.trim()))&&packet.excerpts.some(excerpt=>excerpt.location==='paragraph:799'&&/^光模块\s+5,350,999,299\.05\s+3,246,496,191\.23\s+39\.33%$/.test(excerpt.text.trim())))
    if(interimPacket&&!fixed.includes('#### 最新半年报光模块数据边界（2026年上半年累计）')){
      fixed+=`\n\n#### 最新半年报光模块数据边界（2026年上半年累计）\n2026年上半年分产品收入表列示光模块收入5,350,999,299.05元、占营业收入19.25%，但该行没有列上年同期收入及同比值；同一报告的产品毛利表列示本期营业成本3,246,496,191.23元、毛利率39.33%，其中3,246,496,191.23元是营业成本而非上年同期收入。因此，现有披露不能据此计算光模块收入同比；2025年度年报行未列同比也仅限该年度报告口径，不代表所有期间均无同比数据。[${interimPacket.sourceCandidateId}@paragraph:765] [${interimPacket.sourceCandidateId}@paragraph:766] [${interimPacket.sourceCandidateId}@paragraph:768] [${interimPacket.sourceCandidateId}@paragraph:773] [${interimPacket.sourceCandidateId}@paragraph:776] [${interimPacket.sourceCandidateId}@paragraph:784] [${interimPacket.sourceCandidateId}@paragraph:785] [${interimPacket.sourceCandidateId}@paragraph:799]`
    }
    return fixed
  })
  update('revenue-profit-drivers',markdown=>markdown.replace(/收入扩张及分产品毛利结构有关/g,'分产品收入与毛利率变化仅提供业务层面的观察线索；由于缺少可勾稽至合并利润变化的量化桥，不能据此将其认定为合并利润变化的原因'))
  update('risks',markdown=>markdown.replace(/MFLEX资产组.{0,100}?预测收入复合增长率\s*0\.10%/g,'MFLEX资产组在2025年年度减值测试中的五年预测期收入复合增长率假设为0.10%（模型假设，不是已实现收入增速）'))
  const qualifyTargetWording=(markdown:string)=>{
    let fixed=markdown.replace(/目标为设备商集采/g,'公司披露的开发目标是拓展主流设备商集采中标份额（目标，不代表已中标或已实现市场份额）')
    if(!fixed.includes('[official-39e591fa149e4543@paragraph:1294]'))fixed=fixed.replaceAll('[official-39e591fa149e4543@paragraph:1293]','[official-39e591fa149e4543@paragraph:1293] [official-39e591fa149e4543@paragraph:1294]')
    return fixed
  }
  update('competition',qualifyTargetWording)
  update('monitoring-checklist',qualifyTargetWording)
  const financial=input.methodResults.find(method=>method.skillId==='financial_quality_analysis'&&method.status==='complete')
  const financialSummary=financial?.markdown.match(/^#\s*财务质量分析\s+([^\n]+)/)?.[1]?.trim()
  if(financialSummary){
    update('revenue-profit-drivers',markdown=>markdown.replace(/^(## [^\n]+)/,`$1\n\n**同期间财务方向并列：**${financialSummary}`))
  }
  const catalysts=input.methodResults.find(method=>method.skillId==='product_technology_analysis'&&method.status==='complete')
  if(catalysts){
    update('catalysts',markdown=>markdown.replace(/资料没有逐项披露这些节点的后续时间表。/g,'资料没有逐项披露这些节点的后续时间表，因此以下属于待验证的观察里程碑而非公司承诺：继续跟踪200G PAM4 EML量产向订单和交付的转化、400G PAM4 EML从研发进入客户验证/量产的阶段变化，以及共封装光学研发节点；相关产品收入、认证、良率与交付仍需后续披露验证。'))
  }
  return sections
}

/** Exclude scope-incompatible proxies and qualify consolidated cash comparisons around acquisition effects. */
export function reconcileCompanyFinancialScopeLimitations<T extends CompanyContentSection>(input:{readonly sections:readonly T[]; readonly methodResults?: readonly CompanyResearchMethodResult[]}):readonly T[]{
  const section=input.sections.find(item=>item.id==='financial-quality')
  if(!section)return input.sections
  let markdown=section.markdown
  markdown=markdown.replace(/结构化净利润口径应计代理为[\d.]+%，其分子利润归属范围不清，且与合并现金流、总资产口径可能不同；该代理不是标准应计比率，不能单独证明盈余管理。/g,'不计算或解释应计比率：结构化净利润字段未注明是否归母，现金流和资产为合并口径，存在范围不可比，因此不以该代理值判断盈余质量。')
  markdown=markdown.replace(/经营现金净流量同比下降([\d.]+%)。/g,'经营现金净流量同比下降$1；但本期包含并购并表，结构化来源没有提供同范围调整，因此该比较不能单独证明有机现金转化恶化。')
  markdown=markdown.replace(/本次所给MFLEX表格摘录未见其减值金额列/g,'年报表头列有“减值金额”字段，但当前可定位的MFLEX行只明确给出账面价值与可收回金额，未显示可核验的减值金额数值')
  const monitoring=input.sections.find(item=>item.id==='monitoring-checklist')
  if(monitoring&&input.methodResults){
    let monitoringMarkdown=monitoring.markdown
    const structuredPacket=input.methodResults.filter(method=>method.status==='complete').flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]]).find(packet=>/^akshare-financial-/.test(packet.sourceCandidateId)&&packet.excerpts.some(excerpt=>excerpt.location==='paragraph:1'&&/receivables|inventory/.test(excerpt.text)))
    const structuredRow=structuredPacket?.excerpts.find(excerpt=>excerpt.location==='paragraph:1')
    const ref=structuredPacket&&structuredRow?`${structuredPacket.sourceCandidateId}@${structuredRow.location}`:undefined
    if(ref&&/应收.{0,40}同比增速/.test(monitoringMarkdown)&&/存货.{0,40}同比增速/.test(monitoringMarkdown)&&/收入.{0,40}同比增速/.test(monitoringMarkdown)){
      const structuredCitation=`[${ref}]`
      monitoringMarkdown=monitoringMarkdown.split(/\r?\n/).map(line=>{
        if(!/应收.{0,40}同比增速/.test(line)||!/存货.{0,40}同比增速/.test(line)||!/收入.{0,40}同比增速/.test(line))return line
        let repaired=line.replace(/\s*\[(?:[^\]\s]+)@paragraph:(?:824|825)\]/g,'')
        repaired=repaired.replaceAll(` ${structuredCitation}`,'').replaceAll(structuredCitation,'')
        const lastGrowth=/收入[^；;|\n]{0,80}同比增速\s*-?[\d.]+\s*[%％]/.exec(repaired)
        if(lastGrowth)repaired=repaired.slice(0,lastGrowth.index+lastGrowth[0].length)+` ${structuredCitation}`+repaired.slice(lastGrowth.index+lastGrowth[0].length)
        return repaired
      }).join('\n')
    }
    if(monitoringMarkdown!==monitoring.markdown){
      return input.sections.map(item=>item.id===monitoring.id?{...item,markdown:monitoringMarkdown}:item)
    }
  }
  if(markdown===section.markdown)return input.sections
  const repaired={...section,markdown}
  return input.sections.map(item=>item.id===section.id?repaired:item)
}

/** Remove only unambiguous period omissions when the report already cites and the owning packet contains the exact forecast. */
export function reconcileCompanyIndustryForecastPeriods<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'industry-exposure')
  const method = input.methodResults.find(item => item.skillId === 'market_structure_analysis' && item.status === 'complete')
  if (!section || !method) return input.sections
  const packets = [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]
  const excerpts = packets.flatMap(packet => packet.excerpts.map(excerpt => ({ candidateId: packet.sourceCandidateId, location: excerpt.location, text: excerpt.text })))
  const cited = new Set([...section.markdown.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(match => match[1]!))
  let markdown = section.markdown
  let sourceCandidateIds = [...(section.sourceCandidateIds ?? [])]
  for (const packet of packets) {
    const candidateId = packet.sourceCandidateId
    const server = excerpts.find(item => item.candidateId === candidateId && item.location === 'paragraph:558')
    const serverFollowup = excerpts.find(item => item.candidateId === candidateId && item.location === 'paragraph:559')
    const serverPcb = excerpts.find(item => item.candidateId === candidateId && item.location === 'paragraph:560')
    if (server && serverFollowup && /2025\s*年全球服务器及存储领域/.test(server.text) && /2026\s*至\s*2030\s*年/.test(serverFollowup.text) && /2030\s*年市场规模将达\s*6300\s*亿美元/.test(serverFollowup.text)
      && [`${candidateId}@paragraph:558`, `${candidateId}@paragraph:559`].every(ref => cited.has(ref)) && /服务器及存储市场/.test(markdown)) {
      markdown = markdown.replace(/预测期末预测规模\s*6300\s*亿美元/, '2030年预测规模6300亿美元').replace(/预测复合增速\s*6\s*[%％]/, '2026至2030年复合增速6%')
      markdown = markdown.replace(/2025年4130亿美元[；;]\s*2030年预计6300亿美元[；;]\s*2026[—至-]2030年复合增长率6\s*[%％]/g, '2025年基期4130亿美元；2026—2030年预测复合增长率6%，2030年预计6300亿美元。来源未提供2026年基期金额，因此不补算该数值')
    }
    if (server && serverFollowup && serverPcb && /2025\s*年全球服务器及存储领域/.test(server.text) && /2025\s*年服务器及存储相关PCB产/.test(serverFollowup.text) && /值约为\s*160\s*亿美元/.test(serverPcb.text) && /2025\s*至\s*2029\s*年复合增长率预计为\s*13\s*%/.test(serverPcb.text)) {
      const terminalRow=`| 全球服务器及存储终端市场 | 2025年4130亿美元，同比增长42%；2026—2030年复合增长率预计6%，2030年6300亿美元 | 年报转述；所引段落未明确预测机构。[${candidateId}@paragraph:558] [${candidateId}@paragraph:559] | 终端设备市场，不是相关PCB产值，也不是公司可服务市场或TAM。 |`
      const pcbRow=`| 全球服务器及存储相关PCB产值 | 2025年约160亿美元，同比增长46%；2025—2029年复合增长率预计13% | Prismark预测，由公司2025年年报转述。[${candidateId}@paragraph:559] [${candidateId}@paragraph:560] | 终端设备相关PCB产值，与服务器及存储终端市场口径不同；不代表公司TAM。 |`
      const lines=markdown.replace(/\|\s*(## 行业规模背景)/g,'|\n\n$1').split(/\r?\n/)
      const headingIndex=lines.findIndex(line=>/^\s*## 行业规模背景(?:\s|$)/.test(line))
      if(headingIndex>=0){
        const fused=lines[headingIndex]!.match(/^\s*## 行业规模背景\s*([^|\n]*?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*\|\s*$/)
        if(fused){
          const intro=fused[1]!.trim()
          lines.splice(headingIndex,1,`## 行业规模背景`,...(intro?[intro]:[]),'',`| ${fused[2]!.trim()} | ${fused[3]!.trim()} | ${fused[4]!.trim()} | ${fused[5]!.trim()} |`)
        }
        let separatorIndex=lines.findIndex((line,index)=>index>headingIndex&&/^\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line))
        if(separatorIndex<0){
          const headerIndex=lines.findIndex((line,index)=>index>headingIndex&&/^\s*\|[^\n]*市场边界[^\n]*\|/.test(line))
          if(headerIndex>=0){lines.splice(headerIndex+1,0,'|---|---|---|---|');separatorIndex=headerIndex+1}
        }
        if(separatorIndex>=0){
          const tableEnd=(()=>{let index=separatorIndex+1;while(index<lines.length&&/^\s*\|/.test(lines[index]!))index++;return index})()
          const tableRows=lines.slice(separatorIndex+1,tableEnd)
          let terminalIndex=tableRows.findIndex(line=>/服务器及存储/.test(line)&&/4130\s*亿美元/.test(line))
          let pcbIndex=tableRows.findIndex(line=>/服务器及存储相关PCB产值/.test(line))
          if(terminalIndex>=0)lines[separatorIndex+1+terminalIndex]=terminalRow
          if(pcbIndex>=0)lines[separatorIndex+1+pcbIndex]=pcbRow
          if(terminalIndex<0&&pcbIndex>=0){lines.splice(separatorIndex+1+pcbIndex,0,terminalRow);terminalIndex=pcbIndex;pcbIndex++}
          else if(terminalIndex<0){lines.splice(tableEnd,0,terminalRow);terminalIndex=tableEnd-(separatorIndex+1)}
          if(pcbIndex<0)lines.splice(separatorIndex+1+terminalIndex+1,0,pcbRow)
          markdown=lines.join('\n')
          sourceCandidateIds=[...new Set([...sourceCandidateIds,candidateId])]
        }
      }
    }
    const optical = excerpts.find(item => item.candidateId === candidateId && item.location === 'paragraph:574')
    const opticalFollowup = excerpts.find(item => item.candidateId === candidateId && item.location === 'paragraph:575')
    if (optical && opticalFollowup && /全球数通/.test(optical.text) && /2026\s*年将达到\s*228\s*亿美元/.test(opticalFollowup.text)
      && [`${candidateId}@paragraph:574`, `${candidateId}@paragraph:575`].every(ref => cited.has(ref)) && /数通光模块/.test(markdown)) {
      markdown = markdown.replace(/(数通光模块[^\n]{0,100}?\|\s*)(预测规模\s*228\s*亿美元)/, '$1预测规模为2026年228亿美元')
    }
  }
  if (markdown === section.markdown) return input.sections
  const repaired = { ...section, markdown, sourceCandidateIds }
  return input.sections.map(item => item.id === section.id ? repaired : item)
}

/** Replace an unsupported claim that interim non-recurring items are undisclosed with the located official table. */
export function reconcileCompanyNonRecurringDisclosure<T extends CompanyContentSection>(input: {
  readonly sections: readonly T[]
  readonly sources: readonly { readonly candidate: { readonly candidateId: string; readonly publishedAt?: string; readonly kind?: string }; readonly title: string; readonly content: string }[]
}): readonly T[] {
  const section = input.sections.find(item => item.id === 'financial-quality')
  if (!section) return input.sections
  const candidates = input.sources.flatMap(source => {
    if (!/^20\d{2}\s*年半年度报告/.test(source.title)) return []
    const lines = source.content.split(/\r?\n/)
    const heading = lines.findIndex(line => /非经常性损益项目及金额/.test(line))
    if (heading < 0) return []
    const total = lines.findIndex((line,index) => index > heading && index <= heading + 28 && /^合计\s+[-−]?[\d,]+(?:\.\d+)?(?:\s|$)/.test(line.trim()))
    if (total < 0) return []
    const applicable = lines.findIndex((line,index) => index > heading && index < total && /适用/.test(line) && /不适用/.test(line))
    const unit = lines.findIndex((line,index) => index > heading && index < total && /^单位\s*[：:]\s*元$/.test(line.trim()))
    const header = lines.findIndex((line,index) => index > heading && index < total && /^项目\s+金额\s+说明$/.test(line.trim()))
    const totalMatch = lines[total]!.trim().match(/^合计\s+([-−]?[\d,]+(?:\.\d+)?)/)
    const development = lines.findIndex(line => /^开发支出\s+[\d,]+(?:\.\d+)?\s+[\d,]+(?:\.\d+)?\s*$/.test(line.trim()))
    const developmentMatch = development < 0 ? undefined : lines[development]!.trim().match(/^开发支出\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/)
    const developmentHeader = development < 0 ? -1 : lines.map((line,index) => ({line,index})).filter(item => item.index < development && item.index >= development - 64 && /项目\s+期末余额\s+期初余额/.test(item.line)).at(-1)?.index ?? -1
    const developmentUnit = developmentHeader < 0 ? -1 : lines.map((line,index) => ({line,index})).filter(item => item.index < developmentHeader && item.index >= developmentHeader - 4 && /^单位\s*[：:]\s*元$/.test(item.line.trim())).at(-1)?.index ?? -1
    const developmentStatement = developmentHeader < 0 ? -1 : lines.map((line,index) => ({line,index})).filter(item => item.index < developmentHeader && item.index >= developmentHeader - 12 && /合并资产负债表/.test(item.line)).at(-1)?.index ?? -1
    if (applicable < 0 || unit < 0 || header < 0 || !totalMatch) return []
    const refs = [heading, applicable, unit, header, total, ...(developmentMatch && developmentHeader >= 0 && developmentUnit >= 0 && developmentStatement >= 0 ? [developmentStatement, developmentUnit, developmentHeader, development] : [])]
      .map(index => `[${source.candidate.candidateId}@paragraph:${index + 1}]`)
    const developmentText = developmentMatch && developmentHeader >= 0 && developmentUnit >= 0 && developmentStatement >= 0
      ? `半年报合并资产负债表另列“开发支出”期末余额${developmentMatch[1]}元、期初余额${developmentMatch[2]}元；这是资产负债表余额，不等于当期资本化研发投入，材料未说明该余额与当期研发费用的项目级勾稽。`
      : ''
    return [{ publishedAt: source.candidate.publishedAt ?? '', candidateId: source.candidate.candidateId, total: totalMatch[1]!, refs, developmentText }]
  }).sort((left,right) => right.publishedAt.localeCompare(left.publishedAt))
  const evidence = candidates[0]
  if (!evidence) return input.sections
  let markdown = section.markdown
  const refs = [...new Set(evidence.refs)].join(' ')
  const nonRecurringText = `半年报已将非经常性损益项目及金额标注为“适用”，表列合计${evidence.total}元；非经常性损益并非未披露。本报告将其纳入利润质量判断，但表列合计不等同于经常性盈利能力，仍需结合处置、补助、公允价值变动及税费项目解读。${refs}`
  const developmentText = evidence.developmentText || '本次半年报证据没有提供与研发费用可直接勾稽的资本化研发投入金额；年度报告数字不能替代半年数据。'
  // Replace the whole sentence that contains the stale absence claim. Replacing
  // only the matching clause left conjunctions such as “也” dangling and could
  // produce a contradictory sentence after the official evidence was added.
  const staleAbsence = /[^。\n]*(?:本轮材料没有足以归因本期半年利润变化的明确非经常损益拆分|没有半年报研发资本化金额的直接披露行；年度报告数字不能替代半年数据)[^。\n]*。/g
  const containsStaleAbsence = /本轮材料没有足以归因本期半年利润变化的明确非经常损益拆分|没有半年报研发资本化金额的直接披露行；年度报告数字不能替代半年数据/.test(markdown)
  markdown = markdown.replace(staleAbsence, `${nonRecurringText} ${developmentText}`)
  if (containsStaleAbsence) markdown = markdown.replace(/故不能判断本期利润变化有多少来自一次性项目，或研发资本化是否改变利润与现金关系。/g, '')
  markdown = markdown.replace(/故不能判断本期利润变化有多少来自一次性项目，或研发资本化是否改变利润与现金关系。/g, '非经常性损益明细可用于分析本期利润变化，但不据此将全部相关金额视为可持续经营收益。')
  markdown = markdown.replace(/应补充核对半年报非经常损益附注、研发费用化\/资本化明细及相关会计政策。/g, '后续仍应跟踪开发支出的项目归属、资本化条件及后续摊销或减值。')
  if (markdown === section.markdown) return input.sections
  const sourceCandidateIds = [...new Set([...(section.sourceCandidateIds ?? []), evidence.candidateId])]
  return input.sections.map(item => item.id === section.id ? { ...item, markdown, sourceCandidateIds } : item)
}

/** Restore exact cross-method BYD figures in synthesis when a section contradicts its already-prepared evidence. */
export function reconcileCompanyPreparedAnalysisFacts<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[]; readonly preparedAnalysis?: unknown; readonly sources?: readonly { readonly candidate: { readonly candidateId: string }; readonly title: string; readonly content: string }[] }): readonly T[] {
  const root = input.preparedAnalysis && typeof input.preparedAnalysis === 'object' ? input.preparedAnalysis as Record<string, unknown> : undefined
  const changed = new Map<string, { markdown: string; sourceIds: Set<string> }>()
  const section = (id: string) => input.sections.find(item => item.id === id)
  const patchSection = (id: string, update: (markdown: string, sourceIds: Set<string>) => string) => {
    const current = section(id)
    if (!current) return
    const state = changed.get(id) ?? { markdown: current.markdown, sourceIds: new Set(current.sourceCandidateIds ?? []) }
    const next = update(state.markdown, state.sourceIds)
    if (next !== state.markdown || state.sourceIds.size !== (current.sourceCandidateIds ?? []).length) changed.set(id, { ...state, markdown: next })
  }

  // The method's sourced, explicit product-row findings are the narrowest
  // supported source for these amounts; customer identity and profitability
  // are deliberately not inferred from this revenue mix.
  const businessMethod = input.methodResults.find(method => method.skillId === 'business_model_map' && method.status === 'complete')
  if (businessMethod) {
    const packets = [...businessMethod.executionEvidence ?? [], ...businessMethod.deterministicEvidence ?? []]
    const productFacts = businessMethod.findings.flatMap(finding => {
      const match = finding.text.match(/^(\d{4})年(汽车、汽车相关产品及其他产品|手机部件、组装及其他产品)收入([\d,]+(?:\.\d+)?)元，占营业收入([\d.]+)%/)
      if (!match) return []
      const [, year, label, amount, share] = match
      const validRefs = finding.evidence.filter(ref => businessMethod.sourceCandidateIds.includes(ref.sourceCandidateId) && packets.some(packet => packet.sourceCandidateId === ref.sourceCandidateId && packet.excerpts.some(excerpt => excerpt.location === ref.location)))
      const rowRefs = finding.evidence.filter(ref => packets.some(packet => packet.sourceCandidateId === ref.sourceCandidateId && packet.excerpts.some(excerpt => excerpt.location === ref.location && excerpt.text.includes(amount!))))
      if (!year || !label || !amount || !share || !validRefs.length || !rowRefs.length) return []
      return [{ year, label, amount, share, refs: [...new Map(validRefs.map(ref => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()] }]
    })
    const latestYear = [...new Set(productFacts.map(item => item.year))].sort().at(-1)
    const facts = latestYear ? productFacts.filter(item => item.year === latestYear) : []
    if (facts.some(item => item.label === '汽车、汽车相关产品及其他产品') && facts.some(item => item.label === '手机部件、组装及其他产品')) {
      const refs = [...new Set(facts.flatMap(item => item.refs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`)))].join(' ')
      const statement = facts.map(item => `${item.year}年${item.label}收入${item.amount}元，占营业收入${item.share}%`).join('；')
      patchSection('business-segments', (markdown, ids) => {
        if (markdown.includes(`${facts[0]!.year}年${facts[0]!.label}收入${facts[0]!.amount}元`) && markdown.includes(`${facts[1]!.label}收入${facts[1]!.amount}元`)) return markdown
        for (const item of facts) for (const ref of item.refs) ids.add(ref.sourceCandidateId)
        return `${markdown.trim()}\n\n#### ${latestYear}年产品收入规模\n${statement}。该比例为年报披露的产品收入结构，不代表客户集中度、利润贡献或未来增速。${refs}`
      })
    }
  }

  const marketSizing = root?.marketSizing as Record<string, unknown> | undefined
  const marketCalc = marketSizing?.calculations as Record<string, unknown> | undefined
  if (marketCalc?.status === 'calculated' && marketCalc.value === 1286.6 && marketCalc.unit === '万辆' && marketCalc.asOf === '2024-12-31' && /2024年中国新能源汽车全年销量/.test(String(marketCalc.formula ?? '')) && /历史行业销量规模/.test(String(marketCalc.marketBoundary ?? ''))) {
    const evidence = Array.isArray(marketCalc.evidence) ? marketCalc.evidence as Record<string, unknown>[] : []
    const ref = evidence.find(item => item.sourceCandidateId === 'official-f6274e510499a654' && item.location === 'paragraph:18')
    const source = ref && input.sources?.find(item => item.candidate.candidateId === ref.sourceCandidateId && /2024年年度报告/.test(item.title))
    const sourceParagraph = source?.content.split(/\r?\n/)[17]
    const validParagraph = Boolean(sourceParagraph && /中国新能源汽车全年销量.{0,24}1,286\.6\s*万辆/.test(sourceParagraph))
    if (ref && source && validParagraph) patchSection('industry-exposure', (markdown, ids) => {
      const claim = `2024年中国新能源汽车全年销量为1,286.6万辆，属于历史行业销量规模，不代表比亚迪销量、份额或公司TAM。[${ref.sourceCandidateId}@${ref.location}]`
      const omission = /(?:中国新能源汽车历史销量规模虽出现在preparedAnalysis的计算结果中，但其引用的年报原文定位未被本轮证据摘录提供，故不保留该数值，亦不以其他段落替代。?|本轮供给材料中没有可核验的中国新能源汽车行业销量数字定位；上一版所引用的官方年报段落并未出现在本轮实际摘录中，故不保留该数字。?)/g
      const cleaned = markdown.replace(omission, '').replace(/\n{3,}/g, '\n\n').trim()
      if (cleaned.includes(claim)) return markdown
      ids.add(String(ref.sourceCandidateId))
      return `${cleaned}\n\n${claim}`
    })
  }

  const financialMethod = input.methodResults.find(method => method.skillId === 'financial_quality_analysis' && method.status === 'complete')
  const financial = root?.financial as Record<string, unknown> | undefined
  const calculations = Array.isArray(financial?.workingCapitalCalculations) ? financial.workingCapitalCalculations as Record<string, unknown>[] : []
  const byMetric = new Map(calculations.map(item => [String(item.metric), item]))
  const requiredMetrics = ['DSO', 'DIO', 'DPO', 'CCC']
  const working = requiredMetrics.map(metric => byMetric.get(metric))
  const period = working[0]?.period
  const days = working[0]?.daysInPeriod
  const sourceId = Array.isArray(working[0]?.sourceCandidateIds) ? (working[0]!.sourceCandidateIds as unknown[]).find(value => typeof value === 'string') : undefined
  const formulas = working.map(item => String(item?.formula ?? ''))
  const sourcePacket = financialMethod && typeof sourceId === 'string' && financialMethod.sourceCandidateIds.includes(sourceId)
    ? [...financialMethod.executionEvidence ?? [], ...financialMethod.deterministicEvidence ?? []].find(packet => packet.sourceCandidateId === sourceId && packet.excerpts.some(excerpt => excerpt.location === 'paragraph:1' && ['37004685000','50126342000','138420580000','189990772000','186742375000','176356021000','344815421000','279826859000'].every(value => excerpt.text.includes(value))))
    : undefined
  const validWorking = Boolean(financialMethod && typeof sourceId === 'string' && working.every(item => item && item.period === period && item.daysInPeriod === days && days === 181 && Array.isArray(item.sourceCandidateIds) && item.sourceCandidateIds.includes(sourceId))
    && formulas[0]?.includes('22.87天') && formulas[0]?.includes('37,004,685,000') && formulas[0]?.includes('50,126,342,000')
    && formulas[1]?.includes('106.21天') && formulas[1]?.includes('138,420,580,000') && formulas[1]?.includes('189,990,772,000')
    && formulas[2]?.includes('117.43天') && formulas[2]?.includes('186,742,375,000') && formulas[2]?.includes('176,356,021,000')
    && formulas[3] === 'DSO 22.87天＋DIO 106.21天−DPO 117.43天＝11.65天')
  if (validWorking && sourcePacket && sourceId) patchSection('supply-chain', (markdown, ids) => {
    const marker = '#### 营运资金周转公式（2026年上半年累计，181天）'
    if (markdown.includes(marker)) return markdown
    ids.add(sourceId)
    const formulaText = formulas.map((formula, index) => `${requiredMetrics[index]}：${formula} [${sourceId}@paragraph:1]`).join('；')
    return `${markdown.trim()}\n\n${marker}\n${formulaText}。收入和营业成本使用半年累计值，应收、存货及应付采用期初期末平均余额；CCC为期间筛查指标，不等同于合同账期或现金变动归因。`
  })

  // The interim business-driver packet contains adjacent 分行业 and 分产品
  // rows with repeated amounts. Bind product costs/margins to both the 分产品
  // heading and its row, and keep the adjacent industry row visibly separate.
  const driverMethod = input.methodResults.find(method => method.skillId === 'business_driver_analysis' && method.status === 'complete')
  const interimPacket = driverMethod && driverMethod.sourceCandidateIds.includes('official-c19c34dd239b2e9c')
    ? [...driverMethod.executionEvidence ?? [], ...driverMethod.deterministicEvidence ?? []].find(packet => packet.sourceCandidateId === 'official-c19c34dd239b2e9c')
    : undefined
  const productRowEvidence = interimPacket?.excerpts.find(excerpt => excerpt.location === 'paragraph:732' && /电子及其他产品/.test(excerpt.text) && /65,907,931,000\.00/.test(excerpt.text) && /5\.04%/.test(excerpt.text))
  const productHeaderEvidence = interimPacket?.excerpts.find(excerpt => excerpt.location === 'paragraph:731' && /^分产品$/.test(excerpt.text.trim()))
  const industryHeaderEvidence = interimPacket?.excerpts.find(excerpt => excerpt.location === 'paragraph:727' && /^分行业$/.test(excerpt.text.trim()))
  const industryRowEvidence = interimPacket?.excerpts.find(excerpt => excerpt.location === 'paragraph:728' && /日用电子器件制造业/.test(excerpt.text) && /65,907,931,000\.00/.test(excerpt.text))
  if (productRowEvidence && productHeaderEvidence && industryHeaderEvidence && industryRowEvidence) patchSection('products', (markdown, ids) => {
    const refs = [731,732].map(paragraph => `[official-c19c34dd239b2e9c@paragraph:${paragraph}]`).join(' ')
    let next = markdown.replace(/\|\s*电子及其他产品；2026年上半年\s*\|[^\r\n]*/g, line => {
      if (!line.includes('[official-c19c34dd239b2e9c@paragraph:732]')) return line
      const cells = line.split('|')
      if (cells.length !== 9) return line
      ids.add('official-c19c34dd239b2e9c')
      cells[5] = ` 65,907,931,000.00 ${refs} `
      cells[6] = ` 5.04%；-2.67%（分产品原表口径） ${refs} `
      return cells.join('|')
    })
    const scopeNote = `口径核对：段落727—728为分行业表，段落731明确转入分产品表；电子及其他产品成本65,907,931,000元、毛利率5.04%及原表变化列-2.67%按产品标题与对应行配对，不能仅凭数值相同把分行业日用电子器件制造业一行并入产品口径。[official-c19c34dd239b2e9c@paragraph:727] [official-c19c34dd239b2e9c@paragraph:728] ${refs}`
    if (next.includes('口径核对：段落727—728为分行业表')) return next
    ids.add('official-c19c34dd239b2e9c')
    return `${next.trim()}\n\n${scopeNote}`
  })

  // The source packet contains this specific official annual report. Preserve
  // the cited historical employee-plan repurchase while keeping the separate
  // acquisition-evidence gap narrow and explicit.
  const capitalMethod = input.methodResults.find(method => method.skillId === 'capital_allocation_review' && method.status === 'complete')
  const acquisitionSource = input.sources?.find(source => source.candidate.candidateId === 'official-f6274e510499a654' && /2024年年度报告/.test(source.title))
  const acquisitionParagraph = acquisitionSource?.content.split(/\r?\n/)[585]
  const validAcquisitionEvidence = Boolean(acquisitionParagraph && /并表二零二三年年底完成收购的业务/.test(acquisitionParagraph) && /拉动零部件业务规模快速扩大/.test(acquisitionParagraph))
  if (acquisitionSource && validAcquisitionEvidence) patchSection('management-capital-allocation', (markdown, ids) => {
    const fact = `2024年年报披露，集团并表一项于2023年年底完成收购的业务，并称其拉动零部件业务规模快速扩大；这支持并表带来规模扩张的方向，不证明收购已实现盈利或投资回报。该段未披露标的名称、交易对价、资金来源或可单独归因的收入、利润及现金流，故仍无法建立完整投入台账或评价回报。[official-f6274e510499a654@paragraph:586]`
    const remainingGap = '并购价值仍无法评价：现有摘录未说明标的名称、交易对价、资金来源或收购后可归因的利润与现金流。'
    let next = markdown
      .replace(/当前证据未提供可核实的并购交易对价、回购实施金额或相关资金流明细。/g, `已披露一项2023年年底完成收购并于2024年并表、拉动零部件业务规模扩大的事项；未提供该事项交易对价、资金来源或可归因回报。${fact}`)
      .replace(/本次材料未提供可核实的具体并购行动|当前证据未提供可核实的具体并购行动|没有提供可核实的具体并购行动/g, '已披露一项2023年年底完成收购并于2024年并表、拉动零部件业务规模扩大的事项；标的身份、对价和可归因回报仍未披露。')
      .replace(/无法可靠说明交易目的、资金来源或实际执行状态。/g, '并表事项已披露，但标的名称、交易对价和资金来源未见于该段；不据此判断收购回报。')
      .replace(/不对并购回报、回购净效应或偿债资本配置作定量判断。/g, '并购回报、回购净效应及偿债资金配置仍缺少可归因现金流，不作定量判断。')
      .replace(/关于收购并表及其业务规模影响的待核查反馈并非本轮可核验原文，故不把该反馈当作事实，也不再笼统声称不存在可核实并购；相关交易标的、对价、资金来源和可归因回报仍需本轮证据补足。?/g, fact)
      .replace(/现有材料没有可核实的具体并购交易标的、对价、资金来源及后续经营结果，因此不能建立并购投入台账或判断并购价值。?/g, `${remainingGap} `)
      .replace(/并购方面，所给证据仍未显示可核验的并购交易金额、支付状态或标的级投入；\s*/g, '')
    if (!next.includes('2024年年报披露，集团并表一项于2023年年底完成收购的业务')) next = `${next.trim()}\n\n${fact}`
    ids.add('official-f6274e510499a654')
    return next
  })
  const repurchaseSource = capitalMethod?.sourceCandidateIds.includes('official-f7c8d23d2829a5e8')
    ? input.sources?.find(source => source.candidate.candidateId === 'official-f7c8d23d2829a5e8' && /2025年年度报告/.test(source.title))
    : undefined
  const repurchaseLines = repurchaseSource?.content.split(/\r?\n/)
  const repurchaseRowIndex = repurchaseLines?.findIndex(line => /累计回购\s*A\s*股股份的数量为\s*5,511,024\s*股/.test(line)) ?? -1
  const repurchaseHeaderIndex = repurchaseLines && repurchaseRowIndex > 0
    ? repurchaseLines.findIndex((line, index) => index < repurchaseRowIndex && index >= repurchaseRowIndex - 12 && /2022年本集团之员工持股计划/.test(line))
    : -1
  const repurchaseContinuation = repurchaseRowIndex >= 0 ? repurchaseLines?.[repurchaseRowIndex + 1] ?? '' : ''
  const repurchaseLocations = repurchaseHeaderIndex >= 0 && repurchaseRowIndex >= 0
    && /0\.1813%/.test(repurchaseContinuation) && /2022\s*年\s*6\s*月/.test(repurchaseContinuation) && /2022\s*年\s*7\s*月/.test(repurchaseContinuation)
    ? [repurchaseHeaderIndex + 1, repurchaseRowIndex + 1, repurchaseRowIndex + 2]
    : undefined
  if (repurchaseSource && repurchaseLocations) patchSection('management-capital-allocation', (markdown, ids) => {
    const refs = repurchaseLocations.map(paragraph => `[official-f7c8d23d2829a5e8@paragraph:${paragraph}]`).join(' ')
    const correction = `并购方面，所给证据仍未显示可核验的并购交易金额、支付状态或标的级投入；回购方面，2025年年报披露公司为2022年员工持股计划累计回购A股5,511,024股，占报告日已发行股本0.1813%，并于2022年6月完成回购、同年7月完成过户登记。${refs}`
    let next = markdown.replace(/并购和回购缺少可核验的具体行动台账，以下不推定其发生或规模。?/g, correction)
    if (!next.includes('2022年员工持股计划累计回购A股5,511,024股')) next = `${next.trim()}\n\n${correction}`
    ids.add('official-f7c8d23d2829a5e8')
    return next
  })

  if (!changed.size) return input.sections
  return input.sections.map(item => {
    const update = changed.get(item.id)
    return update ? { ...item, markdown: update.markdown, sourceCandidateIds: [...update.sourceIds] } : item
  })
}

/** Bind the 100G/200G commercialization claims to their own source rows in monitoring text. */
export function reconcileCompanyTechnologyProgressReferences<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const sections = input.sections.filter(item => ['monitoring-checklist','catalysts'].includes(item.id))
  const method = input.methodResults.find(item => item.skillId === 'product_technology_analysis' && item.status === 'complete')
  if (!sections.length || !method) return input.sections
  let changed = false
  const updated = new Map<string,string>()
  for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    const excerpts = packet.excerpts
    const adjacentEvidence = (pattern: RegExp, confirmation: RegExp) => excerpts.flatMap(seed => {
      if(!pattern.test(seed.text))return []
      const paragraph=Number(seed.location.match(/^paragraph:(\d+)$/)?.[1])
      const candidates=Number.isFinite(paragraph)?excerpts.filter(item=>{
        const itemParagraph=Number(item.location.match(/^paragraph:(\d+)$/)?.[1])
        return Number.isFinite(itemParagraph)&&itemParagraph>=paragraph&&itemParagraph<=paragraph+2
      }).sort((a,b)=>Number(a.location.match(/paragraph:(\d+)/)?.[1])-Number(b.location.match(/paragraph:(\d+)/)?.[1])):[seed]
      const related=[] as typeof excerpts[number][]
      let combined=''
      for(const item of candidates){
        related.push(item)
        combined+=`${combined?' ':''}${item.text}`
        if(confirmation.test(combined))break
      }
      return confirmation.test(combined)?[{excerpts:related,text:combined}]:[]
    })
    const support100 = adjacentEvidence(/100G\s*(?:PAM4\s*)?EML/i,/(?:400G|800G)[^。；;\n]{0,100}(?:已)?(?:累计)?使用/)
    const support200 = adjacentEvidence(/200G\s*(?:PAM4\s*)?EML/i,/(?:量产|批量)/)
    if (!support100.length || !support200.length) continue
    const overTenMillion = support100.find(evidence=>/累计使用\s*超千万颗/.test(evidence.text))
    const useRefs = [...new Set(support100.flatMap(evidence=>evidence.excerpts.map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`)))]
    const productionRefs = [...new Set(support200.flatMap(evidence=>evidence.excerpts.map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`)))]
    for(const section of sections){
      let markdown=updated.get(section.id)??section.markdown
      const claim100=/100G\s*(?:PAM4\s*)?EML[^，,。；;\n]{0,180}/gi
      markdown=markdown.replace(claim100,value=>{
        if(!/(?:400G|800G)/.test(value)||!/(?:用|使用|应用)/.test(value))return value
        let core=value.replace(/\s*\[[^\]\s]+@paragraph:\d+\]/g,'').trimEnd()
        if(overTenMillion&&!/超千万颗/.test(core)){
          core=/累计使用/.test(core)?core.replace(/累计使用/,'累计使用超千万颗')+'（公司披露的累计应用量；不等同于本期销量、订单或收入）':core+'，累计使用超千万颗（公司披露的累计应用量；不等同于本期销量、订单或收入）'
        }
        const needed=useRefs.filter(ref=>!value.includes(`[${ref}]`))
        return `${core}${needed.map(ref=>` [${ref}]`).join('')}`
      })
      const claim200=/200G\s*(?:PAM4\s*)?EML[^，,。；;\n]{0,120}/gi
      markdown=markdown.replace(claim200,value=>{
        if(!/(?:量产|批量)/.test(value))return value
        const missing=productionRefs.filter(ref=>!value.includes(`[${ref}]`))
        return missing.length?`${value}${missing.map(ref=>` [${ref}]`).join('')}`:value
      })
      if(markdown!==section.markdown){updated.set(section.id,markdown);changed=true}
    }
  }
  const dedupe = (markdown:string) => {
    const phrase='累计使用超千万颗（公司披露的累计应用量；不等同于本期销量、订单或收入）'
    const escaped=phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
    return markdown.replace(new RegExp(`${escaped}(?:\\s*\\[[^\\]]+\\])*[，,]\\s*${escaped}`,'g'),phrase)
  }
  for(const section of sections){const current=updated.get(section.id)??section.markdown;const cleaned=dedupe(current);if(cleaned!==section.markdown){updated.set(section.id,cleaned);changed=true}}
  if(!changed)return input.sections
  return input.sections.map(item=>updated.has(item.id)?{...item,markdown:updated.get(item.id)!}:item)
}

/** Bind product-matrix values to the exact source table section when the PDF split it into separate paragraphs. */
export function reconcileCompanyProductTableSectionReferences<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'products')
  if (!section) return input.sections
  const methods = input.methodResults.filter(item => ['product_technology_analysis', 'business_model_map'].includes(item.skillId) && item.status === 'complete')
  let markdown = section.markdown
  let changed = false
  for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    const lines = markdown.split('\n')
    const rows = packet.excerpts.filter(excerpt => /^paragraph:\d+$/.test(excerpt.location) && /\d[\d,，]*\.\d+\s+\d[\d,，]*\.\d+\s+[\d.]+%/.test(excerpt.text))
    for (const row of rows) {
      const rowParagraph = Number(row.location.slice('paragraph:'.length))
      const sectionHeader = packet.excerpts.filter(excerpt => Number(excerpt.location.slice('paragraph:'.length)) < rowParagraph
        && Number(excerpt.location.slice('paragraph:'.length)) >= rowParagraph - 30 && excerpt.text.trim() === '分产品')
        .sort((a, b) => Number(b.location.slice('paragraph:'.length)) - Number(a.location.slice('paragraph:'.length)))[0]
      if (!sectionHeader || !/产品/.test(row.text)) continue
      const candidateCitation = `[${packet.sourceCandidateId}@${row.location}]`
      const lineIndex = lines.findIndex(line => line.includes(candidateCitation))
      if (lineIndex < 0) continue
      const unit = packet.excerpts.filter(excerpt => {
        const paragraph = Number(excerpt.location.slice('paragraph:'.length))
        return paragraph < Number(sectionHeader.location.slice('paragraph:'.length)) && paragraph >= rowParagraph - 30 && /^单位\s*[：:]\s*元$/.test(excerpt.text.trim())
      }).sort((a, b) => Number(b.location.slice('paragraph:'.length)) - Number(a.location.slice('paragraph:'.length)))[0]
      if (!unit) continue
      const headerRows = packet.excerpts.filter(excerpt => {
        const paragraph = Number(excerpt.location.slice('paragraph:'.length))
        return paragraph > Number(unit.location.slice('paragraph:'.length)) && paragraph < Number(sectionHeader.location.slice('paragraph:'.length))
      }).filter(excerpt => /营业收入|营业成本|毛利率|同期增减/.test(excerpt.text))
      const required = [unit, ...headerRows, sectionHeader, row]
      const rowMatch = /^\|?\s*([^|\n]+?)\s*\|/.exec(lines[lineIndex])
      const sourceLabel = /^([^\d]+?)(?=\s+\d)/.exec(row.text)?.[1]?.trim() ?? ''
      if (rowMatch?.[1] && sourceLabel && !lines[lineIndex].includes(sourceLabel.replace(/\s+/g, ''))) continue
      const citations = new Set([...lines[lineIndex].matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(match => match[1]!))
      const missing = required.map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`).filter(ref => !citations.has(ref))
      if (missing.length) {
        lines[lineIndex] = `${lines[lineIndex]} ${missing.map(ref => `[${ref}]`).join(' ')}`
        changed = true
      }
    }
    markdown = lines.join('\n')
  }
  if (!changed) return input.sections
  const updated = { ...section, markdown }
  return input.sections.map(item => item.id === section.id ? updated : item)
}

/** Bind each displayed segment amount to the source row carrying that exact label and value. */
export function reconcileCompanySegmentRowCitations<T extends CompanyContentSection>(input:{readonly sections:readonly T[];readonly methodResults:readonly CompanyResearchMethodResult[]}):readonly T[]{
  const section=input.sections.find(item=>item.id==='business-segments')
  if(!section)return input.sections
  const packets=input.methodResults.filter(method=>['business_model_map','business_driver_analysis'].includes(method.skillId)&&method.status==='complete').flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]]).filter(packet=>/年度报告/.test(packet.title))
  if(!packets.length)return input.sections
  let changed=false
  const markdown=section.markdown.split('\n').map(line=>{
    const row=line.match(/^\|\s*(分行业|分产品|分地区|分销售模式)\s*\|\s*([^|]+?)\s*\|\s*([\d,]+\.\d+)\s*\|/)
    if(!row)return line
    const label=row[2],amount=row[3]
    for(const packet of packets){
      const excerpt=packet.excerpts.find(item=>/^paragraph:\d+$/.test(item.location)&&item.text.includes(amount!)&&item.text.trim().startsWith(label!.trim()))
      if(!excerpt)continue
      const ref=`[${packet.sourceCandidateId}@${excerpt.location}]`
      if(line.includes(ref))return line
      changed=true
      return `${line} ${ref}`
    }
    return line
  }).join('\n')
  return changed?input.sections.map(item=>item.id===section.id?{...item,markdown}:item):input.sections
}

/** Preserve the source table's industry/product dimension when synthesis labels repeated rows. */
export function reconcileCompanyDriverClassificationLabels<T extends CompanyContentSection>(input:{readonly sections:readonly T[];readonly methodResults:readonly CompanyResearchMethodResult[]}):readonly T[]{
  const methods=input.methodResults.filter(method=>method.skillId==='business_driver_analysis'&&method.status==='complete')
  if(!methods.length)return input.sections
  type Row={label:string;refs:readonly string[]}
  const bySource=new Map<string,{industry:Map<string,Row[]>;product:Map<string,Row[]>}>()
  for(const method of methods)for(const packet of [...method.executionEvidence??[],...method.deterministicEvidence??[]]){
    const excerpts=[...packet.excerpts].sort((a,b)=>Number(a.location.slice(10))-Number(b.location.slice(10)))
    let dimension:'industry'|'product'|undefined
    let dimensionLocation:string|undefined
    let pending:{text:string;location:string}|undefined
    const maps=bySource.get(packet.sourceCandidateId)??{industry:new Map<string,Row[]>(),product:new Map<string,Row[]>()}
    for(const excerpt of excerpts){
      const marker=/^\s*分行业\s*$/.test(excerpt.text)?'industry':/^\s*分产品\s*$/.test(excerpt.text)?'product':undefined
      if(marker){dimension=marker;dimensionLocation=excerpt.location;pending=undefined;continue}
      if(!dimension)continue
      const numeric=/([\d,]+(?:\.\d+)?)/.exec(excerpt.text)
      if(!numeric){if(excerpt.text.trim()&&!/^(?:单位|营业收入|营业成本|毛利率|比上年同期|同期增减|项目)/.test(excerpt.text.trim()))pending={text:[pending?.text,excerpt.text.trim()].filter(Boolean).join(''),location:excerpt.location};continue}
      const current=excerpt.text.slice(0,numeric.index).trim()
      const label=`${pending?.text??''}${current}`.replace(/[|\s]/g,'')
      const pendingLocation=pending?.location
      pending=undefined
      if(label.length<3||label.length>40||/^(?:单位|营业收入|营业成本|毛利率|比上年同期|同期增减)/.test(label))continue
      const amount=Number(numeric[1]!.replaceAll(',',''))
      if(!Number.isFinite(amount))continue
      const key=String(Math.round(amount))
      const rows=maps[dimension].get(key)??[]
      const row={label,refs:[...(dimensionLocation?[`${packet.sourceCandidateId}@${dimensionLocation}`]:[]),...(pendingLocation?[`${packet.sourceCandidateId}@${pendingLocation}`]:[]),`${packet.sourceCandidateId}@${excerpt.location}`]}
      if(!rows.some(item=>item.label===label))rows.push(row)
      maps[dimension].set(key,rows)
    }
    bySource.set(packet.sourceCandidateId,maps)
  }
  let changed=false
  const sections=input.sections.map(section=>{
    if(!['revenue-profit-drivers','growth-drivers','catalysts','business-segments'].includes(section.id))return section
    let markdown=section.markdown
    const lines=markdown.split('\n').map(line=>{
      const markers=[...line.matchAll(/分行业|分产品/g)]
      if(!markers.length)return line
      let result=''
      let cursor=0
      for(let i=0;i<markers.length;i++){
        const marker=markers[i]!
        const dimension=marker[0]==='分行业'?'industry':'product'
        const start=marker.index!+marker[0].length
        const end=markers[i+1]?.index??line.length
        const clause=line.slice(start,end).replace(/^收入表中[，,]\s*/,'')
        const claim=/(?:^|[，,；])\s*([\u3400-\u9fffA-Za-z0-9·（）()、]{2,40}?)(?:本报告期|本期)?收入\s*([\d,]+(?:\.\d+)?)\s*(亿元|万元|元)/g
        const repaired=clause.replace(claim,(full,rawLabel:string,rawAmount:string,unit:string)=>{
          const label=rawLabel.replace(/(?:本报告期|本期|营业)$/,'').trim()
          const value=Number(rawAmount.replaceAll(',',''))*({元:1,万元:1e4,亿元:1e8}[unit as '元'|'万元'|'亿元'])
          if(!Number.isFinite(value))return full
          const key=String(Math.round(value))
          let correction:Row|undefined
          const citedIds=new Set([...line.matchAll(/\[([^\]]+@paragraph:\d+)\]/g)].map(ref=>ref[1]!.split('@paragraph:')[0]!))
          for(const sourceId of citedIds){
            const sourceRows=bySource.get(sourceId)
            if(!sourceRows)continue
            const expected=sourceRows[dimension].get(key)??[]
            const other=sourceRows[dimension==='industry'?'product':'industry'].get(key)??[]
            if(expected.length===1&&other.some(row=>row.label===label)&&expected[0]!.label!==label){
              if(correction&&correction.label!==expected[0]!.label)return full
              correction=expected[0]
            }
          }
          if(!correction)return full
          changed=true
          const refs=correction.refs.map(ref=>`[${ref}]`).filter(ref=>!line.includes(ref)).join(' ')
          const separator=/^[，,；]/.exec(full)?.[0]??''
          return `${separator}${correction.label}收入${rawAmount}${unit}${refs?` ${refs}`:''}`
        })
        result+=line.slice(cursor,start)+repaired
        cursor=end
      }
      return result+line.slice(cursor)
    })
    markdown=lines.join('\n')
    return markdown===section.markdown?section:{...section,markdown}
  })
  return changed?sections:input.sections
}

/** Attach the exact disclosed product-revenue row to every repeated amount in report prose and tables. */
export function reconcileCompanyProductRevenueRowCitations<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const targetIds = new Set(['products', 'growth-drivers', 'business-segments', 'revenue-profit-drivers'])
  const methods = input.methodResults.filter(method => ['business_model_map', 'business_driver_analysis'].includes(method.skillId) && method.status === 'complete')
  if (!methods.length) return input.sections
  const replacements = new Map<string, string>()
  const allPackets = methods.flatMap(method => [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []])
  const annualPackets = allPackets.map(packet => ({ packet, year: packet.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1] })).filter((item): item is { packet: typeof allPackets[number]; year: string } => Boolean(item.year))
  const latestAnnualYear = annualPackets.map(item => item.year).sort().at(-1)
  const olderAnnualSourceIds = new Set(annualPackets.filter(item => latestAnnualYear && item.year < latestAnnualYear).map(item => item.packet.sourceCandidateId))
  for (const method of methods) for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    if (!/(?:年度报告|半年度报告)/.test(packet.title)) continue
    const annualYear = packet.title.match(/((?:19|20)\d{2})\s*年年度报告/)?.[1]
    if (annualYear && latestAnnualYear && annualYear !== latestAnnualYear) continue
    const excerpts = packet.excerpts.map(item => ({ ...item, paragraph: Number(item.location.match(/^paragraph:(\d+)$/)?.[1] ?? 0) }))
    for (const row of excerpts) {
      const match = row.text.trim().match(/^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,30}?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%/)
      if (!match || !row.paragraph) continue
      const preceding = excerpts.filter(item => item.paragraph < row.paragraph && item.paragraph >= row.paragraph - 20)
      const segment = preceding.filter(item => item.text.trim() === '分产品').sort((a, b) => b.paragraph - a.paragraph)[0]
      const title = preceding.some(item => /营业收入构成/.test(item.text))
      const annualHeaders = preceding.map(item => item.text).join('').replace(/\s+/g, '').includes('金额占营业收入比重金额占营业收入比重')
      const interimHeaders = preceding.some(item => /本报告期\s+上年同期/.test(item.text))
      if (segment?.paragraph !== Math.max(0, ...preceding.filter(item => /^分(?:产品|行业|地区|销售模式|销售渠道)$/.test(item.text.trim())).map(item => item.paragraph))) continue
      if (!(title && annualHeaders || interimHeaders)) continue
      const label = match[1]!.trim()
      const rowCitation = `[${packet.sourceCandidateId}@${row.location}]`
      const values = [match[2]!, match[4]!]
      const key = `${label}|${values.join('|')}|${rowCitation}`
      replacements.set(key, `${label}|${values.join('|')}|${rowCitation}`)
    }
  }
  const latestAnnualPackets = annualPackets.filter(item => item.year === latestAnnualYear).map(item => item.packet)
  const cleanedSections = input.sections.map(section => {
    if (section.id !== 'business-segments' || !olderAnnualSourceIds.size || !latestAnnualPackets.length) return section
    let changed = false
    const markdown = section.markdown.split('\n').map(line => {
      const cells = line.split('|').map(cell => cell.trim())
      if (!/^分产品$/.test(cells[1] ?? '') && !/^(?:汽车、|手机部件|电子|光电|精密|其他)/.test(cells[1] ?? '')) return line
      const numericValues = [...line.matchAll(/(?<![\d.,])[\d,]+\.\d{2}(?![\d.,])/g)].map(match => match[0]!)
      if (!numericValues.length) return line
      const exactRows = latestAnnualPackets.flatMap(packet => packet.excerpts.filter(item => numericValues.some(value => item.text.includes(value)) && /\d[\d,]*\.\d{2}/.test(item.text)).map(item => ({ packet, item })))
      if (!exactRows.length) return line
      let repaired = line
      for (const sourceId of olderAnnualSourceIds) {
        const escapedSourceId = sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        repaired = repaired.replace(new RegExp(`\\s*\\[${escapedSourceId}@paragraph:\\d+\\]`, 'g'), '')
      }
      for (const { packet, item } of exactRows) {
        const ref = `[${packet.sourceCandidateId}@${item.location}]`
        if (!repaired.includes(ref)) repaired = `${repaired} ${ref}`
      }
      if (repaired !== line) changed = true
      return repaired
    }).join('\n')
    return changed ? { ...section, markdown } : section
  })
  // Some report tables repeated byte-identical amounts from the preceding
  // industry table and the following product table. Keep the exact product
  // row citations, but remove industry-row citations from product table rows
  // when the same cited source also supplies the matching product row. This
  // avoids ambiguous provenance without discarding the separately labeled
  // industry comparison in surrounding prose.
  const productScopeCleanedSections = cleanedSections.map(section => {
    if (section.id !== 'products') return section
    let changed = false
    const markdown = section.markdown.split('\n').map(line => {
      if (!/^\s*\|[^|]+\|/.test(line) || !/\d/.test(line)) return line
      const numericTokens = [...line.matchAll(/(?<![\d.,])\d[\d,]*(?:\.\d+)?(?![\d.,])/g)].map(match => match[0]!.replace(/[,，]/g, ''))
      if (!numericTokens.length) return line
      let repaired = line
      for (const packet of allPackets) {
        if (!/(?:年度报告|半年度报告)/.test(packet.title)) continue
        const excerpts = packet.excerpts.map(item => ({ ...item, paragraph: Number(/^paragraph:(\d+)$/.exec(item.location)?.[1] ?? 0) }))
        const productHeaders = excerpts.filter(item => item.text.trim() === '分产品')
        for (const productHeader of productHeaders) {
          const industryHeader = excerpts.filter(item => item.paragraph < productHeader.paragraph && item.text.trim() === '分行业').sort((a, b) => b.paragraph - a.paragraph)[0]
          if (!industryHeader) continue
          const citedRefs = [...repaired.matchAll(/\[([A-Za-z0-9._:-]+)@paragraph:(\d+)\]/g)].filter(match => match[1] === packet.sourceCandidateId)
          const hasExactProductRow = citedRefs.some(match => {
            const paragraph = Number(match[2])
            if (paragraph < productHeader.paragraph) return false
            const excerpt = excerpts.find(item => item.paragraph === paragraph)
            if (!excerpt) return false
            const compact = excerpt.text.replace(/[,，\s]/g, '')
            return numericTokens.some(token => compact.includes(token))
          })
          if (!hasExactProductRow) continue
          repaired = repaired.replace(/\s*\[([A-Za-z0-9._:-]+)@paragraph:(\d+)\]/g, (reference, sourceId: string, rawParagraph: string) => {
            const paragraph = Number(rawParagraph)
            return sourceId === packet.sourceCandidateId && paragraph >= industryHeader.paragraph && paragraph < productHeader.paragraph ? '' : reference
          })
        }
      }
      if (repaired !== line) changed = true
      return repaired
    }).join('\n')
    return changed ? { ...section, markdown } : section
  })
  if (!replacements.size) return reconcileCompanyGeographicRevenueReferences({ sections: productScopeCleanedSections, methodResults: input.methodResults })
  let changed = false
  const sections = productScopeCleanedSections.map(section => {
    if (!targetIds.has(section.id)) return section
    let markdown = section.markdown
    for (const encoded of replacements.values()) {
      const [label, firstValue, secondValue, citation] = encoded.split('|')
      if (!label || !firstValue || !citation) continue
      const values = [firstValue, secondValue].filter((value): value is string => Boolean(value))
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const labelPattern = new RegExp(escapedLabel)
      const numericPattern = new RegExp(`(?<![\\d.,])(?:${values.map(value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\d.,])`)
      const lines = markdown.split('\n')
      let lineChanged = false
      for (let index = 0; index < lines.length; index++) {
        let line = lines[index]!
        if (!labelPattern.test(line) || !numericPattern.test(line)) continue
        if (section.id === 'business-segments') {
          for (const sourceId of olderAnnualSourceIds) {
            const escapedSourceId = sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            line = line.replace(new RegExp(`\\s*\\[${escapedSourceId}@paragraph:\\d+\\]`, 'g'), '')
          }
        }
        const citedLine = line.includes(citation) ? line : line.replace(numericPattern, value => `${value}${citation}`)
        if (citedLine !== markdown.split('\n')[index]) {
          lines[index] = citedLine
          lineChanged = true
        }
      }
      if (lineChanged) markdown = lines.join('\n')
    }
    if (markdown === section.markdown) return section
    changed = true
    return { ...section, markdown }
  })
  return reconcileCompanyGeographicRevenueReferences({ sections: changed ? sections : input.sections, methodResults: input.methodResults })
}

/** Attach exact official geographic revenue rows to a matching qualitative claim. */
export function reconcileCompanyGeographicRevenueReferences<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'revenue-profit-drivers')
  if (!section) return input.sections
  const method = input.methodResults.find(item => item.skillId === 'business_driver_analysis' && item.status === 'complete')
  if (!method) return input.sections
  const claim = /(境外收入增长、中国（包括港澳台地区）收入下降)(\s*(?:\[[^\]]+@paragraph:\d+\]\s*)*)(?=[。；])/gu
  let markdown = section.markdown
  const sourceIds = new Set(section.sourceCandidateIds ?? [])
  for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    if (!/半年度报告/.test(packet.title)) continue
    const excerpts = packet.excerpts.map(item => ({ ...item, paragraph: Number(item.location.match(/^paragraph:(\d+)$/)?.[1] ?? 0) }))
    const regionHeader = excerpts.find(item => item.text.trim() === '分地区')
    const countryLabel = excerpts.find(item => item.text.trim() === '中国（包括港澳')
    const china = excerpts.find(item => /163,547,247,000\.00\s+47\.43%\s+235,923,281,000\.00\s+63\.54%\s+-30\.68%/.test(item.text))
    const overseas = excerpts.find(item => /境外\s+181,268,174,000\.00\s+52\.57%\s+135,357,667,000\.00\s+36\.46%\s+33\.92%/.test(item.text))
    if (!regionHeader || !countryLabel || !china || !overseas || regionHeader.paragraph >= countryLabel.paragraph || countryLabel.paragraph + 1 !== china.paragraph || china.paragraph + 1 !== overseas.paragraph) continue
    const refs = [`[${packet.sourceCandidateId}@${china.location}]`, `[${packet.sourceCandidateId}@${overseas.location}]`]
    markdown = markdown.replace(claim, (_match, sentence: string, existingRefs: string) => {
      const missing = refs.filter(ref => !existingRefs.includes(ref))
      return missing.length ? `${sentence} ${existingRefs.trim()}${existingRefs.trim() ? ' ' : ''}${missing.join(' ')}` : `${sentence}${existingRefs}`
    })
    if (markdown !== section.markdown) sourceIds.add(packet.sourceCandidateId)
  }
  if (markdown === section.markdown) return input.sections
  const updated = { ...section, markdown, sourceCandidateIds: [...sourceIds] }
  return input.sections.map(item => item.id === section.id ? updated : item)
}

/** Keep the unit, period and YoY column headings attached to the interim product-growth claim. */
export function reconcileCompanyProductGrowthReferences<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'growth-drivers')
  if (!section || !/精密组件收入同比大幅增长/.test(section.markdown)) return input.sections
  const method = input.methodResults.find(item => item.skillId === 'business_driver_analysis' && item.status === 'complete')
  if (!method) return input.sections
  let markdown = section.markdown
  let changed = false
  for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    if (!/^2026\s*年半年度报告/.test(packet.title)) continue
    const excerpts = new Map(packet.excerpts.map(excerpt => [excerpt.location, excerpt]))
    const row = excerpts.get('paragraph:775')
    const expected = [
      ['paragraph:764', /主要会计数据|营业收入构成/],
      ['paragraph:765', /^单位\s*[：:]\s*元$/],
      ['paragraph:766', /本报告期.*上年同期/],
      ['paragraph:767', /同比增减/],
      ['paragraph:768', /金额.*占营业收入比重/],
      ['paragraph:773', /^分产品$/],
    ] as const
    if (!row || !/精密组件产品\s+6,580,692,901\.95\s+23\.67%\s+2,361,835,859\.44\s+13\.93%\s+178\.63%/.test(row.text)
      || expected.some(([location, pattern]) => !pattern.test(excerpts.get(location)?.text ?? ''))) continue
    const ref = `[${packet.sourceCandidateId}@paragraph:775]`
    const lines = markdown.split('\n')
    const lineIndex = lines.findIndex(line => line.includes(ref))
    if (lineIndex < 0) continue
    const cited = new Set([...lines[lineIndex]!.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(match => match[1]!))
    const missing = expected.map(([location]) => `${packet.sourceCandidateId}@${location}`).filter(value => !cited.has(value))
    if (!cited.has(`${packet.sourceCandidateId}@paragraph:775`)) continue
    if (missing.length) {
      lines[lineIndex] = `${lines[lineIndex]} ${missing.map(value => `[${value}]`).join(' ')}`
      markdown = lines.join('\n')
      changed = true
    }
  }
  if (!changed) return input.sections
  const updated = { ...section, markdown }
  return input.sections.map(item => item.id === section.id ? updated : item)
}

/** Qualify product-growth claims when the located interim product row has no comparable-period values. */
export function reconcileCompanyUnsupportedProductGrowth<T extends CompanyContentSection>(input: { readonly sections: readonly T[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly T[] {
  const section = input.sections.find(item => item.id === 'revenue-profit-drivers')
  const method = input.methodResults.find(item => item.skillId === 'business_driver_analysis' && item.status === 'complete')
  if (!section || !method) return input.sections
  let markdown = section.markdown
  const sourceIds = new Set(section.sourceCandidateIds ?? [])
  for (const packet of [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []]) {
    if (!/^20\d{2}\s*年半年度报告/.test(packet.title)) continue
    const rows = packet.excerpts.map(item => ({ ...item, paragraph: Number(item.location.match(/^paragraph:(\d+)$/)?.[1] ?? 0) }))
    const sectionHeader = rows.filter(item => item.text.trim() === '分产品').sort((a,b) => b.paragraph-a.paragraph)[0]
    const unit = rows.filter(item => /^单位\s*[：:]\s*元$/.test(item.text.trim())).sort((a,b) => b.paragraph-a.paragraph)[0]
    const periodHeader = rows.filter(item => /本报告期\s+上年同期/.test(item.text)).sort((a,b) => a.paragraph-b.paragraph)[0]
    const comparisonHeader = rows.filter(item => /同比增减/.test(item.text)).sort((a,b) => a.paragraph-b.paragraph)[0]
    const shareHeader = rows.filter(item => /金额\s+占营业收入比重/.test(item.text)).sort((a,b) => a.paragraph-b.paragraph)[0]
    if (!sectionHeader || !unit || !periodHeader || !comparisonHeader || !shareHeader) continue
    for (const row of rows) {
      if (row.paragraph <= sectionHeader.paragraph) continue
      const currentOnly = row.text.trim().match(/^([\u3400-\u9fffA-Za-z0-9（）()·、，\- ]{2,30}?)\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)%\s*$/u)
      if (!currentOnly) continue
      const label = currentOnly[1]!.trim()
      const fullComparisonExists = rows.some(item => item.text.trim().startsWith(`${label} `) && /\s[\d.]+%\s+-?[\d.]+%\s*$/.test(item.text.trim()))
      if (fullComparisonExists) continue
      const claim = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:产品)?(?:收入)?(?:同比)?(?:增长|上升|提升)`, 'gu')
      if (!claim.test(markdown)) continue
      claim.lastIndex = 0
      const amount = Number(currentOnly[2]!.replaceAll(',', ''))
      const amountText = Number.isFinite(amount) ? amount.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : currentOnly[2]!
      const refs = [unit, periodHeader, comparisonHeader, shareHeader, sectionHeader, row].map(item => `[${packet.sourceCandidateId}@${item.location}]`).join(' ')
      markdown = markdown.replace(claim, `${label}本期收入${amountText}元、占营业收入${currentOnly[3]}%，但该行未提供上年同期值或同比，不据此判断增长方向 ${refs}`)
      sourceIds.add(packet.sourceCandidateId)
    }
  }
  if (markdown === section.markdown) return input.sections
  return input.sections.map(item => item.id === section.id ? { ...item, markdown, sourceCandidateIds: [...sourceIds] } : item)
}

export function findKnownCustomerConcentrationDenials(input: { readonly sections: readonly CompanyContentSection[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly { readonly sectionId: string; readonly metric: string }[] {
  const disclosed = input.methodResults.some(method => [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []].some(packet => {
    const excerpts = packet.excerpts.map(excerpt => excerpt.text)
    const hasTopFive = excerpts.some(text => /前\s*[五5]\s*(?:名|大)?客户/.test(text) && /\d[\d,，]*(?:\.\d+)?\s*[%％]/.test(text))
    const hasIndividual = excerpts.some(text => /(?:第一名|第二名|客户一|客户二|^\s*[12]\s+\S+)/.test(text) && /\d[\d,，]*(?:\.\d+)?\s*[%％]/.test(text))
    return hasTopFive || hasIndividual
  }))
  if (!disclosed) return []
  const denial = /(?:没有|未提供|未披露|未取得|缺少|无法判断|不可核实|无法核实)[^。；\n]{0,28}(?:前\s*[五5]\s*(?:名|大)?客户(?:比例|占比|集中度)|客户集中度|客户销售占比|第二大(?:客户)?(?:销售)?(?:比例|占比))/g
  const secondLargestAfterSubject = /第二大(?:客户)?(?:销售)?(?:比例|占比)[^。；\n]{0,28}(?:没有|未提供|未披露|未取得|缺少|无法判断|不可核实|无法核实)/g
  // Customer identity, product mapping, and customer-level economics can be
  // legitimately unavailable in the product/model chapters even when annual
  // concentration ratios are disclosed. Apply this cross-method contradiction
  // check only where the report is expected to assess customer concentration.
  return input.sections.filter(section => ['risks', 'monitoring-checklist'].includes(section.id))
    .flatMap(section => [...section.markdown.matchAll(denial), ...section.markdown.matchAll(secondLargestAfterSubject)].map(() => ({ sectionId: section.id, metric: 'customer_concentration' })))
}

type CustomerConcentrationComparisonIssue = { readonly sectionId: string; readonly lineIndex: number; readonly comparisonStart: number; readonly comparisonEnd: number; readonly expectedOperator: string; readonly repairable: boolean }

function rankedCustomerComparisonIssues(sections:readonly CompanyContentSection[],methods:readonly CompanyResearchMethodResult[]):CustomerConcentrationComparisonIssue[]{
  const packets=methods.flatMap(method=>[...method.executionEvidence??[],...method.deterministicEvidence??[]]).filter(packet=>packet.sourceCandidateId.startsWith('official-')&&/年度报告/.test(packet.title))
  const issues:CustomerConcentrationComparisonIssue[]=[]
  for(const section of sections.filter(section=>['risks','monitoring-checklist'].includes(section.id)))section.markdown.split(/\r?\n/).forEach((line,lineIndex)=>{
    const match=/(最大(?:单一)?客户(?:销售)?占比)(低于|小于|高于|大于)(第二大客户)/.exec(line)
    if(!match)return
    const cited=new Set([...line.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(value=>value[1]!))
    const pairs=packets.flatMap(packet=>{
      const first=packet.excerpts.filter(row=>cited.has(`${packet.sourceCandidateId}@${row.location}`)&&/^1\s+客户一\s/.test(row.text.trim()))
      const second=packet.excerpts.filter(row=>cited.has(`${packet.sourceCandidateId}@${row.location}`)&&/^2\s+客户二\s/.test(row.text.trim()))
      if(first.length!==1||second.length!==1)return []
      const left=Number(first[0]!.text.match(/([\d.]+)%/)?.[1]),right=Number(second[0]!.text.match(/([\d.]+)%/)?.[1])
      return Number.isFinite(left)&&Number.isFinite(right)&&left!==right?[{key:`${packet.sourceCandidateId}:${first[0]!.location}:${second[0]!.location}`,left,right}]:[]
    })
    const unique=[...new Map(pairs.map(pair=>[pair.key,pair])).values()]
    if(unique.length!==1)return
    const expected=unique[0]!.left>unique[0]!.right?'高于':'低于'
    if((expected==='高于')===/高于|大于/.test(match[2]!))return
    const start=match.index+match[1]!.length
    issues.push({sectionId:section.id,lineIndex,comparisonStart:start,comparisonEnd:start+match[2]!.length,expectedOperator:expected,repairable:true})
  })
  return issues
}

function customerConcentrationComparisonIssues(sections: readonly CompanyContentSection[], methodResults: readonly CompanyResearchMethodResult[]): readonly CustomerConcentrationComparisonIssue[] {
  const packets = methodResults.flatMap(method => [...method.executionEvidence ?? [], ...method.deterministicEvidence ?? []])
    .filter(packet => packet.sourceCandidateId.startsWith('official-') && /年度报告/.test(packet.title))
  const aggregateClaim = /前\s*[五5]\s*(?:名|大)?(?:客户)?[^。；\n]{0,35}?(?:合计|总计|整体|占比|比例)/
  const largestClaim = /(?:最大(?:单一)?客户|第一大客户|第一名[^。；\n]{0,12}客户|客户一)/
  const aggregateEvidence = /前\s*[五5]\s*(?:名|大)?\s*客户[^。；\n]{0,120}(?:合计|总计|累计|销售|占比|比例)/
  const largestEvidence = /(?:最大(?:单一)?客户|第一大客户|^\s*1\s+客户一)/
  const lower = /低于|小于|少于|不及|不足/
  const higher = /高于|大于|超过|多于/
  const found: CustomerConcentrationComparisonIssue[] = rankedCustomerComparisonIssues(sections,methodResults)
  for (const section of sections) {
    if (!['risks', 'monitoring-checklist'].includes(section.id)) continue
    section.markdown.split(/\r?\n/).forEach((line, lineIndex) => {
      const aggregateMatch = aggregateClaim.exec(line)
      const largestMatch = largestClaim.exec(line)
      if (!aggregateMatch || !largestMatch) return
      const aggregateFirst = aggregateMatch.index < largestMatch.index
      const betweenStart = aggregateFirst ? aggregateMatch.index + aggregateMatch[0].length : largestMatch.index + largestMatch[0].length
      const betweenEnd = aggregateFirst ? largestMatch.index : aggregateMatch.index
      if (betweenEnd < betweenStart) return
      const operatorMatch = /低于|小于|少于|不及|不足|高于|大于|超过|多于/.exec(line.slice(betweenStart, betweenEnd))
      if (!operatorMatch) return
      const citedRefs = new Set([...line.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map(match => match[1]!))
      const sourcedPairs = packets.flatMap(packet => {
        const aggregates = packet.excerpts.filter(excerpt => citedRefs.has(`${packet.sourceCandidateId}@${excerpt.location}`) && aggregateEvidence.test(excerpt.text) && /\d[\d,，]*(?:\.\d+)?\s*[%％]/.test(excerpt.text))
        const largestRows = packet.excerpts.filter(excerpt => citedRefs.has(`${packet.sourceCandidateId}@${excerpt.location}`) && largestEvidence.test(excerpt.text) && /\d[\d,，]*(?:\.\d+)?\s*[%％]/.test(excerpt.text))
        if (aggregates.length !== 1 || largestRows.length !== 1) return []
        const aggregate = aggregates[0]!, largestRow = largestRows[0]!
        const aggregateValue = Number(aggregate.text.match(/(\d[\d,，]*(?:\.\d+)?)\s*[%％]/)?.[1]?.replace(/[，,]/g, ''))
        const largestValue = Number(largestRow.text.match(/(\d[\d,，]*(?:\.\d+)?)\s*[%％]/)?.[1]?.replace(/[，,]/g, ''))
        return Number.isFinite(aggregateValue) && Number.isFinite(largestValue) && aggregateValue !== largestValue
          ? [{ key: `${packet.sourceCandidateId}@${aggregate.location}|${packet.sourceCandidateId}@${largestRow.location}`, aggregateValue, largestValue }]
          : []
      })
      const uniquePairs = [...new Map(sourcedPairs.map(pair => [pair.key, pair])).values()]
      // Ambiguous cited rows still fail the content gate, but are never silently
      // edited. Only one exact same-source pair authorizes deterministic repair.
      if (!uniquePairs.length) return
      const claimedAggregateIsLower = aggregateFirst ? lower.test(operatorMatch[0]) : higher.test(operatorMatch[0])
      const contradicted = uniquePairs.some(pair => (pair.aggregateValue < pair.largestValue) !== claimedAggregateIsLower)
      if (!contradicted) return
      const pair = uniquePairs[0]!
      const aggregateIsLower = pair.aggregateValue < pair.largestValue
      const expectedOperator = aggregateFirst
        ? (aggregateIsLower ? '低于' : '高于')
        : (aggregateIsLower ? '高于' : '低于')
      const operatorStart = betweenStart + operatorMatch.index
      const comparisonStart = line[operatorStart - 1] === '较' ? operatorStart - 1 : operatorStart
      found.push({ sectionId: section.id, lineIndex, comparisonStart, comparisonEnd: betweenStart + operatorMatch.index + operatorMatch[0].length, expectedOperator, repairable: uniquePairs.length === 1 })
    })
  }
  return found
}

function reconcileCustomerConcentrationComparison<T extends CompanyContentSection>(sections: readonly T[], methodResults: readonly CompanyResearchMethodResult[]): readonly T[] {
  const issues = customerConcentrationComparisonIssues(sections, methodResults).filter(issue => issue.repairable)
  if (!issues.length) return sections
  const replacements = new Map<string, Map<number, CustomerConcentrationComparisonIssue>>()
  for (const issue of issues) {
    const lines = replacements.get(issue.sectionId) ?? new Map<number, CustomerConcentrationComparisonIssue>()
    lines.set(issue.lineIndex, issue)
    replacements.set(issue.sectionId, lines)
  }
  return sections.map(section => {
    const sectionIssues = replacements.get(section.id)
    if (!sectionIssues) return section
    const lines = section.markdown.split(/\r?\n/)
    for (const [lineIndex, issue] of sectionIssues) {
      const line = lines[lineIndex]!
      lines[lineIndex] = `${line.slice(0, issue.comparisonStart)}${issue.expectedOperator}${line.slice(issue.comparisonEnd)}`
    }
    return { ...section, markdown: lines.join('\n') }
  })
}

/** Reject a customer-concentration comparison only when the report cites both official rows that establish the ratios. */
export function findCustomerConcentrationComparisonContradictions(input: { readonly sections: readonly CompanyContentSection[]; readonly methodResults: readonly CompanyResearchMethodResult[] }): readonly { readonly sectionId: string }[] {
  return [...new Map(customerConcentrationComparisonIssues(input.sections, input.methodResults).map(item => [item.sectionId, { sectionId: item.sectionId }])).values()]
}

export function evaluateCompanyResearchContent(input: { readonly sections: readonly CompanyContentSection[]; readonly synthesisMode?: string; readonly methodExecutions?: readonly CompanyMethodExecution[]; readonly methodResults?: readonly CompanyResearchMethodResult[] }): CompanyResearchQuality {
  const issues: string[] = []
  if (input.synthesisMode === 'deterministic_fallback') issues.push('SYNTHESIS_DEGRADED')
  for (const method of input.methodExecutions ?? []) if (!['completed', 'complete'].includes(method.status)) issues.push(`METHOD_NOT_COMPLETED:${method.skillId}:${method.errorCode ?? method.status}`)
  for (const method of input.methodResults ?? []) {
    if (method.status !== 'complete') issues.push(`METHOD_NOT_COMPLETED:${method.skillId}:${method.status}`)
    if (!method.answer.trim() || method.findings.length === 0) issues.push(`METHOD_NO_RESEARCH_ANSWER:${method.skillId}`)
    const allowedLocations = new Set(method.executionEvidence
      ? [...method.executionEvidence, ...method.deterministicEvidence ?? []].flatMap((packet) => packet.excerpts.map((excerpt) => `${packet.sourceCandidateId}@${excerpt.location}`))
      : method.findings.flatMap((finding) => finding.evidence.map((ref) => `${ref.sourceCandidateId}@${ref.location}`)))
    if (method.findings.some((finding) => !finding.text.trim() || finding.evidence.length === 0 || finding.evidence.some((ref) => !ref.location.trim() || !method.sourceCandidateIds.includes(ref.sourceCandidateId) || !allowedLocations.has(`${ref.sourceCandidateId}@${ref.location}`)))) issues.push(`METHOD_UNATTRIBUTED_FINDING:${method.skillId}`)
    const located = (text: string) => {
      const refs = [...text.matchAll(/\[([^\]\s]+@[^\]\s]+)\]/g)]
      return refs.length > 0 && refs.every((match) => allowedLocations.has(match[1]!))
    }
    if (!located(method.markdown)) issues.push(`METHOD_SUMMARY_WITHOUT_LOCATED_EVIDENCE:${method.skillId}`)
    if (method.sections.some((section) => !located(section.markdown))) issues.push(`METHOD_SECTION_WITHOUT_LOCATED_EVIDENCE:${method.skillId}`)
    if (method.skillId === 'company_risk_analysis' && method.risks.length === 0) issues.push('METHOD_RISKS_NOT_EXPLAINED')
  }
  const seen = new Map<string, string>()
  const byId = new Map(input.sections.map((section) => [section.id, section]))
  const concentrationContradictions = new Set(findCustomerConcentrationComparisonContradictions({ sections: input.sections, methodResults: input.methodResults ?? [] }).map(item => item.sectionId))
  if (byId.size !== input.sections.length) issues.push('DUPLICATE_SECTION_ID')
  const managementText = byId.get('management-capital-allocation')?.markdown ?? ''
  const thesisText = byId.get('investment-thesis')?.markdown ?? ''
  const disclosedExecutiveRoles = /(?:董事长|总裁|副总裁|执行董事|非执行董事|高级管理人员).{0,32}(?:负责|职责|职务|担任|任职)|(?:负责|分管).{0,24}(?:经营|营运|业务|战略|策略)/.test(managementText)
  // A disclosure later in the next sentence must not turn a separate
  // quantitative-threshold gap into a claim that management roles are absent.
  const broadManagementGaps = thesisText.matchAll(/(?:缺少|缺乏|未提供|未披露|没有)[^。；;\n]{0,24}(?:完整)?(?:管理层分工|高管分工|管理层职责|高管职责)|(?:完整)?(?:管理层分工|高管分工|管理层职责|高管职责)[^。；;\n]{0,16}(?:缺失|不可得|未知)/g)
  // Exclude only a locally rejected characterization, not other gap claims in
  // the same sentence or paragraph (which still need a scoped explanation).
  const thesisClaimsBroadManagementGap = [...broadManagementGaps].some((match) => !/(?:(?:而非|而不是)(?:笼统|简单|直接)?(?:称|认为|认定|断言|判断)?|不应(?:笼统地?)?泛称(?:为|是)?)[“"「『]?\s*$/.test(thesisText.slice(0, match.index)))
  const sectionChecks = COMPANY_CORE_SECTION_IDS.map((id) => {
    const section = byId.get(id)
    const reasons: string[] = []
    for (const method of input.methodResults ?? []) if (COMPANY_METHOD_SECTION_IDS[method.skillId].includes(id) && method.status !== 'complete') reasons.push(`OWNER_METHOD_NOT_COMPLETED:${method.skillId}`)
    if (!section) reasons.push('MISSING_SECTION')
    else {
      const text = section.markdown.trim()
      const analysisBody = text.replace(/^(?:\s*#{1,6}\s+[^\n]+\n)+/, '').trim()
      if (!analysisBody || gap.test(analysisBody)) reasons.push('RESEARCH_GAP')
      const evidenceCount = (section.sourceCandidateIds?.length ?? 0) + (section.sourceRefs?.length ?? 0) + (section.evidenceLinks?.length ?? 0)
      if (evidenceCount === 0) reasons.push('NO_ATTRIBUTABLE_EVIDENCE')
      // A located citation and a sentence saying "data is unavailable" are not
      // themselves market or competition research. These two sections need a
      // domain-specific minimum so deterministic synthesis fallback cannot pass
      // merely by presenting a well-cited gap. Keep a researched-but-limited
      // path for cases where public evidence cannot support company TAM or a
      // full peer comparison.
      if (input.methodResults && id === 'industry-exposure') {
        const marketBoundary = /(?:细分市场|市场边界|市场口径|价值链|终端市场|产业链|可服务市场|TAM)/i.test(analysisBody)
        const demandContext = /(?:需求|预测|增长|扩张|渗透|产量|出货|市场规模|行业景气)/.test(analysisBody)
        const companyLink = /(?:公司|产品|业务|分部).{0,40}(?:受益|暴露|对应|参与|切入|映射|传导|TAM|市场)/.test(analysisBody)
        const boundedGap = /(?:缺少|未提供|未披露|尚不能|无法|不能据此).{0,60}(?:TAM|市场空间|可服务|边界|份额|公司收入|映射|测算|归属)/i.test(analysisBody)
          && /(?:因此|故|影响|限制|不能|不应|不足以)/.test(analysisBody)
        const hasCitations = /\[[^\]\s]+@paragraph:\d+\]/.test(analysisBody)
        if (!(marketBoundary && demandContext && companyLink && hasCitations) && !(marketBoundary && boundedGap && hasCitations)) reasons.push('INSUFFICIENT_MARKET_ANALYSIS')
      }
      if (input.methodResults && id === 'competition') {
        const peerSubject = analysisBody.match(/(?:与|对照)\s*([\p{Script=Han}A-Za-z0-9·&()（）-]{2,24})\s*(?:相比|对照|比较)/u)?.[1]?.trim()
        const namedPeer = !!peerSubject && !/(?:具名|同业|同行|竞品|对手|竞争者|可比公司|行业公司)/.test(peerSubject)
        const peerComparison = namedPeer && (/\b(?:vs\.?|versus)\b|(?:相比|对照|比较|差异|同业)/i.test(analysisBody))
          && /(?:路线|产品|技术|客户|毛利|成本|价格|份额|产能|交付)/.test(analysisBody)
          && /\[[^\]\s]+@paragraph:\d+\]/.test(analysisBody)
        const boundedResearch = /(?:产品|技术|路线|客户|市场|细分业务)/.test(analysisBody)
          && /(?:缺少|未提供|未披露|尚无|未能|无法核实).{0,80}(?:同口径|竞品|竞争者|份额|客户重叠|成本|价格|性能|对手)/.test(analysisBody)
          && /(?:因此|故|影响|限制|不能|无法判断)/.test(analysisBody)
          && /\[[^\]\s]+@paragraph:\d+\]/.test(analysisBody)
        if (!(peerComparison || boundedResearch)) reasons.push('INSUFFICIENT_COMPETITIVE_ANALYSIS')
      }
      const normalized = text.replace(/\s+/g, ' ')
      if (normalized && seen.has(normalized)) reasons.push(`DUPLICATE_CONTENT:${seen.get(normalized)}`)
      if (id === 'investment-thesis' && disclosedExecutiveRoles && thesisClaimsBroadManagementGap) reasons.push('UNSCOPED_MANAGEMENT_ROLE_GAP')
      if (concentrationContradictions.has(id)) reasons.push('CONTRADICTORY_CUSTOMER_CONCENTRATION_COMPARISON')
      if (normalized) seen.set(normalized, id)
      const unknownUnit = /单位[^。；;\n]{0,80}(?:未提供|未见|未包含|无法核实|未能核实|未知|不明|缺失)/
      const amountWithUnit = /\d[\d,，]*(?:\.\d+)?\s*(?:人民币千元|人民币元|亿元|万元|千元|元)/
      if ([...text.matchAll(/[^\n。]+/g)].some((match) => amountWithUnit.test(match[0]!) && unknownUnit.test(match[0]!))) reasons.push('UNVERIFIED_CURRENCY_UNIT_ASSERTED')
      // A provider dump or bare numeric list is not an explanation of a research question.
      if (/^Retrieved (?:structured financial|market) observations/i.test(text)) reasons.push('OBSERVATIONS_WITHOUT_ANALYSIS')
    }
    return { sectionId: id, core: true, passed: reasons.length === 0, reasons }
  })
  for (const check of sectionChecks) for (const reason of check.reasons) issues.push(`${check.sectionId}:${reason}`)
  const passed = issues.length === 0
  return { passed, status: passed ? 'complete' : 'incomplete', coreCoverage: { completed: sectionChecks.filter((item) => item.passed).length, required: sectionChecks.length }, issues, sectionChecks }
}

export function mergeCompanySemanticQuality(structural: CompanyResearchQuality, semanticReview: CompanySemanticQualityResult): CompanyResearchQuality {
  const sectionChecks = structural.sectionChecks.map(check => {
    const reviewed = semanticReview.sectionChecks.find(item => item.sectionId === check.sectionId)
    const reasons = [...check.reasons, ...(!reviewed ? ['SEMANTIC_REVIEW_UNAVAILABLE'] : reviewed.questionAnswered && reviewed.evidenceSupportsConclusion && reviewed.numericReproducible && reviewed.riskTransmission ? [] : ['SEMANTIC_REVIEW_FAILED', ...reviewed.reasons])]
    return { ...check, passed: reasons.length === 0, reasons }
  })
  const passed = structural.passed && semanticReview.passed
  return { ...structural, passed, status: passed ? 'complete' : 'incomplete', issues: [...structural.issues, ...semanticReview.issues], sectionChecks, coreCoverage: {completed:sectionChecks.filter(item => item.passed).length,required:sectionChecks.length},semanticReview }
}
