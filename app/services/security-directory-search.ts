import { createHash } from 'node:crypto'
import { polyphonic } from 'pinyin-pro'

export interface SecurityDirectoryEntry { readonly symbol: string; readonly name: string; readonly exchange: 'SH' | 'SZ' | 'BJ' }
export interface SecurityDirectoryCandidate extends SecurityDirectoryEntry { readonly candidateId: string; readonly matchKind: string }
export interface SecurityDirectorySearch { readonly candidates: readonly SecurityDirectoryCandidate[]; readonly directoryTimestamp: string; readonly directoryVersion: string }

function normalize(value: string): string { return value.normalize('NFKC').replace(/[\s·•]/gu, '').toLowerCase() }

// Dynamic programming matches all readings without expanding a combinatorial list.
function pinyinMatches(name: string, query: string, initials: boolean): boolean {
  let offsets = new Set([0])
  for (const readings of polyphonic(normalize(name), { type: 'array', toneType: 'none' })) {
    const next = new Set<number>()
    for (const reading of readings) {
      const syllable = initials ? reading.slice(0, 1) : reading
      for (const offset of offsets) if (query.startsWith(syllable, offset)) next.add(offset + syllable.length)
    }
    offsets = next
    if (offsets.size === 0) return false
  }
  return offsets.has(query.length)
}

export function searchSecurityDirectory(rows: readonly SecurityDirectoryEntry[], query: string, directoryTimestamp: string): SecurityDirectorySearch {
  const normalized = normalize(query)
  const unique = [...new Map(rows.map((row) => [`${row.symbol}.${row.exchange}`, row])).values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
  const directoryVersion = createHash('sha256').update(JSON.stringify(unique)).digest('hex')
  const candidates: SecurityDirectoryCandidate[] = []
  for (const row of unique) {
    const name = normalize(row.name)
    // Listing status markers are not part of the company pronunciation. Match
    // only variants of an actual directory row and always return its real name.
    const phoneticNames = [name.replace(/^\*/u, ''), name.replace(/^\*?st/u, '')]
    const matchKind = normalized === row.symbol || normalized === `${row.symbol}.${row.exchange.toLowerCase()}` ? 'exact_code'
      : normalized === name ? 'exact_name'
      : /^[a-z]+$/u.test(normalized) && phoneticNames.some((variant) => pinyinMatches(variant, normalized, true)) ? 'pinyin_initials'
      : /^[a-z]+$/u.test(normalized) && phoneticNames.some((variant) => pinyinMatches(variant, normalized, false)) ? 'pinyin'
      : normalized.length >= 2 && name.includes(normalized) ? 'name_fragment' : undefined
    if (matchKind) candidates.push({ ...row, candidateId: `${row.symbol}.${row.exchange}`, matchKind })
  }
  return { candidates, directoryTimestamp, directoryVersion }
}
