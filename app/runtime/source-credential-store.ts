import type { SourceCredentialStore } from '../services/data-source-administration-contracts.ts'

const MAX_FIELDS = 16
// The Windows backend encodes the complete password as UTF-16 and caps it at
// 2560 bytes. Leave a small margin for native framing.
const MAX_VALUE_BYTES = 2048
const MAX_PAYLOAD_BYTES = 2048
const MAX_PAYLOAD_UTF16_BYTES = 2400
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FIELD_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u

export interface SourceVaultDriver {
  read(integrationId: string): Promise<string | null | undefined>
  write(integrationId: string, payload: string): Promise<void>
  delete(integrationId: string): Promise<void>
}

export class SourceCredentialError extends Error {
  constructor(readonly code: 'INVALID_SOURCE_CREDENTIAL' | 'SOURCE_VAULT_UNAVAILABLE') {
    super(code === 'INVALID_SOURCE_CREDENTIAL'
      ? 'Invalid source credential input.'
      : 'OS credential vault unavailable.')
    this.name = 'SourceCredentialError'
  }
}

function invalid(): never {
  throw new SourceCredentialError('INVALID_SOURCE_CREDENTIAL')
}

function unavailable(): never {
  throw new SourceCredentialError('SOURCE_VAULT_UNAVAILABLE')
}

function validateId(integrationId: string): void {
  if (typeof integrationId !== 'string' || integrationId.length > 64 || !ID_PATTERN.test(integrationId)) invalid()
}

function validateValues(values: unknown): Record<string, string> {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) invalid()
  const entries = Object.entries(values)
  if (entries.length < 1 || entries.length > MAX_FIELDS) invalid()
  const copy: Record<string, string> = Object.create(null)
  for (const [field, value] of entries) {
    if (!FIELD_PATTERN.test(field) || typeof value !== 'string' || !value.length ||
      CONTROL_PATTERN.test(value) || Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) invalid()
    copy[field] = value
  }
  const payload = JSON.stringify(copy)
  if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES ||
    Buffer.byteLength(payload, 'utf16le') > MAX_PAYLOAD_UTF16_BYTES) invalid()
  return { ...copy }
}

function parsePayload(payload: string): Readonly<Record<string, string>> {
  if (typeof payload !== 'string' || Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES ||
    Buffer.byteLength(payload, 'utf16le') > MAX_PAYLOAD_UTF16_BYTES) unavailable()
  try {
    return validateValues(JSON.parse(payload))
  } catch {
    return unavailable()
  }
}

export function createSourceCredentialStore(driver: SourceVaultDriver = windowsVaultDriver()): SourceCredentialStore {
  return {
    async read(integrationId) {
      validateId(integrationId)
      try {
        const payload = await driver.read(integrationId)
        return payload == null ? undefined : parsePayload(payload)
      } catch {
        return unavailable()
      }
    },
    async write(integrationId, values) {
      validateId(integrationId)
      let payload: string
      try { payload = JSON.stringify(validateValues(values)) }
      catch { return invalid() }
      try { await driver.write(integrationId, payload) }
      catch { unavailable() }
    },
    async has(integrationId) {
      validateId(integrationId)
      try {
        const payload = await driver.read(integrationId)
        if (payload == null) return false
        parsePayload(payload)
        return true
      } catch {
        return unavailable()
      }
    },
    async delete(integrationId) {
      validateId(integrationId)
      try { await driver.delete(integrationId) }
      catch { unavailable() }
    },
  }
}

function windowsVaultDriver(): SourceVaultDriver {
  async function entry(integrationId: string) {
    if (process.platform !== 'win32') unavailable()
    const { AsyncEntry } = await import('@napi-rs/keyring')
    return new AsyncEntry('ResearchHub.DataSources', integrationId)
  }
  return {
    async read(integrationId) { return (await entry(integrationId)).getPassword() },
    async write(integrationId, payload) { await (await entry(integrationId)).setPassword(payload) },
    async delete(integrationId) { await (await entry(integrationId)).deletePassword() },
  }
}
