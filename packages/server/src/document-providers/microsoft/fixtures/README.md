# Microsoft capability-spike fixtures (T-021 / THE-962)

These are **fixture contracts**, not live Microsoft files or provider calls. No tenant data,
credentials, tokens, or downloaded artifacts belong in this directory. A future T-022/T-023
lane may add sanitized OOXML fixtures only after recording their source, license, SHA-256, and
round-trip proof.

## Required fixture set before enabling a format mutation

| Fixture | Required proof | Current disposition |
| --- | --- | --- |
| `docx` minimal document | create/upload, open in Microsoft 365, mutate a text node, reopen and compare | Not present; `agent_text_mutation=unsupported` |
| `xlsx` minimal workbook | create/upload, mutate a named range/cell, reopen and compare workbook semantics | Not present; `agent_range_mutation=unsupported` |
| `pptx` minimal presentation | create/upload, mutate a slide element, reopen and compare package semantics | Not present; `agent_slide_mutation=unsupported` |
| provider version/change sample | item identity, opaque version IDs, delta token, rename/move behavior | T-024 scope; no live sample here |
| preview/open sample | thumbnail availability and provider web URL, including unavailable branch | T-024 scope; no live sample here |

A file upload or download round trip proves storage only. It does **not** prove format-aware
mutation. The fixture must demonstrate a deterministic semantic mutation and a valid artifact
that reopens in the corresponding Microsoft editor. Whole-file replacement without a revision
precondition is explicitly not an acceptable mutation proof.

## Safe fixture metadata contract

Every future fixture manifest must include:

```json
{
  "artifactType": "document | spreadsheet | presentation",
  "format": "docx | xlsx | pptx",
  "source": "exact public/provider or generated source",
  "license": " SPDX or provider permission reference",
  "sha256": "64 lowercase hex characters",
  "retrievedAt": "YYYY-MM-DD",
  "roundTripProof": "path to bounded proof receipt"
}
```

Do not add real tenant artifacts. The capability matrix in
`../capability-spike.ts` remains the authoritative default until the fixture and current
provider evidence are reviewed together.
