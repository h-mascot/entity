# Entity Agent Contracts Plugin

`entity-agent-contracts` externalizes the Entity operating contracts that agents previously learned from private memory files.

This package is intentionally not the Discord thread title hook. It covers the contracts Entity itself depends on agents to follow:

- convert local artifact paths into Entity FS docs links before sending them to users
- keep a source registry for agent workspaces and document delivery
- use the canonical Entity source/deploy path for code changes
- move Mission Control work to review with evidence before claiming completion
- mutate OpenClaw config through schema-aware or first-class tooling

## Why this exists

Entity needs these behaviors to be installable and discoverable instead of hidden in one crew memory file. A new agent or external installer should be able to install this package, load the contract manifest, and know which runtime helpers and checks are required.

## Files

- `entity.plugin.json` - schema-compatible Entity plugin manifest
- `contracts/agent-contracts.v1.json` - machine-readable agent operating contracts
- `contracts/source-registry.v1.json` - initial Entity File Source id to local-root map
- `scripts/validate.mjs` - lightweight package validation

## Install model

Installers may install this package individually or as part of a bundle.

Individual install:

```bash
entity install entity-agent-contracts
```

Bundle install:

```bash
entity install entity-default
```

Until Entity has a full plugin loader, this is a soft plugin package: the manifest and contracts are stable, and host installers can consume them directly.

## Runtime expectations

Agents that load this package should expose or install an equivalent of:

```bash
scripts/entity-fs-link.sh <local-or-relative-path>
```

The resolver must return a URL shaped like:

```text
http://100.104.229.62:3000/docs/source/<sourceId>/<relativePath>
```

It should verify both the Entity FS file endpoint and docs endpoint before the link is sent as the primary deliverable.
