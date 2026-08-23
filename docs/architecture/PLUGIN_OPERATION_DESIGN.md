# Plugin Operation Design

Plugins expose typed external-resource operations to Skills and the DSH.
There is no standalone operation layer between Skill and Plugin.

## Contract

`PluginDefinition` pairs a Harness schema with a TypeScript input/output
contract. `PluginRegistry` registers `DataPlugin` implementations and returns
typed `PluginHandle` values. Registry fetches validate JSON-safe metadata,
clone returned data, and invoke the Plugin-owned data validator.

## Domain Plugins

- Market Plugin: normalized market snapshots.
- News Plugin: normalized company-news evidence.
- Financial Plugin: reported statements and metrics.
- Announcement and Media Plugins: source-specific information adapters that
  feed the News Plugin contract.

These operations perform input normalization and output validation because the
boundary is part of the external-resource contract. They do not plan research,
select Workflows, or create research conclusions.

## Harness tools

Plugin tools are thin adapters that expose a stable operation schema and call an
injected Plugin. The DSH remains the only component that selects a Workflow or
coordinates a research request.

## Testing

Tests cover typed registration, duplicate and unknown handles, source errors,
metadata validation, JSON safety, fixture adapters, primary/fallback behavior,
and Skill integration without network access.
