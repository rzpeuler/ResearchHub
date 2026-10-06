# ResearchHub Repository Layout v1

**Status:** FROZEN / CTO decision
**Version:** v1.0
**Baseline:** ResearchHub Production Baseline v1
**Purpose:** Repository physical layout and ownership governance

---

## 1. Purpose

本规范定义 ResearchHub 的长期仓库物理目录结构、模块 ownership、依赖方向、测试布局和文档分类。

本规范解决的是：

* Repository physical organization
* Code ownership
* Module discoverability
* Long-term maintainability
* New-code placement
* Test ownership
* Documentation taxonomy

本规范不改变：

* Production Baseline v1
* Runtime architecture
* Knowledge Architecture
* Workflow / Skill / Plugin 逻辑边界
* Provider/model authority
* Product capability
* Public API semantics

Repository Layout 是现有架构的物理映射，而不是新的架构层。

---

# 2. Root Layout

ResearchHub 一级目录冻结为：

```text
ResearchHub/
│
├── app/
├── client/
├── knowledge/
├── workflows/
├── skills/
├── plugins/
├── tests/
├── docs/
│
├── AGENTS.md
├── README.md
├── package.json
├── package-lock.json
├── tsconfig.json
└── .gitignore
```

除非出现新的独立产品子系统，不新增一级源码目录。

---

# 3. Root Directory Ownership

## 3.1 app/

职责：

Application Backend / Host / Runtime integration。

包含：

* Application Services
* Runtime lifecycle
* HTTP/SSE transport
* Attachment ingress
* Session integration
* Pi host integration
* Application-level security boundary

目标结构：

```text
app/
├── pi/
├── runtime/
└── services/
```

### app/pi/

仅负责：

* Pi Coding Agent host integration
* Pi ModelRuntime selection
* Pi session integration
* Pi tools
* Pi-specific security
* Pi system prompt

不得放：

* Knowledge business logic
* Workflow semantic logic
* Provider abstraction framework

### app/runtime/

负责：

* Runtime lifecycle
* HTTP server
* SSE/event stream
* Runtime security
* Attachment lifecycle
* Runtime storage boundary
* Runtime session lifecycle

### app/services/

负责 Application Use Cases：

* KnowledgeService
* KnowledgeGraphService
* ProductionService
* ReviewService
* WorkflowService

Application Service 可以协调 domain modules，但不得成为 Knowledge semantic authority。

---

# 4. client/

职责：

ResearchHub browser application。

长期目标：

```text
client/
└── src/
    ├── app/
    ├── features/
    │   ├── research/
    │   ├── knowledge/
    │   ├── graph/
    │   └── reviews/
    │
    └── shared/
        ├── api/
        ├── components/
        └── hooks/
```

## client/src/app/

只放：

* Application shell
* Routing
* Top-level orchestration
* Workflow polling
* Global application state

不得长期存放具体 feature implementation。

## client/src/features/

按照用户可感知功能组织。

例如：

* research
* knowledge
* graph
* reviews

## client/src/shared/

仅允许真正跨 Feature 使用的：

* API client
* Generic UI components
* Hooks
* Browser-side utilities

禁止把 `shared/` 变成任意代码垃圾桶。

Browser 不得直接访问：

* filesystem
* Knowledge storage
* Writer
* Review store
* Runtime internals

---

# 5. knowledge/

Knowledge 是 ResearchHub Canonical Knowledge authority。

当前一级内部边界冻结：

```text
knowledge/
├── schema/
├── raw/
├── registry/
├── storage/
├── validation/
├── writer/
├── query/
└── review/
```

本轮 Repository 整理不重新组织 Knowledge 内部目录。

## schema/

定义：

* Canonical domain
* Executable schema
* Manifest schema
* Mutation schema
* Schema release

## raw/

定义：

* Raw identity
* Immutable Raw archive

## registry/

负责：

* KnowledgeBase registry
* ID allocation

## storage/

负责：

* Persistent storage
* Loader
* Manifest
* Canonical hash
* Mutation lock
* Root transaction
* Ingestion log

## validation/

负责：

* Canonical validation
* ChangeSet validation
* Semantic structural validation

## writer/

唯一 canonical mutation authority。

## query/

Canonical Knowledge read/query primitives。

## review/

负责 durable actionable ReviewCase：

* contracts
* builder
* store
* validation

Review telemetry 不属于该目录。

---

# 6. workflows/

Workflow 表示确定性的业务执行流程。

每个 Workflow 必须拥有独立目录：

```text
workflows/
└── <workflow-name>/
```

当前：

```text
workflows/
└── raw-document-knowledge-ingestion/
```

长期目标结构：

```text
raw-document-knowledge-ingestion/
├── index.ts
├── contracts.ts
├── workflow.ts
│
├── planning/
├── extraction/
├── resolution/
├── review/
├── changeset/
└── shared/
```

具体规划：

```text
planning/
└── plan-validation.ts

extraction/
└── consolidation.ts

resolution/
├── knowledge-resolution.ts
└── investment-theme-policy.ts

review/
└── review-telemetry.ts

changeset/
└── changeset-planner.ts

shared/
└── id-helpers.ts
```

## Workflow 根目录规则

根目录只允许：

* workflow.ts
* contracts.ts
* index.ts
* README / Workflow specification（如需要）

大型 stage implementation 不继续平铺在 Workflow 根目录。

## Workflow ownership

Workflow 负责：

* stage order
* deterministic routing
* lifecycle
* retry/replay semantics
* validation gates
* Writer entry
* terminal status

Workflow 不负责：

* 专业研究方法论
* Provider implementation
* Canonical storage implementation

---

# 7. skills/

Skill 表示专业语义方法论。

每个 Skill 独立目录：

```text
skills/
└── <skill-name>/
```

Knowledge Curation 长期目标：

```text
skills/
└── knowledge-curation/
    ├── SKILL.md
    ├── index.ts
    ├── skill.ts
    ├── contracts.ts
    ├── errors.ts
    │
    ├── identity/
    ├── model/
    ├── validation/
    └── prompts/
```

规划：

```text
identity/
└── company-identity.ts

model/
├── model-input.ts
├── output-contracts.ts
├── schema-context.ts
└── schema-context-types.ts

validation/
└── validation.ts
```

## Skill 根目录规则

根目录主要保留：

* SKILL.md
* skill.ts
* contracts.ts
* errors.ts
* index.ts

专业子能力进入语义子目录。

## Skill ownership

Skill 负责：

* professional methodology
* semantic interpretation
* extraction methodology
* reasoning input/output contracts
* identity methodology
* domain-specific validation

Skill 不控制：

* Workflow lifecycle
* Persistent Writer transaction
* HTTP Runtime
* Provider authentication

---

# 8. plugins/

Plugin 是 ResearchHub 与外部能力之间的 adapter boundary。

冻结：

```text
plugins/
├── document/
└── reasoning/
```

未来新增 Plugin 时必须代表真正独立的外部 capability。

---

## 8.1 Document Plugin

目标：

```text
plugins/document/
├── index.ts
├── contracts.ts
├── errors.ts
├── input-resolver.ts
├── parser-registry.ts
├── validation.ts
│
└── parsers/
    ├── text/
    └── docling/
```

Parser implementation 统一进入：

```text
parsers/
```

避免：

```text
text-parser.ts
docling/
```

这种不同 adapter 使用不同层级的结构。

---

## 8.2 Reasoning Plugin

保持当前清晰边界：

```text
plugins/reasoning/
├── index.ts
├── contracts.ts
├── capabilities.ts
├── errors.ts
├── pi/
├── codex/
└── mock/
```

不得增加：

```text
providers/
drivers/
adapters/
implementations/
engines/
```

等无实际必要的中间抽象。

Plugin 本身已经是 adapter boundary。

---

# 9. tests/

Tests 必须 mirror source ownership。

长期结构：

```text
tests/
├── app/
│   ├── services/
│   ├── runtime/
│   └── pi/
│
├── knowledge/
│
├── plugins/
│   ├── document/
│   └── reasoning/
│
├── skills/
│   └── knowledge-curation/
│
├── workflows/
│   └── raw-document-knowledge-ingestion/
│
└── validation/
```

禁止继续使用与源码 ownership 不一致的分类：

```text
tests/curation/
tests/document/
tests/reasoning/
tests/workflow/
tests/pi/
tests/runtime/
```

应逐步迁移到对应源码 ownership。

---

# 10. Validation Layout

Validation 属于系统级 acceptance infrastructure，与普通 unit/integration tests 分开。

目标：

```text
tests/validation/
├── contracts/
├── scenarios/
└── evidence/
```

## contracts/

放：

* deterministic validation helper
* acceptance oracle
* invariant verifier

## scenarios/

放：

* real Provider validation
* Production E2E scenario
* Runtime restart validation
* semantic quality validation

## evidence/

保存历史 validation evidence。

### Critical Rule

`tests/validation/evidence/`

路径冻结。

历史 Evidence：

* 不移动
* 不重命名
* 不覆盖
* 不重写

历史治理文档中的 evidence 路径必须继续有效。

---

# 11. docs/

长期文档 taxonomy 冻结为：

```text
docs/
├── architecture/
├── governance/
└── engineering/
    └── specs/
```

## architecture/

长期架构 authority：

* architecture
* schema architecture
* production architecture
* graph architecture
* review architecture
* repository layout

冻结的 architecture document 不因普通实现变化被重写。

## governance/

项目状态 authority：

* PROJECT_OVERVIEW
* CURRENT_STATUS
* CHANGELOG
* DECISION_LOG
* PRODUCTION_BASELINE
* roadmap / registry

## engineering/specs/

具体工程设计：

* feature design
* bug fix design
* refactor design
* migration design

原：

```text
docs/superpowers/specs/
```

迁移为：

```text
docs/engineering/specs/
```

项目文档 taxonomy 不得使用具体 Agent / Tool 名称。

---

# 12. Dependency Direction

Repository ownership 的正常依赖方向为：

```text
client
   ↓ HTTP/SSE boundary
app
   ↓
workflows
   ↓
skills
   ↓
knowledge
```

外部能力：

```text
workflows ──→ plugins
skills    ──→ plugin contracts where necessary
app       ──→ Pi/runtime plugins where necessary
```

核心规则：

```text
knowledge
```

不得反向依赖：

* app
* workflows
* skills
* client

plugins 不得依赖：

* app
* client
* concrete Workflow implementation

client 不得 import server internal implementation。

---

# 13. Public Entry Points

每个主要 module 应通过：

```text
index.ts
```

定义稳定 module surface。

跨目录调用应优先使用 module public entrypoint。

不鼓励其他模块长期依赖深层内部路径，例如：

```text
../../../knowledge/storage/internal-x.ts
```

但本规则不要求一次性重构所有现有 imports。

---

# 14. Naming Rules

目录：

```text
kebab-case
```

例如：

```text
knowledge-curation
raw-document-knowledge-ingestion
```

文件：

```text
kebab-case.ts
```

TypeScript：

* Types / Classes: PascalCase
* functions / values: camelCase

避免新增：

```text
utils.ts
helpers.ts
common.ts
misc.ts
core.ts
shared.ts
```

除非作用域被限定在具体 owning module 中。

例如：

```text
raw-document-knowledge-ingestion/shared/id-helpers.ts
```

允许。

根级：

```text
common/
utils/
core/
shared/
```

禁止。

---

# 15. Forbidden Root Directories

除非 CTO 新架构决策，不新增：

```text
src/
packages/
core/
common/
utils/
backend/
server/
lib/
framework/
providers/
capabilities/
agents/
```

原因：

它们会削弱当前清晰的 domain ownership，或重新引入已经废弃的框架化方向。

---

# 16. Repository Configuration

`tsconfig.json` 必须显式覆盖所有 Production TypeScript ownership。

至少包括：

```text
app/**/*.ts
knowledge/**/*.ts
plugins/**/*.ts
skills/**/*.ts
workflows/**/*.ts
tests/**/*.ts
```

Workflow 不应仅依赖 indirect imports 被 TypeScript 检查。

---

# 17. Test Discovery

`npm test` 不应长期依赖手工维护超长具体文件清单。

目录整理后，应建立稳定的 test discovery 规则。

要求：

* 不更换 Node test / Vitest 技术路线
* 不引入新的 Test Framework
* 新增符合目录规范的 test 后，应自动或低维护成本被 test suite 纳入

---

# 18. Migration Principles

Repository Layout migration 必须遵守：

## 18.1 Move First, Refactor Later

目录迁移阶段：

允许：

* move files
* update imports
* update test paths
* update scripts
* update docs

禁止同时：

* 重写业务逻辑
* 拆函数
* 修改 contract
* 改变 Workflow semantics
* 修改 Knowledge schema

---

## 18.2 Preserve Git History

优先使用：

```text
git mv
```

使 Git 能够识别 rename/move。

---

## 18.3 Preserve Production Baseline Semantics

目录迁移不得改变：

* Runtime behavior
* API
* Workflow output
* Knowledge state
* Review behavior
* Graph behavior
* Provider behavior

---

# 19. Migration Phases

## Phase A — Structural Governance

包括：

* Freeze Repository Layout v1
* tests mirror source ownership
* docs/superpowers → docs/engineering
* tsconfig ownership correction
* test discovery cleanup

Production implementation 尽量不移动。

---

## Phase B — Production Module Layout

包括：

* Workflow stage directories
* Knowledge Curation Skill internal directories
* Document Plugin parser normalization

仅移动文件和 import。

---

## Phase C — Code Decomposition

结合未来产品需求逐步处理：

* workflow.ts
* knowledge-resolution.ts
* changeset-planner.ts
* consolidation.ts
* app/runtime/server.ts
* client App.tsx
* Knowledge Curation validation

Phase C 不属于 Repository Layout migration。

它是独立 refactor。

---

# 20. Change Governance

Repository Layout v1 冻结后：

新增代码必须优先遵循当前 Layout。

如果某个新模块无法明确归属于：

```text
app
client
knowledge
workflow
skill
plugin
```

必须首先判断：

是否真的出现了新的架构概念。

不得简单创建：

```text
core/
common/
misc/
utils/
```

解决 placement 问题。

---

# 21. Architectural Principle

Repository structure 应让开发者仅通过路径就能判断代码责任。

目标：

```text
path
→ ownership
→ architectural role
→ allowed dependencies
```

而不是：

```text
path
→ implementation history
```

Repository Layout v1 的核心原则是：

> Organize by stable architectural ownership, not by temporary implementation convenience.

---

# 22. Frozen Decision

ResearchHub Repository Layout v1 冻结以下决策：

1. 保留现有八个一级目录：

   * app
   * client
   * knowledge
   * workflows
   * skills
   * plugins
   * tests
   * docs

2. 不引入新的顶层 src/packages/core/common 抽象。

3. Knowledge 当前内部布局保持稳定。

4. Workflow 内部按 execution stage 分组。

5. Skill 内部按 professional capability 分组。

6. Plugin 保持薄 adapter boundary。

7. Tests mirror source ownership。

8. Validation Evidence 路径保持 immutable。

9. Docs 只保留：

   * architecture
   * governance
   * engineering

10. Repository migration 与逻辑 refactor 分离。

---

**End of ResearchHub Repository Layout v1**
