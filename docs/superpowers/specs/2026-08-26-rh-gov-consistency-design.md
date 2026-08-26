# RH-GOV-CONSISTENCY-002 Design

## Objective

Close the current Architecture / Governance / AKShare Bridge consistency gaps
without adding a system architecture layer or changing the frozen Knowledge
v0.1 boundary.

## Boundaries

```text
ResearchManager (DSH)
  -> Workflow
    -> Skill
      -> Financial Plugin
        -> TypeScript AKShare adapter
          -> external Python AKShare Bridge
```

The Python Bridge remains a lightweight external-runtime adapter. The
TypeScript runtime does not import the AKShare SDK. Research Output and
Knowledge remain separate product-facing boundaries; Workflow controls any
future Knowledge lifecycle update, and no automatic Research Output to
Knowledge conversion is introduced.

## Recommended Approach

### Period semantics

The Bridge validates `periodType` as `annual`, `quarterly`, or `ttm`. An omitted
period type defaults to `annual` for compatibility with the existing adapter
call path. Annual requests select a report period ending in December;
quarterly requests select a report period ending in March, June, or September.
If no row satisfies the requested period semantics, the Bridge fails
explicitly. TTM is not available from the current source contract and returns
HTTP 422 with `Unsupported periodType: ttm`.

### Source-date semantics

The financial period is required and must parse as a valid source date. A
missing or invalid period returns an explicit validation error. Report or
publication dates are optional: missing values remain `null` in the Bridge
payload and are not replaced with the current date or period end.

The TypeScript financial model therefore makes `reportDate` and source
`publishedAt` optional. Financial Evidence uses the actual `retrievedAt` only
as the evidence creation timestamp when the source publication date is absent;
the source metadata continues to show that the source date was unavailable.

### Deterministic testing

Python standard-library tests patch the AKShare functions and never access the
network. They cover symbol validation, statement selection and normalization,
annual/quarterly behavior, explicit TTM rejection, missing dates, empty data,
provider exceptions, and JSON-safe NaN/Pandas timestamp conversion. Existing
TypeScript tests cover the request payload and compatibility of optional source
dates.

### Governance synchronization

The root README describes Research Output and Knowledge as separate boundaries.
TASK_REGISTRY records completed Knowledge and Bridge tasks using recoverable
commit hashes. DEVELOPMENT_ROADMAP records the frozen and implemented
Knowledge milestones and states that automated ingestion, extraction,
databases, RAG, ontology engines, or automatic Knowledge formation require a
separate architecture decision. CURRENT_STATUS and CHANGELOG receive the same
state update. A tool-local dependency manifest and operating README document
the external Python runtime, endpoint, period behavior, and network boundary.

## Alternatives Rejected

- Filtering only in the TypeScript adapter would leave the Bridge free to
  return semantically incorrect rows.
- Computing TTM in this task would introduce an undefined calculation contract
  and could fabricate a source meaning that AKShare did not provide.
- Adding a generic Provider, ingestion, or Knowledge conversion layer would
  violate the current single-DSH architecture and task scope.

## Validation

- Focused Python Bridge tests pass without network access.
- Focused AKShare TypeScript tests and typecheck pass.
- The existing full ResearchHub suite is run and any unrelated opt-in real-data
  dependency failure is reported separately.
- Static architecture checks confirm no `packages/dsh`, no package-to-DSH
  imports, top-level `knowledge/`, and no automatic Research Output to
  Knowledge pipeline.
