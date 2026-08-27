import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { KNOWLEDGE_SCHEMA_V03 } from '../../schemas/knowledge/v03/executable-schema.ts'
import { parseKnowledgeBaseManifest, type KnowledgeBaseManifest } from '../../schemas/knowledge/index.ts'
import { CanonicalV03KnowledgeLoader } from '../../shared/knowledge-base/canonical-v03-loader.ts'
import { verifyRaw } from '../../shared/knowledge-base/raw-archive.ts'
import { createKnowledgeBaseHandle } from '../../shared/knowledge-base/handle.ts'
import { parseYaml } from '../../shared/knowledge-base/yaml.ts'
import type { ValidationDiagnostic, ValidationScope } from './types.ts'
import type { KnowledgeAssetCollectionV03 } from '../../shared/knowledge-base/v03-types.ts'
import { validateV03CanonicalObject, validateV03GlobalInvariants, type V03CanonicalObject } from './v03-validation-core.ts'

type Dict = Record<string, unknown>
const rawRefPattern = new RegExp(KNOWLEDGE_SCHEMA_V03.rawIdentity.pattern)

function isRecord(value: unknown): value is Dict { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function arrayOfStrings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string') }
function error(code: string, message: string, assetId?: string, filePath?: string): ValidationDiagnostic { return { code, severity: 'error', message, ...(assetId ? { assetId } : {}), ...(filePath ? { filePath } : {}) } }

async function listFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true }); const result: string[] = []
    for (const entry of entries) { const path = join(root, entry.name); if (entry.isDirectory()) result.push(...await listFiles(path)); else if (/\.(yaml|yml|json)$/i.test(entry.name)) result.push(path) }
    return result
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
}

export async function validateKnowledgeBaseV03(rootRef: string, manifest?: KnowledgeBaseManifest, scope: ValidationScope = 'all'): Promise<ValidationDiagnostic[]> {
  const diagnostics: ValidationDiagnostic[] = []; const root = resolve(rootRef)
  let actualManifest = manifest
  try { actualManifest ??= parseKnowledgeBaseManifest(parseYaml(await readFile(join(root, 'manifest.yaml'), 'utf8'), join(root, 'manifest.yaml'))) } catch (caught) { return [error('V03_MANIFEST_INVALID', caught instanceof Error ? caught.message : String(caught))] }
  if (actualManifest.schemaVersion !== KNOWLEDGE_SCHEMA_V03.identity.schemaVersion || actualManifest.storageFormatVersion !== KNOWLEDGE_SCHEMA_V03.identity.storageFormatVersion) return [error('V03_MANIFEST_VERSION', 'Manifest is not Schema 0.3 / Storage Format 1')]
  if (scope === 'manifest') return diagnostics
  let assets: KnowledgeAssetCollectionV03
  try { assets = await new CanonicalV03KnowledgeLoader(root).readAssets() } catch (caught) { return [error('V03_REGISTRY_INVALID', caught instanceof Error ? caught.message : String(caught))] }

  const taxonomyIds = new Set<string>()
  for (const file of await listFiles(join(root, 'taxonomy'))) {
    try {
      const visit = (candidate: unknown): void => { if (Array.isArray(candidate)) { candidate.forEach(visit); return }; if (!isRecord(candidate)) return; if (typeof candidate.id === 'string') taxonomyIds.add(candidate.id); Object.values(candidate).forEach(visit) }
      visit(parseYaml(await readFile(file, 'utf8'), file))
    } catch { diagnostics.push(error('V03_AUXILIARY_PARSE_ERROR', `Unable to parse taxonomy file: ${relative(root, file)}`, undefined, file)) }
  }
  const rawIds = new Set<string>()
  try {
    const raw = parseYaml(await readFile(join(root, 'registry', 'raw.yaml'), 'utf8'), join(root, 'registry', 'raw.yaml'))
    if (!isRecord(raw)) diagnostics.push(error('V03_RAW_REGISTRY_INVALID', 'registry/raw.yaml must be an object map'))
    else for (const [id, entry] of Object.entries(raw)) { if (!rawRefPattern.test(id) || !isRecord(entry) || typeof entry.contentHash !== 'string' || typeof entry.storageRef !== 'string') diagnostics.push(error('V03_RAW_REGISTRY_INVALID', `Invalid Raw registry entry: ${id}`)); rawIds.add(id) }
  } catch (caught) { if ((caught as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(error('V03_RAW_REGISTRY_INVALID', caught instanceof Error ? caught.message : String(caught))) }

  const all = [...assets.themeGroups, ...assets.entities, ...assets.relations, ...assets.claims, ...assets.modules, ...assets.sources]
  const objects = new Map<string, V03CanonicalObject>(all.map((item) => [item.value.id, { kind: item.kind, object: item.value as unknown as Dict }]))
  const context = { objects, rawRefs: rawIds, taxonomyRefs: taxonomyIds }
  const fileById = new Map<string, string>(all.map((item) => [String(item.value.id), item.filePath]))
  for (const item of all) {
    if (scope !== 'all' && !((scope === 'entity' && item.kind === 'entity') || (scope === 'relation' && item.kind === 'relation') || (scope === 'module' && item.kind === 'module') || (scope === 'source' && item.kind === 'source'))) continue
    validateV03CanonicalObject(objects.get(item.value.id)!, context, diagnostics, { assetId: item.value.id, filePath: item.filePath })
  }
  validateV03GlobalInvariants(context, diagnostics, (assetId) => ({ assetId, filePath: fileById.get(assetId) }))

  for (const file of [...await listFiles(join(root, 'entities')), ...await listFiles(join(root, 'relations')), ...await listFiles(join(root, 'intelligence')), ...await listFiles(join(root, 'modules')), ...await listFiles(join(root, 'sources')), ...await listFiles(join(root, 'theme-groups'))]) {
    try { const value = parseYaml(await readFile(file, 'utf8'), file); if (isRecord(value) && typeof value.id === 'string' && !objects.has(value.id)) diagnostics.push(error('V03_ORPHAN_CANONICAL_ASSET', `Canonical asset is not registered: ${value.id}`, value.id, file)) } catch { /* loader reports registered parse failures */ }
  }
  const rawHandle = createKnowledgeBaseHandle(actualManifest, root, 'read_only_compatible')
  for (const source of assets.sources) if (Array.isArray(source.value.rawRefs)) for (const rawRef of source.value.rawRefs) {
    if (!rawRefPattern.test(rawRef) || !rawIds.has(rawRef)) diagnostics.push(error('V03_RAW_REF_MISSING', `Source rawRef does not resolve through registry/raw.yaml: ${rawRef}`, source.value.id, source.filePath))
    else { try { await verifyRaw(rawHandle, rawRef) } catch (caught) { diagnostics.push(error('V03_RAW_INTEGRITY_ERROR', caught instanceof Error ? caught.message : String(caught), source.value.id, source.filePath)) } }
  }
  for (const file of await listFiles(join(root, 'taxonomy'))) {
    try {
      const value = parseYaml(await readFile(file, 'utf8'), file)
      const visit = (node: unknown): void => { if (Array.isArray(node)) { for (const child of node) visit(child); return }; if (!isRecord(node)) return; for (const [field, child] of Object.entries(node)) { if (field === 'graphRefs' && (!arrayOfStrings(child) || child.some((ref) => !objects.has(ref)))) diagnostics.push(error('V03_AUXILIARY_REF_INVALID', 'Taxonomy graphRefs must use resolvable v0.3 canonical references', undefined, file)); visit(child) } }
      visit(value)
    } catch { /* taxonomy parse errors are reported during inventory */ }
  }
  for (const file of await listFiles(join(root, 'views'))) {
    try {
      const value = parseYaml(await readFile(file, 'utf8'), file)
      const visit = (node: unknown): void => { if (Array.isArray(node)) { for (const child of node) visit(child); return }; if (!isRecord(node)) return; for (const [field, child] of Object.entries(node)) { if (field === 'targetEntity' && (typeof child !== 'string' || objects.get(child)?.kind !== 'entity')) diagnostics.push(error('V03_VIEW_REF_INVALID', `View targetEntity does not resolve to an Entity: ${String(child)}`, undefined, file)); if (field === 'graphRefs' && (!arrayOfStrings(child) || child.some((ref) => !objects.has(ref)))) diagnostics.push(error('V03_VIEW_REF_INVALID', 'View graphRefs must use resolvable v0.3 canonical references', undefined, file)); visit(child) } }
      visit(value)
    } catch { diagnostics.push(error('V03_AUXILIARY_PARSE_ERROR', `Unable to parse view file: ${relative(root, file)}`, undefined, file)) }
  }
  return diagnostics
}
