# Development Rules

1. Keep ResearchManager as the only ResearchHub DSH coordination center.
2. Treat DeepSeek Harness as the owner of Agent, Tool, Session, loading, and
   LLM runtime services; do not modify Harness Core.
3. Keep Workflow declarative and separate from research methodology; Workflow
   is a research SOP, not a Planner or Workflow Engine.
4. Keep Skill logic focused on professional research methods and structured
   Research Output generation; Skill is not a Workflow or runtime.
5. Keep Plugin logic focused on external connections, tools, conversion, and
   validation; Plugin is not a Skill or research method.
6. Treat `research-output/` as the output boundary and `knowledge/` as the
   future durable knowledge boundary. Retain `packages/memory/` and
   `packages/evaluation/` only for compatibility; do not expand them as new
   product layers.
7. Do not add a Capability Layer, Provider Layer, Agent Planner, Workflow
   Composition Layer, Workflow Engine, Multi-Agent architecture, autonomous
   memory loop, prediction-evaluation product layer, or knowledge agent.
8. Treat Artifact as a compatibility technical term; use the Research Object
   envelope for new public output contracts. Do not modify Artifact core
   models without a separate architecture decision.
9. New external data access must be a typed Plugin with deterministic tests.
10. Knowledge work must remain runtime-neutral and must not introduce graph
    storage, RAG, extraction, or automatic formation without a separate
    architecture decision.
11. Every change must run the relevant focused tests and the full validation
    command before commit.
