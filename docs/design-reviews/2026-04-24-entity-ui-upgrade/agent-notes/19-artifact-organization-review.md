# Artifact Organization Review

## Scope

Reviewed folder organization and naming under `docs/design-reviews/2026-04-24-entity-ui-upgrade/`, including screenshots, prompts, metadata, generation/capture scripts, validation output, and existing agent notes.

## Easy To Hand Off

- The top-level artifact boundary is clear. Everything for this UI pass lives under one dated folder, which is good for archiving and future comparison.
- The `actual/` folder is easy to understand as baseline captured product state. Its files use stable numeric view IDs: `01-files.png` through `09-task-detail.png`.
- The baseline metadata mirrors the actual screenshots with matching IDs in `metadata/01-files.json` through `metadata/09-task-detail.json`. This makes it straightforward to pair a screenshot with extracted headings, controls, route, viewport, and visible text.
- `capture-actual.cjs` is a useful source of truth for the canonical view list. It documents the nine intended views, route/tab setup, viewport, and capture assumptions.
- `generate-image2.cjs` makes the generated-set intent discoverable. It defines `set-1` as `Polished Evolution` and `set-2` as `Alternate IA Direction`, which is more useful than only having opaque folder names.
- Existing notes in `agent-notes/` mostly follow the same numeric prefix pattern as the screenshots. This helps distribute review ownership across parallel agents without needing a separate task index.
- `prompts/` and `metadata/set-1-*-image2.json` preserve enough provenance to reconstruct how generated artifacts were requested, including model, set, view, size, quality, request timing, and output path.

## Confusing Or Fragile

- `set-1/` and `set-2/` are not self-describing on their own. The set labels only exist inside `generate-image2.cjs` and the image metadata, so a reviewer browsing the folder has to infer what each set means.
- `set-2/` exists but is empty. That is easy to mistake for a failed copy, an unfinished generation batch, or a deliberate placeholder.
- Coverage is uneven. `actual/` has nine screenshots, `set-1/` currently has six screenshots, `prompts/` has seven `set-1` prompts, and validation metadata still expects both generated sets to contain all nine views.
- There is no top-level manifest or README that states current artifact status. Reviewers must combine `ls`, `visual-validation-all.json`, generation metadata, and agent notes to know what is complete.
- `logs/` exists but is empty. Without a placeholder README or convention, it is unclear whether logs were intentionally omitted, generated elsewhere, or expected later.
- Generated prompts and generated screenshot metadata are separated from their output images. The naming makes them matchable, but there is no single per-artifact record that links baseline screenshot, prompt, generated image, metadata, validation result, and reviewer note.
- `actual` is a good baseline name, but generated folders use ordinal set names instead of intent names. `set-1`/`set-2` works for scripts, but it is weaker for handoff than a folder or manifest label such as `polished-evolution` or `alternate-ia`.
- Some metadata captures include loading, login, or stale-content signals. That is a capture-quality issue, but it also affects organization because the folder does not mark which artifacts are clean baselines versus known-problem captures.

## Naming And Metadata Recommendations

- Add a top-level `README.md` or `manifest.json` for the artifact pack. It should define each folder, set label, canonical view list, current completion status, and known gaps.
- Keep the stable numeric view IDs, but make them explicit in the manifest:
  - `01-files`
  - `02-agents`
  - `03-tasks`
  - `04-services`
  - `05-chat`
  - `06-admin`
  - `07-docs-view`
  - `08-agent-detail`
  - `09-task-detail`
- Add set metadata outside scripts, for example:
  - `sets.set-1.label = Polished Evolution`
  - `sets.set-1.status = partial`
  - `sets.set-2.label = Alternate IA Direction`
  - `sets.set-2.status = not-started`
- Use explicit status fields for every expected artifact: `missing`, `captured`, `generated`, `validated`, `reviewed`, or `known-issue`.
- Prefer one manifest row per view/set pair with fields like `viewId`, `viewName`, `kind`, `set`, `sourcePath`, `promptPath`, `metadataPath`, `validationPath`, `reviewNotePath`, `viewport`, `generatedSize`, `createdAt`, and `knownIssues`.
- Either remove empty placeholder folders before handoff or add a small README in them. For `set-2/`, a note like `Placeholder for Alternate IA Direction; no images generated yet` would prevent misreads.
- Either populate `logs/` or add `logs/README.md` saying whether command output was intentionally not saved.
- Consider renaming generated-set folders only if scripts are updated in the same change. A low-risk alternative is to keep `set-1` and `set-2` as machine-stable IDs, then put human-readable labels in the manifest.
- Extend validation output to include expected-vs-present counts by group. Example: `actual: 9/9`, `set-1: 6/9`, `set-2: 0/9`, `prompts: 7/18 expected`.
- Record capture state quality in metadata, not only visual dimensions. Useful fields: `dataState`, `routeVerified`, `loadingState`, `authBypassed`, `knownStaleData`, and `usableAsBaseline`.

## Suggested Minimal Handoff Manifest

```json
{
  "artifactPack": "2026-04-24-entity-ui-upgrade",
  "canonicalViews": ["01-files", "02-agents", "03-tasks", "04-services", "05-chat", "06-admin", "07-docs-view", "08-agent-detail", "09-task-detail"],
  "sets": {
    "actual": { "label": "Current captured UI", "status": "complete", "expected": 9, "present": 9 },
    "set-1": { "label": "Polished Evolution", "status": "partial", "expected": 9, "present": 6 },
    "set-2": { "label": "Alternate IA Direction", "status": "not-started", "expected": 9, "present": 0 }
  },
  "knownGaps": [
    "set-1 missing 07-docs-view, 08-agent-detail, and 09-task-detail screenshots",
    "set-2 folder exists but has no screenshots",
    "logs folder is empty",
    "prompt and generated-image coverage are not aligned"
  ]
}
```

## Bottom Line

The artifact pack is close to handoff-ready because the baseline screenshots, metadata, scripts, and review notes share a clear numeric view vocabulary. The main weakness is status ambiguity: empty or partial folders look the same as failed/incomplete work unless a reader cross-checks scripts and validation JSON. A small top-level manifest with set labels, coverage counts, and known issues would remove most of that friction without disrupting the current file layout.
