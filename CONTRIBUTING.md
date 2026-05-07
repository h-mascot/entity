# Contributing

Entity is early public software. Small, focused changes with clear verification
notes are easiest to review.

## Setup

```bash
npm install
cp .env.example .env
npm run setup
npm run dev
```

For manual config, copy `entity.config.example.yaml` to `entity.config.yaml` and
edit local paths, URLs, agents, and file sources for your machine.

## Checks

Run the relevant checks before opening a PR:

```bash
npm run scan:private-defaults
npm run build
cd packages/server && npx vitest run
```

When changing `packages/server/`, add or update colocated Vitest coverage where
practical.

## Pull Requests

- Keep the scope narrow.
- Include verification commands and results.
- Update docs when setup, config, or behavior changes.
- Do not commit DB files, `.env`, private profiles, secrets, logs, screenshots
  with private data, generated backup directories, or local agent scratch files.

## Deployments

Do not deploy from public PRs. `deploy.sh` requires explicit private production
environment variables and is intended for trusted operators only.
