/** Availability instant for an exchange daily close after the Shanghai close. */
export function dailyCloseAvailableAt(priceDate: string): string {
  return new Date(`${priceDate}T15:00:00+08:00`).toISOString()
}

export interface MarketCloseFreshness {
  readonly status: 'FRESH' | 'STALE' | 'UNVERIFIABLE'
  readonly priceDate: string
  readonly analysisAsOf: string
  readonly completedSessionsSincePrice?: number
  readonly maximumMissedSessions: 1
  readonly calendarSource: 'AKSHARE_SINA' | 'SHORT_GAP_FALLBACK' | 'UNAVAILABLE'
  readonly diagnostic?: 'MARKET_PRICE_STALE' | 'MARKET_FRESHNESS_UNVERIFIABLE' | 'MARKET_CALENDAR_DATE_MISMATCH'
}

function validIsoDay(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function shanghaiDate(timestamp: string): string | undefined {
  const instant = Date.parse(timestamp)
  return Number.isFinite(instant) ? new Date(instant + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10) : undefined
}

/**
 * A quote remains usable through one completed exchange session without an
 * updated bar (normal publication lag). Two or more missed sessions are stale.
 * When the exchange calendar is unavailable, only a gap of at most three
 * calendar days is accepted; longer gaps are unverified rather than falsely
 * called stale, which preserves weekends while failing closed on long holidays.
 */
export function assessMarketCloseFreshness(input: {
  readonly priceDate: string
  readonly analysisAsOf: string
  readonly tradingDates?: readonly string[]
}): MarketCloseFreshness {
  const { priceDate, analysisAsOf } = input
  const asOfDate = shanghaiDate(analysisAsOf)
  const base = { priceDate, analysisAsOf, maximumMissedSessions: 1 as const }
  if (!validIsoDay(priceDate) || asOfDate === undefined || priceDate > asOfDate || Date.parse(dailyCloseAvailableAt(priceDate)) > Date.parse(analysisAsOf)) {
    return { ...base, status: 'UNVERIFIABLE', calendarSource: 'UNAVAILABLE', diagnostic: 'MARKET_FRESHNESS_UNVERIFIABLE' }
  }
  const tradingDates = input.tradingDates?.filter(validIsoDay)
  if (tradingDates && tradingDates.length > 0) {
    const sessions = [...new Set(tradingDates)].sort()
    if (!sessions.includes(priceDate)) return { ...base, status: 'UNVERIFIABLE', calendarSource: 'AKSHARE_SINA', diagnostic: 'MARKET_CALENDAR_DATE_MISMATCH' }
    const completedSessionsSincePrice = sessions.filter((date) => date > priceDate && date <= asOfDate && Date.parse(dailyCloseAvailableAt(date)) <= Date.parse(analysisAsOf)).length
    if (completedSessionsSincePrice > 1) return { ...base, status: 'STALE', completedSessionsSincePrice, calendarSource: 'AKSHARE_SINA', diagnostic: 'MARKET_PRICE_STALE' }
    return { ...base, status: 'FRESH', completedSessionsSincePrice, calendarSource: 'AKSHARE_SINA' }
  }
  const elapsedCalendarDays = (Date.parse(`${asOfDate}T00:00:00.000Z`) - Date.parse(`${priceDate}T00:00:00.000Z`)) / 86_400_000
  if (elapsedCalendarDays <= 3) return { ...base, status: 'FRESH', calendarSource: 'SHORT_GAP_FALLBACK' }
  return { ...base, status: 'UNVERIFIABLE', calendarSource: 'UNAVAILABLE', diagnostic: 'MARKET_FRESHNESS_UNVERIFIABLE' }
}
