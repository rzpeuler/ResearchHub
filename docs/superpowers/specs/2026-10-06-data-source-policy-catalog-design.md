# Data Source Policy Catalog Design

**Date:** 2026-10-06  
**Status:** Design approved in conversation; awaiting specification review  
**Scope:** Read-only data-source catalog and Workflow-owned source routing for non-industry generic data requirements.

## Context

ResearchHub has multiple ways to acquire external data. Some Workflows declare a `DataRequirement` and a `SourcePolicy`; other Workflows call source adapters directly. The current source behavior is therefore difficult to inspect in one place, and a frontend catalog cannot safely infer execution order from source names alone.

The existing acquisition contract distinguishes Workflow, capability, metric identity, source operation, authority, and fallback level. A capability is a label for the data service a requirement needs. It is not itself a function or Skill. An `operationId` identifies the executable source operation. Workflow remains responsible for deterministic execution and validation; Plugin remains responsible for external integrations.

## Goals

- Add a **Data Sources** window reachable from the frontend sidebar.
- Show a read-only table for every non-industry generic data requirement.
- Give every row a globally unique `metricId`, a Chinese label, its capability, and its configured source order.
- Make the displayed source order the same policy used by runtime acquisition.
- Configure a real executable non-public-web fallback for every metric. The second fallback is optional.
- Configure public web search as the final fallback, subject to evidence validation and provenance requirements.
- Make missing source coverage explicit instead of presenting an unimplemented adapter as available.

## Non-goals

- Editing, reordering, or saving source policy from the frontend in this phase.
- Including industry-research requirements in this table; their fields and evidence model differ.
- Introducing a global provider registry, generic service locator, or dynamic plugin discovery mechanism.
- Weakening authority, point-in-time (PIT), required-field, or evidence validation to accept a fallback result.
- Treating the table as a live provider health monitor.

## User experience

Add a **Data Sources** item to the frontend sidebar. Opening it loads the backend's read-only catalog and displays one row per globally unique metric ID, sorted by `metricId`.

The table has exactly these columns, in order:

1. `metricId`
2. Chinese meaning
3. Service `capability`
4. Default source
5. First fallback source
6. Second fallback source
7. Final fallback source

The final fallback column displays Public Web Search. The second fallback may be empty when no second source is configured. An uncovered or not-yet-executable source is shown as **待接入**, never as a working provider. The table contains no edit, drag-and-drop, or save controls. It displays configured routing, not current network reachability.

## Identity and policy model

- `metricId` is globally unique across all non-industry generic requirements. Existing duplicate IDs must be renamed and all corresponding consumers, requirements, source policies, and persisted/read contracts migrated consistently. For example, valuation EPS and earnings-expectation EPS need distinct namespaced IDs such as `valuation_eps` and `earnings_expectation_eps`.
- Each requirement is internally bound to its owning Workflow. Although the table does not add a Workflow column, policy matching and execution use Workflow + capability + metric ID to prevent cross-Workflow matches.
- `capability` remains a descriptive, exact-match contract value; it is not a closed global registry and does not replace `operationId`.
- Each Workflow explicitly declares its requirements and ordered source candidates. The backend catalog is a read-only aggregate view over these declarations. Runtime routing consumes the same declarations; a separately maintained display-only mapping is not allowed.
- Every non-industry generic source call must be routed through the Workflow's source policy. Existing direct adapter calls that bypass the policy must be brought under that policy so the table and execution agree.
- Candidate adapters stay explicit in Workflow composition and Plugin integration. Do not add global provider discovery or a service locator.

## Source order and fallback behavior

For each metric, the ordered candidates are:

`default source -> fallback 1 -> optional fallback 2 -> public web search`

Each metric must have a configured default and at least one implemented non-public-web fallback. The second non-web fallback is optional. Public web search is always the last configured candidate and does not count toward the required non-web fallback.

Use the existing deterministic first-valid acquisition behavior. Proceed to the next candidate when an attempt errors, returns no usable data, or fails required-field, minimum-authority, or PIT validation. A user-cancelled request stops immediately. Do not accept a candidate merely because it returned a value; the owning Workflow's validations determine acceptance. Record attempted operation/source, result or rejection reason, provenance, and collection time for each attempt.

Public Web Search may retrieve and extract attributable public sources. It must not turn a search-result snippet or model inference into evidence. Numeric results remain subject to the metric's authority floor, required fields, and PIT checks. If no public page passes those checks, the metric fails closed. Public Web Search never counts as the required non-web fallback.

The frontend table shows configured policy order, not reachability or availability. Runtime acquisition records are the source of truth for whether an attempt succeeded.

## Backend and frontend boundary

- Add a read-only backend query/API that aggregates the explicit Workflow declarations into the table shape. The response may include an internal Workflow identifier for matching and diagnosis, but the requested seven-column table remains unchanged.
- Do not expose a write endpoint for editing source order in this phase.
- The frontend fetches and renders the catalog; it does not choose providers, reach into local files, or perform canonical writes.
- Public web retrieval is an external capability integration behind the application/Plugin boundary. Its implementation must preserve source URLs, retrieval timestamps, extracted values, and validation outcomes.
- Send only the entity, metric, and time constraints needed for public search. Do not forward Knowledge Base source text or an entire private conversation as search context.

## Coverage and configuration validation

Catalog construction validates that:

- each non-industry generic requirement is represented exactly once;
- every `metricId` is globally unique;
- every row has a Chinese meaning, owning Workflow, and capability;
- the default candidate resolves to an implemented operation;
- at least one non-public-web fallback resolves to an implemented operation;
- the second fallback is optional; and
- public web search is the final candidate.

An uncovered metric or unavailable required adapter is reported as **待接入** and is an implementation delivery gap. Do not substitute an invented source or silently count public web search as the required non-web fallback. A catalog/API response must preserve and expose this gap instead of claiming complete coverage.

## Acceptance criteria

- The sidebar contains a Data Sources entry and opens the read-only catalog.
- The table renders the seven requested columns in the requested order and sorts by `metricId`.
- The catalog includes all non-industry generic requirements and excludes industry-research requirements.
- No duplicate `metricId` remains in the catalog or its corresponding runtime requirements.
- The policy shown for a metric is the same policy used by its owning Workflow at runtime.
- Every fully covered metric has a real default source and at least one real non-public-web fallback; second fallback may be empty; public web search is last.
- Gaps are visibly labeled **待接入** and are not reported as usable source coverage.
- Fallback attempts preserve provenance and are accepted only after existing Workflow validation, including numeric authority and PIT checks.
- User cancellation does not trigger another source attempt.
- No source-order editing controls or API are introduced in this phase.

## Implementation note

The repository currently has both explicit source policies and direct adapter calls, and it does not yet have a generic public-web search adapter for this acquisition path. Implementation must inventory every in-scope requirement, reconcile direct calls with Workflow-owned policies, identify real non-web fallback coverage, and implement an attributable public-web integration behind the appropriate external-capability boundary. Any metric without the required executable source chain remains a declared delivery gap; the catalog must not conceal it.
