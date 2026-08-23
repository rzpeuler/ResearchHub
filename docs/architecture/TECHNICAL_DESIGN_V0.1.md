# ResearchHub Technical Design v0.1


## Document Status


Version:

v0.1


Status:

Technical Design Baseline


Related Architecture:

ResearchHub Architecture v0.2


Purpose:

Define the engineering implementation approach of ResearchHub based on DeepSeek Harness architecture.


---

# 1. Overview


ResearchHub is an AI-powered A-share investment research system built on DeepSeek Harness.


The engineering objective:


Build a persistent AI investment research assistant through:


- Harness Runtime reuse
- Financial Capability extension
- Research Skill implementation
- Research Memory accumulation


---

# 2. Engineering Principles


## 2.1 Reuse Existing Runtime


ResearchHub MUST reuse DeepSeek Harness components.


Reuse:


- Agent Runtime
- Plugin Runtime
- Workflow Runtime
- Session Runtime
- Tool Runtime
- Memory Interface


Do not rebuild.


---

## 2.2 Domain Extension


ResearchHub development focuses on:


- Financial capabilities
- Investment research skills
- Research workflows
- Financial memory


---

## 2.3 Separation of Responsibility


The system separates:


## Intelligence Layer


Responsible for:


- Reasoning
- Research methodology
- Workflow decisions


Includes:


- Agent
- Skill
- Workflow


---


## Capability Layer


Responsible for:


- Data access
- External service integration
- Financial functions


Includes:


- Market Capability
- Financial Capability
- News Capability


---


## Infrastructure Layer


Responsible for:


- Storage
- Search
- Data processing


---

# 3. System Runtime Architecture


User
↓
ResearchHub Application
↓
Research Manager Agent
↓
Research Skills
↓
Financial Capabilities
↓
DeepSeek Harness Runtime
↓
Infrastructure Services


---

# 4. Repository Structure


Target structure:


ResearchHub/
├── docs/
│
├── architecture/
│
├── project-management/
│
└── decisions/
├── packages/
│
├── agents/
│
│   └── research-manager/
│
├── skills/
│
│   ├── event-analysis/
│   ├── stock-research/
│   ├── industry-analysis/
│   ├── market-monitoring/
│   └── investment-review/
│
├── capabilities/
│
│   ├── market/
│   ├── financial/
│   ├── news/
│   ├── institution/
│   ├── community/
│   └── knowledge/
│
├── memory/
│
├── workflows/
└── bundles/

---

# 5. Agent Design


## 5.1 Research Manager Agent


Role:


AI personal A-share equity research analyst.


---

## Responsibilities


The Agent is responsible for:


- Understanding user research intent
- Selecting appropriate research skills
- Coordinating capability usage
- Producing research artifacts
- Updating memory


---

## Non-responsibilities


Agent must not:


- Directly query databases
- Implement data collectors
- Contain financial API logic
- Execute trades


---

# 6. Agent Capability Binding


Research Manager Agent obtains capabilities through Harness extension mechanism.


Example:


Research Manager Agent
    |

    |
Capability Registry
    |

    |
Market Capability
News Capability
Financial Capability


---

# 7. Skill Design


## 7.1 Skill Definition


A Skill represents a reusable investment research methodology.


Skill contains:


- Name
- Description
- Required capabilities
- Reasoning framework
- Output schema
- Evaluation rules


---

# 8. Event Analysis Skill Design


## Purpose


Analyze abnormal A-share stock movement.


---

## Input


Example:


symbol:
600xxx
date:
2026-08-23
movement:
+8%

---

## Process


Confirm abnormal movement
↓
Collect evidence
↓
Search events
↓
Validate fundamentals
↓
Analyze sentiment
↓
Assess sustainability

---

## Output


Structured Research Artifact:


Reason
Evidence
Confidence
Sustainability
Risk

---

# 9. Stock Research Skill Design


Purpose:


Generate company research profile.


Process:


Company Overview
↓
Business Model
↓
Industry Position
↓
Financial Analysis
↓
Growth Drivers
↓
Risks
↓
Valuation

---

# 10. Industry Analysis Skill Design


Purpose:


Analyze industry opportunity.


Process:


Industry Cycle
↓
Supply Demand
↓
Competition
↓
Industrial Chain
↓
Beneficiary Companies
↓
Risks

---

# 11. Workflow Design


Workflow controls task execution lifecycle.


---

# 12. User Research Workflow


Trigger:


User request.


Process:


Create Research Session
↓
Identify Research Type
↓
Load Skill
↓
Request Capabilities
↓
Generate Artifact
↓
Save Memory

---

# 13. Market Monitoring Workflow


Trigger:


Scheduled execution.


Process:


Collect Information
↓
Filter Signals
↓
Generate Research Candidates
↓
Run Analysis
↓
Create Daily Report
↓
Update Memory

---

# 14. Review Workflow


Trigger:


Scheduled review.


Process:


Load Historical Decision
↓
Compare Outcome
↓
Evaluate Accuracy
↓
Update Decision Memory

---

# 15. Capability Design


Capability is the interface between Agent and external data.


---

# 16. Market Capability


Functions:


get_quote()
get_history()
get_volume()
get_money_flow()
get_abnormal_event()

---

# 17. Financial Capability


Functions:


get_company_profile()
get_financial_statement()
get_growth_metric()
get_valuation()

---

# 18. News Capability


Functions:


search_news()
get_company_news()
get_policy_news()

---

# 19. Institution Capability


Functions:


get_research_report()
get_institution_activity()
get_survey_information()

---

# 20. Community Capability


Functions:


get_hot_topic()
get_sentiment()
get_discussion()

---

# 21. Knowledge Capability


Functions:


query_industry_chain()
query_company_relation()
query_theme_mapping()

---

# 22. Plugin Design Rules


Plugins provide capabilities.


Plugins must:


- Return structured data
- Include source metadata
- Include timestamp
- Include confidence


Example:


```json
{
"data": {},

"source": "",

"time": "",

"confidence": 0.9
}

Plugins must not:
Generate investment conclusions
Contain trading logic
Replace Skill reasoning
23. Session Design
ResearchHub uses Harness Session as runtime foundation.
Additional metadata:
ResearchSession


id

topic

target

research_type

evidence

thesis

confidence

prediction

outcome

review

24. Research Artifact Design
Research artifacts are persistent research objects.
Types:
Evidence Artifact
Contains:
Source
Content
Timestamp
Thesis Artifact
Contains:
View
Evidence
Risk
Confidence
Prediction Artifact
Contains:
Expected outcome
Time range
Verification metrics
Review Artifact
Contains:
Actual outcome
Error analysis
Learning
25. Memory Provider Design
ResearchHub implements financial memory on top of Harness Memory Interface.
26. Memory Types
Knowledge Memory
Stores:
Industry information
Documents
Company Memory
Stores:
Company profile
Historical changes
Research Memory
Stores:
Research sessions
Previous analysis
Decision Memory
Stores:
Investment decisions
Predictions
Results
27. Data Storage Design
PostgreSQL
Stores structured business objects.
Examples:
users
companies
sessions
artifacts
Vector Database
Stores:
News
Reports
Documents
Graph Database
Future:
Industrial chain
Company relationship
28. Evaluation Design
Financial research requires evaluation.
Every important thesis should support:
Prediction

↓

Outcome

↓

Evaluation

↓

Memory Update

Evaluation metrics:
Evidence quality
Reasoning quality
Prediction accuracy
Risk identification
29. MVP Development Plan
Phase 1
Harness Integration Validation
Goal:
Verify:
Agent loading
Skill loading
Capability calling
Session persistence
Phase 2
First Capability
Implement:
Market Capability
Phase 3
Event Analysis MVP
Complete:
Data
↓
Analysis
↓
Report
↓
Memory
loop.
Phase 4
Company Research System
Phase 5
Daily Intelligence System
30. Engineering Constraints
All development must follow:
Architecture:
Architecture

↓

Technical Design

↓

Engineering Task

↓

Implementation

↓

Validation

Forbidden:
Creating independent Agent framework
Bypassing Harness Runtime
Direct database access from Agent
Mixing data collection and reasoning
Untracked architecture changes
31. Future Evolution
ResearchHub should evolve as:
DeepSeek Harness

+

Financial Intelligence Layer

+

Research Memory

+

Evaluation System


=

Personal AI Investment Research Platform