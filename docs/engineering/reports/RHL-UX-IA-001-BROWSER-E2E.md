# RHL-UX-IA-001 Browser E2E

Status: `PASS / CTO ACCEPTANCE PENDING`

Baseline: `9ca20a86467767a12feec4e79fb18874a70f99d6` (predecessor WF-PERSIST merge).

## Method

Executed `npm run client:build` followed by `node tests/validation/ux-ia-browser-acceptance.mjs` on Windows, Node v24.16.0, Microsoft Edge headless through CDP. The build passed (JS 687.98 kB, gzip 208.38 kB); Vite retained its >500 kB advisory.

The harness launches the production React assets with real `ResearchHubRuntimeServer`, Application Runtime, Workflow/Research/Report/Bundle services and persisted Pi SessionManager. Company Research starts through the browser composer and actual HTTP dispatch path. CNINFO/GDELT and the Pi model use isolated deterministic providers with model network disabled. These results prove product integration and persistence, not authenticated external-provider or model quality.

Each execution creates a fresh temporary Knowledge Base, conversation store, report store, Bundle store and observation store. No user Knowledge Base or current development Runtime is used. A graceful shutdown is followed by a second Node process using the same isolated stores. The fixture delays one actual upstream Bundle response for the request race; it does not substitute an API payload. Fault cases change only isolated Bundle files and restore the original bytes before continuing.

Evidence: `tests/validation/evidence/RHL-UX-IA-001-BROWSER-E2E.json`. It records actual API response statuses, DOM text, artifact identifiers, process IDs and complete observed Workflow histories. No local absolute paths or credential patterns appear in the artifact.

## Results

| Scenario | Actual evidence | Result |
| --- | --- | --- |
| E2E-01 | Company Research completed through the browser; corresponding Report, Bundle and run IDs verified by actual GET APIs | PASS |
| E2E-02 | Report body rendered before appendix expansion; structured result contains the same run; nested JSON starts collapsed | PASS |
| E2E-03 | Source-library and proposal sections display explicit empty states matching real zero-count Bundle arrays | PASS |
| E2E-04 | Distinct Runtime PIDs 12544 and 34208; after graceful restart, Report appendix loads `historical`, `completed`, all 7 stages; stage, Provider and Skill records exactly match before restart | PASS |
| E2E-05 | Actual gated then cancelled Company Research has no Report; its original conversation Activity opens the correct cancelled Bundle compatibility detail | PASS |
| E2E-06 | Missing file gives empty state; malformed JSON and valid different-run Bundle transplanted into the requested filename give safe errors; Report body remains available; wrong run is absent | PASS |
| E2E-07 | Direct `/bundles` compatibility route lists genuine persisted artifacts; Bundle entry is absent from primary navigation | PASS |
| E2E-08 | 375px viewport has 375px document width; trusted CDP Enter events collapse and expand native summaries; repairing a genuinely corrupt file followed by Retry succeeds | PASS |
| E2E-09 | Actual Bundle response from Report A held for 2000ms; switch to Report B and expand its results; late A response never replaces B data | PASS |

The first keyboard harness attempt lacked the native Enter text payload and failed its control assertion. Adding the standard CDP Enter text and native virtual-key fields resolved the harness interaction; production code was unchanged. The completed run above passed all 11 checkpoints, including three separate E2E-06 fault cases. An additional evidence comparison confirmed exact equality of historical stages, Provider observations and Skill observations.

## Artifact relationships

| Role | Workflow run | Report | Bundle |
| --- | --- | --- | --- |
| Completed A | `794e4f92-0381-442d-b778-412b0a4218ca` | `company-research-002640-794e4f92-0381-442d-b778-412b0a4218ca` | `research-bundle-794e4f92-0381-442d-b778-412b0a4218ca` |
| Completed B | `71dd5cb9-ea29-47ad-b486-e05f2d40a3ce` | `company-research-002640-71dd5cb9-ea29-47ad-b486-e05f2d40a3ce` | `research-bundle-71dd5cb9-ea29-47ad-b486-e05f2d40a3ce` |
| Cancelled, no Report | `774601b9-c49e-4e20-8882-2ec8998fb7fb` | absent | `research-bundle-774601b9-c49e-4e20-8882-2ec8998fb7fb` |

Recorded browser HTTP statuses include 200 (successful actual service responses), 404 (missing Bundle) and 500 (unreadable or transplanted Bundle). The UI renders a bounded error and Retry while preserving the report. Restart does not launch another Workflow: the second Runtime start list is empty and the isolated Knowledge Base SHA-256 is unchanged.

## Limits

The browser acceptance uses deterministic Provider fixtures and a faux Pi model. The source/proposal scenario verifies honest empty states; non-empty rendering is covered by component tests. The no-Report browser scenario uses a real cancelled Company Workflow; free-research association is additionally covered by the Runtime integration tests. Component tests cover large structured results, additional failure states and race boundaries.

The temporary stores and Edge profile are deleted after the run. No browser fixture data is committed as product Runtime state.
