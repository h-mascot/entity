// Geordi QA watchdog (GQR-006).
//
// A script-only watchdog observes the QA run's live progress state and
// self-pauses once the run is terminal (complete / stopped / wrong-build /
// aborted / WRONG BUILD verdict). It observes, surfaces stalls, and wakes —
// it never kills the worker and never keeps polling a finished run.
import { readProgressState } from "./progress-state.mjs";

export async function runWatchdog({
  stateFile,
  pollIntervalMs = 5_000,
  maxPolls = 100,
  staleAfterSeconds = 120,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  read = (file, opts) => readProgressState(file, opts),
  onObservation = () => {},
  pausedAt = () => new Date().toISOString(),
} = {}) {
  if (!stateFile) throw new Error("stateFile is required");
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new Error("pollIntervalMs must be a positive number");
  }
  if (!Number.isInteger(maxPolls) || maxPolls < 1) {
    throw new Error("maxPolls must be a positive integer");
  }

  let polls = 0;
  let last = null;
  while (polls < maxPolls) {
    polls += 1;
    const observation = await read(stateFile, { staleAfterSeconds });
    last = observation;

    if (observation.terminal && observation.state) {
      const state = observation.state;
      const reason = {
        workerStatus: state.workerStatus,
        verdict: state.verdict ?? null,
        stopReason: state.stopReason ?? null,
        lastProgressTime: state.lastProgressTime,
      };
      const receipt = {
        action: "self-pause",
        pausedAt: pausedAt(),
        runId: state.runId ?? null,
        reason,
        observed: {
          percent: state.percent,
          phase: state.phase,
          completedLanes: state.completedLanes,
          evidenceCount: state.evidenceCount,
        },
        polls,
      };
      onObservation({ type: "self-paused", poll: polls, reason, receipt });
      return { selfPaused: true, reason, receipt, polls };
    }

    onObservation({
      type: observation.state === null ? "absent" : observation.live ? "observing" : "stalled",
      poll: polls,
      ageSeconds: observation.ageSeconds,
      percent: observation.state?.percent ?? null,
    });

    if (polls < maxPolls) await sleep(pollIntervalMs);
  }
  return {
    selfPaused: false,
    reason: "max-polls",
    receipt: null,
    polls,
    lastObservation: last,
  };
}
