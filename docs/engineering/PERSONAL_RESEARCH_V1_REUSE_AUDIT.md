# Personal Research v1 Reuse Audit

Date: 2026-09-08
Scope: first A-share Company Deep Research foundation

## Decision summary

ResearchHub keeps its current Workflow / Skill / Plugin / Knowledge boundaries. The original ResearchHub assets were audited locally under `C:/Users/Administrator/Desktop/ResearchHub/packages`; external repositories were checked for license and maintenance signals. No legacy `packages/` tree or DSH/Capability/Provider framework is copied.

| Asset | Decision | Rationale |
| --- | --- | --- |
| Original `packages/plugins/news/acquisition` search/fetch/normalize/evidence shape | ADAPT | Existing contracts map cleanly to the narrow Lite acquisition contract; canonical Knowledge writes must remain Lite-owned. |
| Original CNINFO official-announcement provider | ADAPT | Preserve official disclosure priority and request shape, with a Lite-native client and explicit rights/provenance. |
| Original GDELT provider | ADAPT | Reuse the query/result semantics, but use the Lite native fetch boundary and bounded candidate count. |
| Original `packages/skills/company-research` | REFERENCE | Its workflow is coupled to the old artifact/harness architecture; only methodology headings and evaluation ideas are retained. |
| Original `packages/skills/equity-research` | REFERENCE | Useful research framing, but not copied as a second orchestration framework. |
| Original `packages/skills/valuation` | REFERENCE | Formula and report ideas inform the small deterministic Lite utilities. |
| Original financial/market plugins | ADAPT | The external-data intent is retained behind an injected AKShare client; no old plugin registry is restored. |
| Anthropic Financial Services / equity-research | REFERENCE | Institutional report discipline and source-priority methodology; MCP/data connectors are out of scope for Lite. Apache-2.0 repository. |
| rollingSirius/equity-research-skill | REFERENCE | Expectations-gap, reproducible valuation, and A-share awareness are useful references; MIT repository with a small maintenance footprint, so no bulk copy. |
| AKShare | DEPEND | External Python dependency/bridge. MIT repository; official README documents A-share history and financial interfaces and warns interfaces may change. |
| GDELT | DEPEND | Public discovery endpoint, accessed through a bounded HTTP adapter; no SDK dependency. |
| RSS / RSSHub-compatible feeds | DEPEND | Feed URLs are runtime configuration; RSSHub itself is not embedded or restored as a service. |
| Trafilatura | DEPEND (optional) / REFERENCE | Mature extraction boundary; use an external adapter when installed. Current releases are Apache-2.0; versions before 1.8.0 are GPLv3+, so the integration must pin and audit the deployed version. |
| Crawl4AI | EXCLUDE for v1 | Python/browser-heavy crawler is unnecessary for the first bounded source set; reserve for JS-heavy sources only after a separate audit. |
| zcker/xueqiu-crawler | EXCLUDE for v1 | Community/social crawler introduces brittle and rights-sensitive collection without being required for the first production loop. |

## License and maintenance notes

- [Anthropic Financial Services](https://github.com/anthropics/financial-services): Apache-2.0 reference repository; the project explicitly stages analyst work product for review and does not provide execution authority.
- [rollingSirius equity-research-skill](https://github.com/rollingSirius/equity-research-skill): MIT; GitHub showed 35 commits and no open issues at audit time.
- [AKShare](https://github.com/akfamily/akshare): MIT; active public repository with documented Python installation and A-share examples.
- [Trafilatura](https://github.com/adbar/trafilatura): Apache-2.0 for current package versions, GPLv3+ before v1.8.0.
- [RSSHub](https://github.com/DIYgod/RSSHub) and [Crawl4AI](https://github.com/unclecode/crawl4ai) were reviewed as active upstream projects, but neither is vendored.

## Resulting implementation boundary

The implemented Lite assets are small adapters and contracts under `plugins/research-acquisition/`, a deterministic Company Research Skill under `skills/company-research/`, a thin acquisition/reporting Workflow under `workflows/company-deep-research/`, and the producer-neutral canonical binding/validation seam under `knowledge/production/`. External network tests remain separate from the normal offline suite.
