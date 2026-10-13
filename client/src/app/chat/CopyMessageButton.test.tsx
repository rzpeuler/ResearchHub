import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyMessageButton } from './CopyMessageButton'

const labels = {
  copy: 'Copy message',
  copyVisibleSoFar: 'Copy visible content so far',
  copied: 'Copied',
  copyFailed: 'Copy failed',
}

let writeText: ReturnType<typeof vi.fn>
let clipboardDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
})

afterEach(() => {
  cleanup()
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor)
  else Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

describe('CopyMessageButton', () => {
  it('copies the exact readable text and announces success accessibly', async () => {
    const text = 'Answer with spacing  \n第二行\n'
    render(<CopyMessageButton text={text} isStreaming={false} labels={labels} />)
    expect(screen.queryByRole('status')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(text)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied'))
  })

  it('labels streaming copies as visible content so far and copies only supplied text', async () => {
    const visibleText = 'Visible answer so far'
    render(<CopyMessageButton text={visibleText} isStreaming labels={labels} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy visible content so far' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(visibleText)
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copied'))
  })

  it('announces clipboard failures accessibly without using a fallback', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard unavailable'))
    render(<CopyMessageButton text="Readable answer" isStreaming={false} labels={labels} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('Readable answer')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Copy failed'))
  })
})
