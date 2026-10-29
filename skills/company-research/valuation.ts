export interface RelativeValuationInput { readonly metric: number; readonly peerMultiples: readonly number[]; readonly selectedMultiple?: number }
export interface RelativeValuationResult { readonly multiple: number; readonly impliedValue: number; readonly peerCount: number }
export function relativeValuation(input: RelativeValuationInput): RelativeValuationResult {
  if (!Number.isFinite(input.metric) || input.metric < 0) throw new TypeError('metric must be a finite non-negative number')
  const peers = input.peerMultiples.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
  if (peers.length === 0) throw new TypeError('peerMultiples must contain a positive finite multiple')
  const multiple = input.selectedMultiple ?? peers[Math.floor(peers.length / 2)]!
  if (!Number.isFinite(multiple) || multiple <= 0) throw new TypeError('selectedMultiple must be positive')
  return { multiple, impliedValue: metricValue(input.metric, multiple), peerCount: peers.length }
}

export interface ScenarioValuationCase { readonly name: string; readonly earnings: number; readonly multiple: number }
export interface ScenarioValuationResult { readonly cases: readonly (ScenarioValuationCase & { readonly value: number })[] }
export function scenarioValuation(cases: readonly ScenarioValuationCase[]): ScenarioValuationResult {
  if (cases.length === 0) throw new TypeError('At least one scenario is required')
  const normalized = cases.map((item) => {
    if (!item.name.trim() || !Number.isFinite(item.earnings) || !Number.isFinite(item.multiple) || item.multiple <= 0) throw new TypeError('Scenario inputs are invalid')
    if ('probability' in item) throw new TypeError('Scenario probabilities are not supported without a calibration-aware method')
    return { name: item.name, earnings: item.earnings, multiple: item.multiple, value: metricValue(item.earnings, item.multiple) }
  })
  return { cases: normalized }
}
function metricValue(metric: number, multiple: number): number { const value = metric * multiple; if (!Number.isFinite(value)) throw new TypeError('valuation result is not finite'); return value }
