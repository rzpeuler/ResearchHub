# ResearchHub Architecture v0.2


## Document Status

Version:

v0.2


Status:

Architecture Baseline Freeze


Owner:

System Architect


Purpose:

Define the long-term architecture direction of ResearchHub and prevent engineering deviation.


---

# 1. Product Positioning


## 1.1 Product Definition


ResearchHub is an AI-powered A-share investment research assistant built on DeepSeek Harness.


The product positioning:

> An AI personal equity research analyst for A-share investors.


ResearchHub aims to help individual investors improve:


- Information processing efficiency
- Investment research quality
- Research methodology consistency
- Investment decision review capability


ResearchHub is not designed to replace investors.

It is designed to become a persistent AI research partner.


---

# 2. Phase 1 Scope


## Target User


Individual investors with basic investment experience.


## Market Scope


Primary:

- China A-share market


Future expansion:

- Global markets


## Core Capabilities


Phase 1 focuses on:


1. Market intelligence monitoring

2. Stock research

3. Industry research

4. Abnormal movement analysis

5. Investment decision review



---

# 3. Explicit Non-Goals


ResearchHub Phase 1 will NOT implement:


## Automated Trading

ResearchHub does not execute trades.


## Stock Price Prediction Engine

ResearchHub does not promise future price prediction.


## Quantitative Trading Platform

ResearchHub is not a high-frequency or systematic trading system.


## General Agent Framework

ResearchHub does not replace DeepSeek Harness.


## Bloomberg Replacement

ResearchHub focuses on AI research workflow rather than complete financial terminal functions.


---

# 4. Core Architecture Principles


## 4.1 Harness First


ResearchHub adopts DeepSeek Harness as the underlying Agent infrastructure.


ResearchHub does not rebuild:


- Agent Runtime
- Tool Runtime
- Workflow Engine
- Session Engine
- Plugin Runtime


---

## 4.2 Extension Over Modification


ResearchHub extends Harness through:


- Agent Definition
- Skill Extension
- Capability Provider
- Plugin Extension
- Memory Provider
- Workflow Definition


ResearchHub MUST NOT modify Harness Core without explicit architecture review.


---

## 4.3 Separation of Intelligence and Data


The system separates:


Research Intelligence:

- Agent
- Skill
- Workflow
- Research Methodology


from:


Data Capability:

- Market Data
- Financial Data
- News
- Institution Data


---

# 5. Overall Architecture


                ResearchHub
================================================
Application Layer
================================================
Research UI
Research Dashboard
Investment Journal
================================================
Research Intelligence Layer
================================================
Research Manager Agent
    |

    |
Research Skills
    |

    |
Financial Capabilities
    |

    |
Research Workflows
    |

    |
Research Memory
================================================
DeepSeek Harness Runtime
================================================
Cordis Runtime
Agent Runtime
Plugin Runtime
Workflow Runtime
Session Runtime
Memory Interface
================================================
Infrastructure Layer
================================================
Database
Vector Database
Graph Database
External Data Services

---

# 6. DeepSeek Harness Integration Model


## 6.1 Architecture Position


ResearchHub is implemented as a financial intelligence extension bundle on top of DeepSeek Harness.


Conceptually:


DeepSeek Harness
    |
ResearchHub Bundle
    |
Research Manager Agent
Research Skills
Financial Capabilities
Memory Providers
Research Workflows
Financial Plugins


---

# 7. Agent Architecture


## Research Manager Agent


ResearchHub maintains one primary long-lived Agent.


Role:


AI personal A-share investment researcher.


Responsibilities:


- Understand user research goals
- Select appropriate skills
- Request required capabilities
- Coordinate research workflow
- Generate research artifacts
- Update research memory


The Agent does NOT:


- Access databases directly
- Implement data acquisition logic
- Execute trading actions


---

# 8. Skill Architecture


## Definition


Skill represents investment research methodology.


Skill answers:


"How should this research problem be analyzed?"


Skill is NOT:


- Data source
- Database interface
- Agent


Relationship:


Agent
↓
Skill
↓
Capability
↓
Data Source


---

# 9. Core Research Skills


## 9.1 Event Analysis Skill


Purpose:


Analyze abnormal stock movements.


Process:


1. Confirm abnormal movement

2. Collect evidence

3. Identify possible events

4. Validate fundamental logic

5. Evaluate sustainability


Output:


- Main reasons
- Evidence
- Confidence
- Sustainability
- Risks


---

## 9.2 Stock Research Skill


Purpose:


Create company research profile.


Includes:


- Business model
- Industry position
- Financial analysis
- Growth drivers
- Risks
- Valuation


---

## 9.3 Industry Analysis Skill


Purpose:


Analyze industry opportunities.


Includes:


- Industry cycle
- Supply and demand
- Competitive landscape
- Industrial chain
- Beneficiary companies


---

## 9.4 Market Monitoring Skill


Purpose:


Identify important market research signals.


Sources:


- News
- Institutions
- Communities
- Market data


---

## 9.5 Investment Review Skill


Purpose:


Review historical investment decisions.


Process:


Prediction
↓
Actual Outcome
↓
Evaluation
↓
Learning


---

# 10. Capability Architecture


## Definition


Capability is the standardized financial ability exposed to Agents.


Agents interact with capabilities, not databases.


Architecture:


Agent
↓
Capability Interface
↓
Data Service Layer
↓
External Data Provider


---

# 11. Financial Capabilities


## Market Capability


Provides:


- Stock quotes
- Historical prices
- Volume
- Capital flow
- Abnormal movement information


---

## Financial Capability


Provides:


- Financial statements
- Profit growth
- Valuation information
- Profitability metrics


---

## News Capability


Provides:


- Company news
- Industry news
- Policy information


---

## Institution Capability


Provides:


- Research reports
- Institutional activity
- Survey information


---

## Community Capability


Provides:


- Market sentiment
- Hot topics
- Discussion signals


---

## Knowledge Capability


Provides:


- Industry chain
- Company relationship
- Concept mapping


---

# 12. Workflow Architecture


Workflow defines research task lifecycle.


Core workflows:


---

## User Research Workflow


Example:


"Analyze a company"


Flow:


Create Research Session
↓
Select Skill
↓
Collect Evidence
↓
Generate Research Artifact
↓
Save Memory


---

## Market Monitoring Workflow


Flow:


Collect Market Information
↓
Signal Filtering
↓
Research Opportunity Detection
↓
Generate Report
↓
Update Memory


---

## Investment Review Workflow


Flow:


Read Historical Decisions
↓
Compare Actual Results
↓
Evaluate Accuracy
↓
Update Memory


---

# 13. Session Architecture


ResearchHub uses Harness Session as execution foundation.


ResearchHub extends Session with financial metadata.


Research Session contains:


- Research topic
- Target company
- Evidence
- Analysis process
- Investment thesis
- Confidence
- Prediction
- Review result


---

# 14. Research Artifact Architecture


Research outputs are structured artifacts.


## Evidence Artifact


Contains:


- Data source
- Facts
- Timestamp


---

## Thesis Artifact


Contains:


- Investment view
- Supporting evidence
- Risks
- Confidence


---

## Prediction Artifact


Contains:


- Expected development
- Verification indicators
- Evaluation period


---

## Review Artifact


Contains:


- Actual outcome
- Prediction accuracy
- Learning result


---

# 15. Memory Architecture


ResearchHub builds financial research memory.


## Knowledge Memory


Stores:


- Industry knowledge
- Company information
- Documents


---

## Company Memory


Stores:


- Company history
- Business evolution
- Important events


---

## Research Memory


Stores:


- Research processes
- Evidence
- Conclusions


---

## Decision Memory


Stores:


- Investment thesis
- Confidence
- Prediction
- Outcome


Decision Memory is the long-term competitive asset of ResearchHub.


---

# 16. Data Architecture


## Structured Data Layer


Technology:


PostgreSQL


Stores:


- Users
- Companies
- Sessions
- Research artifacts
- Decisions


---

## Vector Data Layer


Stores:


- News
- Research reports
- Announcements
- Documents


---

## Graph Data Layer


Future capability:


Stores:


- Industry chain
- Company relationships
- Theme relationships


---

# 17. Engineering Rules


## Must


ResearchHub development must:


- Use Harness extension mechanisms
- Keep capabilities modular
- Preserve evidence traceability
- Maintain research history
- Separate data and reasoning


---

## Forbidden


Development must not:


- Fork Harness Core
- Rebuild Agent Runtime
- Rebuild Workflow Engine
- Allow Agent direct database access
- Put investment conclusions inside data plugins


---

# 18. Development Roadmap


## Phase 0

Governance Bootstrap


Status:

Completed


---

## Phase 1

Architecture and Harness Integration


Goals:


- Validate Harness extension model
- Build project skeleton
- Implement first capability


---

## Phase 2

Financial Capability Layer


Implement:


- Market Capability
- News Capability
- Financial Capability


---

## Phase 3

Event Analysis MVP


First complete user value loop.


---

## Phase 4

Company Research System


Build:


- Company Memory
- Research History
- Decision Tracking


---

## Phase 5

Personal Investment Research Assistant


Build:


- Daily intelligence
- Continuous monitoring
- Automated review


---

# 19. Architecture Decision Records


## ADR-001

Decision:

DeepSeek Harness is adopted as ResearchHub runtime.


Status:

Accepted


---

## ADR-002

Decision:

ResearchHub focuses on Financial Intelligence Layer.


Status:

Accepted


---

## ADR-003

Decision:

ResearchHub adopts Skill + Capability architecture.


Status:

Accepted


---

## ADR-004

Decision:

ResearchHub adopts Research Memory architecture.


Status:

Accepted


---

## ADR-005

Decision:

ResearchHub does not fork Harness Core.


Status:

Accepted


---

# 20. Architecture Freeze Statement


ResearchHub Architecture v0.2 is the current baseline.


All future engineering work must follow:


Architecture
↓
Technical Design
↓
Engineering Task
↓
Implementation
↓
Validation


Any architecture changes require:


- New ADR
- Architecture version update
- Technical review