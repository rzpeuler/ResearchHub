export * from '../../skills/thesis-red-team/contracts.ts'

import type { DataResolver } from '../../data/resolver.ts'
import type { ThesisRedTeamWorkflowInput as SkillContractsWorkflowInput } from '../../skills/thesis-red-team/contracts.ts'
import type { ResearchCompanyIdentity } from '../../plugins/research-acquisition/contracts.ts'

export interface ThesisRedTeamDataResolverContext {
  readonly company: ResearchCompanyIdentity
  readonly asOf: string
  readonly period: { readonly start: string; readonly end: string }
  readonly signal?: AbortSignal
}

export type ThesisRedTeamDataResolverFactory = (context: ThesisRedTeamDataResolverContext) => DataResolver<unknown> | undefined

export type ThesisRedTeamWorkflowInput = SkillContractsWorkflowInput & {
  readonly dataResolverFactory?: ThesisRedTeamDataResolverFactory
}
