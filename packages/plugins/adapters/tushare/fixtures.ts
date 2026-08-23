export const TUSHARE_DAILY_RESPONSE_FIXTURE = {
  code: 0,
  msg: '',
  data: {
    fields: ['ts_code', 'trade_date', 'close', 'change', 'pct_chg', 'vol'],
    items: [['600519.SH', '20260821', 1680.5, 12.5, 0.75, 123456.7]],
  },
} as const

export const TUSHARE_DAILY_CHANGE_ONLY_FIXTURE = {
  code: 0,
  msg: '',
  data: {
    fields: ['ts_code', 'trade_date', 'close', 'change', 'vol'],
    items: [['000001.SZ', '2026-08-21', '12.34', '-0.12', '250,000']],
  },
} as const
