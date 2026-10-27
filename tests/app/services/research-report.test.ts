import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readResearchReport, writeResearchReport, validateResearchReport, renderResearchReport, type ResearchReport } from '../../../app/services/research-report.ts'
import { evaluateCompanyResearchContent } from '../../../workflows/company-deep-research/content-quality.ts'

test('company report preserves optional quality and evidence locations without canonical writes', () => {
  const report: ResearchReport = { reportId: 'quality-report', reportType: 'company_research', subjectRefs: ['entity:company-test'], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'quality-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', researchQuality: evaluateCompanyResearchContent({ sections: [] }), methodExecutions: [{ skillId: 'company_history_strategy', status: 'complete', attempts: 1 }], sections: [{ id: 'company-overview', title: 'Company Overview', markdown: '公司成立与业务转型分析。', evidenceLinks: ['https://example.test/annual.pdf'], evidenceLocations: [{ sourceCandidateId: 'annual', url: 'https://example.test/annual.pdf', locator: 'paragraph:22', excerpt: '业务转型披露' }] }], outputPath: 'quality-report.md' }
  assert.equal(validateResearchReport(report).sourceRefs.length, 0)
  assert.match(renderResearchReport(report), /公司概况与发展历程/)
  assert.match(renderResearchReport(report), /paragraph:22/)
  assert.match(renderResearchReport(report), /研究完成度：未完成/)
  assert.throws(() => validateResearchReport({ ...report, methodExecutions: [{ skillId: 'method', status: 'complete', attempts: 3 }] }), /methodExecutions/)
})

test('company report accepts two independent review rounds with bounded attempts and rejects excess budget', () => {
  const base: ResearchReport = { reportId: 'review-budget-report', reportType: 'company_research', subjectRefs: ['entity:company-test'], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'review-budget-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'company-overview', title: 'Company Overview', markdown: '公司沿革分析。' }], outputPath: 'review-budget-report.md' }
  const sectionChecks = Array.from({ length: 19 }, (_, index) => ({ sectionId: `section-${index}`, questionAnswered: true, evidenceSupportsConclusion: true, numericReproducible: true, riskTransmission: true, reasons: [] }))
  const researchQuality = { ...evaluateCompanyResearchContent({ sections: [] }), semanticReview: { passed: true, status: 'passed' as const, attempts: 3, rounds: 2, sectionChecks, issues: [], diagnostics: [] } }
  assert.equal(validateResearchReport({ ...base, researchQuality }).researchQuality?.semanticReview?.attempts, 3)
  assert.throws(() => validateResearchReport({ ...base, researchQuality: { ...researchQuality, semanticReview: { ...researchQuality.semanticReview, attempts: 5 } } }), /semantic review is invalid/)
  assert.throws(() => validateResearchReport({ ...base, researchQuality: { ...researchQuality, semanticReview: { ...researchQuality.semanticReview, rounds: 3 } } }), /semantic review is invalid/)
})

test('company report nests method headings beneath the fixed chapter title', () => {
  const report: ResearchReport = { reportId: 'nested-heading-report', reportType: 'company_research', subjectRefs: [], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'heading-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'company-overview', title: 'Company Overview', markdown: '## 发展阶段与战略转向\n正文。\n\n### 路径依赖\n说明。\n段落内换节。 ## 战略验证' }], outputPath: 'nested-heading-report.md' }
  const markdown = renderResearchReport(report)
  assert.match(markdown, /^## 公司概况与发展历程$/m)
  assert.match(markdown, /^### 发展阶段与战略转向$/m)
  assert.match(markdown, /^### 路径依赖$/m)
  assert.match(markdown, /段落内换节。\n\n### 战略验证$/m)
  assert.equal((markdown.match(/^## /gm) ?? []).length, 1)
})

test('company report separates inline method headings and restores a table header', () => {
  const report: ResearchReport = { reportId: 'inline-headings-report', reportType: 'company_research', subjectRefs: [], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'inline-heading-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'company-overview', title: 'Company Overview', markdown: '### 公司沿革与战略演变 ### 成立口径与早期基础\n正文说明。\n段落内转入标题。 ### 股份改制\n### 财务指标 | 指标 | 2024 | 2025 | 备注 |\n| --- | --- | --- | --- | --- |\n| 营收 | 1 | 2 | 年度 |' }], outputPath: 'inline-headings-report.md' }
  const markdown = renderResearchReport(report)
  assert.match(markdown, /^## 公司概况与发展历程$/m)
  assert.match(markdown, /^### 公司沿革与战略演变$/m)
  assert.match(markdown, /^#### 成立口径与早期基础$/m)
  assert.match(markdown, /段落内转入标题。\n\n### 股份改制$/m)
  assert.match(markdown, /^### 财务指标$/m)
  assert.match(markdown, /^\| 指标 \| 2024 \| 2025 \| 备注 \|$/m)
  assert.match(markdown, /^\| --- \| --- \| --- \| --- \| --- \|$/m)
  assert.match(markdown, /^\| 营收 \| 1 \| 2 \| 年度 \|$/m)
  assert.equal((markdown.match(/^## /gm) ?? []).length, 1, 'section normalizing must preserve the fixed chapter H2')
})

test('company report separates flattened H1 and H3 titles from long Chinese body text', () => {
  const report: ResearchReport = { reportId: 'inline-h1-report', reportType: 'company_research', subjectRefs: [], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'inline-h1-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'company-overview', title: 'Company Overview', markdown: '# 公司历史与战略演变 比亚迪的发展路径表现为从技术与制造能力出发，向新能源汽车扩张。[annual@paragraph:12] ## 起点及主体口径 董事长致辞称实业公司于1995年共同注册成立，2002年整体变更为股份有限公司。[annual@paragraph:13]' }], outputPath: 'inline-h1-report.md' }
  const markdown = renderResearchReport(report)
  assert.match(markdown, /^## 公司概况与发展历程$/m)
  assert.match(markdown, /^### 公司历史与战略演变$/m)
  assert.match(markdown, /^比亚迪的发展路径表现为从技术与制造能力出发，向新能源汽车扩张。\[annual@paragraph:12\]$/m)
  assert.match(markdown, /^### 起点及主体口径$/m)
  assert.match(markdown, /^董事长致辞称实业公司于1995年共同注册成立，2002年整体变更为股份有限公司。\[annual@paragraph:13\]$/m)
  assert.equal((markdown.match(/^# /gm) ?? []).length, 1, 'a section H1 must not become a second report title')
})

test('company report restores a table header appended to prose before its separator', () => {
  const report: ResearchReport = { reportId: 'inline-prose-table-report', reportType: 'company_research', subjectRefs: [], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'inline-prose-table-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'business-model', title: 'Business Model', markdown: '商业模式说明收入来自整车及相关产品销售。[annual@paragraph:40] | 产品 | 2025营业收入 | 占比 |\n|---|---:|---:|\n| 汽车 | 100 | 80% |' }], outputPath: 'inline-prose-table-report.md' }
  const markdown = renderResearchReport(report)
  assert.match(markdown, /^商业模式说明收入来自整车及相关产品销售。\[annual@paragraph:40\]$/m)
  assert.match(markdown, /^\| 产品 \| 2025营业收入 \| 占比 \|$/m)
  assert.match(markdown, /^\|---\|---:\|---:\|$/m)
  assert.match(markdown, /^\| 汽车 \| 100 \| 80% \|$/m)
  assert.match(markdown, /销售。\[annual@paragraph:40\]\n\n\| 产品/m)
})

test('company report lifts an inline heading out of a flattened table row', () => {
  const report: ResearchReport = { reportId: 'inline-heading-table-row', reportType: 'company_research', subjectRefs: [], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'inline-heading-table-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'products', title: 'Products', markdown: '| ### 产品收入与利润差异 本段解释收入结构、毛利变化和相关限制。[annual@paragraph:40] |\n\n| 产品 | 收入 | 占比 |\n|---|---:|---:|\n| 汽车 | 100 | 80% |' }], outputPath: 'inline-heading-table-row.md' }
  const markdown = renderResearchReport(report)
  assert.match(markdown, /^### 产品收入与利润差异$/m)
  assert.match(markdown, /^本段解释收入结构、毛利变化和相关限制。\[annual@paragraph:40\]$/m)
  assert.match(markdown, /^\| 产品 \| 收入 \| 占比 \|$/m)
  assert.doesNotMatch(markdown, /^\| ###/m)
})

test('company report removes duplicate locators within a citation bundle but keeps repeated citations across claims', () => {
  const report: ResearchReport = { reportId: 'dedupe-citations', reportType: 'company_research', subjectRefs: [], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'dedupe-citations-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'business-model', title: 'Business Model', markdown: '汽车收入与占比见表。[annual@paragraph:821] [annual@paragraph:822] [annual@paragraph:821] 第二项结论仍引用同一原文。[annual@paragraph:821]' }], outputPath: 'dedupe-citations.md' }
  const markdown = renderResearchReport(report)
  const firstClaim = markdown.split('第二项结论')[0]!
  assert.equal([...firstClaim.matchAll(/\[annual@paragraph:821\]/g)].length, 1)
  assert.equal([...markdown.matchAll(/\[annual@paragraph:821\]/g)].length, 2)
})

test('company report does not format a long flattened heading and body as a heading', () => {
  const report: ResearchReport = { reportId: 'long-inline-heading-report', reportType: 'company_research', subjectRefs: [], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'long-inline-heading-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'industry-exposure', title: 'Industry', markdown: '### 市场边界与产业链位置\n正文。\n### 需求变化、结构与反证 **披露事实：**公司正在扩展海外业务，并推进电子业务的服务器产品导入与量产。正文继续说明其不能证明市场份额或行业总需求。' }], outputPath: 'long-inline-heading-report.md' }
  const markdown = renderResearchReport(report)
  assert.match(markdown, /^### 市场边界与产业链位置$/m)
  assert.match(markdown, /^### 需求变化、结构与反证$/m)
  assert.match(markdown, /^\*\*披露事实：\*\*公司正在扩展海外业务，并推进电子业务的服务器产品导入与量产。正文继续说明其不能证明市场份额或行业总需求。$/m)
})

test('company report leaves an ordinary long paragraph intact', () => {
  const paragraph = '比亚迪的发展路径表现为从技术与制造能力出发，向新能源汽车扩张；现有证据说明近期战略重点，但不足以重建早期各业务阶段或断言其长期回报。'
  const report: ResearchReport = { reportId: 'long-paragraph-report', reportType: 'company_research', subjectRefs: [], generatedAt: '2026-09-08T00:00:00Z', asOf: '2026-09-08T00:00:00Z', workflowRunId: 'long-paragraph-run', knowledgeBaseRevision: 0, sourceRefs: [], claimRefs: [], methodology: 'Evidence-bounded research', sections: [{ id: 'company-overview', title: 'Company Overview', markdown: paragraph }], outputPath: 'long-paragraph-report.md' }
  const markdown = renderResearchReport(report)
  assert.match(markdown, new RegExp(`^${paragraph}$`, 'm'))
  assert.equal((markdown.match(/^### /gm) ?? []).length, 0)
})

test('ResearchReport writes Markdown plus validated metadata', async () => { const root = await mkdtemp(join(tmpdir(), 'researchhub-report-')); try { const report: ResearchReport = { reportId: 'report-test', reportType: 'company_research', subjectRefs: ['entity:company-test'], generatedAt: '2026-09-08T00:00:00.000Z', asOf: '2026-09-08T00:00:00.000Z', workflowRunId: 'run-test', knowledgeBaseRevision: 1, sourceRefs: ['source:test'], claimRefs: ['claim:test'], methodology: 'fixture', sections: [{ id: 'overview', title: 'Company Overview', markdown: 'Evidence-backed overview.', sourceRefs: ['source:test'], claimRefs: ['claim:test'] }], outputPath: 'report-test.md' }; const output = await writeResearchReport(report, root); assert.match(await readFile(output, 'utf8'), /Company Overview/); assert.equal((await readResearchReport(`${output}.json`)).reportId, 'report-test') } finally { await rm(root, { recursive: true, force: true }) } })

test('ResearchReport accepts event_research and renders the product title', async () => { const root = await mkdtemp(join(tmpdir(), 'researchhub-event-report-')); try { const report: ResearchReport = { reportId: 'event-report-test', reportType: 'event_research', subjectRefs: ['entity:company-test'], generatedAt: '2026-09-08T00:00:00.000Z', asOf: '2026-09-08T00:00:00.000Z', workflowRunId: 'event-run-test', knowledgeBaseRevision: 1, sourceRefs: [], claimRefs: [], methodology: 'bounded event fixture', sections: [{ id: 'event-summary', title: 'Event Summary', markdown: 'Event-backed summary.' }], outputPath: 'event-report-test.md' }; const output = await writeResearchReport(report, root); assert.match(await readFile(output, 'utf8'), /^# Event Research/m); assert.equal((await readResearchReport(`${output}.json`)).reportType, 'event_research') } finally { await rm(root, { recursive: true, force: true }) } })

test('ResearchReport accepts industry_research, renders title, and preserves relation provenance', async () => { const root = await mkdtemp(join(tmpdir(), 'researchhub-industry-report-')); try { const report: ResearchReport = { reportId: 'industry-report-test', reportType: 'industry_research', subjectRefs: ['entity:industry-test'], generatedAt: '2026-09-08T00:00:00.000Z', asOf: '2026-09-08T00:00:00.000Z', workflowRunId: 'industry-run-test', knowledgeBaseRevision: 2, sourceRefs: ['source:s'], claimRefs: ['claim:c'], methodology: 'fixture', sections: [{ id: 's1', title: 'Industry Scope & Definition', markdown: 'Industry-backed.', sourceRefs: ['source:s'], claimRefs: ['claim:c'], relationRefs: ['relation:r'] }], outputPath: 'industry-report-test.md' }; const output = await writeResearchReport(report, root); assert.match(await readFile(output, 'utf8'), /^# Industry Research/m); const loaded = await readResearchReport(`${output}.json`); assert.deepEqual(loaded.sections[0]?.relationRefs, ['relation:r']); assert.equal(loaded.sections.length, 1) } finally { await rm(root, { recursive: true, force: true }) } })
