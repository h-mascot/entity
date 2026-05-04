# Prompt/API Audit

## Scope

- Reviewed `generate-image2.cjs`.
- Reviewed generated prompt files in `prompts/`: `set-1-01-files.txt`, `set-1-02-agents.txt`, `set-1-03-tasks.txt`, and `set-1-04-services.txt`.
- Reviewed generated API metadata for `set-1` outputs where present: Files, Agents, and Tasks.
- Did not call the OpenAI API, regenerate images, or modify generated screenshots.

## Findings

### Model Enforcement

- The generator hard-codes `MODEL = 'gpt-image-2'` and sends it to `https://api.openai.com/v1/images/edits`, which is good for explicit model targeting.
- There is no post-response assertion that the returned artifact was actually produced by `gpt-image-2`; metadata records the requested model, endpoint, HTTP status, and request ID, but not a response-side model field.
- The script writes metadata only after the API call succeeds or fails. The prompt text is written before the request, so a prompt can exist without a corresponding image or API metadata. Current evidence shows `prompts/set-1-04-services.txt` exists, but there is no matching `metadata/set-1-04-services-image2.json` or `set-1/04-services.png`.
- Recommendation: treat prompt-only files as incomplete jobs unless matching output and metadata exist. Add a manifest/state field such as `promptWritten`, `requestStarted`, `requestCompleted`, `outputWritten`, and `verifiedOutputExists`.

### Fallback Avoidance

- The generator fails closed when `OPENAI_API_KEY` is missing, an actual screenshot is missing, a set/view is unknown, the API status is non-OK, or `data[0].b64_json` is missing. It does not silently switch to another model or local placeholder renderer.
- Existing output skip behavior can hide stale artifacts: if an image file already exists and `--force` is not set, the script skips without comparing the prompt, source screenshot, generator version, or metadata. This is not a model fallback, but it can create a stale-output fallback in practice.
- Recommendation: record a prompt hash, source screenshot hash, generator hash, and requested model in metadata, then skip only when all hashes match. Otherwise require `--force` or mark the artifact stale.

### Prompt Consistency

- The base prompt structure is consistent across views: edit provided screenshot, set label, direction, product context, view job, visual constraints, UX constraints, rendering constraints, headings, controls, and screen-content summary.
- The set framework is coherent: `set-1` is a polished evolution and `set-2` is an alternate IA direction. However, only `set-1` prompt files currently exist, so downstream reviewers should not assume `set-2` has been generated.
- The prompts rely on raw extracted controls and page text. This creates inconsistent prompt length and quality by view: Files and Agents contain long irrelevant document/output excerpts, while Tasks is more focused on the visible board state.
- Recommendation: move shared constraints into a single prompt template block and add a per-view curated context block. Generated prompt files should include a short header with `view`, `set`, `sourceScreenshot`, `metadataSource`, `promptHash`, and `generatedAt`.

### Context Grounding

- The strongest risk is context contamination from metadata collection. `capture-actual.cjs` collects `document.body.innerText` and the first 80 `button,a,select` labels from the whole DOM, not only visible in-viewport or active-panel content.
- Files, Agents, and Services prompts include large excerpts from file/document lists such as deployment scripts, memory files, and unrelated runbooks. This can pull the image model toward random content instead of the target UI layout.
- Metadata headings report `Login` for multiple app views even when the screenshot is already inside the Entity shell. This gives the prompt a stale semantic signal that conflicts with the actual screenshot.
- Agents metadata includes controls from the Files dashboard even though the visible Agents view is mostly loading/empty. The prompt therefore combines an Agents job description with Files controls and document excerpts.
- Recommendation: collect context from visible elements only. Filter by bounding box intersection with the viewport, exclude hidden/inert panels, and cap text per element. For each view, prefer structured summaries of visible regions over global `body.innerText`.

## Risk Summary

- High: prompt grounding is polluted by off-screen or inactive DOM content, especially for Files, Agents, and Services.
- Medium: prompt-only artifacts can look like completed generation jobs unless metadata and output are cross-checked.
- Medium: skip behavior can preserve stale screenshots after prompt/template/source changes.
- Low: direct model fallback risk is low because the script hard-codes `gpt-image-2` and fails on API errors instead of downgrading.

## Suggested Acceptance Checks

- Every generated image has a matching prompt file, metadata file, source screenshot, request ID, prompt hash, source hash, and output hash.
- Every prompt's extracted context is traceable to visible active-view UI, not hidden panels or unrelated document bodies.
- `set-2` work is treated as not started until prompt, metadata, and image artifacts exist for that set.
- Re-running without `--force` verifies artifact freshness instead of only checking that an output PNG is non-empty.
