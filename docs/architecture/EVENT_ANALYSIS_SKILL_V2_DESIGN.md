# Event Analysis Skill v2 Design

**Task:** RH-ENG-010  
**Status:** Implemented  
**Skill version:** `2.0.0`  
**Harness:** DeepSeek Harness `0.1.1-rc.2`

## 1. Standard Skill Package

```text
packages/skills/event-analysis/
├── skill.yaml              # ResearchHub metadata and compatibility contract
├── SKILL.md                # Harness entry point and human-readable method
├── research-framework.md   # Professional research methodology
├── evidence-schema.yaml    # Evidence categories and Thesis support rules
├── output-schema.yaml      # Thesis/Prediction output contract
├── evaluation-rules.md     # Evidence, reasoning, and Prediction quality
├── workflow.ts             # Existing Skill execution adapter
└── *.test.ts               # Runtime and package contract tests
```

`skill.yaml` is the canonical ResearchHub metadata file. `SKILL.md` retains
the existing Harness-compatible `name` and `description` Front Matter and
remains the Skill loading entry point. The files describe one contract and do
not create a second Skill runtime.

## 2. Research Method

Event Analysis is a neutral, evidence-first method for explaining a material
company or market event:

```text
Event confirmation
  -> Catalyst identification
  -> Information verification
  -> Fundamental validation
  -> Logic-chain formation
  -> Risk identification
  -> Prediction metric definition
```

The detailed method includes Price Action Analysis, Catalyst Analysis,
Expectation Analysis, Fundamental Validation, and Risk Analysis. The Skill
distinguishes observed facts, interpretation, hypothesis, and realized Outcome.

## 3. Workflow Relationship

```text
Research Manager
  -> Event Analysis Workflow
      -> Event Analysis Skill
          -> Market Capability
          -> Information Capability
          -> Financial Capability
      -> Evidence / Thesis / Prediction Artifacts
      -> Research Report View
```

The Workflow owns lifecycle and cross-capability ordering. The Skill owns the
method, Evidence requirements, and output quality rules. The Skill does not
call Providers, schedule steps, create an Agent Loop, or own Session
persistence.

The approved `event-analysis@1.x` Workflow remains compatible with Skill v2:
its steps reference `event-analysis`, and its output remains Evidence IDs,
Thesis IDs, and Prediction IDs.

## 4. Evidence Relationship

An Event Analysis run should retain three evidence categories when their
Capabilities are available:

- Market Evidence: establishes the observed movement or event context.
- Information Evidence: records official announcement and professional-media
  facts with source metadata.
- Financial Evidence: validates or qualifies the interpretation using reported
  company facts and periods.

A causal Thesis requires at least two Evidence source categories and must list
the supporting IDs in `Thesis.evidenceIds`. Single-source attribution and
unsupported certainty are invalid research outputs.

## 5. Output and Evaluation

The canonical output remains the existing Artifact chain:

```text
Evidence[]
  -> Thesis.evidenceIds[]
  -> Prediction.thesisId
  -> Evaluation(Prediction, Outcome)
  -> Review
```

The Skill's semantic `hypothesis` maps to the existing Prediction Artifact's
`expectation` field. `validation_metric` is represented in
`Prediction.metrics.validation_metric`, and `evaluation_period` maps to the
existing `evaluationPeriod` field. This preserves the Artifact Framework and
does not add or rename base Artifact fields.

Evaluation remains objective and downstream. It checks whether declared
metrics can be compared with a caller-supplied Outcome; it does not judge the
Skill's intelligence, modify its methodology, or create trading instructions.

## 6. Validation

The Skill Package tests verify:

- all six standard contract files exist and are non-empty;
- `skill.yaml` declares required metadata, capabilities, Workflow compatibility,
  and output types;
- `SKILL.md` preserves Harness loading metadata and required method sections;
- the approved Workflow references the Event Analysis Skill;
- existing Capability, Artifact, Evaluation, Memory, Workflow, and Harness
  integration tests remain unchanged and compatible.

No Harness Core, Architecture v0.2, Technical Design v0.1, Capability
Framework, or Artifact type was modified.
