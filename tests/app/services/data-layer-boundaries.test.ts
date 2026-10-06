import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const repositoryRoot = resolve(import.meta.dirname, '../../..')
const skillsRoot = join(repositoryRoot, 'skills')

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
  return /(?:^|\/)data\/(?:resolver|workflow|index)\.ts$/.test(normalized)
    || /(?:^|\/)workflows\/research-data-acquisition\//.test(normalized)
}

function isConcreteProviderModule(specifier: string): boolean {
  const normalized = specifier.replaceAll('\\', '/').toLowerCase()
  return normalized.includes('plugins/research-acquisition/')
    || /(?:^|[/@_.-])(?:akshare|cninfo|eastmoney|ths|sse|szse)(?:[/@_.-]|$)/.test(normalized)
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
