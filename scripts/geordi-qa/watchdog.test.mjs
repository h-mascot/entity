import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createProgressStateStore, readProgressState } from "./progress-state.mjs";
import { runWatchdog } from "./watchdog.mjs";

const T0 = Date.parse("2026-08-27T10:00:00Z");

function clockFixture(startMs = T0) {
  let ms = startMs;
  return {
    now: () => new Date(ms).toISOString(),
    advanceMs: (delta) => {
      ms += delta;
    },
  };
}

async function freshRun(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "geordi-watchdog-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, "state.json");
  const clock = clockFixture();
  const store = createProgressStateStore(file, { now: clock.now });
  await store.init({ runId: "geordi-qa-run", target: "http://sandbox.entity" });
  return { file, clock, store };
}

test("self-pauses on the first poll when the state is already terminal", async (t) => {
  const { file, store } = await freshRun(t);
  await store.advance({ percent: 100, phase: "closeout" });
  await store.markTerminal({ workerStatus: "complete" });

  const sleeps = [];
  const result = await runWatchdog({
    stateFile: file,
    pollIntervalMs: 1000,
    maxPolls: 10,
    staleAfterSeconds: 60,
    read,
    sleep: async (ms) => sleeps.push(ms),
  });
  assert.equal(result.selfPaused, true);
  assert.equal(result.polls, 1);
  assert.deepEqual(sleeps, [], "no further polling after terminal state");
  assert.equal(result.reason.workerStatus, "complete");
  assert.ok(result.receipt.pausedAt);
  assert.ok(result.receipt.runId);
});

test("keeps observing a live advancing run, then self-pauses at terminal", async (t) => {
  const { file, clock, store } = await freshRun(t);
  const events = [];
  let pollsSeen = 0;

  const worker = (async () => {
    await sleep(10);
    await store.advance({ phase: "lane-A", lane: "A", percent: 20, evidenceCount: 4 });
    await sleep(10);
    clock.advanceMs(5_000);
    await store.advance({ laneCompleted: "A", percent: 40 });
    await sleep(10);
    clock.advanceMs(5_000);
    await store.advance({ percent: 100, phase: "closeout" });
    await store.markTerminal({ workerStatus: "stopped", stopReason: "manager halt" });
  })();

  const result = await runWatchdog({
    stateFile: file,
    pollIntervalMs: 1,
    maxPolls: 50,
    staleAfterSeconds: 120,
    read: (fileArg, opts) => readProgressState(fileArg, { ...opts, now: clock.now }),
    sleep: async (ms) => {
      pollsSeen += 1;
      await sleep(ms);
    },
    onObservation: (event) => events.push(event),
  });
  await worker;

  assert.equal(result.selfPaused, true);
  assert.equal(result.reason.workerStatus, "stopped");
  assert.equal(result.reason.stopReason, "manager halt");
  assert.ok(result.polls >= 3, "observed multiple live polls before terminal");
  assert.ok(
    events.every((event) => event.type !== "self-paused" || event === events.at(-1)),
    "self-pause is the final event",
  );
});

test("reports stalled observations without killing the run, then pauses at terminal", async (t) => {
  const { file, clock, store } = await freshRun(t);
  // State is written once at T0, then the watchdog clock runs far ahead.
  await store.advance({ percent: 10 }); // written once, then abandoned
  clock.advanceMs(10 * 60_000);
  const before = await readProgressState(file, { now: clock.now });
  assert.equal(before.live, false);

  const events = [];
  const result = await runWatchdog({
    stateFile: file,
    pollIntervalMs: 1,
    maxPolls: 3,
    staleAfterSeconds: 60,
    read: (fileArg, opts) => readProgressState(fileArg, { ...opts, now: clock.now }),
    sleep: async () => {
      clock.advanceMs(1_000);
    },
    onObservation: (event) => events.push(event),
  });

  assert.equal(result.selfPaused, false, "no terminal state reached");
  assert.equal(result.reason, "max-polls");
  assert.ok(events.some((event) => event.type === "stalled"), "stall surfaced, not silently ignored");
});

test("the pause receipt carries the full terminal state summary", async (t) => {
  const { file, store } = await freshRun(t);
  await store.advance({ percent: 100, phase: "closeout" });
  await store.markTerminal({
    workerStatus: "wrong-build",
    verdict: "WRONG BUILD",
    stopReason: "Source checkout is not approved main SHA.",
  });
  const result = await runWatchdog({
    stateFile: file,
    pollIntervalMs: 10,
    maxPolls: 5,
    sleep: async () => {},
  });
  assert.equal(result.receipt.reason.workerStatus, "wrong-build");
  assert.equal(result.receipt.reason.verdict, "WRONG BUILD");
  assert.equal(result.receipt.reason.stopReason, "Source checkout is not approved main SHA.");
  assert.equal(result.receipt.observed.percent, 100);
  assert.equal(result.receipt.action, "self-pause");
});

test("rejects invalid poll settings", async (t) => {
  const { file } = await freshRun(t);
  await assert.rejects(
    () => runWatchdog({ stateFile: file, pollIntervalMs: 0, maxPolls: 1, sleep: async () => {} }),
    /pollIntervalMs/,
  );
  await assert.rejects(
    () => runWatchdog({ stateFile: file, pollIntervalMs: 10, maxPolls: 0, sleep: async () => {} }),
    /maxPolls/,
  );
});

function read(file, opts) {
  return readProgressState(file, opts);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
