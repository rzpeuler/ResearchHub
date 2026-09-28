# TL-001 real kill-criterion invalidation acceptance

Generated: 2026-09-28T09:16:58.017Z

Classification: **EXECUTED / PASS GATE** (process exit 0).

This run uses a disposable Schema 0.4 Knowledge Base, a live original-publisher CNINFO PDF with archived PDF bytes, and the real configured Pi executor. The Thesis and the human-rule criterion are explicitly acceptance harness records, not an investor-approved judgment. Criterion confirmation uses a simulated historical test clock so the already-published original evidence is temporally eligible; the Source publishedAt value is retained unchanged. The mounted user Knowledge Base is not used. The artifacts omit source body text, exact quote text, Raw bytes, credentials, and tokens.

## Evidence stages

| Stage | Status | Evidence |
| --- | --- | --- |
| originalPublisherDiscovery | PASS | cninfo; short original CNINFO PDF disclosure; publishedAt 2026-06-02T16:00:00.000Z |
| liveOriginalPublisherPdf | PASS | CNINFO PDF fetched and normalized; 94853 original bytes; public rights admit Raw retention, AI processing and derived Knowledge |
| deterministicExactQuoteExtraction | PASS | Programmatic source scan selected the exact CNINFO metric, period, unit and sole numeric token 28.02423; quote and source body withheld from output |
| isolatedGatewaySeedWithOriginalPdfRaw | PASS | Disposable v0.4 KB has a synthetic Thesis, member Claim, structured numeric evidence Claim, CNINFO Source and verified archived PDF Raw (raw-sha256-f51131858f82005c9ed36dcb78ecca961f3f10cff71dc54039c4a37804ed5412) |
| httpHumanRulePrepareNoWrite | PASS | POST /api/production/thesis-lifecycle/criteria/prepare returned a preview and hash; canonical fingerprint stayed unchanged |
| httpHumanRuleConfirmGatewayWriterReplay | PASS | Human-rule criterion revision 1 confirmed through the actual HTTP route; Writer tl001-kill-confirm-1790586983753 and reload revision 2; identical confirm replay did not advance revision |
| simulatedConfirmationClock | PASS | Harness confirmation time 2026-06-02T15:59:59.000Z was injected only into the isolated human criterion service; source publishedAt 2026-06-02T16:00:00.000Z was retained unchanged |
| httpRefreshMetReviewCase | PASS | POST /api/production/thesis-lifecycle/refresh called real Pi refresh; deterministic evaluator proved the exact CNINFO PDF numeric value and created ReviewCase thesis-refresh-687a1ede0f05edfabeef7345e433bc627da8e1a8a5513457bcd2070d622ffae5 without canonical writes |
| numericVersionAndSourceRawBinding | PASS | ReviewCase binds 每股派发现金红利=28.02423 元, 2025 年年度, exact locator hash, Source source:research-f19bc5badc85dece, verified archived PDF Raw raw-sha256-f51131858f82005c9ed36dcb78ecca961f3f10cff71dc54039c4a37804ed5412, and numericValueVersionVerified=true |
| refreshReportLinkage | PASS | Durable thesis_lifecycle report thesis-lifecycle-thesis-refresh-ebd8d918e7e38b798b47875d includes ReviewCase, invalidation transition and criterion definition hash |
| invalidationDeferNoWrite | PASS | HTTP DEFER persisted DEFERRED state while the KB revision and every canonical object hash stayed unchanged |
| invalidationAcceptWriterReloadReplay | PASS | HTTP ACCEPT revalidated current criterion/evidence, committed invalidated through Gateway/Writer writer-thesis-a19f82ed8cf882f57c0c7538, reloaded revision 3; identical replay added no write |
| decisionReportAndActionability | PASS | Durable report records ACCEPTED and Writer run; terminal case is absent from actionable ReviewCase listing |

## Errors and blockers

- None.

## Machine evidence

- `tests/validation/evidence/RHL_TL001_THESIS_KILL_CRITERION_REAL_E2E.json`
- Script: `scripts/acceptance-thesis-lifecycle-invalidation-real.ts`
- User Knowledge Base touched: `false`
- Secrets included: `false`
- Source body included: `false`
