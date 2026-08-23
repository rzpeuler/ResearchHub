# Project Architecture

ResearchHub has one decision and coordination center: `ResearchManager` as
the DSH. The application layers are:

1. DSH — request understanding, Workflow selection, Skill/Plugin invocation,
   and result integration.
2. Workflow — standard process definitions, dependencies, schemas, and
   verification nodes.
3. Skill — professional research methods, analysis, and Artifact generation.
4. Plugin — external resource connection, normalization, and validation.

Workflow is not Planner. Skill is not Workflow. Plugin is not Skill.

The Harness owns its own runtime lifecycle. ResearchHub reuses that lifecycle
and does not introduce a parallel engine. Artifact core models remain stable.
