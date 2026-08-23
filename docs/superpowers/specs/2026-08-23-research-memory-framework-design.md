# RH-DESIGN-002 Research Memory Framework Design

## Status

Approved for implementation.

## Objective

建立 ResearchHub 的最小 Research Memory Layer，将 Thesis 和 Prediction 等结构化 Research Artifact 沉淀为可持久化、可检索、可更新的 Memory Entry。

本任务不保存完整聊天记录，不接入外部数据库，不实现 Vector/Graph/RAG 或投资评价。

## Scope and Boundaries

In scope:

- `packages/memory/core/` 通用 Memory 类型、查询类型和 Provider 接口。
- `packages/memory/providers/` JSON 文件 Local Memory Provider。
- `packages/memory/adapters/` Artifact 到 Memory 的转换适配器。
- Thesis 和 Prediction 的 Memory 沉淀。
- Save、retrieve、update 和本地持久化测试。
- Memory 架构设计文档和治理状态同步。

Out of scope:

- 完整聊天记录、Prompt、Agent trace 或 Harness Session transcript 存储。
- Vector Database、Graph Database、SQLite、复杂 RAG 或语义检索。
- Review、Evaluation、Outcome 或投资决策逻辑。
- DeepSeek Harness Core 或冻结架构文档修改。

## Architecture

```text
Thesis / Prediction Artifact
            ↓
ArtifactMemoryAdapter
            ↓
MemoryProvider
            ↓
Local JSON File
```

Artifact Adapter 负责领域映射；Memory Provider 负责 Entry 的存储、检索和更新。上层不依赖 JSON 文件格式，未来可替换为 Vector 或 Graph Provider。

## Memory Entry

```ts
type MemoryEntryType = 'thesis' | 'prediction'

type MemoryEntry = {
  id: string
  type: MemoryEntryType
  content: string
  sourceArtifactId: string
  createdAt: string
  metadata: JsonObject
}
```

`content` 保存 Artifact 的 JSON 序列化结果，以便保留结构化字段；`metadata.sessionId` 保存来源 Harness Session ID。Memory Entry 不保存原始聊天内容。

Entry ID 由 Adapter 基于 Artifact 类型和 Artifact ID 确定性生成，例如：

```text
memory:thesis:<artifact-id>
memory:prediction:<artifact-id>
```

## Memory Interface

Provider 使用异步接口：

```ts
interface MemoryProvider {
  save(entry: MemoryEntry): Promise<MemoryEntry>
  retrieve(query?: MemoryQuery): Promise<MemoryEntry[]>
  update(id: string, patch: MemoryEntryPatch): Promise<MemoryEntry>
}
```

`MemoryQuery` 至少支持：

- `id`
- `type`
- `sourceArtifactId`
- `sessionId`

`MemoryEntryPatch` 只允许更新 `content` 和 `metadata`。`id`、`type`、`sourceArtifactId` 和 `createdAt` 在 MVP 中保持稳定，避免破坏引用关系。

Save 对重复 ID 失败，更新必须通过 `update()` 显式执行。Retrieve 返回新的数组和 Entry 对象，调用方修改结果不会改变 Provider 内部状态。

## Local JSON Provider

`LocalJsonMemoryProvider` 接收调用方提供的 JSON 文件路径：

```text
<memory-file>.json
```

存储格式为 JSON array of `MemoryEntry`。Provider 行为：

1. 首次访问时创建父目录和空 JSON 文件。
2. 读取文件并验证 Entry 结构。
3. `save()` 追加新 Entry 并持久化。
4. `retrieve()` 在本地 Entry 集合上按 Query 过滤。
5. `update()` 修改允许字段并持久化。
6. 使用临时文件写入后替换目标文件，避免产生半写入 JSON。

该 Provider 只使用 Node 内置文件 API，不引入外部数据库或新依赖。

## Artifact Memory Adapter

`ArtifactMemoryAdapter` 支持：

- `saveThesis(thesis)`
- `savePrediction(prediction)`
- `saveArtifact(artifact)`，当前只接受 Thesis 或 Prediction

映射规则：

| Artifact | Memory type | sourceArtifactId | content | metadata |
| --- | --- | --- | --- | --- |
| Thesis | `thesis` | `thesis.id` | `serializeThesis(thesis)` | `sessionId`, `artifactType` |
| Prediction | `prediction` | `prediction.id` | `serializePrediction(prediction)` | `sessionId`, `artifactType` |

Adapter 不保存 Evidence，因为 MVP 重点是可复用研究结论和待评估预期；Thesis 内部的 `evidenceIds` 已保留证据关系。

## Retrieval and Update Semantics

基础验证流程：

1. 创建 Thesis 或 Prediction Artifact。
2. Adapter 转换为 Memory Entry 并调用 `save()`。
3. Provider 将 Entry 写入 JSON 文件。
4. 使用 `sourceArtifactId` 或 `sessionId` 查询。
5. 使用 `update()` 修改内容或 metadata。
6. 再次读取确认更新结果持久化。

MVP 只提供精确字段过滤，不提供全文、向量或语义检索。

## Validation Plan

必须验证：

- TypeScript strict typecheck。
- Memory Entry Schema 校验。
- Local JSON Provider 的 save/retrieve/update。
- 重启新的 Provider 实例后数据仍可读取。
- Thesis 和 Prediction Adapter 映射正确。
- `sourceArtifactId`、`sessionId` 和 Artifact JSON 内容保留。
- 重复 ID、未知 ID 和无效 Entry 被拒绝。
- 现有 Artifact、Skill、Capability 和 Harness Session 测试不受影响。

## Future Evolution

未来可在不改变 Artifact Adapter 合同的前提下增加：

- Vector Memory Provider。
- Graph Memory Provider。
- 全文和语义检索索引。
- Review/Evaluation Entry 类型。
- Prediction Outcome 与 Memory Update 闭环。

这些演进必须通过新的 ADR 和独立任务实现，不能把外部存储耦合进 Artifact 类型。

## Acceptance Criteria

- `packages/memory/core`、`providers`、`adapters` 存在并有清晰边界。
- `save()`、`retrieve()`、`update()` 可用。
- Local JSON Provider 可持久化。
- Thesis/Prediction 可转换为 Memory Entry。
- Retrieval test 可保存并查询对应研究记录。
- `docs/architecture/RESEARCH_MEMORY_DESIGN.md` 与实现一致。
