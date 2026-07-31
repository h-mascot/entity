# Phase B Test Receipt

**Source SHA:** `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`
**Worktree HEAD:** `2ad32ee47889ad69bb37efba4712dac7d8a084ea`
**Generated at:** 2026-07-30T03:31:08Z
**Node:** v22.22.1
**npm:** 10.9.4
**PATH prefix:** `/Users/enterprise/.hermes/node/bin` (Node 22)

## Command deviations vs prompt

| Prompt command | Actual | Notes |
| --- | --- | --- |
| `npm --prefix packages/db run test -- --runInBand` | `npm --prefix packages/db run test` (= `vitest run src`) | No `--runInBand` in db vitest script; vitest 4 has no Jest-style runInBand |
| `npm --prefix packages/server run test -- --runInBand` | `cd packages/server && npx vitest run` | Same; used workspace vitest |
| `npm run typecheck --if-present` | Covered by `tsc` via `npm run build` / package builds | No root typecheck script |

## Results

| Command | Result |
| --- | --- |
| `node -v` / `npm -v` | v22.22.1 / 10.9.4 |
| `npm install` | PASS |
| `npm run scan:private-defaults --if-present` | PASS (errors=0; warnings=206 baseline) |
| `npm --prefix packages/db run test` | PASS 5/5 |
| `cd packages/server && npx vitest run src/provider-registry` | PASS 32/32 |
| `cd packages/server && npm run build && npx vitest run` | PASS build; PASS 768/768 |
| `npm run build` (root app+db+server) | PASS |
| `npm run ctrl:gate` | PASS ✅ |

## Gate tail

```
 Test Files  2 passed (2)
      Tests  5 passed (5)
   Start at  04:30:06
   Duration  464ms (transform 321ms, setup 0ms, import 103ms, tests 478ms, environment 0ms)


> @entity/server@0.0.1 test
> npx vitest run


 RUN  v4.1.2 /Users/enterprise/Code/entity-provider-registry-phase-b-runner/packages/server


 Test Files  106 passed (106)
      Tests  768 passed (768)
   Start at  04:30:08
   Duration  3.46s (transform 10.44s, setup 0ms, import 18.66s, tests 13.42s, environment 11ms)

[ctrl] unit tests passed
[ctrl] gate passed ✅
```
