import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { buildCodexCliInvocationArgs, buildCodexCliProcessInvocation, classifyCodexFailure, CODEX_CLI_LUNA_CONFIG, CodexCliReasoningExecutor, normalizeCodexOutputSchema, parseCodexCliJsonlFinalResponse, resolveCodexCliExecutable } from '../../../plugins/reasoning/codex-cli/executor.ts'
import { PiReasoningExecutor } from '../../../plugins/reasoning/pi/executor.ts'
import { buildCurationSchemaContext } from '../../../skills/knowledge-curation/model/schema-context.ts'
import { buildExtractKnowledgeOutputContract, buildResolveSemanticCaseOutputContract, buildUnderstandAndPlanOutputContract } from '../../../skills/knowledge-curation/model/output-contracts.ts'

const capabilities = { maxContextTokens: 4_000, maxOutputTokens: 1_000, structuredOutputSupport: true, maxConcurrency: 1 }
const fixture = join(process.cwd(), 'tests/plugins/reasoning/fixtures/fake-reasoning-host.mjs')

async function runFakeCodexCompletion(input: { readonly output: unknown; readonly operation?: string; readonly outputContract: unknown }): Promise<{ readonly result: string; readonly prompt: string; readonly schema: Record<string, any> }> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-structured-transport-'))
  try {
    const hostPath = join(root, 'fake-codex.mjs')
    const promptPath = join(root, 'captured-prompt.json')
    const schemaPath = join(root, 'captured-schema.json')
    const source = [
      "import { readFileSync, writeFileSync } from 'node:fs'",
      "let input = ''; for await (const chunk of process.stdin) input += chunk",
      `writeFileSync(${JSON.stringify(promptPath)}, input, 'utf8')`,
      "const flag = process.argv.indexOf('--output-schema')",
      `writeFileSync(${JSON.stringify(schemaPath)}, readFileSync(process.argv[flag + 1]))`,
      "const outputFlag = process.argv.indexOf('-o')",
      `writeFileSync(process.argv[outputFlag + 1], ${JSON.stringify(JSON.stringify(input.output))}, 'utf8')`,
    ].join('\n')
    await writeFile(hostPath, source, 'utf8')
    const adapter = new CodexCliReasoningExecutor({ capabilities, executable: process.execPath, tempRoot: root, commandPrefix: [hostPath] })
    const result = await adapter.complete(undefined, { systemPrompt: 'Synthetic contract test.', messages: [] }, { signal: new AbortController().signal, maxTokens: 1_000, metadata: { operation: input.operation ?? 'extractKnowledge' }, operationId: 'synthetic-contract-test', outputContract: input.outputContract })
    return { result, prompt: await readFile(promptPath, 'utf8'), schema: JSON.parse(await readFile(schemaPath, 'utf8')) as Record<string, any> }
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('Codex resolver honors explicit paths before environment, PATH, and AppData', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-resolver-'))
  try {
    const explicit = join(root, 'explicit.exe'); const env = join(root, 'env.exe'); const pathCandidate = join(root, 'path', 'codex.exe'); const app = join(root, 'app', 'npm', 'codex.cmd')
    await mkdir(join(root, 'path'), { recursive: true }); await mkdir(join(root, 'app', 'npm'), { recursive: true }); await writeFile(explicit, ''); await writeFile(env, ''); await writeFile(pathCandidate, ''); await writeFile(app, '')
    const resolution = resolveCodexCliExecutable({ executable: explicit, platform: 'win32', env: { CODEX_EXECUTABLE: env, PATH: join(root, 'path'), APPDATA: join(root, 'app'), PATHEXT: '.EXE;.CMD' } })
    assert.deepEqual(resolution, { executable: explicit, source: 'explicit', kind: 'native' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex resolver honors CODEX_EXECUTABLE and deterministic Windows PATH extensions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-resolver-'))
  try {
    const environment = join(root, 'codex.cmd'); const pathDir = join(root, 'path'); const pathCandidate = join(pathDir, 'codex.exe')
    await mkdir(pathDir, { recursive: true }); await writeFile(environment, ''); await writeFile(pathCandidate, '')
    assert.equal(resolveCodexCliExecutable({ platform: 'win32', env: { CODEX_EXECUTABLE: environment, PATH: pathDir }, }).source, 'environment')
    assert.deepEqual(resolveCodexCliExecutable({ platform: 'win32', env: { PATH: pathDir, PATHEXT: '.EXE;.CMD' } }), { executable: pathCandidate, source: 'path', kind: 'native' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex resolver reaches bounded AppData fallback when PATH is absent or empty', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-resolver-'))
  try {
    const app = join(root, 'appdata'); const shim = join(app, 'npm', 'codex.cmd'); await mkdir(join(app, 'npm'), { recursive: true }); await writeFile(shim, '')
    assert.equal(resolveCodexCliExecutable({ platform: 'win32', env: { PATH: '', APPDATA: app } }).executable, shim)
    const profile = join(root, 'profile'); const profileShim = join(profile, 'AppData', 'Roaming', 'npm', 'codex.cmd'); await mkdir(join(profile, 'AppData', 'Roaming', 'npm'), { recursive: true }); await writeFile(profileShim, '')
    assert.equal(resolveCodexCliExecutable({ platform: 'win32', env: { USERPROFILE: profile } }).executable, profileShim)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex resolver prefers PATH over bounded standalone Windows candidates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-resolver-'))
  try {
    const pathCandidate = join(root, 'path', 'codex.exe')
    const standalone = join(root, 'local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')
    const managed = join(root, 'profile', '.codex', 'packages', 'standalone', 'current', 'bin', 'codex.exe')
    await mkdir(join(root, 'path'), { recursive: true }); await mkdir(join(root, 'local', 'Programs', 'OpenAI', 'Codex', 'bin'), { recursive: true }); await mkdir(join(root, 'profile', '.codex', 'packages', 'standalone', 'current', 'bin'), { recursive: true })
    await writeFile(pathCandidate, ''); await writeFile(standalone, ''); await writeFile(managed, '')
    assert.deepEqual(resolveCodexCliExecutable({ platform: 'win32', env: { PATH: join(root, 'path'), LOCALAPPDATA: join(root, 'local'), USERPROFILE: join(root, 'profile') } }), { executable: pathCandidate, source: 'path', kind: 'native' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex resolver discovers the official Windows standalone layout without PATH or AppData', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-resolver-'))
  try {
    const standalone = join(root, 'local', 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')
    await mkdir(join(root, 'local', 'Programs', 'OpenAI', 'Codex', 'bin'), { recursive: true }); await writeFile(standalone, '')
    assert.deepEqual(resolveCodexCliExecutable({ platform: 'win32', env: { PATH: '', LOCALAPPDATA: join(root, 'local') } }), { executable: standalone, source: 'standalone', kind: 'native' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex resolver discovers the fixed managed current package when public standalone is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-resolver-'))
  try {
    const managed = join(root, 'profile', '.codex', 'packages', 'standalone', 'current', 'bin', 'codex.exe')
    await mkdir(join(root, 'profile', '.codex', 'packages', 'standalone', 'current', 'bin'), { recursive: true }); await writeFile(managed, '')
    assert.deepEqual(resolveCodexCliExecutable({ platform: 'win32', env: { PATH: '', LOCALAPPDATA: join(root, 'local'), USERPROFILE: join(root, 'profile') } }), { executable: managed, source: 'standalone', kind: 'native' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex resolver accepts only the exact bounded local runtime path after public standalone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-resolver-'))
  try {
    const localRuntime = join(root, 'local', 'OpenAI', 'Codex', 'bin', 'codex.exe')
    await mkdir(join(root, 'local', 'OpenAI', 'Codex', 'bin'), { recursive: true }); await writeFile(localRuntime, '')
    assert.deepEqual(resolveCodexCliExecutable({ platform: 'win32', env: { PATH: '', LOCALAPPDATA: join(root, 'local') } }), { executable: localRuntime, source: 'localappdata', kind: 'native' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex resolver fails closed when every authorized candidate is missing', () => {
  assert.throws(() => resolveCodexCliExecutable({ platform: 'win32', env: { PATH: '', APPDATA: 'missing-app', LOCALAPPDATA: 'missing-local', USERPROFILE: 'missing-profile' } }), (error: unknown) => error instanceof Error && (error as any).code === 'reasoning_host_unavailable')
})

test('Windows command-shim invocation quotes spaced paths and keeps prompt off the command line', () => {
  const args = ['exec', '--model', 'gpt-5.6-luna', '-o', 'C:\\work dir\\out.json', '-']
  const invocation = buildCodexCliProcessInvocation('C:\\Program Files\\Codex\\codex.cmd', args, 'win32')
  assert.equal(invocation.executable, 'cmd.exe'); assert.equal(invocation.shell, false)
  assert.deepEqual(invocation.args.slice(0, 2), ['/d', '/s']); assert.match(invocation.args[3], /"C:\\Program Files\\Codex\\codex\.cmd"/u)
  assert.match(invocation.args[3], /gpt-5\.6-luna/u); assert.equal(invocation.args[3].includes('user prompt'), false)
})

test('Codex CLI Luna configuration is immutable and builds the safe documented invocation', () => {
  assert.deepEqual(CODEX_CLI_LUNA_CONFIG, { backend: 'codex-cli', model: 'gpt-5.6-luna', reasoningEffort: 'medium' })
  const args = buildCodexCliInvocationArgs({ commandPrefix: ['exec'], ...CODEX_CLI_LUNA_CONFIG, invocationDirectory: 'temp', outputPath: 'temp/final-output.txt', schemaPath: 'temp/output-schema.json' })
  assert.deepEqual(args.slice(0, 18), ['exec', '--model', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="medium"', '--ephemeral', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', 'temp', '--output-schema', 'temp/output-schema.json', '--json', '-o', 'temp/final-output.txt', '-'])
  assert.equal(args.filter((arg) => arg === '--output-schema').length, 1)
  assert.equal(args.includes(JSON.stringify({ type: 'object' })), false)
  assert.equal(args.includes('--dangerously-bypass-approvals-and-sandbox'), false)
  assert.equal(args.includes('semantic prompt'), false)
})

test('Codex schema normalizer preserves Design structure and strips ResearchHub metadata and provider-unsupported constraints', async () => {
  const { INDUSTRY_RESEARCH_DESIGN_CONTRACT, INDUSTRY_MODULES } = await import('../../../skills/industry-research/contracts.ts')
  const normalized = normalizeCodexOutputSchema(INDUSTRY_RESEARCH_DESIGN_CONTRACT)
  assert.equal(normalized.schema.type, 'object')
  assert.deepEqual((normalized.schema.properties as Record<string, any>).targetKind.enum, ['industry', 'theme', 'product', 'technology', 'uncertain'])
  assert.deepEqual((normalized.schema as any).required, ['definitionHypothesis', 'targetKind', 'scope', 'moduleQuestions', 'keyMetrics', 'evidenceRequirements', 'searchTerms', 'knownGaps', 'verificationCandidates'])
  assert.deepEqual(Object.keys((normalized.schema.properties as any).moduleQuestions.properties), [...INDUSTRY_MODULES])
  assert.deepEqual((normalized.schema.properties as any).scope.required, ['included', 'excluded'])
  assert.deepEqual((normalized.schema.properties as any).verificationCandidates.items.required, ['name', 'kind', 'reason'])
  assert.deepEqual([...normalized.removedKeywords].sort(), ['bounds', 'maxItems', 'maxLength', 'minItems', 'minLength', 'name', 'pattern', 'uniqueItems'])
  assert.equal(JSON.stringify(normalized.schema).includes('proposalRules'), false)
})

test('Codex schema normalizer preserves the Schema 0.4 Industry structured value contract', async () => {
  const { createIndustryModuleResultContract } = await import('../../../skills/industry-research/contracts.ts')
  const source = createIndustryModuleResultContract('risk_analysis', ['e1'])
  const normalized = normalizeCodexOutputSchema(source)
  const structured = (normalized.schema.properties as any).proposals.items.anyOf[2].properties.structuredValue
  assert.equal(structured.additionalProperties, false)
  assert.deepEqual(Object.keys(structured.properties).sort(), ['comparator', 'fiscalPeriod', 'metric', 'period', 'semanticKey', 'unit', 'value'])
  assert.deepEqual(structured.properties.comparator.enum, ['eq', 'gt', 'gte', 'lt', 'lte', 'approx'])
})

test('Codex normalizer unwraps the strict Knowledge Curation contracts and rejects malformed wrappers', () => {
  const contracts = [
    buildUnderstandAndPlanOutputContract(buildCurationSchemaContext('understand_and_plan')),
    buildExtractKnowledgeOutputContract(buildCurationSchemaContext('knowledge_extraction')),
    buildResolveSemanticCaseOutputContract({ caseKind: 'entity_identity', allowedOutcomes: ['bind_existing', 'create_new', 'review'], existingAliases: ['Entity A'] }),
  ]
  for (const contract of contracts) {
    const normalized = normalizeCodexOutputSchema(contract)
    assert.equal(normalized.schema.type, 'object')
    assert.equal(normalized.schema.additionalProperties, false)
    assert.equal(JSON.stringify(normalized.schema).includes('"format":"json"'), false)
  }
  const schema = { type: 'object', additionalProperties: false, properties: { ok: { type: 'string' } } }
  const wrapper = { format: 'json', root: 'object', additionalProperties: false, schema }
  assert.throws(() => normalizeCodexOutputSchema({ ...wrapper, proposalRules: {} }), /wrapper must contain only/)
  assert.throws(() => normalizeCodexOutputSchema({ ...wrapper, root: 'array' }), /must declare JSON object output/)
  assert.throws(() => normalizeCodexOutputSchema({ ...wrapper, additionalProperties: true }), /must declare JSON object output/)
  assert.throws(() => normalizeCodexOutputSchema({ format: 'json', root: 'object', additionalProperties: false }), /wrapper must contain only/)
  assert.throws(() => normalizeCodexOutputSchema({ ...wrapper, schema: { type: 'object', properties: {} } }), /must preserve its declared object root constraints/)
})

test('Codex curation wrapper lowers only finite primitive type unions and preserves sibling constraints', () => {
  const schema = {
    type: 'object', additionalProperties: false,
    properties: {
      nullable: { type: ['string', 'null'], description: 'Optional text.' },
      scalar: { type: ['string', 'number', 'boolean', 'null'], description: 'Supported scalar value.' },
    },
  }
  const wrapped = { format: 'json', root: 'object', additionalProperties: false, schema }
  const normalized = normalizeCodexOutputSchema(wrapped).schema as any
  assert.deepEqual(normalized.properties.nullable, { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Optional text.' })
  assert.deepEqual(normalized.properties.scalar, { anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' }], description: 'Supported scalar value.' })
  assert.deepEqual(schema.properties.nullable.type, ['string', 'null'])
  const causeIncludes = (text: string) => (error: unknown): boolean => error instanceof Error && 'cause' in error && (error as { cause?: unknown }).cause instanceof Error && ((error as { cause: Error }).cause.message.includes(text))
  for (const type of [[], ['string', 'string'], ['object', 'null']]) {
    assert.throws(() => normalizeCodexOutputSchema({ ...wrapped, schema: { ...schema, properties: { value: { type } } } }), causeIncludes('unsupported type union'))
  }
  assert.throws(() => normalizeCodexOutputSchema({ ...wrapped, schema: { ...schema, properties: { value: { type: ['string', 'null'], anyOf: [{ type: 'string' }] } } } }), causeIncludes('unsupported combination'))
  assert.throws(() => normalizeCodexOutputSchema({ type: ['string', 'null'] }), causeIncludes('unsupported type union'))
})

test('Codex extraction transport round-trips open Knowledge Curation objects before Skill validation', async () => {
  const outputContract = buildExtractKnowledgeOutputContract(buildCurationSchemaContext('knowledge_extraction'))
  const encoded = {
    entities: [{ candidateId: 'synthetic-entity', semanticFields: '{"ticker":"T001","exchange":"SSE","attributes":{"layer":2}}' }],
    relations: [{ candidateId: 'synthetic-relation', attributes: '{"importance":"material","rank":3}' }],
    claims: [],
  }
  const result = await runFakeCodexCompletion({ output: encoded, outputContract })
  const decoded = JSON.parse(result.result)
  assert.deepEqual(decoded.entities[0].semanticFields, { ticker: 'T001', exchange: 'SSE', attributes: { layer: 2 } })
  assert.deepEqual(decoded.relations[0].attributes, { importance: 'material', rank: 3 })
  assert.equal(result.schema.properties.entities.items.properties.semanticFields.type, 'string')
  assert.equal(result.schema.properties.relations.items.properties.attributes.type, 'string')
  const claimProperties = result.schema.properties.claims.items.properties
  assert.ok(Array.isArray(claimProperties.temporal.anyOf), 'temporal nullable oneOf is lowered only in the extraction transport schema')
  assert.ok(Array.isArray(claimProperties.structuredValue.anyOf), 'structuredValue nullable oneOf is lowered only in the extraction transport schema')
  const structuredValueObject = claimProperties.structuredValue.anyOf.find((branch: any) => branch.type === 'object')
  assert.ok(Array.isArray(structuredValueObject.properties.comparator.anyOf), 'comparator nullable oneOf is lowered only in the extraction transport schema')
  const original = normalizeCodexOutputSchema(outputContract).schema as any
  assert.ok(Array.isArray(original.properties.claims.items.properties.temporal.oneOf), 'direct normalizer keeps source oneOf unchanged')
  const prompt = JSON.parse(result.prompt)
  assert.match(prompt.systemPrompt, /complete JSON objects encoded as JSON strings/u)
  assert.equal(JSON.stringify(prompt).includes('Synthetic contract test.'), true)
})

test('Codex extraction transport rejects overlapping and unsupported nullable oneOf branches', async () => {
  const outputContract = buildExtractKnowledgeOutputContract(buildCurationSchemaContext('knowledge_extraction'))
  const malformed = structuredClone(outputContract) as any
  const claims = malformed.schema.properties.claims.items.properties
  claims.temporal.oneOf[0] = { type: ['object', 'null'] }
  await assert.rejects(
    () => runFakeCodexCompletion({ output: { entities: [], relations: [], claims: [] }, outputContract: malformed }),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'reasoning_configuration_invalid',
  )
  const unsupported = structuredClone(outputContract) as any
  unsupported.schema.properties.claims.items.properties.temporal.description = 'nullable wrapper metadata is unsupported'
  await assert.rejects(
    () => runFakeCodexCompletion({ output: { entities: [], relations: [], claims: [] }, outputContract: unsupported }),
    (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'reasoning_configuration_invalid',
  )
})

test('Codex extraction transport rejects malformed, non-object, and omitted bridge fields', async () => {
  const outputContract = buildExtractKnowledgeOutputContract(buildCurationSchemaContext('knowledge_extraction'))
  const base = { entities: [{ candidateId: 'synthetic-entity', semanticFields: '{}' }], relations: [{ candidateId: 'synthetic-relation', attributes: '{}' }], claims: [] }
  for (const output of [
    { ...base, entities: [{ ...base.entities[0], semanticFields: '{bad' }] },
    { ...base, entities: [{ ...base.entities[0], semanticFields: '[]' }] },
    { ...base, relations: [{ ...base.relations[0], attributes: 'null' }] },
    { ...base, entities: [{ candidateId: 'synthetic-entity' }] },
  ]) {
    await assert.rejects(() => runFakeCodexCompletion({ output, outputContract }), (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'reasoning_output_invalid')
  }
})

test('Codex schema normalizer supports dynamic enum, const and oneOf contracts and fails closed for unsafe inputs', () => {
  const normalized = normalizeCodexOutputSchema({ name: 'dynamic', type: 'object', required: ['kind'], additionalProperties: false, properties: { kind: { enum: ['a', 'b'] }, fixed: { const: 'x' }, value: { oneOf: [{ type: 'string' }, { type: 'number' }] } } })
  assert.deepEqual(normalized.schema.properties, { kind: { enum: ['a', 'b'] }, fixed: { const: 'x', type: 'string' }, value: { oneOf: [{ type: 'string' }, { type: 'number' }] } })
  assert.throws(() => normalizeCodexOutputSchema({ type: 'object', properties: { x: { type: 'string', unknownKeyword: true } } }), (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'reasoning_configuration_invalid')
  assert.throws(() => normalizeCodexOutputSchema({ type: 'object', properties: { x: undefined } }), (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'reasoning_configuration_invalid')
  assert.throws(() => normalizeCodexOutputSchema({}), /one JSON Schema object/)
  assert.throws(() => normalizeCodexOutputSchema({ type: 'string', enum: Array.from({ length: 100000 }, (_, i) => String(i)) }), /size limit/)
  assert.throws(() => normalizeCodexOutputSchema({ type: 'number', const: Number.NaN }), (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'reasoning_configuration_invalid')
  assert.throws(() => normalizeCodexOutputSchema({ type: 'object', properties: { x: new Date(0) } }), (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'reasoning_configuration_invalid')
})

test('Codex transport applies only the proven schema compatibility set', () => {
  const source = {
    type: 'object', additionalProperties: false,
    properties: {
      text: { const: 'x' }, bool: { const: true }, integer: { const: 2 }, decimal: { const: 2.5 }, nil: { const: null }, enumOnly: { enum: ['a', 'b'] },
      objectConst: { const: { x: 1 } }, arrayConst: { const: [1] }, unrelated: {},
      structuredValue: { type: 'object', properties: { value: {} }, anyOf: [{ required: ['value'] }, { required: ['value'] }] },
      choice: { oneOf: [
        { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'a' }, value: { type: 'string' } } },
        { type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: 'b' }, value: { type: 'number' } } },
      ] },
    },
  }
  const before = JSON.stringify(source)
  const normalized = normalizeCodexOutputSchema(source)
  const properties = normalized.schema.properties as any
  assert.deepEqual(properties.text, { const: 'x', type: 'string' })
  assert.deepEqual(properties.bool, { const: true, type: 'boolean' })
  assert.deepEqual(properties.integer, { const: 2, type: 'integer' })
  assert.deepEqual(properties.decimal, { const: 2.5, type: 'number' })
  assert.deepEqual(properties.nil, { const: null, type: 'null' })
  assert.deepEqual(properties.enumOnly, { enum: ['a', 'b'] })
  assert.deepEqual(properties.objectConst, { const: { x: 1 } })
  assert.deepEqual(properties.arrayConst, { const: [1] })
  assert.deepEqual(properties.unrelated, {})
  assert.deepEqual(properties.choice.anyOf.map((x: any) => x.properties.kind.const), ['a', 'b'])
  assert.equal(properties.choice.oneOf, undefined)
  assert.deepEqual(properties.structuredValue.properties.value, { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }] })
  assert.deepEqual(properties.structuredValue.anyOf, undefined)
  assert.equal(normalized.primitiveConstTypeCount, 7)
  assert.equal(normalized.guardedKindOneOfConversionCount, 1)
  assert.equal(normalized.redundantRequiredOnlyAnyOfRemovalCount, 1)
  assert.equal(normalized.structuredValueScalarNormalizationCount, 1)
  assert.equal(JSON.stringify(source), before)
})

test('Codex guarded oneOf conversion refuses unsafe or alternate discriminators', () => {
  const variant = (kind: string, extra: Record<string, unknown> = {}) => ({ type: 'object', additionalProperties: false, required: ['kind'], properties: { kind: { const: kind }, value: { type: 'string' } }, ...extra })
  for (const schema of [
    { oneOf: [variant('a'), variant('a')] },
    { oneOf: [variant('a'), { ...variant('b'), required: [] }] },
    { oneOf: [variant('a'), { type: 'string' }] },
    { oneOf: [{ ...variant('a'), additionalProperties: true }, variant('b')] },
    { oneOf: [{ type: 'object', additionalProperties: false, required: ['discriminator'], properties: { discriminator: { const: 'a' } } }, { type: 'object', additionalProperties: false, required: ['discriminator'], properties: { discriminator: { const: 'b' } } }] },
  ]) assert.equal((normalizeCodexOutputSchema(schema).schema as any).oneOf !== undefined, true)
})

test('Codex redundant required-only anyOf removal is conservative', () => {
  const make = (branch: any) => normalizeCodexOutputSchema({ type: 'object', properties: { value: { type: 'object', properties: { period: { type: 'string' }, fiscalPeriod: { type: 'string' } }, anyOf: [branch] } } }).schema as any
  assert.equal(make({ required: ['period'] }).properties.value.anyOf, undefined)
  assert.ok(make({ required: ['period'], description: 'semantic' }).properties.value.anyOf)
  assert.ok(make({ required: ['missing'] }).properties.value.anyOf)
  assert.ok((normalizeCodexOutputSchema({ type: 'object', properties: { structuredValue: { type: 'object', properties: { value: { anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'boolean' }] } } } } }).schema as any).properties.structuredValue.properties.value.anyOf)
})

test('Codex transport normalization makes every declared property required without mutating the source', () => {
  const source = { type: 'object', additionalProperties: false, properties: { status: { type: 'string', const: 'ok' }, note: { type: 'string' } }, required: ['status'] }
  const before = JSON.stringify(source)
  const normalized = normalizeCodexOutputSchema(source)
  assert.deepEqual(normalized.schema.required, ['status', 'note'])
  assert.equal(normalized.strengthenedObjectCount, 1)
  assert.deepEqual(normalized.strengthenedObjectPaths, ['$'])
  assert.equal(JSON.stringify(source), before)
  assert.deepEqual(source.required, ['status'])
})

test('Codex transport normalization recursively covers properties, items, maps, oneOf and anyOf', () => {
  const normalized = normalizeCodexOutputSchema({ type: 'object', properties: {
    nested: { type: 'object', properties: { value: { type: 'string' } } },
    list: { type: 'array', items: { type: 'object', properties: { item: { type: 'boolean' } } } },
    map: { type: 'object', additionalProperties: { type: 'object', properties: { mapped: { type: 'number' } } } },
    one: { oneOf: [{ type: 'object', properties: { branch: { type: 'null' } } }] },
    any: { anyOf: [{ type: 'object', properties: { alternative: { type: 'integer' } } }] },
  } })
  const schema = normalized.schema as any
  assert.deepEqual(schema.required, ['nested', 'list', 'map', 'one', 'any'])
  assert.deepEqual(schema.properties.nested.required, ['value'])
  assert.deepEqual(schema.properties.list.items.required, ['item'])
  assert.deepEqual(schema.properties.map.additionalProperties.required, ['mapped'])
  assert.deepEqual(schema.properties.one.oneOf[0].required, ['branch'])
  assert.deepEqual(schema.properties.any.anyOf[0].required, ['alternative'])
})

test('Codex transport normalization handles empty and propertyless schema nodes and rejects inconsistent required references', () => {
  const normalized = normalizeCodexOutputSchema({ type: 'object', properties: { empty: { type: 'object', properties: {} }, noProperties: { type: 'string' } } })
  assert.deepEqual((normalized.schema as any).required, ['empty', 'noProperties'])
  assert.deepEqual((normalized.schema as any).properties.empty.required, [])
  assert.equal(Object.prototype.hasOwnProperty.call((normalized.schema as any).properties.noProperties, 'required'), false)
  assert.throws(() => normalizeCodexOutputSchema({ type: 'object', properties: { present: { type: 'string' } }, required: ['missing'] }), (error: unknown) => error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'reasoning_configuration_invalid')
})

test('Codex transport normalization preserves supported schema semantics and accepted Design fingerprint', async () => {
  const { INDUSTRY_RESEARCH_DESIGN_CONTRACT, INDUSTRY_MODULE_RESULT_CONTRACT, INDUSTRY_SYNTHESIS_CONTRACT } = await import('../../../skills/industry-research/contracts.ts')
  const source = JSON.stringify(INDUSTRY_RESEARCH_DESIGN_CONTRACT)
  const normalized = normalizeCodexOutputSchema(INDUSTRY_RESEARCH_DESIGN_CONTRACT)
  assert.equal(createHash('sha256').update(source).digest('hex').slice(0, 16), 'b2d53042cd0f2b88')
  assert.equal(JSON.stringify(INDUSTRY_RESEARCH_DESIGN_CONTRACT), source)
  assert.equal(normalized.fingerprint, '2ff5ce2b631ceb26')
  assert.equal(normalized.bytes, 2243)
  assert.deepEqual((normalized.schema as any).properties.knownGaps.items.required, ['gapId', 'module', 'question', 'reason', 'actionable', 'searchTerms'])
  assert.equal((INDUSTRY_RESEARCH_DESIGN_CONTRACT as any).properties.knownGaps.items.properties.gapId.pattern, '^[A-Za-z][A-Za-z0-9._-]*$')
  assert.equal((INDUSTRY_RESEARCH_DESIGN_CONTRACT as any).properties.knownGaps.items.properties.gapId.maxLength, 120)
  for (const contract of [INDUSTRY_MODULE_RESULT_CONTRACT, INDUSTRY_SYNTHESIS_CONTRACT]) {
    const result = normalizeCodexOutputSchema(contract)
    const visit = (node: any): void => {
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        if (node.properties) assert.deepEqual(node.required, Object.keys(node.properties))
        for (const value of Object.values(node)) visit(value)
      } else if (Array.isArray(node)) for (const value of node) visit(value)
    }
    visit(result.schema)
  }
})

test('Codex normalization preserves the strict gap ID contract on module and synthesis surfaces', async () => {
  const { createIndustryModuleResultContract, createIndustrySynthesisContract } = await import('../../../skills/industry-research/contracts.ts')
  for (const contract of [createIndustryModuleResultContract('risk_analysis', []), createIndustrySynthesisContract([], [], [])]) {
    const rawGapId = (contract.properties.gaps.items.properties.gapId)
    assert.equal(rawGapId.pattern, '^[A-Za-z][A-Za-z0-9._-]*$')
    assert.equal(rawGapId.maxLength, 120)
    const { schema } = normalizeCodexOutputSchema(contract)
    const gapId = (schema as any).properties.gaps.items.properties.gapId
    assert.equal(gapId.pattern, undefined)
    assert.equal(gapId.maxLength, undefined)
    assert.equal((schema as any).properties.gaps.items.additionalProperties, false)
  }
})

test('Codex normalizes synthesis same-response local references without widening them to canonical IDs', async () => {
  const { createIndustrySynthesisContract } = await import('../../../skills/industry-research/contracts.ts')
  const { schema } = normalizeCodexOutputSchema(createIndustrySynthesisContract(['e1'], ['module-claim'], ['module-relation']))
  const material = (schema as any).properties.reportMaterial
  assert.match(material.properties.proposalIds.items.description, /Local ID only/u)
  assert.match(material.properties.relationProposalIds.items.description, /Local ID only/u)
  assert.equal(material.properties.proposalIds.items.enum, undefined)
  assert.equal(material.properties.relationProposalIds.items.enum, undefined)
  assert.equal(material.properties.proposalIds.items.type, 'string')
  assert.equal(material.properties.relationProposalIds.items.type, 'string')
  assert.equal(material.properties.proposalIds.items.enum, undefined)
})

test('Codex CLI JSONL parser keeps only the final assistant response', () => {
  const stdout = [
    JSON.stringify({ type: 'thread.started', thread_id: 'public-fixture' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'private trace' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '{"status":"ok"}' } }),
  ].join('\n')
  assert.equal(parseCodexCliJsonlFinalResponse(stdout), '{"status":"ok"}')
  assert.throws(() => parseCodexCliJsonlFinalResponse('{"type":"bad"}'), /final assistant response/)
  assert.throws(() => parseCodexCliJsonlFinalResponse('{bad'), /malformed JSONL/)
})

test('Codex failure classifier safely distinguishes synthetic stdout and stderr categories', () => {
  const cases = [
    [{ type: 'error', error: { code: 'invalid_schema' } }, '', 'structured_output_configuration'],
    [{ type: 'error', error: { code: 'invalid_json_schema' } }, '', 'structured_output_configuration'],
    [{ type: 'turn.failed', error: { code: 'authentication_required' } }, '', 'authentication_or_account'],
    [{ type: 'error', error: { code: 'model_unavailable' } }, '', 'model_unavailable'],
    [null, 'quota exceeded for fixture', 'rate_limit_or_quota'],
    [null, 'request refused by safety policy fixture', 'safety_or_policy'],
    [null, 'fixture service unavailable', 'transport_or_service'],
    [null, 'synthetic failure', 'unknown_nonzero_exit'],
  ] as const
  for (const [event, stderr, expected] of cases) assert.equal(classifyCodexFailure(event ? JSON.stringify(event) : '', stderr).failureClass, expected)
  assert.equal(classifyCodexFailure('{malformed', 'fixture service unavailable').failureClass, 'transport_or_service')
  assert.equal(classifyCodexFailure('{malformed', '').failureClass, 'unknown_nonzero_exit')
})

test('Codex CLI adapter runs through the Pi completion boundary without a native ModelRuntime model', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhl-codex-cli-test-'))
  try {
    const adapter = new CodexCliReasoningExecutor({ capabilities, executable: process.execPath, tempRoot: root, commandPrefix: [fixture] })
    const executor = new PiReasoningExecutor({ capabilities, completion: adapter.complete.bind(adapter), runtimeMetadata: { backend: 'codex-cli', requestedModel: 'gpt-5.6-luna', requestedReasoningEffort: 'medium' } })
    const result = await executor.execute({ operation: 'understandAndPlan', instruction: 'return the fixture object', input: { publicValue: 'ok' }, outputContract: { type: 'object' } })
    assert.equal((result.output as { ok: boolean }).ok, true)
    assert.deepEqual(executor.runtimeMetadata(), { provider: 'pi-coding-agent', backend: 'codex-cli', requestedModel: 'gpt-5.6-luna', requestedReasoningEffort: 'medium' })
    const metadata = adapter.runtimeMetadata()
    assert.equal(metadata.structuredOutputEnabled, true)
    assert.match(metadata.structuredOutputSchemaFingerprint ?? '', /^[a-f0-9]{16}$/)
    assert.equal(typeof metadata.structuredOutputSchemaBytes, 'number')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('Codex CLI records a spawned non-zero process without exposing provider channels', async () => {
  const adapter = new CodexCliReasoningExecutor({ capabilities, executable: process.execPath, commandPrefix: [fixture, '--fail'] })
  await assert.rejects(() => adapter.complete(undefined, { systemPrompt: 'fixture', messages: [] }, { signal: new AbortController().signal, maxTokens: 100, metadata: { operation: 'understandAndPlan' }, operationId: 'fixture-operation', outputContract: { type: 'object' } }), (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal((error as any).code, 'reasoning_execution_failed')
    assert.equal((error as any).processStarted, true)
    assert.equal((error as any).exitState, 'nonzero_exit')
    assert.equal((error as any).failureClass, 'unknown_nonzero_exit')
    assert.equal((error as any).stderr, undefined)
    assert.equal((error as any).stdout, undefined)
    return true
  })
  assert.equal(adapter.executionDiagnostics().processStarted, true)
  assert.equal(adapter.executionDiagnostics().semanticResultAvailable, false)
})
