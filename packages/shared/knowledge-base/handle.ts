import type { KnowledgeBaseManifest } from '../../schemas/knowledge/index.ts'
import type { KnowledgeCompatibilityStatus } from './compatibility.ts'

export interface KnowledgeBaseHandleInit {
  knowledgeBaseId: string
  rootRef: string
  schemaVersion: string
  storageFormatVersion: string
  revision: number
  status: KnowledgeBaseManifest['status']
  compatibility?: KnowledgeCompatibilityStatus
}

export class KnowledgeBaseHandle {
  readonly knowledgeBaseId: string
  readonly rootRef: string
  readonly schemaVersion: string
  readonly storageFormatVersion: string
  readonly revision: number
  readonly status: KnowledgeBaseManifest['status']
  readonly compatibility: KnowledgeCompatibilityStatus

  constructor(input: KnowledgeBaseHandleInit) {
    this.knowledgeBaseId = input.knowledgeBaseId
    this.rootRef = input.rootRef
    this.schemaVersion = input.schemaVersion
    this.storageFormatVersion = input.storageFormatVersion
    this.revision = input.revision
    this.status = input.status
    this.compatibility = input.compatibility ?? 'compatible'
    Object.freeze(this)
  }

  get writable(): boolean {
    return this.compatibility === 'compatible' && this.status === 'active'
  }
}

export function createKnowledgeBaseHandle(
  manifest: KnowledgeBaseManifest,
  rootRef: string,
  compatibility: KnowledgeCompatibilityStatus = 'compatible',
): KnowledgeBaseHandle {
  return new KnowledgeBaseHandle({
    knowledgeBaseId: manifest.knowledgeBaseId,
    rootRef,
    schemaVersion: manifest.schemaVersion,
    storageFormatVersion: manifest.storageFormatVersion,
    revision: manifest.revision,
    status: manifest.status,
    compatibility,
  })
}
