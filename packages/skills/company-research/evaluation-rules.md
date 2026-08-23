# Company Research Evaluation Rules

These rules evaluate research-record quality. They do not calculate valuation,
rank companies, measure investment profitability, or modify a strategy.

## Evidence Quality

- Confirm source reliability and preserve source, Provider, timestamp, quality,
  confidence, period, and unit metadata where applicable.
- Confirm that Evidence covers the relevant research modules rather than only
  the easiest data source.
- Require multiple independent sources for material business, industry,
  competitive, or risk claims when available.
- Qualify single-source claims and reject missing source identity, invalid
  timestamps, invalid periods, or conflicting symbol mappings.
- Keep facts from different reporting periods explicitly separated.

## Reasoning Quality

- Confirm that every major Thesis claim references Evidence IDs.
- Confirm a complete chain from business facts through industry, advantage,
  growth, financial quality, capital allocation, and risk where relevant.
- Identify logical jumps from description directly to durable advantage,
  certainty, or recommendation.
- Separate historical fact, interpretation, hypothesis, assumption, and
  realized Outcome.
- Confirm that confidence is calibrated to evidence quality and uncertainty.

## Risk Quality

- Check relevant industry, competitive, execution, regulatory, technology,
  concentration, financial, governance, and capital-allocation risks.
- Check that each material risk identifies an affected Thesis assumption or
  validation metric.
- Require warning signals or review conditions where practical.
- Treat empty or generic `risks` as incomplete when the Evidence contains
  material uncertainty or conflict.

## Prediction Quality

- Confirm that Prediction references a valid Thesis through `thesisId`.
- Confirm that `metrics.validation_metric` is explicit, observable, and
  comparable with a future Outcome.
- Confirm that `evaluationPeriod` has valid start and end timestamps.
- Confirm that the expectation is a hypothesis, not a guaranteed return,
  valuation target, or trading instruction.
- Confirm that the Prediction states what observation would weaken or
  invalidate it.

## Evaluation handoff

The existing Evaluation Framework compares Prediction metrics with a
caller-supplied Outcome and creates a Review. Company Research does not self-
evaluate, rewrite its method, or automatically change an investment strategy
after a Review.
