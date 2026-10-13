import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { SecurityIdentityResolver } from '../../../app/services/security-identity-resolver.ts'
import { createSecurityIdentityDataResolver, type AkshareSecurityDirectoryClient } from '../../../plugins/research-acquisition/security-identity-data.ts'

const NOW = '2026-10-08T12:00:00.000Z'
const AS_OF = '2026-10-08T00:00:00.000Z'
const WORKFLOW = 'valuation' as const

type DirectoryRow = { symbol: string; name: string; exchange: 'SH' | 'SZ' | 'BJ' }

async function fixture(options: { readonly companies?: readonly { readonly id: string; readonly name: string; readonly ticker: string; readonly exchange?: string; readonly aliases?: readonly string[]; readonly active?: boolean }[] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'rhl-security-identity-'))
  const kb = join(root, 'kb')
  await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: `kb-security-identity-${Math.random().toString(36).slice(2)}`, now: NOW })
  if (options.companies?.length) {
    const registry: Record<string, { type: string; storageRef: string }> = {}
    for (const company of options.companies) {
      const id = company.id
      const storageRef = `entities/${id.slice('entity:'.length)}.yaml`
      registry[id] = { type: 'entity', storageRef }
      await writeFile(join(kb, storageRef), `${JSON.stringify({
        id,
        type: 'company',
        name: company.name,
        aliases: company.aliases ?? [],
        ticker: company.ticker,
        exchange: company.exchange ?? 'SH',
        lifecycle: { status: company.active === false ? 'inactive' : 'active' },
      })}\n`, 'utf8')
    }
    await writeFile(join(kb, 'registry', 'assets.yaml'), `${JSON.stringify(registry)}\n`, 'utf8')
  }
  return { root, kb, close: () => rm(root, { recursive: true, force: true }) }
}

function resolver(rows: readonly DirectoryRow[] | Error | undefined, calls: { count: number; requests: unknown[] }, options: { readonly kb?: string; readonly now?: string } = {}) {
  const client = (rows === undefined ? {} : {
    securityDirectory: async (request: unknown) => {
      calls.count++
      calls.requests.push(request)
      if (rows instanceof Error) throw rows
      return rows
    },
  }) as unknown as AkshareSecurityDirectoryClient
  return new SecurityIdentityResolver({
    ...(options.kb ? { mountedKnowledgeBaseRoot: options.kb } : {}),
    now: () => new Date(options.now ?? NOW),
    dataResolverFactory: ({ now, signal }) => createSecurityIdentityDataResolver({ akshare: client, now, ...(signal ? { signal } : {}) }),
  })
}

function candidate(input: Partial<Parameters<SecurityIdentityResolver['resolve']>[0]> = {}) {
  return {
    workflowId: WORKFLOW,
    asOf: AS_OF,
    allowKnowledgeLookup: false,
    ...input,
  } as Parameters<SecurityIdentityResolver['resolve']>[0]
}

test('Security Identity prefers an exact active Canonical Company and skips the directory', async () => {
  const f = await fixture({ companies: [{ id: 'entity:company-kweichow', name: '贵州茅台', ticker: '600519', aliases: ['茅台'] }] })
  const calls = { count: 0, requests: [] as unknown[] }
  try {
    const result = await resolver([{ symbol: '600519', name: '贵州茅台', exchange: 'SH' }], calls, { kb: f.kb }).resolve(candidate({ name: '茅台', symbol: '600519', exchange: 'SSE', allowKnowledgeLookup: true }))
    assert.equal(result.status, 'VERIFIED')
    if (result.status === 'VERIFIED') {
      assert.equal(result.identity.verificationSource, 'canonical_knowledge')
      assert.equal(result.identity.canonicalCompanyRef, 'entity:company-kweichow')
      assert.equal(result.identity.verifiedName, '贵州茅台')
    }
    assert.equal(calls.count, 0)
  } finally { await f.close() }
})

test('Security Identity resolves exact symbol, name, and exchange through the real DataResolver policy', async () => {
  const calls = { count: 0, requests: [] as unknown[] }
  const result = await resolver([{ symbol: '002487', name: '大金重工', exchange: 'SZ' }], calls).resolve(candidate({ name: '大金重工', symbol: '002487.SZSE' }))
  assert.equal(result.status, 'VERIFIED')
  assert.deepEqual(calls.requests, [{ symbol: '002487', name: '大金重工', exchange: 'SZ' }])
  if (result.status === 'VERIFIED') {
    assert.equal(result.identity.symbol, '002487')
    assert.equal(result.identity.exchange, 'SZ')
    assert.equal(result.identity.verificationSource, 'akshare_security_directory')
    assert.equal(result.identity.originAuthority, 'S3_AGGREGATOR')
    assert.equal(result.identity.sourceId, 'akshare-security-identity-directory')
    assert.equal(result.identity.sourceUrl, 'https://github.com/akfamily/akshare')
  }
})

test('Security Identity blocks a directory ticker that conflicts with an existing Canonical name', async () => {
  const f = await fixture({ companies: [{ id: 'entity:company-kweichow', name: '贵州茅台', ticker: '600519' }] })
  const calls = { count: 0, requests: [] as unknown[] }
  try {
    const result = await resolver([{ symbol: '600000', name: '贵州茅台', exchange: 'SH' }], calls, { kb: f.kb }).resolve(candidate({ name: '贵州茅台', symbol: '600000', exchange: 'SH', allowKnowledgeLookup: true }))
    assert.equal(result.status, 'CONFLICT')
    assert.deepEqual(calls.requests, [])
    assert.equal(calls.count, 0)
  } finally { await f.close() }
})

test('Security Identity rechecks Canonical conflicts before reusing a cached directory result', async () => {
  const f = await fixture()
  const calls = { count: 0, requests: [] as unknown[] }
  try {
    const securityResolver = resolver([{ symbol: '600519', name: '贵州茅台', exchange: 'SH' }], calls, { kb: f.kb })
    const input = candidate({ name: '贵州茅台', symbol: '600519', exchange: 'SH', allowKnowledgeLookup: true })
    assert.equal((await securityResolver.resolve(input)).status, 'VERIFIED')
    assert.equal(calls.count, 1)
    const companyId = 'entity:company-conflict'
    await writeFile(join(f.kb, 'entities', 'company-conflict.yaml'), `${JSON.stringify({ id: companyId, type: 'company', name: '贵州茅台', aliases: [], ticker: '600000', exchange: 'SH', lifecycle: { status: 'active' } })}\n`, 'utf8')
    await writeFile(join(f.kb, 'registry', 'assets.yaml'), `${JSON.stringify({ [companyId]: { type: 'entity', storageRef: 'entities/company-conflict.yaml' } })}\n`, 'utf8')
    const result = await securityResolver.resolve(input)
    assert.equal(result.status, 'CONFLICT')
    assert.equal(calls.count, 1)
  } finally { await f.close() }
})

test('Security Identity rejects a directory name/code mismatch', async () => {
  const calls = { count: 0, requests: [] as unknown[] }
  const result = await resolver([{ symbol: '002488', name: '大金重工', exchange: 'SZ' }], calls).resolve(candidate({ name: '大金重工', symbol: '002487', exchange: 'SZ' }))
  assert.equal(result.status, 'UNRESOLVED')
  assert.equal(calls.count, 1)
})

test('Security Identity reports ambiguity for an exact name shared by multiple directory rows', async () => {
  const calls = { count: 0, requests: [] as unknown[] }
  const result = await resolver([
    { symbol: '000001', name: '平安银行', exchange: 'SZ' },
    { symbol: '600001', name: '平安银行', exchange: 'SH' },
  ], calls).resolve(candidate({ name: '平安银行' }))
  assert.equal(result.status, 'AMBIGUOUS')
  assert.deepEqual([...result.candidateSymbols].sort(), ['000001', '600001'])
})

test('Security Identity fails closed when the directory is unavailable or errors', async (t) => {
  await t.test('no directory method registered', async () => {
    const calls = { count: 0, requests: [] as unknown[] }
    const result = await resolver(undefined, calls).resolve(candidate({ symbol: '002487' }))
    assert.equal(result.status, 'UNRESOLVED')
    assert.match(result.reason, /did not verify an exact identity/u)
    assert.equal(calls.count, 0)
  })
  await t.test('directory request fails', async () => {
    const calls = { count: 0, requests: [] as unknown[] }
    const result = await resolver(new Error('offline'), calls).resolve(candidate({ symbol: '002487' }))
    assert.equal(result.status, 'UNRESOLVED')
    assert.match(result.reason, /did not verify an exact identity/u)
    assert.equal(calls.count, 1)
  })
})

test('Security Identity rejects historical identity without invoking the current directory', async () => {
  const calls = { count: 0, requests: [] as unknown[] }
  const result = await resolver([{ symbol: '002487', name: '大金重工', exchange: 'SZ' }], calls).resolve(candidate({ symbol: '002487', historical: true }))
  assert.equal(result.status, 'HISTORICAL_IDENTITY_UNAVAILABLE')
  assert.equal(calls.count, 0)
})

test('Security Identity reports conflict when a supplied name disagrees with the canonical ticker', async () => {
  const f = await fixture({ companies: [{ id: 'entity:company-kweichow', name: '贵州茅台', ticker: '600519' }] })
  const calls = { count: 0, requests: [] as unknown[] }
  try {
    const result = await resolver([{ symbol: '600519', name: '贵州茅台', exchange: 'SH' }], calls, { kb: f.kb }).resolve(candidate({ name: '虚构名称', symbol: '600519', allowKnowledgeLookup: true }))
    assert.equal(result.status, 'CONFLICT')
    assert.equal(calls.count, 0)
  } finally { await f.close() }
})

test('Security Identity does not accept fuzzy or query-only semantic guesses', async () => {
  const calls = { count: 0, requests: [] as unknown[] }
  const result = await resolver([{ symbol: '002487', name: '大金重工', exchange: 'SZ' }], calls).resolve(candidate({ query: '请分析大金重工股份有限公司的投资价值', allowKnowledgeLookup: false }))
  assert.equal(result.status, 'UNRESOLVED')
  assert.equal(calls.count, 1)
})
