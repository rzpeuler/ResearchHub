# ResearchHub — Wave 5 Architecture State

Date: 2026-09-22  
Task: `RHL-W5-001`  
Status: IMPLEMENTED / SOL ACCEPTANCE PENDING

The active canonical Research Skill catalog contains 26 entries: 22
`IMPLEMENTED`, 0 `PARTIAL`, and 4 `PLANNED`. The reduction from the previous
29-entry catalog is an ownership correction, not a capability deletion:
evidence normalization remains acquisition/shared infrastructure, valuation
cross-check remains inside Valuation Workflow composition, and `research_qc` is
represented by the reusable Workflow-layer `ResearchQualityGate`.

Wave 5 adds independently executable `comps_valuation`, registers its semantic
runtime binding, and routes direct comparable-valuation requests without
colliding with reverse DCF or growth-analysis intents. It also adds explicit
quality-gate and cross-check result contracts to the affected workflows.

The remaining planned roadmap is document change analysis, earnings call
analysis, financial model build/update, and model audit. No Agent Runtime,
Planner, generic Provider layer, Knowledge Schema, or UI redesign was added.

Fixture/unit validation is in scope. Authenticated provider E2E remains pending
until Sol performs the external-account acceptance pass.
