import assert from 'node:assert/strict'
import { test } from 'node:test'
import { archiveRaw } from '../../../knowledge/raw/raw-archive.ts'
import { hashKillCriterionDefinitionV04 } from '../../../knowledge/schema/kill-criterion-v04.ts'
import { getMetricDefinitionV04 } from '../../../knowledge/schema/metric-registry.ts'
import type { KillCriterionV04, KnowledgeAssetV04 } from '../../../knowledge/schema/domain-v04.ts'
import type { KnowledgeAssetCollectionV04, LoadedAssetV04 } from '../../../knowledge/storage/v04-types.ts'
import { KnowledgeBaseRegistry } from '../../../knowledge/registry/registry.ts'
import { createKnowledgeBase, removeKnowledgeBase } from '../../knowledge/helpers.ts'
import { evaluateThesisKillCriterion, type KillCriterionEvidenceBindingV1, type ThesisKillCriterionEvaluatorInput } from '../../../workflows/thesis-lifecycle/kill-criterion-evaluator.ts'
import type { DocumentInputResolver } from '../../../plugins/document/input-resolver.ts'

const AS_OF = '2026-09-01T00:00:00.000Z'
const PUBLISHED = '2026-05-01T00:00:00.000Z'
const asLoaded = (value: KnowledgeAssetV04, kind: LoadedAssetV04['kind']): LoadedAssetV04 => ({ value, kind, filePath: `${value.id}.json`, storageRef: `${kind}/${value.id}.json` })
const quote = (value: number, metric = 'gross_margin', unit = 'ratio', period = '2026-Q1'): string => `${metric} ${value} ${unit} ${period}`
const locator = (value: number, exactQuote = quote(value)): string => `quote:${Buffer.from(exactQuote, 'utf8').toString('base64url')}`

async function fixture(options: { value?: number; unit?: string; period?: string; criterionUnit?: string; criterionPeriod?: string; metricRef?: string; rawQuote?: string; rawBytesText?: string; deadline?: string; mediaType?: string; sourcePublishedAt?: string; rights?: boolean; includeCriterion?: boolean; type?: string } = {}) {
  const root = await createKnowledgeBase({ schemaVersion: '0.4', knowledgeBaseId: 'kb-kill-criterion-evaluator' })
  const handle = await new KnowledgeBaseRegistry().mount(root)
  const value = options.value ?? 0.42
  const metricRef = options.metricRef ?? 'gross_margin'
  const unit = options.unit ?? 'ratio'
  const period = options.period ?? '2026-Q1'
  const exactQuote = options.rawQuote ?? quote(value, getMetricDefinitionV04(metricRef)?.label ?? metricRef, unit, period)
  const exactLocator = locator(value, exactQuote)
  const raw = await archiveRaw(handle, { bytes: Buffer.from(options.rawBytesText ?? exactQuote, 'utf8'), originalFilename: options.mediaType === 'application/pdf' ? 'evidence.pdf' : 'evidence.txt', mediaType: options.mediaType ?? 'text/plain' }, { clock: () => PUBLISHED })
  const origin = { kind: 'human_rule' as const }
  const definition = { metricRef, operator: 'gte' as const, threshold: 0.4, unit: options.criterionUnit ?? 'ratio', period: options.criterionPeriod ?? '2026-Q1', ...(options.deadline === undefined ? {} : { deadline: options.deadline }) }
  const criterion: KillCriterionV04 = {
    conditionId: 'margin-floor', revision: 1, state: 'active', type: options.type ?? 'numeric_threshold', definitionVersion: 1,
    definition: options.type && options.type !== 'numeric_threshold' ? { signal: 'future' } : definition,
    targetClaimRefs: ['claim:proposition'], effectiveAt: '2026-04-01T00:00:00.000Z',
    definitionHash: hashKillCriterionDefinitionV04({ type: options.type ?? 'numeric_threshold', definitionVersion: 1, definition: options.type && options.type !== 'numeric_threshold' ? { signal: 'future' } : definition, targetClaimRefs: ['claim:proposition'], origin }),
    authority: { workflowRunId: 'criterion-confirm', confirmedAt: '2026-03-01T00:00:00.000Z', origin },
  }
  const thesis = { id: 'thesis:case', subjectRefs: ['entity:issuer'], title: 'Margin thesis', statement: 'Issuer grows margins', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', lifecycle: { status: 'active' }, ...(options.includeCriterion === false ? {} : { killCriteria: [criterion] }) } as unknown as KnowledgeAssetV04
  const entity = { id: 'entity:issuer', type: 'company', name: 'Issuer', aliases: [], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const claim = { id: 'claim:proposition', claimType: 'viewpoint', statement: 'Margins expand', subjectRefs: ['entity:issuer'], sourceRefs: ['source:publisher'], provenance: [{ sourceRef: 'source:publisher', rawRef: raw.manifest.rawRef, locator: exactLocator, chunkRef: null }], lifecycle: { status: 'active' }, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as KnowledgeAssetV04
  const source = {
    id: 'source:publisher', title: 'Official disclosure', sourceType: 'official_disclosure', provider: 'regulator', publishedAt: options.sourcePublishedAt ?? PUBLISHED,
    rawRefs: [raw.manifest.rawRef], acquisition: { method: 'official' },
    rights: { accessScope: 'public', providerTermsKnown: true, retentionAllowed: options.rights === false ? false : true, aiProcessingAllowed: true, derivativeKnowledgeAllowed: true },
    usagePolicy: { mode: 'personal_noncommercial_research', retainRaw: true, allowAiProcessing: true, allowDerivedKnowledge: true, redistributionAllowed: false }, lifecycle: { status: 'active' },
  } as unknown as KnowledgeAssetV04
  const observation = { id: 'observation:margin', observationType: 'metric', subjectRef: 'entity:issuer', metricRef, value, unit, period, sourceRef: 'source:publisher', provenance: [{ sourceRef: 'source:publisher', rawRef: raw.manifest.rawRef, locator: exactLocator }], lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const membership = { id: 'reasoning-edge:qualifies', type: 'qualifies', sourceRef: 'claim:proposition', targetRef: 'thesis:case', lifecycle: { status: 'active' } } as unknown as KnowledgeAssetV04
  const values: Array<[KnowledgeAssetV04, LoadedAssetV04['kind']]> = [[thesis, 'thesis'], [entity, 'entity'], [claim, 'claim'], [source, 'source'], [observation, 'observation'], [membership, 'reasoning_edge']]
  const assets: KnowledgeAssetCollectionV04 = { rootDir: root, objects: values.map(([asset, kind]) => asLoaded(asset, kind)), registry: [] }
  const binding: KillCriterionEvidenceBindingV1 = { evidenceRef: observation.id, targetClaimRefs: ['claim:proposition'], sourceRef: source.id, rawRef: raw.manifest.rawRef, locator: exactLocator }
  const input: ThesisKillCriterionEvaluatorInput = { assets, handle, thesisRef: 'thesis:case', conditionId: 'margin-floor', asOf: AS_OF, evidenceBindings: [binding] }
  return { root, assets, input, rawRef: raw.manifest.rawRef, binding, source, observation }
}

test('numeric threshold evaluator proves original publisher value and returns review identity', async () => {
  const f = await fixture()
  try {
    const result = await evaluateThesisKillCriterion(f.input)
    assert.equal(result.status, 'met')
    assert.deepEqual([result.conditionId, result.revision, result.definitionHash], ['margin-floor', 1, (f.assets.objects[0]!.value as { killCriteria: KillCriterionV04[] }).killCriteria[0]!.definitionHash])
    assert.deepEqual(result.evaluatedValue && [result.evaluatedValue.value, result.evaluatedValue.sourceRef, result.evaluatedValue.rawRef, result.evaluatedValue.locator, result.evaluatedValue.numericValueVersionVerified], [0.42, 'source:publisher', f.rawRef, locator(0.42), true])
  } finally { await removeKnowledgeBase(f.root) }
})

test('one verified numeric value below threshold returns not_met', async () => {
  const f = await fixture({ value: 0.32 })
  try { assert.equal((await evaluateThesisKillCriterion(f.input)).status, 'not_met') }
  finally { await removeKnowledgeBase(f.root) }
})

test('quote must contain exactly one numeric value after metric, unit, and period spans are removed', async () => {
  const ambiguous = await fixture({ rawQuote: 'gross_margin 0.42 or 0.31 ratio 2026-Q1' })
  const registeredLabel = await fixture({ metricRef: 'metric:revenue', unit: 'CNY', period: 'FY2026', criterionUnit: 'CNY', criterionPeriod: 'FY2026', rawQuote: 'Revenue 0.42 CNY FY2026' })
  try {
    const rejected = await evaluateThesisKillCriterion(ambiguous.input)
    const accepted = await evaluateThesisKillCriterion(registeredLabel.input)
    assert.equal(rejected.status, 'insufficient_evidence')
    assert.ok(rejected.diagnostics.includes('KILL_CRITERION_NUMERIC_VALUE_VERSION_UNVERIFIED'))
    assert.equal(accepted.status, 'met')
  } finally { await removeKnowledgeBase(ambiguous.root); await removeKnowledgeBase(registeredLabel.root) }
})

test('Chinese metric, unit, and period literals match inside original prose, while duplicate tokens and embedded Latin tokens fail', async () => {
  const chinese = await fixture({
    metricRef: '毛利率', unit: '比例', period: '2026年第一季度', criterionUnit: '比例', criterionPeriod: '2026年第一季度',
    rawQuote: '公司披露，2026年第一季度毛利率达到0.42比例。',
  })
  const duplicateChinese = await fixture({
    metricRef: '毛利率', unit: '比例', period: '2026年第一季度', criterionUnit: '比例', criterionPeriod: '2026年第一季度',
    rawQuote: '公司披露，2026年第一季度毛利率达到0.42比例，毛利率维持稳定。',
  })
  const embeddedLatin = await fixture({
    metricRef: 'metric:revenue', unit: 'CNY', period: 'FY2026', criterionUnit: 'CNY', criterionPeriod: 'FY2026',
    rawQuote: 'xRevenue reached 0.42 CNY FY2026',
  })
  const overlappingFields = await fixture({
    metricRef: '比例', unit: '比例', period: '2026年第一季度', criterionUnit: '比例', criterionPeriod: '2026年第一季度',
    rawQuote: '公司披露，2026年第一季度比例为0.42。',
  })
  try {
    assert.equal((await evaluateThesisKillCriterion(chinese.input)).status, 'met')
    const duplicate = await evaluateThesisKillCriterion(duplicateChinese.input)
    assert.equal(duplicate.status, 'insufficient_evidence')
    assert.ok(duplicate.diagnostics.includes('KILL_CRITERION_NUMERIC_VALUE_VERSION_UNVERIFIED'))
    assert.equal((await evaluateThesisKillCriterion(embeddedLatin.input)).status, 'insufficient_evidence')
    assert.equal((await evaluateThesisKillCriterion(overlappingFields.input)).status, 'insufficient_evidence')
  } finally {
    await removeKnowledgeBase(chinese.root)
    await removeKnowledgeBase(duplicateChinese.root)
    await removeKnowledgeBase(embeddedLatin.root)
    await removeKnowledgeBase(overlappingFields.root)
  }
})

test('deadline definitions stay insufficient until their evaluation semantics are defined', async () => {
  const f = await fixture({ deadline: '2026-12-31T23:59:59.000Z' })
  try {
    const result = await evaluateThesisKillCriterion(f.input)
    assert.equal(result.status, 'insufficient_evidence')
    assert.ok(result.diagnostics.includes('KILL_CRITERION_DEADLINE_UNSUPPORTED'))
  } finally { await removeKnowledgeBase(f.root) }
})

test('historical Thesis without criteria and unknown future criterion types fail closed', async () => {
  const historical = await fixture({ includeCriterion: false })
  const future = await fixture({ type: 'future_event' })
  const missingEvidence = await fixture()
  try {
    const missing = await evaluateThesisKillCriterion(historical.input)
    const unknown = await evaluateThesisKillCriterion(future.input)
    const noEvidence = await evaluateThesisKillCriterion({ ...missingEvidence.input, evidenceBindings: [] })
    assert.equal(missing.status, 'insufficient_evidence')
    assert.ok(missing.diagnostics.includes('KILL_CRITERION_MISSING'))
    assert.equal(unknown.status, 'insufficient_evidence')
    assert.ok(unknown.diagnostics.includes('KILL_CRITERION_TYPE_OR_DEFINITION_UNSUPPORTED'))
    assert.equal(noEvidence.status, 'insufficient_evidence')
    assert.ok(noEvidence.diagnostics.includes('KILL_CRITERION_EVIDENCE_MISSING'))
  } finally { await removeKnowledgeBase(historical.root); await removeKnowledgeBase(future.root); await removeKnowledgeBase(missingEvidence.root) }
})

test('unverifiable locators, unsupported Raw formats, rights failures, and future publication are insufficient', async () => {
  const badLocator = await fixture()
  const pdf = await fixture({ mediaType: 'application/pdf' })
  const restricted = await fixture({ rights: false })
  const future = await fixture({ sourcePublishedAt: '2027-01-01T00:00:00.000Z' })
  try {
    const invalid = { ...badLocator.input, evidenceBindings: [{ ...badLocator.binding, locator: 'page 2' }] }
    const pdfUnavailable = { ...pdf.input, documentResolver: { resolve: async () => { throw new Error('PDF parser unavailable') } } as unknown as Pick<DocumentInputResolver, 'resolve'> }
    assert.equal((await evaluateThesisKillCriterion(invalid)).status, 'insufficient_evidence')
    assert.equal((await evaluateThesisKillCriterion(pdfUnavailable)).status, 'insufficient_evidence')
    assert.equal((await evaluateThesisKillCriterion(restricted.input)).status, 'insufficient_evidence')
    assert.equal((await evaluateThesisKillCriterion(future.input)).status, 'insufficient_evidence')
  } finally { await removeKnowledgeBase(badLocator.root); await removeKnowledgeBase(pdf.root); await removeKnowledgeBase(restricted.root); await removeKnowledgeBase(future.root) }
})

test('PDF evidence is parsed from verified archived bytes and exact extracted text can prove the quote', async () => {
  const f = await fixture({ mediaType: 'application/pdf', rawBytesText: '%PDF-original-bytes' })
  let parsedBytes: Uint8Array | undefined
  try {
    const documentResolver = {
      resolve: async (input: { type: string; bytes?: Uint8Array; mediaType?: string }) => {
        assert.equal(input.type, 'bytes')
        assert.equal(input.mediaType, 'application/pdf')
        parsedBytes = input.bytes
        return { document: { normalizedText: quote(0.42) } }
      },
    } as unknown as Pick<DocumentInputResolver, 'resolve'>
    const result = await evaluateThesisKillCriterion({ ...f.input, documentResolver })
    assert.equal(result.status, 'met')
    assert.equal(Buffer.from(parsedBytes!).toString('utf8'), '%PDF-original-bytes')
  } finally { await removeKnowledgeBase(f.root) }
})

test('PDF parser errors and extracted quote mismatches fail closed', async () => {
  const f = await fixture({ mediaType: 'application/pdf', rawBytesText: '%PDF-original-bytes' })
  try {
    const mismatchResolver = { resolve: async () => ({ document: { normalizedText: 'gross_margin 0.41 ratio 2026-Q1' } }) } as unknown as Pick<DocumentInputResolver, 'resolve'>
    const errorResolver = { resolve: async () => { throw new Error('PDF extraction unavailable') } } as unknown as Pick<DocumentInputResolver, 'resolve'>
    const mismatch = await evaluateThesisKillCriterion({ ...f.input, documentResolver: mismatchResolver })
    const errored = await evaluateThesisKillCriterion({ ...f.input, documentResolver: errorResolver })
    assert.equal(mismatch.status, 'insufficient_evidence')
    assert.ok(mismatch.diagnostics.includes('KILL_CRITERION_NUMERIC_VALUE_VERSION_UNVERIFIED'))
    assert.equal(errored.status, 'insufficient_evidence')
    assert.ok(errored.diagnostics.includes('KILL_CRITERION_RAW_FORMAT_INTEGRITY_OR_EXTRACTION_UNSUPPORTED'))
  } finally { await removeKnowledgeBase(f.root) }
})

test('exact unit and period are required', async () => {
  const unit = await fixture({ unit: 'percent' })
  const period = await fixture({ period: '2025-Q4' })
  try {
    const unitResult = await evaluateThesisKillCriterion(unit.input)
    const periodResult = await evaluateThesisKillCriterion(period.input)
    assert.equal(unitResult.status, 'insufficient_evidence')
    assert.ok(unitResult.diagnostics.includes('KILL_CRITERION_EVIDENCE_UNIT_MISMATCH'))
    assert.equal(periodResult.status, 'insufficient_evidence')
    assert.ok(periodResult.diagnostics.includes('KILL_CRITERION_EVIDENCE_MISSING_OR_MISMATCHED'))
  } finally { await removeKnowledgeBase(unit.root); await removeKnowledgeBase(period.root) }
})

test('conflicting verified values are not averaged or selected by input order', async () => {
  const f = await fixture()
  try {
    const raw2 = await archiveRaw((await new KnowledgeBaseRegistry().mount(f.root)), { bytes: Buffer.from(quote(0.31), 'utf8'), originalFilename: 'evidence-2.txt', mediaType: 'text/plain' }, { clock: () => '2026-06-01T00:00:00.000Z' })
    const source = { ...(f.source as unknown as Record<string, unknown>), rawRefs: [f.rawRef, raw2.manifest.rawRef] } as unknown as KnowledgeAssetV04
    const observation = { ...(f.observation as unknown as Record<string, unknown>), id: 'observation:margin-later', value: 0.31, provenance: [{ sourceRef: 'source:publisher', rawRef: raw2.manifest.rawRef, locator: locator(0.31) }] } as unknown as KnowledgeAssetV04
    const assets: KnowledgeAssetCollectionV04 = { ...f.assets, objects: [...f.assets.objects.map((item) => item.value.id === source.id ? asLoaded(source, 'source') : item), asLoaded(observation, 'observation')] }
    const evidenceBindings = [f.binding, { evidenceRef: observation.id, targetClaimRefs: ['claim:proposition'], sourceRef: 'source:publisher', rawRef: raw2.manifest.rawRef, locator: locator(0.31) }]
    const decision = await evaluateThesisKillCriterion({ ...f.input, assets, evidenceBindings })
    assert.equal(decision.status, 'insufficient_evidence')
    assert.ok(decision.diagnostics.includes('KILL_CRITERION_EVIDENCE_VALUES_CONFLICT'))
  } finally { await removeKnowledgeBase(f.root) }
})
