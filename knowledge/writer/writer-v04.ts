import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { KnowledgeAssetV04 } from '../schema/domain-v04.ts'
import type { ValidatedKnowledgeChangeSetV04, KnowledgeChangeSetV04, KnowledgeWriteResultV04 } from '../schema/mutation-v04.ts'
import { canonicalSerialize, hashKnowledgeObject } from '../storage/canonical-hash.ts'
import { readCanonicalV04Assets } from '../storage/canonical-v04-loader.ts'
import { loadKnowledgeBaseManifest } from '../storage/manifest-loader.ts'
import { withKnowledgeBaseMutationLock } from '../storage/mutation-lock.ts'
import { recoverKnowledgeBaseRoot, runKnowledgeRootTransaction } from '../storage/root-transaction.ts'
import { KnowledgeBaseRegistry } from '../registry/registry.ts'
import { assertKnowledgeV04Objects } from '../validation/v04-validator.ts'
import { inspectThemeScopeContextV04, isValidatorIssuedV04Receipt, validateKnowledgeBaseV04State } from '../validation/v04-change-set-validator.ts'
import { allocateKnowledgeStorageRefV04, kindForKnowledgeV04 } from './path-allocation-v04.ts'
import type { KnowledgeBaseHandle } from '../storage/handle.ts'

type Dict = Record<string, unknown>

function result(changeSet: KnowledgeChangeSetV04, handle: KnowledgeBaseHandle): KnowledgeWriteResultV04 {
  return { status: 'rejected', knowledgeBaseId: handle.knowledgeBaseId, changeSetId: changeSet.changeSetId, baseRevision: handle.revision, committedRevision: handle.revision, createdIds: [], updatedIds: [] }
}

function yaml(value: unknown): string {
  return `${canonicalSerialize(value)}\n`
}

function objectMap(objects: readonly { value: KnowledgeAssetV04 }[]): Map<string, KnowledgeAssetV04> {
  return new Map(objects.map((item) => [item.value.id, structuredClone(item.value)]))
}

function registryMap(objects: readonly { value: KnowledgeAssetV04; storageRef: string }[]): Record<string, { type: string; storageRef: string }> {
  return Object.fromEntries(objects.map((item) => [item.value.id, { type: kindForKnowledgeV04(item.value), storageRef: item.storageRef }]))
}

function idempotencyHash(changeSet: KnowledgeChangeSetV04): string {
  const { expectedBaseRevision: _expectedBaseRevision, ...stableChangeSet } = changeSet
  return hashKnowledgeObject(stableChangeSet)
}

async function existingExecution(root: string, changeSet: KnowledgeChangeSetV04): Promise<Dict | undefined> {
  let names: string[]
  try {
    names = (await readdir(join(root, 'logs', 'research'))).filter((name) => name.endsWith('.yaml')).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  for (const name of names) {
    const value = JSON.parse(await readFile(join(root, 'logs', 'research', name), 'utf8')) as unknown
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && (value as Dict).workflowRunId === changeSet.workflowRunId) return value as Dict
  }
  return undefined
}

async function writeState(root: string, manifest: Dict, registry: Record<string, { type: string; storageRef: string }>, objects: ReadonlyMap<string, KnowledgeAssetV04>): Promise<void> {
  await mkdir(join(root, 'registry'), { recursive: true })
  await writeFile(join(root, 'manifest.yaml'), yaml(manifest))
  await writeFile(join(root, 'registry', 'assets.yaml'), yaml(registry))
  for (const [id, object] of objects) {
    const entry = registry[id]
    if (!entry) throw new Error(`Missing registry entry: ${id}`)
    const path = resolve(root, entry.storageRef)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, yaml(object))
  }
}

export async function writeKnowledgeBaseV04(
  handle: KnowledgeBaseHandle,
  receipt: ValidatedKnowledgeChangeSetV04,
  registry: KnowledgeBaseRegistry,
  clock: () => string = () => new Date().toISOString(),
): Promise<KnowledgeWriteResultV04> {
  const changeSet = receipt && typeof receipt === 'object' && 'changeSet' in receipt ? (receipt as ValidatedKnowledgeChangeSetV04).changeSet : { changeSetId: 'invalid-receipt', workflowRunId: 'invalid-receipt', knowledgeBaseId: handle.knowledgeBaseId } as unknown as KnowledgeChangeSetV04
  const base = result(changeSet, handle)
  if (!isValidatorIssuedV04Receipt(receipt)) return { ...base, error: { code: 'validation_required', message: 'Schema 0.4 Writer accepts only a runtime Validator-issued receipt' } }
  const scopeContext = inspectThemeScopeContextV04(changeSet)
  if (scopeContext.error) return { ...base, error: { code: 'receipt_mismatch', message: scopeContext.error } }
  if (
    receipt.knowledgeBaseId !== handle.knowledgeBaseId ||
    changeSet.knowledgeBaseId !== handle.knowledgeBaseId ||
    handle.schemaVersion !== '0.4' ||
    changeSet.schemaVersion !== '0.4' ||
    receipt.baseRevision !== changeSet.expectedBaseRevision ||
    receipt.changeSetHash !== hashKnowledgeObject(changeSet)
  ) {
    return { ...base, error: { code: 'receipt_mismatch', message: 'Validated Schema 0.4 receipt does not match handle or ChangeSet' } }
  }

  try {
    return await withKnowledgeBaseMutationLock(handle.rootRef, async () => {
      await recoverKnowledgeBaseRoot(handle.rootRef)
      const root = resolve(handle.rootRef)
      const manifest = await loadKnowledgeBaseManifest(root)
      if (manifest.schemaVersion !== '0.4' || manifest.storageFormatVersion !== '1' || manifest.status !== 'active') {
        return { ...base, error: { code: 'not_writable', message: 'Schema 0.4 Knowledge Base is not active and writable' } }
      }
      const prior = await existingExecution(root, changeSet)
      if (prior) {
        const stableHash = idempotencyHash(changeSet)
        if (prior.changeSetHash !== stableHash && prior.changeSetHash !== hashKnowledgeObject(changeSet)) {
          return { ...base, error: { code: 'idempotency_conflict', message: 'Workflow run was already used with a different ChangeSet' } }
        }
        const changes = typeof prior.changes === 'object' && prior.changes !== null ? prior.changes as Dict : {}
        return {
          ...base,
          status: 'already_committed',
          committedRevision: Number(prior.committedRevision ?? manifest.revision),
          createdIds: Array.isArray(changes.createdIds) ? changes.createdIds as string[] : [],
          updatedIds: Array.isArray(changes.updatedIds) ? changes.updatedIds as string[] : [],
        }
      }
      if (manifest.revision !== changeSet.expectedBaseRevision) {
        return { ...base, error: { code: 'stale_revision', message: `Expected ${changeSet.expectedBaseRevision}, current ${manifest.revision}` } }
      }

      const loaded = await readCanonicalV04Assets(root)
      const objects = objectMap(loaded.objects)
      const registryEntries = registryMap(loaded.objects)
      const created: string[] = []
      const updated: string[] = []
      for (const operation of changeSet.operations) {
        if (operation.type === 'create') {
          if (objects.has(operation.object.id)) return { ...base, error: { code: 'id_conflict', message: `Object already exists: ${operation.object.id}` } }
          objects.set(operation.object.id, structuredClone(operation.object))
          registryEntries[operation.object.id] = { type: kindForKnowledgeV04(operation.object), storageRef: allocateKnowledgeStorageRefV04(operation.object) }
          created.push(operation.object.id)
        } else {
          const current = objects.get(operation.knowledgeId)
          if (!current || hashKnowledgeObject(current) !== operation.expectedBeforeHash) return { ...base, error: { code: 'stale_target', message: `Target changed or does not exist: ${operation.knowledgeId}` } }
          if (operation.object.id !== operation.knowledgeId || kindForKnowledgeV04(operation.object) !== registryEntries[operation.knowledgeId]!.type) return { ...base, error: { code: 'invalid_update', message: `Update identity is invalid: ${operation.knowledgeId}` } }
          objects.set(operation.knowledgeId, structuredClone(operation.object))
          updated.push(operation.knowledgeId)
        }
      }
      assertKnowledgeV04Objects([...objects.values()])
      const hasCommittedChanges = created.length + updated.length > 0 || scopeContext.present
      const nextRevision = hasCommittedChanges ? manifest.revision + 1 : manifest.revision
      const nextManifest = { ...manifest, revision: nextRevision, updatedAt: hasCommittedChanges ? clock() : manifest.updatedAt }
      const logRef = `logs/research/${changeSet.workflowRunId}.yaml`
      const log = {
        workflowRunId: changeSet.workflowRunId,
        changeSetId: changeSet.changeSetId,
        changeSetHash: idempotencyHash(changeSet),
        knowledgeBaseId: manifest.knowledgeBaseId,
        schemaVersionAtExecution: '0.4',
        status: 'completed',
        writeStatus: hasCommittedChanges ? 'committed' : 'no_changes',
        committedRevision: nextRevision,
        changes: { createdIds: created, updatedIds: updated },
        ingestionContext: changeSet.ingestionContext,
      }
      await runKnowledgeRootTransaction({
        rootRef: root,
        transactionId: `${changeSet.workflowRunId}-${changeSet.changeSetId}`,
        transactionKind: 'write',
        knowledgeBaseId: manifest.knowledgeBaseId,
        previousRevision: manifest.revision,
        nextRevision,
        targetSchemaVersion: '0.4',
        targetStorageFormatVersion: '1',
        targetStatus: 'active',
        prepare: async (staging) => {
          await writeState(staging, nextManifest, registryEntries, objects)
          await mkdir(dirname(join(staging, logRef)), { recursive: true })
          await writeFile(join(staging, logRef), yaml(log))
        },
        validate: async (staging) => {
          const staged = await validateKnowledgeBaseV04State(staging)
          if (staged.status === 'failed') throw new Error(staged.errors.map((error) => error.message).join('; '))
        },
      })
      await registry.refresh(root)
      return { ...base, status: hasCommittedChanges ? 'committed' : 'no_changes', committedRevision: nextRevision, createdIds: created, updatedIds: updated }
    })
  } catch (error) {
    return { ...base, status: 'failed', error: { code: 'commit_failed', message: error instanceof Error ? error.message : String(error) } }
  }
}
