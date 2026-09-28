import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseGraphTopicState, serializeGraphTopicState, subscribeGraphTopicState, writeGraphTopicState } from './topic-state'

describe('graph topic URL state', () => {
  afterEach(() => { window.history.replaceState({}, '', '/graph') })

  it('round-trips topic context and a canonical selection', () => {
    const state = parseGraphTopicState('?themeRef=entity%3Atheme-alpha&graphRootRef=entity%3Aindustry-a&depth=2&section=observation&scope=connected&lifecycle=all&observationType=estimate&selectedRef=observation%3Aestimate-1')
    expect(state).toEqual({ themeRef: 'entity:theme-alpha', graphRootRef: 'entity:industry-a', depth: 2, section: 'observation', scope: 'connected', lifecycle: 'all', observationType: 'estimate', selectedRef: 'observation:estimate-1' })
    expect(parseGraphTopicState(serializeGraphTopicState(state))).toEqual(state)
  })

  it('preserves legacy root/depth links and writes non-theme roots with the old root key', () => {
    expect(parseGraphTopicState('?root=entity%3Acompany-a&depth=2')).toMatchObject({ graphRootRef: 'entity:company-a', depth: 2, section: 'overview' })
    expect(serializeGraphTopicState({ graphRootRef: 'entity:company-a', depth: 2, section: 'overview', scope: 'direct', lifecycle: 'active' })).toBe('root=entity%3Acompany-a&depth=2')
    expect(parseGraphTopicState('?root=entity%3Acompany-a&themeRef=entity%3Atheme-a')).toMatchObject({ themeRef: 'entity:theme-a' })
  })

  it('drops invalid query values and private paths or Source URLs', () => {
    const state = parseGraphTopicState('?themeRef=C%3A%5Cprivate%5Ckb&graphRootRef=%2Fetc%2Fpasswd&root=https%3A%2F%2Fsecret.example%2Ffile&depth=99&section=unknown&scope=everything&claimType=%3Cscript%3E&selectedRef=https%3A%2F%2Fsecret.example')
    expect(state).toEqual({ depth: 1, section: 'overview', scope: 'direct', lifecycle: 'active' })
    expect(serializeGraphTopicState(state)).toBe('')
  })

  it('clears stale selection on context changes and follows popstate', () => {
    window.history.replaceState({}, '', '/graph?themeRef=entity%3Atheme-a&selectedRef=claim%3Ac1')
    writeGraphTopicState({ themeRef: 'entity:theme-b', depth: 1, section: 'claim', scope: 'direct', lifecycle: 'active', selectedRef: 'claim:c2' })
    expect(parseGraphTopicState(window.location.search).selectedRef).toBeUndefined()
    const onChange = vi.fn()
    const unsubscribe = subscribeGraphTopicState(onChange)
    window.history.pushState({}, '', '/graph?root=entity%3Acompany-b&depth=2')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ graphRootRef: 'entity:company-b', depth: 2 }))
    unsubscribe()
  })
})
