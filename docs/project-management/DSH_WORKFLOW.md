# DSH Development Workflow

1. Read Architecture v0.3 and the current status documents.
2. Classify the requested change as ResearchManager coordination, Workflow,
   Skill, Plugin, Memory, or Evaluation.
3. Define the boundary and its tests before implementation.
4. Keep runtime execution and LLM reasoning in DeepSeek Harness.
5. Keep external access in Plugins and research methodology in Skills.
6. Keep Memory focused on research history and Evaluation focused on review.
7. Run TypeScript compilation, focused tests, and `npm test` for code changes.
8. Update the decision log or ADR when a boundary changes.
