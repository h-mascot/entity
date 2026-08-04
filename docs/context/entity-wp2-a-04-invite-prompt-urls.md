# THE-879 / WP2-A-04 — Copyable invite prompt + URL bundle

Status: **IMPLEMENTED** (prompt/URL shaping + copy controls; no durable invite HTTP)  
Date: 2026-07-31  
Worktree: `/Users/enterprise/Code/entity-the-879-wp2-a-04`  
Parent: THE-829 — Workplanes Slice 2 Phase A  
Dependency: THE-878 / WP2-A-03 Done (`6cc815b`)

## Verdict

Added the minimal copyable agent invite prompt experience on the Add Agent ready path:

1. Pure prompt/URL builders under `packages/app/src/lib/addAgentInvitePrompt.ts`
2. Ready-state URL bundle + copy controls in `AddAgentCreationPanel`
3. Golden fixture + copy/degraded tests in `addAgentInvitePrompt.test.ts`

Uses THE-877 product statuses and THE-878 `InviteKitPreview` / `local_preview_not_durable` seam.

## URL shapes

| Key | Shape |
| --- | --- |
| setup | `{origin}/onboard/agent/:token` |
| manifest | `{origin}/api/onboarding/agent-session/:token/manifest` |
| bundle | `{origin}/api/onboarding/agent-session/:token/bundle` |
| skill | `{origin}/api/onboarding/agent-session/:token/skill` |
| progress | `{origin}/api/onboarding/agent-session/:token/progress` |

Missing/blank paths surface as **degraded** prompt state — never silently coerced to healthy.

## Explicit seam / dependency

| Concern | This ticket | Later |
| --- | --- | --- |
| Copyable full invite prompt | ✅ | — |
| Absolute setup/manifest/bundle/skill/progress URLs | ✅ | — |
| Per-URL + full-prompt copy controls | ✅ | — |
| Progressive disclosure (show/hide URLs + prompt) | ✅ | — |
| Local preview warning | ✅ | — |
| Durable `POST /api/agents/invites` | Not shipped | **WP2-A-05** |
| Revoke / regenerate | Not shipped | **WP2-A-05** |
| Live tokenized endpoint fulfillment for Agents invites | May 404 on local_preview | **WP2-A-05** |

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/addAgentInvitePrompt.ts` | URL absolutize, prompt golden shape, copy helpers |
| `packages/app/src/lib/addAgentInvitePrompt.test.ts` | Focused golden/copy/degraded tests |
| `packages/app/src/components/agents/AddAgentCreationPanel.tsx` | Ready-state prompt + URL UI |
| `packages/app/src/lib/addAgentInviteCreation.ts` | nextStep text updated for prompt availability |
