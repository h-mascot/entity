import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ActivityRecord,
  ActivityRepository,
  TaskCommentRecord,
  TaskCommentRepository,
  TaskRecord,
} from '../../../db/src';
import type { TaskSyncLayer } from '../../../db/src/task-sync';
import { createTaskAgentTools, type TaskAgentToolDependencies } from './tools';

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 7,
    name: 'Collect review evidence',
    description: 'Review notes are in output/current-review.md.',
    brief: null,
    origin_channel: null,
    column: 'review',
    model: 'codex',
    archived: false,
    assignee: 'Geordi',
    blocked: false,
    blocker_reason: null,
    due_date: null,
    priority: null,
    estimate_hours: null,
    time_spent: null,
    output: null,
    progress_status: null,
    recurring: false,
    recurring_config: null,
    created_at: '2026-03-19T00:00:00.000Z',
    updated_at: '2026-03-19T00:00:00.000Z',
    metadata: null,
    ...overrides,
  };
}

function makeActivity(overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: 1,
    source: 'task',
    type: 'task_updated',
    activity_event_type: 'task_updated',
    activity_event_payload_version: 1,
    activity_event_payload_json: JSON.stringify({
      version: 1,
      actor_type: 'agent',
      task_id: 7,
    }),
    activity_event_schema_status: 'legacy_mapped',
    activity_event_legacy_type: null,
    action: 'Updated task',
    description: 'Saved artifact to workspace/reviews/evidence.txt.',
    agent_name: 'Geordi',
    agent_emoji: '🛠️',
    file_path: null,
    task_id: 7,
    task_column: 'review',
    metadata: null,
    created_at: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeComment(overrides: Partial<TaskCommentRecord> = {}): TaskCommentRecord {
  return {
    id: 1,
    task_id: 7,
    body: 'Attached output/comment-evidence.md for review.',
    author: 'Entity Agent',
    parent_id: null,
    created_at: '2026-03-19T00:00:00.000Z',
    ...overrides,
  };
}

function makeDependencies(): {
  dependencies: TaskAgentToolDependencies;
  taskSyncLayer: TaskSyncLayer;
  activityRepository: ActivityRepository;
  taskCommentRepository: TaskCommentRepository;
} {
  const taskSyncLayer: TaskSyncLayer = {
    getMode: vi.fn().mockReturnValue('LOCAL'),
    setMode: vi.fn(),
    hasCloudAdapter: vi.fn().mockReturnValue(false),
    listTasks: vi.fn().mockResolvedValue([
      makeTask(),
      makeTask({
        id: 8,
        name: 'Other task',
        description: 'Do not borrow output/other-task.md from here.',
        output: 'output/other-task.md',
      }),
    ]),
    listSubtasks: vi.fn().mockResolvedValue([]),
    getTask: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn(),
    updateTask: vi.fn().mockResolvedValue(undefined),
    claimTaskForTaskMaster: vi.fn().mockResolvedValue({
      status: 'not_found',
      claimed: false,
      reason: 'task not found',
    }),
    moveTask: vi.fn().mockResolvedValue(undefined),
    deleteTask: vi.fn().mockResolvedValue(true),
  };

  const activityRepository: ActivityRepository = {
    listActivities: vi.fn().mockReturnValue([]),
    listActivitiesByTaskId: vi.fn().mockReturnValue([makeActivity()]),
    listActivitiesFiltered: () => ({ activities: [], total: 0 }),
    getActivityReport: () => ({
      totals: { count: 0 },
      byAction: [],
      byActor: [],
      byDay: [],
      bySource: [],
      byType: [],
    }),
    createActivity: vi.fn(),
  };

  const taskCommentRepository: TaskCommentRepository = {
    listComments: vi.fn().mockReturnValue([makeComment()]),
    createComment: vi.fn(),
  };

  return {
    taskSyncLayer,
    activityRepository,
    taskCommentRepository,
    dependencies: {
      taskSyncLayer,
      activityRepository,
      taskCommentRepository,
      workspaceRoot: '/Users/henrymascot/Code/entity',
      logActivity: vi.fn(),
      broadcast: vi.fn(),
    },
  };
}

describe('createTaskAgentTools', () => {
  it('discovers output candidates from the current task context only', async () => {
    const { dependencies, taskSyncLayer } = makeDependencies();
    const tools = createTaskAgentTools(dependencies);

    const candidates = await tools.discoverOutputCandidates(makeTask());

    expect(candidates).toEqual([
      'output/current-review.md',
      'workspace/reviews/evidence.txt',
      'output/comment-evidence.md',
    ]);
    expect(candidates).not.toContain('output/other-task.md');
    expect(vi.mocked(taskSyncLayer.listTasks)).not.toHaveBeenCalled();
  });
});

/**
 * T-032 — Provider-neutral agent document tools — cross-provider contract tests.
 *
 * Source of truth: docs/loom/entity-document-integrations/phase2-canonical-prd.md R-023
 *   ("Provider-neutral tools must cover at minimum: document.create / document.read /
 *    document.revise / spreadsheet.range.update / presentation.slide.update"), R-024
 *   (revision-aware mutation), R-025 (standard conflict response), R-026 (idempotent
 *   creation/retry), R-002 (unknown/degraded capability fails closed).
 *
 * The SAME tool contract dispatches across Google Workspace, Microsoft 365, and local-office
 * lanes based on trusted document/provider context (never caller-claimed provider authority).
 *
 * RED-before-GREEN: these tests are written first and fail while the T-032 implementation is
 * absent; they pass once `createDocumentAgentTools` exists.
 *
 * Privacy: no credentials, raw tokens, tenant secrets, document contents, or operator-specific
 * absolute paths in fixtures/logs/output. Every provider is the deterministic fake adapter.
 */
import fs from 'fs';
import Database from 'better-sqlite3';
import type { DocumentArtifactType, DocumentProvider } from '../../../db/src/document-integrations';
import { createDocumentIntegrationsRepository } from '../../../db/src/document-integrations';
import type { DocumentRegistry, RegistryWriteInput } from '../document-providers/registry';
import { createDocumentRegistry } from '../document-providers/registry';
import type { DocumentProviderAdapter } from '../document-providers/types';
import { createFakeDocumentProviderAdapter } from '../document-providers/fake-adapter';
import type { WritePolicy } from '../document-providers/write-policy';
import { createPolicyForWorkspace } from '../document-providers/write-policy';
import type { DocumentDestination } from '../document-providers/destinations';
import { resolvePhase2Flags } from '../phase2-flags';
import {
  createDocumentAgentTools,
  type DocumentAgentDeps,
  type DocumentAgentTools,
} from './tools';

const TEST_NOW = '2026-08-18T00:00:00.000Z';
const WS = 'ws_A';

const openDatabases: Database.Database[] = [];
const tempDirs: string[] = [];
afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function openFreshDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  openDatabases.push(db);
  return db;
}

function baseWriteInput(overrides: Partial<RegistryWriteInput> = {}): RegistryWriteInput {
  return {
    provider: 'google_workspace',
    artifact_type: 'document',
    title: 'Q3 Operating Plan',
    external_id: 'goog-doc-sample-1',
    provider_url: 'https://example.test/d/sample-1',
    owner_summary: 'owner:acct',
    tenant_external_id: null,
    permissions_summary_json: '{"canEdit":true}',
    sensitivity_label: 'internal',
    auth_state: 'authorized',
    readiness_state: 'ready',
    current_revision: 'rev-1',
    provider_modified_at: '2026-08-18T00:00:00.000Z',
    preview_state: 'ready',
    conflict_state: 'none',
    ...overrides,
  };
}

const ARTIFACT_TYPES: readonly DocumentArtifactType[] = ['document', 'spreadsheet', 'presentation'];

function policyFor(
  provider: DocumentProvider,
  artifactType: DocumentArtifactType | '*',
  overrides: Partial<WritePolicy> = {},
): WritePolicy {
  return createPolicyForWorkspace({
    workspaceId: WS,
    tenantId: null,
    connectionId: null,
    provider,
    artifactType,
    allowedDestinationIds: new Set([`dest-${provider}`]),
    defaultDestinationId: `dest-${provider}`,
    writeMode: 'create_and_update',
    confirmationPolicy: null,
    writeAuthorizationProven: true,
    adminWriteAuthorized: true,
    ...overrides,
  });
}

function destinationFor(provider: DocumentProvider): DocumentDestination {
  return {
    id: `dest-${provider}`,
    workspaceId: WS,
    tenantId: null,
    connectionId: null,
    provider,
    artifactTypes: new Set<DocumentArtifactType>([...ARTIFACT_TYPES]),
    destinationKind: 'folder',
    externalId: `folder-${provider}`,
    displayName: `Folder ${provider}`,
    enabled: true,
  };
}

interface Harness {
  tools: DocumentAgentTools;
  registry: DocumentRegistry;
  adapters: Map<string, DocumentProviderAdapter>;
}

function setup(overrides: Partial<DocumentAgentDeps> = {}): Harness {
  const db = openFreshDb();
  const repo = createDocumentIntegrationsRepository(db);
  repo.ensureSchema();
  const registry = createDocumentRegistry(db);
  const adapters = new Map<string, DocumentProviderAdapter>();
  const policies: WritePolicy[] = [];
  const destinations: DocumentDestination[] = [];

  // Register one adapter per lane: Google, Microsoft, local.
  adapters.set('google_workspace', createFakeDocumentProviderAdapter({
    provider: 'google_workspace',
    capabilities: { agent_range_mutation: 'supported', agent_slide_mutation: 'supported' },
  }));
  adapters.set('microsoft_365', createFakeDocumentProviderAdapter({
    provider: 'microsoft_365',
    capabilities: { agent_range_mutation: 'supported', agent_slide_mutation: 'supported' },
  }));
  adapters.set('local_office', createFakeDocumentProviderAdapter({
    provider: 'local_office',
    capabilities: { agent_range_mutation: 'supported', agent_slide_mutation: 'supported' },
  }));

  // R-003 write policies + approved destinations for every lane (admin-authorized,
  // create_and_update) so each provider has a governed, approved create target.
  for (const provider of ['google_workspace', 'microsoft_365', 'local_office'] as const) {
    policies.push(policyFor(provider, '*'));
    destinations.push(destinationFor(provider));
  }

  const deps: DocumentAgentDeps = {
    registry,
    adapters: (provider: string) => adapters.get(provider),
    policies,
    destinations,
    flags: resolvePhase2Flags(),
    resolveWorkspace: () => WS,
    connectionStateFor: () => 'authorized',
    now: () => TEST_NOW,
    ...overrides,
  };
  return { tools: createDocumentAgentTools(deps), registry, adapters };
}

async function createDocument(
  tools: DocumentAgentTools,
  provider: DocumentProvider,
  artifactType: DocumentArtifactType,
): Promise<{ documentId: string; revision: string | null }> {
  const result = await tools.create({
    provider,
    artifactType,
    title: `${provider} ${artifactType}`,
    destinationId: `dest-${provider}`,
    idempotencyKey: `idem-${provider}-${artifactType}-1`,
    confirmed: true,
  });
  expect(result.status).toBe('ok');
  expect(result.documentId).toBeTruthy();
  expect(result.provider).toBe(provider);
  expect(result.revision).toBeTruthy();
  return { documentId: result.documentId!, revision: result.revision };
}

describe('T-032 provider-neutral agent tools — cross-provider dispatch', () => {
  it('dispatches document.create across Google, Microsoft, and local lanes', async () => {
    for (const provider of ['google_workspace', 'microsoft_365', 'local_office'] as const) {
      const { tools } = setup();
      const result = await tools.create({
        provider,
        artifactType: 'document',
        title: `${provider} doc`,
        destinationId: `dest-${provider}`,
        idempotencyKey: `idem-create-${provider}`,
        confirmed: true,
      });
      expect(result.status).toBe('ok');
      expect(result.tool).toBe('document.create');
      expect(result.provider).toBe(provider);
      expect(result.documentId).toBeTruthy();
      expect(result.entityUrl).toBe(`/documents/${result.documentId}`);
      expect(result.revision).toBeTruthy();
      expect(result.capability?.name).toBe('create');
      expect(result.capability?.state).toBe('supported');
      expect(result.operationId).toBe(`idem-create-${provider}`);
    }
  });

  it('dispatches document.revise across Google, Microsoft, and local lanes with revision advance', async () => {
    for (const provider of ['google_workspace', 'microsoft_365', 'local_office'] as const) {
      const { tools } = setup();
      const { documentId, revision } = await createDocument(tools, provider, 'document');
      const result = await tools.revise({
        documentId,
        text: 'Updated body text',
        expectedRevision: revision!,
        idempotencyKey: `idem-revise-${provider}`,
        confirmed: true,
      });
      expect(result.status).toBe('ok');
      expect(result.tool).toBe('document.revise');
      expect(result.provider).toBe(provider);
      expect(result.revision).not.toBe(revision);
      expect(result.capability?.name).toBe('agent_text_mutation');
      expect(result.capability?.state).toBe('supported');
    }
  });

  it('dispatches spreadsheet.range.update across all three lanes', async () => {
    for (const provider of ['google_workspace', 'microsoft_365', 'local_office'] as const) {
      const { tools } = setup();
      const { documentId, revision } = await createDocument(tools, provider, 'spreadsheet');
      const result = await tools.updateRange({
        documentId,
        cell: 'A1',
        value: '42',
        expectedRevision: revision!,
        idempotencyKey: `idem-range-${provider}`,
        confirmed: true,
      });
      expect(result.status).toBe('ok');
      expect(result.tool).toBe('spreadsheet.range.update');
      expect(result.capability?.name).toBe('agent_range_mutation');
    }
  });

  it('dispatches presentation.slide.update across all three lanes', async () => {
    for (const provider of ['google_workspace', 'microsoft_365', 'local_office'] as const) {
      const { tools } = setup();
      const { documentId, revision } = await createDocument(tools, provider, 'presentation');
      const result = await tools.updateSlide({
        documentId,
        slideId: 'slide-1',
        expectedRevision: revision!,
        idempotencyKey: `idem-slide-${provider}`,
        confirmed: true,
      });
      expect(result.status).toBe('ok');
      expect(result.tool).toBe('presentation.slide.update');
      expect(result.capability?.name).toBe('agent_slide_mutation');
    }
  });

  it('dispatches document.read across all three lanes', async () => {
    for (const provider of ['google_workspace', 'microsoft_365', 'local_office'] as const) {
      const { tools } = setup();
      const { documentId } = await createDocument(tools, provider, 'document');
      const result = await tools.read({ documentId });
      expect(result.status).toBe('ok');
      expect(result.tool).toBe('document.read');
      expect(result.documentId).toBe(documentId);
      expect(result.provider).toBe(provider);
      expect(result.capability?.name).toBe('read');
    }
  });
});

describe('T-032 agent tools — negative capability / provider / authorization / stale / idempotency', () => {
  it('never implies capability: an unsupported range lane fails closed', async () => {
    const db = openFreshDb();
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();
    const registry = createDocumentRegistry(db);
    const adapters = new Map<string, DocumentProviderAdapter>();
    // Google adapter does NOT advertise agent_range_mutation.
    adapters.set('google_workspace', createFakeDocumentProviderAdapter({ provider: 'google_workspace' }));
    const policies = [policyFor('google_workspace', 'spreadsheet')];
    const destinations = [destinationFor('google_workspace')];
    const tools = createDocumentAgentTools({
      registry,
      adapters: (p) => adapters.get(p),
      policies,
      destinations,
      flags: resolvePhase2Flags(),
      resolveWorkspace: () => WS,
      connectionStateFor: () => 'authorized',
      now: () => TEST_NOW,
    });
    const created = await tools.create({
      provider: 'google_workspace',
      artifactType: 'spreadsheet',
      title: 'budget',
      destinationId: 'dest-google_workspace',
      idempotencyKey: 'idem-budget',
      confirmed: true,
    });
    expect(created.status).toBe('ok');
    const range = await tools.updateRange({
      documentId: created.documentId!,
      cell: 'A1',
      value: '1',
      expectedRevision: created.revision!,
      idempotencyKey: 'idem-range-unsupported',
      confirmed: true,
    });
    expect(range.status).toBe('unsupported');
    expect(range.capability?.name).toBe('agent_range_mutation');
    expect(range.capability?.state).not.toBe('supported');
  });

  it('fail-closes on provider mismatch between caller-provided provider and trusted document record', async () => {
    const { tools } = setup();
    const { documentId, revision } = await createDocument(tools, 'google_workspace', 'document');
    // A caller cannot redirect authority to another provider by claiming a different lane;
    // the trusted record provider (google_workspace) governs dispatch.
    const result = await tools.revise({
      documentId,
      text: 'attempted cross-provider write',
      expectedRevision: revision!,
      idempotencyKey: 'idem-mismatch',
      provider: 'microsoft_365',
      confirmed: true,
    });
    expect(result.status).toBe('denied');
  });

  it('fail-closes when a caller string supplies no provider authority for create without an authorized destination', async () => {
    const db = openFreshDb();
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();
    const registry = createDocumentRegistry(db);
    const adapters = new Map<string, DocumentProviderAdapter>();
    adapters.set('microsoft_365', createFakeDocumentProviderAdapter({ provider: 'microsoft_365' }));
    const tools = createDocumentAgentTools({
      registry,
      adapters: (p) => adapters.get(p),
      policies: [], // no policy => not authorized
      destinations: [],
      flags: resolvePhase2Flags(),
      resolveWorkspace: () => WS,
      now: () => TEST_NOW,
    });
    const result = await tools.create({
      provider: 'microsoft_365',
      artifactType: 'document',
      title: 'no-authority',
      destinationId: 'dest-unknown',
      idempotencyKey: 'idem-noauth',
      confirmed: true,
    });
    expect(result.status).toBe('denied');
  });

  it('rejects a stale expected revision on revise (R-024/R-025) without overwriting', async () => {
    const { tools } = setup();
    const { documentId, revision } = await createDocument(tools, 'google_workspace', 'document');
    // Advance the document once to produce a newer current revision.
    await tools.revise({
      documentId,
      text: 'first edit',
      expectedRevision: revision!,
      idempotencyKey: 'idem-first',
      confirmed: true,
    });
    // Now retry with the stale original revision.
    const stale = await tools.revise({
      documentId,
      text: 'stale write must not land',
      expectedRevision: revision!,
      idempotencyKey: 'idem-stale',
      confirmed: true,
    });
    expect(stale.status).toBe('conflict');
    expect(stale.capability?.name).toBe('agent_text_mutation');
  });

  it('is idempotent on replayed create idempotency keys (R-026) — one business artifact', async () => {
    const { tools } = setup();
    const first = await tools.create({
      provider: 'google_workspace',
      artifactType: 'document',
      title: 'Idempotent',
      destinationId: 'dest-google_workspace',
      idempotencyKey: 'idem-same-key',
      confirmed: true,
    });
    expect(first.status).toBe('ok');
    const replay = await tools.create({
      provider: 'google_workspace',
      artifactType: 'document',
      title: 'Idempotent',
      destinationId: 'dest-google_workspace',
      idempotencyKey: 'idem-same-key',
      confirmed: true,
    });
    expect(replay.status).toBe('ok');
    expect(replay.documentId).toBe(first.documentId);
  });

  it('fails closed for an unknown document id (no read across the boundary)', async () => {
    const { tools } = setup();
    const result = await tools.read({ documentId: 'doc_does_not_exist' });
    expect(result.status).toBe('not_found');
  });

  it('fails closed when a missing workspace cannot be determined', async () => {
    const db = openFreshDb();
    const repo = createDocumentIntegrationsRepository(db);
    repo.ensureSchema();
    const registry = createDocumentRegistry(db);
    const adapters = new Map<string, DocumentProviderAdapter>();
    adapters.set('google_workspace', createFakeDocumentProviderAdapter({ provider: 'google_workspace' }));
    const tools = createDocumentAgentTools({
      registry,
      adapters: (p) => adapters.get(p),
      policies: [],
      destinations: [],
      flags: resolvePhase2Flags(),
      resolveWorkspace: () => null, // cannot determine workspace => fail closed
      now: () => TEST_NOW,
    });
    const result = await tools.read({ documentId: 'doc_x' });
    expect(result.status).toBe('denied');
  });
});
