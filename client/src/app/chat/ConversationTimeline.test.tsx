import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ConversationMessage } from '../../api/runtime-client'
import { ConversationTimeline } from '../../App'
import { LanguageProvider } from '../../i18n'

const emptyProps = {
  activities: [],
  optimisticRequests: [],
  streaming: false,
  thinking: false,
  streamText: '',
  toolEvents: [],
} as const

function messages(count: number): readonly ConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
    content: `Message ${index} ${'long text '.repeat(8)}`,
    timestamp: `2026-10-13T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
  }))
}

function renderTimeline(conversationId: string, items: readonly ConversationMessage[], streamText = '') {
  window.localStorage.setItem('researchhub.language', 'en')
  return render(<LanguageProvider><ConversationTimeline conversationId={conversationId} messages={items} {...emptyProps} streamText={streamText} /></LanguageProvider>)
}

function setViewport(element: HTMLElement, scrollHeight: number, clientHeight = 400): void {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight })
}

afterEach(() => cleanup())

describe('ConversationTimeline scroll behavior', () => {
  it('keeps a reader at their position as long streamed output grows and jumps to latest on request', () => {
    const items = messages(60)
    const view = renderTimeline('conversation-a', items)
    const scroller = screen.getByRole('region', { name: 'Conversation timeline' })
    setViewport(scroller, 2400)
    scroller.scrollTop = 620
    fireEvent.scroll(scroller)

    view.rerender(<LanguageProvider><ConversationTimeline conversationId="conversation-a" messages={items} {...emptyProps} streaming thinking streamText={'partial '.repeat(300)} /></LanguageProvider>)
    expect(scroller.scrollTop).toBe(620)
    const jump = screen.getByRole('button', { name: 'Jump to latest' })
    fireEvent.click(jump)
    expect(scroller.scrollTop).toBe(2400)

    setViewport(scroller, 2800)
    view.rerender(<LanguageProvider><ConversationTimeline conversationId="conversation-a" messages={items} {...emptyProps} streaming thinking streamText={'more '.repeat(500)} /></LanguageProvider>)
    expect(scroller.scrollTop).toBe(2800)
  })

  it('restores scroll position per conversation and does not carry A position into B', () => {
    const view = renderTimeline('conversation-a', messages(60))
    const scroller = screen.getByRole('region', { name: 'Conversation timeline' })
    setViewport(scroller, 2400)
    scroller.scrollTop = 520
    fireEvent.scroll(scroller)

    view.rerender(<LanguageProvider><ConversationTimeline conversationId="conversation-b" messages={messages(30)} {...emptyProps} /></LanguageProvider>)
    expect(scroller.scrollTop).toBe(2400)
    setViewport(scroller, 1600)

    view.rerender(<LanguageProvider><ConversationTimeline conversationId="conversation-a" messages={messages(60)} {...emptyProps} /></LanguageProvider>)
    expect(scroller.scrollTop).toBe(520)
  })

  it('announces concise response transitions without making the transcript a live region', () => {
    const view = renderTimeline('conversation-a', [])
    expect(screen.getByRole('region', { name: 'Conversation timeline' }).getAttribute('aria-live')).toBe('off')
    view.rerender(<LanguageProvider><ConversationTimeline conversationId="conversation-a" messages={[]} {...emptyProps} streaming thinking streamText="partial answer" /></LanguageProvider>)
    expect(screen.getByRole('status').textContent).toBe('Agent is responding.')
    view.rerender(<LanguageProvider><ConversationTimeline conversationId="conversation-a" messages={[]} {...emptyProps} /></LanguageProvider>)
    expect(screen.getByRole('status').textContent).toBe('Agent response complete.')
  })
})
