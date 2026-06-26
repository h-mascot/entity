# Worktype Overlays

Entity worktype overlays add domain fields to tasks without changing the task into a runtime/admin surface. The base task remains the work object; the overlay records the domain context that helps people review, search, and route the work.

## Registry

The registry lives in `packages/db/src/index.ts` and is exposed read-only through `/api/worktype-registry`.

Each registered worktype declares:

- `schema_name` and `schema_version`
- risk default and sensitivity class
- user-facing `plan_labels`
- field definitions with type, allowed values, indexability, sensitivity, and display label

The UI consumes only registry metadata and task overlay values. It does not expose credentials, provider settings, or runtime controls.

## Current Overlays

- Sales: account, deal stage, next action, external-send risk, and CRM side-effect type.
- Customer success: customer, health state, renewal/escalation markers, support context, SLA/customer-impact risk, and external-response risk.
- People: candidate/employee reference, workflow stage, sensitivity class, HR side-effect type, checklist state, and approval requirement.
- Business operations: process area and approval path.

## Versioning

Overlay payloads are stored under `policy_inputs_json.layers.worktype` with the selected `worktype`. Registry metadata adds `schema_name`, `schema_version`, risk default, sensitivity, and field definitions when policy inputs are evaluated.

Versioning rules:

- Additive fields can be introduced in the current schema version when old payloads remain valid.
- Allowed-value changes should be treated as schema changes when they would reject existing task data.
- Unknown legacy worktypes are preserved as degraded legacy data instead of being dropped.
- UI labels come from registry `plan_label` and `plan_labels`, so users see domain language rather than internal schema keys.

## Search And Filters

Only fields declared with `indexable: true` are exposed in the board overlay filter UI. Non-indexable fields, high-sensitivity payloads, system routing fields, and object-shaped values are not offered as filters.

The board filter reads existing task overlay values from `policy_inputs_json.layers.worktype` and matches on formatted display values. This keeps filtering local to declared work-object context and avoids leaking restricted preview content.

## Migration Behavior

Tasks without a known overlay continue to render as general tasks. Tasks with an unknown worktype keep their saved overlay payload as legacy data and receive degraded registry metadata in policy evaluation. Migration should prefer backfilling `policy_inputs_json.layers.worktype` rather than copying overlay values into unrelated metadata keys.
