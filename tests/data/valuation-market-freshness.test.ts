import assert from 'node:assert/strict'
import test from 'node:test'
import { materializePhase2CommonRequirement } from '../../data/requirements.ts'
import { createValuationDataResolver } from '../../plugins/research-acquisition/valuation-data.ts'
import type { AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import { assessMarketCloseFreshness } from '../../data/point-in-time.ts'
import { normalizeValuationMarketData } from '../../plugins/research-acquisition/valuation-normalization.ts'

const CALENDAR_WEEK = [
  { trade_date: '2026-10-08' },
  { trade_date: '2026-10-09' },
  { trade_date: '2026-10-12' },
]

function marketRequirement(asOf = '2026-10-09T07:00:00.000Z') {
  return materializePhase2CommonRequirement('valuation_market_price', { workflowId: 'valuation', ticker: '600519', asOf, period: { end: '2026-10-09' }, required: true })
}

function marketResolver(input: { readonly eastmoney?: readonly Record<string, unknown>[]; readonly tencent?: readonly Record<string, unknown>[]; readonly eastmoneyError?: Error; readonly calendar?: readonly Record<string, unknown>[] }) {
  const calls: string[] = []
  const akshare = {
    companyBasic: async () => [], financialData: async () => [], historicalMarketData: async () => { calls.push('EastMoney'); if (input.eastmoneyError) throw input.eastmoneyError; return input.eastmoney ?? [{ date: '2026-10-09', close: 105 }] },
    historicalMarketDataTencent: async () => { calls.push('Tencent'); return input.tencent ?? [{ date: '2026-10-09', close: 105 }] },
    tradingCalendar: async () => input.calendar ?? CALENDAR_WEEK,
  } as unknown as AkshareDataClient
  return { calls, resolver: createValuationDataResolver({ akshare, company: { symbol: '600519', name: 'Fixture', exchange: 'SH' }, valuationDate: '2026-10-09', now: () => '2026-10-09T07:00:00.000Z' }) }
}

test('market selection excludes an unfinished current-session close before 15:00 Shanghai', () => {
  const result = normalizeValuationMarketData([
    { date: '2026-10-08', close: 100 },
    { date: '2026-10-09', close: 105 },
  ], '2026-10-09', '2026-10-09T06:00:00.000Z', CALENDAR_WEEK)
  assert.deepEqual(result.observation, { priceDate: '2026-10-08', close: 100 })
  assert.equal(result.freshness?.status, 'FRESH')
})

test('market selection permits the same-session close at and after 15:00 Shanghai', () => {
  const result = normalizeValuationMarketData([
    { date: '2026-10-08', close: 100 },
    { date: '2026-10-09', close: 105 },
  ], '2026-10-09', '2026-10-09T07:00:00.000Z', CALENDAR_WEEK)
  assert.deepEqual(result.observation, { priceDate: '2026-10-09', close: 105 })
})

test('a Friday close remains fresh over a normal weekend', () => {
  const result = assessMarketCloseFreshness({ priceDate: '2026-10-09', analysisAsOf: '2026-10-11T12:00:00.000Z', tradingDates: CALENDAR_WEEK.map((row) => row.trade_date) })
  assert.equal(result.status, 'FRESH')
  assert.equal(result.completedSessionsSincePrice, 0)
})

test('exchange holidays do not count as missed trading sessions', () => {
  const result = assessMarketCloseFreshness({ priceDate: '2026-10-09', analysisAsOf: '2026-10-14T06:00:00.000Z', tradingDates: ['2026-10-09', '2026-10-14', '2026-10-15'] })
  assert.equal(result.status, 'FRESH')
  assert.equal(result.completedSessionsSincePrice, 0)
})

test('a long suspension or stale feed is rejected after two completed sessions', () => {
  const result = assessMarketCloseFreshness({ priceDate: '2026-10-05', analysisAsOf: '2026-10-09T08:00:00.000Z', tradingDates: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'] })
  assert.equal(result.status, 'STALE')
  assert.equal(result.completedSessionsSincePrice, 4)
  assert.equal(result.diagnostic, 'MARKET_PRICE_STALE')
})

test('an extended gap without a usable exchange calendar is unverifiable, not falsely stale', () => {
  const result = assessMarketCloseFreshness({ priceDate: '2026-10-02', analysisAsOf: '2026-10-09T08:00:00.000Z' })
  assert.equal(result.status, 'UNVERIFIABLE')
  assert.equal(result.diagnostic, 'MARKET_FRESHNESS_UNVERIFIABLE')
})

test('a same-day bar before close has an explicit not-yet-closed diagnostic', () => {
  const result = normalizeValuationMarketData([{ date: '2026-10-09', close: 105 }], '2026-10-09', '2026-10-09T06:00:00.000Z', CALENDAR_WEEK)
  assert.equal(result.observation, undefined)
  assert.ok(result.diagnostics.includes('MARKET_NOT_YET_CLOSED'))
})

test('future market rows are rejected with a PIT diagnostic', () => {
  const result = normalizeValuationMarketData([{ date: '2026-10-10', close: 105 }], '2026-10-09', '2026-10-09T08:00:00.000Z', CALENDAR_WEEK)
  assert.equal(result.observation, undefined)
  assert.ok(result.diagnostics.includes('MARKET_PIT_REJECTED'))
})

test('fixed historical asOf selects only a close available at that cutoff', () => {
  const result = normalizeValuationMarketData([
    { date: '2026-10-08', close: 100 },
    { date: '2026-10-09', close: 105 },
  ], '2026-10-09', '2026-10-09T06:00:00.000Z', CALENDAR_WEEK)
  assert.deepEqual(result.observation, { priceDate: '2026-10-08', close: 100 })
})

test('DataResolver accepts the EastMoney primary when its close is fresh', async () => {
  const { calls, resolver } = marketResolver({ eastmoney: [{ date: '2026-10-09', close: 105 }] })
  const result = await resolver.resolve([marketRequirement()])
  assert.equal(result.items[0]?.status, 'AVAILABLE')
  assert.equal(result.items[0]?.source?.originPublisher, 'EastMoney')
  assert.deepEqual(calls, ['EastMoney'])
})

test('DataResolver rejects a stale primary and selects a fresh Tencent fallback', async () => {
  const { resolver } = marketResolver({
    eastmoney: [{ date: '2026-10-05', close: 99 }],
    tencent: [{ date: '2026-10-09', close: 105 }],
    calendar: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((trade_date) => ({ trade_date })),
  })
  const result = await resolver.resolve([marketRequirement()])
  assert.equal(result.items[0]?.status, 'AVAILABLE')
  assert.equal(result.items[0]?.source?.originPublisher, 'Tencent')
  assert.deepEqual(result.items[0]?.attempts.map((attempt) => attempt.status), ['STALE', 'SUCCESS'])
})

test('DataResolver rejects stale primary and fallback quotes with an explicit diagnostic', async () => {
  const staleRows = [{ date: '2026-10-05', close: 99 }]
  const { resolver } = marketResolver({ eastmoney: staleRows, tencent: staleRows, calendar: ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].map((trade_date) => ({ trade_date })) })
  const result = await resolver.resolve([marketRequirement()])
  assert.equal(result.items[0]?.status, 'UNAVAILABLE')
  assert.equal(result.items[0]?.unavailableReason, 'PIT_INVALID')
  assert.deepEqual(result.items[0]?.attempts.map((attempt) => [attempt.status, attempt.diagnostic]), [
    ['STALE', 'MARKET_PRICE_STALE'],
    ['STALE', 'MARKET_PRICE_STALE'],
  ])
})
