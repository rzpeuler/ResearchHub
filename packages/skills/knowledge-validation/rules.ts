import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseYaml } from '../knowledge-access/yaml.ts'
import type { IntelligenceType, LifecycleStatus } from '../knowledge-access/types.ts'

export interface RelationRule {
  type: string
  sourceTypes: string[]
  targetTypes: string[]
}

export interface IntelligenceRule {
  type: IntelligenceType
  required: string[]
}

export interface ValidationRules {
  relations: RelationRule[]
  intelligence: IntelligenceRule[]
  lifecycleStatuses: LifecycleStatus[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export class KnowledgeRuleConfigLoader {
  constructor(private readonly rulesDir: string) {}

  async load(): Promise<ValidationRules> {
    const relationValue = parseYaml(await readFile(join(this.rulesDir, 'relation-rules.yaml'), 'utf8'), join(this.rulesDir, 'relation-rules.yaml'))
    const intelligenceValue = parseYaml(await readFile(join(this.rulesDir, 'intelligence-rules.yaml'), 'utf8'), join(this.rulesDir, 'intelligence-rules.yaml'))
    const lifecycleValue = parseYaml(await readFile(join(this.rulesDir, 'lifecycle-rules.yaml'), 'utf8'), join(this.rulesDir, 'lifecycle-rules.yaml'))
    const relations = isRecord(relationValue) && Array.isArray(relationValue.relations) ? relationValue.relations : []
    const intelligence = isRecord(intelligenceValue) && Array.isArray(intelligenceValue.types) ? intelligenceValue.types : []
    const statuses = isRecord(lifecycleValue) ? strings(lifecycleValue.statuses) : []
    return {
      relations: relations.filter(isRecord).map((rule) => ({
        type: String(rule.type),
        sourceTypes: strings(rule.sourceTypes),
        targetTypes: strings(rule.targetTypes),
      })),
      intelligence: intelligence.filter(isRecord).map((rule) => ({
        type: String(rule.type) as IntelligenceType,
        required: strings(rule.required),
      })),
      lifecycleStatuses: statuses as LifecycleStatus[],
    }
  }
}
