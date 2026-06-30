# Entity deploy contract

Entity uses a staged deployment contract:

```text
/Users/enterprise/Code/Entity        # dev/source only
  -> GitHub origin/main              # reviewed source of truth
  -> sandbox.entity / :3007          # automatic deploy from main
  -> prod.entity / :3000             # manual promotion only
```

## Rules

1. `/Users/enterprise/Code/Entity` is a development checkout. Production must not run from it.
2. Sandbox may auto-deploy from GitHub `main` after CI passes.
3. Production must not auto-deploy from GitHub or a mutable sandbox working tree.
4. Production promotion must name an exact Git SHA and promote the same artifact that sandbox validated.
5. `ctrl:full` is a gate/evidence command, not a deploy command.
6. Runtime identity must be provable through `/api/version`, `RELEASE.json`, and `VERSION`.

## Target runtime layout

```text
/Users/enterprise/Services/entity-sandbox/
  releases/<sha>/
  current -> releases/<sha>
  previous -> releases/<sha>
  state/last-deployed.json
  state/validations/<sha>.json

/Users/enterprise/Services/entity-prod/
  releases/<sha>/
  current -> releases/<sha>
  previous -> releases/<sha>
  state/last-promoted.json
  state/approvals/<sha>.json
  state/validations/<sha>.json
```

The current live system has not fully migrated to this layout yet. As of the goal-mode audit on 2026-06-30:

- prod runs from `/Users/enterprise/Services/entity` on port `3000`
- sandbox runs from `/Users/enterprise/Code/entity-clickclack-dev` on port `3007`
- sandbox auto-deployer targets `main` and writes into the sandbox runtime directory
- old prod/gateway auto-deployer is disabled but stale files/state remain

## Release identity

Every release should contain:

- `VERSION` — full 40-character Git SHA
- `RELEASE.json` — manifest with SHA, repo, branch, build time, package lock hash, artifact hash, and dist hashes

The server exposes `GET /api/version` so deploy checks can prove the live runtime identity without authenticated API access.

## Minimum prod promotion gates

Before prod promotion:

1. GitHub Actions passed for the exact SHA.
2. Sandbox deployed and served the exact SHA.
3. `/api/version` on sandbox reports the exact SHA or the release files verify it.
4. Sandbox smoke checks pass for `/`, `/api/health`, `/api/tasks`, and config route.
5. Prod approval receipt names the SHA/artifact hash.
6. Current prod SHA/release is captured as rollback target.
7. Candidate artifact hash matches the sandbox-validated artifact.
8. Prod DB path, service label, and port are explicitly checked.

## Approval boundary

The following require explicit prod approval:

- changing `com.claw.entity-server.plist`
- restarting or kickstarting prod
- flipping prod `current` symlink
- running `promote:prod` or prod-targeted `deploy.sh`
- changing prod Caddy routing
- changing prod DB path or restoring/backing up prod DB

Safe source-level changes include version endpoint code, manifest generation, check-only verification, and documentation.
