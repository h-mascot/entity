# MC v2 - Bhanu Mission Control feature gap list

Reference used: `MC-SOURCE.html` + `MC-SERVER-REFERENCE.js` in this repo (captured from Bhanu MC).

## 1) Features from Bhanu MC that Entity currently lacks (or has only partial support)

1. **Roadmaps UI (full module)**
   - Bhanu MC exposes a dedicated Roadmaps view/entry point.
   - Entity has DB tables (`roadmaps`, `roadmap_items`) but no visible app UI/routes for roadmap planning.

2. **Attachments in task detail (upload + list + open)**
   - Bhanu MC includes Attachments section and attachment actions.
   - Entity detail panel currently hides attachments block (`useMCData.ts`).

3. **Estimate + Time Spent controls in task detail**
   - Bhanu MC surfaces `estimate_hours` and `time_spent` directly in task UX.
   - Entity stores these fields but does not expose clear edit/display controls in MC UI.

4. **Archive column visibility toggle / explicit archive workflow**
   - Bhanu MC has "Show Archive column" and explicit archive board treatment.
   - Entity supports archived state but lacks equivalent obvious board-level archive UX parity.

5. **Recurring task management UX (create/edit cadence from UI)**
   - Bhanu MC has explicit recurring task controls in the task form/detail.
   - Entity has recurring data fields and filter artifacts, but recurring configuration UX appears incomplete.

6. **Task output typing + richer output workflow**
   - Bhanu MC uses output + output type in task lifecycle.
   - Entity supports output text, but no clear typed output workflow parity in visible MC UX.

7. **Task history/audit timeline per task (field-level deltas)**
   - Bhanu MC keeps stronger task evolution traceability.
   - Entity has `task_history` table but no surfaced, first-class task history panel in MC detail.

## 2) Priority ranking

- **P0**
  - Attachments in task detail (upload/list/open)
  - Estimate + Time Spent controls

- **P1**
  - Roadmaps UI (activate existing schema)
  - Recurring task management UX
  - Archive column visibility toggle + archive workflow polish

- **P2**
  - Task output typing workflow
  - Task history/audit panel in detail view

## 3) Estimated effort

- Attachments in task detail - **1.5 to 2.5 days**
- Estimate + Time Spent controls - **0.5 to 1 day**
- Roadmaps UI - **2 to 4 days**
- Recurring task management UX - **1.5 to 3 days**
- Archive workflow polish - **0.5 to 1 day**
- Task output typing workflow - **0.5 to 1 day**
- Task history/audit panel - **1 to 2 days**

## Suggested implementation order

1. Attachments
2. Estimate/Time tracking
3. Recurring UX
4. Roadmaps UI
5. Archive polish
6. Output typing
7. Task history panel
