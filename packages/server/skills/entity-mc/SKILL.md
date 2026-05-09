---
name: entity-mc
description: Use when an agent is given an Entity onboarding setup link or needs to operate Entity Mission Control through the public app APIs.
---

# Entity MC

Entity MC is the public, setup-safe operating skill for Entity. It contains no private host paths, agent names, credentials, cron jobs, or production assumptions. Use only the setup URL, manifest, and API URLs supplied by the running Entity app.

## Onboarding Flow

1. Open the setup URL the human gave you, for example `/onboard/agent/<token>`.
2. Read the manifest from `/api/onboarding/agent-session/<token>/manifest`.
3. Download the bundle from the manifest `entityMc.bundleUrl`.
4. Install locally:

```bash
bash install.sh --entity-url http://localhost:3000 --token <token>
```

5. Verify:

```bash
bash verify.sh --entity-url http://localhost:3000 --token <token>
```

6. Report setup progress:

```bash
entity-mc progress skill done "Entity MC installed"
entity-mc progress workspace done "Workspace settings checked"
entity-mc progress verified done "Ready"
```

## Mission Control Commands

```bash
entity-mc manifest
entity-mc config
entity-mc tasks
entity-mc task <id>
entity-mc move-task <id> <backlog|todo|doing|review|done>
entity-mc add-activity <id> "note"
```

## Rules

- Setup tokens are one-time setup access. Do not reuse them for unrelated work.
- Do not infer file paths, hosts, agent names, API keys, or deployment targets.
- Do not install cron jobs or background daemons from this skill.
- Leave advanced Admin setup alone unless the manifest explicitly asks for it.
- Use Entity APIs for task/card movement; do not edit the database directly.
- If an API returns a validation error, surface it instead of bypassing it.

## Files

- `install.sh` - local helper install
- `verify.sh` - local/API verification
- `rollback.sh` - removes the local helper install
- `source-scripts/mc.sh` - generic Entity CLI
- `manifests/example.env` - safe example only
