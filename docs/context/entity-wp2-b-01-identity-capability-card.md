# THE-882 / WP2-B-01 — Agent identity/capability card fields

Status: **IMPLEMENTED**  
Date: 2026-07-31  
Parent: THE-830 — Workplanes Slice 2 Phase B  
Dependency: THE-881 / WP2-A-06 Done (`9cc94c6`)

## Verdict

Canonical plain identity/capability card fields for Agent Desk / invite onboarding (grill Q57):

- agent identity (name, role, invite/agent ids)
- permissions + capability labels
- runtime / model (explicit unbound when absent)
- heartbeat / presence (`live|idle|stale|offline|unknown|missing`)
- current task / workplane

Missing presence is **never** coerced to healthy/live. WP2-B-02 fills heartbeat endpoint + Workplane presence panel.

## Schema

| Layer | Path |
| --- | --- |
| Server | `packages/server/src/agent/identity-capability-card.ts` |
| App model | `packages/app/src/lib/agentIdentityCapabilityCard.ts` |
| UI smoke | `packages/app/src/components/agents/AgentIdentityCapabilityCard.tsx` |
| Mount | Agent Desk invite detail (`AgentInviteDeskPanel`) |

Field key constant: `AGENT_IDENTITY_CAPABILITY_CARD_FIELDS`.

## Compatibility

Built from durable invite views (`DeskInviteView` / invite domain) from THE-879/880/881. Optional merge of registry capability labels and future presence payloads. No secrets on the card.

## Explicit non-goals

- Heartbeat HTTP endpoint / presence persistence (WP2-B-02)
- Workplane attach/detach (WP2-B-03)
- Chief routing / ASK (WP2-B-04+)
- Production promotion
