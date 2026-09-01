# Real Runtime Environment Bootstrap Design

## Scope

Standardize local Real Runtime and Real Knowledge Validation startup on
Node's native `--env-file=.env` bootstrap. This task adds one generic npm entry
for the existing reusable Knowledge smoke runner and deterministic fake-value
coverage for the bootstrap boundary. It does not execute product validation or
change DSH, Workflow, Skill, Provider, or model semantics.

## Architecture

The process bootstrap owns `.env` loading:

`ResearchHub/.env` -> `node --env-file=.env` -> `process.env` ->
`loadLocalRuntimeConfig()` -> Harness / Provider.

DSH remains environment-source agnostic and reads only the supplied
`process.env`-shaped input. No dotenv dependency or second parser is added.

The canonical command is:

`npm run knowledge:smoke:real`

which invokes the existing runner with `node --env-file=.env --import tsx`.
Task-specific identity and evidence paths remain environment overrides and are
not embedded in `package.json`.

## Verification

The bootstrap test creates a temporary fake env file and launches a child Node
process with a fake parent environment. It verifies the actual Node runtime
precedence for duplicate variables, confirms the resulting values are visible
through `process.env`, and confirms `loadLocalRuntimeConfig()` maps those values
without reading `.env` itself. The test never reads the repository `.env`.

The only authorized external check is one `/models` request launched with the
canonical `.env` bootstrap. Its evidence is limited to provider, model, baseUrl
host, HTTP status, and READY/BLOCKED classification. Any BLOCKED result stops
the task before S3 or other real Knowledge operations.
