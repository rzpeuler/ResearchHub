import test from 'node:test'
import assert from 'node:assert/strict'
import { repairCompanyMethodCitations, repairCompanyParagraphCollisionCitations, repairCompanyTrailingSourceIdTypo, repairPreparedAnalysisSourceReferences, repairUnavailableCompanyMethodCitations } from '../../skills/company-research/citation-repair.ts'
import { validateCompanyNumericGrounding } from '../../skills/company-research/numeric-grounding.ts'
import { validateCompanyMethodOutput, type CompanyMethodFinding } from '../../skills/company-research/methods.ts'
import type { CompanyEvidencePacket } from '../../skills/company-research/evidence.ts'
import type { CompanyResearchInput } from '../../skills/company-research/contracts.ts'

const source = { candidate: { candidateId: 'filing' }, title: '2025年年度报告', content: '营业收入构成\n汽车相关业务收入648645636000元，占比80.68%。\n公司其他信息。' } as CompanyResearchInput['sources'][number]
const packet: CompanyEvidencePacket = { sourceCandidateId: 'filing', title: source.title, publisher: '公司', excerpts: source.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })) }
const finding: CompanyMethodFinding = { text: '汽车相关业务收入648645636000元，占比80.68%。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:1' }] }
const input = { company: { symbol: '002594' }, asOf: '2026-10-15', sources: [source] }
const output = (value = finding) => ({ findings: [value], markdown: `${value.text}[filing@paragraph:1]`, sections: [{ id: 'business-segments', markdown: `${value.text}[filing@paragraph:1]\n另一项经营结论。` }] })

test('repairs only R167-style extra trailing source-ID characters against one exact supplied paragraph', () => {
  const candidateId = 'official-c19c34dd239b2e9c'
  const malformedId = `${candidateId}8`
  const lines = Array.from({ length: 699 }, () => '')
  lines[692] = '本报告期 上年同期'
  lines[698] = '分行业'
  const official = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content: lines.join('\n') } as CompanyResearchInput['sources'][number]
  const packetValue: CompanyEvidencePacket = {
    sourceCandidateId: candidateId,
    title: official.title,
    publisher: 'CNINFO',
    excerpts: [693, 699].map(paragraph => ({ sourceCandidateId: candidateId, location: `paragraph:${paragraph}`, text: lines[paragraph - 1]! })),
  }
  const draft = {
    findings: [{ text: '半年度收入表以本报告期和上年同期对比，分行业披露。', kind: 'fact' as const, evidence: [{ sourceCandidateId: malformedId, location: 'paragraph:699' }] }],
    markdown: `半年度收入表以本报告期和上年同期对比。[${malformedId}@paragraph:693]`,
    sections: [{ id: 'business-segments', markdown: `分行业披露。[${malformedId}@paragraph:699]` }],
  }
  const result = repairCompanyTrailingSourceIdTypo(draft, [packetValue], { ...input, sources: [official] })
  assert.equal(result.output.markdown, `半年度收入表以本报告期和上年同期对比。[${candidateId}@paragraph:693]`)
  assert.deepEqual(result.output.findings[0]!.evidence, [{ sourceCandidateId: candidateId, location: 'paragraph:699' }])
  assert.equal(result.output.sections[0]!.markdown, `分行业披露。[${candidateId}@paragraph:699]`)
  assert.equal(result.repairs.length, 2)
})

test('does not repair a trailing source-ID typo when its exact paragraph is absent or source packets are ambiguous', () => {
  const candidateId = 'official-c19c34dd239b2e9c'
  const malformedId = `${candidateId}8`
  const official = { ...source, candidate: { ...source.candidate, candidateId }, content: '已供给。\n未供给。' } as CompanyResearchInput['sources'][number]
  const packetValue: CompanyEvidencePacket = { sourceCandidateId: candidateId, title: source.title, publisher: 'CNINFO', excerpts: [{ sourceCandidateId: candidateId, location: 'paragraph:1', text: '已供给。' }] }
  const draft = { findings: [], markdown: `[${malformedId}@paragraph:2]`, sections: [{ id: 'business-segments', markdown: `[${malformedId}@paragraph:2]` }] }
  const absent = repairCompanyTrailingSourceIdTypo(draft, [packetValue], { ...input, sources: [official] })
  assert.equal(absent.output.markdown, draft.markdown)
  assert.equal(absent.output.sections[0]!.markdown, draft.sections[0]!.markdown)
  assert.equal(absent.repairs.length, 0)
  const ambiguousDraft = { ...draft, sections: [{ id: 'business-segments', markdown: `[${malformedId}@paragraph:1]` }] }
  const ambiguous = repairCompanyTrailingSourceIdTypo(ambiguousDraft, [packetValue, packetValue], { ...input, sources: [official] })
  assert.equal(ambiguous.output.sections[0]!.markdown, ambiguousDraft.sections[0]!.markdown)
  assert.equal(ambiguous.repairs.length, 0)
})

test('repairs the BYD official source-ID suffix typo only with one exact source and paragraph match', () => {
  const candidateId = 'official-c19c34dd239b2e9c'
  const malformedId = 'official-c19c34dd239b2e9de'
  const content = Array.from({ length: 720 }, () => '')
  const claim = '分行业毛利率比上年同期增加1.98个百分点。'
  content[719] = claim
  const official = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content: content.join('\n') } as CompanyResearchInput['sources'][number]
  const exactPacket: CompanyEvidencePacket = {
    sourceCandidateId: candidateId,
    title: official.title,
    publisher: 'CNINFO',
    excerpts: [{ sourceCandidateId: candidateId, location: 'paragraph:720', text: claim }],
  }
  const draft = {
    findings: [{ text: claim, kind: 'fact' as const, evidence: [{ sourceCandidateId: malformedId, location: 'paragraph:720' }] }],
    markdown: `${claim}[${malformedId}@paragraph:720]`,
    sections: [{ id: 'revenue-profit-drivers', markdown: `${claim}[${malformedId}@paragraph:720]` }],
  }
  const repaired = repairCompanyTrailingSourceIdTypo(draft, [exactPacket], { ...input, sources: [official] })
  assert.equal(repaired.output.markdown, `${claim}[${candidateId}@paragraph:720]`)
  assert.equal(repaired.output.sections[0]!.markdown, `${claim}[${candidateId}@paragraph:720]`)
  assert.deepEqual(repaired.output.findings[0]!.evidence, [{ sourceCandidateId: candidateId, location: 'paragraph:720' }])
  assert.equal(repaired.repairs.length, 1)
  assert.equal(repaired.repairs[0]!.inputText, `${malformedId}@paragraph:720`)

  const alternativeId = 'official-c19c34dd239b2e9e'
  const alternativeSource = { ...official, candidate: { ...official.candidate, candidateId: alternativeId } }
  const alternativePacket = { ...exactPacket, sourceCandidateId: alternativeId, excerpts: exactPacket.excerpts.map(excerpt => ({ ...excerpt, sourceCandidateId: alternativeId })) }
  const ambiguous = repairCompanyTrailingSourceIdTypo(draft, [exactPacket, alternativePacket], { ...input, sources: [official, alternativeSource] })
  assert.equal(ambiguous.output.markdown, draft.markdown)
  assert.equal(ambiguous.repairs.length, 0, 'two official source IDs match the narrowly allowed suffix shape')

  const mismatchedTextPacket = { ...exactPacket, excerpts: [{ ...exactPacket.excerpts[0]!, text: '来源摘录与原报告第720段不一致。' }] }
  const mismatchedText = repairCompanyTrailingSourceIdTypo(draft, [mismatchedTextPacket], { ...input, sources: [official] })
  assert.equal(mismatchedText.output.markdown, draft.markdown)
  assert.equal(mismatchedText.repairs.length, 0, 'source text and packet excerpt must match exactly')
})

test('repairs a final-character source-ID substitution only against the unique exact supplied paragraph', () => {
  const candidateId = 'official-c19c34dd239b2e9c'
  const malformedId = 'official-c19c34dd239b2e9e'
  const lines = Array.from({ length: 705 }, () => '')
  lines[704] = '公司营业收入同比增长，利润率保持稳定。'
  const official = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content: lines.join('\n') } as CompanyResearchInput['sources'][number]
  const packetValue: CompanyEvidencePacket = {
    sourceCandidateId: candidateId,
    title: official.title,
    publisher: '公司',
    excerpts: [{ sourceCandidateId: candidateId, location: 'paragraph:705', text: lines[704]! }],
  }
  const claim = '公司营业收入同比增长，利润率保持稳定。'
  const draft = {
    findings: [{ text: claim, kind: 'fact' as const, evidence: [{ sourceCandidateId: malformedId, location: 'paragraph:705' }] }],
    markdown: `${claim} [${malformedId}@paragraph:705]`,
    sections: [{ id: 'revenue-profit-drivers', markdown: `${claim} [${malformedId}@paragraph:705]` }],
  }
  const result = repairCompanyTrailingSourceIdTypo(draft, [packetValue], { ...input, sources: [official] })
  assert.equal(result.output.markdown, `${claim} [${candidateId}@paragraph:705]`)
  assert.equal(result.output.sections[0]!.markdown, `${claim} [${candidateId}@paragraph:705]`)
  assert.deepEqual(result.output.findings[0]!.evidence, [{ sourceCandidateId: candidateId, location: 'paragraph:705' }])
  assert.equal(result.repairs.length, 1)

  const wrongLocator = structuredClone(draft)
  wrongLocator.markdown = `${claim} [${malformedId}@paragraph:704]`
  wrongLocator.sections[0]!.markdown = `${claim} [${malformedId}@paragraph:704]`
  wrongLocator.findings[0]!.evidence[0]!.location = 'paragraph:704'
  assert.equal(repairCompanyTrailingSourceIdTypo(wrongLocator, [packetValue], { ...input, sources: [official] }).repairs.length, 0)
  assert.equal(repairCompanyTrailingSourceIdTypo(draft, [packetValue, packetValue], { ...input, sources: [official] }).repairs.length, 0)
})

test('repairs a repeated official source-ID tail only when the exact paragraph text and source are unique', () => {
  const candidateId = 'official-c19c34dd239b2e9c'
  const malformedId = 'official-c19c34dd239b2e9bc34dd239b2e9c'
  const lines = Array.from({ length: 720 }, () => '')
  lines[719] = '毛利率比上年同期增加1.98个百分点。'
  const official = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content: lines.join('\n') } as CompanyResearchInput['sources'][number]
  const packetValue: CompanyEvidencePacket = {
    sourceCandidateId: candidateId,
    title: official.title,
    publisher: 'CNINFO',
    excerpts: [{ sourceCandidateId: candidateId, location: 'paragraph:720', text: lines[719]! }],
  }
  const draft = {
    findings: [{ text: '毛利率比上年同期增加1.98个百分点。', kind: 'fact' as const, evidence: [{ sourceCandidateId: malformedId, location: 'paragraph:720' }] }],
    markdown: `毛利率比上年同期增加1.98个百分点。[${malformedId}@paragraph:720]`,
    sections: [{ id: 'revenue-profit-drivers', markdown: `毛利率比上年同期增加1.98个百分点。[${malformedId}@paragraph:720]` }],
  }
  const result = repairCompanyTrailingSourceIdTypo(draft, [packetValue], { ...input, sources: [official] })
  assert.equal(result.output.markdown, `毛利率比上年同期增加1.98个百分点。[${candidateId}@paragraph:720]`)
  assert.deepEqual(result.output.findings[0]!.evidence, [{ sourceCandidateId: candidateId, location: 'paragraph:720' }])
  assert.equal(result.output.sections[0]!.markdown, `毛利率比上年同期增加1.98个百分点。[${candidateId}@paragraph:720]`)
  assert.equal(result.repairs.length, 1)
})

test('fails closed for repeated-tail source IDs when exact text, locator, or unique-source proof is missing', () => {
  const candidateId = 'official-c19c34dd239b2e9c'
  const malformedId = 'official-c19c34dd239b2e9bc34dd239b2e9c'
  const content = 'Other text.\n毛利率比上年同期增加1.98个百分点。'
  const official = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content } as CompanyResearchInput['sources'][number]
  const supplied = { sourceCandidateId: candidateId, title: official.title, publisher: 'CNINFO', excerpts: [{ sourceCandidateId: candidateId, location: 'paragraph:2', text: '毛利率比上年同期增加1.98个百分点。' }] } satisfies CompanyEvidencePacket
  const draft = { findings: [], markdown: `[${malformedId}@paragraph:2]`, sections: [{ id: 'revenue-profit-drivers', markdown: `[${malformedId}@paragraph:2]` }] }
  const unchanged = (result: { output: { markdown: string }; repairs: readonly unknown[] }) => {
    assert.equal(result.output.markdown, draft.markdown)
    assert.equal(result.repairs.length, 0)
  }
  unchanged(repairCompanyTrailingSourceIdTypo(draft, [{ ...supplied, excerpts: [{ ...supplied.excerpts[0]!, text: 'different text' }] }], { ...input, sources: [official] }))
  unchanged(repairCompanyTrailingSourceIdTypo(draft, [supplied], { ...input, sources: [{ ...official, content: 'Other text.\nDifferent text.' }] }))
  unchanged(repairCompanyTrailingSourceIdTypo(draft, [supplied, supplied], { ...input, sources: [official] }))
  const unrelatedDraft = { ...draft, markdown: '[official-completely-unrelated@paragraph:2]', sections: [{ id: 'revenue-profit-drivers', markdown: '[official-completely-unrelated@paragraph:2]' }] }
  const unrelated = repairCompanyTrailingSourceIdTypo(unrelatedDraft, [supplied], { ...input, sources: [official] })
  assert.equal(unrelated.output.markdown, unrelatedDraft.markdown)
  assert.equal(unrelated.repairs.length, 0)
})

function r105ProductMargins() {
  const rows = new Map<number, string>([
    ...['单位：元', '营业收入 营业成本 毛利率', '营业收入', '比上年同', '期增减', '营业成本', '比上年同', '期增减', '毛利率比', '上年同期', '增减'].map((text, index) => [716 + index, text] as const),
    [727, '分行业'],
    [728, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [729, '交通运输设备及电气制'],
    [730, '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
    [731, '分产品'],
    [732, '电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [733, '汽车、汽车相关产品及'],
    [734, '其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
    [736, '分地区'],
  ])
  const sourceValue = { ...source, title: '2026年半年度报告', content: Array.from({ length: 736 }, (_, i) => rows.get(i + 1) ?? '').join('\n') }
  const sourcePacket: CompanyEvidencePacket = { ...packet, title: sourceValue.title, excerpts: [...rows].map(([n, text]) => ({ sourceCandidateId: 'filing', location: `paragraph:${n}`, text })) }
  const text = '官方半年报电子及其他产品行毛利率为5.04%，同比变化为-2.67%；汽车相关产品行毛利率为22.33%，同比变化为1.98%。产品行及完整表头分别对应官方半年报，不能用汽车行变化替代电子行。'
  const evidence = [...Array.from({ length: 11 }, (_, i) => 716 + i), 731].map(n => ({ sourceCandidateId: 'filing', location: `paragraph:${n}` }))
  const draft = { findings: [{ text, kind: 'fact' as const, evidence }], markdown: `不同产品的盈利结构应分别核对。[filing@paragraph:731]`, sections: [{ id: 'industry-exposure', markdown: '市场边界不能混算。[filing@paragraph:731]' }] }
  return { sourceValue, sourcePacket, draft }
}

function r107PhoneProductMargin() {
  const rows = new Map<number, string>([
    [805, '（1） 营业收入构成'], [806, '单位：元'], [807, '2025 年 2024 年'], [809, '金额 占营业收入'], [810, '比重 金额 占营业收入比重'],
    [819, '手机部件、组装'], [820, '及其他产品 155,236,528,000.00 19.31% 159,608,576,000.00 20.54% -2.74%'],
    ...['单位：元', '营业收入 营业成本 毛利率 营业收入比上', '年同期增减', '营业成本比上', '年同期增减', '毛利率比上', '年同期增减'].map((text, i) => [833 + i, text] as const),
    [840, '分行业'], [841, '日用电子器件'], [842, '制造业 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'],
    [845, '分产品'], [850, '手机部件、组'], [851, '装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'],
    [856, '分地区'],
  ])
  const sourceValue = { ...source, content: Array.from({ length: 856 }, (_, i) => rows.get(i + 1) ?? '').join('\n') }
  const sourcePacket: CompanyEvidencePacket = { ...packet, excerpts: [...rows].map(([n, text]) => ({ sourceCandidateId: 'filing', location: `paragraph:${n}`, text })) }
  const text = '2025年手机部件、组装及其他产品收入155,236,528,000元，占营业收入19.31%；该产品类别毛利率为6.29%，不是公司合并毛利率。'
  const evidence = [805, 806, 807, 809, 810, 819, 820, 833, 834, 835, 836, 837].map(n => ({ sourceCandidateId: 'filing', location: `paragraph:${n}` }))
  const draft = { findings: [{ text, kind: 'fact' as const, evidence }], markdown: '不同产品有不同的经济结构。[filing@paragraph:820]', sections: ['business-model', 'business-segments', 'supply-chain'].map(id => ({ id, markdown: '披露产品口径应保持一致。[filing@paragraph:820]' })) }
  return { sourceValue, sourcePacket, draft }
}

test('R107 annual phone-product binder verifies full source header and completes only its missing citations', () => {
  const fixture = r107PhoneProductMargin()
  const result = repairCompanyMethodCitations(fixture.draft, [fixture.sourcePacket], { ...input, sources: [fixture.sourceValue] })
  assert.deepEqual(result.repairs[0]?.addedReferences.map(ref => ref.location), ['paragraph:838', 'paragraph:839', 'paragraph:845', 'paragraph:850', 'paragraph:851'])
  assert.equal(result.output.findings[0]!.text, fixture.draft.findings[0]!.text)
  assert.ok(!result.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:842'))
  const refs = result.output.findings[0]!.evidence
  assert.equal(validateCompanyNumericGrounding({ markdown: `${fixture.draft.findings[0]!.text} ${refs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [fixture.sourceValue], evidenceContexts: [fixture.sourcePacket] }).status, 'grounded')
})

test('R72 binds only the product-classification duplicate in a repeated annual revenue table', () => {
  const rows = new Map<number, string>([
    [805, '（1） 营业收入构成'], [806, '单位：元'], [807, '2025 年 2024 年'], [808, '同比增减'], [809, '金额 占营业收入'], [810, '比重 金额 占营业收入比重'],
    [811, '营业收入合计 803,964,958,000.00 100% 777,102,455,000.00 100% 3.46%'], [812, '分行业'],
    [813, '日用电子器件制造业'], [814, '其他 82,794,000.00 0.01% 111,944,000.00 0.01% -26.04%'], [818, '分产品'],
    [821, '汽车、汽车相关'], [822, '产品及其他产品 648,645,636,000.00 80.68% 617,381,935,000.00 79.45% 5.06%'],
    [823, '其他 82,794,000.00 0.01% 111,944,000.00 0.01% -26.04%'], [824, '分地区'],
  ])
  const official = { ...source, content: Array.from({ length: 824 }, (_, index) => rows.get(index + 1) ?? '').join('\n') }
  const excerpts = [806, 807, 809, 810, 821, 822, 823].map(paragraph => ({ sourceCandidateId: 'filing', location: `paragraph:${paragraph}`, text: rows.get(paragraph)! }))
  const evidencePacket: CompanyEvidencePacket = { ...packet, excerpts }
  const refs = [806, 807, 809, 810, 821, 822].map(paragraph => `[filing@paragraph:${paragraph}]`).join(' ')
  const table = `| 产品 | 2025年营业收入（元） | 占营业收入比重 |\n|---|---:|---:|\n| 汽车、汽车相关产品及其他产品 | 648,645,636,000.00 | 80.68% |\n| 其他 | 82,794,000.00 | 0.01% |\n\n表头与产品行见原表。${refs}`
  const draft = { findings: [], markdown: table, sections: [{ id: 'business-model', markdown: table }] }
  const result = repairCompanyMethodCitations(draft, [evidencePacket], { ...input, sources: [official] })
  const section = result.output.sections[0]!.markdown
  assert.match(section, /\| 其他 \| 82,794,000\.00 \| 0\.01% \[filing@paragraph:823\] \|/)
  assert.match(result.output.markdown, /\| 其他 \| 82,794,000\.00 \| 0\.01% \[filing@paragraph:823\] \|/)
  assert.ok(result.repairs.some(repair => repair.addedReferences.some(ref => ref.location === 'paragraph:823')))
  assert.equal(validateCompanyNumericGrounding({ markdown: section, sources: [official], evidenceContexts: [evidencePacket] }).status, 'grounded')

  const noProductAnchor = { ...draft, sections: draft.sections.map(item => ({ ...item, markdown: table.replace('[filing@paragraph:821] [filing@paragraph:822]', '') })) }
  assert.ok(!repairCompanyMethodCitations(noProductAnchor, [evidencePacket], { ...input, sources: [official] }).output.sections[0]!.markdown.includes('[filing@paragraph:823]'))
  const noOtherExcerpt = { ...evidencePacket, excerpts: evidencePacket.excerpts.filter(excerpt => excerpt.location !== 'paragraph:823') }
  assert.ok(!repairCompanyMethodCitations(draft, [noOtherExcerpt], { ...input, sources: [official] }).output.sections[0]!.markdown.includes('[filing@paragraph:823]'))
})

test('R111 corrects an annual product margin unit only when both exact cited source rows show percent cells', () => {
  const fixture = r107PhoneProductMargin()
  const lines = fixture.sourceValue.content.split('\n')
  lines[851] = '汽车、汽车相'
  lines[852] = '关产品及其他'
  lines[853] = '产品'
  lines[854] = '648,645,636,000.00 515,762,940,000.00 20.49% 5.06% 7.53% -1.82%'
  fixture.sourceValue.content = lines.join('\n')
  fixture.sourcePacket = { ...fixture.sourcePacket, excerpts: lines.flatMap((text, index) => text ? [{ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text }] : []) }
  const refs = [833, 834, 835, 836, 837, 838, 839, 845, 850, 851, 852, 853, 854, 855]
    .map(paragraph => `[filing@paragraph:${paragraph}]`).join(' ')
  const text = `反证是两类产品毛利率同比变化分别为-1.82个百分点（汽车相关产品及其他产品）和-2.06个百分点（手机部件、组装及其他产品）。${refs}`
  const draft = { ...fixture.draft, sections: fixture.draft.sections.map(section => section.id === 'business-model' ? { ...section, markdown: text } : section) }
  const result = repairCompanyMethodCitations(draft, [fixture.sourcePacket], { ...input, sources: [fixture.sourceValue] })
  const corrected = result.output.sections.find(section => section.id === 'business-model')!.markdown
  assert.match(corrected, /-1\.82%（汽车相关产品及其他产品）/)
  assert.match(corrected, /-2\.06%（手机部件、组装及其他产品）/)
  assert.doesNotMatch(corrected, /个百分点/)
  assert.equal(result.repairs.find(repair => repair.sectionId === 'business-model')?.addedReferences.length, 0)

  const missingRow = { ...draft, sections: draft.sections.map(section => section.id === 'business-model' ? { ...section, markdown: text.replace('[filing@paragraph:855]', '') } : section) }
  assert.equal(repairCompanyMethodCitations(missingRow, [fixture.sourcePacket], { ...input, sources: [fixture.sourceValue] }).repairs.some(repair => repair.reason.includes('only the incorrect “百分点”')), false)
})

test('R107 annual phone-product binder rejects incomplete, ambiguous, changed or incorrectly scoped proof', () => {
  const cases: { name: string; mutate: (f: ReturnType<typeof r107PhoneProductMargin>) => void }[] = [
    { name: 'wrong margin', mutate: f => { f.draft.findings[0]!.text = f.draft.findings[0]!.text.replace('6.29%', '6.30%') } },
    { name: 'wrong revenue', mutate: f => { f.draft.findings[0]!.text = f.draft.findings[0]!.text.replace('155,236,528,000', '155,236,528,001') } },
    { name: 'wrong year', mutate: f => { f.draft.findings[0]!.text = f.draft.findings[0]!.text.replace('2025年', '2024年') } },
    { name: 'wrong report year', mutate: f => { f.sourceValue.title = '2024年年度报告'; f.sourcePacket = { ...f.sourcePacket, title: f.sourceValue.title } } },
    { name: 'missing cited revenue row', mutate: f => { f.draft.findings[0]!.evidence = f.draft.findings[0]!.evidence.filter(r => r.location !== 'paragraph:820') } },
    { name: 'missing initial header citation', mutate: f => { f.draft.findings[0]!.evidence = f.draft.findings[0]!.evidence.filter(r => r.location !== 'paragraph:834') } },
    { name: 'missing initial supplied header', mutate: f => { f.sourcePacket = { ...f.sourcePacket, excerpts: f.sourcePacket.excerpts.filter(e => e.location !== 'paragraph:837') } } },
    { name: 'missing continuation', mutate: f => { f.sourcePacket = { ...f.sourcePacket, excerpts: f.sourcePacket.excerpts.filter(e => e.location !== 'paragraph:839') } } },
    { name: 'modified continuation', mutate: f => { f.sourcePacket = { ...f.sourcePacket, excerpts: f.sourcePacket.excerpts.map(e => e.location === 'paragraph:838' ? { ...e, text: '营业收入比上' } : e) } } },
    { name: 'wrong product label', mutate: f => { f.sourceValue.content = f.sourceValue.content.replace('手机部件、组\n', '储能部件、组\n'); f.sourcePacket = { ...f.sourcePacket, excerpts: f.sourcePacket.excerpts.map(e => e.location === 'paragraph:850' ? { ...e, text: '储能部件、组' } : e) } } },
    { name: 'duplicate matching product label and values', mutate: f => { const text = '手机部件、组装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'; const lines = f.sourceValue.content.split('\n'); lines[851] = text; f.sourceValue.content = lines.join('\n'); f.sourcePacket = { ...f.sourcePacket, excerpts: [...f.sourcePacket.excerpts, { sourceCandidateId: 'filing', location: 'paragraph:852', text }] } } },
    { name: 'source/excerpt mismatch', mutate: f => { f.sourceValue.content = f.sourceValue.content.replace('装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29%', '装及其他产品 155,236,528,000.00 145,473,989,000.00 6.30%') } },
    { name: 'industry row cannot replace missing product row', mutate: f => { f.sourcePacket = { ...f.sourcePacket, excerpts: f.sourcePacket.excerpts.filter(e => e.location !== 'paragraph:851') } } },
    { name: 'mismatched source identity', mutate: f => { f.sourcePacket = { ...f.sourcePacket, sourceCandidateId: 'other', excerpts: f.sourcePacket.excerpts.map(e => ({ ...e, sourceCandidateId: 'other' })) }; f.sourceValue = { ...f.sourceValue, candidate: { ...f.sourceValue.candidate, candidateId: 'other' } } } },
    { name: 'wrong method owner', mutate: f => { f.draft.sections = [{ id: 'industry-exposure', markdown: '行业分析。[filing@paragraph:820]' }] } },
  ]
  for (const scenario of cases) {
    const fixture = r107PhoneProductMargin()
    scenario.mutate(fixture)
    const result = repairCompanyMethodCitations(fixture.draft, [fixture.sourcePacket], { ...input, sources: [fixture.sourceValue] })
    assert.ok(!result.repairs.some(repair => repair.reason.startsWith('The cited 2025 phone-products')), scenario.name)
    assert.ok(!result.output.findings[0]!.evidence.some(ref => ['paragraph:842', 'paragraph:845', 'paragraph:850', 'paragraph:851'].includes(ref.location)), scenario.name)
  }
})

test('R105 market product-margin binder adds only actual product rows after full H1 header verification', () => {
  const { sourceValue, sourcePacket, draft } = r105ProductMargins()
  const result = repairCompanyMethodCitations(draft, [sourcePacket], { ...input, sources: [sourceValue] })
  assert.deepEqual(result.repairs[0]?.addedReferences.map(ref => ref.location), ['paragraph:732', 'paragraph:733', 'paragraph:734'])
  assert.equal(result.output.findings[0]!.text, draft.findings[0]!.text)
  const refs = result.output.findings[0]!.evidence
  assert.ok(!refs.some(ref => ['paragraph:727', 'paragraph:728', 'paragraph:729', 'paragraph:730'].includes(ref.location)))
  assert.equal(validateCompanyNumericGrounding({ markdown: `${draft.findings[0]!.text} ${refs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [sourceValue], evidenceContexts: [sourcePacket] }).status, 'grounded')
  const equivalent = { ...draft, findings: [{ ...draft.findings[0]!, text: draft.findings[0]!.text.replace('变化为-2.67', '下降2.67').replace('变化为1.98', '上升1.98') }] }
  assert.ok(repairCompanyMethodCitations(equivalent, [sourcePacket], { ...input, sources: [sourceValue] }).repairs.some(repair => repair.reason.startsWith('The cited complete H1')))
})

test('R105 product binder fails closed on period, source, scope, label, value, sign and excerpt ambiguities', () => {
  const cases: { name: string; mutate: (fixture: ReturnType<typeof r105ProductMargins>) => void }[] = [
    { name: 'wrong margin', mutate: f => { f.draft.findings[0]!.text = f.draft.findings[0]!.text.replace('5.04%', '5.05%') } },
    { name: 'wrong change sign', mutate: f => { f.draft.findings[0]!.text = f.draft.findings[0]!.text.replace('-2.67', '+2.67') } },
    { name: 'missing product citation', mutate: f => { f.draft.findings[0]!.evidence = f.draft.findings[0]!.evidence.filter(ref => ref.location !== 'paragraph:731') } },
    { name: 'missing header citation', mutate: f => { f.draft.findings[0]!.evidence = f.draft.findings[0]!.evidence.filter(ref => ref.location !== 'paragraph:725') } },
    { name: 'missing supplied product heading', mutate: f => { f.sourcePacket = { ...f.sourcePacket, excerpts: f.sourcePacket.excerpts.filter(e => e.location !== 'paragraph:731') } } },
    { name: 'wrong source period', mutate: f => { f.sourceValue.title = '2025年年度报告'; f.sourcePacket = { ...f.sourcePacket, title: f.sourceValue.title } } },
    { name: 'explicit conflicting year', mutate: f => { f.draft.findings[0]!.text = '2025年' + f.draft.findings[0]!.text } },
    { name: 'source text differs from excerpt', mutate: f => { f.sourceValue.content = f.sourceValue.content.replace('电子及其他产品 69,404', '储能及其他产品 69,404') } },
    { name: 'wrong product label in both source and packet', mutate: f => { f.sourceValue.content = f.sourceValue.content.replace('电子及其他产品 69,404', '储能及其他产品 69,404'); f.sourcePacket = { ...f.sourcePacket, excerpts: f.sourcePacket.excerpts.map(e => ({ ...e, text: e.text.replace('电子及其他产品 69,404', '储能及其他产品 69,404') })) } } },
    { name: 'duplicate matching product row', mutate: f => { const text = f.sourcePacket.excerpts.find(e => e.location === 'paragraph:732')!.text; const lines = f.sourceValue.content.split('\n'); lines[734] = text; f.sourceValue.content = lines.join('\n'); f.sourcePacket = { ...f.sourcePacket, excerpts: [...f.sourcePacket.excerpts, { sourceCandidateId: 'filing', location: 'paragraph:735', text }] } } },
    { name: 'another source cannot supply the rows', mutate: f => { f.sourceValue = { ...f.sourceValue, candidate: { ...f.sourceValue.candidate, candidateId: 'another' } }; f.sourcePacket = { ...f.sourcePacket, sourceCandidateId: 'another', excerpts: f.sourcePacket.excerpts.map(e => ({ ...e, sourceCandidateId: 'another' })) } } },
    { name: 'different method owner', mutate: f => { f.draft.sections[0]!.id = 'competition' } },
  ]
  for (const scenario of cases) {
    const fixture = r105ProductMargins()
    scenario.mutate(fixture)
    const result = repairCompanyMethodCitations(fixture.draft, [fixture.sourcePacket], { ...input, sources: [fixture.sourceValue] })
    assert.ok(!result.repairs.some(repair => repair.reason.startsWith('The cited complete H1')), scenario.name)
    assert.ok(!result.output.findings[0]!.evidence.some(ref => ['paragraph:732', 'paragraph:733', 'paragraph:734'].includes(ref.location)), scenario.name)
  }
})

test('market margin citations repair only unique same-period product rows and remain fail-closed when the exact row is absent', () => {
  const { sourceValue, sourcePacket, draft } = r105ProductMargins()
  const repaired = repairCompanyMethodCitations(draft, [sourcePacket], { ...input, sources: [sourceValue] })
  const refs = repaired.output.findings[0]!.evidence
  assert.ok(refs.some(ref => ref.location === 'paragraph:732'))
  assert.ok(refs.some(ref => ref.location === 'paragraph:733'))
  assert.ok(refs.some(ref => ref.location === 'paragraph:734'))
  assert.equal(validateCompanyNumericGrounding({
    markdown: `${draft.findings[0]!.text} ${refs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
    sources: [sourceValue], evidenceContexts: [sourcePacket],
  }).status, 'grounded')

  const missingRows = { ...sourcePacket, excerpts: sourcePacket.excerpts.filter(row => !['paragraph:732', 'paragraph:733', 'paragraph:734'].includes(row.location)) }
  const rejected = repairCompanyMethodCitations(draft, [missingRows], { ...input, sources: [sourceValue] })
  assert.equal(rejected.repairs.length, 0)
  assert.equal(validateCompanyNumericGrounding({
    markdown: `${draft.findings[0]!.text} ${rejected.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
    sources: [sourceValue], evidenceContexts: [missingRows],
  }).status, 'unsupported_numbers')
})

test('repair appends only unique supplied actual financial row, preserves numbers and records trace', () => {
  const result = repairCompanyMethodCitations(output(), [packet], input)
  assert.equal(result.repairs.length, 1)
  assert.equal(result.output.findings[0]!.text, finding.text)
  assert.ok(result.output.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:2'))
  assert.match(result.output.sections[0]!.markdown.split('\n')[0]!, /paragraph:2/)
  assert.equal(result.output.sections[0]!.markdown.split('\n')[1], '另一项经营结论。')
  assert.equal(result.repairs[0]!.originalReferences[0]!.location, 'paragraph:1')
})

test('inline numeric repair uses a supplied preceding PDF label when the data row is wrapped', () => {
  const productSource = { ...source, content: '单位：元\n汽车、汽车相关\n产品及其他产品 648,645,636,000.00 80.68%\n其他 82,794,000.00 0.01%' }
  const productPacket: CompanyEvidencePacket = { ...packet, excerpts: productSource.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text, ...(index === 2 ? { contextLocations: ['paragraph:1', 'paragraph:2'] } : {}) })) }
  const text = '2025年度汽车相关产品收入648,645,636,000.00元，占营业收入80.68%。'
  const value = { findings: [{ text, kind: 'fact' as const, evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:2' }, { sourceCandidateId: 'filing', location: 'paragraph:4' }] }], markdown: `${text}[filing@paragraph:2] [filing@paragraph:4]`, sections: [{ id: 'business-model', markdown: `${text}[filing@paragraph:2] [filing@paragraph:4]` }] }
  const result = repairCompanyMethodCitations(value, [productPacket], { ...input, sources: [productSource] })
  assert.ok(result.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:3'))
  assert.ok(result.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:1'))
  assert.match(result.output.sections[0]!.markdown, /\[filing@paragraph:3\]/)
})

test('section numeric citation repair adds the unique supplied continuation for a split market-share fact', () => {
  const marketSource={...source,content:'根据中汽协数据，二零二四年本集团新能源汽车销量在高基数的基础上同比增长超40%，市占率\n进一步提升至33.2%，同比增长1.3个百分点。'}
  const marketPacket:CompanyEvidencePacket={sourceCandidateId:'filing',title:'2025年年度报告',publisher:'公司',excerpts:marketSource.content.split('\n').map((text,index)=>({sourceCandidateId:'filing',location:`paragraph:${index+1}`,text}))}
  const claim='公司披露其新能源汽车在2024年市占率为33.2%，但该份额不能直接推导优势因果。'
  const result=repairCompanyMethodCitations({findings:[],markdown:`市场份额披露。[filing@paragraph:1]`,sections:[{id:'competition',markdown:`${claim} [filing@paragraph:1]`}]},[marketPacket],{...input,sources:[marketSource]})
  assert.match(result.output.sections[0]!.markdown,/\[filing@paragraph:2\]/)
  assert.ok(result.repairs.some(repair=>repair.sectionId==='competition'&&repair.addedReferences.some(ref=>ref.location==='paragraph:2')))
})

test('product optical-module row repair cites only matching supplied specification paragraphs', () => {
  const sourceId = 'official-interim-optical'
  const content = [
    '2026年半年度报告',
    '公司数据中心光模块产品。',
    '400G模块采用QSFP-DD、QSFP112及OSFP封装。',
    '800G光模块支持DSP、LPO和LRO架构。',
    '1.6T模块技术选项包括EML和InP PIC，采用OSFP封装。',
    '公司称100G PAM4 EML已用于模块产品。',
    '400G PAM4 EML仍处研发阶段，面向3.2T模块。',
  ].join('\n')
  const official = { ...source, candidate: { ...source.candidate, candidateId: sourceId }, title: '2026年半年度报告', content } as CompanyResearchInput['sources'][number]
  const packetValue: CompanyEvidencePacket = {
    sourceCandidateId: sourceId,
    title: official.title!,
    publisher: 'CNINFO',
    excerpts: content.split('\n').map((text, index) => ({ sourceCandidateId: sourceId, location: `paragraph:${index + 1}`, text })),
  }
  const row = `| 光模块 | H1销售额见技术节：400G封装/架构选择、800G架构和1.6T芯片技术选项。 [${sourceId}@paragraph:2] |`
  const draft = { findings: [], markdown: row, sections: [{ id: 'products', markdown: row }] }
  const result = repairCompanyMethodCitations(draft, [packetValue], { ...input, sources: [official] })
  const repaired = result.output.sections[0]!.markdown
  assert.match(repaired, new RegExp(`${sourceId}@paragraph:3`))
  assert.match(repaired, new RegExp(`${sourceId}@paragraph:4`))
  assert.match(repaired, new RegExp(`${sourceId}@paragraph:5`))
  assert.doesNotMatch(repaired, new RegExp(`${sourceId}@paragraph:7`), 'a 400G chip development statement cannot establish 400G module architecture')
  assert.equal(validateCompanyNumericGrounding({ markdown: repaired, sources: [official], evidenceContexts: [packetValue] }).status, 'grounded')

  const without400GPackage: CompanyEvidencePacket = { ...packetValue, excerpts: packetValue.excerpts.filter((excerpt) => excerpt.location !== 'paragraph:3') }
  const rejected = repairCompanyMethodCitations(draft, [without400GPackage], { ...input, sources: [official] })
  assert.doesNotMatch(rejected.output.sections[0]!.markdown, new RegExp(`${sourceId}@paragraph:7`))
  assert.equal(validateCompanyNumericGrounding({ markdown: rejected.output.sections[0]!.markdown, sources: [official], evidenceContexts: [without400GPackage] }).status, 'unsupported_numbers')

  const unrelatedSource = { ...official, candidate: { ...official.candidate, candidateId: 'official-unrelated' } }
  const unrelatedPacket: CompanyEvidencePacket = { ...packetValue, sourceCandidateId: 'official-unrelated', excerpts: packetValue.excerpts.map((excerpt) => ({ ...excerpt, sourceCandidateId: 'official-unrelated' })) }
  const excluded = repairCompanyMethodCitations(draft, [packetValue, unrelatedPacket], { ...input, sources: [official, unrelatedSource] })
  assert.doesNotMatch(excluded.output.sections[0]!.markdown, /official-unrelated@paragraph:(?:3|4|5)/, 'an otherwise matching but uncited source cannot be introduced')
})

test('finding citation repair combines exact cited rows when one claim reports separate customer percentages', () => {
  const customerSource = { ...source, content: '公司主要销售客户情况\n前五名客户合计销售金额（元） 145,648,095,000.00\n前五名客户合计销售金额占年度销售总额比例 18.12%\n1 客户一 100,736,686,000.00 12.53%' }
  const customerPacket: CompanyEvidencePacket = { ...packet, excerpts: customerSource.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })) }
  const text = '2025年前五名客户销售占比18.12%，第一大客户占12.53%。'
  const value = { findings: [{ text, kind: 'fact' as const, evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:2' }, { sourceCandidateId: 'filing', location: 'paragraph:4' }] }], markdown: `${text}[filing@paragraph:2] [filing@paragraph:4]`, sections: [{ id: 'risks', markdown: `${text}[filing@paragraph:2] [filing@paragraph:4]` }] }
  const result = repairCompanyMethodCitations(value, [customerPacket], { ...input, sources: [customerSource] })
  assert.ok(result.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:3'))
  assert.match(result.output.sections[0]!.markdown, /\[filing@paragraph:3\]/)
})

test('multi-row percentage findings add one uniquely matching numeric row per clause within the named table', () => {
  const tableSource = { ...source, content: [
    '营业收入 营业成本 毛利率',
    '毛利率比上年同期增减',
    '分产品',
    '汽车产品 100 80 20% -8% -5% 1%',
    '电子产品 200 180 10% 5% 6% -2%',
    '分行业',
    '汽车产品 100 80 20% -8% -5% 1%',
    '电子产品 200 180 10% 5% 6% -2%',
  ].join('\n') }
  const tablePacket: CompanyEvidencePacket = { ...packet, excerpts: tableSource.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })) }
  const text = '分产品表中汽车产品收入同比下降8%，毛利率20%，同比上升1%；电子产品收入同比上升5%，毛利率10%，同比下降2%。'
  const value = {
    findings: [{ text, kind: 'fact' as const, evidence: [1, 2, 3].map(location => ({ sourceCandidateId: 'filing', location: `paragraph:${location}` })) }],
    markdown: `${text}[filing@paragraph:1] [filing@paragraph:2] [filing@paragraph:3]`,
    sections: [{ id: 'revenue-profit-drivers', markdown: `${text}[filing@paragraph:1] [filing@paragraph:2] [filing@paragraph:3]` }],
  }
  const result = repairCompanyMethodCitations(value, [tablePacket], { ...input, sources: [tableSource] })
  const repaired = result.output.findings[0]!.evidence.map(ref => ref.location)
  assert.ok(repaired.includes('paragraph:4'), 'first product claim must cite its numeric row')
  assert.ok(repaired.includes('paragraph:5'), 'second product claim must cite its numeric row')
  assert.ok(!repaired.includes('paragraph:7') && !repaired.includes('paragraph:8'), 'duplicate values in the industry table cannot substitute for product rows')
  assert.match(result.output.sections[0]!.markdown, /\[filing@paragraph:4\]/)
  assert.match(result.output.sections[0]!.markdown, /\[filing@paragraph:5\]/)
})

test('generic single-row repair honors explicit product scope when the industry table has an equal-valued semantic match', () => {
  const lines = [
    '营业收入构成',
    '分行业',
    '电子业务同比增长0.96%。',
    '分产品',
    '电子及其他产品收入同比增长0.96%。',
    '汽车相关业务收入648645636000元，占比80.68%。',
  ]
  const sourceValue = { ...source, content: lines.join('\n') }
  const tablePacket: CompanyEvidencePacket = {
    sourceCandidateId: 'filing', title: sourceValue.title, publisher: '公司',
    excerpts: lines.map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })),
  }
  const text = '分产品表披露：汽车相关业务收入648645636000元，占比80.68%。'
  const draft = {
    findings: [{ text, kind: 'fact' as const, evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:1' }, { sourceCandidateId: 'filing', location: 'paragraph:4' }] }],
    markdown: text,
    sections: [{ id: 'business-model', markdown: text }],
  }
  const repaired = repairCompanyMethodCitations(draft, [tablePacket], { ...input, sources: [sourceValue] })
  const refs = repaired.output.findings[0]!.evidence.map(ref => ref.location)
  assert.ok(refs.includes('paragraph:6'), 'the uniquely scoped product row should be added')
  assert.ok(!refs.includes('paragraph:3'), 'an equal-valued industry row must never be added to an explicit product claim')
  assert.equal(repaired.repairs.length, 1)

  const wrongTableText = '2025年分产品表披露电子业务同比增长0.96%。'
  const wrongTableDraft = {
    ...draft,
    findings: [{ ...draft.findings[0]!, text: wrongTableText }],
    markdown: wrongTableText,
    sections: [{ id: 'business-model', markdown: wrongTableText }],
  }
  const wrongTableRepair = repairCompanyMethodCitations(wrongTableDraft, [tablePacket], { ...input, sources: [sourceValue] })
  const wrongTableRefs = wrongTableRepair.output.findings[0]!.evidence.map(ref => ref.location)
  assert.ok(!wrongTableRefs.includes('paragraph:3'), 'an industry-only semantic match must never support an explicit product claim')
})

test('split industry margin repair adds only the exact signed row when its complete supplied header is cited', () => {
  const lines = [
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入比上年同期增减',
    '营业成本比上年同期增减',
    '毛利率比上年同期增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
  ]
  const sourceValue = { ...source, content: lines.join('\n') }
  const sourcePacket: CompanyEvidencePacket = {
    sourceCandidateId: 'filing', title: sourceValue.title, publisher: '公司',
    excerpts: lines.map((text, index) => ({
      sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text,
      ...(index === 6 ? { contextLocations: ['paragraph:1', 'paragraph:2', 'paragraph:3', 'paragraph:4', 'paragraph:5'] } : {}),
      ...(index === 8 ? { contextLocations: ['paragraph:1', 'paragraph:2', 'paragraph:3', 'paragraph:4', 'paragraph:5', 'paragraph:8'] } : {}),
    })),
  }
  const text = '半年报分行业表显示，日用电子器件制造业毛利率同比下降2.67%；交通运输设备及电气制造业毛利率同比上升1.98%。'
  const headerRefs = [1, 2, 3, 4, 5].map(location => ({ sourceCandidateId: 'filing', location: `paragraph:${location}` }))
  const draft = {
    findings: [{ text, kind: 'fact' as const, evidence: [...headerRefs, { sourceCandidateId: 'filing', location: 'paragraph:7' }] }],
    markdown: text,
    sections: [{ id: 'revenue-profit-drivers', markdown: text }],
  }
  const valid = repairCompanyMethodCitations(draft, [sourcePacket], { ...input, sources: [sourceValue] })
  assert.ok(valid.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:8'), 'the exact split label must be cited')
  assert.ok(valid.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:9'), 'the exact numeric row must be cited')
  assert.match(valid.output.sections[0]!.markdown, /\[filing@paragraph:8\]/)
  assert.match(valid.output.sections[0]!.markdown, /\[filing@paragraph:9\]/)

  const wrongSign = { ...draft, findings: [{ ...draft.findings[0]!, text: text.replace('同比上升1.98', '同比下降1.98') }] }
  assert.equal(repairCompanyMethodCitations(wrongSign, [sourcePacket], { ...input, sources: [sourceValue] }).repairs.length, 0)

  const duplicateLines = [...lines.slice(0, 9), lines[7]!, lines[8]!, ...lines.slice(9)]
  const duplicateSource = { ...source, content: duplicateLines.join('\n') }
  const duplicatePacket: CompanyEvidencePacket = { ...sourcePacket, excerpts: duplicateLines.map((text, index) => ({
    sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text,
    ...([6, 10, 12].includes(index) ? { contextLocations: ['paragraph:1', 'paragraph:2', 'paragraph:3', 'paragraph:4', 'paragraph:5'] } : {}),
    ...(index === 8 || index === 10 ? { contextLocations: ['paragraph:1', 'paragraph:2', 'paragraph:3', 'paragraph:4', 'paragraph:5', `paragraph:${index}`] } : {}),
  })) }
  assert.equal(repairCompanyMethodCitations(draft, [duplicatePacket], { ...input, sources: [duplicateSource] }).repairs.length, 0)

  const missingHeaderPacket: CompanyEvidencePacket = { ...sourcePacket, excerpts: sourcePacket.excerpts.filter(excerpt => excerpt.location !== 'paragraph:4') }
  assert.equal(repairCompanyMethodCitations(draft, [missingHeaderPacket], { ...input, sources: [sourceValue] }).repairs.length, 0)
})

test('R111 single H1 industry finding receives only its exact supplied numeric continuation', () => {
  const lines = [
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入比上年同期增减',
    '营业成本比上年同期增减',
    '毛利率比上年同期增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
  ]
  const report = { ...source, title: '2026年半年度报告', content: lines.join('\n') }
  const sourcePacket: CompanyEvidencePacket = {
    sourceCandidateId: 'filing', title: report.title, publisher: '公司',
    excerpts: lines.map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })),
  }
  const text = '交通运输设备及电气制造业毛利率比上年同期增减为1.98%。'
  const refs = Array.from({ length: 8 }, (_, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}` }))
  const draft = {
    findings: [{ text, kind: 'fact' as const, evidence: refs }],
    markdown: text,
    sections: [{ id: 'revenue-profit-drivers', markdown: `${text} [filing@paragraph:9]` }],
  }
  const repaired = repairCompanyMethodCitations(draft, [sourcePacket], { ...input, sources: [report] })
  assert.deepEqual(repaired.repairs[0]?.addedReferences.map(ref => ref.location), ['paragraph:9'])
  assert.equal(validateCompanyNumericGrounding({
    markdown: `${text} ${repaired.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
    sources: [report], evidenceContexts: [sourcePacket],
  }).status, 'grounded')

  const wrongValue = { ...draft, findings: [{ ...draft.findings[0]!, text: text.replace('1.98', '1.99') }] }
  assert.equal(repairCompanyMethodCitations(wrongValue, [sourcePacket], { ...input, sources: [report] }).repairs.length, 0)
})

test('R84 split margin table findings receive only uniquely matched row citations after citing the complete header', () => {
  const lines = [
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入',
    '比上年同',
    '期增减',
    '营业成本',
    '比上年同',
    '期增减',
    '毛利率比',
    '上年同期',
    '增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
    '分产品',
    '电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
  ]
  const report = { ...source, content: lines.join('\n') }
  const tablePacket: CompanyEvidencePacket = {
    sourceCandidateId: 'filing', title: report.title, publisher: '公司',
    excerpts: lines.map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })),
  }
  const headerRefs = Array.from({ length: 11 }, (_, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}` }))
  const businessText = '半年报分行业表中，日用电子器件制造业收入同比0.96%、成本同比3.88%、毛利率5.04%、毛利率同比变动-2.67%；交通运输设备及电气制造业对应为收入-8.98%、成本-11.24%、毛利率22.33%、毛利率同比变动1.98%。'
  const businessDraft = {
    findings: [{ text: businessText, kind: 'fact' as const, evidence: [...headerRefs, { sourceCandidateId: 'filing', location: 'paragraph:12' }, { sourceCandidateId: 'filing', location: 'paragraph:13' }] }],
    markdown: businessText,
    sections: [{ id: 'revenue-profit-drivers', markdown: businessText }],
  }
  const repairedBusiness = repairCompanyMethodCitations(businessDraft, [tablePacket], { ...input, sources: [report] })
  assert.ok(repairedBusiness.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:14'), 'split industry label must be cited')
  assert.ok(repairedBusiness.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:15'), 'transport industry numeric continuation must be cited')
  assert.equal(validateCompanyNumericGrounding({ markdown: `${businessText} ${repairedBusiness.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [report], evidenceContexts: [tablePacket] }).status, 'grounded')

  const marketText = '半年度披露中电子及其他产品毛利率同比变化为-2.67%，交通运输设备及电气制造业毛利率同比变化为1.98%；分属不同业务分类，不能互相替代。'
  const marketDraft = {
    findings: [{ text: marketText, kind: 'fact' as const, evidence: headerRefs }],
    markdown: marketText,
    sections: [{ id: 'industry-exposure', markdown: marketText }],
  }
  const repairedMarket = repairCompanyMethodCitations(marketDraft, [tablePacket], { ...input, sources: [report] })
  assert.ok(repairedMarket.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:15'))
  assert.ok(repairedMarket.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:16'), 'product segmentation heading must be cited separately')
  assert.ok(repairedMarket.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:17'), 'product numeric row must not borrow the industry row')

  const duplicateLines = [...lines.slice(0, 15), lines[13]!, lines[14]!, ...lines.slice(15)]
  const duplicateReport = { ...source, content: duplicateLines.join('\n') }
  const duplicatePacket: CompanyEvidencePacket = { ...tablePacket, excerpts: duplicateLines.map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })) }
  assert.equal(repairCompanyMethodCitations(businessDraft, [duplicatePacket], { ...input, sources: [duplicateReport] }).repairs.length, 0, 'duplicate same-label row values must remain ambiguous')

  const incompleteHeader = businessDraft.findings[0]!.evidence.filter(ref => ref.location !== 'paragraph:2')
  const missingHeaderDraft = { ...businessDraft, markdown: '', sections: [], findings: [{ ...businessDraft.findings[0]!, evidence: incompleteHeader }] }
  assert.equal(repairCompanyMethodCitations(missingHeaderDraft, [tablePacket], { ...input, sources: [report] }).repairs.length, 0, 'a mostly cited header is insufficient')
})

test('R85 reported industry-margin finding repairs the omitted exact continuation row only', () => {
  const excerpts = [
    ['paragraph:716', '单位：元'],
    ['paragraph:717', '营业收入 营业成本 毛利率'],
    ['paragraph:718', '营业收入'],
    ['paragraph:719', '比上年同'],
    ['paragraph:720', '期增减'],
    ['paragraph:721', '营业成本'],
    ['paragraph:722', '比上年同'],
    ['paragraph:723', '期增减'],
    ['paragraph:724', '毛利率比'],
    ['paragraph:725', '上年同期'],
    ['paragraph:726', '增减'],
    ['paragraph:727', '分行业'],
    ['paragraph:728', '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    ['paragraph:729', '交通运输设备及电气制'],
    ['paragraph:730', '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ] as const
  const report = { ...source, title:'2025年半年度报告', content: Array.from({ length: 730 }, (_, index) => excerpts.find(([location]) => location === `paragraph:${index + 1}`)?.[1] ?? '').join('\n') }
  const tablePacket: CompanyEvidencePacket = {
    sourceCandidateId: 'filing', title: report.title, publisher: '公司',
    excerpts: excerpts.map(([location, text]) => ({
      sourceCandidateId: 'filing', location, text,
      ...(['paragraph:728', 'paragraph:730'].includes(location)
        ? { contextLocations: ['paragraph:716', 'paragraph:717', 'paragraph:718', 'paragraph:719', 'paragraph:720', 'paragraph:721', 'paragraph:722', 'paragraph:723', 'paragraph:724', 'paragraph:725', 'paragraph:726'] }
        : {}),
    })),
  }
  const text = '事实：半年度分行业表报告日用电子器件制造业毛利率5.04%，同比下降2.67%；交通运输设备及电气制造业毛利率22.33%，同比上升1.98%；同表给出相应收入、成本同比增速。单位成本不能从总成本率或毛利率直接推断。'
  const cited = ['paragraph:716', 'paragraph:717', 'paragraph:718', 'paragraph:719', 'paragraph:720', 'paragraph:721', 'paragraph:722', 'paragraph:723', 'paragraph:724', 'paragraph:725', 'paragraph:726', 'paragraph:727', 'paragraph:728']
  const draft = {
    findings: [{ text, kind: 'fact' as const, evidence: cited.map(location => ({ sourceCandidateId: 'filing', location })) }],
    markdown: text,
    sections: [],
  }
  const result = repairCompanyMethodCitations(draft, [tablePacket], { ...input, sources: [report] })
  const locations = result.output.findings[0]!.evidence.map(ref => ref.location)
  assert.equal(result.repairs.length, 1)
  assert.ok(locations.includes('paragraph:729'), 'exact split row label must be added')
  assert.ok(locations.includes('paragraph:730'), 'exact numeric continuation must be added')
  assert.ok(!locations.some(location => ['paragraph:731', 'paragraph:732'].includes(location)), 'repair must not borrow neighboring classifications')
  const references = result.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
  const [marginFinding, costLimitation] = text.split('。单位成本')
  const grounding = validateCompanyNumericGrounding({ markdown: `${marginFinding}。${references}\n单位成本${costLimitation}`, sources: [report], evidenceContexts: [tablePacket] })
  assert.equal(grounding.status, 'grounded',JSON.stringify({diagnostics:grounding.diagnostics,locations}))
  const misplacedCitation = validateCompanyNumericGrounding({ markdown: `${marginFinding}。\n单位成本${costLimitation} ${references}`, sources: [report], evidenceContexts: [tablePacket] })
  assert.equal(misplacedCitation.status, 'unsupported_numbers', 'a later unrelated sentence cannot lend its citations to the industry-margin claim')
})

test('financial-quality findings cite exact H1 industry margin rows, including a split classification label',()=>{
  const excerpts=[
    ['paragraph:716','单位：元'],['paragraph:717','营业收入 营业成本 毛利率'],['paragraph:718','营业收入'],['paragraph:719','比上年同'],['paragraph:720','期增减'],['paragraph:721','营业成本'],['paragraph:722','比上年同'],['paragraph:723','期增减'],['paragraph:724','毛利率比'],['paragraph:725','上年同期'],['paragraph:726','增减'],['paragraph:727','分行业'],
    ['paragraph:728','日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],['paragraph:729','交通运输设备及电气制'],['paragraph:730','造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ] as const
  const report={...source,title:'2026年半年度报告',content:Array.from({length:730},(_,index)=>excerpts.find(([location])=>location===`paragraph:${index+1}`)?.[1]??'').join('\n')}
  const packet:CompanyEvidencePacket={sourceCandidateId:'filing',title:report.title,publisher:'公司',excerpts:excerpts.map(([location,text])=>({sourceCandidateId:'filing',location,text}))}
  const headerRefs=excerpts.slice(0,12).map(([location])=>({sourceCandidateId:'filing',location}))
  const findings=[
    {text:'事实：半年报分行业表列示：日用电子器件制造业毛利率5.04%，同比下降2.67%。变化列按原表百分号单位照录。',kind:'fact' as const,evidence:headerRefs},
    {text:'事实：半年报分行业表列示：交通运输设备及电气制造业毛利率22.33%，同比上升1.98%。变化列按原表百分号单位照录。',kind:'fact' as const,evidence:headerRefs},
  ]
  const markdown=findings.map(finding=>`${finding.text} ${headerRefs.map(ref=>`[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`).join('\n')
  const result=repairCompanyMethodCitations({findings,markdown,sections:[{id:'financial-quality',markdown}]},[packet],{...input,sources:[report]})
  assert.ok(result.repairs.some(repair=>repair.findingIndex===0&&repair.addedReferences.some(ref=>ref.location==='paragraph:728')))
  assert.ok(result.repairs.some(repair=>repair.findingIndex===1&&repair.addedReferences.some(ref=>ref.location==='paragraph:729')&&repair.addedReferences.some(ref=>ref.location==='paragraph:730')))
  assert.match(result.output.sections[0]!.markdown,/\[filing@paragraph:728\]/)
  assert.match(result.output.sections[0]!.markdown,/\[filing@paragraph:729\]/)
  assert.match(result.output.sections[0]!.markdown,/\[filing@paragraph:730\]/)
  const grounding=validateCompanyNumericGrounding({markdown:result.output.sections[0]!.markdown,sources:[report],evidenceContexts:[packet]})
  assert.equal(grounding.status,'grounded',JSON.stringify({diagnostics:grounding.diagnostics,markdown:result.output.sections[0]!.markdown}))
})

test('R169 market-structure H1 findings backfill only their uniquely matched value row', () => {
  const candidateId = 'official-c19c34dd239b2e9c'
  const lines = new Map<number, string>([
    [716, '单位：元'], [717, '营业收入 营业成本 毛利率'], [718, '营业收入'], [719, '比上年同'], [720, '期增减'],
    [721, '营业成本'], [722, '比上年同'], [723, '期增减'], [724, '毛利率比'], [725, '上年同期'], [726, '增减'],
    [727, '分行业'], [728, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [729, '交通运输设备及电气制'], [730, '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
    [731, '分产品'], [732, '电子及其他产品 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [733, '汽车、汽车相关产品及'], [734, '其他产品 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ])
  const content = Array.from({ length: 734 }, (_, index) => lines.get(index + 1) ?? '').join('\n')
  const report = { ...source, candidate: { ...source.candidate, candidateId }, title: '2026年半年度报告', content }
  const packetValue: CompanyEvidencePacket = {
    sourceCandidateId: candidateId, title: report.title, publisher: '公司',
    excerpts: [...lines].map(([paragraph, text]) => ({ sourceCandidateId: candidateId, location: `paragraph:${paragraph}`, text })),
  }
  const headerRefs = Array.from({ length: 11 }, (_, index) => ({ sourceCandidateId: candidateId, location: `paragraph:${716 + index}` }))
  const cases = [
    {
      text: '2026年半年度报告分行业分类中，日用电子器件制造业行对应收入69,404,994,000元、成本65,907,931,000元、毛利率5.04%，毛利率比上年同期增减列为-2.67%。完整表头包含单位、营业收入、营业成本、毛利率及同比变动列，期间为该半年度报告期。',
      evidence: [...headerRefs, { sourceCandidateId: candidateId, location: 'paragraph:727' }],
      row: 'paragraph:728',
    },
    {
      text: '2026年半年度报告分产品分类中，汽车、汽车相关产品及其他产品对应收入275,341,358,000元、成本213,863,297,000元、毛利率22.33%，毛利率比上年同期增减列为1.98%。完整表头包含单位、营业收入、营业成本、毛利率及同比变动列，期间为该半年度报告期。',
      evidence: [...headerRefs, { sourceCandidateId: candidateId, location: 'paragraph:733' }],
      row: 'paragraph:734',
    },
  ]
  for (const item of cases) {
    const refs = item.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
    const methodDraft = {
      findings: [{ text: item.text, kind: 'fact' as const, evidence: item.evidence }],
      markdown: item.text,
      sections: [{ id: 'industry-exposure', markdown: item.text }],
    }
    const before = validateCompanyNumericGrounding({ markdown: `${item.text} ${refs}`, sources: [report], evidenceContexts: [packetValue] })
    assert.equal(before.status, 'unsupported_numbers', 'R169-style finding lacks its exact value row')
    const repaired = repairCompanyMethodCitations(methodDraft, [packetValue], { ...input, sources: [report] })
    assert.deepEqual(repaired.repairs[0]?.addedReferences.map(ref => ref.location), [item.row])
    assert.ok(repaired.output.findings[0]!.evidence.some(ref => ref.location === item.row))
    if (item.row === 'paragraph:734') assert.ok(repaired.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:733'), 'retain the supplied split product label')
    const afterRefs = repaired.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')
    const after = validateCompanyNumericGrounding({ markdown: `${item.text} ${afterRefs}`, sources: [report], evidenceContexts: [packetValue] })
    assert.equal(after.status, 'grounded', JSON.stringify(after.diagnostics))
  }

  const product = cases[1]!
  const draftFor = (text: string, evidence = product.evidence) => ({
    findings: [{ text, kind: 'fact' as const, evidence }], markdown: text,
    sections: [{ id: 'industry-exposure', markdown: text }],
  })
  const shouldNotRepair = (draft: ReturnType<typeof draftFor>, packet = packetValue, sources = [report]) => {
    const result = repairCompanyMethodCitations(draft, [packet], { ...input, sources })
    assert.ok(!result.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:734'), JSON.stringify({reason:'must not add the numeric continuation without exact unique support',evidence:result.output.findings[0]!.evidence,repairs:result.repairs}))
    return result
  }
  shouldNotRepair(draftFor(product.text, product.evidence.filter(ref => ref.location !== 'paragraph:720')), packetValue)
  shouldNotRepair(draftFor(product.text.replace('汽车、汽车相关产品及其他产品', '汽车及其他产品')), packetValue)
  shouldNotRepair(draftFor(product.text.replace('275,341,358,000元', '275,341,358,001元')), packetValue)
  const duplicate = new Map(lines)
  duplicate.set(735, `汽车、汽车相关产品及其他产品 ${lines.get(734)!.replace(/^其他产品\s+/, '')}`)
  const duplicateSource = { ...report, content: Array.from({ length: 735 }, (_, index) => duplicate.get(index + 1) ?? '').join('\n') }
  const duplicatePacket: CompanyEvidencePacket = { ...packetValue, excerpts: [...packetValue.excerpts,
    { sourceCandidateId: candidateId, location: 'paragraph:735', text: duplicate.get(735)! },
  ] }
  shouldNotRepair(draftFor(product.text), duplicatePacket, [duplicateSource])
  shouldNotRepair(draftFor(product.text), packetValue, [report, { ...report }])
})

test('R92 financial margin finding adds only omitted split headers and industry title for the exact row', () => {
  const excerpts = [
    ['paragraph:716', '单位：元'],
    ['paragraph:717', '营业收入 营业成本 毛利率'],
    ['paragraph:718', '营业收入'],
    ['paragraph:719', '比上年同'],
    ['paragraph:720', '期增减'],
    ['paragraph:721', '营业成本'],
    ['paragraph:722', '比上年同'],
    ['paragraph:723', '期增减'],
    ['paragraph:724', '毛利率比'],
    ['paragraph:725', '上年同期'],
    ['paragraph:726', '增减'],
    ['paragraph:727', '分行业'],
    ['paragraph:728', '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    ['paragraph:729', '交通运输设备及电气制'],
    ['paragraph:730', '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ] as const
  const report = { ...source, title:'2025年半年度报告', content: Array.from({ length: 730 }, (_, index) => excerpts.find(([location]) => location === `paragraph:${index + 1}`)?.[1] ?? '').join('\n') }
  const tablePacket: CompanyEvidencePacket = {
    sourceCandidateId: 'filing', title: report.title, publisher: '公司',
    excerpts: excerpts.map(([location, text]) => ({
      sourceCandidateId: 'filing', location, text,
      ...(location === 'paragraph:728' ? { contextLocations: excerpts.slice(0, 11).map(([contextLocation]) => contextLocation) } : {}),
    })),
  }
  const text = '事实：半年报分行业披露日用电子器件制造业毛利率5.04%，同比下降2.67%，收入同比增长0.96%；毛利率变动表头与行业数据行均由引用支持。'
  const initiallyCited = ['paragraph:716', 'paragraph:717', 'paragraph:718', 'paragraph:719', 'paragraph:720', 'paragraph:724', 'paragraph:725', 'paragraph:726', 'paragraph:728']
  const refs = initiallyCited.map(location => ({ sourceCandidateId: 'filing', location }))
  const draft = { findings: [{ text, kind: 'fact' as const, evidence: refs }], markdown: text, sections: [{ id: 'financial-quality', markdown: text }] }
  const repaired = repairCompanyMethodCitations(draft, [tablePacket], { ...input, sources: [report] })
  const locations = repaired.output.findings[0]!.evidence.map(ref => ref.location)
  for (const location of ['paragraph:721', 'paragraph:722', 'paragraph:723', 'paragraph:727']) assert.ok(locations.includes(location), `${location} must be explicitly added`)
  assert.equal(repaired.repairs.length, 1)
  assert.equal(validateCompanyNumericGrounding({ markdown: `${text} ${repaired.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [report], evidenceContexts: [tablePacket] }).status, 'grounded')

  const nearLabel = text.replace('日用电子器件制造业', '日用电子部件制造业')
  const rejected = repairCompanyMethodCitations({ ...draft, findings: [{ ...draft.findings[0]!, text: nearLabel }] }, [tablePacket], { ...input, sources: [report] })
  assert.equal(rejected.repairs.length, 0, 'a near-match industry label must not receive the exact row citations')
})

test('colon-style industry margin claims bind each label and signed value to the unique industry rows', () => {
  const lines = [
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入',
    '比上年同',
    '期增减',
    '营业成本',
    '比上年同',
    '期增减',
    '毛利率比',
    '上年同期',
    '增减',
    '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
    '交通运输设备及电气制',
    '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%',
  ]
  const sourceValue = { ...source, content: lines.join('\n') }
  const headerLocations = Array.from({ length: 11 }, (_, index) => `paragraph:${index + 1}`)
  const sourcePacket: CompanyEvidencePacket = {
    sourceCandidateId: 'filing', title: sourceValue.title, publisher: '公司',
    excerpts: lines.map((text, index) => ({
      sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text,
      ...([12, 14].includes(index) ? { contextLocations: headerLocations } : {}),
    })),
  }
  const text = '半年度分行业毛利率：交通运输设备及电气制造业为22.33%，同比变化+1.98%；日用电子器件制造业为5.04%，同比变化-2.67%。此为分行业数据，不是合并毛利率。'
  const evidence = Array.from({ length: 12 }, (_, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}` }))
  const draft = {
    findings: [{ text, kind: 'fact' as const, evidence }],
    markdown: `${text}[filing@paragraph:1]`,
    sections: [{ id: 'financial-quality', markdown: `${text}[filing@paragraph:1]` }],
  }
  const valid = repairCompanyMethodCitations(draft, [sourcePacket], { ...input, sources: [sourceValue] })
  const locations = valid.output.findings[0]!.evidence.map(ref => ref.location)
  for (const location of ['paragraph:13', 'paragraph:14', 'paragraph:15']) assert.ok(locations.includes(location), `exact industry claim must cite ${location}`)

  const wrongSign = { ...draft, findings: [{ ...draft.findings[0]!, text: text.replace('同比变化+1.98', '同比变化-1.98') }] }
  assert.equal(repairCompanyMethodCitations(wrongSign, [sourcePacket], { ...input, sources: [sourceValue] }).repairs.length, 0)
  const wrongLabel = { ...draft, findings: [{ ...draft.findings[0]!, text: text.replace('交通运输设备及电气制造业', '新能源设备制造业') }] }
  assert.equal(repairCompanyMethodCitations(wrongLabel, [sourcePacket], { ...input, sources: [sourceValue] }).repairs.length, 0)
  const missingUnitPacket: CompanyEvidencePacket = { ...sourcePacket, excerpts: sourcePacket.excerpts.filter(excerpt => excerpt.location !== 'paragraph:1') }
  assert.equal(repairCompanyMethodCitations(draft, [missingUnitPacket], { ...input, sources: [sourceValue] }).repairs.length, 0)
})

test('single-value industry margin findings receive their own exact numeric row citation', () => {
  const lines = [
    '单位：元', '营业收入 营业成本 毛利率', '营业收入', '比上年同', '期增减',
    '营业成本', '比上年同', '期增减', '毛利率比', '上年同期', '增减', '分行业',
    '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%',
  ]
  const sourceValue = { ...source, title: '比亚迪股份有限公司 2026 年半年度报告全文', content: lines.join('\n') }
  const headerAndSection = Array.from({ length: 12 }, (_, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}` }))
  const sourcePacket: CompanyEvidencePacket = {
    sourceCandidateId: 'filing', title: sourceValue.title, publisher: '公司',
    excerpts: lines.map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })),
  }
  const claim = '日用电子器件制造业毛利率比上年同期增减为-2.67%。'
  const draft = { findings: [{ text: claim, kind: 'fact' as const, evidence: headerAndSection }], markdown: '', sections: [{ id: 'revenue-profit-drivers', markdown: claim }] }
  const repaired = repairCompanyMethodCitations(draft, [sourcePacket], { ...input, sources: [sourceValue] })
  assert.ok(repaired.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:13'))
  assert.equal(repaired.repairs.length, 1)
})

test('split product margin repair uses the leading table kind and adds only exact product row references', () => {
  const locations = new Map<number, string>([
    [716, '单位：元'],
    [717, '营业收入 营业成本 毛利率'],
    [718, '营业收入'],
    [719, '比上年同'],
    [720, '期增减'],
    [721, '营业成本'],
    [722, '比上年同'],
    [723, '期增减'],
    [724, '毛利率比'],
    [725, '上年同期'],
    [726, '增减'],
    [727, '分行业'],
    [728, '日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [729, '交通运输设备及电气制'],
    [730, '造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
    [731, '分产品'],
    [732, '电子及其他产品 100 80 5.04% 0.96% 3.88% -2.67%'],
    [733, '汽车、汽车相关产品及'],
    [734, '其他产品 200 150 22.33% -8.98% -11.24% 1.98%'],
  ])
  const sourceValue = { ...source, content: Array.from({ length: 734 }, (_, index) => locations.get(index + 1) ?? '').join('\n') }
  const headerLocations = Array.from({ length: 11 }, (_, index) => `paragraph:${716 + index}`)
  const excerpts: CompanyEvidencePacket['excerpts'][number][] = [...locations.entries()].map(([paragraph, text]) => ({
    sourceCandidateId: 'filing', location: `paragraph:${paragraph}`, text,
    ...([728, 730, 732, 734].includes(paragraph) ? { contextLocations: headerLocations } : {}),
  }))
  const sourcePacket: CompanyEvidencePacket = { sourceCandidateId: 'filing', title: sourceValue.title, publisher: '公司', excerpts }
  const text = '分产品表中汽车、汽车相关产品及其他产品毛利率同比+1.98%，电子及其他产品毛利率同比-2.67%；分产品行不能与分行业行标签混用。'
  const evidence = [...headerLocations.slice(0, 8).map(location => ({ sourceCandidateId: 'filing', location })), { sourceCandidateId: 'filing', location: 'paragraph:731' }]
  const draft = {
    findings: [{ text, kind: 'fact' as const, evidence }],
    markdown: `${text}[filing@paragraph:716] [filing@paragraph:731]`,
    sections: [{ id: 'revenue-profit-drivers', markdown: `${text}[filing@paragraph:716] [filing@paragraph:731]` }],
  }
  const repaired = repairCompanyMethodCitations(draft, [sourcePacket, { ...sourcePacket }], { ...input, sources: [sourceValue] })
  const repairedLocations = repaired.output.findings[0]!.evidence.map(ref => ref.location)
  assert.ok(repairedLocations.includes('paragraph:732'), 'the exact inline electronic product row must be cited')
  assert.ok(repairedLocations.includes('paragraph:733'), 'the exact split automotive product label must be cited')
  assert.ok(repairedLocations.includes('paragraph:734'), 'the exact automotive product numeric row must be cited')
  assert.match(repaired.output.sections[0]!.markdown, /\[filing@paragraph:732\]/)
  assert.match(repaired.output.sections[0]!.markdown, /\[filing@paragraph:733\]/)
  assert.match(repaired.output.sections[0]!.markdown, /\[filing@paragraph:734\]/)
  for (const location of ['paragraph:724', 'paragraph:725', 'paragraph:726']) {
    assert.ok(repairedLocations.includes(location), `the supplied complete margin header must add ${location}`)
    assert.match(repaired.output.sections[0]!.markdown, new RegExp(`\\[filing@${location}\\]`))
  }
  assert.equal(repaired.repairs.length, 1)

  const industryText = '分行业表中，交通运输设备及电气制造业收入同比下降8.98%、成本下降11.24%、毛利率同比增加1.98%，日用电子器件制造业收入增0.96%、成本增3.88%、毛利率同比下降2.67%；分行业行不能与分产品行标签混用。'
  const industryRefs = [...headerLocations.slice(0, 8).map(location => ({ sourceCandidateId: 'filing', location })), { sourceCandidateId: 'filing', location: 'paragraph:727' }]
  const industryDraft = {
    findings: [{ text: industryText, kind: 'fact' as const, evidence: industryRefs }],
    markdown: `${industryText}[filing@paragraph:716] [filing@paragraph:727]`,
    sections: [{ id: 'revenue-profit-drivers', markdown: `${industryText}[filing@paragraph:716] [filing@paragraph:727]` }],
  }
  const industryRepaired = repairCompanyMethodCitations(industryDraft, [sourcePacket], { ...input, sources: [sourceValue] })
  const industryLocations = industryRepaired.output.findings[0]!.evidence.map(ref => ref.location)
  for (const location of ['paragraph:728', 'paragraph:729', 'paragraph:730']) assert.ok(industryLocations.includes(location), `multi-row industry claim must cite ${location}`)
  assert.equal(industryRepaired.repairs.length, 1)

  const missingHeaderPacket: CompanyEvidencePacket = {
    ...sourcePacket,
    excerpts: sourcePacket.excerpts.filter(excerpt => !['paragraph:724', 'paragraph:725', 'paragraph:726'].includes(excerpt.location)),
  }
  assert.equal(repairCompanyMethodCitations(draft, [missingHeaderPacket], { ...input, sources: [sourceValue] }).repairs.length, 0, 'a table is not repaired if its complete supplied header is missing')
  const conflictingHeaderPacket: CompanyEvidencePacket = {
    ...sourcePacket,
    excerpts: [...sourcePacket.excerpts, { sourceCandidateId: 'filing', location: 'paragraph:726', text: '单位：元' }],
  }
  assert.equal(repairCompanyMethodCitations(draft, [sourcePacket, conflictingHeaderPacket], { ...input, sources: [sourceValue] }).repairs.length, 0, 'conflicting same-locator header excerpts are ambiguous')
})

test('R88 product-margin aliases backfill exact supplied product rows and never borrow equal industry rows', () => {
  const paragraphText = new Map<number, string>([
    [833, '单位：元'],
    [834, '营业收入 营业成本 毛利率 营业收入比上'],
    [835, '年同期增减'],
    [836, '营业成本比上'],
    [837, '年同期增减'],
    [838, '毛利率比上'],
    [839, '年同期增减'],
    [840, '分行业'],
    [841, '日用电子器件'],
    [842, '制造业 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'],
    [843, '交通运输设备'],
    [844, '及电气制造业 648,645,636,000.00 515,762,940,000.00 20.49% 5.06% 7.53% -1.82%'],
    [845, '分产品'],
    [850, '手机部件、组'],
    [851, '装及其他产品 155,236,528,000.00 145,473,989,000.00 6.29% -2.74% -0.56% -2.06%'],
    [852, '汽车、汽车相'],
    [853, '关产品及其他'],
    [854, '产品'],
    [855, '648,645,636,000.00 515,762,940,000.00 20.49% 5.06% 7.53% -1.82%'],
  ])
  const content = Array.from({ length: 855 }, (_, index) => paragraphText.get(index + 1) ?? '').join('\n')
  const productSource = { ...source, content, candidate: { ...source.candidate, candidateId: 'annual-filing' } }
  const allParagraphs = [...paragraphText.entries()].map(([paragraph, text]) => ({
    sourceCandidateId: 'annual-filing', location: `paragraph:${paragraph}`, text,
    ...([842, 844, 851, 855].includes(paragraph) ? { contextLocations: ['paragraph:833', 'paragraph:834', 'paragraph:835', 'paragraph:836', 'paragraph:837', 'paragraph:838', 'paragraph:839'] } : {}),
  }))
  const tablePacket: CompanyEvidencePacket = { sourceCandidateId: 'annual-filing', title: '2025年年度报告', publisher: '公司', excerpts: allParagraphs }
  const text = '2025年产品毛利率分别为汽车相关产品20.49%、手机产品6.29%；这是产品口径，不是合并毛利率。'
  const headerRefs = Array.from({ length: 7 }, (_, index) => ({ sourceCandidateId: 'annual-filing', location: `paragraph:${833 + index}` }))
  const draft = {
    findings: [{ text, kind: 'fact' as const, evidence: headerRefs }],
    markdown: `${text} ${headerRefs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
    sections: [{ id: 'business-model', markdown: `${text} ${headerRefs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}` }],
  }
  const repaired = repairCompanyMethodCitations(draft, [tablePacket], { ...input, sources: [productSource] })
  const repairedLocations = repaired.output.findings[0]!.evidence.map(ref => ref.location)
  for (const location of ['paragraph:845', 'paragraph:850', 'paragraph:851', 'paragraph:852', 'paragraph:853', 'paragraph:854', 'paragraph:855']) {
    assert.ok(repairedLocations.includes(location), `the exact 分产品 evidence must include ${location}`)
  }
  assert.ok(!repairedLocations.includes('paragraph:842') && !repairedLocations.includes('paragraph:844'), 'same-valued 分行业 rows must not be selected')
  assert.equal(repaired.repairs.length, 1)
  assert.equal(validateCompanyNumericGrounding({
    markdown: `${text} ${repaired.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
    sources: [productSource], evidenceContexts: [tablePacket],
  }).status, 'grounded')

  const industryOnlyPacket: CompanyEvidencePacket = {
    ...tablePacket,
    excerpts: allParagraphs.filter(excerpt => Number(excerpt.location.split(':')[1]) <= 844),
  }
  const industryOnly = repairCompanyMethodCitations(draft, [industryOnlyPacket], { ...input, sources: [productSource] })
  assert.equal(industryOnly.repairs.length, 0, 'an equal margin in the adjacent 分行业 table is not a product-row fallback')
  assert.deepEqual(industryOnly.output.findings[0]!.evidence, headerRefs)

  const wrongAlias = { ...draft, findings: [{ ...draft.findings[0]!, text: text.replace('手机产品', '电子产品') }] }
  assert.equal(repairCompanyMethodCitations(wrongAlias, [tablePacket], { ...input, sources: [productSource] }).repairs.length, 0, 'unlisted business aliases fail closed')
})

test('repair adds a uniquely matching supplied paragraph for an inline numeric claim within an already cited source', () => {
  const supplierSource = { ...source, content: '前五名供应商合计采购金额（元） 98,700,166,000.00\n前五名供应商合计采购金额占年度采购总额比例 15.31%\n前五名供应商采购额中关联方采购额占年度采购总额比例 1.15%\n第一名供应商采购额占年度采购总额比例 9.74%' }
  const supplierPacket: CompanyEvidencePacket = { ...packet, excerpts: supplierSource.content.split('\n').map((text,index)=>({sourceCandidateId:'filing',location:`paragraph:${index+1}`,text})) }
  const supplierText = '供应商合计采购98,700,166,000元，占采购总额15.31%；第一大供应商占9.74%。关联方采购占比1.15%，该项仅说明关联采购的披露比例。[filing@paragraph:1] [filing@paragraph:2] [filing@paragraph:4]'
  const inputOutput = { findings: [], markdown: '', sections: [{ id: 'supply-chain', markdown: supplierText }] }
  const result = repairCompanyMethodCitations(inputOutput, [supplierPacket], { ...input, sources: [supplierSource] })
  assert.equal(result.repairs.length, 1)
  assert.match(result.output.sections[0]!.markdown, /\[filing@paragraph:3\]/)
  assert.equal(result.repairs[0]!.sectionId, 'supply-chain')
})

test('unavailable locator is rebound only to one matching excerpt from the same supplied source', () => {
  const historicalSource = { ...source, content: 'Unrelated disclosure.\n报告期内，分车型类别产销量数据发生变化主要是公司业务增长以及产品结构变化所致。' }
  const historicalPacket: CompanyEvidencePacket = { sourceCandidateId: 'filing', title: '2025年年度报告', publisher: '公司', excerpts: [{ sourceCandidateId: 'filing', location: 'paragraph:2', text: historicalSource.content.split('\n')[1]! }] }
  const claim = '2025年年报仅定性称分车型产销量数据变化主要来自业务增长以及产品结构变化。'
  const draft = { findings: [], markdown: `${claim} [filing@paragraph:999]`, sections: [{ id: 'revenue-profit-drivers', markdown: `${claim} [filing@paragraph:999]` }] }
  const repaired = repairUnavailableCompanyMethodCitations(draft, [historicalPacket], { ...input, sources: [historicalSource] })
  assert.equal(repaired.repairs.length, 2)
  assert.equal(repaired.output.sections[0]!.markdown, `${claim} [filing@paragraph:2]`)

  const ambiguousPacket = { ...historicalPacket, excerpts: [historicalPacket.excerpts[0]!, { ...historicalPacket.excerpts[0]!, location: 'paragraph:3' }] }
  const ambiguous = repairUnavailableCompanyMethodCitations(draft, [ambiguousPacket], { ...input, sources: [historicalSource] })
  assert.equal(ambiguous.repairs.length, 0)
  assert.match(ambiguous.output.sections[0]!.markdown, /paragraph:999/)
})

test('an unavailable source id is rebound only when the exact locator has one semantic and numeric match',()=>{
  const historicalSource={...source,content:'报告期内，分车型类别产销量数据发生变化主要是公司业务增长以及产品结构变化所致。'}
  const verifiedSource={...historicalSource,candidate:{...historicalSource.candidate,candidateId:'verified-filing'}}
  const historicalPacket:CompanyEvidencePacket={sourceCandidateId:'verified-filing',title:'2025年年度报告',publisher:'公司',excerpts:[{sourceCandidateId:'verified-filing',location:'paragraph:2',text:historicalSource.content}]}
  const claim='2025年年报称分车型类别产销量变化主要来自公司业务增长以及产品结构变化。'
  const draft={findings:[],markdown:`${claim} [wrong-report-id@paragraph:2]`,sections:[{id:'company-history',markdown:`${claim} [wrong-report-id@paragraph:2]`}]}
  const repaired=repairUnavailableCompanyMethodCitations(draft,[historicalPacket],{...input,sources:[verifiedSource]})
  assert.equal(repaired.repairs.length,2)
  assert.match(repaired.output.sections[0]!.markdown,/\[verified-filing@paragraph:2\]/)
  const unrelated='市场份额超过50%。 [wrong-report-id@paragraph:2]'
  const rejected=repairUnavailableCompanyMethodCitations({...draft,markdown:unrelated,sections:[{id:'company-history',markdown:unrelated}]},[historicalPacket],{...input,sources:[verifiedSource]})
  assert.equal(rejected.repairs.length,0)
})

test('governance citations repair a source-id collision only when the same paragraph supports the control claim',()=>{
  const wrongSource={...source,candidate:{...source.candidate,candidateId:'wrong-annual'},content:'公司持续加强研发投入。'}
  const verifiedSource={...source,candidate:{...source.candidate,candidateId:'verified-annual'},content:'公司实际控制人为袁永刚、袁永峰、袁富根，三人为一致行动人。'}
  const packets:CompanyEvidencePacket[]=[verifiedSource].map(item=>({sourceCandidateId:item.candidate.candidateId,title:'2025年年度报告',publisher:'公司',excerpts:[{sourceCandidateId:item.candidate.candidateId,location:'paragraph:4069',text:item.content}]}))
  const claim='公司实际控制人为袁永刚、袁永峰、袁富根，三人为一致行动人。'
  const draft={findings:[],markdown:`${claim} [wrong-annual@paragraph:4069]`,sections:[{id:'management-capital-allocation',markdown:`${claim} [wrong-annual@paragraph:4069]`}]}
  const repaired=repairUnavailableCompanyMethodCitations(draft,packets,{...input,sources:[wrongSource,verifiedSource]})
  assert.equal(repaired.repairs.length,2)
  assert.match(repaired.output.sections[0]!.markdown,/\[verified-annual@paragraph:4069\]/)

  const unrelatedSource={...verifiedSource,content:'公司持续加强内部控制建设，报告期内未发现重大缺陷。'}
  const unrelatedPacket:CompanyEvidencePacket={sourceCandidateId:'verified-annual',title:'2025年年度报告',publisher:'公司',excerpts:[{sourceCandidateId:'verified-annual',location:'paragraph:4069',text:unrelatedSource.content}]}
  const rejected=repairUnavailableCompanyMethodCitations(draft,[unrelatedPacket],{...input,sources:[wrongSource,unrelatedSource]})
  assert.equal(rejected.repairs.length,0)
  assert.match(rejected.output.sections[0]!.markdown,/wrong-annual@paragraph:4069/)
})

test('an unavailable shareholder-note source is rebound only when its exact excerpt uniquely matches and cited table rows ground the percentage', () => {
  const tableId = 'half-year-shareholders'
  const annualId = 'annual-governance'
  const tableSource = { ...source, candidate: { candidateId: tableId }, title: '2026年半年度报告', content: '前十名股东表\nHKSCC NOMINEES LIMITED 境外法人 40.38% 3,681,498,007' } as CompanyResearchInput['sources'][number]
  const annualContent = Array(5886).fill('')
  annualContent[5885] = '2、HKSCC NOMINEES LIMITED 所持股份为其代理的交易平台交易本公司H股。'
  const annualSource = { ...source, candidate: { candidateId: annualId }, title: '2025年年度报告', content: annualContent.join('\n') } as CompanyResearchInput['sources'][number]
  const tablePacket: CompanyEvidencePacket = { sourceCandidateId: tableId, title: tableSource.title!, publisher: '公司', excerpts: tableSource.content.split('\n').map((text, index) => ({ sourceCandidateId: tableId, location: `paragraph:${index + 1}`, text })) }
  const annualPacket: CompanyEvidencePacket = { sourceCandidateId: annualId, title: annualSource.title!, publisher: '公司', excerpts: [{ sourceCandidateId: annualId, location: 'paragraph:5886', text: annualContent[5885]! }] }
  const claim = 'HKSCC NOMINEES LIMITED在股东表中列示持股40.38%；年报注释称其持股为代理持有，因此不应直接解释为单一最终投资者的集中持股。'
  const tableRefs = [{ sourceCandidateId: tableId, location: 'paragraph:1' }, { sourceCandidateId: tableId, location: 'paragraph:2' }]
  const draft = {
    findings: [{ text: claim, kind: 'fact' as const, evidence: [...tableRefs, { sourceCandidateId: tableId, location: 'paragraph:5886' }] }],
    markdown: '', sections: [],
  }
  const repaired = repairUnavailableCompanyMethodCitations(draft, [tablePacket, annualPacket], { ...input, sources: [tableSource, annualSource] })
  assert.equal(repaired.repairs.length, 1)
  assert.deepEqual(repaired.output.findings[0]!.evidence.at(-1), { sourceCandidateId: annualId, location: 'paragraph:5886' })
  const grounding = validateCompanyNumericGrounding({
    markdown: `${claim} ${repaired.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
    sources: [tableSource, annualSource], evidenceContexts: [tablePacket, annualPacket],
  })
  assert.equal(grounding.status, 'grounded', JSON.stringify(grounding.diagnostics))

  const noNumericSupport = repairUnavailableCompanyMethodCitations({
    ...draft,
    findings: [{ ...draft.findings[0]!, evidence: [{ sourceCandidateId: tableId, location: 'paragraph:1' }, { sourceCandidateId: tableId, location: 'paragraph:5886' }] }],
  }, [tablePacket, annualPacket], { ...input, sources: [tableSource, annualSource] })
  assert.equal(noNumericSupport.repairs.length, 1, 'the exact note may be rebound independently from the numeric table claim')
  const unsupportedNumber = validateCompanyNumericGrounding({
    markdown: `${claim} ${noNumericSupport.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
    sources: [tableSource, annualSource], evidenceContexts: [tablePacket, annualPacket],
  })
  assert.equal(unsupportedNumber.status, 'unsupported_numbers', 'repairing the note must not make it prove the shareholder percentage')
})

test('an unknown markdown source id is rebound only from one semantic match at the exact supplied locator',()=>{
  const productSource={...source,candidate:{...source.candidate,candidateId:'official-verified'},content:'公司汽车产品覆盖乘用车和商用车，产品矩阵面向多元应用场景。'}
  const productPacket:CompanyEvidencePacket={sourceCandidateId:'official-verified',title:'公司产品资料',publisher:'公司',excerpts:[{sourceCandidateId:'official-verified',location:'paragraph:585',text:productSource.content}]}
  const claim='公司汽车产品覆盖乘用车和商用车，产品矩阵面向多元应用场景。'
  const draft={findings:[],markdown:`${claim} [official-c19c34dd239b9e@paragraph:585]`,sections:[{id:'products',markdown:`${claim} [official-c19c34dd239b9e@paragraph:585]`}]}
  const repaired=repairUnavailableCompanyMethodCitations(draft,[productPacket],{...input,sources:[productSource]})
  assert.equal(repaired.repairs.length,2)
  assert.match(repaired.output.sections[0]!.markdown,/\[official-verified@paragraph:585\]/)

  const wrongClaim=`${claim} [official-c19c34dd239b9e@paragraph:584]`
  const wrongLocator=repairUnavailableCompanyMethodCitations({...draft,markdown:wrongClaim,sections:[{id:'products',markdown:wrongClaim}]},[productPacket],{...input,sources:[productSource]})
  assert.equal(wrongLocator.repairs.length,0,'an unknown source id cannot borrow a nearby locator')
  assert.match(wrongLocator.output.sections[0]!.markdown,/official-c19c34dd239b9e@paragraph:584/)

  const ambiguousPacket:CompanyEvidencePacket={sourceCandidateId:'official-other',title:'公司产品资料副本',publisher:'公司',excerpts:[{sourceCandidateId:'official-other',location:'paragraph:585',text:productSource.content}]}
  const ambiguousSource={...productSource,candidate:{...productSource.candidate,candidateId:'official-other'}}
  const ambiguous=repairUnavailableCompanyMethodCitations(draft,[productPacket,ambiguousPacket],{...input,sources:[productSource,ambiguousSource]})
  assert.equal(ambiguous.repairs.length,0,'multiple semantic matches at the exact locator remain unresolved')
  assert.match(ambiguous.output.sections[0]!.markdown,/official-c19c34dd239b9e@paragraph:585/)
})

test('R145 review retry repairs a malformed source id only from unique exact-locator text overlap',()=>{
  const sourceId='official-c19c34dd239b2e9c'
  const wrongId='official-f7c8d23d2829b2e9c'
  const rows=new Map<number,string>([
    [164,'动力电池、电驱动、电控、车规级半导体、整车平台及智能座舱等领域形成技术布局。'],
    [165,'汽车电动化：本集团坚持纯电动和插电式混合动力路线，围绕动力电池、纯电/插混平台持续开展技术研发。'],
    [166,'相关技术成果在多品牌、多车型中规模化应用。'],
  ])
  const content=Array.from({length:166},(_,index)=>rows.get(index+1)??'').join('\n')
  const verifiedSource={...source,candidate:{...source.candidate,candidateId:sourceId},title:'2026年半年度报告',content}
  const wrongSource={...source,candidate:{...source.candidate,candidateId:'official-f7c8d23d2829a5e8'},title:'2025年年度报告',content:'其他汽车业务披露。'}
  const officialPacket:CompanyEvidencePacket={sourceCandidateId:sourceId,title:verifiedSource.title!,publisher:'公司',excerpts:[
    {sourceCandidateId:sourceId,location:'paragraph:164',text:rows.get(164)!},
    {sourceCandidateId:sourceId,location:'paragraph:165',text:rows.get(165)!,contextLocations:['paragraph:164','paragraph:166']},
    {sourceCandidateId:sourceId,location:'paragraph:166',text:rows.get(166)!},
  ]}
  const claim='公司披露持续技术研发与多车型规模化应用，并围绕动力电池、纯电/插混平台布局关键技术。'
  const draft={status:'complete',answer:'关键技术成果持续应用。',markdown:`${claim} [${wrongId}@paragraph:165]`,sections:[{id:'competition',markdown:`${claim} [${wrongId}@paragraph:165]`}],findings:[{text:claim,kind:'fact' as const,evidence:[{sourceCandidateId:wrongId,location:'paragraph:165'}]}],limitations:[],risks:[]}
  const options={...input,sources:[verifiedSource,wrongSource]}
  const repaired=repairUnavailableCompanyMethodCitations(draft,[officialPacket],options)
  assert.equal(repaired.repairs.length,3)
  assert.match(repaired.output.sections[0]!.markdown,/\[official-c19c34dd239b2e9c@paragraph:165\]/)
  assert.ok(repaired.repairs.every(repair=>repair.originalReferences[0]?.sourceCandidateId===wrongId&&repair.addedReferences[0]?.sourceCandidateId===sourceId))
  assert.equal(validateCompanyMethodOutput(repaired.output,[officialPacket]).status,'complete')

  const collisionId='official-collision-report'
  const collisionSource={...verifiedSource,candidate:{...verifiedSource.candidate,candidateId:collisionId}}
  const collisionPacket:CompanyEvidencePacket={...officialPacket,sourceCandidateId:collisionId,title:'另一份同段号报告',excerpts:officialPacket.excerpts.map(row=>({...row,sourceCandidateId:collisionId}))}
  const ambiguous=repairUnavailableCompanyMethodCitations(draft,[officialPacket,collisionPacket],{...input,sources:[verifiedSource,collisionSource]})
  assert.equal(ambiguous.repairs.length,0,'an exact paragraph collision across sources remains ambiguous')
  assert.match(ambiguous.output.sections[0]!.markdown,new RegExp(`${wrongId}@paragraph:165`))

  const unrelatedText='市场份额尚未披露，新能源汽车行业竞争加剧。'
  const unrelatedSource={...verifiedSource,content:Array.from({length:165},(_,index)=>index===164?unrelatedText:'').join('\n')}
  const unrelatedPacket:CompanyEvidencePacket={...officialPacket,excerpts:[{sourceCandidateId:sourceId,location:'paragraph:165',text:unrelatedText}]}
  const unsupported=repairUnavailableCompanyMethodCitations(draft,[unrelatedPacket],{...input,sources:[unrelatedSource]})
  assert.equal(unsupported.repairs.length,0,'a unique exact locator without same-claim overlap cannot repair the source id')
  assert.match(unsupported.output.sections[0]!.markdown,new RegExp(`${wrongId}@paragraph:165`))
})

test('a truncated source id is completed only when it is a unique strict prefix with the same exact locator',()=>{
  const officialId='official-296fff2b2889c26f'
  const truncatedId='official-296fff2b2889c26'
  const claim='2026年上半年营业收入同比增长63.95%。'
  const excerpt='2026年上半年，公司营业收入同比增长63.95%。'
  const officialSource={...source,candidate:{...source.candidate,candidateId:officialId},title:'2026年半年度报告',content:Array.from({length:787},(_,index)=>index===786?excerpt:'').join('\n')}
  const officialPacket:CompanyEvidencePacket={sourceCandidateId:officialId,title:officialSource.title!,publisher:'公司',excerpts:[{sourceCandidateId:officialId,location:'paragraph:787',text:excerpt}]}
  const draft={markdown:`${claim} [${truncatedId}@paragraph:787]`,sections:[{id:'revenue-profit-drivers',markdown:`${claim} [${truncatedId}@paragraph:787]`}]}
  const repaired=repairUnavailableCompanyMethodCitations(draft,[officialPacket],{...input,sources:[officialSource]})
  assert.equal(repaired.repairs.length,2)
  assert.match(repaired.output.sections[0]!.markdown,new RegExp(`\\[${officialId}@paragraph:787\\]`))

  const collisionId='official-296fff2b2889c260'
  const collisionSource={...officialSource,candidate:{...officialSource.candidate,candidateId:collisionId}}
  const collisionPacket:CompanyEvidencePacket={...officialPacket,sourceCandidateId:collisionId,excerpts:[{sourceCandidateId:collisionId,location:'paragraph:787',text:excerpt}]}
  const ambiguous=repairUnavailableCompanyMethodCitations(draft,[officialPacket,collisionPacket],{...input,sources:[officialSource,collisionSource]})
  assert.equal(ambiguous.repairs.length,0,'two supplied source ids share the invalid prefix and exact locator')
  assert.match(ambiguous.output.sections[0]!.markdown,new RegExp(`${truncatedId}@paragraph:787`))
})

test('an unknown source id is rebound only when its exact locator has one candidate and the excerpt supports the claim',()=>{
  const officialId='official-f7c8d23d2829a5e8'
  const wrongId='official-f7c8d23d2829f062'
  const claim='中国自主品牌乘用车市场份额达到69.5%，较去年同期增长4.3个百分点。'
  const excerpt='根据中国汽车工业协会的数据，二零二五年中国自主品牌乘用车市场份额达到69.5%，较去年同期增长4.3个百分点。'
  const officialContent=Array.from({length:397},(_,index)=>index===396?excerpt:'').join('\n')
  const officialSource={...source,candidate:{...source.candidate,candidateId:officialId},content:officialContent}
  const officialPacket:CompanyEvidencePacket={sourceCandidateId:officialId,title:'2025年年度报告',publisher:'公司',excerpts:[{sourceCandidateId:officialId,location:'paragraph:397',text:excerpt}]}
  const badRef={sourceCandidateId:wrongId,location:'paragraph:397'}
  const draft={
    status:'complete',answer:'自主品牌市场扩张加剧竞争。',markdown:`${claim} [${wrongId}@paragraph:397]`,
    sections:[{id:'competition',markdown:`${claim} [${wrongId}@paragraph:397]`}],
    findings:[{text:claim,kind:'fact' as const,evidence:[badRef]}],limitations:[],risks:[],
  }
  const repaired=repairUnavailableCompanyMethodCitations(draft,[officialPacket],{...input,sources:[officialSource]})
  assert.equal(repaired.repairs.length,3)
  assert.match(repaired.output.sections[0]!.markdown,new RegExp(`\\[${officialId}@paragraph:397\\]`))
  assert.deepEqual(repaired.output.findings[0]!.evidence,[{sourceCandidateId:officialId,location:'paragraph:397'}])
  const validated=validateCompanyMethodOutput(repaired.output,[officialPacket])
  assert.equal(validated.status,'complete')
  const numeric=validateCompanyNumericGrounding({markdown:`${validated.sections[0]!.markdown} ${validated.findings[0]!.text} [${officialId}@paragraph:397]`,sources:[officialSource],evidenceContexts:[officialPacket]})
  assert.equal(numeric.status,'grounded',JSON.stringify(numeric.diagnostics))

  const collisionId='official-collision'
  const collisionExcerpt='市场竞争加剧，但未披露自主品牌乘用车市场份额。'
  const collisionSource={...officialSource,candidate:{...officialSource.candidate,candidateId:collisionId},content:Array.from({length:397},(_,index)=>index===396?collisionExcerpt:'').join('\n')}
  const collisionPacket:CompanyEvidencePacket={sourceCandidateId:collisionId,title:'行业资料',publisher:'行业资料',excerpts:[{sourceCandidateId:collisionId,location:'paragraph:397',text:collisionExcerpt}]}
  const collision=repairUnavailableCompanyMethodCitations(draft,[officialPacket,collisionPacket],{...input,sources:[officialSource,collisionSource]})
  assert.equal(collision.repairs.length,0,'same-number paragraph in another candidate remains ambiguous even when only one excerpt semantically matches')
  assert.match(collision.output.sections[0]!.markdown,new RegExp(wrongId))

  const unrelatedExcerpt='新能源汽车行业竞争白热化，价格竞争加剧。'
  const unrelatedSource={...officialSource,content:Array.from({length:397},(_,index)=>index===396?unrelatedExcerpt:'').join('\n')}
  const unrelatedPacket:CompanyEvidencePacket={...officialPacket,excerpts:[{sourceCandidateId:officialId,location:'paragraph:397',text:unrelatedExcerpt}]}
  const unsupported=repairUnavailableCompanyMethodCitations(draft,[unrelatedPacket],{...input,sources:[unrelatedSource]})
  assert.equal(unsupported.repairs.length,0,'a unique locator is insufficient when its excerpt does not support the cited share claim')
  assert.match(unsupported.output.sections[0]!.markdown,new RegExp(wrongId))
})

test('a colliding exact locator is disambiguated only by same-claim references to one source',()=>{
  const h1Id='official-c19c34dd239b2e9c'
  const annualId='official-f6274e510499a654'
  const typo='official-c19b34dd239b2e9c'
  const rows=new Map<number,string>([
    [716,'单位：元'],[717,'营业收入 营业成本 毛利率'],[718,'营业收入'],[719,'比上年同'],[720,'期增减'],
    [721,'营业成本'],[722,'比上年同'],[723,'期增减'],[724,'毛利率比'],[725,'上年同期'],[726,'增减'],
    [727,'分行业'],[728,'日用电子器件制造业 69,404,994,000.00 65,907,931,000.00 5.04% 0.96% 3.88% -2.67%'],
    [729,'交通运输设备及电气制'],[730,'造业 275,341,358,000.00 213,863,297,000.00 22.33% -8.98% -11.24% 1.98%'],
  ])
  const h1Content=Array.from({length:730},(_,index)=>rows.get(index+1)??'').join('\n')
  const h1Source={...source,candidate:{...source.candidate,candidateId:h1Id},title:'2026年半年度报告',content:h1Content}
  const h1Packet:CompanyEvidencePacket={sourceCandidateId:h1Id,title:h1Source.title!,publisher:'公司',excerpts:[...rows].map(([paragraph,text])=>({sourceCandidateId:h1Id,location:`paragraph:${paragraph}`,text}))}
  const annualContent=Array.from({length:718},(_,index)=>index===716?'分行业':index===717?'年度行业表格标题':'').join('\n')
  const annualSource={...source,candidate:{...source.candidate,candidateId:annualId},title:'2024年年度报告',content:annualContent}
  const annualPacket:CompanyEvidencePacket={sourceCandidateId:annualId,title:annualSource.title!,publisher:'公司',excerpts:[{sourceCandidateId:annualId,location:'paragraph:717',text:'分行业'},{sourceCandidateId:annualId,location:'paragraph:718',text:'年度行业表格标题'}]}
  const claim='半年度分行业表中，日用电子器件制造业毛利率比上年同期增减为-2.67%；交通运输设备及电气制造业毛利率比上年同期增减为1.98%。'
  const refs=[716,717,718,719,720,721,722,723,724,725,726,727,728,729,730].map(paragraph=>({sourceCandidateId:paragraph===717?typo:h1Id,location:`paragraph:${paragraph}`}))
  const findingRefs=[refs[0]!,refs[1]!,refs[12]!]
  const draft={
    status:'complete',answer:'分行业毛利变化方向不同。',markdown:`${claim} ${refs.map(ref=>`[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,
    sections:[{id:'revenue-profit-drivers',markdown:`${claim} ${refs.map(ref=>`[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`}],
    findings:[{text:'半年度分行业表列示毛利率指标。',kind:'fact' as const,evidence:findingRefs}],limitations:[],risks:[],
  }
  const options={...input,sources:[h1Source,annualSource]}
  const repaired=repairUnavailableCompanyMethodCitations(draft,[h1Packet,annualPacket],options)
  assert.equal(repaired.repairs.length,3)
  assert.deepEqual(repaired.output.findings[0]!.evidence[1],{sourceCandidateId:h1Id,location:'paragraph:717'})
  const validated=validateCompanyMethodOutput(repaired.output,[h1Packet,annualPacket])
  assert.equal(validated.status,'complete')
  const numeric=validateCompanyNumericGrounding({markdown:`${validated.sections[0]!.markdown} ${validated.findings[0]!.text} ${validated.findings[0]!.evidence.map(ref=>`[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,sources:options.sources,evidenceContexts:[h1Packet,annualPacket]})
  assert.equal(numeric.status,'grounded',JSON.stringify(numeric.diagnostics))

  const crossSourceRefs=refs.map(ref=>({...ref}))
  crossSourceRefs[1]={sourceCandidateId:typo,location:'paragraph:717'}
  crossSourceRefs.push({sourceCandidateId:annualId,location:'paragraph:718'})
  const crossSourceDraft={...draft,markdown:`${claim} ${crossSourceRefs.map(ref=>`[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`,sections:[{id:'revenue-profit-drivers',markdown:`${claim} ${crossSourceRefs.map(ref=>`[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`}],findings:[{...draft.findings[0]!,evidence:crossSourceRefs}]}
  const crossSource=repairUnavailableCompanyMethodCitations(crossSourceDraft,[h1Packet,annualPacket],options)
  assert.equal(crossSource.repairs.length,0,'same-claim support spanning two candidate sources cannot disambiguate the locator collision')
  assert.match(crossSource.output.sections[0]!.markdown,new RegExp(`${typo}@paragraph:717`))
})

test('a consecutive cited paragraph cluster can be rebound only to one exact supplied source', () => {
  const correctId = 'official-customer-risk-h1'
  const wrongId = 'official-customer-risk-annual'
  const paragraphs = new Map<number, string>([
    [1320, '1、客户集中度风险'],
    [1321, '公司客户资源较好，主要客户均为相关行业的国际国内知名企业，客户信誉良好，且公司与其建立了稳定的合作关系。'],
    [1322, '但是公司前五大客户收入占比较高，如果主要客户的经营状况发生重大不利变化，将会对公司'],
    [1323, '经营产生不利影响。公司将高度关注重点客户所处行业发展动向及客户信用状况，积极加大新产品、新客户开拓力度，减'],
    [1324, '少因客户集中度较高对公司可能产生的不利影响。'],
  ])
  const lines = Array.from({ length: 1324 }, (_, index) => paragraphs.get(index + 1) ?? '')
  const correctSource = { ...source, candidate: { ...source.candidate, candidateId: correctId }, title: '2026年半年度报告', content: lines.join('\n') }
  const wrongSource = { ...source, candidate: { ...source.candidate, candidateId: wrongId }, title: '2025年年度报告', content: Array.from({ length: 1324 }, () => '其他披露内容。').join('\n') }
  const excerpts = [...paragraphs].map(([paragraph, text]) => ({ sourceCandidateId: correctId, location: `paragraph:${paragraph}`, text }))
  const correctPacket: CompanyEvidencePacket = { sourceCandidateId: correctId, title: correctSource.title!, publisher: '公司', excerpts }
  const claim = '公司披露客户集中度风险：若主要客户经营状况重大不利变化可能影响经营，公司将关注客户信用并拓展新产品、新客户。'
  const wrongCluster = [1320, 1321, 1322, 1323, 1324].map(paragraph => `[${wrongId}@paragraph:${paragraph}]`).join(' ')
  const draft = { findings: [], markdown: `${claim} ${wrongCluster}`, sections: [{ id: 'business-model', markdown: `${claim} ${wrongCluster}` }] }
  const options = { ...input, sources: [wrongSource, correctSource] }

  const repaired = repairUnavailableCompanyMethodCitations(draft, [correctPacket], options)
  assert.equal(repaired.repairs.length, 2, 'the same repair is recorded for the Markdown and section copies of the claim')
  assert.match(repaired.output.sections[0]!.markdown, new RegExp(`${correctId}@paragraph:1320`))
  assert.doesNotMatch(repaired.output.sections[0]!.markdown, new RegExp(`${wrongId}@paragraph:1320`))
  const numeric = validateCompanyNumericGrounding({ markdown: repaired.output.sections[0]!.markdown, sources: [correctSource], evidenceContexts: [correctPacket] })
  assert.equal(numeric.status, 'grounded', JSON.stringify(numeric.diagnostics))

  const duplicatePacket: CompanyEvidencePacket = { ...correctPacket, sourceCandidateId: 'official-customer-risk-second', excerpts: excerpts.map(excerpt => ({ ...excerpt, sourceCandidateId: 'official-customer-risk-second' })) }
  const ambiguous = repairUnavailableCompanyMethodCitations(draft, [correctPacket, duplicatePacket], { ...options, sources: [...options.sources, { ...correctSource, candidate: { ...correctSource.candidate, candidateId: 'official-customer-risk-second' }, title: '另一份报告' }] })
  assert.equal(ambiguous.repairs.length, 0, 'the full locator cluster must identify one unique candidate source')
  assert.match(ambiguous.output.sections[0]!.markdown, new RegExp(`${wrongId}@paragraph:1320`))

  const unrelatedClaim = '公司公布新款手机上市日期并建立自动化产线。'
  const unrelatedDraft = { ...draft, markdown: `${unrelatedClaim} ${wrongCluster}`, sections: [{ id: 'business-model', markdown: `${unrelatedClaim} ${wrongCluster}` }] }
  const unrelated = repairUnavailableCompanyMethodCitations(unrelatedDraft, [correctPacket], options)
  assert.equal(unrelated.repairs.length, 0, 'unique parallel locators do not repair a claim the supplied text does not support')
  assert.match(unrelated.output.sections[0]!.markdown, new RegExp(`${wrongId}@paragraph:1320`))
})

test('inline citation repair can use an exact paragraph already cited by a finding in the same method',()=>{
  const researchSource={...source,content:'2024年研发投入541.61亿元。\n2025年研发投入634.41亿元。'}
  const researchPacket:CompanyEvidencePacket={...packet,excerpts:researchSource.content.split('\n').map((text,index)=>({sourceCandidateId:'filing',location:`paragraph:${index+1}`,text}))}
  const researchFinding:CompanyMethodFinding={text:'2025年研发投入634.41亿元。',kind:'fact',evidence:[{sourceCandidateId:'filing',location:'paragraph:2'}]}
  const result=repairCompanyMethodCitations({findings:[researchFinding],markdown:'研发投入变化见下文。[filing@paragraph:1]',sections:[{id:'management-capital-allocation',markdown:'研发投入由541.61亿元增至634.41亿元。[filing@paragraph:1]'}]},[researchPacket],{...input,sources:[researchSource]})
  assert.match(result.output.sections[0]!.markdown,/\[filing@paragraph:2\]/)
  assert.ok(result.repairs.some(repair=>repair.sectionId==='management-capital-allocation' && repair.addedReferences.some(ref=>ref.location==='paragraph:2')))
})

test('annual R&D investment repair adds only the unique exact amount row under the cited period header', () => {
  const rows = new Map<number, string>([
    [2243, '2025 年 2024 年 变动比例'],
    [2244, '研发投入金额（元） 63,441,379,000.00 54,160,964,000.00 17.13%'],
    [2246, '研发投入资本化的金额（元） 5,463,274,000.00 966,219,000.00 465.43%'],
    [2247, '资本化研发投入占研发投入的比例 8.61% 1.78% 6.83%'],
    [2254, '研发活动符合公司战略方向。'],
  ])
  const report = { ...source, title: '2025年年度报告', content: Array.from({ length: 2254 }, (_, index) => rows.get(index + 1) ?? '').join('\n') }
  const reportPacket: CompanyEvidencePacket = { ...packet, title: report.title, excerpts: [...rows].map(([paragraph, text]) => ({ sourceCandidateId: 'filing', location: `paragraph:${paragraph}`, text })) }
  const claim = '2025年研发投入634.41亿元，2024年研发投入54,160,964,000.00元。'
  const headerAndRelatedRefs = [2243, 2246, 2247, 2254].map(paragraph => ({ sourceCandidateId: 'filing', location: `paragraph:${paragraph}` }))
  const draft = {
    findings: [{ text: claim, kind: 'fact' as const, evidence: headerAndRelatedRefs }],
    markdown: claim,
    sections: [{ id: 'financial-quality', markdown: `${claim}[filing@paragraph:2243] [filing@paragraph:2246] [filing@paragraph:2247] [filing@paragraph:2254]` }],
  }
  const result = repairCompanyMethodCitations(draft, [reportPacket], { ...input, sources: [report] })
  assert.ok(result.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:2244'))
  assert.match(result.output.sections[0]!.markdown, /\[filing@paragraph:2244\]/)
  assert.ok(result.repairs.some(repair => repair.addedReferences.some(ref => ref.location === 'paragraph:2244')))
  assert.equal(validateCompanyNumericGrounding({ markdown: `${result.output.findings[0]!.text} ${result.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [report], evidenceContexts: [reportPacket] }).status, 'grounded')

  const withoutHeader = structuredClone(draft)
  withoutHeader.findings[0]!.evidence = withoutHeader.findings[0]!.evidence.filter(ref => ref.location !== 'paragraph:2243')
  withoutHeader.sections[0]!.markdown = withoutHeader.sections[0]!.markdown.replace('[filing@paragraph:2243]', '')
  const refusedHeaderless = repairCompanyMethodCitations(withoutHeader, [reportPacket], { ...input, sources: [report] })
  assert.ok(!refusedHeaderless.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:2244'))
  assert.ok(!refusedHeaderless.output.sections[0]!.markdown.includes('[filing@paragraph:2244]'))

  const duplicateReport = { ...report, content: `${report.content}\n研发投入金额（元） 63,441,379,000.00 54,160,964,000.00 17.13%` }
  const duplicateExcerpt = { sourceCandidateId: 'filing', location: 'paragraph:2255', text: '研发投入金额（元） 63,441,379,000.00 54,160,964,000.00 17.13%' }
  const duplicatePacket = { ...reportPacket, excerpts: [...reportPacket.excerpts, duplicateExcerpt] }
  const refusedDuplicate = repairCompanyMethodCitations(draft, [duplicatePacket], { ...input, sources: [duplicateReport] })
  assert.ok(!refusedDuplicate.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:2244'))
})

test('numeric repair adds an exact optical identifier paragraph to an otherwise multi-paragraph finding', () => {
  const productSource = { ...source, content: [
    '与 LRO 架构的 OSFP 及 QSFP-DD800G 光模块。公司的 1.6T 光模块提供 EML 及 InP PIC 等多种',
    '技术选项，采用OSFP等紧凑封装实现超高速、低延迟连接。公司的自研100GPAM4EML芯片在',
    '400G 及 800G 光模块中累计使用超千万颗，200GPAM4EML 芯片已进入量产阶段，为 1.6T 光模块',
    '产品提供芯片基础。',
    '同时，公司正在研发的 400GPAM4EML 芯片将赋能 3.2T 光模块。',
  ].join('\n') }
  const productPacket: CompanyEvidencePacket = { sourceCandidateId: 'filing', title: source.title, publisher: '公司', excerpts: productSource.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })) }
  const productFinding: CompanyMethodFinding = {
    text: '公司披露100G PAM4 EML用于400G/800G模块、200G PAM4 EML进入量产；400G EML与3.2T共封装光学仍在研发推进阶段。',
    kind: 'fact',
    evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:3' }, { sourceCandidateId: 'filing', location: 'paragraph:5' }],
  }
  const result = repairCompanyMethodCitations({ findings: [productFinding], markdown: '产品技术分析。[filing@paragraph:3]', sections: [{ id: 'technologies', markdown: '公司披露相关光芯片路径。[filing@paragraph:3]' }] }, [productPacket], { ...input, sources: [productSource] })
  assert.equal(result.repairs.filter((repair) => repair.findingIndex === 0).length, 1)
  assert.ok(result.output.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:2'))
  assert.equal(result.output.findings[0]!.text, productFinding.text)
})

test('capital-allocation repair binds long-term equity investment and placement proceeds to their exact source rows', () => {
  const investmentSource = { ...source, title: '2025年年度报告', content: '单位：元\n2025年 2024年\n长期股权投资 21,781,418,000.00 19,082,496,000.00 0.02%' }
  const investmentPacket: CompanyEvidencePacket = { sourceCandidateId: 'filing', title: investmentSource.title, publisher: '公司', excerpts: investmentSource.content.split('\n').map((text,index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text, ...(index === 2 ? { contextLocations: ['paragraph:1', 'paragraph:2'] } : {}) })) }
  const investmentFinding: CompanyMethodFinding = { text: '2025年末长期股权投资余额为217.81亿元。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:2' }] }
  const investment = repairCompanyMethodCitations(output(investmentFinding), [investmentPacket], { ...input, sources: [investmentSource] })
  assert.ok(investment.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:3'))

  const placementSource = { ...source, title: '2024年年度报告', content: '本集团已于2025年3月11日通过配售129,800,000股新H股，扣除佣金和估计费用后募集资金净额约为港元\n43,383,000千元，根据管理层编制的现金流预测。' }
  const placementPacket: CompanyEvidencePacket = { sourceCandidateId: 'filing', title: placementSource.title, publisher: '公司', excerpts: placementSource.content.split('\n').map((text,index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })) }
  const placementFinding: CompanyMethodFinding = { text: '2024年年报披露于2025年3月完成新H股配售，净募集433.83亿港元。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:1' }] }
  const placement = repairCompanyMethodCitations(output(placementFinding), [placementPacket], { ...input, sources: [placementSource] })
  assert.ok(placement.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:2'))
  assert.ok(placement.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:1'))
})

test('citation repair discards a distant context locator even when a packet supplies it', () => {
  const sourceWithBadContext = { ...source, content: '本集团于2025年3月通过配售新H股，净募集资金约为港元\n43,383,000千元，根据管理层现金流预测。\n其他披露。\n本公司于2002年整体变更设立。' }
  const excerpts = sourceWithBadContext.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text, ...(index === 1 ? { contextLocations: ['paragraph:4'] } : {}) }))
  const wrappedPacket = { ...packet, excerpts }
  const claim: CompanyMethodFinding = { text: '2025年完成H股配售，净募集资金43,383,000千港元。', kind: 'fact', evidence: [{ sourceCandidateId: 'filing', location: 'paragraph:1' }] }
  const result = repairCompanyMethodCitations(output(claim), [wrappedPacket], { ...input, sources: [sourceWithBadContext] })
  assert.ok(result.output.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:2'))
  assert.ok(!result.output.findings[0]!.evidence.some((ref) => ref.location === 'paragraph:4'))
})

test('placement continuation repair preserves mixed-source amounts when the actual PDF date contains whitespace', () => {
  const announcement = { ...source, candidate: { ...source.candidate, candidateId: 'announcement' }, content: '2025年3月完成56亿美元配售。' }
  const annual = { ...source, title: '2024年年度报告', content: '本集团已于 2025 年 3 月 11 日通过配售 129,800,000 股新 H 股，扣除佣金和估计费用后募集资金净额约为港元\n43,383,000 千元，根据本公司管理层编制的现金流预测。' }
  const annualPacket: CompanyEvidencePacket = { ...packet, title: annual.title, excerpts: annual.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text })) }
  const announcementPacket: CompanyEvidencePacket = { ...packet, sourceCandidateId: 'announcement', excerpts: [{ sourceCandidateId: 'announcement', location: 'paragraph:1', text: announcement.content }] }
  const text = '2025年3月完成56亿美元配售；另披露新H股配售净募资约港元433.83亿元。币种及披露背景不同，材料不足以确认两项应否视为同一事项，故不合并计算。'
  const refs = [{ sourceCandidateId: 'announcement', location: 'paragraph:1' }, { sourceCandidateId: 'filing', location: 'paragraph:1' }]
  const draft = (claim = text) => ({ findings: [{ text: claim, kind: 'fact' as const, evidence: refs }], markdown: '', sections: [] })
  const options = { ...input, sources: [announcement, annual] }
  const result = repairCompanyMethodCitations(draft(), [announcementPacket, annualPacket], options)
  assert.equal(result.output.findings[0]!.text, text)
  assert.deepEqual(result.output.findings[0]!.evidence, [...refs, { sourceCandidateId: 'filing', location: 'paragraph:2' }])
  assert.equal(result.repairs.length, 1)
  for (const wrong of [text.replace('2025年', '2026年'), text.replace('433.83', '433.84'), text.replace('433.83亿元', '433.83万元')]) {
    assert.equal(repairCompanyMethodCitations(draft(wrong), [announcementPacket, annualPacket], options).repairs.length, 0, wrong)
  }
  assert.equal(repairCompanyMethodCitations(draft(), [announcementPacket, { ...annualPacket, excerpts: annualPacket.excerpts.slice(0, 1) }], options).repairs.length, 0)
  const otherPacket = { ...annualPacket, sourceCandidateId: 'other', excerpts: annualPacket.excerpts.map(excerpt => ({ ...excerpt, sourceCandidateId: 'other' })) }
  const otherSource = { ...annual, candidate: { ...annual.candidate, candidateId: 'other' } }
  assert.equal(repairCompanyMethodCitations(draft(), [announcementPacket, { ...annualPacket, excerpts: annualPacket.excerpts.slice(0, 1) }, otherPacket], { ...options, sources: [...options.sources, otherSource] }).repairs.length, 0)
})

test('prepared calculation pseudo-citations map only through their actual supplied sourceCandidateIds', () => {
  const financialSource = { ...source, content: '2026年上半年经营现金净流量23.84亿元，购建长期资产现金支出52.53亿元。' }
  const financialPacket: CompanyEvidencePacket = { sourceCandidateId: 'filing', title: '结构化财务数据', publisher: '数据源', excerpts: [{ sourceCandidateId: 'filing', location: 'paragraph:1', text: financialSource.content }] }
  const pseudo = 'preparedAnalysis.financial.simpleFreeCashFlow'
  const claim = '简化现金流差额为23.84亿元−52.53亿元＝-28.69亿元。'
  const value = { ...output({ text: claim, kind: 'fact', evidence: [{ sourceCandidateId: pseudo, location: 'paragraph:1' }] }), markdown: `${claim}[${pseudo}@paragraph:1]`, sections: [{ id: 'business-segments', markdown: `${claim}[${pseudo}@paragraph:1]` }] }
  const result = repairPreparedAnalysisSourceReferences(value, [financialPacket], {
    ...input,
    sources: [financialSource],
    preparedAnalysis: { financial: { simpleFreeCashFlow: [{ value: -2869470684, formula: '23.84亿元−52.53亿元＝-28.69亿元', sourceCandidateIds: ['filing'] }] } },
  })
  assert.equal(result.repairs.length, 3)
  assert.equal(result.output.markdown, `${claim}[filing@paragraph:1]`)
  assert.equal(result.output.sections[0]!.markdown, `${claim}[filing@paragraph:1]`)
  assert.deepEqual(result.output.findings[0]!.evidence, [{ sourceCandidateId: 'filing', location: 'paragraph:1' }])
  const unresolved = repairPreparedAnalysisSourceReferences(value, [financialPacket], { ...input, sources: [financialSource], preparedAnalysis: { financial: { simpleFreeCashFlow: [{ sourceCandidateIds: ['unprovided-source'] }] } } })
  assert.equal(unresolved.repairs.length, 0)
})

test('repair removes plain paragraph locator prose only when the same range is bound as finding evidence',()=>{
  const locatorFinding={...finding,text:'业务事实见 paragraph:2-3。',evidence:[{sourceCandidateId:'filing',location:'paragraph:2'},{sourceCandidateId:'filing',location:'paragraph:3'}]}
  const result=repairCompanyMethodCitations(output(locatorFinding),[packet],input)
  assert.equal(result.output.findings[0]!.text,'业务事实。')
  const unbound={...locatorFinding,evidence:[{sourceCandidateId:'filing',location:'paragraph:2'}]}
  assert.match(repairCompanyMethodCitations(output(unbound),[packet],input).output.findings[0]!.text,/paragraph:2-3/)
})

test('repair removes inline locator notes from method sections only when supplied citations bind the exact range',()=>{
  const bound='业务事实（paragraphs:2–3）。[filing@paragraph:2] [filing@paragraph:3]'
  const draft={findings:[],markdown:bound,sections:[{id:'business-segments',markdown:bound}]}
  const cleaned=repairCompanyMethodCitations(draft,[packet],input).output
  assert.equal(cleaned.markdown,'业务事实。[filing@paragraph:2] [filing@paragraph:3]')
  assert.equal(cleaned.sections[0]!.markdown,'业务事实。[filing@paragraph:2] [filing@paragraph:3]')
  const unbound=repairCompanyMethodCitations({...draft,sections:[{id:'business-segments',markdown:'业务事实（paragraph:2–3）。[filing@paragraph:2]'}]},[packet],input).output
  assert.match(unbound.sections[0]!.markdown,/paragraph:2–3/)
})

test('repair never searches unprovided full-document text or changes cited source identity', () => {
  assert.equal(repairCompanyMethodCitations(output(), [{ ...packet, excerpts: packet.excerpts.slice(0, 1) }], input).repairs.length, 0)
  const other = { ...packet, sourceCandidateId: 'other', excerpts: packet.excerpts.map((excerpt) => ({ ...excerpt, sourceCandidateId: 'other' })) }
  const otherSource = { ...source, candidate: { ...source.candidate, candidateId: 'other' } }
  assert.equal(repairCompanyMethodCitations(output(), [{ ...packet, excerpts: packet.excerpts.slice(0, 1) }, other], { ...input, sources: [source, otherSource] }).repairs.length, 0)
})

test('citation repair removes a source label only when the exact supplied id is its unique suffix', () => {
  const draft={findings:[],markdown:'收入为10元。[结构化财务数据，filing@paragraph:1]',sections:[{id:'business-model',markdown:'收入为10元。[结构化财务数据，filing@paragraph:1]'}]}
  const result=repairPreparedAnalysisSourceReferences(draft,[packet],input)
  assert.equal(result.output.markdown,'收入为10元。[filing@paragraph:1]')
  assert.equal(result.output.sections[0]!.markdown,'收入为10元。[filing@paragraph:1]')
  assert.equal(result.repairs.length,2)
  const ambiguousPackets=[packet,packet]
  const ambiguous=repairPreparedAnalysisSourceReferences(draft,ambiguousPackets,input)
  assert.match(ambiguous.output.markdown,/结构化财务数据，filing@paragraph:1/)
})

test('deterministic calculator sourceRefs resolve pseudo preparedAnalysis citations to the supplied source', () => {
  const draft={findings:[{text:'收入变化未作量价归因。',kind:'fact' as const,evidence:[{sourceCandidateId:'preparedAnalysis.businessDrivers',location:'paragraph:1'}]}],markdown:'收入变化未作量价归因。[preparedAnalysis.businessDrivers@paragraph:1]',sections:[{id:'revenue-profit-drivers',markdown:'收入变化未作量价归因。[preparedAnalysis.businessDrivers@paragraph:1]'}]}
  const result=repairPreparedAnalysisSourceReferences(draft,[packet],{...input,preparedAnalysis:{businessDrivers:{sourceRefs:['filing']}}})
  assert.deepEqual(result.output.findings[0]!.evidence,[{sourceCandidateId:'filing',location:'paragraph:1'}])
  assert.match(result.output.markdown,/\[filing@paragraph:1\]/)
  assert.equal(result.repairs.length,3)
})

test('citation repair corrects a one-character source-id typo only for a unique supplied id and exact locator', () => {
  const officialId='official-c19c34dd239b2e9c'
  const officialSource={...source,candidate:{...source.candidate,candidateId:officialId},content:'毛利率比上年同期增减'}
  const officialPacket={...packet,sourceCandidateId:officialId,excerpts:[{sourceCandidateId:officialId,location:'paragraph:720',text:officialSource.content}]}
  const typo='official-c19c34d239b2e9c'
  const claim='毛利率比上年同期增减。'
  const draft={findings:[],markdown:`${claim}[${typo}@paragraph:720]`,sections:[{id:'financial-quality',markdown:`${claim}[${typo}@paragraph:720]`}]}
  const officialInput={...input,sources:[officialSource]}
  const repaired=repairPreparedAnalysisSourceReferences(draft,[officialPacket],officialInput)
  assert.equal(repaired.output.markdown,`${claim}[${officialId}@paragraph:720]`)
  assert.equal(repaired.repairs.length,2)
  const conflict='市场份额超过5%。'
  const conflicting={...draft,markdown:`${conflict}[${typo}@paragraph:720]`,sections:[{id:'financial-quality',markdown:`${conflict}[${typo}@paragraph:720]`}]}
  assert.equal(repairPreparedAnalysisSourceReferences(conflicting,[officialPacket],officialInput).repairs.length,0)
  const wrongLocator=repairPreparedAnalysisSourceReferences({...draft,markdown:`${claim}[${typo}@paragraph:721]`,sections:[{id:'financial-quality',markdown:`${claim}[${typo}@paragraph:721]`}]},[officialPacket],officialInput)
  assert.match(wrongLocator.output.markdown,/paragraph:721/)
  const ambiguousPacket={...officialPacket,sourceCandidateId:'official-c19c34d239b2e9d',excerpts:[{sourceCandidateId:'official-c19c34d239b2e9d',location:'paragraph:720',text:officialSource.content}]}
  const ambiguous=repairPreparedAnalysisSourceReferences(draft,[officialPacket,ambiguousPacket],officialInput)
  assert.match(ambiguous.output.markdown,new RegExp(typo))
})

test('citation repair corrects a unique one-character source-id typo on a table heading using the same line exact supporting rows', () => {
  const officialId = 'official-c19c34dd239b2e9c'
  const typo = 'official-c19c34dd239b2e9e'
  const content = ['分行业', '日用电子器件制造业', '收入同比0.96%；交通运输设备及电气制造业收入同比-8.98%'].join('\n')
  const officialSource = { ...source, candidate: { ...source.candidate, candidateId: officialId }, content }
  const officialPacket: CompanyEvidencePacket = { ...packet, sourceCandidateId: officialId, excerpts: content.split('\n').map((text, index) => ({ sourceCandidateId: officialId, location: `paragraph:${index + 1}`, text })) }
  const claim = '分行业收入对比：日用电子器件制造业同比增长0.96%，交通运输设备及电气制造业同比下降8.98%。'
  const refs = [
    { sourceCandidateId: typo, location: 'paragraph:1' },
    { sourceCandidateId: officialId, location: 'paragraph:2' },
    { sourceCandidateId: officialId, location: 'paragraph:3' },
  ]
  const draft = { findings: [], markdown: '', sections: [{ id: 'risks', markdown: `${claim} ${refs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}` }] }
  const repaired = repairPreparedAnalysisSourceReferences(draft, [officialPacket], { ...input, sources: [officialSource] })
  assert.match(repaired.output.sections[0]!.markdown, new RegExp(`\\[${officialId}@paragraph:1\\]`))
  assert.equal(repaired.repairs.length, 1)
  const numeric = validateCompanyNumericGrounding({ markdown: `${claim} ${[officialId, officialId, officialId].map((id, index) => `[${id}@paragraph:${index + 1}]`).join(' ')}`, sources: [officialSource], evidenceContexts: [officialPacket] })
  assert.equal(numeric.status, 'grounded', JSON.stringify(numeric.diagnostics))
})

test('method citation repair corrects a typo on one exact channel row in a multi-row finding only when unique and fully grounded', () => {
  const officialId = 'official-f7c8d23d2829a5e8'
  const typo = 'official-f7c8d2829a5e8'
  const content = ['（1）营业收入构成', '2025年 2024年', '单位：元', '分销售模式',
    '直销 367,210,862,000.00 45.67% 373,156,016,000.00 48.02% -1.59%',
    '经销 436,754,096,000.00 54.33% 403,946,439,000.00 51.98% 8.12%'].join('\n')
  const officialSource = { ...source, candidate: { ...source.candidate, candidateId: officialId }, content }
  const excerpts = content.split('\n').map((text, index) => ({ sourceCandidateId: officialId, location: `paragraph:${index + 1}`, text,
    ...(index === 4 || index === 5 ? { contextLocations: ['paragraph:1', 'paragraph:2', 'paragraph:3'] } : {}) }))
  const officialPacket: CompanyEvidencePacket = { ...packet, sourceCandidateId: officialId, excerpts }
  const claim = '2025年度直销收入367,210,862,000元、占45.67%；经销收入436,754,096,000元、占54.33%。'
  const draft = { findings: [{ text: claim, kind: 'fact', evidence: [1, 2, 3, 4].map(row => ({ sourceCandidateId: officialId, location: `paragraph:${row}` })).concat([
    { sourceCandidateId: typo, location: 'paragraph:5' }, { sourceCandidateId: officialId, location: 'paragraph:6' },
  ]) }], markdown: claim, sections: [{ id: 'business-segments', markdown: claim }] }
  const numericCheck = validateCompanyNumericGrounding({ markdown: `${claim} ${[1,2,3,4,5,6].map(row=>`[${officialId}@paragraph:${row}]`).join(' ')}`, sources: [officialSource], evidenceContexts: [officialPacket] })
  const repaired = repairPreparedAnalysisSourceReferences(draft, [officialPacket], { ...input, sources: [officialSource] })
  assert.equal(numericCheck.status, 'grounded', JSON.stringify(numericCheck.diagnostics))
  assert.equal(repaired.output.findings[0]!.evidence[4]!.sourceCandidateId, officialId, JSON.stringify(repaired))
  assert.equal(repaired.output.findings[0]!.evidence[4]!.location, 'paragraph:5')
  assert.equal(repaired.repairs.length, 1)

  const wrongLocator = structuredClone(draft)
  wrongLocator.findings[0]!.evidence[4] = { sourceCandidateId: typo, location: 'paragraph:7' }
  assert.equal(repairPreparedAnalysisSourceReferences(wrongLocator, [officialPacket], { ...input, sources: [officialSource] }).repairs.length, 0)
  const wrongClaim = structuredClone(draft)
  wrongClaim.findings[0]!.text = '2025年度汽车收入367,210,862,000元、占45.67%；经销收入436,754,096,000元、占54.33%。'
  assert.equal(repairPreparedAnalysisSourceReferences(wrongClaim, [officialPacket], { ...input, sources: [officialSource] }).repairs.length, 0)
  const alternateId = 'official-f7c8d2829a5e8x'
  const alternateSource = { ...officialSource, candidate: { ...officialSource.candidate, candidateId: alternateId } }
  const alternatePacket = { ...officialPacket, sourceCandidateId: alternateId, excerpts: excerpts.map(excerpt => ({ ...excerpt, sourceCandidateId: alternateId })) }
  const ambiguous = repairPreparedAnalysisSourceReferences(draft, [officialPacket, alternatePacket], { ...input, sources: [officialSource, alternateSource] })
  assert.equal(ambiguous.repairs.length, 0)
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

test('section citation repair cannot borrow an unrelated existing account label to justify a nearby amount', () => {
  const annual={...source,content:'营业收入100亿元。\n经营现金流20亿元。'}
  const annualPacket:CompanyEvidencePacket={sourceCandidateId:'filing',title:'2025年年度报告',publisher:'公司',excerpts:annual.content.split('\n').map((text,index)=>({sourceCandidateId:'filing',location:`paragraph:${index+1}`,text}))}
  const claim='营业收入20亿元。'
  const draft={findings:[],markdown:`${claim}[filing@paragraph:1]`,sections:[{id:'financial-quality',markdown:`${claim}[filing@paragraph:1]`}]}
  const result=repairCompanyMethodCitations(draft,[annualPacket],{...input,sources:[annual]})
  assert.equal(result.repairs.length,0)
  assert.equal(result.output.sections[0]!.markdown,draft.sections[0]!.markdown)
})

test('a split product label may still ground its own adjacent financial row during repair', () => {
  const annual={...source,content:'汽车相关业务收入\n648645636000元，占比80.68%。'}
  const annualPacket:CompanyEvidencePacket={sourceCandidateId:'filing',title:'2025年年度报告',publisher:'公司',excerpts:annual.content.split('\n').map((text,index)=>({sourceCandidateId:'filing',location:`paragraph:${index+1}`,text}))}
  const claim='汽车相关业务收入648645636000元，占比80.68%。'
  const draft={findings:[{text:claim,kind:'fact' as const,evidence:[{sourceCandidateId:'filing',location:'paragraph:1'}]}],markdown:`${claim}[filing@paragraph:1]`,sections:[{id:'business-segments',markdown:`${claim}[filing@paragraph:1]`}]}
  const result=repairCompanyMethodCitations(draft,[annualPacket],{...input,sources:[annual]})
  assert.ok(result.repairs.some(repair=>repair.addedReferences.some(ref=>ref.location==='paragraph:2')))
})

test('a unique legal registration date can repair its actual legal event, but not founding or product dates', () => {
  const dated = { ...source, content: '公司介绍\n本公司前身于一九九五年二月注册成立。\n公司于2008年推出F3DM。' }
  const excerpts = dated.content.split('\n').map((text, index) => ({ sourceCandidateId: 'filing', location: `paragraph:${index + 1}`, text }))
  const legal = { ...finding, text: '本公司前身于1995年注册成立。' }
  assert.equal(repairCompanyMethodCitations(output(legal), [{ ...packet, excerpts }], { ...input, sources: [dated] }).repairs.length, 1)
  assert.equal(repairCompanyMethodCitations(output({ ...finding, text: '比亚迪在深圳成立日期为1995年。' }), [{ ...packet, excerpts }], { ...input, sources: [dated] }).repairs.length, 0)
  assert.equal(repairCompanyMethodCitations(output({ ...finding, text: '公司于2008年推出F9车型。' }), [{ ...packet, excerpts }], { ...input, sources: [dated] }).repairs.length, 0)
})

test('cross-document paragraph collision repairs only the unique strongly matching supplied source', () => {
  const wrong = { ...source, candidate: { ...source.candidate, candidateId: 'official-wrong' }, content: '公司持续加强技术研发。' }
  const right = { ...source, candidate: { ...source.candidate, candidateId: 'official-right' }, content: '公司实际控制人为袁永刚、袁永峰、袁富根。' }
  const loc = 'paragraph:1'
  const packets: CompanyEvidencePacket[] = [wrong, right].map(item => ({ sourceCandidateId: item.candidate.candidateId, title: item.title, publisher: '公司', excerpts: [{ sourceCandidateId: item.candidate.candidateId, location: loc, text: item.content }] }))
  const claim = '公司实际控制人为袁永刚、袁永峰、袁富根。'
  const draft = {
    markdown: `${claim}[official-wrong@${loc}]`,
    sections: [{ id: 'governance', markdown: `${claim} [official-wrong@${loc}]` }],
    findings: [{ text: claim, kind: 'fact', evidence: [{ sourceCandidateId: 'official-wrong', location: loc }] }],
  }
  const result = repairCompanyParagraphCollisionCitations(draft, packets, { ...input, sources: [wrong, right] })
  assert.match(result.output.markdown, /\[official-right@paragraph:1\]/)
  assert.match(result.output.sections[0]!.markdown, /\[official-right@paragraph:1\]/)
  assert.deepEqual(result.output.findings[0]!.evidence, [{ sourceCandidateId: 'official-right', location: loc }])
  assert.equal(result.repairs.length, 3)
  assert.ok(result.repairs.every(repair => repair.reason.includes('paragraph number collided')))
})

test('cross-document paragraph collision is not repaired for dissimilar text', () => {
  const wrong = { ...source, candidate: { ...source.candidate, candidateId: 'official-wrong' }, content: '公司持续加强技术研发。' }
  const unrelated = { ...source, candidate: { ...source.candidate, candidateId: 'official-other' }, content: '本年度经营活动现金流量净额保持稳定。' }
  const loc = 'paragraph:1'
  const packets: CompanyEvidencePacket[] = [wrong, unrelated].map(item => ({ sourceCandidateId: item.candidate.candidateId, title: item.title, publisher: '公司', excerpts: [{ sourceCandidateId: item.candidate.candidateId, location: loc, text: item.content }] }))
  const claim = '公司实际控制人为袁永刚、袁永峰、袁富根。'
  const draft = { markdown: `${claim}[official-wrong@${loc}]`, sections: [{ id: 'governance', markdown: `${claim}[official-wrong@${loc}]` }], findings: [{ text: claim, kind: 'fact', evidence: [{ sourceCandidateId: 'official-wrong', location: loc }] }] }
  const result = repairCompanyParagraphCollisionCitations(draft, packets, { ...input, sources: [wrong, unrelated] })
  assert.equal(result.repairs.length, 0)
  assert.match(result.output.markdown, /\[official-wrong@paragraph:1\]/)
  assert.equal(result.output.findings[0]!.evidence[0]!.sourceCandidateId, 'official-wrong')
})

test('cross-document paragraph collision fails closed when multiple alternate sources match', () => {
  const wrong = { ...source, candidate: { ...source.candidate, candidateId: 'official-wrong' }, content: '公司持续加强技术研发。' }
  const matches = ['official-a', 'official-b'].map(candidateId => ({ ...source, candidate: { ...source.candidate, candidateId }, content: '公司实际控制人为袁永刚、袁永峰、袁富根。' }))
  const loc = 'paragraph:1'
  const packets: CompanyEvidencePacket[] = [wrong, ...matches].map(item => ({ sourceCandidateId: item.candidate.candidateId, title: item.title, publisher: '公司', excerpts: [{ sourceCandidateId: item.candidate.candidateId, location: loc, text: item.content }] }))
  const claim = '公司实际控制人为袁永刚、袁永峰、袁富根。'
  const draft = { markdown: `${claim}[official-wrong@${loc}]`, sections: [{ id: 'governance', markdown: `${claim}[official-wrong@${loc}]` }], findings: [{ text: claim, kind: 'fact', evidence: [{ sourceCandidateId: 'official-wrong', location: loc }] }] }
  const result = repairCompanyParagraphCollisionCitations(draft, packets, { ...input, sources: [wrong, ...matches] })
  assert.equal(result.repairs.length, 0)
  assert.match(result.output.markdown, /\[official-wrong@paragraph:1\]/)
  assert.equal(result.output.findings[0]!.evidence[0]!.sourceCandidateId, 'official-wrong')
})

test('an unsupported cross-report locator is removed when exact same-claim citations already support it', () => {
  const annualId = 'official-f7c8d23d2829a5e8'
  const interimId = 'official-c19c34dd239b2e9c'
  const annualRows = new Map<number, string>([
    [2252, '研发投入总额占营业收入的比重较上年发生显著变化的原因'],
    [2253, '□适用 不适用'],
  ])
  const annualSource = { ...source, candidate: { ...source.candidate, candidateId: annualId }, title: '2025年年度报告', content: Array.from({ length: 2253 }, (_, index) => annualRows.get(index + 1) ?? '').join('\n') }
  const interimSource = { ...source, candidate: { ...source.candidate, candidateId: interimId }, title: '2026年半年度报告', content: Array.from({ length: 1110 }, (_, index) => index === 1109 ? '本集团持续加码科技创新，二零二六年上半年研发投入约人民币289亿元。' : '').join('\n') }
  const annualPacket: CompanyEvidencePacket = { sourceCandidateId: annualId, title: annualSource.title!, publisher: '公司', excerpts: [...annualRows].map(([paragraph, text]) => ({ sourceCandidateId: annualId, location: `paragraph:${paragraph}`, text })) }
  const interimPacket: CompanyEvidencePacket = { sourceCandidateId: interimId, title: interimSource.title!, publisher: '公司', excerpts: [{ sourceCandidateId: interimId, location: 'paragraph:1110', text: interimSource.content.split('\n')[1109]! }] }
  const claim = '研发投入总额占营业收入比重变化原因栏标为“不适用”，即原表未给出具体解释。'
  const tableRow = `| 研发投入 | 2025年度 | ${claim} [${annualId}@paragraph:1110] [${annualId}@paragraph:2252] [${annualId}@paragraph:2253] |`
  const draft = {
    markdown: tableRow,
    sections: [{ id: 'management-capital-allocation', markdown: tableRow }],
    findings: [{ text: claim, kind: 'fact' as const, evidence: [{ sourceCandidateId: annualId, location: 'paragraph:2252' }, { sourceCandidateId: annualId, location: 'paragraph:2253' }] }],
  }
  const options = { ...input, sources: [annualSource, interimSource] }
  const repaired = repairCompanyParagraphCollisionCitations(draft, [annualPacket, interimPacket], options)
  assert.ok(repaired.repairs.filter(item => item.originalReferences[0]?.location === 'paragraph:1110').length >= 2)
  assert.ok(repaired.repairs.filter(item => item.originalReferences[0]?.location === 'paragraph:1110').every(item => item.addedReferences.length === 0))
  assert.ok(!repaired.output.sections[0]!.markdown.includes(`${annualId}@paragraph:1110`))
  assert.match(repaired.output.sections[0]!.markdown, new RegExp(`${annualId}@paragraph:2252`))
  assert.match(repaired.output.sections[0]!.markdown, new RegExp(`${annualId}@paragraph:2253`))
  assert.equal(validateCompanyNumericGrounding({ markdown: repaired.output.sections[0]!.markdown, sources: options.sources, evidenceContexts: [annualPacket, interimPacket] }).status, 'grounded')

  const unsupported = `| 研发投入 | 2025年度 | 研发投入原因栏有明确解释。 [${annualId}@paragraph:1110] [${annualId}@paragraph:2252] |`
  const unrelatedDraft = { ...draft, markdown: unsupported, sections: [{ id: 'management-capital-allocation', markdown: unsupported }] }
  const unchanged = repairCompanyParagraphCollisionCitations(unrelatedDraft, [annualPacket, interimPacket], options)
  assert.equal(unchanged.repairs.length, 0, 'unrelated legal citations must not authorize removal of the mismatched reference')
  assert.match(unchanged.output.sections[0]!.markdown, new RegExp(`${annualId}@paragraph:1110`))
})

test('R168 canonicalizes the supported battery row before removing an unsupported same-cell locator', () => {
  const typoId = 'official-f7c8d23d239b2e9c'
  const interimId = 'official-c19c34dd239b2e9c'
  const interimRows = new Map<number, string>([
    [174, '消费类电池：广泛应用于各类消费电子产品及新型智能产品'],
    [183, '一站式解决方案，覆盖材料、结构、热管理及系统集成能力'],
  ])
  const interimSource = { ...source, candidate: { ...source.candidate, candidateId: interimId }, title: '2026年半年度报告', content: Array.from({ length: 183 }, (_, index) => interimRows.get(index + 1) ?? '').join('\n') }
  const interimPacket: CompanyEvidencePacket = { sourceCandidateId: interimId, title: interimSource.title!, publisher: '公司', excerpts: [...interimRows].map(([paragraph, text]) => ({ sourceCandidateId: interimId, location: `paragraph:${paragraph}`, text })) }
  const claim = '消费类电池已广泛应用于各类消费电子产品及新型智能产品。'
  const cell = ` ${claim} [${typoId}@paragraph:174] [${typoId}@paragraph:183] `
  const draft = {
    status: 'complete', answer: '产品应用可由公司披露支持。',
    markdown: `| 消费类电池 | 应用 |${cell}|`,
    sections: [{ id: 'products', markdown: `| 消费类电池 | 应用 |${cell}|` }],
    findings: [{ text: claim, kind: 'fact' as const, evidence: [{ sourceCandidateId: typoId, location: 'paragraph:174' }] }],
    limitations: [], risks: [],
  }
  const options = { ...input, sources: [interimSource] }
  const firstPass = repairCompanyParagraphCollisionCitations(draft, [interimPacket], options)
  assert.match(firstPass.output.sections[0]!.markdown, new RegExp(`${interimId}@paragraph:174`))
  assert.match(firstPass.output.sections[0]!.markdown, new RegExp(`${typoId}@paragraph:183`))
  const unavailableOnly = repairUnavailableCompanyMethodCitations(draft, [interimPacket], options)
  assert.match(unavailableOnly.output.sections[0]!.markdown, new RegExp(`${interimId}@paragraph:174`), 'the unique exact p174 source is selected using its own table-cell claim')
  assert.match(unavailableOnly.output.sections[0]!.markdown, new RegExp(`${typoId}@paragraph:183`), 'the unrelated p183 text cannot borrow the p174 claim')
  const unavailable = repairUnavailableCompanyMethodCitations(firstPass.output, [interimPacket], options)
  const secondPass = repairCompanyParagraphCollisionCitations(unavailable.output, [interimPacket], options)
  assert.match(secondPass.output.sections[0]!.markdown, new RegExp(`${interimId}@paragraph:174`))
  assert.ok(!secondPass.output.sections[0]!.markdown.includes(`${typoId}@paragraph:183`))
  assert.ok(!secondPass.output.sections[0]!.markdown.includes(`${interimId}@paragraph:183`))
  assert.equal(validateCompanyMethodOutput(secondPass.output, [interimPacket], ['products']).status, 'complete')
  assert.ok([...firstPass.repairs, ...unavailable.repairs, ...secondPass.repairs].some(repair => repair.originalReferences[0]?.location === 'paragraph:183' && repair.addedReferences.length === 0))

  const competingId = 'official-competing-interim'
  const competingSource = { ...interimSource, candidate: { ...interimSource.candidate, candidateId: competingId }, content: interimSource.content }
  const competingPacket: CompanyEvidencePacket = { ...interimPacket, sourceCandidateId: competingId, excerpts: interimPacket.excerpts.map(excerpt => ({ ...excerpt, sourceCandidateId: competingId })) }
  const ambiguous = repairUnavailableCompanyMethodCitations(draft, [interimPacket, competingPacket], { ...options, sources: [interimSource, competingSource] })
  assert.ok(ambiguous.output.sections[0]!.markdown.includes(`${typoId}@paragraph:174`), 'two exact source candidates must leave the locator unresolved')
  const ambiguousCleanup = repairCompanyParagraphCollisionCitations(ambiguous.output, [interimPacket, competingPacket], { ...options, sources: [interimSource, competingSource] })
  assert.ok(ambiguousCleanup.output.sections[0]!.markdown.includes(`${typoId}@paragraph:174`))
  assert.ok(ambiguousCleanup.output.sections[0]!.markdown.includes(`${typoId}@paragraph:183`))
})

test('margin-table paragraph collisions cannot cross report period or segment classification', () => {
  const fixture = r105ProductMargins()
  const interim = { ...fixture.sourceValue, candidate: { ...fixture.sourceValue.candidate, candidateId: 'official-interim' } }
  const annual = { ...fixture.sourceValue, candidate: { ...fixture.sourceValue.candidate, candidateId: 'official-annual' }, title: '2024年年度报告' }
  const interimPacket = { ...fixture.sourcePacket, sourceCandidateId: 'official-interim', excerpts: fixture.sourcePacket.excerpts.map(row => ({ ...row, sourceCandidateId: 'official-interim' })) }
  const annualPacket = { ...fixture.sourcePacket, sourceCandidateId: 'official-annual', title: annual.title, excerpts: fixture.sourcePacket.excerpts.map(row => ({ ...row, sourceCandidateId: 'official-annual' })) }
  const claim = '2026年上半年分产品表电子及其他产品毛利率为5.04%，同比变化为-2.67%。'
  const refs = ['paragraph:716', 'paragraph:717', 'paragraph:718', 'paragraph:719', 'paragraph:720', 'paragraph:721', 'paragraph:722', 'paragraph:723', 'paragraph:724', 'paragraph:725', 'paragraph:726', 'paragraph:731', 'paragraph:732']
    .map(location => ({ sourceCandidateId: 'official-interim', location }))
  const draft = { markdown: `${claim} ${refs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sections: [], findings: [{ text: claim, kind: 'fact', evidence: refs }] }
  const result = repairCompanyParagraphCollisionCitations(draft, [interimPacket, annualPacket], { ...input, sources: [interim, annual] })
  assert.equal(result.repairs.length, 0, '2024 annual paragraphs with the same locators cannot replace the 2026 interim table citations')
  assert.ok(result.output.findings[0]!.evidence.every(ref => ref.sourceCandidateId === 'official-interim'))

  const samePeriodWrongClassification = { ...annualPacket, sourceCandidateId: 'official-other-h1', title: '2026年半年度报告', excerpts: annualPacket.excerpts.map(row => ({ ...row, sourceCandidateId: 'official-other-h1', ...(row.location === 'paragraph:727' ? { text: '分产品' } : {}) })) }
  const samePeriodSource = { ...annual, candidate: { ...annual.candidate, candidateId: 'official-other-h1' }, title: samePeriodWrongClassification.title, content: annual.content.replace('\n分行业\n', '\n分产品\n') }
  const wrongScope = repairCompanyParagraphCollisionCitations(draft, [interimPacket, samePeriodWrongClassification], { ...input, sources: [interim, samePeriodSource] })
  assert.equal(wrongScope.repairs.length, 0, 'an equal-numbered row under the other segmentation heading cannot replace the cited row')
  assert.ok(wrongScope.output.findings[0]!.evidence.every(ref => ref.sourceCandidateId === 'official-interim'))
})

test('R75 human-readable structured-financial citation normalizes only to an exactly supplied paragraph', () => {
  const candidateId = 'akshare-financial-002594'
  const value = 23_307_152_000
  const content = JSON.stringify({ kind: 'financial', rows: [{ periodEnd: '2026-06-30', metrics: { researchDevelopment: value }, metricMetadata: { researchDevelopment: { unit: 'CNY', currency: 'CNY', basis: 'YTD' } } }] })
  const financialSource = {
    candidate: { candidateId, metadata: { dataProvenance: { metricId: 'company_financial_history' } } },
    title: 'Company financial history',
    content,
  } as unknown as CompanyResearchInput['sources'][number]
  const financialPacket: CompanyEvidencePacket = { sourceCandidateId: candidateId, title: financialSource.title, publisher: 'EastMoney', excerpts: [{ sourceCandidateId: candidateId, location: 'paragraph:1', text: content }] }
  const preparedAnalysis = { financial: { table: [{ metrics: { researchDevelopment: value }, metadata: { researchDevelopment: { unit: 'CNY', currency: 'CNY' } } }] } }
  const claim = '结构化财务资料列示研发费用人民币23,307,152,000元，累计口径。'
  const humanCitation = '〔证据：akshare-financial-002594，paragraph:1〕'
  const base = { findings: [], markdown: `${claim}${humanCitation}`, sections: [{ id: 'technologies', markdown: `${claim}${humanCitation}` }] }
  const researchInput = { ...input, sources: [financialSource], preparedAnalysis }

  const normalized = repairCompanyMethodCitations(base, [financialPacket], researchInput)
  assert.match(normalized.output.sections[0]!.markdown, /\[akshare-financial-002594@paragraph:1\]/)
  assert.ok(normalized.repairs.some(repair => repair.reason.includes('human-readable citation was normalized')))
  assert.equal(validateCompanyNumericGrounding({ markdown: normalized.output.sections[0]!.markdown, sources: [financialSource], evidenceContexts: [financialPacket], preparedAnalysis }).status, 'grounded')

  for (const citation of ['〔证据：unknown-financial-id，paragraph:1〕', '〔证据：akshare-financial-002594，paragraph:2〕']) {
    const untrusted = repairCompanyMethodCitations({ ...base, markdown: `${claim}${citation}`, sections: [{ id: 'technologies', markdown: `${claim}${citation}` }] }, [financialPacket], researchInput)
    assert.ok(untrusted.output.sections[0]!.markdown.includes(citation), `unsupported citation should remain unchanged: ${citation}`)
    assert.equal(untrusted.repairs.length, 0)
    assert.equal(validateCompanyNumericGrounding({ markdown: untrusted.output.sections[0]!.markdown, sources: [financialSource], evidenceContexts: [financialPacket], preparedAnalysis }).status, 'unsupported_numbers')
  }
})

test('financial-quality duplicate segment-margin prose reuses only its unique cited source-table row', () => {
  const candidateId='official-half'
  const lines=['单位：元','营业收入 营业成本 毛利率','营业收入比上年同期增减','营业成本比上年同期增减','毛利率比上年同期增减','分行业','计算机、通信和','其他电子','27,347,867,868.08 21,929,134,042.30 19.81% 63.21% 51.01% 6.48%']
  const half={candidate:{candidateId},title:'2026年半年度报告',content:lines.join('\n')} as CompanyResearchInput['sources'][number]
  const excerpts=lines.map((text,index)=>({sourceCandidateId:candidateId,location:`paragraph:${index+1}`,text,...(index===8?{contextLocations:lines.slice(0,8).map((_,contextIndex)=>`paragraph:${contextIndex+1}`)}:{})}))
  const halfPacket:CompanyEvidencePacket={sourceCandidateId:candidateId,title:half.title,publisher:'CNINFO',excerpts}
  const claim='半年报分行业表列示：计算机、通信和其他电子毛利率19.81%，同比上升6.48%。这里的6.48%沿用原表变化列显示单位，不改称百分点。'
  const tableRow='| 计算机、通信和其他电子毛利率19.81%，同比上升6.48% | [official-half@paragraph:1] [official-half@paragraph:2] [official-half@paragraph:3] [official-half@paragraph:4] [official-half@paragraph:5] [official-half@paragraph:6] [official-half@paragraph:7] [official-half@paragraph:8] [official-half@paragraph:9] |'
  const draft={findings:[],markdown:`## 分行业及分产品\n\n${tableRow}`,sections:[{id:'financial-quality',markdown:claim}]}
  const result=repairCompanyMethodCitations(draft,[halfPacket],{...input,company:{symbol:'002384'},sources:[half]})
  const repaired=result.output.sections[0]!.markdown
  assert.match(repaired,/毛利率19\.81%，同比上升6\.48%[^\n]*\[official-half@paragraph:9\]/)
  assert.match(repaired,/原表变化列沿用百分比单位/)
  assert.doesNotMatch(repaired,/这里的6\.48%/)
  assert.ok(result.repairs.some(repair=>repair.reason.includes('unique, already cited source-table row')))
  assert.equal(validateCompanyNumericGrounding({markdown:repaired,sources:[half],evidenceContexts:[halfPacket]}).status,'grounded')

  const ambiguousMarkdown=`${tableRow}\n${tableRow.replace('计算机、通信和其他电子','其他电子行业')}`
  const ambiguous=repairCompanyMethodCitations({...draft,markdown:ambiguousMarkdown},[halfPacket],{...input,company:{symbol:'002384'},sources:[half]})
  assert.equal(ambiguous.output.sections[0]!.markdown,claim,'duplicate source-table candidates must not be selected by order')
  assert.equal(ambiguous.repairs.filter(repair=>repair.sectionId==='financial-quality').length,0)
})

test('financial-quality normalizes only an exact prepared simple-FCF formula before numeric grounding', () => {
  const candidateId='akshare-financial-002384'
  const formula='23.84亿元−52.53亿元＝-28.69亿元'
  const text=`2026年上半年累计简化自由现金流：${formula}。[${candidateId}@paragraph:1]`
  const financialSource={candidate:{candidateId},title:'structured financial data',content:'{"kind":"financial"}'} as CompanyResearchInput['sources'][number]
  const financialPacket:CompanyEvidencePacket={sourceCandidateId:candidateId,title:financialSource.title,publisher:'AKShare',excerpts:[{sourceCandidateId:candidateId,location:'paragraph:1',text:financialSource.content}]}
  const preparedAnalysis={financial:{simpleFreeCashFlow:[{period:'2026-06-30',basis:'YTD',unit:'CNY',operatingCashFlow:2_384_000_000,capex:5_253_000_000,value:-2_869_000_000,displayUnit:'亿元',displayOperatingCashFlow:'23.84',displayCapex:'52.53',displayValue:'-28.69',formula,sourceCandidateIds:[candidateId]}]}}
  const tableRow=`| 简化自由现金流 | 2026年上半年累计；23.84亿元−52.53亿元 | -28.69亿元 | [${candidateId}@paragraph:1]`
  const draft={findings:[{text,kind:'fact' as const,evidence:[{sourceCandidateId:candidateId,location:'paragraph:1'}]}],markdown:`${text}\n${tableRow}`,sections:[{id:'financial-quality',markdown:`## 现金流\n${text}\n${tableRow}`} ]}
  const result=repairCompanyMethodCitations(draft,[financialPacket],{...input,sources:[financialSource],preparedAnalysis})
  const canonical=`23.84亿元减52.53亿元＝负28.69亿元`
  assert.ok(result.output.markdown.split(/\r?\n/).every(line=>!line.includes('亿元−') || !line.includes('简化自由现金流')))
  assert.ok(result.output.markdown.includes('23.84亿元减52.53亿元'))
  assert.ok(result.output.sections[0]!.markdown.includes(canonical))
  assert.ok(result.output.sections[0]!.markdown.includes('负28.69亿元'))
  assert.ok(result.output.findings[0]!.text.includes(canonical))
  for(const markdown of [result.output.markdown,result.output.sections[0]!.markdown,result.output.findings[0]!.text]) assert.equal(validateCompanyNumericGrounding({markdown,sources:[financialSource],evidenceContexts:[financialPacket],preparedAnalysis,trustedText:['002384','2026-10-23','2026-06-30']}).status,'grounded')

  const wrongPeriodText=text.replace('2026年上半年','2025年上半年')
  const unbound={...draft,findings:[{...draft.findings[0]!,text:wrongPeriodText}],markdown:`${wrongPeriodText}\n2025年上半年${tableRow.replace('2026年上半年','')}`,sections:[{id:'financial-quality',markdown:`## 现金流\n${wrongPeriodText}\n2025年上半年${tableRow.replace('2026年上半年','')}`} ]}
  const rejected=repairCompanyMethodCitations(unbound,[financialPacket],{...input,sources:[financialSource],preparedAnalysis})
  assert.ok(rejected.output.markdown.includes(formula),'wrong period must not receive deterministic formula normalization')
})

test('fills only uniquely matched omitted split labels and value rows in cited classified tables', () => {
  const annualId = 'official-annual'
  const annualLines = [
    '单位：元',
    '2025 年 2024 年',
    '同比增减',
    '金额 占营业收入比重 金额 占营业收入比重',
    '分行业',
    '计算机、通信和',
    '其他电子 39,643,732,616.04 98.80% 36,479,191,979.20 99.21% 8.67%',
    '单位：元',
    '营业收入 营业成本 毛利率',
    '营业收入比上年同期增减',
    '营业成本比上年同期增减',
    '毛利率比上年同期增减',
    '分行业',
    '计算机、通信',
    '和其他电子 39,643,732,616.04 34,153,971,460.65 13.85% 8.67% 8.83% -0.12%',
  ]
  const annual = { candidate: { candidateId: annualId }, title: '2025年年度报告', content: annualLines.join('\n') } as CompanyResearchInput['sources'][number]
  const annualPacket: CompanyEvidencePacket = { sourceCandidateId: annualId, title: annual.title, publisher: 'CNINFO', excerpts: annualLines.map((text, index) => ({ sourceCandidateId: annualId, location: `paragraph:${index + 1}`, text })) }
  const annualRefs = (paragraphs: number[]) => paragraphs.map(paragraph => ({ sourceCandidateId: annualId, location: `paragraph:${paragraph}` }))
  const revenueFinding: CompanyMethodFinding = {
    text: '2025年度分行业营业收入表中，计算机、通信和其他电子收入为396.44亿元、占营业收入98.80%；2024年度该标签行收入为364.79亿元、占99.21%。',
    kind: 'fact', evidence: annualRefs([1, 2, 3, 4, 5, 7]),
  }
  assert.equal(validateCompanyNumericGrounding({ markdown: `${revenueFinding.text} ${[...revenueFinding.evidence, { sourceCandidateId: annualId, location: 'paragraph:6' }].map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [annual], evidenceContexts: [annualPacket] }).status, 'grounded')
  const revenueRepair = repairCompanyMethodCitations({ ...output(revenueFinding), findings: [revenueFinding] }, [annualPacket], { ...input, sources: [annual] })
  assert.deepEqual(revenueRepair.output.findings[0]!.evidence, [...revenueFinding.evidence, { sourceCandidateId: annualId, location: 'paragraph:6' }])
  assert.equal(validateCompanyNumericGrounding({ markdown: `${revenueFinding.text} ${revenueRepair.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [annual], evidenceContexts: [annualPacket] }).status, 'grounded')

  const marginFinding: CompanyMethodFinding = {
    text: '2025年度分行业“计算机、通信和其他电子”行营业收入396.44亿元、占98.80%；毛利率比上年同期增减为-0.12%。收入同比增幅8.67%，成本同比增幅8.83%。',
    kind: 'fact', evidence: annualRefs([1, 2, 5, 8, 9, 10, 11, 12, 13]),
  }
  const marginRepair = repairCompanyMethodCitations({ ...output(marginFinding), findings: [marginFinding] }, [annualPacket], { ...input, sources: [annual] })
  const repairedRefs = marginRepair.output.findings[0]!.evidence
  for (const paragraph of [3, 4, 6, 7, 14, 15]) assert.ok(repairedRefs.some(ref => ref.location === `paragraph:${paragraph}`), `missing annual row context paragraph ${paragraph}`)
  assert.equal(validateCompanyNumericGrounding({ markdown: `${marginFinding.text} ${repairedRefs.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [annual], evidenceContexts: [annualPacket] }).status, 'grounded')

  const halfId = 'official-half'
  const halfLines = [
    '单位：元', '营业收入 营业成本 毛利率', '营业收入比上年同期增减', '营业成本比上年同期增减',
    '毛利率比上年同期增减', '分行业', '计算机、通信和', '其他电子',
    '27,347,867,868.08 21,929,134,042.30 19.81% 63.21% 51.01% 6.48%',
  ]
  const half = { candidate: { candidateId: halfId }, title: '2026年半年度报告', content: halfLines.join('\n') } as CompanyResearchInput['sources'][number]
  const halfPacket: CompanyEvidencePacket = { sourceCandidateId: halfId, title: half.title, publisher: 'CNINFO', excerpts: halfLines.map((text, index) => ({ sourceCandidateId: halfId, location: `paragraph:${index + 1}`, text })) }
  const halfFinding: CompanyMethodFinding = {
    text: '2026年上半年分行业“计算机、通信和其他电子”收入为273.48亿元、毛利率19.81%；毛利率比上年同期增减为6.48%。',
    kind: 'fact', evidence: [1, 2, 3, 4, 5, 6].map(paragraph => ({ sourceCandidateId: halfId, location: `paragraph:${paragraph}` })),
  }
  const halfRepair = repairCompanyMethodCitations({ ...output(halfFinding), findings: [halfFinding] }, [halfPacket], { ...input, company: { symbol: '002384' }, sources: [half] })
  assert.deepEqual(halfRepair.output.findings[0]!.evidence.slice(-3).map(ref => ref.location), ['paragraph:7', 'paragraph:8', 'paragraph:9'])
  assert.equal(validateCompanyNumericGrounding({ markdown: `${halfFinding.text} ${halfRepair.output.findings[0]!.evidence.map(ref => `[${ref.sourceCandidateId}@${ref.location}]`).join(' ')}`, sources: [half], evidenceContexts: [halfPacket], trustedText: ['002384', '2026-10-15'] }).status, 'grounded')
  const rowAlreadyCited = { ...halfFinding, evidence: [...halfFinding.evidence, { sourceCandidateId: halfId, location: 'paragraph:9' }] }
  const rowAlreadyCitedRepair = repairCompanyMethodCitations({ ...output(rowAlreadyCited), findings: [rowAlreadyCited] }, [halfPacket], { ...input, company: { symbol: '002384' }, sources: [half] })
  assert.ok(rowAlreadyCitedRepair.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:7'))
  assert.ok(rowAlreadyCitedRepair.output.findings[0]!.evidence.some(ref => ref.location === 'paragraph:8'))

  const wrongValue = { ...halfFinding, text: halfFinding.text.replace('273.48亿元', '300亿元') }
  const wrongValueRepair = repairCompanyMethodCitations({ ...output(wrongValue), findings: [wrongValue] }, [halfPacket], { ...input, company: { symbol: '002384' }, sources: [half] })
  assert.deepEqual(wrongValueRepair.output.findings[0]!.evidence, wrongValue.evidence, 'an unmatched number must not receive row citations')

  const wrongLabel = { ...halfFinding, text: halfFinding.text.replace('计算机、通信和其他电子', '计算机、通信和其他行业') }
  const wrongLabelRepair = repairCompanyMethodCitations({ ...output(wrongLabel), findings: [wrongLabel] }, [halfPacket], { ...input, company: { symbol: '002384' }, sources: [half] })
  assert.deepEqual(wrongLabelRepair.output.findings[0]!.evidence, wrongLabel.evidence, 'a category label mismatch must not receive row citations')

  const missingHeader = { ...halfFinding, evidence: halfFinding.evidence.filter(ref => ref.location !== 'paragraph:2') }
  const missingHeaderRepair = repairCompanyMethodCitations({ ...output(missingHeader), findings: [missingHeader] }, [halfPacket], { ...input, company: { symbol: '002384' }, sources: [half] })
  assert.deepEqual(missingHeaderRepair.output.findings[0]!.evidence, missingHeader.evidence, 'incomplete header citations must remain blocked')
})
