import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { CompanyMethodExecution, CompanyResearchQuality } from '../../workflows/company-deep-research/content-quality.ts'

export interface ResearchReportSection { readonly id: string; readonly title: string; readonly markdown: string; readonly sourceRefs?: readonly string[]; readonly claimRefs?: readonly string[]; readonly relationRefs?: readonly string[]; readonly signalRefs?: readonly string[]; readonly evidenceLinks?: readonly string[]; readonly evidenceLocations?: readonly { readonly sourceCandidateId?: string; readonly url?: string; readonly locator: string; readonly excerpt?: string }[] }
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
  readonly researchQuality?: CompanyResearchQuality
  readonly methodExecutions?: readonly CompanyMethodExecution[]
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
  readonly verifiedName?: string
}

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const externalEvidenceReportTypes = new Set<ResearchReport['reportType']>(['company_research', 'valuation', 'earnings_review'])
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
  if (report.researchQuality !== undefined && (typeof report.researchQuality.passed !== 'boolean' || !['complete', 'incomplete'].includes(report.researchQuality.status) || report.researchQuality.passed !== (report.researchQuality.status === 'complete') || !Array.isArray(report.researchQuality.issues) || !Array.isArray(report.researchQuality.sectionChecks) || !Number.isInteger(report.researchQuality.coreCoverage?.completed) || !Number.isInteger(report.researchQuality.coreCoverage?.required) || report.researchQuality.coreCoverage.completed < 0 || report.researchQuality.coreCoverage.completed > report.researchQuality.coreCoverage.required)) throw new TypeError('researchQuality metadata is invalid')
  if (report.researchQuality !== undefined && (report.researchQuality.issues.some((item) => typeof item !== 'string' || !item.trim()) || report.researchQuality.sectionChecks.some((item) => !item || !safeId.test(item.sectionId) || typeof item.core !== 'boolean' || typeof item.passed !== 'boolean' || !Array.isArray(item.reasons) || item.reasons.some((reason) => typeof reason !== 'string' || !reason.trim()) || item.passed !== (item.reasons.length === 0)) || (report.researchQuality.passed && (report.researchQuality.issues.length > 0 || report.researchQuality.coreCoverage.completed !== report.researchQuality.coreCoverage.required)))) throw new TypeError('researchQuality checks are inconsistent')
  const semanticReview = report.researchQuality?.semanticReview
  if (semanticReview !== undefined && (typeof semanticReview.passed !== 'boolean' || !['passed', 'failed', 'cancelled'].includes(semanticReview.status) || semanticReview.passed !== (semanticReview.status === 'passed') || !Number.isInteger(semanticReview.attempts) || semanticReview.attempts < 0 || semanticReview.attempts > 4 || (semanticReview.rounds !== undefined && (!Number.isInteger(semanticReview.rounds) || semanticReview.rounds < 0 || semanticReview.rounds > 2)) || !Array.isArray(semanticReview.sectionChecks) || !Array.isArray(semanticReview.issues) || !Array.isArray(semanticReview.diagnostics) || (semanticReview.passed && (semanticReview.issues.length !== 0 || semanticReview.sectionChecks.length !== 16)))) throw new TypeError('researchQuality semantic review is invalid')
  if (report.methodExecutions !== undefined && (!Array.isArray(report.methodExecutions) || report.methodExecutions.some((item) => typeof item.skillId !== 'string' || !safeId.test(item.skillId) || !['complete', 'completed', 'incomplete', 'insufficient_evidence', 'failed', 'cancelled'].includes(item.status) || !Number.isInteger(item.attempts) || item.attempts < 0 || item.attempts > 2))) throw new TypeError('methodExecutions metadata is invalid')
  if (!report.sections || report.sections.length === 0 || report.sections.some((section: ResearchReportSection) => !safeId.test(section.id) || section.title.trim() === '' || section.markdown.trim() === '')) throw new TypeError('sections must contain non-empty Markdown sections')
  if (report.sections.some((section: ResearchReportSection) => (section.sourceRefs ?? []).some((item: string) => !/^source:[^\s]+$/.test(item)) || (section.claimRefs ?? []).some((item: string) => !/^claim:[^\s]+$/.test(item)))) throw new TypeError('section references must be canonical Source/Claim references')
  if (report.sections.some((section: ResearchReportSection) => (section.relationRefs ?? []).some((item: string) => !/^relation:[^\s]+$/.test(item)))) throw new TypeError('section relationRefs must be canonical Relation references')
  if (report.sections.some((section: ResearchReportSection) => (section.signalRefs ?? []).some((item: string) => !safeId.test(item)))) throw new TypeError('signalRefs must contain safe ResearchSignal references')
  if (externalEvidenceReportTypes.has(report.reportType) && report.sections.some((section: ResearchReportSection) => (section.evidenceLinks ?? []).some((item: string) => typeof item !== 'string' || !/^https:\/\//i.test(item)))) throw new TypeError('report evidenceLinks must be HTTPS URLs')
  if (report.sections.some((section) => (section.evidenceLocations ?? []).some((item) => typeof item.locator !== 'string' || !item.locator.trim() || (item.url !== undefined && !/^https:\/\//i.test(item.url))))) throw new TypeError('report evidenceLocations require a locator and HTTPS URL when supplied')
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
    ...(report.verifiedSecurityIdentity?.verifiedName ? { verifiedName: report.verifiedSecurityIdentity.verifiedName } : {}),
  }
}

function normalizeCompanySectionMarkdown(markdown: string): string {
  const sourceLines = markdown.trim().split(/\r?\n/)
  const output: string[] = []
  let inFence = false
  const pushHeading = (heading: string): void => {
    if (output.length && output[output.length - 1] !== '') output.push('')
    output.push(heading)
  }
  const pushParagraph = (paragraph: string): void => {
    const content = paragraph.trim()
    if (content) output.push(content)
  }
  const pushTableHeader = (header: string): void => {
    if (output.length && output[output.length - 1] !== '') output.push('')
    output.push(header.trim())
  }
  const tableHeaderStart = (line: string, nextLine: string | undefined): number | undefined => {
    if (!nextLine || !/^\s*\|?\s*:?-{3,}/.test(nextLine)) return undefined
    const separatorPipeCount = (nextLine.match(/\|/g) ?? []).length
    if (separatorPipeCount === 0) return undefined
    for (let start = line.indexOf('|'); start >= 0; start = line.indexOf('|', start + 1)) {
      const candidate = line.slice(start).trim()
      const candidatePipeCount = (candidate.match(/\|/g) ?? []).length
      if (Math.abs(candidatePipeCount - separatorPipeCount) <= 1) return start
    }
    return undefined
  }
  const appendInlineHeadingContent = (text: string, markerLevel: number, markerIndex: number): void => {
    // Some model outputs place an inline heading inside a table cell. Once a
    // heading marker is recognized, those boundary pipes are formatting
    // debris rather than meaningful prose or table structure.
    const headingText = text.trim().replace(/^\|\s*/, '').replace(/\s*\|$/, '').trim()
    if (!headingText) return
    // Research Skills write Chinese headings without spaces, then separate the
    // heading from its flattened body with one space. A short first token
    // followed by a substantial sentence is the unambiguous report shape.
    const bodyBoundary = headingText.search(/[ \t]/)
    const title = bodyBoundary > 0 ? headingText.slice(0, bodyBoundary) : ''
    const body = bodyBoundary > 0 ? headingText.slice(bodyBoundary).trim() : ''
    const hasCjkTitle = /[\u3400-\u9fff]/.test(title)
    const splitHeadingFromBody = title.length <= 48 && hasCjkTitle && body.length >= 20
    const level = Math.min(Math.max(3, markerLevel + (markerIndex > 0 ? 1 : 0)), 6)
    if (splitHeadingFromBody) {
      pushHeading(`${'#'.repeat(level)} ${title}`)
      pushParagraph(body)
    } else if (headingText.length > 48) {
      // An unusually long heading is more likely flattened prose; retain it as
      // prose rather than creating a visually dominant heading.
      pushParagraph(headingText)
    } else {
      pushHeading(`${'#'.repeat(level)} ${headingText}`)
    }
  }
  const appendLine = (line: string, nextLine: string | undefined): void => {
    const headerStart = tableHeaderStart(line, nextLine)
    const contentLine = headerStart === undefined ? line : line.slice(0, headerStart)
    const markers = [...contentLine.matchAll(/(^|[ \t]+)(#{1,6})[ \t]+(?=\S)/g)]
    if (markers.length === 0) {
      pushParagraph(contentLine)
      if (headerStart !== undefined) pushTableHeader(line.slice(headerStart))
      return
    }
    const firstMarkerStart = markers[0]!.index ?? 0
    pushParagraph(contentLine.slice(0, firstMarkerStart).replace(/^\s*\|\s*$/, ''))
    for (let markerIndex = 0; markerIndex < markers.length; markerIndex += 1) {
      const marker = markers[markerIndex]!
      const markerStart = (marker.index ?? 0) + marker[1].length
      const markerWhitespaceLength = marker[0].length - marker[1].length - marker[2].length
      const contentStart = markerStart + marker[2].length + markerWhitespaceLength
      const contentEnd = markers[markerIndex + 1]?.index ?? contentLine.length
      appendInlineHeadingContent(contentLine.slice(contentStart, contentEnd), marker[2].length, markerIndex)
    }
    if (headerStart !== undefined) pushTableHeader(line.slice(headerStart))
  }
  for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
    const line = sourceLines[lineIndex]!
    if (/^\s*```/.test(line)) { inFence = !inFence; output.push(line); continue }
    if (inFence) { output.push(line); continue }
    appendLine(line, sourceLines[lineIndex + 1])
  }
  // Semantic output may repeat the same locator in adjacent citation bundles
  // when a table row and its explanatory sentence both bind the same source.
  // Collapse duplicates only within one contiguous bundle so separate claims
  // on the same paragraph keep their own citations.
  return output.join('\n').replace(/(?:\s*\[[^\]\s]+@paragraph:\d+\])+/g, (bundle) =>
    [...new Set(bundle.match(/\[[^\]\s]+@paragraph:\d+\]/g) ?? [])].join(' '),
  )
}

export function renderResearchReport(report: ResearchReport): string {
  const title = report.reportType === 'daily_brief' ? 'Daily Intelligence Brief' : report.reportType === 'earnings_review' ? 'Earnings Review' : report.reportType === 'valuation' ? 'Valuation' : report.reportType === 'event_research' ? 'Event Research' : report.reportType === 'thesis_red_team' ? 'Thesis Red Team' : report.reportType === 'industry_research' ? 'Industry Research' : report.reportType === 'thesis_lifecycle' ? 'Thesis Lifecycle' : 'Company Research'
  const company = report.reportType === 'company_research'
  const lines = [`# ${company ? `${report.verifiedSecurityIdentity?.verifiedName ?? ''}公司研究报告` : title}`, '', `- Report: ${report.reportId}`, `- As of: ${report.asOf}`, `- Knowledge revision: ${report.knowledgeBaseRevision}`, '', `Methodology: ${report.methodology}`, '']
  if (report.researchQuality) lines.push(`研究完成度：${report.researchQuality.passed ? '通过' : '未完成'}（核心覆盖 ${report.researchQuality.coreCoverage.completed}/${report.researchQuality.coreCoverage.required}）`, '', ...(report.researchQuality.issues.length ? ['研究缺口：', ...report.researchQuality.issues.map((item) => `- ${item}`), ''] : []))
  for (const section of report.sections) { const markdown = company ? normalizeCompanySectionMarkdown(section.markdown) : section.markdown.trim(); lines.push(`## ${company ? COMPANY_SECTION_TITLES[section.id] ?? section.title : section.title}`, '', markdown, ''); if (section.sourceRefs?.length) lines.push(`Sources: ${section.sourceRefs.join(', ')}`, ''); if (section.relationRefs?.length) lines.push(`Relations: ${section.relationRefs.join(', ')}`, ''); if (section.claimRefs?.length) lines.push(`Claims: ${section.claimRefs.join(', ')}`, ''); if (externalEvidenceReportTypes.has(report.reportType) && section.evidenceLinks?.length) lines.push('External evidence:', ...section.evidenceLinks.map((url) => `- <${url}>`), ''); if (section.evidenceLocations?.length) lines.push('证据定位：', ...section.evidenceLocations.map((item) => `- ${item.sourceCandidateId ?? ''} ${item.url ? `[原文](${item.url})` : ''} ${item.locator}${item.excerpt ? `：${item.excerpt}` : ''}`), '') }
  return `${lines.join('\n').trim()}\n`
}
const COMPANY_SECTION_TITLES: Readonly<Record<string, string>> = { 'company-overview': '公司概况与发展历程', 'business-model': '商业模式', 'business-segments': '业务分部', 'revenue-profit-drivers': '收入与利润驱动', products: '产品与服务', technologies: '技术与壁垒', 'industry-exposure': '行业与市场空间', 'supply-chain': '供应链', competition: '竞争格局', 'financial-quality': '财务质量', 'growth-drivers': '增长驱动', 'management-capital-allocation': '管理层、治理与资本配置', catalysts: '催化因素', risks: '风险', valuation: '估值', 'bull-base-bear': '乐观、基准与悲观情景', 'variant-perception': '预期差', 'investment-thesis': '研究结论', 'monitoring-checklist': '跟踪清单' }

export async function writeResearchReport(report: ResearchReport, reportRoot: string): Promise<string> {
  validateResearchReport(report)
  const outputPath = resolve(reportRoot, report.outputPath)
  if (!inside(resolve(reportRoot), outputPath)) throw new TypeError('Report outputPath escapes reportRoot')
  await mkdir(dirname(outputPath), { recursive: true }); await writeFile(outputPath, renderResearchReport(report), 'utf8'); await writeFile(`${outputPath}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); return outputPath
}

export async function readResearchReport(path: string): Promise<ResearchReport> { const value = JSON.parse(await readFile(path, 'utf8')) as ResearchReport; return validateResearchReport(value) }
