# Entity Phase 2 Native Markdown Storage and Versioning

## Scope

`THE-43` adds the storage/versioning seam for Entity-owned markdown records without choosing a final blob/object-store backend. The implemented contract stores stable object metadata, content hashes, and version history in SQLite so later filesystem/object-store work can plug in without changing the API shape.

## Current Storage Contract

- `NativeDocument` records point at a stable markdown path and content hash.
- `EvidenceArtifact` records point at a stable artifact path and content hash.
- `native_document_versions` stores every created or updated native markdown version.
- `evidence_artifact_versions` stores every created or updated evidence artifact version.
- Version records capture version number, stable path, content hash, metadata, actor, and timestamp.

The markdown body storage backend is intentionally abstracted. Current APIs require callers to provide a content hash and stable path metadata; a later backend may persist the body in the filesystem, object storage, or a content-addressed store while preserving the same stable identity and version history.

## Mutability Rules

- Editable native documents and curated artifacts use versioned updates.
- Immutable native documents cannot be overwritten; callers must create a superseding document.
- Raw evidence artifacts and task receipts are append-only. Their original body/hash metadata is never overwritten.
- Corrections, disputes, retries, or curated interpretation should create a new artifact or an editable curated report that references the raw source artifact.

## V1 Boundaries

- Google Docs/Drive remains an external reference layer and is not the storage backend for low-level proof.
- Raw proof remains Entity-native and immutable.
- This note documents the seam only; it does not introduce a final production storage backend, external mutation, or connector write behavior.
