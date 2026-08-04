/**
 * THE-888 / WP2-B-07 — Workplanes slice 2 end-to-end proof pack contract.
 *
 * Durable scenario definitions for the integrated Slice-2 journey:
 * invite → progress → presence → Chief ASK (+ admin settings / no secret leak).
 * Browser harnesses and focused tests share this contract.
 */

import {
  createInitialDeskState,
  deskFromListSuccess,
  normalizeDeskInvite,
  verificationSummary,
  type DeskInviteView,
} from './agentInviteDesk.ts';
import {
  normalizeAdminAgentSettings,
  normalizeInviteAuditEvents,
  validateAdminAgentSettingsDraft,
} from './adminAgentSettings.ts';
import {
  parseWorkplaneAskPanel,
  askPanelSummary,
} from './workplaneAskFlow.ts';
import {
  parseWorkplanePresencePanel,
} from './workplanePresence.ts';

export const WORKPLANE_SLICE2_E2E_ISSUE = 'THE-888';
export const WORKPLANE_SLICE2_E2E_CODE = 'WP2-B-07';

export type WorkplaneSlice2E2EScenarioId =
  | 'invite'
  | 'progress'
  | 'presence'
  | 'chief_ask'
  | 'admin_settings_no_secrets';

export interface WorkplaneSlice2E2EScenario {
  id: WorkplaneSlice2E2EScenarioId;
  title: string;
  stepOrder: number;
  expect: {
    inviteStatus?: DeskInviteView['status'];
    progressDoneCount?: number;
    presenceLiveMin?: number;
    askResolvedMin?: number;
    askDeniedCode?: 'chief_priority';
    adminSettingsValid?: boolean;
    secretsForbidden?: boolean;
  };
}

/** Canonical Slice-2 E2E scenarios required by WP2-B-07. */
export const WORKPLANE_SLICE2_E2E_SCENARIOS: readonly WorkplaneSlice2E2EScenario[] = [
  {
    id: 'invite',
    title: 'Create durable invite bound to workplane',
    stepOrder: 1,
    expect: {
      inviteStatus: 'created',
      secretsForbidden: true,
    },
  },
  {
    id: 'progress',
    title: 'Tokenized progress advances durable invite to completed',
    stepOrder: 2,
    expect: {
      inviteStatus: 'completed',
      progressDoneCount: 1,
      secretsForbidden: true,
    },
  },
  {
    id: 'presence',
    title: 'Heartbeat yields live Workplane presence',
    stepOrder: 3,
    expect: {
      presenceLiveMin: 1,
      secretsForbidden: true,
    },
  },
  {
    id: 'chief_ask',
    title: 'Chief ASK claim/resolve; worker denied under chief priority',
    stepOrder: 4,
    expect: {
      askResolvedMin: 1,
      askDeniedCode: 'chief_priority',
      secretsForbidden: true,
    },
  },
  {
    id: 'admin_settings_no_secrets',
    title: 'Admin TTL/modules + audit never leak invite tokens',
    stepOrder: 5,
    expect: {
      adminSettingsValid: true,
      secretsForbidden: true,
    },
  },
] as const;

export const WORKPLANE_SLICE2_E2E_FIXTURE = {
  workplaneId: 'wp-slice2-e2e',
  taskId: 888,
  chiefAgentId: 'invite:invite_wp2_b_07',
  workerAgentId: 'worker-slice2',
  invite: {
    id: 'invite_wp2_b_07',
    status: 'created' as const,
    agentName: 'Slice2 Chief',
    role: 'chief',
    creationSource: 'agents_invite',
    createdAt: '2026-07-31T10:00:00.000Z',
    expiresAt: '2026-07-31T10:45:00.000Z',
    openedAt: null,
    completedAt: null,
    revokedAt: null,
    revokedBy: null,
    generation: 1,
    rotated: false,
    selectedBundle: 'default',
    selectedModules: ['entity-mc'],
    permissionsScope: ['tasks:read'],
    safeStopConditions: ['Stop if manifest token is invalid/expired/revoked.'],
    projectId: null,
    workplaneId: 'wp-slice2-e2e',
    taskId: 888,
    persistence: 'durable' as const,
    progress: [
      {
        stepId: 'install-entity-mc',
        label: 'Install entity-mc',
        moduleId: 'entity-mc',
        status: 'pending' as const,
        updatedAt: '2026-07-31T10:00:00.000Z',
      },
    ],
  },
  completedInvite: {
    id: 'invite_wp2_b_07',
    status: 'completed' as const,
    agentName: 'Slice2 Chief',
    role: 'chief',
    creationSource: 'agents_invite',
    createdAt: '2026-07-31T10:00:00.000Z',
    expiresAt: '2026-07-31T10:45:00.000Z',
    openedAt: '2026-07-31T10:01:00.000Z',
    completedAt: '2026-07-31T10:02:00.000Z',
    revokedAt: null,
    revokedBy: null,
    generation: 1,
    rotated: false,
    selectedBundle: 'default',
    selectedModules: ['entity-mc'],
    permissionsScope: ['tasks:read'],
    safeStopConditions: ['Stop if manifest token is invalid/expired/revoked.'],
    projectId: null,
    workplaneId: 'wp-slice2-e2e',
    taskId: 888,
    persistence: 'durable' as const,
    progress: [
      {
        stepId: 'install-entity-mc',
        label: 'Install entity-mc',
        moduleId: 'entity-mc',
        status: 'done' as const,
        message: 'verified',
        updatedAt: '2026-07-31T10:02:00.000Z',
      },
    ],
  },
  presencePanel: {
    workplaneId: 'wp-slice2-e2e',
    staleAfterMs: 60_000,
    evaluatedAt: '2026-07-31T10:03:00.000Z',
    counts: {
      total: 1,
      live: 1,
      idle: 0,
      stale: 0,
      offline: 0,
      missing: 0,
      unknown: 0,
      degraded: 0,
    },
    agents: [
      {
        agentId: 'invite:invite_wp2_b_07',
        inviteId: 'invite_wp2_b_07',
        agentName: 'Slice2 Chief',
        role: 'chief',
        presenceStatus: 'live',
        lastSeenAt: '2026-07-31T10:03:00.000Z',
        heartbeatFreshnessLabel: 'live',
        currentTaskId: 888,
        currentWorkplaneId: 'wp-slice2-e2e',
        currentWorkLabel: 'Task #888',
        runtime: 'proof',
        sessionId: null,
        capabilities: ['ask', 'routing'],
        cardCompleteness: 'complete',
        degradedReasons: [],
        source: 'heartbeat',
      },
    ],
  },
  askPanel: {
    workplaneId: 'wp-slice2-e2e',
    evaluatedAt: '2026-07-31T10:05:00.000Z',
    openCount: 0,
    claimedCount: 0,
    resolvedCount: 1,
    staleCount: 0,
    summary: '1 resolved',
    asks: [
      {
        id: 'ask_wp2_b_07',
        workplaneId: 'wp-slice2-e2e',
        taskId: 888,
        title: 'Slice2 Chief ASK proof',
        body: null,
        status: 'resolved',
        version: 3,
        createdBy: 'wp2-b-07-proof',
        createdAt: '2026-07-31T10:04:00.000Z',
        updatedAt: '2026-07-31T10:05:00.000Z',
        claimantAgentId: 'invite:invite_wp2_b_07',
        claimantAgentName: 'Slice2 Chief',
        claimedAt: '2026-07-31T10:04:30.000Z',
        claimPolicyCode: 'chief_claim',
        resolvedBy: 'invite:invite_wp2_b_07',
        resolvedAt: '2026-07-31T10:05:00.000Z',
        resolutionNote: 'Slice2 E2E proof closed',
        blockedReason: null,
        reasonChain: [],
      },
    ],
  },
  adminSettings: {
    defaultTtlMs: 45 * 60 * 1000,
    minTtlMs: 5 * 60 * 1000,
    maxTtlMs: 2 * 60 * 60 * 1000,
    allowedModules: ['entity-mc', 'entity-fs'],
    defaultModules: ['entity-mc'],
    updatedAt: '2026-07-31T10:00:00.000Z',
    updatedBy: 'wp2-b-07-proof',
    catalogModules: [
      { id: 'entity-mc', label: 'Entity MC', defaultAllowed: true },
      { id: 'entity-fs', label: 'Entity FS', defaultAllowed: true },
    ],
    hardMinTtlMs: 60_000,
    hardMaxTtlMs: 24 * 60 * 60 * 1000,
  },
  auditEvents: [
    {
      id: 'audit_1',
      inviteId: 'invite_wp2_b_07',
      eventType: 'invite_created',
      actorId: 'wp2-b-07-proof',
      agentName: 'Slice2 Chief',
      status: 'created',
      generation: 1,
      detail: 'modules=entity-mc',
      createdAt: '2026-07-31T10:00:00.000Z',
    },
  ],
} as const;

export function getWorkplaneSlice2E2EScenario(
  id: WorkplaneSlice2E2EScenarioId,
): WorkplaneSlice2E2EScenario {
  const scenario = WORKPLANE_SLICE2_E2E_SCENARIOS.find((entry) => entry.id === id);
  if (!scenario) {
    throw new Error(`Unknown Workplane Slice-2 E2E scenario: ${id}`);
  }
  return scenario;
}

/** Fail closed if JSON accidentally includes secret-bearing keys. */
export function payloadHasSecretKeys(payload: unknown): boolean {
  const raw = JSON.stringify(payload);
  return /"token"\s*:|"apiKey"\s*:|"api_key"\s*:|"password"\s*:|"secret"\s*:|"authorization"\s*:|"tokenHash"\s*:|"previousTokenHash"\s*:/i.test(raw);
}

export interface WorkplaneSlice2E2EEvalResult {
  scenarioId: WorkplaneSlice2E2EScenarioId;
  pass: boolean;
  failures: string[];
}

export function evaluateWorkplaneSlice2E2EScenario(
  id: WorkplaneSlice2E2EScenarioId,
): WorkplaneSlice2E2EEvalResult {
  const scenario = getWorkplaneSlice2E2EScenario(id);
  const failures: string[] = [];

  if (id === 'invite') {
    const invite = normalizeDeskInvite(WORKPLANE_SLICE2_E2E_FIXTURE.invite);
    if (!invite) failures.push('invite fixture failed to normalize');
    else if (invite.status !== scenario.expect.inviteStatus) {
      failures.push(`expected status ${scenario.expect.inviteStatus}, got ${invite.status}`);
    }
    if (payloadHasSecretKeys({ ...WORKPLANE_SLICE2_E2E_FIXTURE.invite, token: undefined })) {
      failures.push('invite list shape must not include secrets');
    }
    const desk = deskFromListSuccess(createInitialDeskState(), {
      invites: [WORKPLANE_SLICE2_E2E_FIXTURE.invite],
      count: 1,
    });
    if (desk.uiStatus !== 'ready') failures.push(`desk uiStatus=${desk.uiStatus}`);
  }

  if (id === 'progress') {
    const invite = normalizeDeskInvite(WORKPLANE_SLICE2_E2E_FIXTURE.completedInvite);
    if (!invite) failures.push('completed invite failed to normalize');
    else {
      if (invite.status !== 'completed') failures.push(`status=${invite.status}`);
      const done = invite.progress.filter((step) => step.status === 'done').length;
      if (done < (scenario.expect.progressDoneCount ?? 0)) {
        failures.push(`progress done=${done}`);
      }
      if (!verificationSummary(invite).includes('verified')) {
        failures.push(`verificationSummary=${verificationSummary(invite)}`);
      }
    }
  }

  if (id === 'presence') {
    const panel = parseWorkplanePresencePanel(WORKPLANE_SLICE2_E2E_FIXTURE.presencePanel);
    if (!panel) failures.push('presence panel failed to parse');
    else if (panel.counts.live < (scenario.expect.presenceLiveMin ?? 0)) {
      failures.push(`live=${panel.counts.live}`);
    }
    if (payloadHasSecretKeys(WORKPLANE_SLICE2_E2E_FIXTURE.presencePanel)) {
      failures.push('presence panel leaked secrets');
    }
  }

  if (id === 'chief_ask') {
    const panel = parseWorkplaneAskPanel(WORKPLANE_SLICE2_E2E_FIXTURE.askPanel);
    if (!panel) failures.push('ask panel failed to parse');
    else {
      if (panel.resolvedCount < (scenario.expect.askResolvedMin ?? 0)) {
        failures.push(`resolvedCount=${panel.resolvedCount}`);
      }
      if (!askPanelSummary(panel).includes('resolved')) {
        failures.push(`summary=${askPanelSummary(panel)}`);
      }
    }
    if (scenario.expect.askDeniedCode !== 'chief_priority') {
      failures.push('scenario missing chief_priority negative expectation');
    }
    if (payloadHasSecretKeys(WORKPLANE_SLICE2_E2E_FIXTURE.askPanel)) {
      failures.push('ask panel leaked secrets');
    }
  }

  if (id === 'admin_settings_no_secrets') {
    const settings = normalizeAdminAgentSettings(WORKPLANE_SLICE2_E2E_FIXTURE.adminSettings);
    if (!settings) failures.push('admin settings failed to normalize');
    else {
      const validationError = validateAdminAgentSettingsDraft(settings);
      if (validationError) failures.push(`admin draft invalid: ${validationError}`);
    }
    const events = normalizeInviteAuditEvents(WORKPLANE_SLICE2_E2E_FIXTURE.auditEvents);
    if (events.length !== WORKPLANE_SLICE2_E2E_FIXTURE.auditEvents.length) {
      failures.push('audit events failed to normalize');
    }
    if (
      payloadHasSecretKeys(WORKPLANE_SLICE2_E2E_FIXTURE.adminSettings)
      || payloadHasSecretKeys(WORKPLANE_SLICE2_E2E_FIXTURE.auditEvents)
    ) {
      failures.push('admin settings/audit leaked secrets');
    }
  }

  return { scenarioId: id, pass: failures.length === 0, failures };
}

export function evaluateAllWorkplaneSlice2E2EScenarios(): WorkplaneSlice2E2EEvalResult[] {
  return WORKPLANE_SLICE2_E2E_SCENARIOS.map((scenario) =>
    evaluateWorkplaneSlice2E2EScenario(scenario.id));
}

/** Agent Desk deep-link helper for browser proof. */
export function buildWorkplaneSlice2E2EDeskHref(base = ''): string {
  return `${base}/?view=agents&panel=invite-desk`;
}
