# Company Research Skill Package MVP Implementation

**Task:** RH-ENG-011  
**Status:** Implemented MVP  
**Skill version:** `1.0.0`  
**Workflow:** `company-research` v1.0.0  
**Harness:** DeepSeek Harness `0.1.1-rc.2`

## 1. Package structure

```text
packages/skills/company-research/
├── skill.yaml
├── SKILL.md
├── research-framework.md
├── evidence-schema.yaml
├── output-schema.yaml
├── evaluation-rules.md
├── types.ts
├── workflow.ts
├── index.ts
└── *.test.ts
```

The six standard Skill contract files are present. `skill.yaml` declares the
logical Market, Financial, and Information Plugin dependencies and the
compatible `company-research` Workflow. `SKILL.md` remains the Harness loading
entry point; the other files provide the research method and contracts.

## 2. Workflow relationship

```text
Research Request
    -> Research Manager
        -> company-research Workflow Definition
            -> Company Research Skill
                -> Market Plugin
                -> Information Plugin
                -> Financial Plugin
            -> Evidence
            -> Thesis
            -> Prediction
        -> Research Report View
    -> Evaluation(Prediction, Outcome)
```

The Workflow Registry contains a declarative `company-research` definition
with these method steps:

```text
Business Understanding
  -> Industry Position
  -> Competitive Advantage
  -> Growth Drivers
  -> Financial Quality
  -> Capital Allocation
  -> Risk Analysis
  -> Thesis
  -> Prediction
```

ResearchHub does not create a Harness Workflow Runtime. The thin Workflow Executor
adapts the approved definition to the existing Company Research Skill
implementation, while Research Manager remains responsible for request
validation, Workflow selection, Artifact collection, and Report View
aggregation.

## 3. Plugin dependencies

The Skill receives three injected Plugin interfaces:

- Market Plugin: observed market context.
- Information Plugin: company and industry information facts.
- Financial Plugin: reported statements and metrics.

The Company Research Skill never imports a Plugin, calls HTTP, handles
credentials, or selects a data source. Existing Plugin Registry and
Plugin boundaries remain unchanged.

## 4. Evidence flow

The MVP creates Evidence from the three available fact domains:

- Market Evidence for industry and event context.
- Information Evidence for business and competitive context.
- Financial Evidence for financial quality and capital-allocation context.

The seven methodology modules operate on this Evidence set. The MVP does not
invent unsupported Evidence for a module; missing module-specific data is
represented through Thesis risks and the documented Evidence requirements.

All generated Evidence shares the active Session ID and preserves source,
timestamp, quality, confidence, Plugin, and period metadata where available.

## 5. Artifact relationship

The implementation reuses the existing Artifact types:

```text
Evidence[]
    -> Thesis.evidenceIds[]
    -> Prediction.thesisId
    -> Research Report View IDs
    -> Evaluation(Prediction, Outcome)
```

Thesis metadata identifies `skill: company-research`, workflow, symbol, and
the seven research modules. Prediction contains a reviewable hypothesis,
`metrics.validation_metric`, `evaluationPeriod`, and the Thesis relationship.
No CompanyResearchArtifact or CompanyThesisArtifact was added.

## 6. Evaluation integration

The existing Evaluation Engine accepts the Company Research Prediction without
special handling. The integration test supplies a deterministic Outcome using
the declared Prediction metrics and confirms a Review with status `met`.

Evaluation remains objective and downstream. It does not calculate valuation,
rank companies, mutate the Skill, or generate a trading recommendation.

## 7. Validation

New tests cover:

- Company Research Skill Package file structure and metadata.
- Required research sections and output rules.
- Company Research Workflow registration and step ordering.
- Plugin invocation through injected interfaces.
- Evidence, Thesis, Prediction, and Report View relationships.
- Prediction compatibility with the Evaluation Engine.

Existing Plugin, Plugin, Workflow, Artifact, Memory, Evaluation, Skill,
and Harness integration tests remain part of the full validation command.

## 8. Explicit non-goals

This MVP does not implement:

- valuation models or price targets;
- investment recommendations or trading;
- new Plugins or Plugins;
- a new Artifact base type;
- a custom Harness Runtime Loop, Plugin Runtime, or Harness Workflow Runtime;
- automatic strategy modification after Evaluation.
