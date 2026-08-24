# LLM Runtime Validation Design

**Task:** LLM-RUNTIME-VALIDATION-001
**Status:** Proposed for review
**Date:** 2026-08-24

## 1. Goal

Validate the existing Equity Research Workflow with real LLM-backed Skill
Adapters while keeping Workflow design, Skill definitions, Plugin interfaces,
and Artifact schemas unchanged.

The runtime path is:

`ResearchManager → Equity Research Workflow → LLM Skill Adapter → Harness LlmRuntime → Provider Adapter → structured Skill output → Artifacts → Evaluation`

## 2. Boundary decision

The LLM Skill Adapter is runtime-specific code under `dsh/llm-runtime/`. It
receives an injected Harness `LlmRuntime` stream function, loads an existing
Skill prompt file, sends a typed request, parses JSON, validates the response,
and returns the existing Skill output contract.

The Adapter does not select Workflows or Skills, generate new prompts, access
Plugins, plan tasks, or create an Agent layer. The Workflow continues to own
step order and context transfer.

The test-only Provider Adapter registers with Harness `ctx.llm` and translates
the provider-neutral `GenerateOptions` into a DeepSeek-compatible HTTP request.
It is infrastructure for runtime validation, not a ResearchHub architecture
layer or a replacement for Harness Core.

## 3. LLM request and response contract

Each call contains:

- Skill ID;
- prompt loaded from `packages/skills/<skill>/prompts/analysis.md`;
- serialized Skill input;
- prior Workflow context summary;
- a strict JSON-output instruction;
- provider and model selected by runtime configuration.

The model must return a JSON envelope containing `skillId`, `subject`, `asOf`,
`summary`, `findings`, `keyRisks`, `openQuestions`, and `evidence`. The Adapter
rejects malformed JSON, mismatched Skill IDs, missing required fields,
non-finite confidence values, and evidence without source/as-of metadata.

The Adapter maps the validated envelope into the existing typed Skill result
shape. For Company Research it creates the existing Evidence, Thesis, and
Prediction Artifacts using the unchanged Artifact constructors. For the other
Skills it creates the existing runtime-neutral report results. No Skill source
definition or Plugin contract is modified.

## 4. Real Provider validation

The runtime test mounts the existing Harness prerequisites, registers the
Provider Adapter with `ctx.llm`, constructs the existing Equity Research
Workflow and ResearchManager, and executes a public-company request.

Configuration comes from:

- `DEEPSEEK_API_KEY` — required for the real call;
- `DEEPSEEK_BASE_URL` — optional, defaulting to the DeepSeek API endpoint;
- `DEEPSEEK_MODEL` — optional, defaulting to `deepseek-chat`;
- `RESEARCHHUB_RUN_REAL_LLM` — explicit opt-in switch.

The real test is excluded from default `npm test` and runs through a separate
`npm run test:runtime` command. Without explicit opt-in or credentials, it is
reported as skipped with a clear reason. It must never claim a real call
succeeded when the call did not occur.

## 5. Validation assertions

The runtime validation must prove:

- a real Provider Adapter request passed through Harness `LlmRuntime.stream()`;
- all five Workflow Skill Adapter calls received the correct prompt and
  context;
- every LLM response passed the Skill output schema validation;
- the Workflow completed with six completed step states;
- Evidence, Thesis, Prediction, and ResearchReport were generated;
- core Artifacts round-trip through serialization;
- Evaluation can produce a Review from the LLM-generated Prediction;
- no Skill source imports DSH and no Workflow source imports Plugin runtime
  implementation.

## 6. Failure handling and safety

Provider HTTP failures, empty responses, invalid JSON, schema mismatches, and
wrong Skill IDs become typed Adapter errors. Secrets are read from process
environment only, never logged, persisted, or included in Artifact content.
The runtime test uses bounded request and output limits and does not retry at
the ResearchHub Adapter layer; provider retry behavior remains Harness-owned.

Default deterministic tests remain network-free. Real runtime validation is
explicit, separately reportable, and dependent on provider availability,
credentials, model access, response quality, and API cost.

## 7. Non-goals

- no change to Workflow structure;
- no change to Skill definitions or business logic;
- no change to Plugin interfaces or adapters;
- no change to Artifact core schemas;
- no Agent Planner, Capability Layer, Provider Layer, or Workflow Engine;
- no automatic prompt generation or autonomous strategy optimization.
