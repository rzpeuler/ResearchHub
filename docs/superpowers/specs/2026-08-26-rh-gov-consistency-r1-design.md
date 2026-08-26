# RH-GOV-CONSISTENCY-002-R1 Design

## Goal

Close the default-period regression in the AKShare Financial Bridge. An
omitted `periodType` must select the latest valid financial period end date
across all available source rows, while explicit `annual` and `quarterly`
requests retain their existing filters. Explicit `ttm` remains unsupported
and returns HTTP 422.

## Chosen approach

Keep period selection inside the existing Python Bridge boundary and make the
period filter tri-state:

- `None`: sort all rows with valid financial period end dates descending and
  select the newest row;
- `annual`: retain only December period ends, then select the newest row;
- `quarterly`: retain only March, June, or September period ends, then select
  the newest row.

The request parser continues to distinguish an omitted value from explicit
period values. The TypeScript Financial Plugin contract and the DSH,
Workflow, Skill, and Knowledge boundaries remain unchanged.

## Error and date semantics

Rows without a parseable financial period end date are excluded from selection.
If no valid row remains, the Bridge returns HTTP 422. Missing report or
publication dates remain absent/null; they are not substituted with the
selected period end or current time. TTM is rejected before provider access.

## Verification

The network-free Python Bridge tests will cover the omitted-period case with
mixed annual and quarterly fixtures, proving that the latest period wins even
when it is not annual. Existing explicit annual, quarterly, TTM, missing
period, provider-error, and date-cleaning tests remain. The operating README
will document the corrected default behavior.

The default `npm test` will be run without real-provider activation. Any
opt-in real-data failure will be reported separately from deterministic test
results. Generated Python cache files are excluded from Git.
