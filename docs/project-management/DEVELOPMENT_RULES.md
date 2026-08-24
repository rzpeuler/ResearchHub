# Development Rules

1. Keep ResearchManager as the only ResearchHub DSH coordination center.
2. Treat DeepSeek Harness as the owner of Agent, Tool, Session, loading, and
   LLM runtime services; do not modify Harness Core.
3. Keep Workflow declarative and separate from research methodology; Workflow
   is a research SOP, not a Planner or Workflow Engine.
4. Keep Skill logic focused on professional research methods and Artifact
   generation; Skill is not a Workflow or runtime.
5. Keep Plugin logic focused on external connections, tools, conversion, and
   validation; Plugin is not a Skill or research method.
6. Keep Memory focused on structured research history and Evaluation focused
   on validation and review.
7. Do not add a Capability Layer, Provider Layer, Agent Planner, Workflow
   Composition Layer, Workflow Engine, Multi-Agent architecture, or
   autonomous memory loop.
8. Do not modify Artifact core models without a separate architecture
   decision.
9. New external data access must be a typed Plugin with deterministic tests.
10. Every change must run the relevant focused tests and the full validation
    command before commit.
