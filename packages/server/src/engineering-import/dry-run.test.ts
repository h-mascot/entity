import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  type CurrentEntitySnapshot,
  type ImportCandidate,
  type PrerequisiteAssessment,
  ENTITY_TODO_SOURCE_SYSTEM,
  EXPECTED_MAPPING_CSV_SHA256,
  EXPECTED_TODO_SNAPSHOT_SHA256,
  parseImportCandidates,
  runEngineeringImportDryRun,
  stableTitleKey,
  validateMappingHashes,
} from './dry-run';
import { assessRepositoryPrerequisites } from './repo-prerequisites';

const repoRoot = path.resolve(__dirname, '../../../..');

function candidate(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  const sourceTitle = overrides.sourceTitle ?? 'New engineering capability';
  return {
    sourceLine: 1,
    sourceTitle,
    sourceFingerprint: 'fingerprint-1',
    importAction: 'create',
    stableTitleKey: stableTitleKey(sourceTitle),
    targetProjectKey: 'entity-engineering',
    targetState: 'backlog',
    targetLane: 'app-test',
    risk: 'low',
    prerequisite: 'Stable fixture',
    ...overrides,
  };
}

function prerequisite(
  sourceLine: number,
  state: PrerequisiteAssessment['state'] = 'ready',
): PrerequisiteAssessment {
  return { sourceLine, state, evidence: [`${state} evidence`] };
}

function snapshot(
  overrides: Partial<CurrentEntitySnapshot> = {},
): CurrentEntitySnapshot {
  return {
    schema: {
      projectColumns: [
        'id',
        'org_id',
        'team_id',
        'name',
        'lifecycle_state',
        'project_key',
        'work_domain',
      ],
      taskColumns: ['id', 'name', 'project_id'],
      taskProjectColumns: ['task_id', 'project_id'],
      ledgerTablePresent: true,
      ledgerColumns: [
        'project_id',
        'source_system',
        'source_key',
        'task_id',
        'source_fingerprint',
        'source_snapshot_sha256',
      ],
      ledgerUniqueProjectSourceKey: true,
      ledgerUniqueTaskId: true,
    },
    projects: [
      {
        id: 7,
        orgId: 'default-org',
        teamId: 'default-team',
        name: 'Entity Engineering',
        lifecycleState: 'active',
        projectKey: 'entity-engineering',
        workDomain: 'engineering',
      },
    ],
    tasks: [],
    ledgerEntries: [],
    connection: { readonly: true, queryOnly: true, totalChanges: 0 },
    ...overrides,
  };
}

describe('Entity Engineering import dry run', () => {
  it('validates the pinned mapping and returns exactly seven stable candidates', () => {
    const sourceCsv = fs.readFileSync(
      path.join(repoRoot, 'docs/plans/entity-engineering-import-mapping-source.csv'),
    );
    const mappingCsv = fs.readFileSync(
      path.join(repoRoot, 'docs/plans/entity-engineering-import-mapping.csv'),
    );

    expect(() => validateMappingHashes(sourceCsv, mappingCsv)).not.toThrow();
    const candidates = parseImportCandidates(mappingCsv.toString('utf8'));
    expect(candidates).toHaveLength(7);
    expect(new Set(candidates.map((entry) => entry.stableTitleKey)).size).toBe(7);
    expect(candidates.every((entry) => entry.targetProjectKey === 'entity-engineering')).toBe(
      true,
    );
  });

  it('assesses every mapped prerequisite from deterministic repository markers', () => {
    const assessments = assessRepositoryPrerequisites(repoRoot);
    expect(assessments.map((entry) => entry.sourceLine)).toEqual([
      28, 31, 34, 39, 90, 92, 96,
    ]);
    expect(assessments.filter((entry) => entry.state === 'unknown')).toEqual([]);
    expect(assessments.find((entry) => entry.sourceLine === 92)?.state).toBe('ready');
    expect(assessments.find((entry) => entry.sourceLine === 90)?.state).toBe('blocked');
    expect(assessments.find((entry) => entry.sourceLine === 96)?.state).toBe('blocked');
    expect(
      assessRepositoryPrerequisites(repoRoot, { serverBuildPassed: true }).find(
        (entry) => entry.sourceLine === 90,
      )?.state,
    ).toBe('already_implemented');
    expect(
      assessRepositoryPrerequisites(repoRoot, {
        sourceRef: 'refs/heads/ee-b-05-ref-that-does-not-exist',
      }).every((entry) => entry.state === 'unknown'),
    ).toBe(true);
  });

  it('reports create only when project, ledger, prerequisite, and titles are clear', () => {
    const entry = candidate();
    const report = runEngineeringImportDryRun(
      [entry],
      snapshot(),
      [prerequisite(entry.sourceLine)],
    );

    expect(report.decisions[0]).toMatchObject({
      decision: 'create',
      executionReady: true,
    });
  });

  it('links only through a matching project-scoped ledger row', () => {
    const entry = candidate();
    const current = snapshot({
      tasks: [
        {
          id: 44,
          name: entry.sourceTitle,
          column: 'backlog',
          archived: false,
          projectIds: [7],
          legacyProject: 'Entity Engineering',
          engineeringImport: {
            sourceSystem: 'entity-todo',
            sourceKey: entry.stableTitleKey,
            sourceFingerprint: entry.sourceFingerprint,
            sourceSnapshotSha256:
              'e2715adba665d61f8d467a550737364f57595bef53deb73e460505d0f2842bcc',
            mappingSha256:
              '9c60c02d3869ef5606613f38ed37fb075a6f4904c5f26d2f1ce2e81251bfa93b',
          },
        },
      ],
      ledgerEntries: [
        {
          projectId: 7,
          sourceSystem: 'entity-todo',
          sourceKey: entry.stableTitleKey,
          taskId: 44,
          sourceFingerprint: entry.sourceFingerprint,
          sourceSnapshotSha256:
            'e2715adba665d61f8d467a550737364f57595bef53deb73e460505d0f2842bcc',
        },
      ],
    });

    expect(
      runEngineeringImportDryRun([entry], current, [prerequisite(entry.sourceLine)])
        .decisions[0],
    ).toMatchObject({ decision: 'link', executionReady: false });
  });

  it('never links a ledger row when exact project identity is unresolved', () => {
    const entry = candidate();
    const current = snapshot({
      schema: {
        projectColumns: ['id', 'name'],
        taskColumns: ['id', 'name', 'project_id'],
        taskProjectColumns: ['task_id', 'project_id'],
        ledgerTablePresent: true,
        ledgerColumns: [
          'project_id',
          'source_system',
          'source_key',
          'task_id',
          'source_fingerprint',
          'source_snapshot_sha256',
        ],
        ledgerUniqueProjectSourceKey: true,
        ledgerUniqueTaskId: true,
      },
      projects: [],
      tasks: [
        {
          id: 44,
          name: entry.sourceTitle,
          column: 'backlog',
          archived: false,
          projectIds: [7],
          legacyProject: null,
          engineeringImport: null,
        },
      ],
      ledgerEntries: [
        {
          projectId: 7,
          sourceSystem: 'entity-todo',
          sourceKey: entry.stableTitleKey,
          taskId: 44,
          sourceFingerprint: entry.sourceFingerprint,
          sourceSnapshotSha256:
            'e2715adba665d61f8d467a550737364f57595bef53deb73e460505d0f2842bcc',
        },
      ],
    });

    expect(
      runEngineeringImportDryRun([entry], current, [prerequisite(entry.sourceLine)])
        .decisions[0],
    ).toMatchObject({ decision: 'conflict', executionReady: false });
  });

  it('rejects ledger links without snapshot and task provenance agreement', () => {
    const entry = candidate();
    const current = snapshot({
      tasks: [
        {
          id: 44,
          name: entry.sourceTitle,
          column: 'backlog',
          archived: false,
          projectIds: [7],
          legacyProject: null,
          engineeringImport: null,
        },
      ],
      ledgerEntries: [
        {
          projectId: 7,
          sourceSystem: 'entity-todo',
          sourceKey: entry.stableTitleKey,
          taskId: 44,
          sourceFingerprint: entry.sourceFingerprint,
          sourceSnapshotSha256: null,
        },
      ],
    });

    expect(
      runEngineeringImportDryRun([entry], current, [prerequisite(entry.sourceLine)])
        .decisions[0],
    ).toMatchObject({ decision: 'conflict', executionReady: false });
  });

  it('does not lose a target-project fuzzy match behind global result truncation', () => {
    const entry = candidate({
      sourceTitle:
        'Browser testing activity stream grouping stable local fixture behavior proof',
    });
    const globalTasks = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      name: `Browser testing activity stream grouping extra ${index}`,
      column: 'todo',
      archived: false,
      projectIds: [99],
      legacyProject: null,
      engineeringImport: null,
    }));
    const targetTask = {
      id: 99,
      name: 'Browser testing activity stream grouping stable local fixture alternate',
      column: 'todo',
      archived: false,
      projectIds: [7],
      legacyProject: null,
      engineeringImport: null,
    };

    expect(
      runEngineeringImportDryRun(
        [entry],
        snapshot({ tasks: [...globalTasks, targetTask] }),
        [prerequisite(entry.sourceLine)],
      ).decisions[0],
    ).toMatchObject({ decision: 'conflict', executionReady: false });
  });

  it('fails closed on unresolved project identity and unledgered exact titles', () => {
    const entry = candidate();
    const missingProject = snapshot({
      projects: [],
      schema: {
        projectColumns: ['id', 'name'],
        taskColumns: ['id', 'name', 'project_id'],
        taskProjectColumns: ['task_id', 'project_id'],
        ledgerTablePresent: false,
        ledgerColumns: [],
        ledgerUniqueProjectSourceKey: false,
        ledgerUniqueTaskId: false,
      },
    });
    expect(
      runEngineeringImportDryRun(
        [entry],
        missingProject,
        [prerequisite(entry.sourceLine)],
      ).decisions[0],
    ).toMatchObject({ decision: 'conflict', executionReady: false });

    const exactTitle = snapshot({
      tasks: [
        {
          id: 55,
          name: entry.sourceTitle.toUpperCase(),
          column: 'todo',
          archived: false,
          projectIds: [7],
          legacyProject: null,
          engineeringImport: null,
        },
      ],
    });
    expect(
      runEngineeringImportDryRun(
        [entry],
        exactTitle,
        [prerequisite(entry.sourceLine)],
      ).decisions[0].reasons,
    ).toContain(
      'Exact target-project title exists without an authoritative stable-key ledger link',
    );
  });

  it('does not expose off-project task titles in the receipt', () => {
    const entry = candidate();
    const report = runEngineeringImportDryRun(
      [entry],
      snapshot({
        tasks: [
          {
            id: 77,
            name: entry.sourceTitle,
            column: 'todo',
            archived: false,
            projectIds: [99],
            legacyProject: null,
            engineeringImport: null,
          },
        ],
      }),
      [prerequisite(entry.sourceLine)],
    );

    expect(report.decisions[0].exactMatches).toEqual([]);
    expect(report.decisions[0].advisoryGlobalExactMatchCount).toBe(1);
    expect(JSON.stringify(report)).not.toContain('"taskId":77');
  });

  it('fails closed when task-to-project membership schema is incomplete', () => {
    const entry = candidate();
    const current = snapshot({
      schema: {
        ...snapshot().schema,
        taskColumns: ['id', 'name'],
        taskProjectColumns: [],
      },
    });

    const report = runEngineeringImportDryRun(
      [entry],
      current,
      [prerequisite(entry.sourceLine)],
    );
    expect(report.taskMembershipReadiness.status).toBe('schema_not_ready');
    expect(report.decisions[0].decision).toBe('conflict');
  });

  it('requires snapshot provenance and both ledger uniqueness constraints', () => {
    const entry = candidate();
    const current = snapshot({
      schema: {
        ...snapshot().schema,
        ledgerColumns: [
          'project_id',
          'source_system',
          'source_key',
          'task_id',
          'source_fingerprint',
        ],
        ledgerUniqueProjectSourceKey: false,
        ledgerUniqueTaskId: false,
      },
      tasks: [
        {
          id: 44,
          name: entry.sourceTitle,
          column: 'todo',
          archived: false,
          projectIds: [7],
          legacyProject: null,
          engineeringImport: {
            sourceSystem: ENTITY_TODO_SOURCE_SYSTEM,
            sourceKey: entry.stableTitleKey,
            sourceFingerprint: entry.sourceFingerprint,
            sourceSnapshotSha256: EXPECTED_TODO_SNAPSHOT_SHA256,
            mappingSha256: EXPECTED_MAPPING_CSV_SHA256,
          },
        },
      ],
      ledgerEntries: [
        {
          projectId: 7,
          sourceSystem: ENTITY_TODO_SOURCE_SYSTEM,
          sourceKey: entry.stableTitleKey,
          taskId: 44,
          sourceFingerprint: entry.sourceFingerprint,
          sourceSnapshotSha256: EXPECTED_TODO_SNAPSHOT_SHA256,
        },
      ],
    });

    const report = runEngineeringImportDryRun(
      [entry],
      current,
      [prerequisite(entry.sourceLine)],
    );
    expect(report.ledgerReadiness).toMatchObject({ status: 'schema_not_ready' });
    expect(report.ledgerReadiness.missingColumns).toEqual(
      expect.arrayContaining([
        'source_snapshot_sha256',
        'UNIQUE(project_id, source_system, source_key)',
        'UNIQUE(task_id)',
      ]),
    );
    expect(report.decisions[0].decision).toBe('conflict');
    expect(report.decisions[0].reasons).toContain('Import ledger is schema_not_ready');
  });

  it('marks already-landed verify candidates stale before infrastructure blockers', () => {
    const entry = candidate({ importAction: 'verify_then_create' });
    const current = snapshot({
      projects: [],
      schema: {
        projectColumns: ['id', 'name'],
        taskColumns: ['id', 'name', 'project_id'],
        taskProjectColumns: ['task_id', 'project_id'],
        ledgerTablePresent: false,
        ledgerColumns: [],
        ledgerUniqueProjectSourceKey: false,
        ledgerUniqueTaskId: false,
      },
    });

    expect(
      runEngineeringImportDryRun(
        [entry],
        current,
        [prerequisite(entry.sourceLine, 'already_implemented')],
      ).decisions[0],
    ).toMatchObject({ decision: 'stale', executionReady: false });
  });

  it('rejects any connection that is writable, non-query-only, or changed', () => {
    const entry = candidate();
    for (const connection of [
      { readonly: false, queryOnly: true, totalChanges: 0 },
      { readonly: true, queryOnly: false, totalChanges: 0 },
      { readonly: true, queryOnly: true, totalChanges: 1 },
    ]) {
      expect(() =>
        runEngineeringImportDryRun(
          [entry],
          snapshot({ connection }),
          [prerequisite(entry.sourceLine)],
        ),
      ).toThrow('read-only, query-only database connection with zero changes');
    }
  });
});
