# CTRL Instructions

## Rules

1. Write/update tests for each changed file.
2. Run gates before marking done.
3. Fix failures and rerun until green.
4. Never ship failing gates.

## Gates

- Fast gate: `npm run ctrl:gate`
- Full gate: `npm run ctrl:full`

## Mode

Check `.ctrlrc.json` or package.json `ctrl.mode` for project mode (mvp/production).
- MVP: Build must pass, tests recommended
- Production: All gates mandatory, coverage required
