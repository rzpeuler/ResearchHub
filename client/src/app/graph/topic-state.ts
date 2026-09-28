import type { KnowledgeTopicKind, KnowledgeTopicScope } from '../../api/runtime-client'

export type TopicSection = 'overview' | KnowledgeTopicKind
export type TopicLifecycle = 'active' | 'all'
export type TopicObservationType = 'metric' | 'estimate' | 'consensus'

export interface GraphTopicState {
  readonly themeRef?: string
  readonly graphRootRef?: string
  readonly depth: 1 | 2
  readonly section: TopicSection
  readonly scope: KnowledgeTopicScope
  readonly lifecycle: TopicLifecycle
  readonly observationType?: TopicObservationType
  readonly claimType?: string
  readonly relationType?: string
  readonly selectedRef?: string
}

export const TOPIC_SECTIONS: readonly TopicSection[] = ['overview', 'relation', 'claim', 'observation', 'event', 'thesis', 'module', 'source', 'reasoning_edge']
const OBSERVATION_TYPES: readonly TopicObservationType[] = ['metric', 'estimate', 'consensus']
const CLAIM_TYPES = ['fact', 'forecast', 'viewpoint', 'trend', 'risk', 'assumption', 'thesis', 'catalyst'] as const
const RELATION_TYPES = ['theme_exposure', 'business_exposure', 'upstream_of', 'supplier_of', 'competes_with', 'owns_stake_in', 'offers_product', 'belongs_to_industry', 'component_of', 'develops_technology', 'uses_technology', 'applied_in', 'depends_on', 'substitutes_for'] as const
const REF_PATTERN = /^(?:entity|relation|claim|source|module|event|observation|thesis|reasoning-edge):[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/
const THEME_PATTERN = /^entity:[A-Za-z0-9][A-Za-z0-9._:-]{0,240}$/

function paramsOf(search: string | URLSearchParams): URLSearchParams {
  if (search instanceof URLSearchParams) return new URLSearchParams(search)
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
}

function allowed<T extends string>(value: string | null, choices: readonly T[]): T | undefined {
  return value !== null && choices.includes(value as T) ? value as T : undefined
}

function canonicalRef(value: string | null): string | undefined { return value !== null && REF_PATTERN.test(value) ? value : undefined }
function themeRef(value: string | null): string | undefined { return value !== null && THEME_PATTERN.test(value) ? value : undefined }

/** Parse only the bounded, public view state understood by the graph page. */
export function parseGraphTopicState(search: string | URLSearchParams): GraphTopicState {
  const params = paramsOf(search)
  const theme = themeRef(params.get('themeRef'))
  const rawGraphRoot = canonicalRef(params.get('graphRootRef'))
  const legacyRoot = canonicalRef(params.get('root'))
  const depth = params.get('depth') === '2' ? 2 : 1
  return {
    ...(theme ? { themeRef: theme, ...(rawGraphRoot ? { graphRootRef: rawGraphRoot } : {}) } : legacyRoot ? { graphRootRef: legacyRoot } : {}),
    depth,
    section: allowed(params.get('section'), TOPIC_SECTIONS) ?? 'overview',
    scope: allowed(params.get('scope'), ['direct', 'connected'] as const) ?? 'direct',
    lifecycle: allowed(params.get('lifecycle'), ['active', 'all'] as const) ?? 'active',
    ...(allowed(params.get('observationType'), OBSERVATION_TYPES) ? { observationType: allowed(params.get('observationType'), OBSERVATION_TYPES)! } : {}),
    ...(allowed(params.get('claimType'), CLAIM_TYPES) ? { claimType: allowed(params.get('claimType'), CLAIM_TYPES)! } : {}),
    ...(allowed(params.get('relationType'), RELATION_TYPES) ? { relationType: allowed(params.get('relationType'), RELATION_TYPES)! } : {}),
    ...(canonicalRef(params.get('selectedRef')) ? { selectedRef: canonicalRef(params.get('selectedRef'))! } : {}),
  }
}

/** Serialize known view state only; cursor, local paths, and Source URLs have no URL representation. */
export function serializeGraphTopicState(state: GraphTopicState): string {
  const params = new URLSearchParams()
  const theme = state.themeRef && THEME_PATTERN.test(state.themeRef) ? state.themeRef : undefined
  const root = state.graphRootRef && REF_PATTERN.test(state.graphRootRef) ? state.graphRootRef : undefined
  if (theme) {
    params.set('themeRef', theme)
    if (root) params.set('graphRootRef', root)
  } else if (root) params.set('root', root)
  if (state.depth === 2) params.set('depth', '2')
  if (TOPIC_SECTIONS.includes(state.section) && state.section !== 'overview') params.set('section', state.section)
  if (state.scope === 'connected') params.set('scope', state.scope)
  if (state.lifecycle === 'all') params.set('lifecycle', state.lifecycle)
  if (state.observationType && OBSERVATION_TYPES.includes(state.observationType)) params.set('observationType', state.observationType)
  if (state.claimType && CLAIM_TYPES.includes(state.claimType as typeof CLAIM_TYPES[number])) params.set('claimType', state.claimType)
  if (state.relationType && RELATION_TYPES.includes(state.relationType as typeof RELATION_TYPES[number])) params.set('relationType', state.relationType)
  if (state.selectedRef && REF_PATTERN.test(state.selectedRef)) params.set('selectedRef', state.selectedRef)
  return params.toString()
}

const INVALIDATES_SELECTION: readonly (keyof GraphTopicState)[] = ['themeRef', 'graphRootRef', 'depth', 'section', 'scope', 'lifecycle', 'observationType', 'claimType', 'relationType']

/** Write graph state and clear a selection when its topic context has changed. */
export function writeGraphTopicState(state: GraphTopicState, mode: 'push' | 'replace' = 'push'): void {
  const current = parseGraphTopicState(window.location.search)
  const contextChanged = INVALIDATES_SELECTION.some((key) => current[key] !== state[key])
  const next = contextChanged ? { ...state, selectedRef: undefined } : state
  const query = serializeGraphTopicState(next)
  const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
  if (mode === 'replace') window.history.replaceState({}, '', url)
  else window.history.pushState({}, '', url)
}

/** Subscribe to browser back/forward navigation and return a listener cleanup function. */
export function subscribeGraphTopicState(onChange: (state: GraphTopicState) => void): () => void {
  const onPopState = (): void => onChange(parseGraphTopicState(window.location.search))
  window.addEventListener('popstate', onPopState)
  return () => window.removeEventListener('popstate', onPopState)
}
