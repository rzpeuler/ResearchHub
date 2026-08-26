import { createHash } from 'node:crypto'

/** The canonical raw identity used by both the archive and ingestion planning. */
export function deriveRawIdentity(bytes: Uint8Array): { rawRef: string; contentHash: string; sizeBytes: number } {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Raw bytes must be a Uint8Array')
  const digest = createHash('sha256').update(bytes).digest('hex')
  return { rawRef: `raw-sha256-${digest}`, contentHash: `sha256:${digest}`, sizeBytes: bytes.byteLength }
}
