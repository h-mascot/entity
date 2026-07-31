# provider-registry-open-decisions.md

Canonical SuperSpec §4.7 #8 and §24 open-decision ledger.

Status: `PROPOSED_FROM_AUDIT` — Henry/Engineering/Security/Release sign-off pending. THE-743/THE-744 remain In Review.

## Phase A decisions (OQ-001–OQ-018)

See `oq-001-oq-018-decision-ledger.md` for the full proposed ledger.

## Production cutover decisions (OQ-019–OQ-028)

These are canonical open decisions from the controlling SuperSpec §24.2. They are not blockers for Phase A audit closeout, but they are blockers for production cutover / legacy cleanup and must be carried into Phase B+ planning.

| ID | Decision | Owner | Status | Why it matters |
| --- | --- | --- | --- | --- |
| OQ-019 | How long must legacy fallback remain enabled? | Henry + Engineering | OPEN | Controls cleanup and rollback window |
| OQ-020 | Is read-only registry rollout required before mutations? | Release owner | OPEN | Controls staged exposure |
| OQ-021 | Are registry changes mirrored to legacy settings during rollback window? | Engineering + Product | OPEN | Determines behavior after code rollback |
| OQ-022 | How long are provider health-test records retained? | Product + Backend | OPEN | Controls storage/audit history |
| OQ-023 | May exact environment-variable names be shown to administrators? | Security + Product | OPEN | Controls `referenceHint` disclosure |
| OQ-024 | Should a material profile edit display `never_tested` or `untested_after_change`? | Product | OPEN | Controls health semantics after edits |
| OQ-025 | Can Run Now operate when scheduling is disabled? | Task Master owner | OPEN | Determines action availability |
| OQ-026 | What timeout/rate limit applies to provider tests? | Platform + Security | OPEN | Controls resource use and abuse |
| OQ-027 | What production observability system receives registry events? | Observability owner | OPEN | Required for release monitoring |
| OQ-028 | What approved production rollback observation period gates legacy removal? | Release owner | OPEN | Determines when fallback can be removed |

Design-freeze rule: Phase B may start with these tracked as cutover gates, but production promotion and legacy fallback removal cannot proceed until OQ-019–OQ-028 are accepted or amended.
