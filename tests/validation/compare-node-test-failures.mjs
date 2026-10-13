#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : process.argv[index + 1]
}

const baselineLogPath = argument('--baseline-log')
const branchLogPath = argument('--branch-log')
const outputPath = argument('--output')
const baselineSha = argument('--baseline-sha')
const branchSha = argument('--branch-sha')
const baselineRoot = argument('--baseline-root')
const branchRoot = argument('--branch-root')
const npmVersion = argument('--npm-version')
const packageLockSha256 = argument('--package-lock-sha256')
if (![baselineLogPath, branchLogPath, outputPath, baselineSha, branchSha, baselineRoot, branchRoot, npmVersion, packageLockSha256].every(Boolean)) {
  throw new Error('Usage: compare-node-test-failures.mjs --baseline-log FILE --branch-log FILE --output FILE --baseline-sha SHA --branch-sha SHA --baseline-root DIR --branch-root DIR --npm-version VERSION --package-lock-sha256 SHA256')
}

function normalizeText(text, worktreeRoot) {
  return text.replaceAll(worktreeRoot.replaceAll('\\', '/'), '<WORKTREE>').replaceAll(worktreeRoot.replaceAll('/', '\\'), '<WORKTREE>').replaceAll('\\', '/')
}

function summary(log, label) {
  const tests = Number(log.match(/ℹ tests (\d+)/)?.[1])
  const passed = Number(log.match(/ℹ pass (\d+)/)?.[1])
  const failed = Number(log.match(/ℹ fail (\d+)/)?.[1])
  if (![tests, passed, failed].every(Number.isSafeInteger)) throw new Error(`${label} test summary is missing`)
  return { tests, passed, failed }
}

function failureRecords(log, root, label) {
  const marker = log.lastIndexOf('✖ failing tests:')
  if (marker < 0) {
    if (summary(log, label).failed === 0) return []
    throw new Error(`${label} failure details are missing`)
  }
  const section = log.slice(marker + '✖ failing tests:'.length)
  const chunks = section.split(/^test at /mu).slice(1)
  const records = chunks.map((chunk) => {
    const lines = chunk.replace(/\s+$/u, '').split(/\r?\n/u)
    const heading = lines[0] ?? ''
    const testFile = heading.match(/^(.*?):\d+:\d+$/u)?.[1]
    const titleLine = lines[1] ?? ''
    const testName = titleLine.replace(/^✖ /u, '').replace(/ \([\d.]+ms\)$/u, '')
    if (!testFile || !testName) throw new Error(`${label} contains an unparseable failure header: ${heading}`)
    const normalizedBody = normalizeText(lines.slice(2).join('\n'), root)
    const normalizedLines = normalizedBody.split('\n')
    const firstError = normalizedLines.find((line) => /^\s+[A-Za-z]*Error(?: \[[^\]]+\])?:/u.test(line))?.trim() ?? ''
    const errorMatch = firstError.match(/^([A-Za-z]*Error)(?: \[([^\]]+)\])?:\s*(.*)$/u)
    const actual = normalizedLines.find((line) => /^\s+actual: /u.test(line))?.trim().replace(/^actual: /u, '').replace(/,$/u, '')
    const expected = normalizedLines.find((line) => /^\s+expected: /u.test(line))?.trim().replace(/^expected: /u, '').replace(/,$/u, '')
    const stack = normalizedLines.filter((line) => /^\s+at /u.test(line)).map((line) => line.trim())
    const firstFrame = stack[0] ?? ''
    const sourceLocation = firstFrame.match(/(<WORKTREE>\/[^()\s]+:\d+:\d+)/u)?.[1]
    return {
      testFile: testFile.replaceAll('\\', '/'),
      testName,
      errorType: errorMatch?.[1] ?? 'UnknownError',
      ...(errorMatch?.[2] === undefined ? {} : { errorCode: errorMatch[2] }),
      errorMessage: errorMatch?.[3] ?? firstError,
      actual: actual ?? null,
      expected: expected ?? null,
      sourcePosition: heading.replaceAll('\\', '/'),
      ...(sourceLocation === undefined ? {} : { failureSourceLocation: sourceLocation }),
      normalizedCallStack: stack,
      normalizedFailureText: normalizedBody,
    }
  })
  if (records.length !== summary(log, label).failed) throw new Error(`${label} failure detail count ${records.length} does not match summary ${summary(log, label).failed}`)
  return records.sort((a, b) => a.testFile.localeCompare(b.testFile) || a.testName.localeCompare(b.testName))
}

function stableJson(value) { return `${JSON.stringify(value, null, 2)}\n` }
function sha256(value) { return createHash('sha256').update(stableJson(value), 'utf8').digest('hex') }
function identity(item) { return `${item.testFile}\0${item.testName}` }
function content(item) { return stableJson(item) }

const baselineLog = await readFile(baselineLogPath, 'utf8')
const branchLog = await readFile(branchLogPath, 'utf8')
const baselineFailures = failureRecords(baselineLog, baselineRoot, 'baseline')
const branchFailures = failureRecords(branchLog, branchRoot, 'branch')
const baselineById = new Map(baselineFailures.map((item) => [identity(item), item]))
const branchById = new Map(branchFailures.map((item) => [identity(item), item]))
const newFailures = branchFailures.filter((item) => !baselineById.has(identity(item)))
const disappearedFailures = baselineFailures.filter((item) => !branchById.has(identity(item)))
const changedFailures = branchFailures.flatMap((item) => {
  const previous = baselineById.get(identity(item))
  return previous !== undefined && content(previous) !== content(item) ? [{ testFile: item.testFile, testName: item.testName, baseline: previous, branch: item }] : []
})
const baselineSummary = summary(baselineLog, 'baseline')
const branchSummary = summary(branchLog, 'branch')
const status = newFailures.length === 0 && disappearedFailures.length === 0 && changedFailures.length === 0 ? 'BASELINE_FAILURES_IDENTICAL' : 'FAILURE_SET_CHANGED'
const comparison = {
  schemaVersion: 1,
  taskId: 'RHL-WF-PERSIST-001-ACCEPTANCE-FIX-001',
  capturedAt: new Date().toISOString(),
  status,
  testEnvironment: {
    nodeVersion: process.version,
    npmVersion,
    platform: process.platform,
    architecture: process.arch,
    packageLockSha256,
    dependencyInstall: 'npm ci succeeded in both isolated worktrees',
    environmentHandling: 'Same host account and inherited process environment; no task-specific environment overrides were applied between runs.',
  },
  commands: {
    baseline: 'npm run test:node',
    branch: 'npm run test:node',
    comparison: 'node tests/validation/compare-node-test-failures.mjs (full arguments recorded in the execution log; local paths are omitted here)',
  },
  normalizationRules: [
    'Replace only the respective worktree absolute root with <WORKTREE>.',
    'Normalize path separators to /.',
    'Remove only per-test elapsed milliseconds from failure title headings.',
    'Preserve error type, code, message, assertion diff, actual/expected fields, source positions, and all stack frames.',
  ],
  baseline: { commit: baselineSha, summary: baselineSummary, failureRecordSha256: sha256(baselineFailures), failures: baselineFailures },
  branch: { commit: branchSha, summary: branchSummary, failureRecordSha256: sha256(branchFailures), failures: branchFailures },
  differences: { newFailures, disappearedFailures, changedFailures },
  failureCounts: {
    baseline: baselineFailures.length,
    branch: branchFailures.length,
    new: newFailures.length,
    disappeared: disappearedFailures.length,
    sameNamedButChanged: changedFailures.length,
  },
  sha256Comparison: {
    baseline: sha256(baselineFailures),
    branch: sha256(branchFailures),
    equal: sha256(baselineFailures) === sha256(branchFailures),
  },
}
await writeFile(outputPath, stableJson(comparison), 'utf8')
process.stdout.write(`${JSON.stringify({ status, baseline: baselineSummary, branch: branchSummary, failureCounts: comparison.failureCounts, sha256Comparison: comparison.sha256Comparison, output: outputPath }, null, 2)}\n`)
if (status !== 'BASELINE_FAILURES_IDENTICAL') process.exitCode = 2
