import type { CompanyResearchInput } from './contracts.ts'
import type { CompanyEvidencePacket } from './evidence.ts'
import type { CompanyMethodEvidenceRef, CompanyMethodFinding } from './methods.ts'
import { validateCompanyNumericGrounding } from './numeric-grounding.ts'

export interface CompanyCitationRepair {
  readonly findingIndex: number
  readonly inputText: string
  readonly originalReferences: readonly CompanyMethodEvidenceRef[]
  readonly addedReferences: readonly CompanyMethodEvidenceRef[]
  readonly reason: string
}
type MethodOutput = { readonly findings: readonly CompanyMethodFinding[]; readonly markdown: string; readonly sections: readonly { readonly id: string; readonly markdown: string }[] }
const strip = (text: string) => text.replace(/\[[^\]\s]+@[^\]]+\]/g, '')
const numbers = (text: string) => [...strip(text).matchAll(/(?<![\w.])-?\d+(?:[,，]\d{3})*(?:\.\d+)?/g)].map((match) => match[0].replace(/[,，]/g, ''))
const keywordGroups: Readonly<Record<string, readonly string[]>> = {
  auto: ['汽车相关', '汽车及相关', '汽车、汽车', '汽车业务', '汽车收入', '汽车产品'], electronics: ['手机部件', '手机业务', '电子制造', '电子业务'],
  revenue: ['营业收入', '收入', '营收'], netProfit: ['净利润', '归母利润', '归母净利'], operatingProfit: ['营业利润', '经营利润'],
  operatingCash: ['经营活动', '经营现金', '经营净现金'], investingCash: ['投资活动', '投资净流'], financingCash: ['筹资活动', '筹资净流'],
  capex: ['资本开支', '资本支出', '购建固定资产'], rnd: ['研发投入', '研发费用', '研发支出'], dividends: ['分红', '现金股利', '派息'], repurchase: ['回购'],
  rndExpense: ['研发费用'], rndInvestment: ['研发投入'],
  overseas: ['境外', '海外'], domestic: ['国内', '中国（包括', '中国(包括'], other: ['其他收入', '其他产品', '其他业务'],
  registration: ['注册成立', '注册', '前身'], founding: ['创立', '创办', '成立日期', '公司成立', '在深圳成立'],
  lithium: ['锂离子电池', '锂电池'], carEntry: ['进入汽车行业', '进军汽车'], listing: ['香港上市', '香港证券交易所', '香港联交所'],
  launch: ['推出', '发布', '商业化', '产品上市'], acquisition: ['收购', '并购'],
}
function keys(text: string): Set<string> { return new Set(Object.entries(keywordGroups).filter(([, terms]) => terms.some((term) => text.includes(term))).map(([key]) => key)) }
function meaningMatches(claim: string, original: string): boolean {
  const claimKeys = keys(claim); const sourceKeys = keys(original)
  if (!claimKeys.size || ![...claimKeys].some((key) => sourceKeys.has(key))) return false
  const specific = ['auto', 'electronics', 'netProfit', 'operatingProfit', 'operatingCash', 'investingCash', 'financingCash', 'capex', 'rnd', 'rndExpense', 'rndInvestment', 'dividends', 'repurchase', 'overseas', 'domestic', 'registration', 'founding', 'lithium', 'carEntry', 'listing', 'acquisition']
  if (specific.some((key) => claimKeys.has(key) && !sourceKeys.has(key))) return false
  // A product-specific launch must retain the named model/technology, not just the generic verb.
  const named = [...claim.matchAll(/\b[A-Z][A-Za-z]*\d+[A-Za-z\d.-]*\b/g)].map((match) => match[0])
  if (named.some((name) => !original.includes(name))) return false
  const quotedNames = [...claim.matchAll(/[“「]([^”」]{2,80})[”」]/g)].map((match) => match[1]!.replace(/\s/g, ''))
  if (quotedNames.some((name) => !original.replace(/\s/g, '').includes(name))) return false
  const percentages = (text: string) => [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*[%％]/g)].map((match) => Number(match[1]))
  if (percentages(claim).some((value) => !percentages(original).some((source) => Math.abs(source - value) <= 0.005001))) return false
  // If a sentence explicitly names multiple accounting measures, their nearby values cannot be swapped.
  const accounting = ['revenue', 'netProfit', 'operatingProfit', 'operatingCash', 'investingCash', 'financingCash', 'capex', 'rnd', 'dividends', 'repurchase'].filter((key) => claimKeys.has(key))
  if (accounting.length > 1) for (const key of accounting) {
    const first = (text: string): string | undefined => {
      for (const term of keywordGroups[key]!) { const at = text.indexOf(term); if (at < 0) continue; const number = /-?\d+(?:[,，]\d{3})*(?:\.\d+)?/.exec(text.slice(at + term.length, at + term.length + 35)); if (number) return number[0].replace(/[,，]/g, '') }
      return undefined
    }
    const value = first(claim)
    if (value === undefined || value !== first(original)) return false
  }
  return true
}

/** Repairs only uniquely verifiable mislocated citations, within already cited sources and supplied excerpts. */
export function repairCompanyMethodCitations<T extends MethodOutput>(output: T, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): { readonly output: T; readonly repairs: readonly CompanyCitationRepair[] } {
  const repairs: CompanyCitationRepair[] = []
  const packetSources = packets.map((packet) => {
    const source = input.sources.find((item) => item.candidate.candidateId === packet.sourceCandidateId)!
    const last = Math.max(...packet.excerpts.map((excerpt) => Number(excerpt.location.split(':')[1])))
    const lines = Array<string>(last).fill('')
    for (const excerpt of packet.excerpts) lines[Number(excerpt.location.split(':')[1]) - 1] = excerpt.text
    return { ...source, content: lines.join('\n') }
  })
  const grounded = (text: string, refs: readonly CompanyMethodEvidenceRef[]) => validateCompanyNumericGrounding({ markdown: `${text} ${refs.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: packetSources, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] }).status === 'grounded'
  const findings = output.findings.map((finding, findingIndex) => {
    if (grounded(finding.text, finding.evidence)) return finding
    const tokens = [...new Set(numbers(finding.text))]
    const singleDatedEvent = tokens.length === 1 && /^(?:19|20)\d{2}$/.test(tokens[0]!) && ['registration', 'founding', 'lithium', 'carEntry', 'listing', 'launch', 'acquisition'].some((key) => keys(finding.text).has(key))
    if (tokens.length < 2 && !singleDatedEvent) return finding
    const citedSources = new Set(finding.evidence.map((ref) => ref.sourceCandidateId))
    const matches: { refs: CompanyMethodEvidenceRef[] }[] = []
    for (const packet of packets.filter((item) => citedSources.has(item.sourceCandidateId))) for (const excerpt of packet.excerpts) {
      const row = Number(excerpt.location.split(':')[1])
      const context = packet.excerpts.filter((item) => (excerpt.contextLocations ?? []).includes(item.location))
      // PDF labels may wrap onto the immediately preceding supplied nonnumeric row.
      const label = numbers(excerpt.text).length >= 2 ? packet.excerpts.filter((item) => Number(item.location.split(':')[1]) >= row - 2 && Number(item.location.split(':')[1]) < row && !/\d|[。；;.!]|[一二三四五六七八九〇零]{4}年/.test(item.text) && item.text.length < 90) : []
      const original = [excerpt, ...label, ...context].map((item) => item.text).join(' ')
      if (!meaningMatches(finding.text, original)) continue
      const refs = [excerpt, ...label, ...context].map((item) => ({ sourceCandidateId: packet.sourceCandidateId, location: item.location }))
      if (grounded(finding.text, refs)) matches.push({ refs })
    }
    if (matches.length !== 1) return finding
    const addedReferences = matches[0]!.refs.filter((ref) => !finding.evidence.some((original) => original.sourceCandidateId === ref.sourceCandidateId && original.location === ref.location))
    if (!addedReferences.length) return finding
    repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences, reason: 'Unique supplied excerpt in an already cited source supports every quantitative token and matching business/accounting or dated-event terms; exact context locators retained for independent semantic review.' })
    return { ...finding, evidence: [...finding.evidence, ...addedReferences] }
  })
  const enrich = (text: string) => text.split(/(?<=[。！？])|(?=\n)/).map((segment) => {
    let result = segment
    for (const repair of repairs) {
      const tokens = numbers(segment)
      if (!tokens.length || !meaningMatches(segment, repair.inputText)) continue
      // Require the segment's actual values be supported by this repaired finding's exact refs.
      const refs = findings[repair.findingIndex]!.evidence
      if (!grounded(segment, refs)) continue
      const extra = repair.addedReferences.filter((ref) => !result.includes(`[${ref.sourceCandidateId}@${ref.location}]`))
      if (extra.length) result += ` ${extra.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`
    }
    return result
  }).join('')
  return { output: { ...output, findings, markdown: enrich(output.markdown), sections: output.sections.map((section) => ({ ...section, markdown: enrich(section.markdown) })) }, repairs }
}
