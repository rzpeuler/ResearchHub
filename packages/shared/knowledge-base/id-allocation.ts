import { createHash } from 'node:crypto'
import { canonicalSerialize } from './canonical-hash.ts'

export type KnowledgeIdNamespace = 'industry' | 'segment' | 'company' | 'product' | 'technology' | 'relation' | 'fact' | 'forecast' | 'viewpoint' | 'trend' | 'risk' | 'source' | 'module'

export function normalizeKnowledgeSlug(value: string): string {
  const ascii = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
  return ascii || `item-${semanticHash(value).slice(0, 16)}`
}

export function semanticHash(value: unknown): string {
  const copy = stripDurableIdentity(value)
  return createHash('sha256').update(canonicalSerialize(copy)).digest('hex')
}

export function hashId(namespace: KnowledgeIdNamespace, value: unknown): string {
  return `${namespace}:${semanticHash(value).slice(0, 16)}`
}

export function allocateEntityId(type: string, name: string, discriminator?: unknown): string {
  const namespace = ['industry', 'segment', 'company', 'product', 'technology'].includes(type) ? type : 'product'
  const base = normalizeKnowledgeSlug(name)
  if (discriminator === undefined) return `${namespace}:${base}`
  return `${namespace}:${base}-${semanticHash(discriminator).slice(0, 8)}`
}

export function allocateSourceId(input: { sourceUrl?: string | null; publishedAt?: string | null; title?: string | null; rawRef: string }): string {
  const identity = input.sourceUrl?.trim() ? `${normalizeUrl(input.sourceUrl)}|${input.publishedAt ?? ''}|${input.title ?? ''}` : input.rawRef
  return `source:doc-${semanticHash(identity).slice(0, 16)}`
}

export function allocateKnowledgeId(type: string, value: unknown): string {
  const namespace = ['fact', 'forecast', 'viewpoint', 'trend', 'risk'].includes(type) ? type : ['relation', 'module'].includes(type) ? type : 'fact'
  return hashId(namespace as KnowledgeIdNamespace, value)
}

export function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim())
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return value.trim()
  }
}

function stripDurableIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDurableIdentity)
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'id' || key === 'knowledgeId' || key === 'sourceRefs' || key === 'rawRefs' || key === 'createdAt' || key === 'updatedAt') continue
    result[key] = stripDurableIdentity(child)
  }
  return result
}
