import { useRef, type ReactNode } from 'react'
import type { ResearchReport, ResearchReportEvidenceLocation } from '../api/runtime-client'
import { useLanguage } from '../i18n'

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

function ReportSection({ report, section, sectionIndex }: { report: ResearchReport; section: ResearchReport['sections'][number]; sectionIndex: number }) {
  const { t } = useLanguage()
  const detailRefs = useRef(new Map<string, HTMLDetailsElement>())
  const locations = section.evidenceLocations ?? []
  const anchor = (index: number) => `report-evidence-${encodeURIComponent(report.reportId)}-${sectionIndex}-${index}`
  const find = (source: string, locator: string): number => locations.findIndex((location) => location.sourceCandidateId === source && location.locator === locator)
  const inline = (text: string): ReactNode => {
    const result: ReactNode[] = []; let start = 0
    const pattern = /\[([^\]\s]+)@(paragraph:\d+)\]|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g
    for (const match of text.matchAll(pattern)) {
      if (match.index! > start) result.push(text.slice(start, match.index))
      const key = `${match.index}-${result.length}`
      if (match[1]) { const found = find(match[1], match[2]!); result.push(found >= 0 ? <a className="research-report-citation" key={key} href={`#${anchor(found)}`} onClick={() => { const detail = detailRefs.current.get(anchor(found)); if (detail) detail.open = true }}>{t('证据', 'Evidence')} {found + 1}</a> : <span className="research-report-unresolved" key={key} title={t('旧报告或缺少段落原文', 'Legacy report or excerpt unavailable')}>{match[0]}</span>) }
      else if (match[3]) { const url = safeReportUrl(match[4]); result.push(url ? <a key={key} href={url} target="_blank" rel="noopener noreferrer">{match[3]}</a> : <span key={key}>{match[3]}</span>) }
      else if (match[5]) result.push(<strong key={key}>{match[5]}</strong>)
      else result.push(<code key={key}>{match[6]}</code>)
      start = match.index! + match[0].length
    }
    if (start < text.length) result.push(text.slice(start))
    return result
  }
  const evidence = (location: ResearchReportEvidenceLocation, index: number) => {
    const url = safeReportUrl(location.url)
    return <details className="research-report-evidence" id={anchor(index)} key={index} ref={(element) => { if (element) detailRefs.current.set(anchor(index), element); else detailRefs.current.delete(anchor(index)) }}><summary>{t('证据', 'Evidence')} {index + 1} · {location.locator}</summary><div><p className="muted">{location.sourceCandidateId}</p>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{t('查看公开来源', 'Open public source')}</a> : null}<blockquote>{location.excerpt || t('此旧报告未保存段落原文。', 'This legacy report has no saved excerpt.')}</blockquote></div></details>
  }
  const title = report.reportType === 'company_research' && titles[section.id] ? t(titles[section.id]!, section.title) : section.title
  return <article className="brief-section research-report-section"><div className="brief-section-heading"><h3>{title}</h3><span>{section.id}</span></div><div className="research-report-markdown"><ReportMarkdown markdown={section.markdown} inline={inline} /></div>{locations.length ? <div className="research-report-evidence-list" aria-label={t('章节证据', 'Section evidence')}>{locations.map(evidence)}</div> : null}{section.sourceRefs?.length ? <small>{t('来源：', 'Sources: ')}{section.sourceRefs.join(', ')}</small> : null}{section.claimRefs?.length ? <small>{t('主张：', 'Claims: ')}{section.claimRefs.join(', ')}</small> : null}{section.relationRefs?.length ? <small>{t('关系：', 'Relations: ')}{section.relationRefs.join(', ')}</small> : null}</article>
}

export function ResearchReportBody({ report }: { report: ResearchReport }) {
  const { t } = useLanguage()
  const quality = report.researchQuality
  return <><section className={`research-report-quality ${quality?.passed ? 'passed' : 'incomplete'}`} aria-label={t('研究完成度', 'Research completion')}><strong>{quality ? quality.passed ? t('研究质量已通过', 'Research quality passed') : t('研究尚未完成', 'Research incomplete') : t('旧报告：未记录研究完成度', 'Legacy report: completion not recorded')}</strong>{quality ? <><p>{t('核心章节', 'Core sections')} {quality.coreCoverage.completed} / {quality.coreCoverage.required}</p>{quality.issues.length ? <details><summary>{t('查看未完成事项', 'View remaining issues')} · {quality.issues.length}</summary><ul>{quality.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details> : null}</> : null}</section>{report.sections.map((section, sectionIndex) => <ReportSection key={section.id} report={report} section={section} sectionIndex={sectionIndex} />)}</>
}
