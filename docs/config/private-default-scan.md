# Private Default Scan

Entity portability requires public runtime code to avoid Henry/Enterprise-specific defaults.

Run:

```bash
npm run scan:private-defaults
```

Strict mode:

```bash
npm run scan:private-defaults -- --enforce
```

The scan checks runtime source, scripts, public docs/config examples, and onboarding-facing files for values that should not ship as public defaults:

- `/Users/enterprise`
- `/home/henrymascot`
- `/home/jamify`
- `enterprise@...`
- Tailnet `100.*` IPs
- Henry/Enterprise naming
- Enterprise crew names
- `clawd*` workspace assumptions

The default mode writes a baseline report to:

```text
docs/reports/private-default-scan-baseline.md
```

Default mode does not fail yet because the repo still contains known Enterprise assumptions. As each productization slice moves values into settings/config/profile, the baseline should shrink. Later, CI should run strict mode with explicit allowlists for internal-only fixtures/profiles.

## Scope

Scanned:

- `packages/app/src`
- `packages/server/src`
- `packages/db/src`
- `scripts`
- root deploy/dev scripts
- public README/config docs/examples

Excluded:

- `node_modules`
- generated `dist`/build output
- internal plans/specs/reports
- screenshots/artifacts

## Policy

A value may remain as a public built-in default only if it is universal and safe for nearly every Entity installation. Private hosts, private paths, Henry names, Enterprise services, and specific crew defaults belong in explicit profiles/settings, not source constants.
