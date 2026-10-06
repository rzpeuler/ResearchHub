# ResearchHub — Direct Codex Guide

Codex is the repository engineering owner: interpret the requested change,
inspect the current checkout, implement within scope, run validation, and
report the factual result. Preserve unrelated working-tree changes and stop
for unresolved product, architecture, security, or data-loss decisions.

ResearchHub is the Agent-first investment research application. It is focused on
Free Research, Knowledge Query, Knowledge Production, provenance, validation,
and canonical persistence.

Before changing code, inspect the current Git state, the approved task, and the
relevant documents under docs/architecture/ and docs/engineering/. Use source,
tests, package scripts, and current runtime behavior as the evidence for
implementation decisions.

## Current architecture context

The following points describe the current repository architecture and product
boundaries.

- Do not build a custom Agent Runtime.
- Do not introduce DeepSeek Harness / DSH dependencies.
- Workflow owns deterministic execution control and routing.
- Skill owns professional semantic methodology.
- Plugin owns external capability integration, including Pi-specific reasoning-host integration.
- Pi Coding Agent is the canonical application host; Agent-host portability is not a product requirement.
- ReasoningExecutor is the Workflow semantic-operation boundary and deterministic testing seam, not host-portability architecture.
- Pi-specific application integration belongs under app/pi/; business semantics remain under Workflow, Skill, Plugin, and Knowledge.
- Application Runtime v0.1 is implemented and accepted; use the approved task and architecture revision set to determine the architecture scope that is binding for new work.
- Runtime v0.1 is local-first with one Node process, direct Pi SDK embedding, React + TypeScript + Vite, HTTP JSON + SSE, and no WebSocket.
- Do not introduce Pi RPC subprocess integration, direct browser filesystem/Knowledge access, arbitrary frontend canonical writes, or Next.js as the backend runtime.
- Canonical Knowledge mutation is allowed only through the ResearchHub Knowledge Production path, validated ChangeSet, and Writer.
- Pi Agent Skills under .pi/skills/ and ResearchHub Skills under skills/ are distinct; their contexts must not be conflated.
- Knowledge Base runtime data is not source code.
- Do not use this guide as Knowledge Schema-version authority; use the mounted Knowledge Base contract and the approved task context.
- Do not revive fixed chunk → batch → extraction as the current ingestion architecture.
- Do not port the original monolithic ingestion workflow.ts wholesale.

Engineering completion must be reviewed against the repository state, the
approved task, and the applicable architecture documents.

## Codex engineering delegation

For work in this repository, the primary agent owns requirements analysis,
product and architecture decisions, task planning, scope control, and final
acceptance. Use subagents for bounded implementation, debugging, test
execution, or test repair when that work can be delegated independently.

The primary agent should give the subagent a concrete task, relevant contracts,
allowed files, and validation expectations. The primary agent reviews the
resulting diff and test evidence, resolves scope or architecture questions, and
owns the final user-facing report and Git delivery. If implementation reveals
an unresolved product, architecture, security, or data-loss decision, return
that decision to the primary agent before continuing.

Do not spawn a subagent for a read-only explanation or another task with no
engineering execution. If subagents or the requested model are unavailable,
report that limitation instead of silently claiming the preferred split was
used. Explicit user instructions for a particular task take precedence over
these defaults.
