# Development Rules

1. Keep ResearchManager as the only DSH planning and coordination center.
2. Keep Workflow declarative and separate from research methodology.
3. Keep Skill logic independent from external protocols and credentials.
4. Keep Plugin logic independent from research conclusions and scheduling.
5. Do not add a parallel runtime, scheduler, or workflow engine.
6. Do not modify Artifact core models without a separate architecture decision.
7. New external data access must be a typed Plugin with deterministic tests.
8. Every change must run the relevant focused tests and the full validation
   command before commit.
