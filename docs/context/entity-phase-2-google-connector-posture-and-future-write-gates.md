# Entity Phase 2 Google Connector Posture and Future Write Gates

## Scope

THE-85 documents the Google Docs/Drive V1 connector posture. V1 is limited to read/index/link/preview so Entity can attach externally owned Google context to work objects without becoming a Google Docs or Drive mutation surface.

Google Docs is not canonical low-level proof storage. Entity-native markdown receipts remain the canonical proof record for completed `entity-mc` work, even when a task also links to a human-authored Google Doc, Drive item, or later curated report.

## V1 Posture

Google Docs/Drive V1 may:

- read safe metadata for authorized external refs;
- index permitted snippets for search after Entity visibility checks;
- link external refs to tasks, projects, goals, plans, specs, and proof objects;
- preview metadata/snippets where connector auth and Entity policy both allow it;
- open the externally owned Google URL when the ref is available and visible.

Google Docs/Drive V1 must not:

- create Google Docs or Drive files;
- update Google Docs content or Drive metadata;
- write Entity markdown into Google Docs;
- export Entity proof into Google Docs;
- sync Entity-native documents or receipts into Google Docs by default.

## Future Write/Export/Sync Gates

Writes/export/sync are later-phase capabilities, outside the V1 default path. A later implementation must require all of the following before any external mutation is possible:

- an explicit product requirement naming the write/export/sync operation;
- a narrow permission gate that distinguishes read/preview users from external mutation operators;
- user confirmation for the exact target document or Drive item;
- an audit trail recording actor, work object, target external ref, requested operation, prior state summary where safe, result, and failure/degraded state;
- proof that canonical Entity receipts remain Entity-native and are not replaced by mutable external documents;
- tests showing denied, insufficient-scope, expired-auth, and degraded connector paths do not mutate external content.

## Security Caveats

Connector scopes should be minimal. The security posture is minimal scopes plus no mutation proof: the product-level V1 scope set is `read`, `index`, `link`, and `preview`; implementation-specific provider scopes must be the least privilege needed to support those capabilities.

External connector permission does not grant Entity visibility. Entity permission and sensitivity checks must run before snippets, previews, search content, permission summaries, or open URLs are returned.

No mutation proof for V1 means tests and receipts should demonstrate absence of create/update/write/export/sync behavior. V1 proof should not rely on a Google-side write log because the connector should not request or exercise mutation capabilities in the first place.

## Audit Trail Requirements for Later Writes

If a later phase adds write/export/sync, every attempted mutation must produce an Entity audit/evidence reference before it can be treated as complete. The audit record must show who initiated the action, who approved it where required, which work object authorized it, which external ref was targeted, whether the operation succeeded, and how failures were surfaced.

External document mutations must never be the only proof of work completion. They can be linked evidence or human-facing outputs, but low-level task proof remains the Entity-native receipt.
