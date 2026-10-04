# Global Model Selection Runtime

Date: 2026-10-04

## Runtime behavior

The application settings document stores a single `{ provider, modelId }` for Pi chat and Workflow semantic operations. The server resolves and validates the selection with Pi `ModelRuntime` before creating or replacing an Application Runtime. Candidate availability uses `ModelRuntime.getAvailable()` so OAuth and API key providers are checked through Pi's auth resolution; credential values are never returned. Candidates must accept text and use a Pi API with known tool-call support, because the chat host needs product tools as well as text completions.

Pi Coding Agent and Pi AI are pinned to 0.87.1, whose built-in Codex catalog includes `openai-codex/gpt-6-luna`. The same resolved Pi `Model` is passed to restored and new sessions, and to the shared Workflow executor. Industry, Theme Framework, and raw-document preview no longer create production Codex CLI executors. Theme Framework retains its 180-second timeout and raw-document preview retains its 600-second timeout while using the selected model. The standalone daily-brief CLI reads the same application settings before constructing its Pi executor.

The model setting is application-local and does not change Pi's global default. Explicit `model` and executor injection remains available to offline tests. Runtime replacement can defer the daily scheduler's initial tick until after the replacement has committed.

## Structured output

Pi semantic calls still include the unchanged Workflow output contract in the prompt, enforce the output byte limit and timeout, and parse one JSON value. When a contract is a JSON Schema or the ResearchHub JSON-schema wrapper, the executor also validates the parsed result locally with Ajv and fails closed on a mismatch. Prose-shaped legacy contracts continue to rely on their existing operation-specific Workflow validators. This is post-generation validation; the runtime does not claim provider-enforced strict JSON output for models whose Pi catalog does not advertise it. The previous Codex CLI curation bridge that string-encoded open fields is not needed on the Pi path; Pi receives the original contract and the normal object-shaped result.

## Verification scope

Local unit coverage checks Pi candidate auth gating, `gpt-6-luna` catalog presence, schema-conformant output acceptance/rejection, cancellation, timeout, and JSON parsing. Provider calls are not part of deterministic unit tests; a real model call remains dependent on local provider authentication and connectivity.
