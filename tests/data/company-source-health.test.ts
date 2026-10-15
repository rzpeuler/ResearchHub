import assert from 'node:assert/strict'
import test from 'node:test'
import { assessCompanySourceHealth, type CompanySourceAttemptTrace } from '../../data/company-source-health.ts'
const failure: CompanySourceAttemptTrace = { metricId: 'company_market_history', requirementId: 'market-002594', sourceId: 'primary', status: 'SOURCE_ERROR', diagnostic: 'HTTP_503' }
const replacement: CompanySourceAttemptTrace = { ...failure, sourceId: 'fallback', status: 'SUCCESS', validated: true, diagnostic: undefined }
test('one failure cannot recommend replacing a source', () => {
  assert.deepEqual(assessCompanySourceHealth([failure, replacement]), [])
})
test('repeated failures plus later validated alternative recommends run-local replacement', () => {
  const advice = assessCompanySourceHealth([failure, { ...failure, round: 1 }, replacement])
  assert.deepEqual(advice, [{ metricId: failure.metricId, requirementId: failure.requirementId, sourceId: 'primary', status: 'replacement_recommended', failureCount: 2, latestDiagnostic: 'HTTP_503', replacementSourceId: 'fallback' }])
})
test('no usable alternate, earlier success, and different requirement cannot justify replacement', () => {
  for (const trace of [[failure, failure], [replacement, failure, failure], [failure, failure, { ...replacement, validated: false }], [failure, failure, { ...replacement, requirementId: 'another-company' }]]) assert.equal(assessCompanySourceHealth(trace)[0]?.status, 'repeated_failure')
})
test('budget, cancellation and PIT-window exclusions are not provider incidents', () => {
  for (const diagnostic of ['ACQUISITION_BUDGET_EXCEEDED', 'WORKFLOW_CANCELLED', 'OUTSIDE_PERIOD', 'POINT_IN_TIME_INVALID']) assert.deepEqual(assessCompanySourceHealth([{ ...failure, diagnostic }, { ...failure, diagnostic }, replacement]), [])
})
test('verified recovery clears prior incidents and does not mutate input', () => {
  const trace = Object.freeze([Object.freeze(failure), Object.freeze(failure), Object.freeze({ ...failure, status: 'SUCCESS' as const, validated: true })])
  assert.deepEqual(assessCompanySourceHealth(trace), [])
  assert.equal(trace[0]?.status, 'SOURCE_ERROR')
})
