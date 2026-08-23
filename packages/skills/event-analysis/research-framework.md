# Event Analysis Research Framework

## 1. Price Action Analysis

Describe the observable market event before explaining it. Record symbol,
price, change, volume, timestamp, and source metadata. The analysis may flag
anomalous movement, but it must not treat movement as proof of causality.

Required questions:

- What changed and over what period?
- Is the observation supported by price, volume, or another market fact?
- What data is missing or stale?

Output: Market Evidence and a bounded event description.

## 2. Catalyst Analysis

Search for company announcements and professional media reports that could be
temporally related to the event. Keep the reported claim, publisher/source,
publication time, and related symbol distinct from the researcher's
interpretation.

Required questions:

- What candidate catalyst was reported?
- Is it official, professional-media, or another source type?
- Do multiple independent sources describe the same fact?

Output: Information Evidence with source and confidence metadata.

## 3. Expectation Analysis

Translate the collected facts into explicit expectations without presenting
them as certainty. Identify what the market may be responding to, what would
confirm the interpretation, and what would invalidate it.

Required questions:

- Which evidence supports the expectation?
- What alternative explanation remains plausible?
- Which metric can be observed during the evaluation period?

Output: a Thesis candidate and a measurable Prediction hypothesis.

## 4. Fundamental Validation

Use reported financial facts to test whether the event interpretation is
consistent with the company's operating condition. Financial data is context,
not an automatic valuation or recommendation.

Required questions:

- Which revenue, profit, balance-sheet, or cash-flow facts are relevant?
- What reporting period and source apply?
- Does the financial evidence support, qualify, or contradict the Thesis?

Output: Financial Evidence and explicit qualifications in Thesis risks.

## 5. Risk Analysis

List uncertainty before finalizing the research record. Risks include single-
source explanations, contradictory reports, stale financial periods, symbol
mapping uncertainty, missing metrics, and events that cannot be causally
attributed from the available evidence.

Required questions:

- What evidence would change the Thesis?
- What is the minimum invalidation condition for the Prediction?
- Which unresolved risk must be reviewed later?

Output: Thesis `risks[]` and Prediction validation conditions.

## Method sequence

```text
Event confirmation
  -> Catalyst identification
  -> Information verification
  -> Fundamental validation
  -> Logic-chain formation
  -> Risk identification
  -> Prediction metric definition
```

The sequence is a research method. The approved Event Analysis Workflow
remains responsible for invoking Capabilities and passing the resulting
Artifacts through the Harness execution boundary.
