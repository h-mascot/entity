# Entity Selected UI Comparison Notes

Generated from `npm --prefix packages/app run test:visual` at a 1440x1000 desktop viewport.

## What Changed In Verification

- The visual smoke harness now uses deterministic loaded-state fixtures for files, agents, activities, tasks, services, docs, plugins, and chat.
- The test now fails if any target view falls back to visible request errors, unavailable placeholders, or missing fixture-specific loaded-state labels.
- Comparison sheets were regenerated in this folder:
  - `comparison-sheet-1.png`: Files, Agents, Tasks
  - `comparison-sheet-2.png`: Services, Chat, Admin
  - `comparison-sheet-3.png`: Docs View, Agent Detail, Task Detail

## View Comparison

- Files: close to the Set 1 direction. The built version has the same left source rail, compact filters, and dense file rows. Fixture data is shorter than the concept data, but the layout direction matches.
- Agents: functionally populated and dense, but visually diverges from Set 1. The current implementation leans into large live cards and yellow selection borders instead of the selected concept's quieter loading/fleet structure.
- Tasks: close enough structurally. The selected concept has more task density; the fixture intentionally validates a smaller deterministic board.
- Services: stronger than the selected empty-state concept because it validates populated service rows. This is useful for Entity context and should be kept.
- Chat: intentionally conservative. It now validates a loaded channel, sidebar, messages, status, and composer. It is not a concept match because chat's generated image was rejected.
- Admin: close to Set 2. The built version keeps the left settings rail, security/session panels, theme controls, and source management.
- Docs View: close in purpose and layout, but the built version is cleaner and less IDE-like than Set 2. It keeps a document rail and right context panel without adding the full file-tree sidebar.
- Agent Detail: usable, but less faithful than Set 2. The selected reference has denser tabs and richer activity/file context; the current build emphasizes selected-agent summary cards.
- Task Detail: close to Set 1. It preserves the board context behind the panel, compact task metadata, output/evidence links, and action controls.

## Adopt Next

- Keep Files, Admin, Docs View, and Task Detail as the strongest matches.
- For Agents and Agent Detail, reduce the yellow selected-card dominance and move closer to the selected reference's quieter tabular/detail layout before calling that slice finished.
- Keep Services as a populated operational table even though the selected reference was empty-state oriented.
- Redo Chat concept separately before any larger chat rebuild.
