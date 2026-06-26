# Entity Phase 2 Linear Live Preflight — 2026-06-21

- Pack: `/Users/enterprise/Code/Entity/docs/execution-packs/entity-phase-2-cursor-20260621`
- Live issues fetched: **75/75**
- UUID match: **75/75**
- Canonical title patched/exact after patch: **75/75**
- Title contains source ID: **75/75**
- Parent link match: **75/75**
- Body heading contains source ID: **0/75**
- Body contains source ID anywhere: **0/75**
- Source section slug / Linear URL source key match: **75/75**
- Proof commands present in issue body: **75/75**
- Suspicious banned-term issues: **0**

## Verdict

**FAIL — generated pack remains not approved for Cursor execution.**

Blockers:
- `body_source_key_alignment_not_all_confirmed`

## Sample rows

| Issue | Source | UUID | Parent | Title source | Body heading | Body contains source | URL slug | Proof cmds | Suspicious banned |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `THE-21` | `THE-6.1` | True | True | True | False | False | True | True | 0 |
| `THE-22` | `THE-6.2` | True | True | True | False | False | True | True | 0 |
| `THE-23` | `THE-6.3` | True | True | True | False | False | True | True | 0 |
| `THE-24` | `THE-6.4` | True | True | True | False | False | True | True | 0 |
| `THE-25` | `THE-6.5` | True | True | True | False | False | True | True | 0 |
| `THE-91` | `THE-20.1` | True | True | True | False | False | True | True | 0 |
| `THE-92` | `THE-20.2` | True | True | True | False | False | True | True | 0 |
| `THE-93` | `THE-20.3` | True | True | True | False | False | True | True | 0 |
| `THE-94` | `THE-20.4` | True | True | True | False | False | True | True | 0 |
| `THE-95` | `THE-20.5` | True | True | True | False | False | True | True | 0 |

Full per-issue boolean receipt is in `linear-live-preflight-20260621.json`. Raw live fetch is kept under ignored `output/` for local audit only.

## Repo / proof command receipt

- `bash scripts/proof/entity-phase-2-smoke.sh`: **PASS**
- Server build: PASS
- Vitest: **53 files / 385 tests PASS**
- Root build: PASS
- Branch state at check: `main...origin/main [ahead 1]`
- Dirty state at check: `.gitignore` modified; generated pack/spec mapping untracked.
- Runtime state ignore verified: `.cursor/run-state/` and `output/` are ignored.
