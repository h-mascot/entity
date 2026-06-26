# Entity Phase 2 Notification Contracts

## Scope

This document covers the Phase 2 notification contract for THE-15.5 / THE-70. It documents the behavior implemented by the notification schema, routing service, API, and inbox UI:

- Entity inbox/activity is the canonical notification record.
- External channels are delivery routes only.
- Failed, skipped, or degraded external routes do not erase or downgrade the canonical notification.
- Notification records carry policy reasons, object references, and stable links back to Entity work objects.

## Source Of Truth

The `notifications` record is the source of truth for recipient-facing notification state. Its core identity is:

- `recipient_principal_id`: who the notification is for.
- `canonical_event_id`: the Entity activity/event that caused the notification.
- `object_ref`: the canonical Entity object the notification is about.
- `notification_type`: the supported notification class.
- `inbox_state`: `unread`, `read`, or `archived`.
- `policy_reason_chain_json`: why this recipient and route were selected.

The `entity_inbox` delivery attempt is created first by the routing service. That delivery records that the notification reached the canonical Entity inbox, not that an external channel succeeded.

## Delivery Routes

External channels are represented as rows in `notification_deliveries`. Supported delivery channels are:

- `entity_inbox`
- `clickclack`
- `email`
- `discord`
- `slack`
- `agentpush`
- `webhook`
- `other`

Delivery status is per route:

- `pending`: a route has not completed.
- `sent`: a route completed successfully.
- `failed`: a route attempted delivery and failed.
- `degraded`: a route is available only in degraded form.
- `skipped`: a route was selected but not attempted, usually because it is unavailable or not configured.

External delivery status must never be used as the sole claim that a notification exists, was actionable, or was lost. The canonical claim comes from the notification record plus its `entity_inbox` delivery.

## Failure And Degraded Behavior

When an external route fails, is skipped, or is degraded:

- The canonical notification remains in the recipient's Entity inbox.
- The failed/degraded route remains visible through delivery attempts.
- The failure or degraded reason is stored on that route, not on the canonical inbox state.
- The UI should present canonical inbox state separately from external delivery state.
- Follow-up recovery can inspect route-level delivery attempts without recreating the canonical notification.

This means an email, chat, webhook, or other configured route can fail without hiding review requests, owner escalations, receipt failures, or connector degradation notices from Entity itself.

## Supported Notification Types

The Phase 2 notification type enum is:

- `task_nudge`
- `owner_escalation`
- `review_request`
- `human_gate_request`
- `auto_reassignment_notice`
- `receipt_failure`
- `connector_degraded`
- `policy_warning`

These types cover the THE-15 acceptance surface: nudges, owner escalations, review and human-gate requests, reassignment notices, receipt failures, connector degradation, and policy warnings.

## Object References And Deep Links

Every notification must include an `object_ref` with:

- `object_type`
- `object_id`
- `link_role`

Notification APIs and UI can derive stable Entity links from this reference, such as task deep links for task-related notifications. External channel payloads may include those links, but those messages are pointers back to Entity. They are not the source of truth for notification state or work-object status.

## Test Contract

Tests should prove both sides of the contract:

- Success path: a canonical notification is created with an `entity_inbox` delivery and route metadata.
- Degraded path: when all selected external routes fail, are skipped, or are degraded, the canonical notification remains unread/read/archived according to `inbox_state`, and route-level delivery outcomes remain inspectable.
