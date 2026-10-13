# RHL-UX-004 Remaining UX Limitations

Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`

## Input method testing

The browser automation environment does not provide a real operating-system Chinese IME. No claim is made that Microsoft Pinyin or another native IME was driven. Component-level CompositionEvent/`isComposing`/keyCode-229 regressions and browser keyboard checks cover the guard contract. Before final product acceptance, perform the manual checklist below on a Windows device with Microsoft Pinyin.

1. Focus the composer and type a multi-character Chinese phrase using Pinyin.
2. Press Enter while the candidate list is open; confirm the candidate is committed and no request is sent.
3. Press Enter again after composition ends; confirm exactly one request is sent.
4. Repeat with Shift+Enter and confirm a newline without sending.
5. Repeat while a request is in flight and confirm no duplicate operation is created.

## Browser environment limits

- E2E used a local isolated Knowledge Base and a faux Pi provider with model network disabled. It validates the production Client and actual Runtime/session paths, not authenticated external provider behavior.
- The 320 px layout was browser-viewport tested; native mobile virtual-keyboard occlusion was not available in the desktop Edge automation session.
- Browser automation observed the copy success live region, but did not read the system clipboard. Component tests verify the text passed to Clipboard API and the failure path.
- Browser history rename/archive/restore was pointer-driven. Before final accessibility acceptance, complete a keyboard-only pass: search, clear, start/cancel/commit rename, archive, switch archived view, and restore while checking focus after each action.
- Browser history search with zero results was not directly exercised; component tests cover the empty result state.
