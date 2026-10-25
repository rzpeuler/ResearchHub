import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import type { ResearchSkillDetail, ResearchSkillSummary, RuntimeClient } from '../../api/runtime-client'
import { useLanguage } from '../../i18n'
import './research-skills-page.css'

interface Props { readonly client: RuntimeClient }
type LoadStatus = 'loading' | 'ready' | 'error'
const DOMAIN_ORDER = ['Company Economics', 'Industry', 'Earnings / Expectations', 'Financial', 'Valuation', 'Thesis', 'Evidence']

function domainLabel(domain: string | undefined, t: (zh: string, en: string) => string): string {
  if (domain === undefined || domain.trim() === '') return t('其他', 'Other')
  const labels: Readonly<Record<string, [string, string]>> = {
    'Company Economics': ['公司经济', 'Company Economics'],
    Industry: ['行业', 'Industry'],
    'Earnings / Expectations': ['盈利与预期', 'Earnings / Expectations'],
    Financial: ['财务', 'Financial'],
    Valuation: ['估值', 'Valuation'],
    Thesis: ['投资论点', 'Thesis'],
    Evidence: ['证据', 'Evidence'],
  }
  const translated = labels[domain]
  return translated ? t(translated[0], translated[1]) : domain
}

function groupSkills(skills: readonly ResearchSkillSummary[]): readonly { readonly domain: string | undefined; readonly items: readonly ResearchSkillSummary[] }[] {
  const groups = new Map<string, { domain: string | undefined; items: ResearchSkillSummary[] }>()
  for (const skill of skills) {
    const domain = skill.domain?.trim() || undefined
    const key = domain ?? '__other__'
    const group = groups.get(key) ?? { domain, items: [] }
    group.items.push(skill)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((group) => ({ ...group, items: [...group.items].sort((left, right) => left.id.localeCompare(right.id)) }))
    .sort((left, right) => {
      if (left.domain === undefined) return right.domain === undefined ? 0 : 1
      if (right.domain === undefined) return -1
      const leftIndex = DOMAIN_ORDER.indexOf(left.domain)
      const rightIndex = DOMAIN_ORDER.indexOf(right.domain)
      if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex)
      return left.domain.localeCompare(right.domain)
    })
}

function listValue(value: readonly string[] | undefined, fallback: string, separator: string): string {
  return value?.length ? value.join(separator) : fallback
}

function skillName(id: string): string {
  const acronyms: Readonly<Record<string, string>> = { ai: 'AI', dcf: 'DCF', esg: 'ESG', fcff: 'FCFF', kpi: 'KPI', pit: 'PIT' }
  return id.split(/[_-]+/).filter(Boolean).map((word) => acronyms[word.toLowerCase()] ?? `${word[0]!.toUpperCase()}${word.slice(1)}`).join(' ')
}

function DataRequirements({ requirements }: { readonly requirements: NonNullable<ResearchSkillDetail['dataRequirements']> }): ReactElement | null {
  const { t } = useLanguage()
  if (requirements.length === 0) return null
  return <section className="research-skill-section"><h2>{t('数据需求', 'Data requirements')}</h2><ul className="research-skill-requirements">{requirements.map((requirement) => <li key={requirement.id}><strong>{requirement.id}</strong><span>{requirement.kind === 'STATIC' ? requirement.metricId : requirement.semanticRole}</span><small>{requirement.required ? t('必需', 'Required') : t('可选', 'Optional')} · {requirement.dataKind}</small></li>)}</ul></section>
}

export function ResearchSkillsPage({ client }: Props): ReactElement {
  const { t } = useLanguage()
  const [skills, setSkills] = useState<readonly ResearchSkillSummary[]>([])
  const [listStatus, setListStatus] = useState<LoadStatus>('loading')
  const [listError, setListError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [detail, setDetail] = useState<ResearchSkillDetail>()
  const [detailStatus, setDetailStatus] = useState<LoadStatus>('loading')
  const [detailError, setDetailError] = useState('')
  const [detailRetry, setDetailRetry] = useState(0)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

  const loadSkills = useCallback(async (isActive: () => boolean = () => true): Promise<void> => {
    setListStatus('loading'); setListError('')
    try {
      const result = await client.listResearchSkills()
      if (!isActive()) return
      const sorted = [...result].sort((left, right) => left.id.localeCompare(right.id))
      setSkills(sorted)
      setSelectedId((current) => sorted.some((skill) => skill.id === current) ? current : sorted[0]?.id ?? '')
      setListStatus('ready')
    } catch (error) {
      if (!isActive()) return
      setListError(error instanceof Error ? error.message : t('技能目录加载失败。', 'Could not load the skill directory.'))
      setListStatus('error')
    }
  }, [client, t])

  useEffect(() => {
    let active = true
    void loadSkills(() => active)
    return () => { active = false }
  }, [loadSkills])

  useEffect(() => {
    if (!selectedId) { setDetail(undefined); setDetailStatus('ready'); setDetailError(''); return }
    let active = true
    setDetail(undefined); setDetailError(''); setDetailStatus('loading')
    void client.getResearchSkill(selectedId).then((result) => {
      if (!active) return
      setDetail(result); setDetailStatus('ready')
    }).catch((error: unknown) => {
      if (!active) return
      setDetailError(error instanceof Error ? error.message : t('技能详情加载失败。', 'Could not load the skill details.'))
      setDetailStatus('error')
    })
    return () => { active = false }
  }, [client, selectedId, detailRetry, t])

  const groups = useMemo(() => groupSkills(skills), [skills])
  const selected = skills.find((skill) => skill.id === selectedId)
  const selectSkill = (id: string): void => { setSelectedId(id); setMobileDetailOpen(true) }
  const retryDetail = (): void => setDetailRetry((value) => value + 1)

  return <main className={`research-skills-page ${mobileDetailOpen ? 'mobile-detail-open' : ''}`}>
    <aside className="research-skills-directory" aria-label={t('研究技能目录', 'Research skill directory')}>
      <header className="research-skills-directory-header"><p className="eyebrow">{t('研究能力', 'RESEARCH CAPABILITIES')}</p><h1>{t('研究技能', 'Research Skills')}</h1>{listStatus === 'ready' ? <span className="research-skills-count">{skills.length} {t('项可运行技能', 'available skills')}</span> : null}</header>
      {listStatus === 'loading' ? <p className="research-skills-status" role="status">{t('正在加载技能目录…', 'Loading skills…')}</p> : null}
      {listStatus === 'error' ? <div className="research-skills-status error" role="alert"><p>{listError}</p><button type="button" onClick={() => void loadSkills()}>{t('重试', 'Retry')}</button></div> : null}
      {listStatus === 'ready' && skills.length === 0 ? <p className="research-skills-status">{t('当前没有可运行的研究技能。', 'There are no available research skills.')}</p> : null}
      {listStatus === 'ready' && skills.length > 0 ? <nav className="research-skills-groups" aria-label={t('按研究领域分组', 'Grouped by research domain')}>{groups.map((group) => <section className="research-skills-group" key={group.domain ?? '__other__'}><h2>{domainLabel(group.domain, t)}<span>{group.items.length}</span></h2><ul>{group.items.map((skill) => <li key={skill.id}><button type="button" className={skill.id === selectedId ? 'selected' : ''} aria-current={skill.id === selectedId ? 'true' : undefined} onClick={() => selectSkill(skill.id)} title={skill.id}><span className="research-skill-list-name">{skillName(skill.id)}<small>{skill.id}</small></span><span className="research-skill-origin">{skill.origin === 'external' ? t('外部', 'External') : t('内置', 'Built in')}</span></button></li>)}</ul></section>)}</nav> : null}
    </aside>
    <section className="research-skill-detail" aria-label={t('技能详情', 'Skill details')}>
      {selected ? <button className="research-skills-back" type="button" onClick={() => setMobileDetailOpen(false)}>{t('‹ 返回技能目录', '‹ Back to skills')}</button> : null}
      {listStatus === 'ready' && !selected ? <div className="research-skills-empty"><span className="research-skills-empty-mark">◇</span><h2>{t('尚无可展示的研究技能', 'No research skills to display')}</h2><p>{t('已注册并启用的原子级研究技能会显示在左侧目录中。', 'Enabled atomic research skills appear in the directory.')}</p></div> : null}
      {selected && detailStatus === 'loading' ? <div className="research-skill-detail-status" role="status"><span className="research-skill-spinner" />{t('正在加载技能详情…', 'Loading skill details…')}</div> : null}
      {selected && detailStatus === 'error' ? <div className="research-skill-detail-status error" role="alert"><h2>{selected.id}</h2><p>{detailError}</p><button type="button" onClick={retryDetail}>{t('重试加载详情', 'Retry details')}</button></div> : null}
      {selected && detailStatus === 'ready' && detail ? <article className="research-skill-content">
        <header className="research-skill-heading"><div><p className="eyebrow">{domainLabel(detail.domain, t)} · {detail.origin === 'external' ? t('外部技能', 'External skill') : t('内置技能', 'Built-in skill')}</p><h1>{skillName(detail.id)}</h1><code>{detail.id}</code><p>{detail.purpose}</p></div></header>
        <section className="research-skill-section"><h2>{t('适用场景', 'When to use')}</h2><p>{detail.invocationMatch}</p></section>
        <div className="research-skill-facts"><section className="research-skill-section"><h2>{t('输入', 'Inputs')}</h2><p>{listValue(detail.inputs, t('未注明', 'Not specified'), t('、', ', '))}</p></section><section className="research-skill-section"><h2>{t('产出', 'Produces')}</h2><p>{listValue(detail.produces, t('未注明', 'Not specified'), t('、', ', '))}</p></section></div>
        {detail.executionClass ? <section className="research-skill-section"><h2>{t('执行方式', 'Execution')}</h2><p>{detail.executionClass === 'SEMANTIC_EXECUTABLE' ? t('语义执行', 'Semantic execution') : detail.executionClass === 'DETERMINISTIC_EXECUTABLE' ? t('确定性执行', 'Deterministic execution') : detail.executionClass}</p></section> : null}
        {detail.dataRequirements ? <DataRequirements requirements={detail.dataRequirements} /> : null}
        <section className="research-skill-section research-skill-methodology"><h2>{t('方法文档', 'Methodology')}</h2><details open><summary>{t('查看完整方法说明', 'Show full methodology')}</summary><pre>{detail.methodology}</pre></details></section>
      </article> : null}
    </section>
  </main>
}
