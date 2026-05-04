# Council Review: Settings-Backed Entity Portability Spec

Date: 2026-04-30
Spec reviewed: `docs/specs/settings-backed-portability-spec.md`

## Council participants

- Systems Architect
- Reliability Engineer
- Security Engineer
- Product/UX Engineer
- Pragmatic Engineer

## Consensus

The direction is correct: Entity should move installation-specific values out of source constants and into a settings-backed model with both human UI and agent config/API paths.

The council agreed the original spec needed hardening before implementation in seven areas:

1. Config merge semantics, especially arrays and partial objects.
2. Bootstrap vs runtime settings separation.
3. Admin/security model for settings APIs and effective config.
4. Secret reference and redaction contract.
5. Filesystem and outbound network safety.
6. UX grouping/progressive disclosure for settings screens.
7. Safer execution gates, because current `ctrl:full` includes Enterprise-specific checks.

## Major risks identified

### Config precedence ambiguity

The precedence stack was clear, but merge behavior was not. Arrays like `agents`, `fileSources`, `docs.roots`, `services`, and `terminal.targets` must merge by stable ID or explicitly replace. `null` must mean intentional clear/disable; missing values mean inherit.

### Bootstrap cycle

DB settings cannot override the DB path used to open the DB. Host, port, database path, config path, and profile selection are bootstrap settings and must be loaded before DB-backed Admin settings.

### Security exposure

`/api/settings/*` and `/api/config/effective` can expose sensitive operational topology or mutate powerful surfaces. They need admin authorization/redaction rules, even before full internet-facing auth exists.

### Secrets

Secrets must use references (`env:NAME`, future secret stores). UI fields should be write-only/status-only. APIs, doctor, logs, exports, and screenshots must never contain raw secret values.

### Filesystem safety

Configurable docs/file roots introduce traversal and symlink escape risk. Path handling needs canonicalization, containment checks, extension allowlists, sensitive-root warnings, and tests.

### SSRF / outbound checks

Provider/service/gateway test buttons and doctor checks can become SSRF tools. Disabled integrations must make zero calls. Enabled checks need timeouts, response limits, no redirects or guarded redirects, and metadata/private-range controls.

### UX overload

A flat Settings list with 13 domains is technically complete but too much for first-run users. UI should group settings into Workspace, Agents, Knowledge & Files, Mission Control, Integrations, and System, with advanced/read-only tiers.

### Gate mismatch

`npm run ctrl:full` currently includes Enterprise live/deploy checks. For portability work, we need a portable gate and an Enterprise gate. Henry requested ctrl full after each section, so we will run it, but the spec now treats the current Enterprise-coupled gate as a thing to split early.

## Required spec changes applied

The spec now includes/strengthens:

- universal defaults rule
- config source precedence
- merge semantics
- bootstrap vs runtime settings
- effective config metadata
- admin settings security model
- secrets contract
- filesystem safety contract
- outbound network safety
- first-run setup security
- settings UX grouping/tiering
- agent configuration contract
- migration safety
- testing/verification gates
- rollback rules

## Recommended implementation stance

Start with Slice 0 and Slice 1 only:

1. Baseline/private-default scan.
2. Additive config schema/effective-config infrastructure.

Do not wire all runtime consumers immediately. First prove the substrate: schema, merge, source metadata, redaction, config loading, DB settings read path, endpoint, tests.

## Open decision

Current `ctrl:full` should continue running for Henry's environment because Henry requested it, but portability needs a future split:

- `ctrl:portable` — public/fresh-install gate.
- `ctrl:enterprise` — Henry Enterprise live/deploy preservation gate.
- `ctrl:full` — either both when available, or environment-aware.
