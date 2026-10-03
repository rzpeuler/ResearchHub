import assert from 'node:assert/strict'
import test from 'node:test'
import { EastmoneyIndustryResearchPlugin, EastmoneyRequestError } from '../../../plugins/research-acquisition/eastmoney-industry.ts'

const request = { industry: { name: 'PCB Manufacturing', aliases: ['Printed Circuit Board'], searchTerms: ['PCB 印制电路板'] }, asOf: '2026-09-12T00:00:00.000Z', limitPerKind: 12 }
const response = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } })
const boardRows = (rows: unknown[], total = rows.length) => response({ total, diff: rows })
const memberRows = (rows: unknown[], total = rows.length) => response({ total, diff: rows })

test('Eastmoney discovers both taxonomies, ranks PCB semantics, and paginates at 100', async () => {
  const calls: string[] = []; const plugin = new EastmoneyIndustryResearchPlugin({ fetchImpl: async (url) => { calls.push(String(url)); const parsed = new URL(String(url)); if (parsed.searchParams.get('fs') === 'm:90+t:2') return boardRows([{ f12: 'BK0001', f14: 'Generic Manufacturing' }, { f12: 'BK0002', f14: 'PCB' }], 150); return boardRows([{ f12: 'BK0003', f14: '印制电路板' }]) }, now: () => '2026-09-12T00:00:00.000Z' })
  const candidates = await plugin.discover(request); assert.deepEqual(candidates.map((x) => x.metadata?.boardName), ['印制电路板', 'PCB']); assert.equal(calls.length, 7); assert.ok(calls.every((x) => new URL(x).searchParams.get('pz') === '100'))
})

test('Company discovery is empty and never uses fetch', async () => { let calls = 0; const plugin = new EastmoneyIndustryResearchPlugin({ fetchImpl: async () => { calls++; throw new Error('network') } }); assert.deepEqual(await plugin.discover({ company: { symbol: '600519' } }), []); assert.equal(calls, 0) })

test('Eastmoney fetches bounded identity-only constituents, sorts, hashes, and normalizes rights', async () => {
  let calls = 0; const plugin = new EastmoneyIndustryResearchPlugin({ fetchImpl: async (url) => { calls++; const parsed = new URL(String(url)); if (parsed.searchParams.get('fs')?.startsWith('b:')) assert.equal(parsed.searchParams.get('fields'), 'f12,f13,f14'); return parsed.searchParams.get('fs')?.startsWith('b:') ? memberRows([{ f12: '000002', f13: '0', f14: 'B' }, { f12: '600001', f13: '1', f14: 'A', f2: 99, f3: 8 }], 2) : boardRows([{ f12: 'BK0002', f14: 'PCB' }]) }, now: () => '2026-09-12T00:00:00.000Z' })
  const candidate = (await plugin.discover(request))![0]!; const source = await plugin.fetch(candidate); const normalized = await plugin.normalize(source); assert.equal(calls, 3); assert.equal(source.contentHash!.length, 64); assert.match(normalized.canonicalUrl!, /fs=b:/); assert.equal(normalized.publisher, 'Eastmoney'); assert.equal(normalized.rights.policyBasis, 'personal_noncommercial_research'); assert.equal(normalized.rights.redistributionAllowed, false); assert.doesNotMatch(source.content, /"f2"|"f3"|price|fund/i); assert.ok(source.content.indexOf('000002') < source.content.indexOf('600001')); assert.equal(source.content, (await plugin.fetch(candidate)).content)
})

test('Malformed and HTTP error responses are rejected', async () => { const bad = new EastmoneyIndustryResearchPlugin({ fetchImpl: async () => new Response('{bad', { status: 200 }) }); await assert.rejects(() => bad.discover(request), /JSON/); const http = new EastmoneyIndustryResearchPlugin({ fetchImpl: async () => new Response('{}', { status: 503 }) }); await assert.rejects(() => http.discover(request), /HTTP 503/) })

test('Transport failures retain a sanitized provider category and socket diagnosis', async () => {
  const plugin = new EastmoneyIndustryResearchPlugin({ fetchImpl: async () => { const error = new TypeError('fetch failed'); Object.defineProperty(error, 'cause', { value: { code: 'UND_ERR_SOCKET', message: 'other side closed' } }); throw error } })
  await assert.rejects(() => plugin.discover(request), (error: unknown) => error instanceof EastmoneyRequestError && error.category === 'transport' && error.message === 'Eastmoney remote socket closed (UND_ERR_SOCKET)' && error.cause instanceof TypeError)
})

test('Generic Manufacturing and Industry words alone do not select unrelated boards', async () => { const plugin = new EastmoneyIndustryResearchPlugin({ fetchImpl: async (url) => boardRows([{ f12: 'BK0099', f14: new URL(String(url)).searchParams.get('fs') === 'm:90+t:2' ? 'Advanced Manufacturing' : 'Industry Services' }]) }); assert.deepEqual(await plugin.discover(request), []) })
