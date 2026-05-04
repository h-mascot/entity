# Bird Multi-Host Install Report

## Scope
- Install Bird on Enterprise
- Install Bird on MascotM3
- Update shared tool references so all agents, including Book on MascotM3, have the Bird X/Twitter read path documented

## Install Result
### Enterprise
- `bird` path: `/Users/enterprise/.cargo/bin/bird`
- target: `/Users/enterprise/.npm-global/lib/node_modules/@steipete/bird/dist/cli.js`
- version: `0.8.0`
- support links added: `~/TOOLS.md`, `~/.openclaw/workspace/TOOLS.md`

### MascotM3
- `bird` path: `/Users/henrymascot/.cargo/bin/bird`
- target: `/Users/henrymascot/.npm-global/lib/node_modules/@steipete/bird/dist/cli.js`
- version: `0.8.0`
- support links added/synced: `~/clawd/TOOLS.md`, `~/clawd/memory/tools-reference.md`, `~/clawd/memory/agents-reference.md`, `~/clawd-memory-sync/memory/tools-reference.md`, `~/clawd-memory-sync/memory/agents-reference.md`, `~/.openclaw-zora/workspace/{TOOLS.md,memory/tools-reference.md,memory/agents-reference.md}`, `~/.openclaw-zora-sandbox/workspace/{TOOLS.md,memory/tools-reference.md,memory/agents-reference.md}`

## Book Coverage
- Book runs on MascotM3 under `~/.hermes/`
- Book inherits the MascotM3 Bird install
- Mac-side tool references now explicitly state that Book should use the same Bird install and `~/clawd/secrets/bird.env`

## Verification
### Enterprise
- `bird --version` -> `0.8.0`
- `bird check --plain` -> credentials detected from `~/clawd/secrets/bird.env`
- `bird read "https://x.com/tdinh_me/status/2017445413767500176" --plain` -> succeeded

### MascotM3
- `bird --version` -> `0.8.0`
- `bird check --plain` -> credentials detected from `~/clawd/secrets/bird.env`
- `bird read "https://x.com/tdinh_me/status/2017445413767500176" --plain` -> succeeded

## Canonical Docs Updated
- `TOOLS.md`
- `memory/tools-reference.md`
- `memory/tools/outreach-and-apis.md`
- `memory/agents-reference.md`
