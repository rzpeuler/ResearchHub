import type { DataPlugin, FinancialDataQuality } from '../../core/index.ts'

export const FINANCIAL_STATEMENT_TYPES = ['income', 'balance-sheet', 'cash-flow'] as const
export type FinancialStatementType = (typeof FINANCIAL_STATEMENT_TYPES)[number]

export const FINANCIAL_PERIOD_TYPES = ['annual', 'quarterly', 'ttm'] as const
export type FinancialPeriodType = (typeof FINANCIAL_PERIOD_TYPES)[number]

export interface FinancialPeriod {
  start: string
  end: string
  periodType: FinancialPeriodType
}

export interface FinancialSourceMetadata {
  plugin: string
  source: string
  publishedAt?: string
  retrievedAt: string
  quality: FinancialDataQuality
  confidence: number
}

export interface FinancialLineItem {
  name: string
  value: number
  unit: string
}

export interface FinancialStatement {
  id: string
  symbol: string
  statementType: FinancialStatementType
  fiscalPeriod: FinancialPeriod
  reportDate?: string
  currency: string
  unit: string
  lineItems: FinancialLineItem[]
  source: FinancialSourceMetadata
}

export type FinancialMetricName =
  | 'revenue'
  | 'operating_profit'
  | 'net_profit'
  | 'gross_margin'
  | 'net_profit_margin'
  | 'eps'
  | 'current_ratio'
  | 'quick_ratio'
  | 'debt_to_assets'
  | 'total_assets'
  | 'total_liabilities'
  | 'operating_cash_flow'

export interface FinancialMetric {
  name: FinancialMetricName
  value: number
  unit: string
  period: FinancialPeriod
  calculationBasis: 'reported' | 'derived'
  sourceStatementIds: string[]
  confidence: number
  source: FinancialSourceMetadata
}

export interface FinancialDataRequest {
  symbol: string
  statementTypes?: FinancialStatementType[]
  periodType?: FinancialPeriodType
}

export interface FinancialData {
  symbol: string
  statements: FinancialStatement[]
  metrics: FinancialMetric[]
}

export type FinancialDataPlugin = DataPlugin<FinancialDataRequest, FinancialData>
