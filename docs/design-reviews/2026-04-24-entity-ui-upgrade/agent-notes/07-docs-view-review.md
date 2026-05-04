# 07 Docs View Review

## Source Observations

- Actual capture reviewed: `actual/07-docs-view.png`, `metadata/07-docs-view.json`, and `metadata/visual-validation-all.json`.
- The actual Docs View is visually valid at 1440x1000 with strong contrast and a readable document column.
- Metadata confirms a long markdown document with many headings, but no right-side outline/table of contents is visible in the capture.
- Generated Docs View concepts are missing for both sets: `set-1/07-docs-view.png` and `set-2/07-docs-view.png` are both absent from validation metadata.

## Recommendations

### Readability

- Preserve the current generous reading width and high-contrast typography; this is the clearest part of the view.
- Slightly reduce the weight/size gap between `h1`, `h2`, and `h3` so long operational docs feel structured rather than poster-like.
- Add a sticky or collapsible document outline for long markdown files. Metadata lists 30 headings, so scroll recovery matters.
- Keep code tokens and paths highly legible, but ensure long paths wrap or horizontally scroll inside code blocks without widening the page.

### Breadcrumbs

- Consolidate the title metadata and path into one clear hierarchy: document title, collection breadcrumb, then full route/path as secondary copy.
- Make breadcrumb segments clickable where they represent navigation, e.g. `memory / entity-mc-context.md`.
- Avoid duplicating the same path in both the subtitle area and the far-right header unless one is explicitly a copyable route.
- Add current-section awareness if an outline is introduced, so the user can tell where they are inside a long document.

### Audio, Share, And Back Controls

- Keep `Entity Home` as the primary back navigation, but use a standard back icon button plus text and ensure it has a large, stable hit target.
- Share belongs in the document toolbar with a clear copy/open feedback state; the current top-right placement works, but it should not be visually detached from document actions.
- The `Listen` control is useful, but the current full-width audio strip consumes too much early reading space. Convert it to a compact toolbar action or collapsible audio row with status: idle, generating, playing, failed.
- `Add to Dock` should remain a global shell affordance, but it currently floats over the reading surface. Anchor it in the shell/action rail or ensure it never covers document content, outline, or scroll controls.

### Markdown Layout

- Add a right-side outline on desktop and a compact outline/menu control on mobile for long markdown navigation.
- Style blockquotes, tables, task lists, and code fences explicitly; the current capture mostly demonstrates headings, paragraphs, bullets, and inline code.
- Ensure heading anchors have `scroll-margin-top` so deep links do not hide headings behind the header.
- Keep markdown content semantic: one `h1`, ordered heading levels, list semantics, accessible link text, and keyboard-reachable anchor/share actions.

## QA Notes

- Actual capture passes automated visual validation, but manual review should still check long-scroll behavior, heading anchor deep links, copy/share feedback, and audio generation states.
- The metadata text includes `Generate TTS for this document` and `HTML`; verify those controls have accessible labels and do not read as stray document content to screen readers.
- Test with a very long path, a document with tables/code fences, and a document with no headings to confirm the layout does not depend on this specific markdown shape.
- Check that back, share, listen, add-to-dock, outline links, and inline document links are keyboard reachable with visible focus states.

## Acceptance Checks For Both Sets

- `set-1/07-docs-view.png` and `set-2/07-docs-view.png` exist, render nonblank, and use the same desktop framing as the actual capture for comparison.
- Both sets preserve readable markdown: strong contrast, stable line length, clear heading hierarchy, readable inline code, and no text overlap at 1440x1000 and 1536x1024.
- Breadcrumbs show document location clearly and avoid duplicate/conflicting path treatments.
- Back, Share, Listen, and Add to Dock controls have canonical placement, visible hover/focus states, accessible labels, and no overlap with document content.
- Long markdown navigation is represented: outline, section anchors, or another clear mechanism for jumping between headings.
- QA includes at least one markdown stress case with long headings, long paths, code fences, tables, bullets, and deep-linked headings.
