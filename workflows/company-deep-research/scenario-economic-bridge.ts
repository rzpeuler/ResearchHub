/** Pure fixture-only economic accounting bridge. No source or qualification authority. */
import { hashCanonicalScenarioValue } from './scenario-method-validation.ts'
import type {
  EconomicBridgeComponent,
  EconomicBridgeDiagnostic,
  EconomicBridgeInput,
  EconomicBridgeResult,
  EconomicBridgeScalar,
} from './scenario-method-contracts.ts'

type AnyRecord = Record<string, unknown>
const FORMULA = 'economic-bridge-fixture-v1'
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
const isRecord = (v: unknown): v is AnyRecord => v !== null && typeof v === 'object' && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const evidenceRefsOf = (v: unknown): string[] => isRecord(v) && Array.isArray(v.evidenceRefs) ? v.evidenceRefs.filter(nonEmpty) : []

function canonicalBridgeInput(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const revenue = isRecord(raw.revenue) ? raw.revenue : undefined
  const profit = isRecord(raw.profit) ? raw.profit : undefined
  const fcff = isRecord(raw.fcff) ? raw.fcff : undefined
  return {
    ...raw,
    ...(revenue ? { revenue: { ...revenue,
      ...(Array.isArray(revenue.lines) ? { lines: [...revenue.lines].sort((a, b) => compare(String((a as AnyRecord)?.lineId), String((b as AnyRecord)?.lineId))) } : {}),
      ...(Array.isArray(revenue.adjustments) ? { adjustments: [...revenue.adjustments].sort((a, b) => compare(String((a as AnyRecord)?.adjustmentId), String((b as AnyRecord)?.adjustmentId))) } : {}),
    } } : {}),
    ...(profit ? { profit: { ...profit,
      ...(Array.isArray(profit.operatingExpenses) ? { operatingExpenses: [...profit.operatingExpenses].sort((a, b) => compare(String((a as AnyRecord)?.accountId), String((b as AnyRecord)?.accountId))) } : {}),
      ...(Array.isArray(profit.otherOperatingIncome) ? { otherOperatingIncome: [...profit.otherOperatingIncome].sort((a, b) => compare(String((a as AnyRecord)?.accountId), String((b as AnyRecord)?.accountId))) } : {}),
      ...(Array.isArray(profit.nonRecurringItems) ? { nonRecurringItems: [...profit.nonRecurringItems].sort((a, b) => compare(String((a as AnyRecord)?.adjustmentId), String((b as AnyRecord)?.adjustmentId))) } : {}),
    } } : {}),
    ...(fcff ? { fcff: { ...fcff,
      ...(Array.isArray(fcff.nwcStart) ? { nwcStart: [...fcff.nwcStart].sort((a, b) => compare(String((a as AnyRecord)?.accountId ?? (a as AnyRecord)?.sourceId), String((b as AnyRecord)?.accountId ?? (b as AnyRecord)?.sourceId))) } : {}),
      ...(Array.isArray(fcff.nwcEnd) ? { nwcEnd: [...fcff.nwcEnd].sort((a, b) => compare(String((a as AnyRecord)?.accountId ?? (a as AnyRecord)?.sourceId), String((b as AnyRecord)?.accountId ?? (b as AnyRecord)?.sourceId))) } : {}),
    } } : {}),
    ...(Array.isArray(raw.calibrationProposals) ? { calibrationProposals: [...raw.calibrationProposals].sort((a, b) => compare(String((a as AnyRecord)?.scenario), String((b as AnyRecord)?.scenario)) || compare(String((a as AnyRecord)?.driverId), String((b as AnyRecord)?.driverId))) } : {}),
  }
}

function evidenceNumber(value: unknown, subjectId: string, diagnostics: EconomicBridgeDiagnostic[]): number | undefined {
  if (!isRecord(value) || typeof value.status !== 'string') {
    diagnostics.push({ code: 'MISSING_REQUIRED_OPERAND', subjectId, reason: 'numeric evidence is malformed or missing' })
    return undefined
  }
  if (value.status === 'UNAVAILABLE' || value.status === 'NOT_APPLICABLE') {
    diagnostics.push({ code: 'MISSING_REQUIRED_OPERAND', subjectId, reason: `${value.status} cannot be used as numeric zero or as a required operand` })
    return undefined
  }
  if (value.status === 'KNOWN_ZERO') {
    if (value.value !== 0 || !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0 || !value.evidenceRefs.every(nonEmpty)) {
      diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId, reason: 'KNOWN_ZERO requires exact numeric zero and non-empty evidence refs' })
      return undefined
    }
    return 0
  }
  if (value.status !== 'KNOWN' || typeof value.value !== 'number' || !Number.isFinite(value.value) || !Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0 || !value.evidenceRefs.every(nonEmpty)) {
    diagnostics.push({ code: typeof value.value === 'number' && !Number.isFinite(value.value) ? 'INVALID_NUMBER' : 'INVALID_STRUCTURE', subjectId, reason: 'KNOWN requires a finite number and non-empty evidence refs' })
    return undefined
  }
  return value.value
}

function unavailable(formulaVersion: string, reason: string, lineageIds: readonly string[] = []): EconomicBridgeComponent {
  return { status: 'UNAVAILABLE', formulaVersion, lineageIds: [...lineageIds].sort(compare), reason }
}
function known(value: number, formulaVersion: string, lineageIds: readonly string[]): EconomicBridgeComponent {
  if (!Number.isFinite(value)) return unavailable(formulaVersion, 'calculation overflowed or produced a non-finite value', lineageIds)
  return { status: 'KNOWN', value, formulaVersion, lineageIds: [...lineageIds].sort(compare) }
}
function add(a: number, b: number): number | undefined { const n = a + b; return Number.isFinite(n) ? n : undefined }
function subtract(a: number, b: number): number | undefined { const n = a - b; return Number.isFinite(n) ? n : undefined }
function samePeriod(a: EconomicBridgeScalar, b: EconomicBridgeScalar): boolean { return a.periodStart === b.periodStart && a.periodEnd === b.periodEnd && a.periodBasis === b.periodBasis }
function sameScope(a: EconomicBridgeScalar, b: EconomicBridgeScalar): boolean { return a.companySymbol === b.companySymbol && a.financialScope === b.financialScope && a.economicScope === b.economicScope }
function sameCurrency(a: EconomicBridgeScalar, b: EconomicBridgeScalar): boolean { return a.currency === b.currency && a.unit === b.unit && a.dimension === b.dimension && a.shareBasis === b.shareBasis }
type CivilDate = { year: number; month: number; day: number }
function parseCivilDate(value: unknown): CivilDate | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10))
  if (year < 1 || year > 9999 || month < 1 || month > 12) return undefined
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day >= 1 && day <= days[month - 1]! ? { year, month, day } : undefined
}
function previousCivilDate(value: unknown): string | undefined {
  const date = parseCivilDate(value)
  if (!date) return undefined
  if (date.day > 1) return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day - 1).padStart(2, '0')}`
  const year = date.month === 1 ? date.year - 1 : date.year
  const month = date.month === 1 ? 12 : date.month - 1
  if (year < 1) return undefined
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(days[month - 1]!).padStart(2, '0')}`
}
function validatePair(a: EconomicBridgeScalar, b: EconomicBridgeScalar, subject: string, diagnostics: EconomicBridgeDiagnostic[]): boolean {
  let valid = true
  if (!samePeriod(a, b)) { diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId: subject, reason: 'period start/end/basis differ' }); valid = false }
  if (!sameScope(a, b)) { diagnostics.push({ code: 'SCOPE_MISMATCH', subjectId: subject, reason: 'economic or financial scope differs' }); valid = false }
  if (!sameCurrency(a, b)) { diagnostics.push({ code: 'UNIT_MISMATCH', subjectId: subject, reason: 'native unit, scale, dimension, or currency differs; no conversion is applied' }); valid = false }
  if (a.flowOrStock !== b.flowOrStock) { diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId: subject, reason: 'flow and stock measures cannot be combined' }); valid = false }
  return valid
}
function scalar(value: EconomicBridgeScalar | null | undefined, id: string, diagnostics: EconomicBridgeDiagnostic[]): number | undefined {
  if (!value || !isRecord(value)) { diagnostics.push({ code: 'MISSING_REQUIRED_OPERAND', subjectId: id, reason: 'required scalar is missing' }); return undefined }
  if (!nonEmpty(value.sourceId) || !nonEmpty(value.companySymbol) || !nonEmpty(value.metricId) || !nonEmpty(value.unit) || !nonEmpty(value.financialScope) || !nonEmpty(value.economicScope) || !nonEmpty(value.periodStart) || !nonEmpty(value.periodEnd) || !nonEmpty(value.periodBasis)) {
    diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: id, reason: 'scalar identity, scope, unit, and period fields are required' }); return undefined
  }
  if (!['CURRENCY_AMOUNT', 'CURRENCY_PER_UNIT', 'COUNT', 'RATE', 'CURRENCY_AMOUNT_PER_PERIOD'].includes(value.dimension) || !['FLOW', 'STOCK', 'RATE', 'COUNT'].includes(value.flowOrStock) || !parseCivilDate(value.periodStart) || !parseCivilDate(value.periodEnd)) {
    diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: id, reason: 'scalar dimension, flow/stock kind, and period dates must be valid' }); return undefined
  }
  if (/\bEPS\b|PER_SHARE/i.test(value.metricId)) { diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: id, reason: 'per-share EPS cannot substitute for an income statement amount or NCI' }); return undefined }
  return evidenceNumber(value.value, id, diagnostics)
}
function checkBaseScalar(input: EconomicBridgeInput): EconomicBridgeDiagnostic[] {
  const d: EconomicBridgeDiagnostic[] = []
  if (input.mode !== 'FIXTURE_ONLY' || !nonEmpty(input.companySymbol) || !nonEmpty(input.bridgeId) || !nonEmpty(input.formulaVersion) || !nonEmpty(input.analysisAsOf)) d.push({ code: 'INVALID_STRUCTURE', subjectId: 'input', reason: 'fixture mode, company, bridge, formula version, and asOf are required' })
  const times = input.sourceTimeClaims
  if (!isRecord(times)) d.push({ code: 'INVALID_STRUCTURE', subjectId: 'sourceTimeClaims', reason: 'independent source timestamps are required as fixture claims' })
  else {
    const cutoff = Date.parse(input.analysisAsOf)
    for (const key of ['sourcePublishedAt', 'valueVersionAvailableAt', 'snapshotCapturedAt', 'snapshotSealedAt'] as const) {
      const t = times[key]
      if (t !== null && (typeof t !== 'string' || !Number.isFinite(Date.parse(t)))) d.push({ code: 'INVALID_STRUCTURE', subjectId: key, reason: 'timestamp claim must be null or parseable ISO time' })
      if (typeof t === 'string' && Number.isFinite(cutoff) && Date.parse(t) > cutoff) d.push({ code: 'PERIOD_MISMATCH', subjectId: key, reason: 'timestamp claim is later than analysisAsOf; fixture claim is not trusted proof' })
    }
    if (times.retrievedAt !== null && (typeof times.retrievedAt !== 'string' || !Number.isFinite(Date.parse(times.retrievedAt)))) d.push({ code: 'INVALID_STRUCTURE', subjectId: 'retrievedAt', reason: 'timestamp claim must be null or parseable ISO time' })
    if (times.snapshotCapturedAt && times.snapshotSealedAt && Date.parse(times.snapshotCapturedAt) > Date.parse(times.snapshotSealedAt)) d.push({ code: 'PERIOD_MISMATCH', subjectId: 'snapshotCapturedAt', reason: 'snapshot capture must not follow seal' })
  }
  const seen = new Set<object>()
  const scan = (value: unknown, path: string): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (isRecord(value) && 'companySymbol' in value && value.companySymbol !== input.companySymbol) d.push({ code: 'SCOPE_MISMATCH', subjectId: path, reason: 'company symbol differs from bridge company' })
    if (Array.isArray(value)) value.forEach((item, i) => scan(item, `${path}[${i}]`))
    else if (isRecord(value)) Object.keys(value).sort(compare).forEach((key) => scan(value[key], `${path}.${key}`))
  }
  scan(input, 'input')
  return d
}

/** Returns arithmetic diagnostics and fixture-only component values; it never qualifies evidence. */
function calculateEconomicBridgeCore(raw: EconomicBridgeInput): EconomicBridgeResult {
  const diagnostics: EconomicBridgeDiagnostic[] = []
  let inputHash = 'UNAVAILABLE'
  try { inputHash = hashCanonicalScenarioValue(canonicalBridgeInput(raw)) } catch { diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: 'inputHash', reason: 'input is not canonical finite JSON; no input hash available' }) }
  if (!isRecord(raw)) {
    return { status: 'UNAVAILABLE', reportEligible: false, inputHash, bridgeHash: 'UNAVAILABLE', components: {}, residual: unavailable(FORMULA, 'malformed top-level input'), cashFlowDifference: unavailable(FORMULA, 'malformed top-level input'), assumptionReviewStatus: 'REVIEW_REQUIRED', diagnostics: [{ code: 'INVALID_STRUCTURE', subjectId: 'input', reason: 'input must be a plain object' }] }
  }
  const input = raw as unknown as EconomicBridgeInput
  diagnostics.push(...checkBaseScalar(input))
  const components: Record<string, EconomicBridgeComponent> = {}
  const revenueLines = Array.isArray(input.revenue?.lines) ? [...input.revenue.lines].sort((a, b) => compare(String(a?.lineId), String(b?.lineId))) : []
  const lineIds = new Set<string>(), economicKeys = new Set<string>()
  let revenueValid = true
  let calculatedRevenue = 0
  const revenueRefs: string[] = []
  for (const line of revenueLines) {
    if (!isRecord(line) || !nonEmpty(line.lineId) || !nonEmpty(line.economicLineKey) || line.bridgeId !== input.bridgeId || line.companySymbol !== input.companySymbol || line.scenario !== input.horizon?.scenario) { diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: String(line?.lineId ?? 'revenue-line'), reason: 'line identity/company/bridge/scenario mismatch' }); revenueValid = false; continue }
    const lineRefsValid = Array.isArray(line.inputRefs) && line.inputRefs.length > 0 && line.inputRefs.every(nonEmpty) && Array.isArray(line.evidenceRefs) && line.evidenceRefs.length > 0 && line.evidenceRefs.every(nonEmpty) && nonEmpty(line.formulaVersion) && line.formulaVersion === input.formulaVersion
    if (!lineRefsValid) { diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: line.lineId, reason: 'lineage refs and formulaVersion must be non-empty' }); revenueValid = false }
    if (lineIds.has(line.lineId) || (line.disposition === 'INCLUDED_ONCE' && economicKeys.has(line.economicLineKey))) { diagnostics.push({ code: 'DOUBLE_COUNTED_REVENUE_PATH', subjectId: line.lineId, reason: 'duplicate line ID or overlapping economic line key' }); revenueValid = false }
    lineIds.add(line.lineId); economicKeys.add(line.economicLineKey)
    if (line.periodStart !== input.horizon.periodStart || line.periodEnd !== input.horizon.periodEnd || line.periodBasis !== input.horizon.periodBasis) { diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId: line.lineId, reason: 'revenue line does not match bridge horizon' }); revenueValid = false }
    if (line.financialScope !== input.revenue.reportedConsolidatedRevenue?.financialScope || line.economicScope !== input.revenue.reportedConsolidatedRevenue?.economicScope) { diagnostics.push({ code: 'SCOPE_MISMATCH', subjectId: line.lineId, reason: 'revenue line scope differs from reported total' }); revenueValid = false }
    if (line.currency !== input.revenue.reportedConsolidatedRevenue?.currency || line.unit !== input.revenue.reportedConsolidatedRevenue?.unit || line.dimension !== input.revenue.reportedConsolidatedRevenue?.dimension || line.shareBasis !== input.revenue.reportedConsolidatedRevenue?.shareBasis) { diagnostics.push({ code: 'UNIT_MISMATCH', subjectId: line.lineId, reason: 'revenue line currency, native unit/scale, dimension, or share basis differs from reported total' }); revenueValid = false }
    if (line.disposition === 'INCLUDED_ONCE' && (line.flowOrStock !== 'FLOW' || line.dimension !== 'CURRENCY_AMOUNT' || line.toMetric !== 'revenue' || line.operation !== 'ADD' || line.fromMetric !== 'segmentRevenue')) { diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: line.lineId, reason: 'included disclosed revenue must be a FLOW currency amount added from segmentRevenue to revenue' }); revenueValid = false }
    if (line.disposition === 'INCLUDED_ONCE' && line.originKind !== 'FACT' && line.originKind !== 'DERIVED') { diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: line.lineId, reason: 'revenue inclusion requires FACT or DERIVED identity; inference/assumption cannot become disclosed revenue' }); revenueValid = false }
    if (line.disposition === 'INCLUDED_ONCE' && input.revenue.selectedRoute !== 'DISCLOSED_SEGMENT_REVENUE') { diagnostics.push({ code: 'DOUBLE_COUNTED_REVENUE_PATH', subjectId: line.lineId, reason: 'segment amounts cannot be included on the volume-times-ASP route' }); revenueValid = false }
    if (line.disposition === 'INCLUDED_ONCE') {
      const amount = evidenceNumber(line.amount, line.lineId, diagnostics)
      if (amount === undefined) revenueValid = false
      else { const next = add(calculatedRevenue, amount); if (next === undefined) { diagnostics.push({ code: 'INVALID_NUMBER', subjectId: line.lineId, reason: 'revenue sum overflow' }); revenueValid = false } else calculatedRevenue = next }
      revenueRefs.push(line.lineId, ...(line.inputRefs as string[]), ...(line.evidenceRefs as string[]), ...evidenceRefsOf(line.amount))
    }
  }
  if (input.revenue?.selectedRoute === 'DISCLOSED_SEGMENT_REVENUE' && !revenueLines.some((l) => l?.disposition === 'INCLUDED_ONCE')) {
    diagnostics.push({ code: 'MISSING_REQUIRED_OPERAND', subjectId: 'revenue.lines', reason: 'disclosed segment route requires at least one evidenced included row; empty rows are not zero revenue' })
    revenueValid = false
  }
  if (input.revenue?.selectedRoute === 'RECOGNIZED_VOLUME_TIMES_REALIZED_NET_ASP') {
    if (revenueLines.some((l) => l?.disposition === 'INCLUDED_ONCE')) { diagnostics.push({ code: 'DOUBLE_COUNTED_REVENUE_PATH', subjectId: 'revenue.route', reason: 'segment revenue rows cannot also be counted with volume times net ASP' }); revenueValid = false }
    const v = input.revenue.volume, asp = input.revenue.realizedNetAsp
    const vn = scalar(v, 'revenue.volume', diagnostics), an = scalar(asp, 'revenue.realizedNetAsp', diagnostics)
    if (!v || !asp || v.mappingRole !== 'RECOGNIZED_REVENUE_VOLUME' || asp.mappingRole !== 'REALIZED_NET_ASP') { diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: 'revenue.route', reason: 'volume must be recognized-revenue volume and ASP must be realized net ASP' }); revenueValid = false }
    if (v && asp) {
      if (!samePeriod(v, asp)) { diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId: 'revenue.volume-times-asp', reason: 'volume and net ASP periods differ' }); revenueValid = false }
      if (!sameScope(v, asp)) { diagnostics.push({ code: 'SCOPE_MISMATCH', subjectId: 'revenue.volume-times-asp', reason: 'volume and ASP scopes differ' }); revenueValid = false }
      if (!nonEmpty(v.unit) || asp.unit !== `${asp.currency}/${v.unit}` || v.dimension !== 'COUNT' || asp.dimension !== 'CURRENCY_PER_UNIT' || asp.currency !== input.revenue.reportedConsolidatedRevenue.currency || asp.periodBasis !== input.horizon.periodBasis) { diagnostics.push({ code: 'UNIT_MISMATCH', subjectId: 'revenue.volume-times-asp', reason: 'native units do not algebraically cancel to reported currency amount' }); revenueValid = false }
    }
    if (vn !== undefined && vn < 0) { diagnostics.push({ code: 'NEGATIVE_PHYSICAL_QUANTITY', subjectId: 'revenue.volume', reason: 'recognized volume cannot be negative' }); revenueValid = false }
    if (vn === undefined || an === undefined) revenueValid = false
    else { const product = vn * an; if (!Number.isFinite(product)) { diagnostics.push({ code: 'INVALID_NUMBER', subjectId: 'revenue.volume-times-asp', reason: 'volume-times-ASP overflow' }); revenueValid = false } else { calculatedRevenue = product; revenueRefs.push(v!.sourceId, asp!.sourceId) } }
  } else if (input.revenue?.selectedRoute !== 'DISCLOSED_SEGMENT_REVENUE') {
    diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: 'revenue.selectedRoute', reason: 'exactly one supported revenue route is required' }); revenueValid = false
  }
  const adjustmentIds = new Set<string>(), adjustmentAccounts = new Set<string>()
  for (const adj of [...(input.revenue?.adjustments ?? [])].sort((a, b) => compare(String(a?.adjustmentId), String(b?.adjustmentId)))) {
    if (adjustmentIds.has(adj.adjustmentId) || adjustmentAccounts.has(adj.accountId)) { diagnostics.push({ code: 'DUPLICATE_ADJUSTMENT', subjectId: adj.adjustmentId, reason: 'adjustment ID or account mapping is duplicated' }); revenueValid = false }
    adjustmentIds.add(adj.adjustmentId); adjustmentAccounts.add(adj.accountId)
    if (!adj.adjustmentId || !adj.accountId || !adj.evidenceRefs.length || adj.overlapsLineId !== null) { diagnostics.push({ code: adj.overlapsLineId !== null ? 'DOUBLE_COUNTED_REVENUE_PATH' : 'INVALID_STRUCTURE', subjectId: adj.adjustmentId || 'adjustment', reason: 'adjustments need unique IDs, account, refs, and no overlap with included line' }); revenueValid = false }
    const n = scalar(adj.signedAmount, adj.adjustmentId, diagnostics)
    if (!validatePair(adj.signedAmount, input.revenue.reportedConsolidatedRevenue, `adjustment.${adj.adjustmentId}`, diagnostics)) revenueValid = false
    if (n === undefined) revenueValid = false
    else { const next = add(calculatedRevenue, n); if (next === undefined) { diagnostics.push({ code: 'INVALID_NUMBER', subjectId: adj.adjustmentId, reason: 'adjusted revenue overflow' }); revenueValid = false } else calculatedRevenue = next; revenueRefs.push(adj.adjustmentId, ...adj.evidenceRefs, ...evidenceRefsOf(adj.signedAmount.value)) }
  }
  const reported = scalar(input.revenue?.reportedConsolidatedRevenue, 'reportedConsolidatedRevenue', diagnostics)
  const reportedInput = input.revenue?.reportedConsolidatedRevenue
  const includedRevenueLine = input.revenue?.lines.find((l) => l?.disposition === 'INCLUDED_ONCE')
  const revenueScopeReference = input.revenue?.selectedRoute === 'RECOGNIZED_VOLUME_TIMES_REALIZED_NET_ASP' ? input.revenue.volume : undefined
  if (reportedInput?.companySymbol !== input.companySymbol || (includedRevenueLine && (reportedInput?.financialScope !== includedRevenueLine.financialScope || reportedInput?.economicScope !== includedRevenueLine.economicScope)) || (revenueScopeReference && !sameScope(reportedInput, revenueScopeReference))) { diagnostics.push({ code: 'SCOPE_MISMATCH', subjectId: 'reportedConsolidatedRevenue', reason: 'reported total company or scope differs from revenue inputs' }); revenueValid = false }
  if (!reportedInput || reportedInput.periodStart !== input.horizon.periodStart || reportedInput.periodEnd !== input.horizon.periodEnd || reportedInput.periodBasis !== input.horizon.periodBasis) { diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId: 'reportedConsolidatedRevenue', reason: 'reported total must match the bridge horizon' }); revenueValid = false }
  if (!reportedInput || reportedInput.flowOrStock !== 'FLOW' || reportedInput.dimension !== 'CURRENCY_AMOUNT' || reportedInput.unit !== reportedInput.currency) { diagnostics.push({ code: 'UNIT_MISMATCH', subjectId: 'reportedConsolidatedRevenue', reason: 'reported consolidated revenue must be a currency amount FLOW in its stated currency unit' }); revenueValid = false }
  if (reported === undefined) revenueValid = false
  components.revenue = revenueValid ? known(calculatedRevenue, input.formulaVersion || FORMULA, revenueRefs) : unavailable(input.formulaVersion || FORMULA, 'revenue route or operand failed closed', revenueRefs)
  let residual: EconomicBridgeComponent
  if (reported === undefined) {
    diagnostics.push({ code: 'RESIDUAL_UNVERIFIED', subjectId: 'revenue.residual', reason: 'reported consolidated revenue unavailable; residual is unavailable, not zero' })
    residual = unavailable(input.formulaVersion || FORMULA, 'reported consolidated revenue is unavailable', revenueRefs)
  } else if (!revenueValid) residual = unavailable(input.formulaVersion || FORMULA, 'calculated revenue unavailable', revenueRefs)
  else { const diff = subtract(reported, calculatedRevenue); residual = diff === undefined ? unavailable(input.formulaVersion || FORMULA, 'residual overflow', revenueRefs) : known(diff, input.formulaVersion || FORMULA, [...revenueRefs, input.revenue.reportedConsolidatedRevenue.sourceId]) }

  const profit = input.profit
  const cogs = scalar(profit?.cogs, 'cogs', diagnostics)
  const rev = components.revenue.status === 'KNOWN' ? components.revenue.value : undefined
  const gross = rev !== undefined && cogs !== undefined && validatePair(input.revenue.reportedConsolidatedRevenue, profit.cogs, 'grossProfit', diagnostics) ? subtract(rev, cogs) : undefined
  components.grossProfit = gross === undefined ? unavailable(input.formulaVersion || FORMULA, 'revenue or COGS unavailable/incompatible', ['revenue', profit?.cogs?.sourceId ?? 'cogs']) : known(gross, input.formulaVersion || FORMULA, ['revenue', profit.cogs.sourceId])
  components.grossMargin = gross !== undefined && rev !== undefined && rev > 0 ? known(gross / rev, input.formulaVersion || FORMULA, ['grossProfit', 'revenue']) : unavailable(input.formulaVersion || FORMULA, 'gross margin requires strictly positive revenue and compatible gross profit', ['grossProfit', 'revenue'])
  if (rev !== undefined && rev <= 0) diagnostics.push({ code: 'MISSING_REQUIRED_OPERAND', subjectId: 'grossMargin', reason: 'gross margin requires strictly positive revenue as denominator' })

  let op = gross, opValid = gross !== undefined
  const accountIds = new Set<string>()
  for (const expense of [...(profit?.operatingExpenses ?? [])].sort((a, b) => compare(String(a?.accountId), String(b?.accountId)))) {
    const id = expense.accountId ?? expense.sourceId
    if (!expense.accountId || accountIds.has(expense.accountId) || expense.mappingRole === 'OPERATING_TOTAL_OVERLAP') { diagnostics.push({ code: 'ACCOUNT_MAPPING_OVERLAP', subjectId: id, reason: 'operating account ID missing, duplicated, or overlaps an already mapped total' }); opValid = false }
    accountIds.add(expense.accountId ?? '')
    if (expense.signConvention !== 'POSITIVE_EXPENSE') { diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: id, reason: 'operating expense must use positive expense sign convention' }); opValid = false }
    const n = scalar(expense, id, diagnostics)
    if (!validatePair(expense, input.revenue.reportedConsolidatedRevenue, id, diagnostics)) opValid = false
    if (n === undefined) opValid = false
    else if (op !== undefined) { op = subtract(op, n); if (op === undefined) { diagnostics.push({ code: 'INVALID_NUMBER', subjectId: id, reason: 'operating profit overflow' }); opValid = false } }
  }
  for (const other of [...(profit?.otherOperatingIncome ?? [])].sort((a, b) => compare(String(a?.accountId), String(b?.accountId)))) {
    const id = other.accountId ?? other.sourceId
    if (!other.accountId || accountIds.has(other.accountId)) { diagnostics.push({ code: 'ACCOUNT_MAPPING_OVERLAP', subjectId: id, reason: 'other operating income account missing or duplicated' }); opValid = false }
    accountIds.add(other.accountId ?? '')
    const n = scalar(other, id, diagnostics); if (n === undefined || !validatePair(other, input.revenue.reportedConsolidatedRevenue, id, diagnostics)) opValid = false
    else if (op !== undefined) { op = add(op, n); if (op === undefined) { diagnostics.push({ code: 'INVALID_NUMBER', subjectId: id, reason: 'operating profit overflow' }); opValid = false } }
  }
  const oneOffIds = new Set<string>()
  for (const item of [...(profit?.nonRecurringItems ?? [])].sort((a, b) => compare(String(a?.adjustmentId), String(b?.adjustmentId)))) {
    if (!item.adjustmentId || !item.accountId || oneOffIds.has(item.adjustmentId)) { diagnostics.push({ code: 'DUPLICATE_ADJUSTMENT', subjectId: item.adjustmentId || 'nonRecurringItem', reason: 'non-recurring adjustment IDs must be unique and account IDs present' }); opValid = false }
    oneOffIds.add(item.adjustmentId)
    if (item.overlapsAccountId !== null) { diagnostics.push({ code: 'ACCOUNT_MAPPING_OVERLAP', subjectId: item.adjustmentId, reason: 'non-recurring item overlaps a separately mapped account' }); opValid = false }
    if (item.treatment === 'UNRESOLVED') { diagnostics.push({ code: 'NON_RECURRING_UNRESOLVED', subjectId: item.adjustmentId, reason: 'non-recurring treatment must state whether it is already included or excluded' }); opValid = false }
    if (item.treatment === 'INCLUDED_IN_OPERATING_EXPENSES' && !accountIds.has(item.accountId)) { diagnostics.push({ code: 'ACCOUNT_MAPPING_OVERLAP', subjectId: item.adjustmentId, reason: 'included one-off must match a uniquely mapped operating expense account' }); opValid = false }
    const n = scalar(item.amount, item.adjustmentId, diagnostics)
    if (n === undefined || !validatePair(item.amount, input.revenue.reportedConsolidatedRevenue, item.adjustmentId, diagnostics)) opValid = false
  }
  components.operatingProfit = opValid && op !== undefined ? known(op, input.formulaVersion || FORMULA, ['grossProfit', ...(profit?.operatingExpenses ?? []).map((x) => x.sourceId), ...(profit?.otherOperatingIncome ?? []).map((x) => x.sourceId)]) : unavailable(input.formulaVersion || FORMULA, 'operating statement mapping or required input unavailable')
  if (profit?.ebit?.sourceId === profit?.signedNetFinanceItems?.sourceId || profit?.ebit?.accountId && profit?.ebit?.accountId === profit?.signedNetFinanceItems?.accountId) diagnostics.push({ code: 'ACCOUNT_MAPPING_OVERLAP', subjectId: 'ebit', reason: 'finance item is duplicated in EBIT and operating mapping' })

  const financeScalar = profit?.signedNetFinanceItems
  const nonopScalar = profit?.signedNonOperatingItems
  const taxScalar = profit?.incomeTaxExpense
  const nciScalar = profit?.profitAttributableToNci
  const finance = scalar(financeScalar, 'signedNetFinanceItems', diagnostics)
  const nonop = scalar(nonopScalar, 'signedNonOperatingItems', diagnostics)
  const tax = scalar(taxScalar, 'incomeTaxExpense', diagnostics)
  const nci = scalar(nciScalar, 'profitAttributableToNci', diagnostics)
  const financeCompatible = Boolean(financeScalar && validatePair(financeScalar, input.revenue.reportedConsolidatedRevenue, 'signedNetFinanceItems', diagnostics) && financeScalar.signConvention === 'SIGNED_AMOUNT')
  const nonopCompatible = Boolean(nonopScalar && validatePair(nonopScalar, input.revenue.reportedConsolidatedRevenue, 'signedNonOperatingItems', diagnostics) && nonopScalar.signConvention === 'SIGNED_AMOUNT')
  const taxCompatible = Boolean(taxScalar && validatePair(taxScalar, input.revenue.reportedConsolidatedRevenue, 'incomeTaxExpense', diagnostics) && taxScalar.signConvention === 'POSITIVE_EXPENSE')
  const nciCompatible = Boolean(nciScalar && validatePair(nciScalar, input.revenue.reportedConsolidatedRevenue, 'profitAttributableToNci', diagnostics) && nciScalar.signConvention === 'SIGNED_AMOUNT' && profit?.nciBasis === 'CONSOLIDATED_TO_PARENT')
  if (financeScalar && !financeCompatible && financeScalar.signConvention !== 'SIGNED_AMOUNT') diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: 'signedNetFinanceItems', reason: 'net finance items must use signed amount convention' })
  if (nonopScalar && !nonopCompatible && nonopScalar.signConvention !== 'SIGNED_AMOUNT') diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: 'signedNonOperatingItems', reason: 'non-operating items must use signed amount convention' })
  if (taxScalar && !taxCompatible && taxScalar.signConvention !== 'POSITIVE_EXPENSE') diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: 'incomeTaxExpense', reason: 'income tax must use positive-expense convention' })
  if (nciScalar && !nciCompatible && nciScalar.signConvention !== 'SIGNED_AMOUNT') diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: 'profitAttributableToNci', reason: 'NCI attribution must use signed amount convention' })
  const operating = components.operatingProfit.status === 'KNOWN' ? components.operatingProfit.value : undefined
  let pbt: number | undefined
  if (operating !== undefined && finance !== undefined && nonop !== undefined && financeCompatible && nonopCompatible && components.revenue.status === 'KNOWN') {
    const first = add(operating, finance)
    pbt = first === undefined ? undefined : add(first, nonop)
    if (pbt === undefined) diagnostics.push({ code: 'INVALID_NUMBER', subjectId: 'pbt', reason: 'PBT arithmetic overflow' })
  }
  components.pbt = pbt === undefined ? unavailable(input.formulaVersion || FORMULA, 'operating profit or signed finance/non-operating items unavailable') : known(pbt, input.formulaVersion || FORMULA, ['operatingProfit', profit?.signedNetFinanceItems?.sourceId ?? '', profit?.signedNonOperatingItems?.sourceId ?? ''])
  const consolidated = pbt !== undefined && tax !== undefined && taxCompatible ? subtract(pbt, tax) : undefined
  components.consolidatedNetProfit = consolidated === undefined ? unavailable(input.formulaVersion || FORMULA, 'PBT or positive-expense tax unavailable') : known(consolidated, input.formulaVersion || FORMULA, ['pbt', profit?.incomeTaxExpense?.sourceId ?? ''])
  const parent = consolidated !== undefined && nci !== undefined && nciCompatible ? subtract(consolidated, nci) : undefined
  if (profit?.nciBasis !== 'CONSOLIDATED_TO_PARENT') diagnostics.push({ code: 'NCI_SCOPE_MISSING', subjectId: 'profitAttributableToNci', reason: 'NCI must be explicitly mapped from consolidated to parent; missing/mixed is not zero' })
  components.parentNetProfit = parent === undefined ? unavailable(input.formulaVersion || FORMULA, 'consolidated NP or explicitly scoped NCI unavailable') : known(parent, input.formulaVersion || FORMULA, ['consolidatedNetProfit', profit?.profitAttributableToNci?.sourceId ?? ''])

  const fc = input.fcff
  const fcIds = [fc?.unleveredEbit?.sourceId, fc?.taxRate?.sourceId, fc?.da?.sourceId, fc?.capex?.sourceId].filter((x): x is string => Boolean(x))
  const ebit = scalar(fc?.unleveredEbit, 'fcff.ebit', diagnostics), rate = scalar(fc?.taxRate, 'fcff.taxRate', diagnostics), da = scalar(fc?.da, 'fcff.da', diagnostics), capex = scalar(fc?.capex, 'fcff.capex', diagnostics)
  let fcffOperandsValid = ebit !== undefined && rate !== undefined && da !== undefined && capex !== undefined
  const ebitInput = fc?.unleveredEbit, taxRateInput = fc?.taxRate, daInput = fc?.da, capexInput = fc?.capex
  const horizonStart = parseCivilDate(input.horizon?.periodStart)
  const horizonEnd = parseCivilDate(input.horizon?.periodEnd)
  const horizonValid = Boolean(horizonStart && horizonEnd && (input.horizon.periodStart <= input.horizon.periodEnd) && nonEmpty(input.horizon.periodBasis))
  if (!horizonValid) {
    diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId: 'horizon', reason: 'FCFF horizon requires real YYYY-MM-DD dates in order and a non-empty periodBasis' })
    fcffOperandsValid = false
  }
  const horizonOperands: readonly [string, EconomicBridgeScalar | undefined][] = [
    ['fcff.ebit', ebitInput], ['fcff.taxRate', taxRateInput], ['fcff.da', daInput], ['fcff.capex', capexInput],
  ]
  for (const [subjectId, operand] of horizonOperands) {
    if (!horizonValid || !operand || operand.periodStart !== input.horizon.periodStart || operand.periodEnd !== input.horizon.periodEnd || operand.periodBasis !== input.horizon.periodBasis) {
      diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId, reason: 'FCFF operand periodStart, periodEnd, and periodBasis must exactly match the bridge horizon' })
      fcffOperandsValid = false
    }
  }
  if (!ebitInput || ebitInput.companySymbol !== input.companySymbol || ebitInput.dimension !== 'CURRENCY_AMOUNT' || ebitInput.flowOrStock !== 'FLOW' || !ebitInput.currency) { diagnostics.push({ code: 'FCFF_INPUTS_MISSING', subjectId: 'fcff.ebit', reason: 'unlevered EBIT must belong to bridge company and be a currency amount FLOW' }); fcffOperandsValid = false }
  if (!taxRateInput || !ebitInput || !samePeriod(ebitInput, taxRateInput)) { diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId: 'fcff.taxRate', reason: 'tax rate must share EBIT period' }); fcffOperandsValid = false }
  if (!taxRateInput || !ebitInput || !sameScope(ebitInput, taxRateInput)) { diagnostics.push({ code: 'SCOPE_MISMATCH', subjectId: 'fcff.taxRate', reason: 'tax rate must share EBIT company and scope' }); fcffOperandsValid = false }
  if (!taxRateInput || taxRateInput.dimension !== 'RATE' || taxRateInput.flowOrStock !== 'RATE' || taxRateInput.unit !== 'fraction' || taxRateInput.currency !== null || rate === undefined || rate < 0 || rate > 1) { diagnostics.push({ code: 'UNIT_MISMATCH', subjectId: 'fcff.taxRate', reason: 'tax rate must be a same-scope fraction in [0,1] with null currency' }); fcffOperandsValid = false }
  if (!daInput || !ebitInput || !validatePair(ebitInput, daInput, 'fcff.da', diagnostics) || daInput.dimension !== 'CURRENCY_AMOUNT' || daInput.flowOrStock !== 'FLOW') { diagnostics.push({ code: 'FCFF_INPUTS_MISSING', subjectId: 'fcff.da', reason: 'D&A must match EBIT period, company, scope, currency, native unit, dimension, and FLOW basis' }); fcffOperandsValid = false }
  if (!capexInput || !ebitInput || !validatePair(ebitInput, capexInput, 'fcff.capex', diagnostics) || capexInput.dimension !== 'CURRENCY_AMOUNT' || capexInput.flowOrStock !== 'FLOW' || capexInput.signConvention !== 'POSITIVE_CASH_OUTFLOW' || capex === undefined || capex < 0) { diagnostics.push({ code: 'FCFF_INPUTS_MISSING', subjectId: 'fcff.capex', reason: 'CapEx must be a compatible currency FLOW, non-negative, and use POSITIVE_CASH_OUTFLOW' }); fcffOperandsValid = false }
  let nwcDelta: number | undefined
  let nwcGood = Boolean(fc?.nwcComplete) && Array.isArray(fc?.nwcStart) && Array.isArray(fc?.nwcEnd) && fc!.nwcStart.length > 0 && fc!.nwcEnd.length > 0
  if (!nwcGood) diagnostics.push({ code: 'FCFF_INPUTS_MISSING', subjectId: 'fcff.nwc', reason: 'complete, paired operating NWC categories are required' })
  if (nwcGood) {
    const start = new Map<string, EconomicBridgeScalar>(), end = new Map<string, EconomicBridgeScalar>()
    const excluded = new Set(fc!.excludedOperatingCapitalIds)
    const validNwcRole = (role: string | undefined): boolean => role === 'OPERATING_CURRENT_ASSET' || role === 'OPERATING_CURRENT_LIABILITY'
    for (const item of fc!.nwcStart) {
      const key = item.accountId ?? ''
      if (!nonEmpty(key) || start.has(key) || !validNwcRole(item.mappingRole) || excluded.has(key)) { diagnostics.push({ code: 'ACCOUNT_MAPPING_OVERLAP', subjectId: key || 'nwc.start', reason: 'opening NWC requires a unique accountId, a permitted operating asset/liability role, and no exclusion conflict' }); nwcGood = false; continue }
      start.set(key, item)
    }
    for (const item of fc!.nwcEnd) {
      const key = item.accountId ?? ''
      if (!nonEmpty(key) || end.has(key) || !validNwcRole(item.mappingRole) || excluded.has(key)) { diagnostics.push({ code: 'ACCOUNT_MAPPING_OVERLAP', subjectId: key || 'nwc.end', reason: 'closing NWC requires a unique accountId, a permitted operating asset/liability role, and no exclusion conflict' }); nwcGood = false; continue }
      end.set(key, item)
    }
    if ([...start.keys()].some((k) => !end.has(k)) || [...end.keys()].some((k) => !start.has(k))) { diagnostics.push({ code: 'FCFF_INPUTS_MISSING', subjectId: 'fcff.nwc', reason: 'opening and closing operating categories do not pair' }); nwcGood = false }
    let s = 0, e = 0
    for (const [key, a] of [...start.entries()].sort(([x], [y]) => compare(x, y))) {
      const b = end.get(key)
      if (!b) { nwcGood = false; continue }
      if (a.mappingRole !== b.mappingRole) { diagnostics.push({ code: 'ACCOUNT_MAPPING_OVERLAP', subjectId: `nwc.${key}`, reason: 'opening and closing mappingRole must remain identical for an account' }); nwcGood = false }
      if (!sameScope(a, b)) { diagnostics.push({ code: 'SCOPE_MISMATCH', subjectId: `nwc.${key}`, reason: 'opening and closing NWC scopes differ' }); nwcGood = false }
      if (!sameCurrency(a, b)) { diagnostics.push({ code: 'UNIT_MISMATCH', subjectId: `nwc.${key}`, reason: 'opening and closing NWC native units differ' }); nwcGood = false }
      if (fc!.unleveredEbit && (!sameScope(a, fc!.unleveredEbit) || !sameCurrency(a, fc!.unleveredEbit))) { diagnostics.push({ code: 'SCOPE_MISMATCH', subjectId: `nwc.${key}`, reason: 'operating NWC must match unlevered EBIT company, scopes, currency, unit, and dimension' }); nwcGood = false }
      const requiredOpeningDate = previousCivilDate(input.horizon?.periodStart)
      const closingDateValid = parseCivilDate(input.horizon?.periodEnd) !== undefined
      if (a.flowOrStock !== 'STOCK' || b.flowOrStock !== 'STOCK' || !requiredOpeningDate || !closingDateValid || a.periodEnd !== requiredOpeningDate || b.periodEnd !== input.horizon.periodEnd) {
        diagnostics.push({ code: 'PERIOD_MISMATCH', subjectId: `nwc.${key}`, reason: `NWC stock observations must be opening ${requiredOpeningDate ?? 'valid day before horizon start'} and closing ${input.horizon?.periodEnd ?? 'valid horizon end'}` })
        nwcGood = false
      }
      if (!nwcGood) continue
      const av = scalar(a, `nwc.start.${key}`, diagnostics), bv = scalar(b, `nwc.end.${key}`, diagnostics)
      if (av === undefined || bv === undefined) { nwcGood = false; continue }
      const sv = a.mappingRole === 'OPERATING_CURRENT_LIABILITY' ? -av : av
      const ev = b.mappingRole === 'OPERATING_CURRENT_LIABILITY' ? -bv : bv
      const ns = add(s, sv), ne = add(e, ev); if (ns === undefined || ne === undefined) { nwcGood = false; diagnostics.push({ code: 'INVALID_NUMBER', subjectId: key, reason: 'NWC sum overflow' }) } else { s = ns; e = ne }
    }
    if (nwcGood) {
      nwcDelta = subtract(e, s)
      if (nwcDelta === undefined) { diagnostics.push({ code: 'INVALID_NUMBER', subjectId: 'fcff.nwc', reason: 'NWC delta overflow' }); nwcGood = false }
    }
  }
  if (!nwcGood) nwcDelta = undefined
  const treatmentsValid = nonEmpty(fc?.taxConvention) && nonEmpty(fc?.taxTreatment) && nonEmpty(fc?.leaseTreatment) && nonEmpty(fc?.acquisitionTreatment)
  const fcffReady = fcffOperandsValid && ebit !== undefined && rate !== undefined && da !== undefined && capex !== undefined && nwcDelta !== undefined && treatmentsValid && [ebit, rate, da, capex, nwcDelta].every(Number.isFinite)
  if (!fcffReady) diagnostics.push({ code: 'FCFF_INPUTS_MISSING', subjectId: 'fcff', reason: 'FCFF needs same-period unlevered EBIT, tax, D&A, positive CapEx, complete paired NWC, and explicit treatments' })
  const fcffValue = fcffReady ? ebit! * (1 - rate!) + da! - capex! - nwcDelta! : undefined
  components.deltaNwc = nwcDelta === undefined ? unavailable(input.formulaVersion || FORMULA, 'complete operating NWC unavailable') : known(nwcDelta, input.formulaVersion || FORMULA, [...(fc?.nwcStart ?? []).map((x) => x.sourceId), ...(fc?.nwcEnd ?? []).map((x) => x.sourceId)])
  components.fcff = fcffValue === undefined || !Number.isFinite(fcffValue) ? unavailable(input.formulaVersion || FORMULA, 'FCFF inputs unavailable or overflowed', fcIds) : known(fcffValue, input.formulaVersion || FORMULA, [...fcIds, 'deltaNwc'])
  let cashFlowDifference: EconomicBridgeComponent = unavailable(input.formulaVersion || FORMULA, 'CFO and long-term asset purchases are not both available')
  if (fc?.cfo && fc?.purchasesOfLongTermAssets) {
    const cfo = scalar(fc.cfo, 'cashFlowDifference.cfo', diagnostics), purchases = scalar(fc.purchasesOfLongTermAssets, 'cashFlowDifference.purchases', diagnostics)
    if (cfo !== undefined && purchases !== undefined && fc.purchasesOfLongTermAssets.signConvention === 'POSITIVE_CASH_OUTFLOW' && validatePair(fc.cfo, fc.purchasesOfLongTermAssets, 'cashFlowDifference', diagnostics)) cashFlowDifference = known(cfo - purchases, input.formulaVersion || FORMULA, [fc.cfo.sourceId, fc.purchasesOfLongTermAssets.sourceId])
  }

  const scenarios = new Set<string>()
  for (const p of input.calibrationProposals ?? []) {
    const key = `${p.scenario}:${p.driverId}`
    if (scenarios.has(key)) diagnostics.push({ code: 'INVALID_STRUCTURE', subjectId: key, reason: 'duplicate scenario-driver proposal' })
    scenarios.add(key)
    const missing = !p.baseline || p.proposedValue === null || !Number.isFinite(p.proposedValue) || !p.mechanism || !p.calibration || !p.strongestCounterevidence || !p.trigger || !p.author
    if (missing) diagnostics.push({ code: 'REVIEW_REQUIRED', subjectId: key, reason: 'baseline/value/mechanism/calibration/counterevidence/trigger/author must be present' })
    if (p.calibration?.category === 'HISTORICAL_OR_INDUSTRY_ENVELOPE') diagnostics.push({ code: 'HISTORICAL_ENVELOPE_NOT_CALIBRATION', subjectId: key, reason: 'historical/industry extrema are not forward operational calibration' })
    if (p.calibration?.status !== 'CALIBRATED' || p.calibration?.category !== 'OPERATIONAL_MECHANISM') diagnostics.push({ code: 'REVIEW_REQUIRED', subjectId: key, reason: 'calibration remains unverified or lacks an operational mechanism' })
  }
  for (const scenario of ['BEAR', 'BASE', 'BULL']) if (![...scenarios].some((key) => key.startsWith(`${scenario}:`))) diagnostics.push({ code: 'REVIEW_REQUIRED', subjectId: scenario, reason: 'scenario has no proposal for review' })
  const diagnosticsSorted = diagnostics.sort((a, b) => compare(a.code, b.code) || compare(a.subjectId, b.subjectId) || compare(a.reason, b.reason))
  let bridgeHash = 'UNAVAILABLE'
  try { bridgeHash = hashCanonicalScenarioValue({ inputHash, formula: FORMULA, components, residual, cashFlowDifference, diagnostics: diagnosticsSorted }) } catch { diagnosticsSorted.push({ code: 'INVALID_STRUCTURE', subjectId: 'bridgeHash', reason: 'result could not be canonically hashed' }) }
  const fatal = diagnosticsSorted.some((d) => ['INVALID_STRUCTURE', 'INVALID_NUMBER', 'NEGATIVE_PHYSICAL_QUANTITY', 'DOUBLE_COUNTED_REVENUE_PATH', 'SCOPE_MISMATCH', 'PERIOD_MISMATCH', 'UNIT_MISMATCH', 'ACCOUNT_MAPPING_OVERLAP', 'DUPLICATE_ADJUSTMENT', 'MISSING_REQUIRED_OPERAND', 'NCI_SCOPE_MISSING', 'FCFF_INPUTS_MISSING', 'NON_RECURRING_UNRESOLVED'].includes(d.code))
  return { status: fatal ? 'UNAVAILABLE' : 'STRUCTURALLY_VALID_FIXTURE_ONLY', reportEligible: false, inputHash, bridgeHash, components, residual, cashFlowDifference, assumptionReviewStatus: 'REVIEW_REQUIRED', diagnostics: diagnosticsSorted }
}

export function calculateEconomicBridge(raw: EconomicBridgeInput): EconomicBridgeResult {
  try { return calculateEconomicBridgeCore(raw) }
  catch {
    let inputHash = 'UNAVAILABLE'
    try { inputHash = hashCanonicalScenarioValue(canonicalBridgeInput(raw)) } catch { /* malformed input has no canonical hash */ }
    const result = {
      status: 'UNAVAILABLE' as const,
      reportEligible: false as const,
      inputHash,
      bridgeHash: 'UNAVAILABLE',
      components: {},
      residual: unavailable(FORMULA, 'malformed input caused fail-closed evaluation'),
      cashFlowDifference: unavailable(FORMULA, 'malformed input caused fail-closed evaluation'),
      assumptionReviewStatus: 'REVIEW_REQUIRED' as const,
      diagnostics: [{ code: 'INVALID_STRUCTURE' as const, subjectId: 'input', reason: 'malformed fixture structure rejected without throwing' }],
    }
    return result
  }
}
