# Entity Phase 2 Review and Human Gate Policy

**Linear issue:** `THE-50` / source `THE-11.5`
**Date:** 2026-06-24

This document describes how Entity displays and applies review policy, separation of duties, override audit context, and human gate state in the work plane.

## Resolver Semantics

The review policy resolver evaluates task policy inputs from workspace, org, team, project, worktype, task, risk, agent trust, and external side effects. The resolver output is task-scoped:

- `review_required` and `review_state`
- `human_gate_required` and `human_gate_state`
- assigned reviewer and human approver principals
- reason-chain entries explaining why review or approval is required

The UI should show the reason chain as explanatory context. It should not silently collapse missing or degraded policy input into a healthy state.

## Separation of Duties

Review controls are available only to the resolved eligible reviewer. Human gate controls are available only to the resolved human approver. If the current profile does not match the assigned principal, Entity shows the state and reason context but hides action controls.

This keeps the task detail view informative for collaborators while preserving separation-of-duties enforcement in the backend service.

## Human Gate Semantics

Human gate state is separate from review state. Review answers whether the output meets the task criteria. Human gate approval answers whether the risky or externally visible work may proceed.

When a human gate is required:

- `pending` blocks clean completion.
- `approved` permits completion once other required review state is resolved.
- `rejected` remains visible as a resolved negative approval state.

Receipts should record resolved decisions only. Pending review or pending human gate state must not be rendered as completed approval.

## Override Audit

Policy overrides are allowed only when the task metadata includes audit context explaining the override. The UI surfaces override audit entries separately from the normal reason chain so reviewers can distinguish routine policy resolution from a manual or administrative exception.

Override audit entries should include the actor, time, reason, and target state when available. Missing details should remain visible as degraded audit context rather than being normalized away.

## UI Contract

Task detail surfaces should keep review and human gate panels visually separate:

- Review panel: review state, eligible reviewer, review packet summary, reason chain, override audit, accept/request-fix controls for the eligible reviewer.
- Human gate panel: human gate state, eligible human approver, approval note, request/approve/reject controls for eligible humans.
- Receipt panel: resolved review and human gate decisions from canonical receipt metadata.

Admin/settings surfaces should summarize the policy so operators understand why task detail controls may be hidden for ineligible actors.
