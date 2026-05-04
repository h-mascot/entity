# Visual QA Review

## Current Artifact State

- Reviewed `visual-validate.cjs`, `metadata/visual-validation-all.json`, `metadata/visual-validation-actual.json`, generated-image metadata, and the current artifact directories.
- `visual-validate.cjs` expects 9 actual screenshots and 18 generated screenshots when run with `--include-generated`: all `set-1/*.png` and all `set-2/*.png`.
- The validator checks file existence, nonzero file size, PNG decode, minimum dimensions of `900x600`, and basic visual richness through luminance range, color buckets, and nontransparent samples.
- The current `metadata/visual-validation-all.json` reports all 9 actual captures plus `set-1/01-files.png` as valid, then fails on missing generated images.
- The current directory listing now includes additional `set-1` PNGs, so the validation JSON should be treated as a point-in-time result and regenerated after each image batch lands.
- `metadata/visual-validation-actual.json` currently contains a single `set-1/01-files.png` result despite its filename, likely from a targeted `--file` validation run. Do not rely on that file as proof that the actual baseline was fully validated.

## Required Validation Flow

1. Validate the baseline actual screenshots:
   ```bash
   node docs/design-reviews/2026-04-24-entity-ui-upgrade/visual-validate.cjs
   ```
   Expected result: `metadata/visual-validation-actual.json` contains 9 results for `actual/01-files.png` through `actual/09-task-detail.png`, with no failures.

2. Validate every generated candidate image:
   ```bash
   node docs/design-reviews/2026-04-24-entity-ui-upgrade/visual-validate.cjs --include-generated
   ```
   Expected result: `metadata/visual-validation-all.json` contains 27 results: 9 actual captures, 9 `set-1` images, and 9 `set-2` images, with no failures.

3. Spot-check individual images during batch generation without treating the output file as final proof:
   ```bash
   node docs/design-reviews/2026-04-24-entity-ui-upgrade/visual-validate.cjs --include-generated --file set-1/03-tasks.png
   ```
   This is useful for quick decode and blank-image checks, but it overwrites the validation JSON selected by `--include-generated`. Always rerun the full command after the batch is complete.

4. Cross-check metadata against files:
   - Every `metadata/set-*-*-image2.json` with `"ok": true` must have a matching `outputPath` file.
   - Every generated PNG must have matching metadata with model, endpoint, set, view, size, status, requestId, and outputPath.
   - The image dimensions in validation results should match the requested metadata size, currently `1536x1024` for generated images.

## Failure Cases That Matter

- Missing generated artifacts: the current major blocker. A full visual pass is not complete until every expected file in both sets exists.
- Stale validation output: validation JSON can be overwritten by targeted runs, so reviewers should verify the `results` count and file list, not just the filename.
- Decode failures: corrupted or partially written PNGs must be regenerated, not accepted based on metadata alone.
- Blank or uniform images: failures on luminance range, color buckets, or transparency usually mean an API/image pipeline issue or an image that is visually useless for design review.
- Wrong dimensions or aspect ratio: images under `900x600`, or generated images not matching `1536x1024`, should fail because they are not comparable to the desktop captures.
- Wrong view rendered: a file can be visually valid while showing the wrong screen. Compare each generated image to its prompt and actual metadata for expected nav state, title, primary content, and detail route.
- Login/auth leakage: several actual metadata files include `Login` in headings even when the page content is visible. Generated images should not make login the focal point unless that is the reviewed state.
- Occlusion and cropping: watch for Add to Dock, modals, notification badges, terminal drawers, bottom bars, or browser chrome covering core task rows, file rows, agent cards, docs text, or detail panels.
- Text hallucination: generated UI copy can look plausible but diverge from Entity terminology. Flag invented metrics, nonexistent agents, incorrect statuses, impossible dates, or labels that contradict metadata.
- Interaction-state mismatch: detail screens must actually read as detail screens. `08-agent-detail` and `09-task-detail` should show a selected agent/task context, not only the generic agents/tasks landing layout.
- Set inconsistency: `set-1` and `set-2` should be comparable explorations of the same nine views. If one set changes product structure, route meaning, or major information architecture, annotate it before design selection.

## Manual Review Checklist

- Confirm each generated image exists for:
  `01-files`, `02-agents`, `03-tasks`, `04-services`, `05-chat`, `06-admin`, `07-docs-view`, `08-agent-detail`, and `09-task-detail` in both `set-1` and `set-2`.
- Open each actual screenshot beside its generated counterpart and verify the generated image preserves the view's core job, not just a decorative style.
- Check the first viewport for readable hierarchy: active section, primary content area, key controls, and selected/detail context should be identifiable within 3 seconds.
- Check dense screens for operational usability: tables, kanban lanes, filters, file rows, service statuses, and chat controls should stay scannable without marketing-style empty space.
- Check repeated chrome consistency across all nine views: nav, left rail, top controls, notification affordance, terminal/dock affordance, and detail-panel behavior.
- Verify text legibility at full image size and at thumbnail-review size; tiny decorative text is acceptable only if it is not carrying product meaning.
- Flag any generated artifact that passes `visual-validate.cjs` but fails product fidelity, because the script only proves the PNG is present, decodable, large enough, and nonblank.

## Recommended Script Improvements

- Add an output filename suffix or `--output` option for targeted `--file` runs so spot checks cannot overwrite full-suite validation evidence.
- Include `expectedCount`, `actualCount`, and the explicit expected file list in the JSON output.
- Validate generated dimensions against `1536x1024` exactly, not only `>=900x600`.
- Add a metadata join check that fails when `outputPath` is missing, points to a missing file, or disagrees with the validated file path.
- Add optional perceptual checks for near-identical images across different views, which would catch duplicated or misrouted generated outputs.
