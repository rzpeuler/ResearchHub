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
  /** Distinguishes company disclosure from tightly verified macro industry context. */
  readonly evidenceScope?: 'company' | 'industry_context' | 'peer_company'
  readonly contextTopics?: readonly string[]
  readonly excerpts: readonly CompanyEvidenceExcerpt[]
}

/** Inspect the entire document before bounding context. Paragraph IDs stay stable across methods. */
export function selectCompanyEvidence(sources: readonly NormalizedResearchSource[], eligibleIds: readonly string[], terms: readonly string[], options: { maxSources?: number; maxExcerptsPerSource?: number; maxCharacters?: number; purpose?: string; requiredSourceCandidateIds?: readonly string[] } = {}): CompanyEvidencePacket[] {
  const eligible = new Set(eligibleIds)
  const required = new Set((options.requiredSourceCandidateIds ?? []).filter(id => eligible.has(id)))
  const maxSources = options.maxSources ?? 16
  const maxExcerpts = options.maxExcerptsPerSource ?? (options.purpose === 'company_content_review' ? 120 : 72)
  const maxCriticalExcerpts = options.maxExcerptsPerSource ?? (['capital_allocation_review', 'business_model_map', 'company_risk_analysis'].includes(options.purpose ?? '') ? 96 : maxExcerpts)
  const maxCharacters = options.maxCharacters ?? 32_000
  const ranked = sources.filter((source) => eligible.has(source.candidate.candidateId)
    && (source.candidate.metadata?.researchSubject !== 'peer_company' || options.purpose === 'competitive_market_map')
    && (source.candidate.metadata?.researchScope !== 'industry_context' || ['market_structure_analysis', 'company_content_review'].includes(options.purpose ?? ''))).map((source, sourceOrder) => {
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
    const tableHeaderContexts = new Map<number, number[]>()
    const criticalBundles = (PURPOSE_QUERY_FAMILIES[options.purpose ?? ''] ?? []).flatMap((family, familyIndex) => {
      const candidates = scores.filter((row) => family.test(row.text) && !/\.{3,}|…{2,}/.test(row.text)).sort((a, b) => {
        const quantitative = (row: typeof a) => (family === CUSTOMERS || family === SUPPLIERS) ? /\d[\d,.，]*%/.test(row.text) ? 6 : /\d[\d,.，]+/.test(row.text) ? 4 : 0 : family === EMPLOYEE_PLAN ? /20\d{2}\s*年.{0,30}员工持股计划/.test(row.text) && /(?:不超过\s*[\d,]+\s*人|\d[\d,]*\s*股|\d[\d.]*%|\d[\d,]*\s*份)/.test(row.text) ? 10 : /(?:\d+[、.]\s*)?员工持股计划的实施情况/.test(row.text) ? 5 : 0 : family === SHARE_ACTION && /报告期内.*(?:回购股份|增发股份).*\d/.test(row.text) ? 6 : family === DIVIDEND ? /每\s*10\s*股|(?:人民币|现金红利).*\d/.test(row.text) ? 6 : /(?:\d{4}\s*年度|本年度|报告期).*(?:不派发|派发|现金分红)/.test(row.text) ? 4 : 0 : family === FINANCING && /\d.*(?:亿美元|港元)/.test(row.text) ? 6 : 0
        const grossMargin = (row: typeof a) => family === SEGMENT && scores.some((prior) => prior.index < row.index && prior.index >= row.index - 25 && /毛利率/.test(prior.text)) ? /^分产品$/.test(row.text) ? 2 : 1 : 0
        const specificity = (row: typeof a) => family === STOCK_LISTING ? /(?:本公司|公司)股票于/.test(row.text) && /挂牌交易/.test(row.text) ? 6 : /发行的.*股票于/.test(row.text) ? 0 : 2 : family === COMMERCIALIZATION ? /未来|计划|预计|将(?:于|在|实现|进入)/.test(row.text) && !/已|正在|仍/.test(row.text) ? 0 : /量产爬坡/.test(row.text) ? 6 : /批量出货/.test(row.text) ? 5 : 3 : family === OWNERSHIP ? /(?:境内|境外)自然人\s+\d[\d.]*%/.test(row.text) ? 4 : /\d[\d.]*%/.test(row.text) && /第一大股东|实际控制人|控股股东/.test(row.text) ? 3 : /\d[\d.]*%/.test(row.text) ? 1 : 0 : family === INTERNAL_CONTROL_AUDIT && /(?:内部控制审计报告中的审议意见段|内控审计报告意见类型|保持了有效的财务报告内部控制)/.test(row.text) ? 8 : family === RELATED_TRANSACTION_POLICY && /关联交易决策制度|关联交易管理制度/.test(row.text) ? 8 : family === CONTROLLER_GOVERNANCE && /实际控制人.{0,80}(?:兼任|董事长|总裁|总经理)/.test(row.text) ? 8 : family === RELATIONSHIP && /父子|之子|兄长|兄弟|夫妻/.test(row.text) ? 3 : family === OPERATING_SUMMARY && /同比(?:增长|下降|减少)?$/.test(row.text) ? 1 : family === REVENUE_RECOGNITION && /收入确认.*具体方法|不同经营模式.*收入确认/.test(row.text) ? 3 : family === ACQUISITION && /^合并成本\s+\S/.test(row.text) ? 3 : family === VOLUME && /(?:产量|生产量).*(?:销量|销售量).*收入/.test(row.text) ? 3 : 0
        return quantitative(b) - quantitative(a) || grossMargin(b) - grossMargin(a) || specificity(b) - specificity(a) || a.index - b.index
      })
      return candidates.slice(0, 2).map((anchor) => {
        const before = family === OPERATING_SUMMARY ? [] : scores.filter((row) => row.index < anchor.index).slice(family === REVENUE_COMPOSITION ? -2 : family === ACQUISITION ? -10 : family === EMPLOYEE_PLAN || family === SHARE_ACTION || family === RELATED_TRANSACTION_POLICY ? -1 : family === CUSTOMERS || family === SUPPLIERS || family === RESEARCH || family === INTERNAL_CONTROL_AUDIT || family === CONTROLLER_GOVERNANCE ? -2 : -4)
        const after = scores.filter((row) => row.index >= anchor.index).slice(0, family === GOODWILL || family === GOODWILL_TEST ? 36 : family === TOP_SHAREHOLDER_TABLE ? 40 : family === BIOGRAPHY && options.purpose === 'management_governance_analysis' ? 20 : family === REVENUE_COMPOSITION ? 19 : family === EMPLOYEE_PLAN ? options.purpose === 'management_governance_analysis' ? 28 : 20 : family === ACQUISITION ? 19 : family === REMUNERATION ? 14 : family === CUSTOMERS || family === SUPPLIERS ? 11 : family === RESEARCH ? 10 : family === INTERNAL_CONTROL_AUDIT ? 8 : family === RELATED_TRANSACTION_POLICY ? 3 : family === CONTROLLER_GOVERNANCE ? 5 : family === SHARE_ACTION ? 6 : family === REVENUE_RECOGNITION || family === CHANNELS ? 8 : family === ENTITY_TRANSFORMATION || family === ENTITY_REGISTRATION || family === STOCK_LISTING ? 2 : /^(?:分产品|分行业)$/.test(anchor.text) ? 13 : 5)
        const tableHeader = family === SEGMENT ? scores.filter((row) => row.index < anchor.index && row.index >= anchor.index - 25 && /营业收入.*营业成本.*毛利率/.test(row.text)).at(-1) : undefined
        // PDF extraction often splits a 6-column financial header over several
        // paragraphs; preserve the full continuation (including the margin-change column).
        const headers = tableHeader ? scores.filter((row) => row.index >= tableHeader.index - 1 && row.index < anchor.index && row.index <= tableHeader.index + 12) : []
        if (tableHeader && headers.length) {
          const headerIndices = headers.map(row => row.index)
          const nextTable = scores.find(row => row.index > tableHeader.index && /营业收入.*营业成本.*毛利率/.test(row.text))?.index ?? Number.POSITIVE_INFINITY
          for (const dataRow of scores.filter(row => row.index >= anchor.index && row.index > (headers.at(-1)?.index ?? tableHeader.index) && row.index <= Math.min(tableHeader.index + 25, nextTable - 1) && row.index <= anchor.index + 8 && (row.text.match(/[%％]/g)?.length ?? 0) >= 2)) {
            const splitLabel = scores.find(row => row.index === dataRow.index - 1 && isSplitSegmentLabelContinuation(row.text, dataRow.text))
            if (splitLabel) selected.add(splitLabel.index)
            tableHeaderContexts.set(dataRow.index, [...new Set([...(tableHeaderContexts.get(dataRow.index) ?? []), ...headerIndices, ...(splitLabel ? [splitLabel.index] : [])])])
          }
        }
        // CNINFO PDF text can split a product-segment label from its numeric
        // row (for example, "汽车、汽车相关" followed by
        // "产品及其他产品 648,..."). The value row is already in the
        // segment bundle, but without this link the model may cite the label
        // paragraph alone and numeric grounding cannot verify the amount.
        if (options.purpose === 'business_model_map' && family === SEGMENT && anchor.text === '分产品') {
          for (const dataRow of scores.filter(row => row.index >= anchor.index && row.index <= anchor.index + 16
            && /\d[\d,，]*(?:\.\d+)?\s+\d+(?:\.\d+)?%/.test(row.text))) {
            const splitLabel = scores.find(row => row.index === dataRow.index - 1
              && row.text.length <= 80
              && !/\d/.test(row.text)
              && (/(?:汽车|产品|业务).*(?:、|及|和|与|相关)$/.test(row.text)
                // CNINFO sometimes breaks this specific product label as
                // "手机部件、组装" / "及其他产品 <amount> <share>".
                // Bind only this exact lexical continuation to the numeric row.
                || (row.text.trim() === '手机部件、组装' && /^及其他产品\s+\d/.test(dataRow.text))))
            if (!splitLabel) continue
            selected.add(splitLabel.index)
            tableHeaderContexts.set(dataRow.index, [...new Set([...(tableHeaderContexts.get(dataRow.index) ?? []), splitLabel.index])])
          }
        }
        return { family: familyIndex, indices: [...new Set([...headers, ...before, ...after].map((row) => row.index))] }
      })
    })
    // A revenue-composition table can contain separate industry, product,
    // region, and channel classifications. The generic segment family limits
    // anchors to two, so a high-scoring margin table may crowd out the product
    // revenue rows entirely. Reserve the exact product table independently and
    // bind each split product label to the value continuation it names.
    if (options.purpose === 'business_model_map' || options.purpose === 'business_driver_analysis') {
      const family = (PURPOSE_QUERY_FAMILIES[options.purpose] ?? []).indexOf(SEGMENT)
      const productAnchors = scores.filter(row => row.text.trim() === '分产品'
        && scores.some(prior => prior.index < row.index && prior.index >= row.index - 24 && /营业收入构成/.test(prior.text)))
      const productBundles = productAnchors.map(anchor => {
        const rows = scores.filter(row => row.index > anchor.index && row.index <= anchor.index + 12
          && /\d[\d,，]*(?:\.\d+)?\s+\d+(?:\.\d+)?%/.test(row.text))
        const indices = [anchor.index]
        for (const dataRow of rows) {
          indices.push(dataRow.index)
          const splitLabel = scores.find(row => row.index === dataRow.index - 1 && row.text.length <= 80 && !/\d/.test(row.text)
            && (/(?:汽车|产品|业务).*(?:、|及|和|与|相关)$/.test(row.text)
              || (['手机部件、组', '手机部件、组装'].includes(row.text.trim()) && /^及其他产品\s+\d/.test(dataRow.text))))
          if (splitLabel) {
            indices.push(splitLabel.index)
            tableHeaderContexts.set(dataRow.index, [...new Set([...(tableHeaderContexts.get(dataRow.index) ?? []), splitLabel.index])])
          }
        }
        const unit = scores.filter(row => row.index < anchor.index && row.index >= anchor.index - 16 && /^单位\s*[：:]/.test(row.text)).at(-1)
        const period = scores.filter(row => row.index < anchor.index && row.index >= anchor.index - 16 && /^(?:19|20)\d{2}\s*年/.test(row.text)).at(-1)
        if (unit) indices.push(unit.index)
        if (period) indices.push(period.index)
        return { family, indices: [...new Set(indices)] }
      }).filter(bundle => bundle.indices.length > 1)
      // The revenue-composition table has separate industry and product
      // classifications. Preserve the complete annual/interim industry slice
      // (caption, unit/period/column headings, section marker, row labels and
      // numeric rows) independently of the product slice. Equal amounts in
      // those sections do not make their classifications interchangeable.
      const industryRevenueBundles = options.purpose === 'business_driver_analysis'
        ? scores.flatMap(anchor => {
          if (!/营业收入构成/.test(anchor.text)) return []
          const industry = scores.find(row => row.index > anchor.index && row.index <= anchor.index + 24
            && row.text.trim() === '分行业'
            && !scores.some(between => between.index > anchor.index && between.index < row.index
              && /^分(?:产品|地区|销售模式)$/.test(between.text.trim())))
          if (!industry) return []
          const nextClassification = scores.find(row => row.index > industry.index && row.index <= industry.index + 24
            && /^分(?:产品|行业|地区|销售模式)$/.test(row.text.trim()))?.index ?? industry.index + 24
          const headerRows = scores.filter(row => row.index >= anchor.index && row.index <= industry.index
            && /营业收入构成|单位\s*[：:]|(?:19|20)\d{2}\s*年|金额|占营业收入|同比增减/.test(row.text))
          const unit = headerRows.some(row => /^单位\s*[：:]/.test(row.text))
          const period = headerRows.some(row => /^(?:19|20)\d{2}\s*年/.test(row.text))
          const dataRows = scores.filter(row => row.index > industry.index && row.index < nextClassification
            && row.index <= industry.index + 24
            && (row.text.match(/\d[\d,，]*(?:\.\d+)?/g)?.length ?? 0) >= 2)
          if (!unit || !period || !headerRows.some(row => /占营业收入|金额/.test(row.text)) || !dataRows.length) return []
          const indices = new Set<number>([...headerRows.map(row => row.index), industry.index])
          for (const dataRow of dataRows) {
            indices.add(dataRow.index)
            for (let prior = dataRow.index - 1; prior > industry.index && prior >= dataRow.index - 4; prior--) {
              const label = scores.find(row => row.index === prior)
              if (!label || /\d|单位|营业收入|营业成本|分产品|分行业|分地区|同比增减/.test(label.text)) break
              indices.add(prior)
            }
            tableHeaderContexts.set(dataRow.index, [...new Set([...(tableHeaderContexts.get(dataRow.index) ?? []), ...headerRows.map(row => row.index), industry.index])])
          }
          return [{ family, indices: [...indices] }]
        })
        : []
      // Carry the complete same-period industry and product revenue/cost/margin
      // tables into both methods. Driver conclusions require the split headers
      // and industry rows even when the product table has identical amounts.
      const marginAnchors = scores.filter(row => /^(?:分产品|分行业)$/.test(row.text.trim())
        && scores.some(prior => prior.index < row.index && prior.index >= row.index - 20 && /营业收入.*营业成本.*毛利率/.test(prior.text)))
      const marginBundles = marginAnchors.map(anchor => {
        const header = scores.filter(row => row.index < anchor.index && row.index >= anchor.index - 20 && /营业收入.*营业成本.*毛利率/.test(row.text)).at(-1)
        if (!header) return undefined
        const splitHeaders = scores.filter(row => row.index >= header.index - 1 && row.index < anchor.index && row.index <= header.index + 12
          && /营业收入|营业成本|毛利率|同期增减/.test(row.text))
        const nextClassification = scores.find(row => row.index > anchor.index && /^分(?:产品|行业|地区|销售模式)$/.test(row.text.trim()))?.index ?? Number.POSITIVE_INFINITY
        const rows = scores.filter(row => row.index > anchor.index && row.index < nextClassification && row.index <= anchor.index + 16
          // Compact one-period product tables have revenue, cost, and margin
          // but only one percent sign; multi-period tables add more percent
          // columns. Require the three numeric cells so unrelated prose or
          // nearby revenue-composition rows do not join this bundle.
          && (row.text.match(/[%％]/g)?.length ?? 0) >= 1
          && (row.text.match(/\d[\d,，]*(?:\.\d+)?/g)?.length ?? 0) >= 3)
        const unit = scores.filter(row => row.index < header.index && row.index >= header.index - 12 && /^单位\s*[：:]/.test(row.text)).at(-1)
        const period = scores.filter(row => row.index < header.index && row.index >= header.index - 24 && /^(?:19|20)\d{2}\s*年/.test(row.text)).at(-1)
        const labelIndices = rows.flatMap(dataRow => {
          const fragments: number[] = []
          for (let index = dataRow.index - 1; index > anchor.index && fragments.length < 4; index--) {
            const fragment = scores.find(row => row.index === index)
            if (!fragment || fragment.text.length > 100 || /\d|单位|营业收入|营业成本|毛利率|同期增减|分产品|分行业|分地区/.test(fragment.text)) break
            fragments.unshift(index)
          }
          return fragments
        })
        for (const dataRow of rows) {
          const preceding = labelIndices.filter(index => index < dataRow.index && index >= dataRow.index - 4)
          tableHeaderContexts.set(dataRow.index, [...new Set([...(tableHeaderContexts.get(dataRow.index) ?? []), ...(unit ? [unit.index] : []), ...(period ? [period.index] : []), ...splitHeaders.map(row => row.index), anchor.index, ...preceding])])
        }
        return { family, indices: [...new Set([...(unit ? [unit.index] : []), ...(period ? [period.index] : []), ...splitHeaders.map(row => row.index), anchor.index, ...labelIndices, ...rows.map(row => row.index) ])] }
      }).filter((bundle): bundle is {family:number;indices:number[]} => Boolean(bundle && bundle.indices.length > 2))
      const relevantBundles = [...industryRevenueBundles, ...productBundles, ...marginBundles]
      const productEvidenceIndices = [...new Set(relevantBundles.flatMap(bundle => bundle.indices))]
      if (productEvidenceIndices.length) criticalBundles.unshift({ family, indices: productEvidenceIndices })
    }
    // The existence and timing of a completed acquisition or historical buyback
    // is an answer even when consideration/return data is absent. Reserve compact
    // verbatim action spans separately from long accounting-note cost tables.
    if (options.purpose === 'capital_allocation_review') {
      for (const [familyPattern, action] of [[ACQUISITION, ACQUISITION_ACTION], [SHARE_ACTION, HISTORICAL_BUYBACK]] as const) {
        const family = (PURPOSE_QUERY_FAMILIES[options.purpose] ?? []).indexOf(familyPattern)
        const anchors = scores.filter(row => action.test(row.text) && !/\.{3,}|…{2,}/.test(row.text))
          .filter((row, index, all) => all.findIndex(other => other.text === row.text) === index).slice(0, 2)
        if (!anchors.length) continue
        const indices = [...new Set(anchors.flatMap(anchor => scores.filter(row => row.index >= anchor.index - 1 && row.index <= anchor.index + 2).map(row => row.index)))]
        criticalBundles.unshift({ family, indices })
      }
    }
    // Interim/annual filings often serialize the current employee-plan table
    // as many short paragraphs: scope, column labels, split cells, then values.
    // Select that explicit "all valid during the reporting period" table as a
    // coherent bundle for both governance and capital-allocation methods, so
    // an older plan's more text-rich narrative cannot crowd out current rows.
    if (options.purpose === 'management_governance_analysis' || options.purpose === 'capital_allocation_review') {
      const family = (PURPOSE_QUERY_FAMILIES[options.purpose] ?? []).indexOf(EMPLOYEE_PLAN)
      const currentPlanSections = scores.filter(row => /报告期内全部有效的员工持股计划情况/.test(row.text))
      const currentPlanBundles = currentPlanSections.flatMap(anchor => {
        const end = scores.find(row => row.index > anchor.index && row.index <= anchor.index + 40
          && /^报告期内(?:资产管理机构|因持有人|员工持股计划持有人)/.test(row.text))?.index
          ?? anchor.index + 32
        const rows = scores.filter(row => row.index >= anchor.index - 2 && row.index <= end && row.index <= anchor.index + 36)
        const hasPlanValues = rows.some(row => /\d[\d,，]*\s+\d[\d,，]*\s+(?:无|[^\s]+)\s+\d[\d.]*[%％]/.test(row.text)
          || /(?:\d[\d,，]*\s+)?\d[\d,，]*\s+\d[\d.]*[%％]/.test(row.text))
        if (!hasPlanValues) return []
        return [{ family, indices: [...new Set(rows.map(row => row.index))] }]
      })
      if (currentPlanBundles.length) criticalBundles.unshift(currentPlanBundles[0]!)
    }
    // Preserve the latest director/executive appointment table as a coherent
    // governance input. Appointment names and dates are easy to confuse with
    // adjacent shareholding rows when the table is omitted from the packet.
    if (options.purpose === 'management_governance_analysis') {
      const family = (PURPOSE_QUERY_FAMILIES[options.purpose] ?? []).indexOf(PERSONNEL_CHANGES)
      const headings = scores.filter(row => /^(?:一、)?公司董事、高级管理人员变动情况$/.test(row.text.trim()))
      const appointmentBundles = headings.flatMap(anchor => {
        const end = scores.find(row => row.index > anchor.index && row.index <= anchor.index + 30
          && /^(?:二、|二、|股权激励|员工持股计划)/.test(row.text.trim()))?.index ?? anchor.index + 24
        const rows = scores.filter(row => row.index >= anchor.index && row.index < end
          && (row.index === anchor.index || /^(?:姓名\s+担任的职务\s+类型\s+日期\s+原因|.{1,40}\s+(?:被选举|聘任|解聘|离任|任期届满离任)\s+20\d{2}\s*年\s*\d{2}\s*月\s*\d{2}\s*日)/.test(row.text)))
        return rows.some(row => /(?:被选举|聘任|任期届满离任)/.test(row.text))
          ? [{ family, indices: [...new Set(rows.map(row => row.index))] }]
          : []
      })
      criticalBundles.unshift(...appointmentBundles)
    }
    // Goodwill impairment assumptions are often the decisive evidence for a
    // risk finding, but the generic GOODWILL_TEST span can run through several
    // pages of note text and lose the exact discount-rate row when budgets are
    // shared across many sources. Reserve a compact, source-local table window
    // around an explicitly labelled discount rate, including the table heading
    // and adjacent growth/cash-flow assumptions. Keep original paragraph IDs.
    if (options.purpose === 'company_risk_analysis') {
      const family = (PURPOSE_QUERY_FAMILIES[options.purpose] ?? []).indexOf(GOODWILL_TEST)
      const discountRows = scores.filter(row => /^(?:税前)?折现率\s*[:：]?\s*\d/.test(row.text))
      const parameterBundles = discountRows.slice(0, 2).map(anchor => {
        const start = Math.max(0, anchor.index - 4)
        const end = Math.min(scores.length - 1, anchor.index + 5)
        const header = scores.filter(row => row.index < start && row.index >= start - 8
          && /(?:商誉减值测试|可收回金额的具体确定方法|关键参数|稳定期)/.test(row.text)).at(-1)
        return {
          family,
          indices: [...new Set([
            ...(header ? [header.index] : []),
            ...scores.filter(row => row.index >= start && row.index <= end).map(row => row.index),
          ])],
        }
      })
      criticalBundles.unshift(...parameterBundles)
    }
    if (options.purpose === 'company_risk_analysis') {
      const family = (PURPOSE_QUERY_FAMILIES[options.purpose] ?? []).indexOf(CUSTOMERS)
      const summaries = scores.filter(row => /前\s*[五5]\s*(?:名|大)?客户.*(?:合计.*销售总额比例|客户集中度)/.test(row.text) && /\d[\d,.，]*%/.test(row.text))
      for (const summary of summaries) {
        const amount = scores.filter(row => row.index < summary.index && row.index >= summary.index - 3 && /前\s*[五5]\s*(?:名|大)?客户.*合计.*(?:销售金额|销售额).*\d/.test(row.text)).at(-1)
        const header = scores.find(row => row.index > summary.index && row.index <= summary.index + 80 && /^序号\s+客户名称\s+销售额[（(]元[）)]\s+占年度销售总额比例$/.test(row.text))
        if (!amount || !header) continue
        const first = scores.find(row => row.index > header.index && row.index <= header.index + 12 && /^1\s+\S+\s+[\d,，.]+\s+[\d.]+%$/.test(row.text))
        const second = first && scores.find(row => row.index > first.index && row.index <= first.index + 3 && /^2\s+\S+\s+[\d,，.]+\s+[\d.]+%$/.test(row.text))
        if (!first || !second) continue
        const total = scores.find(row => row.index > second.index && row.index <= second.index + 8 && /^合计\s/.test(row.text))
        criticalBundles.unshift({ family, indices: [amount.index, summary.index, header.index, first.index, second.index, ...(total ? [total.index] : [])] })
        break
      }
    }
    // Keep split HKSCC legal-name rows with the shareholder row that carries
    // its nominee classification, percentage and share count. The percentage
    // alone cannot establish which holder the row describes.
    if (options.purpose === 'management_governance_analysis' || options.purpose === 'capital_allocation_review') {
      const family = (PURPOSE_QUERY_FAMILIES[options.purpose] ?? []).indexOf(TOP_SHAREHOLDER_TABLE)
      const nomineeNames = scores.filter(row => /^HKSCC\s+NOMINEES$/i.test(row.text.trim()))
      const nomineeBundles = nomineeNames.flatMap(anchor => {
        const limited = scores.find(row => row.index === anchor.index + 1 && /^LIMITED$/i.test(row.text.trim()))
        const holding = scores.find(row => row.index === anchor.index + 2 && /^境外法人\s+[\d.]+%\s+[\d,]+$/.test(row.text.trim()))
        return limited && holding ? [{ family, indices: [anchor.index, limited.index, holding.index] }] : []
      })
      criticalBundles.unshift(...nomineeBundles)
    }
    // Reserve primary-source research answers independently of generic report keyword
    // volume. A company introduction and a technical specification can be short and
    // otherwise lose to thousands of annual-report matches. These are exact source
    // spans, not synthetic facts or permission to equate different date/sales scopes.
    const focusedOfficialPeerProduct = options.purpose === 'competitive_market_map'
      && source.candidate.metadata?.researchSubject === 'peer_company'
      && source.candidate.metadata?.focusedPeerProduct === true
    const authority = source.candidate.metadata?.officialCompanyHost === true
      || source.candidate.kind === 'official_disclosure'
      || (typeof source.candidate.tier === 'number' && source.candidate.tier <= 2)
      // Acquisition marks this only for a configured peer's exact product-page
      // query and validates the fetched body against peer identity. Broad peer
      // homepages do not receive these body-answer bundles.
      || focusedOfficialPeerProduct
      || source.candidate.metadata?.researchScope === 'industry_context'
    const topicalPatterns = authority ? evidenceAnswerPatterns(options.purpose ?? '') : []
    const topicalBundles = topicalPatterns.flatMap((pattern, family) => {
      const matches = scores.filter(row => pattern.test(row.text) && !/\.{3,}|…{2,}/.test(row.text)
        && !(options.purpose === 'company_history_strategy' && /参股公司|联营公司|合营公司|子公司|被投资(?:单位|公司)/.test(row.text)))
      // Distinct, compact answers only; repeated web navigation must not displace
      // a second parameter or a different historical period.
      const distinct = matches.filter((row, index) => matches.findIndex(other => other.text === row.text) === index).slice(0, 2)
      return distinct.map(anchor => ({ family: -1 - family, indices: scores.filter(row => row.index >= anchor.index - 3 && row.index <= anchor.index + 3).map(row => row.index) }))
    })
    if (focusedOfficialPeerProduct) {
      // Match a model token from the candidate title to genuine fetched-body
      // text. The title itself never becomes a fabricated evidence paragraph.
      const models = source.title.match(/[A-Za-z]+[ -]?\d+[A-Za-z0-9-]*/g) ?? []
      const identity = scores.filter(row => row.text.length <= 140 && models.some(model => row.text.toLowerCase().includes(model.toLowerCase())))
        .sort((a, b) => Number(/官网|网站|首页/.test(a.text)) - Number(/官网|网站|首页/.test(b.text)) || a.index - b.index)[0]
      if (identity) topicalBundles.unshift({ family: -100, indices: [identity.index] })
    }
    criticalBundles.unshift(...topicalBundles)
    const topicalPriority = topicalBundles.length ? (source.candidate.metadata?.officialCompanyHost === true || focusedOfficialPeerProduct) ? 2 : 1 : 0
    for (const bundle of criticalBundles) for (const index of bundle.indices) selected.add(index)
    const seen = new Set<string>()
    for (const term of allTerms) for (const row of best.filter(({ text }) => text.toLowerCase().includes(term.toLowerCase())).slice(0, 3)) if (selected.size < maxExcerpts - 12 && !seen.has(row.text)) { selected.add(row.index); seen.add(row.text) }
    for (const row of best) if (selected.size < maxExcerpts - 8 && !seen.has(row.text)) { selected.add(row.index); seen.add(row.text) }
    if (!best.length) for (const row of scores.slice(0, 2)) selected.add(row.index)
    // Include surrounding context, while keeping original paragraph numbering.
    const contexts = new Map<number, number[]>(tableHeaderContexts)
    for (const index of [...selected]) {
      // Website timelines often place the year several blank lines before the event.
      if (options.purpose === 'company_history_strategy' && (scores.find((row) => row.index === index)?.text.length ?? 0) > 5) { const year = scores.filter((row) => row.index < index && row.index >= index - 12 && /^(19|20)\d{2}$/.test(row.text)).at(-1); if (year) { selected.add(year.index); contexts.set(index, [year.index]) } }
      const row = scores.find((row) => row.index === index)
      if (row && /\d[\d,，.]*.*\d/.test(row.text)) {
        const prior = scores.filter((candidate) => candidate.index < index && candidate.index >= index - 30)
        const header = prior.filter((candidate) => /^(?:\d{4}\s*年?\s*){2,}|\d{4}\s*年.*\d{4}\s*年|本报告期末.*上年末|本报告期.*上年同期/.test(candidate.text) && !/^于|^截至|通过.*形成|比例为/.test(candidate.text) && candidate.text.length < 160).at(-1)
        const localTableUnit = prior.filter(candidate=>/^序号\s+(?:客户名称\s+销售额|供应商名称\s+采购额)[（(]元[）)]\s+占年度(?:销售|采购)总额比例$/.test(candidate.text) && scores.filter(between=>between.index>candidate.index && between.index<index).every(between=>/^\d+\s+(?:客户|供应商)\S*\s+[\d,，.]+\s+[\d.]+%$/.test(between.text))).at(-1)
        const goodwillHeader=prior.filter(candidate=>/^(?:（[12]）\s*)?商誉(?:原值|减值准备)?$|^\d+[、.]\s*商誉$/.test(candidate.text)).at(-1)
        // Annual/interim statement tables use 期初余额 / 期末余额. Require
        // both labels after the goodwill heading so a nearby unrelated table
        // cannot inherit the report-wide RMB convention.
        const goodwillTable=goodwillHeader && prior.some(candidate=>candidate.index>goodwillHeader.index && /(?:年|期)初余额.*(?:年|期)末余额/.test(candidate.text))
        // Annual-report vehicle operating tables have the monetary unit embedded
        // in a split column header, while the production-count unit is stated in
        // a footnote after the data rows. Bind both only to matching vehicle rows.
        const vehicleHeader = prior.filter(candidate => candidate.index >= index - 10
          && /产品类别.*产能状况.*快报产量.*快报销量.*销售收入\s*[（(]元[）)]/.test(candidate.text)).at(-1)
        const vehicleRow = /^(?:乘用车|商用车)\s+[\d,，]+\s+[\d,，]+\s+[\d,，]+\s+[\d,，]+(?:\.\d+)?\s*$/.test(row.text)
        const vehicleFootnote = vehicleHeader && vehicleRow
          ? scores.find(candidate => candidate.index > index && candidate.index <= index + 3 && /产能状况指报告期产量.*单位为辆/.test(candidate.text))
          : undefined
        // CNINFO may extract a cash-dividend table label and its total amount
        // onto separate adjacent paragraphs. Keep the exact column/unit label
        // bound to the amount-only cell; mere proximity is not enough.
        const cashDividendTotalHeader = options.purpose === 'capital_allocation_review'
          && /^[\d,，]+(?:\.\d+)?$/.test(row.text)
          ? prior.find(candidate => candidate.index === index - 1 && /^现金分红总额（含其他方式）（元）$/.test(candidate.text))
          : undefined
        const explicitUnit = prior.filter((candidate) => /^(?:单位[：:]|人民币.*(?:千元|万元)|金额单位[：:])/.test(candidate.text) && candidate.text.length < 100).at(-1)
        // A financial-statement convention applies to a genuine goodwill note
        // table, while explicit units inside that note override the convention.
        // Cost/customer table units outside the note never become goodwill units.
        const goodwillUnit=goodwillTable ? explicitUnit && explicitUnit.index>goodwillHeader.index ? explicitUnit : scores.filter(candidate=>candidate.index<goodwillHeader.index && REPORT_CURRENCY_CONVENTION.test(candidate.text)).at(-1) : undefined
        const unit = localTableUnit ?? (goodwillTable ? goodwillUnit : explicitUnit)
        const caption = prior.filter((candidate) => /收入构成|主要会计数据|合并(?:利润|现金流量|资产负债)表/.test(candidate.text) && candidate.text.length < 100).at(-1)
        const linked = [header?.index, unit?.index, caption?.index, cashDividendTotalHeader?.index, ...(vehicleHeader && vehicleRow ? [vehicleHeader.index, vehicleFootnote?.index] : [])].filter((value): value is number => value !== undefined)
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
    const excerpts = (best.length || criticalBundles.length ? scores.filter(({ index }) => selected.has(index)) : scores.slice(0, 2)).map(({ text, index }) => {
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
    return { source, sourceOrder, topicalPriority, score: Math.min(150, best.reduce((sum, row) => sum + row.score, 0)) + titleScore, excerpts, priorities, criticalBundles }
  }).sort((a, b) => Number(required.has(b.source.candidate.candidateId)) - Number(required.has(a.source.candidate.candidateId)) || b.topicalPriority - a.topicalPriority || b.score - a.score || a.sourceOrder - b.sourceOrder).slice(0, Math.max(maxSources, required.size))
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
    const goodwillFamilyIndex = (PURPOSE_QUERY_FAMILIES[options.purpose ?? ''] ?? []).indexOf(GOODWILL)
    const queryFamilies = PURPOSE_QUERY_FAMILIES[options.purpose ?? ''] ?? []
    const customerFamilyIndex = queryFamilies.indexOf(CUSTOMERS)
    // Customer concentration is a core risk input. Reserve its compact source-backed
    // summary + table header + largest two rows before longer governance/goodwill spans.
    if (options.purpose === 'company_risk_analysis' && families.includes(customerFamilyIndex)) {
      families.sort((a, b) => Number(b === customerFamilyIndex) - Number(a === customerFamilyIndex))
    }
    const familyAllowance = Math.floor(sourceBudget * 0.85 / Math.max(1, families.length))
    for (const [familyPosition, family] of families.entries()) {
      const allowance = Math.max(familyAllowance, sourceBudget - 180 * (families.length - familyPosition - 1))
      const familyPattern = queryFamilies[family]
      const candidates = criticalBundles.filter((bundle) => bundle.family === family).map((bundle) => {
        const rows = bundle.indices.flatMap((index) => { const row = byLocation.get(`paragraph:${index + 1}`); return row ? [row] : [] })
        const context = rows.flatMap((row) => (row.contextLocations ?? []).flatMap((location) => { const provided = byLocation.get(location); return provided ? [provided] : [] }))
        return [...new Map([...context, ...rows].map((row) => [row.location, row])).values()]
      })
      const governanceFamily = [INTERNAL_CONTROL_AUDIT, RELATED_TRANSACTION_POLICY, CONTROLLER_GOVERNANCE].includes(familyPattern)
      const employeePlanFamily = familyPattern === EMPLOYEE_PLAN && ['management_governance_analysis', 'capital_allocation_review'].includes(options.purpose ?? '')
      const customerConcentrationFamily = familyPattern === CUSTOMERS && ['company_risk_analysis', 'business_model_map', 'financial_quality_analysis', 'market_structure_analysis'].includes(options.purpose ?? '')
      const businessDriverSegmentFamily = options.purpose === 'business_driver_analysis' && familyPattern === SEGMENT
      const familyAllowanceOverride = businessDriverSegmentFamily ? Math.max(allowance, Math.min(3400, Math.floor(sourceBudget * 0.85))) : family === goodwillFamilyIndex ? Math.max(allowance, Math.min(2400, Math.floor(sourceBudget * 0.6))) : governanceFamily ? Math.max(allowance, Math.min(2400, Math.floor(sourceBudget * 0.75))) : employeePlanFamily ? Math.max(allowance, Math.min(1600, Math.floor(sourceBudget * 0.25))) : customerConcentrationFamily ? Math.max(allowance, Math.min(1800, Math.floor(sourceBudget * 0.25))) : allowance
      const bundle = candidates.find((rows) => admitted.size + rows.filter((row) => !admitted.has(row.location)).length <= maxCriticalExcerpts && rows.reduce((sum, row) => sum + (admitted.has(row.location) ? 0 : row.text.length), 0) <= familyAllowanceOverride)
      if (!bundle) continue
      const cost = bundle.reduce((sum, row) => sum + (admitted.has(row.location) ? 0 : row.text.length), 0)
      if (cost > Math.min(sourceBudget, remaining, familyAllowanceOverride)) continue
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
    const evidenceScope = metadata?.researchScope === 'industry_context' ? 'industry_context' : metadata?.researchSubject === 'peer_company' ? 'peer_company' : 'company'
    const contextTopics = Array.isArray(metadata?.contextTopics) ? metadata.contextTopics.filter((topic): topic is string => typeof topic === 'string') : undefined
    return bounded.length ? [withCompanyEvidenceDateContext({ sourceCandidateId: source.candidate.candidateId, title: source.title, url: source.canonicalUrl ?? source.candidate.url, publisher: source.publisher, publishedAt: source.candidate.publishedAt, evidenceScope, ...(contextTopics?.length ? {contextTopics} : {}), ...(typeof metadata?.observedPublicationDate === 'string' ? {observedPublicationDate:metadata.observedPublicationDate} : {}), ...(historicalSourceContext ? {historicalSourceContext} : {}), excerpts: validated })] : []
  })
}

/** PDF text extraction can split a segment label from the row that carries its
 * amounts. Bind only the known lexical continuations, and only when the next
 * line is a numeric row in a table whose income/cost/margin header was found. */
function isSplitSegmentLabelContinuation(label: string, row: string): boolean {
  const continuation = /^([\u3400-\u9fff]{1,5})\s+(?=-?\d|[（(]?\d)/.exec(row)?.[1]
  if (!continuation || /\d/.test(label) || label.length < 4 || label.length > 32) return false
  const joined = `${label.trim()}${continuation}`.replace(/\s+/g, '')
  return (label.endsWith('制') && continuation === '造业' && joined.endsWith('制造业'))
    || (label.endsWith('及') && continuation === '其他产品' && joined.endsWith('及其他产品'))
    || (label.trim() === '手机部件、组装' && continuation === '及其他产品' && joined === '手机部件、组装及其他产品')
}

/** Bind only syntactically verified, actual supplied adjacent PDF continuation rows. */
export function withCompanyEvidenceDateContext(packet: CompanyEvidencePacket): CompanyEvidencePacket {
  const rows = new Map(packet.excerpts.map((row) => [Number(row.location.split(':')[1]), row]))
  return { ...packet, excerpts: packet.excerpts.map((row) => {
    const previous = rows.get(Number(row.location.split(':')[1]) - 1)
    const next = rows.get(Number(row.location.split(':')[1]) + 1)
    const contexts = [...row.contextLocations ?? []]
    if (previous) {
      const splitYear = splitCompanyYear(previous.text, row.text)
      const datedContinuation = /截至(?:[一二三四五六七八九零〇○]{4}|(?:19|20)\d{2})年(?:末|底|\d{1,2}月)/.test(previous.text) && /[亿万千百]$/.test(previous.text) && /^元[，,、。]/.test(row.text)
      if (splitYear || datedContinuation) contexts.push(previous.location)
    }
    if (next && (closesSuppliedParenthesis(row.text, next.text) || closesFinancialYoYClause(row.text, next.text))) contexts.push(next.location)
    return contexts.length ? { ...row, contextLocations: [...new Set(contexts)] } : row
  }) }
}

function closesFinancialYoYClause(current: string, next: string): boolean {
  const clause = current.split(/[。！？]/).at(-1) ?? ''
  const unfinished = /(?:^|[，,；;])同比(增长|上升|下降|减少|下滑)?\s*$/.exec(clause)
  if (!unfinished || !/收入|利润|现金流|研发|销量|产量|营业额|费用|成本/.test(clause) || !/\d/.test(clause)) return false
  const continuation = /^(增长|上升|下降|减少|下滑)?\s*-?\d+(?:\.\d+)?\s*[%％](?=[，,；;。\s]|$)/.exec(next)
  if (!continuation) return false
  // No metric label may intervene; a stated direction cannot flip at the line break.
  if (!unfinished[1]) return Boolean(continuation[1])
  return !continuation[1] || unfinished[1] === continuation[1]
}

function closesSuppliedParenthesis(current: string, next: string): boolean {
  const open: string[] = []
  for (const char of current) {
    if (char === '(' || char === '（') open.push(char)
    else if (char === ')' || char === '）') {
      if (open.at(-1) !== (char === ')' ? '(' : '（')) return false
      open.pop()
    }
  }
  if (open.length !== 1) return false
  const close = open[0] === '(' ? ')' : '）'
  const end = next.indexOf(close)
  // A bounded unfinished parenthetical must close on this supplied immediate next row.
  return end >= 0 && end < 180 && !/[()（）。！？；;]/.test(next.slice(0, end))
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


/** Topic tests inspect actual acquired text; titles, issuer IDs and URLs alone
 * never establish a founding date, product capability or historical market size. */
function evidenceAnswerPatterns(purpose: string): readonly RegExp[] {
  if (purpose === 'company_history_strategy') return [
    /(?:founded|established)\s+in\s+(?:19|20)\d{2}|(?:创立|创办|始创|成立)于?\s*(?:19|20)\d{2}|(?:19|20)\d{2}\s*年.{0,30}(?:成立|创办|创立)/i,
    /共同注册成立|(?:前身|整体变更|改制).{0,100}(?:19|20|一九|二[〇零○])|(?:19|20)\d{2}.{0,80}(?:注册成立|整体变更|改制)/,
  ]
  if (purpose === 'product_technology_analysis' || purpose === 'competitive_market_map') return [
    // Official model pages often put the model and price on one normalized
    // body line. Preserve that exact locator with adjacent specification text.
    /[\u3400-\u9fffA-Za-z][\u3400-\u9fffA-Za-z0-9·-]{1,32}\s*(?:¥|￥)\s*[\d,]+(?:\s*[-—至]\s*(?:¥|￥)?\s*[\d,]+)?/i,
    /(?:续航|range|油耗|fuel consumption).{0,55}\d|\d[\d,.]*\s*(?:km|公里|千米|L).{0,25}(?:续航|range|油耗)/i,
    /(?:充电|闪充|charging|charge).{0,55}\d|\d[\d,.]*\s*(?:分钟|minutes?).{0,25}(?:充|charge)/i,
    /(?:电压|功率|转速|voltage|power).{0,45}\d|\d[\d,.]*\s*(?:kW|V|转\/分)\b/i,
    /(?:车型|型号|model|产品名称)\s*[：:]\s*\S+/i,
  ]
  if (purpose === 'market_structure_analysis') return [NEV_INDUSTRY_SALES]
  return []
}

const PURPOSE_HEADINGS: Readonly<Record<string, readonly string[]>> = {
  company_history_strategy: ['发展历程', '公司历程', '前身', '起步', '进入汽车', '战略转型', '董事长致辞'],
  management_governance_analysis: ['专业背景', '主要工作经历', '董事会成员', '高级管理人员情况', '董事、监事', '任职情况', '实际控制人', '报酬情况', '股权激励'],
  business_model_map: ['主要业务', '经营模式', '主营业务', '分行业', '分产品', '主要客户', '供应商'],
  product_technology_analysis: ['核心竞争力分析', '技术创新', '主要产品', '研发投入', '研发项目', '产品矩阵'],
  business_driver_analysis: ['主营业务分析', '营业收入构成', '分行业', '分产品', '分地区', '产销量', '增长'],
  financial_quality_analysis: ['主要会计数据', '现金流', '合并利润表', '合并资产负债表', '资产及负债', '收入和成本'],
  market_structure_analysis: ['行业情况', '行业发展', '市场规模', '产业链', '市场空间'],
  competitive_market_map: ['竞争格局', '竞争对手', '市场竞争', '核心竞争力', '市占率'],
  capital_allocation_review: ['投资状况', '研发投入', '利润分配', '回购', '资本支出', '重大资产', '募集资金'],
  company_risk_analysis: ['风险因素', '面临的风险', '可能面对的风险', '应对措施', '客户集中', '偿债', '商誉', '商誉原值', '商誉减值准备', '商誉所在资产组'],
}

const REVENUE_COMPOSITION = /营业收入构成|占营业收入比重/
const SEGMENT = /^(?:分产品|分行业)$|分(?:产品|行业).*毛利|(?:产品|业务).*毛利率/
const CUSTOMERS = /前\s*[五5]\s*(?:名|大)?客户.*(?:合计|比例|集中)|客户集中度/
const NEV_INDUSTRY_SALES = /(?:中国|我国).{0,12}(?:新能源汽车|新能源乘用车).{0,40}(?:销量|销售量).{0,36}\d[\d,.，]*\s*(?:万辆|万台)/
const SUPPLIERS = /前\s*[五5]\s*(?:名|大)?供应商.*(?:合计|比例|集中)/
const RESEARCH = /研发投入资本化|资本化研发投入|研发投入金额|研发投入占营业收入/
const OWNERSHIP = /持股比例|控股股东.*持股|实际控制人.*持股|(?:境内|境外)自然人\s+\d[\d.]*%/
const TOP_SHAREHOLDER_TABLE = /(?:前\s*10\s*名|前十名|前十大).{0,24}股东.*持股情况|(?:前\s*10\s*名|前十名|前十大)股东/
const RELATIONSHIP = /股东关联关系|一致行动.*说明|(?:兄弟|父子|之子|兄长|夫妻).*(?:实际控制人|股东)|实际控制人.*(?:兄弟|父子|夫妻)/
const BIOGRAPHY = /专业背景|主要工作经历|管理层履历|董事长.*(?:出生|毕业|曾任)|(?:现任|曾任).*(?:董事长|总经理)/
const PERSONNEL_CHANGES = /^(?:姓名\s+担任的职务\s+类型\s+日期\s+原因|.{1,40}\s+(?:被选举|聘任|解聘|离任|任期届满离任)\s+20\d{2}\s*年\s*\d{2}\s*月\s*\d{2}\s*日)/
const INTERNAL_CONTROL_AUDIT = /内部控制审计报告|内控审计报告|内部控制审议意见|保持了有效的财务报告内部控制/
const RELATED_TRANSACTION_POLICY = /关联交易决策制度|关联交易管理制度/
const CONTROLLER_GOVERNANCE = /实际控制人.{0,80}(?:兼任|担任|董事长|总裁|总经理)/
const REMUNERATION = /报告期内.*(?:董事|高管|高级管理).*报酬情况|税前报酬总额/
const CONSTRUCTION = /在建工程/
const OPERATING_SUMMARY = /实现收入.*同比/
const REVENUE_RECOGNITION = /收入确认.*(?:具体|方法)|内销.*(?:确认|收入)|外销.*(?:确认|收入)|客户接受|控制权转移/
const ACQUISITION_ACTION = /(?:已|完成|于|在|通过).{0,60}收购|收购.{0,100}(?:完成|交割|并表|合并范围|规模|收入贡献)/
const ACQUISITION = /合并成本|股份收购对价|股权收购对价|购买日.*支付|支付及待支付?现金|收购对价|收购.{0,100}(?:完成|交割|并表|合并范围|规模|收入贡献)/
// Goodwill note tables use the asset name and carrying-value headings rather
// than acquisition-price wording; reserve their table span for company risk.
const GOODWILL = /商誉原值|商誉减值准备|商誉所在资产组|商誉的账面金额|资产组商誉的账面金额/
const GOODWILL_TEST = /可收回金额的具体确定方法|预算\/预测期的|预测期增长率|永续增长率|税前折现率/
const REPORT_CURRENCY_CONVENTION = /除(?:有)?特别说明外.{0,40}人民币千元为单位表示/
const CHANNELS = /^分地区$|^分销售模式$|直销.*经销/
const VOLUME = /(?:产量|生产量).*(?:销量|销售量)|主要产品.*产销|产销情况/
const EMPLOYEE_PLAN = /员工持股计划的实施情况|员工持股计划.*(?:授予|解锁|实施)|报告期内全部有效的员工持股计划情况|股权激励.*(?:授予|行权|条件)|20\d{2}\s*年.{0,30}员工持股计划|员工持股计划.{0,50}(?:已通过|已完成|累计买入|解锁时点)/
const HISTORICAL_BUYBACK = /(?:累计|已|完成).{0,35}回购.{0,60}\d[\d,，]*\s*股|回购.{0,60}(?:数量为?|共计)\s*\d[\d,，]*\s*股/
const SHARE_ACTION = /报告期内.*(?:回购股份|增发股份).*\d.*股|(?:股份回购|回购股份|增发股份).*(?:金额|数量)|(?:累计|已|完成).{0,35}回购.{0,60}\d[\d,，]*\s*股/
const DIVIDEND = /(?:现金分红|现金红利|现金股利).*(?:\d|金额|比例)|利润分配.*(?:方案|实施)|(?:年度|报告期).*不派发现金红利|每\s*10\s*股.*(?:派|分)|分红.*实施/
const FINANCING = /配售.*(?:亿美元|港元|资金|股份)|(?:亿美元|港元).*配售|融资.*(?:发行|配售)|发行.*(?:债券|募集资金)/
const REGISTRATION = /共同注册成立|成立日期|(?:公司|本公司).*改制|股份公司.*成立/
const ENTITY_TRANSFORMATION = /(?:本公司|公司).{0,100}(?:由.{0,70}整体变更设立|整体变更为.{0,40}股份有限公司)/
const ENTITY_REGISTRATION = /(?:本公司|公司).{0,100}(?:于\s*\d{4}\s*年.{0,30}登记注册|登记注册)/
const STOCK_LISTING = /(?:本公司|公司)?股票于|股票.{0,40}(?:挂牌交易|挂牌上市|上市交易)/
const COMMERCIALIZATION = /批量出货|量产爬坡|进入量产|已量产|仍(?:在|处于?)研发|处于研发/
// Company product and competition methods need the actual product/technology
// passages, not only the high-scoring automotive strategy paragraphs. These
// content-ranked bundles retain battery, storage, and photovoltaic context
// with their nearby explanatory rows while keeping the original locators.
const BATTERY_STORAGE_PRODUCTS = /刀片电池|动力电池|储能电池|储能系统|储能解决方案|电源侧储能|电网储能/
const PHOTOVOLTAIC_PRODUCTS = /光伏业务|硅片.{0,30}电池片|光伏组件|光伏系统应用/
const PURPOSE_QUERY_FAMILIES: Readonly<Record<string, readonly RegExp[]>> = {
  company_history_strategy: [/共同注册成立/, ENTITY_TRANSFORMATION, ENTITY_REGISTRATION, STOCK_LISTING],
  business_model_map: [REVENUE_COMPOSITION, SEGMENT, CHANNELS, CUSTOMERS, SUPPLIERS, REVENUE_RECOGNITION],
  business_driver_analysis: [VOLUME, SEGMENT, CHANNELS, CUSTOMERS, RESEARCH, COMMERCIALIZATION],
  financial_quality_analysis: [SEGMENT, CUSTOMERS, RESEARCH, CONSTRUCTION],
  capital_allocation_review: [SHARE_ACTION, DIVIDEND, FINANCING, ACQUISITION, RESEARCH, CONSTRUCTION, OPERATING_SUMMARY, OWNERSHIP, TOP_SHAREHOLDER_TABLE, EMPLOYEE_PLAN],
  management_governance_analysis: [PERSONNEL_CHANGES, EMPLOYEE_PLAN, BIOGRAPHY, OWNERSHIP, TOP_SHAREHOLDER_TABLE, RELATIONSHIP, REMUNERATION, CONTROLLER_GOVERNANCE, INTERNAL_CONTROL_AUDIT, RELATED_TRANSACTION_POLICY],
  product_technology_analysis: [COMMERCIALIZATION, SEGMENT, RESEARCH, /主要研发项目|研发项目名称/, BATTERY_STORAGE_PRODUCTS, PHOTOVOLTAIC_PRODUCTS],
  company_risk_analysis: [CONTROLLER_GOVERNANCE, INTERNAL_CONTROL_AUDIT, RELATED_TRANSACTION_POLICY, GOODWILL, GOODWILL_TEST, REPORT_CURRENCY_CONVENTION, CUSTOMERS, ACQUISITION, REVENUE_COMPOSITION, SEGMENT, SUPPLIERS, RESEARCH, BIOGRAPHY, /偿债能力|有息负债/],
  // Industry-volume context is required by the market-boundary/TAM analysis.
  // Reserve it first so later customer and segment bundles cannot crowd its
  // only annual-report paragraph out of the evidence packet.
  market_structure_analysis: [NEV_INDUSTRY_SALES, CUSTOMERS, SUPPLIERS, SEGMENT],
  competitive_market_map: [/\b(?:400G|800G|1\.6T|1\.6T|OSFP|QSFP|PAM4|EML|HDI)\b|光模块|收发器|高速光|高多层|柔性电路板|产品(?:领域|系列|组合)|应用领域|服务器用板|技术路线/i, BATTERY_STORAGE_PRODUCTS, PHOTOVOLTAIC_PRODUCTS],
  company_content_review: [CUSTOMERS, REVENUE_RECOGNITION, EMPLOYEE_PLAN, SHARE_ACTION, DIVIDEND, SEGMENT, SUPPLIERS, RESEARCH, OWNERSHIP, BIOGRAPHY, REGISTRATION, FINANCING],
}
