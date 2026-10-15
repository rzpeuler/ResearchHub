import type { CompanyResearchInput } from './contracts.ts'
type NormalizedResearchSource = CompanyResearchInput['sources'][number]

export interface CompanyEvidenceExcerpt {
  readonly sourceCandidateId: string
  /** Stable, one-based normalized-text paragraph locator; does not invent PDF page numbers. */
  readonly location: string
  readonly text: string
  /** Exact context locators supplied alongside this row, never inferred dates or numeric values. */
  readonly contextLocations?: readonly string[]
}
export interface CompanyEvidencePacket {
  readonly sourceCandidateId: string
  readonly title: string
  readonly url?: string
  readonly publisher: string
  readonly publishedAt?: string
  /** Observed page dates remain context and never become a verified publication timestamp. */
  readonly observedPublicationDate?: string
  readonly historicalSourceContext?: { readonly observedYear: number; readonly basis: string; readonly caution: string }
  readonly excerpts: readonly CompanyEvidenceExcerpt[]
}

/** Inspect the entire document before bounding context. Paragraph IDs stay stable across methods. */
export function selectCompanyEvidence(sources: readonly NormalizedResearchSource[], eligibleIds: readonly string[], terms: readonly string[], options: { maxSources?: number; maxExcerptsPerSource?: number; maxCharacters?: number; purpose?: string } = {}): CompanyEvidencePacket[] {
  const eligible = new Set(eligibleIds)
  const maxSources = options.maxSources ?? 16
  const maxExcerpts = options.maxExcerptsPerSource ?? 72
  const maxCharacters = options.maxCharacters ?? 32_000
  const ranked = sources.filter((source) => eligible.has(source.candidate.candidateId)).map((source, sourceOrder) => {
    const paragraphs = source.content.split(/\r?\n/).map((text, index) => ({ text: text.trim(), index })).filter(({ text }) => text.length > 0)
    const headingTerms = PURPOSE_HEADINGS[options.purpose ?? ''] ?? []
    const allTerms = [...headingTerms, ...terms]
    const frequencies = new Map<string, number>()
    for (const paragraph of paragraphs) frequencies.set(paragraph.text, (frequencies.get(paragraph.text) ?? 0) + 1)
    const scores = paragraphs.map(({ text, index }) => {
      const heading = headingTerms.some((term) => text.includes(term)) && text.length < 150 && !/\.{3,}|…{2,}/.test(text)
      const density = (text.match(/\d/g)?.length ?? 0) / text.length
      const repeatedHeader = (frequencies.get(text) ?? 0) > 4 && /报告全文|股份有限公司|^\d+$|^\[第\d+页\]/.test(text)
      const numericPenalty = density > 0.3 && !['financial_quality_analysis', 'business_driver_analysis'].includes(options.purpose ?? '') ? 0.15 : 1
      const score = repeatedHeader ? 0 : (allTerms.reduce((score, term) => score + (text.toLowerCase().includes(term.toLowerCase()) ? term.length > 3 ? 3 : 1 : 0), 0) + (heading ? 12 : 0)) * numericPenalty
      return { text, index, heading, score }
    })
    // Reserve substantial coherent spans for methodology-specific headings, then diversify across term families.
    const anchorIndices: number[] = []
    for (const row of scores.filter(({ heading, score }) => heading && score > 0).sort((a, b) => b.score - a.score || a.index - b.index)) if (anchorIndices.length < 4 && anchorIndices.every((anchor) => Math.abs(anchor - row.index) > 24)) anchorIndices.push(row.index)
    const selected = new Set<number>()
    for (const anchor of anchorIndices) for (const row of scores.filter(({ index }) => index >= anchor && index <= anchor + 24)) if (selected.size < Math.floor(maxExcerpts * 0.7)) selected.add(row.index)
    const best = scores.filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.index - b.index)
    // Explicit research questions outrank generic heading frequency and numeric-density penalties.
    // Keep real table labels, headers and adjacent value rows together, including PDF line wraps.
    const criticalBundles = (PURPOSE_QUERY_FAMILIES[options.purpose ?? ''] ?? []).flatMap((family, familyIndex) => {
      const candidates = scores.filter((row) => family.test(row.text) && !/\.{3,}|…{2,}/.test(row.text)).sort((a, b) => {
        const grossMargin = (row: typeof a) => family === SEGMENT && scores.some((prior) => prior.index < row.index && prior.index >= row.index - 25 && /毛利率/.test(prior.text)) ? /^分产品$/.test(row.text) ? 2 : 1 : 0
        const specificity = (row: typeof a) => family === OWNERSHIP ? /\d[\d.]*%/.test(row.text) && /第一大股东|实际控制人|控股股东/.test(row.text) ? 3 : /\d[\d.]*%/.test(row.text) ? 1 : 0 : family === OPERATING_SUMMARY && /同比(?:增长|下降|减少)?$/.test(row.text) ? 1 : family === REVENUE_RECOGNITION && /收入确认.*具体方法/.test(row.text) ? 3 : family === ACQUISITION && /^合并成本\s+\S/.test(row.text) ? 3 : family === VOLUME && /(?:产量|生产量).*(?:销量|销售量).*收入/.test(row.text) ? 3 : 0
        return grossMargin(b) - grossMargin(a) || specificity(b) - specificity(a) || a.index - b.index
      })
      return candidates.slice(0, 2).map((anchor) => {
        const before = family === OPERATING_SUMMARY ? [] : scores.filter((row) => row.index < anchor.index).slice(family === ACQUISITION ? -10 : -4)
        const after = scores.filter((row) => row.index >= anchor.index).slice(0, family === ACQUISITION ? 19 : family === REVENUE_RECOGNITION || family === CHANNELS ? 8 : /^(?:分产品|分行业)$/.test(anchor.text) ? 13 : 5)
        const tableHeader = family === SEGMENT ? scores.filter((row) => row.index < anchor.index && row.index >= anchor.index - 25 && /营业收入.*营业成本.*毛利率/.test(row.text)).at(-1) : undefined
        const headers = tableHeader ? scores.filter((row) => row.index >= tableHeader.index - 1 && row.index < anchor.index && row.index <= tableHeader.index + 5) : []
        return { family: familyIndex, indices: [...new Set([...headers, ...before, ...after].map((row) => row.index))] }
      })
    })
    for (const bundle of criticalBundles) for (const index of bundle.indices) selected.add(index)
    const seen = new Set<string>()
    for (const term of allTerms) for (const row of best.filter(({ text }) => text.toLowerCase().includes(term.toLowerCase())).slice(0, 3)) if (selected.size < maxExcerpts - 12 && !seen.has(row.text)) { selected.add(row.index); seen.add(row.text) }
    for (const row of best) if (selected.size < maxExcerpts - 8 && !seen.has(row.text)) { selected.add(row.index); seen.add(row.text) }
    if (!best.length) for (const row of scores.slice(0, 2)) selected.add(row.index)
    // Include surrounding context, while keeping original paragraph numbering.
    const contexts = new Map<number, number[]>()
    for (const index of [...selected]) {
      // Website timelines often place the year several blank lines before the event.
      if (options.purpose === 'company_history_strategy' && (scores.find((row) => row.index === index)?.text.length ?? 0) > 5) { const year = scores.filter((row) => row.index < index && row.index >= index - 12 && /^(19|20)\d{2}$/.test(row.text)).at(-1); if (year) { selected.add(year.index); contexts.set(index, [year.index]) } }
      const row = scores.find((row) => row.index === index)
      if (row && /\d[\d,，.]*.*\d/.test(row.text)) {
        const prior = scores.filter((candidate) => candidate.index < index && candidate.index >= index - 30)
        const header = prior.filter((candidate) => /^(?:\d{4}\s*年?\s*){2,}|\d{4}\s*年.*\d{4}\s*年|本报告期末.*上年末|本报告期.*上年同期/.test(candidate.text) && candidate.text.length < 160).at(-1)
        const unit = prior.filter((candidate) => /^(?:单位[：:]|人民币.*(?:千元|万元)|金额单位[：:])/.test(candidate.text) && candidate.text.length < 100).at(-1)
        const caption = prior.filter((candidate) => /收入构成|主要会计数据|合并(?:利润|现金流量|资产负债)表/.test(candidate.text) && candidate.text.length < 100).at(-1)
        const linked = [header?.index, unit?.index, caption?.index].filter((value): value is number => value !== undefined)
        if (linked.length) { for (const context of linked) selected.add(context); contexts.set(index, [...contexts.get(index) ?? [], ...linked]) }
      }
      for (const neighbor of [index - 1, index + 1]) if (selected.size < maxExcerpts && scores.some((row) => row.index === neighbor)) selected.add(neighbor)
    }
    // Neighbor rows may themselves be timeline events; attach their supplied years too.
    if (options.purpose === 'company_history_strategy') for (const index of [...selected]) {
      const row = scores.find((candidate) => candidate.index === index)
      if (!row || row.text.length <= 5) continue
      const year = scores.filter((candidate) => candidate.index < index && candidate.index >= index - 12 && /^(19|20)\d{2}$/.test(candidate.text)).at(-1)
      if (year) { selected.add(year.index); contexts.set(index, [...new Set([...contexts.get(index) ?? [], year.index])]) }
    }
    const excerpts = (best.length ? scores.filter(({ index }) => selected.has(index)) : scores.slice(0, 2)).map(({ text, index }) => {
      const hit = terms.map((term) => text.toLowerCase().indexOf(term.toLowerCase())).filter((offset) => offset >= 0).sort((a, b) => a - b)[0] ?? 0
      const start = text.length > 2400 ? Math.max(0, hit - 400) : 0
      return { sourceCandidateId: source.candidate.candidateId, location: `paragraph:${index + 1}`, text: text.slice(start, start + 2400), ...(contexts.has(index) ? { contextLocations: contexts.get(index)!.map((context) => `paragraph:${context + 1}`) } : {}) }
    })
    const titleScore = allTerms.filter((term) => source.title.toLowerCase().includes(term.toLowerCase())).length * 15
    const priorities = new Map(excerpts.map((excerpt) => {
      const index = Number(excerpt.location.split(':')[1]) - 1
      const row = scores.find((candidate) => candidate.index === index)!
      return [excerpt.location, { score: row.score + (anchorIndices.some((anchor) => index >= anchor && index <= anchor + 24) ? 6 : 0), terms: allTerms.filter((term) => row.text.toLowerCase().includes(term.toLowerCase())) }] as const
    }))
    return { source, sourceOrder, score: Math.min(150, best.reduce((sum, row) => sum + row.score, 0)) + titleScore, excerpts, priorities, criticalBundles }
  }).sort((a, b) => b.score - a.score || a.sourceOrder - b.sourceOrder).slice(0, maxSources)
  let remaining = maxCharacters
  return ranked.flatMap(({ source, excerpts, priorities, criticalBundles }) => {
    let sourceBudget = Math.min(remaining, Math.max(3000, Math.floor(maxCharacters / Math.min(ranked.length, 8))))
    const byLocation = new Map(excerpts.map((excerpt) => [excerpt.location, excerpt]))
    const admitted = new Map<string, CompanyEvidenceExcerpt>()
    const usedTerms = new Set<string>()
    const relevance = (excerpt: CompanyEvidenceExcerpt) => { const priority = priorities.get(excerpt.location); return (priority?.score ?? 0) + (priority?.terms.filter((term) => !usedTerms.has(term)).length ?? 0) * 2 }
    const add = (excerpt: CompanyEvidenceExcerpt, allowance: number) => {
      if (admitted.has(excerpt.location) || allowance < 100) return
      const context = (excerpt.contextLocations ?? []).flatMap((location) => { const row = byLocation.get(location); return row && !admitted.has(location) ? [row] : [] })
      if (admitted.size + context.length + 1 > maxExcerpts) return
      const contextCost = context.reduce((sum, row) => sum + row.text.length, 0)
      const available = Math.min(remaining, sourceBudget, allowance)
      if (available < Math.min(160, excerpt.text.length) + contextCost) return
      const text = excerpt.text.slice(0, available - contextCost)
      for (const row of [...context, { ...excerpt, text }]) {
        if (admitted.has(row.location)) continue
        admitted.set(row.location, row)
        sourceBudget -= row.text.length
        remaining -= row.text.length
      }
      for (const term of priorities.get(excerpt.location)?.terms ?? []) usedTerms.add(term)
    }
    // Reserve bounded coherent bundles for each exact query family before generic region anchors.
    const families = [...new Set(criticalBundles.map((bundle) => bundle.family))]
    const familyAllowance = Math.floor(sourceBudget * 0.85 / Math.max(1, families.length))
    for (const [familyPosition, family] of families.entries()) {
      const allowance = Math.max(familyAllowance, sourceBudget - 180 * (families.length - familyPosition - 1))
      const candidates = criticalBundles.filter((bundle) => bundle.family === family).map((bundle) => {
        const rows = bundle.indices.flatMap((index) => { const row = byLocation.get(`paragraph:${index + 1}`); return row ? [row] : [] })
        const context = rows.flatMap((row) => (row.contextLocations ?? []).flatMap((location) => { const provided = byLocation.get(location); return provided ? [provided] : [] }))
        return [...new Map([...context, ...rows].map((row) => [row.location, row])).values()]
      })
      const bundle = candidates.find((rows) => admitted.size + rows.filter((row) => !admitted.has(row.location)).length <= maxExcerpts && rows.reduce((sum, row) => sum + (admitted.has(row.location) ? 0 : row.text.length), 0) <= allowance)
      if (!bundle) continue
      const cost = bundle.reduce((sum, row) => sum + (admitted.has(row.location) ? 0 : row.text.length), 0)
      if (cost > Math.min(sourceBudget, remaining, allowance)) continue
      for (const row of bundle) {
        if (admitted.has(row.location)) continue
        admitted.set(row.location, row); sourceBudget -= row.text.length; remaining -= row.text.length
        for (const term of priorities.get(row.location)?.terms ?? []) usedTerms.add(term)
      }
    }
    // Allocate one meaningful bundle per content region before long early passages consume the budget.
    const indices = excerpts.map((excerpt) => Number(excerpt.location.split(':')[1]))
    const first = Math.min(...indices), width = Math.max(1, Math.ceil((Math.max(...indices) - first + 1) / 3))
    const regions = new Map<number, CompanyEvidenceExcerpt[]>()
    for (const excerpt of excerpts) { const region = Math.min(2, Math.floor((Number(excerpt.location.split(':')[1]) - first) / width)); const rows = regions.get(region) ?? []; rows.push(excerpt); regions.set(region, rows) }
    const regionRows = [...regions.values()].sort((a, b) => Math.max(...b.map(relevance)) - Math.max(...a.map(relevance)))
    const regionAllowance = Math.max(160, Math.floor(sourceBudget * 0.65 / regionRows.length))
    for (const rows of regionRows) {
      const best = [...rows].sort((a, b) => relevance(b) - relevance(a))[0]
      if (best) add(best, regionAllowance)
    }
    while (sourceBudget >= 100 && remaining >= 100) {
      const novel = (excerpt: CompanyEvidenceExcerpt) => priorities.get(excerpt.location)?.terms.some((term) => !usedTerms.has(term)) ? 1 : 0
      const candidates = excerpts.filter((excerpt) => !admitted.has(excerpt.location)).sort((a, b) => novel(b) - novel(a) || relevance(b) - relevance(a))
      if (!candidates.length) break
      const size = admitted.size
      for (const candidate of candidates) { add(candidate, sourceBudget); if (admitted.size > size) break }
      if (admitted.size === size) break
    }
    // Spend any remainder on longer coherent passages only after region/keyword coverage is retained.
    for (const excerpt of [...excerpts].sort((a, b) => relevance(b) - relevance(a))) {
      const previous = admitted.get(excerpt.location)
      if (!previous || previous.text.length >= excerpt.text.length || sourceBudget <= 0 || remaining <= 0) continue
      const added = Math.min(excerpt.text.length - previous.text.length, sourceBudget, remaining)
      admitted.set(excerpt.location, { ...previous, text: excerpt.text.slice(0, previous.text.length + added) })
      sourceBudget -= added; remaining -= added
    }
    const bounded = [...admitted.values()].sort((a, b) => Number(a.location.split(':')[1]) - Number(b.location.split(':')[1]))
    const supplied = new Set(bounded.map((excerpt) => excerpt.location))
    const validated = bounded.map((excerpt) => ({ ...excerpt, ...(excerpt.contextLocations ? { contextLocations: excerpt.contextLocations.filter((location) => supplied.has(location)) } : {}) }))
    const metadata = source.candidate.metadata
    const history = metadata?.historicalSourceContext as { observedYear?: unknown; basis?: unknown; caution?: unknown } | undefined
    const historicalSourceContext = history && typeof history.observedYear === 'number' && typeof history.basis === 'string' && typeof history.caution === 'string' ? {observedYear:history.observedYear,basis:history.basis,caution:history.caution} : undefined
    return bounded.length ? [withCompanyEvidenceDateContext({ sourceCandidateId: source.candidate.candidateId, title: source.title, url: source.canonicalUrl ?? source.candidate.url, publisher: source.publisher, publishedAt: source.candidate.publishedAt, ...(typeof metadata?.observedPublicationDate === 'string' ? {observedPublicationDate:metadata.observedPublicationDate} : {}), ...(historicalSourceContext ? {historicalSourceContext} : {}), excerpts: validated })] : []
  })
}

/** Bind only actual supplied adjacent PDF continuation rows, never a document-wide year pool. */
export function withCompanyEvidenceDateContext(packet: CompanyEvidencePacket): CompanyEvidencePacket {
  const rows = new Map(packet.excerpts.map((row) => [Number(row.location.split(':')[1]), row]))
  return { ...packet, excerpts: packet.excerpts.map((row) => {
    const previous = rows.get(Number(row.location.split(':')[1]) - 1)
    if (!previous) return row
    const splitYear = splitCompanyYear(previous.text, row.text)
    const datedContinuation = /截至(?:[一二三四五六七八九零〇○]{4}|(?:19|20)\d{2})年(?:末|底|\d{1,2}月)/.test(previous.text) && /[亿万千百]$/.test(previous.text) && /^元[，,、。]/.test(row.text)
    return splitYear || datedContinuation ? { ...row, contextLocations: [...new Set([...row.contextLocations ?? [], previous.location])] } : row
  }) }
}

function splitCompanyYear(previous: string, current: string): string | undefined {
  const left = /[于自在]([一二三四五六七八九零〇○\d]{1,3})$/.exec(previous)?.[1]
  const right = /^([一二三四五六七八九零〇○\d]{1,3})年/.exec(current)?.[1]
  const year = left && right ? left + right : ''
  return /^(?:[一二三四五六七八九零〇○]{4}|(?:19|20)\d{2})$/.test(year) ? `${year}年` : undefined
}

/** Exact date strings reconstructed from two cited, supplied continuation rows; raw evidence stays unchanged. */
export function companyCitedSplitDateText(markdown: string, packets: readonly CompanyEvidencePacket[]): readonly string[] {
  const cited = new Set([...markdown.matchAll(/\[([^\]\s]+@paragraph:\d+)\]/g)].map((match) => match[1]!))
  return packets.flatMap((packet) => {
    const rows = new Map(packet.excerpts.map((row) => [Number(row.location.split(':')[1]), row]))
    return packet.excerpts.flatMap((row) => {
      const previous = rows.get(Number(row.location.split(':')[1]) - 1)
      if (!previous || !cited.has(`${packet.sourceCandidateId}@${row.location}`) || !cited.has(`${packet.sourceCandidateId}@${previous.location}`)) return []
      const year = splitCompanyYear(previous.text, row.text)
      return year ? [year] : []
    })
  })
}

const PURPOSE_HEADINGS: Readonly<Record<string, readonly string[]>> = {
  company_history_strategy: ['发展历程', '公司历程', '成立', '起步', '进入汽车', '战略转型', '董事长致辞'],
  management_governance_analysis: ['专业背景', '主要工作经历', '董事会成员', '高级管理人员情况', '董事、监事', '任职情况', '实际控制人', '报酬情况', '股权激励'],
  business_model_map: ['主要业务', '经营模式', '主营业务', '分行业', '分产品', '主要客户', '供应商'],
  product_technology_analysis: ['核心竞争力分析', '技术创新', '主要产品', '研发投入', '研发项目', '产品矩阵'],
  business_driver_analysis: ['主营业务分析', '营业收入构成', '分行业', '分产品', '分地区', '产销量', '增长'],
  financial_quality_analysis: ['主要会计数据', '现金流', '合并利润表', '合并资产负债表', '资产及负债', '收入和成本'],
  market_structure_analysis: ['行业情况', '行业发展', '市场规模', '产业链', '市场空间'],
  competitive_market_map: ['竞争格局', '竞争对手', '市场竞争', '核心竞争力', '市占率'],
  capital_allocation_review: ['投资状况', '研发投入', '利润分配', '回购', '资本支出', '重大资产', '募集资金'],
  company_risk_analysis: ['风险因素', '面临的风险', '可能面对的风险', '应对措施', '客户集中', '偿债'],
}

const SEGMENT = /^(?:分产品|分行业)$|分(?:产品|行业).*毛利|(?:产品|业务).*毛利率/
const CUSTOMERS = /前\s*[五5]\s*(?:名|大)?客户.*(?:合计|比例|集中)|客户集中度/
const SUPPLIERS = /前\s*[五5]\s*(?:名|大)?供应商.*(?:合计|比例|集中)/
const RESEARCH = /研发投入资本化|资本化研发投入|研发投入金额|研发投入占营业收入/
const OWNERSHIP = /持股比例|控股股东.*持股|实际控制人.*持股/
const BIOGRAPHY = /专业背景|主要工作经历|管理层履历|董事长.*(?:出生|毕业|曾任)|(?:现任|曾任).*(?:董事长|总经理)/
const CONSTRUCTION = /在建工程/
const OPERATING_SUMMARY = /实现收入.*同比/
const REVENUE_RECOGNITION = /收入确认.*(?:具体|方法)|内销.*(?:确认|收入)|外销.*(?:确认|收入)|客户接受|控制权转移/
const ACQUISITION = /合并成本|股份收购对价|股权收购对价|购买日.*支付|支付及待支付?现金|收购对价/
const CHANNELS = /^分地区$|^分销售模式$|直销.*经销/
const VOLUME = /(?:产量|生产量).*(?:销量|销售量)|主要产品.*产销|产销情况/
const PURPOSE_QUERY_FAMILIES: Readonly<Record<string, readonly RegExp[]>> = {
  company_history_strategy: [/共同注册成立/, /成立日期|(?:公司|本公司).*改制|股份公司.*成立/],
  business_model_map: [SEGMENT, CHANNELS, CUSTOMERS, SUPPLIERS, REVENUE_RECOGNITION],
  business_driver_analysis: [VOLUME, SEGMENT, CHANNELS, CUSTOMERS, RESEARCH],
  financial_quality_analysis: [SEGMENT, CUSTOMERS, RESEARCH, CONSTRUCTION],
  capital_allocation_review: [ACQUISITION, RESEARCH, CONSTRUCTION, OPERATING_SUMMARY, OWNERSHIP, /现金分红.*(?:金额|比例)|股份回购.*(?:金额|数量)/],
  management_governance_analysis: [BIOGRAPHY, OWNERSHIP, /股权激励.*(?:授予|行权|条件)/],
  product_technology_analysis: [RESEARCH, /主要研发项目|研发项目名称/],
  company_risk_analysis: [CUSTOMERS, SUPPLIERS, RESEARCH, /偿债能力|有息负债/],
}
