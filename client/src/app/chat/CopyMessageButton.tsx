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

  return (
    <span>
      <button type="button" onClick={copyText} aria-label={isStreaming ? labels.copyVisibleSoFar : labels.copy}>
        {isStreaming ? labels.copyVisibleSoFar : labels.copy}
      </button>
      {status ? <span role="status" aria-live="polite" aria-atomic="true">
        {status === 'copied' ? labels.copied : labels.copyFailed}
      </span> : null}
    </span>
  )
}
