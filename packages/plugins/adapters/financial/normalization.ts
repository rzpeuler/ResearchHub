import { PluginValidationError } from '../../core/index.ts'
import { FinancialPluginError } from './errors.ts'
import {
  FINANCIAL_PERIOD_TYPES,
  FINANCIAL_STATEMENT_TYPES,
  type FinancialData,
  type FinancialDataRequest,
  type FinancialMetric,
  type FinancialMetricName,
  type FinancialPeriod,
  type FinancialPeriodType,
  type FinancialSourceMetadata,
  type FinancialStatement,
  type FinancialStatementType,
} from './types.ts'

export interface NormalizedFinancialRow {
  statementType: FinancialStatementType
  symbol: string
  period: string
  reportDate?: string
  currency?: string
  unit?: string
  values: Readonly<Record<string, unknown>>
  plugin: string
  source: string
  retrievedAt: string
  quality: 'high' | 'medium' | 'low'
  confidence: number
}

export const METRIC_ALIASES: Readonly<Record<FinancialMetricName, readonly string[]>> = {
  revenue: ['total_revenue', 'revenue', 'operate_income'],
  operating_profit: ['operate_profit', 'operating_profit'],
  net_profit: ['n_income', 'net_profit', 'net_income'],
  gross_margin: ['gross_margin', 'grossprofit_margin'],
  net_profit_margin: ['netprofit_margin', 'net_profit_margin'],
  eps: ['eps', 'dt_eps'],
  current_ratio: ['current_ratio'],
  quick_ratio: ['quick_ratio'],
  debt_to_assets: ['debt_to_assets', 'debt_to_asset'],
  total_assets: ['total_assets'],
  total_liabilities: ['total_liab', 'total_liabilities'],
  operating_cash_flow: ['n_cashflow_act', 'operating_cash_flow', 'net_operate_cash_flow'],
}

const INDICATOR_METRICS = new Set<FinancialMetricName>([
  'gross_margin',
  'net_profit_margin',
  'eps',
  'current_ratio',
  'quick_ratio',
  'debt_to_assets',
])

export function normalizeFinancialRequest(value: FinancialDataRequest): {
  symbol: string
  statementTypes: FinancialStatementType[]
  periodType: FinancialPeriodType | undefined
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected a Financial plugin request')
  }

  if (typeof value.symbol !== 'string' || !/^\d{6}$/.test(value.symbol.trim())) {
    throw new PluginValidationError('expected a six-digit A-share symbol', '$.symbol')
  }

  const statementTypes = value.statementTypes === undefined
    ? [...FINANCIAL_STATEMENT_TYPES]
    : [...value.statementTypes]
  if (statementTypes.length === 0 || statementTypes.some(type => !FINANCIAL_STATEMENT_TYPES.includes(type))) {
    throw new PluginValidationError('statementTypes must contain supported statement types', '$.statementTypes')
  }
  if (new Set(statementTypes).size !== statementTypes.length) {
    throw new PluginValidationError('statementTypes must not contain duplicates', '$.statementTypes')
  }
  if (value.periodType !== undefined && !FINANCIAL_PERIOD_TYPES.includes(value.periodType)) {
    throw new PluginValidationError('periodType must be annual, quarterly, or ttm', '$.periodType')
  }
  return {
    symbol: value.symbol.trim(),
    statementTypes,
    periodType: value.periodType,
  }
}

export function buildFinancialData(rows: readonly NormalizedFinancialRow[]): FinancialData {
  const statements: FinancialStatement[] = []
  const metrics: FinancialMetric[] = []
  for (const row of mergeFinancialRows(rows)) {
    const statement = rowToStatement(row)
    statements.push(statement)
    metrics.push(...statementMetrics(statement, row))
  }
  return { symbol: rows[0]?.symbol ?? '', statements, metrics }
}

export function validateFinancialData(value: unknown): asserts value is FinancialData {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected Financial data to be an object')
  }
  const data = value as Record<string, unknown>
  assertAllowedFields(data, new Set(['symbol', 'statements', 'metrics']))
  assertSymbol(data.symbol, '$.symbol')
  if (!Array.isArray(data.statements) || !Array.isArray(data.metrics)) {
    throw new PluginValidationError('statements and metrics must be arrays')
  }
  data.statements.forEach((statement, index) => validateStatement(statement, index))
  data.metrics.forEach((metric, index) => validateMetric(metric, index))
}

export function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const number = Number(value.replaceAll(',', ''))
    if (Number.isFinite(number)) {
      return number
    }
  }
  throw new FinancialPluginError(`invalid financial numeric field: ${field}`)
}

export function readRequiredField(row: Readonly<Record<string, unknown>>, aliases: readonly string[], field: string): unknown {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && row[alias] !== '') {
      return row[alias]
    }
  }
  throw new FinancialPluginError(`missing financial field: ${field}`)
}

export function readOptionalField(row: Readonly<Record<string, unknown>>, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && row[alias] !== '') {
      return row[alias]
    }
  }
  return undefined
}

export function normalizeFinancialDate(value: unknown, field: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new FinancialPluginError(`missing financial date: ${field}`)
  }
  const raw = String(value).trim()
  const candidate = /^\d{8}$/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T00:00:00Z`
    : /^\d{4}-\d{2}-\d{2}$/.test(raw)
      ? `${raw}T00:00:00Z`
      : raw
  const date = new Date(candidate)
  if (Number.isNaN(date.getTime())) {
    throw new FinancialPluginError(`invalid financial date: ${field}`)
  }
  return date.toISOString()
}

function rowToStatement(row: NormalizedFinancialRow): FinancialStatement {
  const periodEnd = normalizeFinancialDate(row.period, 'period')
  const periodType = inferPeriodType(periodEnd)
  const fiscalPeriod: FinancialPeriod = {
    start: periodStart(periodEnd, periodType),
    end: periodEnd,
    periodType,
  }
  const reportDate = row.reportDate === undefined ? undefined : normalizeFinancialDate(row.reportDate, 'reportDate')
  const source = sourceMetadata(row, reportDate)
  const lineItems = metricNamesFor(row.statementType)
    .flatMap((name) => {
      const raw = readOptionalField(row.values, METRIC_ALIASES[name])
      if (raw === undefined) {
        return []
      }
      return [{ name, value: readFiniteNumber(raw, name), unit: unitForMetric(name, row) }]
    })
  if (lineItems.length === 0) {
    throw new FinancialPluginError(`financial ${row.statementType} row contains no supported metrics`)
  }
  return {
    id: `${row.symbol}:${row.statementType}:${periodEnd.slice(0, 10)}`,
    symbol: row.symbol,
    statementType: row.statementType,
    fiscalPeriod,
    ...(reportDate === undefined ? {} : { reportDate }),
    currency: row.currency ?? 'CNY',
    unit: row.unit ?? 'CNY',
    lineItems,
    source,
  }
}

function statementMetrics(statement: FinancialStatement, row: NormalizedFinancialRow): FinancialMetric[] {
  return statement.lineItems.map((lineItem) => ({
    name: lineItem.name as FinancialMetricName,
    value: lineItem.value,
    unit: lineItem.unit,
    period: { ...statement.fiscalPeriod },
    calculationBasis: 'reported' as const,
    sourceStatementIds: [statement.id],
    confidence: row.confidence,
    source: { ...statement.source },
  }))
}

function sourceMetadata(row: NormalizedFinancialRow, publishedAt: string | undefined): FinancialSourceMetadata {
  return {
    plugin: row.plugin,
    source: row.source,
    retrievedAt: row.retrievedAt,
    quality: row.quality,
    confidence: row.confidence,
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

function metricNamesFor(statementType: FinancialStatementType): FinancialMetricName[] {
  switch (statementType) {
    case 'income':
      return ['revenue', 'operating_profit', 'net_profit', ...INDICATOR_METRICS]
    case 'balance-sheet':
      return ['total_assets', 'total_liabilities']
    case 'cash-flow':
      return ['operating_cash_flow']
  }
}

function mergeFinancialRows(rows: readonly NormalizedFinancialRow[]): NormalizedFinancialRow[] {
  const merged = new Map<string, NormalizedFinancialRow>()
  for (const row of rows) {
    const period = normalizeFinancialDate(row.period, 'period')
    const key = `${row.symbol}:${row.statementType}:${period}`
    const previous = merged.get(key)
    if (previous === undefined) {
      merged.set(key, row)
      continue
    }
    merged.set(key, {
      ...previous,
      reportDate: previous.reportDate ?? row.reportDate,
      values: { ...previous.values, ...row.values },
      quality: qualityRank(previous.quality) <= qualityRank(row.quality) ? previous.quality : row.quality,
      confidence: Math.min(previous.confidence, row.confidence),
    })
  }
  return [...merged.values()]
}

function unitForMetric(name: FinancialMetricName, row: NormalizedFinancialRow): string {
  if (name === 'eps') return 'CNY/share'
  if (name === 'gross_margin' || name === 'net_profit_margin' || name === 'debt_to_assets') return 'percent'
  if (name === 'current_ratio' || name === 'quick_ratio') return 'ratio'
  return row.unit ?? row.currency ?? 'CNY'
}

function qualityRank(value: NormalizedFinancialRow['quality']): number {
  return value === 'high' ? 0 : value === 'medium' ? 1 : 2
}

function inferPeriodType(end: string): FinancialPeriodType {
  const month = Number(end.slice(5, 7))
  return month === 12 ? 'annual' : 'quarterly'
}

function periodStart(end: string, periodType: FinancialPeriodType): string {
  const date = new Date(end)
  if (periodType === 'annual') {
    return new Date(Date.UTC(date.getUTCFullYear(), 0, 1)).toISOString()
  }
  const month = date.getUTCMonth()
  const quarterStart = Math.floor(month / 3) * 3
  return new Date(Date.UTC(date.getUTCFullYear(), quarterStart, 1)).toISOString()
}

function validateStatement(value: unknown, index: number): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected statement object', `$.statements[${index}]`)
  }
  const statement = value as Record<string, unknown>
  assertAllowedFields(statement, new Set(['id', 'symbol', 'statementType', 'fiscalPeriod', 'reportDate', 'currency', 'unit', 'lineItems', 'source']))
  assertNonEmptyString(statement.id, `$.statements[${index}].id`)
  assertSymbol(statement.symbol, `$.statements[${index}].symbol`)
  if (!FINANCIAL_STATEMENT_TYPES.includes(statement.statementType as FinancialStatementType)) {
    throw new PluginValidationError('unsupported statement type', `$.statements[${index}].statementType`)
  }
  validatePeriod(statement.fiscalPeriod, `$.statements[${index}].fiscalPeriod`)
  if (statement.reportDate !== undefined) assertTimestamp(statement.reportDate, `$.statements[${index}].reportDate`)
  assertNonEmptyString(statement.currency, `$.statements[${index}].currency`)
  assertNonEmptyString(statement.unit, `$.statements[${index}].unit`)
  if (!Array.isArray(statement.lineItems) || statement.lineItems.length === 0) {
    throw new PluginValidationError('expected non-empty lineItems', `$.statements[${index}].lineItems`)
  }
  statement.lineItems.forEach((item, itemIndex) => validateLineItem(item, `${index}.${itemIndex}`))
  validateSource(statement.source, `$.statements[${index}].source`)
}

function validateMetric(value: unknown, index: number): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected metric object', `$.metrics[${index}]`)
  }
  const metric = value as Record<string, unknown>
  assertAllowedFields(metric, new Set(['name', 'value', 'unit', 'period', 'calculationBasis', 'sourceStatementIds', 'confidence', 'source']))
  if (!Object.keys(METRIC_ALIASES).includes(String(metric.name))) {
    throw new PluginValidationError('unsupported financial metric', `$.metrics[${index}].name`)
  }
  if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
    throw new PluginValidationError('expected finite metric value', `$.metrics[${index}].value`)
  }
  assertNonEmptyString(metric.unit, `$.metrics[${index}].unit`)
  validatePeriod(metric.period, `$.metrics[${index}].period`)
  if (metric.calculationBasis !== 'reported' && metric.calculationBasis !== 'derived') {
    throw new PluginValidationError('invalid calculation basis', `$.metrics[${index}].calculationBasis`)
  }
  if (!Array.isArray(metric.sourceStatementIds) || metric.sourceStatementIds.length === 0 || !metric.sourceStatementIds.every(id => typeof id === 'string' && id.length > 0)) {
    throw new PluginValidationError('expected source statement IDs', `$.metrics[${index}].sourceStatementIds`)
  }
  assertConfidence(metric.confidence, `$.metrics[${index}].confidence`)
  validateSource(metric.source, `$.metrics[${index}].source`)
}

function validateLineItem(value: unknown, path: string): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected line item object', `$.lineItems[${path}]`)
  }
  const item = value as Record<string, unknown>
  assertAllowedFields(item, new Set(['name', 'value', 'unit']))
  assertNonEmptyString(item.name, `$.lineItems[${path}].name`)
  if (typeof item.value !== 'number' || !Number.isFinite(item.value)) {
    throw new PluginValidationError('expected finite line item value', `$.lineItems[${path}].value`)
  }
  assertNonEmptyString(item.unit, `$.lineItems[${path}].unit`)
}

function validatePeriod(value: unknown, path: string): asserts value is FinancialPeriod {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected period object', path)
  }
  const period = value as Record<string, unknown>
  assertAllowedFields(period, new Set(['start', 'end', 'periodType']))
  assertTimestamp(period.start, `${path}.start`)
  assertTimestamp(period.end, `${path}.end`)
  if (Date.parse(period.start) > Date.parse(period.end)) {
    throw new PluginValidationError('period start must not be after end', path)
  }
  if (!FINANCIAL_PERIOD_TYPES.includes(period.periodType as FinancialPeriodType)) {
    throw new PluginValidationError('invalid period type', `${path}.periodType`)
  }
}

function validateSource(value: unknown, path: string): asserts value is FinancialSourceMetadata {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginValidationError('expected source metadata object', path)
  }
  const source = value as Record<string, unknown>
  assertAllowedFields(source, new Set(['plugin', 'source', 'publishedAt', 'retrievedAt', 'quality', 'confidence']))
  assertNonEmptyString(source.plugin, `${path}.plugin`)
  assertNonEmptyString(source.source, `${path}.source`)
  if (source.publishedAt !== undefined) assertTimestamp(source.publishedAt, `${path}.publishedAt`)
  assertTimestamp(source.retrievedAt, `${path}.retrievedAt`)
  if (!['high', 'medium', 'low'].includes(String(source.quality))) {
    throw new PluginValidationError('invalid source quality', `${path}.quality`)
  }
  assertConfidence(source.confidence, `${path}.confidence`)
}

function assertAllowedFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new PluginValidationError(`unknown field: ${key}`)
    }
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PluginValidationError('expected a non-empty string', path)
  }
}

function assertSymbol(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) {
    throw new PluginValidationError('expected a six-digit A-share symbol', path)
  }
}

function assertTimestamp(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new PluginValidationError('expected an ISO timestamp', path)
  }
}

function assertConfidence(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new PluginValidationError('expected a number between 0 and 1', path)
  }
}
