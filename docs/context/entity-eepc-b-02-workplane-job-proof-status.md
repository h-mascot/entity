# EEPC-B-02 — Wire job proof/status into Workplane activity/proof panels

**Linear:** THE-897  
**Build-plan task:** EEPC-B-02  
**Parent:** THE-832 (Entity Execution-Engine Plugin Contract — Phase B)  
**Decision:** IMPLEMENTED  
**Dependencies:** EEPC-A-03 / THE-891 Done; WP1-C-03 / THE-871 Done (Workplane panels integrated via WP1-C-07 merge)

## What this delivers

App-side wiring that surfaces execution-engine job **proof** and **status** on existing Workplane panels:

1. **Activity / progress panel** — job-linked spine rows show a Job badge, provider/job/status label, and nested `event_body.summary` from EEPC-A-03 callbacks (also WP1-C-04 `swarm_job` adapter rows).
2. **Proof bundle panel** — proof-typed job artifact refs (`artifact_refs`, commit sha, payloadRef) merge into the proof bundle as `execution_job_proof` items; status-only signals never invent proof.
3. **Fail-closed** — secret-like refs dropped; incomplete job proof stays visible as `proof_incomplete` and never claims review-ready.

| Surface | Path |
| --- | --- |
| Job signal extract/merge | `packages/app/src/lib/workplaneJobProofStatus.ts` |
| Proofs | `packages/app/src/lib/workplaneJobProofStatus.test.ts` |
| Activity panel | `packages/app/src/components/workplane/ActivityProgressPanel.tsx` |
| Proof panel | `packages/app/src/components/workplane/ProofBundlePanel.tsx` |
| Shell merge | `packages/app/src/components/workplane/WorkplaneShell.tsx` |

## Acceptance

- [x] Job proof/status visible in Workplane activity + proof panels
- [x] Dependencies satisfied (EEPC-A-03 + WP1-C-03)
- [x] Browser proof required
- [x] No secret leakage / no production promotion

## Non-goals

- No Doc Hub rebuild / Provider Registry duplicate / Skill Workshop
- No replacing legacy swarm status/proof mutation routes
- No canonical dirty-tree edits
