# Scenario Valuation

## Purpose

Calculate how explicit Bear/Base/Bull assumptions change deterministic value.

## Invocation Match

Use this Skill when the user asks for valuation scenarios or sensitivity around
growth and multiples. Do not use it to select an ungrounded target price or to
replace a full DCF/reverse-DCF method.

## Typical Intents

- “Show Bear/Base/Bull target prices.”
- “How sensitive is value to growth and the multiple?”

## Inputs

Validated valuation basis, eligible primary method, target fiscal year, three
ordered scenario assumptions, explicit source refs, and valuation date.

## Produces

Three deterministic scenario results, a 3x3 sensitivity matrix, monotonicity
diagnostics, and evidence/source bindings.

## Methodology

Validate exactly Bear/Base/Bull assumptions and horizon; calculate each target
price and implied return in code; recompute all nine sensitivity cells; and
report unavailable methods without substituting values. This method does not
calculate a probability-weighted expected value: report the scenarios without
probabilities or a weighted expected value. A separate calibration-aware method
would require sourced, independently calibrated probabilities; never assign
equal default weights.

## Evidence Requirements

Basis inputs and scenario assumptions must be attributable, finite, and aligned
to the same point-in-time and fiscal horizon. Any probability requires
independent calibration evidence and an attributable source.

## Deterministic / Model Boundary

`skills/valuation/financials.ts` owns arithmetic and monotonicity checks. The
model may provide a bounded rationale for supplied assumptions only.

## Missing Data

An absent scenario input or ineligible method is `unavailable`; no scenario is
silently filled from a default.

## Validation / QC

Require three ordered scenarios, positive multiples, valid growth, eligible
methods, finite outputs, and deterministic recomputation equality.

## Related Skills

`dcf_valuation`, `comps_valuation`, and `valuation_crosscheck` are peer methods.
