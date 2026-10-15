import type { CompanyResearchInput } from './contracts.ts'
type NormalizedResearchSource = CompanyResearchInput['sources'][number]

export interface NumericGroundingDiagnostic { readonly code: 'UNSUPPORTED_NUMBER'; readonly token: string; readonly value: number; readonly context: string; readonly reason: string }
export interface NumericGroundingInput {
  readonly markdown: string
  readonly sources: readonly NormalizedResearchSource[]
  readonly preparedAnalysis?: unknown
  /** Explicit workflow identity/cutoff strings, never model-created narrative. */
  readonly trustedText?: readonly string[]
}
interface NumericToken { readonly token: string; readonly value: number; readonly rawValue: number; readonly magnitude: boolean; readonly decimals: number; readonly index: number }
const multipliers: Readonly<Record<string, number>> = { 万亿: 1e12, 亿元: 1e8, 亿: 1e8, 万元: 1e4, 万: 1e4, 千: 1e3, 百万: 1e6, billion: 1e9, million: 1e6, trillion: 1e12 }

function numericTokens(text: string): NumericToken[] {
  text = normalizeChineseDates(text)
  return [...text.matchAll(/(?<![\w.])-?\d+(?:[,，]\d{3})*(?:\.\d+)?\s*(?:万亿|亿元|百万元|百万|万元|亿|万|千|trillion|billion|million)?/gi)].flatMap((match) => {
    const token = match[0].trim()
    const components = /^(-?[\d,，]+(?:\.\d+)?)\s*(.*)$/.exec(token)!
    let rawValue = Number(components[1]!.replace(/[,，]/g, ''))
    const after = text.slice((match.index ?? 0) + match[0].length)
    const datePart = /^(?:年|月|日)/.test(after) || /^\d{4}$/.test(components[1]!) && /^-\d{2}(?:-\d{2})?/.test(after)
    if (rawValue >= 0 && !datePart && directionBefore(text, match.index ?? 0) === -1) rawValue = -rawValue
    const suffix = components[2]!.toLowerCase().replace('百万元', '百万')
    const multiplier = suffix ? multipliers[suffix] : 1
    const value = rawValue * (multiplier ?? 1)
    if (!Number.isFinite(value)) return []
    return [{ token, value, rawValue, magnitude: Boolean(suffix), decimals: components[1]!.split('.')[1]?.length ?? 0, index: match.index ?? 0 }]
  })
}
function directionBefore(text: string, index: number): -1 | 1 {
  const before = text.slice(Math.max(0, index - 24), index).split(/[。；;，,\n|]/).at(-1) ?? ''
  if (/(?<!非|正)负\s*$/.test(before)) return -1
  if (/(?:下降|减少|下滑|降)(?:至|到)\s*(?:约|大约)?\s*$/.test(before)) return 1
  const direction = [...before.matchAll(/下降|减少|下滑|净流出|净减少|增长|增加|上升|净流入|降(?=\s*$)/g)].at(-1)
  // A completed amount/percentage ends the direction's scope, even without punctuation.
  if (direction && /\d/.test(before.slice(direction.index! + direction[0].length))) {
    const remaining = before.slice(direction.index! + direction[0].length)
    // A conjunction-only numeric list still shares its explicit direction:
    // "分别下降1.82和2.06个百分点". Completed units or new prose end it.
    if (!/^\s*(?:约)?-?[\d,，]+(?:\.\d+)?(?:\s*(?:和|及|、)\s*-?[\d,，]+(?:\.\d+)?)*\s*(?:和|及|、)\s*$/.test(remaining)) return 1
  }
  return direction && /下降|减少|下滑|净流出|净减少|^降$/.test(direction[0]) ? -1 : 1
}
function normalizeChineseDates(text: string): string {
  const digits: Readonly<Record<string, string>> = { 零: '0', 〇: '0', '○': '0', 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }
  return text.replace(/[零〇○一二三四五六七八九]{4}(?=年)/g, (year) => [...year].map((digit) => digits[digit]).join('')).replace(/([一二三四五六七八九十]{1,3})(?=月|日)/g, (value) => { if (!value.includes('十')) return digits[value] ?? value; const [tens, ones] = value.split('十'); return String(Number(tens ? digits[tens] : 1) * 10 + Number(ones ? digits[ones] : 0)) })
}
function trustedNumbers(value: unknown, output: number[], seen = new Set<object>()): void {
  if (typeof value === 'number' && Number.isFinite(value)) { output.push(value); return }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) for (const item of value) trustedNumbers(item, output, seen)
  else for (const item of Object.values(value)) trustedNumbers(item, output, seen)
}

function citedPublicationYears(source: NormalizedResearchSource): readonly string[] {
  const metadata = source.candidate.metadata
  const years: string[] = []
  for (const date of [source.candidate.publishedAt, metadata?.observedPublicationDate]) if (typeof date === 'string' && /^((?:19|20)\d{2})-(\d{2})-(\d{2})(?:$|T| )/.test(date)) {
    const day = date.slice(0, 10)
    const timestamp = Date.parse(`${day}T00:00:00Z`)
    if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(date))) years.push(day.slice(0, 4))
  }
  const historical = metadata?.historicalSourceContext
  if (historical && typeof historical === 'object') {
    const { observedYear, basis } = historical as Record<string, unknown>
    if ((basis === 'fetched_html_publication_meta' || basis === 'explicit_title_year') && typeof observedYear === 'number' && Number.isInteger(observedYear) && observedYear >= 1900 && observedYear <= 2099) years.push(String(observedYear))
  }
  return years
}

/** Only a declared unit for this table/column may scale a bare monetary cell. */
function declaredTableUnit(text: string, token: NumericToken): string | null | undefined {
  const start = text.lastIndexOf('\n', token.index) + 1
  const end = text.indexOf('\n', token.index)
  const line = text.slice(start, end < 0 ? undefined : end)
  if (!/^\s*\|/.test(line)) return undefined
  const separatorPattern = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/
  const nextLine = end < 0 ? '' : text.slice(end + 1).split('\n')[0] ?? ''
  // A unit-bearing label in the header describes data cells, never its period labels.
  if (separatorPattern.test(nextLine)) return null
  const column = text.slice(start, token.index).split('|').length - 2
  if (column < 1) return undefined
  const before = text.slice(0, start).split('\n')
  let headerIndex = before.length - 2
  while (headerIndex >= 0 && /^\s*\|/.test(before[headerIndex]!)) headerIndex -= 1
  const header = before[headerIndex + 1]
  const separator = before[headerIndex + 2]
  if (!header || !separator || !separatorPattern.test(separator)) return undefined
  const cells = header.split('|').slice(1, -1).map(cell => cell.trim())
  const label = cells[column] ?? ''
  const rowLabel = line.split('|')[1] ?? ''
  const monetary = /收入|利润|现金|资产|负债|借款|债券|支出|费用|金额|资本开支|研发投入|应收|存货|余额|成本|revenue|income|cash|amount/i
  const nonMonetary = /同比|环比|增长|增速|占比|比重|率|比例|百分|百分点|[%％]|倍数|天数|日期|数量|销量|产量|单价|每股|EPS/i
  const after = text.slice(token.index + token.token.length, token.index + token.token.length + 12).trimStart()
  const cellStart = line.lastIndexOf('|', token.index - start) + 1
  const cellEnd = line.indexOf('|', token.index - start)
  const beforeInCell = line.slice(cellStart, token.index - start)
  const afterInCell = line.slice(token.index - start + token.token.length, cellEnd < 0 ? undefined : cellEnd)
  // "收入/毛利率" may explicitly contain one monetary amount followed by a percentage.
  // Only its first bare amount inherits currency; the percent component never does.
  const mixedAmount = monetary.test(label) && !beforeInCell.trim() && /^\s*(?:\/|[；;])\s*[-+]?[\d,，]+(?:\.\d+)?\s*[%％](?:\s*\*?\s*)$/.test(afterInCell)
  if (nonMonetary.test(label) && !mixedAmount || /^[%％]|^个?百分点|^[倍天年月日]/.test(after)) return null
  if (!monetary.test(label) && !(monetary.test(rowLabel) && /^(?:本期|上期|期末|期初|(?:19|20)\d{2}(?:年|[-/\d年月日上中下半季度末初\s])*)$/.test(label))) return undefined
  const ownUnit = label.match(/[（(]\s*(?:人民币\s*)?(亿元|万元|元)\s*[）)]/)?.[1]
  if (ownUnit) return ownUnit
  const headerUnit = cells[0]?.match(/[（(]\s*(?:人民币\s*)?(亿元|万元|元)\s*[）)]/)?.[1]
  if (headerUnit) return headerUnit
  let contextIndex = headerIndex
  while (contextIndex >= 0 && !before[contextIndex]!.trim()) contextIndex -= 1
  const declaration = before[contextIndex] ?? ''
  // A nearest heading/paragraph is the boundary: no unit leaks from an older table.
  return declaration.match(/(?:人民币\s*|(?:金额|单位)\s*(?:单位)?\s*(?:为|[:：])?\s*|[（(]\s*)(亿元|万元|元)(?=[）)\s*。；;，,]|$)/)?.[1]
}

/** Conservative numeric novelty guard, not a proof of semantic entailment or correct accounting scope. */
export function validateCompanyNumericGrounding(input: NumericGroundingInput): { readonly status: 'grounded' | 'unsupported_numbers'; readonly diagnostics: readonly NumericGroundingDiagnostic[] } {
  const sourceMap = new Map(input.sources.map((source) => [source.candidate.candidateId, source]))
  const citedText: string[] = []
  for (const match of input.markdown.matchAll(/\[([^\]\s]+)@paragraph:(\d+)\]/g)) {
    const source = sourceMap.get(match[1]!)
    const paragraph = source?.content.split(/\r?\n/)[Number(match[2]) - 1]
    if (paragraph !== undefined) citedText.push(paragraph)
    // Report title supplies its declared reporting period, not operating quantities in unrelated paragraphs.
    if (source && paragraph !== undefined) citedText.push(...(source.title.match(/(?:19|20)\d{2}(?=\s*年|年度|\s*annual)/gi) ?? []), ...citedPublicationYears(source))
  }
  // Without a locator no entire-document number pool is admitted.
  const sourceTokens = numericTokens([...citedText, ...(input.trustedText ?? [])].join('\n'))
  const calculated: number[] = []
  trustedNumbers(input.preparedAnalysis, calculated)
  const markdown = input.markdown
    .replace(/\[[^\]\s]+@[^\]]+\]/g, '')
    .replace(/\[[^\]]*\]\([^)]*\)/g, (link) => link.replace(/\]\([^)]*\)/, ']'))
    .replace(/^\s*(?:#{1,6}\s+)?\d+[.、)]\s*/gm, '')
  const normalizedMarkdown = normalizeChineseDates(markdown)
  const diagnostics: NumericGroundingDiagnostic[] = []
  for (const candidate of numericTokens(normalizedMarkdown)) {
    // Fixed editorial cadence/ordinal labels are instructions, not observed company quantities.
    const context = normalizedMarkdown.slice(Math.max(0, candidate.index - 35), candidate.index + candidate.token.length + 45)
    const before = normalizedMarkdown.slice(Math.max(0, candidate.index - 8), candidate.index)
    const after = normalizedMarkdown.slice(candidate.index + candidate.token.length, candidate.index + candidate.token.length + 15).trimStart()
    if (/第\s*$/.test(before) && /^[阶段项条节类次]/.test(after)) continue
    if (/^[、.：:)]/.test(after) && /(?:^|\n|\|)\s*$/.test(before)) continue
    if (/^[次个月周天日季度年]/.test(after) && /每|频率|监控|观察|建议/.test(context) && candidate.rawValue <= 12 && !candidate.magnitude) continue
    // A paired amount in one table cell may share an explicit trailing monetary unit (373 / 447亿元).
    const tailInCell = normalizedMarkdown.slice(candidate.index + candidate.token.length).split(/[|\n]/)[0]?.slice(0, 45) ?? ''
    const sharedUnit = !candidate.magnitude ? /^\s*\/\s*-?[\d,，.]+\s*(亿元|万元|万亿|亿|万)(?:元)?\s*$/.exec(tailInCell)?.[1]
      // A pure numeric enumeration can state its monetary unit once after the last item.
      // Intervening prose, percentage markers or a new clause terminate that scope.
      ?? /^\s*(?:、\s*-?[\d,，]+(?:\.\d+)?\s*)+(亿元|万元|万亿|亿|万)(?:元)?(?=\s*(?:[；;。。，,）)]|$))/.exec(tailInCell)?.[1] : undefined
    const rowStart = normalizedMarkdown.lastIndexOf('\n', candidate.index) + 1
    const rowPrefix = normalizedMarkdown.slice(rowStart, candidate.index)
    const explicitRowUnit = /^\s*\|[^|]*[（(](亿元|万元|元)[）)]\s*\|/.exec(rowPrefix)?.[1]
    const tableUnit = !candidate.magnitude ? declaredTableUnit(normalizedMarkdown, candidate) : undefined
    const rowUnit = !candidate.magnitude && tableUnit !== null && !/^[%％]|^个?百分点|^[倍天年月日]/.test(after) ? explicitRowUnit ?? tableUnit : undefined
    const sharedMultiplier = sharedUnit ? multipliers[sharedUnit] ?? 1 : rowUnit ? multipliers[rowUnit] ?? 1 : 1
    const value = candidate.value * sharedMultiplier
    const rounding = 0.5 * 10 ** -candidate.decimals * (candidate.magnitude ? Math.abs(candidate.value / (candidate.rawValue || 1)) : sharedMultiplier)
    const rounded = (number: number): boolean => Math.abs(number - value) <= Math.max(Math.abs(number) * 1e-10, rounding * 1.0001)
    const sourceMatch = sourceTokens.some((source) => candidate.magnitude || sharedUnit || rowUnit ? close(source.value, value, 1e-10) || rounded(source.value) : close(source.rawValue, candidate.rawValue, 1e-10) || close(source.value, value, 1e-10) || candidate.decimals > 0 && rounded(source.rawValue))
    const percentage = /^[%％]/.test(after)
    const computedMatch = calculated.some((number) => rounded(number) || percentage && rounded(number * 100))
    if (!sourceMatch && !computedMatch) diagnostics.push({ code: 'UNSUPPORTED_NUMBER', token: candidate.token, value: candidate.value, context: context.trim(), reason: 'Number absent from cited paragraphs, trusted identity/cutoff, and deterministic prepared calculations.' })
  }
  return { status: diagnostics.length ? 'unsupported_numbers' : 'grounded', diagnostics }
}
function close(a: number, b: number, relative: number): boolean { return Math.abs(a - b) <= Math.max(1e-12, Math.max(Math.abs(a), Math.abs(b)) * relative) }
