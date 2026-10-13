/** Availability instant for an exchange daily close after the Shanghai close. */
export function dailyCloseAvailableAt(priceDate: string): string {
  return new Date(`${priceDate}T15:00:00+08:00`).toISOString()
}

export interface MarketCloseFreshness {
  readonly status: 'FRESH' | 'STALE' | 'UNVERIFIABLE'
  readonly priceDate: string
  readonly analysisAsOf: string
  readonly completedSessionsSincePrice?: number
  readonly completedSessionDates: readonly string[]
  readonly maximumMissedSessions: 1
  readonly calendarSource: 'AKSHARE_SINA' | 'SHORT_GAP_FALLBACK' | 'UNAVAILABLE'
  readonly calendarCoverage?: MarketTradingCalendarCoverage
  readonly diagnostic?: 'MARKET_PRICE_STALE' | 'MARKET_FRESHNESS_UNVERIFIABLE' | 'MARKET_CALENDAR_DATE_MISMATCH'
}

export interface MarketTradingCalendarCoverage {
  readonly requestedStartDate: string
  readonly requestedEndDate: string
  readonly returnedStartDate: string
  readonly returnedEndDate: string
}

function validTimestamp(value: string): boolean { return Number.isFinite(Date.parse(value)) }

function cutoffDate(value: string): string | undefined {
  return validTimestamp(value) ? shanghaiDate(value) : undefined
}

function completedWeekdaysAfter(priceDate: string, analysisAsOf: string): readonly string[] | undefined {
  const asOfDate = cutoffDate(analysisAsOf)
  if (!validIsoDay(priceDate) || asOfDate === undefined || priceDate > asOfDate) return undefined
  const dates: string[] = []
  const cursor = new Date(`${priceDate}T00:00:00.000Z`)
  cursor.setUTCDate(cursor.getUTCDate() + 1)
  const end = new Date(`${asOfDate}T00:00:00.000Z`)
  while (cursor <= end) {
    const weekday = cursor.getUTCDay()
    const date = cursor.toISOString().slice(0, 10)
    if (weekday !== 0 && weekday !== 6 && Date.parse(dailyCloseAvailableAt(date)) <= Date.parse(analysisAsOf)) dates.push(date)
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
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
 * Without a calendar, weekdays are treated as possible sessions and holidays
 * are never inferred. Zero or one possible completed session is acceptable;
 * two or more possible sessions are unverifiable. Weekends are excluded by
 * their deterministic weekday, without assuming exchange holidays.
 */
export function assessMarketCloseFreshness(input: {
  readonly priceDate: string
  readonly analysisAsOf: string
  readonly tradingDates?: readonly string[]
  readonly calendarCoverage?: MarketTradingCalendarCoverage
  readonly calendarAttempted?: boolean
}): MarketCloseFreshness {
  const { priceDate, analysisAsOf } = input
  const asOfDate = shanghaiDate(analysisAsOf)
  const base = { priceDate, analysisAsOf, completedSessionDates: [] as readonly string[], maximumMissedSessions: 1 as const }
  if (!validIsoDay(priceDate) || asOfDate === undefined || priceDate > asOfDate || Date.parse(dailyCloseAvailableAt(priceDate)) > Date.parse(analysisAsOf)) {
    return { ...base, status: 'UNVERIFIABLE', calendarSource: 'UNAVAILABLE', diagnostic: 'MARKET_FRESHNESS_UNVERIFIABLE' }
  }
  if (input.tradingDates?.some((date) => !validIsoDay(date))) return { ...base, status: 'UNVERIFIABLE', calendarSource: 'AKSHARE_SINA', diagnostic: 'MARKET_FRESHNESS_UNVERIFIABLE' }
  const tradingDates = input.tradingDates
  if (input.calendarAttempted && (!tradingDates || tradingDates.length === 0)) return { ...base, status: 'UNVERIFIABLE', calendarSource: 'AKSHARE_SINA', diagnostic: 'MARKET_FRESHNESS_UNVERIFIABLE' }
  if (tradingDates && tradingDates.length > 0) {
    const sessions = [...new Set(tradingDates)].sort()
    const coverage = input.calendarCoverage
    if (!coverage
      || !validIsoDay(coverage.requestedStartDate)
      || !validIsoDay(coverage.requestedEndDate)
      || !validIsoDay(coverage.returnedStartDate)
      || !validIsoDay(coverage.returnedEndDate)
      || coverage.requestedStartDate > priceDate
      || coverage.requestedEndDate < asOfDate
      || coverage.returnedStartDate > priceDate
      || coverage.returnedEndDate < asOfDate) {
      return { ...base, status: 'UNVERIFIABLE', calendarSource: 'AKSHARE_SINA', diagnostic: 'MARKET_FRESHNESS_UNVERIFIABLE' }
    }
    if (!sessions.includes(priceDate)) return { ...base, status: 'UNVERIFIABLE', calendarSource: 'AKSHARE_SINA', calendarCoverage: coverage, diagnostic: 'MARKET_CALENDAR_DATE_MISMATCH' }
    const completedSessionDates = sessions.filter((date) => date > priceDate && date <= asOfDate && Date.parse(dailyCloseAvailableAt(date)) <= Date.parse(analysisAsOf))
    const completedSessionsSincePrice = completedSessionDates.length
    if (completedSessionsSincePrice > 1) return { ...base, status: 'STALE', completedSessionsSincePrice, completedSessionDates, calendarSource: 'AKSHARE_SINA', calendarCoverage: coverage, diagnostic: 'MARKET_PRICE_STALE' }
    return { ...base, status: 'FRESH', completedSessionsSincePrice, completedSessionDates, calendarSource: 'AKSHARE_SINA', calendarCoverage: coverage }
  }
  const possibleSessions = completedWeekdaysAfter(priceDate, analysisAsOf)
  if (!possibleSessions) return { ...base, status: 'UNVERIFIABLE', calendarSource: 'UNAVAILABLE', diagnostic: 'MARKET_FRESHNESS_UNVERIFIABLE' }
  if (possibleSessions.length <= 1) return { ...base, status: 'FRESH', completedSessionsSincePrice: possibleSessions.length, completedSessionDates: possibleSessions, calendarSource: 'SHORT_GAP_FALLBACK' }
  return { ...base, status: 'UNVERIFIABLE', completedSessionsSincePrice: possibleSessions.length, completedSessionDates: possibleSessions, calendarSource: 'UNAVAILABLE', diagnostic: 'MARKET_FRESHNESS_UNVERIFIABLE' }
}

/** Re-checks freshness against the point-in-time fields before DataResolver accepts a quote. */
export function validateMarketCloseFreshnessMetadata(input: {
  readonly freshness: MarketCloseFreshness
  readonly observedAt: string
  readonly observationAvailableAt: string
  readonly analysisAsOf: string
  readonly requestedPeriodEnd: string
}): string | undefined {
  const { freshness, observedAt, observationAvailableAt, analysisAsOf, requestedPeriodEnd } = input
  const observedDate = observedAt.slice(0, 10)
  const asOfDate = cutoffDate(analysisAsOf)
  const periodEnd = requestedPeriodEnd.slice(0, 10)
  if (!validIsoDay(observedDate) || !validTimestamp(observationAvailableAt) || asOfDate === undefined || !validIsoDay(periodEnd)) return 'MARKET_FRESHNESS_UNVERIFIABLE'
  if (freshness.priceDate !== observedDate || !validTimestamp(freshness.analysisAsOf) || Date.parse(freshness.analysisAsOf) !== Date.parse(analysisAsOf)) return 'MARKET_FRESHNESS_METADATA_MISMATCH'
  if (observedDate > periodEnd) return 'MARKET_FRESHNESS_METADATA_MISMATCH'
  if (Date.parse(observationAvailableAt) < Date.parse(dailyCloseAvailableAt(observedDate)) || Date.parse(observationAvailableAt) > Date.parse(analysisAsOf)) return 'MARKET_FRESHNESS_METADATA_MISMATCH'
  if (freshness.status === 'UNVERIFIABLE') return freshness.diagnostic ?? 'MARKET_FRESHNESS_UNVERIFIABLE'
  const completedSessionDates = freshness.completedSessionDates
  if (!Array.isArray(completedSessionDates)
    || completedSessionDates.some((date, index) => !validIsoDay(date) || date <= observedDate || date > asOfDate || Date.parse(dailyCloseAvailableAt(date)) > Date.parse(analysisAsOf) || index > 0 && completedSessionDates[index - 1]! >= date)
    || freshness.completedSessionsSincePrice !== completedSessionDates.length) return 'MARKET_FRESHNESS_METADATA_MISMATCH'
  if (freshness.calendarSource === 'SHORT_GAP_FALLBACK') {
    const possibleSessions = completedWeekdaysAfter(observedDate, analysisAsOf)
    if (!possibleSessions || possibleSessions.length > 1 || freshness.status !== 'FRESH' || JSON.stringify(completedSessionDates) !== JSON.stringify(possibleSessions) || freshness.calendarCoverage !== undefined) return 'MARKET_FRESHNESS_METADATA_MISMATCH'
    return undefined
  }
  if (freshness.calendarSource === 'AKSHARE_SINA') {
    const coverage = freshness.calendarCoverage
    if (!coverage
      || !validIsoDay(coverage.requestedStartDate)
      || !validIsoDay(coverage.requestedEndDate)
      || !validIsoDay(coverage.returnedStartDate)
      || !validIsoDay(coverage.returnedEndDate)
      || coverage.requestedStartDate > observedDate
      || coverage.requestedEndDate < asOfDate
      || coverage.returnedStartDate > observedDate
      || coverage.returnedEndDate < asOfDate
      || freshness.completedSessionsSincePrice === undefined
      || !Number.isInteger(freshness.completedSessionsSincePrice)
      || freshness.completedSessionsSincePrice < 0
      || freshness.completedSessionsSincePrice > 1 && freshness.status !== 'STALE'
      || freshness.completedSessionsSincePrice <= 1 && freshness.status === 'STALE') return 'MARKET_FRESHNESS_UNVERIFIABLE'
    return undefined
  }
  return 'MARKET_FRESHNESS_UNVERIFIABLE'
}
