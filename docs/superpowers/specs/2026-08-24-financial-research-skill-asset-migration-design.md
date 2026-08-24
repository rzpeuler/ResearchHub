# Financial Research Skill Asset Migration Design

## Objective

Migrate the high-value financial research methods from
`anthropics/financial-services` into runtime-neutral ResearchHub Skill Assets.
The migration preserves research methodology, command-oriented workflows,
structured output contracts, and reusable templates while removing Claude
runtime, slash-command, MCP, and provider-specific orchestration.

## Scope

The first phase contains four independent Skill Assets:

1. `equity-research` — coverage initiation and investment thesis formation.
2. `industry-research` — market, sector, value-chain, and competitive landscape analysis.
3. `earnings-review` — post-earnings beat/miss, guidance, estimate, and thesis review.
4. `valuation` — comparable-company benchmarking and DCF valuation with sensitivities.

Each Skill package contains:

```text
skill/
  index.ts
  SKILL.md
  commands/
  schemas/
  templates/
  *.test.ts
```

## Architecture

Skills are runtime-neutral assets under `packages/skills/`. They expose typed
input/output contracts and accept Plugin interfaces through dependency
injection. They do not import `dsh/`, `ResearchManager`, Claude packages,
slash-command infrastructure, MCP clients, or provider-specific orchestration.

The allowed direction is:

```text
dsh / other Runtime
          ↓
packages/skills → injected Plugin interfaces
```

External data access remains in `packages/plugins`. The Skill owns research
methodology, analysis steps, evidence requirements, validation, and output
assembly; the Plugin owns data retrieval and normalization.

## Skill contracts

### Equity Research

Inputs include company identity, research question, coverage context, and
optional financial/market evidence. The method covers company profile,
industry position, competitive moat, management, financial quality, risks,
catalysts, and thesis. The output is a structured coverage report with linked
Evidence, Thesis, and Prediction artifacts.

### Industry Research

Inputs include industry scope, geography, time horizon, and research purpose.
The method covers market size and growth, segmentation, value chain, barriers,
drivers, risks, competitive landscape, valuation context, and investment
implications. The output includes a structured industry report and evidence
references.

### Earnings Review

Inputs include company identity, reporting period, consensus snapshot, prior
guidance, and current earnings evidence. The method focuses on what changed:
revenue/EPS beat or miss, segment performance, margins, guidance, estimate
revisions, and thesis impact. The output is a concise review with source
attribution and a validation-ready update to the research thesis.

### Valuation

Inputs include company identity, peer set, financial history/projections, and
market assumptions. The method combines comparable-company statistics with a
DCF model, WACC and terminal-growth assumptions, scenario outputs, sensitivity
tables, cross-checks, and valuation risks. The output is a structured valuation
analysis; it does not make an autonomous investment decision.

## Validation

Each Skill test must verify:

- package files and schemas exist;
- method inputs reject malformed values;
- injected Plugin interfaces are called without direct network access;
- output shape and evidence/source requirements are enforced;
- no source import references `dsh`, `ResearchManager`, Claude, MCP, or slash-command runtime code.

The full repository validation remains `npm test`.

## Source adaptation

The source methodology is adapted from the public Anthropic financial-services
reference repository, especially the equity initiation, sector overview,
earnings analysis, comparable-company, and DCF materials. Source-specific
deliverables such as DOCX/Excel automation, MCP connector configuration,
Claude agent wrappers, and slash-command dispatch are intentionally excluded.
