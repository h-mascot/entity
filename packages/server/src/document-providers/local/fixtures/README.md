# Local Office engine fixtures (T-025 / R-017)

This directory is reserved for sanitized DOCX/XLSX/PPTX round-trip fixtures. T-025 does **not** claim that a runtime or desktop editor was installed or exercised.

## Reproducible manual protocol

1. Place a non-secret fixture in the managed local fixture directory.
2. Record the candidate, OS, editor/version, file hash before opening, and bridge readiness.
3. Open the file through the future document-scoped bridge (never an arbitrary path).
4. Make one visible edit, save, close, reopen, and inspect the result in the same editor.
5. Record hashes/revisions and whether the edit survived for DOCX, XLSX, and PPTX.
6. Remove any personal or customer data before committing evidence.

## T-025 result

| Candidate | DOCX | XLSX | PPTX | Open/edit/save/reopen | Status |
| --- | --- | --- | --- | --- | --- |
| GenOffice | unmeasured | unmeasured | unmeasured | not performed | deferred |
| ONLYOFFICE | unmeasured | unmeasured | unmeasured | not performed | deferred |
| Univer | unmeasured | unmeasured | unmeasured | not performed | deferred |
| Installed desktop app via bridge | conditional | conditional | conditional | not performed | recommended boundary only |

The table is intentionally capability-honest: no manual runtime proof was performed in this spike. The recommended desktop-bridge boundary is reversible and does not select a concrete editor or enable any product route.
