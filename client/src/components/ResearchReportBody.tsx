import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ResearchReport } from '../api/runtime-client'
import { useLanguage } from '../i18n'
import { reportEvidenceEntries, reportEvidenceNavigationEvent, type ReportEvidenceEntry } from '../app/report-evidence'

const titles: Readonly<Record<string, string>> = {
  'company-overview': '公司概况与战略沿革', 'business-model': '商业模式', 'business-segments': '业务分部', 'revenue-profit-drivers': '收入与利润驱动', products: '产品分析', technologies: '技术竞争力', 'industry-exposure': '行业与市场空间', 'supply-chain': '供应链', competition: '竞争格局', 'financial-quality': '财务质量', 'growth-drivers': '增长驱动', 'management-capital-allocation': '管理层、治理与资本配置', catalysts: '催化剂', risks: '风险分析', valuation: '估值', 'bull-base-bear': '乐观、基准与悲观情景', 'variant-perception': '预期差', 'investment-thesis': '研究结论与投资论点', 'monitoring-checklist': '监控清单',
}
export function safeReportUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}
export function countReportEvidenceSources(report: ResearchReport): number {
  const sources = new Set<string>()
  const attributedUrls = new Set<string>()
  for (const section of report.sections) for (const location of section.evidenceLocations ?? []) {
    const url = safeReportUrl(location.url)
    if (location.sourceCandidateId) { sources.add(`candidate:${location.sourceCandidateId}`); if (url) attributedUrls.add(url) }
  }
  for (const section of report.sections) for (const raw of [...section.evidenceLinks ?? [], ...(section.evidenceLocations ?? []).map((location) => location.url ?? '')]) {
    const url = safeReportUrl(raw)
    if (url && !attributedUrls.has(url)) sources.add(`url:${url}`)
  }
  return sources.size
}
function tableCells(line: string): string[] { return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|')) }
function tableDivider(line: string): boolean { const cells = tableCells(line); return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell)) }

function ReportMarkdown({ markdown, inline }: { markdown: string; inline: (text: string) => ReactNode }): ReactNode {
  const lines = markdown.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (!line.trim()) { index++; continue }
    if (line.includes('|') && index + 1 < lines.length && tableDivider(lines[index + 1]!)) {
      const headers = tableCells(line); const rows: string[][] = []; index += 2
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) rows.push(tableCells(lines[index++]!))
      blocks.push(<div className="research-report-table-scroll" key={`table-${index}`}><table><thead><tr>{headers.map((cell, column) => <th scope="col" key={column}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{headers.map((_, column) => <td key={column}>{inline(row[column] ?? '')}</td>)}</tr>)}</tbody></table></div>); continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) { blocks.push(<h4 key={`heading-${index}`}>{inline(heading[2]!)}</h4>); index++; continue }
    if (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line); const items: string[] = []
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)/ : /^\s*[-*+]\s+(.+)/
      while (index < lines.length && pattern.test(lines[index]!)) items.push(pattern.exec(lines[index++]!)![1]!)
      const children = items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)
      blocks.push(ordered ? <ol key={`list-${index}`}>{children}</ol> : <ul key={`list-${index}`}>{children}</ul>); continue
    }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { blocks.push(<hr key={`rule-${index}`} />); index++; continue }
    if (/^```/.test(line)) { const code: string[] = []; index++; while (index < lines.length && !/^```/.test(lines[index]!)) code.push(lines[index++]!); if (index < lines.length) index++; blocks.push(<pre key={`code-${index}`}><code>{code.join('\n')}</code></pre>); continue }
    const paragraph = [line]; index++
    while (index < lines.length && lines[index]!.trim() && !/^(?:#{1,6}\s|```|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[index]!) && !(lines[index]!.includes('|') && index + 1 < lines.length && tableDivider(lines[index + 1]!))) paragraph.push(lines[index++]!)
    blocks.push(<p key={`paragraph-${index}`}>{inline(paragraph.join('\n'))}</p>)
  }
  return <>{blocks}</>
}

type ReportPreferences = { citationsVisible: boolean; hiddenSectionIds: string[] }
const defaultPreferences: ReportPreferences = { citationsVisible: false, hiddenSectionIds: [] }
function preferencesKey(reportId: string): string { return `researchhub.report-body.preferences.v1:${reportId}` }
function readPreferences(reportId: string): ReportPreferences {
  try {
    if (typeof window === 'undefined') return defaultPreferences
    const raw = window.localStorage.getItem(preferencesKey(reportId))
    if (!raw) return defaultPreferences
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaultPreferences
    const value = parsed as Record<string, unknown>
    return { citationsVisible: value.citationsVisible === true, hiddenSectionIds: Array.isArray(value.hiddenSectionIds) ? [...new Set(value.hiddenSectionIds.filter((id): id is string => typeof id === 'string'))] : [] }
  } catch { return defaultPreferences }
}

function ReportSection({ report, section, sectionIndex, evidenceByKey, showCitations, onCitationClick }: { report: ResearchReport; section: ResearchReport['sections'][number]; sectionIndex: number; evidenceByKey: Map<string, ReportEvidenceEntry>; showCitations: boolean; onCitationClick: (id: string) => void }) {
  const { t } = useLanguage()
  const anchor = `report-section-${encodeURIComponent(report.reportId)}-${sectionIndex}`
  const find = (source: string, locator: string) => evidenceByKey.get(`${source}\u0000${locator}`)
  const inline = (text: string): ReactNode => {
    const result: ReactNode[] = []; let start = 0
    const pattern = /\[([^\]\s]+)@(paragraph:\d+)\]|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g
    for (const match of text.matchAll(pattern)) {
      if (match.index! > start) result.push(text.slice(start, match.index))
      const key = `${match.index}-${result.length}`
      if (match[1]) { const found = find(match[1], match[2]!); result.push(showCitations && found ? <a className="research-report-citation" key={key} href={`#${found.id}`} onClick={(event) => { event.preventDefault(); onCitationClick(found.id) }}>{t('证据', 'Evidence')} {found.index}</a> : null) }
      else if (match[3]) { const url = safeReportUrl(match[4]); result.push(url ? <a key={key} href={url} target="_blank" rel="noopener noreferrer">{match[3]}</a> : <span key={key}>{match[3]}</span>) }
      else if (match[5]) result.push(<strong key={key}>{match[5]}</strong>)
      else result.push(<code key={key}>{match[6]}</code>)
      start = match.index! + match[0].length
    }
    if (start < text.length) result.push(text.slice(start))
    return result
  }
  const title = report.reportType === 'company_research' && titles[section.id] ? t(titles[section.id]!, section.title) : section.title
  return <details className="brief-section research-report-section" id={anchor} open><summary className="brief-section-heading"><h3>{title}</h3><span>{section.id}</span></summary><div className="research-report-section-content"><div className="research-report-markdown"><ReportMarkdown markdown={section.markdown} inline={inline} /></div>{section.sourceRefs?.length ? <small>{t('来源：', 'Sources: ')}{section.sourceRefs.join(', ')}</small> : null}{section.claimRefs?.length ? <small>{t('主张：', 'Claims: ')}{section.claimRefs.join(', ')}</small> : null}{section.relationRefs?.length ? <small>{t('关系：', 'Relations: ')}{section.relationRefs.join(', ')}</small> : null}</div></details>
}

export function ResearchReportBody({ report }: { report: ResearchReport }) {
  return <ResearchReportBodyForReport key={report.reportId} report={report} />
}

function ResearchReportBodyForReport({ report }: { report: ResearchReport }) {
  const { t } = useLanguage()
  const [preferences, setPreferences] = useState(() => readPreferences(report.reportId))
  const sectionRefs = useRef(new Map<string, HTMLDetailsElement>())
  useEffect(() => { try { if (typeof window !== 'undefined') window.localStorage.setItem(preferencesKey(report.reportId), JSON.stringify(preferences)) } catch { /* Storage may be disabled or full. */ } }, [report.reportId, preferences])
  const evidenceEntries = reportEvidenceEntries(report)
  const evidenceByKey = new Map(evidenceEntries.flatMap((entry) => entry.location.sourceCandidateId ? [[`${entry.location.sourceCandidateId}\u0000${entry.location.locator}`, entry] as const] : []))
  const visibleSections = report.sections.map((section) => !preferences.hiddenSectionIds.includes(section.id))
  const toggleHiddenSection = (id: string) => setPreferences((current) => ({ ...current, hiddenSectionIds: current.hiddenSectionIds.includes(id) ? current.hiddenSectionIds.filter((hidden) => hidden !== id) : [...current.hiddenSectionIds, id] }))
  const scrollToSection = (id: string) => { const element = sectionRefs.current.get(id); if (element) { element.open = true; element.scrollIntoView?.({ behavior: 'smooth', block: 'start' }) } }
  const navigateToEvidence = (evidenceId: string) => { window.dispatchEvent(new CustomEvent(reportEvidenceNavigationEvent, { detail: { reportId: report.reportId, evidenceId } })) }
  const quality = report.researchQuality
  return <div className="research-report-body"><section className={`research-report-quality ${quality?.passed ? 'passed' : 'incomplete'}`} aria-label={t('研究完成度', 'Research completion')}><strong>{quality ? quality.passed ? t('研究质量已通过', 'Research quality passed') : t('研究尚未完成', 'Research incomplete') : t('旧报告：未记录研究完成度', 'Legacy report: completion not recorded')}</strong>{quality ? <><p>{t('核心章节', 'Core sections')} {quality.coreCoverage.completed} / {quality.coreCoverage.required}</p>{quality.issues.length ? <details><summary>{t('查看未完成事项', 'View remaining issues')} · {quality.issues.length}</summary><ul>{quality.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details> : null}</> : null}</section>
    <div className="research-report-body-controls"><label><input type="checkbox" checked={preferences.citationsVisible} onChange={(event) => setPreferences((current) => ({ ...current, citationsVisible: event.target.checked }))} />{t('正文显示证据编号', 'Show inline evidence citations')}</label><details><summary>{t('管理章节显示', 'Manage visible chapters')}</summary><fieldset><legend>{t('显示的章节', 'Visible chapters')}</legend>{report.sections.map((section) => <label key={section.id}><input type="checkbox" checked={visibleSections[report.sections.indexOf(section)]} onChange={() => toggleHiddenSection(section.id)} />{titles[section.id] ? t(titles[section.id]!, section.title) : section.title}</label>)}</fieldset></details></div>
    <nav className="research-report-section-locator" aria-label={t('章节定位', 'Chapter navigation')}>{report.sections.map((section, index) => visibleSections[index] ? <button type="button" key={`${section.id}-${index}`} aria-label={t(`定位到章节：${section.title}`, `Go to chapter: ${section.title}`)} title={section.title} onClick={() => scrollToSection(`report-section-${encodeURIComponent(report.reportId)}-${index}`)}>•</button> : null)}</nav>
    {report.sections.map((section, sectionIndex) => visibleSections[sectionIndex] ? <div key={`${section.id}-${sectionIndex}`} ref={(element) => { const id = `report-section-${encodeURIComponent(report.reportId)}-${sectionIndex}`; if (element) sectionRefs.current.set(id, element.querySelector('details')!); else sectionRefs.current.delete(id) }}><ReportSection report={report} section={section} sectionIndex={sectionIndex} evidenceByKey={evidenceByKey} showCitations={preferences.citationsVisible} onCitationClick={navigateToEvidence} /></div> : null)}
  </div>
}
