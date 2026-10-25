import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WorkflowRun } from '../../api/runtime-client'
import { LanguageProvider } from '../../i18n'
import { WorkflowNodeGraph } from './WorkflowNodeGraph'

function view(workflow: WorkflowRun) {
  return render(<LanguageProvider><WorkflowNodeGraph workflow={workflow} statusLabel={(status) => status} stageDuration={() => 'duration'} duration={() => 'duration'} /></LanguageProvider>)
}

beforeEach(() => window.localStorage.setItem('researchhub.language', 'en'))
afterEach(() => cleanup())

describe('Workflow node graph', () => {
  it('shows the complete Company Research path and attaches actual Provider and Skill observations', () => {
    const workflow: WorkflowRun = {
      runId: 'company-run', workflowType: 'company_research', objective: 'Research a company', status: 'running',
      startedAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:01:00Z', currentStageId: 'data_acquisition',
      stages: [{ stageId: 'identity_validation', label: 'Identity validation', status: 'completed' }, { stageId: 'data_acquisition', label: 'Data acquisition', status: 'running', summary: 'Acquiring annual reports' }],
      acquisitionActivities: [{ activityId: 'source-1', providerId: 'cninfo', step: 'download', status: 'running', sourceTitle: 'Annual report', startedAt: '2026-10-25T00:00:30Z' }],
      providerObservations: [{ providerId: 'cninfo', label: 'CNINFO', status: 'partial', diagnostics: [] }],
      skillObservations: [{ skillId: 'company_research_synthesis', label: 'Company research synthesis', status: 'completed', summary: 'Synthesis returned' }],
    }
    const { container } = view(workflow)
    const graph = screen.getByTestId('workflow-node-graph')
    expect(within(graph).getAllByRole('listitem')).toHaveLength(7)
    expect(container.querySelector('[data-node-id="identity_validation"]')?.getAttribute('data-node-state')).toBe('completed')
    expect(container.querySelector('[data-node-id="data_acquisition"]')?.getAttribute('data-node-state')).toBe('running')
    expect(within(container.querySelector('[data-node-id="data_acquisition"]') as HTMLElement).getByText(/cninfo · Annual report · Running/)).toBeTruthy()
    expect(within(container.querySelector('[data-node-id="data_acquisition"]') as HTMLElement).getByText('CNINFO')).toBeTruthy()
    expect(within(container.querySelector('[data-node-id="research_synthesis"]') as HTMLElement).getByText('Company research synthesis')).toBeTruthy()
    expect(container.querySelector('[data-node-id="report_persistence"]')?.getAttribute('data-node-state')).toBe('pending')
  })

  it('marks absent observations in historical runs as unreported rather than showing live progress', () => {
    const workflow: WorkflowRun = {
      runId: 'historical-run', workflowType: 'company_research', objective: 'Research a company', status: 'interrupted',
      startedAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:01:00Z', observationSource: 'historical',
      stages: [{ stageId: 'data_acquisition', label: 'Data acquisition', status: 'interrupted' }],
    }
    const { container } = view(workflow)
    expect(container.querySelector('[data-node-id="identity_validation"]')?.getAttribute('data-node-state')).toBe('unreported')
    expect(container.querySelector('[data-node-id="data_acquisition"]')?.getAttribute('data-node-state')).toBe('interrupted')
    expect(screen.getByText(/saved run snapshot/i)).toBeTruthy()
    expect(screen.queryByText('Waiting for earlier nodes')).toBeNull()
  })

  it('does not invent nodes for Workflows without fine-grained stage observations', () => {
    view({ runId: 'industry-run', workflowType: 'industry_research', objective: 'Research an industry', status: 'running', startedAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:01:00Z' })
    expect(screen.getByText(/no detailed node observations/i)).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()
  })
})
