# Geordi QA superseding report — 20260826T103159Z-release-recovery-all-features-rerun1

Supersedes run `20260826T103159Z-release-recovery-all-features-rerun1` at `/Users/enterprise/clawd/output/geordi-qa/entity/20260826T103159Z-release-recovery-all-features-rerun1/report.json` (sha256 `70490b771de45400775ee8de3b84d76e450f1eaaf78baa5fe9a0d1258f0c1f51`).

The historical report and all historical receipts are preserved verbatim; historical evidence preserved, nothing was rewritten.

## Corrections

| Row | Field | From | To | Rationale |
|---|---|---|---|---|
| I2 | contractStatus | FAIL | INVALID_PREREQUISITE | The server suite was invoked directly (cd packages/server && npx vitest run) inside the read-only deploy-source checkout without generated broker outputs. The supported root `npm run test:server` entry point builds the managed-storage broker before testing (GQR-003); the exact-build release-deploy suite proved the broker build/publication contracts 129/129. The failures are an invalid prerequisite/setup artifact, not a product contract failure, and this reclassification is not a product pass. |

### Recorded evidence for each correction

- **I2**: "All ten failures are source-checkout FS/local conversion tests because the read-only deploy-source checkout intentionally has no packages/server/native/managed-storage-broker/.build/broker."

`INVALID_PREREQUISITE` means invalid prerequisite/setup — the observed failures stem from an unsupported invocation environment, not a product contract failure; it is not a product pass.

## Corrected counts

```json
{
  "visible": {
    "PASS": 22,
    "PARTIAL": 8,
    "FAIL": 1,
    "WRONG BUILD": 0,
    "BLOCKED": 31
  },
  "contract": {
    "PASS": 61,
    "FAIL": 0,
    "BLOCKED": 0,
    "NOT_APPLICABLE": 0,
    "INVALID_PREREQUISITE": 1
  }
}
```

## Historical blockers (verbatim)

- GitHub/S3 adapters return 500
- OpenWiki preview blank
- source-checkout server suite has 10 broker-absence failures
- native admin/detail/mobile workflows incomplete
