import { assertNonEmptyString, assertTimestamp, createEvidence, normalizeSymbol } from '../../shared/research-report.ts'
import type { DcfResult, ValuationAssumptions, ValuationInput, ValuationPeer, ValuationPlugins, ValuationResult, ValuationSection, ValuationStatistic } from '../types.ts'

const peerMetrics: ValuationStatistic['metric'][] = ['evRevenue', 'evEbitda', 'pe', 'revenueGrowth', 'ebitdaMargin']

export async function runValuationCommand(input: ValuationInput, plugins: ValuationPlugins): Promise<ValuationResult> {
  const normalized = validateInput(input)
  const peers = await plugins.peers.list_peer_valuations({ symbol: normalized.symbol })
  validatePeers(peers)
  const currentPrice = normalized.currentPrice ?? (plugins.market === undefined ? undefined : (await plugins.market.get_market_snapshot({ symbol: normalized.symbol })).price)
  const statistics = peerMetrics.map((metric) => summarize(metric, peers))
  const dcf = calculateDcf(normalized.forecasts, normalized.assumptions)
  const evidence = [
    createEvidence('valuation-peers-1', 'peer-valuation-plugin', normalized.asOf, 'Comparable company valuation and operating benchmarks', { peers, statistics }),
    createEvidence('valuation-dcf-1', 'valuation-method', normalized.asOf, 'DCF valuation with sensitivity analysis', { dcf, assumptions: normalized.assumptions, forecasts: normalized.forecasts }),
  ]
  const sections: ValuationSection[] = [
    makeSection('peer-selection', 'Peer Selection', ['Select peers by business model, scale, geography, and industry comparability; record exclusions.'], ['valuation-peers-1']),
    makeSection('operating-benchmarks', 'Operating and Multiple Benchmarks', ['Compare growth, margins, EV/Revenue, EV/EBITDA, and P/E with min, quartile, median, and max statistics.'], ['valuation-peers-1']),
    makeSection('dcf', 'DCF Valuation', ['Project free cash flow, discount it using WACC, calculate terminal value, bridge to equity value, and show sensitivity.'], ['valuation-dcf-1']),
    makeSection('cross-checks', 'Valuation Cross-Checks', ['Compare implied multiples, terminal value concentration, and forecast assumptions with peer benchmarks.'], ['valuation-peers-1', 'valuation-dcf-1']),
    makeSection('risks', 'Valuation Risks', ['Highlight sensitivity to WACC, terminal growth, margins, revenue growth, net debt, and peer selection.'], ['valuation-dcf-1']),
  ]
  return {
    skillId: 'valuation',
    subject: `${normalized.companyName} (${normalized.symbol})`,
    asOf: normalized.asOf,
    template: 'valuation-analysis-report',
    sections,
    evidence,
    keyRisks: ['DCF value is highly sensitive to WACC, terminal growth, and forecast cash flow.', 'Comparable-company conclusions depend on peer selection, source freshness, and business-model comparability.'],
    openQuestions: [currentPrice === undefined ? 'What current market price should be used for upside/downside?' : `Current price is ${currentPrice}; which valuation assumption deserves the next review?`],
    peers,
    statistics,
    dcf,
  }
}

function calculateDcf(forecasts: ValuationInput['forecasts'], assumptions: ValuationAssumptions): DcfResult {
  const presentValueOfForecasts = forecasts.reduce((total, forecast, index) => total + forecast.freeCashFlow / (1 + assumptions.wacc) ** (index + 1), 0)
  const last = forecasts[forecasts.length - 1]
  const terminalValue = last.freeCashFlow * (1 + assumptions.terminalGrowth) / (assumptions.wacc - assumptions.terminalGrowth)
  const presentValueOfTerminalValue = terminalValue / (1 + assumptions.wacc) ** forecasts.length
  const enterpriseValue = presentValueOfForecasts + presentValueOfTerminalValue
  const equityValue = enterpriseValue - assumptions.netDebt
  const impliedSharePrice = equityValue / assumptions.sharesOutstanding
  const sensitivity = [-0.01, 0, 0.01].flatMap((waccDelta) => [-0.005, 0, 0.005].map((growthDelta) => {
    const wacc = assumptions.wacc + waccDelta
    const terminalGrowth = assumptions.terminalGrowth + growthDelta
    const terminal = last.freeCashFlow * (1 + terminalGrowth) / (wacc - terminalGrowth)
    const pvTerminal = terminal / (1 + wacc) ** forecasts.length
    const pvForecasts = forecasts.reduce((total, forecast, index) => total + forecast.freeCashFlow / (1 + wacc) ** (index + 1), 0)
    return { wacc, terminalGrowth, impliedSharePrice: (pvForecasts + pvTerminal - assumptions.netDebt) / assumptions.sharesOutstanding }
  }))
  return { enterpriseValue, equityValue, impliedSharePrice, presentValueOfForecasts, presentValueOfTerminalValue, terminalValueShare: presentValueOfTerminalValue / enterpriseValue, sensitivity }
}

function summarize(metric: ValuationStatistic['metric'], peers: ValuationPeer[]): ValuationStatistic {
  const values = peers.map((peer) => peer[metric]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b)
  if (values.length === 0) return { metric, count: 0 }
  return { metric, count: values.length, min: values[0], percentile25: percentile(values, 0.25), median: percentile(values, 0.5), percentile75: percentile(values, 0.75), max: values[values.length - 1] }
}

function percentile(values: number[], fraction: number): number {
  const position = (values.length - 1) * fraction
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  return values[lower] + (values[upper] - values[lower]) * (position - lower)
}

function makeSection(id: ValuationSection['id'], title: string, findings: string[], evidenceIds: string[]): ValuationSection {
  return { id, title, findings, evidenceIds }
}

function validateInput(input: ValuationInput): ValuationInput & { symbol: string } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('valuation input must be an object')
  const value = input as unknown as Record<string, unknown>
  assertNonEmptyString(value.companyName, '$.companyName')
  assertTimestamp(value.asOf, '$.asOf')
  if (!Array.isArray(value.forecasts) || value.forecasts.length === 0) throw new TypeError('valuation forecasts must be a non-empty array')
  if (value.assumptions === null || typeof value.assumptions !== 'object' || Array.isArray(value.assumptions)) throw new TypeError('valuation assumptions must be an object')
  const assumptions = value.assumptions as ValuationAssumptions
  if (!(assumptions.wacc > assumptions.terminalGrowth) || assumptions.sharesOutstanding <= 0 || assumptions.netDebt < 0) throw new RangeError('valuation assumptions are invalid')
  for (const forecast of value.forecasts as ValuationInput['forecasts']) {
    if (!Number.isFinite(forecast.freeCashFlow) || !Number.isFinite(forecast.revenue) || !Number.isFinite(forecast.ebitda)) throw new TypeError('valuation forecast values must be finite numbers')
  }
  return { ...input, symbol: normalizeSymbol(value.symbol, '$.symbol'), companyName: value.companyName.trim(), asOf: value.asOf }
}

function validatePeers(peers: ValuationPeer[]): void {
  if (!Array.isArray(peers)) throw new TypeError('valuation peer Plugin must return an array')
  for (const peer of peers) {
    assertNonEmptyString(peer.symbol, '$.peer.symbol')
    assertNonEmptyString(peer.name, '$.peer.name')
    assertNonEmptyString(peer.source, '$.peer.source')
    assertTimestamp(peer.asOf, '$.peer.asOf')
  }
}
