import test from 'node:test'
import assert from 'node:assert/strict'
import { repairCompanyMethodCitations } from '../../skills/company-research/citation-repair.ts'
import type { CompanyMethodFinding } from '../../skills/company-research/methods.ts'
import type { CompanyEvidencePacket } from '../../skills/company-research/evidence.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'

const source = { candidate: { candidateId: 'filing' }, title: '2025年年度报告', content: '营业收入构成\n汽车相关业务收入648645636000元，占比80.68%。\n公司其他信息。' } as CompanyResearchInput['sources'][number]
const packet: CompanyEvidencePacket = { sourceCandidateId: 'filing', title: source.title, publisher: '公司', excerpts: source.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })) }
const finding: CompanyMethodFinding = { text: '汽车相关业务收入648645636000元，占比80.68%。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:1' }] }
const input = { company: { symbol: '002594' }, asOf: '2026-10-15', sources: [source] }
const output = (value = finding) => ({ findings: [value], markdown: `${value.text}[filing@paragraph:1]`, sections: [{ id: 'business-segments', markdown: `${value.text}[filing@paragraph:1]\n另一项经营结论。` }] })

test('repair appends only unique supplied actual financial row, preserves numbers and records trace', () => {
  const result = repairCompanyMethodCitations(output(), [packet], input)
  assert.equal(result.repairs.length, 1)
  assert.equal(result.output.findings[0]!.text, finding.text)
  assert.ok(result.output.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:2'))
  assert.match(result.output.sections[0]!.markdown.split('\n')[0]!, /paragraph:2/)
  assert.equal(result.output.sections[0]!.markdown.split('\n')[1], '另一项经营结论。')
  assert.equal(result.repairs[0]!.originalReferences[0]!.location, 'paragraph:1')
})

test('repair never searches unprovided full-document text or changes cited source identity', () => {
  assert.equal(repairCompanyMethodCitations(output(), [{ ...packet, excerpts: packet.excerpts.slice(0, 1) }], input).repairs.length, 0)
  const other = { ...packet, sourceCandidateId: 'other', excerpts: packet.excerpts.map((excerpt) => ({ ...excerpt, sourceCandidateId: 'other' })) }
  const otherSource = { ...source, candidate: { ...source.candidate, candidateId: 'other' } }
  assert.equal(repairCompanyMethodCitations(output(), [{ ...packet, excerpts: packet.excerpts.slice(0, 1) }, other], { ...input, sources: [source, otherSource] }).repairs.length, 0)
})

test('a quoted strategic event cannot borrow a different event year from the same supplied timeline', () => {
  const timeline = { ...source, content: '2016\n发布“治污+治堵”战略。\n2015\n发布新能源车“全产业链+全市场”战略。' }
  const excerpts = timeline.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text, ...(index % 2 ? { contextLocations: [`paragraph:${index}`] } : {}) }))
  const wrong: CompanyMethodFinding = { text: '2016年发布新能源车“全产业链+全市场”战略。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:4' }, { sourceCandidateId: 'filing', location: 'paragraph:3' }] }
  assert.equal(repairCompanyMethodCitations(output(wrong), [{ ...packet, excerpts }], { ...input, sources: [timeline] }).repairs.length, 0)
})

test('repair refuses wrong units, swapped percent/amount meanings, wrong accounts and ambiguous rows', () => {
  const cases = ['汽车相关业务收入648645636000亿元，占比80.68%。', '汽车相关业务收入80.68元，占比648645636000%。', '归母净利润648645636000元，占比80.68%。']
  for (const text of cases) assert.equal(repairCompanyMethodCitations(output({ ...finding, text }), [packet], input).repairs.length, 0, text)
  const ambiguous = { ...packet, excerpts: [...packet.excerpts, { ...packet.excerpts[1]!, location: 'paragraph:4' }] }
  assert.equal(repairCompanyMethodCitations(output(), [ambiguous], { ...input, sources: [{ ...source, content: `${source.content}\n${packet.excerpts[1]!.text}` }] }).repairs.length, 0)
})

test('repair refuses swapping values between explicitly named income and profit fields', () => {
  const mixed = { ...source, content: '经营概况\n营业收入10元，净利润20元。' }
  const excerpts = mixed.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text }))
  const text = '营业收入20元，净利润10元。'
  assert.equal(repairCompanyMethodCitations(output({ ...finding, text }), [{ ...packet, excerpts }], { ...input, sources: [mixed] }).repairs.length, 0)
})

test('a unique legal registration date can repair its actual legal event, but not founding or product dates', () => {
  const dated = { ...source, content: '公司介绍\n本公司前身于一九九五年二月注册成立。\n公司于2008年推出F3DM。' }
  const excerpts = dated.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text }))
  const legal = { ...finding, text: '本公司前身于1995年注册成立。' }
  assert.equal(repairCompanyMethodCitations(output(legal), [{ ...packet, excerpts }], { ...input, sources: [dated] }).repairs.length, 1)
  assert.equal(repairCompanyMethodCitations(output({ ...finding, text: '比亚迪在深圳成立日期为1995年。' }), [{ ...packet, excerpts }], { ...input, sources: [dated] }).repairs.length, 0)
  assert.equal(repairCompanyMethodCitations(output({ ...finding, text: '公司于2008年推出F9车型。' }), [{ ...packet, excerpts }], { ...input, sources: [dated] }).repairs.length, 0)
})
