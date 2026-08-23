import { FinancialPluginError } from './errors.ts'
import { safePluginMessage } from '../market-types.ts'

export interface FinancialHttpTransport {
  request(input: string, init?: RequestInit): Promise<Response>
}

export async function readFinancialJson(
  response: Response,
  pluginName: string,
  secrets: readonly (string | undefined)[] = [],
): Promise<unknown> {
  if (!response.ok) {
    throw new FinancialPluginError(`${pluginName} request failed with HTTP ${response.status}`)
  }
  try {
    return await response.json() as unknown
  } catch (cause) {
    throw new FinancialPluginError(
      `${pluginName} response was not valid JSON: ${safePluginMessage(cause, secrets)}`,
      cause,
    )
  }
}

export function readTushareRows(payload: unknown, pluginName: string, secrets: readonly (string | undefined)[]): Record<string, unknown>[] {
  if (!isRecord(payload) || payload.code !== 0) {
    const message = isRecord(payload) && typeof payload.msg === 'string' && payload.msg.trim().length > 0
      ? payload.msg.trim()
      : 'Tushare API returned an error'
    throw new FinancialPluginError(`${pluginName} API error: ${safePluginMessage(message, secrets)}`)
  }
  if (!isRecord(payload.data) || !Array.isArray(payload.data.items) || payload.data.items.length === 0) {
    throw new FinancialPluginError(`${pluginName} response is empty`)
  }
  const fields = payload.data.fields
  return payload.data.items.map((item, index) => {
    if (isRecord(item)) {
      return item
    }
    if (!Array.isArray(item) || !Array.isArray(fields)) {
      throw new FinancialPluginError(`${pluginName} response is malformed at row ${index}`)
    }
    const row: Record<string, unknown> = {}
    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      const field = fields[fieldIndex]
      if (typeof field !== 'string' || field.trim().length === 0) {
        throw new FinancialPluginError(`${pluginName} response contains an invalid field list`)
      }
      row[field] = item[fieldIndex]
    }
    return row
  })
}

export function readAkShareRows(payload: unknown, pluginName: string): Record<string, unknown>[] {
  if (!isRecord(payload)) {
    throw new FinancialPluginError(`${pluginName} response is malformed`)
  }
  const data = isRecord(payload.data) ? payload.data : payload
  const statements = isRecord(data.statements) ? data.statements : data
  const rows: Record<string, unknown>[] = []
  for (const [key, value] of Object.entries(statements)) {
    if (!Array.isArray(value)) {
      continue
    }
    for (const item of value) {
      if (!isRecord(item)) {
        throw new FinancialPluginError(`${pluginName} response contains an invalid row`)
      }
      if (key === 'income' || key === 'income_statement') {
        rows.push({ statementType: 'income', ...item })
      } else if (key === 'balance-sheet' || key === 'balance_sheet' || key === 'balance') {
        rows.push({ statementType: 'balance-sheet', ...item })
      } else if (key === 'cash-flow' || key === 'cash_flow' || key === 'cashflow') {
        rows.push({ statementType: 'cash-flow', ...item })
      } else {
        rows.push(item)
      }
    }
  }
  if (rows.length === 0) {
    throw new FinancialPluginError(`${pluginName} response is empty`)
  }
  return rows
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
