# Event Analysis Evaluation Rules

These rules define research-record quality. They do not grade investment
profitability and do not allow the Skill to change its own methodology.

## Evidence Quality

### Source reliability

- Prefer official announcements for issuer facts.
- Use professional media as contextual or explanatory evidence, not as proof
  of an issuer fact when an official source is required.
- Preserve plugin, source, timestamp, quality, and confidence metadata.
- Reject or qualify evidence with unmapped symbols, invalid timestamps, or
  missing source identity.

### Multi-source verification

- A causal Thesis requires at least two Evidence source categories.
- A single source may establish an observation but cannot establish a complete
  cause by itself.
- Conflicting sources must be recorded in Thesis risks and not silently
  resolved in favor of the preferred explanation.

## Reasoning Quality

- The Thesis must reference the Evidence IDs that support each major claim.
- The reasoning must distinguish observed fact, interpretation, hypothesis,
  and uncertainty.
- The logic chain must not skip from price movement directly to investment
  conclusion.
- Financial Evidence must be period-aware and used to qualify the Thesis,
  not to create an unrequested valuation model.
- Alternative explanations and invalidation conditions must be explicit.

## Prediction Quality

- The Prediction must contain a hypothesis represented by Artifact
  `expectation`.
- It must contain at least one named `validation_metric` in `metrics`.
- It must contain a bounded `evaluationPeriod` with start and end timestamps.
- The metric must be observable from a future Outcome and have a clear
  pass/fail or comparison interpretation.
- Directional certainty, unsupported targets, and unmeasurable language are
  quality failures.

## Evaluation handoff

The Evaluation Framework later receives the Prediction and a caller-supplied
Outcome. It compares declared metrics and produces a Review. Event Analysis
must not treat the existence of a Prediction as evidence that the Thesis was
correct, and must not automatically modify a strategy after Review.
