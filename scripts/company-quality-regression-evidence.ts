import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

const args = process.argv.slice(2)
const option = (name: string): string => { const index = args.indexOf(name); if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`); return resolve(args[index + 1]!) }
type Failure = { filePath: string; testTitle: string }
function failureSet(text: string, client: boolean): Failure[] {
  const matches = client
    ? [...text.matchAll(/^\s*FAIL\s+(\S+)\s+>\s+(.*)$/gm)].map((match) => ({ filePath: match[1]!, testTitle: match[2]!.trim() }))
    : [...text.matchAll(/test at ([^\r\n]+?):\d+:\d+\r?\n✖ (.*?) \([\d.]+ms\)/g)].map((match) => ({ filePath: match[1]!, testTitle: match[2]! }))
  const unique = new Map(matches.map((failure) => { const normalized = { ...failure, filePath: failure.filePath.replaceAll('\\', '/') }; return [JSON.stringify(normalized), normalized] }))
  return [...unique.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}
async function compare(baselinePath: string, currentPath: string, client: boolean) {
  const baselineText = await readFile(baselinePath, 'utf8'); const currentText = await readFile(currentPath, 'utf8')
  const baseline = failureSet(baselineText, client); const current = failureSet(currentText, client)
  if (!baseline.length || !current.length) throw new Error('Expected inherited failures; empty parsed set is not evidence of success')
  const contains = (values: Failure[], value: Failure) => values.some((item) => item.filePath === value.filePath && item.testTitle === value.testTitle)
  return {
    baselineLog: baselinePath, currentLog: currentPath,
    baselineSha256: createHash('sha256').update(baselineText).digest('hex'), currentSha256: createHash('sha256').update(currentText).digest('hex'),
    baselineFailures: baseline, currentFailures: current,
    inheritedFailures: current.filter((failure) => contains(baseline, failure)),
    addedFailures: current.filter((failure) => !contains(baseline, failure)),
    removedFailures: baseline.filter((failure) => !contains(current, failure)),
    reportedTotals: currentText.split(/\r?\n/).filter((line) => /^ℹ (tests|pass|fail) |^\s*(Test Files|Tests)\s/.test(line)).map((line) => line.trim()),
  }
}
const node = await compare(option('--baseline-node'), option('--current-node'), false)
const client = await compare(option('--baseline-client'), option('--current-client'), true)
const output = option('--output'); await mkdir(dirname(output), { recursive: true })
await writeFile(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), comparisonKey: ['filePath', 'testTitle'], node, client, newRegressionCount: node.addedFailures.length + client.addedFailures.length }, null, 2)}\n`)
console.log(JSON.stringify({ output, node: { baseline: node.baselineFailures.length, current: node.currentFailures.length, added: node.addedFailures, removed: node.removedFailures }, client: { baseline: client.baselineFailures.length, current: client.currentFailures.length, added: client.addedFailures, removed: client.removedFailures } }))
