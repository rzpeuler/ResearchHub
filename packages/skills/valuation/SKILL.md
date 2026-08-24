---
name: valuation
description: Combine comparable-company benchmarking and DCF valuation with explicit assumptions, sensitivity analysis, cross-checks, and valuation risks.
---

# Valuation Skill

This Skill adapts the comparable-company and DCF methods into a structured,
runtime-neutral valuation asset. It keeps formulas and assumptions explicit,
uses peer medians to benchmark forecasts, and never turns a model output into
an autonomous investment decision.

## Method

1. Select comparable companies by business model, scale, geography, and sector.
2. Calculate operating and valuation statistics: min, 25th percentile, median,
   75th percentile, and max.
3. Discount forecast free cash flow using WACC and calculate terminal value.
4. Run WACC/terminal-growth sensitivity analysis.
5. Cross-check implied multiples, terminal-value concentration, and forecast
   assumptions against the peer set.
6. Record risks and unresolved assumptions.

Peer and market data arrive through injected Plugin ports. The Skill does not
depend on DSH, ResearchManager, Claude, MCP, slash commands, or Excel runtime.
