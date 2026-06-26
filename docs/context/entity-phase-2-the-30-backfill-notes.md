# Entity Phase 2 THE-30 Backfill Notes

`THE-30` adds a conservative task hierarchy/accountability backfill helper:

- Default mode is dry-run; it returns a report and performs no task updates.
- Apply mode only updates fields when a conservative source exists:
  - project scope from an existing task-project link;
  - initiator from a non-legacy creator;
  - owner from an existing individual assignee;
  - assignment state from existing assignee/executor state.
- Missing owner, unknown initiator, missing project, and missing executable assignment remain cleanup warnings.
- Applied inferences are recorded under `tasks.metadata.phase2_backfill` with source and confidence.
- Running apply again is idempotent for already-recorded unresolved cleanup warnings.

## Rollback Notes

The helper does not delete tasks, projects, task-project links, or metadata. If apply mode is used, rollback is manual and narrow: inspect `tasks.metadata.phase2_backfill.inferred_fields` for the task IDs in the report, then revert only those listed columns to their previous values from the saved before-state/test fixture. Dry-run reports are the default proof artifact and require no rollback.
