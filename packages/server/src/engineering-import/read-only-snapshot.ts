import Database from 'better-sqlite3';
import type {
  CurrentEntitySnapshot,
  ImportLedgerEntry,
  ProjectSnapshot,
  TaskImportMetadata,
  TaskSnapshot,
} from './dry-run';

type Row = Record<string, unknown>;

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function tableColumns(db: Database.Database, table: string): string[] {
  if (!tableExists(db, table)) return [];
  return (db.prepare(`PRAGMA table_info("${table}")`).all() as Row[]).map((row) =>
    String(row.name),
  );
}

function selectExpression(columns: string[], column: string, alias: string): string {
  return columns.includes(column) ? `"${column}" AS "${alias}"` : `NULL AS "${alias}"`;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseEngineeringImportMetadata(value: unknown): TaskImportMetadata | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const metadata = JSON.parse(value) as Record<string, unknown>;
    const raw = metadata.engineering_import;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    return {
      sourceSystem: text(entry.source_system),
      sourceKey: text(entry.source_key),
      sourceFingerprint: text(entry.source_fingerprint),
      sourceSnapshotSha256: text(entry.source_snapshot_sha256),
      mappingSha256: text(entry.mapping_sha256),
    };
  } catch {
    return null;
  }
}

function readProjects(db: Database.Database, columns: string[]): ProjectSnapshot[] {
  if (!columns.length) return [];
  const rows = db
    .prepare(
      `SELECT
        ${selectExpression(columns, 'id', 'id')},
        ${selectExpression(columns, 'org_id', 'org_id')},
        ${selectExpression(columns, 'team_id', 'team_id')},
        ${selectExpression(columns, 'name', 'name')},
        ${selectExpression(columns, 'lifecycle_state', 'lifecycle_state')},
        ${selectExpression(columns, 'project_key', 'project_key')},
        ${selectExpression(columns, 'work_domain', 'work_domain')}
      FROM projects
      ORDER BY id ASC`,
    )
    .all() as Row[];
  return rows.flatMap((row) => {
    const id = integer(row.id);
    if (id === null) return [];
    return [
      {
        id,
        orgId: text(row.org_id),
        teamId: text(row.team_id),
        name: text(row.name) ?? '',
        lifecycleState: text(row.lifecycle_state),
        projectKey: text(row.project_key),
        workDomain: text(row.work_domain),
      },
    ];
  });
}

function readTaskProjectIds(db: Database.Database): Map<number, Set<number>> {
  const memberships = new Map<number, Set<number>>();
  if (!tableExists(db, 'task_projects')) return memberships;
  const columns = tableColumns(db, 'task_projects');
  if (!columns.includes('task_id') || !columns.includes('project_id')) return memberships;
  for (const row of db.prepare('SELECT task_id, project_id FROM task_projects').all() as Row[]) {
    const taskId = integer(row.task_id);
    const projectId = integer(row.project_id);
    if (taskId === null || projectId === null) continue;
    const projectIds = memberships.get(taskId) ?? new Set<number>();
    projectIds.add(projectId);
    memberships.set(taskId, projectIds);
  }
  return memberships;
}

function readTasks(db: Database.Database, columns: string[]): TaskSnapshot[] {
  if (!columns.includes('id') || !columns.includes('name')) return [];
  const memberships = readTaskProjectIds(db);
  const importMetadata = new Map<number, TaskImportMetadata>();
  if (columns.includes('metadata')) {
    const metadataRows = db
      .prepare(
        `SELECT id, metadata
         FROM tasks
         WHERE metadata IS NOT NULL
           AND metadata LIKE '%"engineering_import"%'`,
      )
      .all() as Row[];
    for (const metadataRow of metadataRows) {
      const taskId = integer(metadataRow.id);
      const parsed = parseEngineeringImportMetadata(metadataRow.metadata);
      if (
        taskId === null ||
        !parsed ||
        !parsed.sourceSystem ||
        !parsed.sourceKey ||
        !parsed.sourceFingerprint ||
        !parsed.sourceSnapshotSha256 ||
        !parsed.mappingSha256
      ) {
        throw new Error('tasks contains malformed engineering_import metadata');
      }
      importMetadata.set(taskId, parsed);
    }
  }
  const rows = db
    .prepare(
      `SELECT
        "id" AS "id",
        "name" AS "name",
        ${selectExpression(columns, 'column', 'column_name')},
        ${selectExpression(columns, 'archived', 'archived')},
        ${selectExpression(columns, 'project_id', 'project_id')},
        ${selectExpression(columns, 'project', 'legacy_project')}
      FROM tasks
      ORDER BY id ASC`,
    )
    .all() as Row[];
  return rows.flatMap((row) => {
    const id = integer(row.id);
    if (id === null) return [];
    const projectIds = memberships.get(id) ?? new Set<number>();
    const primaryProjectId = integer(row.project_id);
    if (primaryProjectId !== null) projectIds.add(primaryProjectId);
    return [
      {
        id,
        name: text(row.name) ?? '',
        column: text(row.column_name) ?? 'unknown',
        archived: row.archived === 1 || row.archived === true,
        projectIds: [...projectIds].sort((left, right) => left - right),
        legacyProject: text(row.legacy_project),
        engineeringImport: importMetadata.get(id) ?? null,
      },
    ];
  });
}

function readLedgerEntries(
  db: Database.Database,
  columns: string[],
): ImportLedgerEntry[] {
  const required = [
    'project_id',
    'source_system',
    'source_key',
    'task_id',
    'source_fingerprint',
    'source_snapshot_sha256',
  ];
  if (required.some((column) => !columns.includes(column))) return [];
  const rows = db
    .prepare(
      `SELECT project_id, source_system, source_key, task_id, source_fingerprint,
              source_snapshot_sha256
       FROM task_import_keys
       WHERE source_system = 'entity-todo'
       ORDER BY project_id ASC, source_key ASC`,
    )
    .all() as Row[];
  return rows.map((row) => {
    const projectId = integer(row.project_id);
    const taskId = integer(row.task_id);
    const sourceSystem = text(row.source_system);
    const sourceKey = text(row.source_key);
    const sourceFingerprint = text(row.source_fingerprint);
    const sourceSnapshotSha256 = text(row.source_snapshot_sha256);
    if (
      projectId === null ||
      taskId === null ||
      sourceSystem === null ||
      sourceKey === null ||
      sourceFingerprint === null ||
      sourceSnapshotSha256 === null
    ) {
      throw new Error('task_import_keys contains a malformed entity-todo row');
    }
    return {
      projectId,
      taskId,
      sourceSystem,
      sourceKey,
      sourceFingerprint,
      sourceSnapshotSha256,
    };
  });
}

function hasUniqueIndex(
  db: Database.Database,
  table: string,
  expectedColumns: string[],
): boolean {
  if (!tableExists(db, table)) return false;
  const indexes = db.prepare(`PRAGMA index_list("${table}")`).all() as Row[];
  return indexes.some((index) => {
    if (
      index.unique !== 1 ||
      Number(index.partial ?? 0) !== 0 ||
      typeof index.name !== 'string'
    ) {
      return false;
    }
    const columns = (
      db.prepare(`PRAGMA index_info("${index.name}")`).all() as Row[]
    ).map((row) => String(row.name));
    return (
      columns.length === expectedColumns.length &&
      columns.every((column, position) => column === expectedColumns[position])
    );
  });
}

export function readCurrentEntitySnapshot(databasePath: string): CurrentEntitySnapshot {
  const db = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
    timeout: 5_000,
  });
  try {
    db.pragma('query_only = ON');
    db.exec('BEGIN');
    const projectColumns = tableColumns(db, 'projects');
    const taskColumns = tableColumns(db, 'tasks');
    const taskProjectColumns = tableColumns(db, 'task_projects');
    const ledgerTablePresent = tableExists(db, 'task_import_keys');
    const ledgerColumns = ledgerTablePresent
      ? tableColumns(db, 'task_import_keys')
      : [];
    const snapshot: CurrentEntitySnapshot = {
      schema: {
        projectColumns,
        taskColumns,
        taskProjectColumns,
        ledgerTablePresent,
        ledgerColumns,
        ledgerUniqueProjectSourceKey: hasUniqueIndex(db, 'task_import_keys', [
          'project_id',
          'source_system',
          'source_key',
        ]),
        ledgerUniqueTaskId: hasUniqueIndex(db, 'task_import_keys', ['task_id']),
      },
      projects: readProjects(db, projectColumns),
      tasks: readTasks(db, taskColumns),
      ledgerEntries: ledgerTablePresent
        ? readLedgerEntries(db, ledgerColumns)
        : [],
      connection: {
        readonly: db.readonly,
        queryOnly: db.pragma('query_only', { simple: true }) === 1,
        totalChanges: Number(
          (db.prepare('SELECT total_changes() AS changes').get() as Row).changes,
        ),
      },
    };
    db.exec('COMMIT');
    return snapshot;
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}
