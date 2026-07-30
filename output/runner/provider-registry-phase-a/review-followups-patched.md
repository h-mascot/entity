# Review follow-ups patched

Status: patched

Reviewer findings addressed:

1. Backup verification wording now requires verifying the retained backup checksum and comparing live DB state logically, not byte-comparing online backup against mutable WAL source.
2. Provider-health persistence now acknowledges sandbox `provider_health_samples` / `provider_recovery_receipts` and requires a Phase B reuse/migrate/separate decision.
3. Provider-error exposure now records raw `Error.message` log/API response risk and requires redacted provider-error envelopes.
4. Actual invocation usage tracking seam now requires recording usage/error/health around real `generateText` call sites, not only resolver construction.

Touched artifacts:
- `migration-rollback-plan.md`
- `provider-adapter-capability-matrix.md`
- `permissions-csrf-rate-limit-log-audit.md`
- `phase-a-final-report.md`

Additional reviewer findings addressed:

5. Provider-kind support matrix now explicitly classifies every SuperSpec §13.1 packet-listed kind, including distinct Azure OpenAI and Local/OpenAI-compatible rows with storable status, adapter availability, Task Master/Docs compatibility, health-test strategy, and Phase B/C exposure classification.
6. Canonical open-decisions artifact now carries OQ-019–OQ-028 production cutover decisions with owner/status and cutover gating rule.

