# OpenClaw GHSA skill verification

This runbook documents how we verify whether the `openclaw-ghsa-maintainer` skill is available on a gateway and what to do with the result.

## Why this exists

Entity roadmap item: verify and document the OpenClaw GHSA security skill installation and configuration path for our gateways so ClawHub hygiene is checkable instead of assumed.

## Expected skill id

- `openclaw-ghsa-maintainer`

## Where we check

The verification script checks the most likely skill locations used by our gateways:

- `~/.openclaw/skills/openclaw-ghsa-maintainer/SKILL.md`
- `~/.agents/skills/openclaw-ghsa-maintainer/SKILL.md`
- `/usr/lib/node_modules/openclaw/skills/openclaw-ghsa-maintainer/SKILL.md`
- `/usr/local/lib/node_modules/openclaw/skills/openclaw-ghsa-maintainer/SKILL.md`

It also does a fallback search under `~/.openclaw`, `~/.agents`, and the common global OpenClaw install roots.

## Verification command

Run from the Entity repo:

```bash
./scripts/check-openclaw-ghsa-skill.sh
```

Remote gateway example:

```bash
ssh <gateway-host> 'cd ~/Code/entity && ./scripts/check-openclaw-ghsa-skill.sh'
```

## Current verified state, 2026-04-11

Verified from this work pass:

- ada-gateway: `NOT_FOUND`
- Mac source of truth (`100.86.150.96`): `NOT_FOUND`

That means the roadmap item is still real. The skill was not present in the standard shared or bundled skill paths on either checked host during this pass.

## Operational next step

If we decide this skill should be active on a gateway, install it through the canonical OpenClaw skill flow for that environment, then rerun the verification script and save the output under `output/entity/`.

Until then, this check is our source of truth for presence versus assumption.

