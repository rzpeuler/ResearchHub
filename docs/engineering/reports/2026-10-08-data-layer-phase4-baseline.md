# Data Layer Phase 4 Baseline Validation

**Purpose:** Preserve exact pre-implementation test results for comparison with the Phase 4 branch.

**Source revision:** `ef3634e70e193a1f2a37172738253d3c014d9c8a` (Phase 3 accepted SHA; identical to `main`, `origin/main`, and the Phase 4 branch baseline at run time).

**Run location:** Detached clean Phase 3 worktree at the same source SHA, using the repository's shared `node_modules` junction. No source files were changed for this run.

## Results

| Command | Result |
| --- | --- |
| `npm run client:test` (via `npm test`) | 9 test files, 97 passed, 0 failed |
| `npm run test:node` | 239 test files discovered; 2,071 tests, 2,046 passed, 25 failed |
| `npm test` | Exit code 1 because the baseline Node suite has 25 failures |
| `npm run typecheck` | Passed (`tsc --noEmit`) |
| `npm run client:typecheck` | Passed (`tsc --noEmit -p client/tsconfig.json`) |
| `npm run client:build -- --outDir <archive path>` | Passed; output isolated under the local archive. Vite emitted its existing warning for a 628.73 kB JavaScript chunk. |

The full captured Node output is retained locally at `C:\Users\Administrator\Desktop\ResearchHub_worktrees\_archive\DL_GOAL_004-baseline-node-2026-10-08.log`.

## Exact baseline failing test names

1. `Application Industry research projects canonical graph and replays semantic objects without duplication`
2. `Workflow Definition Registry exposes the current executable research set`
3. `Workflow metadata composes canonical peers without registering composite Skill IDs`
4. `Theme graph includes only human-confirmed scope refs, preserves direction, and never expands global edges`
5. `Industry projection returns bounded facts, deterministic core views, publication-labeled dates, future catalysts and competition units`
6. `semantic section classification receives only readable facts and cannot block the base projection`
7. `current restricted or expired source rights suppress company exposures and dependent competition data`
8. `company projection is readable through a canonical business exposure without adding a company graph node`
9. `stale expected revision and a corrupt scope ledger fail closed`
10. `Gateway creates a competition Module and maps its local proposal ID`
11. `Gateway blocks numeric Module cells that disagree with their canonical facts`
12. `same Industry table replays idempotently with the same canonical Module ref`
13. `evidence-backed cell update commits, and an unavailable update preserves the prior usable value`
14. `same Claim may support a canonical numeric display update after new provenance is admitted`
15. `Module blocks the whole submit when a cell reference cannot resolve`
16. `ChangeSet validation rejects denied or missing Raw evidence listed by a competition Module`
17. `Module blocks when the row Source payload is unusable`
18. `Module blocks unusable Source evidence inherited from an existing business_exposure Relation`
19. `new Claim provenance alone cannot justify a contradictory same-reference display value`
20. `Writer rejection does not report success or overwrite the prior Module`
21. `different rows may retain different currencies and a changed column schema blocks for review`
22. `composition is source-immutable, deterministic and idempotent`
23. `FIX-015 offline evidence inputs preserve authoritative contracts and expected source sizes`
24. `V39 acquisition calls all three AKShare methods`
25. `V65 source acquisition time is distinct from historical valuation context`

The baseline comparison must use these exact names, not just a failure count. Failures in Industry projection and Competition Gateway overlap the Phase 4 surface and therefore require review even though they predate Phase 4 implementation. The remaining failures are also retained in the comparison set; they are not presumed harmless or ignored without checking final results.

Focused suites were not run separately; the full Node and client suites were captured above.
