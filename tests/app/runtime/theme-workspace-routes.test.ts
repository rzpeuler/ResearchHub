import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fauxProvider } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createFreshKnowledgeBaseV04 } from '../../../knowledge/storage/create-v04.ts'
import { createResearchHubApplicationRuntime } from '../../../app/runtime/application-runtime.ts'
import { ResearchHubRuntimeServer } from '../../../app/runtime/server.ts'
import { ApplicationServiceError } from '../../../app/services/contracts.ts'
import type { ThemeWorkspaceProjectionService } from '../../../app/services/theme-workspace-projection.ts'
import type { ThemeWorkspaceProjectionInput } from '../../../app/services/theme-workspace-projection-contracts.ts'
import type { ReasoningCapabilities, ReasoningExecutor, ReasoningRequest, ReasoningResult } from '../../../plugins/reasoning/contracts.ts'

const capabilities: ReasoningCapabilities = { maxContextTokens: 100_000, maxOutputTokens: 10_000, structuredOutputSupport: true, maxConcurrency: 4 }
class FixtureExecutor implements ReasoningExecutor {
  capabilities(): ReasoningCapabilities { return capabilities }
  async execute(request: ReasoningRequest): Promise<ReasoningResult> { return { operation: request.operation, output: {} } as ReasoningResult }
}

async function withRuntime(mounted: boolean, run: (input: { origin: string; runtime: Awaited<ReturnType<typeof createResearchHubApplicationRuntime>> }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rhl-theme-workspace-routes-'))
  const kb = join(root, 'knowledge-base')
  if (mounted) await createFreshKnowledgeBaseV04(kb, { knowledgeBaseId: 'kb-theme-workspace-routes', now: '2026-10-02T00:00:00.000Z' })
  const cwd = join(root, 'cwd'); const agentDir = join(root, 'agent'); const workspaceRoot = join(root, 'workspace')
  await mkdir(cwd, { recursive: true }); await mkdir(agentDir, { recursive: true })
  const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const faux = fauxProvider({ provider: `rhl-theme-workspace-routes-${Date.now()}-${Math.random()}`, models: [{ id: 'fixture-model' }] })
  modelRuntime.registerNativeProvider(faux.provider)
  const runtime = await createResearchHubApplicationRuntime({ cwd, agentDir, mountedKnowledgeBaseRoot: mounted ? kb : undefined, workspaceRoot, modelRuntime, model: faux.getModel(), reasoningExecutor: new FixtureExecutor() })
  const server = new ResearchHubRuntimeServer({ runtime, port: 0 })
  try {
    const info = await server.start()
    await run({ origin: info.origin, runtime })
  } finally {
    await server.close()
    await runtime.close()
    await (modelRuntime as unknown as { readonly dispose?: () => void | Promise<void> }).dispose?.()
    await rm(root, { recursive: true, force: true })
  }
}

test('Theme Workspace GET routes pass bounded inputs and preserve projection rights metadata', async () => {
  await withRuntime(true, async ({ origin, runtime }) => {
    const calls: { method: string; input: ThemeWorkspaceProjectionInput; industryRef?: string; companyRef?: string }[] = []
    const projection = {
      async getThemeProjection(input: ThemeWorkspaceProjectionInput) {
        calls.push({ method: 'theme', input })
        return { status: 'available', themeRef: input.themeRef, revision: 12, graph: { nodes: [] }, responseBounds: { maxBytes: 100_000, serializedBytes: 50, truncated: false } }
      },
      async getIndustryProjection(input: ThemeWorkspaceProjectionInput, industryRef: string) {
        calls.push({ method: 'industry', input, industryRef })
        return { themeRef: input.themeRef, industryRef, revision: 12, sections: { omittedRestrictedCount: 2 }, companies: [], responseBounds: { maxBytes: 100_000, serializedBytes: 50, truncated: false } }
      },
      async getCompanyProjection(input: ThemeWorkspaceProjectionInput, industryRef: string, companyRef: string) {
        calls.push({ method: 'company', input, industryRef, companyRef })
        return { themeRef: input.themeRef, industryRef, companyRef, revision: 12, sections: { omittedRestrictedCount: 1 }, responseBounds: { maxBytes: 100_000, serializedBytes: 50, truncated: false } }
      },
    } as unknown as ThemeWorkspaceProjectionService
    Object.defineProperty(runtime.services, 'themeWorkspaceProjectionService', { value: projection })

    const overviewUrl = `${origin}/api/knowledge/themes/${encodeURIComponent('entity:theme-a')}/overview?expectedRevision=12&asOf=2026-10-01T00%3A00%3A00.000Z&maxNodes=20&maxEdges=30&maxResponseBytes=50000`
    const overviewResponse = await fetch(overviewUrl)
    assert.equal(overviewResponse.status, 200)
    assert.equal((await overviewResponse.json()).themeRef, 'entity:theme-a')
    const industryResponse = await fetch(`${origin}/api/knowledge/themes/entity%3Atheme-a/industries/entity%3Aindustry-a?maxItemsPerSection=25&maxCompaniesPerIndustry=40`)
    assert.equal(industryResponse.status, 200)
    const industryBody = await industryResponse.json() as { sections: { omittedRestrictedCount: number } }
    assert.equal(industryBody.sections.omittedRestrictedCount, 2, 'rights-filtered service response must pass through unchanged')
    const companyResponse = await fetch(`${origin}/api/knowledge/themes/entity%3Atheme-a/industries/entity%3Aindustry-a/companies/entity%3Acompany-a?maxItemsPerSection=8`)
    assert.equal(companyResponse.status, 200)
    assert.equal((await companyResponse.json() as { sections: { omittedRestrictedCount: number } }).sections.omittedRestrictedCount, 1)

    assert.deepEqual(calls.map((call) => call.method), ['theme', 'industry', 'company'])
    assert.deepEqual(calls[0]?.input, { themeRef: 'entity:theme-a', expectedRevision: 12, asOf: '2026-10-01T00:00:00.000Z', maxNodes: 20, maxEdges: 30, maxResponseBytes: 50_000 })
    assert.equal(calls[1]?.industryRef, 'entity:industry-a')
    assert.equal(calls[1]?.input.maxCompaniesPerIndustry, 40)
    assert.equal(calls[2]?.companyRef, 'entity:company-a')
  })
})

test('Theme Workspace routes reject invalid refs, unsupported query keys and stale revisions', async () => {
  await withRuntime(true, async ({ origin, runtime }) => {
    const projection = {
      async getThemeProjection(input: ThemeWorkspaceProjectionInput) {
        if (input.expectedRevision !== undefined) throw new ApplicationServiceError('conflict', 'Knowledge revision changed')
        return { status: 'available' }
      },
      async getIndustryProjection() { return { status: 'available' } },
      async getCompanyProjection() { return { status: 'available' } },
    } as unknown as ThemeWorkspaceProjectionService
    Object.defineProperty(runtime.services, 'themeWorkspaceProjectionService', { value: projection })

    const requests = [
      [`${origin}/api/knowledge/themes/not-an-entity/overview`, 400, 'invalid_input'],
      [`${origin}/api/knowledge/themes/entity%3Atheme-a/overview?unknown=1`, 400, 'invalid_input'],
      [`${origin}/api/knowledge/themes/entity%3Atheme-a/overview?maxNodes=151`, 400, 'invalid_input'],
      [`${origin}/api/knowledge/themes/entity%3Atheme-a/overview?expectedRevision=11`, 409, 'conflict'],
    ] as const
    for (const [url, expectedStatus, expectedCode] of requests) {
      const response = await fetch(url)
      assert.equal(response.status, expectedStatus, url)
      assert.equal((await response.json() as { code: string }).code, expectedCode, url)
    }
  })
})

test('Theme Workspace routes fail with no mounted Knowledge Base', async () => {
  await withRuntime(false, async ({ origin }) => {
    const response = await fetch(`${origin}/api/knowledge/themes/entity%3Atheme-a/overview`)
    assert.equal(response.status, 503)
    assert.equal((await response.json() as { code: string }).code, 'no_kb_mounted')
  })
})
