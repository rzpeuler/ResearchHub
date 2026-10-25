import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResearchSkillDetail, ResearchSkillSummary, RuntimeClient } from '../../api/runtime-client'
import { LanguageProvider } from '../../i18n'
import { ResearchSkillsPage } from './ResearchSkillsPage'

const summaries: readonly ResearchSkillSummary[] = [
  { id: 'zeta_skill', domain: 'Valuation', purpose: 'Zeta purpose', invocationMatch: 'Use Zeta', inputs: ['forecast'], produces: ['value'], executionClass: 'DETERMINISTIC_EXECUTABLE', origin: 'canonical' },
  { id: 'business_driver_analysis', domain: 'Company Economics', purpose: 'Driver analysis', invocationMatch: 'Analyze drivers', inputs: ['periods'], produces: ['drivers'], executionClass: 'DETERMINISTIC_EXECUTABLE', origin: 'canonical' },
  { id: 'external_research', purpose: 'External purpose', invocationMatch: 'Use external', inputs: ['context'], produces: ['report'], origin: 'external' },
]

function detail(summary: ResearchSkillSummary): ResearchSkillDetail { return { ...summary, methodology: `# ${summary.id}\n\nMethodology details.` } }
function renderPage(client: RuntimeClient): void { render(<LanguageProvider><ResearchSkillsPage client={client} /></LanguageProvider>) }

describe('ResearchSkillsPage', () => {
  beforeEach(() => window.localStorage.setItem('researchhub.language', 'en'))
  afterEach(() => cleanup())

  it('groups by research domain, puts unknown external skills under Other, and loads the selected skill details', async () => {
    const client = { listResearchSkills: vi.fn(async () => summaries), getResearchSkill: vi.fn(async (id: string) => detail(summaries.find((skill) => skill.id === id)!)) } as unknown as RuntimeClient
    renderPage(client)

    expect(await screen.findByText('Company Economics')).toBeTruthy()
    expect(screen.getByText('Valuation')).toBeTruthy()
    expect(screen.getByText('Other')).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Business Driver Analysis' })).toBeTruthy()
    expect(screen.getByText('Driver analysis')).toBeTruthy()
    expect(screen.getByText(/Methodology details\./)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /zeta_skill/ }))
    expect(await screen.findByRole('heading', { name: 'Zeta Skill' })).toBeTruthy()
    expect(screen.getByText('Zeta purpose')).toBeTruthy()
    expect(client.getResearchSkill).toHaveBeenCalledWith('zeta_skill')
  })

  it('shows an empty state when no executable research skills are registered', async () => {
    const client = { listResearchSkills: vi.fn(async () => []), getResearchSkill: vi.fn() } as unknown as RuntimeClient
    renderPage(client)
    expect(await screen.findByText('There are no available research skills.')).toBeTruthy()
    expect(screen.getByText('No research skills to display')).toBeTruthy()
  })

  it('keeps the directory available and retries a failed selected-skill detail', async () => {
    const getResearchSkill = vi.fn().mockRejectedValueOnce(new Error('Methodology unavailable')).mockImplementationOnce(async (id: string) => detail(summaries.find((skill) => skill.id === id)!))
    const client = { listResearchSkills: vi.fn(async () => summaries), getResearchSkill } as unknown as RuntimeClient
    renderPage(client)
    expect(await screen.findByText('Methodology unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: /business_driver_analysis/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry details' }))
    expect(await screen.findByText('Driver analysis')).toBeTruthy()
    expect(getResearchSkill).toHaveBeenCalledTimes(2)
  })

  it('shows retry for a failed directory request', async () => {
    const listResearchSkills = vi.fn().mockRejectedValueOnce(new Error('Directory unavailable')).mockResolvedValueOnce(summaries)
    const client = { listResearchSkills, getResearchSkill: vi.fn(async (id: string) => detail(summaries.find((skill) => skill.id === id)!)) } as unknown as RuntimeClient
    renderPage(client)
    expect(await screen.findByText('Directory unavailable')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { name: 'Business Driver Analysis' })).toBeTruthy()
  })
})
