import { readCanonicalV04Assets } from '../../knowledge/storage/canonical-v04-loader.ts'
import { KnowledgeProductionGateway } from '../../knowledge/production/gateway.ts'
import { KnowledgeBaseRegistry } from '../../knowledge/registry/registry.ts'
import type { KnowledgeEntityV04 } from '../../knowledge/schema/domain-v04.ts'
import { KNOWLEDGE_SCHEMA_V04 } from '../../knowledge/schema/executable-schema-v04.ts'
import { COMPETITION_MODULE_SCHEMA_ID_V1 } from '../../knowledge/schema/competition-module-v04.ts'
import { validateUsableAcquisitionPayload } from '../../plugins/research-acquisition/payload-validation.ts'
import { validateRelationAttributesV03 } from '../../knowledge/validation/v03-validation-core.ts'
import type { NormalizedResearchSource } from '../../plugins/research-acquisition/contracts.ts'
import { materializeIndustryEvidenceRequirement } from '../../data/requirements.ts'
import { resolveIndustryIdentity } from '../../data/industry-catalog.ts'
import { finalizeResearchEvidence, sourceWithDataEvidenceProvenance } from '../../data/research-evidence.ts'
import { mergeIndustryObservationPoints, type IndustryObservationPoint } from '../../data/industry-observations.ts'
import { IndustryResearchSkill } from '../../skills/industry-research/skill.ts'
import { INDUSTRY_MODULES, isValidIndustryStructuredValue, type IndustryModuleResult, type IndustryResearchModule, type IndustryTargetInput, type ModuleEvidence, type ResearchDesign, type ResearchGap } from '../../skills/industry-research/contracts.ts'
import type { CompetitionModuleProductionProposal, KnowledgeProductionProposal, SemanticProductionProposal } from '../../knowledge/production/contracts.ts'
import { sha256 } from '../../plugins/research-acquisition/hash.ts'
import { validateResearchReport, writeResearchReport } from '../../app/services/research-report.ts'
import type { IndustryDeepResearchInput, IndustryDeepResearchResult } from './contracts.ts'
import { runResearchQualityGate } from '../research-quality-gate.ts'

const safeId = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const moduleTitle: Record<IndustryResearchModule, string> = { industry_definition: 'Industry Scope & Definition', market_size_growth: 'Market Size & Growth', supply_demand_analysis: 'Demand Structure & Drivers', industry_chain_analysis: 'Industry Chain Map', competitive_landscape: 'Competitive Landscape', technology_evolution: 'Technology & Product Roadmap', company_mapping: 'Company Mapping & Exposure', risk_analysis: 'Risks & Invalidation Conditions' }
const titles = ['Executive Industry View','Industry Scope & Definition','Market Size & Growth','Demand Structure & Drivers','Supply, Capacity & Utilization','Supply-Demand Balance & Pricing','Industry Chain Map','Value Capture & Industry Economics','Competitive Landscape','Technology & Product Roadmap','Company Mapping & Exposure','Catalysts','Risks & Invalidation Conditions','Key Metrics & Monitoring','Research Gaps & Alternative Views','Methodology & Provenance'] as const
const relationTypes = new Set<string>(KNOWLEDGE_SCHEMA_V04.relation.types)
const claimTypes = new Set(['fact','forecast','viewpoint','trend','risk','assumption','thesis','catalyst'])
const abort = (s?: AbortSignal) => { if (s?.aborted) throw new Error('WORKFLOW_CANCELLED') }
const normalizedPitDate = (value: string): string => /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value
const asOfOk = (s: NormalizedResearchSource, asOf: string) => s.candidate.publishedAt === undefined || Number.isNaN(Date.parse(s.candidate.publishedAt)) || Date.parse(normalizedPitDate(s.candidate.publishedAt)) <= Date.parse(normalizedPitDate(asOf))
function empty(input: IndustryDeepResearchInput, status: IndustryDeepResearchResult['status'], errors: readonly string[], extra: Partial<IndustryDeepResearchResult> = {}): IndustryDeepResearchResult { return { workflowRunId: input.workflowRunId, status, knowledgeBaseId: input.handle.knowledgeBaseId, knowledgeBaseRevision: input.handle.revision, modules: [], evidence: [], operatingObservations: [], operatingObservationStatus: 'SCOPE_UNSUPPORTED', operatingObservationDiagnostics: [], dataRequirementGaps: [], requirementCoverage: 'PARTIAL', proposalIds: [], createdIds: [], updatedIds: [], committedIds: [], sourceIds: [], relationIds: [], claimIds: [], entityRefs: {}, relationRefs: {}, claimRefs: {}, sourceRefs: {}, resolutionIntents: [], diagnostics: [], errors, gatewaySubmitCount: 0, acquisitionWaves: 0, moduleCallCounts: {}, ...extra } }
function project(objects: readonly { value: unknown }[], targets: readonly string[]): readonly unknown[] { const values = objects.map((x) => x.value as Record<string, unknown>); const ids = new Set(targets); if (!ids.size) return []; for (const x of values.filter((v) => String(v.id).startsWith('relation:'))) if (ids.has(String(x.sourceRef)) || ids.has(String(x.targetRef))) { ids.add(String(x.id)); ids.add(String(x.sourceRef)); ids.add(String(x.targetRef)) } for (const x of values.filter((v) => String(v.id).startsWith('claim:'))) if (Array.isArray(x.subjectRefs) && x.subjectRefs.some((r) => ids.has(String(r)))) ids.add(String(x.id)); return values.filter((x) => ids.has(String(x.id))).sort((a,b) => String(a.id).localeCompare(String(b.id))).slice(0, 80) }
function qualify(sources: readonly NormalizedResearchSource[], asOf: string, max: number, diagnostics: string[], prior = new Set<string>(), dedupeCurrentContent = false) { if (max <= 0) return [] as NormalizedResearchSource[]; const out: NormalizedResearchSource[] = []; const seen = new Set(prior); for (const source of sources) { const id=source.candidate.candidateId; const sourceKeys = [id, source.canonicalUrl ? `url:${source.canonicalUrl}` : '', source.contentHash ? `hash:${source.contentHash}` : ''].filter(Boolean); const p=validateUsableAcquisitionPayload(source.content); if (p.status!=='usable'||!source.content.trim()||!source.rights.retentionAllowed||!source.rights.aiProcessingAllowed||!source.rights.derivativeKnowledgeAllowed||!asOfOk(source,asOf)) { diagnostics.push(`Evidence rejected: ${id}`); continue }; if(sourceKeys.some((key)=>seen.has(key))){diagnostics.push(`Duplicate evidence skipped: ${id}`);continue}; seen.add(id); if (dedupeCurrentContent) sourceKeys.filter((key)=>key!==id).forEach((key)=>seen.add(key)); out.push(source); if(out.length>=max)break }; return out }
function gate(modules: readonly IndustryModuleResult[], synthesis: { proposals: readonly SemanticProductionProposal[] }, evidence: readonly ModuleEvidence[], diagnostics: string[], rootName: string) {
  const ev = new Set(evidence.map((x) => x.evidenceId))
  const raw = [...modules.flatMap((m) => m.proposals), ...synthesis.proposals]
  const byId = new Map<string, SemanticProductionProposal[]>()
  for (const p of raw) (byId.get(p.proposalId) ?? (byId.set(p.proposalId, []), byId.get(p.proposalId)!)).push(p)
  const rejectedIds = new Set<string>()
  for (const [id, ps] of byId) if (ps.length > 1) { rejectedIds.add(id); diagnostics.push(`Duplicate local proposal rejected in full: ${id}`) }
  const candidates = raw.filter((p) => !rejectedIds.has(p.proposalId))
  const stable = (v: unknown): string => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join('|')}}` : JSON.stringify(v)
  const key = (p: SemanticProductionProposal) => stable({ kind:p.kind, subjectKey:p.subjectKey, targetKey:p.targetKey, entityType:p.entityType, entityName:p.entityName, relationType:p.relationType, attributes:p.attributes, claimType:p.claimType, statement:p.statement, temporal:p.temporal, structuredValue:p.structuredValue, confidence:p.confidence, probability:p.probability, semanticKey:p.semanticKey })
  const groups = new Map<string, SemanticProductionProposal[]>()
  for (const p of candidates) (groups.get(key(p)) ?? (groups.set(key(p), []), groups.get(key(p))!)).push(p)
  const representative = new Map<string, string>(); const merged: SemanticProductionProposal[] = []
  for (const ps of [...groups.values()].sort((a,b) => a.map((x)=>x.proposalId).sort()[0].localeCompare(b.map((x)=>x.proposalId).sort()[0]))) {
    const sorted = [...ps].sort((a,b)=>a.proposalId.localeCompare(b.proposalId)), first = sorted[0]
    for (const p of sorted) representative.set(p.proposalId, first.proposalId)
    const merge = (k: 'sourceCandidateIds'|'supportsProposalIds'|'dependsOnProposalIds'|'contradictsProposalIds') => [...new Set(sorted.flatMap((p)=>p[k] ?? []))].sort()
    merged.push({ ...first, sourceCandidateIds: merge('sourceCandidateIds'), supportsProposalIds: merge('supportsProposalIds'), dependsOnProposalIds: merge('dependsOnProposalIds'), contradictsProposalIds: merge('contradictsProposalIds') })
    if (sorted.length > 1) diagnostics.push(`Exact semantic proposals merged: ${sorted.map((x)=>x.proposalId).join('/')}`)
  }
  const remap = (p: SemanticProductionProposal): SemanticProductionProposal => ({ ...p, ...(p.targetKey ? { targetKey: representative.get(p.targetKey) ?? p.targetKey } : {}), ...Object.fromEntries((['supportsProposalIds','dependsOnProposalIds','contradictsProposalIds'] as const).map((k)=>[k,[...new Set((p[k] ?? []).map((x)=>representative.get(x) ?? x))].sort()])) })
  const normalized = merged.map(remap).filter((p) => { if (p.existingKnowledgeRefs !== undefined || p.resolution !== undefined) { diagnostics.push(`Canonical resolution field rejected: ${p.proposalId}`); return false } return true })
  const out: SemanticProductionProposal[] = []; const valid = new Map<string,string>(); const rejected = new Set<string>(); const entities = new Map<string,SemanticProductionProposal[]>()
  for (const p of normalized.filter((p)=>p.kind==='entity')) (entities.get(p.subjectKey) ?? (entities.set(p.subjectKey, []), entities.get(p.subjectKey)!)).push(p)
  for (const [localKey, ps] of entities) {
    if (localKey === 'industry') { if (ps.every((p)=>p.entityType==='industry' && p.entityName?.trim().toLowerCase()===rootName.trim().toLowerCase())) diagnostics.push(`Compatible redundant root proposal dropped: ${ps.map((p)=>p.proposalId).join('/')}`); else { rejected.add(localKey); diagnostics.push(`Reserved industry root redefinition rejected: ${ps.map((p)=>p.proposalId).join('/')}`) }; continue }
    if (ps.length > 1) { rejected.add(localKey); diagnostics.push(`Conflicting Entity local key rejected as a whole: ${localKey}`); continue }
    const p=ps[0]; if (!p.entityType || !p.entityName || !['company','industry','product','technology'].includes(p.entityType)) { rejected.add(localKey); diagnostics.push(`Invalid Entity rejected: ${p.proposalId}`); continue }; valid.set(localKey,p.entityType); out.push(p)
  }
  const durable=(p:SemanticProductionProposal)=>(p.sourceCandidateIds ?? []).length>0 && p.sourceCandidateIds!.every((x)=>ev.has(x))
  const sourceFor=(p:SemanticProductionProposal)=>(p.sourceCandidateIds ?? []).map((id)=>evidence.find((e)=>e.evidenceId===id)?.source).filter((x):x is NormalizedResearchSource=>Boolean(x))
  const relations=new Map<string,SemanticProductionProposal>()
  for (const p of normalized.filter((p)=>p.kind==='relation').sort((a,b)=>a.proposalId.localeCompare(b.proposalId))) {
    const d=p.relationType ? KNOWLEDGE_SCHEMA_V04.relation.definitions[p.relationType as keyof typeof KNOWLEDGE_SCHEMA_V04.relation.definitions] : undefined
    const st=p.subjectKey==='industry'?'industry':valid.get(p.subjectKey), tt=p.targetKey==='industry'?'industry':valid.get(p.targetKey ?? '')
    const supplier=p.relationType!=='supplier_of' || sourceFor(p).some((x)=>x.candidate.tier<=2 && (x.candidate.kind==='official_disclosure'||x.candidate.kind==='structured_data') && Boolean(x.publisher.trim()) && /(supplier|manufactur|procurement|vendor|supply chain)/i.test(`${x.title} ${x.content}`))
    if (rejected.has(p.subjectKey)||rejected.has(p.targetKey ?? '')||!durable(p)||!d||!relationTypes.has(p.relationType ?? '')||!st||!tt||!(d.sourceTypes as readonly string[]).includes(st)||!(d.targetTypes as readonly string[]).includes(tt)||!validateRelationAttributesV03(p.relationType!,p.attributes).valid||!supplier) { diagnostics.push(`Relation rejected: ${p.proposalId}`); continue }
    relations.set(p.proposalId,p); out.push(p)
  }
const structured=isValidIndustryStructuredValue
  const claims=normalized.filter((p)=>p.kind==='claim').filter((p)=>{ if(!durable(p)||!p.statement?.trim()||!claimTypes.has(p.claimType ?? '')||rejected.has(p.subjectKey)||(!valid.has(p.subjectKey)&&!relations.has(p.subjectKey))||(p.structuredValue!=null&&!structured(p.structuredValue))){diagnostics.push(`Claim rejected: ${p.proposalId}`);return false} return true }).sort((a,b)=>a.proposalId.localeCompare(b.proposalId))
const slot=(p:SemanticProductionProposal)=>{const v=p.structuredValue as Record<string,unknown>|undefined;return stable({subject:p.subjectKey,type:p.claimType,metric:v?.metric??null,period:v?.period??null,fiscalPeriod:v?.fiscalPeriod??null,semanticKey:v?.semanticKey??null})}
  const claimGroups=new Map<string,SemanticProductionProposal[]>(); for(const p of claims)(claimGroups.get(slot(p)) ?? (claimGroups.set(slot(p),[]),claimGroups.get(slot(p))!)).push(p)
  const admitted=new Set<string>(), finalClaims:SemanticProductionProposal[]=[]
  for(const [slotKey,ps] of claimGroups){const values=new Set(ps.map((p)=>stable({ value: p.structuredValue, statement: p.statement }))), contradiction=(a:SemanticProductionProposal,b:SemanticProductionProposal)=>[...(a.contradictsProposalIds??[])].includes(b.proposalId)||[...(b.contradictsProposalIds??[])].includes(a.proposalId); if(values.size>1&&!ps.every((a,i)=>ps.slice(i+1).every((b)=>contradiction(a,b)))){diagnostics.push(`Unsupported same-slot conflict excluded: ${slotKey}`);continue};for(const p of ps){admitted.add(p.proposalId);finalClaims.push(p)}}
  const claimIds=new Set(finalClaims.map((p)=>p.proposalId)); for(const p of finalClaims){const links:Record<string,readonly string[]>={};for(const k of ['supportsProposalIds','dependsOnProposalIds','contradictsProposalIds'] as const){const xs=[...new Set((p[k]??[]).map((x)=>representative.get(x)??x).filter((x)=>x!==p.proposalId&&claimIds.has(x)))].sort();if(xs.length)links[k]=xs};out.push({...p,...links})}
  return out
}
function competitionModuleProposal(module: IndustryModuleResult | undefined, accepted: readonly SemanticProductionProposal[], evidence: readonly ModuleEvidence[], diagnostics: string[]): CompetitionModuleProductionProposal | undefined {
  if (!module?.competitionTable || module.status === 'unavailable') return undefined
  const byId = new Map(accepted.map((proposal) => [proposal.proposalId, proposal]))
  const rows: CompetitionModuleProductionProposal['rows'][number][] = []
  for (const row of module.competitionTable.rows) {
    const company = byId.get(row.companyKey), exposure = byId.get(row.businessExposureProposalId)
    if (company?.kind !== 'entity' || company.entityType !== 'company' || exposure?.kind !== 'relation' || exposure.relationType !== 'business_exposure' || exposure.subjectKey !== company.subjectKey || exposure.targetKey !== 'industry') {
      diagnostics.push(`Competition Module row omitted because its Company or business_exposure did not pass the durable production gate: ${row.companyKey}`)
      continue
    }
    const cells: Record<string, CompetitionModuleProductionProposal['rows'][number]['cells'][string]> = {}
    for (const [columnId, cell] of Object.entries(row.cells)) {
      if (cell.status !== 'available') { cells[columnId] = cell; continue }
      const refs = cell.knowledgeProposalIds.map((proposalId) => byId.get(proposalId))
      if (refs.some((proposal) => !proposal || !['claim', 'relation'].includes(proposal.kind))) {
        cells[columnId] = { status: 'unavailable', reason: 'Evidence-backed Knowledge proposal did not pass the durable production gate.' }
        diagnostics.push(`Competition Module cell omitted because its Knowledge proposal did not pass the durable production gate: ${row.companyKey}.${columnId}`)
        continue
      }
      const { knowledgeProposalIds, ...fields } = cell
      cells[columnId] = { ...fields, status: 'available', knowledgeRefs: knowledgeProposalIds.map((proposalId) => ({ proposalId })) }
    }
    rows.push({ company: { localKey: company.subjectKey }, businessExposure: { proposalId: row.businessExposureProposalId }, cells })
  }
  if (rows.length === 0) {
    diagnostics.push('Competition Module was not submitted because no Company row had an admitted evidence-backed business_exposure Relation.')
    return undefined
  }
  // Gateway sourceCandidateIds are submission-local Source keys; these are the
  // same explicit evidence IDs supplied to the Skill, not provider candidate IDs.
  const sourceCandidateIds = [...new Set(module.evidenceIds.filter((evidenceId) => evidence.some((candidate) => candidate.evidenceId === evidenceId)))].sort()
  return {
    proposalId: `competition-${sha256(module.module + ':' + rows.map((row) => row.company.localKey).sort().join('|')).slice(0, 20)}`,
    kind: 'module',
    targetIndustry: { localKey: 'industry' },
    schemaId: COMPETITION_MODULE_SCHEMA_ID_V1,
    columns: module.competitionTable.columns,
    rows,
    ...(sourceCandidateIds.length ? { sourceCandidateIds } : {}),
  }
}
const moduleEvidenceTerms: Readonly<Record<IndustryResearchModule, readonly string[]>> = {
  industry_definition: ['定义', '范围', '规范', '标准', '行业分类', 'definition', 'scope'],
  market_size_growth: ['市场', '规模', '营收', '产值', '增长', '收入', '投资概况', '市场规模', 'market', 'revenue', 'growth'],
  supply_demand_analysis: ['产能', '利用率', '需求', '供需', '库存', '价格', '投资项目', '产量', '销量', '产销率', '订单', 'capacity', 'utilization', 'demand', 'supply', 'pricing'],
  industry_chain_analysis: ['产业链', '上游', '下游', '材料', '设备', '制程', '供应链', '供应商', '原材料', 'chain', 'upstream', 'downstream', 'process'],
  competitive_landscape: ['企业', '厂商', '竞争', '排名', '百强', '份额', '集中度', '营收', '客户', '公司', 'competitor', 'market share'],
  technology_evolution: ['技术', '工艺', '制程', 'AI', 'HDI', '高阶', '高速', '材料', '设备', '技术路线', 'technology', 'process'],
  company_mapping: ['企业', '厂商', '公司', '主营', '客户', '供应商', '营收', '排名', '分布', '深南电路', '沪电股份', '鹏鼎科技', '生益科技', 'company', 'business'],
  risk_analysis: ['风险', '政策', '贸易', '环保', '产能', '利润', '成本', '原材料', '产能消化', '合规', 'risk', 'regulation', 'margin'],
};
function evidenceRelevance(e: ModuleEvidence, m: IndustryResearchModule, design: ResearchDesign, target: IndustryTargetInput, gap?: ResearchGap): number {
  const md = e.source.candidate.metadata ?? {};
  const hints = [md.module, md.modules, md.moduleHints, md.researchModules].flatMap((x) => Array.isArray(x) ? x : typeof x === 'string' ? [x] : []).map(String);
  if (hints.length) return hints.some((x) => x === m || x.toLowerCase() === m.replaceAll('_', ' ')) ? 10000 : 0;
  const h = `${e.source.title} ${e.source.candidate.title} ${e.source.candidate.snippet ?? ''} ${e.source.content}`.toLowerCase();
  let score = 0;
  for (const term of moduleEvidenceTerms[m]) if (h.includes(term.toLowerCase())) score += term.length > 2 ? 3 : 1;
  const targetTerms = [target.name, ...(target.aliases ?? [])];
  for (const term of [...targetTerms, design.definitionHypothesis, ...design.searchTerms, ...design.moduleQuestions[m].toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3), ...(gap?.searchTerms ?? [])]) if (term && h.includes(term.toLowerCase())) score += 1;
  if (e.source.candidate.kind === 'official_disclosure' && e.source.candidate.tier <= 2 && /industry|market|supply|demand|capacity|product|company|technology|risk|growth|chain|price|supplier/i.test(h)) score += 1;
  return score;
}
function relevant(e: ModuleEvidence, m: IndustryResearchModule, design: ResearchDesign, target: IndustryTargetInput, gap?: ResearchGap): boolean { return evidenceRelevance(e, m, design, target, gap) > 0 }
function renderOperatingObservationTable(observations: readonly IndustryObservationPoint[], sourceRefs: Readonly<Record<string, string>>): string {
  if (!observations.length) return 'Validated Data Layer Industry observations: none.\n\nResearch Gap — no canonical Industry metric resolved for this target and cutoff.'
  const esc = (value: unknown) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
  const value = (observation: IndustryObservationPoint) => `${observation.qualifier === 'LOWER_BOUND' ? '>=' : observation.qualifier === 'UPPER_BOUND' ? '<=' : ''}${observation.value} ${observation.canonicalUnit}`
  const rows = [...observations].sort((a, b) => `${a.metricId}:${a.periodEnd}:${a.sourceIdentity}`.localeCompare(`${b.metricId}:${b.periodEnd}:${b.sourceIdentity}`)).map((observation) => `| ${esc(observation.metricId)} | ${esc(value(observation))} | ${esc(`${observation.periodStart.slice(0, 10)} – ${observation.periodEnd.slice(0, 10)}`)} | ${esc(observation.frequency)} / ${esc(observation.periodBasis)} / ${esc(observation.aggregation)} | ${esc([observation.product, observation.segment, observation.grade].filter(Boolean).join(' / ') || '—')} | ${esc(observation.geography)} | ${esc(observation.originPublisher)} | ${esc(observation.authority)} | ${esc(observation.retrievalProvider)} | ${esc(observation.publishedAt)} | ${esc(`${observation.publicationPit}/${observation.valueVersion.status}`)} | ${esc(sourceRefs[`evidence-${observation.sourceIdentity}`] ?? observation.sourceIdentity)} |`)
  return ['Canonical Data Layer Industry observations. Only exact canonical metrics with validated unit, scope, period, PIT, and provenance are included.', '', '| Metric ID | Value | Period | Frequency / basis / aggregation | Product / segment / grade | Geography | Publisher | Authority | Retrieval | Published | PIT | Source |', '|---|---:|---|---|---|---|---|---|---|---|---|---|', ...rows].join('\n')
}
export async function runIndustryDeepResearch(input: IndustryDeepResearchInput): Promise<IndustryDeepResearchResult> { const diagnostics: string[] = [], counts: Record<string, number> = {}; let waves = 0, submits = 0; try {
  if (!safeId.test(input.workflowRunId) || !input.target.name.trim()) return empty(input,'failed',['Invalid workflowRunId or Industry target']); if (input.useStructuredKnowledge === false) return empty(input,'blocked',['Industry Deep Research requires structured Knowledge context and cannot run with it disabled']); if (input.handle.schemaVersion !== '0.4' || input.handle.storageFormatVersion !== '1') return empty(input,'failed',['Industry Deep Research requires Schema 0.4 / Storage 1']); const assets = await readCanonicalV04Assets(input.handle.rootRef), values = assets.objects.map((x) => x.value); let rootRef = input.target.canonicalRef; if (rootRef) { const root = values.find((v) => v.id === rootRef) as KnowledgeEntityV04 | undefined; if (!root || root.type !== 'industry') return empty(input,'blocked',['Supplied canonical ref must exist and be an Industry']) }
  const names = new Set([input.target.name, ...(input.target.aliases ?? [])].map((x) => x.trim().toLowerCase())); const candidates = rootRef ? [rootRef] : values.filter((v) => v.id?.startsWith('entity:') && (v as unknown as Record<string,unknown>).type === 'industry' && names.has(String((v as unknown as Record<string,unknown>).name ?? '').trim().toLowerCase())).map((v) => String(v.id)).sort().slice(0,5); const existing = (input.existingKnowledge ?? project(assets.objects,candidates)).slice(0,80); const skill = new IndustryResearchSkill(input.reasoningExecutor); abort(input.signal); const design = await skill.design({ target: input.target, existingKnowledge: existing }); if (design.targetKind !== 'industry') return empty(input,'blocked',[`Bounded scope diagnosis: target is ${design.targetKind}, not one Industry`],{design}); const now = input.now ?? (() => new Date().toISOString()), asOf = input.asOf ?? input.target.asOf ?? now(), max = Math.max(1,Math.min(input.maxSources ?? 24,50)), per = Math.max(1,Math.min(input.maxEvidencePerModule ?? 8,12));
   const industryIdentity = resolveIndustryIdentity(input.target.name)
   const subject = industryIdentity.status === 'RESOLVED' ? { industryId: industryIdentity.industryId } : {}
   if (industryIdentity.status !== 'RESOLVED') diagnostics.push(`INDUSTRY_IDENTITY_${industryIdentity.status}:${input.target.name}`)
   const resolver = input.dataResolverFactory({ workflowId: 'industry-deep-research', target: input.target, asOf, now, subject, ...(input.signal ? { signal: input.signal } : {}) })
   const operatingObservations: IndustryObservationPoint[] = []
   const marketSizeObservationIds = new Set<string>()
   const operatingObservationDiagnostics: string[] = []
   const dataRequirementGaps: string[] = []
   let operatingObservationStatus: IndustryDeepResearchResult['operatingObservationStatus'] = industryIdentity.status === 'RESOLVED' ? 'SOURCE_UNAVAILABLE' : 'SCOPE_UNSUPPORTED'
   const seenEvidence = new Set<string>()
   const seenPoints = new Set<string>()
   const readWave = async (wave: 1 | 2, gaps: readonly string[], searchTerms: readonly string[]): Promise<ModuleEvidence[]> => {
     abort(input.signal)
     const boundedSearchTerms = [...new Set(searchTerms.map((term) => term.trim()).filter(Boolean))].slice(0, 8)
     if (boundedSearchTerms.length === 0) boundedSearchTerms.push(input.target.name)
     const evidenceRequirement = materializeIndustryEvidenceRequirement({ id: `industry:${input.workflowRunId}:evidence:wave-${wave}`, displayTarget: input.target.name, searchTerms: boundedSearchTerms, purpose: `${wave === 1 ? 'Initial research design' : 'Actionable gap repair'}: ${gaps.slice(0, 8).join('; ') || design.definitionHypothesis}`.slice(0, 240), asOf, subject, required: false })
     const evidenceBundle = await resolver.resolve([evidenceRequirement])
     const evidenceItem = evidenceBundle.items[0]
     const qualifiedSources: NormalizedResearchSource[] = []
     if (evidenceItem) {
       const evidencePayloads = evidenceItem.acquisition.observations?.map((observation) => observation.data) ?? (evidenceItem.value ? [evidenceItem.value] : [])
       if (evidencePayloads.length) {
         operatingObservationDiagnostics.push(...evidencePayloads.flatMap((payload) => payload.diagnostics.slice(0, 16)))
         const evidenceAcquisition = { ...evidenceItem.acquisition, observations: evidenceItem.acquisition.observations?.map(({ data, ...observation }) => ({ ...observation, data: { kind: 'evidence' as const, documents: data.documents, outcome: { ...data.outcome, diagnostics: data.diagnostics ?? [] } } })) }
         const finalized = finalizeResearchEvidence<NormalizedResearchSource>(evidenceRequirement, evidenceAcquisition as never)
         for (const document of finalized.observations?.flatMap((observation) => observation.data.documents) ?? []) qualifiedSources.push(sourceWithDataEvidenceProvenance(document))
       }
       if (evidenceItem.status !== 'AVAILABLE') operatingObservationDiagnostics.push(`INDUSTRY_EVIDENCE_${evidenceItem.status}:${evidenceItem.unavailableReason ?? 'UNKNOWN'}`)
     }
     const admitted = qualify(qualifiedSources, asOf, Math.min(6, max), diagnostics, seenEvidence, true)
     for (const source of admitted) [source.candidate.candidateId, ...(source.canonicalUrl ? [`url:${source.canonicalUrl}`] : []), ...(source.contentHash ? [`hash:${source.contentHash}`] : [])].forEach((key) => seenEvidence.add(key))
     const dataBundle = await resolver.resolveSkillRequirements('industry_supply_demand_cycle', input.skillDataRequirements, { workflowId: 'industry-deep-research', asOf, subject })
     for (const unresolved of dataBundle.unresolvedRequirements) dataRequirementGaps.push(`${unresolved.templateId}:${unresolved.reason}`)
     for (const item of dataBundle.items) {
       if (item.status !== 'AVAILABLE' && item.status !== 'PARTIAL') { dataRequirementGaps.push(`${item.requirementId}:${item.unavailableReason ?? item.status}`); continue }
       for (const point of item.value?.observationPoints ?? []) {
         const identity = `${point.metricId}:${point.periodStart}:${point.periodEnd}:${point.sourceIdentity}`
         if (!seenPoints.has(identity)) { seenPoints.add(identity); operatingObservations.push(point) }
         if (item.requirementId.includes(':production-output-evidence:')) marketSizeObservationIds.add(identity)
       }
       operatingObservationDiagnostics.push(...(item.value?.observationDiagnostics ?? []), ...(item.value?.diagnostics ?? []))
     }
     const mergedObservations = mergeIndustryObservationPoints(operatingObservations)
     for (const conflict of mergedObservations.conflicts) operatingObservationDiagnostics.push(`INDUSTRY_METRIC_CONFLICT:${conflict.slotIdentity}:${conflict.sourceIdentities.join(',')}`)
     if (operatingObservations.length) operatingObservationStatus = operatingObservationDiagnostics.length ? 'PARTIAL' : 'COMPLETED'
     else if (industryIdentity.status !== 'RESOLVED') operatingObservationStatus = 'SCOPE_UNSUPPORTED'
     else if (dataBundle.items.some((item) => item.attempts.some((attempt) => /HTTP_|TRANSPORT|TIMEOUT/.test(attempt.diagnostic ?? '')))) operatingObservationStatus = 'TRANSPORT_UNAVAILABLE'
     else if (dataBundle.items.some((item) => item.attempts.some((attempt) => /PARSER|PARSE/.test(attempt.diagnostic ?? '')))) operatingObservationStatus = 'PARSER_UNAVAILABLE'
     return admitted.map((source) => ({ evidenceId: `evidence-${source.candidate.candidateId}`, source }))
   }
   const evidenceWaveOne = await readWave(1, design.knownGaps.map((gap) => gap.question), (input.searchTerms?.length ? input.searchTerms : design.searchTerms))
   waves++
   const evidence: ModuleEvidence[] = [...evidenceWaveOne]
   const modules: IndustryModuleResult[] = []
   const operatingObservationModules = new Set<IndustryResearchModule>(['market_size_growth', 'supply_demand_analysis'])
   const run = async (only?: ReadonlySet<IndustryResearchModule>, allowed = evidence) => { for (const m of INDUSTRY_MODULES) { if (only && !only.has(m)) continue; abort(input.signal); counts[m]=(counts[m]??0)+1; const routed=allowed.filter((e)=>relevant(e,m,design,input.target)).sort((a,b)=>evidenceRelevance(b,m,design,input.target)-evidenceRelevance(a,m,design,input.target)||a.source.candidate.tier-b.source.candidate.tier||(b.source.candidate.publishedAt??'').localeCompare(a.source.candidate.publishedAt??'')||a.evidenceId.localeCompare(b.evidenceId)).slice(0,per); const moduleObservations = m === 'market_size_growth' ? operatingObservations.filter((point) => marketSizeObservationIds.has(`${point.metricId}:${point.periodStart}:${point.periodEnd}:${point.sourceIdentity}`)) : operatingObservationModules.has(m) ? operatingObservations : []; modules.push(await skill.analyze(m,{target:input.target,designContext:{design,module:m},evidence:routed,operatingObservations:moduleObservations,existingKnowledge:existing,localReferences:[]})) } }
   await run(); const firstGaps=modules.flatMap((m)=>m.gaps).filter((g)=>g.actionable); if(firstGaps.length){ const remaining=max-evidenceWaveOne.length; let newWave: ModuleEvidence[]=[]; if(remaining<=0) diagnostics.push('Evidence/source budget exhausted; actionable gaps remain and Wave 2 was skipped'); else { abort(input.signal); newWave=await readWave(2,firstGaps.map((gap)=>gap.question),[...new Set([...firstGaps.flatMap((gap)=>gap.searchTerms??[]),...(input.searchTerms??[])])]); waves++; evidence.push(...newWave) } const affected=new Set<IndustryResearchModule>(); const newHay=newWave.map((x)=>`${x.source.title} ${x.source.candidate.title} ${x.source.candidate.snippet??''} ${x.source.content}`.toLowerCase()); for(const g of firstGaps) if(newHay.some((h)=> (g.searchTerms??[]).some((t)=>h.includes(t.toLowerCase())) || h.includes(g.question.toLowerCase().slice(0,12)))) affected.add(g.module); if(affected.size){ for(let i=modules.length-1;i>=0;i--) if(affected.has(modules[i].module)) modules.splice(i,1); await run(affected,evidence) } }const def=modules.find((m)=>m.module==='industry_definition'); if(!def || def.status==='unavailable') return empty(input,'blocked',['Industry Definition is mandatory and unavailable after the bounded repair/gap-fill attempt'],{design,modules,evidence,operatingObservations,operatingObservationStatus,operatingObservationDiagnostics,diagnostics,acquisitionWaves:waves,moduleCallCounts:counts}); abort(input.signal); const synthesis=await skill.synthesize({modules,evidence,operatingObservations:operatingObservations,existingKnowledge:existing}); const semanticProposals=gate(modules,synthesis,evidence,diagnostics,input.target.name); const qualityGate=runResearchQualityGate({profile:'industry',asOf,sources:evidence.map((item)=>item.source),referencedSourceCandidateIds:evidence.map((item)=>item.source.candidate.candidateId),proposalSourceCandidateIds:semanticProposals.flatMap((proposal)=>proposal.sourceCandidateIds??[]),reportSourceCandidateIds:synthesis.reportMaterial.evidenceIds}); const competitionProposal=competitionModuleProposal(modules.find((module)=>module.module==='competitive_landscape'),semanticProposals,evidence,diagnostics); const proposals: KnowledgeProductionProposal[]=[...semanticProposals,...(competitionProposal?[competitionProposal]:[])]; if(!qualityGate.eligibleForGateway) return empty(input,'blocked',qualityGate.diagnostics.filter((item)=>item.severity==='ERROR').map((item)=>item.code),{design,modules,synthesis,evidence,operatingObservations,operatingObservationStatus,operatingObservationDiagnostics,dataRequirementGaps:[...new Set(dataRequirementGaps)],requirementCoverage:dataRequirementGaps.length===0?'COMPLETE':'PARTIAL',proposalIds:proposals.map((p)=>p.proposalId),diagnostics,qualityGate,gatewaySubmitCount:submits,acquisitionWaves:waves,moduleCallCounts:counts}); abort(input.signal); const outcome=await new KnowledgeProductionGateway(new KnowledgeBaseRegistry()).submit({handle:input.handle,producerType:'industry_deep_research',producerRunId:input.workflowRunId,schemaProfile:{schemaVersion:'0.4',storageFormatVersion:'1',requiresRawProvenance:true},entity:{localKey:'industry',entityType:'industry',name:input.target.name,aliases:input.target.aliases??[],existingEntityRef:rootRef},proposals,evidenceBindings:evidence.map((e)=>({localSourceId:e.evidenceId,source:e.source})),asOf,now,semanticResolver:input.semanticResolver,writeKnowledge:input.writeKnowledge}); submits++; if(outcome.status==='blocked'||outcome.status==='failed') return empty(input,'blocked',outcome.errors,{design,modules,synthesis,evidence,operatingObservations,operatingObservationStatus,operatingObservationDiagnostics,dataRequirementGaps:[...new Set(dataRequirementGaps)],requirementCoverage:dataRequirementGaps.length===0?'COMPLETE':'PARTIAL',proposalIds:proposals.map((p)=>p.proposalId),diagnostics,qualityGate,gatewaySubmitCount:submits,acquisitionWaves:waves,moduleCallCounts:counts}); const entityRefs=outcome.entityRefsByLocalKey; rootRef=entityRefs.industry; const relationRefs=outcome.relationRefsByProposalId, claimRefs=outcome.claimRefsByProposalId, sourceRefs=outcome.sourceRefsByLocalId; const reload=await readCanonicalV04Assets(input.handle.rootRef), canonical=new Set<string>(reload.objects.map((x)=>x.value.id)); const mapped=[...Object.values(entityRefs),...Object.values(relationRefs),...Object.values(claimRefs),...Object.values(sourceRefs)]; if(input.writeKnowledge !== false && (!rootRef||mapped.some((x)=>!canonical.has(x)))) return empty(input,'failed',['Canonical reload missing a Gateway-mapped reference; report persistence refused'],{design,modules,synthesis,evidence,operatingObservations,operatingObservationStatus,operatingObservationDiagnostics,dataRequirementGaps:[...new Set(dataRequirementGaps)],requirementCoverage:dataRequirementGaps.length===0?'COMPLETE':'PARTIAL',diagnostics,qualityGate,gatewaySubmitCount:submits,acquisitionWaves:waves,moduleCallCounts:counts});
  const boundOperatingObservations = operatingObservations
  const by=new Map(modules.map((m)=>[m.module,m])), refs=(ids: readonly string[], map: Readonly<Record<string,string>>)=>ids.map((x)=>map[x]).filter((x):x is string=>Boolean(x)&&canonical.has(x)), gapText=(ms: readonly IndustryModuleResult[], label: string)=>ms.flatMap((m)=>m.gaps.filter((g)=>g.actionable).map((g)=>`${label}: Research Gap — ${g.question} (${g.reason})`)).join('\\n\\n') || `${label}: Research Gap — validated supporting material is unavailable.`; const selected=(ms: readonly IndustryResearchModule[],label:string)=>{const xs=ms.map((m)=>by.get(m)?.reportMaterial).filter((x):x is NonNullable<typeof x>=>Boolean(x)); const terms=label.includes('Capacity')?['capacity','utilization','inventory']:label.includes('Balance')?['balance','price','pricing','margin','economics']:['industry','chain','competition']; const useful=xs.filter((x)=>terms.some((t)=>x.markdown.toLowerCase().includes(t))); return {markdown:useful.map((x)=>x.markdown).join('\\n\\n')||gapText([],label),evidenceIds:[...new Set(useful.flatMap((x)=>x.evidenceIds))],proposalIds:[...new Set(useful.flatMap((x)=>x.proposalIds))],relationProposalIds:[...new Set(useful.flatMap((x)=>x.relationProposalIds??[]))]}}; const catalysts=modules.flatMap((m)=>m.proposals.filter((p)=>p.kind==='claim'&&(p.claimType==='catalyst'||/catalyst/i.test(`${p.statement} ${p.structuredValue?.metric??''}`)))), metrics=modules.flatMap((m)=>m.proposals.filter((p)=>p.kind==='claim'&&/monitor|metric|capacity|utilization|inventory/i.test(`${p.statement} ${p.structuredValue?.metric??''}`))); const special: Record<number,{markdown:string,evidenceIds:readonly string[],proposalIds:readonly string[],relationProposalIds:readonly string[]}>={4:selected(['supply_demand_analysis'],'Supply, Capacity & Utilization'),5:selected(['supply_demand_analysis'],'Supply-Demand Balance & Pricing'),7:selected(['supply_demand_analysis','industry_chain_analysis','competitive_landscape'],'Value Capture & Industry Economics'),11:catalysts.length?{markdown:catalysts.map((p)=>p.statement??'').join('\\n\\n'),evidenceIds:catalysts.flatMap((p)=>p.sourceCandidateIds??[]),proposalIds:catalysts.map((p)=>p.proposalId),relationProposalIds:[]}:{markdown:'Catalysts: Research Gap — no validated catalyst material.',evidenceIds:[],proposalIds:[],relationProposalIds:[]},13:{markdown:[renderOperatingObservationTable(boundOperatingObservations,sourceRefs), `Key metrics: ${design.keyMetrics.join(', ')}. ${metrics.map((p)=>p.statement??'').join('\\n\\n')||'Research Gap — no validated monitoring observations.'}`].join('\\n\\n'),evidenceIds:[...new Set([...boundOperatingObservations.map((item)=>`evidence-${item.sourceIdentity}`), ...metrics.flatMap((p)=>p.sourceCandidateIds??[])])],proposalIds:metrics.map((p)=>p.proposalId),relationProposalIds:[]},14:{markdown:[...modules.flatMap((m)=>m.gaps.filter((g)=>g.actionable).map((g)=>`Module ${m.module}: ${g.question}`)),...synthesis.gaps.map((g)=>`Synthesis: ${g.question}`),...synthesis.alternativeViews.map((v)=>`Alternative view: ${v}`)].join('\\n\\n')||'Research Gap — no unresolved gaps or alternative views.',evidenceIds:synthesis.reportMaterial.evidenceIds,proposalIds:synthesis.reportMaterial.proposalIds,relationProposalIds:synthesis.reportMaterial.relationProposalIds??[]}}; const sections=titles.map((title,i)=>{const m=Object.entries(moduleTitle).find(([,t])=>t===title)?.[0] as IndustryResearchModule|undefined,mat=m?by.get(m)?.reportMaterial:undefined,chosen=special[i],md=i===0?synthesis.executiveView:i===15?'Bounded Research Design, qualified evidence, eight module analyses, one consolidated Gateway submission, canonical reload, and report persistence.':chosen?.markdown??mat?.markdown??gapText([],title),eids=chosen?.evidenceIds??mat?.evidenceIds??synthesis.reportMaterial.evidenceIds,pids=chosen?.proposalIds??mat?.proposalIds??synthesis.reportMaterial.proposalIds,rids=chosen?.relationProposalIds??mat?.relationProposalIds??synthesis.reportMaterial.relationProposalIds??[]; return {id:`section-${i+1}`,title,markdown:md,sourceRefs:refs(eids,sourceRefs),claimRefs:refs(pids,claimRefs),relationRefs:refs(rids,relationRefs)}}); const report=validateResearchReport({reportId:`industry-research-${input.workflowRunId}`,reportType:'industry_research',subjectRefs:[rootRef],generatedAt:now(),asOf,workflowRunId:input.workflowRunId,knowledgeBaseRevision:outcome.knowledgeBaseRevision,sourceRefs:Object.values(sourceRefs),claimRefs:Object.values(claimRefs),methodology:'Bounded design -> two-wave evidence qualification -> eight bounded modules -> deterministic gate -> one Gateway/Writer -> canonical reload.',sections,outputPath:`industry-research-${input.workflowRunId}.md`}); const outputPath=await writeResearchReport(report,input.reportRoot); return {workflowRunId:input.workflowRunId,status:'completed',knowledgeBaseId:input.handle.knowledgeBaseId,knowledgeBaseRevision:outcome.knowledgeBaseRevision,report:{reportId:report.reportId,outputPath},design,modules,synthesis,evidence,operatingObservations:boundOperatingObservations,operatingObservationStatus,operatingObservationDiagnostics,dataRequirementGaps:[...new Set(dataRequirementGaps)],requirementCoverage:dataRequirementGaps.length===0?'COMPLETE':'PARTIAL',proposalIds:proposals.map((p)=>p.proposalId),createdIds:outcome.createdIds,updatedIds:outcome.updatedIds,committedIds:[...outcome.createdIds,...outcome.updatedIds],sourceIds:Object.values(sourceRefs),relationIds:Object.values(relationRefs),claimIds:Object.values(claimRefs),entityRefs,relationRefs,claimRefs,sourceRefs,resolutionIntents:outcome.resolutionIntents,diagnostics,errors:[],qualityGate,gatewaySubmitCount:submits,acquisitionWaves:waves,moduleCallCounts:counts}
 } catch(e) { const message=e instanceof Error?e.message:String(e); return empty(input,message==='WORKFLOW_CANCELLED'?'cancelled':'failed',[message],{diagnostics,gatewaySubmitCount:submits,acquisitionWaves:waves,moduleCallCounts:counts}) } }
