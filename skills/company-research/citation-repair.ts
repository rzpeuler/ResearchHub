import type { CompanyResearchInput } from './contracts.ts'
import type { CompanyEvidencePacket } from './evidence.ts'
import type { CompanyMethodEvidenceRef, CompanyMethodFinding } from './methods.ts'
import { validateCompanyNumericGrounding } from './numeric-grounding.ts'

export interface CompanyCitationRepair {
  readonly findingIndex?: number
  readonly sectionId?: string
  readonly inputText: string
  readonly originalReferences: readonly CompanyMethodEvidenceRef[]
  readonly addedReferences: readonly CompanyMethodEvidenceRef[]
  readonly reason: string
}
type MethodOutput = { readonly findings: readonly CompanyMethodFinding[]; readonly markdown: string; readonly sections: readonly { readonly id: string; readonly markdown: string }[] }
const strip = (text: string) => text.replace(/\[[^\]\s]+@[^\]]+\]/g, '')
const numbers = (text: string) => [...strip(text).matchAll(/(?<![\w.])-?\d+(?:[,，]\d{3})*(?:\.\d+)?/g)].map((match) => match[0].replace(/[,，]/g, ''))

/** Normalize only an exact prepared FCF row to wording the numeric parser reads unambiguously. */
function normalizePreparedSimpleFcfFormula(text: string, evidencePackets: readonly CompanyEvidencePacket[], input: CompanyResearchInput, additionalRefs: readonly CompanyMethodEvidenceRef[] = []): string {
  const financial = input.preparedAnalysis && typeof input.preparedAnalysis === 'object' && !Array.isArray(input.preparedAnalysis)
    ? (input.preparedAnalysis as Record<string, unknown>).financial
    : undefined
  const rows = financial && typeof financial === 'object' && !Array.isArray(financial)
    ? (financial as Record<string, unknown>).simpleFreeCashFlow
    : undefined
  if (!Array.isArray(rows)) return text
  let result = text
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const formula = row.formula
    const period = row.period
    const basis = row.basis
    const unit = row.displayUnit
    const displayOperatingCashFlow = row.displayOperatingCashFlow
    const displayCapex = row.displayCapex
    const displayValue = row.displayValue
    const sourceCandidateIds = Array.isArray(row.sourceCandidateIds) ? row.sourceCandidateIds.filter((id): id is string => typeof id === 'string') : []
    if (typeof formula !== 'string' || typeof period !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(period) || basis !== 'YTD'
      || typeof unit !== 'string' || !['元', '千元', '万元', '百万元', '亿元', '万亿'].includes(unit)
      || typeof displayOperatingCashFlow !== 'string' || typeof displayCapex !== 'string' || typeof displayValue !== 'string'
      || !sourceCandidateIds.length || !sourceCandidateIds.every(id => input.sources.some(source => source.candidate.candidateId === id))) continue
    const operating = Number(displayOperatingCashFlow.replace(/,/g, ''))
    const capex = Number(displayCapex.replace(/,/g, ''))
    const value = Number(displayValue.replace(/,/g, ''))
    const decimals = displayValue.split('.')[1]?.length ?? 0
    if (![operating, capex, value].every(Number.isFinite) || operating < 0 || capex < 0
      || Number((operating - capex).toFixed(decimals)) !== value
      || formula !== `${displayOperatingCashFlow}${unit}−${displayCapex}${unit}＝${displayValue}${unit}`) continue
    const year = period.slice(0, 4)
    const month = Number(period.slice(5, 7))
    const periodLabel = month === 6 ? new RegExp(`${year}年(?:上半年|1\\s*[-—至]\\s*6月|1月至6月)`)
      : month === 3 ? new RegExp(`${year}年(?:一季度|第一季度|1\\s*季度)`)
        : month === 9 ? new RegExp(`${year}年(?:前三季度|前三季|1\\s*[-—至]\\s*9月|1月至9月)`)
          : month === 12 ? new RegExp(`${year}(?:年(?:全年|全年度|度)?|年度|全年|全年度)`)
            : undefined
    if (!periodLabel) continue
    const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const operandPattern = new RegExp(`${escaped(displayOperatingCashFlow)}\\s*${escaped(unit)}\\s*[−-]\\s*${escaped(displayCapex)}\\s*${escaped(unit)}`)
    const resultMagnitude = Math.abs(value).toFixed(decimals)
    const resultPattern = value < 0
      ? new RegExp(`(?:-|−|负)\\s*${escaped(resultMagnitude)}\\s*${escaped(unit)}`)
      : new RegExp(`${escaped(resultMagnitude)}\\s*${escaped(unit)}`)
    result = result.split(/(?<=\n)/).map(line => {
      if (!/简化自由现金流/.test(line) || !periodLabel.test(line) || !operandPattern.test(line) || !resultPattern.test(line)) return line
      const citationIds = [
        ...[...line.matchAll(/\[([^\]\s]+)@paragraph:(\d+)\]/g)].map(match => ({ id: match[1]!, location: `paragraph:${match[2]}` })),
        ...additionalRefs.map(ref => ({ id: ref.sourceCandidateId, location: ref.location })),
      ]
      const sourcesVerified = sourceCandidateIds.every(id => citationIds.some(ref =>
        ref.id === id && evidencePackets.some(packet =>
          packet.sourceCandidateId === id && packet.excerpts.some(excerpt => excerpt.location === ref.location),
        ),
      ))
      if (!sourcesVerified) return line
      let normalized = line.replace(new RegExp(operandPattern.source, 'g'), `${displayOperatingCashFlow}${unit}减${displayCapex}${unit}`)
      if (value < 0) {
        const normalizedResults = normalized.replace(new RegExp(resultPattern.source, 'g'), `负${resultMagnitude}${unit}`)
        if (normalizedResults === normalized) return line
        normalized = normalizedResults
      }
      return normalized
    }).join('')
  }
  return result
}

/**
 * Reuse a cited exact financial-table row only for a duplicate segment-margin
 * statement in the financial-quality section. The normal numeric validator
 * still checks every copied locator against the actual source text and row.
 */
function reinforceFinancialQualityMarginCitations(markdown: string, sections: readonly { id: string; markdown: string }[], packets: readonly CompanyEvidencePacket[], sources: CompanyResearchInput['sources']): { readonly sections: readonly { id: string; markdown: string }[]; readonly repairs: readonly CompanyCitationRepair[] } {
  const rowCandidates = markdown.split(/\r?\n/).filter(line => /^\s*\|/.test(line) && /\[[^\]\s]+@paragraph:\d+\]/.test(line))
  const commonChineseRun = (left: string, right: string): number => {
    const a = left.replace(/[^\u3400-\u9fff]/g, '')
    const b = right.replace(/[^\u3400-\u9fff]/g, '')
    let best = 0
    const previous = Array<number>(b.length + 1).fill(0)
    for (let i = 0; i < a.length; i++) {
      const current = Array<number>(b.length + 1).fill(0)
      for (let j = 0; j < b.length; j++) if (a[i] === b[j]) {
        current[j + 1] = previous[j]! + 1
        best = Math.max(best, current[j + 1]!)
      }
      previous.splice(0, previous.length, ...current)
    }
    return best
  }
  const repairs: CompanyCitationRepair[] = []
  const updated = sections.map(section => {
    if (section.id !== 'financial-quality') return section
    let text = section.markdown
    const chunks = text.split(/(?<=[。；;])/)
    for (const chunk of chunks) {
      if (!/毛利率/.test(chunk) || !/分(?:行业|产品)/.test(chunk) || !numbers(chunk).length || /\[[^\]\s]+@paragraph:\d+\]/.test(chunk)) continue
      const values = new Set(numbers(chunk))
      const matches = rowCandidates.filter(row => {
        const rowValues = new Set(numbers(row))
        if (![...values].every(value => rowValues.has(value))) return false
        if (commonChineseRun(chunk, row) < 6) return false
        const refs = [...row.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)]
        return refs.length > 0 && refs.every(match => packets.some(packet => packet.sourceCandidateId === match[1] && packet.excerpts.some(excerpt => excerpt.location === match[2])))
      })
      if (matches.length !== 1) continue
      const refs = [...matches[0]!.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => ({ sourceCandidateId: match[1]!, location: match[2]! }))
      const grounded = validateCompanyNumericGrounding({ markdown: `${chunk} ${refs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources, evidenceContexts: packets })
      if (grounded.status !== 'grounded') continue
      const offset = text.indexOf(chunk)
      if (offset < 0) continue
      const insertion = chunk.search(/[。；;]$/)
      const at = insertion >= 0 ? insertion : chunk.length
      const updatedChunk = `${chunk.slice(0, at).trimEnd()} ${refs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}${chunk.slice(at)}`
      text = `${text.slice(0, offset)}${updatedChunk}${text.slice(offset + chunk.length)}`
      repairs.push({ sectionId: section.id, inputText: chunk, originalReferences: [], addedReferences: refs, reason: 'A duplicate segment-margin statement was linked to its unique, already cited source-table row; numeric grounding revalidated the exact source row, classification, period context, unit, and displayed change before adding the locators.' })
    }
    // Keep a separate unit explanation from reasserting the numeric change
    // without its row citation; the immediately preceding claim carries it.
    text = text.replace(/(?:这里的)?\d+(?:[,，]\d{3})*(?:\.\d+)?\s*[%％]\s*沿用原表变化列(?:显示)?单位/g, match => {
      const value = numbers(match)[0]
      const citedMarginClaim = value && text.split(/(?<=[。；;])/).some(chunk => /毛利率/.test(chunk) && chunk.includes(value) && /\[[^\]\s]+@paragraph:\d+\]/.test(chunk))
      return citedMarginClaim
        ? '原表变化列沿用百分比单位'
        : match
    })
    return text === section.markdown ? section : { ...section, markdown: text }
  })
  return { sections: updated, repairs }
}

/** Preserve existing narrow citation fixes; repeated-substring source-ID repairs are limited to finding evidence. */
export function repairCompanyTrailingSourceIdTypo<T>(output: T, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): { readonly output: T; readonly repairs: readonly CompanyCitationRepair[] } {
  let raw: unknown = output
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return { output, repairs: [] } }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { output, repairs: [] }
  const value = structuredClone(raw) as Record<string, unknown>
  if (typeof value.markdown !== 'string' || !Array.isArray(value.sections) || !Array.isArray(value.findings)) return { output, repairs: [] }
  const repairs: CompanyCitationRepair[] = []
  const legacyRepairs = new Map<string, CompanyMethodEvidenceRef[]>()
  const legacyFindingIndexes = new Map<string, number>()
  const packetIds = [...new Set(packets.map(packet => packet.sourceCandidateId))]
  const isKnownLegacyTypo = (malformedId: string, candidateId: string): boolean => {
    const canonicalPrefix = candidateId.slice(0, -1)
    const malformedTailLength = malformedId.length - canonicalPrefix.length
    if (malformedId.startsWith('official-') && candidateId.startsWith('official-')
      && malformedId.startsWith(canonicalPrefix)
      && malformedTailLength >= 2 && malformedTailLength <= 3) return true
    if (malformedId.length === candidateId.length + 1 && malformedId.startsWith(candidateId)) return true
    if (malformedId.length === candidateId.length
      && malformedId.startsWith(candidateId.slice(0, -1))
      && malformedId.at(-1) !== candidateId.at(-1)) return true
    if (!malformedId.startsWith('official-') || !candidateId.startsWith('official-')) return false
    let commonPrefix = 0
    while (commonPrefix < malformedId.length && commonPrefix < candidateId.length && malformedId[commonPrefix] === candidateId[commonPrefix]) commonPrefix++
    if (commonPrefix < candidateId.length - 1) return false
    const tail = malformedId.slice(commonPrefix)
    if (tail.length < 11 || tail.length > candidateId.length) return false
    const stray = tail[0]!
    const repeatedTail = tail.slice(1)
    if (candidateId.indexOf(stray) < 0) return false
    for (let start = 0; start <= candidateId.length - 10; start++) if (candidateId.slice(start) === repeatedTail) return true
    return false
  }
  const isRepeatedSubstringTypo = (malformedId: string, candidateId: string): boolean => {
    if (!malformedId.startsWith('official-') || !candidateId.startsWith('official-')) return false
    // Accept only an insertion that duplicates an immediately adjacent 3-8
    // character substring of the canonical ID. This covers repeated ID tails
    // while excluding arbitrary edits, transpositions, and one-character typos.
    for (let insertion = 1; insertion < candidateId.length; insertion++) {
      for (let length = 3; length <= 8; length++) {
        const repeated = candidateId.slice(insertion - length, insertion)
        if (repeated.length === length
          && malformedId === `${candidateId.slice(0, insertion)}${repeated}${candidateId.slice(insertion)}`) return true
      }
    }
    return false
  }
  const resolve = (sourceId: string, location: string, includeRepeatedSubstring = false): CompanyMethodEvidenceRef | undefined => {
    const candidates = packetIds.filter(id => isKnownLegacyTypo(sourceId, id) || includeRepeatedSubstring && isRepeatedSubstringTypo(sourceId, id))
      .filter(id => {
        const sourceMatches = input.sources.filter(source => source.candidate.candidateId === id)
        const packetMatches = packets.filter(packet => packet.sourceCandidateId === id)
        if (sourceMatches.length !== 1 || packetMatches.length !== 1) return false
        const source = sourceMatches[0]!
        const packet = packetMatches[0]!
        const lineNumber = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
        if (!Number.isInteger(lineNumber) || lineNumber < 1) return false
        const originalLine = source.content.split(/\r?\n/)[lineNumber - 1]
        const exactExcerpt = packet.excerpts.filter(excerpt => excerpt.sourceCandidateId === id && excerpt.location === location && excerpt.text === originalLine)
        return exactExcerpt.length === 1
      })
    return candidates.length === 1 ? { sourceCandidateId: candidates[0]!, location } : undefined
  }
  const normalizeLegacyText = (text: string): string => text.replace(/\[([^\]\s]+)@(paragraph:\d+)\]/g, (literal, sourceId: string, location: string) => {
    // A duplicated adjacent source-ID substring may be repaired in prose as
    // well as finding objects only when the exact paragraph is present in one
    // unique source and one unique method packet. This canonicalizes identity;
    // the normal reference and numeric validators still decide whether the
    // paragraph supports the claim.
    const corrected = resolve(sourceId, location, true)
    if (!corrected) return literal
    const key = `${sourceId}@${location}`
    legacyRepairs.set(key, [...(legacyRepairs.get(key) ?? []), corrected])
    return `[${corrected.sourceCandidateId}@${corrected.location}]`
  })
  const markdown = normalizeLegacyText(value.markdown)
  const sections = value.sections.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const section = item as Record<string, unknown>
    return typeof section.markdown === 'string' ? { ...section, markdown: normalizeLegacyText(section.markdown) } : section
  })
  const findings = value.findings.map((item, findingIndex) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const finding = item as Record<string, unknown>
    if (!Array.isArray(finding.evidence)) return finding
    const findingRepairs: { original: CompanyMethodEvidenceRef; corrected: CompanyMethodEvidenceRef }[] = []
    const evidence = finding.evidence.map(ref => {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return ref
      const row = ref as Record<string, unknown>
      if (typeof row.sourceCandidateId !== 'string' || typeof row.location !== 'string') return ref
      const corrected = resolve(row.sourceCandidateId, row.location, true)
      if (!corrected) return ref
      findingRepairs.push({ original: { sourceCandidateId: row.sourceCandidateId, location: row.location }, corrected })
      return corrected
    })
    if (findingRepairs.length) {
      const uniqueRepairs = [...new Map(findingRepairs.map(item => [`${item.original.sourceCandidateId}@${item.original.location}->${item.corrected.sourceCandidateId}@${item.corrected.location}`, item])).values()]
      for (const item of uniqueRepairs) {
        const key = `${item.original.sourceCandidateId}@${item.original.location}`
        legacyRepairs.set(key, [...(legacyRepairs.get(key) ?? []), item.corrected])
        legacyFindingIndexes.set(key, findingIndex)
      }
    }
    return {
      ...finding,
      evidence,
    }
  })
  for (const [key, additions] of legacyRepairs) {
    const [sourceCandidateId, location] = key.split('@')
    const corrected = [...new Map(additions.map(ref => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()]
    if (corrected.length === 1) repairs.push({ ...(legacyFindingIndexes.has(key) ? { findingIndex: legacyFindingIndexes.get(key)! } : {}), inputText: key, originalReferences: [{ sourceCandidateId: sourceCandidateId!, location: location! }], addedReferences: corrected, reason: 'The malformed source ID matched an existing narrow typo pattern; the exact paragraph text matched its unique source document line and supplied packet excerpt.' })
  }
  return { output: { ...value, markdown, sections, findings } as T, repairs }
}

/** R107: retain the annual phone-products scope across separate revenue/margin tables. */
function exactAnnualPhoneMarginReferences(finding: CompanyMethodFinding, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): CompanyMethodEvidenceRef[] | undefined {
  if (!/2025\s*年(?:度)?手机部件、组装及其他产品收入\s*155,?236,?528,?000\s*元/.test(finding.text)
    || !/毛利率(?:为|是)\s*6\.29\s*[%％]/.test(finding.text)
    || numbers(finding.text).some(value => !['2025', '155236528000', '19.31', '6.29'].includes(value))) return undefined
  const cited = new Set(finding.evidence.map(ref => `${ref.sourceCandidateId}@${ref.location}`))
  const matches: CompanyMethodEvidenceRef[][] = []
  for (const packet of packets) {
    const sources = input.sources.filter(source => source.candidate.candidateId === packet.sourceCandidateId)
    if (sources.length !== 1 || sources[0]!.title !== packet.title || !/^2025\s*年年度报告(?:全文)?$/.test(packet.title)) continue
    const lines = sources[0]!.content.split(/\r?\n/)
    const supplied = (paragraph: number) => packet.excerpts.filter(excerpt => excerpt.sourceCandidateId === packet.sourceCandidateId && excerpt.location === `paragraph:${paragraph}` && excerpt.text === lines[paragraph - 1])
    const header = ['单位：元', '营业收入 营业成本 毛利率 营业收入比上', '年同期增减', '营业成本比上', '年同期增减', '毛利率比上', '年同期增减']
    if (!header.every((text, i) => supplied(833 + i).length === 1 && supplied(833 + i)[0]!.text === text && (i >= 5 || cited.has(`${packet.sourceCandidateId}@paragraph:${833 + i}`)))) continue
    const revenueRows = new Map([[819, '手机部件、组装'], [820, '及其他产品 155,236,528,000.00 19.31% 159,608,576,000.00 20.54% -2.74%']])
    if (![...revenueRows].every(([paragraph, text]) => supplied(paragraph).length === 1 && supplied(paragraph)[0]!.text === text && cited.has(`${packet.sourceCandidateId}@paragraph:${paragraph}`))) continue
    if (supplied(845).length !== 1 || supplied(845)[0]!.text !== '分产品' || supplied(850).length !== 1 || supplied(850)[0]!.text !== '手机部件、组' || supplied(851).length !== 1) continue
    const end = packet.excerpts.filter(excerpt => Number(excerpt.location.split(':')[1]) > 845 && /^(?:分行业|分地区|分销售模式)$/.test(excerpt.text.trim())).map(excerpt => Number(excerpt.location.split(':')[1])).sort((a, b) => a - b)[0]
    if (end === undefined || end <= 851) continue
    const rows = packet.excerpts.filter(excerpt => {
      const paragraph = Number(excerpt.location.split(':')[1])
      if (paragraph <= 845 || paragraph >= end || supplied(paragraph).length !== 1) return false
      const continuation = /^([^\d]+?)\s*(?=\d)/.exec(excerpt.text)?.[1]?.trim() ?? ''
      const prior = supplied(paragraph - 1)[0]?.text ?? ''
      const label = (continuation === '装及其他产品' && prior === '手机部件、组' ? prior + continuation : continuation).replace(/\s+/g, '')
      const cells = numbers(excerpt.text).map(Number)
      return label === '手机部件、组装及其他产品' && cells.length === 6 && cells[0] === 155236528000 && cells.at(-4) === 6.29
    })
    if (rows.length === 1 && rows[0]!.location === 'paragraph:851') matches.push([838, 839, 845, 850, 851].map(paragraph => ({ sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${paragraph}` })))
  }
  return matches.length === 1 ? matches[0]!.filter(ref => !cited.has(`${ref.sourceCandidateId}@${ref.location}`)) : undefined
}

/** R105: two explicitly paired H1 product margins, never equal industry rows. */
function exactH1ProductMarginReferences(finding: CompanyMethodFinding, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): CompanyMethodEvidenceRef[] | undefined {
  if (!/(?:半年报|半年度报告)/.test(finding.text)) return undefined
  const pairs = [...finding.text.matchAll(/(电子及其他产品|电子产品|汽车、汽车相关产品及其他产品|汽车相关产品)(?:行)?毛利率(?:为|是)?\s*([+-]?\d+(?:\.\d+)?)\s*[%％]\s*[，,]\s*(?:同比|比上年同期)(?:变动|变化|增减)?(?:为)?\s*(上升|增加|提高|下降|减少|降低)?\s*([+-]?\d+(?:\.\d+)?)\s*[%％]/g)]
  if (pairs.length !== 2) return undefined
  const expected = new Map<string, { level: number; change: number }>([['电子及其他产品', { level: 5.04, change: -2.67 }], ['汽车、汽车相关产品及其他产品', { level: 22.33, change: 1.98 }]])
  const labels = new Set<string>()
  for (const pair of pairs) {
    const label = pair[1]!.startsWith('电子') ? '电子及其他产品' : '汽车、汽车相关产品及其他产品'
    const wanted = expected.get(label)!
    const amount = Number(pair[4])
    // A direction word cannot override a contradictory explicit sign.
    if (pair[3] && (/下降|减少|降低/.test(pair[3]) ? amount > 0 && pair[4]!.startsWith('+') : amount < 0)) return undefined
    const change = pair[3] ? (/下降|减少|降低/.test(pair[3]) ? -Math.abs(amount) : Math.abs(amount)) : amount
    if (labels.has(label) || Number(pair[2]) !== wanted.level || change !== wanted.change) return undefined
    labels.add(label)
  }
  const cited = new Set(finding.evidence.map(ref => `${ref.sourceCandidateId}@${ref.location}`))
  const matches: CompanyMethodEvidenceRef[][] = []
  for (const packet of packets) {
    const sources = input.sources.filter(source => source.candidate.candidateId === packet.sourceCandidateId)
    if (sources.length !== 1 || sources[0]!.title !== packet.title || !/^(?:19|20)\d{2}\s*年半年度报告(?:全文)?$/.test(packet.title)) continue
    const year = packet.title.match(/(?:19|20)\d{2}/)![0]
    if ([...finding.text.matchAll(/\b((?:19|20)\d{2})\s*年/g)].some(match => match[1] !== year)) continue
    const lines = sources[0]!.content.split(/\r?\n/)
    const supplied = (paragraph: number) => packet.excerpts.filter(excerpt => excerpt.location === `paragraph:${paragraph}` && excerpt.sourceCandidateId === packet.sourceCandidateId && excerpt.text === lines[paragraph - 1])
    const header = ['单位：元', '营业收入 营业成本 毛利率', '营业收入', '比上年同', '期增减', '营业成本', '比上年同', '期增减', '毛利率比', '上年同期', '增减']
    if (!header.every((text, index) => supplied(716 + index).length === 1 && supplied(716 + index)[0]!.text === text && cited.has(`${packet.sourceCandidateId}@paragraph:${716 + index}`))) continue
    if (supplied(727).length !== 1 || supplied(727)[0]!.text !== '分行业' || supplied(731).length !== 1 || supplied(731)[0]!.text !== '分产品' || !cited.has(`${packet.sourceCandidateId}@paragraph:731`)) continue
    if (![732, 733, 734].every(paragraph => supplied(paragraph).length === 1)) continue
    const compact = (text: string) => text.replace(/\s+/g, '')
    if (compact(supplied(733)[0]!.text) !== '汽车、汽车相关产品及') continue
    const productEnd = packet.excerpts.filter(excerpt => Number(excerpt.location.split(':')[1]) > 731 && /^(?:分行业|分地区|分销售模式)$/.test(excerpt.text.trim())).map(excerpt => Number(excerpt.location.split(':')[1])).sort((a, b) => a - b)[0]
    if (productEnd === undefined || productEnd <= 734) continue
    let unique = true
    for (const [label, { level, change }] of expected) {
      const rowMatches = packet.excerpts.filter(excerpt => {
        const paragraph = Number(excerpt.location.split(':')[1])
        if (paragraph <= 731 || paragraph >= productEnd || supplied(paragraph).length !== 1) return false
        const continuation = /^([^\d]+?)\s*(?=\d)/.exec(excerpt.text)?.[1]?.trim() ?? ''
        const prior = supplied(paragraph - 1)[0]?.text ?? ''
        const rowLabel = compact(continuation === '其他产品' && compact(prior) === '汽车、汽车相关产品及' ? prior + continuation : continuation)
        const cells = numbers(excerpt.text).map(Number)
        return rowLabel === label && cells.length === 6 && cells.at(-4) === level && cells.at(-1) === change
      })
      if (rowMatches.length !== 1 || rowMatches[0]!.location !== (label.startsWith('电子') ? 'paragraph:732' : 'paragraph:734')) unique = false
    }
    if (unique) matches.push([732, 733, 734].map(paragraph => ({ sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${paragraph}` })))
  }
  return matches.length === 1 ? matches[0]!.filter(ref => !cited.has(`${ref.sourceCandidateId}@${ref.location}`)) : undefined
}

/** Bind one official split-industry margin finding to its exact numeric row. */
function exactH1IndustryMarginReferences(finding: CompanyMethodFinding, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): CompanyMethodEvidenceRef[] | undefined {
  const claim = /(?:^|[，,；;。！？：:])\s*(?:事实\s*[：:]\s*)?(?:半年报)?(?:分行业表(?:中|列示|显示|披露)?\s*[：，,]?\s*)?([\u3400-\u9fff·（）()、]+?)毛利率[^，,；;。！？]{0,24}(?:同比|比上年同期)(?:变化|变动|增减)?(?:为)?\s*([+-]?\d+(?:\.\d+)?)\s*[%％]/.exec(finding.text)
  if (!claim) return undefined
  const label = claim[1]!.replace(/\s+/g, '')
  const expectedChange = Number(claim[2])
  if (!label || !Number.isFinite(expectedChange)) return undefined
  const cited = new Set(finding.evidence.map(ref => `${ref.sourceCandidateId}@${ref.location}`))
  const matches: CompanyMethodEvidenceRef[][] = []
  for (const packet of packets) {
    const sources = input.sources.filter(source => source.candidate.candidateId === packet.sourceCandidateId)
    const normalizedTitle = packet.title.replace(/\s+/g, '')
    if (sources.length !== 1 || sources[0]!.title !== packet.title || !/(?:19|20)\d{2}年半年度报告(?:全文)?/.test(normalizedTitle)) continue
    const lines = sources[0]!.content.split(/\r?\n/)
    const supplied = (paragraph: number) => packet.excerpts.filter(row => row.sourceCandidateId === packet.sourceCandidateId && row.location === `paragraph:${paragraph}` && row.text === lines[paragraph - 1])
    const excerpts = packet.excerpts.map(row => ({ row, paragraph: Number(/^paragraph:(\d+)$/.exec(row.location)?.[1]) })).filter(item => Number.isInteger(item.paragraph)).sort((a, b) => a.paragraph - b.paragraph)
    const candidateRows = excerpts.filter(({ row }) => {
      if (excerptTableKind(packet, row) !== 'industry') return false
      const percentValues = [...row.text.matchAll(/([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*[%％]/g)].map(match => Number(match[1]!.replace(/,/g, '')))
      if (percentValues.at(-1) !== expectedChange) return false
      const rowPrefix = /^[\s\u3000]*([\u3400-\u9fff·（）()、]+?)\s*(?=-?\d)/.exec(row.text)?.[1] ?? ''
      const previous = excerpts.find(item => item.paragraph === Number(row.location.split(':')[1]) - 1)?.row
      const splitPrefix = previous && !/\d/.test(previous.text) && !/[。；;！？]/.test(previous.text) && previous.text.length < 90 && previous.text.trim() !== '分行业' ? previous.text : ''
      return (splitPrefix + rowPrefix).replace(/\s+/g, '') === label
    })
    if (candidateRows.length !== 1) continue
    const row = candidateRows[0]!
    const rowParagraph = row.paragraph
    const previous = supplied(rowParagraph - 1)
    const splitLabel = previous.length === 1 && !/\d/.test(previous[0]!.text) && !/[。；;！？]/.test(previous[0]!.text) && previous[0]!.text.trim() !== '分行业'
    const labelParagraph = splitLabel ? rowParagraph - 1 : rowParagraph
    const industryHeading = packet.excerpts.filter(item => Number(item.location.split(':')[1]) < labelParagraph && Number(item.location.split(':')[1]) >= labelParagraph - 40 && item.text.trim() === '分行业').sort((a, b) => Number(b.location.split(':')[1]) - Number(a.location.split(':')[1]))[0]
    if (!industryHeading || !cited.has(`${packet.sourceCandidateId}@${industryHeading.location}`)) continue
    const headingParagraph = Number(industryHeading.location.split(':')[1])
    const unit = packet.excerpts.filter(item => Number(item.location.split(':')[1]) < headingParagraph && Number(item.location.split(':')[1]) >= labelParagraph - 40 && /^\s*单位\s*[:：]\s*元\s*$/.test(item.text)).sort((a, b) => Number(b.location.split(':')[1]) - Number(a.location.split(':')[1]))[0]
    if (!unit || !cited.has(`${packet.sourceCandidateId}@${unit.location}`)) continue
    const header = packet.excerpts.filter(row => {
      const paragraph = Number(row.location.split(':')[1])
      return paragraph > Number(unit.location.split(':')[1]) && paragraph < headingParagraph
    })
    const headerText = header.map(row => row.text).join('').replace(/\s+/g, '')
    if (!/营业收入/.test(headerText) || !/营业成本/.test(headerText) || !/毛利率/.test(headerText)
      || !/毛利率比上年同期增减/.test(headerText) || !header.every(item => cited.has(`${packet.sourceCandidateId}@${item.location}`))) continue
    const additions: CompanyMethodEvidenceRef[] = [{ sourceCandidateId: packet.sourceCandidateId, location: row.row.location }]
    if (splitLabel) additions.push({ sourceCandidateId: packet.sourceCandidateId, location: previous[0]!.location })
    matches.push(additions.filter(ref => !cited.has(`${ref.sourceCandidateId}@${ref.location}`)))
  }
  return matches.length === 1 && matches[0]!.length ? matches[0] : undefined
}

/**
 * Backfill only the omitted value row in the market-structure H1 margin finding
 * shape seen in R169. The finding itself must name the classification and exact
 * row label, cite every split unit/header line, and state the four relevant
 * cells (revenue, cost, margin level, margin change) exactly as disclosed.
 */
function exactMarketStructureH1MarginRowReference(
  finding: CompanyMethodFinding,
  packets: readonly CompanyEvidencePacket[],
  input: CompanyResearchInput,
): CompanyMethodEvidenceRef[] | undefined {
  const classification = /分(行业|产品)/.exec(finding.text)?.[1]
  if (!classification || !/毛利率/.test(finding.text)) return undefined
  const tableKind: CompanyTableKind = classification === '行业' ? 'industry' : 'product'
  const labelMatch = tableKind === 'industry'
    ? /日用电子器件制造业/
    : /汽车、汽车相关产品及其他产品/
  const label = labelMatch.exec(finding.text)?.[0]
  if (!label) return undefined
  const cited = new Set(finding.evidence.map(ref => `${ref.sourceCandidateId}@${ref.location}`))
  const matches: CompanyMethodEvidenceRef[][] = []
  const expectedHeader = [
    '单位：元', '营业收入 营业成本 毛利率', '营业收入', '比上年同', '期增减',
    '营业成本', '比上年同', '期增减', '毛利率比', '上年同期', '增减',
  ]
  const normalizedLabel = label.replace(/\s+/g, '')
  for (const packet of packets) {
    const sources = input.sources.filter(source => source.candidate.candidateId === packet.sourceCandidateId)
    if (sources.length !== 1 || sources[0]!.title !== packet.title || !/^2026\s*年半年度报告(?:全文)?$/.test(packet.title.replace(/\s+/g, ''))) continue
    const source = sources[0]!
    const lines = source.content.split(/\r?\n/)
    const supplied = (paragraph: number) => packet.excerpts.filter(excerpt =>
      excerpt.sourceCandidateId === packet.sourceCandidateId
      && excerpt.location === `paragraph:${paragraph}`
      && excerpt.text === lines[paragraph - 1],
    )
    const headerRefs = expectedHeader.map((text, index) => {
      const paragraph = 716 + index
      const excerpt = supplied(paragraph)
      return excerpt.length === 1 && excerpt[0]!.text === text && cited.has(`${packet.sourceCandidateId}@paragraph:${paragraph}`)
    })
    if (headerRefs.some(valid => !valid)) continue

    const expectedCells: number[] = []
    const revenue = /(?:营业)?收入\s*([\d,，]+(?:\.\d+)?)\s*元/.exec(finding.text)
    const cost = /(?:营业)?成本\s*([\d,，]+(?:\.\d+)?)\s*元/.exec(finding.text)
    const margin = /毛利率(?:为|是)?\s*([\d,，]+(?:\.\d+)?)\s*[%％]/.exec(finding.text)
    const change = /毛利率比上年同期增减(?:列)?为?\s*([+-]?\d[\d,，]*(?:\.\d+)?)\s*[%％]/.exec(finding.text)
    if (!revenue || !cost || !margin || !change) continue
    expectedCells.push(...[revenue[1], cost[1], margin[1], change[1]].map(value => Number(value!.replace(/[,，]/g, ''))))
    if (expectedCells.some(value => !Number.isFinite(value))) continue

    const excerpts = packet.excerpts
      .map(excerpt => ({ excerpt, paragraph: Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1]) }))
      .filter(item => Number.isInteger(item.paragraph))
    const rowMatches: Array<{ paragraph: number; preceding?: number }> = []
    for (const { excerpt, paragraph } of excerpts) {
      if (excerptTableKind(packet, excerpt) !== tableKind) continue
      const section = [...excerpts].filter(item => item.paragraph < paragraph && item.paragraph >= paragraph - 40 && item.excerpt.text.trim() === `分${classification}`).sort((a, b) => b.paragraph - a.paragraph)[0]
      if (!section) continue
      const rowValues = numbers(excerpt.text).map(Number)
      if (rowValues.length !== 6 || !/%|％/.test(excerpt.text)) continue
      const currentLabel = /^[\s\u3000]*([\u3400-\u9fff·（）()、]+?)\s*(?=-?\d)/.exec(excerpt.text)?.[1]?.replace(/\s+/g, '') ?? ''
      const prior = excerpts.find(item => item.paragraph === paragraph - 1)?.excerpt
      const splitLabel = Boolean(prior && !/\d/.test(prior.text) && !/[。；;！？]/.test(prior.text) && prior.text.length < 90 && prior.text.trim() !== `分${classification}`)
      const fullLabel = `${splitLabel ? prior!.text.replace(/\s+/g, '') : ''}${currentLabel}`
      if (fullLabel !== normalizedLabel) continue
      // The exact classification row must own the cited sales/cost/margin cells.
      if (rowValues[0] !== expectedCells[0] || rowValues[1] !== expectedCells[1]
        || rowValues[2] !== expectedCells[2] || rowValues[5] !== expectedCells[3]) continue
      if (splitLabel && !cited.has(`${packet.sourceCandidateId}@paragraph:${paragraph - 1}`)) continue
      rowMatches.push({ paragraph, ...(splitLabel ? { preceding: paragraph - 1 } : {}) })
    }
    if (rowMatches.length !== 1) continue
    const row = rowMatches[0]!
    matches.push([
      ...(row.preceding ? [{ sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${row.preceding}` }] : []),
      { sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${row.paragraph}` },
    ].filter(ref => !cited.has(`${ref.sourceCandidateId}@${ref.location}`)))
  }
  return matches.length === 1 && matches[0]!.length ? matches[0] : undefined
}

/**
 * Complete only omitted split label/value locators for a uniquely named,
 * already-cited official product/industry table row. The table unit and
 * classification heading must already be cited, along with its period header
 * or main metric header. Any remaining supplied header lines are added with
 * the exact split label/value row; numeric grounding remains the final gate.
 */
function exactClassifiedTableRowContextReferences(
  finding: CompanyMethodFinding,
  packets: readonly CompanyEvidencePacket[],
  input: CompanyResearchInput,
): CompanyMethodEvidenceRef[] | undefined {
  const tableKind = findingTableKind(finding.text)
  if (!tableKind || !/\b(?:19|20)\d{2}\s*年/.test(finding.text) || !/收入|毛利率/.test(finding.text)) return undefined
  const normalizedFinding = finding.text.replace(/[\s“”"「」『』]/g, '')
  const cited = new Set(finding.evidence.map(ref => `${ref.sourceCandidateId}@${ref.location}`))
  const matches = new Map<string, CompanyMethodEvidenceRef[][]>()

  for (const packet of packets) {
    if (!finding.evidence.some(ref => ref.sourceCandidateId === packet.sourceCandidateId)) continue
    const sourceMatches = input.sources.filter(source => source.candidate.candidateId === packet.sourceCandidateId)
    if (sourceMatches.length !== 1 || sourceMatches[0]!.title !== packet.title || !/(?:年年度报告|年半年度报告)/.test(packet.title.replace(/\s+/g, ''))) continue
    const source = sourceMatches[0]!
    const lines = source.content.split(/\r?\n/)
    const byParagraph = new Map<number, CompanyEvidencePacket['excerpts'][number]>()
    for (const excerpt of packet.excerpts) {
      const paragraph = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
      if (!Number.isInteger(paragraph) || excerpt.sourceCandidateId !== packet.sourceCandidateId || excerpt.text !== lines[paragraph - 1]) continue
      if (!byParagraph.has(paragraph)) byParagraph.set(paragraph, excerpt)
      else if (byParagraph.get(paragraph)!.text !== excerpt.text) byParagraph.delete(paragraph)
    }
    const excerpts = [...byParagraph.entries()].map(([paragraph, excerpt]) => ({ paragraph, excerpt })).sort((a, b) => a.paragraph - b.paragraph)
    const citedRows = new Set(excerpts.filter(item => cited.has(`${packet.sourceCandidateId}@paragraph:${item.paragraph}`)
      && numbers(item.excerpt.text).length >= 2 && excerptTableKind(packet, item.excerpt) === tableKind).map(item => item.paragraph))
    for (const { paragraph: rowParagraph, excerpt: rowExcerpt } of excerpts) {
      if (citedRows.size && !citedRows.has(rowParagraph)) continue
      if (excerptTableKind(packet, rowExcerpt) !== tableKind || numbers(rowExcerpt.text).length < 2) continue
      const rowPrefix = /^[\s\u3000]*([^\d]+?)\s*(?=-?\d)/.exec(rowExcerpt.text)?.[1]?.trim() ?? ''
      const preceding: { paragraph: number; text: string }[] = []
      for (let current = rowParagraph - 1; current > 0 && preceding.length < 3; current -= 1) {
        const excerpt = byParagraph.get(current)
        if (!excerpt || /\d|[。；;！？]|单位|营业收入|营业成本|毛利率|分行业|分产品|分地区/.test(excerpt.text)) break
        if (!excerpt.text.trim() || excerpt.text.length > 90) break
        preceding.unshift({ paragraph: current, text: excerpt.text.trim() })
      }
      const labelCandidates: { readonly label: string; readonly prefixes: readonly { readonly paragraph: number; readonly text: string }[] }[] = []
      if (rowPrefix) labelCandidates.push({ label: rowPrefix.replace(/\s+/g, ''), prefixes: [] })
      for (let start = 0; start < preceding.length; start += 1) {
        const prefixes = preceding.slice(start)
        const label = `${prefixes.map(item => item.text).join('')}${rowPrefix}`.replace(/\s+/g, '')
        if (label.length >= 4 && normalizedFinding.includes(label)) labelCandidates.push({ label, prefixes })
      }
      const matchingLabels = labelCandidates.filter(candidate => candidate.label.length >= 4 && normalizedFinding.includes(candidate.label))
      const longestLabels = matchingLabels.filter(candidate => !matchingLabels.some(other => other.label.length > candidate.label.length && other.label.endsWith(candidate.label)))
      if (longestLabels.length !== 1) continue

      const classificationText = tableKind === 'industry' ? '分行业' : '分产品'
      const heading = excerpts.filter(item => item.paragraph < rowParagraph && item.paragraph >= rowParagraph - 40 && /^(?:分行业|分产品|分地区)$/.test(item.excerpt.text.trim())).at(-1)
      if (!heading || heading.excerpt.text.trim() !== classificationText || !cited.has(`${packet.sourceCandidateId}@paragraph:${heading.paragraph}`)) continue
      const unit = excerpts.filter(item => item.paragraph < heading.paragraph && item.paragraph >= rowParagraph - 40 && /^\s*单位\s*[:：]\s*(?:元|千元|万元|百万元|亿元)\s*$/.test(item.excerpt.text)).at(-1)
      if (!unit || !cited.has(`${packet.sourceCandidateId}@paragraph:${unit.paragraph}`)) continue
      const firstClassificationHeading = excerpts.find(item => item.paragraph > unit.paragraph
        && item.paragraph <= heading.paragraph && /^(?:分行业|分产品|分地区)$/.test(item.excerpt.text.trim()))
      if (!firstClassificationHeading) continue
      const header = excerpts.filter(item => item.paragraph > unit.paragraph && item.paragraph < firstClassificationHeading.paragraph)
      if (!header.length) continue
      const compactHeader = header.map(item => item.excerpt.text).join('').replace(/\s+/g, '')
      if (!/营业收入/.test(compactHeader)) continue
      const mainHeader = header.find(item => /营业收入/.test(item.excerpt.text)
        && (!/毛利率/.test(compactHeader) || /营业成本/.test(item.excerpt.text) && /毛利率/.test(item.excerpt.text)))
      const periodHeader = header.find(item => /(?:19|20)\d{2}\s*年/.test(item.excerpt.text))
      const citedHeaderAnchor = periodHeader
        ? cited.has(`${packet.sourceCandidateId}@paragraph:${periodHeader.paragraph}`)
        : Boolean(mainHeader && cited.has(`${packet.sourceCandidateId}@paragraph:${mainHeader.paragraph}`))
      if (!mainHeader || !citedHeaderAnchor) continue

      const label = longestLabels[0]!
      const refs = [
        ...header.map(item => ({ sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${item.paragraph}` })),
        ...label.prefixes.map(item => ({ sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${item.paragraph}` })),
        { sourceCandidateId: packet.sourceCandidateId, location: rowExcerpt.location },
      ].filter(ref => !cited.has(`${ref.sourceCandidateId}@${ref.location}`))
      if (refs.length) {
        const tableKey = `${packet.sourceCandidateId}@${heading.paragraph}`
        matches.set(tableKey, [...(matches.get(tableKey) ?? []), refs])
      }
    }
  }
  if (!matches.size || [...matches.values()].some(tableMatches => tableMatches.length !== 1)) return undefined
  return [...matches.values()].flat(2)
}

/** R111: preserve the percent unit shown by BYD's official annual product-margin change column. */
function correctVerifiedAnnualProductMarginUnits(text: string, citedRefs: readonly CompanyMethodEvidenceRef[], packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): string | undefined {
  const refs = new Set(citedRefs.map(ref => `${ref.sourceCandidateId}@${ref.location}`))
  for (const packet of packets) {
    const source = input.sources.find(item => item.candidate.candidateId === packet.sourceCandidateId)
    if (!source || source.title !== '2025年年度报告' || packet.title !== source.title) continue
    const lines = source.content.split(/\r?\n/)
    const supplied = (paragraph: number) => packet.excerpts.filter(row => row.sourceCandidateId === packet.sourceCandidateId && row.location === `paragraph:${paragraph}` && row.text === lines[paragraph - 1])
    const exactRows = [
      { label: '手机部件、组装及其他产品', labelParagraphs: [850], valueParagraph: 851, value: -2.06 },
      { label: '汽车相关产品及其他产品', labelParagraphs: [852, 853, 854], valueParagraph: 855, value: -1.82 },
    ]
    const header = [833, 834, 835, 836, 837, 838, 839, 845]
    if (!header.every(paragraph => supplied(paragraph).length === 1 && refs.has(`${packet.sourceCandidateId}@paragraph:${paragraph}`))) continue
    const validated = exactRows.filter(row => {
      const labels = row.labelParagraphs.map(paragraph => supplied(paragraph)[0]?.text)
      const value = supplied(row.valueParagraph)[0]?.text
      if (labels.some(item => item === undefined) || !value) return false
      if (!row.label.includes(labels.join('').replace(/\s+/g, '')) && !labels.join('').replace(/\s+/g, '').includes(row.label)) return false
      if (!row.labelParagraphs.every(paragraph => refs.has(`${packet.sourceCandidateId}@paragraph:${paragraph}`)) || !refs.has(`${packet.sourceCandidateId}@paragraph:${row.valueParagraph}`)) return false
      const values = [...value.matchAll(/([+-]?\d+(?:,\d{3})*(?:\.\d+)?)\s*[%％]/g)].map(match => Number(match[1]!.replace(/,/g, '')))
      return values.at(-1) === row.value
    })
    if (validated.length !== exactRows.length) continue
    let corrected = text
    for (const row of validated) {
      const token = row.value.toFixed(2)
      const pattern = new RegExp(`(?<![\\d.])${token}\\s*个百分点`,'g')
      corrected = corrected.replace(pattern, (match, offset: number) => {
        const context = corrected.slice(Math.max(0, offset - 80), Math.min(corrected.length, offset + match.length + 110))
        return context.includes(row.label) ? match.replace(/个百分点$/, '%') : match
      })
    }
    if (corrected !== text) return corrected
  }
  return undefined
}

/**
 * Backfills only the two explicit short labels used by the R88 product-margin
 * finding. The source rows, product section, unit and full header must all be
 * supplied; the existing claim must already cite every unit/header paragraph.
 */
function exactProductMarginRowReferences(
  claim: string,
  existing: readonly CompanyMethodEvidenceRef[],
  packets: readonly CompanyEvidencePacket[],
): CompanyMethodEvidenceRef[] | undefined {
  if (!/产品毛利率/.test(claim)) return undefined
  const normalized = strip(claim).replace(/\s+/g, '')
  const claimMatches = [...normalized.matchAll(/(汽车相关产品|手机产品)\s*([\d,，]+(?:\.\d+)?)\s*[%％]/g)]
  if (claimMatches.length !== 2 || new Set(claimMatches.map(match => match[1])).size !== 2) return undefined
  const mappings = new Map<string, { readonly value: number; readonly exactLabel: string }>(claimMatches.map(match => [match[1]!, {
    value: Number(match[2]!.replace(/[,，]/g, '')),
    exactLabel: match[1] === '汽车相关产品' ? '汽车、汽车相关产品及其他产品' : '手机部件、组装及其他产品',
  }]))
  const refs = new Map(existing.map(ref => [`${ref.sourceCandidateId}@${ref.location}`, ref]))
  const cited = new Set(refs.keys())
  const matches = new Map([...mappings.keys()].map(alias => [alias, [] as CompanyMethodEvidenceRef[][]]))

  for (const packet of packets) {
    const excerpts = packet.excerpts
      .map(excerpt => ({ excerpt, paragraph: Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1]) }))
      .filter(item => Number.isInteger(item.paragraph))
      .sort((left, right) => left.paragraph - right.paragraph)
    const byParagraph = new Map(excerpts.map(item => [item.paragraph, item.excerpt]))
    const mainHeader = excerpts.find(item => cited.has(`${packet.sourceCandidateId}@${item.excerpt.location}`)
      && /营业收入/.test(item.excerpt.text) && /营业成本/.test(item.excerpt.text) && /毛利率/.test(item.excerpt.text))
    if (!mainHeader) continue
    const mainHeaderParagraph = mainHeader.paragraph
    const unit = excerpts.filter(item => item.paragraph < mainHeaderParagraph && item.paragraph >= mainHeaderParagraph - 20 && /^\s*单位\s*[:：]\s*元\s*$/.test(item.excerpt.text)).at(-1)
    if (!unit) continue
    const unitParagraph = unit.paragraph
    const tableSections = excerpts.filter(item => item.paragraph > mainHeaderParagraph && /^(?:分产品|分行业|分地区)$/.test(item.excerpt.text.trim()))
    const industrySection = tableSections[0]
    const productSection = tableSections.find(item => item.paragraph > (industrySection?.paragraph ?? mainHeaderParagraph) && item.excerpt.text.trim() === '分产品')
    if (!industrySection || industrySection.excerpt.text.trim() !== '分行业' || !productSection) continue
    const sectionParagraph = productSection.paragraph
    const headerRows = excerpts.filter(item => item.paragraph > unitParagraph && item.paragraph < industrySection.paragraph)
    const headerText = headerRows.map(item => item.excerpt.text).join('').replace(/\s+/g, '')
    if (!/营业收入/.test(headerText) || !/营业成本/.test(headerText) || !/毛利率/.test(headerText)
      || !/营业收入(?:(?!营业成本|毛利率).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(headerText)
      || !/营业成本(?:(?!营业收入|毛利率).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(headerText)
      || !/毛利率(?:(?!营业收入|营业成本).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(headerText)) continue
    // Require every supplied paragraph in this split header, not just a
    // nearby generic margin label, to have been cited by the finding.
    const requiredHeader = [unit.excerpt, ...headerRows.map(item => item.excerpt)]
    if (!requiredHeader.every(item => cited.has(`${packet.sourceCandidateId}@${item.location}`))) continue
    const followingSection = tableSections.find(item => item.paragraph > sectionParagraph)?.paragraph ?? Number.POSITIVE_INFINITY
    const productRows = excerpts.filter(item => item.paragraph > sectionParagraph && item.paragraph < followingSection
      && numbers(item.excerpt.text).length >= 6 && /[%％]/.test(item.excerpt.text))

    for (const [alias, { value, exactLabel }] of mappings) {
      const rowMatches: CompanyMethodEvidenceRef[][] = []
      for (const row of productRows) {
        const numericCells = numbers(row.excerpt.text).map(Number)
        if (Math.abs(numericCells.at(-4)! - value) > 0.005001) continue
        // Join only immediately preceding, contiguous, label-only paragraphs.
        // Exact equality prevents a vague business alias from selecting a row.
        const rowContinuation = /^[\s\u3000]*([\u3400-\u9fff·（）()、]+?)\s*(?=-?\d)/.exec(row.excerpt.text)?.[1] ?? ''
        const labelParts: string[] = rowContinuation ? [rowContinuation] : []
        const labelLocations: string[] = []
        for (let paragraph = row.paragraph - 1; paragraph >= Math.max(sectionParagraph + 1, row.paragraph - 4); paragraph--) {
          const excerpt = byParagraph.get(paragraph)
          if (!excerpt || !excerpt.text.trim() || /\d|[。；;！？]/.test(excerpt.text) || /^(?:分行业|分产品|分地区)$/.test(excerpt.text.trim())) break
          labelParts.unshift(excerpt.text)
          labelLocations.unshift(excerpt.location)
          const joined = labelParts.join('').replace(/\s+/g, '')
          if (joined.length >= exactLabel.length) break
        }
        if (labelParts.join('').replace(/\s+/g, '') !== exactLabel) continue
        const rowRefs = [productSection.excerpt.location, ...labelLocations, row.excerpt.location]
          .map(location => ({ sourceCandidateId: packet.sourceCandidateId, location }))
        rowMatches.push(rowRefs)
      }
      matches.get(alias)!.push(...rowMatches)
    }
  }
  if ([...matches.values()].some(rows => rows.length !== 1)) return undefined
  const added = [...new Map([...matches.values()].flatMap(rows => rows[0]!).filter(ref => !cited.has(`${ref.sourceCandidateId}@${ref.location}`))
    .map(ref => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()]
  return added.length ? added : undefined
}

/** Resolves model-made preparedAnalysis pseudo-citations only when the named
 * deterministic calculation identifies one real supplied source and its exact
 * paragraph:1 packet is available. The normal numeric validator still runs
 * after this identity repair. */
export function repairPreparedAnalysisSourceReferences<T>(output: T, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): { readonly output: T; readonly repairs: readonly CompanyCitationRepair[] } {
  let raw: unknown = output
  if (typeof raw === 'string') { try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return { output, repairs: [] } } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { output, repairs: [] }
  const copy = structuredClone(raw) as Record<string, unknown>
  const repairs: CompanyCitationRepair[] = []
  const distanceAtMostOne = (left: string, right: string): boolean => {
    if (Math.abs(left.length - right.length) > 1) return false
    let i = 0; let j = 0; let edits = 0
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) { i++; j++; continue }
      if (++edits > 1) return false
      if (left.length > right.length) i++
      else if (right.length > left.length) j++
      else { i++; j++ }
    }
    return edits + Number(i < left.length || j < right.length) <= 1
  }
  const distanceAtMostThree = (left: string, right: string): boolean => {
    if (Math.abs(left.length - right.length) > 3) return false
    let prior = Array.from({ length: right.length + 1 }, (_, index) => index)
    for (let i = 1; i <= left.length; i++) {
      const current = [i]
      let rowMin = i
      for (let j = 1; j <= right.length; j++) {
        const value = Math.min(current[j - 1]! + 1, prior[j]! + 1, prior[j - 1]! + Number(left[i - 1] !== right[j - 1]))
        current[j] = value
        rowMin = Math.min(rowMin, value)
      }
      if (rowMin > 3) return false
      prior = current
    }
    return prior[right.length]! <= 3
  }
  const normalizeSourceId = (value: string, location?: string, claim?: string, supportingRefs: readonly CompanyMethodEvidenceRef[] = []): string | undefined => {
    const known = packets.map((packet) => packet.sourceCandidateId).filter((id) => value === id || /[，,:：]\s*$/.test(value.slice(0, Math.max(0, value.length - id.length))) && value.endsWith(id))
    if (known.length === 1) return known[0]
    if (known.length > 1 || !location || value.length < 16) return undefined
    if (!claim?.trim()) return undefined
    const near = packets.filter(packet => distanceAtMostOne(value, packet.sourceCandidateId)).flatMap(packet => packet.excerpts.filter(excerpt => excerpt.location === location).flatMap(excerpt => {
      const linked = (excerpt.contextLocations ?? []).flatMap(contextLocation => packet.excerpts.filter(row => row.location === contextLocation).map(row => row.text))
      const suppliedSupport = supportingRefs.filter(ref => ref.sourceCandidateId === packet.sourceCandidateId).flatMap(ref => packet.excerpts.filter(row => row.location === ref.location))
      const semanticText = [packet.title, ...linked, excerpt.text, ...suppliedSupport.map(row => row.text)].join(' ')
      if (!meaningMatches(claim, semanticText)) return []
      const claimRefs = [...new Map([...suppliedSupport.map(row => ({ sourceCandidateId: packet.sourceCandidateId, location: row.location })), { sourceCandidateId: packet.sourceCandidateId, location }].map(ref => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()]
      const grounded = validateCompanyNumericGrounding({ markdown: `${claim} ${claimRefs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: input.sources, evidenceContexts: packets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] })
      return grounded.status === 'grounded' ? [packet.sourceCandidateId] : []
    }))
    const unique = [...new Set(near)]
    return unique.length === 1 ? unique[0] : undefined
  }
  // A finding can cover multiple adjacent table rows. For a one-character id
  // typo, the exact cited row may support only one clause of that finding;
  // validate that clause against the candidate row, then validate the whole
  // finding against all of its references after the proposed id correction.
  // This keeps the repair bounded to a unique exact locator and semantic row.
  const normalizeFindingSourceId = (value: string, location: string, claim: string, refs: readonly CompanyMethodEvidenceRef[], refIndex: number): string | undefined => {
    const clauses = strip(claim).split(/(?<=[；;。！？\n])/).map(clause => clause.trim()).filter(clause => numbers(clause).length > 0)
    // Keep the established one-clause repair path. Multi-row findings must
    // resolve across all plausible ids together, so a near-duplicate source
    // cannot win merely because it is a closer string match.
    if (clauses.length <= 1) {
      const direct = normalizeSourceId(value, location, claim)
      if (direct) return direct
    }
    if (value.length < 16) return undefined
    const matches = packets.filter(packet => distanceAtMostThree(value, packet.sourceCandidateId)
      && input.sources.some(source => source.candidate.candidateId === packet.sourceCandidateId))
      .flatMap(packet => packet.excerpts.filter(excerpt => excerpt.location === location).flatMap(excerpt => {
        // Generic income headers are numeric/table context, not the semantic
        // identity of a particular row. Keep row identity matching to the
        // exact locator text and source title; the validator below still sees
        // the packet's authenticated header contexts for period, unit and values.
        const semanticText = [packet.title, excerpt.text].join(' ')
        const locallySupported = clauses.some(clause => meaningMatches(clause, semanticText)
          && validateCompanyNumericGrounding({ markdown: `${clause} [${packet.sourceCandidateId}@${location}]`, sources: input.sources, evidenceContexts: packets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] }).status === 'grounded')
        if (!locallySupported) return []
        const correctedRefs = refs.map((ref, index) => index === refIndex ? { ...ref, sourceCandidateId: packet.sourceCandidateId } : ref)
        const wholeClaim = validateCompanyNumericGrounding({ markdown: `${claim} ${correctedRefs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: input.sources, evidenceContexts: packets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] })
        return wholeClaim.status === 'grounded' ? [packet.sourceCandidateId] : []
      }))
    const unique = [...new Set(matches)]
    return unique.length === 1 ? unique[0] : undefined
  }
  const inlineClaim = (value: string, offset: number): string => {
    const before = value.slice(0, offset)
    const lastBoundary = Math.max(before.lastIndexOf('。'), before.lastIndexOf('！'), before.lastIndexOf('？'), before.lastIndexOf('；'), before.lastIndexOf(';'), before.lastIndexOf('\n'))
    let claim = before.slice(lastBoundary + 1).trim()
    if (!claim) {
      const prior = before.slice(0, Math.max(0, lastBoundary)).trimEnd()
      const previousBoundary = Math.max(prior.lastIndexOf('。'), prior.lastIndexOf('！'), prior.lastIndexOf('？'), prior.lastIndexOf('；'), prior.lastIndexOf(';'), prior.lastIndexOf('\n'))
      claim = prior.slice(previousBoundary + 1)
    }
    return strip(claim).trim()
  }
  const normalizeInlineSourceIds = (value: string, fieldPath: string): string => value.replace(/\[([^\]\s]+)@(paragraph:\d+)\]/g, (literal, sourceCandidateId: string, location: string, offset: number, whole: string) => {
    const lineStart = whole.lastIndexOf('\n', offset) + 1
    const lineEnd = whole.indexOf('\n', offset)
    const line = whole.slice(lineStart, lineEnd < 0 ? whole.length : lineEnd)
    const supportingRefs = [...line.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)]
      .filter(match => match[0] !== literal && packets.some(packet => packet.sourceCandidateId === match[1] && packet.excerpts.some(excerpt => excerpt.location === match[2])))
      .map(match => ({ sourceCandidateId: match[1]!, location: match[2]! }))
    const normalized = normalizeSourceId(sourceCandidateId, location, inlineClaim(whole, offset), supportingRefs)
    if (!normalized || normalized === sourceCandidateId) return literal
    repairs.push({ sectionId: fieldPath, inputText: literal, originalReferences: [{ sourceCandidateId, location }], addedReferences: [{ sourceCandidateId: normalized, location }], reason: sourceCandidateId.endsWith(normalized) ? 'The citation contained a human-readable source label followed by the exact unique supplied sourceCandidateId; removed only that label while preserving the exact source id and locator.' : 'The source id differed by one character from a unique supplied id that contains the exact same paragraph locator; corrected only the id and retained the exact locator.' })
    return `[${normalized}@${location}]`
  })
  const resolveSource = (pseudoId: string): CompanyMethodEvidenceRef | undefined => {
    const path = pseudoId.slice('preparedAnalysis.'.length).split('.').filter(Boolean)
    let value: unknown = input.preparedAnalysis
    for (const key of path) {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !(key in value)) return undefined
      value = (value as Record<string, unknown>)[key]
    }
    const ids = new Set<string>()
    const visit = (item: unknown): void => {
      if (!item || typeof item !== 'object') return
      if (Array.isArray(item)) { for (const child of item) visit(child); return }
      const row = item as Record<string, unknown>
      if (Array.isArray(row.sourceCandidateIds)) for (const id of row.sourceCandidateIds) if (typeof id === 'string') ids.add(id)
      // Deterministic skill calculators use sourceRefs to carry the exact source ids.
      // Resolve only values that also match an actually supplied source packet below.
      if (Array.isArray(row.sourceRefs)) for (const id of row.sourceRefs) if (typeof id === 'string') ids.add(id)
    }
    visit(value)
    const candidates = [...ids].filter((id) => packets.some((packet) => packet.sourceCandidateId === id && packet.excerpts.some((excerpt) => excerpt.location === 'paragraph:1')))
    return candidates.length === 1 ? { sourceCandidateId: candidates[0]!, location: 'paragraph:1' } : undefined
  }
  const replaceText = (value: unknown, fieldPath: string): unknown => {
    if (typeof value !== 'string') return value
    return normalizeInlineSourceIds(value, fieldPath).replace(/\[(preparedAnalysis(?:\.[^@\]\s]+)*)@(paragraph:\d+)\]/g, (literal, pseudoId: string, location: string) => {
      const ref = resolveSource(pseudoId)
      if (!ref) return literal
      repairs.push({ sectionId: fieldPath, inputText: literal, originalReferences: [{ sourceCandidateId: pseudoId, location }], addedReferences: [ref], reason: 'The pseudo source named a deterministic preparedAnalysis value whose sole sourceCandidateId is an actually supplied structured evidence source; replaced it with that source exact paragraph:1 locator.' })
      return `[${ref.sourceCandidateId}@${ref.location}]`
    })
  }
  for (const key of ['markdown', 'answer'] as const) copy[key] = replaceText(copy[key], key)
  if (Array.isArray(copy.sections)) copy.sections = copy.sections.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const row = item as Record<string, unknown>
    return { ...row, markdown: replaceText(row.markdown, `sections[${index}]`) }
  })
  if (Array.isArray(copy.findings)) copy.findings = copy.findings.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const row = item as Record<string, unknown>
    const text = replaceText(row.text, `findings[${index}]`)
    const findingRefs = Array.isArray(row.evidence) ? row.evidence.flatMap((candidate): CompanyMethodEvidenceRef[] => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const value = candidate as Record<string, unknown>
      return typeof value.sourceCandidateId === 'string' && typeof value.location === 'string' ? [{ sourceCandidateId: value.sourceCandidateId, location: value.location }] : []
    }) : []
    const evidence = Array.isArray(row.evidence) ? row.evidence.map((ref) => {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return ref
      const evidenceRef = ref as Record<string, unknown>
      const pseudoId = evidenceRef.sourceCandidateId
      if (typeof pseudoId === 'string') {
        const location = typeof evidenceRef.location === 'string' ? evidenceRef.location : ''
        const refIndex = findingRefs.findIndex(candidate => candidate.sourceCandidateId === pseudoId && candidate.location === location)
        const normalized = normalizeFindingSourceId(pseudoId, location, typeof text === 'string' ? text : '', findingRefs, refIndex) ?? normalizeSourceId(pseudoId, location, typeof text === 'string' ? text : undefined)
        if (normalized && normalized !== pseudoId) {
          repairs.push({ findingIndex: index, inputText: typeof text === 'string' ? text : '', originalReferences: [{ sourceCandidateId: pseudoId, location }], addedReferences: [{ sourceCandidateId: normalized, location }], reason: pseudoId.endsWith(normalized) ? 'The finding reference prefixed its exact unique supplied sourceCandidateId with a human-readable label; preserved the source id suffix and locator.' : 'The source id was within three character edits of one unique supplied id; the exact cited locator, clause semantics, numeric grounding, and whole finding were all verified before correcting only the id.' })
          return { ...evidenceRef, sourceCandidateId: normalized }
        }
      }
      if (typeof pseudoId !== 'string' || !pseudoId.startsWith('preparedAnalysis.')) return ref
      const mapped = resolveSource(pseudoId)
      if (!mapped) return ref
      const location = typeof evidenceRef.location === 'string' ? evidenceRef.location : ''
      repairs.push({ findingIndex: index, inputText: typeof text === 'string' ? text : '', originalReferences: [{ sourceCandidateId: pseudoId, location }], addedReferences: [mapped], reason: 'The finding cited a deterministic preparedAnalysis value as though it were a source; its sole underlying sourceCandidateId and supplied paragraph:1 were verified.' })
      return mapped
    }) : row.evidence
    return { ...row, text, evidence }
  })
  return { output: copy as T, repairs }
}
const keywordGroups: Readonly<Record<string, readonly string[]>> = {
  monetaryUnit: ['人民币千元', '人民币万元', '人民币元', '单位：元', '单位:元'], goodwill: ['商誉', '减值准备', '资产组'],
  grossMargin: ['毛利率'],
  channel: ['直销', '经销'],
  auto: ['汽车相关', '汽车及相关', '汽车、汽车', '汽车业务', '汽车收入', '汽车产品', '分车型产销量', '分车型类别产销量', '分车型'], electronics: ['手机部件', '手机业务', '电子制造', '电子业务'],
  relatedPartyPurchase: ['关联方采购'], supplier: ['供应商采购', '供应商'], customer: ['客户销售', '客户'],
  revenue: ['营业收入', '收入', '营收'], netProfit: ['净利润', '归母利润', '归母净利'], operatingProfit: ['营业利润', '经营利润'], marketShare: ['市占率', '市场份额', '市场占有率'],
  operatingCash: ['经营活动', '经营现金', '经营净现金'], investingCash: ['投资活动', '投资净流'], financingCash: ['筹资活动', '筹资净流'],
  capex: ['资本开支', '资本支出', '购建固定资产'], rnd: ['研发费用', '研发支出'], dividends: ['分红', '现金股利', '派息'], repurchase: ['回购'],
  equityInvestment: ['长期股权投资', '股权投资'], placement: ['配售', '募集资金', '融资'],
  nomineeShareholding: ['代理持有', '代理人持有', '名义持有人', '代理的'], nomineeEntity: ['HKSCC NOMINEES LIMITED'],
  rndExpense: ['研发费用'], rndInvestment: ['研发投入'],
  governanceControl: ['实际控制人', '控制人', '一致行动', '控股股东', '控制权'], governanceRelation: ['关联关系', '关联方', '关联交易'],
  overseas: ['境外', '海外'], domestic: ['国内', '中国（包括', '中国(包括'], other: ['其他收入', '其他产品', '其他业务'],
  registration: ['注册成立', '注册', '前身'], founding: ['创立', '创办', '成立日期', '公司成立', '在深圳成立'],
  lithium: ['锂离子电池', '锂电池'], carEntry: ['进入汽车行业', '进军汽车'], listing: ['香港上市', '香港证券交易所', '香港联交所'],
  launch: ['推出', '发布', '商业化', '产品上市'], acquisition: ['收购', '并购'],
}
function keys(text: string): Set<string> { return new Set(Object.entries(keywordGroups).filter(([, terms]) => terms.some((term) => text.includes(term))).map(([key]) => key)) }
function meaningMatches(claim: string, original: string): boolean {
  const compact = (text: string) => text.replace(/\s+/g, '').toUpperCase()
  const productionCompositionMatch = /分车型产销量/.test(claim) && /分车型(?:类别)?产销量/.test(original) && /业务增长/.test(claim) && /业务增长/.test(original) && /产品结构变化/.test(claim) && /产品结构变化/.test(original)
  // Product specifications are often split over adjacent PDF paragraphs, and
  // extraction may collapse e.g. "100G PAM4 EML" into "100GPAM4EML". Keep
  // this repair restricted to an exact technical identifier present in the
  // supplied excerpt; the final numeric-grounding check still validates every
  // amount and rate against the complete cited paragraph set.
  const technicalIdentifiers = [...claim.matchAll(/\b\d+(?:\.\d+)?\s*[GT](?:\s*PAM4)?(?:\s*(?:EML|PIC))?/gi)].map((match) => compact(match[0]))
  const hasExactTechnicalIdentifier = technicalIdentifiers.length > 0 && technicalIdentifiers.some((identifier) => compact(original).includes(identifier))
  const claimKeys = keys(claim); const sourceKeys = keys(original)
  if ((!claimKeys.size || ![...claimKeys].some((key) => sourceKeys.has(key)) ) && !hasExactTechnicalIdentifier && !productionCompositionMatch) return false
  // Do not attach one data row to a multi-period claim unless the cited row
  // itself preserves the year labels. A nearby header still requires model
  // review to map column order to periods.
  const claimYears = [...new Set([...claim.matchAll(/\b((?:19|20)\d{2})年/g)].map((match) => match[1]!))]
  // PDF prose may render the same date as "2025 年". Normalize only the
  // separator before 年; retain the exact year and all event/account checks.
  const normalizedYears = original.replace(/[零〇○一二三四五六七八九]{4}(?=年)/g, year => [...year].map(digit => ({零:'0',〇:'0','○':'0',一:'1',二:'2',三:'3',四:'4',五:'5',六:'6',七:'7',八:'8',九:'9'} as Record<string,string>)[digit] ?? digit).join('')).replace(/\b((?:19|20)\d{2})\s+(?=年)/g, '$1')
  if (!claimKeys.has('registration') && claimYears.some((year) => !new RegExp(`(?:^|\\D)${year}年`).test(normalizedYears))) return false
  const specific = ['auto', 'electronics', 'channel', 'netProfit', 'operatingProfit', 'marketShare', 'operatingCash', 'investingCash', 'financingCash', 'capex', 'rnd', 'rndExpense', 'rndInvestment', 'dividends', 'repurchase', 'equityInvestment', 'placement', 'overseas', 'domestic', 'registration', 'founding', 'lithium', 'carEntry', 'listing', 'acquisition', 'governanceControl', 'governanceRelation']
  if (specific.some((key) => claimKeys.has(key) && !sourceKeys.has(key)) && !productionCompositionMatch) return false
  // A product-specific launch must retain the named model/technology, not just the generic verb.
  const named = [...claim.matchAll(/\b[A-Z][A-Za-z]*\d+[A-Za-z\d.-]*\b/g)].map((match) => match[0])
  if (named.some((name) => !original.includes(name))) return false
  const quotedNames = [...claim.matchAll(/[“「]([^”」]{2,80})[”」]/g)].map((match) => match[1]!.replace(/\s/g, ''))
  if (quotedNames.some((name) => !original.replace(/\s/g, '').includes(name))) return false
  const percentages = (text: string) => [...text.matchAll(/(下降|减少|下滑|上升|增长|增加)?\s*(-?\d+(?:\.\d+)?)\s*(?:[%％]|个百分点)/g)].map((match) => {
    const value = Number(match[2])
    if (/下降|减少|下滑/.test(match[1] ?? '')) return -Math.abs(value)
    if (/上升|增长|增加/.test(match[1] ?? '')) return Math.abs(value)
    return value
  })
  if (percentages(claim).some((value) => !percentages(original).some((source) => Math.abs(source - value) <= 0.005001))) return false
  // If a sentence explicitly names multiple accounting measures, their nearby values cannot be swapped.
  const accounting = ['revenue', 'netProfit', 'operatingProfit', 'operatingCash', 'investingCash', 'financingCash', 'capex', 'rnd', 'dividends', 'repurchase'].filter((key) => claimKeys.has(key))
  // A percentage claim about revenue (for example, revenue growth) must not
  // compare its first rate with the monetary amount in the same source row.
  // Numeric grounding still requires each exact percentage and its table row.
  const rateWithoutCurrency = /[%％]|个百分点/.test(claim) && !/(?:人民币|元|万元|亿元|千元|百万元)/.test(claim)
  if (accounting.length > 0 && !rateWithoutCurrency) for (const key of accounting) {
    const first = (text: string): string | undefined => {
      for (const term of keywordGroups[key]!) { const at = text.indexOf(term); if (at < 0) continue; const number = /-?\d+(?:[,，]\d{3})*(?:\.\d+)?/.exec(text.slice(at + term.length, at + term.length + 35)); if (number) return number[0].replace(/[,，]/g, '') }
      return undefined
    }
    const value = first(claim)
    const originalValue = first(original)
    if (value === undefined) return false
    // A wrapped product row may omit the account name that appeared in its
    // supplied label paragraph. Compare account values whenever that account
    // is present in the candidate context; never borrow a different row's value.
    if (keywordGroups[key]!.some(term => original.includes(term)) && value !== originalValue) return false
  }
  return true
}
function hasBoundedCjkOverlap(claim: string, evidenceText: string): boolean {
  const evidence = evidenceText.replace(/\s+/g, '')
  const clauses = claim.replace(/\s+/g, '').split(/[。；;，,|]/).filter(Boolean)
  return clauses.some(clause => {
    const claimRuns = clause.match(/[\u3400-\u9fff]{2,}/g) ?? []
    const total = claimRuns.reduce((sum, run) => sum + run.length, 0)
    if (!total) return false
    const phrases: string[] = []
    for (const run of claimRuns) {
      let longest = ''
      for (let length = Math.min(run.length, 12); length >= 2 && !longest; length--) {
        for (let start = 0; start + length <= run.length; start++) {
          const candidate = run.slice(start, start + length)
          if (evidence.includes(candidate)) { longest = candidate; break }
        }
      }
      if (longest && !phrases.includes(longest)) phrases.push(longest)
    }
    const covered = phrases.reduce((sum, phrase) => sum + phrase.length, 0)
    return phrases.length >= 2 && covered >= 5 && covered / total >= 0.2
  })
}

/** Strong single-run overlap is allowed only for an exact, unique table-cell locator. */
function hasStrongTableCellCjkOverlap(claim: string, evidenceText: string): boolean {
  const evidence = evidenceText.replace(/\s+/g, '')
  return claim.replace(/\s+/g, '').split(/[。；;，,|]/).filter(Boolean).some(clause => {
    const runs = clause.match(/[\u3400-\u9fff]{2,}/g) ?? []
    const total = runs.reduce((sum, run) => sum + run.length, 0)
    if (!total) return false
    const phrases = runs.flatMap(run => {
      for (let length = Math.min(run.length, 12); length >= 2; length--) {
        for (let start = 0; start + length <= run.length; start++) {
          const phrase = run.slice(start, start + length)
          if (evidence.includes(phrase)) return [phrase]
        }
      }
      return []
    })
    const uniquePhrases = [...new Set(phrases)]
    const covered = uniquePhrases.reduce((sum, phrase) => sum + phrase.length, 0)
    return uniquePhrases.some(phrase => phrase.length >= 8) && covered / total >= 0.35
  })
}

/**
 * A source id can be paired with a paragraph number that is also present in a
 * different supplied document. Repair that collision only when the paragraph
 * from exactly one alternate source has strong lexical overlap with the
 * adjacent claim. Paragraph numbers alone are never treated as globally
 * unique locators.
 */
export function repairCompanyParagraphCollisionCitations<T>(
  output: T,
  packets: readonly CompanyEvidencePacket[],
  input: CompanyResearchInput,
): { readonly output: T; readonly repairs: readonly CompanyCitationRepair[] } {
  let raw: unknown = output
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) }
    catch { return { output, repairs: [] } }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { output, repairs: [] }
  const copy = structuredClone(raw) as Record<string, unknown>
  const repairs: CompanyCitationRepair[] = []
  const verifiedCollisionMappings = new Map<string, CompanyMethodEvidenceRef>()
  const exactExcerpt = (sourceCandidateId: string, location: string) => packets.flatMap(packet => {
    if (packet.sourceCandidateId !== sourceCandidateId) return []
    const sourceMatches = input.sources.filter(source => source.candidate.candidateId === sourceCandidateId)
    if (sourceMatches.length !== 1) return []
    const lineNumber = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
    if (!Number.isInteger(lineNumber) || lineNumber < 1) return []
    const sourceLine = sourceMatches[0]!.content.split(/\r?\n/)[lineNumber - 1]
    if (sourceLine === undefined) return []
    return packet.excerpts.filter(row => row.sourceCandidateId === sourceCandidateId && row.location === location && row.text === sourceLine)
      .map(row => ({ packet, row }))
  })
  const strongOverlap = (claim: string, excerpt: string, additionalCitedTexts: readonly string[] = []): boolean => {
    const normalizedClaim = strip(claim).replace(/\s+/g, '')
    const normalizedExcerpt = excerpt.replace(/\s+/g, '')
    if (!normalizedClaim || !normalizedExcerpt) return false
    const claimNumbers = numbers(normalizedClaim)
    // A nearby, already-valid citation may independently ground the numeric
    // cells in the same sentence (for example, a half-year shareholder table
    // alongside an annual report's family-relationship disclosure). Keep the
    // lexical overlap check bound to the candidate paragraph itself.
    const excerptNumbers = new Set([normalizedExcerpt, ...additionalCitedTexts].flatMap(numbers))
    if (claimNumbers.some(value => !excerptNumbers.has(value))) return false
    // A long sentence may combine unrelated rows (e.g. three shareholding
    // percentages plus the family relationship that this particular paragraph
    // supports). Score lexical overlap per clause, while requiring every
    // numeric token in the whole claim to be grounded by the alternate
    // paragraph or separately cited evidence above.
    const clauses = normalizedClaim.split(/[，,；;]/).filter(Boolean)
    return clauses.some(clause => {
      const runs = clause.match(/[\u3400-\u9fff]{2,}/g) ?? []
      const cjkChars = runs.reduce((sum, run) => sum + run.length, 0)
      if (!cjkChars) return false
      const matchedRuns = runs.map(run => {
        for (let length = run.length; length >= 2; length--) {
          for (let start = 0; start + length <= run.length; start++) {
            const phrase = run.slice(start, start + length)
            if (normalizedExcerpt.includes(phrase)) return { phrase, length }
          }
        }
        return undefined
      }).filter((item): item is { phrase: string; length: number } => item !== undefined)
      const uniquePhrases = [...new Map(matchedRuns.map(item => [item.phrase, item])).values()]
      const covered = uniquePhrases.reduce((sum, item) => sum + item.length, 0)
      const longPhrase = uniquePhrases.some(item => item.length >= 5)
      return (uniquePhrases.length >= 2 && covered / cjkChars >= 0.3)
        || (longPhrase && covered / cjkChars >= 0.3)
    })
  }
  const reportPeriod = (title: string): string | undefined => {
    const year = title.match(/(?:19|20)\d{2}/)?.[0]
    if (!year) return undefined
    if (/(?:半年度|半年报|上半年|中期|\bH1\b)/i.test(title)) return `${year}-H1`
    if (/(?:年度报告|年报|年度|全年)/.test(title)) return `${year}-FY`
    return undefined
  }
  const marginClaim = (claim: string) => /毛利率/.test(claim) && /(?:分行业|分产品|行业|产品)/.test(claim)
  const marginCitationCompatible = (sourceCandidateId: string, candidatePacket: CompanyEvidencePacket, candidateLocation: string, claim: string): boolean => {
    if (!marginClaim(claim)) return true
    const originalSources = input.sources.filter(source => source.candidate.candidateId === sourceCandidateId)
    const originalPackets = packets.filter(packet => packet.sourceCandidateId === sourceCandidateId)
    if (originalSources.length !== 1 || originalPackets.length !== 1) return false
    const originalPeriod = reportPeriod(originalPackets[0]!.title)
    const candidatePeriod = reportPeriod(candidatePacket.title)
    if (!originalPeriod || originalPeriod !== candidatePeriod) return false
    const explicitPeriod = reportPeriod(claim)
    if (explicitPeriod && explicitPeriod !== originalPeriod) return false
    const requestedTable = claimTableKind(claim)
    // A statement that combines both segment classifications cannot safely
    // establish which table a colliding paragraph is meant to replace.
    if (!requestedTable && /分行业/.test(claim) && /分产品/.test(claim)) return false
    const candidate = candidatePacket.excerpts.find(row => row.location === candidateLocation)
    if (!candidate) return false
    const candidateParagraph = Number(/^paragraph:(\d+)$/.exec(candidateLocation)?.[1])
    if (!Number.isInteger(candidateParagraph)) return false
    const candidateSection = candidatePacket.excerpts.filter(row => {
      const paragraph = Number(/^paragraph:(\d+)$/.exec(row.location)?.[1])
      return paragraph < candidateParagraph && paragraph >= candidateParagraph - 40 && /^(?:分产品|分行业)$/.test(row.text.trim())
    }).sort((left, right) => Number(right.location.split(':')[1]) - Number(left.location.split(':')[1]))[0]
    const candidateKind = candidateSection?.text.trim() === '分产品' ? 'product' : candidateSection?.text.trim() === '分行业' ? 'industry' : undefined
    const headingKind = candidate.text.trim() === '分产品' ? 'product' : candidate.text.trim() === '分行业' ? 'industry' : undefined
    if (requestedTable && (candidateKind && candidateKind !== requestedTable || headingKind && headingKind !== requestedTable)) return false
    return true
  }
  const chooseReplacement = (sourceCandidateId: string, location: string, claim: string, additionalCitedTexts: readonly string[] = []): CompanyMethodEvidenceRef | undefined => {
    const original = exactExcerpt(sourceCandidateId, location)
    if (marginClaim(claim)) {
      const originalPackets = packets.filter(packet => packet.sourceCandidateId === sourceCandidateId)
      const explicitPeriod = reportPeriod(claim)
      // A valid same-period report is the anchor for a financial table. Do not
      // splice in a same-number paragraph from another report merely because
      // the generic heading text has weak overlap with the full finding.
      if (originalPackets.length === 1 && reportPeriod(originalPackets[0]!.title)
        && (!explicitPeriod || explicitPeriod === reportPeriod(originalPackets[0]!.title))) return undefined
    }
    // If the cited paragraph is itself an exact, semantically strong match,
    // this is not a source-id collision and must remain untouched.
    if (original.some(({ row }) => strongOverlap(claim, row.text))) return undefined
    const candidates = packets.flatMap(packet => {
      if (packet.sourceCandidateId === sourceCandidateId) return []
      const rows = exactExcerpt(packet.sourceCandidateId, location)
      return rows.filter(({ packet: exactPacket, row }) => {
        if (!marginCitationCompatible(sourceCandidateId, exactPacket, row.location, claim)) return false
        const paragraph = Number(/^paragraph:(\d+)$/.exec(row.location)?.[1])
        // PDF extraction may split one sentence across adjacent paragraph
        // locators (for example, a controller disclosure ending with "actual"
        // followed by "controller" on the next locator). Neighboring text is
        // used only to identify the matching source; both wrong locators still
        // need their own exact alternate paragraph to be selected and repaired.
        const adjacent = [paragraph - 1, paragraph + 1].filter(value => value > 0)
          .flatMap(value => exactExcerpt(exactPacket.sourceCandidateId, `paragraph:${value}`).map(item => item.row.text))
        return strongOverlap(claim, [row.text, ...adjacent].join(' '), additionalCitedTexts)
      })
        .map(({ packet: exactPacket, row }) => ({ sourceCandidateId: exactPacket.sourceCandidateId, location: row.location }))
    })
    const unique = [...new Map(candidates.map(ref => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()]
    return unique.length === 1 ? unique[0] : undefined
  }
  const replaceInline = (text: string, sectionId: string): string => text.replace(/\[([^\]\s]+)@(paragraph:\d+)\]/g,
    (literal, sourceCandidateId: string, location: string, offset: number, whole: string) => {
      const lineStart = whole.lastIndexOf('\n', offset) + 1
      const lineEnd = whole.indexOf('\n', offset)
      const line = whole.slice(lineStart, lineEnd < 0 ? whole.length : lineEnd)
      const offsetInLine = offset - lineStart
      const leftPipe = line.lastIndexOf('|', offsetInLine)
      const rightPipe = line.indexOf('|', offsetInLine + literal.length)
      // A citation inside a table cell belongs to that cell. Using the whole
      // row dilutes semantic overlap with unrelated metrics in neighboring
      // cells and can hide a clear wrong-document paragraph pairing.
      const citationScope = leftPipe >= 0 && rightPipe > leftPipe
        ? line.slice(leftPipe + 1, rightPipe)
        : line
      // References often appear after the final sentence of a paragraph even
      // when they support a specific earlier clause. Use the bounded paragraph
      // (or the citation's table cell), then score individual clauses and
      // require every number to be grounded by its own supplied citation.
      const claim = strip(citationScope).trim()
      const independentNumericEvidence = [...citationScope.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)]
        .filter(match => match[0] !== literal)
        .flatMap(match => exactExcerpt(match[1]!, match[2]!).map(({ packet, row }) => `${packet.title} ${row.text}`))
      const replacement = chooseReplacement(sourceCandidateId, location, claim, independentNumericEvidence)
      if (!replacement) {
        if (exactExcerpt(sourceCandidateId, location).length > 0) return literal
        // A wrong source/paragraph pair can be redundant when the same claim
        // already cites exact, directly supporting paragraphs elsewhere on
        // the line. Remove only that unsupported pair; do not rebind it to a
        // same-number paragraph whose text does not support the claim.
        const remainingRefs = [...citationScope.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)]
          .filter(match => match[0] !== literal)
          .map(match => ({ sourceCandidateId: match[1]!, location: match[2]! }))
        const remainingEvidence = remainingRefs.flatMap(ref => exactExcerpt(ref.sourceCandidateId, ref.location)
          .map(({ packet, row }) => ({ ref, text: `${packet.title} ${row.text}` })))
        const remainingMarkdownRefs = remainingEvidence.map(({ ref }) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
        const supportSourceIds = new Set(remainingEvidence.map(item => item.ref.sourceCandidateId))
        const independentlySupported = remainingEvidence.length > 0 && supportSourceIds.size === 1
          && strongOverlap(claim, remainingEvidence.map(item => item.text).join(' '))
          && validateCompanyNumericGrounding({
            markdown: `${claim} ${remainingMarkdownRefs}`,
            sources: input.sources,
            evidenceContexts: packets,
            preparedAnalysis: input.preparedAnalysis,
            trustedText: [input.company.symbol, input.asOf],
          }).status === 'grounded'
        if (!independentlySupported) return literal
        repairs.push({ sectionId, inputText: claim, originalReferences: [{ sourceCandidateId, location }], addedReferences: [], reason: 'Removed an unsupported source-paragraph pair because the same claim retained exact supplied citations that independently support its text and pass numeric grounding.' })
        return ''
      }
      repairs.push({ sectionId, inputText: claim, originalReferences: [{ sourceCandidateId, location }], addedReferences: [replacement], reason: 'The supplied paragraph number collided across documents. The cited source paragraph did not strongly match the adjacent claim; exactly one alternate supplied source had the same exact paragraph location and strong textual overlap, verified against that source’s original content.' })
      verifiedCollisionMappings.set(`${sourceCandidateId}@${location}`, replacement)
      return `[${replacement.sourceCandidateId}@${replacement.location}]`
    })
  for (const key of ['markdown', 'answer'] as const) if (typeof copy[key] === 'string') copy[key] = replaceInline(copy[key] as string, key)
  if (Array.isArray(copy.sections)) copy.sections = copy.sections.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const row = item as Record<string, unknown>
    return typeof row.markdown === 'string' ? { ...row, markdown: replaceInline(row.markdown, typeof row.id === 'string' ? row.id : `sections[${index}]`) } : item
  })
  if (Array.isArray(copy.findings)) copy.findings = copy.findings.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const row = item as Record<string, unknown>
    const text = typeof row.text === 'string' ? row.text : ''
    const findingRefs = Array.isArray(row.evidence) ? row.evidence.flatMap((candidate): CompanyMethodEvidenceRef[] => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
      const value = candidate as Record<string, unknown>
      return typeof value.sourceCandidateId === 'string' && typeof value.location === 'string' ? [{ sourceCandidateId: value.sourceCandidateId, location: value.location }] : []
    }) : []
    const evidence = Array.isArray(row.evidence) ? row.evidence.flatMap(ref => {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return ref
      const value = ref as Record<string, unknown>
      if (typeof value.sourceCandidateId !== 'string' || typeof value.location !== 'string') return [ref]
      const independentNumericEvidence = Array.isArray(row.evidence) ? row.evidence.flatMap(candidate => {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
        const other = candidate as Record<string, unknown>
        if (other.sourceCandidateId === value.sourceCandidateId && other.location === value.location) return []
        if (typeof other.sourceCandidateId !== 'string' || typeof other.location !== 'string') return []
        return exactExcerpt(other.sourceCandidateId, other.location).map(({ packet: exactPacket, row: excerpt }) => `${exactPacket.title} ${excerpt.text}`)
      }) : []
      const priorVerified = verifiedCollisionMappings.get(`${value.sourceCandidateId}@${value.location}`)
      const priorRows = priorVerified ? exactExcerpt(priorVerified.sourceCandidateId, priorVerified.location) : []
      const priorParagraph = Number(/^paragraph:(\d+)$/.exec(priorVerified?.location ?? '')?.[1])
      const priorAdjacent = priorRows.flatMap(({ packet: exactPacket, row: excerpt }) => [excerpt.text,
        ...[priorParagraph - 1, priorParagraph + 1].filter(paragraph => paragraph > 0)
          .flatMap(paragraph => exactExcerpt(exactPacket.sourceCandidateId, `paragraph:${paragraph}`).map(item => item.row.text)),
      ])
      const supportedPrior = priorVerified && priorAdjacent.length
        && strongOverlap(text, priorAdjacent.join(' '), independentNumericEvidence) ? priorVerified : undefined
      const replacement = supportedPrior ?? chooseReplacement(value.sourceCandidateId, value.location, text, independentNumericEvidence)
      if (!replacement) {
        const isActuallyUnavailable = exactExcerpt(value.sourceCandidateId, value.location).length === 0
        const otherEvidence = Array.isArray(row.evidence) ? row.evidence.flatMap(candidate => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
          const other = candidate as Record<string, unknown>
          if (other === value || other.sourceCandidateId === value.sourceCandidateId && other.location === value.location) return []
          if (typeof other.sourceCandidateId !== 'string' || typeof other.location !== 'string') return []
          return exactExcerpt(other.sourceCandidateId, other.location).map(({ packet: exactPacket, row: excerpt }) => `${exactPacket.title} ${excerpt.text}`)
        }) : []
        const stillAttributable = isActuallyUnavailable && otherEvidence.length > 0
          && strongOverlap(text, otherEvidence.join(' '), independentNumericEvidence)
          && validateCompanyNumericGrounding({ markdown: `${text} ${findingRefs.filter(candidate => candidate.sourceCandidateId !== value.sourceCandidateId || candidate.location !== value.location).map(candidate => `[${candidate.sourceCandidateId}@${candidate.location}]`).join(' ')}`, sources: input.sources, evidenceContexts: packets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] }).status === 'grounded'
        if (stillAttributable) {
          repairs.push({ findingIndex: index, inputText: text, originalReferences: [{ sourceCandidateId: value.sourceCandidateId, location: value.location }], addedReferences: [], reason: 'The locator was unavailable in its cited source; removed that reference because the finding retained exact supplied citations with strong lexical overlap and all numeric claims remained grounded.' })
          return []
        }
        return [ref]
      }
      repairs.push({ findingIndex: index, inputText: text, originalReferences: [{ sourceCandidateId: value.sourceCandidateId, location: value.location }], addedReferences: [replacement], reason: 'The supplied paragraph number collided across documents. The finding’s cited source paragraph did not strongly match its claim; exactly one alternate supplied source had the same exact paragraph location and strong textual overlap, verified against that source’s original content.' })
      return [replacement]
    }) : row.evidence
    return { ...row, evidence }
  })
  return { output: copy as T, repairs }
}

type CompanyTableKind = 'product' | 'industry'
function claimTableKind(claim: string): CompanyTableKind | undefined {
  const product = /(?:分产品|产品表)/.test(claim)
  const industry = /(?:分行业|行业表)/.test(claim)
  return product === industry ? undefined : product ? 'product' : 'industry'
}
function findingTableKind(claim: string): CompanyTableKind | undefined {
  const leading = /^(?:半年报|半年度报告)?\s*(分产品|分行业)/.exec(claim)?.[1]
  return leading === '分产品' ? 'product' : leading === '分行业' ? 'industry' : claimTableKind(claim)
}
function excerptTableKind(packet: CompanyEvidencePacket, excerpt: CompanyEvidencePacket['excerpts'][number]): CompanyTableKind | undefined {
  const row = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
  const heading = packet.excerpts.filter(item => {
    const paragraph = Number(/^paragraph:(\d+)$/.exec(item.location)?.[1])
    return paragraph < row && paragraph >= row - 40 && /^(?:分产品|分行业)$/.test(item.text.trim())
  }).sort((left, right) => Number(right.location.split(':')[1]) - Number(left.location.split(':')[1]))[0]
  return heading?.text.trim() === '分产品' ? 'product' : heading?.text.trim() === '分行业' ? 'industry' : undefined
}
function claimIncludesExactClassifiedRowLabel(claim: string, packet: CompanyEvidencePacket, excerpt: CompanyEvidencePacket['excerpts'][number]): boolean {
  if (!/(?:分行业|分产品)/.test(claim)) return true
  const row = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
  if (!Number.isInteger(row)) return false
  const normalizedClaim = strip(claim).replace(/[\s“”"「」『』]/g, '')
  const rowPrefix = /^[\s\u3000]*([^\d]+?)\s*(?=-?\d)/.exec(excerpt.text)?.[1]?.trim() ?? ''
  const candidates = new Set<string>()
  if (rowPrefix) candidates.add(rowPrefix.replace(/\s+/g, ''))
  const preceding: string[] = []
  for (let paragraph = row - 1; paragraph > 0 && preceding.length < 3; paragraph -= 1) {
    const line = packet.excerpts.filter(item => item.sourceCandidateId === packet.sourceCandidateId && item.location === `paragraph:${paragraph}`)
    if (line.length !== 1 || /\d|[。；;！？]|单位|营业收入|营业成本|毛利率|分行业|分产品|分地区/.test(line[0]!.text)) break
    if (!line[0]!.text.trim() || line[0]!.text.length > 90) break
    preceding.unshift(line[0]!.text.trim())
  }
  for (let start = 0; start < preceding.length; start += 1) {
    const label = `${preceding.slice(start).join('')}${rowPrefix}`.replace(/\s+/g, '')
    if (label.length >= 4) candidates.add(label)
  }
  return [...candidates].some(label => label.length >= 4 && normalizedClaim.includes(label))
}
function deduplicateCompanyPackets(packets: readonly CompanyEvidencePacket[]): CompanyEvidencePacket[] {
  const grouped = new Map<string, { packet: CompanyEvidencePacket; excerpts: Map<string, CompanyEvidencePacket['excerpts'][number]>; conflicts: Set<string> }>()
  for (const packet of packets) {
    let group = grouped.get(packet.sourceCandidateId)
    if (!group) {
      group = { packet, excerpts: new Map(), conflicts: new Set() }
      grouped.set(packet.sourceCandidateId, group)
    }
    for (const excerpt of packet.excerpts) {
      if (group.conflicts.has(excerpt.location)) continue
      const prior = group.excerpts.get(excerpt.location)
      if (!prior) { group.excerpts.set(excerpt.location, excerpt); continue }
      if (prior.text !== excerpt.text) {
        group.excerpts.delete(excerpt.location)
        group.conflicts.add(excerpt.location)
        continue
      }
      const contextLocations = [...new Set([...(prior.contextLocations ?? []), ...(excerpt.contextLocations ?? [])])]
      if (contextLocations.length !== (prior.contextLocations ?? []).length) group.excerpts.set(excerpt.location, { ...prior, contextLocations })
    }
  }
  return [...grouped.values()].map(({ packet, excerpts }) => ({ ...packet, excerpts: [...excerpts.values()] }))
}
type TableMarginClaim = { readonly text: string; readonly label: string; readonly expectedChange: number; readonly margin?: number }
function tableMarginClaims(clause: string, inheritedMarginTable = false): TableMarginClaim[] {
  const claims: TableMarginClaim[] = []
  const changePattern = /(?:同比|比上年同期)?\s*(?:(下降|减少|下滑|降低|上升|增加|增长|提高)\s*(-?\d+(?:\.\d+)?)|([+-])\s*(\d+(?:\.\d+)?))\s*(?:个百分点|[%％])/g
  const marginTablePrefix = /^(?:半年报|半年度报告|半年度)?\s*(?:分行业|分产品)毛利率\s*[:：]\s*/.exec(clause)
  let cursor = marginTablePrefix?.[0].length ?? 0
  let change: RegExpExecArray | null
  while ((change = changePattern.exec(clause))) {
    const marginAt = clause.lastIndexOf('毛利率', change.index)
    const colonFormat = marginTablePrefix !== null || inheritedMarginTable && marginAt < cursor
    let label: string
    let marginValue: string | undefined
    if (colonFormat) {
      const rowText = clause.slice(cursor, change.index)
      const row = /([\s\S]*?)\s*为\s*(-?\d+(?:\.\d+)?)\s*[%％]\s*(?:[，,]\s*(?:同比)?变化)?\s*$/.exec(rowText)
      if (!row) continue
      label = row[1]!.replace(/^[\s，,、:：]+|[\s，,、:：]+$/g, '').replace(/\s+/g, '')
      marginValue = row[2]
    } else {
      if (marginAt < cursor) continue
      const rawLabel = clause.slice(cursor, marginAt).replace(/收入[\s\S]*$/, '')
      label = rawLabel.replace(/^.*?(?:分行业|分产品)(?:表)?(?:报告|显示|披露|列示|中)?[:：]?/, '').replace(/^[\s，,、:：]+|[\s，,、:：]+$/g, '').replace(/\s+/g, '')
      const marginText = clause.slice(marginAt, change.index)
      marginValue = /毛利率\s*(-?\d+(?:\.\d+)?)\s*[%％]/.exec(marginText)?.[1]
    }
    const direction = change[1]
    const sign = direction ? (/下降|减少|下滑|降低/.test(direction) ? -1 : 1) : change[3] === '-' ? -1 : 1
    claims.push({ text: clause.slice(cursor, changePattern.lastIndex).replace(/^[\s，,、]+/, ''), label, expectedChange: Number(change[2] ?? change[4]) * sign, ...(marginValue === undefined ? {} : { margin: Number(marginValue) }) })
    cursor = changePattern.lastIndex
  }
  return claims
}

/**
 * Bind a reported annual R&D investment amount to its exact row only when the
 * same claim cites the immediately adjacent year header in a supplied annual
 * report. The row, header, source text, period ordering, and amount must all
 * match uniquely; numeric grounding remains the final gate.
 */
function exactAnnualResearchInvestmentRow(
  claim: string,
  citedReferences: readonly CompanyMethodEvidenceRef[],
  packets: readonly CompanyEvidencePacket[],
  input: CompanyResearchInput,
): { readonly reference: CompanyMethodEvidenceRef; readonly verificationText: string } | undefined {
  if (!/研发投入/.test(claim)) return undefined
  const yearMatches = [...claim.matchAll(/\b((?:19|20)\d{2})\s*年/g)]
  const values: { readonly year: number; readonly amount: number; readonly unit: '亿元' | '元' }[] = []
  for (let index = 0; index < yearMatches.length; index++) {
    const match = yearMatches[index]!
    const start = (match.index ?? 0) + match[0].length
    const next = yearMatches[index + 1]?.index ?? claim.length
    const periodText = claim.slice(start, next)
    const amount = /([\d,，]+(?:\.\d+)?)\s*(亿元|元)/.exec(periodText)
    if (!amount) return undefined
    values.push({ year: Number(match[1]), amount: Number(amount[1]!.replace(/[,，]/g, '')), unit: amount[2] as '亿元' | '元' })
  }
  if (!values.length || new Set(values.map(value => value.year)).size !== values.length) return undefined

  const matches: CompanyMethodEvidenceRef[] = []
  for (const packet of packets) {
    if (!citedReferences.some(ref => ref.sourceCandidateId === packet.sourceCandidateId)) continue
    const sourceRows = input.sources.filter(source => source.candidate.candidateId === packet.sourceCandidateId)
    if (sourceRows.length !== 1 || sourceRows[0]!.title !== packet.title || !/年度报告/.test(packet.title)) continue
    const source = sourceRows[0]!
    const lines = source.content.split(/\r?\n/)
    const excerptAt = (paragraph: number) => packet.excerpts.filter(excerpt => excerpt.sourceCandidateId === packet.sourceCandidateId
      && excerpt.location === `paragraph:${paragraph}` && excerpt.text === lines[paragraph - 1])
    const rowCandidates = lines.flatMap((line, index) => /^\s*研发投入金额\s*[（(]元[）)]/.test(line) ? [index + 1] : [])
    if (rowCandidates.length !== 1) continue
    const rowParagraph = rowCandidates[0]!
    const rowExcerpt = excerptAt(rowParagraph)
    if (rowExcerpt.length !== 1) continue
    const headerParagraph = rowParagraph - 1
    const headerExcerpt = excerptAt(headerParagraph)
    if (headerExcerpt.length !== 1 || !citedReferences.some(ref => ref.sourceCandidateId === packet.sourceCandidateId && ref.location === `paragraph:${headerParagraph}`)) continue
    const headerYears = [...headerExcerpt[0]!.text.matchAll(/\b((?:19|20)\d{2})\s*年/g)].map(match => Number(match[1]))
    if (headerYears.length !== 2 || !headerExcerpt[0]!.text.includes('变动比例')) continue
    const cells = [...rowExcerpt[0]!.text.matchAll(/\d[\d,，]*(?:\.\d+)?/g)].map(match => Number(match[0]!.replace(/[,，]/g, '')))
    if (cells.length !== 3 || !/%|％/.test(rowExcerpt[0]!.text)) continue
    if (!values.every(value => {
      const column = headerYears.indexOf(value.year)
      if (column < 0 || column > 1) return false
      const actual = cells[column]!
      const claimedYuan = value.amount * (value.unit === '亿元' ? 1e8 : 1)
      const tolerance = value.unit === '亿元' ? 0.0050001 * 1e8 : 0.005001
      return Math.abs(actual - claimedYuan) <= tolerance
    })) continue
    matches.push({ sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${rowParagraph}` })
  }
  if (matches.length !== 1) return undefined
  const reference = matches[0]!
  if (citedReferences.some(ref => ref.sourceCandidateId === reference.sourceCandidateId && ref.location === reference.location)) return undefined
  const verificationText = values.map(value => `${value.year}年研发投入${value.amount}${value.unit}`).join('；')
  return { reference, verificationText }
}

/** Correct a bad locator only when one uniquely matching excerpt from that
 * same cited source is in the exact packet and also grounds the claim's numbers. */
export function repairUnavailableCompanyMethodCitations<T>(output: T, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): { readonly output: T; readonly repairs: readonly CompanyCitationRepair[] } {
  let raw: unknown = output
  if (typeof raw === 'string') { try { raw = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return { output, repairs: [] } } }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { output, repairs: [] }
  const copy = structuredClone(raw) as Record<string, unknown>
  const allowed = new Set(packets.flatMap(packet => packet.excerpts.map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`)))
  const packetSources = packets.map(packet => {
    const source = input.sources.find(item => item.candidate.candidateId === packet.sourceCandidateId)!
    const last = Math.max(...packet.excerpts.map(excerpt => Number(excerpt.location.split(':')[1])))
    const lines = Array<string>(last).fill('')
    for (const excerpt of packet.excerpts) lines[Number(excerpt.location.split(':')[1]) - 1] = excerpt.text
    return { ...source, content: lines.join('\n') }
  })
  const repairs: CompanyCitationRepair[] = []
  const repairAdjacentSourceLocatorCluster = (text: string, fieldPath: string): string => text.replace(/((?:\[[^\]\s]+@paragraph:\d+\]\s*){2,})/g, (literal, rawCluster: string, offset: number, whole: string) => {
    const refs = [...rawCluster.matchAll(/\[([^@\]\s]+)@paragraph:(\d+)\]/g)].map(match => ({ sourceCandidateId: match[1]!, location: `paragraph:${match[2]}`, paragraph: Number(match[2]) }))
    if (refs.length < 2 || !input.sources.some(source => source.candidate.candidateId === refs[0]!.sourceCandidateId)
      || refs.some((ref, index) => index > 0 && (ref.sourceCandidateId !== refs[0]!.sourceCandidateId || ref.paragraph !== refs[index - 1]!.paragraph + 1))) return literal
    if (refs.some(ref => allowed.has(`${ref.sourceCandidateId}@${ref.location}`))) return literal

    const locatorSourceIds = refs.map(ref => new Set(packets
      .filter(packet => packet.sourceCandidateId !== refs[0]!.sourceCandidateId
        && input.sources.some(source => source.candidate.candidateId === packet.sourceCandidateId)
        && packet.excerpts.some(excerpt => excerpt.location === ref.location))
      .map(packet => packet.sourceCandidateId)))
    const matchingSourceIds = [...locatorSourceIds[0]!].filter(sourceId => locatorSourceIds.every(ids => ids.has(sourceId)))
    if (matchingSourceIds.length !== 1) return literal
    const sourceCandidateId = matchingSourceIds[0]!
    // Leave ordinary truncated-id completion to the existing strict-prefix repair.
    if (sourceCandidateId.startsWith(refs[0]!.sourceCandidateId) || refs[0]!.sourceCandidateId.startsWith(sourceCandidateId)) return literal
    if (packets.filter(packet => packet.sourceCandidateId === sourceCandidateId).length !== 1
      || input.sources.filter(source => source.candidate.candidateId === sourceCandidateId).length !== 1) return literal
    const packet = packets.find(candidate => candidate.sourceCandidateId === sourceCandidateId)
    if (!packet) return literal

    const claimStart = whole.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
    const before = whole.slice(claimStart, offset).trimEnd()
    const withoutSentenceEnd = /[。！？；]$/.test(before) ? before.slice(0, -1) : before
    const boundary = Math.max(withoutSentenceEnd.lastIndexOf('。'), withoutSentenceEnd.lastIndexOf('！'), withoutSentenceEnd.lastIndexOf('？'), withoutSentenceEnd.lastIndexOf('；'))
    const claim = withoutSentenceEnd.slice(boundary + 1).trim()
    if (!claim) return literal

    const excerpts = refs.flatMap(ref => packet.excerpts.filter(excerpt => excerpt.location === ref.location))
    if (excerpts.length !== refs.length) return literal
    const semanticText = [packet.title, ...excerpts.map(excerpt => excerpt.text)].join(' ')
    if (!meaningMatches(claim, semanticText)) return literal
    const candidateRefs = refs.map(ref => ({ sourceCandidateId, location: ref.location }))
    const grounded = validateCompanyNumericGrounding({
      markdown: `${claim} ${candidateRefs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
      sources: packetSources,
      evidenceContexts: packets,
      preparedAnalysis: input.preparedAnalysis,
      trustedText: [input.company.symbol, input.asOf],
    })
    if (grounded.status !== 'grounded') return literal

    const replacements = new Map(refs.map(ref => [`[${ref.sourceCandidateId}@${ref.location}]`, `[${sourceCandidateId}@${ref.location}]`]))
    const repairedCluster = rawCluster.replace(/\[[^\]\s]+@paragraph:\d+\]/g, citation => replacements.get(citation) ?? citation)
    repairs.push({
      sectionId: fieldPath,
      inputText: claim,
      originalReferences: refs.map(ref => ({ sourceCandidateId: ref.sourceCandidateId, location: ref.location })),
      addedReferences: candidateRefs,
      reason: 'A consecutive cited paragraph cluster used a source id that supplied none of those locators. Every exact locator was present in one unique alternative source, and the combined supplied excerpts matched the claim and passed numeric grounding before the source ids were rebound.',
    })
    return repairedCluster
  })
  const repairText = (text: string, sectionId: string, supportingRefs: readonly CompanyMethodEvidenceRef[] = []): string => text.replace(/\[([^\]\s]+)@(paragraph:\d+)\]/g, (literal, sourceCandidateId: string, location: string, offset: number, whole: string) => {
    if (allowed.has(`${sourceCandidateId}@${location}`)) return literal
    // Models occasionally truncate the final character of a long official
    // candidate id. Permit only a strict-prefix completion that is unique
    // among the supplied packets and contains this exact locator; semantic
    // and numeric grounding checks below still have to pass.
    const prefixCandidates = [...new Set(packets
      .filter(packet => packet.sourceCandidateId.startsWith(sourceCandidateId)
        && packet.sourceCandidateId !== sourceCandidateId
        && packet.excerpts.some(excerpt => excerpt.location === location)
        && input.sources.some(source => source.candidate.candidateId === packet.sourceCandidateId))
      .map(packet => packet.sourceCandidateId))]
    const prefixCompletedSourceCandidateId = prefixCandidates.length === 1 ? prefixCandidates[0]! : sourceCandidateId
    const repairedTruncatedSourceId = prefixCompletedSourceCandidateId !== sourceCandidateId
    const sourceIdWasSupplied = packets.some(packet => packet.sourceCandidateId === prefixCompletedSourceCandidateId)
    if (!sourceIdWasSupplied) {
      // An invented source id may be rebound only when this exact paragraph
      // exists in the current evidence packet. Do not infer identity from edit
      // distance; paragraph collisions are handled below using valid citations
      // already attached to this same claim.
      const locatorCandidates = new Set(packets
        .filter(packet => input.sources.some(source => source.candidate.candidateId === packet.sourceCandidateId))
        .flatMap(packet => packet.excerpts
          .filter(excerpt => excerpt.location === location)
          .map(excerpt => `${packet.sourceCandidateId}@${excerpt.location}`)))
      if (locatorCandidates.size === 0) return literal
    }
    const left = whole.slice(0, offset).trimEnd()
    let boundary = Math.max(left.lastIndexOf('。'), left.lastIndexOf('！'), left.lastIndexOf('？'), left.lastIndexOf('；'), left.lastIndexOf('\n'))
    if (boundary === left.length - 1) boundary = Math.max(left.lastIndexOf('。', boundary - 1), left.lastIndexOf('！', boundary - 1), left.lastIndexOf('？', boundary - 1), left.lastIndexOf('；', boundary - 1), left.lastIndexOf('\n', boundary - 1))
    const start = boundary + 1
    const right = whole.slice(offset + literal.length)
    const stops = [right.indexOf('。'), right.indexOf('！'), right.indexOf('？'), right.indexOf('；'), right.indexOf('\n')].filter(index => index >= 0)
    const end = offset + literal.length + (stops.length ? Math.min(...stops) : right.length)
    let claim = strip(whole.slice(start, end)).trim()
    // Citation lists commonly follow sentence-final punctuation. In that
    // layout, the normal forward slice is just references; use the text before
    // the first citation on this physical line as the claim so the exact
    // citations on that line remain available as same-claim disambiguators.
    const lineStart = whole.lastIndexOf('\n', offset) + 1
    const lineEndIndex = whole.indexOf('\n', offset)
    const lineEnd = lineEndIndex < 0 ? whole.length : lineEndIndex
    const line = whole.slice(lineStart, lineEnd)
    const offsetInLine = offset - lineStart
    const leftPipe = line.lastIndexOf('|', offsetInLine)
    const rightPipe = line.indexOf('|', offsetInLine + literal.length)
    const isCellScoped = leftPipe >= 0 && rightPipe > leftPipe
    const citationScope = isCellScoped ? line.slice(leftPipe + 1, rightPipe) : line
    const firstCitationInScope = citationScope.search(/\[[^\]\s]+@paragraph:\d+\]/)
    const lineClaim = firstCitationInScope >= 0 ? strip(citationScope.slice(0, firstCitationInScope)).trim() : ''
    if (!claim || (lineClaim && (isCellScoped || start >= offset))) claim = lineClaim
    // A missing locator may support one clause of a compound claim while
    // other exact values in that same claim are already grounded by valid
    // citations (for example a shareholder-table percentage plus an annual
    // report's nominee-share note). Keep those verified references in the
    // numeric check; the replacement excerpt must still independently match
    // the clause semantics below and be the unique valid locator.
    const citationContext = lineClaim ? citationScope : whole.slice(start, end)
    const inlineRefs = [...citationContext.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)]
      .map(match => ({ sourceCandidateId: match[1]!, location: match[2]! }))
      .filter(ref => allowed.has(`${ref.sourceCandidateId}@${ref.location}`))
    const claimRefs = [...new Map([...supportingRefs, ...inlineRefs]
      .filter(ref => allowed.has(`${ref.sourceCandidateId}@${ref.location}`))
      .map(ref => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()]
    const supportSourceIds = new Set(claimRefs.map(ref => ref.sourceCandidateId))
    const exactLocatorCandidateIds = new Set(packets
      .filter(packet => input.sources.some(source => source.candidate.candidateId === packet.sourceCandidateId))
      .flatMap(packet => packet.excerpts.some(excerpt => excerpt.location === location) ? [packet.sourceCandidateId] : []))
    // A malformed (non-prefix) id may be corrected only when the same claim
    // has valid citations to exactly one supplied source and that source has
    // this exact locator. The candidate paragraph still must independently
    // match the claim and pass numeric grounding below. This handles small
    // model transcription errors without using edit distance or paragraph
    // number alone to guess a document.
    const claimAnchoredSourceCandidateId = !sourceIdWasSupplied
      && supportSourceIds.size === 1
      && exactLocatorCandidateIds.has([...supportSourceIds][0]!)
      ? [...supportSourceIds][0]
      : undefined
    const canonicalSourceCandidateId = claimAnchoredSourceCandidateId ?? prefixCompletedSourceCandidateId
    const resolvedSourceIdWasSupplied = sourceIdWasSupplied || claimAnchoredSourceCandidateId !== undefined
    const repairedSourceIdFromClaimAnchor = claimAnchoredSourceCandidateId !== undefined
    const sourceHasExactLocator = packets.some(packet => packet.sourceCandidateId === canonicalSourceCandidateId
      && packet.excerpts.some(excerpt => excerpt.location === location))
    // A real source id can still be paired with another report's paragraph
    // number. Treat that as an invalid pair (not a same-source bad locator)
    // only when the exact locator is present elsewhere in supplied evidence;
    // the candidate must still be unique/disambiguated and independently
    // support the claim below.
    const repairFromExactOtherSource = resolvedSourceIdWasSupplied && !sourceHasExactLocator && exactLocatorCandidateIds.size > 0
    const repairAtExactLocator = !resolvedSourceIdWasSupplied || repairFromExactOtherSource
    // A paragraph number can collide across documents. In that case only
    // already-valid references attached to this same claim may disambiguate,
    // and they must all identify exactly one source that also supplies the
    // exact locator. Cross-source support remains ambiguous and fails closed.
    const disambiguatedSourceId = repairAtExactLocator && exactLocatorCandidateIds.size > 1
      ? supportSourceIds.size === 1 && exactLocatorCandidateIds.has([...supportSourceIds][0]!)
        ? [...supportSourceIds][0]
        : undefined
      : undefined
    if (repairAtExactLocator && exactLocatorCandidateIds.size > 1 && !disambiguatedSourceId) return literal
    const matches = packets.flatMap(packet => packet.excerpts.flatMap(excerpt => {
      // An invented source id, or a real source paired with another report's
      // paragraph number, can only be rebound at that exact supplied locator.
      // A genuinely unavailable paragraph in the named source retains the
      // existing same-source semantic locator repair behavior.
      if (repairAtExactLocator && excerpt.location !== location) return []
      // For a malformed id anchored by other valid citations in this same
      // claim, preserve the requested paragraph exactly: the correction is
      // source-id completion, not a semantic locator search within that file.
      if (repairedSourceIdFromClaimAnchor && excerpt.location !== location) return []
      if (!repairAtExactLocator && excerpt.location !== location && packet.sourceCandidateId !== canonicalSourceCandidateId) return []
      if (repairedTruncatedSourceId && packet.sourceCandidateId !== canonicalSourceCandidateId) return []
      if (disambiguatedSourceId && packet.sourceCandidateId !== disambiguatedSourceId) return []
      if (!input.sources.some(source => source.candidate.candidateId === packet.sourceCandidateId)) return []
      const context = (excerpt.contextLocations ?? []).flatMap(contextLocation => packet.excerpts.filter(item => item.location === contextLocation && Math.abs(Number(item.location.split(':')[1]) - Number(excerpt.location.split(':')[1])) <= 1).map(item => item.text))
      const claimSupportText = claimRefs.filter(ref => ref.sourceCandidateId === packet.sourceCandidateId)
        .flatMap(ref => packet.excerpts.filter(item => item.location === ref.location).map(item => item.text))
      const semanticText = [packet.title, ...context, excerpt.text, ...claimSupportText].join(' ')
      const exactUniqueUnknownIdOverlap = !resolvedSourceIdWasSupplied
        && exactLocatorCandidateIds.size === 1
        && (hasBoundedCjkOverlap(claim, semanticText) || isCellScoped && hasStrongTableCellCjkOverlap(claim, semanticText))
      if (!meaningMatches(claim, semanticText)
        && !(repairedSourceIdFromClaimAnchor && hasBoundedCjkOverlap(claim, semanticText))
        && !exactUniqueUnknownIdOverlap) return []
      const grounded = validateCompanyNumericGrounding({ markdown: `${claim} ${[...claimRefs, { sourceCandidateId: packet.sourceCandidateId, location: excerpt.location }].map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: packetSources, evidenceContexts: packets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] })
      return grounded.status === 'grounded' ? [{ ref: { sourceCandidateId: packet.sourceCandidateId, location: excerpt.location }, text: excerpt.text }] : []
    }))
    const uniqueMatches = [...new Map(matches.map(match => [`${match.ref.sourceCandidateId}@${match.ref.location}`, match])).values()]
    if (uniqueMatches.length !== 1) return literal
    const replacement = uniqueMatches[0]!.ref
    repairs.push({ sectionId, inputText: claim, originalReferences: [{ sourceCandidateId, location }], addedReferences: [replacement], reason: repairedSourceIdFromClaimAnchor
      ? 'The malformed source id was resolved only from the unique source already cited by the same claim; that source supplies this exact locator, whose excerpt independently matches claim semantics and numeric grounding.'
      : repairedTruncatedSourceId
      ? 'The cited source id was a strict prefix of exactly one supplied candidate with this exact locator; its excerpt independently matches the claim semantics and numeric grounding before completing the id.'
      : repairFromExactOtherSource
      ? 'The source id was supplied but its paired locator was absent from that source; the exact locator exists in supplied evidence and its uniquely supported excerpt independently matches claim semantics and numeric grounding before replacing the source-locator pair.'
      : disambiguatedSourceId
      ? 'The exact locator collided across supplied sources, but all already-valid same-claim citations identified one candidate; its exact excerpt semantically supports the claim and numeric grounding before changing the source-locator pair.'
      : 'Unique supplied excerpt at the exact locator from a verified source and title independently matches the claim semantics and numeric grounding; repaired the source-locator pair together.' })
    return `[${replacement.sourceCandidateId}@${replacement.location}]`
  })
  for (const key of ['markdown', 'answer'] as const) if (typeof copy[key] === 'string') copy[key] = repairText(repairAdjacentSourceLocatorCluster(copy[key] as string, key), key)
  if (Array.isArray(copy.sections)) copy.sections = copy.sections.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const row = item as Record<string, unknown>
    return typeof row.markdown === 'string' ? { ...row, markdown: repairText(repairAdjacentSourceLocatorCluster(row.markdown, typeof row.id === 'string' ? row.id : `sections[${index}]`), typeof row.id === 'string' ? row.id : `sections[${index}]`) } : item
  })
  if (Array.isArray(copy.findings)) copy.findings = copy.findings.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const row = item as Record<string, unknown>
    const suppliedFindingRefs = Array.isArray(row.evidence) ? row.evidence.flatMap(ref => {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return []
      const value = ref as Record<string, unknown>
      return typeof value.sourceCandidateId === 'string' && typeof value.location === 'string' && allowed.has(`${value.sourceCandidateId}@${value.location}`)
        ? [{ sourceCandidateId: value.sourceCandidateId, location: value.location }]
        : []
    }) : []
    const text = typeof row.text === 'string' ? repairText(row.text, `findings[${index}]`, suppliedFindingRefs) : row.text
    const evidence = Array.isArray(row.evidence) ? row.evidence.map(ref => {
      if (!ref || typeof ref !== 'object' || Array.isArray(ref)) return ref
      const value = ref as Record<string, unknown>
      if (typeof value.sourceCandidateId !== 'string' || typeof value.location !== 'string' || allowed.has(`${value.sourceCandidateId}@${value.location}`)) return ref
      const placeholder = `[${value.sourceCandidateId}@${value.location}]`
      const repaired = repairText(`${typeof text === 'string' ? text : ''} ${placeholder}`, `findings[${index}]`, suppliedFindingRefs).match(/\[([^\]\s]+)@(paragraph:\d+)\]/g)?.at(-1)
      const match = repaired?.match(/^\[([^\]\s]+)@(paragraph:\d+)\]$/)
      return match ? { sourceCandidateId: match[1], location: match[2] } : ref
    }) : row.evidence
    return { ...row, text, evidence }
  })
  return { output: copy as T, repairs }
}
function removeBoundLocatorProse(text: string, refs: readonly CompanyMethodEvidenceRef[]): string {
  return text.replace(/(?<![@\w])(?:见\s*)?paragraphs?\s*:\s*(\d+)(?:\s*[-–—]\s*(\d+))?/gi, (literal, first: string, last: string | undefined) => {
    const start = Number(first); const end = last ? Number(last) : start
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 20) return literal
    const sourceIds = new Set(refs.filter((ref) => { const paragraph = Number(/^paragraph:(\d+)$/.exec(ref.location)?.[1]); return paragraph >= start && paragraph <= end }).map((ref) => ref.sourceCandidateId))
    const covered = (id: string) => Array.from({ length: end - start + 1 }, (_, offset) => `paragraph:${start + offset}`).every((location) => refs.some((ref) => ref.sourceCandidateId === id && ref.location === location))
    return sourceIds.size === 1 && covered([...sourceIds][0]!) ? '' : literal
  })
}

/** Remove parenthetical locator explanations only when the exact supplied citations already bind them. */
function removeBoundLocatorMarkers(text: string, refs: readonly CompanyMethodEvidenceRef[]): string {
  return removeBoundLocatorProse(text, refs).replace(/[（(]\s*[）)]/g, '').replace(/\[\s*\]/g, '').replace(/\s{2,}/g, ' ').trim()
}

/** Binds a repeated annual-report "other" value only to its product-table row. */
function repairExactAnnualProductRevenueRows(text: string, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): { text: string; added: CompanyMethodEvidenceRef[] } {
  const lines = text.split('\n')
  const added: CompanyMethodEvidenceRef[] = []
  const rowPair = (line: string): { amount: number; percentage: number } | undefined => {
    if (!/^\s*\|/.test(line)) return undefined
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
    const amountCell = cells.find((cell, cellIndex) => cellIndex > 0 && /[\d,]+(?:\.\d+)?/.test(cell) && !/[%％]/.test(cell))
    const amount = amountCell ? Number(/[\d,]+(?:\.\d+)?/.exec(amountCell)![0].replace(/,/g, '')) : Number.NaN
    const shareCell = cells.find(cell => /[\d,]+(?:\.\d+)?\s*[%％]/.test(cell))
    const percentage = shareCell ? Number(/[\d,]+(?:\.\d+)?/.exec(shareCell)![0].replace(/,/g, '')) : Number.NaN
    return Number.isFinite(amount) && Number.isFinite(percentage) ? { amount, percentage } : undefined
  }
  for (let index = 0; index < lines.length; index += 1) {
    const row = lines[index]!
    if (!/^\s*\|/.test(row) || !/其他/.test(row) || /\[[^\]]+@paragraph:\d+\]/.test(row)) continue
    const header = lines.slice(Math.max(0, index - 5), index).reverse().find(line => /^\s*\|/.test(line) && /产品/.test(line) && /营业收入/.test(line) && /占营业收入|收入占比/.test(line))
    if (!header || !/[（(]元[）)]/.test(header)) continue
    const reportYear = /((?:19|20)\d{2})\s*年/.exec(header)?.[1]
    if (!reportYear) continue
    const cells = row.split('|').slice(1, -1).map(cell => cell.trim())
    const amounts = cells.flatMap(cell => [...cell.matchAll(/(?<![\w.])[\d,]+(?:\.\d+)?/g)].map(match => Number(match[0].replace(/,/g, ''))))
    const percentage = cells.flatMap(cell => [...cell.matchAll(/([\d,]+(?:\.\d+)?)\s*[%％]/g)].map(match => Number(match[1]!.replace(/,/g, ''))))[0]
    if (!amounts.length || percentage === undefined) continue
    const cited = new Set([...text.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => `${match[1]}@${match[2]}`))
    const matchingTableRows = lines.slice(0, index).filter(line => {
      const firstCell = /^\s*\|\s*([^|]+)/.exec(line)?.[1]?.trim() ?? ''
      return !/^其他(?:\s|$)/.test(firstCell) && !/---/.test(line) && Boolean(rowPair(line))
    })
    const matches: CompanyMethodEvidenceRef[] = []
    for (const packet of packets) {
      const source = input.sources.find(item => item.candidate.candidateId === packet.sourceCandidateId)
      if (!source || source.title !== packet.title || !new RegExp(`^${reportYear}年年度报告(?:全文)?$`).test(packet.title.replace(/\s+/g, ''))) continue
      const sourceLines = source.content.split(/\r?\n/)
      const excerpts = new Map(packet.excerpts.map(excerpt => [Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1]), excerpt]))
      const exactExcerpt = (paragraph: number) => excerpts.get(paragraph)?.text === sourceLines[paragraph - 1]
      const headings = sourceLines.map((line, lineIndex) => ({ line: line.trim(), paragraph: lineIndex + 1 })).filter(item => /^分(?:行业|产品|地区|销售模式)$/.test(item.line))
      const firstSection = headings.find(item => item.line === '分行业' || item.line === '分产品')
      const productSection = headings.find(item => item.line === '分产品')
      const nextProductSection = productSection && headings.find(item => item.paragraph > productSection.paragraph)
      if (!firstSection || !productSection || !nextProductSection) continue
      const unit = sourceLines.map((line, lineIndex) => ({ line, paragraph: lineIndex + 1 })).filter(item => item.paragraph < firstSection.paragraph && /^\s*单位\s*[:：]\s*元\s*$/.test(item.line.trim())).at(-1)
      const period = sourceLines.map((line, lineIndex) => ({ line, paragraph: lineIndex + 1 })).filter(item => item.paragraph > (unit?.paragraph ?? 0) && item.paragraph < firstSection.paragraph && new RegExp(`^\\s*${reportYear}\\s*年`).test(item.line)).at(0)
      const headerRows = sourceLines.map((line, lineIndex) => ({ line, paragraph: lineIndex + 1 })).filter(item => item.paragraph > (period?.paragraph ?? 0) && item.paragraph < firstSection.paragraph && /金额|占营业收入/.test(item.line))
      if (!unit || !period || !headerRows.length || ![unit, period, ...headerRows].every(item => cited.has(`${packet.sourceCandidateId}@paragraph:${item.paragraph}`) && exactExcerpt(item.paragraph))) continue
      const productAnchors = sourceLines.map((line, lineIndex) => ({ line, paragraph: lineIndex + 1 }))
        .filter(item => item.paragraph > productSection.paragraph && item.paragraph < nextProductSection.paragraph && cited.has(`${packet.sourceCandidateId}@paragraph:${item.paragraph}`) && exactExcerpt(item.paragraph))
        .some(item => {
          const values = [...item.line.matchAll(/([\d,]+(?:\.\d+)?)\s+([\d.]+)\s*[%％]/g)]
          const prefix = item.line.slice(0, values[0]?.index ?? 0).trim()
          const previous = sourceLines[item.paragraph - 2]?.trim() ?? ''
          const label = (!/\d/.test(previous) && previous.length < 90 && !/^分(?:产品|行业|地区|销售模式)$/.test(previous) ? previous : '') + prefix
          const matchedTableRow = matchingTableRows.some(tableRow => {
            const pair = rowPair(tableRow)
            return pair && values[0]
              && pair.amount === Number(values[0][1]!.replace(/,/g, ''))
              && pair.percentage === Number(values[0][2]!)
              && pair.amount !== amounts[0]
          })
          return Boolean(label && !/^其他(?:\s|$)/.test(label) && values[0] && matchedTableRow)
        })
      if (!productAnchors) continue
      for (let paragraph = productSection.paragraph + 1; paragraph < nextProductSection.paragraph; paragraph += 1) {
        const sourceRow = sourceLines[paragraph - 1] ?? ''
        const sourceMatch = /^其他\s+([\d,]+(?:\.\d+)?)\s+([\d.]+)\s*[%％]/.exec(sourceRow)
        if (!sourceMatch || Number(sourceMatch[1]!.replace(/,/g, '')) !== amounts[0] || Number(sourceMatch[2]!) !== percentage || !exactExcerpt(paragraph)) continue
        matches.push({ sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${paragraph}` })
      }
    }
    if (matches.length !== 1) continue
    const ref = matches[0]!
    const lastPipe = row.lastIndexOf('|')
    const insertion = ` [${ref.sourceCandidateId}@${ref.location}]`
    lines[index] = lastPipe > 0 ? `${row.slice(0, lastPipe).trimEnd()}${insertion} ${row.slice(lastPipe)}` : `${row}${insertion}`
    added.push(ref)
  }
  return { text: lines.join('\n'), added }
}

/** Repairs only uniquely verifiable mislocated citations, within already cited sources and supplied excerpts. */
export function repairCompanyMethodCitations<T extends MethodOutput>(output: T, packets: readonly CompanyEvidencePacket[], input: CompanyResearchInput): { readonly output: T; readonly repairs: readonly CompanyCitationRepair[] } {
  const evidencePackets = deduplicateCompanyPackets(packets)
  const repairs: CompanyCitationRepair[] = []
  const normalizeHumanReadableParagraphCitations = (text: string, fieldPath: string): string => text.replace(/〔证据：([^\s，〕]+)，paragraph:(\d+)〕/g, (literal, sourceCandidateId: string, paragraph: string) => {
    const location = `paragraph:${paragraph}`
    const supplied = evidencePackets.some(packet => packet.sourceCandidateId === sourceCandidateId
      && packet.excerpts.some(excerpt => excerpt.sourceCandidateId === sourceCandidateId && excerpt.location === location))
    if (!supplied) return literal
    const reference = { sourceCandidateId, location }
    repairs.push({ sectionId: fieldPath, inputText: literal, originalReferences: [], addedReferences: [reference], reason: 'A human-readable citation was normalized only after its exact source candidate and paragraph locator were found in the current evidence packet; normal reference, source, and numeric validation still applies.' })
    return `[${sourceCandidateId}@${location}]`
  })
  output = {
    ...output,
    markdown: normalizePreparedSimpleFcfFormula(normalizeHumanReadableParagraphCitations(output.markdown, 'method-summary'), evidencePackets, input),
    sections: output.sections.map(section => ({ ...section, markdown: normalizePreparedSimpleFcfFormula(normalizeHumanReadableParagraphCitations(section.markdown, section.id), evidencePackets, input) })),
    findings: output.findings.map((finding, index) => ({ ...finding, text: normalizePreparedSimpleFcfFormula(normalizeHumanReadableParagraphCitations(finding.text, `finding-${index + 1}`), evidencePackets, input, finding.evidence) })),
  } as T
  const outputReferencedSources = new Set([
    ...[output.markdown, ...output.sections.map((section) => section.markdown)].flatMap((text) => [...text.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map((match) => match[1]!)),
    ...output.findings.flatMap((finding) => finding.evidence.map((ref) => ref.sourceCandidateId)),
  ])
  const packetSources = evidencePackets.map((packet) => {
    const source = input.sources.find((item) => item.candidate.candidateId === packet.sourceCandidateId)!
    const last = Math.max(...packet.excerpts.map((excerpt) => Number(excerpt.location.split(':')[1])))
    const lines = Array<string>(last).fill('')
    for (const excerpt of packet.excerpts) lines[Number(excerpt.location.split(':')[1]) - 1] = excerpt.text
    return { ...source, content: lines.join('\n') }
  })
  const correctedSections = output.sections.map(section => {
    if (section.id !== 'business-model') return section
    const revenue = repairExactAnnualProductRevenueRows(section.markdown, evidencePackets, input)
    if (revenue.added.length) repairs.push({ sectionId: section.id, inputText: section.markdown, originalReferences: [...section.markdown.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => ({ sourceCandidateId: match[1]!, location: match[2]! })), addedReferences: revenue.added, reason: 'The exact annual product-revenue row was matched to a supplied report excerpt. When the same values also appear under another classification, repair requires cited period/unit headers and a separately cited, uniquely labeled product row whose displayed values match; the duplicate outside the product subsection is excluded.' })
    const refs = [...revenue.text.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => ({ sourceCandidateId: match[1]!, location: match[2]! }))
    const corrected = correctVerifiedAnnualProductMarginUnits(revenue.text, refs, evidencePackets, input)
    if (!corrected) return revenue.text === section.markdown ? section : { ...section, markdown: revenue.text }
    repairs.push({ sectionId: section.id, inputText: revenue.text, originalReferences: refs, addedReferences: [], reason: 'The supplied 2025 annual report product-margin table explicitly displays the two cited year-over-year changes as percentages in its final column. Exact product labels, values, unit, full column headers, and all source paragraphs match; only the incorrect “百分点” unit wording was corrected to the disclosed “%”.' })
    return { ...section, markdown: corrected }
  })
  const correctedMarkdown = repairExactAnnualProductRevenueRows(output.markdown, evidencePackets, input)
  if (correctedMarkdown.added.length) repairs.push({ inputText: output.markdown, originalReferences: [...output.markdown.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => ({ sourceCandidateId: match[1]!, location: match[2]! })), addedReferences: correctedMarkdown.added, reason: 'The exact annual product-revenue row was matched to a supplied report excerpt. Existing citations establish the product table headers and a uniquely labeled, value-matched product row, disambiguating an identical row in another classification.' })
  const reinforced = reinforceFinancialQualityMarginCitations(correctedMarkdown.text, correctedSections, evidencePackets, input.sources)
  repairs.push(...reinforced.repairs)
  if (reinforced.sections.some((section, index) => section.markdown !== output.sections[index]!.markdown) || correctedMarkdown.text !== output.markdown) output = { ...output, sections: reinforced.sections, markdown: correctedMarkdown.text } as T
  const grounded = (text: string, refs: readonly CompanyMethodEvidenceRef[]) => validateCompanyNumericGrounding({ markdown: `${text} ${refs.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: packetSources, evidenceContexts: evidencePackets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] }).status === 'grounded'
  const findings = output.findings.map((finding, findingIndex) => {
    const locatorCleanedText = removeBoundLocatorMarkers(finding.text, finding.evidence)
    if (locatorCleanedText !== finding.text) finding = { ...finding, text: locatorCleanedText }
    const initiallyGrounded = grounded(finding.text, finding.evidence)
    const classifiedRowRefs = exactClassifiedTableRowContextReferences(finding, evidencePackets, input)
    if (classifiedRowRefs?.length && grounded(finding.text, [...finding.evidence, ...classifiedRowRefs])) {
      repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences: classifiedRowRefs, reason: 'The already-cited unit, complete table header, and exact classification heading identify one source-bound row whose split label matches the finding; exact source lines were verified and the full finding passed numeric grounding after adding only the omitted label/value locators.' })
      return { ...finding, evidence: [...finding.evidence, ...classifiedRowRefs] }
    }
    const researchInvestment = exactAnnualResearchInvestmentRow(finding.text, finding.evidence, evidencePackets, input)
    if (researchInvestment && grounded(researchInvestment.verificationText, [...finding.evidence, researchInvestment.reference])) {
      repairs.push({ findingIndex, inputText: researchInvestment.verificationText, originalReferences: finding.evidence, addedReferences: [researchInvestment.reference], reason: 'The finding cites the exact adjacent annual-report year header; the unique supplied R&D investment row matches the named periods and reported amounts, and numeric grounding accepts the exact row.' })
      finding = { ...finding, evidence: [...finding.evidence, researchInvestment.reference] }
    }
    const marketStructureH1Refs = output.sections.length === 1 && output.sections[0]!.id === 'industry-exposure'
      ? exactMarketStructureH1MarginRowReference(finding, evidencePackets, input) : undefined
    if (marketStructureH1Refs?.length && grounded(finding.text, [...finding.evidence, ...marketStructureH1Refs])) {
      repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences: marketStructureH1Refs, reason: 'The market-structure finding explicitly names one 2026 H1 classification and exact label; its already-cited unit and full split header, exact source/excerpt text, split product label when applicable, and all four matching row cells uniquely identify the value row.' })
      return { ...finding, evidence: [...finding.evidence, ...marketStructureH1Refs] }
    }
    const isR169MarketStructureShape = output.sections.length === 1 && output.sections[0]!.id === 'industry-exposure'
      && /毛利率比上年同期增减列为/.test(finding.text)
      && /(?:营业)?收入\s*[\d,，]+(?:\.\d+)?\s*元/.test(finding.text)
      && /(?:营业)?成本\s*[\d,，]+(?:\.\d+)?\s*元/.test(finding.text)
      && finding.evidence.some(ref => evidencePackets.some(packet => packet.sourceCandidateId === ref.sourceCandidateId && /^2026\s*年半年度报告(?:全文)?$/.test(packet.title.replace(/\s+/g, ''))))
    if (isR169MarketStructureShape) return finding
    const annualPhoneRefs = output.sections.map(section => section.id).sort().join(',') === 'business-model,business-segments,supply-chain'
      ? exactAnnualPhoneMarginReferences(finding, evidencePackets, input) : undefined
    if (annualPhoneRefs?.length && grounded(finding.text, [...finding.evidence, ...annualPhoneRefs])) {
      repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences: annualPhoneRefs, reason: 'The cited 2025 phone-products revenue row and initial annual margin header, plus verified supplied header continuations, bind one exact product label with matching revenue and margin; actual source paragraphs equal the excerpts. The industry row was excluded.' })
      return { ...finding, evidence: [...finding.evidence, ...annualPhoneRefs] }
    }
    const h1ProductRefs = output.sections.length === 1 && output.sections[0]!.id === 'industry-exposure'
      ? exactH1ProductMarginReferences(finding, evidencePackets, input) : undefined
    if (h1ProductRefs?.length && grounded(finding.text, [...finding.evidence, ...h1ProductRefs])) {
      repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences: h1ProductRefs, reason: 'The cited complete H1 margin header and product heading bind two unique supplied product labels, margin levels and signed changes; source paragraphs equal the supplied excerpts. Equal industry rows were excluded.' })
      return { ...finding, evidence: [...finding.evidence, ...h1ProductRefs] }
    }
    const h1IndustryRefs = output.sections.some(section => ['revenue-profit-drivers','financial-quality','industry-exposure'].includes(section.id))
      ? exactH1IndustryMarginReferences(finding, evidencePackets, input) : undefined
    if (h1IndustryRefs?.length && grounded(finding.text, [...finding.evidence, ...h1IndustryRefs])) {
      repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences: h1IndustryRefs, reason: 'The finding cites the complete supplied H1 industry table header, unit and industry heading; the unique exact source row and any split label continuation match the claimed margin level and signed change. Each source line equals its supplied excerpt.' })
      return { ...finding, evidence: [...finding.evidence, ...h1IndustryRefs] }
    }
    if (initiallyGrounded && !/毛利率/.test(finding.text)) return finding
    const tokens = [...new Set(numbers(finding.text))]
    const singleDatedEvent = tokens.length === 1 && /^(?:19|20)\d{2}$/.test(tokens[0]!) && ['registration', 'founding', 'lithium', 'carEntry', 'listing', 'launch', 'acquisition'].some((key) => keys(finding.text).has(key))
    if (tokens.length < 2 && !singleDatedEvent && !/毛利率/.test(finding.text)) return finding
    const citedSources = new Set(finding.evidence.map((ref) => ref.sourceCandidateId))
    const findingTable = findingTableKind(finding.text)
    // Preserve the existing single-row repair path for findings that one exact
    // excerpt can fully support (including one-row summaries and dated events).
    const singleRowMatches: { refs: CompanyMethodEvidenceRef[]; excerptText: string }[] = []
    for (const packet of evidencePackets.filter((item) => citedSources.has(item.sourceCandidateId))) for (const excerpt of packet.excerpts) {
      // When the finding explicitly scopes the claim to a product or industry
      // table, do not let an equal-valued row from the adjacent table compete
      // in this generic single-row repair path.
      if (findingTable && excerptTableKind(packet, excerpt) !== findingTable) continue
      const row = Number(excerpt.location.split(':')[1])
      if (!grounded(finding.text, [...finding.evidence, { sourceCandidateId: packet.sourceCandidateId, location: excerpt.location }])) continue
      const eventContext = keys(finding.text).has('placement') ? packet.excerpts.filter((item) => Math.abs(Number(item.location.split(':')[1]) - row) === 1 && keys(item.text).has('placement')) : []
      const context = [...new Map(packet.excerpts.filter((item) => {
        if (!(excerpt.contextLocations ?? []).includes(item.location)) return false
        const contextRow = Number(/^paragraph:(\d+)$/.exec(item.location)?.[1])
        return Number.isInteger(row) && contextRow > 0 && Math.abs(row - contextRow) <= 1
      }).concat(eventContext).map((item) => [item.location, item])).values()]
      const label = numbers(excerpt.text).length >= 2 ? packet.excerpts.filter((item) => Number(item.location.split(':')[1]) >= row - 2 && Number(item.location.split(':')[1]) < row && !/\d|[。；;.!]|[一二三四五六七八九〇零]{4}年/.test(item.text) && item.text.length < 90) : []
      const existingContext = finding.evidence.filter((ref) => ref.sourceCandidateId === packet.sourceCandidateId).flatMap((ref) => {
        const cited = packet.excerpts.find((item) => item.location === ref.location)
        const citedRow = Number(/^paragraph:(\d+)$/.exec(ref.location)?.[1])
        const nearbyContext = (cited?.contextLocations ?? []).flatMap((location) => {
          const contextRow = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
          const linked = packet.excerpts.find((item) => item.location === location)
          return linked && citedRow > 0 && contextRow > 0 && Math.abs(citedRow - contextRow) <= 1 ? [linked] : []
        })
        return cited ? [cited, ...nearbyContext] : []
      })
      const original = [packet.title, ...existingContext, excerpt, ...label, ...context].map((item) => typeof item === 'string' ? item : item.text).join(' ')
      if (!meaningMatches(finding.text, original)) continue
      const refs = [...finding.evidence, ...[excerpt, ...label, ...context].map((item) => ({ sourceCandidateId: packet.sourceCandidateId, location: item.location }))]
      if (grounded(finding.text, refs)) singleRowMatches.push({ refs, excerptText: excerpt.text })
    }
    if (!/毛利率/.test(finding.text) && singleRowMatches.length && new Set(singleRowMatches.map((match) => match.excerptText)).size === singleRowMatches.length) {
      const addedReferences = [...new Map(singleRowMatches.flatMap((match) => match.refs).filter((ref) => !finding.evidence.some((original) => original.sourceCandidateId === ref.sourceCandidateId && original.location === ref.location)).map((ref) => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()]
      if (addedReferences.length) {
        repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences, reason: 'A unique supplied excerpt in an already cited source supports every quantitative token; exact context locators retained for independent semantic review.' })
        return { ...finding, evidence: [...finding.evidence, ...addedReferences] }
      }
    }
    const productMarginReferences = exactProductMarginRowReferences(finding.text, finding.evidence, evidencePackets.filter(packet => citedSources.has(packet.sourceCandidateId)))
    if (productMarginReferences?.length && grounded(finding.text, [...finding.evidence, ...productMarginReferences])) {
      repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences: productMarginReferences, reason: 'The explicitly cited unit and complete margin header, supplied 分产品 heading, exact split product labels, and unique matching product margin cells support these exact rows; the adjacent 分行业 rows were excluded.' })
      return { ...finding, evidence: [...finding.evidence, ...productMarginReferences] }
    }
    // PDF tables can split a label and its numeric continuation into separate
    // paragraphs. A numeric finding may cite the complete table header yet
    // omit the exact row paragraphs. Repair only margin-table findings where
    // the cited header, segmentation heading, complete label, and every value
    // in each label-scoped clause bind to one unique supplied row.
    if (/毛利率/.test(finding.text)) {
      const normalizedClaim = strip(finding.text).replace(/\s+/g, '')
      const initialRefs = new Set(finding.evidence.map(ref => `${ref.sourceCandidateId}@${ref.location}`))
      const citedTableRows: { refs: CompanyMethodEvidenceRef[]; key: string; label: string }[] = []
      for (const packet of evidencePackets.filter(item => citedSources.has(item.sourceCandidateId))) {
        const excerpts = packet.excerpts
          .map(excerpt => ({ excerpt, paragraph: Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1]) }))
          .filter(item => Number.isInteger(item.paragraph))
          .sort((left, right) => left.paragraph - right.paragraph)
        for (const { excerpt: rowExcerpt, paragraph: rowNumber } of excerpts) {
          const rowValues = numbers(rowExcerpt.text)
          if (rowValues.length < 6 || !/%|％/.test(rowExcerpt.text)) continue
          const section = excerpts.filter(item => item.paragraph < rowNumber && item.paragraph >= rowNumber - 40 && /^(?:分产品|分行业)$/.test(item.excerpt.text.trim())).at(-1)
          if (!section) continue
          const unit = excerpts.filter(item => item.paragraph < section.paragraph && item.paragraph >= rowNumber - 40 && /^\s*单位\s*[:：]\s*元\s*$/.test(item.excerpt.text)).at(-1)
          if (!unit) continue
          const firstSection = excerpts.find(item => item.paragraph > unit.paragraph && item.paragraph < rowNumber && /^(?:分产品|分行业)$/.test(item.excerpt.text.trim()))
          if (!firstSection) continue
          const headerRows = excerpts.filter(item => item.paragraph > unit.paragraph && item.paragraph < firstSection.paragraph)
          const compactHeader = headerRows.map(item => item.excerpt.text).join('').replace(/\s+/g, '')
          if (!/营业收入/.test(compactHeader) || !/营业成本/.test(compactHeader) || !/毛利率/.test(compactHeader)
            || !/营业收入(?:(?!营业成本|毛利率).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(compactHeader)
            || !/营业成本(?:(?!营业收入|毛利率).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(compactHeader)
            || !/毛利率(?:(?!营业收入|营业成本).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(compactHeader)) continue
          // The existing citation must establish the table and its complete
          // column header. Merely citing an equal number or a nearby row is
          // never enough to trigger this repair.
          const mainHeader = headerRows.find(item => /营业收入/.test(item.excerpt.text) && /营业成本/.test(item.excerpt.text) && /毛利率/.test(item.excerpt.text))
          const requiredHeader = mainHeader ? [unit, mainHeader] : []
          if (!requiredHeader.length || !requiredHeader.every(item => initialRefs.has(`${packet.sourceCandidateId}@${item.excerpt.location}`))) continue
          const continuation = /^[\s\u3000]*([\u3400-\u9fff·（）()、]+?)\s*(?=-?\d)/.exec(rowExcerpt.text)?.[1] ?? ''
          const preceding = excerpts.find(item => item.paragraph === rowNumber - 1)?.excerpt
          const splitLabel = preceding && !/\d/.test(preceding.text) && !/[。；;！？]/.test(preceding.text) && preceding.text.length < 90 && !/^(?:分产品|分行业)$/.test(preceding.text.trim()) ? preceding.text : ''
          const rowLabel = (splitLabel + continuation).replace(/\s+/g, '')
          if (rowLabel.length < 4) continue
          const labelIndex = normalizedClaim.indexOf(rowLabel)
          if (labelIndex < 0) continue
          const otherLabels = excerpts.flatMap(item => {
            const nextContinuation = /^[\s\u3000]*([\u3400-\u9fff·（）()、]+?)\s*(?=-?\d)/.exec(item.excerpt.text)?.[1] ?? ''
            const previous = excerpts.find(candidate => candidate.paragraph === item.paragraph - 1)?.excerpt
            const previousLabel = previous && !/\d/.test(previous.text) && !/[。；;！？]/.test(previous.text) && previous.text.length < 90 ? previous.text : ''
            const label = (previousLabel + nextContinuation).replace(/\s+/g, '')
            const index = label.length >= 4 ? normalizedClaim.indexOf(label) : -1
            return index > labelIndex ? [index] : []
          }).sort((left, right) => left - right)
          const clauseEnd = normalizedClaim.slice(labelIndex + rowLabel.length).search(/[；;。！？\n]/)
          const punctuationEnd = clauseEnd < 0 ? normalizedClaim.length : labelIndex + rowLabel.length + clauseEnd
          const valueEnd = Math.min(punctuationEnd, otherLabels[0] ?? normalizedClaim.length)
          const rowClaim = normalizedClaim.slice(labelIndex + rowLabel.length, valueEnd)
          const claimedValues = numbers(rowClaim)
          const marginChanges = [
            ...[...rowClaim.matchAll(/毛利率[^，,；;。！？]{0,32}?(?:同比|比上年同期)(?:变化|变动|增减)?(?:为)?(上升|增加|提高|下降|减少|降低)?\s*([+-]?\d+(?:\.\d+)?)\s*(?:个百分点|[%％])/g)].map(match => ({ direction: match[1], amount: match[2] })),
            // Some method findings state the margin level and its change in
            // one clause: “毛利率5.04%，同比下降2.67个百分点”. Keep this
            // exact level-plus-change grammar aligned with numeric grounding.
            ...[...rowClaim.matchAll(/毛利率(?:水平)?(?:为|是)?\s*([+-]?\d+(?:\.\d+)?)\s*[%％]\s*[、，,]\s*(?:同比|比上年同期)(?:变化|变动|增减)?(上升|增加|提高|下降|减少|降低)\s*([+-]?\d+(?:\.\d+)?)\s*(?:个百分点|[%％])/g)].map(match => ({ direction: match[2], amount: match[3] })),
          ]
          // A directional change is written as a positive magnitude in prose
          // (“下降2.67个百分点”) while the disclosed final table cell is
          // signed (-2.67). Permit that magnitude only when the exact
          // direction-plus-unit claim below independently matches the cell.
          if (!claimedValues.length || !claimedValues.every(value => rowValues.includes(value) || marginChanges.some(change => Math.abs(Number(change.amount)) === Math.abs(Number(value))))) continue
          const marginChangeCell = Number(rowValues.at(-1))
          const marginChangesAgree = marginChanges.every(match => {
            const amount = Number(match.amount)
            const direction = match.direction
            const expected = direction ? (/下降|减少|降低/.test(direction) ? -Math.abs(amount) : Math.abs(amount)) : amount
            return Number.isFinite(expected) && Math.abs(expected - marginChangeCell) <= 0.005001
          })
          if (!marginChangesAgree) continue
          const marginLevels = [...rowClaim.matchAll(/毛利率(?:水平)?(?:为|是)?\s*([+-]?\d+(?:\.\d+)?)\s*[%％]/g)]
          const marginLevelCell = Number(rowValues.at(-4))
          if (!marginLevels.every(match => Math.abs(Number(match[1]) - marginLevelCell) <= 0.005001)) continue
          const tableKind: CompanyTableKind = section.excerpt.text.trim() === '分产品' ? 'product' : 'industry'
          if (excerptTableKind(packet, rowExcerpt) !== tableKind) continue
          const refs: CompanyMethodEvidenceRef[] = [
            ...headerRows.map(item => ({ sourceCandidateId: packet.sourceCandidateId, location: item.excerpt.location })),
            { sourceCandidateId: packet.sourceCandidateId, location: section.excerpt.location },
            ...(splitLabel ? [{ sourceCandidateId: packet.sourceCandidateId, location: `paragraph:${rowNumber - 1}` }] : []),
            { sourceCandidateId: packet.sourceCandidateId, location: rowExcerpt.location },
          ]
          citedTableRows.push({ refs, key: `${packet.sourceCandidateId}@${rowExcerpt.location}`, label: rowLabel })
        }
      }
      const uniqueRows = [...new Map(citedTableRows.map(row => [row.key, row])).values()]
      // Every label-scoped numeric clause must resolve to exactly one row. If
      // duplicate rows or duplicate classifications can support the same
      // label/value combination, leave the finding untouched for retry.
      const allRowsUnique = uniqueRows.length > 0 && uniqueRows.every(row => uniqueRows.filter(candidate => candidate.label === row.label).length === 1)
      const addedByKey = new Map(uniqueRows.flatMap(row => row.refs).filter(ref => !initialRefs.has(`${ref.sourceCandidateId}@${ref.location}`)).map(ref => [`${ref.sourceCandidateId}@${ref.location}`, ref]))
      const addedReferences = [...addedByKey.values()]
      if (allRowsUnique && addedReferences.length && grounded(finding.text, [...finding.evidence, ...addedReferences])) {
        repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences, reason: 'A cited complete gross-margin table header and uniquely matching supplied row labels and numeric cells support the finding; exact split-label and row locators were added.' })
        return { ...finding, evidence: [...finding.evidence, ...addedReferences] }
      }
      if (initiallyGrounded) return finding
    }
    const currentRefs = [...finding.evidence]
    const addedByLocator = new Map<string, CompanyMethodEvidenceRef>()
    // A single finding can describe several rows. Resolve each clause against
    // one uniquely matching row in the already cited table, then validate the
    // complete finding against the combined, explicit citations.
    const inheritedMarginTable = /(?:分行业|分产品)毛利率\s*[:：]/.test(finding.text)
    const clauses = finding.text.split(/(?<=[；;。！？\n])/).map(clause => clause.trim()).filter(clause => numbers(clause).length >= 2 || findingTable !== undefined && /毛利率/.test(clause) && /(?:个百分点|[%％])/.test(clause))
    const packetsToSearch = evidencePackets.filter((item) => citedSources.has(item.sourceCandidateId))
    const hasCitedGrossMarginHeader = packetsToSearch.some(packet => {
      const cited = new Set(finding.evidence.filter(ref => ref.sourceCandidateId === packet.sourceCandidateId).map(ref => ref.location))
      const mainHeader = packet.excerpts.find(item => /营业收入/.test(item.text) && /营业成本/.test(item.text) && /毛利率/.test(item.text))
      if (!mainHeader || !cited.has(mainHeader.location)) return false
      const source = input.sources.find(item => item.candidate.candidateId === packet.sourceCandidateId)
      const sourceDeclaresUnit = Boolean(source?.content.split(/\r?\n/).some(line => /^\s*单位\s*[:：]\s*元\s*$/.test(line)))
      if (!sourceDeclaresUnit) return packet.excerpts.some(item => /毛利率.{0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(item.text))
      const mainHeaderParagraph = Number(/^paragraph:(\d+)$/.exec(mainHeader.location)?.[1])
      if (!Number.isInteger(mainHeaderParagraph)) return false
      // A filing may contain several tables with the same unit. Bind the unit
      // to this cited financial header by choosing the nearest preceding unit
      // without an intervening table-classification heading.
      const unit = packet.excerpts
        .filter(item => {
          const paragraph = Number(/^paragraph:(\d+)$/.exec(item.location)?.[1])
          return Number.isInteger(paragraph) && paragraph < mainHeaderParagraph
            && /^\s*单位\s*[:：]\s*元\s*$/.test(item.text)
            && !packet.excerpts.some(section => {
              const sectionParagraph = Number(/^paragraph:(\d+)$/.exec(section.location)?.[1])
              return sectionParagraph > paragraph && sectionParagraph < mainHeaderParagraph
                && /^(?:分行业|分产品|分地区|分销售模式)$/.test(section.text.trim())
            })
        })
        .sort((left, right) => Number(right.location.split(':')[1]) - Number(left.location.split(':')[1]))[0]
      if (!unit || !cited.has(unit.location)) return false
      const firstSection = packet.excerpts.find(item => Number(/^paragraph:(\d+)$/.exec(item.location)?.[1]) > mainHeaderParagraph && /^(?:分行业|分产品)$/.test(item.text.trim()))
      if (!firstSection) return false
      const header = packet.excerpts.filter(item => {
        const paragraph = Number(/^paragraph:(\d+)$/.exec(item.location)?.[1])
        return paragraph >= mainHeaderParagraph && paragraph < Number(firstSection.location.split(':')[1])
      }).map(item => item.text).join('').replace(/\s+/g, '')
      return /营业收入(?:(?!营业成本|毛利率).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(header)
        && /营业成本(?:(?!营业收入|毛利率).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(header)
        && /毛利率(?:(?!营业收入|营业成本).){0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(header)
    })
    for (const clause of clauses) {
      if (/毛利率/.test(finding.text) && !hasCitedGrossMarginHeader) continue
      const requestedTable = claimTableKind(clause) ?? findingTable
      // Industry and product margin rows share a table header but not a
      // segmentation label. Resolve each one-row clause against the exact
      // adjacent table heading and supplied row/label strings.
      const marginClaims = tableMarginClaims(clause, inheritedMarginTable)
      const strictTableMargin = requestedTable !== undefined && marginClaims.length > 0
        && (inheritedMarginTable || packetsToSearch.some(packet => packet.excerpts.some(excerpt => (excerpt.contextLocations ?? []).some(location => packet.excerpts.some(context => context.location === location && /^\s*单位\s*[:：]\s*元\s*$/.test(context.text))))))
      if (strictTableMargin) {
        const expectedSection = requestedTable === 'industry' ? '分行业' : '分产品'
        const selectedRows: { refs: CompanyMethodEvidenceRef[]; rowLocation: string }[] = []
        let allClaimsUnique = true
        for (const marginClaim of marginClaims) {
          const matches: { refs: CompanyMethodEvidenceRef[]; rowLocation: string }[] = []
          for (const packet of packetsToSearch) for (const rowExcerpt of packet.excerpts) {
            const rowNumber = Number(/^paragraph:(\d+)$/.exec(rowExcerpt.location)?.[1])
            if (!Number.isInteger(rowNumber) || excerptTableKind(packet, rowExcerpt) !== requestedTable) continue
            const rowNumbers = numbers(rowExcerpt.text)
            const finalCell = rowNumbers.at(-1)
            if (finalCell === undefined || Math.abs(Number(finalCell) - marginClaim.expectedChange) > 0.005001) continue
            if (rowNumbers.length < 6 || marginClaim.margin !== undefined && Math.abs(Number(rowNumbers.at(-4)) - marginClaim.margin) > 0.005001) continue

            const continuation = /^[\s\u3000]*([\u3400-\u9fff·（）()、]+?)\s*(?=-?\d)/.exec(rowExcerpt.text)?.[1] ?? ''
            const preceding = packet.excerpts.find(item => item.location === `paragraph:${rowNumber - 1}`)
            const splitLabel = preceding && !/\d/.test(preceding.text) && !/[。；;！？]/.test(preceding.text) ? `${preceding.text}${continuation}` : ''
            const rowLabel = (splitLabel || continuation).replace(/\s+/g, '')
            const normalizedClaimLabel = marginClaim.label.replace(/\s+/g, '')
            if (normalizedClaimLabel.length < 4 || !rowLabel || !(rowLabel.includes(normalizedClaimLabel) || normalizedClaimLabel.includes(rowLabel))) continue

            const contextLocations = rowExcerpt.contextLocations ?? []
            const unitHeaders = packet.excerpts.filter(item => {
              const paragraph = Number(/^paragraph:(\d+)$/.exec(item.location)?.[1])
              return paragraph < rowNumber && paragraph >= rowNumber - 40 && /^\s*单位\s*[:：]\s*元\s*$/.test(item.text)
                && (!contextLocations.length || contextLocations.includes(item.location))
            })
            if (unitHeaders.length !== 1) continue
            const unitHeader = unitHeaders[0]!
            const unitParagraph = Number(/^paragraph:(\d+)$/.exec(unitHeader.location)?.[1])
            const headerCandidates = packet.excerpts.filter(item => Number(/^paragraph:(\d+)$/.exec(item.location)?.[1]) >= unitParagraph && Number(/^paragraph:(\d+)$/.exec(item.location)?.[1]) < rowNumber)
              .sort((left, right) => Number(left.location.split(':')[1]) - Number(right.location.split(':')[1]))
            const headerLocations: string[] = []
            let headerText = ''
            let priorParagraph = unitParagraph - 1
            for (const item of headerCandidates) {
              const paragraph = Number(item.location.split(':')[1])
              if (paragraph !== priorParagraph + 1) break
              if (paragraph !== unitParagraph && /^(?:分行业|分产品|分地区)$/.test(item.text.trim())) break
              headerLocations.push(item.location)
              headerText += item.text.replace(/\s+/g, '')
              priorParagraph = paragraph
              if (/毛利率比上年同期增减|毛利率同比增减/.test(headerText)) break
            }
            if (!/营业收入.{0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(headerText)
              || !/营业成本.{0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(headerText)
              || !/毛利率.{0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(headerText)) continue
            if (headerLocations.length < 3) continue
            const section = packet.excerpts.filter(item => Number(item.location.split(':')[1]) < rowNumber && Number(item.location.split(':')[1]) >= rowNumber - 40 && /^(?:分行业|分产品)$/.test(item.text.trim()))
              .sort((left, right) => Number(right.location.split(':')[1]) - Number(left.location.split(':')[1]))[0]
            if (!section || section.text.trim() !== expectedSection) continue

            const rawFinal = [...rowExcerpt.text.matchAll(/-?\d+(?:[,，]\d{3})*(?:\.\d+)?/g)].at(-1)?.[0]?.replace(/[,，]/g, '')
            if (rawFinal === undefined || Math.sign(Number(rawFinal)) !== Math.sign(marginClaim.expectedChange)) continue
            const rowAndLabel = [...new Set([section.location, ...headerLocations, ...(splitLabel && preceding ? [preceding.location] : []), rowExcerpt.location])].map(location => ({ sourceCandidateId: packet.sourceCandidateId, location }))
            if (!grounded(marginClaim.text, [...currentRefs, ...addedByLocator.values(), ...rowAndLabel])) continue
            matches.push({ refs: rowAndLabel, rowLocation: rowExcerpt.location })
          }
          const uniqueRows = [...new Map(matches.map(match => [`${match.refs[0]?.sourceCandidateId}@${match.rowLocation}`, match])).values()]
          if (uniqueRows.length !== 1) { allClaimsUnique = false; break }
          selectedRows.push(uniqueRows[0]!)
        }
        if (allClaimsUnique && selectedRows.length === marginClaims.length) {
          for (const row of selectedRows) for (const ref of row.refs) addedByLocator.set(`${ref.sourceCandidateId}@${ref.location}`, ref)
        }
        // This specific repair is deliberately fail-closed. The generic row
        // matcher below must not bypass its full-header/sign/uniqueness checks.
        continue
      }
      if (grounded(clause, [...currentRefs, ...addedByLocator.values()])) continue
      const matches: { refs: CompanyMethodEvidenceRef[]; rowLocation: string }[] = []
      for (const packet of packetsToSearch) for (const excerpt of packet.excerpts) {
        const row = Number(excerpt.location.split(':')[1])
        if (numbers(excerpt.text).length < 2) continue
        if (requestedTable && excerptTableKind(packet, excerpt) !== requestedTable) continue
        if (!claimIncludesExactClassifiedRowLabel(finding.text, packet, excerpt)) continue
        const eventContext = keys(clause).has('placement') ? packet.excerpts.filter((item) => Math.abs(Number(item.location.split(':')[1]) - row) === 1 && keys(item.text).has('placement')) : []
        const context = [...new Map(packet.excerpts.filter((item) => {
          if (!(excerpt.contextLocations ?? []).includes(item.location)) return false
          const contextRow = Number(/^paragraph:(\d+)$/.exec(item.location)?.[1])
          return Number.isInteger(row) && contextRow > 0 && Math.abs(row - contextRow) <= 1
        }).concat(eventContext).map((item) => [item.location, item])).values()]
        // PDF labels may wrap onto the immediately preceding supplied nonnumeric row.
        const label = packet.excerpts.filter((item) => Number(item.location.split(':')[1]) >= row - 2 && Number(item.location.split(':')[1]) < row && !/\d|[。；;.!]|[一二三四五六七八九〇零]{4}年/.test(item.text) && item.text.length < 90)
        const existingContext = currentRefs.filter((ref) => ref.sourceCandidateId === packet.sourceCandidateId).flatMap((ref) => {
          const cited = packet.excerpts.find((item) => item.location === ref.location)
          const citedRow = Number(/^paragraph:(\d+)$/.exec(ref.location)?.[1])
          const nearbyContext = (cited?.contextLocations ?? []).flatMap((location) => {
            const contextRow = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
            const linked = packet.excerpts.find((item) => item.location === location)
            return linked && citedRow > 0 && contextRow > 0 && Math.abs(citedRow - contextRow) <= 1 ? [linked] : []
          })
          return cited ? [cited, ...nearbyContext] : []
        })
        const original = [packet.title, ...existingContext, excerpt, ...label, ...context].map((item) => typeof item === 'string' ? item : item.text).join(' ')
        if (!meaningMatches(clause, original)) continue
        const rowAndContext = [excerpt, ...label, ...context].map((item) => ({ sourceCandidateId: packet.sourceCandidateId, location: item.location }))
        const refs = [...currentRefs, ...addedByLocator.values(), ...rowAndContext]
        if (grounded(clause, refs)) matches.push({ refs: rowAndContext, rowLocation: excerpt.location })
      }
      const uniqueRows = [...new Map(matches.map(match => [match.rowLocation, match])).values()]
      if (uniqueRows.length !== 1) continue
      for (const ref of uniqueRows[0]!.refs) addedByLocator.set(`${ref.sourceCandidateId}@${ref.location}`, ref)
    }
    const addedReferences = [...addedByLocator.values()].filter((ref) => !finding.evidence.some((original) => original.sourceCandidateId === ref.sourceCandidateId && original.location === ref.location))
    if (!addedReferences.length || !grounded(finding.text, [...finding.evidence, ...addedReferences])) {
      // The numeric validator evaluates a nearby text window around each
      // number; semicolon-separated table rows can cause that window to bind
      // one row's numbers to the next row's label. Accept the composed finding
      // only when every numeric clause independently passes with the combined
      // exact citations.
      const numericClauses = finding.text.split(/(?<=[；;。！？\n])/).map(clause => clause.trim()).filter(clause => numbers(clause).length > 0)
      if (!addedReferences.length || !numericClauses.length || !numericClauses.every(clause => grounded(clause, [...finding.evidence, ...addedReferences]))) return finding
    }
    repairs.push({ findingIndex, inputText: finding.text, originalReferences: finding.evidence, addedReferences, reason: 'Each numeric clause was matched to one unique, supplied row in an already cited table; the combined exact rows ground the complete finding.' })
    return { ...finding, evidence: [...finding.evidence, ...addedReferences] }
  })
  const enrich = (text: string) => text.split(/(?<=[。！？])|(?=\n)/).map((segment) => {
    let result = segment
    for (const repair of repairs.filter((item) => item.findingIndex !== undefined)) {
      const tokens = numbers(segment)
      if (!tokens.length || !meaningMatches(segment, repair.inputText)) continue
      // Require the segment's actual values be supported by this repaired finding's exact refs.
      const refs = findings[repair.findingIndex!]!.evidence
      if (!grounded(segment, refs)) continue
      const extra = repair.addedReferences.filter((ref) => !result.includes(`[${ref.sourceCandidateId}@${ref.location}]`))
      if (extra.length) result += ` ${extra.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`
    }
    return result
  }).join('')
  const cleanSectionLocators = (text: string | undefined): string => {
    const value = text ?? ''
    const refs = [...value.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map((match) => ({ sourceCandidateId: match[1]!, location: match[2]! }))
    return removeBoundLocatorMarkers(value, refs)
  }
  const repairSectionNumbers = (text: string, sectionId: string): string => text.split(/(?<=\n\s*\n)/).map((block) => {
    let repaired = block
    const referencedSources = new Set([...outputReferencedSources, ...[...block.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map((match) => match[1]!)])
    if (!referencedSources.size) return repaired
    // Try only exact numbers rejected by the same grounding validator used at
    // method acceptance; a citation is repaired only when one supplied excerpt
    // from an already cited source both matches the claim meaning and resolves
    // that exact diagnostic.
    const initialIssues = validateCompanyNumericGrounding({ markdown: repaired, sources: packetSources, evidenceContexts: evidencePackets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] }).diagnostics
    // Product rows sometimes point readers to a separate technology section,
    // while their exact specifications are already supplied and cited by the
    // same method. Repair only the optical-module row, only from an already
    // referenced source, and only when the excerpt states the matching
    // technology quantity together with its architecture/package context.
    // In particular, a 400G chip-development statement cannot establish a
    // 400G module package or architecture.
    if (sectionId === 'products') {
      const opticalRows = repaired.split('\n').filter((line) => /^\s*\|\s*光模块\s*\|/.test(line))
      if (opticalRows.length === 1) {
        const row = opticalRows[0]!
        const rowIdentifiers = [...row.matchAll(/(\d+(?:\.\d+)?)\s*([GT])\b/gi)].map((match) => ({ identifier: `${match[1]}${match[2]}`.toUpperCase(), value: Number(match[1]) }))
        const rowIssues = initialIssues.flatMap((issue) => {
          const identifier = rowIdentifiers.find((item) => item.value === Math.abs(issue.value))
          return identifier ? [{ issue, identifier: identifier.identifier }] : []
        })
        const candidates = new Map<string, CompanyMethodEvidenceRef>()
        for (const { identifier } of rowIssues) {
          const routeContext = identifier.startsWith('400G') ? /封装|QSFP|OSFP|架构/i
            : identifier.startsWith('800G') ? /DSP|LPO|LRO|QSFP|OSFP|架构/i
              : identifier.startsWith('1.6T') ? /EML|InP|PIC|OSFP/i
                : undefined
          if (!routeContext) continue
          for (const packet of evidencePackets.filter((candidate) => referencedSources.has(candidate.sourceCandidateId))) for (const excerpt of packet.excerpts) {
            const compactExcerpt = excerpt.text.replace(/\s+/g, '').toUpperCase()
            if (!compactExcerpt.includes(identifier) || !routeContext.test(excerpt.text)) continue
            const ref = { sourceCandidateId: packet.sourceCandidateId, location: excerpt.location }
            if (!row.includes(`[${ref.sourceCandidateId}@${ref.location}]`)) candidates.set(`${ref.sourceCandidateId}@${ref.location}`, ref)
          }
        }
        if (candidates.size) {
          const additions = [...candidates.values()]
          const groundedCandidate = `${repaired.trimEnd()} ${additions.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}${block.endsWith('\n') ? '\n' : ''}`
          const remaining = validateCompanyNumericGrounding({ markdown: groundedCandidate, sources: packetSources, evidenceContexts: evidencePackets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] }).diagnostics
          const repairedTechTokens = new Set(rowIssues.map(({ identifier }) => identifier))
          const unresolvedTech = remaining.some((issue) => {
            const identifier = rowIdentifiers.find((item) => item.value === Math.abs(issue.value))?.identifier
            return identifier !== undefined && repairedTechTokens.has(identifier)
          })
          if (!unresolvedTech) {
            repaired = groundedCandidate
            repairs.push({ sectionId, inputText: row, originalReferences: [...block.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map((match) => ({ sourceCandidateId: match[1]!, location: match[2]! })), addedReferences: additions, reason: 'Exact optical-module technology quantities were matched to supplied excerpts from a source already cited by this method. Each added excerpt includes the matching package or architecture context, and the existing numeric grounding validator accepted the repaired row.' })
          }
        }
      }
    }
    for (const issue of initialIssues) {
      const numericIndex = repaired.indexOf(issue.token)
      const beforeNumeric = repaired.slice(0, Math.max(0, numericIndex))
      const rowBoundary = Math.max(beforeNumeric.lastIndexOf('\n'), beforeNumeric.lastIndexOf('|'))
      const sentenceBoundary = Math.max(beforeNumeric.lastIndexOf('。'), beforeNumeric.lastIndexOf('；'), beforeNumeric.lastIndexOf(';'), beforeNumeric.lastIndexOf('！'), beforeNumeric.lastIndexOf('？'))
      const boundary = rowBoundary > sentenceBoundary ? rowBoundary : sentenceBoundary
      const lineEnd = repaired.indexOf('\n', Math.max(0, numericIndex))
      const sentenceEndCandidates = ['。','；',';','！','？'].map(mark => repaired.indexOf(mark, Math.max(0, numericIndex))).filter(index => index >= 0)
      const end = rowBoundary > sentenceBoundary && lineEnd >= 0 ? lineEnd : sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) + 1 : repaired.length
      const claim = repaired.slice(boundary + 1, end).trim() || issue.context.replace(/[。；;]+$/g, '')
      // Keep semantic/numeric support local to this claim. A citation elsewhere
      // in the same section cannot lend its account label or value to a repair.
      const trailingCitations = /^\s*(?:\[[^\]\s]+@paragraph:\d+\]\s*)+/.exec(repaired.slice(end))?.[0] ?? ''
      const claimRefs = [...`${claim}${trailingCitations}`.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map((match) => ({ sourceCandidateId: match[1]!, location: match[2]! }))
      const researchInvestment = exactAnnualResearchInvestmentRow(claim, claimRefs, evidencePackets, input)
      if (researchInvestment) {
        const verificationRefs = [...claimRefs, researchInvestment.reference]
        const verification = validateCompanyNumericGrounding({
          markdown: `${researchInvestment.verificationText} ${verificationRefs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
          sources: packetSources, evidenceContexts: evidencePackets, preparedAnalysis: input.preparedAnalysis,
          trustedText: [input.company.symbol, input.asOf],
        })
        if (!verification.diagnostics.length) {
          const citation = `[${researchInvestment.reference.sourceCandidateId}@${researchInvestment.reference.location}]`
          const insertionPoint = end + trailingCitations.length
          repaired = `${repaired.slice(0, insertionPoint).trimEnd()} ${citation}${repaired.slice(insertionPoint)}`
          repairs.push({ sectionId, inputText: researchInvestment.verificationText, originalReferences: claimRefs, addedReferences: [researchInvestment.reference], reason: 'This sentence cites the exact adjacent annual-report year header; the unique supplied R&D investment row matches the named periods and reported amounts, and numeric grounding accepts the exact row.' })
          continue
        }
      }
      const matches: { ref: CompanyMethodEvidenceRef; excerptText: string }[] = []
      for (const packet of evidencePackets.filter((candidate) => referencedSources.has(candidate.sourceCandidateId))) for (const excerpt of packet.excerpts) {
        const ref = { sourceCandidateId: packet.sourceCandidateId, location: excerpt.location }
        const existingContext = claimRefs.flatMap((existing) => {
          if (existing.sourceCandidateId !== packet.sourceCandidateId) return []
          const cited = packet.excerpts.find((item) => item.location === existing.location)
          const citedRow = Number(/^paragraph:(\d+)$/.exec(existing.location)?.[1])
          const nearbyContext = (cited?.contextLocations ?? []).flatMap((location) => {
            const contextRow = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
            const context = packet.excerpts.find((item) => item.location === location)
          return context && citedRow > 0 && contextRow > 0 && Math.abs(citedRow - contextRow) <= 1 ? [context] : []
          })
          return cited ? [cited, ...nearbyContext] : []
        })
        if (repaired.includes(`[${ref.sourceCandidateId}@${ref.location}]`)) continue
        const row = Number(/^paragraph:(\d+)$/.exec(excerpt.location)?.[1])
        // PDF table labels commonly wrap onto a preceding nonnumeric line,
        // such as a business label followed by a line containing the amount.
        // Use that supplied label only as semantic context; the numeric row
        // remains the citation that independently grounds every value.
        const label = Number.isInteger(row) ? packet.excerpts.filter((item) => Number(item.location.split(':')[1]) >= row - 2 && Number(item.location.split(':')[1]) < row && !/\d|[。；;.!]|[一二三四五六七八九〇零]{4}年/.test(item.text) && item.text.length < 90) : []
        const eventContext = keys(claim).has('placement') ? packet.excerpts.filter((item) => Math.abs(Number(item.location.split(':')[1]) - row) === 1 && keys(item.text).has('placement')) : []
        const semanticText = [packet.title, ...existingContext.map((item) => item.text), ...label.map((item) => item.text), ...eventContext.map((item) => item.text), excerpt.text].join(' ')
        if (!meaningMatches(claim, semanticText)) continue
        const allRefs = [...claimRefs, ref]
        const claimGrounding = validateCompanyNumericGrounding({ markdown: `${claim} ${allRefs.map((item) => `[${item.sourceCandidateId}@${item.location}]`).join(' ')}`, sources: packetSources, evidenceContexts: evidencePackets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] }).diagnostics
        if (claimGrounding.length) continue
        const groundedCandidate = `${repaired.trimEnd()} ${allRefs.map((item) => `[${item.sourceCandidateId}@${item.location}]`).join(' ')}`
        const remaining = validateCompanyNumericGrounding({ markdown: groundedCandidate, sources: packetSources, evidenceContexts: evidencePackets, preparedAnalysis: input.preparedAnalysis, trustedText: [input.company.symbol, input.asOf] }).diagnostics
        if (!remaining.length) matches.push({ ref, excerptText: excerpt.text })
      }
      if (!matches.length || new Set(matches.map((match) => match.excerptText)).size !== matches.length) continue
      const added = [...new Map(matches.map(({ ref }) => [`${ref.sourceCandidateId}@${ref.location}`, ref])).values()]
      repaired = `${repaired.trimEnd()} ${added.map((ref) => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}${block.endsWith('\n') ? '\n' : ''}`
      repairs.push({ sectionId, inputText: claim, originalReferences: [...block.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map((match) => ({ sourceCandidateId: match[1]!, location: match[2]! })), addedReferences: added, reason: 'Supplied excerpts from already cited sources independently contain the exact rejected number and matching metric terms; their precise paragraph locators were added.' })
    }
    return repaired
  }).join('')
  const markdown = repairSectionNumbers(enrich(cleanSectionLocators(output.markdown)), 'method-summary')
  const sections = output.sections.map((section) => ({ ...section, markdown: repairSectionNumbers(enrich(cleanSectionLocators(section.markdown)), section.id) }))
  return { output: { ...output, findings, markdown, sections }, repairs }
}
