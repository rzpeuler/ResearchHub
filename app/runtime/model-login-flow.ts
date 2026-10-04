import { randomUUID } from 'node:crypto'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'

type FlowState = 'pending' | 'prompt' | 'complete' | 'failed' | 'cancelled'
export interface PublicModelLoginFlow {
  readonly id: string
  readonly provider: string
  readonly state: FlowState
  readonly events: readonly AuthEvent[]
  readonly prompt?: { readonly type: AuthPrompt['type']; readonly message: string; readonly placeholder?: string; readonly options?: readonly { readonly id: string; readonly label: string; readonly description?: string }[] }
  readonly error?: string
}

interface InternalFlow {
  readonly id: string
  readonly provider: string
  readonly controller: AbortController
  readonly expiresAt: number
  state: FlowState
  events: AuthEvent[]
  prompt?: PublicModelLoginFlow['prompt']
  answer?: { resolve: (value: string) => void; reject: (error: Error) => void }
  error?: string
}

/** In-memory bridge from Pi's interactive OAuth callbacks to the local settings dialog. */
export class ModelLoginFlowManager {
  private readonly flows = new Map<string, InternalFlow>()
  private activeId?: string

  hasActiveFlow(): boolean { return this.activeId !== undefined }

  start(runtime: ModelRuntime, provider: string): PublicModelLoginFlow {
    if (this.activeId) throw new Error('A model login is already in progress')
    const auth = runtime.getProvider(provider)?.auth
    if (!auth?.oauth) throw new Error('This provider does not support subscription login')
    const flow: InternalFlow = { id: randomUUID(), provider, controller: new AbortController(), expiresAt: Date.now() + 5 * 60_000, state: 'pending', events: [] }
    this.flows.set(flow.id, flow)
    this.activeId = flow.id
    const timeout = setTimeout(() => this.cancel(flow.id), 5 * 60_000)
    timeout.unref?.()
    void runtime.login(provider, 'oauth', {
      signal: flow.controller.signal,
      notify: (event) => {
        if (flow.state === 'cancelled') return
        if (event.type === 'auth_url' && !/^https:\/\//i.test(event.url)) return
        if (event.type === 'info' && event.links?.some((link) => !/^https:\/\//i.test(link.url))) return
        flow.events = [...flow.events.slice(-7), event]
      },
      prompt: (prompt) => new Promise<string>((resolve, reject) => {
        if (flow.controller.signal.aborted) { reject(new Error('Login cancelled')); return }
        flow.state = 'prompt'
        flow.prompt = { type: prompt.type, message: prompt.message.slice(0, 500), ...('placeholder' in prompt && prompt.placeholder ? { placeholder: prompt.placeholder.slice(0, 120) } : {}), ...(prompt.type === 'select' ? { options: prompt.options.map((option) => ({ id: option.id, label: option.label, ...(option.description ? { description: option.description } : {}) })) } : {}) }
        flow.answer = { resolve, reject }
        prompt.signal?.addEventListener('abort', () => {
          if (flow.answer?.resolve === resolve) { flow.answer = undefined; flow.prompt = undefined; flow.state = 'pending'; reject(new Error('Prompt cancelled')) }
        }, { once: true })
      }),
    }).then(() => { if (flow.state !== 'cancelled') flow.state = 'complete' }).catch(() => { if (flow.state !== 'cancelled') { flow.state = 'failed'; flow.error = 'Provider login failed or expired' } }).finally(() => { clearTimeout(timeout); if (this.activeId === flow.id) this.activeId = undefined })
    return this.publicFlow(flow)
  }

  get(id: string): PublicModelLoginFlow | undefined {
    const flow = this.flows.get(id)
    if (!flow) return undefined
    if (Date.now() > flow.expiresAt && flow.state !== 'complete' && flow.state !== 'failed' && flow.state !== 'cancelled') this.cancel(id)
    return this.publicFlow(flow)
  }

  answer(id: string, value: string): PublicModelLoginFlow {
    const flow = this.flows.get(id)
    if (!flow?.answer || flow.state !== 'prompt' || typeof value !== 'string' || value.length > 4096) throw new Error('No pending login prompt accepts this answer')
    const answer = flow.answer
    flow.answer = undefined
    flow.prompt = undefined
    flow.state = 'pending'
    answer.resolve(value)
    return this.publicFlow(flow)
  }

  cancel(id: string): PublicModelLoginFlow | undefined {
    const flow = this.flows.get(id)
    if (!flow) return undefined
    if (flow.state !== 'complete' && flow.state !== 'failed' && flow.state !== 'cancelled') {
      flow.state = 'cancelled'
      flow.answer?.reject(new Error('Login cancelled'))
      flow.answer = undefined
      flow.prompt = undefined
      flow.controller.abort()
      if (this.activeId === id) this.activeId = undefined
    }
    return this.publicFlow(flow)
  }

  close(): void { for (const id of this.flows.keys()) this.cancel(id); this.flows.clear() }

  private publicFlow(flow: InternalFlow): PublicModelLoginFlow {
    return { id: flow.id, provider: flow.provider, state: flow.state, events: flow.events, ...(flow.prompt ? { prompt: flow.prompt } : {}), ...(flow.error ? { error: flow.error } : {}) }
  }
}
