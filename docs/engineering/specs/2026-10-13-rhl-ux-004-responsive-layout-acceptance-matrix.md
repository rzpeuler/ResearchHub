# RHL-UX-004 Responsive Layout Acceptance Matrix

Status: `IMPLEMENTED / CTO ACCEPTANCE PENDING`

Browser: Microsoft Edge, actual production React build served by the isolated `ResearchHubRuntimeServer` fixture. Evidence: [browser acceptance report](../../../tests/validation/evidence/RHL-UX-004-BROWSER-E2E-001.md).

| Viewport width | Page horizontal overflow | Chat/composer | History access | Workflow access | Overlay/focus | Result |
|---:|---|---|---|---|---|---|
| 1440 px | None observed | Desktop layout | Visible | Context rail visible | N/A | PASS |
| 1024 px | None observed | Compact desktop layout | Visible | Toggle/drawer | N/A | PASS |
| 768 px | None observed | Tablet layout | Reachable | Toggle/drawer | Viewport-bounded | PASS |
| 390 px | None observed | Phone layout | Reachable | Toggle/drawer | Viewport-bounded | PASS |
| 320 px | None observed | Minimum narrow layout | Reachable | Toggle/drawer | Modal semantics, focus, Escape and focus restoration verified | PASS |

Measured browser `document.documentElement.scrollWidth` and `document.body.scrollWidth` against `window.innerWidth`; both matched `innerWidth` at all five widths. Captured screenshots are retained in `tests/validation/evidence/ux004-browser/`. OS-level virtual keyboard/IME overlay behavior was not driven by this desktop browser environment and remains listed as a limitation.
