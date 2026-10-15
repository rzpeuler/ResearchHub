import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const root = resolve(option('--round-root') ?? '')
if (!option('--round-root')) throw new Error('--round-root is required')
const output = resolve(option('--output') ?? 'tests/validation/evidence/company-quality-live-review.json')
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const summary = JSON.parse(await readFile(join(root, 'summary.json'), 'utf8'))
const manualPath = option('--manual-review')
const manual = manualPath ? JSON.parse(await readFile(resolve(manualPath), 'utf8')) : undefined
const cases = []
for (const run of summary.cases) {
  if (!run.reportId) { cases.push(run); continue }
  const reportPath = join(root, `${run.symbol}-report.json`)
  const reportText = await readFile(reportPath, 'utf8')
  const parsed = JSON.parse(reportText); const report = parsed.report ?? parsed
  const analysisPath = join(root, `${run.symbol}-analysis.json`)
  const analysisText = await readFile(analysisPath, 'utf8'); const analysis = JSON.parse(analysisText)
  let knowledgeVerification: any
  try { knowledgeVerification = JSON.parse(await readFile(join(root,`${run.symbol}-raw-backed-verification.json`),'utf8')) } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  cases.push({ ...run, reportPath, reportSha256: hash(reportText), analysisPath, analysisSha256: hash(analysisText), knowledgeVerification, methodExecutions: report.methodExecutions, sections: report.sections.map((section: any) => ({id:section.id,characters:section.markdown.length,locatedEvidenceCount:section.evidenceLocations?.length ?? 0})), sourceAdvice: analysis.sourceAdvice, manualReview: manual?.cases?.find((entry: any) => entry.symbol === run.symbol) ?? {acceptance:'PENDING'} })
}
const accepted = args.includes('--accepted')
if (accepted && (cases.length !== 2 || cases.some(run => !run.researchQuality?.passed || run.manualReview?.acceptance !== 'ACCEPTED' || !['completed','completed_with_review'].includes(run.status)))) throw new Error('Both actual reports, Workflow completion and independent manual acceptance are required')
if (accepted && (!summary.writeAcceptance || cases.some(run => !run.knowledgeVerification?.sourceCount || !run.knowledgeVerification?.claimCount || !run.knowledgeVerification?.verifiedRaw?.length || run.knowledgeVerification.verifiedRaw.some((raw: any)=>raw.valid !== true)))) throw new Error('Disposable Knowledge persistence, reload and verified original Raw bytes are required')
const record = {round:basename(root),generatedAt:new Date().toISOString(),executionClass:summary.executionClass,acceptance:accepted?'ACCEPTED':'NOT_ACCEPTED',cases}
let previous: any
try { previous = JSON.parse(await readFile(output,'utf8')) } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
const history = Array.isArray(previous?.rounds) ? previous.rounds : previous?.round ? [previous] : []
const rounds = [...history.filter((entry: any) => entry.round !== record.round),record]
await writeFile(output,`${JSON.stringify({formatVersion:1,latestRound:record.round,acceptance:record.acceptance,rounds},null,2)}\n`)
console.log(JSON.stringify({output,round:record.round,acceptance:record.acceptance,cases:cases.map(run=>({symbol:run.symbol,status:run.status,passed:run.researchQuality?.passed}))}))
