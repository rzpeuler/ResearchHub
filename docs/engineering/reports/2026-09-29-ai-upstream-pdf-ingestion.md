# AI compute upstream materials PDF ingestion — 2026-09-29

## Input and execution

- Input: `C:\Users\Administrator\Desktop\资料\投研\慧博研报\20260805-西部证券-AI算力行业：AI算力上游材料产业链研究报告.pdf` (103 pages, 3,209,114 bytes).
- Source metadata checked against the cover: 西部证券研究中心, 李寅坤, 2026-08-05.
- Normal `raw-document-knowledge-ingestion` Workflow with `KnowledgeCurationSkill`, the deterministic validators, and Writer. Semantic operations used the explicit Codex CLI `gpt-6-luna` / `high` adapter. Run ID: `ai-compute-upstream-materials-20260928-001`.
- The one-off runner and local verification output are retained under ignored `runtime-data/ingestion-ai-upstream/`; the KB is runtime data outside Git.

## Verified canonical result

The fresh Schema 0.3 KB at `C:\Users\Administrator\Desktop\ResearchHubData\knowledge-bases\ai-compute-upstream-materials-v03` advanced from revision 0 to 1. Writer committed ChangeSet `changeset-ca84c06fd25b6a79`. All 20 extraction units completed. The terminal status is `completed_with_review`, with 3 durable ReviewCases.

V0.3 validation passed with zero errors. Canonical counts are 299 entities, 272 relations, 169 claims, 1 Source, and no ThemeGroup or Module. Source `source:doc-1337460d34c4a60b` references the verified archived original `raw-sha256-998703cef102300518bb2edcbcc3e9bc26fa374f157b0714f3986c5028d78d63` (SHA-256 and size verified).

The local Runtime was mounted against this KB and the `/graph` page was checked in a browser. The directory contains extracted industries, companies, products, and technologies. Rooting at `entity:industry-item-8c448f1b9a623178` displays the `半导体材料`–`磷化铟衬底` relation, and its Inspector shows the report Source and publication metadata.

## Schema 0.4 boundary

The existing v0.3-to-v0.4 migrator failed in **dry-run**, before creating the target KB. The source contains 52 forecast Claims without `probability`; the v0.4 validator requires an explicit probability in `[0, 1]` for every forecast Claim. Confidence is a different field and was not substituted. The target path `C:\Users\Administrator\Desktop\ResearchHubData\knowledge-bases\ai-compute-upstream-materials-v04` does not exist.

Raw ingestion also routed proposed InvestmentTheme creation to Review. No InvestmentTheme or ThemeGroup was canonicalized, so the new Schema 0.4 topic workspace cannot yet present a theme view for this report. The Schema 0.3 graph view remains usable for the committed entity–relation projection.

## Validation

- `npm run typecheck`: passed.
- `npm test`: client 54/54; Node 1592/1592.
- Codex CLI adapter focused tests: 31/31; a real synthetic `gpt-6-luna` / `high` extraction call accepted the strict output Schema and preserved JSON object fields through the transport bridge.
- `npx tsx runtime-data/ingestion-ai-upstream/verify-committed-v03.ts`: passed the KB, Raw, Source binding, and run-log checks.
