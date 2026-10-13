# RHL-UX-004-BROWSER-E2E-001 — Browser Acceptance Evidence

Date: 2026-10-13 (Asia/Shanghai)
Worktree: `C:\Users\Administrator\Desktop\ResearchHub_worktrees\UX_004`
Branch: `codex/ux-004-interaction-polish`
Base HEAD used for the branch: `97de5094067792f6aee3ab1ed2a5c62757c2f20d` (browser ran the production build of the UX-004 working tree on top of this base).

## Environment and method

- Windows desktop, Microsoft Edge headless, CDP on `127.0.0.1:50848`.
- Production React client built with `npm run client:build` (Vite; 183 modules; build succeeded; emitted the existing >500 kB chunk advisory).
- Real `ResearchHubRuntimeServer` and Pi `SessionManager` were started by `tests/validation/ux004-browser-fixture.ts`. The browser loaded the production build through a local fixture proxy. The fixture used a newly-created isolated schema v0.4 Knowledge Base and faux Pi/provider adapters; `allowModelNetwork:false`. No mounted user Knowledge Base, provider credentials, or authenticated model were used.
- Fixture commands: `node --import tsx tests/validation/ux004-browser-fixture.ts`; browser driver and scenarios were run with `node tests/validation/ux004-browser-driver.mjs ...` and `node tests/validation/ux004-browser-acceptance.mjs ...`.
- The fixture was stopped through its `stop` control after evidence capture. Its owned listeners on ports 54724 and 54725 were confirmed closed. Edge/CDP was left running because it is the shared browser host.

## E2E observations

| Case | Result | Evidence |
|---|---|---|
| E2E-01 composition / IME | `PARTIAL — OS IME NOT_DRIVEN` | Synthetic `compositionstart` + Enter was exercised; Enter did not submit and the text remained. This is not native Chinese IME evidence. Manual checklist: use a real Chinese IME on Windows; start composition in the prompt; press Enter to choose a candidate and verify no submission; complete composition; press Enter once and verify one submission. |
| E2E-02 keyboard submission | `PASS` with CDP caveat | Enter submitted a prompt through the visible composer; one accepted Activity was observed. Shift+Enter was delivered as a key event and remained unprevented; headless Edge did not insert the newline default action, so the driver used CDP `Input.insertText` to provide the newline before the second Enter. The two-line prompt then submitted. |
| E2E-03 scroll hold | `PASS` | Long faux response created actual message overflow (`scrollHeight=707`, `clientHeight=586`). After mouse-wheel scroll to `scrollTop=0`, additional streamed content arrived while `scrollTop` stayed 0 and the jump control stayed visible. |
| E2E-04 jump to latest | `PASS` | Clicked the visible jump-to-latest control during the same stream. It moved to `scrollTop=167` with `scrollHeight=753`, `clientHeight=586`, satisfying the tail threshold; the jump control became hidden. Screenshot: `ux004-browser/scroll-paused.png`. |
| E2E-05 copy | `PASS` for UI feedback | Clicked the rendered assistant copy control using CDP pointer input; the page live region reported `已复制`. Clipboard contents were not separately read or asserted. |
| E2E-06 history | `PASS` for exercised actions | In the visible UI, renamed an inactive conversation, archived it, showed archived history, restored it, searched for the renamed item, and cleared search. Search input retained focus after clearing. No-results behavior was not tested. |
| E2E-07 workflow session switch | `PASS` | With visible `公司深度研究` selection, started held Workflow A and verified it running at `data_acquisition`. Created B through New Conversation; B had zero Activities, no run card, and no running Workflow. Returned to A by its history entry and verified the same run ID, stage, subject, and started Activity. Then released the hold and the run completed. IDs and detailed timeline below. |
| E2E-08 responsive widths / drawer | `PASS` for layout and drawer checks | At widths 1440, 1024, 768, 390, and 320 px, `documentElement.scrollWidth` and body scroll width matched `innerWidth`. At 320 px opened the research-background drawer; dialog was modal and close button received focus. Escape closed it and focus returned to the drawer toggle. |
| E2E-09 focus and keyboard behavior | `PARTIAL` | Drawer focus entry, Escape close, focus restoration, composer Enter, and search clear focus were observed. History rename/archive/restore themselves were pointer-driven; a complete keyboard-only history workflow was not tested. |
| E2E-10 refresh and SSE reconnect | `PASS` for exercised paths | A held Workflow was refreshed and restored with the same run/subject/stage. Separately, the `/api/events` SSE connection returned HTTP 200, was deliberately interrupted (`net::ERR_INCOMPLETE_CHUNKED_ENCODING`), and reconnected with HTTP 200; UI connection status changed connected → disconnected → connected and the terminal run remained visible. |

## Real Runtime Workflow evidence

### Refresh and runtime/provider observations

- Workflow run: `3f88cc9a-6375-4b18-8ffb-b9226d70e581`.
- Selected in the visible form: `company_research` / `公司深度研究`.
- Prompt: `请对跨境通（002640）进行公司深度研究 UX004 1791855030840`.
- Conversation: `01a132e1-a309-74b6-93f1-95a97e869e71`.
- Accepted Activity: `5ebb8894-8072-4478-bd97-6b2d8f5f09b5`.
- `hold-acquisition` kept the run at `data_acquisition`; after browser refresh, the same run and verified subject `跨境通` were rendered at that stage. Fixture release completed the run.
- Final API observation: completed; AKShare skipped (three unsupported diagnostics), CNINFO failed with zero records, GDELT succeeded with one record. Knowledge write was not authorized; Knowledge Gateway was skipped. Report and bundle references were available.
- Isolated Knowledge Base SHA-256 before and after: `53654452413c9e3161af00614c583bfd22e681c48dd4d6790a1e356dfefcdc38` (unchanged).

### A → B → A while Workflow remained active

- Workflow run: `90b927c0-0c26-4661-bf00-e1ede9c0853c`.
- Conversation A: `01a132e5-37f3-7637-b0b6-dec8d3aa0b6e`.
- Accepted Activity: `89f4164d-e9df-4762-81d8-b4f9923624eb`.
- While held, authoritative API reported `status=running`, `currentStageId=data_acquisition`, revision 5; the accepted Activity was `started` / `workflow_started`, and A's `latestWorkflowRunId` matched the run.
- The visible New Conversation action switched to B. B displayed no Activity, no Workflow run card, and “没有运行中的工作流”. Selecting A from history returned to the same run at `data_acquisition`, with Activity still started. The fixture was then released; API snapshot showed completed stages and terminal run status `completed`.
- Provider observations: AKShare skipped (3 `PROVIDER_UNSUPPORTED` diagnostics), CNINFO failed (`PROVIDER_ATTEMPT_FAILED`, 0 records), GDELT succeeded (1 record). Knowledge Gateway skipped because the run did not authorize a Knowledge write.
- Isolated Knowledge Base SHA-256 before and after: `633c356822d19e018e768b41127502f93519476db13725cb801764bbe8b75c9f` (unchanged).

## Screenshots

Screenshots captured from the actual Edge page are retained in `tests/validation/evidence/ux004-browser/`:

- `ux004-browser/home-1440.png`, `home-1024.png`, `home-768.png`, `home-390.png`, `home-320.png`
- `ux004-browser/drawer-320.png`, `drawer-320-open.png`
- `ux004-browser/workflow-A-B-A.png`
- `ux004-browser/scroll-paused.png`

## Limits

Native operating-system IME behavior remains unverified. The test used synthetic CompositionEvents only. Browser automation used headless Edge/CDP, so platform-native text input behavior and visual rendering differences on a headed user display were not established. Clipboard success was asserted through the application's live-region feedback, not by reading the system clipboard. The faux providers and isolated fixture prove the client-to-real-Runtime path and state transitions, not external provider availability or production Knowledge writes.
