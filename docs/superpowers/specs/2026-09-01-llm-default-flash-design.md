# DeepSeek V4 Flash as ResearchHub Default

## Status

Approved design for `RH-LLM-DEFAULT-FLASH-001`.

## Goal

Change the ResearchHub default DeepSeek model from `deepseek-v4-pro` to
`deepseek-v4-flash` for normal production and local configuration, while
preserving explicit `RESEARCHHUB_LLM_MODEL` overrides. Pro remains a valid
explicit choice.

## Scope and constraints

- Change `DEFAULT_LLM_MODEL` in `dsh/llm-runtime/local-runtime-config.ts`.
- Change the default model in `.env.example`.
- Update the ignored local `.env` to Flash without exposing or tracking credentials.
- Update offline configuration tests to cover default Flash, explicit Flash, and explicit Pro.
- Add a governance decision and current-status/changelog entries.
- Do not change provider, base URL, credential handling, enablement logic, reasoning, temperature, max tokens, adapters, Workflow, Knowledge code, or historical evidence.
- Do not run real DeepSeek, real LLM, or real PDF validation.

## Design

The existing precedence remains unchanged:

```text
RESEARCHHUB_LLM_MODEL override -> DEFAULT_LLM_MODEL -> deepseek-v4-flash
```

Only the fallback constant changes. The model value continues to flow through
the existing `LocalKnowledgeProductValidationConfig` and injected adapter
boundaries. No routing, fallback chain, task-specific selector, or new config
layer is introduced.

Historical `deepseek-v4-pro` occurrences in product-validation evidence,
historical changelog, decision records, and prior design documents remain
unchanged because they record actual past execution. Current active defaults
and their tests change to Flash. An explicit Pro override test proves Pro is
still supported.

## Validation

Run only deterministic checks:

- local runtime configuration tests;
- DSH adapter/config tests if affected;
- TypeScript integration typecheck;
- repository audit of remaining `deepseek-v4-pro` occurrences;
- `git diff --check`.

Confirm `.env` is ignored and untracked, credentials are not displayed or
committed, the Runner still consumes `config.model`, and no real LLM request
is made.

## Acceptance

The change is accepted when the default resolves to Flash, explicit Flash and
explicit Pro both resolve unchanged, provider and base URL remain identical,
historical records are preserved, deterministic checks pass, and `HEAD` is
equal to `origin/main` with a clean tracked worktree.
