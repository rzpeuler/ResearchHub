# ResearchHub Research Artifact Design

## Purpose

ResearchHub 将研究过程中的中间结果建模为可追踪、可序列化、可关联 Session 的结构化 Artifact。

本阶段建立基础数据模型，不实现 Event Analysis、Memory 存储、投资评价或真实数据接入。

## Architecture Position

```text
Harness Session
      ↓ sessionId
Evidence
      ↓ evidenceIds
Thesis
      ↓ thesisId
Prediction
```

Artifact 只负责表达研究结果及其引用关系。Agent、Skill、Capability 和未来的 Memory Adapter 通过 Artifact 合同交换数据；Artifact 本身不访问 Harness、数据源或存储系统。

## Package Structure

```text
packages/artifacts/
├── core/
│   ├── types.ts
│   ├── validation.ts
│   ├── serialization.ts
│   └── errors.ts
├── evidence/
├── thesis/
└── prediction/
```

根入口 `packages/artifacts/index.ts` 汇总导出 Core 和三种 Artifact。

## Core Definition

所有 Artifact 都包含以下公共字段：

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | 由调用方分配的稳定 Artifact ID |
| `type` | `evidence \| thesis \| prediction` | 类型判别字段 |
| `createdAt` | ISO 8601 `string` | Artifact 创建时间 |
| `sessionId` | `string` | 产生该 Artifact 的 Harness Session ID |
| `metadata` | JSON object | 可扩展的 JSON-safe 元数据 |

ID 和时间戳由调用方提供，当前框架不引入 UUID 或持久化依赖，以保持测试确定性并将身份策略留给 Session/Repository 层。

## Artifact Types

### Evidence

Evidence 表示研究过程中收集到的可追溯事实或信息片段。

```ts
type Evidence = ArtifactBase<'evidence'> & {
  source: string
  content: string
  timestamp: string
  confidence: number
}
```

`confidence` 范围为 `[0, 1]`。`source`、`content`、`timestamp` 和公共身份字段必须有效。

### Thesis

Thesis 表示基于 Evidence 形成的、可被后续研究检验的研究观点。

```ts
type Thesis = ArtifactBase<'thesis'> & {
  statement: string
  evidenceIds: string[]
  confidence: number
  risks: string[]
}
```

`evidenceIds` 只保存 Evidence ID，不在 Artifact 层解析或加载外部对象；引用完整性属于未来 Repository/Memory 层职责。

### Prediction

Prediction 表示对 Thesis 的可评估预期。

```ts
type Prediction = ArtifactBase<'prediction'> & {
  thesisId: string
  expectation: string
  evaluationPeriod: {
    start: string
    end: string
  }
  metrics: JsonObject
}
```

`thesisId` 显式关联来源 Thesis。`evaluationPeriod` 使用结构化起止时间，`metrics` 只保存 JSON-safe 目标或测量值，不执行评价逻辑。

Architecture v0.2 定义的 `Review` 暂不在本任务实现，作为后续复盘闭环的预留类型。

## Lifecycle

1. Session 或上层调用方分配 `id`、`sessionId` 和 `createdAt`。
2. 对应工厂函数创建并验证 Evidence、Thesis 或 Prediction。
3. Artifact 通过 `sessionId` 进入当前研究 Session。
4. Thesis 通过 `evidenceIds` 引用证据，Prediction 通过 `thesisId` 引用观点。
5. 未来 Adapter 使用 JSON 序列化结果进行持久化或写入 Memory。
6. 未来 Evaluation 流程读取 Prediction，不改变 Artifact 基础合同。

## Validation and Serialization

Core 提供：

- `validateArtifactBase()`：公共字段和 JSON-safe metadata 校验。
- `ArtifactValidationError`：带字段路径的结构校验错误。
- `serializeArtifact()` / `deserializeArtifact()`：基础 JSON 序列化，必须显式传入对应校验器。
- `isJsonValue()` / `isJsonObject()`：拒绝 `undefined`、非有限数字、非纯对象和循环引用。

每种 Artifact 还提供独立的 `validate*`、`is*`、`serialize*` 和 `deserialize*` 函数，确保具体字段在序列化和反序列化边界都被校验。

所有模型均为 plain JSON-safe objects，不包含方法、外部连接或数据源逻辑。

## Future Memory Integration

未来 Memory Adapter 可以按 `sessionId`、`type`、`evidenceIds` 和 `thesisId` 建立索引，保存 Artifact 的序列化结果，并追加 Review 或 Evaluation 相关信息。存储、检索和引用完整性不进入当前 Artifact 构造函数。

## Validation Scope

本框架使用确定性的内存测试数据，不访问网络、不接入商业金融数据、不修改 Harness Core，也不改变现有 Harness Integration 验证路径。
