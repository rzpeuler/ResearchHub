export const AKSHARE_BRIDGE_RESPONSE_FIXTURE = {
  data: [{
    代码: '600519',
    收盘: '1680.50',
    涨跌幅: '0.75',
    成交量: '123,456.7',
    日期: '2026-08-21',
  }],
} as const

export const AKSHARE_BRIDGE_CHANGE_AMOUNT_FIXTURE = {
  data: [{
    code: '000001',
    close: 12.34,
    涨跌额: '-0.12',
    volume: 250000,
  }],
} as const
