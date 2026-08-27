import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TERMINAL_WORKER_STATUSES,
  createProgressStateStore,
  isTerminalState,
  readProgressState,
} from "./progress-state.mjs";

const T0 = Date.parse("2026-08-27T10:00:00Z");

function clockFixture() {
  let now = T0;
  return {
    now: () => new Date(now).toISOString(),
    advanceMs: (ms) => {
      now += ms;
    },
  };
}

async function freshStore(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "geordi-progress-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "state.json");
  const clock = clockFixture();
  const store = createProgressStateStore(file, { now: clock.now });
  await store.init({ runId: "geordi-qa-run", target: "http://sandbox.entity" });
  return { store, file, clock, dir };
}

test("init writes a live running state", async (t) => {
  const { file } = await freshStore(t);
  const state = JSON.parse(await readFile(file, "utf8"));
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.runId, "geordi-qa-run");
  assert.equal(state.phase, "preflight");
  assert.equal(state.percent, 0);
  assert.equal(state.workerStatus, "running");
  assert.equal(state.lastProgressTime, new Date(T0).toISOString());
});

test("advance updates the state live: time, lane, evidence, percent", async (t) => {
  const { store, file, clock } = await freshStore(t);
  clock.advanceMs(30_000);
  const snap = await store.advance({
    phase: "lane-A",
    lane: "A",
    evidenceCount: 5,
    percent: 10,
  });
  assert.equal(snap.phase, "lane-A");
  assert.equal(snap.currentLane, "A");
  assert.equal(snap.evidenceCount, 5);
  assert.equal(snap.percent, 10);
  assert.equal(snap.lastProgressTime, new Date(T0 + 30_000).toISOString());
  const onDisk = JSON.parse(await readFile(file, "utf8"));
  assert.equal(onDisk.percent, 10, "advance must persist immediately (live state)");
});

test("advance is monotonic and idempotent per lane", async (t) => {
  const { store } = await freshStore(t);
  await store.advance({ phase: "lane-A", lane: "A", percent: 10 });
  await store.advance({ laneCompleted: "A", percent: 20 });
  await assert.rejects(
    () => store.advance({ percent: 15 }),
    /percent must not regress/i,
  );
  await store.advance({ laneCompleted: "A" });
  const snap = await store.snapshot();
  assert.deepEqual(snap.completedLanes, ["A"], "duplicate lane completion ignored");
});

test("advance rejects out-of-range percent and negative evidence", async (t) => {
  const { store } = await freshStore(t);
  await assert.rejects(() => store.advance({ percent: 101 }), /percent/i);
  await assert.rejects(() => store.advance({ percent: -1 }), /percent/i);
  await assert.rejects(() => store.advance({ evidenceCount: -3 }), /evidenceCount/i);
});

test("markTerminal records terminal status, verdict and stop reason, live", async (t) => {
  const { store, file, clock } = await freshStore(t);
  clock.advanceMs(60_000);
  const snap = await store.markTerminal({
    workerStatus: "wrong-build",
    verdict: "WRONG BUILD",
    stopReason: "Source checkout is not approved main SHA.",
  });
  assert.equal(snap.workerStatus, "wrong-build");
  assert.equal(snap.verdict, "WRONG BUILD");
  assert.equal(snap.lastProgressTime, new Date(T0 + 60_000).toISOString());
  assert.equal(JSON.parse(await readFile(file, "utf8")).workerStatus, "wrong-build");
});

test("markTerminal rejects non-terminal statuses and complete without full closeout", async (t) => {
  const { store } = await freshStore(t);
  await assert.rejects(
    () => store.markTerminal({ workerStatus: "running" }),
    /terminal/i,
  );
  await assert.rejects(
    () => store.markTerminal({ workerStatus: "complete", percent: 40 }),
    /100/i,
  );
  await store.advance({ percent: 100, phase: "closeout" });
  await store.markTerminal({ workerStatus: "complete" });
  assert.equal((await store.snapshot()).workerStatus, "complete");
});

test("markTerminal refuses to leave the running state once terminal", async (t) => {
  const { store } = await freshStore(t);
  await store.markTerminal({ workerStatus: "stopped", stopReason: "manager halt" });
  await assert.rejects(() => store.advance({ percent: 50 }), /terminal/i);
});

test("isTerminalState recognizes terminal worker statuses and WRONG BUILD verdict", () => {
  assert.equal(isTerminalState({ workerStatus: "running" }), false);
  for (const status of TERMINAL_WORKER_STATUSES) {
    assert.equal(isTerminalState({ workerStatus: status }), true, status);
  }
  assert.equal(isTerminalState({ workerStatus: "running", verdict: "WRONG BUILD" }), true);
});

test("readProgressState reports age, liveness and terminality from disk", async (t) => {
  const { file, clock } = await freshStore(t);
  clock.advanceMs(30_000);
  const live = await readProgressState(file, { now: clock.now, staleAfterSeconds: 60 });
  assert.equal(live.terminal, false);
  assert.equal(live.live, true);
  assert.equal(live.ageSeconds, 30);

  clock.advanceMs(120_000);
  const stale = await readProgressState(file, { now: clock.now, staleAfterSeconds: 60 });
  assert.equal(stale.live, false, "state older than the stale window is not live");
  assert.equal(stale.terminal, false);
});

test("atomic writes leave no temp litter and always-parseable state", async (t) => {
  const { store, dir } = await freshStore(t);
  for (let i = 1; i <= 5; i += 1) {
    await store.advance({ percent: i * 10, evidenceCount: i });
  }
  const leftovers = (await readdir(dir)).filter((name) => name !== "state.json");
  assert.deepEqual(leftovers, [], "no temp files may remain after atomic writes");
  JSON.parse(await readFile(path.join(dir, "state.json"), "utf8"));
});
