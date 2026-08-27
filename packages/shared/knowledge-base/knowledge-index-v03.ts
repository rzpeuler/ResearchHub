import { KnowledgeError } from './errors.ts'
import type {
  KnowledgeEntityV03,
  KnowledgeRelationV03,
  KnowledgeClaimV03,
  KnowledgeModuleV03,
  KnowledgeSourceV03,
  KnowledgeThemeGroupV03,
  EntityTypeV03,
  RelationTypeV03,
  ClaimTypeV03,
} from '../../schemas/knowledge/v03/domain.ts'
import type { KnowledgeAssetCollectionV03 } from './v03-types.ts'

export class KnowledgeIndexV03 {
  readonly themeGroups = new Map<string, KnowledgeThemeGroupV03>()
  readonly entities = new Map<string, KnowledgeEntityV03>()
  readonly relations = new Map<string, KnowledgeRelationV03>()
  readonly claims = new Map<string, KnowledgeClaimV03>()
  readonly modules = new Map<string, KnowledgeModuleV03>()
  readonly sources = new Map<string, KnowledgeSourceV03>()
  readonly registry = new Map<string, string>()

  private readonly relationsByEntity = new Map<string, KnowledgeRelationV03[]>()
  private readonly claimsBySubject = new Map<string, KnowledgeClaimV03[]>()

  static fromAssets(assets: KnowledgeAssetCollectionV03): KnowledgeIndexV03 {
    const index = new KnowledgeIndexV03()
    for (const asset of assets.themeGroups) index.add(index.themeGroups, asset.value.id, asset.value, asset.filePath)
    for (const asset of assets.entities) index.add(index.entities, asset.value.id, asset.value, asset.filePath)
    for (const asset of assets.relations) {
      index.add(index.relations, asset.value.id, asset.value, asset.filePath)
      index.reverse(index.relationsByEntity, asset.value.sourceRef, asset.value)
      index.reverse(index.relationsByEntity, asset.value.targetRef, asset.value)
    }
    for (const asset of assets.claims) {
      index.add(index.claims, asset.value.id, asset.value, asset.filePath)
      for (const subjectRef of asset.value.subjectRefs) index.reverse(index.claimsBySubject, subjectRef, asset.value)
    }
    for (const asset of assets.modules) index.add(index.modules, asset.value.id, asset.value, asset.filePath)
    for (const asset of assets.sources) index.add(index.sources, asset.value.id, asset.value, asset.filePath)
    for (const entry of assets.registry) index.registry.set(entry.id, entry.storageRef)
    return index
  }

  getThemeGroup(ref: string): KnowledgeThemeGroupV03 {
    const value = this.themeGroups.get(ref)
    if (!value) throw new KnowledgeError('NotFound', `ThemeGroup not found: ${ref}`)
    return value
  }

  getEntity(ref: string): KnowledgeEntityV03 {
    const value = this.entities.get(ref)
    if (!value) throw new KnowledgeError('NotFound', `Entity not found: ${ref}`)
    return value
  }

  searchEntities(query: string, type?: EntityTypeV03): KnowledgeEntityV03[] {
    const normalized = query.trim().toLocaleLowerCase()
    return [...this.entities.values()]
      .filter((entity) => type === undefined || entity.type === type)
      .filter((entity) => normalized === '' || [entity.id, entity.name, ...(entity.aliases ?? [])].join(' ').toLocaleLowerCase().includes(normalized))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  getRelations(ref: string, type?: RelationTypeV03): KnowledgeRelationV03[] {
    if (!this.entities.has(ref)) throw new KnowledgeError('NotFound', `Entity not found: ${ref}`)
    return (this.relationsByEntity.get(ref) ?? []).filter((relation) => type === undefined || relation.type === type).sort((left, right) => left.id.localeCompare(right.id))
  }

  getClaims(subjectRef: string, type?: ClaimTypeV03): KnowledgeClaimV03[] {
    if (!this.entities.has(subjectRef) && !this.relations.has(subjectRef)) throw new KnowledgeError('NotFound', `Knowledge subject not found: ${subjectRef}`)
    return (this.claimsBySubject.get(subjectRef) ?? []).filter((claim) => type === undefined || claim.claimType === type).sort((left, right) => left.id.localeCompare(right.id))
  }

  getSource(ref: string): KnowledgeSourceV03 {
    const value = this.sources.get(ref)
    if (!value) throw new KnowledgeError('NotFound', `Source not found: ${ref}`)
    return value
  }

  getSourcesFor(ref: string): KnowledgeSourceV03[] {
    const value = this.entities.get(ref) ?? this.relations.get(ref) ?? this.claims.get(ref) ?? this.modules.get(ref)
    if (!value) throw new KnowledgeError('NotFound', `Knowledge item not found: ${ref}`)
    const sourceRefs = 'sourceRefs' in value && Array.isArray(value.sourceRefs) ? value.sourceRefs : []
    return sourceRefs.map((sourceRef) => this.sources.get(sourceRef)).filter((source): source is KnowledgeSourceV03 => source !== undefined).sort((left, right) => left.id.localeCompare(right.id))
  }

  private add<T>(map: Map<string, T>, id: string, value: T, filePath: string): void {
    if (map.has(id)) throw new KnowledgeError('SchemaError', `Duplicate Knowledge ID: ${id}`, filePath)
    map.set(id, value)
  }

  private reverse<T>(map: Map<string, T[]>, key: string, value: T): void {
    const values = map.get(key) ?? []
    values.push(value)
    map.set(key, values)
  }
}
