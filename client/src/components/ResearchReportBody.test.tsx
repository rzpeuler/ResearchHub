import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { countReportEvidenceSources, ResearchReportBody } from './ResearchReportBody'
import { LanguageProvider } from '../i18n'
import type { ResearchReport } from '../api/runtime-client'
import { reportEvidenceNavigationEvent, type ReportEvidenceNavigation } from '../app/report-evidence'

const report: ResearchReport = { reportId: 'company-report', reportType: 'company_research', subjectRefs: ['002594'], generatedAt: '2026-10-15', asOf: '2026-10-15', workflowRunId: 'run-a', knowledgeBaseRevision: 1, sourceCount: 1, claimCount: 0, sectionCount: 1, methodology: 'fixture', sourceRefs: [], claimRefs: [], sections: [{ id: 'financial-quality', title: 'Financial Quality', markdown: '## 财务对比\n\n| 指标 | 本期 | 说明 |\n|---|---:|---|\n| 收入 | **277.98亿元** | [filing-1@paragraph:5] |\n\n现金变化需要解释。\n\n- 核对现金流\n- 监控营运资本', evidenceLocations: [{ sourceCandidateId: 'filing-1', locator: 'paragraph:5', url: 'https://example.com/report.pdf', excerpt: '营业收入27798000000元。' }] }] }
const display = (value: ResearchReport) => render(<LanguageProvider><ResearchReportBody report={value} /></LanguageProvider>)
const preferenceKey = 'researchhub.report-body.preferences.v1:company-report'
const companySectionIds = ['company-overview', 'business-model', 'business-segments', 'revenue-profit-drivers', 'products', 'technologies', 'industry-exposure', 'supply-chain', 'competition', 'financial-quality', 'growth-drivers', 'management-capital-allocation', 'catalysts', 'risks', 'valuation', 'bull-base-bear', 'variant-perception', 'investment-thesis', 'monitoring-checklist']
const fullCompanyReport = (failedSectionIds: readonly string[] = []): ResearchReport => {
  const failed = new Set(failedSectionIds)
  const sections = companySectionIds.map((id) => ({ id, title: id === 'new-audit-section' ? '新审计章节' : id, markdown: `原始章节正文：${id}` }))
  const sectionChecks = companySectionIds.map((sectionId) => ({ sectionId, core: true, passed: !failed.has(sectionId), reasons: failed.has(sectionId) ? (sectionId === 'variant-perception' ? ['RESEARCH_GAP', 'VARIANT_EXPECTATION_VALUE_VERSION_UNVERIFIED'] : sectionId === 'bull-base-bear' ? ['RESEARCH_GAP', 'NO_ATTRIBUTABLE_EVIDENCE', 'WORKFLOW_SECTION_NO_LOCATED_EVIDENCE'] : ['UNRECOGNIZED_REASON']) : [] }))
  return { ...report, sectionCount: sections.length, sections, researchQuality: { passed: failed.size === 0, status: failed.size === 0 ? 'complete' : 'incomplete', coreCoverage: { completed: sections.length - failed.size, required: sections.length }, issues: failedSectionIds.map((id) => `${id}:RESEARCH_GAP`), sectionChecks } }
}
afterEach(() => { cleanup(); localStorage.removeItem('researchhub.language'); localStorage.removeItem(preferenceKey) })

describe('ResearchReportBody', () => {
  it('renders Chinese company headings and GFM tables, hides citations by default, and routes citation clicks to the appendix', () => {
    const navigations: ReportEvidenceNavigation[] = []
    const onNavigate = (event: Event) => navigations.push((event as CustomEvent<ReportEvidenceNavigation>).detail)
    window.addEventListener(reportEvidenceNavigationEvent, onNavigate)
    display(report)
    expect(screen.getByRole('heading', { name: '财务质量' })).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: '指标' })).toBeTruthy()
    expect(within(table).getByText('277.98亿元').tagName).toBe('STRONG')
    expect(screen.getByText('核对现金流').tagName).toBe('LI')
    expect(within(table).queryByRole('link', { name: '证据 1' })).toBeNull()
    expect(within(table).queryByText(/paragraph:5/)).toBeNull()
    expect(screen.queryByText('证据 1 · paragraph:5')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '正文显示证据编号' }))
    const citation = within(table).getByRole('link', { name: '证据 1' })
    fireEvent.click(citation)
    expect(navigations).toEqual([{ reportId: 'company-report', evidenceId: 'report-evidence-company-report-0' }])
    expect(localStorage.getItem(preferenceKey)).toContain('"citationsVisible":true')
    window.removeEventListener(reportEvidenceNavigationEvent, onNavigate)
  })

  it('never executes HTML or exposes unsafe URL links, including malicious evidence URLs', () => {
    const { container } = display({ ...report, sections: [{ ...report.sections[0]!, markdown: '<script>alert(1)</script>\n\n[unsafe](javascript:alert(1)) [safe](https://example.com/public)\n\n[filing-1@paragraph:5]', evidenceLocations: [{ sourceCandidateId: 'filing-1', locator: 'paragraph:5', url: 'file:///C:/secret.txt', excerpt: '<img src=x onerror=alert(1)>' }] }] })
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('link', { name: 'unsafe' })).toBeNull()
    expect(screen.getByRole('link', { name: 'safe' }).getAttribute('href')).toBe('https://example.com/public')
    expect(screen.queryByRole('link', { name: '查看公开来源' })).toBeNull()
  })

  it('shows incomplete coverage and issues without implying a saved report passed research acceptance', () => {
    display({ ...report, researchQuality: { passed: false, status: 'incomplete', coreCoverage: { completed: 12, required: 16 }, issues: ['competition:缺少具体竞争比较'], sectionChecks: [] } })
    expect(screen.getByText('研究尚未完成')).toBeTruthy()
    expect(screen.getByText('核心章节 12 / 16')).toBeTruthy()
    expect(screen.getByText('competition:缺少具体竞争比较')).toBeTruthy()
    expect(screen.queryByText('研究质量已通过')).toBeNull()
  })

  it('shows the two failed chapters for 17/19 at the top while preserving all 19 chapters and collapsed raw issues', () => {
    const value = fullCompanyReport(['bull-base-bear', 'variant-perception'])
    display(value)
    expect(screen.getByText('研究尚未完成')).toBeTruthy()
    expect(screen.getByText('核心章节 17 / 19')).toBeTruthy()
    const failedSectionList = screen.getByRole('list', { name: '未通过章节' })
    expect(within(failedSectionList).getByText('乐观、基准与悲观情景')).toBeTruthy()
    expect(within(failedSectionList).getByText('预期差')).toBeTruthy()
    expect(screen.getByText(/缺少可归属证据/)).toBeTruthy()
    expect(screen.getByText(/预期值版本未验证/)).toBeTruthy()
    expect(screen.queryByText('研究质量已通过')).toBeNull()
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(19)
    expect(screen.getByText('原始章节正文：investment-thesis')).toBeTruthy()
    const issueDisclosure = screen.getByText('查看未完成事项 · 2').closest('details') as HTMLDetailsElement
    expect(issueDisclosure.open).toBe(false)
    fireEvent.click(screen.getByText('查看未完成事项 · 2'))
    expect(within(issueDisclosure).getByText('bull-base-bear:RESEARCH_GAP')).toBeTruthy()
    expect(within(issueDisclosure).getByText('variant-perception:RESEARCH_GAP')).toBeTruthy()
  })

  it('keeps the passed state for an actually complete 19/19 report and shows no failed-section summary', () => {
    display(fullCompanyReport())
    expect(screen.getByText('研究质量已通过')).toBeTruthy()
    expect(screen.getByText('核心章节 19 / 19')).toBeTruthy()
    expect(screen.queryByRole('list', { name: '未通过章节' })).toBeNull()
  })

  it('uses the actual title and a generic reason for an unknown failed section', () => {
    const complete = fullCompanyReport()
    const value = { ...complete, sections: complete.sections.map((section) => section.id === 'company-overview' ? { id: 'new-audit-section', title: '新审计章节', markdown: '新章节原文。' } : section), researchQuality: { ...complete.researchQuality!, passed: false, status: 'incomplete' as const, coreCoverage: { completed: 18, required: 19 }, issues: ['new-audit-section:UNRECOGNIZED_REASON'], sectionChecks: complete.researchQuality!.sectionChecks.map((check) => check.sectionId === 'company-overview' ? { sectionId: 'new-audit-section', core: true, passed: false, reasons: ['UNRECOGNIZED_REASON'] } : check) } }
    display(value)
    expect(within(screen.getByRole('list', { name: '未通过章节' })).getByText('新审计章节')).toBeTruthy()
    expect(screen.getByText(/本节未通过完整研究验收，原因见审计明细/)).toBeTruthy()
    expect(screen.queryByText(/预期值版本未验证/)).toBeNull()
    expect(screen.getByText('核心章节 18 / 19')).toBeTruthy()
  })

  it('keeps legacy company reports without section checks readable and adds no inferred completion or gaps', () => {
    display({ ...report, reportType: 'company_research', sections: [{ ...report.sections[0]!, markdown: '旧公司报告正文。' }] })
    expect(screen.getByText('旧报告：未记录研究完成度')).toBeTruthy()
    expect(screen.getByText(/旧公司报告正文/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: '未通过章节' })).toBeNull()
    cleanup()
    display({ ...report, reportType: 'company_research', researchQuality: { passed: false, status: 'incomplete', coreCoverage: { completed: 1, required: 19 }, issues: ['旧事项'], sectionChecks: undefined } } as unknown as ResearchReport)
    expect(screen.getByText('研究尚未完成')).toBeTruthy()
    expect(screen.getByText(/财务对比/)).toBeTruthy()
    expect(screen.queryByRole('list', { name: '未通过章节' })).toBeNull()
  })

  it('does not add the Company Research failed-section summary to non-company report types', () => {
    const quality = fullCompanyReport(['variant-perception']).researchQuality!
    for (const reportType of ['earnings_review', 'industry_research'] as const) {
      cleanup()
      display({ ...report, reportType, researchQuality: quality })
      expect(screen.queryByRole('list', { name: '未通过章节' })).toBeNull()
      expect(screen.getByText('财务对比')).toBeTruthy()
    }
  })

  it('keeps old reports usable without new metadata and preserves other report titles', () => {
    display({ ...report, reportType: 'earnings_review', sections: [{ id: 'overview', title: 'Actual Versus Consensus', markdown: '旧报告正文。 [old-source@paragraph:1]', sourceRefs: ['source:old'] }] })
    expect(screen.getByRole('heading', { name: 'Actual Versus Consensus' })).toBeTruthy()
    expect(screen.getByText('旧报告：未记录研究完成度')).toBeTruthy()
    expect(screen.getByText(/旧报告正文/)).toBeTruthy()
    expect(screen.queryByText('[old-source@paragraph:1]')).toBeNull()
    expect(screen.getByText('来源：source:old')).toBeTruthy()
  })

  it('collapses chapters, supports chapter navigation and hiding/restoring chapters, and persists preferences by report', () => {
    const second = { ...report.sections[0]!, id: 'risks', title: 'Risks', markdown: '风险正文。', evidenceLocations: [] }
    const value = { ...report, sections: [report.sections[0]!, second] }
    const mounted = display(value)
    const financialSummary = screen.getByRole('heading', { name: '财务质量' }).closest('summary')!
    const financial = financialSummary.parentElement as HTMLDetailsElement
    fireEvent.click(financialSummary)
    expect(financial.open).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '定位到章节：Risks' }))
    const risks = screen.getByRole('heading', { name: '风险分析' }).closest('details')!
    expect(risks.open).toBe(true)
    fireEvent.click(screen.getByText('管理章节显示'))
    fireEvent.click(screen.getByRole('checkbox', { name: '风险分析' }))
    expect(screen.queryByText('风险正文。')).toBeNull()
    expect(localStorage.getItem(preferenceKey)).toContain('"hiddenSectionIds":["risks"]')
    mounted.unmount()
    display(value)
    fireEvent.click(screen.getByText('管理章节显示'))
    expect((screen.getByRole('checkbox', { name: '风险分析' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByText('风险正文。')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: '风险分析' }))
    expect(screen.getByText('风险正文。')).toBeTruthy()
    expect(localStorage.getItem(preferenceKey)).toContain('"hiddenSectionIds":[]')
  })

  it('falls back safely when stored report preferences are malformed', () => {
    localStorage.setItem(preferenceKey, '{not-json')
    display(report)
    expect((screen.getByRole('checkbox', { name: '正文显示证据编号' }) as HTMLInputElement).checked).toBe(false)
    expect(screen.queryByRole('link', { name: '证据 1' })).toBeNull()
  })

  it('counts external citations independently from KB persistence without duplicating their URLs', () => {
    expect(report.sourceRefs.length).toBe(0)
    expect(countReportEvidenceSources({ ...report, sections: [{ ...report.sections[0]!, evidenceLinks: ['https://example.com/report.pdf', 'https://example.com/other', 'file:///C:/secret'] }] })).toBe(2)
  })
})
