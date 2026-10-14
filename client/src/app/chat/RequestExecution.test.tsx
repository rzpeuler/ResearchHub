import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestExecution, LinkedWorkflowPanel } from './RequestExecution'
import { ConversationTimeline } from '../../App'
import { LanguageProvider } from '../../i18n'
import type { ConversationActivity, RuntimeClient, WorkflowRun } from '../../api/runtime-client'

const activity: ConversationActivity = { activityId: 'activity', conversationId: 'c1', operationId: 'o1', kind: 'accepted_request', operation: 'prompt', status: 'needs_clarification', requestText: 'Write dsjm report', createdAt: '2026-10-14T00:00:00Z', clarification: { confirmationId: 'confirm', kind: 'security_selection', query: 'dsjm', question: 'Choose the research object', directoryVersion: 'v1', directoryTimestamp: '2026-10-14', candidates: Array.from({ length: 23 }, (_, n) => ({ candidateId: `candidate-${n}`, name: `Security ${n}`, symbol: String(n).padStart(6, '0'), exchange: 'SZSE', matchKind: 'initials' })), missingFields: [] } }
function view(element: React.ReactNode) { return render(<LanguageProvider>{element}</LanguageProvider>) }
beforeEach(() => window.localStorage.setItem('researchhub.language', 'en'))
afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('Research request execution projection', () => {
  it('paginates the complete directory and confirms in the same original operation', async () => {
    const confirmResearch = vi.fn().mockResolvedValue({ status: 'started' })
    const changed = vi.fn()
    view(<RequestExecution activity={activity} client={{ confirmResearch } as unknown as RuntimeClient} onChanged={changed} />)
    expect(screen.getByText('23 matching securities')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Security 22 / })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: /Security 22 / }))
    await waitFor(() => expect(changed).toHaveBeenCalledOnce())
    expect(confirmResearch).toHaveBeenCalledWith({ conversationId: 'c1', operationId: 'o1', confirmationId: 'confirm', candidateId: 'candidate-22', directoryVersion: 'v1' })
  })
  it('submits a missing research goal as clarification, keeping original identity', async () => {
    const confirmResearch = vi.fn().mockResolvedValue({ status: 'started' })
    view(<RequestExecution activity={{ ...activity, clarification: { ...activity.clarification!, kind: 'research_goal', candidates: [], question: 'What should be researched?' } }} client={{ confirmResearch } as unknown as RuntimeClient} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Write a company report' } }); fireEvent.click(screen.getByRole('button', { name: 'Continue research' }))
    await waitFor(() => expect(confirmResearch).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'o1', clarificationText: 'Write a company report' })))
  })
  it('restores safe tool status and actual diagnostics, without blank assistant replies', () => {
    view(<ConversationTimeline conversationId="c1" messages={[{ role: 'assistant', content: '  ', piMessageId: 'blank' }, { role: 'assistant', content: 'Visible result', piMessageId: 'text' }, { role: 'assistant', content: 'Visible result', piMessageId: 'text' }]} activities={[{ ...activity, clarification: undefined, status: 'failed', failureCode: 'model_timeout', resolution: { source: 'bounded_repair', attempts: 2, diagnostics: [], attemptErrors: [{ attempt: 1, category: 'model_call', code: 'timeout', fieldPaths: [] }] }, toolActivities: [{ toolCallId: 'tool-1', name: 'company_research', status: 'failed', summary: 'Timed out' }] }]} optimisticRequests={[]} streaming={false} thinking={false} streamText="" toolEvents={[]} />)
    expect(document.querySelectorAll('article.message.assistant')).toHaveLength(1)
    expect(screen.getAllByText('Visible result')).toHaveLength(1)
    expect(screen.getByText(/model_call · timeout/)).toBeTruthy()
    expect(screen.getByText('Company research · Failed · Timed out')).toBeTruthy()
  })
  it('shows all linked workflow source steps after Agent stop and cancels only the selected task', async () => {
    const run = (runId: string): WorkflowRun => ({ runId, workflowType: 'company_research', objective: 'report', status: 'running', currentStage: 'Data acquisition', startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), acquisitionActivities: [{ activityId: 'source-1', providerId: 'cninfo', step: 'body_read', status: 'running', sourceTitle: 'Annual report', startedAt: new Date().toISOString() }] })
    const workflow = vi.fn(async (id: string) => run(id)); const cancelWorkflow = vi.fn().mockResolvedValue({})
    view(<LinkedWorkflowPanel client={{ workflow, cancelWorkflow } as unknown as RuntimeClient} activities={[{ ...activity, status: 'cancelled', clarification: undefined, linkedWorkflows: [{ runId: 'run-1', workflowRegistryId: 'company_research', subject: 'Security A' }, { runId: 'run-2', workflowRegistryId: 'company_research', subject: 'Security B' }] }]} streaming={false} />)
    await screen.findByText('Agent stopped. Research tasks are still running.')
    expect(screen.getAllByText(/Read body · cninfo · Annual report · Running/)).toHaveLength(2)
    const card = screen.getByText('Security B').closest('article')!
    fireEvent.click(within(card).getByRole('button', { name: 'Cancel this research task' }))
    await waitFor(() => expect(cancelWorkflow).toHaveBeenCalledWith('run-2'))
    expect(cancelWorkflow).toHaveBeenCalledOnce()
  })
  it('opens a linked result with its own run association, independent of the selected workflow', async () => {
    const onOpenArtifact = vi.fn()
    const workflow = vi.fn(async (runId: string) => ({ runId, workflowType: 'company_research', objective: 'report', status: 'completed', startedAt: '2026-10-14T00:00:00Z', completedAt: '2026-10-14T00:00:03Z', updatedAt: '2026-10-14T00:00:03Z', executionResult: { runId, workflowId: 'company_research', executionStatus: 'completed', summary: 'Completed', reportRef: 'report-b', diagnostics: [], bundleStatus: 'unavailable' } } as WorkflowRun))
    view(<LinkedWorkflowPanel client={{ workflow } as unknown as RuntimeClient} activities={[{ ...activity, clarification: undefined, linkedWorkflows: [{ runId: 'run-b', workflowRegistryId: 'company_research' }] }]} streaming={false} onOpenArtifact={onOpenArtifact} />)
    fireEvent.click(await screen.findByRole('button', { name: 'View report' }))
    expect(onOpenArtifact).toHaveBeenCalledWith('report', 'report-b', 'run-b')
  })

  it('renders completed workflow evidence as an Agent message and keeps the sidebar compact', async () => {
    const workflow = vi.fn(async (runId: string) => ({ runId, workflowType: 'company_research', objective: 'Write a company report', status: 'completed', startedAt: '2026-10-14T00:00:00Z', completedAt: '2026-10-14T00:06:12Z', updatedAt: '2026-10-14T00:06:12Z', currentStage: 'Report saved', stages: [{ stageId: 'acquisition', label: 'Data acquisition', status: 'completed', summary: 'Processed 3 observable sources' }], acquisitionActivities: [{ activityId: 'parse-1', providerId: 'cninfo', step: 'parsing', status: 'timeout', sourceTitle: 'Annual report', startedAt: '2026-10-14T00:01:00Z', completedAt: '2026-10-14T00:03:00Z', diagnosticCode: 'DOCUMENT_PARSE_TIMEOUT' }], executionResult: { runId, workflowId: 'company_research', executionStatus: 'completed', summary: 'Company research completed for 002384', reportRef: 'report-1', diagnostics: [], bundleStatus: 'unavailable' } } as WorkflowRun))
    const linked = [{ runId: 'run-report', workflowRegistryId: 'company_research', subject: '东山精密' }]
    const completed = { ...activity, status: 'completed' as const, requestText: '写一篇东山精密的报告', clarification: undefined, linkedWorkflows: linked }
    const result = view(<ConversationTimeline conversationId="c1" messages={[]} activities={[completed]} optimisticRequests={[]} streaming={false} thinking={false} streamText="" toolEvents={[]} client={{ workflow } as unknown as RuntimeClient} />)
    const agentMessage = await screen.findByRole('article', { name: 'Agent research execution result' })
    expect(within(agentMessage).getByText('Data acquisition')).toBeTruthy()
    expect(within(agentMessage).getByText(/Annual report · Timed out/)).toBeTruthy()
    expect(within(agentMessage).getByText(/Company research completed for 002384/)).toBeTruthy()
    const userMessage = result.container.querySelector('[data-activity-id="activity"]')!
    expect(within(userMessage as HTMLElement).queryByText('Annual report')).toBeNull()

    cleanup()
    view(<LinkedWorkflowPanel client={{ workflow } as unknown as RuntimeClient} activities={[completed]} streaming={false} presentation="sidebar" />)
    await screen.findByText(/Completed · Report saved/)
    expect(screen.queryByText('Data acquisition')).toBeNull()
    expect(screen.queryByText(/Annual report/)).toBeNull()
    expect(screen.queryByText(/Company research completed for 002384/)).toBeNull()
  })

})
