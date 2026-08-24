import assert from 'node:assert/strict'
import test from 'node:test'
import { runIndustryResearchCommand } from './index.ts'

const asOf = '2026-08-24T00:00:00.000Z'

test('industry research gathers dated sources and peer metrics through Plugin ports', async () => {
  const result = await runIndustryResearchCommand({ industry: 'Semiconductors', geography: 'China', asOf }, {
    research: {
      search_industry: async ({ query }) => [{ source: 'fixture-research', title: query, content: 'Fixture evidence', asOf, confidence: 0.8 }],
      list_peer_metrics: async () => [{ name: 'Peer A', revenueGrowth: 0.2, source: 'fixture-peers', asOf }],
    },
  })
  assert.equal(result.skillId, 'industry-research')
  assert.equal(result.sections.length, 5)
  assert.equal(result.peerMetrics[0]?.name, 'Peer A')
})

test('industry research rejects missing scope', async () => {
  await assert.rejects(() => runIndustryResearchCommand({ industry: '', geography: 'China', asOf }, {} as never), /industry/)
})
