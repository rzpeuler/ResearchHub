# Scenario Valuation

## Purpose

Evaluate how explicitly authored, attributable Bear/Base/Bull assumptions conditionally
change deterministic value. This Skill evaluates supplied assumptions; it does not
create, calibrate, or approve forward assumptions.

## Invocation Match

Use this Skill when the user asks for valuation scenarios or sensitivity around growth
and multiples. Do not use it to select an ungrounded target price or to replace a full
DCF/reverse-DCF method.

## Typical Intents

- “Show conditional Bear/Base/Bull target prices.”
- “How sensitive is value to growth and the multiple?”

## Inputs

Workflow supplies a validated valuation basis and eligible primary method; base period,
explicit target fiscal year and horizon; company, consolidation and financial scope;
currency and raw units; share denominator, share class and price-per-share basis; a
same-cutoff reference
price; and fixed `analysisAsOf`. Every fact input must have exact source-row,
value-version and rights evidence. Each `RESEARCH_ASSUMPTION` proposal identifies its
driver and value or an explicit unavailable state, economic mechanism, calibration range
and basis, evidence refs, strongest counterevidence, observable falsification trigger
and author. Workflow assigns an independent Reviewer and supplies the review result.
Missing or unqualified inputs remain unavailable.

## Produces

For fully qualified inputs, the existing code-owned calculation may produce three
conditional Bear/Base/Bull target prices, implied returns against the matching
same-cutoff reference price, a conditional 3x3 sensitivity matrix, monotonicity
diagnostics, deterministic recomputation results, and assumption/source/formula/review
bindings. These calculated outputs are conditional; they are not unconditional or
approved broker targets, market consensus, or approved investment recommendations. If a
required gate fails, produce `UNAVAILABLE` or `REVIEW_REQUIRED` without a price.

## Methodology

Keep one research question: given attributable, explicit Bear/Base/Bull assumptions, how
do they conditionally change value? Evaluate only the supplied proposals. Do not author,
calibrate or approve assumptions and do not turn company forecasting into a cross-Skill
task.

Preserve the causal chain
`driver -> mechanism -> accounting line -> conditional value -> observable falsification trigger`.
The cases must use distinct, testable economic mechanisms. Historical or industry
minimum/median/maximum growth is not a future calibration or a reasonable forecast
envelope.

For each non-overlapping revenue line, choose exactly one route: disclosed
`segmentRevenue`, or same-business, same-scope `recognizedVolume * realizedNetASP`.
These routes are mutually exclusive. Orders, production and shipments do not
automatically equal recognized revenue. Include evidenced acquisitions, disposals,
eliminations and reclassifications exactly once; preserve unexplained differences as
`RESIDUAL`. Do not infer volume or ASP from total revenue, organic growth from
consolidation, or profit share from revenue share. Keep financial lines and adjustments
non-duplicative and preserve reported scope, sign and period.

If the supplied primary method requires FCFF, qualify only an aligned, same-period,
same-scope bridge: `EBIT * (1 - T) + D&A - CapEx - deltaNWC`. The tax convention,
operating working-capital components and change, and lease/non-operating boundary must
be explicit. CapEx is a positive expenditure in this formula.
`CFO - purchases of long-term assets` is not FCFF. This is an upstream-input
qualification rule; this Skill does not construct the FCFF bridge. PE/PB routes do not
require FCFF solely because this rule exists. `dcf_valuation` and
`reverse_dcf_expectation_decode` remain independent peer methods with their own input
contracts.

When all required qualifications pass, preserve the existing code-owned conditional
calculations: the three scenario target prices, implied returns against a same-cutoff
reference price with matching currency, unit and share basis, all nine sensitivity
cells, monotonicity checks and deterministic recomputation. Use an explicit valid fiscal
horizon and method-specific eligible inputs. For a multiple-based calculation, multiples
must be explicit and positive; growth inputs must be finite and within the valid domain.
Never supply a default multiple, WACC, terminal growth, probability, equal weights,
probability-weighted expected value or target price. Do not treat the valuation 3x3
sensitivity as a historical operating-growth envelope.

An independent economic review is required before the Workflow can qualify a result. The
Reviewer must differ from the proposal author and review each assumption, evidence
lineage, scope, calibration, counterevidence, formula and trigger. Review binds the
current complete packet hash; a change to inputs, value versions, rights, horizon,
method or formula makes that review stale. Arithmetic and Skill-level text cannot grant
`QUALIFIED` or `reportEligible`; Workflow owns the review lifecycle and publication
gate. This Skill specification alone confers no eligibility on a current report or
frozen point-in-time packet.

Do not annualize H1, mix flow and stock, periods, company or consolidation scope,
currencies, units, quantities and prices, or basic, diluted and adjusted EPS bases. Keep
`FACT`, `DERIVED`, `INFERENCE` and `RESEARCH_ASSUMPTION` distinct.

## Evidence Requirements

Bind every `FACT` to the exact source token, locator, content and row, source version,
period, scope, unit and currency, plus evidence that the exact value version and rights
were available at `analysisAsOf`. A carrier publication date, retrieval time or local
content hash alone does not establish historical availability. Bind each `DERIVED` value
to its eligible inputs and formula version. Keep inferences explicit and label
assumptions with their author, calibration evidence, mechanism, counterevidence and
falsification trigger. Workflow determines point-in-time, rights, review and report
eligibility; this Skill does not claim trust or qualification from caller-provided
status strings.

## Deterministic / Model Boundary

Existing valuation code owns arithmetic and monotonicity checks; sensitivity and
deterministic recomputation remain code-owned. This Skill documents no new runtime
capability and does not itself normalize inputs, build financial bridges, reconcile
values or round results. Any such upstream work required by a selected method must be
supplied as evidence-bound input. A model may explain supplied evidence and proposals,
but may not invent values, fill missing drivers, author or approve forward assumptions,
assign probabilities, or impersonate an independent Reviewer. This Skill does not call
peer Skills, Data, Workflow or Knowledge. Workflow owns collection, routing,
point-in-time and rights qualification, independent review, report assembly and
publication eligibility.

## Missing Data

Missing is neither zero nor an estimate. Absent, conflicted, non-comparable, unlicensed
or unverified inputs remain unavailable; do not substitute history, an industry envelope
or a default. Return `UNAVAILABLE` or `REVIEW_REQUIRED` when any required
method-specific input or qualification is missing. A missing FCFF component blocks only
a method that requires FCFF; do not impose an FCFF bridge on PE/PB methods.

## Validation / QC

Require exactly three ordered Bear/Base/Bull cases, attributable proposals, a valid
explicit fiscal horizon, an eligible primary method, matched
period/scope/currency/unit/share basis and reference price, exact source/version/rights
lineage, and current independent review. Require mutually exclusive revenue routes,
single-count adjustments, preserved residuals, and valid method-specific accounting
inputs. For multiple-based calculations require explicit positive multiples; enforce the
valid growth domain and finite values. Recompute all nine sensitivity cells and require
monotonicity and deterministic equality. Never grant qualification from arithmetic
alone. If any gate fails, return `UNAVAILABLE` or `REVIEW_REQUIRED`, never a target
price.

## Related Skills

`dcf_valuation`, `reverse_dcf_expectation_decode`, `comps_valuation`, and
`valuation_crosscheck` are independent peer methods.
