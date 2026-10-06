# Unified Research Entry, ResearchBundle, Source Library, and Extensible Skills

**Status:** Design checkpoint  
**Date:** 2026-09-17  
**Scope:** ResearchHub unified research mission

## 1. Purpose and boundaries

The homepage Chat composer becomes the primary ordinary research entry while
the existing `/run` surface remains the Workflow Console for exact, expert,
and reproducible launches. The change connects existing Workflow, Skill,
Knowledge, Raw, Report, and Pi application boundaries through a small
application-level dispatch seam.

This design does not introduce a custom Agent Runtime, Planner Layer,
Composition Framework, generic provider/capability layer, Graph DB, vector
service, Pi RPC process, or direct frontend/canonical-file mutation. Workflow
continues to own deterministic execution control; Skills continue to own
professional methodology; Plugins continue to own external capabilities; and
Knowledge Gateway/ChangeSet/Writer remains the only canonical mutation path.

The mission is implemented as serial slices, but the acceptance bar is the
complete integrated product rather than any individual slice.

## 2. Design alternatives

### Recommended: thin dispatch seam

Add typed request and decision contracts, authoritative registries, and
adapters around the existing application services. A `ResearchDispatchService`
validates policy, resolves explicit or free intent, extracts arguments, and
starts the selected existing workflow. This minimizes regression risk and
keeps semantic domain logic in the current workflows and skills.

### Workflow-first rewrite

Require all current workflows to be rewritten behind a new common runner before
adding Chat dispatch. This could produce more uniform internals, but would
unnecessarily disturb accepted evidence, persistence, replay, and real-Pi
paths. It is not selected.

### Agent/tool orchestration

Let Pi infer the workflow and policies from prompts and call the existing tools.
This is small initially, but it cannot prove explicit policy enforcement,
bounded schema validation, or the absence of a second LLM report-to-Knowledge
pass. It is not selected as the product boundary.

## 3. Contracts and registries

### 3.1 ResearchRequest

The Chat/API boundary accepts a typed request with the following semantics:

```ts
interface ResearchRequest {
  query: string
  mode: { type: 'free_research' } | { type: 'workflow'; workflowId: string }
  contextPolicy: {
    structuredKnowledge: boolean
    sourceLibrary: boolean
  }
  persistencePolicy: {
    writeKnowledge: boolean
  }
  attachments?: readonly string[]
}
```

The concrete module and naming may follow repository conventions, but these
semantics are binding. Defaults are structured Knowledge on, Source Library on,
and Knowledge write off. The server validates the object and preserves every
explicit user policy; policy values are never inferred from a model response.

### 3.2 ResearchDispatchDecision v1

The resolver returns a strict, schema-validated decision containing:

```ts
interface ResearchDispatchDecision {
  mode: 'workflow' | 'skill_plan' | 'free_research'
  workflow?: {
    id: string
    confidence: number
    arguments: Record<string, unknown>
  }
  skills: readonly { id: string; purpose: string }[]
  entities: readonly { type: string; value: string; confidence: number }[]
  missingRequiredInputs: readonly string[]
  contextPolicy: ResearchRequest['contextPolicy']
  persistencePolicy: ResearchRequest['persistencePolicy']
  rationale: string
}
```

Invalid structured output is rejected or repaired at most within a bounded
deterministic retry contract. The resolver never executes an unvalidated
decision. An explicit Workflow request bypasses workflow selection: it only
performs argument extraction, schema validation, and required-input handling.

Free Research resolution follows this order:

1. suitable enabled Workflow Definition;
2. enabled ResearchHub Skill with `kind: 'research'`;
3. free research with available tools.

If required input is genuinely missing or ambiguous, the decision reports it
and the application asks only for those fields. It does not ask the user to
re-enter fields reliably extracted from the request or deterministically
resolved from Knowledge/mappings.

### 3.3 Workflow Definition Registry

Each user-facing executable Workflow exposes one authoritative definition:

```ts
interface WorkflowDefinition {
  id: string
  label: string
  intentDescription: string
  inputSchema: unknown
  requiredInputs: readonly string[]
  outputContract: string
  knowledgeEffects: readonly string[]
}
```

The registry is the source for Chat selector options, resolver context,
argument extraction targets, and launch adapters. It includes the current
Company Research, Industry Research, Earnings Review, Valuation, Event
Research, Thesis Red Team, and applicable Daily Intelligence definitions.
Adding a conforming Workflow updates selector/resolver discovery without a
second frontend list. Existing service methods remain the domain execution
implementation.

### 3.4 Research Skill Registry

ResearchHub Skills under `/skills/` receive minimal metadata/definition:

```ts
interface ResearchSkillDefinition {
  id: string
  kind: 'research' | 'knowledge' | 'utility'
  researchCapability?: string
  intentDescription: string
  whenToUse: string
  inputSchema?: unknown
  outputContract?: string
  enabled: boolean
}
```

Core research skills are classified and self-described. Knowledge curation is
`knowledge`; helpers are `utility`. `.pi/skills/` is a separate Pi-native
scope and is not scanned into the ResearchHub registry. Free Research filters
candidate skills by `enabled && kind === 'research'`.

## 4. Dispatch and execution flow

The application flow is:

```text
Chat controls
  -> ResearchRequest validation
  -> explicit argument extraction OR free dispatch resolution
  -> Workflow/Skill schema validation
  -> policy-bound source/Knowledge context
  -> existing Workflow or Skill adapter
  -> ResearchBundle
  -> structured report + Knowledge Proposal
  -> optional governed Knowledge Gateway path
```

`ResearchDispatchService` is application-level routing only. It does not plan
multi-agent work, own semantic methodology, or replace Workflow execution
control. It produces a user-visible execution summary containing mode,
selected Workflow/Skills, extracted-argument status, context policies,
persistence policy, and bounded status/error information. It never exposes
chain-of-thought.

Source retrieval is unavailable to the execution adapter when
`sourceLibrary` is false. Structured Knowledge reads are similarly bounded by
`structuredKnowledge`. The policies are carried to every downstream adapter
so they cannot be accidentally re-enabled by a prompt or Workflow switch.

## 5. ResearchBundle and derivation

Existing workflow outputs are wrapped or adapted to a common structured result:

```ts
interface ResearchBundle {
  researchRunId: string
  workflowId?: string
  subject: unknown
  asOf: string
  evidence: readonly unknown[]
  entities: readonly unknown[]
  relations: readonly unknown[]
  claims: readonly unknown[]
  theses: readonly unknown[]
  risks: readonly unknown[]
  catalysts: readonly unknown[]
  researchGaps: readonly unknown[]
  provenance: readonly unknown[]
  reportModel: unknown
  knowledgeProposals: readonly unknown[]
}
```

The exact domain types are reused from existing workflow contracts where
possible. Evidence, claims, relations, theses, gaps, and their provenance are
retained in the bundle. A structured Human Report model and Knowledge Proposal
are both derived from this bundle. Markdown is an export/persistence artifact,
not the semantic interchange protocol; no standard path invokes a second LLM
to reconstruct Knowledge from Markdown.

Write Knowledge semantics are explicit:

- Write off: persist the bundle/report and Knowledge Proposal; do not call
  Gateway, ChangeSet, or Writer; canonical content and revision remain
  unchanged.
- Write on: pass proposals through the existing Gateway, validation,
  resolution/ChangeSet, Writer, reload, and validation sequence. No direct
  canonical mutation is permitted.

Proposals remain durable enough for a later governed commit without rerunning
the main semantic research operation.

## 6. Source Library

The current Raw store remains the sole original-document source. The Source
Library is a rebuildable derived local index over normalized Raw content:

```text
Raw document
  -> normalized text
  -> deterministic chunks
  -> local lexical index
  -> policy-bound retrieval
  -> evidence candidates
```

Each chunk stores or resolves `rawRef`, `sourceRef`, document identity,
page/section/span when available, `contentHash`, parser version, chunker
version, and source metadata. A local full-text/lexical implementation is the
initial index; embeddings and external vector services are out of scope.

Index deletion/rebuild affects only derived files. Retrieval returns provenance
preserving candidates and never writes canonical Knowledge directly. Retrieval
is tested both enabled and disabled through the ResearchRequest policy.

## 7. External Skill onboarding

The onboarding boundary accepts a GitHub URL or test-fixture source and runs:

```text
inspect -> identify format -> inspect dependencies and permissions
       -> read license/source metadata -> classify -> compatibility decision
       -> install/adapt -> register -> validate
```

The persisted manifest records stable source repository, resolved commit,
license, kind, permissions (network, shell, filesystem write, credentials),
native/adapted integration, and enabled state. It never tracks an unpinned
upstream HEAD.

Pi-native compatible assets stay in Pi Skill scope. ResearchHub research
assets receive only the minimum adapter/metadata needed for `/skills/` and can
enter Free Research discovery after validation. Knowledge and utility assets
remain out of the Research Skill candidate pool. Assets requiring credentials,
unrestricted shell, project-external writes, unknown binaries, or high-risk
dependencies fail closed or stop at an explicit approval boundary.

Tests use harmless fixtures, mocks, or public sample repositories and do not
require a real third-party account.

## 8. Frontend and API

The homepage composer adds a registry-backed Workflow selector and three
policy controls:

```text
Workflow [ Free Research ]
Query Knowledge       on by default
Search Source Library on by default
Write Knowledge       off by default
```

Submitting Chat launches the typed request through the runtime application
boundary. The UI shows a compact execution summary and bounded missing-input or
failure state. The existing Chat streaming, steering, follow-up, stop,
attachments, and conversation behavior remains intact.

The `/run` route remains available and is labelled/presented as Workflow
Console / Advanced Research. It continues to expose precise existing launch
parameters and polling. Existing Reports, Daily Briefs, Knowledge, Graph,
Reviews, and attachment flows remain available.

## 9. Testing and acceptance

Tests are added at each boundary and must include:

- request defaults, explicit policy preservation, explicit workflow precedence,
  schema validation, missing-input handling, resolver priority, and bounded
  invalid-output repair;
- authoritative Workflow and Skill registry discovery and scope separation;
- natural-language extraction for company, period, industry, valuation, event,
  and thesis inputs;
- bundle conformity, provenance retention, shared report/proposal derivation,
  Write OFF immutability, and Write ON Gateway/Writer/reload authority;
- Raw reuse, deterministic indexing, rebuild, retrieval provenance, and policy
  denial;
- external Skill classification, pinned provenance, permission checks, unsafe
  refusal/approval, and research-only discovery;
- frontend selector, toggles, summary, Chat launch, Console usability, and
  regression coverage for existing routes;
- realistic A–G E2E cases from the mission, with runtime artifacts proving
  report/proposal/canonical/retrieval/onboarding behavior rather than fixture
  success presented as authenticated production E2E.

Repository-defined full checks remain authoritative: `npm test`,
`npm run typecheck`, `npm run client:typecheck`, `npm run client:build`, plus
focused and applicable parser/E2E validations.

## 10. Implementation slices

1. Add contracts, registries, metadata, adapters, and deterministic dispatch
   tests.
2. Connect Chat request submission, selector, policy controls, summaries, and
   explicit/free routing.
3. Add ResearchBundle/report/proposal adapters and enforce Write OFF/ON.
4. Build Source Library indexing/retrieval over existing Raw storage.
5. Add external Skill inspection/classification/provenance/security and
   Research Skill registration.
6. Run full regression/E2E acceptance, update current documentation and state,
   review the diff, commit coherent milestones, and verify remote state.

Each slice must be reviewed against the complete mission criteria; a passing
slice, test run, commit, or push is not mission completion.

## 11. Bounded external limitations

Provider availability, authenticated real-Pi execution, and external GitHub
network conditions may affect live evidence. Such limitations must be reported
with concrete artifacts and must not be hidden by synthetic fallback. They do
not excuse missing local contracts, policy enforcement, deterministic tests,
fixture-based onboarding coverage, or governed persistence behavior.
