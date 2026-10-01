export type MetricDataTypeV04 = 'number' | 'percentage' | 'currency' | 'text'

export interface MetricDefinitionV04 {
  readonly id: string
  readonly label: string
  readonly dataType: MetricDataTypeV04
  readonly canonicalUnit?: string | null
  readonly dimensions?: readonly string[]
  readonly description?: string | null
  readonly externalMappings?: Readonly<Record<string, string>>
}

export const METRIC_REGISTRY_V04: readonly MetricDefinitionV04[] = [
  { id: 'metric:revenue', label: 'Revenue', dataType: 'currency', canonicalUnit: 'currency' },
  { id: 'metric:market_cap', label: 'Market Capitalization', dataType: 'currency', canonicalUnit: 'currency' },
  { id: 'metric:net_profit', label: 'Net Profit', dataType: 'currency', canonicalUnit: 'currency' },
  { id: 'metric:gross_margin', label: 'Gross Margin', dataType: 'percentage', canonicalUnit: '%' },
  { id: 'metric:net_profit_margin', label: 'Net Profit Margin', dataType: 'percentage', canonicalUnit: '%' },
  { id: 'metric:eps', label: 'EPS', dataType: 'currency', canonicalUnit: 'per_share' },
  { id: 'metric:current_ratio', label: 'Current Ratio', dataType: 'number' },
  { id: 'metric:quick_ratio', label: 'Quick Ratio', dataType: 'number' },
  { id: 'metric:debt_to_assets', label: 'Debt to Assets', dataType: 'percentage', canonicalUnit: '%' },
  { id: 'metric:capacity', label: 'Capacity', dataType: 'number' },
  { id: 'metric:shipment', label: 'Shipment', dataType: 'number' },
  { id: 'metric:asp', label: 'Average Selling Price', dataType: 'currency', canonicalUnit: 'currency' },
  { id: 'metric:market_share', label: 'Market Share', dataType: 'percentage', canonicalUnit: '%' },
]

const METRICS = new Map(METRIC_REGISTRY_V04.map((metric) => [metric.id, metric]))

export function getMetricDefinitionV04(id: string): MetricDefinitionV04 | undefined {
  return METRICS.get(id)
}

export function isMetricRefV04(value: unknown): value is string {
  return typeof value === 'string' && METRICS.has(value)
}
