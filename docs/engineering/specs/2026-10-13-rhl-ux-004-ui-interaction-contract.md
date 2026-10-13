# RHL-UX-004 UI Interaction Contract

Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`

This contract records UX-004 presentation behavior. UX-001 conversation persistence and title precedence, UX-002 operation/SSE/retry semantics, and UX-003 Workflow status ownership remain unchanged.

## Composer

- Enter uses the same submit callback as the Send button. Shift+Enter inserts a newline.
- Composition state, `KeyboardEvent.isComposing`, and legacy key code 229 prevent Enter from submitting an IME candidate.
- Empty input and an in-flight command do not submit. The operation-level in-flight guard remains authoritative for duplicate suppression.
- Submit and retry feedback retain the user's input until acceptance is confirmed.

Implementation: `ResearchPageBody` and `runCommand` in `client/src/App.tsx`; component regressions in `client/src/App.test.tsx`.

## Conversation timeline

- `ConversationTimeline` owns transient scroll position per conversation ID, bounded to 100 remembered conversations.
- At the bottom threshold, new messages and streaming growth follow the bottom. When the user scrolls away, content changes and reflow preserve the reading position.
- The visible “Jump to latest” control returns to the bottom and resumes follow behavior.
- Switching conversations restores that conversation's saved position; a conversation without a saved position starts at the bottom.
- Workflow refreshes and timer updates do not make the whole timeline tree rerender unnecessarily.

Implementation: memoized `ConversationTimeline`, layout/resize observers, and scroll state in `client/src/App.tsx`; tests in `client/src/app/chat/ConversationTimeline.test.tsx`.

## Message copy

- Copy is available for visible readable message content through the Clipboard API.
- Copy feedback reports success or failure briefly and accessibly.
- Hidden reasoning, raw tool arguments/results, and control labels are not copied. A currently streaming message is explicitly identified as partial/current content.

Implementation: `client/src/app/chat/CopyMessageButton.tsx`; tests in `client/src/app/chat/CopyMessageButton.test.tsx`.

## History and accessibility

- Search has a clear action, a no-results state, and loading/error feedback. Failed loads expose Retry.
- Titles remain truncated within their row. The selected conversation title remains tied to the selected conversation while search filters the list.
- Rename, archive, and restore remain versioned asynchronous Runtime operations. Conflicts and failures remain visible; the UI does not show success before confirmation.
- Status announcements are concise and do not put the full streaming transcript in a live region.
- The compact Workflow panel exposes a button with `aria-expanded` and `aria-controls`. On narrow layouts it opens a labelled modal drawer, traps focus, closes on Escape/backdrop, restores focus, and prevents background interaction.

Implementation: `client/src/App.tsx` and `client/src/styles.css`; tests in `client/src/App.test.tsx`.

## Responsive behavior

The existing application shell is retained. At compact widths the conversation history stays reachable, the main composer remains operable, and the Workflow context becomes an explicit overlay drawer. Buttons use touch-sized targets. The tested widths and per-width results are recorded in the [responsive acceptance matrix](2026-10-13-rhl-ux-004-responsive-layout-acceptance-matrix.md).
