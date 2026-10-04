import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'
import { canonicalSerialize, hashKnowledgeObject } from '../storage/canonical-hash.ts'
import { loadKnowledgeBaseManifest } from '../storage/manifest-loader.ts'
import { parseYaml } from '../storage/yaml.ts'
import { KnowledgeBaseRegistry } from '../registry/registry.ts'
import type { ThemeScopeDecisionV04, ThemeScopeFingerprintV04 } from './theme-scope-v04.ts'
import { readThemeScopeLedgerV04, type ThemeScopeLedgerEntryV04, type ThemeScopeLedgerReadResultV04, type ThemeScopeLedgerThemeV04 } from './theme-scope-ledger-v04.ts'

export const THEME_SCOPE_REVERSE_INDEX_PATH_V04 = 'governance/theme-scope-reverse-index-v04.yaml'
const INDEX_VERSION = 1
const INDEX_BYTES_LIMIT = 16_000_000

export interface ThemeScopeReverseIndexV04 {
  readonly version: '0.4'
  readonly indexVersion: 1
  readonly knowledgeBaseId: string
  readonly revision: number
  /** Writer log that atomically committed this derived snapshot. */
  readonly sourceWorkflowRunId: string | null
  readonly currentDecisionsByTheme: Readonly<Record<string, Readonly<Record<string, ThemeScopeDecisionV04>>>>
  /** Exact bounded A4 slices needed by D3, including decision history. */
  readonly ledgerSlicesByTheme: Readonly<Record<string, ThemeScopeLedgerThemeV04>>
  readonly themesByChangedRef: Readonly<Record<string, readonly string[]>>
  readonly themesByFingerprint: Readonly<Record<string, readonly string[]>>
  readonly decisionIds: readonly string[]
  readonly checksum: string
}

export type ThemeScopeReverseIndexResultV04 =
  | { readonly status: 'available'; readonly index: ThemeScopeReverseIndexV04; readonly rebuilt: boolean }
  | { readonly status: 'failed'; readonly reason: 'ledger_unavailable' | 'revision_mismatch' | 'unsafe_index'; readonly message: string }

function sortedUnique(values: Iterable<string>): string[] { return [...new Set(values)].sort() }
function indexBody(index: Omit<ThemeScopeReverseIndexV04, 'checksum'>): Omit<ThemeScopeReverseIndexV04, 'checksum'> { return index }
function withChecksum(index: Omit<ThemeScopeReverseIndexV04, 'checksum'>): ThemeScopeReverseIndexV04 {
  return { ...index, checksum: hashKnowledgeObject(indexBody(index)) }
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isDecision(value: unknown): value is ThemeScopeDecisionV04 {
  return isRecord(value) && value.version === '0.4' && typeof value.themeRef === 'string' && typeof value.candidateFingerprint === 'string' && typeof value.id === 'string' && isRecord(value.candidate) && Array.isArray(value.evidence)
}
function validIndex(value: unknown, knowledgeBaseId: string, revision: number): value is ThemeScopeReverseIndexV04 {
  if (!isRecord(value) || value.version !== '0.4' || value.indexVersion !== INDEX_VERSION || value.knowledgeBaseId !== knowledgeBaseId || value.revision !== revision || typeof value.sourceWorkflowRunId !== 'string' || !isRecord(value.currentDecisionsByTheme) || !isRecord(value.ledgerSlicesByTheme) || !isRecord(value.themesByChangedRef) || !isRecord(value.themesByFingerprint) || !Array.isArray(value.decisionIds) || typeof value.checksum !== 'string') return false
  const { checksum, ...body } = value
  return hashKnowledgeObject(body) === checksum
}

function decisionRefs(decision: ThemeScopeDecisionV04): { refs: string[]; fingerprints: string[] } {
  const refs: string[] = [decision.themeRef]
  const fingerprints: ThemeScopeFingerprintV04[] = [decision.candidateFingerprint]
  const candidate = decision.candidate as unknown as Record<string, unknown>
  if (typeof candidate.canonicalRef === 'string') refs.push(candidate.canonicalRef)
  if (typeof candidate.sourceFingerprint === 'string') fingerprints.push(candidate.sourceFingerprint as ThemeScopeFingerprintV04)
  if (typeof candidate.targetFingerprint === 'string') fingerprints.push(candidate.targetFingerprint as ThemeScopeFingerprintV04)
  for (const evidence of decision.evidence) {
    if (typeof evidence.sourceRef === 'string') refs.push(evidence.sourceRef)
    if (typeof evidence.rawRef === 'string') refs.push(evidence.rawRef)
  }
  return { refs: sortedUnique(refs), fingerprints: sortedUnique(fingerprints) }
}

function buildReverseMaps(current: Readonly<Record<string, Readonly<Record<string, ThemeScopeDecisionV04>>>>): { refs: Record<string, string[]>; fingerprints: Record<string, string[]>; decisionIds: string[] } {
  const refs = new Map<string, Set<string>>()
  const fingerprints = new Map<string, Set<string>>()
  const decisionIds = new Set<string>()
  for (const [themeRef, byFingerprint] of Object.entries(current)) {
    for (const decision of Object.values(byFingerprint)) {
      decisionIds.add(decision.id)
      const keys = decisionRefs(decision)
      for (const ref of keys.refs) { const themes = refs.get(ref) ?? new Set<string>(); themes.add(themeRef); refs.set(ref, themes) }
      for (const fingerprint of keys.fingerprints) { const themes = fingerprints.get(fingerprint) ?? new Set<string>(); themes.add(themeRef); fingerprints.set(fingerprint, themes) }
    }
  }
  return {
    refs: Object.fromEntries([...refs].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, sortedUnique(values)])),
    fingerprints: Object.fromEntries([...fingerprints].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, sortedUnique(values)])),
    decisionIds: sortedUnique(decisionIds),
  }
}

function makeIndex(knowledgeBaseId: string, revision: number, current: Record<string, Record<string, ThemeScopeDecisionV04>>, slices: Record<string, ThemeScopeLedgerThemeV04>, historicalDecisionIds: readonly string[]): ThemeScopeReverseIndexV04 {
  const maps = buildReverseMaps(current)
  return withChecksum({ version: '0.4', indexVersion: INDEX_VERSION, knowledgeBaseId, revision, sourceWorkflowRunId: null, currentDecisionsByTheme: current, ledgerSlicesByTheme: slices, themesByChangedRef: maps.refs, themesByFingerprint: maps.fingerprints, decisionIds: sortedUnique([...historicalDecisionIds, ...maps.decisionIds]) })
}

/** Build a derived index from A4's authoritative current decision slices. */
export function buildThemeScopeReverseIndexV04(ledger: Extract<ThemeScopeLedgerReadResultV04, { status: 'available' }>): ThemeScopeReverseIndexV04 {
  const current: Record<string, Record<string, ThemeScopeDecisionV04>> = Object.create(null) as Record<string, Record<string, ThemeScopeDecisionV04>>
  const slices: Record<string, ThemeScopeLedgerThemeV04> = Object.create(null) as Record<string, ThemeScopeLedgerThemeV04>
  const historicalDecisionIds: string[] = []
  for (const theme of ledger.themes) {
    slices[theme.themeRef] = structuredClone(theme)
    const currentByFingerprint: Record<string, ThemeScopeDecisionV04> = Object.create(null) as Record<string, ThemeScopeDecisionV04>
    for (const entry of theme.history) historicalDecisionIds.push(entry.decision.id)
    for (const [fingerprint, entry] of Object.entries(theme.currentByCandidateFingerprint)) currentByFingerprint[fingerprint] = entry.decision
    current[theme.themeRef] = currentByFingerprint
  }
  return makeIndex(ledger.knowledgeBaseId, ledger.knowledgeBaseRevision, current, slices, historicalDecisionIds)
}

/** Advance one committed revision and update only Theme slices named by scope decisions. */
export function advanceThemeScopeReverseIndexV04(index: ThemeScopeReverseIndexV04, input: {
  readonly knowledgeBaseId: string
  readonly previousRevision: number
  readonly nextRevision: number
  readonly workflowRunId: string
  readonly decisions?: readonly ThemeScopeDecisionV04[]
}): ThemeScopeReverseIndexV04 {
  if (index.knowledgeBaseId !== input.knowledgeBaseId || index.revision !== input.previousRevision || input.nextRevision < input.previousRevision || input.nextRevision > input.previousRevision + 1) throw new Error('Theme scope reverse index revision does not match the committed transition')
  const current = { ...index.currentDecisionsByTheme } as Record<string, Readonly<Record<string, ThemeScopeDecisionV04>>>
  const slices = { ...index.ledgerSlicesByTheme } as Record<string, ThemeScopeLedgerThemeV04>
  const seen = new Set(index.decisionIds)
  const affectedThemes = new Set<string>()
  for (const decision of input.decisions ?? []) {
    if (seen.has(decision.id)) continue
    seen.add(decision.id)
    const byFingerprint = { ...(current[decision.themeRef] ?? {}) } as Record<string, ThemeScopeDecisionV04>
    byFingerprint[decision.candidateFingerprint] = structuredClone(decision)
    current[decision.themeRef] = byFingerprint
    const priorSlice = slices[decision.themeRef] ?? { themeRef: decision.themeRef, history: [], currentByCandidateFingerprint: {} }
    const entry: ThemeScopeLedgerEntryV04 = { workflowRunId: input.workflowRunId, committedRevision: input.nextRevision, decision: structuredClone(decision) }
    slices[decision.themeRef] = {
      themeRef: decision.themeRef,
      history: [...priorSlice.history, entry],
      currentByCandidateFingerprint: { ...priorSlice.currentByCandidateFingerprint, [decision.candidateFingerprint]: entry },
    }
    affectedThemes.add(decision.themeRef)
  }
  // Re-index only the changed Theme slices; ordinary writes do not scan other Themes.
  const refs = structuredClone(index.themesByChangedRef) as Record<string, string[]>
  const fingerprints = structuredClone(index.themesByFingerprint) as Record<string, string[]>
  const removeTheme = (map: Record<string, string[]>, keys: Iterable<string>, themeRef: string) => {
    for (const key of keys) {
      const themes = map[key]
      if (!themes) continue
      const remaining = themes.filter((value) => value !== themeRef)
      if (remaining.length === 0) delete map[key]
      else if (remaining.length !== themes.length) map[key] = remaining
    }
  }
  const add = (map: Record<string, string[]>, key: string, themeRef: string) => {
    const themes = map[key] ?? (map[key] = [])
    if (!themes.includes(themeRef)) { themes.push(themeRef); themes.sort() }
  }
  for (const themeRef of affectedThemes) {
    const previous = Object.values(index.currentDecisionsByTheme[themeRef] ?? {})
    removeTheme(refs, previous.flatMap((decision) => decisionRefs(decision).refs), themeRef)
    removeTheme(fingerprints, previous.flatMap((decision) => decisionRefs(decision).fingerprints), themeRef)
    for (const decision of Object.values(current[themeRef] ?? {})) {
      const keys = decisionRefs(decision)
      for (const ref of keys.refs) add(refs, ref, themeRef)
      for (const fingerprint of keys.fingerprints) add(fingerprints, fingerprint, themeRef)
    }
  }
  const decisionIds = new Set(index.decisionIds)
  for (const themeRef of affectedThemes) for (const decision of Object.values(current[themeRef] ?? {})) decisionIds.add(decision.id)
  return withChecksum({ version: '0.4', indexVersion: 1, knowledgeBaseId: index.knowledgeBaseId, revision: input.nextRevision, sourceWorkflowRunId: input.workflowRunId, currentDecisionsByTheme: current, ledgerSlicesByTheme: slices, themesByChangedRef: refs, themesByFingerprint: fingerprints, decisionIds: sortedUnique(decisionIds) })
}

/** Resolve only Themes indexed by changed canonical refs or stable candidate fingerprints. */
export function lookupAffectedThemesV04(index: ThemeScopeReverseIndexV04, input: {
  readonly changedRefs: readonly string[]
  readonly changedFingerprints?: readonly string[]
  readonly revision: number
  readonly knowledgeBaseId: string
}): readonly string[] {
  if (input.knowledgeBaseId !== index.knowledgeBaseId || input.revision !== index.revision) throw new Error('Theme scope reverse index is stale for the requested Knowledge Base revision')
  const affected = new Set<string>()
  for (const ref of input.changedRefs) for (const themeRef of index.themesByChangedRef[ref] ?? []) affected.add(themeRef)
  for (const fingerprint of input.changedFingerprints ?? []) for (const themeRef of index.themesByFingerprint[fingerprint] ?? []) affected.add(themeRef)
  return sortedUnique(affected)
}

/** Resolve only the A4-compatible decision slices selected by changed refs. */
export function lookupAffectedThemeSlicesV04(index: ThemeScopeReverseIndexV04, input: {
  readonly changedRefs: readonly string[]
  readonly changedFingerprints?: readonly string[]
  readonly revision: number
  readonly knowledgeBaseId: string
}): { readonly knowledgeBaseRevision: number; readonly themes: readonly ThemeScopeLedgerThemeV04[] } {
  const themeRefs = lookupAffectedThemesV04(index, input)
  return {
    knowledgeBaseRevision: index.revision,
    themes: themeRefs.flatMap((themeRef) => index.ledgerSlicesByTheme[themeRef] ? [index.ledgerSlicesByTheme[themeRef]!] : []),
  }
}

/** Production port shape for `runThemeScopeImpactCheck`'s indexed lookup callback. */
export async function lookupAffectedThemeScopeSlicesV04(handle: KnowledgeBaseHandle, changedRefs: readonly string[], changedFingerprints: readonly string[], revision: number): Promise<
  | { readonly status: 'available'; readonly knowledgeBaseRevision: number; readonly themes: readonly ThemeScopeLedgerThemeV04[] }
  | { readonly status: 'failed'; readonly error: string }
> {
  let currentHandle: KnowledgeBaseHandle
  try { currentHandle = await new KnowledgeBaseRegistry().mount(handle.rootRef) }
  catch (error) { return { status: 'failed', error: error instanceof Error ? error.message : String(error) } }
  if (currentHandle.knowledgeBaseId !== handle.knowledgeBaseId) return { status: 'failed', error: 'Mounted Knowledge Base identity changed.' }
  const loaded = await loadOrRebuildThemeScopeReverseIndexV04(currentHandle)
  if (loaded.status !== 'available') return { status: 'failed', error: `${loaded.reason}: ${loaded.message}` }
  try {
    return { status: 'available', ...lookupAffectedThemeSlicesV04(loaded.index, { knowledgeBaseId: currentHandle.knowledgeBaseId, revision, changedRefs, changedFingerprints }) }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

async function readIndexFile(root: string, knowledgeBaseId: string, revision: number): Promise<ThemeScopeReverseIndexV04 | undefined> {
  const file = join(root, THEME_SCOPE_REVERSE_INDEX_PATH_V04)
  const stat = await lstat(file).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (!stat) return undefined
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Theme scope reverse index path is unsafe')
  if (stat.size > INDEX_BYTES_LIMIT) return undefined
  const rootReal = await realpath(root)
  const fileReal = await realpath(file)
  const rel = relative(rootReal, fileReal)
  if (rel === '' || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Theme scope reverse index resolves outside the Knowledge Base')
  const parsed = parseYaml(await readFile(file, 'utf8'), file)
  if (!validIndex(parsed, knowledgeBaseId, revision)) return undefined
  const writerLog = join(root, 'logs', 'research', `${parsed.sourceWorkflowRunId}.yaml`)
  const logStat = await lstat(writerLog).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (!logStat || logStat.isSymbolicLink() || !logStat.isFile() || logStat.size > 2_000_000) return undefined
  const logReal = await realpath(writerLog)
  const logRelative = relative(rootReal, logReal)
  if (logRelative === '' || isAbsolute(logRelative) || logRelative.split(/[\\/]/).includes('..')) return undefined
  const writerReceipt = parseYaml(await readFile(writerLog, 'utf8'), writerLog)
  if (!isRecord(writerReceipt) || writerReceipt.workflowRunId !== parsed.sourceWorkflowRunId || writerReceipt.knowledgeBaseId !== knowledgeBaseId || writerReceipt.committedRevision !== revision || writerReceipt.themeScopeReverseIndexChecksum !== parsed.checksum) return undefined
  return parsed
}

/** Load a revision-matched sidecar or safely rebuild it from committed A4 Writer logs. */
export async function loadOrRebuildThemeScopeReverseIndexV04(handle: KnowledgeBaseHandle): Promise<ThemeScopeReverseIndexResultV04> {
  const manifest = await loadKnowledgeBaseManifest(handle.rootRef)
  if (manifest.knowledgeBaseId !== handle.knowledgeBaseId || manifest.revision !== handle.revision) return { status: 'failed', reason: 'revision_mismatch', message: 'Mounted handle does not match the current Knowledge Base manifest.' }
  try {
    const existing = await readIndexFile(handle.rootRef, manifest.knowledgeBaseId, manifest.revision)
    if (existing) return { status: 'available', index: existing, rebuilt: false }
  } catch (error) {
    if (error instanceof Error && error.message.includes('unsafe')) return { status: 'failed', reason: 'unsafe_index', message: error.message }
    // Malformed regular-file cache is derived state; rebuild it from A4 below.
  }
  const ledger = await readThemeScopeLedgerV04(handle)
  if (ledger.status !== 'available') return { status: 'failed', reason: 'ledger_unavailable', message: ledger.error.message }
  if (ledger.knowledgeBaseRevision !== manifest.revision) return { status: 'failed', reason: 'revision_mismatch', message: 'A4 ledger revision changed while rebuilding the reverse index.' }
  const index = buildThemeScopeReverseIndexV04(ledger)
  return { status: 'available', index, rebuilt: true }
}

/** Persist an index only inside a known root (Writer uses this on its transaction staging tree). */
export async function persistThemeScopeReverseIndexV04(rootRef: string, index: ThemeScopeReverseIndexV04): Promise<void> {
  const root = resolve(rootRef)
  const directory = join(root, 'governance')
  const directoryStat = await lstat(directory).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (directoryStat && (directoryStat.isSymbolicLink() || !directoryStat.isDirectory())) throw new Error('Theme scope reverse index directory is unsafe')
  if (!directoryStat) await mkdir(directory, { recursive: false })
  const path = join(root, THEME_SCOPE_REVERSE_INDEX_PATH_V04)
  const fileStat = await lstat(path).catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error))
  if (fileStat && (fileStat.isSymbolicLink() || !fileStat.isFile())) throw new Error('Theme scope reverse index file is unsafe')
  const serialized = `${canonicalSerialize(index)}\n`
  if (Buffer.byteLength(serialized, 'utf8') > INDEX_BYTES_LIMIT) throw new Error('Theme scope reverse index exceeds its size bound')
  await writeFile(path, serialized, 'utf8')
}

/** Parse a trusted committed scope envelope without treating the sidecar as authority. */
export function themeScopeDecisionsFromContextV04(context: unknown): readonly ThemeScopeDecisionV04[] {
  if (!isRecord(context)) return []
  const batches: unknown[] = []
  if (isRecord(context.themeScope)) batches.push(context.themeScope)
  if (Array.isArray(context.themeScopeBatches)) batches.push(...context.themeScopeBatches)
  return batches.flatMap((batch) => isRecord(batch) && Array.isArray(batch.decisions) ? batch.decisions.filter(isDecision) : [])
}
