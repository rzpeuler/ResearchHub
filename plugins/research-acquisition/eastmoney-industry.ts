import { sha256 } from './hash.ts'
import type { NormalizedResearchSource, ResearchAcquisitionPlugin, ResearchAcquisitionRequest, ResearchFetchedSource, ResearchSourceCandidate } from './contracts.ts'

export interface EastmoneyHttpClient { fetch(input: string, init?: RequestInit): Promise<Response> }
export interface EastmoneyIndustryResearchPluginOptions { readonly fetchImpl?: typeof fetch; readonly endpoint?: string; readonly now?: () => string; readonly timeoutMs?: number; readonly maxPayloadBytes?: number }
type Board = { readonly code: string; readonly name: string; readonly type: 'industry' | 'concept' }
type Member = { readonly stockCode: string; readonly market: string; readonly companyName: string }
const DEFAULT_ENDPOINT = 'https://push2.eastmoney.com/api/qt/clist/get'
// Public protocol constant required by Eastmoney's unauthenticated clist endpoint; it is not a credential.
const PUBLIC_UT = 'fa5fd1943c7b386f172d6893dbfba10b'
const PAGE_SIZE = 100
const BOARD_PAGE_CAP = 6
const MEMBER_PAGE_CAP = 3
const MAX_CANDIDATES = 12
const GENERIC = new Set(['industry', 'manufacturing', 'industrymanufacturing', '行业', '制造'])
const CODE = /^[A-Z0-9]{2,16}$/i

/** A sanitized failure category for the public Eastmoney JSON endpoint. */
export class EastmoneyRequestError extends Error {
  constructor(readonly category: 'transport' | 'http' | 'payload' | 'response', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'EastmoneyRequestError'
  }
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
const tokens = (value: string) => [...new Set((normalize(value).match(/[a-z0-9]+|[\u3400-\u9fff]+/g) ?? []).filter((x) => !GENERIC.has(x) && x.length >= 2))]
const validCode = (value: unknown): value is string => typeof value === 'string' && CODE.test(value.trim())
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 160
const asRecord = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const field = (row: Record<string, unknown>, name: string) => row[name] ?? row[name.toLowerCase()]

function rowsFromDiff(diff: unknown): Record<string, unknown>[] {
  if (Array.isArray(diff)) return diff.flatMap((row) => { const value = asRecord(row); return value ? [value] : [] })
  const map = asRecord(diff); return map ? Object.values(map).flatMap((row) => { const value = asRecord(row); return value ? [value] : [] }) : []
}
function totalFrom(payload: Record<string, unknown>): number { const data = asRecord(payload.data); const total = data?.total; return typeof total === 'number' && Number.isSafeInteger(total) && total >= 0 ? total : 0 }
function projectBoards(payload: unknown, type: Board['type']): { boards: Board[]; total: number } {
  const root = asRecord(payload); const data = asRecord(root?.data); if (!root || !data || !('diff' in data)) throw new Error('invalid Eastmoney board payload')
  const boards = rowsFromDiff(data.diff).flatMap((row) => { const code = field(row, 'f12'); const name = field(row, 'f14'); return validCode(code) && validName(name) ? [{ code: code.trim(), name: name.trim(), type }] : [] })
  return { boards, total: totalFrom(root) }
}
function projectMembers(payload: unknown): { members: Member[]; total: number } {
  const root = asRecord(payload); const data = asRecord(root?.data); if (!root || !data || !('diff' in data)) throw new Error('invalid Eastmoney constituent payload')
  const members = rowsFromDiff(data.diff).flatMap((row) => { const code = field(row, 'f12'); const market = field(row, 'f13'); const name = field(row, 'f14'); const exchange = market === '1' || market === 1 ? 'SSE' : market === '0' || market === 0 ? 'SZSE' : market === '2' || market === 2 ? 'BSE' : 'unknown'; return typeof code === 'string' && /^\d{6}$/.test(code.trim()) && validName(name) ? [{ stockCode: code.trim(), market: exchange, companyName: name.trim() }] : [] })
  return { members, total: totalFrom(root) }
}

export function matchEastmoneyBoards(target: ResearchAcquisitionRequest & { industry: NonNullable<Extract<ResearchAcquisitionRequest, { industry: unknown }>['industry']> }, boards: readonly Board[]): Board[] {
  const terms = [...new Set([target.industry.name, ...(target.industry.aliases ?? []), ...target.industry.searchTerms].flatMap((x) => [normalize(x), ...tokens(x)]).filter((x) => x && !GENERIC.has(x)))]
  return boards.map((board) => { const name = normalize(board.name); const boardTokens = tokens(board.name); let score = 0; for (const term of terms) { if (name === term) score = Math.max(score, 100); else if (boardTokens.includes(term)) score = Math.max(score, 80); else if (term.length >= 2 && (name.includes(term) || term.includes(name))) score = Math.max(score, 50) } return { board, score } }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score || normalize(a.board.name).localeCompare(normalize(b.board.name)) || a.board.code.localeCompare(b.board.code)).map((x) => x.board)
}

export class EastmoneyIndustryResearchPlugin implements ResearchAcquisitionPlugin {
  readonly name = 'eastmoney-industry-research-acquisition'
  private readonly fetchImpl: typeof fetch
  private readonly endpoint: string
  private readonly now: () => string
  private readonly timeoutMs: number
  private readonly maxPayloadBytes: number
  private readonly boardCache = new Map<string, readonly Board[]>()
  private readonly memberCache = new Map<string, readonly Member[]>()
  constructor(options: EastmoneyIndustryResearchPluginOptions = {}) { this.fetchImpl = options.fetchImpl ?? fetch; this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT; this.now = options.now ?? (() => new Date().toISOString()); this.timeoutMs = Math.min(20_000, Math.max(1, options.timeoutMs ?? 15_000)); this.maxPayloadBytes = options.maxPayloadBytes ?? 2_000_000 }
  private async request(params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(this.endpoint); for (const [key, value] of Object.entries({ ...params, ut: PUBLIC_UT, np: '1', fltt: '2', invt: '2' })) url.searchParams.set(key, value)
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true })
    try {
      let response: Response
      try {
        response = await this.fetchImpl(url.toString(), { headers: { accept: 'application/json' }, signal: controller.signal })
      } catch (cause) {
        const details = asRecord((cause as { cause?: unknown } | null)?.cause)
        const code = typeof details?.code === 'string' && /^[A-Z0-9_]{1,40}$/u.test(details.code) ? details.code : undefined
        const timedOut = !signal?.aborted && controller.signal.aborted
        const detail = timedOut ? 'request timed out' : code === 'UND_ERR_SOCKET' ? 'remote socket closed (UND_ERR_SOCKET)' : cause instanceof TypeError ? 'fetch failed (TypeError)' : 'request transport failed'
        throw new EastmoneyRequestError('transport', `Eastmoney ${detail}`, { cause })
      }
      if (!response.ok) throw new EastmoneyRequestError('http', `Eastmoney request failed with HTTP ${response.status}`)
      let text: string
      try { text = await response.text() } catch (cause) { throw new EastmoneyRequestError('transport', 'Eastmoney response body could not be read', { cause }) }
      if (Buffer.byteLength(text, 'utf8') > this.maxPayloadBytes) throw new EastmoneyRequestError('payload', 'Eastmoney payload exceeds bound')
      try { return JSON.parse(text) } catch (cause) { throw new EastmoneyRequestError('response', 'Eastmoney response is not JSON', { cause }) }
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
  }
  private async boards(type: Board['type']): Promise<readonly Board[]> { const cached = this.boardCache.get(type); if (cached) return cached; const all: Board[] = []; for (let page = 1; page <= BOARD_PAGE_CAP; page++) { const fs = type === 'industry' ? 'm:90+t:2' : 'm:90+t:3'; const projected = projectBoards(await this.request({ pn: String(page), pz: String(PAGE_SIZE), fs, fields: 'f12,f14' }), type); all.push(...projected.boards); if (all.length >= projected.total) break } const stable = [...new Map(all.map((x) => [`${x.type}:${x.code}`, x])).values()]; this.boardCache.set(type, stable); return stable }
  async discover(request: ResearchAcquisitionRequest): Promise<readonly ResearchSourceCandidate[]> { if ('company' in request) return []; const boards = [...await this.boards('industry'), ...await this.boards('concept')]; const matches = matchEastmoneyBoards(request, boards); const limit = Math.min(MAX_CANDIDATES, Math.max(0, request.limitPerKind ?? 6)); return matches.slice(0, limit).map((board) => ({ candidateId: `eastmoney-${board.type}-${board.code}`, kind: 'structured_data', tier: 2, title: `${board.name} board membership`, provider: 'eastmoney', url: `${this.endpoint}?fs=b:${encodeURIComponent(board.code)}&fields=f12,f13,f14`, metadata: { boardCode: board.code, boardName: board.name, boardType: board.type, matching: 'deterministic_board_name_terms' } })) }
  async fetch(candidate: ResearchSourceCandidate): Promise<ResearchFetchedSource> { const metadata = asRecord(candidate.metadata); const boardCode = metadata?.boardCode; const boardName = metadata?.boardName; const boardType = metadata?.boardType; if (candidate.provider !== 'eastmoney' || !validCode(boardCode) || !validName(boardName) || (boardType !== 'industry' && boardType !== 'concept') || candidate.candidateId !== `eastmoney-${boardType}-${boardCode}`) throw new Error('candidate does not belong to Eastmoney'); let members = this.memberCache.get(boardCode); if (!members) { const rows: Member[] = []; for (let page = 1; page <= MEMBER_PAGE_CAP; page++) { const projected = projectMembers(await this.request({ pn: String(page), pz: String(PAGE_SIZE), fs: `b:${boardCode}`, fields: 'f12,f13,f14' })); rows.push(...projected.members); if (rows.length >= projected.total || projected.members.length < PAGE_SIZE) break } members = [...new Map(rows.map((x) => [x.stockCode, x])).values()].sort((a, b) => a.stockCode.localeCompare(b.stockCode)); this.memberCache.set(boardCode, members) } const retrievedAt = this.now(); const content = JSON.stringify({ dataset: 'eastmoney-public-board-constituents', board: { boardCode, boardName, boardType }, observedAt: retrievedAt, retrieval: { provider: 'Eastmoney', endpoint: this.endpoint, selector: `b:${boardCode}` }, constituents: members }, null, 0); return { candidate, retrievedAt, content, contentHash: sha256(content) } }
  async normalize(source: ResearchFetchedSource): Promise<NormalizedResearchSource> { if (source.candidate.provider !== 'eastmoney') throw new Error('source does not belong to Eastmoney'); const metadata = source.candidate.metadata ?? {}; const boardCode = asRecord(metadata)?.boardCode; if (!validCode(boardCode)) throw new Error('Eastmoney source metadata is invalid'); return { candidate: source.candidate, retrievedAt: source.retrievedAt, title: source.candidate.title, content: source.content, contentHash: source.contentHash ?? sha256(source.content), canonicalUrl: `${this.endpoint}?fs=b:${encodeURIComponent(boardCode)}&fields=f12,f13,f14`, publisher: 'Eastmoney', rights: { accessScope: 'public', retentionAllowed: true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true, redistributionAllowed: false, policyBasis: 'personal_noncommercial_research' } } }
}
