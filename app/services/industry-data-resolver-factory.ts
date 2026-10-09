import { createIndustryDataCatalog, type IndustryDataCatalog } from '../../data/industry-catalog.ts'
import { INDUSTRY_DATA_SOURCE_POLICIES } from '../../data/industry-policies.ts'
import { createIndustryDataResolver } from './industry-data-resolver.ts'
import type { IndustryDataResolverFactory } from '../../workflows/industry-deep-research/contracts.ts'
import { createIndustryEvidenceOperation, createIndustryMetricOperation, type NamedIndustryMetricAcquisitionPort } from '../../plugins/research-acquisition/industry-data-operations.ts'
import type { ResearchAcquisitionPlugin } from '../../plugins/research-acquisition/contracts.ts'
import { MiitIndustryResearchPlugin } from '../../plugins/research-acquisition/miit-industry.ts'
import { GovCnIndustryResearchPlugin } from '../../plugins/research-acquisition/govcn-industry.ts'
import { CpcaIndustryResearchPlugin } from '../../plugins/research-acquisition/cpca-industry.ts'
import { EastmoneyIndustryResearchPlugin } from '../../plugins/research-acquisition/eastmoney-industry.ts'

export interface RuntimeIndustryDataResolverOptions {
  readonly plugins: readonly ResearchAcquisitionPlugin[]
  readonly metricAcquisition: NamedIndustryMetricAcquisitionPort
  readonly catalog?: IndustryDataCatalog
}

export interface RuntimeIndustryDataResolverComposition {
  readonly factory: IndustryDataResolverFactory
  readonly boundOperationIds: readonly string[]
}

/** Runtime binds named, reviewed source operations to the existing Industry policies. */
export function createRuntimeIndustryDataResolverComposition(options: RuntimeIndustryDataResolverOptions): RuntimeIndustryDataResolverComposition {
  const catalog = options.catalog ?? createIndustryDataCatalog()
  const miit = options.plugins.find((plugin) => plugin instanceof MiitIndustryResearchPlugin)
  const govcn = options.plugins.find((plugin) => plugin instanceof GovCnIndustryResearchPlugin)
  const cpca = options.plugins.find((plugin) => plugin instanceof CpcaIndustryResearchPlugin)
  const eastmoney = options.plugins.find((plugin) => plugin instanceof EastmoneyIndustryResearchPlugin)
  const operations = Object.freeze({
    'industry.evidence.miit': miit ? createIndustryEvidenceOperation('industry.evidence.miit', miit) : undefined,
    'industry.evidence.govcn': govcn ? createIndustryEvidenceOperation('industry.evidence.govcn', govcn) : undefined,
    'industry.evidence.cpca': cpca ? createIndustryEvidenceOperation('industry.evidence.cpca', cpca) : undefined,
    'industry.evidence.eastmoney-board': eastmoney ? createIndustryEvidenceOperation('industry.evidence.eastmoney-board', eastmoney) : undefined,
    'industry.metric.nbs.room-air-conditioner-production': createIndustryMetricOperation(options.metricAcquisition),
    'industry.metric.cheaa.air-conditioner-export-volume': createIndustryMetricOperation(options.metricAcquisition),
    'industry.metric.miit.lithium-total-output': createIndustryMetricOperation(options.metricAcquisition),
    'industry.metric.miit.lithium-carbonate-average-price': createIndustryMetricOperation(options.metricAcquisition),
    'industry.metric.miit.lithium-hydroxide-average-price': createIndustryMetricOperation(options.metricAcquisition),
  })
  const boundOperationIds = Object.freeze(Object.entries(operations).filter(([, operation]) => operation !== undefined).map(([operationId]) => operationId))
  return {
    factory: (context) => createIndustryDataResolver({ catalog, policies: INDUSTRY_DATA_SOURCE_POLICIES, operations }, context),
    boundOperationIds,
  }
}

export function createRuntimeIndustryDataResolverFactory(options: RuntimeIndustryDataResolverOptions): IndustryDataResolverFactory {
  return createRuntimeIndustryDataResolverComposition(options).factory
}
