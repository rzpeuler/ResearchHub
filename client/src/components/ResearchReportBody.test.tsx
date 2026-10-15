import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { countReportEvidenceSources, ResearchReportBody } from './ResearchReportBody'
import { LanguageProvider } from '../i18n'
import type { ResearchReport } from '../api/runtime-client'

const report: ResearchReport = { reportId: 'company-report', reportType: 'company_research', subjectRefs: ['002594'], generatedAt: '2026-10-15', asOf: '2026-10-15', workflowRunId: 'run-a', knowledgeBaseRevision: 1, sourceCount: 1, claimCount: 0, sectionCount: 1, methodology: 'fixture', sourceRefs: [], claimRefs: [], sections: [{ id: 'financial-quality', title: 'Financial Quality', markdown: '## 财务对比\n\n| 指标 | 本期 | 说明 |\n|---|---:|---|\n| 收入 | **277.98亿元** | [filing-1@paragraph:5] |\n\n现金变化需要解释。\n\n- 核对现金流\n- 监控营运资本', evidenceLocations: [{ sourceCandidateId: 'filing-1', locator: 'paragraph:5', url: 'https://example.com/report.pdf', excerpt: '营业收入27798000000元。' }] }] }
const display = (value: ResearchReport) => render(<LanguageProvider><ResearchReportBody report={value} /></LanguageProvider>)
afterEach(() => { cleanup(); localStorage.removeItem('researchhub.language') })

describe('ResearchReportBody', () => {
  it('renders Chinese company headings and GFM financial tables, with expandable exact evidence', () => {
    display(report)
    expect(screen.getByRole('heading', { name: '财务质量' })).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByRole('columnheader', { name: '指标' })).toBeTruthy()
    expect(within(table).getByText('277.98亿元').tagName).toBe('STRONG')
    expect(screen.getByText('核对现金流').tagName).toBe('LI')
    const citation = within(table).getByRole('link', { name: '证据 1' })
    fireEvent.click(citation)
    const evidence = screen.getByText('证据 1 · paragraph:5').closest('details')!
    expect(evidence.open).toBe(true)
    expect(within(evidence).getByText('营业收入27798000000元。')).toBeTruthy()
    expect(within(evidence).getByRole('link', { name: '查看公开来源' }).getAttribute('href')).toBe('https://example.com/report.pdf')
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

  it('keeps old reports usable without new metadata and preserves other report titles', () => {
    display({ ...report, reportType: 'earnings_review', sections: [{ id: 'overview', title: 'Actual Versus Consensus', markdown: '旧报告正文。 [old-source@paragraph:1]', sourceRefs: ['source:old'] }] })
    expect(screen.getByRole('heading', { name: 'Actual Versus Consensus' })).toBeTruthy()
    expect(screen.getByText('旧报告：未记录研究完成度')).toBeTruthy()
    expect(screen.getByText(/旧报告正文/)).toBeTruthy()
    expect(screen.getByText('[old-source@paragraph:1]')).toBeTruthy()
    expect(screen.getByText('来源：source:old')).toBeTruthy()
  })

  it('counts external citations independently from KB persistence without duplicating their URLs', () => {
    expect(report.sourceRefs.length).toBe(0)
    expect(countReportEvidenceSources({ ...report, sections: [{ ...report.sections[0]!, evidenceLinks: ['https://example.com/report.pdf', 'https://example.com/other', 'file:///C:/secret'] }] })).toBe(2)
  })
})
