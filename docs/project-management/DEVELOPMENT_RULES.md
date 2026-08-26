# Development Rules

1. Keep ResearchManager as the only ResearchHub DSH coordination center.
2. Treat DeepSeek Harness as the owner of Agent, Tool, Session, loading, and
   LLM runtime services; do not modify Harness Core.
3. Keep Workflow declarative and separate from research methodology. Workflow
   is an SOP and owns Knowledge ingestion/update orchestration, not a Planner
   or Workflow Engine.
4. Keep Skill logic focused on professional research methods and structured
   Research Output generation. Skill is not a runtime or data-access layer.
5. Keep Plugin logic focused on external connections, tools, conversion, and
   validation. Plugin is not a Skill or research method.
6. ResearchHub Source owns Knowledge Schema, Adapter, Validation, Migration,
   Curation, Write, and access infrastructure. These capabilities remain
   runtime-neutral and are reusable by another Runtime.
7. Real user Knowledge Base instances are Runtime Data. They must not be
   placed under the ResearchHub source repository by default.
8. Every Knowledge read/write operation must resolve an explicit
   `KnowledgeBaseHandle` or equivalent scoped context. There is no implicit
   global production Knowledge directory.
9. A Knowledge Base is not an Agent. Knowledge Base lifecycle includes mount,
   load, read, ingest, update, validate, migrate, archive, and inspect.
10. Curation may use explicitly invoked research reasoning but must not persist
    Knowledge directly. Access and Validation remain deterministic.
11. Write is deterministic and accepts only validated changes. Mount and
    ingestion must never silently migrate a Knowledge Base.
12. Breaking Schema changes require compatibility analysis and explicit
    Migration design. Schema Version and Storage Format Version evolve
    independently; there is no automatic Schema evolution.
13. Preserve the provenance chain `Knowledge -> Source -> Raw` for durable
    Knowledge created from research material.
14. Do not add a Capability Layer, Provider Layer, Agent Planner, Workflow
    Composition Layer, Workflow Engine, Multi-Agent architecture, Knowledge
    Agent, Graph DB, Vector DB, RAG, or autonomous Knowledge formation without
    a separate architecture decision.
15. Treat Artifact as a compatibility technical term; use the Research Object
    envelope for new public output contracts. Do not modify Artifact core
    models without a separate architecture decision.
16. Packages remain runtime-neutral and must not depend on `dsh/`. Research
    Output and Knowledge interfaces must remain usable by other runtimes.
17. Every change must run relevant focused validation and the default full
    validation command before commit.
18. Engineering Agent may mark an implementation task Status as Completed
    after implementation, validation, commit, and push. Engineering Agent
    must not self-mark Sol/CTO Acceptance as Accepted. Acceptance remains
    Review Pending / Sol Verification until Sol independently reviews the
    GitHub commit and explicitly passes the task. A later governance update may
    record Accepted only after that Sol PASS.
