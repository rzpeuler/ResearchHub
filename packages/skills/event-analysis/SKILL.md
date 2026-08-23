---
name: event-analysis
description: Build a neutral, structured research artifact bundle from market and company-news evidence.
---

# Event Analysis Skill

## Purpose

Organize an event-oriented research pass for one stock symbol. This skill is an integration-validation and research workflow layer: it coordinates capabilities and produces structured research artifacts. It does not collect data directly, make investment decisions, or issue trades.

## Required capabilities

- `get_market_snapshot(symbol)`
- `search_company_news(symbol)`

## Execution steps

1. Accept a stock symbol and evaluation period.
2. Collect a market snapshot as market evidence.
3. Collect company news as news evidence.
4. Organize the evidence for neutral cause analysis.
5. Generate a neutral Thesis that references every Evidence artifact.
6. Generate a neutral Prediction that references the Thesis artifact.

## Output format

Return a structured result containing:

- one or more `Evidence` artifacts;
- one `Thesis` artifact with `evidenceIds`;
- one `Prediction` artifact with `thesisId` and `evaluationPeriod`.

All artifacts must share the active Harness session ID. The output is a research record and must not be presented as a buy, sell, or trading instruction.
