# Real Equity Research Pipeline Design

**Task:** PIPELINE-REAL-DATA-001
**Status:** Approved
**Date:** 2026-08-24

## Goal

Validate one complete ResearchHub Equity Research request with real News,
Financial, and LLM Runtime dependencies while preserving the existing Single
DSH Architecture, Workflow definition, Skill contracts, Plugin interfaces,
and Artifact models.

## Runtime composition

The integration test uses the existing `ResearchManager` as the DSH entry
point and registers the existing `EquityResearchWorkflow` definition and
executor. The executor receives five LLM-backed Skill adapters from the
existing Harness runtime adapter. No new Agent, Planner, Workflow Engine, or
Skill is introduced.

The real data path is:

`GDELT News Plugin + AKShare Financial Plugin -> read-only real-data context -> five LLM Skill calls -> Equity Research Workflow -> Artifact bundle -> Evaluation`

The test prefetches the real News and Financial Plugin results once. It wraps
the existing LLM Skill adapter calls with a test-only context decorator that
adds those provider results and stable provider names to the immutable
Workflow context. The Runtime Adapter continues to accept only Skill input and
context; it does not select Providers or call DSH.

## Provider and Runtime requirements

The test is enabled only when all of the following are present:

- `RUN_REAL_EQUITY_PIPELINE=1`;
- `DEEPSEEK_API_KEY`;
- `AKSHARE_FINANCIAL_ENDPOINT`.

GDELT uses its existing public endpoint configuration. Financial Provider
selection is explicit as `akshare-financial`, matching the current default.
If any required dependency is absent, the test skips with a clear reason and
does not substitute Fixture data.

## Validation assertions

The test validates that:

1. GDELT returns real News records for `600519`.
2. AKShare returns normalized FinancialData with the required financial facts.
3. The real provider payloads and source identifiers are present in every LLM
   request context.
4. The Harness LLM Runtime completes five Skill calls.
5. ResearchManager completes the six Workflow steps in order.
6. The final ResearchReport, Evidence, Thesis, and Prediction are generated
   with stable relationships and JSON serialization round trips.
7. Evaluation produces a successful Review for the generated Prediction.

The test checks provider provenance and Workflow relationships without
asserting model-specific wording or investment conclusions.

## Non-goals

This task does not change the Equity Research Workflow, add Plugin-to-Skill
imports, modify the Artifact core schema, alter Financial or News Plugin
logic, introduce a new Agent, or make real network calls part of default
`npm test`.
