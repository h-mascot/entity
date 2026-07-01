# ACTIVE PLAN — Entity 10x Implementation

Branch: `cursor/entity-10x-implementation-1879`
Driven from: `docs/reviews/2026-07-01-10x-review.md`
Goal: execute the full roadmap end-to-end and validate 10x on each front.

## 10x success targets (measured)

| Front | Baseline | 10x target | Fallback if impossible |
|-------|----------|-----------|------------------------|
| Faster (initial load) | 705 KB gzip single JS chunk | Entry chunk ≤ ~70 KB gzip, heavy libs lazy | Push as low as possible; report ceiling |
| Faster (agent reply) | blocking generateText (2–15s) | streamed TTFB < 500ms | report actual |
| Quality (gate) | ctrl:gate runs 0 tests | gate runs all workspace tests (573+) and fails on red | — |
| Quality (monolith) | index.ts 6378 LOC | ≤ ~640 LOC (10x smaller) via extraction | as small as safely possible |
| Secure | 4 verified-exploitable P0 chains | 0, each with a failing-first regression test | — |

## Waves (checkboxes)

- [x] W1a Quality gate real + .bak removal
- [x] W1b Perf bundle split + lazy tabs + sentry sampling + memo kanban
- [x] W2 Security: auth fail-closed, legacy read containment, FS root allowlist, cmd-injection fixes, terminal input binding, webhook/test-error gating + tests
- [x] W3 Perf server: pagination/caps, /tasks/:id fix, WS unify + drop polls, parallel @mention + prompt cache
- [x] W4 Quality refactor: asyncHandler, break up index.ts (6392->630 LOC, 10.1x), tests for riskiest modules + db
- [x] Validate 10x: gate green (646 tests), app browser-tested, security runtime-verified, bundle re-measured

## Result vs targets
| Front | Target | Achieved |
|-------|--------|----------|
| Faster (entry chunk) | ≤70 KB gzip | 705 KB -> 5.26 KB gzip (134x); heavy libs (codemirror/xterm/markdown ~450 KB gzip) now lazy |
| Quality (gate) | run all tests, fail on red | gate runs 646 tests (build+app+db+server), fail-path proven |
| Quality (monolith) | ≤640 LOC | index.ts 6392 -> 630 LOC (10.1x) |
| Secure | 0 exploitable P0, tests each | 4 chains closed + runtime-verified + 22 regression tests |

## Verify commands
- `cd packages/server && npm run build && npx vitest run`
- `npm --prefix packages/app run build` (record chunk sizes)
- `npm run ctrl:gate`

## Resume instructions
Run `git status`/`git log --oneline`, find first unchecked wave, continue. Code is written by gpt-5.5 subagents; orchestrator builds+tests between waves.
