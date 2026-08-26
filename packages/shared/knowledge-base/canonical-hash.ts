import { createHash } from 'node:crypto'
import { KnowledgeError } from './errors.ts'

type CanonicalValue = null | string | number | boolean | CanonicalValue[] | { [key: string]: CanonicalValue }

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function canonicalize(value: unknown, ancestors: Set<object>): CanonicalValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new KnowledgeError('CanonicalHashError', 'Knowledge object contains a non-finite number')
    return value
  }
  if (typeof value !== 'object') {
    throw new KnowledgeError('CanonicalHashError', `Unsupported Knowledge object value: ${typeof value}`)
  }
  if (ancestors.has(value)) throw new KnowledgeError('CanonicalHashError', 'Knowledge object contains a cycle')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const result: CanonicalValue[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new KnowledgeError('CanonicalHashError', 'Knowledge arrays cannot contain holes')
        result.push(canonicalize(value[index], ancestors))
      }
      return result
    }
    if (!isPlainObject(value)) throw new KnowledgeError('CanonicalHashError', 'Only arrays and plain objects are supported')
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new KnowledgeError('CanonicalHashError', 'Knowledge objects cannot contain symbol keys')
    }
    const result: { [key: string]: CanonicalValue } = Object.create(null) as { [key: string]: CanonicalValue }
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue
      result[key] = canonicalize(value[key], ancestors)
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalSerialize(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set<object>()))
}

export function hashKnowledgeObject(value: unknown): string {
  const digest = createHash('sha256').update(Buffer.from(canonicalSerialize(value), 'utf8')).digest('hex')
  return `sha256:${digest}`
}
