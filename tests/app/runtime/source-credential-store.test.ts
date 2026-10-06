import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createSourceCredentialStore, type SourceVaultDriver } from '../../../app/runtime/source-credential-store.ts'

function fakeVault(): SourceVaultDriver & { entries: Map<string, string> } {
  const entries = new Map<string, string>()
  return {
    entries,
    async read(key) { return entries.get(key) },
    async write(key, value) { entries.set(key, value) },
    async delete(key) { entries.delete(key) },
  }
}

test('round-trips a multi-field integration credential through the injected vault', async () => {
  const vault = fakeVault()
  const store = createSourceCredentialStore(vault)
  assert.equal(await store.has('market-data'), false)
  await store.write('market-data', { apiKey: 'key-123', apiSecret: 'secret-456' })
  assert.deepEqual(await store.read('market-data'), { apiKey: 'key-123', apiSecret: 'secret-456' })
  assert.equal(await store.has('market-data'), true)
  await store.write('market-data', { apiKey: 'rotated' })
  assert.deepEqual(await store.read('market-data'), { apiKey: 'rotated' })
  await store.delete('market-data')
  assert.equal(await store.read('market-data'), undefined)
  assert.equal(await store.has('market-data'), false)
})

test('rejects invalid IDs, empty secrets, control characters, and oversized values', async () => {
  const store = createSourceCredentialStore(fakeVault())
  for (const id of ['', 'Bad-ID', 'bad/id', '-bad', 'bad-', 'bad--id', 'a'.repeat(65)]) {
    await assert.rejects(store.has(id), { code: 'INVALID_SOURCE_CREDENTIAL' })
  }
  for (const values of [
    {},
    { token: '' },
    { token: 'a\u0000b' },
    { token: 'a'.repeat(4097) },
    { token: 'a'.repeat(1400) },
    { first: 'a'.repeat(1100), second: 'b'.repeat(1100) },
    Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`key${i}`, 'x'])),
    { token: 'é'.repeat(9000) },
    { 'api.key': 'secret-123' },
    { 'api:key': 'secret-123' },
  ]) {
    await assert.rejects(store.write('market-data', values), error => {
      assert.equal((error as { code?: string }).code, 'INVALID_SOURCE_CREDENTIAL')
      assert.doesNotMatch(JSON.stringify(error), /secret-123/)
      return true
    })
  }
})

test('fails closed when the OS vault is unavailable', async () => {
  const path = await mkdtemp(join(tmpdir(), 'researchhub-vault-test-'))
  const previous = process.env.RESEARCHHUB_RUNTIME_DATA_ROOT
  process.env.RESEARCHHUB_RUNTIME_DATA_ROOT = path
  const failing: SourceVaultDriver = {
    async read() { throw new Error('vault offline: secret-123') },
    async write() { throw new Error('vault offline: secret-123') },
    async delete() { throw new Error('vault offline: secret-123') },
  }
  try {
    const store = createSourceCredentialStore(failing)
    for (const operation of [
      store.read('market-data'), store.has('market-data'),
      store.write('market-data', { token: 'secret-123' }), store.delete('market-data'),
    ]) {
      await assert.rejects(operation, { code: 'SOURCE_VAULT_UNAVAILABLE' })
    }
    assert.deepEqual(await readdir(path), [])
  } finally {
    if (previous === undefined) delete process.env.RESEARCHHUB_RUNTIME_DATA_ROOT
    else process.env.RESEARCHHUB_RUNTIME_DATA_ROOT = previous
    await rm(path, { recursive: true, force: true })
  }
})

test('never exposes stored values from credential-presence queries or errors', async () => {
  const vault = fakeVault()
  const store = createSourceCredentialStore(vault)
  await store.write('market-data', { token: 'secret-123' })
  assert.equal(await store.has('market-data'), true)
  vault.entries.set('market-data', '{broken:secret-123')
  for (const operation of [store.read('market-data'), store.has('market-data')]) {
    await assert.rejects(operation, error => {
      assert.doesNotMatch(JSON.stringify(error), /secret-123/)
      assert.equal((error as { code?: string }).code, 'SOURCE_VAULT_UNAVAILABLE')
      return true
    })
  }
  const hostile = Object.defineProperty({}, 'token', {
    enumerable: true,
    get() { throw new Error('secret-123') },
  })
  await assert.rejects(store.write('market-data', hostile), error => {
    assert.doesNotMatch(JSON.stringify(error), /secret-123/)
    assert.equal((error as { code?: string }).code, 'INVALID_SOURCE_CREDENTIAL')
    return true
  })
})

test('treats the native Windows null response as a missing credential', async () => {
  const vault: SourceVaultDriver = {
    async read() { return null },
    async write() {},
    async delete() {},
  }
  const store = createSourceCredentialStore(vault)
  assert.equal(await store.read('market-data'), undefined)
  assert.equal(await store.has('market-data'), false)
})
