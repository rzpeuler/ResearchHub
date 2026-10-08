import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const skillsRoot = join(repositoryRoot, 'skills')
const workflowsRoot = join(repositoryRoot, 'workflows')
const appServicesRoot = join(repositoryRoot, 'app/services')

interface ModuleReference {
  readonly specifier: string
  readonly typeOnly: boolean
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path)
  }
  return files.sort()
}

function moduleReferences(path: string, text: string): ModuleReference[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const references: ModuleReference[] = []
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause
      const namedImports = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : undefined
      const typeOnly = clause?.isTypeOnly === true || (
        clause?.name === undefined && namedImports !== undefined && namedImports.length > 0 && namedImports.every((item) => item.isTypeOnly)
      )
      references.push({ specifier: statement.moduleSpecifier.text, typeOnly })
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
      references.push({ specifier: statement.moduleSpecifier.text, typeOnly: statement.isTypeOnly })
    }
  }
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || isRequire) references.push({ specifier: node.arguments[0].text, typeOnly: false })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return references
}

const allowedAcquisitionSchemaImports = new Map<string, ReadonlySet<string>>([
  ['skills/company-research/contracts.ts', new Set(['../../plugins/research-acquisition/contracts.ts'])],
  // Migration debt: this import is type-only, but its module currently co-locates the observation schema with provider I/O.
  ['skills/industry-research/contracts.ts', new Set(['../../plugins/research-acquisition/contracts.ts', '../../plugins/research-acquisition/industry-operating-observations.ts'])],
  ['skills/thesis-red-team/contracts.ts', new Set(['../../plugins/research-acquisition/contracts.ts'])],
  ['skills/valuation/skill.ts', new Set(['../../plugins/research-acquisition/contracts.ts'])],
  ['skills/industry-research/skill.ts', new Set(['../../plugins/research-acquisition/industry-operating-observations.ts'])],
])

function isBlockedDataModule(specifier: string): boolean {
  const normalized = specifier.replaceAll('\\', '/')
  return /(?:^|\/)data\/(?:resolver|workflow|index)(?:\.ts|\.js)?$/.test(normalized)
    || /(?:^|\/)workflows\/research-data-acquisition\//.test(normalized)
}

function isConcreteProviderModule(specifier: string): boolean {
  const normalized = specifier.replaceAll('\\', '/').toLowerCase()
  return normalized.includes('plugins/research-acquisition/')
    || /(?:^|[/@_.-])(?:akshare|cninfo|eastmoney|ths|sse|szse)(?:[/@_.-]|$)/.test(normalized)
}

// Explicit current Workflow/application dependencies on concrete Plugin
// adapters, including deferred acquisition paths. Keep this path-to-module
// list exact: a new dependency requires an explicit architecture decision.
const allowedWorkflowAcquisitionDependencies = new Map<string, ReadonlySet<string>>([
  ['workflows/daily-intelligence/workflow.ts', new Set([
    '../../plugins/daily-intelligence/brief-store.ts',
    '../../plugins/daily-intelligence/signal-intelligence.ts',
  ])],
  ['workflows/earnings-review/automatic-expectations.ts', new Set(['../../plugins/research-acquisition/earnings-data.ts'])],
  ['workflows/earnings-review/contracts.ts', new Set([
    '../../plugins/research-acquisition/akshare.ts',
    '../../plugins/research-acquisition/earnings-data.ts',
    '../../plugins/research-acquisition/management-communication-data.ts',
  ])],
  ['workflows/earnings-review/expectation-source-eastmoney.ts', new Set(['../../plugins/research-acquisition/earnings-expectation-source-eastmoney.ts'])],
  ['workflows/earnings-review/expectations-acquisition.ts', new Set([
    '../../plugins/research-acquisition/akshare.ts',
    '../../plugins/research-acquisition/earnings-data.ts',
  ])],
  ['workflows/earnings-review/expectations-eastmoney-akshare.ts', new Set([
    '../../plugins/research-acquisition/earnings-expectations-eastmoney-akshare.ts',
  ])],
  ['workflows/earnings-review/expectations-ths.ts', new Set([
    '../../plugins/research-acquisition/earnings-expectations-ths.ts',
  ])],
  ['workflows/earnings-review/workflow.ts', new Set(['../../plugins/research-acquisition/earnings-data.ts'])],
  ['workflows/earnings-review/management-communication.ts', new Set(['../../plugins/research-acquisition/management-communication-data.ts'])],
  ['workflows/industry-deep-research/contracts.ts', new Set(['../../plugins/research-acquisition/industry-operating-observations.ts'])],
  ['workflows/industry-deep-research/workflow.ts', new Set(['../../plugins/research-acquisition/industry-operating-observations.ts'])],
  ['workflows/management-communication-acquisition/contracts.ts', new Set(['../../plugins/research-acquisition/management-communication-contracts.ts'])],
  ['workflows/management-communication-acquisition/dedupe.ts', new Set(['../../plugins/research-acquisition/management-dedupe.ts'])],
  ['workflows/management-communication-acquisition/normalization.ts', new Set(['../../plugins/research-acquisition/management-normalization.ts'])],
  ['workflows/management-communication-acquisition/workflow.ts', new Set([
    '../../plugins/research-acquisition/management-communication-data.ts',
    '../../plugins/research-acquisition/management-communication.ts',
    '../../plugins/research-acquisition/official.ts',
    '../../plugins/research-acquisition/akshare.ts',
  ])],
  ['workflows/raw-document-knowledge-ingestion/v04-preview-workflow.ts', new Set(['../../plugins/document/input-resolver.ts'])],
  ['workflows/raw-document-knowledge-ingestion/workflow.ts', new Set(['../../plugins/document/input-resolver.ts'])],
  ['workflows/thesis-lifecycle/kill-criterion-evaluator.ts', new Set(['../../plugins/document/input-resolver.ts'])],
  ['workflows/valuation/automatic-comps.ts', new Set([
    '../../plugins/research-acquisition/akshare.ts',
    '../../plugins/research-acquisition/official.ts',
    '../../plugins/research-acquisition/valuation-data.ts',
  ])],
  ['workflows/valuation/basis-evidence.ts', new Set([
    '../../plugins/research-acquisition/official.ts',
    '../../plugins/research-acquisition/valuation-data.ts',
  ])],
  ['workflows/valuation/contracts.ts', new Set([
    '../../plugins/research-acquisition/akshare.ts',
    '../../plugins/research-acquisition/official.ts',
    '../../plugins/research-acquisition/valuation-data.ts',
  ])],
  ['workflows/valuation/workflow.ts', new Set([
    '../../plugins/research-acquisition/official.ts',
    '../../plugins/research-acquisition/valuation-data.ts',
  ])],
  ['app/services/daily-intelligence-composition.ts', new Set([
    '../../plugins/research-acquisition/akshare.ts',
    '../../plugins/research-acquisition/official.ts',
    '../../plugins/research-acquisition/gdelt.ts',
    '../../plugins/research-acquisition/rss.ts',
    '../../plugins/research-acquisition/industry-operating-observations.ts',
    '../../plugins/daily-intelligence/market.ts',
    '../../plugins/daily-intelligence/expectations.ts',
    '../../plugins/daily-intelligence/institutional.ts',
    '../../plugins/daily-intelligence/industry.ts',
    '../../plugins/daily-intelligence/acquisition.ts',
    '../../plugins/daily-intelligence/config.ts',
    '../../plugins/daily-intelligence/calendar.ts',
  ])],
  ['app/services/daily-intelligence-service.ts', new Set([
    '../../plugins/research-acquisition/akshare.ts',
    '../../plugins/daily-intelligence/config.ts',
    '../../plugins/daily-intelligence/signal-store.ts',
    '../../plugins/daily-intelligence/brief-store.ts',
    '../../plugins/daily-intelligence/calendar.ts',
  ])],
  ['app/services/contracts.ts', new Set(['../../plugins/research-acquisition/industry-operating-observations.ts'])],
  ['app/services/data-source-integrations.ts', new Set(['../../plugins/research-acquisition/industry-operating-observations.ts'])],
  ['app/services/research-service.ts', new Set([
    '../../plugins/research-acquisition/akshare.ts',
    '../../plugins/research-acquisition/company-research-data.ts',
    '../../plugins/research-acquisition/gdelt.ts',
    '../../plugins/research-acquisition/official.ts',
    '../../plugins/research-acquisition/industry.ts',
    '../../plugins/research-acquisition/industry-composition.ts',
    '../../plugins/research-acquisition/industry-operating-observations.ts',
  ])],
  ['app/services/theme-framework-service.ts', new Set(['../../plugins/document/input-resolver.ts'])],
])

function isConcreteWorkflowPluginDependency(specifier: string): boolean {
  const normalized = specifier.replaceAll('\\', '/').toLowerCase()
  if (/(?:^|\/)plugins\//.test(normalized)) {
    // Exact current neutral contracts and generic helper module targets only.
    // Other Plugin modules, including nested provider contracts, stay guarded.
    const neutralPluginModuleSuffixes = [
      '/plugins/research-acquisition/contracts.ts',
      '/plugins/research-acquisition/expectations/contracts.ts',
      '/plugins/research-acquisition/hash.ts',
      '/plugins/research-acquisition/payload-validation.ts',
      '/plugins/reasoning/contracts.ts',
      '/plugins/daily-intelligence/contracts.ts',
      '/plugins/document/contracts.ts',
    ]
    return !neutralPluginModuleSuffixes.some((suffix) => normalized.endsWith(suffix))
  }
  if (normalized.startsWith('.') || normalized.startsWith('/')) return false
  return /(?:^|[/@_.-])(?:akshare|cninfo|eastmoney|ths|sse|szse|gdelt|rss)(?:[/@_.-]|$)/.test(normalized)
}

interface WorkflowAcquisitionDependency {
  readonly relativePath: string
  readonly reference: ModuleReference
}

function unbaselinedWorkflowAcquisitionDependencies(dependencies: readonly WorkflowAcquisitionDependency[]): string[] {
  return dependencies.flatMap(({ relativePath, reference }) => {
    if (!isConcreteWorkflowPluginDependency(reference.specifier)) return []
    if (reference.typeOnly && allowedWorkflowDataTypeImports.get(relativePath)?.has(reference.specifier)) return []
    if (allowedWorkflowAcquisitionDependencies.get(relativePath)?.has(reference.specifier)) return []
    return [`${relativePath} imports unbaselined acquisition module ${reference.specifier}`]
  })
}

const migratedAcquisitionWorkflowPaths = new Set([
  'workflows/company-deep-research',
  'workflows/event-research',
  'workflows/thesis-red-team',
])

const allowedWorkflowDataTypeImports = new Map<string, ReadonlySet<string>>([
  ['workflows/company-deep-research/contracts.ts', new Set(['../../plugins/research-acquisition/company-research-data.ts'])],
  ['workflows/company-deep-research/workflow.ts', new Set(['../../plugins/research-acquisition/company-research-data.ts'])],
  ['workflows/event-research/contracts.ts', new Set(['../../plugins/research-acquisition/company-research-data.ts'])],
])

function directWorkflowAcquisitionCalls(relativePath: string, text: string): string[] {
  if (![...migratedAcquisitionWorkflowPaths].some((root) => relativePath.startsWith(`${root}/`))) return []
  const source = ts.createSourceFile(relativePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const violations: string[] = []
  const methods = new Set(['discover', 'fetch', 'normalize'])
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && methods.has(node.expression.name.text)
      && !(node.expression.name.text === 'normalize' && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) && /^NFK[CD]$|^NF[CD]$/.test(node.arguments[0].text))) {
      const method = node.expression.name.text
      violations.push(`${relativePath} directly calls .${method}()`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return violations
}

function unbaselinedMigratedWorkflowProviderImports(dependencies: readonly WorkflowAcquisitionDependency[]): string[] {
  return dependencies.flatMap(({ relativePath, reference }) => {
    if (![...migratedAcquisitionWorkflowPaths].some((root) => relativePath.startsWith(`${root}/`))) return []
    if (!isConcreteWorkflowPluginDependency(reference.specifier)) return []
    if (reference.typeOnly && allowedWorkflowDataTypeImports.get(relativePath)?.has(reference.specifier)) return []
    return [`${relativePath} imports concrete acquisition module ${reference.specifier}`]
  })
}

test('provider module detector recognizes adapter paths and direct provider packages', () => {
  for (const specifier of [
    '../../plugins/akshare/client.ts',
    '../../plugins/cninfo/official.ts',
    '@market/eastmoney-sdk',
    'ths-provider',
    'sse-adapter',
    'szse-client',
    '../../plugins/research-acquisition/contracts.ts',
  ]) assert.equal(isConcreteProviderModule(specifier), true, `${specifier} must be guarded`)
  for (const specifier of ['node:fs', '../../plugins/reasoning/contracts.ts', 'lodash']) {
    assert.equal(isConcreteProviderModule(specifier), false, `${specifier} is not a concrete data provider`)
  }
})

test('Skill runtime boundary detects resolver modules with TypeScript, JavaScript, or extensionless specifiers', () => {
  for (const specifier of [
    '../../data/resolver.ts',
    '../../data/resolver.js',
    '../../data/resolver',
    '../../data/workflow.js',
    '../../data/index',
  ]) assert.equal(isBlockedDataModule(specifier), true, `${specifier} must be blocked`)
  assert.equal(isBlockedDataModule('../../data/contracts.ts'), false)
})

test('Skills do not import concrete acquisition providers or perform acquisition I/O', async () => {
  const violations: string[] = []
  for (const path of await sourceFiles(skillsRoot)) {
    const text = await readFile(path, 'utf8')
    const relativePath = relative(repositoryRoot, path).split(sep).join('/')
    for (const reference of moduleReferences(path, text)) {
      if (isConcreteProviderModule(reference.specifier)) {
        const allowed = allowedAcquisitionSchemaImports.get(relativePath)?.has(reference.specifier) === true
        if (!reference.typeOnly || !allowed) violations.push(`${relativePath} imports ${reference.specifier}${reference.typeOnly ? ' as a type' : ''}`)
      }
      if (isBlockedDataModule(reference.specifier)) violations.push(`${relativePath} imports data runtime ${reference.specifier}`)
    }

    const forbiddenOperations = [
      ['DataResolver', /\bDataResolver\b/],
      ['runResearchDataAcquisition', /\brunResearchDataAcquisition\b/],
      ['resolveAcquisition', /\bresolveAcquisition\b/],
      ['network fetch', /\b(?:fetch|fetchImpl|axios|got)\s*\(/],
      ['HTTP request', /\bhttps?\.request\s*\(/],
    ] as const
    for (const [label, pattern] of forbiddenOperations) {
      if (pattern.test(text)) violations.push(`${relativePath} contains ${label}`)
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})

test('Workflow and application Plugin dependencies match the explicit deferred-debt baseline', async () => {
  const dependencies: WorkflowAcquisitionDependency[] = []
  const directCalls: string[] = []
  for (const root of [workflowsRoot, appServicesRoot]) {
    for (const path of await sourceFiles(root)) {
      const relativePath = relative(repositoryRoot, path).split(sep).join('/')
      const source = await readFile(path, 'utf8')
      directCalls.push(...directWorkflowAcquisitionCalls(relativePath, source))
      for (const reference of moduleReferences(path, source)) {
        dependencies.push({ relativePath, reference })
      }
    }
  }
  const violations = unbaselinedWorkflowAcquisitionDependencies(dependencies)
  assert.deepEqual(violations, [], violations.join('\n'))
  const migratedProviderImports = unbaselinedMigratedWorkflowProviderImports(dependencies)
  assert.deepEqual(migratedProviderImports, [], migratedProviderImports.join('\n'))
  assert.deepEqual(directCalls, [], directCalls.join('\n'))

  const phase2Paths = new Set([
    'workflows/earnings-review/automatic-expectations.ts',
    'workflows/earnings-review/contracts.ts',
    'workflows/earnings-review/expectation-source-eastmoney.ts',
    'workflows/earnings-review/expectations-acquisition.ts',
    'workflows/earnings-review/expectations-eastmoney-akshare.ts',
    'workflows/earnings-review/expectations-ths.ts',
    'workflows/earnings-review/workflow.ts',
    'workflows/earnings-review/management-communication.ts',
    'workflows/management-communication-acquisition/contracts.ts',
    'workflows/management-communication-acquisition/dedupe.ts',
    'workflows/management-communication-acquisition/normalization.ts',
    'workflows/management-communication-acquisition/workflow.ts',
    'workflows/valuation/automatic-comps.ts',
    'workflows/valuation/basis-evidence.ts',
    'workflows/valuation/contracts.ts',
    'workflows/valuation/workflow.ts',
  ])
  const actualByPath = new Map<string, Set<string>>()
  for (const { relativePath, reference } of dependencies) {
    if (!phase2Paths.has(relativePath) || !isConcreteWorkflowPluginDependency(reference.specifier)) continue
    const actual = actualByPath.get(relativePath) ?? new Set<string>()
    actual.add(reference.specifier)
    actualByPath.set(relativePath, actual)
  }
  const staleEntries = [...allowedWorkflowAcquisitionDependencies]
    .filter(([relativePath]) => phase2Paths.has(relativePath))
    .flatMap(([relativePath, allowed]) => [...allowed]
      .filter((specifier) => !actualByPath.get(relativePath)?.has(specifier))
      .map((specifier) => `${relativePath} allows stale acquisition module ${specifier}`))
  assert.deepEqual(staleEntries, [], staleEntries.join('\n'))
})

test('a new concrete Workflow acquisition dependency fails without an explicit baseline entry', () => {
  const violations = unbaselinedWorkflowAcquisitionDependencies([{
    relativePath: 'workflows/new-research/workflow.ts',
    reference: { specifier: '../../plugins/research-acquisition/new-provider.ts', typeOnly: false },
  }])
  assert.deepEqual(violations, [
    'workflows/new-research/workflow.ts imports unbaselined acquisition module ../../plugins/research-acquisition/new-provider.ts',
  ])
})

test('a new type-only import from a provider module with co-located I/O fails without an explicit baseline entry', () => {
  const violations = unbaselinedWorkflowAcquisitionDependencies([{
    relativePath: 'app/services/new-service.ts',
    reference: { specifier: '../../plugins/research-acquisition/industry-operating-observations.ts', typeOnly: true },
  }])
  assert.deepEqual(violations, [
    'app/services/new-service.ts imports unbaselined acquisition module ../../plugins/research-acquisition/industry-operating-observations.ts',
  ])
})

test('a new relative concrete Plugin adapter import fails without an explicit baseline entry', () => {
  const violations = unbaselinedWorkflowAcquisitionDependencies([{
    relativePath: 'workflows/new-research/workflow.ts',
    reference: { specifier: '../../plugins/acme-feed/client.ts', typeOnly: false },
  }])
  assert.deepEqual(violations, [
    'workflows/new-research/workflow.ts imports unbaselined acquisition module ../../plugins/acme-feed/client.ts',
  ])
})

test('a nested provider contracts import fails without an explicit baseline entry', () => {
  const violations = unbaselinedWorkflowAcquisitionDependencies([{
    relativePath: 'workflows/new-research/workflow.ts',
    reference: { specifier: '../../plugins/research-acquisition/new-provider/contracts.ts', typeOnly: true },
  }])
  assert.deepEqual(violations, [
    'workflows/new-research/workflow.ts imports unbaselined acquisition module ../../plugins/research-acquisition/new-provider/contracts.ts',
  ])
})

test('migrated Company, Event, and Thesis Workflows reject direct provider modules and acquisition calls', () => {
  const dependencies = [
    { relativePath: 'workflows/company-deep-research/workflow.ts', reference: { specifier: '../../plugins/research-acquisition/akshare.ts', typeOnly: false } },
    { relativePath: 'workflows/event-research/workflow.ts', reference: { specifier: '../../plugins/research-acquisition/gdelt.ts', typeOnly: false } },
    { relativePath: 'workflows/thesis-red-team/workflow.ts', reference: { specifier: '../../plugins/research-acquisition/official.ts', typeOnly: true } },
    { relativePath: 'workflows/event-research/contracts.ts', reference: { specifier: '../../plugins/research-acquisition/contracts.ts', typeOnly: true } },
  ] satisfies WorkflowAcquisitionDependency[]
  const imports = unbaselinedMigratedWorkflowProviderImports(dependencies)
  assert.deepEqual(unbaselinedWorkflowAcquisitionDependencies(dependencies), [
    'workflows/company-deep-research/workflow.ts imports unbaselined acquisition module ../../plugins/research-acquisition/akshare.ts',
    'workflows/event-research/workflow.ts imports unbaselined acquisition module ../../plugins/research-acquisition/gdelt.ts',
    'workflows/thesis-red-team/workflow.ts imports unbaselined acquisition module ../../plugins/research-acquisition/official.ts',
  ])
  assert.deepEqual(imports, [
    'workflows/company-deep-research/workflow.ts imports concrete acquisition module ../../plugins/research-acquisition/akshare.ts',
    'workflows/event-research/workflow.ts imports concrete acquisition module ../../plugins/research-acquisition/gdelt.ts',
    'workflows/thesis-red-team/workflow.ts imports concrete acquisition module ../../plugins/research-acquisition/official.ts',
  ])
  for (const method of ['discover', 'fetch', 'normalize']) {
    assert.deepEqual(directWorkflowAcquisitionCalls('workflows/company-deep-research/workflow.ts', `plugin.${method}(value)`), [`workflows/company-deep-research/workflow.ts directly calls .${method}()`])
    assert.deepEqual(directWorkflowAcquisitionCalls('workflows/event-research/workflow.ts', `acquisitionPlugin.${method}(candidate)`), [`workflows/event-research/workflow.ts directly calls .${method}()`])
    assert.deepEqual(directWorkflowAcquisitionCalls('workflows/thesis-red-team/workflow.ts', `input.plugin.${method}(candidate)`), [`workflows/thesis-red-team/workflow.ts directly calls .${method}()`])
  }
  assert.deepEqual(directWorkflowAcquisitionCalls('workflows/valuation/workflow.ts', 'plugin.fetch(value)'), [])
})

test('canonical data implementation exists and legacy acquisition paths only re-export it', async () => {
  const canonicalFiles = [
    'contracts.ts',
    'source-policy.ts',
    'validation.ts',
    'workflow.ts',
    'common-catalog.ts',
    'industry-catalog.ts',
    'requirements.ts',
    'resolver.ts',
    'index.ts',
  ]
  for (const file of canonicalFiles) {
    const path = join(repositoryRoot, 'data', file)
    const text = await readFile(path, 'utf8')
    assert.notEqual(text.trim(), '', `data/${file} must contain the canonical implementation`)
  }

  const compatibilityReExports = {
    'contracts.ts': '../../data/contracts.ts',
    'index.ts': '../../data/index.ts',
    'source-policy.ts': '../../data/source-policy.ts',
    'validation.ts': '../../data/validation.ts',
    'workflow.ts': '../../data/workflow.ts',
  } as const
  const compatibilityRoot = join(repositoryRoot, 'workflows/research-data-acquisition')
  assert.deepEqual((await readdir(compatibilityRoot)).sort(), Object.keys(compatibilityReExports).sort())

  for (const [file, expectedSpecifier] of Object.entries(compatibilityReExports)) {
    const path = join(compatibilityRoot, file)
    const text = await readFile(path, 'utf8')
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    assert.equal(source.statements.length, 1, `${file} must contain only its compatibility re-export`)
    const statement = source.statements[0]
    assert.ok(statement && ts.isExportDeclaration(statement), `${file} must use an export declaration`)
    assert.equal(statement.exportClause, undefined, `${file} must re-export the module surface`)
    assert.equal(statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined, expectedSpecifier, `${file} must point at the canonical data module`)
  }
})
