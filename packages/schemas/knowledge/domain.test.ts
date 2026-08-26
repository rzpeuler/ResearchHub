import assert from 'node:assert/strict'
import test from 'node:test'
import { SOURCE_RELIABILITIES, SOURCE_TYPES } from './domain.ts'
import type { KnowledgeSource, SourceReliability, SourceType } from './domain.ts'

test('v0.1 Source remains representable by the canonical domain contract', () => {
  const source: KnowledgeSource = {
    id: 'source:legacy',
    type: 'research_report',
    title: 'Legacy source',
    publisher: 'ResearchHub fixture',
    publishedAt: '2026-08-25',
    url: 'https://example.com/legacy',
    quality: 'fixture',
  }
  assert.equal(source.publisher, 'ResearchHub fixture')
})

test('v0.2 Source nullable fields and Raw provenance are representable', () => {
  const source: KnowledgeSource = {
    id: 'source:v02',
    type: 'research_report',
    title: 'Sell-side report',
    publisher: null,
    institution: null,
    author: null,
    publishedAt: null,
    url: null,
    sourceType: 'sell_side_research',
    sourceReliability: 'high',
    quality: { score: 0.9, note: 'reviewed' },
    rawRefs: ['raw:report-001'],
    metadata: { coverage: 'AI Hardware' },
    lifecycle: null,
  }
  assert.equal(source.sourceType, 'sell_side_research')
  assert.deepEqual(source.rawRefs, ['raw:report-001'])
})

test('Source enums are deterministic and exclude unsupported values', () => {
  assert.deepEqual(SOURCE_TYPES, [
    'official_disclosure', 'company_official', 'sell_side_research', 'industry_database',
    'professional_media', 'general_media', 'community', 'unknown',
  ])
  assert.deepEqual(SOURCE_RELIABILITIES, ['high', 'medium', 'low', 'unknown'])
  assert.equal((SOURCE_TYPES as readonly string[]).includes('unsupported'), false)
})

test('Source enum types reject arbitrary values at compile time', () => {
  const validType: SourceType = 'company_official'
  const validReliability: SourceReliability = 'medium'
  assert.equal(validType, 'company_official')
  assert.equal(validReliability, 'medium')
  // @ts-expect-error arbitrary source types are not part of the frozen enum
  const invalidType: SourceType = 'arbitrary_source'
  // @ts-expect-error arbitrary reliabilities are not part of the frozen enum
  const invalidReliability: SourceReliability = 'unverified'
  assert.equal(typeof invalidType, 'string')
  assert.equal(typeof invalidReliability, 'string')
})
