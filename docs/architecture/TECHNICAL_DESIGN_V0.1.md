# ResearchHub Technical Design v0.1 — Single DSH

## 1. Module contracts

### ResearchManager DSH

```ts
class ResearchManager {
  execute(request: ResearchRequest): Promise<ResearchExecutionResult>
}
```

The implementation resolves a validated Workflow from `WorkflowRegistry`,
selects its injected executor, validates the returned Artifact bundle, and
creates a report view. It never calls an external data source directly.

### Workflow

```ts
interface WorkflowDefinition {
  id: string
  version: string
  inputs: WorkflowSchema
  outputs: WorkflowSchema
  steps: WorkflowStep[]
}
```

Workflow definitions are declarative. The existing thin executors adapt a
definition to an approved Skill; they do not become a general workflow engine.

### Skill

```ts
interface SkillMethod<TInput, TResult> {
  execute(input: TInput): Promise<TResult>
}
```

Skill methods receive typed Plugin ports or injected Plugin-backed operations.
They create and link Evidence, Thesis, Prediction, and other existing
Artifacts according to the research method.

### Plugin

```ts
interface DataPlugin<TRequest, TData> {
  readonly name: string
  fetch(request: TRequest): Promise<PluginResult<TData>>
  validate(value: unknown): asserts value is TData
}
```

`PluginRegistry` provides typed handles and JSON-safe boundary validation.
Market, information, and financial adapters implement this contract. Plugin
errors preserve operation, Plugin, source, and request context without adding
research reasoning.

## 2. Data flow and ownership

1. ResearchManager validates the research request and chooses a Workflow.
2. The Workflow executor invokes the selected Skill method.
3. The Skill requests external facts through injected Plugin operations.
4. Plugins fetch, normalize, validate, and return structured data.
5. The Skill creates linked Artifacts using the existing core model.
6. ResearchManager validates the Artifact bundle and returns a Report View.

Workflow does not select sources. Skill does not implement source protocols.
Plugin does not select a research method. These rules keep the three layers
independently testable.

## 3. Errors and validation

- Request validation errors remain owned by ResearchManager.
- Workflow definition errors remain owned by `WorkflowRegistry`.
- Plugin boundary and source errors retain typed Plugin context.
- Skill output errors are rejected before the DSH assembles the report.
- Artifact validation remains delegated to the unchanged Artifact core model.

## 4. Compatibility boundary

The migration changes package paths and architecture names. It intentionally
does not retain the removed top-level directories. Tool names, Workflow IDs,
Artifact schemas, Skill business behavior, and Harness session persistence
remain behaviorally stable unless the new Plugin terminology is part of the
typed contract.
