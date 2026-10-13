# RHL-UX-004 Implementation Report

- Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`
- Baseline: `origin/main` at `97de5094067792f6aee3ab1ed2a5c62757c2f20d` (accepted UX-003 merge)
- Branch: `codex/ux-004-interaction-polish`
- Interaction contract: [UI Interaction Contract](../specs/2026-10-13-rhl-ux-004-ui-interaction-contract.md)
- Responsive matrix: [Responsive Layout Acceptance Matrix](../specs/2026-10-13-rhl-ux-004-responsive-layout-acceptance-matrix.md)
- Browser evidence: [RHL-UX-004 Browser E2E Evidence](../../../tests/validation/evidence/RHL-UX-004-BROWSER-E2E-001.md)
- Test report: [Test & Regression Report](2026-10-13-rhl-ux-004-test-regression.md)
- Remaining limits: [Remaining UX Limitations](../specs/2026-10-13-rhl-ux-004-remaining-limitations.md)

## A. Git baseline and scope

The UX-004 worktree started at the fetched `origin/main` commit above and uses branch `codex/ux-004-interaction-polish`. It contains only UX-004 client, test, and evidence changes. No merge to `main` was performed. UX-001 conversation persistence/title precedence, UX-002 request/SSE semantics, and UX-003 Workflow state ownership were retained.

## B. IME and keyboard interaction

Composer Enter and the Send button share the same submission path. Shift+Enter preserves a newline. Composition-state, `isComposing`, and key code 229 prevent candidate confirmation from sending. Empty and in-flight submissions remain blocked by the existing operation guard. Component tests cover composition and duplicate handling. Browser E2E-01 used synthetic CompositionEvents; native Windows IME remains `NOT_DRIVEN`. E2E-02 submitted by Enter and verified the Shift+Enter event was not prevented; headless Edge required CDP `Input.insertText` to supply the default newline action.

## C. Scroll and reading position

Memoized `ConversationTimeline` tracks session-local positions by conversation, follows only when the user remains near the tail, preserves position through stream and reflow updates, and exposes a visible jump-to-latest button. Component tests cover long content and A/B restoration. Browser E2E-03/04 generated 200 streamed segments and a real overflow (`scrollHeight=707`, `clientHeight=586`); the scroll position stayed at 0 during more stream output, then the button returned the reader to the tail and hid.

## D. Message copy

`CopyMessageButton` copies only its supplied readable message text through Clipboard API, reports success/failure, and labels streaming content as “copy visible content so far”. Component tests cover success and rejection. Browser E2E activated the visible assistant copy control and observed the success live region; system clipboard contents were not separately read.

## E. Conversation history

History loading, no-results, clearing search, retry, title truncation, filtered active title, rename conflicts, and archive/restore feedback were improved without changing UX-001 metadata/version semantics. Component tests cover the conflict and feedback paths. Browser E2E performed visible UI search/clear, rename, archive, and restore. The browser actions were pointer-driven; a full keyboard-only history sequence remains unverified.

## F. Long-running Agent and Workflow UI

The timeline is memoized against unrelated parent updates, tool activity is collapsible, and Workflow stage/provider lists are bounded and scrollable. Terminal and accepted state announcements are concise; the full transcript remains outside a live region. E2E-07 held `company_research` run `90b927c0-0c26-4661-bf00-e1ede9c0853c` at `data_acquisition`, switched A→B→A through visible UI, confirmed B had no Activity/run and A retained the same active run/stage, then released the run and observed completion. E2E-10 refreshed a held run and observed the same run/stage restored. No Workflow lifecycle or Pi lifecycle code was changed.

## G. Responsive layout

Production Client was exercised at 1440, 1024, 768, 390, and 320 px in Edge. At each width `document.documentElement.scrollWidth` and body width matched the viewport. The compact Workflow drawer was opened at 320 px; modal semantics, focus on the close control, Escape dismissal, and focus restoration were verified. Screenshots are retained under `tests/validation/evidence/ux004-browser/`.

## H. Accessibility and focus

The Workflow drawer has a named modal dialog, `aria-expanded`/`aria-controls` trigger state, focus entry/restoration, Escape and backdrop close, and background inertness while open. Timeline announcements do not read every streamed token. Browser evidence validates drawer focus and search-clear focus. Keyboard-only rename/archive/restore and real OS IME remain limitations.

## I. Browser E2E evidence

The fixture served the production Vite build through a real `ResearchHubRuntimeServer` and persistent Pi `SessionManager`, with a fresh isolated Schema 0.4 Knowledge Base and faux providers (`allowModelNetwork=false`). It verified chat submit, scroll hold/jump, copy feedback, history actions, held Workflow A/B/A, refresh recovery, and SSE disconnect/reconnect (`connected → disconnected → connected`). Native IME is recorded as `NOT_DRIVEN`, not passed. Full case-by-case evidence and IDs are in the linked acceptance record.

## J. Performance and regression

`npm run typecheck`, `npm run client:typecheck`, and the production build passed. Client tests passed 150/150. Full Node regression produced 2,222 pass / 21 fail, with all 21 failure blocks exactly matching clean `origin/main` baseline; see the [Test & Regression Report](2026-10-13-rhl-ux-004-test-regression.md). The production JS chunk is 672.74 kB and retains Vite's >500 kB advisory. No separate UX-004 timing benchmark was required or claimed.

## K. Knowledge isolation and safety

Browser E2E used an isolated temporary Knowledge Base with no mounted user KB, provider credentials, or model network. The recorded before/after SHA is identical in each test fixture. Workflow Knowledge Gateway was skipped because the controlled run lacked write authorization. Temporary fixture listeners were stopped and verified closed.

## L. Remaining risks

- Native Chinese IME and native mobile virtual keyboard behavior need manual device acceptance.
- Browser copy success feedback was observed, but clipboard contents were not separately asserted in E2E; component tests validate the supplied text and failure path.
- Full keyboard-only history operations were not browser-verified.
- Headless Edge required explicit text insertion to emulate Shift+Enter's browser default newline action.
- The existing Node baseline has 21 unrelated failures; no new failure was introduced.

## M. Git delivery

Delivery is limited to branch `codex/ux-004-interaction-polish`. The exact final commit SHA, matching remote ref, and clean-worktree result are recorded in the final delivery message after commit and push. No merge to `main` is performed.
