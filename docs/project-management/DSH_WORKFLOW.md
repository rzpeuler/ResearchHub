# DSH Development Workflow

1. Read the current Research Output, Knowledge Layer, and status documents.
2. Classify the requested change as ResearchManager coordination, Workflow,
   Skill, Plugin, Research Output, or Knowledge infrastructure.
3. Define the boundary and its tests before implementation.
4. Keep runtime execution and LLM reasoning in DeepSeek Harness.
5. Keep external access in Plugins and research methodology in Skills.
6. Treat Memory and Evaluation as compatibility paths only. Keep new durable
   knowledge under `knowledge/`, and new reports, objects, and provenance
   under `research-output/`.
7. Run TypeScript compilation, focused tests, and `npm test` for code changes.
8. Update the decision log or ADR when a boundary changes.
