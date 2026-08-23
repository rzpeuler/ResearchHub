# ResearchHub Harness Integration Validation

## Validation Scope

This document records the minimum ResearchHub integration validation for Phase 2.

The code under `tests/integration/` is **integration validation only**. It is not production implementation, not a financial capability, and not a replacement for the future ResearchHub runtime package layout.

## Locked Harness Version

DeepSeek Harness: **`0.1.1-rc.2`**

The validation dependencies are pinned to `0.1.1-rc.2` to prevent a future Harness upgrade from silently changing the interfaces under test. Any Harness version change requires a new validation review and an explicit decision record.

## Harness Core Extension Mechanism

DeepSeek Harness is built on the Cordis plugin model. A plugin exports a `name`, optionally exports a `Config` schema and `inject` list, and implements `apply(ctx, config)`. A `cordis.yml` composition loads plugin entries by module path or package name. Cordis owns mounting, dependency readiness, lifecycle and disposal; ResearchHub does not implement a second plugin runtime.

The official source reviewed for this validation is `deepseek-ai/deepseek-harness`, version `0.1.1-rc.2` package surface:

- Cordis tutorial: `docs/cordis-tutorial/01-first-plugin.md`
- Configuration: `docs/cordis-tutorial/05-config.md`
- Architecture: `docs/architecture.md`
- Capability seams: `docs/capability-seams.md`
- Agent API: `packages/core/agent/README.md`
- Agent loop: `packages/core/agent-loop/README.md`
- Skill API: `packages/skill/skill/README.md`
- Session API: `packages/core/session/README.md`
- JSONL persistence: `packages/session/session-persistence-jsonl/README.md`

## ResearchHub Mapping

| ResearchHub concept | Harness interface used | Validation implementation |
| --- | --- | --- |
| ResearchHub Extension | Cordis plugin `apply(ctx, config)` | `tests/integration/extension.ts` |
| Research Manager Agent | `ctx.agents.create()` from `dsh-agent-loop` | `tests/integration/packages/agents/research-manager/` |
| Validation Skill | `ctx.skills` through `dsh-skill-filesystem` and model-facing `skill` tool | `tests/integration/packages/skills/validation-skill/SKILL.md` |
| Validation Capability | ResearchHub Cordis service exposed through `ctx.tools.register()` | `tests/integration/packages/capabilities/validation-capability/` |
| Workflow boundary | Agent follow-up and tool-call sequence | `tests/integration/harness-integration.test.ts` |
| Memory / persistence boundary | `ctx.sessions.flush()` and JSONL persistence plugin | Temporary session root created by the test |

Harness does not expose a generic built-in `CapabilityRegistry`. The ResearchHub validation capability therefore remains a ResearchHub-owned service and uses the Harness tool registry as its Agent-facing boundary. It does not access a database or external financial provider.

## Verified Interfaces

The integration test verifies the following live chain:

1. Cordis context and Harness prerequisite services start.
2. ResearchHub Extension mounts its nested plugins.
3. The extension registers a deterministic mock LLM adapter without an API key.
4. `ctx.agents.create()` returns a real Harness `AgentHandle` from `dsh-agent-loop`.
5. The Agent invokes the Harness `skill` tool and loads `validation-skill` from the configured custom skill root.
6. The Agent invokes `researchhub_validation_capability`.
7. The capability confirms the loaded skill and returns:

   ```json
   {
     "status": "success",
     "message": "ResearchHub capability loaded"
   }
   ```

8. The Agent emits a final response and reaches a completed `turn/end`.
9. `ctx.sessions.flush()` causes the JSONL persistence plugin to write the Session event log.

## Session Lifecycle

The validation uses the Harness lifecycle rather than a custom session object:

- Create: `ctx.agents.create()` creates the Agent and its same-identity Session through the AgentLoop factory.
- Execute: `agent.followup()` wakes the Agent; `agent.whenIdle()` waits for the real loop to quiesce.
- Record: Harness appends tool calls, tool results, assistant output and turn boundaries to `agent.session`.
- Persist: `ctx.sessions.flush(agent.session)` is the durability barrier; JSONL persistence writes the event stream.
- Dispose: `handle.dispose()` and Cordis fiber disposal release the Agent and Session resources.

## Not Yet Confirmed

- Production ResearchHub Agent preset composition and per-agent configuration are not frozen by this validation.
- A real DeepSeek model route is not exercised; the test uses a deterministic local adapter to avoid credentials and nondeterministic model output.
- No production financial Capability, external data provider, database, vector store or graph store is implemented.
- Harness Loader execution from an independently installed ResearchHub package is documented by `tests/integration/cordis.yml`, while the test mounts the same plugin composition programmatically so the deterministic adapter and live handles can be asserted directly.
- Harness remains a developer-preview dependency; upgrading beyond `0.1.1-rc.2` requires rerunning and reviewing this validation.

## Validation Boundary

Passing this test proves the architecture mapping is viable for the smallest real Runtime → Extension → Agent → Skill → Capability → Session path. It does not prove production readiness, model quality, financial data correctness, or the completeness of the future ResearchHub application.
