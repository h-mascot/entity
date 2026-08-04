/**
 * THE-899 / EEPC-B-04 — Execution-engine contract end-to-end proof pack.
 *
 * Durable scenario definitions tying Phase A/B surfaces:
 * list/health (B-01) → operator presets/dispatch (B-03) → authorized callback
 * → Workplane job proof/status (B-02) + unauthorized/malformed security (A-07).
 *
 * Browser harnesses and focused tests share this contract.
 */

import {
  containsSecretShapedValue,
  normalizeExecutionEngineListItem,
  projectExecutionEngineHealthForUi,
  type PublicExecutionEngineListItem,
} from './executionEnginePublicHealth.ts';
import {
  buildSwarmDispatchPayload,
  buildSwarmOperatorPresets,
  listSelectableSwarmOperatorPresets,
  selectDefaultSwarmOperatorPreset,
  type SwarmOperatorPreset,
} from './swarmOperatorPresets.ts';
import {
  countJobProofStatusSignals,
  extractJobProofStatusFromEvent,
  mergeJobProofIntoProofBundle,
  projectJobProofItemsFromActivityEvents,
} from './workplaneJobProofStatus.ts';
import type { ActivityProgressEvent } from './workplaneActivityProgress.ts';
import { normalizeProofBundle } from './proofBundle.ts';

export const EEPC_CONTRACT_E2E_ISSUE = 'THE-899';
export const EEPC_CONTRACT_E2E_CODE = 'EEPC-B-04';

export type EepcContractE2EScenarioId =
  | 'list_engines_no_secrets'
  | 'operator_presets_dispatch'
  | 'callback_to_workplane_proof'
  | 'unauthorized_callback_rejected'
  | 'malformed_callback_rejected'
  | 'degraded_health_visible';

export interface EepcContractE2EScenario {
  id: EepcContractE2EScenarioId;
  title: string;
  stepOrder: number;
  expect: {
    engineCountMin?: number;
    selectablePresetMin?: number;
    stubVisible?: boolean;
    jobProofSignalMin?: number;
    jobStatusSignalMin?: number;
    secretsForbidden?: boolean;
    unauthorizedRejected?: boolean;
    malformedRejected?: boolean;
    degradedVisible?: boolean;
  };
}

/** Canonical EEPC contract E2E scenarios (E2E + security receipt). */
export const EEPC_CONTRACT_E2E_SCENARIOS: readonly EepcContractE2EScenario[] = [
  {
    id: 'list_engines_no_secrets',
    title: 'List registered engines with public health; no secret leak',
    stepOrder: 1,
    expect: {
      engineCountMin: 1,
      secretsForbidden: true,
    },
  },
  {
    id: 'operator_presets_dispatch',
    title: 'Contract presets: selectable dispatch + stub refusal',
    stepOrder: 2,
    expect: {
      selectablePresetMin: 1,
      stubVisible: true,
      secretsForbidden: true,
    },
  },
  {
    id: 'callback_to_workplane_proof',
    title: 'Authorized callback maps to Workplane job proof/status',
    stepOrder: 3,
    expect: {
      jobProofSignalMin: 1,
      jobStatusSignalMin: 1,
      secretsForbidden: true,
    },
  },
  {
    id: 'unauthorized_callback_rejected',
    title: 'Unauthorized callback rejected with no side effects',
    stepOrder: 4,
    expect: {
      unauthorizedRejected: true,
      secretsForbidden: true,
    },
  },
  {
    id: 'malformed_callback_rejected',
    title: 'Malformed callback rejected with public-safe error',
    stepOrder: 5,
    expect: {
      malformedRejected: true,
      secretsForbidden: true,
    },
  },
  {
    id: 'degraded_health_visible',
    title: 'Degraded/unknown health visible (not silently healthy)',
    stepOrder: 6,
    expect: {
      degradedVisible: true,
      secretsForbidden: true,
    },
  },
] as const;

export const EEPC_CONTRACT_E2E_FIXTURE = {
  taskId: 899,
  jobId: 'job-eepc-b-04-899',
  provider: 'acp',
  engines: [
    {
      id: 'swarm.acp',
      name: 'acp',
      label: 'ACP',
      kind: 'execution-engine' as const,
      category: 'coding-agent',
      description: 'Push dispatch coding agent',
      acceptsDispatch: true,
      executionMode: 'push',
      health: {
        available: true,
        message: 'reachable at http://127.0.0.1:9/secret-acp path=/Users/enterprise/queue',
      },
    },
    {
      id: 'swarm.symphony',
      name: 'symphony',
      label: 'Symphony',
      kind: 'execution-engine' as const,
      acceptsDispatch: true,
      executionMode: 'pull',
      health: { available: false, message: 'Symphony URL not configured' },
    },
    {
      id: 'swarm.codex',
      name: 'codex',
      label: 'Codex',
      kind: 'execution-engine' as const,
      acceptsDispatch: true,
      executionMode: 'push',
      // missing health → unknown
    },
    {
      id: 'swarm.ccp',
      name: 'ccp',
      label: 'CCP',
      kind: 'execution-engine' as const,
      acceptsDispatch: false,
      executionMode: 'stub',
      health: { available: false, message: 'stub' },
    },
  ] satisfies PublicExecutionEngineListItem[],
  activityEvents: [
    {
      id: 1,
      taskId: 899,
      eventType: 'status' as const,
      actor: { type: 'agent' as const, principalId: 'execution-engine:acp' },
      timestamp: '2026-07-31T11:00:00.000Z',
      payloadRef: null,
      payload: {
        adapterSource: 'activity_event',
        summary: 'Job moved to running',
        data: {
          source: 'execution-engine-callback',
          execution_callback_kind: 'status',
          provider: 'acp',
          job_id: 'job-eepc-b-04-899',
          job_status: 'running',
          event_body: {
            summary: 'Job moved to running',
            status: 'running',
            run_state: 'active',
          },
        },
      },
      sequence: 1,
      proofIncomplete: false,
    },
    {
      id: 2,
      taskId: 899,
      eventType: 'proof' as const,
      actor: { type: 'agent' as const, principalId: 'execution-engine:acp' },
      timestamp: '2026-07-31T11:01:00.000Z',
      payloadRef: null,
      payload: {
        adapterSource: 'activity_event',
        summary: 'EEPC-B-04 proof artifacts',
        data: {
          source: 'execution-engine-callback',
          execution_callback_kind: 'proof',
          provider: 'acp',
          job_id: 'job-eepc-b-04-899',
          job_status: 'proof',
          event_body: {
            summary: 'EEPC-B-04 proof artifacts',
            commit_sha: 'abcdef1234567890eepcb04',
            branch: 'runner/the-899-eepc-b-04',
            artifact_refs: ['/docs/output/entity/eepc-b-04/proof.md'],
          },
        },
      },
      sequence: 2,
      proofIncomplete: false,
    },
  ] satisfies ActivityProgressEvent[],
  unauthorizedError: {
    error: 'unauthorized',
    message: 'Callback credential required',
  },
  malformedError: {
    error: 'invalid_payload',
    message: 'Callback payload must be a JSON object',
  },
  task: {
    id: 899,
    title: 'EEPC-B-04 contract E2E',
    status: 'in_progress',
    proof_packet: null,
  },
} as const;

/** Fail closed if JSON accidentally includes secret-bearing keys/values. */
export function payloadHasSecretLeak(payload: unknown): boolean {
  const raw = JSON.stringify(payload);
  if (
    /"token"\s*:|"apiKey"\s*:|"api_key"\s*:|"password"\s*:|"secret"\s*:|"authorization"\s*:/i.test(
      raw,
    )
  ) {
    return true;
  }
  if (/Bearer\s+[A-Za-z0-9_\-.+/=]{8,}/i.test(raw)) return true;
  if (/\bsk-[A-Za-z0-9]{10,}\b/.test(raw)) return true;
  return containsSecretShapedValue(raw);
}

export function buildEepcContractE2EWorkplaneHref(baseUrl: string, taskId = EEPC_CONTRACT_E2E_FIXTURE.taskId): string {
  const root = baseUrl.replace(/\/$/, '');
  return `${root}/workplane/${taskId}?panel=activity_progress`;
}

export function buildEepcContractE2ESwarmHref(baseUrl: string): string {
  const root = baseUrl.replace(/\/$/, '');
  return `${root}/?view=swarm`;
}

export function getEepcContractE2EScenario(id: EepcContractE2EScenarioId): EepcContractE2EScenario {
  const scenario = EEPC_CONTRACT_E2E_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`Unknown EEPC contract E2E scenario: ${id}`);
  }
  return scenario;
}

export interface EepcContractE2EEvalResult {
  scenarioId: EepcContractE2EScenarioId;
  pass: boolean;
  failures: string[];
  details?: Record<string, unknown>;
}

function evaluateListEngines(): EepcContractE2EEvalResult {
  const scenario = getEepcContractE2EScenario('list_engines_no_secrets');
  const failures: string[] = [];
  const normalized = EEPC_CONTRACT_E2E_FIXTURE.engines.map((engine) =>
    normalizeExecutionEngineListItem(engine),
  );
  if (normalized.length < (scenario.expect.engineCountMin ?? 1)) {
    failures.push(`expected >= ${scenario.expect.engineCountMin} engines`);
  }
  for (const engine of normalized) {
    const health = projectExecutionEngineHealthForUi(engine.health);
    if (
      containsSecretShapedValue(health.message) ||
      /https?:\/\//i.test(health.message ?? '') ||
      /\/Users\//i.test(health.message ?? '')
    ) {
      failures.push(`engine ${engine.name} health message still secret-shaped: ${health.message}`);
    }
  }
  return {
    scenarioId: scenario.id,
    pass: failures.length === 0,
    failures,
    details: { engineCount: normalized.length },
  };
}

function evaluateOperatorPresets(): EepcContractE2EEvalResult {
  const scenario = getEepcContractE2EScenario('operator_presets_dispatch');
  const failures: string[] = [];
  const presets = buildSwarmOperatorPresets([...EEPC_CONTRACT_E2E_FIXTURE.engines]);
  const selectable = listSelectableSwarmOperatorPresets(presets);
  const stub = presets.find((p) => p.provider === 'ccp');
  const defaultPreset = selectDefaultSwarmOperatorPreset(presets);

  if (selectable.length < (scenario.expect.selectablePresetMin ?? 1)) {
    failures.push(`expected >= ${scenario.expect.selectablePresetMin} selectable presets`);
  }
  if (scenario.expect.stubVisible && (!stub || stub.selectable || stub.acceptsDispatch)) {
    failures.push('stub engine must be visible and non-selectable');
  }
  if (!defaultPreset) {
    failures.push('default selectable preset missing');
  } else {
    try {
      const payload = buildSwarmDispatchPayload(defaultPreset, {
        taskId: EEPC_CONTRACT_E2E_FIXTURE.taskId,
        summary: 'EEPC-B-04 dispatch',
      });
      if (payload.provider !== defaultPreset.provider) {
        failures.push('dispatch payload provider mismatch');
      }
      if (!payload.auto_dispatch) {
        failures.push('dispatch payload should auto_dispatch for acceptsDispatch engines');
      }
      if (payloadHasSecretLeak(payload)) {
        failures.push('dispatch payload leaked secrets');
      }
    } catch (error) {
      failures.push(`dispatch payload build failed: ${String(error)}`);
    }
  }

  if (stub) {
    try {
      buildSwarmDispatchPayload(stub, { taskId: EEPC_CONTRACT_E2E_FIXTURE.taskId });
      failures.push('stub preset must refuse dispatch payload');
    } catch {
      // expected
    }
  }

  for (const preset of presets) {
    if (containsSecretShapedValue(preset.healthMessage) || /https?:\/\//i.test(preset.healthMessage ?? '')) {
      failures.push(`preset ${preset.provider} healthMessage not redacted`);
    }
  }

  return {
    scenarioId: scenario.id,
    pass: failures.length === 0,
    failures,
    details: {
      presetCount: presets.length,
      selectableCount: selectable.length,
      defaultProvider: defaultPreset?.provider ?? null,
    },
  };
}

function evaluateCallbackToWorkplane(): EepcContractE2EEvalResult {
  const scenario = getEepcContractE2EScenario('callback_to_workplane_proof');
  const failures: string[] = [];
  const events = EEPC_CONTRACT_E2E_FIXTURE.activityEvents;
  const counts = countJobProofStatusSignals(events);
  const proofItems = projectJobProofItemsFromActivityEvents(events);
  const bundle = mergeJobProofIntoProofBundle(
    normalizeProofBundle({
      id: EEPC_CONTRACT_E2E_FIXTURE.taskId,
      name: 'EEPC-B-04',
      column: 'doing',
      output: '',
      metadata: {},
    }),
    events,
  );

  if (counts.proof < (scenario.expect.jobProofSignalMin ?? 1)) {
    failures.push(`expected >= ${scenario.expect.jobProofSignalMin} proof signals`);
  }
  if (counts.status < (scenario.expect.jobStatusSignalMin ?? 1)) {
    failures.push(`expected >= ${scenario.expect.jobStatusSignalMin} status signals`);
  }
  if (proofItems.length < 1) {
    failures.push('expected projected job proof items');
  }
  if (!bundle.items.some((item) => item.source === 'execution_job_proof')) {
    failures.push('merged proof bundle missing execution_job_proof source');
  }
  for (const event of events) {
    const signal = extractJobProofStatusFromEvent(event);
    if (!signal) {
      failures.push(`missing job signal for event ${event.id}`);
      continue;
    }
    if (payloadHasSecretLeak(signal)) {
      failures.push(`job signal leaked secrets for event ${event.id}`);
    }
  }

  return {
    scenarioId: scenario.id,
    pass: failures.length === 0,
    failures,
    details: { counts, proofItemCount: proofItems.length },
  };
}

function evaluateUnauthorized(): EepcContractE2EEvalResult {
  const scenario = getEepcContractE2EScenario('unauthorized_callback_rejected');
  const failures: string[] = [];
  const body = EEPC_CONTRACT_E2E_FIXTURE.unauthorizedError;
  if (!scenario.expect.unauthorizedRejected) {
    failures.push('scenario misconfigured');
  }
  if (body.error !== 'unauthorized') {
    failures.push('unauthorized error code mismatch');
  }
  if (payloadHasSecretLeak(body)) {
    failures.push('unauthorized error body leaked secrets');
  }
  return { scenarioId: scenario.id, pass: failures.length === 0, failures, details: { body } };
}

function evaluateMalformed(): EepcContractE2EEvalResult {
  const scenario = getEepcContractE2EScenario('malformed_callback_rejected');
  const failures: string[] = [];
  const body = EEPC_CONTRACT_E2E_FIXTURE.malformedError;
  if (!scenario.expect.malformedRejected) {
    failures.push('scenario misconfigured');
  }
  if (!body.error) {
    failures.push('malformed error code missing');
  }
  if (payloadHasSecretLeak(body)) {
    failures.push('malformed error body leaked secrets');
  }
  return { scenarioId: scenario.id, pass: failures.length === 0, failures, details: { body } };
}

function evaluateDegradedHealth(): EepcContractE2EEvalResult {
  const scenario = getEepcContractE2EScenario('degraded_health_visible');
  const failures: string[] = [];
  const presets = buildSwarmOperatorPresets([...EEPC_CONTRACT_E2E_FIXTURE.engines]);
  const degraded = presets.find((p) => p.provider === 'symphony');
  const unknown = presets.find((p) => p.provider === 'codex');

  if (!degraded || degraded.availability !== 'degraded' || degraded.statusLabel !== 'Degraded') {
    failures.push('symphony must surface Degraded availability');
  }
  if (!unknown || unknown.availability !== 'unknown' || unknown.statusLabel !== 'Health unknown') {
    failures.push('codex missing health must surface Health unknown');
  }
  if (degraded?.ready || unknown?.ready) {
    failures.push('degraded/unknown engines must not be marked ready');
  }

  return {
    scenarioId: scenario.id,
    pass: failures.length === 0,
    failures,
    details: {
      symphony: degraded?.availability ?? null,
      codex: unknown?.availability ?? null,
    },
  };
}

const EVALUATORS: Record<EepcContractE2EScenarioId, () => EepcContractE2EEvalResult> = {
  list_engines_no_secrets: evaluateListEngines,
  operator_presets_dispatch: evaluateOperatorPresets,
  callback_to_workplane_proof: evaluateCallbackToWorkplane,
  unauthorized_callback_rejected: evaluateUnauthorized,
  malformed_callback_rejected: evaluateMalformed,
  degraded_health_visible: evaluateDegradedHealth,
};

export function evaluateEepcContractE2EScenario(id: EepcContractE2EScenarioId): EepcContractE2EEvalResult {
  return EVALUATORS[id]();
}

export function evaluateAllEepcContractE2EScenarios(): EepcContractE2EEvalResult[] {
  return EEPC_CONTRACT_E2E_SCENARIOS.map((scenario) => evaluateEepcContractE2EScenario(scenario.id));
}

/** Operator presets projected from the pack fixture (for UI harnesses). */
export function eepcContractE2EPresets(): SwarmOperatorPreset[] {
  return buildSwarmOperatorPresets([...EEPC_CONTRACT_E2E_FIXTURE.engines]);
}
