import assert from 'node:assert/strict'
import test from 'node:test'
import { KnowledgeSchemaCompatibilityResolver } from '../../../packages/shared/knowledge-base/index.ts'

test('compatibility resolver distinguishes read-only runtime, readonly KB, and unsupported states', () => {
  const resolver = new KnowledgeSchemaCompatibilityResolver({ supported: [{ schemaVersion: '0.2', storageFormatVersion: '1' }] })
  const active = resolver.resolve({ schemaVersion: '0.2', storageFormatVersion: '1', status: 'active' })
  assert.equal(active.status, 'read_only_compatible')
  assert.equal(active.readable, true)
  assert.equal(active.writable, false)
  assert.match(active.reason ?? '', /write capability is not implemented or enabled/)
  assert.equal(resolver.resolve({ schemaVersion: '0.2', storageFormatVersion: '1', status: 'readonly' }).status, 'read_only_compatible')
  assert.equal(resolver.resolve({ schemaVersion: '9.9', storageFormatVersion: '1', status: 'active' }).status, 'unsupported')
})

test('migration availability is reported without running a migration', () => {
  const resolver = new KnowledgeSchemaCompatibilityResolver({ supported: [], migrationAvailable: true })
  const result = resolver.resolve({ schemaVersion: '0.1', storageFormatVersion: '1', status: 'active' })
  assert.equal(result.status, 'migration_available')
  assert.equal(result.readable, false)
  assert.equal(result.migrationAvailable, true)
})
