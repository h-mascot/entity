# Task Master Routing Matrix

Task Master is a recovery helper for policy-drivable work. It is not the universal executor for every task, and it does not replace the task owner, reviewer, or required human approval path.

The routing state shown on task cards and in the task detail panel is derived from assignment fields, policy projection metadata, and structured activity events.

| Routing state | When it appears | What Task Master may do | Policy reason shown |
| --- | --- | --- | --- |
| Unassigned drivable | The task is unassigned, has no executor, and policy marks it `taskmaster_drivable`. | Claim or execute the task through the normal Task Master claim path. | The latest routing policy reason chain entry, or a fallback that policy allows Task Master to claim the work. |
| Routing problem | Assignment state is `routing_problem`. | Do not claim automatically. Surface the mismatch for a human to repair assignee, executor, or policy inputs. | The policy reason chain, or a fallback explaining that executable work needs an individual assignee/executor or a policy-drivable unassigned state. |
| Claimed by Task Master | Assignment state is `claimed`, or claim metadata is present. | Continue as the active executor while the claim remains valid. | Claim audit metadata when available. |
| Nudged | A `nudge_sent` activity event or nudge audit metadata is present. | Wait for the assignee before escalating. | Nudge audit metadata, or a fallback that Task Master nudged the assignee before escalation. |
| Owner escalated | An `owner_escalated` activity event or escalation audit metadata is present. | Notify the accountable owner and wait for policy thresholds before reassignment. | Escalation audit metadata, or a fallback that assigned work stayed stale after a nudge. |
| Auto-reassigned | An `auto_reassigned` activity event, reassignment summary, or reassignment chain is present. | Treat the recorded individual owner as the recovered assignee/executor. | Reassignment audit details, including prior assignee, new assignee, actor, and reason when present. |
| Excluded from routing | Policy projection marks high-risk or otherwise excluded work as not drivable. | Do not claim, reassign, or bypass required review/approval paths. | High-risk exclusion reasons or the latest policy reason chain entry. |

## UI Placement

- Board cards show a compact routing badge and a short reason so work queues can be scanned without opening every task.
- The task detail panel shows the same state, the policy reason, assignee/executor/owner fields, and recent routing reason-chain entries.
- Missing or unknown routing inputs are visible as `Routing unknown` rather than silently coerced into a healthy state.

## Boundary

Task Master can assist only when the task's policy and assignment state permit it. Human review, approval, ownership, and high-risk exclusions remain visible in Entity and are not bypassed by routing state.
