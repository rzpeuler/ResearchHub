import { hashKnowledgeObject } from '../storage/canonical-hash.ts'
import type { KillCriterionOriginV04 } from './domain-v04.ts'

export const KILL_CRITERION_V04_LIMITS = {
  revisionsPerThesis: 100,
  targetsPerCriterion: 32,
  definitionDepth: 8,
  definitionNodes: 256,
  definitionStringLength: 4096,
  definitionKeyLength: 128,
  definitionSerializedLength: 16_384,
} as const

export interface KillCriterionHashInputV04 {
  type: string
  definitionVersion: number
  definition: Record<string, unknown>
  targetClaimRefs: readonly string[]
  origin: KillCriterionOriginV04 | Record<string, unknown>
}

/** Hashes only immutable criterion meaning. Confirmation and activation times are deliberately excluded. */
export function hashKillCriterionDefinitionV04(input: KillCriterionHashInputV04): string {
  return hashKnowledgeObject({
    type: input.type,
    definitionVersion: input.definitionVersion,
    definition: input.definition,
    targetClaimRefs: [...input.targetClaimRefs],
    origin: input.origin,
  })
}

/** Accepts bounded JSON values while rejecting prototype-sensitive keys and non-JSON objects. */
export function isBoundedSafeKillCriterionJsonV04(value: unknown): value is Record<string, unknown> {
  let nodes = 0
  const visit = (item: unknown, depth: number): boolean => {
    nodes += 1
    if (nodes > KILL_CRITERION_V04_LIMITS.definitionNodes || depth > KILL_CRITERION_V04_LIMITS.definitionDepth) return false
    if (item === null || typeof item === 'boolean') return true
    if (typeof item === 'number') return Number.isFinite(item)
    if (typeof item === 'string') return item.length <= KILL_CRITERION_V04_LIMITS.definitionStringLength
    if (typeof item !== 'object') return false
    if (Array.isArray(item)) return item.length <= KILL_CRITERION_V04_LIMITS.definitionNodes && item.every((child) => visit(child, depth + 1))
    const prototype = Object.getPrototypeOf(item)
    if (prototype !== Object.prototype && prototype !== null) return false
    const keys = Object.keys(item)
    if (keys.length > KILL_CRITERION_V04_LIMITS.definitionNodes) return false
    for (const key of keys) {
      if (key.length === 0 || key.length > KILL_CRITERION_V04_LIMITS.definitionKeyLength || key === '__proto__' || key === 'prototype' || key === 'constructor') return false
      if (!visit((item as Record<string, unknown>)[key], depth + 1)) return false
    }
    return true
  }

  if (!itemRecord(value) || !visit(value, 0)) return false
  try {
    return JSON.stringify(value).length <= KILL_CRITERION_V04_LIMITS.definitionSerializedLength
  } catch {
    return false
  }
}

function itemRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
