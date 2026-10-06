import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { ReasoningExecutor } from '../../plugins/reasoning/contracts.ts'
import type { ResearchAcquisitionPlugin } from '../../plugins/research-acquisition/contracts.ts'
import { AkshareDataAdapter, type AkshareDataClient } from '../../plugins/research-acquisition/akshare.ts'
import { CninfoOfficialDisclosureClient, OfficialDisclosureResearchPlugin } from '../../plugins/research-acquisition/official.ts'
import { GdeltResearchPlugin } from '../../plugins/research-acquisition/gdelt.ts'
import { RssResearchPlugin } from '../../plugins/research-acquisition/rss.ts'
import { AkshareDailyMarketAcquisition } from '../../plugins/daily-intelligence/market.ts'
import { DailyExpectationRevisionAcquisition } from '../../plugins/daily-intelligence/expectations.ts'
import { AkshareInstitutionalActivityAcquisition } from '../../plugins/daily-intelligence/institutional.ts'
import { DailyIndustryObservationAcquisition } from '../../plugins/daily-intelligence/industry.ts'
import { IndustryOperatingObservationAcquisition } from '../../plugins/research-acquisition/industry-operating-observations.ts'
import type { IndustryOperatingObservationAcquisitionPort } from '../../plugins/research-acquisition/industry-operating-observations.ts'
import { AkshareEarningsExpectationsSource } from '../../workflows/earnings-review/expectations-acquisition.ts'
import { CommunitySignalAcquisition, PublicInstitutionalViewAcquisition } from '../../plugins/daily-intelligence/acquisition.ts'
import { loadSourceCatalog } from '../../plugins/daily-intelligence/config.ts'
import { TradingCalendarService } from '../../plugins/daily-intelligence/calendar.ts'
import { DailyIntelligenceService } from './daily-intelligence-service.ts'
import { WorkflowService } from './workflow-service.ts'
import { parseYaml } from '../../knowledge/storage/yaml.ts'
import type { DataSourceIntegrationDefinition } from './data-source-administration-contracts.ts'
import { industryOperatingIntegration, mergeSourceIntegrations, sourceIntegration } from './data-source-integrations.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'

export interface DailyIntelligenceCompositionOptions {
  readonly cwd: string
  readonly workflowService: WorkflowService
  readonly reasoningExecutor?: ReasoningExecutor
  readonly modelRuntime?: ModelRuntime
  readonly watchlistPath?: string
  readonly catalogPath?: string
  readonly runtimeRoot?: string
  readonly mountedKnowledgeBaseRoot?: string
  readonly industryOperatingObservationAcquisition?: IndustryOperatingObservationAcquisitionPort
  readonly akshare?: AkshareDataClient
  readonly calendar?: TradingCalendarService
}

export interface DailyIntelligenceComposition {
  readonly service: DailyIntelligenceService
  readonly calendar: TradingCalendarService
  readonly providers: readonly ResearchAcquisitionPlugin[]
  readonly integrationDefinitions: readonly DataSourceIntegrationDefinition[]
  readonly industryOperatingObservationAcquisition: IndustryOperatingObservationAcquisitionPort
  readonly watchlistPath: string
  readonly catalogPath: string
  readonly catalog: Awaited<ReturnType<typeof loadSourceCatalog>>
}

export async function createDailyIntelligenceComposition(options: DailyIntelligenceCompositionOptions): Promise<DailyIntelligenceComposition> {
  const cwd = resolve(options.cwd)
  const watchlistPath = resolve(options.watchlistPath ?? join(cwd, 'config', 'watchlist.yaml'))
  const catalogPath = resolve(options.catalogPath ?? join(cwd, 'config', 'research-sources', 'catalog.yaml'))
  const runtimeRoot = resolve(options.runtimeRoot ?? join(cwd, 'runtime-data'))
  const [catalog, akshare] = await Promise.all([
    loadSourceCatalog(catalogPath).catch(() => []),
    Promise.resolve(options.akshare ?? new AkshareDataAdapter()),
  ])
  const active = catalog.filter((entry) => entry.operationalStatus === 'active')
  const institutionalEntries = active
    .filter((entry) => entry.category === 'institution' || entry.category === 'analyst' || entry.category === 'industry_expert')
    .filter((entry) => entry.discoveryUrl || entry.evidenceUrl)
    .slice(0, 8)
  const institutional = institutionalEntries.map((entry) => new PublicInstitutionalViewAcquisition({
      provider: entry.platform,
      accountRef: `${entry.platform}:${entry.accountId}`,
      urls: [entry.discoveryUrl ?? entry.evidenceUrl],
      tier: entry.reliabilityTier,
      scope: 'broad',
    }))
  const communityEntries = active
    .filter((entry) => entry.category === 'community' && entry.platform !== 'xueqiu')
    .filter((entry) => entry.discoveryUrl || entry.evidenceUrl)
    .slice(0, 4)
  const community = communityEntries.map((entry) => new CommunitySignalAcquisition({
      provider: entry.platform,
      accountRef: `${entry.platform}:${entry.accountId}`,
      urls: [entry.discoveryUrl ?? entry.evidenceUrl],
      tier: entry.reliabilityTier,
    }))
  const activePlatforms = new Set(active.map((entry) => entry.platform))
  const akshareActive = activePlatforms.has('akshare')
  const core: ResearchAcquisitionPlugin[] = []
  const integrationDefinitions: DataSourceIntegrationDefinition[] = []
  if (activePlatforms.has('cninfo')) {
    core.push(new OfficialDisclosureResearchPlugin(new CninfoOfficialDisclosureClient()))
    integrationDefinitions.push(sourceIntegration({ id: 'cninfo', name: 'CNINFO', capabilities: [{ id: 'official-disclosures', label: 'Official disclosures', metricIds: [] }] }))
  }
  if (activePlatforms.has('gdelt')) {
    core.push(new GdeltResearchPlugin())
    integrationDefinitions.push(sourceIntegration({ id: 'gdelt', name: 'GDELT', capabilities: [{ id: 'news-discovery', label: 'News discovery', metricIds: [] }] }))
  }
  if (activePlatforms.has('gov.cn')) {
    core.push(new RssResearchPlugin({ feedUrls: ['https://www.gov.cn/rss/zhengce.xml'] }))
    integrationDefinitions.push(sourceIntegration({ id: 'gov-cn', name: 'Gov.cn', capabilities: [{ id: 'policy-feed', label: 'Policy feed', metricIds: [] }] }))
  }
  if (akshareActive) core.push(new AkshareDailyMarketAcquisition(akshare))
  const breadth: ResearchAcquisitionPlugin[] = []
  if (akshareActive) {
    breadth.push(new DailyExpectationRevisionAcquisition(new AkshareEarningsExpectationsSource({ akshare })), new AkshareInstitutionalActivityAcquisition(akshare))
    integrationDefinitions.push(sourceIntegration({ id: 'akshare', name: 'AKShare', capabilities: [
      { id: 'daily-market', label: 'Daily market observations', metricIds: [] },
      { id: 'expectation-revisions', label: 'Expectation revisions', metricIds: ['earnings_expectation_eps', 'earnings_expectation_net_profit'] },
      { id: 'institutional-activity', label: 'Institutional activity', metricIds: [] },
    ] }))
  }
  const industryOperating = options.industryOperatingObservationAcquisition ?? new IndustryOperatingObservationAcquisition()
  breadth.push(new DailyIndustryObservationAcquisition(industryOperating))
  integrationDefinitions.push(industryOperatingIntegration(industryOperating, options.industryOperatingObservationAcquisition === undefined))
  for (const entry of institutionalEntries) integrationDefinitions.push(sourceIntegration({
    id: `web-${sha256(entry.platform).slice(0, 16)}`,
    name: entry.platform,
    capabilities: [{ id: 'public-institutional-views', label: 'Public institutional views', metricIds: [] }],
  }))
  for (const entry of communityEntries) integrationDefinitions.push(sourceIntegration({
    id: `web-${sha256(entry.platform).slice(0, 16)}`,
    name: entry.platform,
    capabilities: [{ id: 'community-signals', label: 'Community signals', metricIds: [] }],
  }))
  const providers: readonly ResearchAcquisitionPlugin[] = [...core, ...breadth, ...institutional, ...community]
  const overrides = await readCalendarOverrides(join(cwd, 'config', 'trading-calendar-overrides.yaml'))
  const calendar = options.calendar ?? new TradingCalendarService({
    cachePath: join(runtimeRoot, 'trading-calendar.json'),
    manualHolidays: overrides.manualHolidays,
    manualTradingDays: overrides.manualTradingDays,
    ...(akshareActive ? {
      provider: async (date: string) => {
        try {
          const value = await akshare.tradingCalendar?.({ symbol: 'calendar', startDate: date, endDate: date })
          if (!Array.isArray(value)) return undefined
          return value.some((row) => row && typeof row === 'object' && Object.values(row as Record<string, unknown>).some((field) => String(field).startsWith(date)))
        } catch { return undefined }
      },
    } : {}),
  })
  const service = new DailyIntelligenceService({
    cwd,
    workflowService: options.workflowService,
    reasoningExecutor: options.reasoningExecutor,
    mountedKnowledgeBaseRoot: options.mountedKnowledgeBaseRoot,
    providers,
    watchlistPath,
    runtimeRoot,
    calendar,
  })
  return { service, calendar, providers, integrationDefinitions: mergeSourceIntegrations(integrationDefinitions), industryOperatingObservationAcquisition: industryOperating, watchlistPath, catalogPath, catalog }
}

interface CalendarOverrides { readonly manualHolidays: readonly string[]; readonly manualTradingDays: readonly string[] }
async function readCalendarOverrides(path: string): Promise<CalendarOverrides> {
  try {
    const value = parseYaml(await readFile(path, 'utf8'), path) as Record<string, unknown>
    return {
      manualHolidays: strings(value.manualHolidays),
      manualTradingDays: strings(value.manualTradingDays),
    }
  } catch { return { manualHolidays: [], manualTradingDays: [] } }
}
function strings(value: unknown): readonly string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item)) : [] }
