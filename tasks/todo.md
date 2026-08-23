# Entity Doc Hub Governed Runner

- [x] THE-650: deploy-profile targets versus running paths
- [x] THE-653: Milestone 0 routing/viewer/comments/TTS characterization
- [x] THE-654–THE-658: route state, canonical links, share adapter, and manual-copy fallback
- [x] THE-659–THE-665: mobile sharing, Tools, Convert, clarity, and Comments implementation/proof
- [x] THE-669–THE-671: audio cache, mobile player, and telemetry implementation/proof
- [x] THE-672: end-to-end and UI proof gate

## Review

- THE-650: characterization proof complete; corrected `gpt-5.6-terra` high governed review exited 0 with no blockers.
- THE-651: runtime/database receipt complete; governed review clean after staging the durable plan, adding the delivery boundary, and ignoring `.runner/`.
- THE-652: API/static SHA proof, rendered Enterprise Playwright/Chrome proof, and corrected governed review all pass.
- THE-653: 45 app tests, 7 focused server tests, app build, API checks, and desktop/mobile Chrome baseline pass; governed review clean.
- THE-654: canonical route reload and non-restored Comments tool state characterized in Chrome; focused route tests and governed review clean.
- THE-655: shared logical route-state adapter added with 14 focused tests, 50-test app suite, app build, and clean governed review.
- THE-656: absolute canonical-link generation covers five document classes; 3 focused tests, 54-test app suite, app build, and governed review clean.
- THE-657: canonical Copy link uses the shared adapter; app/browser proof and 703-test server gate pass; governed review clean.
- THE-658: accessible keyboard/pointer/touch manual-copy fallback and local-file identity browser proof pass; governed review clean.
- THE-659–THE-665: native sharing, mobile Tools, Convert, first-look clarity, Comments capability and full read/write mobile Comments are unit/build/browser proved; each governed review is clean.
- THE-666–THE-668: audio state controller, explicit playback UX, persistence characterization, and valid artifact identity are unit/build/browser proved; governed reviews clean.
- THE-669–THE-671: bounded audio cache, current-document mobile mini-player, and allowlisted/redacted Milestone A telemetry are proved by Node 22 app/server gates, responsive Chrome evidence, privacy canaries, and clean governed reviews.
- THE-672: the cumulative Gate A run passes 142 app tests, app/server builds, 736 server tests, and a fresh 320x700 Chrome workflow covering Convert, Comments, Share fallback, Audio, telemetry privacy, template retention, and fragment retention. Three governed-review rounds closed every finding; the final review is clean.

✅ Jeff Dean review: route/history state stays in the shared route module, the
two review regressions are covered by focused tests, and the cumulative change
integrates without a new parallel navigation model.

✅ Luke W + Ryan Singer review: the 320px happy path keeps the current document
visible, actions enabled, focus restored, and the sticky player clear of
content; template selection and nested Back behavior are explicit and
frictionless.

## THE-970 / T-029 — Local DOCX milestone

- [x] Map the canonical T-029 contract and accepted T-025–T-028 seams.
- [x] Prove create/open/human save/reopen with semantic DOCX fixtures.
- [x] Prove bounded agent mutation, revision/version/activity/receipt, and stable link.
- [x] Prove hostile/invalid OOXML fails closed under explicit limits.
- [x] Run focused/local/server/build/diff gates and record evidence, including unchanged broader failures.
- [ ] Commit one focused change on the isolated detached worktree.

### Review

Pending implementation and proof.
