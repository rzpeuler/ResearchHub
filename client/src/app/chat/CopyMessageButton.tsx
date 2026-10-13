import { useEffect, useRef, useState } from 'react'

export interface CopyMessageButtonLabels {
  copy: string
  copyVisibleSoFar: string
  copied: string
  copyFailed: string
}

export interface CopyMessageButtonProps {
  text: string
  isStreaming: boolean
  labels: CopyMessageButtonLabels
}

const STATUS_DURATION_MS = 2000

export function CopyMessageButton({ text, isStreaming, labels }: CopyMessageButtonProps) {
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
  }, [])

  async function copyText() {
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current)
    setStatus(null)

    try {
      await navigator.clipboard.writeText(text)
      setStatus('copied')
    } catch {
      setStatus('failed')
    }

    timeoutRef.current = setTimeout(() => {
      setStatus(null)
      timeoutRef.current = null
    }, STATUS_DURATION_MS)
  }

  const label = isStreaming ? labels.copyVisibleSoFar : labels.copy
  return (
    <span className="copy-message-control">
      <button className="copy-message-button" type="button" onClick={copyText} aria-label={label} title={label}>
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="7" y="6" width="9" height="11" rx="1.5" /><path d="M5 13H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1" /></svg>
      </button>
      {status ? <span className="copy-message-status" role="status" aria-live="polite" aria-atomic="true">
        {status === 'copied' ? labels.copied : labels.copyFailed}
      </span> : null}
    </span>
  )
}
