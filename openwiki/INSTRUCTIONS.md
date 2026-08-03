# Entity OpenWiki Instructions

Generate a source-grounded, feature-oriented wiki for Entity: the AI-native workspace where humans and agents share files, tasks, agent state, document collaboration, plugins, and operational tooling.

## Audience

Write for:
1. users and operators trying to understand what Entity can do;
2. engineers and agents changing Entity safely;
3. deployment operators diagnosing whether a capability exists in source.

## Required coverage

Prioritize linked concept pages for:
- user-facing features and workflows;
- Files / Doc Hub and multi-source file browsing;
- Mission Control, tasks, Task Master, comments, review, and handoffs;
- agent registry, health, activity, invites, and collaboration;
- execution engines, Swarm, provider contracts, receipts, and proof;
- Admin-configurable behavior, plugins, services, and model settings;
- server routes, data models, security boundaries, and release flow;
- desktop and mobile shells where source evidence supports them.

For each feature, state:
- what the user can do;
- where it appears in the product;
- the main frontend/server/data implementation seams;
- important configuration, permissions, feature flags, or degraded states;
- what source evidence supports the claim.

Use Mermaid diagrams when they clarify architecture, lifecycles, or cross-package flows. Keep identifiers and route names exact.

## Truth and rollout boundaries

- Document implemented behavior only. Do not convert plans, TODOs, issue descriptions, sample data, or aspirational docs into shipped-feature claims.
- Clearly distinguish implemented, feature-flagged, placeholder, deprecated, and planned behavior.
- Source presence does not prove production rollout. Describe capabilities from source; Entity release metadata and deployment receipts remain authoritative for sandbox/production status.
- Do not claim a workflow works merely because a route or type exists. Check the connected UI, server, persistence, and tests where applicable.
- Treat `CONTEXT.md`, `AGENTS.md`, tests, package manifests, and implementation code as evidence, but resolve conflicts in favor of executable source and focused tests.

## Ownership boundaries

OpenWiki owns generated files under `openwiki/` except this `INSTRUCTIONS.md`. It may maintain only its marked blocks in root agent instruction files. Do not rewrite human-owned strategy, incident history, deployment approvals, `docs/plans/`, or operator context files.

Never include credentials, tokens, private database contents, internal deployment paths, personal data, raw receipts, or ignored-file contents.
