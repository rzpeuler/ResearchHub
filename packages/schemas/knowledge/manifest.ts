export const KNOWLEDGE_BASE_STATUSES = ['active', 'readonly', 'archived'] as const
export type KnowledgeBaseStatus = (typeof KNOWLEDGE_BASE_STATUSES)[number]

export interface KnowledgeBaseManifest {
  knowledgeBaseId: string
  name: string
  schemaVersion: string
  storageFormatVersion: string
  revision: number
  status: KnowledgeBaseStatus
  createdAt: string
  updatedAt: string
  [key: string]: unknown
}

export class KnowledgeBaseManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeBaseManifestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new KnowledgeBaseManifestError(`Manifest field '${field}' must be a non-empty string`)
  }
  return value
}

function dateString(value: unknown, field: string): string {
  const result = requiredString(value, field)
  if (Number.isNaN(Date.parse(result))) {
    throw new KnowledgeBaseManifestError(`Manifest field '${field}' must be a valid date string`)
  }
  return result
}

export function parseKnowledgeBaseManifest(input: unknown): KnowledgeBaseManifest {
  if (!isRecord(input)) throw new KnowledgeBaseManifestError('Knowledge Base manifest must be an object')

  const knowledgeBaseId = requiredString(input.knowledgeBaseId, 'knowledgeBaseId')
  const name = requiredString(input.name, 'name')
  const schemaVersion = requiredString(input.schemaVersion, 'schemaVersion')
  const storageFormatVersion = requiredString(input.storageFormatVersion, 'storageFormatVersion')
  if (!Number.isInteger(input.revision) || (input.revision as number) < 0) {
    throw new KnowledgeBaseManifestError('Manifest field revision must be an integer greater than or equal to 0')
  }
  if (!(KNOWLEDGE_BASE_STATUSES as readonly unknown[]).includes(input.status)) {
    throw new KnowledgeBaseManifestError(`Manifest status must be one of: ${KNOWLEDGE_BASE_STATUSES.join(', ')}`)
  }
  const status = input.status as KnowledgeBaseStatus
  const createdAt = dateString(input.createdAt, 'createdAt')
  const updatedAt = dateString(input.updatedAt, 'updatedAt')

  return {
    ...input,
    knowledgeBaseId,
    name,
    schemaVersion,
    storageFormatVersion,
    revision: input.revision as number,
    status,
    createdAt,
    updatedAt,
  }
}
