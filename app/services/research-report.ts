import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export interface ResearchReportSection { readonly id: string; readonly title: string; readonly markdown: string; readonly sourceRefs?: readonly string[]; readonly claimRefs?: readonly string[]; readonly relationRefs?: readonly string[]; readonly signalRefs?: readonly string[]; readonly evidenceLinks?: readonly string[] }
export interface VerifiedSecurityIdentityReportMetadata {
  readonly symbol: string
  readonly exchange: 'SH' | 'SZ' | 'BJ'
  readonly verifiedName: string
  readonly verificationSource: 'canonical_knowledge' | 'akshare_security_directory'
  readonly originAuthority: 'S3_AGGREGATOR' | 'CANONICAL_KNOWLEDGE'
  readonly verifiedAt: string
  readonly sourceId?: string
  readonly sourceUrl?: string
  readonly canonicalCompanyRef?: string
}
export interface ResearchReport {
  readonly reportId: string
  readonly reportType: 'company_research' | 'daily_brief' | 'earnings_review' | 'valuation' | 'event_research' | 'thesis_red_team' | 'industry_research' | 'thesis_lifecycle'
  readonly subjectRefs: readonly string[]
  readonly generatedAt: string
  readonly asOf: string
  readonly workflowRunId: string
  readonly knowledgeBaseRevision: number
  readonly sourceRefs: readonly string[]
  readonly claimRefs: readonly string[]
  readonly methodology: string
  readonly verifiedSecurityIdentity?: VerifiedSecurityIdentityReportMetadata
  readonly sections: readonly ResearchReportSection[]
  readonly outputPath: string
}
export interface ResearchReportSummary {
  readonly reportId: string
  readonly reportType: ResearchReport['reportType']
  readonly subjectRefs: readonly string[]
  readonly generatedAt: string
  readonly asOf: string
  readonly workflowRunId: string
  readonly knowledgeBaseRevision: number
  readonly sourceCount: number
  readonly claimCount: number
  readonly sectionCount: number
  readonly methodology: string
}

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const inside = (root: string, candidate: string): boolean => { const rel = relative(resolve(root), resolve(candidate)); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`)) }
const ref = (value: string): boolean => /^(?:entity|relation|claim|source|theme-group|module):[^\s]+$/.test(value)
const thesisRef = (value: string): boolean => /^thesis:[^\s]+$/.test(value)

export function validateResearchReport(report: ResearchReport): ResearchReport {
  if (!report || typeof report !== 'object') throw new TypeError('ResearchReport must be an object')
  if (!safeId.test(report.reportId)) throw new TypeError('reportId must be a safe deterministic identifier')
  if (report.reportType !== 'company_research' && report.reportType !== 'daily_brief' && report.reportType !== 'earnings_review' && report.reportType !== 'valuation' && report.reportType !== 'event_research' && report.reportType !== 'thesis_red_team' && report.reportType !== 'industry_research' && report.reportType !== 'thesis_lifecycle') throw new TypeError('Unsupported reportType')
  const identity = report.verifiedSecurityIdentity
  if (identity !== undefined) {
    if (!['company_research', 'valuation', 'earnings_review'].includes(report.reportType) || !/^\d{6}$/.test(identity.symbol) || !['SH', 'SZ', 'BJ'].includes(identity.exchange) || typeof identity.verifiedName !== 'string' || identity.verifiedName.trim() === '' || identity.verifiedName.length > 200 || Number.isNaN(Date.parse(identity.verifiedAt))) throw new TypeError('verifiedSecurityIdentity is invalid for this report type')
    if ((identity.verificationSource === 'canonical_knowledge') !== (identity.originAuthority === 'CANONICAL_KNOWLEDGE')) throw new TypeError('verifiedSecurityIdentity authority does not match its verification source')
    if (identity.verificationSource === 'akshare_security_directory' && (typeof identity.sourceId !== 'string' || identity.sourceId.trim() === '' || typeof identity.sourceUrl !== 'string' || !/^https?:\/\//i.test(identity.sourceUrl))) throw new TypeError('external verifiedSecurityIdentity requires source attribution')
    if (identity.verificationSource === 'canonical_knowledge' && (typeof identity.canonicalCompanyRef !== 'string' || !/^entity:[^\s]+$/.test(identity.canonicalCompanyRef))) throw new TypeError('canonical verifiedSecurityIdentity requires a canonical Company reference')
  }
  if (!Array.isArray(report.subjectRefs) || (report.reportType !== 'daily_brief' && report.subjectRefs.length === 0 && identity === undefined) || report.subjectRefs.some((item) => thesisRef(item) ? report.reportType !== 'thesis_lifecycle' : !ref(item))) throw new TypeError('subjectRefs must contain canonical references valid for the report type or a verified security identity')
  if (Number.isNaN(Date.parse(report.generatedAt)) || Number.isNaN(Date.parse(report.asOf))) throw new TypeError('generatedAt and asOf must be valid dates')
  if (!safeId.test(report.workflowRunId) || !Number.isInteger(report.knowledgeBaseRevision) || report.knowledgeBaseRevision < 0) throw new TypeError('Invalid workflow/revision metadata')
  if (!report.sourceRefs || report.sourceRefs.some((item: string) => !/^source:[^\s]+$/.test(item))) throw new TypeError('sourceRefs must contain Source references')
  if (!report.claimRefs || report.claimRefs.some((item: string) => !/^claim:[^\s]+$/.test(item))) throw new TypeError('claimRefs must contain Claim references')
  if (typeof report.methodology !== 'string' || report.methodology.trim() === '') throw new TypeError('methodology is required')
  if (!report.sections || report.sections.length === 0 || report.sections.some((section: ResearchReportSection) => !safeId.test(section.id) || section.title.trim() === '' || section.markdown.trim() === '')) throw new TypeError('sections must contain non-empty Markdown sections')
  if (report.sections.some((section: ResearchReportSection) => (section.sourceRefs ?? []).some((item: string) => !/^source:[^\s]+$/.test(item)) || (section.claimRefs ?? []).some((item: string) => !/^claim:[^\s]+$/.test(item)))) throw new TypeError('section references must be canonical Source/Claim references')
  if (report.sections.some((section: ResearchReportSection) => (section.relationRefs ?? []).some((item: string) => !/^relation:[^\s]+$/.test(item)))) throw new TypeError('section relationRefs must be canonical Relation references')
  if (report.sections.some((section: ResearchReportSection) => (section.signalRefs ?? []).some((item: string) => !safeId.test(item)))) throw new TypeError('signalRefs must contain safe ResearchSignal references')
  if (report.reportType === 'valuation' && report.sections.some((section: ResearchReportSection) => (section.evidenceLinks ?? []).some((item: string) => typeof item !== 'string' || !/^https:\/\//i.test(item)))) throw new TypeError('valuation evidenceLinks must be HTTPS URLs')
  if (typeof report.outputPath !== 'string' || report.outputPath.trim() === '' || isAbsolute(report.outputPath) || report.outputPath.split(/[\\/]+/).includes('..')) throw new TypeError('outputPath must be a safe relative file path')
  return report
}

export function summarizeResearchReport(report: ResearchReport): ResearchReportSummary {
  validateResearchReport(report)
  return {
    reportId: report.reportId,
    reportType: report.reportType,
    subjectRefs: report.subjectRefs,
    generatedAt: report.generatedAt,
    asOf: report.asOf,
    workflowRunId: report.workflowRunId,
    knowledgeBaseRevision: report.knowledgeBaseRevision,
    sourceCount: report.sourceRefs.length,
    claimCount: report.claimRefs.length,
    sectionCount: report.sections.length,
    methodology: report.methodology,
  }
}

export function renderResearchReport(report: ResearchReport): string {
  const title = report.reportType === 'daily_brief' ? 'Daily Intelligence Brief' : report.reportType === 'earnings_review' ? 'Earnings Review' : report.reportType === 'valuation' ? 'Valuation' : report.reportType === 'event_research' ? 'Event Research' : report.reportType === 'thesis_red_team' ? 'Thesis Red Team' : report.reportType === 'industry_research' ? 'Industry Research' : report.reportType === 'thesis_lifecycle' ? 'Thesis Lifecycle' : 'Company Research'
  const lines = [`# ${title}`, '', `- Report: ${report.reportId}`, `- As of: ${report.asOf}`, `- Knowledge revision: ${report.knowledgeBaseRevision}`, '', `Methodology: ${report.methodology}`, '']
  for (const section of report.sections) { lines.push(`## ${section.title}`, '', section.markdown.trim(), ''); if (section.sourceRefs?.length) lines.push(`Sources: ${section.sourceRefs.join(', ')}`, ''); if (section.relationRefs?.length) lines.push(`Relations: ${section.relationRefs.join(', ')}`, ''); if (section.claimRefs?.length) lines.push(`Claims: ${section.claimRefs.join(', ')}`, ''); if (report.reportType === 'valuation' && section.evidenceLinks?.length) lines.push('External evidence:', ...section.evidenceLinks.map((url) => `- <${url}>`), '') }
  return `${lines.join('\n').trim()}\n`
}

export async function writeResearchReport(report: ResearchReport, reportRoot: string): Promise<string> {
  validateResearchReport(report)
  const outputPath = resolve(reportRoot, report.outputPath)
  if (!inside(resolve(reportRoot), outputPath)) throw new TypeError('Report outputPath escapes reportRoot')
  await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, renderResearchReport(report), 'utf8'); await writeFile(`${outputPath}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); return outputPath
}

export async function readResearchReport(path: string): Promise<ResearchReport> { const value = JSON.parse(await readFile(path, 'utf8')) as ResearchReport; return validateResearchReport(value) }
