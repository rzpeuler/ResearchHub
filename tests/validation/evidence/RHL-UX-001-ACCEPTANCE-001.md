# RHL-UX-001-ACCEPTANCE-001 Evidence

Status: `ACCEPTANCE_COMPLETE / CTO REVIEW PENDING`

- Implementation branch: `codex/ux-001-session-reliability`
- Baseline: `origin/main` `8a7f49d43a01aefd23b72c5103481ad5bdac51aa`
- Accepted candidate before acceptance fixes: `d91397fb0398c3725ed8a3d71b80f9d2d4ef548d`
- UI/Activity acceptance fix commit: `b6bcc1546c7fba61f017966efe6ace90047876d8`

This record captures actual Edge browser state from the production React build served by `ResearchHubRuntimeServer`, plus direct read-only Runtime API observations. The fixture used a fresh Schema 0.4 Knowledge Base, persistent Pi `SessionManager`, faux Pi provider with model network disabled, and a controlled Company Research adapter. It did not use a mounted user Knowledge Base, external credentials, or authenticated model/provider traffic.

## Browser observations

### Primary acceptance run

Initial Runtime origin was dynamically assigned `http://127.0.0.1:63020`; after Runtime restart it was `http://127.0.0.1:63317`. The fixture Knowledge Base hash was `011fb775096928602e31620fad293f6b620fdd500eec47c2425a7ce5bc83c253` before and after restart.

| Scenario | Actual browser operation and observed assertion | Result |
|---|---|---|
| B1 first message | Sent `帮我研究002640`; history showed title `帮我研究002640`, and the timeline displayed `你 · 已提交请求` plus the original request text. Created a second conversation, switched back, and refreshed; the first conversation's title/activity remained. | PASS |
| B2 Workflow naming | Selected `company_research`, sent `帮我研究002640`, and the fixture resolved entity `跨境通`. History and heading showed `跨境通 · 公司深度研究`; the timeline showed `工作流 · 已启动 · workflow_started` and run `b5940a97-db18-404c-9d6c-005a012502e9`. Refresh preserved both. | PASS |
| B3 manual name | Renamed the conversation to `跨境通跟踪`; launched another Company Research run `443e2002-c88c-49e7-8b81-9f332de8d632`; history and heading retained `跨境通跟踪`. Renamed again to `新对话`, launched run `7087dc37-52fb-4a2f-a6a2-7fe97a73db8b`, and confirmed the title remained `新对话`. Refresh and Runtime restart preserved the manual title. | PASS |
| B4 archive/restore | Archived the conversation from its history controls while its Workflow was running. It disappeared from active history, appeared in the archived view, opened with its activities, and restored to active history. The Runtime showed the Workflow still running during archive/restore. | PASS |
| B5 session isolation | Submitted `第二个会话隔离检查` in a second conversation, returned to the first, and checked the first timeline: it retained its own four Activities and run IDs, with no second-conversation request text. | PASS |
| Runtime restart | Restarted the Runtime on the same fixture roots. The selected conversation, title, Activity order, and run associations restored. Started runs became `interrupted`; no live status was fabricated. | PASS |

After restart, the first conversation had ID `01a12f90-33c4-7532-b8e2-7dc43b065faa`; the separate conversation used for isolation had ID `01a12f92-94b4-7532-b8e2-7dc6e5af0f1b`. Its four Activities were returned by `GET /api/conversations/:id/activities` in `createdAt` order, once each. The three started Workflow IDs listed above were present; the fourth Activity was a not-started request and had no Workflow ID.

The browser timeline explicitly identifies Activity rows as `你 · 已提交请求` and includes Activity status/outcome and run ID. Actual Pi transcript rows remain separately sourced from Pi. The client test additionally asserts chronological interleaving of Pi messages and Activities, suppresses an Activity only when the corresponding `chat_started` user message is in the Pi transcript, and keeps `workflow_started`/`not_started` requests distinct.

### Targeted browser recheck after acceptance fix

A fresh fixture at `http://127.0.0.1:65155` independently rechecked the production UI rename and archive behavior after the `PATCH` correction. The UI changed `跨境通 · 公司深度研究` to `跨境通跟踪`; a second Company Research Activity appeared without replacing the title. The two Workflow IDs were `dd83f23e-a7ff-4c8a-9c60-f1f164b8abc8` and `c06c58e0-1918-4ce9-8b87-56d72d7fbfc5`. While archived, read-only `GET /api/workflows/:id` still returned `status: running`; the conversation was present in the archive view and restored through the UI.

## Baseline failure comparison

The same `npm test` command ran on UX-001 and a clean `origin/main` worktree at the SHA above. Client results were 134/134 on UX-001 and 124/124 on baseline. Node results were 2,206 passed / 21 failed (2,227 total) on UX-001 and 2,185 passed / 21 failed (2,206 total) on baseline.

The 21 failure blocks were normalized for elapsed-time noise and checkout-root paths, then compared in full. This comparison included test file/name, error text, actual/expected values, source location, and stack frames. Both sides contained 21 blocks and had zero differences. SHA-256 of each normalized failure-block sequence was identical:

`bc52d9b732f93a6cd9cabfee672eed8be93423f8f0925f6b61cf4c573f58cb81`

Failure categories were 1 Research Skill architecture assertion, 6 Theme Workspace projection assertions, 12 Competition Module Gateway assertions, 1 remaining Schema delta assertion, and 1 FIX-015 generated Schema size assertion. FIX-015 reports actual `6881`, expected `6359` on both branches. The UX-001 diff changes no Schema generator, Schema fixture, Schema validator, or imported dependency in that path; changed paths are Runtime/session metadata, dispatch, React client, tests, and reports.

## Concurrency and safety evidence

- `conversation-state-store.test.ts`: identical operation replay is idempotent; changed text or Workflow intent for the same operation ID conflicts; 20 concurrent per-session accepted requests serialize without loss; simultaneous rename/archive mutations using the same expected revision allow exactly one winner and reject the stale loser in both call orders; stale expected revisions conflict; a USER title survives later Workflow title candidates.
- `slice-c.test.ts` and `ux001-lifecycle.integration.test.ts`: accepted dispatch replay returns the same run ID without starting a duplicate; changed replay is rejected; unassociated dispatch is rejected; after restart a started run is interrupted and `GET /api/workflows/:id` returns 404.
- `slice-a.test.ts`: deleted Pi transcript/sidecar identity cannot be rebound as another conversation; conversations remain switchable and Pi transcript switching is persistent.
- `slice-b.test.ts`: Runtime requests require exact loopback Host, Origin, and nonce token; public/LAN binding is rejected; sensitive names are redacted before Pi persistence/client projection.
- Browser fixture hashes the isolated Knowledge Base before/after Runtime restart; the hash remained unchanged.

## Fix and validation record

Real browser rename first exposed that the client used `POST` while Runtime registered `PATCH /api/conversations/:id/metadata`. `client/src/api/runtime-client.ts` now sends `PATCH`, with a method assertion in `client/src/api/runtime-client.test.ts`. `client/src/App.tsx` now merges typed Activities and Pi messages by timestamp in the Conversation timeline without fabricating Pi transcript rows. The UI changes are covered by `client/src/App.test.tsx`.

The full implementation report is [`2026-10-12-rhl-ux-001-implementation.md`](../../../docs/engineering/reports/2026-10-12-rhl-ux-001-implementation.md). The browser fixture is [`ux001-browser-fixture.ts`](../ux001-browser-fixture.ts).

The final focused UX-001 Runtime suite after the added race test passed 106/106. The dedicated conversation-state-store suite passed 14/14.

The last supplemental browser recheck's isolated temp root is `C:\Users\Administrator\AppData\Local\Temp\researchhub-ux001-browser-mdovIz`. Its listener and browser tab are closed. Automatic command review rejected both recursive and per-entry cleanup attempts, so this fixture-only directory remains outside the repository; it contains only the faux Agent/session state and isolated test Knowledge Base described above.
