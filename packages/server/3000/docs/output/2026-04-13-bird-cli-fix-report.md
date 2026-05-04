# Bird CLI Fix Report

## Summary
Restored Bird CLI on ada-gateway.

## Root Cause
`bird` on PATH resolved to `/home/henrymascot/bin/bird`, which pointed to `/home/henrymascot/Code/bird/dist/cli.js` from an older local repo. That binary only supported `bird tweet` and ignored newer subcommands like `read`, `thread`, and `replies`.

## Fix Applied
- Installed `@steipete/bird` version `0.8.0` to `~/.npm-global`
- Repointed `/home/henrymascot/bin/bird` to `~/.npm-global/bin/bird`
- Existing `/usr/local/bin/bird` now resolves through that corrected user-level symlink

## Verification
Commands run successfully with `~/clawd/secrets/bird.env` loaded:
- `bird --version` → `0.8.0`
- `bird check --plain` → credentials detected from env
- `bird read "https://x.com/tdinh_me/status/2017445413767500176" --plain` → returned tweet text and metadata
- `bird thread "https://x.com/tdinh_me/status/2017445413767500176" --plain` → returned thread/reply chain
- `bird replies "https://x.com/tdinh_me/status/2017445413767500176" --plain` → returned replies

## Current Resolution Path
- `/home/henrymascot/bin/bird` → `/home/henrymascot/.npm-global/bin/bird`
- effective CLI → `/home/henrymascot/.npm-global/lib/node_modules/@steipete/bird/dist/cli.js`
