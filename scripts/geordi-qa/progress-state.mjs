// Geordi QA live progress state (GQR-006).
//
// The first release-recovery QA run left state.json stuck at "closeout/15%"
// because the state was only written at start and closeout, never live. This
// store keeps the on-disk state live: every init/advance/markTerminal writes
// atomically (tmp file + rename) and stamps lastProgressTime, lanes complete
// idempotently, percent never regresses, and terminal states are final so a
// watchdog can observe them and self-pause.
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const TERMINAL_WORKER_STATUSES = ["complete", "stopped", "wrong-build", "aborted"];

export function isTerminalState(state) {
  if (!state || typeof state !== "object") return false;
  if (TERMINAL_WORKER_STATUSES.includes(state.workerStatus)) return true;
  return state.workerStatus === "running" && state.verdict === "WRONG BUILD";
}

function assertPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("percent must be a finite number between 0 and 100");
  }
}

export function createProgressStateStore(file, { now = () => new Date().toISOString() } = {}) {
  let state = null;

  async function persist(next) {
    state = next;
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`);
    await rename(tmp, file);
    return structuredClone(next);
  }

  function assertNotTerminal() {
    if (state && isTerminalState(state)) {
      throw new Error(`progress state is terminal (${state.workerStatus}); no further updates`);
    }
  }

  return {
    async init({ runId, target }) {
      if (state) throw new Error("progress state already initialized");
      return persist({
        schemaVersion: 1,
        runId,
        target: target ?? null,
        phase: "preflight",
        percent: 0,
        currentLane: null,
        completedLanes: [],
        evidenceCount: 0,
        lastProgressTime: now(),
        workerStatus: "running",
        verdict: null,
      });
    },
    async advance({ phase, lane, laneCompleted, evidenceCount, percent } = {}) {
      assertNotTerminal();
      if (state === null) throw new Error("progress state not initialized");
      if (percent !== undefined) assertPercent(percent);
      if (evidenceCount !== undefined && (!Number.isInteger(evidenceCount) || evidenceCount < 0)) {
        throw new Error("evidenceCount must be a non-negative integer");
      }
      if (percent !== undefined && percent < state.percent) {
        throw new Error(`percent must not regress (current ${state.percent}, got ${percent})`);
      }
      const completedLanes = [...state.completedLanes];
      if (laneCompleted !== undefined && !completedLanes.includes(laneCompleted)) {
        completedLanes.push(laneCompleted);
      }
      return persist({
        ...state,
        phase: phase ?? state.phase,
        currentLane: lane ?? (laneCompleted ? null : state.currentLane),
        completedLanes,
        evidenceCount: evidenceCount ?? state.evidenceCount,
        percent: percent ?? state.percent,
        lastProgressTime: now(),
      });
    },
    async markTerminal({ workerStatus, verdict, stopReason, percent } = {}) {
      assertNotTerminal();
      if (state === null) throw new Error("progress state not initialized");
      if (!TERMINAL_WORKER_STATUSES.includes(workerStatus)) {
        throw new Error(`workerStatus must be one of the terminal statuses: ${TERMINAL_WORKER_STATUSES.join(", ")}`);
      }
      const nextPercent = percent ?? state.percent;
      assertPercent(nextPercent);
      if (workerStatus === "complete" && nextPercent !== 100) {
        throw new Error("workerStatus complete requires percent 100 (full closeout)");
      }
      if (nextPercent < state.percent) {
        throw new Error(`percent must not regress (current ${state.percent})`);
      }
      return persist({
        ...state,
        phase: "closeout",
        currentLane: null,
        percent: nextPercent,
        workerStatus,
        verdict: verdict ?? state.verdict,
        stopReason: stopReason ?? null,
        lastProgressTime: now(),
      });
    },
    async snapshot() {
      if (state === null) throw new Error("progress state not initialized");
      return structuredClone(state);
    },
  };
}

export async function readProgressState(file, { now = () => new Date().toISOString(), staleAfterSeconds = 120 } = {}) {
  let state;
  try {
    state = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { state: null, ageSeconds: null, live: false, terminal: false };
    throw error;
  }
  const terminal = isTerminalState(state);
  const ageSeconds = Math.max(0, Math.round((Date.parse(now()) - Date.parse(state.lastProgressTime)) / 1000));
  return { state, ageSeconds, live: terminal || ageSeconds <= staleAfterSeconds, terminal };
}

export const progressStateFileName = path.join("state.json");
