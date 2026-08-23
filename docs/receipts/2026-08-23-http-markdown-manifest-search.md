# HTTP Markdown Manifest Search Receipt

Date: 2026-08-23
Status: patch-ready locally, not pushed, not deployed

## Changed files

- `packages/server/src/fs/adapters/http-markdown.ts` — adds version-1 manifest parsing, bounded file/count/response limits, same-origin manifest URL validation, ambiguous file/directory path rejection, synthesized directory/file nodes, cached manifest loading, and effective list/search capabilities only after a valid manifest loads.
- `packages/server/src/fs/adapters/http-markdown.test.ts` — covers no-manifest exact-read-only behavior, valid manifest listing, invalid/off-origin rejection, file-path-shadow rejection, and preserved read guards.
- `packages/server/src/fs/index-runner.test.ts` — covers indexing a manifest-listed markdown file through the real HTTP markdown adapter and runner.
- `packages/server/src/config/schema.ts` — adds optional config `fileSources[].manifestPath`.
- `packages/server/src/config/runtime.ts` — persists configured manifest paths in source capabilities JSON.
- `packages/server/src/fs/routes-sources.ts` — accepts `manifestPath`/same-origin `manifestUrl`, persists them through the existing capability channel, and exposes `searchability` as `exact-read-only`, `manifest-backed`, or `adapter-defined`.
- `packages/app/src/hooks/useFileSources.ts` — sends optional manifest path during source creation/update.
- `packages/app/src/types/filesystem.ts` — types the API searchability indicator.
- `packages/app/src/components/settings/FileSourcesSettings.tsx` — adds manifest-path configuration and truthful source-mode text.
- `docs/plans/2026-08-23-http-markdown-manifest-search-plan.md` — durable task plan.

## Verification

Book parent verification after Entity Builder completed:

- `npm rebuild better-sqlite3 --build-from-source` — passed after setting `/private/tmp` npm cache; restored Node 22 native binding for route/full tests in this clean worktree.
- `npm --prefix packages/server run test -- src/fs/adapters/http-markdown.test.ts src/fs/index-runner.test.ts src/config/runtime.test.ts src/config/load.test.ts src/fs/routes-sources.test.ts` — passed, 5 files / 40 tests.
- `npm --prefix packages/server run test` — passed, 202 files / 1706 tests.
- `npm run build` — passed, app + db + server.
- Codex review before fix: found P2 file/directory shadow bug in manifest paths.
- Parent fix: reject manifest paths where one file path shadows another path's directory prefix, plus regression test.
- Codex review after fix: clean, no accepted/actionable findings.

## Result

The patch is locally verified and ready for human review/PR. No commit, push, PR, sandbox deploy, or production deploy was performed by this receipt.

## Open questions before live use

- Decide the Ada Gateway manifest publication path, e.g. `manifest.json` under the Ada docs base URL.
- After merge/deploy, configure `ada-gateway` with that manifest path and run a live source sync/readback before calling Ada global search fixed.
