# Knowledge Schema 0.4 / Research State v1 Design

Date: 2026-09-18
Status: approved execution baseline; implemented and acceptance-verified

## Context and boundaries

ResearchHub already has a file-backed Knowledge Base, an explicit
Knowledge Production Gateway, validated ChangeSets, an atomic Writer, durable
ReviewCases, and a partially extended Schema 0.4. The mission completes the
missing v0.4 semantic surface without introducing a second storage system,
custom Agent Runtime, generic Provider layer, planner, new workflow engine,
database, or broad Skill/Workflow rewrite.

Workflow remains deterministic execution control; Skill remains research
methodology; Plugin remains external capability integration; Knowledge remains
governed durable state. Agent, Skill, and Workflow code may emit proposals but
may not allocate canonical IDs or write canonical files directly.

## Canonical semantic model

Schema 0.3 remains a readable legacy/compatibility input. Schema 0.4 is the
only new canonical authority and is identified explicitly by its manifest
version. The four logical layers share the existing file persistence model:

- world: ThemeGroup, Entity, Relation, Event;
- observations: Source, RawRef, MetricObservation, EstimateObservation,
  ConsensusObservation;
- research: Claim, Thesis, ReasoningEdge;
- governance: ReviewCase, ChangeSet, Revision and provenance.

Entity gains person, institution, and security support while keeping Company
distinct from Security. ExternalIdentifier is typed and time-aware. Relation
remains for durable state; Event represents something that happened. Claim
expresses a research assertion, Thesis is a durable conclusion, and
ReasoningEdge stores only public, auditable research dependencies.

Observation variants are typed contracts, not provider JSON containers. Metric
observations reference a Metric Registry entry and a Source; estimates carry
fiscal period, institution/analyst and publication time; consensus carries
its contributing observation references and point-in-time `asOf`.

## Production flow

The production contract accepts local proposal keys for every new canonical
kind. The Gateway validates proposal shape, source/raw bindings, temporal and
reference integrity, rights, endpoint constraints, and deterministic identity.
It resolves equivalent, superseding, contradictory, and ambiguous proposals,
creates a ReviewCase for unresolved ambiguity, emits one validated ChangeSet,
and sends that ChangeSet through the existing atomic, revision-aware Writer.
Replay uses the same deterministic identities and produces no duplicate
objects or revision for identical input.

`derivativeKnowledgeAllowed = false` is a hard production rejection for
derived canonical objects; it must never degrade into a warning or silent
write. Raw preservation remains governed separately by Source rights.

## Storage and compatibility

The current manifest and per-kind directory model is retained. New v0.4 kinds
receive explicit namespaces and safe path allocation. The v0.3 loader remains
available and is never interpreted as v0.4 without version validation.

Migration is a separate deterministic capability with dry-run and apply modes.
Apply requires an explicit empty destination, validates the converted
projection before writing, preserves unknown fields, copies raw state, and
records source identity/revision so an identical re-run returns
`already_applied`. It never mutates a real user corpus implicitly. Migration
tests use sanitized fixtures and verify key IDs, raw/source provenance, reload,
and replay idempotency.

## Query, bundle, and review integration

The existing read path gains kind-aware search, object lookup, subject lookup,
reference traversal, and a bounded `getKnowledgeAsOf` helper based on valid
and system-time fields. ResearchBundle carries new object references and
proposal projections without duplicating domain types. Graph remains an
Entity/Relation topology projection; inspectors and read APIs expose Event,
Observation, Claim, Thesis, ReasoningEdge, and Source details. Ambiguous or
conflicting new proposals route to durable ReviewCases.

## Required vertical slice and acceptance

Fixture-backed Earnings Review is the one end-to-end semantic slice. It
creates/reuses Company and Security identity, an earnings Event, actual
MetricObservations, optional estimates and consensus, a research Claim, a
Thesis impact, and constrained ReasoningEdges, then executes Proposal →
ChangeSet → Writer → reload → Query.

`acceptance:knowledge-v04` exercises K1–K10, records real IDs, revisions,
hashes, diagnostics, migration results, and reload results in a deterministic
JSON artifact. It does not claim external authenticated E2E or real-user-KB
migration. Existing Unified Research A–G, Closure C1–C7, Final Fix F1–F7,
Node/client tests, typechecks, and client build remain required regression
gates.

## Error handling and bounded limitations

Malformed references, unsupported endpoints, invalid dates, rights denials,
stale revisions, hash mismatches, and unsafe storage paths fail closed with
deterministic diagnostics. The initial point-in-time helper is bounded to
stored temporal fields and does not claim to be a database bitemporal engine.
Provider-specific metadata is retained only in controlled fields; missing
provider capabilities produce explicit unavailable evidence, never fabricated
observations.
