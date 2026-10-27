import type { CompanyResearchInput } from './contracts.ts'
type NormalizedResearchSource = CompanyResearchInput['sources'][number]

export interface NumericGroundingDiagnostic { readonly code: 'UNSUPPORTED_NUMBER'; readonly token: string; readonly value: number; readonly context: string; readonly reason: string }
export interface NumericGroundingInput {
  readonly markdown: string
  readonly sources: readonly NormalizedResearchSource[]
  readonly preparedAnalysis?: unknown
  /** Actual supplied excerpts; context references alone never admit unprovided text. */
  readonly evidenceContexts?: readonly {readonly sourceCandidateId:string;readonly excerpts:readonly {readonly location:string;readonly text:string;readonly contextLocations?:readonly string[]}[]}[]
  /** Explicit workflow identity/cutoff strings, never model-created narrative. */
  readonly trustedText?: readonly string[]
}

/** Exact periods emitted by deterministic, source-backed financial preparation. */
export function companyPreparedFinancialDateText(preparedAnalysis: unknown): readonly string[] {
  if (!preparedAnalysis || typeof preparedAnalysis !== 'object') return []
  const financial = (preparedAnalysis as Record<string, unknown>).financial
  if (!financial || typeof financial !== 'object') return []
  const periods = new Set<string>()
  const visit = (value: unknown, depth: number): void => {
    if (depth > 5 || !value || typeof value !== 'object') return
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return }
    for (const [key, item] of Object.entries(value)) {
      if (['period', 'periodEnd', 'currentPeriod', 'priorPeriod'].includes(key) && typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item)) periods.add(item)
      else if (item && typeof item === 'object') visit(item, depth + 1)
    }
  }
  visit(financial, 0)
  return [...periods]
}
interface NumericToken { readonly token: string; readonly value: number; readonly rawValue: number; readonly magnitude: boolean; readonly decimals: number; readonly index: number; readonly technologyUnit?: string; readonly rateUnit?: 'percent' | 'percentage_points'; readonly currencyScale?: number; readonly sourceCandidateId?: string }
const multipliers: Readonly<Record<string, number>> = { 万亿: 1e12, 亿元: 1e8, 亿: 1e8, 百万元: 1e6, 万元: 1e4, 万: 1e4, 千元: 1e3, 元: 1, 千: 1e3, 百万: 1e6, billion: 1e9, million: 1e6, trillion: 1e12 }
const monetaryScales: Readonly<Record<string, number>> = { 元: 1, 千元: 1e3, 万元: 1e4, 百万元: 1e6, 亿元: 1e8, 万亿: 1e12, 亿: 1e8, 万: 1e4 }

function numericTokens(text: string): NumericToken[] {
  // Arithmetic context never crosses a Markdown cell (or a line). In
  // particular, a negative result in the next cell is not a second operand.
  const arithmeticContext = (original: string, offset: number, width: number, afterWidth = width) => {
    const start = Math.max(original.lastIndexOf('|', offset - 1), original.lastIndexOf('\n', offset - 1)) + 1
    const boundaries = [original.indexOf('|', offset + 1), original.indexOf('\n', offset + 1)].filter(index => index >= 0)
    const end = Math.min(original.length, ...boundaries)
    return { before: original.slice(Math.max(start, offset - width), offset), after: original.slice(offset + 1, Math.min(end, offset + afterWidth)) }
  }
  const unitBearingFormulaOperator = (original: string, offset: number): boolean => {
    const { before, after } = arithmeticContext(original, offset, 100, 48)
    const formula = before.slice(Math.max(before.lastIndexOf('。'), before.lastIndexOf('；'), before.lastIndexOf(';'), before.lastIndexOf('\n')) + 1)
    const unit = '(?:天|万亿|亿元|百万元|万元|元)'
    const hasPriorEquation = /[=＝]/.test(formula) && new RegExp(`\\d+(?:\\.\\d+)?\\s*${unit}[+＋]\\s*\\d+(?:\\.\\d+)?\\s*${unit}$`).test(before)
    const hasFollowingEquation = new RegExp(`\\d+(?:\\.\\d+)?\\s*${unit}\\s*[=＝]`).test(after)
    // A generated explanation may put account labels between each operand and
    // the arithmetic operator: "373亿元经营现金流−447亿元资本开支＝-74亿元".
    const hasLabeledFollowingEquation = new RegExp(`[\\s\\S]*?\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${unit}\\s*[\\u3400-\\u9fff]{0,16}$`).test(before)
      && new RegExp(`^\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${unit}\\s*[\\u3400-\\u9fff]{0,16}\\s*[=＝]`).test(after)
    // A prose calculation can state the result first and then give the operands:
    // "差额为-73.68亿元，计算为373.35亿元−447.03亿元". The earlier negative
    // result must not turn the second operand into a negative amount.
    const narrativeCalculation = /(?:计算为|公式(?:为|[:：])|依据为)[^。；;\n]*$/.test(before)
      && new RegExp(`\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${unit}$`).test(before)
      && new RegExp(`^\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${unit}`).test(after)
    // Parenthesized financial ratios may subtract two unit-bearing operands
    // before dividing (e.g. (29.57亿元-23.84亿元)÷平均总资产). The minus is
    // an operator here, not the sign of the second input amount.
    const parenthesizedArithmetic = /[（(][^()]{0,80}$/.test(before)
      && new RegExp(`^\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${unit}[）)]\\s*(?:÷|/|×|\\*|=|＝)`).test(after)
    const textualFormula = !/[=＝]\s*$/.test(before) && /(?:公式|自由现金流|简化现金流|FCF).{0,55}\d[\d,，]*(?:\.\d+)?\s*(?:万亿|亿元|百万元|万元|元|天).{0,30}$/.test(formula) && /^\d+(?:\.\d+)?\s*(?:万亿|亿元|百万元|万元|元|天)/.test(after)
    // A table may put A−B in one cell and its result in the next. The
    // complete unit-bearing pair is mathematical subtraction even when a
    // semicolon separated it from the row's FCF label. Unary cell-start
    // negatives cannot match the required left operand.
    const tableLine = original.slice(original.lastIndexOf('\n', offset - 1) + 1, original.indexOf('\n', offset) < 0 ? undefined : original.indexOf('\n', offset))
    const completeTablePair = /^\s*\|/.test(tableLine)
      && new RegExp(`\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${unit}\\s*$`).test(before)
      && new RegExp(`^\\d+(?:[,，]\\d{3})*(?:\\.\\d+)?\\s*${unit}\\s*$`).test(after)
    return completeTablePair || new RegExp(`${unit}$`).test(before) && (hasPriorEquation || hasFollowingEquation || narrativeCalculation || parenthesizedArithmetic) || hasLabeledFollowingEquation || textualFormula
  }
  // Normalize the common mathematical minus glyph without changing UTF-16 offsets.
  // Do not let a punctuation separator after an ISO date join its final day
  // with the next period quantity ("2026-06-30，181天" is two values, not 30,181).
  text = text.replace(/((?:19|20)\d{2}-\d{2}-\d{2})[，,](?=\s*\d)/g, '$1；')
  text = text.replace(/−/g, (_sign, offset, original: string) => {
    const before = original.slice(0, offset)
    if (/(?:=|＝|等于)\s*(?:人民币|RMB|CNY)\s*$/.test(before)) return '-'
    if (/[\d.%)]$/.test(before)) return ' '
    return unitBearingFormulaOperator(original, offset) ? ' ' : '-'
  })
  // An ASCII minus immediately after a percentage is an arithmetic operator,
  // not the sign of the following value (e.g. 76.57%-63.95%). Keep spaced
  // negative values and date separators such as 2025-06-30 intact.
  // A subtraction between two ISO period labels is also a date-range
  // separator, not a negative year operand (e.g. 2026-06-30收入−2025-06-30收入).
  text = text.replace(/((?:19|20)\d{2}-\d{2}-\d{2}[^−\-；;。！？\n|]{0,64})[−-](?=(?:19|20)\d{2}-\d{2}-\d{2})/g, '$1 ')
  text = text.replace(/-(?=\d)/g, (sign, offset, original: string) => {
    const { before, after } = arithmeticContext(original, offset, 8, 55)
    if (!before.trim()) return sign
    if (/(?:=|＝|等于)\s*(?:人民币|RMB|CNY)\s*$/.test(before)) return sign
    // A minus after an explicit result cue is the result sign, not an operator.
    if (/(?:计算为|结果为|等于|＝|即|得)\s*$/.test(before)) return sign
    // In a formula like "本期值−2025年同期可比期", the minus separates
    // the two period labels; a calendar year cannot be a negative operand.
    if (/^(?:19|20)\d{2}年/.test(original.slice(offset + 1))) return ' '
    // Model prose sometimes inserts an account label between formula operands
    // ("373亿元经营现金流−447亿元资本开支＝-74亿元"). The following
    // labeled amount before an equality is still a positive operand.
    if (/^\d+(?:[,，]\d{3})*(?:\.\d+)?\s*(?:亿元|万元|元)\s*[\u3400-\u9fff]{0,16}\s*[=＝]/.test(after)) return ' '
    if (/[%％]$/.test(before)) return ' '
    return unitBearingFormulaOperator(original, offset) ? ' ' : sign
  })
  text = normalizeChineseDates(text)
  // Preserve offsets while allowing an explicit currency marker between the
  // negative word and amount, including ASCII markers without a separating space.
  text = text.replace(/(?<!非|正)负(?:数)?\s*(人民币|CNY|RMB)\s*(?=\d)/gi, (match, currency: string) => match.replace(currency, ' '.repeat(currency.length)))
  // Preserve an explicitly negative result when the currency marker follows
  // its sign ("为−人民币73.68亿元" or "＝-人民币73.68亿元"). Restrict this to
  // explicit result cues so a subtraction operand "−人民币447亿元" stays positive.
  text = text.replace(/(＝|=|等于|为|是)\s*-(?:人民币|CNY|RMB)\s*(?=\d)/gi, '$1-')
  return [...text.matchAll(/(?<![\w.])-?\d+(?:[,，]\d{3})*(?:\.\d+)?\s*(?:万亿|亿元|百万元|百万|万元|千元|元|亿|万|千|trillion|billion|million)?|(?<=\b(?:QSFP-DD|OSFP|QSFP|DD))\d+(?:\.\d+)?(?=\s*(?:Gbps|Tbps|G|T)(?=$|[^A-Za-z0-9]|(?<=G)PAM4(?:EML)?(?![A-Za-z0-9])|(?<=G)EML(?![A-Za-z0-9])))/gi)].flatMap((match) => {
    const token = match[0].trim()
    const components = /^(-?[\d,，]+(?:\.\d+)?)\s*(.*)$/.exec(token)!
    let rawValue = Number(components[1]!.replace(/[,，]/g, ''))
    // A price-range hyphen joins two positive endpoints; it is not a signed
    // financial amount. Require an explicit range/price label and the same
    // adjacent monetary unit, so subtraction and standalone negatives retain signs.
    if (rawValue < 0 && /^(?:万元|亿元|元)$/.test(components[2]!)) {
      const prefix=text.slice(Math.max(0,(match.index??0)-80),match.index)
      const lower=/(?:售价(?:区间)?|价格(?:区间)?|报价(?:区间)?|区间|范围)(?:为|是|在|约|[:：])?\s*([\d,，]+(?:\.\d+)?)\s*(万元|亿元|元)$/.exec(prefix)
      if(lower && lower[2]===components[2] && Number(lower[1]!.replace(/[,，]/g,''))<=Math.abs(rawValue)) rawValue=Math.abs(rawValue)
    }
    const after = text.slice((match.index ?? 0) + match[0].length)
    // PDF text may collapse standard modulation/component labels, e.g.
    // "100GPAM4EML". Only these explicit labels can replace the unit boundary.
    const technologyUnit = !components[2] ? /^(?:Gbps|Tbps|G|T)(?=$|[^A-Za-z0-9]|(?<=G)PAM4(?:EML)?(?![A-Za-z0-9])|(?<=G)EML(?![A-Za-z0-9]))/i.exec(after.trimStart())?.[0].toUpperCase() : undefined
    const datePart = /^(?:年|月|日)/.test(after) || /^\d{4}$/.test(components[1]!) && /^-\d{2}(?:-\d{2})?/.test(after)
    if (rawValue >= 0 && !datePart && directionBefore(text, match.index ?? 0) === -1) rawValue = -rawValue
    const suffix = components[2]!.toLowerCase()
    const multiplier = suffix ? multipliers[suffix] : 1
    const value = rawValue * (multiplier ?? 1)
    if (!Number.isFinite(value)) return []
    const unitTail = text.slice((match.index ?? 0) + match[0].length).trimStart()
    // Chinese prose commonly omits the unit on the first value in a list:
    // "22.6758和42.0271个百分点". Attribute the trailing unit to that
    // first value only when the immediately following value carries it.
    const sharedRateUnit = !suffix && /^(?:和|及|、|与)\s*-?\d+(?:[,，]\d{3})*(?:\.\d+)?\s*个百分点/.test(unitTail)
      ? 'percentage_points'
      : !suffix && /^(?:和|及|、|与)\s*-?\d+(?:[,，]\d{3})*(?:\.\d+)?\s*[%％]/.test(unitTail)
        ? 'percent'
        : undefined
    const rateUnit = /^个百分点/.test(unitTail) || sharedRateUnit === 'percentage_points'
      ? 'percentage_points'
      : /^[%％]/.test(unitTail) || sharedRateUnit === 'percent'
        ? 'percent'
        : undefined
    const explicitShareCount = /^\s*股/.test(after)
    return [{ token, value, rawValue, magnitude: Boolean(suffix), decimals: components[1]!.split('.')[1]?.length ?? 0, index: match.index ?? 0, ...(technologyUnit ? {technologyUnit}: {}), ...(rateUnit ? {rateUnit} : {}), ...(suffix && monetaryScales[suffix] !== undefined && !explicitShareCount ? {currencyScale: monetaryScales[suffix]} : {}) }]
  })
}
function directionBefore(text: string, index: number): -1 | 1 {
  const clause = text.slice(Math.max(0, index - 120), index).split(/[。；;\n|]/).at(-1) ?? ''
  // A narrative may explain that a roll-forward table has opening balance,
  // additions, reductions, and closing balance, then state a closing balance.
  // Do not let the word "减少" in the column description turn that later
  // balance into a negative amount. The full ordered header plus colon is
  // required; ordinary claims such as "商誉准备减少4,796" keep their sign.
  if (/年初余额[^。；;\n|]{0,30}本年增加[^。；;\n|]{0,20}本年减少[^。；;\n|]{0,20}年末余额[^。；;\n|]{0,30}[:：][^。；;\n|]*$/.test(clause)) return 1
  const before = clause.slice(-24).split(/[。；;，,\n|]/).at(-1) ?? ''
  if (/(?<!非|正)负(?:数)?\s*$/.test(before)) return -1
  // A positive spread may be described after contrasting one growth rate
  // with another that declined (for example, "收入增长与现金流下降之间的
  // 增速背离为68.5972个百分点"). The decline describes one operand; once
  // the clause names the divergence result, it no longer supplies that result's sign.
  if (/背离(?:为|达|约为)\s*$/.test(before)) return 1
  if (/(?:下降|减少|下滑|降)(?:至|到)\s*(?:约|大约)?\s*$/.test(before)) return 1
  // A source table header such as “毛利率比上年同期增减” is a neutral
  // change-column label. Do not read its final “减” as a negative direction;
  // only standalone shorthand “减1.25%” carries that sign.
  const shorthandPercentageDecrease = /(?<!增)减\s*$/.test(before) && /^\d+(?:[,，]\d{3})*(?:\.\d+)?\s*[%％]/.test(text.slice(index))
  if (shorthandPercentageDecrease) return -1
  const direction = [...before.matchAll(/下降|减少|下滑|净流出|净减少|增长|增加|上升|净流入|降(?=\s*$)/g)].at(-1)
  // A completed amount/percentage ends the direction's scope, even without punctuation.
  if (direction && /\d/.test(before.slice(direction.index! + direction[0].length))) {
    const remaining = before.slice(direction.index! + direction[0].length)
    // A conjunction-only numeric list still shares its explicit direction:
    // "分别下降1.82和2.06个百分点". Completed units or new prose end it.
    const sharedNumericList = /^\s*(?:约)?-?[\d,，]+(?:\.\d+)?\s*(?:亿元|万元|元|个?百分点|[%％])?(?:\s*(?:和|及|、)\s*-?[\d,，]+(?:\.\d+)?\s*(?:亿元|万元|元|个?百分点|[%％])?)*\s*(?:和|及|、)\s*$/
    // Separately marked percentages also share a preceding direction when
    // each enumerated value repeats its own approximation marker, e.g.
    // "分别同比下降约7.13%、约21.24%及约20.54%". Keep this grammar limited
    // to a percent-only list so intervening prose or a new metric cannot
    // inherit the direction.
    const sharedPercentList = /^\s*(?:约|大约)?-?[\d,，]+(?:\.\d+)?\s*[%％](?:\s*(?:和|及|、)\s*(?:约|大约)?-?[\d,，]+(?:\.\d+)?\s*[%％])*(?:\s*(?:和|及|、)\s*(?:约|大约)?)?\s*$/
    if (!sharedNumericList.test(remaining) && !sharedPercentList.test(remaining)) return 1
  }
  return direction && /下降|减少|下滑|净流出|净减少|^降$/.test(direction[0]) ? -1 : 1
}
function normalizeChineseDates(text: string): string {
  const digits: Readonly<Record<string, string>> = { 零: '0', 〇: '0', '○': '0', 一: '1', 二: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' }
  return text.replace(/[零〇○一二三四五六七八九]{4}(?=年)/g, (year) => [...year].map((digit) => digits[digit]).join('')).replace(/([一二三四五六七八九十]{1,3})(?=月|日)/g, (value) => { if (!value.includes('十')) return digits[value] ?? value; const [tens, ones] = value.split('十'); return String(Number(tens ? digits[tens] : 1) * 10 + Number(ones ? digits[ones] : 0)) })
}
function referencesAttachedToSentence(markdown: string, sentence: string): Set<string> {
  const target = normalizeChineseDates(sentence).trim().replace(/[。；;！？!?\n]+$/g, '').trim()
  const segments = markdown.match(/[^。；;！？!?\n]+[。；;！？!?\n]?(?:\s*\[[^\]\s]+@paragraph:\d+\])*/g) ?? []
  for (const segment of segments) {
    const plain = normalizeChineseDates(segment.replace(/\[[^\]\s]+@paragraph:\d+\]/g, '')).trim().replace(/[。；;！？!?\n]+$/g, '').trim()
    if (plain !== target) continue
    return new Set([...segment.matchAll(/\[([^\]\s]+)@(paragraph:\d+)\]/g)].map(match => `${match[1]}@${match[2]}`))
  }
  return new Set()
}
function trustedNumbers(value: unknown, output: number[], seen = new Set<object>()): void {
  if (typeof value === 'number' && Number.isFinite(value)) { output.push(value); return }
  if (!value || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) for (const item of value) trustedNumbers(item, output, seen)
  else for (const [key,item] of Object.entries(value)) {
    // Raw CNY observations are facts, not free-standing calculations. They
    // enter a method's numeric allowance only through an exact cited source
    // and the source-bound conversion below. Derived ratios/growth remain
    // independently available in the prepared analysis.
    if (key === 'table' && ('financialQuality' in value || 'financialReadableTable' in value)) continue
    // Percentage-point results have their own unit-aware acceptance path; do
    // not also admit them as unitless values that could ground a percent claim.
    if (key === 'growthDivergences' || key === 'ratioChanges' || key === 'simpleFreeCashFlow') continue
    // The working-capital calculator's exact formula is generated from the
    // source-backed structured observations above. Its operands are valid
    // numeric evidence when the method cites that structured source, even
    // though the compact paragraph excerpt does not repeat the full raw row.
    if (key === 'workingCapitalCalculations' && Array.isArray(item)) {
      for (const calculation of item) if (calculation && typeof calculation === 'object' && typeof (calculation as Record<string, unknown>).formula === 'string') {
        for (const token of numericTokens((calculation as Record<string, string>).formula)) if (!token.technologyUnit) output.push(token.value)
      }
      continue
    }
    trustedNumbers(item, output, seen)
  }
}

interface PreparedCashConversionCycle {
  readonly dso: number
  readonly dio: number
  readonly dpo: number
  readonly cycle: number
  readonly sourceCandidateIds: readonly string[]
}

/** Keep only a complete, internally consistent, same-period calculator result. */
function preparedCashConversionCycles(preparedAnalysis: unknown): PreparedCashConversionCycle[] {
  if (!preparedAnalysis || typeof preparedAnalysis !== 'object') return []
  const financial = (preparedAnalysis as Record<string, unknown>).financial
  if (!financial || typeof financial !== 'object') return []
  const calculations = (financial as Record<string, unknown>).workingCapitalCalculations
  if (!Array.isArray(calculations)) return []
  const byPeriod = new Map<string, Map<string, Record<string, unknown>>>()
  for (const value of calculations) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    if (!['DSO', 'DIO', 'DPO', 'CCC'].includes(String(row.metric)) || typeof row.period !== 'string') continue
    const rows = byPeriod.get(row.period) ?? new Map<string, Record<string, unknown>>()
    if (rows.has(String(row.metric))) continue
    rows.set(String(row.metric), row)
    byPeriod.set(row.period, rows)
  }
  const result: PreparedCashConversionCycle[] = []
  for (const rows of byPeriod.values()) {
    const dso = rows.get('DSO')
    const dio = rows.get('DIO')
    const dpo = rows.get('DPO')
    const ccc = rows.get('CCC')
    if (!dso || !dio || !dpo || !ccc) continue
    const components = [dso, dio, dpo, ccc]
    if (!components.every(row => typeof row.value === 'number' && Number.isFinite(row.value) && typeof row.daysInPeriod === 'number' && Number.isFinite(row.daysInPeriod))) continue
    if (components.some(row => row.daysInPeriod !== dso.daysInPeriod)) continue
    const sourceIds = dso.sourceCandidateIds
    if (!Array.isArray(sourceIds) || sourceIds.length === 0 || !sourceIds.every(id => typeof id === 'string' && id.length > 0)) continue
    const normalizedIds = [...new Set(sourceIds as string[])].sort()
    if (components.some(row => !Array.isArray(row.sourceCandidateIds) || [...new Set(row.sourceCandidateIds.filter((id): id is string => typeof id === 'string'))].sort().join('\0') !== normalizedIds.join('\0'))) continue
    const [dsoValue, dioValue, dpoValue, cycleValue] = components.map(row => row.value as number)
    if (Math.abs(cycleValue - (dsoValue + dioValue - dpoValue)) > 1e-8) continue
    const dsoDisplay = dsoValue.toFixed(2)
    const dioDisplay = dioValue.toFixed(2)
    const dpoDisplay = dpoValue.toFixed(2)
    const cycleDisplay = cycleValue.toFixed(2)
    const expectedFormula = `DSO ${dsoDisplay}天＋DIO ${dioDisplay}天−DPO ${dpoDisplay}天＝${cycleDisplay}天`
    if (ccc.formula !== expectedFormula) continue
    result.push({ dso: dsoValue, dio: dioValue, dpo: dpoValue, cycle: cycleValue, sourceCandidateIds: normalizedIds })
  }
  return result
}

/**
 * A compact CCC formula may omit the DSO/DIO/DPO labels. The tokenizer then
 * reads the subtraction operand as a negative number. Admit that operand only
 * when the complete cited expression exactly matches the prepared CCC result.
 */
function isPreparedCashConversionCycleSubtraction(
  text: string,
  token: NumericToken,
  cycles: readonly PreparedCashConversionCycle[],
  citedIds: ReadonlySet<string>,
): boolean {
  if (token.rawValue >= 0 || token.magnitude || token.currencyScale !== undefined || token.rateUnit) return false
  const number = '[-−]?[\\d,，]+(?:\\.\\d+)?'
  const patterns = [
    new RegExp(`现金转换周期[^。；;\\n]{0,36}?(?:为|[=＝])\\s*(${number})\\s*天[^。；;\\n]{0,30}?(?:即|计算为|公式为)\\s*(${number})\\s*天\\s*[+＋]\\s*(${number})\\s*天\\s*[−-]\\s*(${number})\\s*天`, 'g'),
    new RegExp(`现金转换周期\\s*[：:]?\\s*[=＝]\\s*DSO\\s*(${number})\\s*天\\s*[+＋]\\s*DIO\\s*(${number})\\s*天\\s*[−-]\\s*DPO\\s*(${number})\\s*天\\s*[=＝]\\s*(${number})\\s*天`, 'g'),
  ]
  const equalsDisplay = (value: string, expected: number): boolean => Number(value.replace(/[,，]/g, '')) === Number(expected.toFixed(2))
  const tokenAt = token.index
  for (const cycle of cycles) {
    if (!cycle.sourceCandidateIds.every(id => citedIds.has(id))) continue
    for (const pattern of patterns) {
      for (const match of text.matchAll(pattern)) {
        const start = match.index ?? 0
        const end = start + match[0].length
        if (tokenAt < start || tokenAt >= end) continue
        const operands = pattern === patterns[0]
          ? { result: match[1]!, dso: match[2]!, dio: match[3]!, dpo: match[4]! }
          : { dso: match[1]!, dio: match[2]!, dpo: match[3]!, result: match[4]! }
        if (equalsDisplay(operands.result, cycle.cycle)
          && equalsDisplay(operands.dso, cycle.dso)
          && equalsDisplay(operands.dio, cycle.dio)
          && equalsDisplay(operands.dpo, cycle.dpo)
          && Math.abs(Math.abs(token.rawValue) - Number(operands.dpo.replace(/[,，]/g, ''))) < 1e-10) return true
      }
    }
  }
  return false
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

/** Resolve the remuneration column only, never other numbers (notably age). */
function suppliedRemunerationAmount(source: NormalizedResearchSource, location: string, input: NumericGroundingInput): string[] {
  const packet=input.evidenceContexts?.find(item=>item.sourceCandidateId===source.candidate.candidateId)
  const excerpt=packet?.excerpts.find(item=>item.location===location)
  if(!packet || !excerpt) return []
  const lines=source.content.split(/\r?\n/)
  const rowNumber=Number(/^paragraph:(\d+)$/.exec(location)?.[1])
  if(!rowNumber || lines[rowNumber-1]!==excerpt.text) return []
  // Name / sex / age / role / status / remuneration / related-party flag.
  const amount=/^[\u3400-\u9fff·]{2,12}\s+[男女]\s+\d{1,3}\s+.+?\s+(?:现任|离任)\s+([\d,，]+(?:\.\d+)?)\s+(?:是|否)\s*$/.exec(excerpt.text)?.[1]
  if(!amount) return []
  const contexts=(excerpt.contextLocations??[]).flatMap(context=>{
    const number=Number(/^paragraph:(\d+)$/.exec(context)?.[1])
    const supplied=packet.excerpts.find(item=>item.location===context)
    return number>0 && number<rowNumber && rowNumber-number<=12 && supplied?.text===lines[number-1] ? [{number,text:supplied.text}] : []
  })
  const units=contexts.filter(context=>/^\s*单位\s*[:：]\s*(?:人民币\s*)?(?:万元|元)\s*$/.test(context.text))
  const unit=units.length===1?units[0]:undefined
  if(!unit) return []
  const header=packet.excerpts.some(item=>{
    const number=Number(/^paragraph:(\d+)$/.exec(item.location)?.[1])
    return number>unit.number && number<rowNumber && number-unit.number<=4 && item.text===lines[number-1] && /税前报酬总额/.test(item.text)
  })
  if(!header) return []
  const value=Number(amount.replace(/[,，]/g,''))*(unit.text.includes('万元')?1e4:1)
  return Number.isFinite(value)?[`${value}元`]:[]
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
  const periodColumn = /^(?:(?:19|20)\d{2}(?:年|[-/\d年月日上中下半季度末初累计\s])*)(?:[（(]\s*(?:人民币\s*)?(?:亿元|万元|元)\s*[）)])?$/
  if (!monetary.test(label) && !(monetary.test(rowLabel) && periodColumn.test(label))) return undefined
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

/** A prepared financial value may inherit its exact period from its own table column. */
function preparedTableColumnHasPeriod(text: string, token: NumericToken, period: string, basis: string): boolean {
  const start = text.lastIndexOf('\n', token.index) + 1
  const end = text.indexOf('\n', token.index)
  const line = text.slice(start, end < 0 ? undefined : end)
  if (!/^\s*\|/.test(line)) return false
  const column = text.slice(start, token.index).split('|').length - 2
  if (column < 1) return false
  const before = text.slice(0, start).split('\n')
  let headerIndex = before.length - 2
  while (headerIndex >= 0 && /^\s*\|/.test(before[headerIndex]!)) headerIndex -= 1
  const header = before[headerIndex + 1]
  const separator = before[headerIndex + 2]
  if (!header || !/^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(separator ?? '')) return false
  const cell = header.split('|').slice(1, -1)[column]?.replace(/\s+/g, '') ?? ''
  if (cell.includes(period)) return true
  const year = period.slice(0, 4)
  const month = Number(period.slice(5, 7))
  return basis === 'YTD' && (
    month === 3 && new RegExp(`${year}年(?:一季度|第一季度|1季度)`).test(cell)
    || month === 6 && new RegExp(`${year}年(?:上半年|1[-—至]6月|1月至6月)`).test(cell)
    || month === 9 && new RegExp(`${year}年(?:前三季度|前三季|1[-—至]9月|1月至9月)`).test(cell)
    || month === 12 && new RegExp(`${year}年(?:全年|年度|全年度)`).test(cell)
  )
}

/** Conservative numeric novelty guard, not a proof of semantic entailment or correct accounting scope. */
function capexComparisonDiagnostics(markdown: string, prepared: unknown): NumericGroundingDiagnostic[] {
  if (!prepared || typeof prepared !== 'object') return []
  const financial = (prepared as Record<string, unknown>).financial
  if (!financial || typeof financial !== 'object') return []
  const rows = (financial as Record<string, unknown>).periodRatios
  if (!Array.isArray(rows)) return []
  const diagnostics: NumericGroundingDiagnostic[] = []
  // Deliberately bounded: an explicit calendar period and both named accounts in
  // one factual clause. No inherited period, quarterly guess, or forecast logic.
  for (const clause of markdown.split(/[。；;\n|]/)) {
    if (/假设|若|如果|预计|预期|预测|未来|将|计划|目标|可能|有望|情景/.test(clause)) continue
    for (const match of clause.matchAll(/((?:19|20)\d{2})\s*年\s*(上半年|全年|年度)\s*(?:则|的)?\s*(?:资本开支|购建长期资产现金支出)\s*(?:仍)?\s*(低于|少于|小于|高于|超过|大于|等于)\s*(?:同期)?\s*(?:经营现金流|经营现金净流量|经营活动现金流量净额)/g)) {
    const period = `${match[1]}-${match[2] === '上半年' ? '06-30' : '12-31'}`
    const candidates = rows.filter(row => row && typeof row === 'object' && row.period === period && typeof row.capexToOperatingCashFlowMultiple === 'number' && Number.isFinite(row.capexToOperatingCashFlowMultiple) && row.capexToOperatingCashFlowMultiple >= 0 && Array.isArray(row.sourceCandidateIds) && row.sourceCandidateIds.some((id: unknown) => typeof id === 'string' && id.length > 0))
    if (!candidates.length) continue
    const ratio = candidates[0].capexToOperatingCashFlowMultiple as number
    if (candidates.some(row => row.capexToOperatingCashFlowMultiple !== ratio)) continue
    const stated = /低于|少于|小于/.test(match[3]!) ? '<' : /高于|超过|大于/.test(match[3]!) ? '>' : '='
    const actual = ratio < 1 ? '<' : ratio > 1 ? '>' : '='
    if (stated !== actual) diagnostics.push({code:'UNSUPPORTED_NUMBER',token:`capex${stated}CFO@${period}`,value:ratio,context:clause.trim(),reason:`Explicit period/account comparison contradicts deterministic capex/CFO ratio ${ratio}; supported relation is capex${actual}CFO.`})
    }
  }
  return diagnostics
}

function growthDivergenceRelationDiagnostics(markdown: string, prepared: unknown, citedIds: ReadonlySet<string>): NumericGroundingDiagnostic[] {
  if (!prepared || typeof prepared !== 'object') return []
  const financial = (prepared as Record<string, unknown>).financial
  if (!financial || typeof financial !== 'object') return []
  const divergences = (financial as Record<string, unknown>).growthDivergences
  if (!Array.isArray(divergences)) return []
  const aliases: Readonly<Record<string, readonly string[]>> = {
    receivables: ['应收账款', '应收款项', '应收票据及应收账款'],
    revenue: ['营业收入', '收入'],
    operatingCashFlow: ['经营活动现金流量净额', '经营现金净流量', '经营现金流'],
    inventory: ['存货'],
  }
  const metricFor = (label: string): string | undefined => Object.entries(aliases).find(([, names]) => names.includes(label))?.[0]
  const diagnostics: NumericGroundingDiagnostic[] = []
  const pattern = /(应收票据及应收账款|经营活动现金流量净额|经营现金净流量|经营现金流|应收账款|应收款项|营业收入|收入|存货)(?:同比)?增速\s*(高于|超过|快于|大于|低于|少于|慢于|小于)\s*(应收票据及应收账款|经营活动现金流量净额|经营现金净流量|经营现金流|应收账款|应收款项|营业收入|收入|存货)(?:同比)?增速/g
  for (const match of markdown.replace(/\[[^\]\s]+@[^\]]+\]/g, '').matchAll(pattern)) {
    if (/假设|若|如果|预计|预期|预测|未来|将|计划|目标|可能|有望|情景/.test(match[0])) continue
    const leftMetric = metricFor(match[1]!)
    const rightMetric = metricFor(match[3]!)
    if (!leftMetric || !rightMetric) continue
    const relation = /高于|超过|快于|大于/.test(match[2]!) ? '>' : '<'
    const candidates = divergences.filter((item) => {
      if (!item || typeof item !== 'object') return false
      const value = item as Record<string, unknown>
      return value.unit === 'percentage_points' && typeof value.value === 'number' && Number.isFinite(value.value)
        && value.leftMetric === leftMetric && value.rightMetric === rightMetric
        && Array.isArray(value.sourceCandidateIds) && value.sourceCandidateIds.some((id) => typeof id === 'string' && citedIds.has(id))
    })
    if (!candidates.length || candidates.some((item) => (item as Record<string, unknown>).value !== (candidates[0] as Record<string, unknown>).value)) continue
    const value = (candidates[0] as Record<string, unknown>).value as number
    const actual = value > 0 ? '>' : value < 0 ? '<' : '='
    if (relation !== actual) diagnostics.push({ code: 'UNSUPPORTED_NUMBER', token: `${match[1]}增速${match[2]}${match[3]}增速`, value, context: match[0], reason: `Growth-rate relation contradicts deterministic ${leftMetric} minus ${rightMetric} divergence (${value} percentage points).` })
  }
  return diagnostics
}

export function validateCompanyNumericGrounding(input: NumericGroundingInput): { readonly status: 'grounded' | 'unsupported_numbers'; readonly diagnostics: readonly NumericGroundingDiagnostic[] } {
  const sourceMap = new Map(input.sources.map((source) => [source.candidate.candidateId, source]))
  const citedText: string[] = []
  const citedLines = new Map<string, Map<number,string>>()
  for (const match of input.markdown.matchAll(/\[([^\]\s]+)@paragraph:(\d+)\]/g)) {
    const source = sourceMap.get(match[1]!)
    const paragraph = source?.content.split(/\r?\n/)[Number(match[2]) - 1]
    if (paragraph !== undefined) {
      citedText.push(paragraph)
      if(source) citedText.push(...suppliedRemunerationAmount(source, `paragraph:${match[2]}`, input))
      const lines=citedLines.get(match[1]!)??new Map<number,string>()
      lines.set(Number(match[2]),paragraph)
      citedLines.set(match[1]!,lines)
    }
    // Report title supplies its declared reporting period, not operating quantities in unrelated paragraphs.
    if (source && paragraph !== undefined) citedText.push(...(source.title.match(/(?:19|20)\d{2}(?=\s*年|年度|\s*annual)/gi) ?? []), ...citedPublicationYears(source))
  }
  // PDF line wraps can split an EPS label from its amount. Join only actual
  // consecutive cited lines of the same source; never fill a missing citation.
  const perShareFacts: {metric:string;value:number}[]=[]
  for(const lines of citedLines.values()) {
    const runs:string[]=[]
    let previous=-1
    for(const [number,text] of [...lines].sort((a,b)=>a[0]-b[0])) {
      if(number===previous+1) runs[runs.length-1]+=text
      else runs.push(text)
      previous=number
    }
    for(const run of runs) {
      const compact=run.replace(/\s+/g,'')
      for(const match of compact.matchAll(/每股(净资产|收益)(减少|下降|增加|上升)([\d,，]+(?:\.\d+)?)元\/股/g)) perShareFacts.push({metric:match[1]!,value:Number(match[3]!.replace(/[,，]/g,''))*(/减少|下降/.test(match[2]!)?-1:1)})
      for(const match of compact.matchAll(/(减少|下降|增加|上升)每股(净资产|收益)([\d,，]+(?:\.\d+)?)元\/股/g)) perShareFacts.push({metric:match[2]!,value:Number(match[3]!.replace(/[,，]/g,''))*(/减少|下降/.test(match[1]!)?-1:1)})
      for(const match of compact.matchAll(/(减少|下降|增加|上升)基本每股收益(?:和|及)稀释每股收益([\d,，]+(?:\.\d+)?)元\/股/g)) perShareFacts.push({metric:'收益',value:Number(match[2]!.replace(/[,，]/g,''))*(/减少|下降/.test(match[1]!)?-1:1)})
    }
  }
  // Without a locator no entire-document number pool is admitted.
  const citedTechnologyTokens = numericTokens(citedText.join('\n')).filter(token=>token.technologyUnit)
  const sourceTokens: NumericToken[] = [...([...citedLines.entries()].flatMap(([candidateId, lines]) => {
    const ordered = [...lines].sort((a, b) => a[0] - b[0])
    const globalScale = ordered.flatMap(([, line]) => {
      const match = /除(?:有)?特别说明外[^。；;\n]{0,80}?(?:均以|均按|以|按)\s*(?:人民币\s*)?(万亿|亿元|百万元|万元|千元|元)\s*为单位表示/.exec(line)
      return match ? [monetaryScales[match[1]!]] : []
    }).at(-1)
    return ordered.flatMap(([paragraph, text]) => {
      const packet = input.evidenceContexts?.find(item => item.sourceCandidateId === candidateId)
      const rowExcerpt = packet?.excerpts.find(item => item.location === `paragraph:${paragraph}` && item.text === text)
      const isExactCustomerSupplierHeader = (header: string) => /^(?:序号\s+)?(?:供应商名称\s+采购额|客户名称\s+销售额)\s*[（(]元[）)]\s+占年度(?:采购|销售)总额比例\s*$/.test(header.trim())
      const hasCitedCustomerSupplierHeader = ordered.some(([headerParagraph, header]) => headerParagraph < paragraph && paragraph - headerParagraph <= 10 && isExactCustomerSupplierHeader(header))
        || (rowExcerpt?.contextLocations ?? []).some(location => {
          const headerParagraph = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
          const headerExcerpt = packet?.excerpts.find(item => item.location === location)
          const headerLine = sourceMap.get(candidateId)?.content.split(/\r?\n/)[headerParagraph - 1]
          return Number.isInteger(headerParagraph) && headerParagraph < paragraph && paragraph - headerParagraph <= 10
            && headerExcerpt?.text === headerLine && isExactCustomerSupplierHeader(headerLine ?? '')
        })
      const customerSupplierAmountRow = /^(?:\d+\s+)?(?:(?:供应商|客户)\S*|第[一二三四五六七八九十]+名)\s+[\d,，]+(?:\.\d+)?\s+[\d.]+\s*%\s*$/.test(text)
        || /^合计\s+--\s+[\d,，]+(?:\.\d+)?\s+[\d.]+\s*%\s*$/.test(text)
      const citedCustomerSupplierUnit = hasCitedCustomerSupplierHeader && customerSupplierAmountRow ? '元' : undefined
      const suppliedUnitContext = (rowExcerpt?.contextLocations ?? []).flatMap(location => {
        const number = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
        const supplied = packet?.excerpts.find(item => item.location === location)
        const line = sourceMap.get(candidateId)?.content.split(/\r?\n/)[number - 1]
        const exactSourceContext = supplied && line === supplied.text && number > 0 && number < paragraph
        const nearbyLocalUnit = exactSourceContext && paragraph - number <= 30 && /^\s*单位\s*[:：]/.test(line)
        const vehicleSalesTableHeader = exactSourceContext && paragraph - number <= 2
          && /产品类别.*产能状况.*快报产量.*快报销量.*销售收入\s*[（(]元[）)]/.test(line.trim())
          && /^(?:乘用车|商用车)\s+[\d,，]+\s+[\d,，]+\s+[\d,，]+\s+[\d,，]+(?:\.\d+)?\s*$/.test(text)
        const cashDividendTotalHeader = exactSourceContext && paragraph - number === 1
          && /^现金分红总额（含其他方式）（元）$/.test(line.trim())
          && /^[\d,，]+(?:\.\d+)?$/.test(text.trim())
        const suppliedGlobalConvention = exactSourceContext && REPORT_CURRENCY_CONVENTION.test(line) && isVerifiedGoodwillTableRow(sourceMap.get(candidateId)?.content ?? '', paragraph)
        return nearbyLocalUnit || vehicleSalesTableHeader || cashDividendTotalHeader || suppliedGlobalConvention ? [line] : []
      }).at(-1)
      const localUnit = /(?:^|[（(])(?:单位\s*[:：]\s*)?(?:人民币\s*)?(万亿|亿元|百万元|万元|千元|元)(?:[）)]|\s*$)/.exec(text)?.[1]
      const nearbyUnit = [...ordered].reverse().find(([number, line]) => number <= paragraph && paragraph - number <= 30 && /^\s*单位\s*[:：]/.test(line) && /(?:万亿|亿元|百万元|万元|千元|元)/.test(line))?.[1]
      const unitText = suppliedUnitContext ?? nearbyUnit
      const remunerationRow = /^[\u3400-\u9fff·]{2,12}\s+[男女]\s+\d{1,3}\s+.+?\s+(?:现任|离任)\s+[\d,，]+(?:\.\d+)?\s+(?:是|否)\s*$/.test(text)
      const contextualCurrencyUnit = unitText ? /万亿|亿元|百万元|万元|千元|元/.exec(unitText)?.[0] : undefined
      const currencyScale = remunerationRow ? undefined : localUnit ? monetaryScales[localUnit] : contextualCurrencyUnit ? monetaryScales[contextualCurrencyUnit] : citedCustomerSupplierUnit ? monetaryScales[citedCustomerSupplierUnit] : globalScale
      const rawTokens = numericTokens(text).filter((token) => !token.technologyUnit)
      // Some official PDF rows place the unit in the metric label rather than
      // after each value, e.g. "研发投入占营业收入比例（%） 4.56 23.71".
      // Bind those bare row values to percent only when the same cited row
      // explicitly declares a percentage unit. Explicit "个百分点" values
      // remain distinct and are not reclassified.
      const declaredPercentMetric = /(?:比例|占比|比重|毛利率|净利率|资产负债率|负债率|收益率|增长率|变动率|周转率)\s*[（(]\s*[%％]\s*[）)]/.exec(text)
      const tokens = rawTokens.map(token => {
        const isReportingYear = !token.magnitude && /(?:19|20)\d{2}\s*(?:年|年度)/.test(text.slice(token.index, token.index + token.token.length + 4))
        const afterToken = text.slice(token.index + token.token.length).trimStart()
        const isExplicitCount = /^(?:人|名|股|家|个|台|套|辆|吨|天|月|年|季度|次|项|款)/.test(afterToken)
        const vehicleSalesHeader = (rowExcerpt?.contextLocations ?? []).some(location => {
          const contextLine = packet?.excerpts.find(item => item.location === location)?.text
          return contextLine && /产品类别.*产能状况.*快报产量.*快报销量.*销售收入\s*[（(]元[）)]/.test(contextLine)
        }) && /^(?:乘用车|商用车)\s+[\d,，]+\s+[\d,，]+\s+[\d,，]+\s+[\d,，]+(?:\.\d+)?\s*$/.test(text)
        const vehicleAmountIndex = vehicleSalesHeader ? rawTokens.at(-1)?.index : undefined
        const vehicleCountCell = vehicleSalesHeader && token.index !== vehicleAmountIndex
        const declaredRateUnit = !token.rateUnit && declaredPercentMetric && token.index > declaredPercentMetric.index
          ? 'percent' as const
          : undefined
        return { ...token, ...(declaredRateUnit ? { rateUnit: declaredRateUnit } : {}), ...(token.currencyScale === undefined && currencyScale !== undefined && !token.rateUnit && !isReportingYear && !isExplicitCount && !vehicleCountCell ? {currencyScale, value: token.rawValue * currencyScale} : {}), sourceCandidateId: candidateId }
      })
      // A margin-change column can report its change as a raw percent cell.
      // Preserve the source's displayed unit; do not silently reinterpret it
      // as percentage points based on the metric name or neighboring headers.
      return tokens
    })
  })), ...numericTokens((input.trustedText ?? []).join('\n')).filter((token) => !token.technologyUnit)]
  for (const [candidateId, lines] of citedLines) {
    const source = sourceMap.get(candidateId)
    if (!source) continue
    const metadataYears = [...(source.title.match(/(?:19|20)\d{2}(?=\s*年|年度|\s*annual)/gi) ?? []), ...citedPublicationYears(source)]
    sourceTokens.push(...numericTokens(metadataYears.join(' ')).filter((token) => !token.technologyUnit))
    for (const [paragraph] of lines) sourceTokens.push(...numericTokens(suppliedRemunerationAmount(source, `paragraph:${paragraph}`, input).join(' ')).filter((token) => !token.technologyUnit))
  }
  const citedExplicitYuanAmounts: number[] = []
  for (const [candidateId, lines] of citedLines) for (const [paragraph, text] of lines) {
    const location = `paragraph:${paragraph}`
    const packet = input.evidenceContexts?.find((item) => item.sourceCandidateId === candidateId)
    const excerpt = packet?.excerpts.find((item) => item.location === location && item.text === text)
    const declaredContexts = (excerpt?.contextLocations ?? []).flatMap((contextLocation) => {
      const context = packet?.excerpts.find((item) => item.location === contextLocation)
      const contextParagraph = Number(/^paragraph:(\d+)$/.exec(contextLocation)?.[1])
      const actual = sourceMap.get(candidateId)?.content.split(/\r?\n/)[contextParagraph - 1]
      return context && context.text === actual ? [context.text] : []
    })
    const explicitYuan = /(?:（元）|\(元\)|\bCNY\b|人民币元)/i.test(text) || declaredContexts.some((context) => /^\s*单位\s*[:：]\s*(?:人民币\s*)?元\s*$/.test(context))
    for (const token of numericTokens(text)) if (!token.technologyUnit) {
      if (!token.magnitude && explicitYuan) citedExplicitYuanAmounts.push(token.value)
    }
  }
  const calculated: number[] = []
  trustedNumbers(input.preparedAnalysis, calculated)
  // Derive only explicit balance-sheet movements from a fully cited official
  // row whose supplied local context binds both the unit and the ordered
  // current-period / prior-year-end columns. This supports claims such as
  // "receivables increased by 8.06亿元" without trusting model arithmetic.
  const citedBalanceSheetDifferences: Array<{ sourceCandidateId: string; paragraph: number; account: string; delta: number; currentYear: number }> = []
  for (const [candidateId, lines] of citedLines) {
    const source = sourceMap.get(candidateId)
    const packet = input.evidenceContexts?.find(item => item.sourceCandidateId === candidateId)
    if (!source || !packet || !/半年度报告/.test(source.title ?? '')) continue
    const currentYear = Number(/((?:19|20)\d{2})\s*年/.exec(source.title ?? '')?.[1])
    if (!Number.isInteger(currentYear)) continue
    for (const [paragraph, text] of lines) {
      const account = /^(?:\s*)(应收账款|存货)\s+/.exec(text)?.[1]
      if (!account) continue
      const excerpt = packet.excerpts.find(item => item.location === `paragraph:${paragraph}` && item.text === text)
      const contexts = (excerpt?.contextLocations ?? []).flatMap(location => {
        const contextParagraph = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
        const context = packet.excerpts.find(item => item.location === location)
        const actual = source.content.split(/\r?\n/)[contextParagraph - 1]
        return Number.isInteger(contextParagraph) && contextParagraph < paragraph && context?.text === actual && lines.get(contextParagraph) === actual
          ? [{ paragraph: contextParagraph, text: actual }]
          : []
      })
      const header = contexts.find(item => /本报告期末\s+上年末/.test(item.text))
      const unit = contexts.find(item => /^\s*单位\s*[:：]\s*(?:人民币\s*)?(元|千元|万元|百万元|亿元|万亿)\s*$/.test(item.text))
      if (!header || !unit || header.paragraph >= paragraph || paragraph - header.paragraph > 12 || paragraph - unit.paragraph > 30) continue
      const unitName = /^\s*单位\s*[:：]\s*(?:人民币\s*)?(元|千元|万元|百万元|亿元|万亿)\s*$/.exec(unit.text)?.[1]
      const scale = unitName ? monetaryScales[unitName] : undefined
      if (scale === undefined) continue
      const amounts = numericTokens(text).filter(token => !token.technologyUnit && !token.rateUnit && !token.magnitude)
      if (amounts.length < 2) continue
      const delta = (amounts[0]!.rawValue - amounts[1]!.rawValue) * scale
      if (Number.isFinite(delta)) citedBalanceSheetDifferences.push({ sourceCandidateId: candidateId, paragraph, account, delta, currentYear })
    }
  }
  // Deterministic company-financial facts are normalized from CNY to readable
  // units by the Workflow. Admit those exact conversions only when the method
  // cites the corresponding structured financial candidate.
  const citedIds = new Set([...input.markdown.matchAll(/\[([^\]\s]+)@paragraph:(\d+)\]/g)].map(match => match[1]!))
  const availableCitedIds = new Set([...citedIds].filter(id => sourceMap.has(id)))
  const preparedCashCycles = preparedCashConversionCycles(input.preparedAnalysis)
  const preparedRoot = input.preparedAnalysis && typeof input.preparedAnalysis === 'object' ? input.preparedAnalysis as Record<string, unknown> : undefined
  const preparedFinancial = preparedRoot?.financial ?? (preparedRoot && 'financialQuality' in preparedRoot ? preparedRoot : undefined)
  const financialTable = preparedFinancial && typeof preparedFinancial === 'object' ? (preparedFinancial as Record<string, unknown>).table : undefined
  const citedFinancialSourceIds = new Set(input.sources.flatMap(source => {
    const provenance = source.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined
    return provenance?.metricId === 'company_financial_history' && citedIds.has(source.candidate.candidateId) ? [source.candidate.candidateId] : []
  }))
  const preparedFinancialPeriodYears = new Set(Array.isArray(financialTable) ? financialTable.flatMap(row => {
    if (!row || typeof row !== 'object') return []
    const period = (row as Record<string, unknown>).period
    return typeof period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(period) ? [Number(period.slice(0, 4))] : []
  }) : [])
  if (Array.isArray(financialTable)) for (const source of input.sources) {
    const provenance = source.candidate.metadata?.dataProvenance as Record<string, unknown> | undefined
    if (!citedIds.has(source.candidate.candidateId) || provenance?.metricId !== 'company_financial_history') continue
    for (const row of financialTable) {
      if (!row || typeof row !== 'object') continue
      const metrics = (row as Record<string, unknown>).metrics
      const metadata = (row as Record<string, unknown>).metadata
      if (!metrics || typeof metrics !== 'object' || !metadata || typeof metadata !== 'object') continue
      for (const [key, amount] of Object.entries(metrics as Record<string, unknown>)) {
        const unit = (metadata as Record<string, {unit?:unknown;currency?:unknown}>)[key]
        if (typeof amount !== 'number' || !Number.isFinite(amount) || unit?.unit !== 'CNY' || unit.currency !== 'CNY') continue
        calculated.push(amount)
        for (const divisor of [1e4, 1e6, 1e8]) calculated.push(amount / divisor)
      }
    }
  }
  const percentagePointCalculations: number[] = []
  const growthPercentCalculations: number[] = []
  const preparedGrowth = preparedFinancial && typeof preparedFinancial === 'object' ? (preparedFinancial as Record<string, unknown>).growth : undefined
  if (Array.isArray(preparedGrowth)) for (const growth of preparedGrowth) {
    if (!growth || typeof growth !== 'object') continue
    const value = growth as Record<string, unknown>
    const sourceCandidateIds = Array.isArray(value.sourceCandidateIds) ? value.sourceCandidateIds : []
    if (value.unit === 'CNY' && typeof value.growthPercent === 'number' && Number.isFinite(value.growthPercent)
      && sourceCandidateIds.some(id => typeof id === 'string' && citedIds.has(id))) growthPercentCalculations.push(value.growthPercent)
  }
  const growthDivergences = preparedFinancial && typeof preparedFinancial === 'object' ? (preparedFinancial as Record<string, unknown>).growthDivergences : undefined
  if (Array.isArray(growthDivergences)) for (const divergence of growthDivergences) {
    if (!divergence || typeof divergence !== 'object') continue
    const value = divergence as Record<string, unknown>
    if (value.unit !== 'percentage_points' || typeof value.value !== 'number' || !Number.isFinite(value.value)) continue
    const sourceCandidateIds = Array.isArray(value.sourceCandidateIds) ? value.sourceCandidateIds : []
    if (sourceCandidateIds.some(id => typeof id === 'string' && citedIds.has(id))) {
      percentagePointCalculations.push(value.value)
      // Workflow may display a result calculated from the operands rounded to
      // the report's four-decimal precision. Admit that explicit calculator
      // value as well as the unrounded underlying difference.
      if (typeof value.displayValue === 'number' && Number.isFinite(value.displayValue)) percentagePointCalculations.push(value.displayValue)
    }
  }
  const ratioChanges = preparedFinancial && typeof preparedFinancial === 'object' ? (preparedFinancial as Record<string, unknown>).ratioChanges : undefined
  if (Array.isArray(ratioChanges)) for (const change of ratioChanges) {
    if (!change || typeof change !== 'object') continue
    const value = change as Record<string, unknown>
    if (typeof value.changePercentagePoints !== 'number' || !Number.isFinite(value.changePercentagePoints)) continue
    const sourceCandidateIds = Array.isArray(value.sourceCandidateIds) ? value.sourceCandidateIds : []
    if (sourceCandidateIds.some(id => typeof id === 'string' && citedIds.has(id))) {
      percentagePointCalculations.push(value.changePercentagePoints)
      // A prepared ratio row carries the exact current/prior percentage
      // operands and their source binding. Admit those values only when the
      // same structured source is cited; the aggregate gross-margin guard
      // below additionally binds the pair and delta to one comparison row.
      if (value.metric === 'grossMarginPercent') {
        if (typeof value.currentValue === 'number' && Number.isFinite(value.currentValue)) calculated.push(value.currentValue)
        if (typeof value.priorValue === 'number' && Number.isFinite(value.priorValue)) calculated.push(value.priorValue)
      }
      // Ratio changes can be reported from the displayed two-decimal ratio
      // operands. Admit only this deterministic display calculation alongside
      // the unrounded underlying value.
      if (typeof value.displayChangePercentagePoints === 'number' && Number.isFinite(value.displayChangePercentagePoints)) percentagePointCalculations.push(value.displayChangePercentagePoints)
    }
  }
  // The Workflow's simple FCF result is stored in CNY, while reports display
  // its prepared displayValue (usually CNY 亿元). Admit that normalized result
  // only when the exact cited financial sources, period, basis, and display
  // unit all match the prepared row. Never infer a unit conversion from an
  // arbitrary model-authored formula.
  const simpleFreeCashFlow = preparedFinancial && typeof preparedFinancial === 'object'
    ? (preparedFinancial as Record<string, unknown>).simpleFreeCashFlow
    : undefined
  const simpleFreeCashFlowDisplayValues: Array<{value:number; displayValue:string; period:string; basis:string; displayUnit:string}> = []
  if (Array.isArray(simpleFreeCashFlow)) for (const item of simpleFreeCashFlow) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const sourceCandidateIds = Array.isArray(row.sourceCandidateIds) ? row.sourceCandidateIds : []
    const period = row.period
    const basis = row.basis
    const unit = row.unit
    const value = row.value
    const operatingCashFlow = row.operatingCashFlow
    const capex = row.capex
    const displayValue = typeof row.displayValue === 'string' ? Number(row.displayValue.replace(/,/g, '')) : Number.NaN
    const displayUnit = row.displayUnit
    const scale = typeof displayUnit === 'string' ? monetaryScales[displayUnit] : undefined
    const displayRoundingTolerance = typeof row.displayValue === 'string' && scale !== undefined
      ? 0.5 * 10 ** -(row.displayValue.split('.')[1]?.length ?? 0) * scale
      : 0
    const formula = typeof row.formula === 'string' ? row.formula : ''
    const citedAndAvailableSources = sourceCandidateIds.length > 0
      && sourceCandidateIds.every(id => typeof id === 'string' && citedIds.has(id) && sourceMap.has(id))
    const consistent = typeof value === 'number' && Number.isFinite(value)
      && typeof operatingCashFlow === 'number' && Number.isFinite(operatingCashFlow)
      && typeof capex === 'number' && Number.isFinite(capex)
      && close(value, operatingCashFlow - capex, 1e-10)
      && Number.isFinite(displayValue) && scale !== undefined
      && Math.abs(displayValue * scale - value) <= Math.max(Math.abs(value) * 1e-10, displayRoundingTolerance)
      && typeof period === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(period)
      && (basis === 'YTD' || basis === 'POINT_IN_TIME')
      && unit === 'CNY'
      && formula.includes(String(row.displayOperatingCashFlow ?? ''))
      && formula.includes(String(row.displayCapex ?? ''))
      && formula.includes(String(row.displayValue))
      && formula.includes(displayUnit as string)
    if (citedAndAvailableSources && consistent) {
      simpleFreeCashFlowDisplayValues.push({ value: displayValue, displayValue: row.displayValue as string, period, basis, displayUnit: displayUnit as string })
      // A deterministic FCF table reports the two calculator operands beside
      // its result. Admit those rounded display values only from the same
      // internally consistent row, cited structured source, exact period,
      // cumulative basis, and declared display unit.
      for (const [display, amount] of [[row.displayOperatingCashFlow, operatingCashFlow], [row.displayCapex, capex]] as const) {
        if (typeof display !== 'string' || typeof amount !== 'number' || !Number.isFinite(amount)) continue
        const operandValue = Number(display.replace(/,/g, ''))
        const tolerance = 0.5 * 10 ** -(display.split('.')[1]?.length ?? 0) * scale!
        if (!Number.isFinite(operandValue) || Math.abs(operandValue * scale! - amount) > Math.max(Math.abs(amount) * 1e-10, tolerance)) continue
        simpleFreeCashFlowDisplayValues.push({ value: operandValue, displayValue: display, period, basis, displayUnit: displayUnit as string })
      }
    }
  }
  const markdown = input.markdown
    .replace(/\[[^\]\s]+@[^\]]+\]/g, '')
    // Formatting delimiters can separate a sign from its numeric token
    // (`**-28.69亿元**`), causing signed deterministic results to be read as
    // positive amounts. Validate the rendered text without paired emphasis.
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/__(.*?)__/gs, '$1')
    .replace(/\[[^\]]*\]\([^)]*\)/g, (link) => link.replace(/\]\([^)]*\)/, ']'))
    // Models sometimes emit an explicit rejected draft token immediately
    // before its source-grounded correction ("525.34亿元？否，原始金额为...").
    // The rejected token is not an asserted figure; retain and validate the
    // corrected amount that follows.
    .replace(/([-−]?[\d,，]+(?:\.\d+)?\s*(?:亿元|万元|元|个百分点|[%％]))\s*[？?]\s*(?:否|不对|错误|有误)\s*[,，；;]?\s*(?=(?:原始金额|正确金额|实际金额|更正为|应为))/g, ' ')
    // Require whitespace after a numbered-list marker. Without it, a formula
    // starting a line such as "373.35亿元..." is truncated to "35亿元".
    .replace(/^\s*(?:#{1,6}\s+)?\d{1,2}[.、)]\s+/gm, '')
  const normalizedMarkdown = normalizeChineseDates(markdown)
  const formulaResults = inlineFormulaResults(normalizedMarkdown)
  const diagnostics: NumericGroundingDiagnostic[] = [...capexComparisonDiagnostics(markdown, input.preparedAnalysis), ...growthDivergenceRelationDiagnostics(markdown, input.preparedAnalysis, citedIds), ...industryMarginAttributionDiagnostics(input.markdown, input.sources, input.evidenceContexts), ...consolidatedGrossMarginDiagnostics(input.markdown, input.preparedAnalysis)]
  for (const candidate of numericTokens(normalizedMarkdown)) {
    const perShareContext = normalizedMarkdown.slice(Math.max(0,candidate.index-50),candidate.index)
    const directPerShareClaim=/每股(净资产|收益)(?:各)?(?:的)?(?:影响(?:为)?)?(?:的)?(减少|下降|增加|上升)(?:为)?\s*(?:(?:人民币|RMB|CNY)\s*)?$/.exec(perShareContext)
    const reversePerShareClaim=/(减少|下降|增加|上升)(?:基本及稀释)?每股(净资产|收益)(?:各)?(?:影响(?:为)?)?\s*(?:(?:人民币|RMB|CNY)\s*)?$/.exec(perShareContext)
    const perShareClaim=directPerShareClaim ?? (reversePerShareClaim ? Object.assign([...reversePerShareClaim] as RegExpExecArray, { 1: reversePerShareClaim[2]!, 2: reversePerShareClaim[1]! }) : null)
    if(perShareClaim && (candidate.currencyScale === 1 && /元$/.test(candidate.token) || /^\s*元(?:\/股)?/.test(normalizedMarkdown.slice(candidate.index+candidate.token.length)))) {
      const signed=candidate.rawValue<0?candidate.rawValue:candidate.rawValue*(/减少|下降/.test(perShareClaim[2]!)?-1:1)
      if(!perShareFacts.some(fact=>fact.metric===perShareClaim[1] && close(fact.value,signed,1e-10))) diagnostics.push({code:'UNSUPPORTED_NUMBER',token:candidate.token,value:signed,context:normalizedMarkdown.slice(Math.max(0,candidate.index-35),candidate.index+candidate.token.length+45).trim(),reason:'Per-share metric and change direction must match an explicitly cited source line or its consecutively cited continuation; another per-share metric is not interchangeable.'})
      continue
    }
    if(candidate.technologyUnit) {
      if(!citedTechnologyTokens.some(source=>source.rawValue===candidate.rawValue && source.technologyUnit===candidate.technologyUnit)) diagnostics.push({code:'UNSUPPORTED_NUMBER',token:candidate.token,value:candidate.value,context:normalizedMarkdown.slice(Math.max(0,candidate.index-35),candidate.index+candidate.token.length+45).trim(),reason:'Technology quantity and unit absent from the cited paragraphs; generic financial numbers cannot establish a technology specification.'})
      continue
    }
    // Fixed editorial cadence/ordinal labels are instructions, not observed company quantities.
    const context = normalizedMarkdown.slice(Math.max(0, candidate.index - 35), candidate.index + candidate.token.length + 45)
    const before = normalizedMarkdown.slice(Math.max(0, candidate.index - 8), candidate.index)
    const after = normalizedMarkdown.slice(candidate.index + candidate.token.length, candidate.index + candidate.token.length + 15).trimStart()
    const precedingNegation = normalizedMarkdown.slice(Math.max(0, candidate.index - 60), candidate.index)
    // Explicitly rejected counterfactual quantities (for example, “1.98%
    // does not represent a 1.98 percentage-point increase”) are not numeric
    // claims. Skip only the value immediately governed by a bounded negation;
    // an earlier asserted value in the same sentence is still checked.
    if (/(?:不表示|不等于|不代表|并非|不是|不得称为|不能称为|不应称为|不应改称|不能改称|不得改写为|不应写为|不能写为|不能表述为)[^。；;\n]{0,36}$/.test(precedingNegation)) continue
    if (/第\s*$/.test(before) && /^[阶段项条节类次]/.test(after)) continue
    if (/^[、.：:)]/.test(after) && /(?:^|\n|\|)\s*$/.test(before)) continue
    if (/^[次个月周天日季度年]/.test(after) && /每|频率|监控|观察|建议/.test(context) && candidate.rawValue <= 12 && !candidate.magnitude) continue
    // 百万元与亿元之间的 factor is a fixed unit identity, not a company
    // quantity. Admit only the literal conversion explanation in this scope.
    if (candidate.rawValue === 100 && !candidate.magnitude && /(?:百万元\s*按\s*|按\s*百万元\s*)(?:(?:除以|÷)\s*)?100\s*(?:(?:再)?换算为\s*(?:[-+]?\d[\d,，]*(?:\.\d+)?\s*)?亿元)/.test(context)) continue
    if (candidate.rawValue === 100 && candidate.token.endsWith('百万元') && /每\s*100\s*百万元.{0,15}折合\s*1亿元/.test(context)) continue
    if (candidate.rawValue === 100000000 && !candidate.magnitude && /(?:人民币)?元换算亿元.{0,50}(?:除以|÷)\s*100,000,000|(?:除以|÷)\s*100,000,000.{0,50}(?:人民币)?元换算亿元/.test(context)) continue
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
    const currencyAmount = candidate.currencyScale !== undefined || candidate.magnitude || Boolean(sharedUnit || rowUnit)
    const rounded = (number: number): boolean => Math.abs(number - value) <= (currencyAmount ? Math.max(1e-6, rounding * 1.0001) : Math.max(Math.abs(number) * 1e-10, rounding * 1.0001))
    // Relative tolerances suitable for ratios become whole-currency errors on
    // large sales amounts (1e-10 of 18bn is 1.8). Currency facts use an exact
    // floating-point tolerance plus the separately computed display rounding.
    const exactCurrencyValue = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1e-6, Math.max(Math.abs(a), Math.abs(b)) * 1e-15)
    // Some official-report rows declare the monetary unit in the row label
    // immediately before the amount ("研发投入资本化的金额（元） 5,463...").
    // Preserve that same-row binding even when an excerpt packet's other
    // context causes the general unit inference to stay unset.
    const exactLocallyDeclaredUnit = candidate.currencyScale !== undefined && [...citedLines.values()].some(lines => [...lines.values()].some(line => {
      const localUnit = /[（(](?:人民币\s*)?(元|千元|万元|百万元|亿元|万亿)[）)]\s*/.exec(line)?.[1]
      return localUnit !== undefined && monetaryScales[localUnit] === candidate.currencyScale
        && numericTokens(line).some(source => !source.magnitude && exactCurrencyValue(source.rawValue, candidate.rawValue))
    }))
    const periodAfterToken = normalizedMarkdown.slice(candidate.index + candidate.token.length, candidate.index + candidate.token.length + 14)
    const preparedPeriodYearMatch = /^\d{4}$/.test(candidate.token)
      && ( /^\s*年(?:上半年|下半年|全年|同期|累计|末|度)/.test(periodAfterToken) || /^-\d{2}-\d{2}/.test(periodAfterToken) )
      && preparedFinancialPeriodYears.has(candidate.rawValue)
      && citedFinancialSourceIds.size > 0
    const preparedCashCycleSubtraction = isPreparedCashConversionCycleSubtraction(normalizedMarkdown, candidate, preparedCashCycles, availableCitedIds)
    const sourceMatch = preparedCashCycleSubtraction || sourceTokens.some((source) => {
      if (candidate.rateUnit && candidate.rateUnit !== source.rateUnit) return false
      const directMatch = candidate.currencyScale !== undefined
        ? source.currencyScale !== undefined && (exactCurrencyValue(source.value, candidate.value) || rounded(source.value))
        : candidate.magnitude || sharedUnit || rowUnit
          ? exactCurrencyValue(source.value, value) || rounded(source.value)
          : close(source.rawValue, candidate.rawValue, 1e-10) || close(source.value, value, 1e-10) || candidate.decimals > 0 && rounded(source.rawValue)
      if (directMatch) return true
      // A negative source cell may be rendered as a positive decrease
      // magnitude only when the report sentence explicitly states the
      // direction (e.g. source -26m, report "减少26m"). This prevents a
      // negative goodwill movement from being silently relabelled as an
      // increase or an unsigned amount.
      const explicitDecreaseMagnitude = candidate.rawValue >= 0
        && source.rawValue < 0
        && directionBefore(normalizedMarkdown, candidate.index) === -1
      if (!explicitDecreaseMagnitude) return false
      return candidate.currencyScale !== undefined
        ? source.currencyScale !== undefined && exactCurrencyValue(Math.abs(source.value), candidate.value)
        : candidate.magnitude || sharedUnit || rowUnit
          ? exactCurrencyValue(Math.abs(source.value), value) || rounded(Math.abs(source.value))
          : close(Math.abs(source.rawValue), candidate.rawValue, 1e-10) || close(Math.abs(source.value), value, 1e-10) || candidate.decimals > 0 && rounded(Math.abs(source.rawValue))
    }) || exactLocallyDeclaredUnit || preparedPeriodYearMatch
      || candidate.magnitude && citedExplicitYuanAmounts.some((amount) => rounded(amount / 1e8))
    const percentage = /^[%％]/.test(after)
    const directionalPercentagePointMatch = candidate.rateUnit === 'percentage_points'
      && candidate.rawValue >= 0
      && /(?:低于|低|下降|减少|降低|下滑|回落|收窄)\s*$/.test(normalizedMarkdown.slice(Math.max(0, candidate.index - 14), candidate.index))
      && percentagePointCalculations.some(value => value < 0 && rounded(Math.abs(value)))
    const computedMatch = candidate.rateUnit === 'percentage_points'
      ? percentagePointCalculations.some(rounded) || directionalPercentagePointMatch || formulaResults.some(result => result.rateUnit === 'percentage_points' && rounded(result.value))
      : candidate.rateUnit === 'percent'
        ? growthPercentCalculations.some(rounded) || calculated.some((number) => rounded(number) || rounded(number * 100)) || formulaResults.some(result => result.rateUnit === 'percent' && rounded(result.value))
        : calculated.some((number) => rounded(number) || percentage && rounded(number * 100)) || formulaResults.some(result => rounded(result.value))
          || citedBalanceSheetDifferences.some(change => {
            const start = Math.max(normalizedMarkdown.lastIndexOf('。', candidate.index), normalizedMarkdown.lastIndexOf('；', candidate.index), normalizedMarkdown.lastIndexOf(';', candidate.index), normalizedMarkdown.lastIndexOf('\n', candidate.index)) + 1
            const endCandidates = ['。', '；', ';', '\n'].map(separator => normalizedMarkdown.indexOf(separator, candidate.index)).filter(index => index >= 0)
            const sentence = normalizedMarkdown.slice(start, endCandidates.length ? Math.min(...endCandidates) : undefined)
            const attachedReferences = referencesAttachedToSentence(input.markdown, sentence)
            const citesExactRow = attachedReferences.has(`${change.sourceCandidateId}@paragraph:${change.paragraph}`)
            const namesAccount = sentence.includes(change.account)
            const citesPriorYearEnd = new RegExp(`较\\s*${change.currentYear - 1}\\s*年末`).test(sentence)
            const directionMatches = change.delta >= 0 ? /增加|上升|提高/.test(sentence) : /减少|下降|降低/.test(sentence)
            return citesExactRow && namesAccount && citesPriorYearEnd && directionMatches && rounded(change.delta)
          })
          || simpleFreeCashFlowDisplayValues.some((prepared) => {
            const displayRounding = 0.5 * 10 ** -candidate.decimals
            if (Math.abs(candidate.rawValue - prepared.value) > Math.max(1e-12, displayRounding * 1.0001)) return false
            const lineStart = normalizedMarkdown.lastIndexOf('\n', candidate.index) + 1
            const lineEnd = normalizedMarkdown.indexOf('\n', candidate.index)
            const line = normalizedMarkdown.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
            const periodYear = prepared.period.slice(0, 4)
            const periodMonth = Number(prepared.period.slice(5, 7))
            const hasExactPeriod = line.includes(prepared.period)
              || prepared.basis === 'YTD' && (
                periodMonth === 3 && new RegExp(`${periodYear}年(?:一季度|第一季度|1\s*季度)`).test(line)
                || periodMonth === 6 && new RegExp(`${periodYear}年(?:上半年|1\s*[-—至]\s*6月|1月至6月)`).test(line)
                || periodMonth === 9 && new RegExp(`${periodYear}年(?:前三季度|前三季|1\s*[-—至]\s*9月|1月至9月)`).test(line)
                // Chinese reports commonly write "2025年度" (without the
                // additional 年 in "2025年年度"). Accept both natural annual
                // forms while retaining the exact year and prepared period.
                || periodMonth === 12 && new RegExp(`${periodYear}(?:年(?:全年|全年度|度)?|年度|全年|全年度)`).test(line)
              )
              || preparedTableColumnHasPeriod(normalizedMarkdown, candidate, prepared.period, prepared.basis)
            const tokenUnit = candidate.magnitude ? candidate.token.match(/(万亿|亿元|百万元|万元|千元|元|亿|万|千)$/)?.[1] : undefined
            const tableUnit = declaredTableUnit(normalizedMarkdown, candidate)
            // Real reports often put units on the FCF row label (e.g.
            // "简化自由现金流（累计，亿元）") while period columns are in the
            // header. Accept that explicit row unit only on the corresponding
            // named FCF row; do not infer units from a generic neighboring row.
            const fcfRowLabel = line.split('|')[1]?.trim() ?? ''
            const rowUnit = /^简化自由现金流/.test(fcfRowLabel) ? /(?:百万元|亿元|万元|千元|元)/.exec(fcfRowLabel)?.[0] : undefined
            // Some generated financial tables put the period, cumulative basis,
            // and currency unit together in the value cell instead of the row
            // label or table header. Accept that unit only for the named simple
            // FCF row, and only when this same cell explicitly identifies the
            // prepared YTD period and cumulative basis.
            const cellIndex = line.slice(0, candidate.index - lineStart).split('|').length - 2
            const currentCell = /^\s*\|/.test(line) && cellIndex >= 1
              ? line.split('|').slice(1, -1)[cellIndex]?.trim() ?? ''
              : ''
            const cells = /^\s*\|/.test(line) ? line.split('|').slice(1, -1).map(cell => cell.trim()) : []
            const currentCellPeriod = currentCell.replace(/\s+/g, '').includes(prepared.period)
              || prepared.basis === 'YTD' && (
                periodMonth === 3 && new RegExp(`${periodYear}年(?:一季度|第一季度|1季度)`).test(currentCell.replace(/\s+/g, ''))
                || periodMonth === 6 && new RegExp(`${periodYear}年(?:上半年|1[-—至]6月|1月至6月)`).test(currentCell.replace(/\s+/g, ''))
                || periodMonth === 9 && new RegExp(`${periodYear}年(?:前三季度|前三季|1[-—至]9月|1月至9月)`).test(currentCell.replace(/\s+/g, ''))
                || periodMonth === 12 && new RegExp(`${periodYear}(?:年(?:全年|全年度|度)?|年度|全年|全年度)`).test(currentCell.replace(/\s+/g, ''))
              )
            const currentCellUnit = /^简化自由现金流/.test(fcfRowLabel)
              && prepared.basis === 'YTD'
              && currentCellPeriod
              && /累计/.test(currentCell)
              ? /(?:人民币\s*)?(百万元|亿元|万元|千元|元)/.exec(currentCell)?.[1]
              : undefined
            // Citation repair may append the source locator after the table's
            // closing pipe. A repeated FCF result in the formula column can
            // then lose the period carried by the dedicated result column.
            // Allow only that duplicate when the same row has the exact
            // prepared display result in its result cell, that cell's header
            // carries the prepared period, and the duplicate repeats the
            // exact display value with its explicit unit in a formula cell.
            const primaryFcfCell = cells[1] ?? ''
            const primaryFcfNumber = /^([+-]?\d[\d,，]*(?:\.\d+)?)$/.exec(primaryFcfCell.replace(/,/g, ''))?.[1]
            const resultPipe = line.indexOf('|', line.indexOf('|') + 1)
            const primaryNumberOffset = primaryFcfCell.match(/[+-]?\d[\d,，]*(?:\.\d+)?/)?.[0]
            const primaryNumberIndex = primaryNumberOffset && resultPipe >= 0
              ? lineStart + line.indexOf(primaryNumberOffset, resultPipe + 1)
              : -1
            const primaryFcfColumnHasPeriod = primaryNumberIndex >= 0
              && preparedTableColumnHasPeriod(normalizedMarkdown, { ...candidate, index: primaryNumberIndex }, prepared.period, prepared.basis)
            const exactFormulaDuplicate = /^简化自由现金流/.test(fcfRowLabel)
              && cellIndex > 1
              && /[=＝]/.test(currentCell)
              && tokenUnit === prepared.displayUnit
              && candidate.rawValue === Number(prepared.displayValue.replace(/,/g, ''))
              && Boolean(primaryFcfNumber)
              && primaryFcfCell.replace(/,/g, '') === prepared.displayValue.replace(/,/g, '')
              && rowUnit === prepared.displayUnit
              && primaryFcfColumnHasPeriod
            const declaredUnit = tokenUnit ?? rowUnit ?? (tableUnit && tableUnit !== null ? tableUnit : undefined) ?? currentCellUnit
            return (hasExactPeriod || exactFormulaDuplicate) && declaredUnit === prepared.displayUnit
              && (!candidate.currencyScale || candidate.currencyScale === monetaryScales[prepared.displayUnit])
          })
    if (!sourceMatch && !computedMatch) diagnostics.push({ code: 'UNSUPPORTED_NUMBER', token: candidate.token, value: candidate.value, context: context.trim(), reason: 'Number absent from cited paragraphs, trusted identity/cutoff, and deterministic prepared calculations.' })
  }
  return { status: diagnostics.length ? 'unsupported_numbers' : 'grounded', diagnostics }
}
function close(a: number, b: number, relative: number): boolean { return Math.abs(a - b) <= Math.max(1e-12, Math.max(Math.abs(a), Math.abs(b)) * relative) }

/** Bind an industry margin-change claim to its exact row, metric column and sign. */
function industryMarginAttributionDiagnostics(markdown: string, sources: readonly NormalizedResearchSource[], evidenceContexts: NumericGroundingInput['evidenceContexts']): NumericGroundingDiagnostic[] {
  const diagnostics: NumericGroundingDiagnostic[] = []
  const claimPattern = /毛利率(?:同比|比上年同期)(上升|增加|提高|下降|减少|降低)\s*([+-]?\d[\d,，]*(?:\.\d+)?)\s*(个百分点|[%％])/g
  // Some valid report prose gives both cells in the row as "margin level,
  // year-on-year change". Capture that form separately so the change is
  // still bound to the exact industry row instead of being accepted as an
  // arbitrary percentage-point claim.
  const levelAndChangePattern = /毛利率\s*([+-]?\d[\d,，]*(?:\.\d+)?)\s*[%％]\s*[、，,]\s*(?:同比|比上年同期)(上升|增加|提高|下降|减少|降低)\s*([+-]?\d[\d,，]*(?:\.\d+)?)\s*(个百分点|[%％])/g
  const claims = [
    ...[...markdown.matchAll(claimPattern)].map(match => ({
      index: match.index ?? 0,
      directionWord: match[1]!,
      change: match[2]!,
      unit: match[3]!,
      marginLevel: undefined as number | undefined,
      claimText: match[0],
    })),
    ...[...markdown.matchAll(levelAndChangePattern)].map(match => ({
      index: match.index ?? 0,
      directionWord: match[2]!,
      change: match[3]!,
      unit: match[4]!,
      marginLevel: Number(match[1]!.replace(/[,，]/g, '')),
      claimText: match[0],
    })),
  ].sort((a, b) => a.index - b.index)
  for (const claim of claims) {
    const claimIndex = claim.index
    const priorBoundary = Math.max(...['\n','。','；',';'].map(separator=>markdown.lastIndexOf(separator,claimIndex)))
    const nextBoundaries = ['\n','。','；',';'].map(separator=>markdown.indexOf(separator,claimIndex + claim.claimText.length)).filter(index=>index>=0)
    const delimiterIndex = nextBoundaries.length ? Math.min(...nextBoundaries) : -1
    const trailingCitations = delimiterIndex < 0 || !['。','；',';'].includes(markdown[delimiterIndex] ?? '') ? '' : /^\s*(?:\[[^\]]+\]\s*)*/.exec(markdown.slice(delimiterIndex + 1))?.[0] ?? ''
    const sentenceEnd = delimiterIndex < 0 ? markdown.length : delimiterIndex + 1 + trailingCitations.length
    const sentenceStartBase = priorBoundary + 1
    const leadingCitations = /^\s*(?:\[[^\]]+\]\s*)*/.exec(markdown.slice(sentenceStartBase,claimIndex))?.[0] ?? ''
    const sentenceStart = sentenceStartBase + leadingCitations.length
    const sentence = markdown.slice(sentenceStart, sentenceEnd)
    const rawLabelContext = markdown.slice(sentenceStart, claimIndex)
    // Strip only enumerated sentence/table framing used in method findings;
    // the remaining business label must still match the cited row verbatim.
    const labelContext = rawLabelContext.replace(/^(?:(?:事实|推断)\s*[：:]\s*)?(?:(?:19|20)\d{2}年(?:上半年|下半年|前三季度)?\s*)?(?:(?:半年度报告|半年度|半年报)\s*)?分(?:行业|产品)(?:表)?(?:报告|显示|披露|列示|中)?\s*[：，,]?\s*/, '')
    const requestedKind = /分产品/.test(rawLabelContext) ? 'product' : /分行业/.test(rawLabelContext) ? 'industry' : undefined
    const industryLabelMatch = /([\u3400-\u9fffA-Za-z0-9·（）()]{2,32}(?:制造业|行业))\s*$/.exec(labelContext)
    // Product rows do not consistently end in "行业/制造业". When a claim
    // explicitly names 分产品, bind its exact label from the table framing
    // through 毛利率 instead of allowing an equal-valued 分行业 row to lend
    // numeric support. Unscoped legacy industry claims retain their prior
    // industry-only contract.
    const productLabel = requestedKind === 'product'
      ? labelContext.replace(/^(?:19|20)\d{2}年(?:上半年|下半年|前三季度)?/, '').replace(/[\s，,:：]+$/g, '').trim()
      : ''
    if (requestedKind === 'product' && (!productLabel || productLabel.length < 4 || !/^[\u3400-\u9fff·（）()、]+$/.test(productLabel))) continue
    if (requestedKind !== 'product' && !industryLabelMatch) continue
    const label = (requestedKind === 'product' ? productLabel : industryLabelMatch![1]!.replace(/^(?:19|20)\d{2}年(?:上半年|下半年|前三季度)?/, '')).replace(/\s+/g, '')
    // Citation lists may follow the explanatory sentences at paragraph end.
    // Keep row attribution bounded to that same paragraph, then require the
    // exact named row, value, unit, period header and segment heading below;
    // an unrelated later paragraph cannot lend its row to this claim.
    const paragraphStart = markdown.lastIndexOf('\n', claimIndex) + 1
    const paragraphBoundary = markdown.indexOf('\n', claimIndex)
    const paragraphEnd = paragraphBoundary < 0 ? markdown.length : paragraphBoundary
    const paragraph = markdown.slice(paragraphStart, paragraphEnd)
    const refs = [...paragraph.matchAll(/\[([^\]]+)\]/g)].flatMap(ref => {
      const locator = /^(.+)@paragraph:(\d+)$/.exec(ref[1]!.trim())
      return locator ? [{ sourceCandidateId: locator[1]!, paragraph: Number(locator[2]!) }] : []
    })
    const direction = /上升|增加|提高/.test(claim.directionWord) ? 1 : -1
    const raw = Number(claim.change.replace(/[,，]/g, ''))
    const statedValue = raw < 0 ? raw : direction * raw
    let exactRowMatch = false
    for (const source of sources) {
      const paragraphs = [...new Set(refs.filter(ref => ref.sourceCandidateId === source.candidate.candidateId).map(ref => ref.paragraph))].sort((a, b) => a - b)
      if (!paragraphs.length) continue
      const cited = new Set(paragraphs)
      const lines = source.content.split(/\r?\n/)
      const citedLines = paragraphs.map(paragraph => ({ paragraph, text: lines[paragraph - 1] })).filter((row): row is { paragraph: number; text: string } => Boolean(row.text))
      const suppliedContexts = citedLines.flatMap(row => {
        const packet = evidenceContexts?.find(item => item.sourceCandidateId === source.candidate.candidateId)
        const excerpt = packet?.excerpts.find(item => item.location === `paragraph:${row.paragraph}` && item.text === row.text)
        return (excerpt?.contextLocations ?? []).flatMap(location => {
          const paragraph = Number(/^paragraph:(\d+)$/.exec(location)?.[1])
          const text = lines[paragraph - 1]
          const supplied = packet?.excerpts.find(item => item.location === location)
          return Number.isInteger(paragraph) && paragraph > 0 && paragraph < row.paragraph && row.paragraph - paragraph <= 32 && supplied?.text === text
            ? [{ paragraph, text }]
            : []
        })
      })
      const compactHeaders = [...citedLines, ...suppliedContexts].map(row => row.text).join('').replace(/\s+/g, '')
      const hasMarginHeader = /毛利率.{0,60}(?:同比|上年同期).{0,16}(?:增减|变动|变化)/.test(compactHeaders)
      if (!hasMarginHeader) continue
      for (const first of citedLines) {
        let rowText = first.text
        if (cited.has(first.paragraph + 1) && !/\d/.test(first.text)) rowText += ` ${lines[first.paragraph] ?? ''}`
        // Some Chinese filing parsers split an industry label over multiple
        // paragraphs before the numeric row (e.g. "计算机、通信和" / "其他电子" /
        // the row's values). Join only immediately preceding, cited label
        // fragments; stop at table headings, units, or any preceding numeric
        // row so another industry can never lend its label to this row.
        const precedingLabels: string[] = []
        for (let paragraph = first.paragraph - 1; paragraph > 0 && first.paragraph - paragraph <= 3; paragraph -= 1) {
          if (!cited.has(paragraph)) break
          const text = lines[paragraph - 1]?.trim() ?? ''
          if (!text || /\d|单位|营业收入|营业成本|毛利率|分行业|分产品|分地区|同期增减|增减/.test(text)) break
          precedingLabels.unshift(text)
        }
        if (precedingLabels.length) rowText = `${precedingLabels.join('')}${rowText}`
        // Preserve cell separators while joining PDF-wrapped row labels;
        // stripping spaces can turn "3.88% -2.67%" into a subtraction
        // expression and erase the disclosed negative sign.
        const normalizedRow = rowText.replace(/\s+/g, ' ')
        // Chinese filing parsers may split a long industry name across PDF
        // lines. Compare the label with whitespace removed, but keep the
        // numeric cells' separators intact so signs and percentage columns
        // remain distinguishable.
        const firstNumeric = normalizedRow.search(/\d/)
        if (firstNumeric < 0) continue
        const compactRowLabel = normalizedRow.slice(0, firstNumeric).replace(/\s+/g, '')
        const matchedLabel = requestedKind === 'product'
          ? (compactRowLabel === label ? label : undefined)
          : [label, label.replace(/行业$/, '')].find(variant => compactRowLabel.includes(variant))
        if (!matchedLabel) continue
        // PDF extraction may split a table's "分行业" heading into its own
        // paragraph, while the evidence packet supplies the exact header and
        // named data row but omits that classification line. Verify the
        // nearest segmentation heading in the acquired source itself, bounded
        // to the same nearby table; a later product/region section must never
        // lend its row to an industry claim.
        const nearestSection = lines.slice(Math.max(0, first.paragraph - 33), first.paragraph - 1)
          .map((text, index) => ({ text, paragraph: Math.max(0, first.paragraph - 33) + index + 1 }))
          .filter(row => /(?:^|\s)分(?:行业|产品|地区)(?:\s|$)/.test(row.text))
          .at(-1)
        const expectedHeading = requestedKind === 'product' ? '分产品' : '分行业'
        if (!nearestSection || !new RegExp(`(?:^|\\s)${expectedHeading}(?:\\s|$)`).test(nearestSection.text)) continue
        const rowRates = numericTokens(normalizedRow.slice(firstNumeric)).filter(token => token.rateUnit === 'percent')
        const marginChange = rowRates.at(-1)
        const marginLevelMatches = claim.marginLevel === undefined || rowRates.some(rate => close(rate.rawValue, claim.marginLevel!, 1e-10))
        const unitMatches = claim.unit === '个百分点'
          ? marginChange?.rateUnit === 'percentage_points'
          : marginChange?.rateUnit === 'percent'
        if (rowRates.length >= 2 && marginChange && unitMatches && marginLevelMatches && close(marginChange.rawValue, statedValue, 1e-10)) {
          exactRowMatch = true
          break
        }
      }
      if (exactRowMatch) break
    }
    if (!exactRowMatch) diagnostics.push({
      code: 'UNSUPPORTED_NUMBER',
      token: claim.change,
      value: statedValue,
      context: sentence.trim(),
      reason: `${requestedKind === 'product' ? 'Product' : 'Industry'} gross-margin change must match the final percentage cell, the exact cited ${label} row under the explicitly named classification, the complete margin-change header, and its disclosed direction; adjacent revenue/cost changes or a same-valued row from the other classification cannot substitute.`,
      })
  }
  return diagnostics
}

/** Bind explicit consolidated gross-margin comparisons to their prepared source rows. */
function consolidatedGrossMarginDiagnostics(markdown: string, prepared: unknown): NumericGroundingDiagnostic[] {
  const diagnostics: NumericGroundingDiagnostic[] = []
  const financial = prepared && typeof prepared === 'object' ? (prepared as Record<string, unknown>).financial : undefined
  const ratioChanges = financial && typeof financial === 'object' ? (financial as Record<string, unknown>).ratioChanges : undefined
  const preparedRows = Array.isArray(ratioChanges) ? ratioChanges.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === 'object' && (row as Record<string, unknown>).metric === 'grossMarginPercent')) : []
  for (const match of markdown.matchAll(/(?:合并|整体)(?:口径)?毛利率/g)) {
    const matchIndex = match.index ?? 0
    const start = markdown.lastIndexOf('\n', matchIndex) + 1
    const newline = markdown.indexOf('\n', matchIndex + match[0].length)
    const end = newline < 0 ? markdown.length : newline
    const paragraph = markdown.slice(start, end)
    const previousClaimBoundary = Math.max(...['。', '；', ';', '！', '？', '!', '?'].map(separator => paragraph.lastIndexOf(separator, matchIndex - start)))
    const claimStart = previousClaimBoundary + 1
    const followingClaimBoundaries = ['。', '；', ';', '！', '？', '!', '?'].map(separator => paragraph.indexOf(separator, matchIndex - start + match[0].length)).filter(index => index >= 0)
    const claimEnd = followingClaimBoundaries.length ? Math.min(...followingClaimBoundaries) : paragraph.length
    const claim = paragraph.slice(claimStart, claimEnd)
    if (/(?:不是|并非|不等于|不代表|不能称为|不得称为|不能替代|不足以替代)[^。；;\n]{0,24}(?:公司)?(?:合并|整体)(?:口径)?毛利率/.test(claim)) continue
    const percentValues = [...claim.matchAll(/([+-]?\d[\d,，]*(?:\.\d+)?)\s*[%％]/g)].map(item => Number(item[1]!.replace(/[,，]/g, '')))
    const pointValue = /百分点/.test(claim) ? [...claim.matchAll(/([+-]?\d[\d,，]*(?:\.\d+)?)\s*个百分点/g)].map(item => Number(item[1]!.replace(/[,，]/g, ''))).at(-1) : undefined
    if (percentValues.length < 2 && pointValue === undefined) continue
    const citedIds = new Set([...paragraph.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(item => item[1]!))
    const sectionCitedIds = new Set([...markdown.matchAll(/\[([^\]\s]+)@paragraph:\d+\]/g)].map(item => item[1]!))
    // Provider rows may include the period basis in the metric label, e.g.
    // “合并毛利率（半年累计，%）”. Keep the binding limited to a single
    // parenthetical qualifier containing the percent unit so unrelated
    // consolidated-margin mentions cannot turn a paragraph into a table row.
    const tableRow = /^\s*\|\s*(?:结构化)?合并毛利率(?:\s*[（(](?=[^（）()]{0,24}(?:[%％]|YTD|上半年|半年累计|季度|年度))[^（）()]{0,24}[）)])?\s*\|/im.test(paragraph)
    const tableRowIndex = tableRow ? markdown.indexOf(paragraph) : -1
    const tableLines = markdown.split('\n')
    const tableLineIndex = tableRowIndex < 0 ? -1 : markdown.slice(0, tableRowIndex).split('\n').length - 1
    // The table header can be several rows above a metric (R171 has four
    // preceding metric rows). Walk to the start of this contiguous Markdown
    // table, then require its header immediately before the separator row.
    let tableStart = tableLineIndex
    while (tableStart > 0 && /^\s*\|/.test(tableLines[tableStart - 1]!)) tableStart -= 1
    const separatorIndex = tableLineIndex < 0 ? -1 : tableLines.slice(tableStart, tableLineIndex).findIndex(line => /^\s*\|\s*:?-{3,}/.test(line)) + tableStart
    const rawHeaderLine = separatorIndex > 0 ? tableLines[separatorIndex - 1]! : ''
    // Citation/paragraph repair can join prose and the first table header on
    // one physical line. Recover only the Markdown-table suffix immediately
    // before the separator; period binding below still requires unique exact
    // column matches and matching numeric cells.
    const headerPipe = /^\s*\|/.test(rawHeaderLine) ? 0 : rawHeaderLine.indexOf('|')
    const headerLine = headerPipe >= 0 ? rawHeaderLine.slice(headerPipe) : ''
    const tableCells = tableLineIndex < 0 ? [] : tableLines[tableLineIndex]!.split('|').slice(1, -1).map(cell => cell.trim())
    const headerCells = headerLine.split('|').slice(1, -1).map(cell => cell.trim())
    const exactPreparedRow = preparedRows.some(row => {
      const sourceIds = Array.isArray(row.sourceCandidateIds) ? row.sourceCandidateIds : []
      const directSourceBinding = sourceIds.length > 0 && sourceIds.every(id => typeof id === 'string' && citedIds.has(id))
      const tableSourceBinding = tableRow && sourceIds.length > 0 && sourceIds.every(id => typeof id === 'string' && sectionCitedIds.has(id))
      if (!directSourceBinding && !tableSourceBinding) return false
      const current = row.currentValue
      const prior = row.priorValue
      const change = row.changePercentagePoints
      if (typeof current !== 'number' || !Number.isFinite(current) || typeof prior !== 'number' || !Number.isFinite(prior) || typeof change !== 'number' || !Number.isFinite(change)) return false
      const displayMatches = (value: number, displayed: number) => Math.abs(value - displayed) <= Math.max(0.005001, Math.abs(value) * 1e-10)
      const hasBothLevels = percentValues.some(value => displayMatches(current, value)) && percentValues.some(value => displayMatches(prior, value))
      const hasExactChange = pointValue !== undefined && (displayMatches(change, pointValue) || typeof row.displayChangePercentagePoints === 'number' && displayMatches(row.displayChangePercentagePoints, pointValue))
      if (!hasBothLevels && !(!tableRow && percentValues.length < 2 && hasExactChange)) return false
      const calculated = current - prior
      if (Math.abs(calculated - change) > Math.max(1e-10, Math.abs(calculated) * 1e-10)) return false
      if (tableRow) {
        const currentPeriod = typeof row.currentPeriod === 'string' ? row.currentPeriod : ''
        const priorPeriod = typeof row.priorPeriod === 'string' ? row.priorPeriod : ''
        const currentYear = currentPeriod.slice(0, 4)
        const priorYear = priorPeriod.slice(0, 4)
        // The comparable period may be stated in its value cell instead of
        // the generic column header (R175: 可比期间 / 18.01%（2025年上半年）).
        // Use only that column's explicit period annotation, never a year
        // elsewhere in the table or a different metric's row.
        const columnPeriod = (index: number): string => `${headerCells[index] ?? ''} ${(tableCells[index] ?? '').match(/[（(][^（）()]*[12]\d{3}[^（）()]*[）)]/g)?.join(' ') ?? ''}`
        const matchesPeriod = (index: number, period: string, year: string): boolean => {
          const context = columnPeriod(index)
          const years = [...context.matchAll(/(?<!\d)([12]\d{3})(?!\d)/g)].map(item => item[1]!)
          if (!year || !years.length || years.some(value => value !== year)) return false
          if (/06-30$/.test(period)) return /上半年|半年累计|06-30|6月(?:30日|末)/.test(context)
            && !/单季|第二季度|本季度|Q2|全年|年度/i.test(context)
          // An explicit half-year annotation cannot label a different prepared period.
          return !/上半年|半年累计|06-30|6月(?:30日|末)/.test(context)
        }
        const priorColumns = headerCells.flatMap((_cell, index) => index > 0 && matchesPeriod(index, priorPeriod, priorYear) ? [index] : [])
        const currentColumns = headerCells.flatMap((_cell, index) => index > 0 && matchesPeriod(index, currentPeriod, currentYear) ? [index] : [])
        const priorColumn = priorColumns.length === 1 ? priorColumns[0]! : -1
        const currentColumn = currentColumns.length === 1 ? currentColumns[0]! : -1
        const hasOrderedPeriods = headerCells.length >= 3 && priorColumn > 0 && currentColumn > 0 && priorColumn !== currentColumn
        const cellNumber = (cell: string | undefined) => {
          const value = cell?.match(/[+-]?\d[\d,，]*(?:\.\d+)?/)?.[0]
          return value === undefined ? Number.NaN : Number(value.replace(/[,，]/g, ''))
        }
        const rowPrior = cellNumber(tableCells[priorColumn])
        const rowCurrent = cellNumber(tableCells[currentColumn])
        const hasPeriodColumns = hasOrderedPeriods && displayMatches(prior, rowPrior) && displayMatches(current, rowCurrent)
        // A compact table may place both explicit ISO periods and their values
        // in one comparison cell (for example, “2026-06-30为18.85%，
        // 2025-06-30为18.01%”). Accept this only when each prepared period is
        // uniquely paired with its exact prepared value in that same cell;
        // years elsewhere in the row or section cannot satisfy the binding.
        const comparisonCell = tableCells.length === 2 ? tableCells[1] ?? '' : ''
        const labeledPeriodValues = [...comparisonCell.matchAll(/(?<!\d)(\d{4}-\d{2}-\d{2})\s*(?:为|[:：=＝])\s*([+-]?\d[\d,，]*(?:\.\d+)?)\s*[%％]/g)]
          .map(match => ({ period: match[1]!, value: Number(match[2]!.replace(/[,，]/g, '')) }))
        const matchesLabeledPeriod = (period: string, expected: number): boolean => {
          const matches = labeledPeriodValues.filter(item => item.period === period)
          return matches.length === 1 && displayMatches(expected, matches[0]!.value)
        }
        const hasExplicitPeriodValues = currentPeriod !== priorPeriod
          && matchesLabeledPeriod(currentPeriod, current)
          && matchesLabeledPeriod(priorPeriod, prior)
        if (!hasPeriodColumns && !hasExplicitPeriodValues) return false
      }
      return pointValue === undefined || displayMatches(calculated, pointValue)
        || typeof row.displayChangePercentagePoints === 'number' && displayMatches(row.displayChangePercentagePoints, pointValue)
    })
    if (!exactPreparedRow) diagnostics.push({
      code: 'UNSUPPORTED_NUMBER',
      token: '合并毛利率比较',
      value: pointValue ?? 0,
      context: paragraph.trim(),
      reason: 'A quantified consolidated gross-margin comparison must cite every exact structured source used by one prepared grossMarginPercent ratio-change row; both displayed period operands and the percentage-point change must match that row.',
    })
  }
  return diagnostics
}

const REPORT_CURRENCY_CONVENTION = /除(?:有)?特别说明外[^。；;\n]{0,80}?(?:均以|均按|以|按)\s*(?:人民币\s*)?(?:万亿|亿元|百万元|万元|千元|元)\s*为单位表示/

function isVerifiedGoodwillTableRow(content: string, paragraph: number): boolean {
  const lines = content.split(/\r?\n/)
  const start = Math.max(0, paragraph - 40)
  const preceding = lines.slice(start, paragraph - 1)
  const goodwillHeading = preceding.reduce((last, line, index) => /^(?:（[12]）\s*)?商誉(?:原值|减值准备)?$|^\d+[、.]\s*商誉$/.test(line.trim()) ? index : last, -1)
  if (goodwillHeading < 0) return false
  return preceding.slice(goodwillHeading + 1).some(line => /年初余额.*年末余额/.test(line))
}

/** Only an explicit, arithmetically valid equation can ground a derived inline result. */
function inlineFormulaResults(text: string): { readonly value: number; readonly rateUnit?: NumericToken['rateUnit'] }[] {
  const number = '[-−]?[\\d,，]+(?:\\.\\d+)?'
  const currency = '(?:人民币|RMB|CNY)?\\s*'
  const unit = '(亿元|万元|元|个百分点|[%％])'
  const label = '[\\u3400-\\u9fff（）()A-Za-z ]{0,24}?'
  const formula = new RegExp(`${currency}(${number})\\s*${unit}\\s*${label}([+＋\\-−－])\\s*${label}${currency}(${number})\\s*${unit}\\s*${label}[=＝]\\s*${currency}(${number})\\s*${unit}`, 'g')
  const multiplier: Record<string, number> = { '亿元': 1e8, '万元': 1e4, '元': 1, '个百分点': 1, '%': 1, '％': 1 }
  const results: { value: number; rateUnit?: NumericToken['rateUnit'] }[] = []
  for (const match of text.matchAll(formula)) {
    const left = Number(match[1]!.replace(/[,，]/g, '').replace('−', '-'))
    const right = Number(match[4]!.replace(/[,，]/g, '').replace('−', '-'))
    const stated = Number(match[6]!.replace(/[,，]/g, '').replace('−', '-'))
    const unitName = match[2]!
    if (match[5] !== unitName || match[7] !== unitName) continue
    const expected = (match[3] === '+' || match[3] === '＋' ? left + right : left - right)
    const tolerance = Math.max(0.5 * 10 ** -(match[6]!.split('.')[1]?.length ?? 0), Math.abs(expected) * 1e-10)
    if (Math.abs(expected - stated) <= tolerance) results.push({ value: stated * multiplier[unitName]!, ...(unitName === '个百分点' ? { rateUnit: 'percentage_points' as const } : /[%％]/.test(unitName) ? { rateUnit: 'percent' as const } : {}) })
  }
  // Explicit growth-rate spread: the operands are percentages, while their
  // subtraction is a percentage-point result. Accept both a plain second
  // operand and a parenthesized one; exact cited source matching still grounds
  // each operand independently, so a raw change-column cell cannot substitute.
  const direction = '(上升|增加|提高|下降|减少|降低)?'
  const growthSpread = new RegExp(`(?:\\d{4}年\\s*)?(${number})\\s*[%％]\\s*[−-]\\s*(?:\\(\\s*(?:\\d{4}年\\s*)?(${number})\\s*[%％]\\s*\\)|(?:\\d{4}年\\s*)?(${number})\\s*[%％])\\s*[=＝]\\s*${direction}\\s*(${number})\\s*个百分点`, 'g')
  for (const match of text.matchAll(growthSpread)) {
    const left = Number(match[1]!.replace(/[,，]/g, '').replace('−', '-'))
    const right = Number((match[2] ?? match[3])!.replace(/[,，]/g, '').replace('−', '-'))
    const stated = Number(match[5]!.replace(/[,，]/g, '').replace('−', '-'))
    const expected = left - right
    const tolerance = Math.max(0.5 * 10 ** -(match[5]!.split('.')[1]?.length ?? 0), Math.abs(expected) * 1e-10)
    const directionMatches = !match[4] || (/上升|增加|提高/.test(match[4]) ? stated >= 0 : stated <= 0)
    if (directionMatches && Math.abs(expected - stated) <= tolerance) results.push({ value: stated, rateUnit: 'percentage_points' })
  }
  // Some semantic outputs state the operands after a named formula, then put
  // the result after Chinese prose ("本期比例−上期比例，即 A%−B%，为 C 个百分点").
  // Keep the arithmetic explicit and validate the same operands/result rather
  // than accepting a nearby disclosed change-column value as the calculation.
  const growthSpreadProse = new RegExp(`(?:本期比例\s*[−-]\s*上期比例|两年比例水平差)[^。；]{0,24}?(?:即|为)\s*(?:\\d{4}年\s*)?(${number})\s*[%％]\s*[−-]\s*(?:\\d{4}年\s*)?(${number})\s*[%％]\s*(?:[,，、]?\s*(?:为|结果为))\s*${direction}\s*(${number})\s*个百分点`, 'g')
  for (const match of text.matchAll(growthSpreadProse)) {
    const left = Number(match[1]!.replace(/[,，]/g, '').replace('−', '-'))
    const right = Number(match[2]!.replace(/[,，]/g, '').replace('−', '-'))
    const stated = Number(match[4]!.replace(/[,，]/g, '').replace('−', '-'))
    const expected = left - right
    const tolerance = Math.max(0.5 * 10 ** -(match[4]!.split('.')[1]?.length ?? 0), Math.abs(expected) * 1e-10)
    const directionMatches = !match[3] || (/上升|增加|提高/.test(match[3]) ? stated >= 0 : stated <= 0)
    if (directionMatches && Math.abs(expected - stated) <= tolerance) results.push({ value: stated, rateUnit: 'percentage_points' })
  }
  // Also accept the explicitly labelled algebraic form required by the
  // capital-allocation method: "本期比例−上期比例＝2025年A%−2024年B%=C个百分点".
  const labelledGrowthSpread = new RegExp(`本期比例\s*[−-]\s*上期比例\s*[=＝]\s*(?:\\d{4}年\s*)?(${number})\s*[%％]\s*[−-]\s*(?:\\d{4}年\s*)?(${number})\s*[%％]\s*(?:[=＝]|[,，、]?\s*(?:即|为)(?:为)?)\s*${direction}\s*(${number})\s*个百分点`, 'g')
  for (const match of text.matchAll(labelledGrowthSpread)) {
    const left = Number(match[1]!.replace(/[,，]/g, '').replace('−', '-'))
    const right = Number(match[2]!.replace(/[,，]/g, '').replace('−', '-'))
    const stated = Number(match[4]!.replace(/[,，]/g, '').replace('−', '-'))
    const expected = left - right
    const tolerance = Math.max(0.5 * 10 ** -(match[4]!.split('.')[1]?.length ?? 0), Math.abs(expected) * 1e-10)
    const directionMatches = !match[3] || (/上升|增加|提高/.test(match[3]) ? stated >= 0 : stated <= 0)
    if (directionMatches && Math.abs(expected - stated) <= tolerance) results.push({ value: stated, rateUnit: 'percentage_points' })
  }
  return results
}
