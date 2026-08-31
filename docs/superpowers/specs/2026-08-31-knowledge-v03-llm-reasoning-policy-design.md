# Knowledge v0.3 Curation LLM Reasoning Policy

## Context

C-006 measured the real `deepseek-v4-pro` execution envelope. The current
Knowledge Curation adapter omitted `reasoningEffort`, which caused the
provider-resolved default `high` policy. The exact `understandReport` request
emitted sustained reasoning and did not finish within the controlled window;
the same request with `reasoningEffort=off` completed and passed strict v0.3
validation. The resolved model supports `off`, `low`, `high`, and `max`.

## Goal

Make the Knowledge Curation reasoning policy explicit and operation-specific at
the existing DSH runtime boundary:

| Operation | Reasoning effort |
| --- | --- |
| `understandReport` | `off` |
| `extractKnowledge` | `off` |
| `reconcileKnowledge` | `low` |
| `analyzeSchemaGaps` | `low` |

No operation may depend implicitly on the provider default.

## Design

Add one exhaustive typed mapping in
`dsh/llm-runtime/knowledge-curation-model-adapter.ts`, typed against the
active four-operation union and the DSH `ReasoningEffortId`. Set
`GenerateOptions.reasoningEffort` from that mapping for every request.

The mapping remains local to the adapter because reasoning is runtime policy,
while the Skill owns operation meaning, Schema Context, and Structured Output
Contract. No reasoning field is added to Knowledge Curation request types,
Schema Context, output contracts, Workflow inputs, or Knowledge Schema.

Existing provider, model, message construction, temperature, and
`maxTokens=65536` behavior remain unchanged. The adapter continues to pass
Schema Context and Output Contract, reject missing contracts, preserve strict
output validation, avoid normalization, and make no retry.

## Testing

Extend the existing adapter tests to capture `GenerateOptions` for all four
operations and assert the exact mapping. Retain tests for contract propagation,
fail-fast missing contracts, malformed JSON rejection, and one-call behavior.
Extend the deterministic Skill-to-Adapter boundary test to verify
`understandReport -> off` and, where useful, `reconcileKnowledge -> low`.
Add coverage that every active operation resolves to a defined effort.

Run the required Curation, Ingestion, Workflow/DSH Adapter, Knowledge,
Runtime/Dependency, Product Validation, and TypeScript integration suites.

## Scope and non-goals

Allowed production change: only
`dsh/llm-runtime/knowledge-curation-model-adapter.ts`.

Allowed tests and compatibility updates remain limited to the C-007 task
scope. No changes are made to Schema, Validator, Workflow semantics, Writer,
Migration, Access, input projection, generation budget, retry policy, output
normalization, environment configuration, or new runtime architecture layers.

The measured model-visible input bloat remains technical debt and is not part
of C-007. `maxTokens=65536` remains unchanged pending separate evidence.

## Acceptance

- Every Knowledge Curation `GenerateOptions` contains an explicit
  `reasoningEffort`.
- The four values exactly match the table above.
- The Skill remains runtime-neutral.
- Existing contract and strict-validation behavior remains green.
- No forbidden production surface changes are present.
- Governance records C6 as accepted, C7 as Sol-verification pending, and Stage
  C as awaiting C7 verification.
