---
name: equity-research
description: Build an evidence-backed equity research coverage package covering business quality, industry position, competitive advantage, financial quality, growth drivers, risks, and thesis formation.
---

# Equity Research Skill

This Skill produces a structured coverage package for a listed company. It
adapts the institutional initiation method from the financial research
reference while keeping the asset independent from any runtime.

## Method

1. Business understanding
2. Industry position and value chain
3. Competitive advantage and weakening conditions
4. Financial quality and capital allocation
5. Growth mechanisms and validation metrics
6. Risk analysis
7. Evidence-linked thesis and open questions

The Skill calls only injected Market, Financial, and Information Plugin ports.
It does not import DSH, ResearchManager, Claude, MCP, slash commands, or
provider-specific orchestration.

## Output

The output follows `schemas/output.yaml` and `templates/report.md`. It
contains structured sections, evidence references, thesis drivers, key risks,
and open questions. It is not an investment recommendation.
