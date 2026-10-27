import type { ResearchReport, ResearchReportEvidenceLocation } from '../api/runtime-client'

export interface ReportEvidenceEntry { readonly id: string; readonly location: ResearchReportEvidenceLocation; readonly index: number }
export interface ReportEvidenceNavigation { readonly reportId: string; readonly evidenceId: string }
export const reportEvidenceNavigationEvent = 'researchhub:report-evidence-navigation'

export function reportEvidenceEntries(report: ResearchReport): ReportEvidenceEntry[] {
  const entries: ReportEvidenceEntry[] = []
  const seen = new Set<string>()
  for (const section of report.sections) for (const location of section.evidenceLocations ?? []) {
    const key = `${location.sourceCandidateId ?? ''}\u0000${location.locator}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ id: `report-evidence-${encodeURIComponent(report.reportId)}-${entries.length}`, location, index: entries.length + 1 })
  }
  return entries
}
