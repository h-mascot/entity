import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { getEntityDatabase } from './entity-db';

export const TASK_COLUMNS = ['backlog', 'todo', 'doing', 'review', 'done'] as const;
export const DEFAULT_WORKSPACE_ORG_ID = 'default-org';
export const DEFAULT_WORKSPACE_TEAM_ID = 'default-team';

export type TaskColumn = (typeof TASK_COLUMNS)[number];

export interface TaskRecord {
  id: number;
  org_id?: string;
  team_id?: string;
  project_id?: number | null;
  name: string;
  description: string | null;
  brief: string | null;
  origin_channel: string | null;
  column: TaskColumn;
  model: string | null;
  archived: boolean;
  assignee: string | null;
  blocked: boolean;
  blocker_reason: string | null;
  due_date: string | null;
  priority: string | null;
  estimate_hours: number | null;
  time_spent: number | null;
  output: string | null;
  progress_status: string | null;
  recurring: boolean;
  recurring_config: string | null;
  created_at: string;
  updated_at: string;
  metadata: string | null;
  project?: string | null;
  projects?: ProjectRecord[];
}

export interface CreateTaskInput {
  org_id?: string;
  team_id?: string;
  project_id?: number | null;
  name: string;
  description?: string;
  brief?: string;
  origin_channel?: string;
  column?: string;
  model?: string;
  archived?: boolean;
  assignee?: string;
  blocked?: boolean;
  blocker_reason?: string;
  due_date?: string;
  priority?: string;
  estimate_hours?: number;
  time_spent?: number;
  output?: string;
  progress_status?: string;
  recurring?: boolean;
  recurring_config?: string;
  metadata?: string;
  project?: string;
}


export interface AgentRegistryRecord {
  id: string;
  slug: string;
  name: string;
  emoji: string;
  avatar_url: string | null;
  description: string | null;
  adapter_type: string | null;
  runtime_type: string | null;
  status: string;
  instructions_path: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAgentRegistryInput {
  id?: string;
  slug: string;
  name: string;
  emoji: string;
  avatar_url?: string | null;
  description?: string | null;
  adapter_type?: string | null;
  runtime_type?: string | null;
  status?: string;
  instructions_path?: string | null;
  metadata_json?: string;
}

export interface UpdateAgentRegistryInput {
  slug?: string;
  name?: string;
  emoji?: string;
  avatar_url?: string | null;
  description?: string | null;
  adapter_type?: string | null;
  runtime_type?: string | null;
  status?: string;
  instructions_path?: string | null;
  metadata_json?: string;
}

export interface AgentRegistryRepository {
  listAgents: () => AgentRegistryRecord[];
  getAgent: (id: string) => AgentRegistryRecord | undefined;
  getAgentBySlug: (slug: string) => AgentRegistryRecord | undefined;
  createAgent: (input: CreateAgentRegistryInput) => AgentRegistryRecord;
  updateAgent: (id: string, updates: UpdateAgentRegistryInput) => AgentRegistryRecord | undefined;
  deleteAgent: (id: string) => boolean;
}

export interface UpsertAgentModuleGrantInput {
  agent_id: string;
  module_id: string;
  enabled?: boolean;
  permissions_json?: string;
  scope_json?: string;
}

export interface ModuleRegistryRepository {
  listModules: () => ModuleRegistryRecord[];
  listModuleSkillRefs: (moduleId: string) => ModuleSkillRefRecord[];
  listAgentModuleGrants: (agentId: string) => AgentModuleGrantRecord[];
  upsertAgentModuleGrant: (input: UpsertAgentModuleGrantInput) => AgentModuleGrantRecord;
  deleteAgentModuleGrant: (agentId: string, moduleId: string) => boolean;
}

export interface ModuleRegistryRecord {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  enabled: boolean;
  icon: string | null;
  kind: string;
  permissions_schema_json: string;
  ui_config_json: string;
  created_at: string;
  updated_at: string;
}

export interface AgentModuleGrantRecord {
  id: string;
  agent_id: string;
  module_id: string;
  enabled: boolean;
  permissions_json: string;
  scope_json: string;
  created_at: string;
  updated_at: string;
}

export interface ModuleSkillRefRecord {
  id: string;
  module_id: string;
  label: string;
  kind: string;
  ref: string;
  required: boolean;
  notes: string | null;
}

export interface UpdateTaskInput {
  org_id?: string;
  team_id?: string;
  project_id?: number | null;
  name?: string;
  description?: string;
  brief?: string;
  origin_channel?: string;
  column?: string;
  model?: string;
  archived?: boolean;
  assignee?: string;
  blocked?: boolean;
  blocker_reason?: string;
  due_date?: string;
  priority?: string;
  estimate_hours?: number;
  time_spent?: number;
  output?: string;
  progress_status?: string;
  recurring?: boolean;
  recurring_config?: string;
  metadata?: string;
  project?: string;
}

export interface TaskRepository {
  listTasks: () => TaskRecord[];
  getTask: (id: number) => TaskRecord | undefined;
  createTask: (input: CreateTaskInput) => TaskRecord;
  updateTask: (id: number, updates: UpdateTaskInput) => TaskRecord | undefined;
  moveTask: (id: number, nextColumn: string) => TaskRecord | undefined;
  deleteTask: (id: number) => boolean;
}

export type ActivitySource = 'agent' | 'task';

export type ActivityType =
  | 'file_edit'
  | 'tool_call'
  | 'message_sent'
  | 'command_run'
  | 'research'
  | 'thinking'
  | 'task_created'
  | 'task_updated'
  | 'task_moved'
  | 'task_completed'
  | 'task_deleted'
  | 'task_comment';

export interface ActivityRecord {
  id: number;
  source: ActivitySource;
  type: ActivityType;
  action: string;
  description: string;
  agent_name: string | null;
  agent_emoji: string | null;
  file_path: string | null;
  task_id: number | null;
  task_column: string | null;
  metadata: string | null;
  created_at: string;
}

export interface CreateActivityInput {
  source?: ActivitySource;
  type: ActivityType;
  action: string;
  description: string;
  agent_name?: string;
  agent_emoji?: string;
  file_path?: string;
  task_id?: number;
  task_column?: string;
  model?: string;
  archived?: boolean;
  metadata?: string;
}

export interface ActivityRepository {
  listActivities: (limit?: number) => ActivityRecord[];
  listActivitiesByTaskId: (taskId: number, limit?: number) => ActivityRecord[];
  createActivity: (input: CreateActivityInput) => ActivityRecord;
}

export interface AgentLogRecord {
  id: number;
  timestamp: string;
  event: string;
  task_id: number | null;
  action: string;
  result: string | null;
  model: string;
  tokens_used: number;
}

export interface CreateAgentLogInput {
  event: string;
  task_id?: number | null;
  action: string;
  result?: string | null;
  model?: string;
  tokens_used?: number;
}

export interface AgentLogStatus {
  lastRun: string | null;
  totalActions: number;
}

export interface AgentLogRepository {
  listLogs: (limit?: number) => AgentLogRecord[];
  createLog: (input: CreateAgentLogInput) => AgentLogRecord;
  getStatus: () => AgentLogStatus;
}

export interface TaskCommentRecord {
  id: number;
  task_id: number;
  body: string;
  author: string;
  parent_id: number | null;
  created_at: string;
}

export interface CreateTaskCommentInput {
  task_id: number;
  body: string;
  author?: string;
  parent_id?: number | null;
}

export interface TaskCommentRepository {
  listComments: (taskId: number) => TaskCommentRecord[];
  createComment: (input: CreateTaskCommentInput) => TaskCommentRecord;
}

export interface RoadmapRecord {
  id: number;
  name: string;
  theme: string | null;
  color: string | null;
  created_at: string;
}

export interface RoadmapItemRecord {
  id: number;
  roadmap_id: number;
  title: string;
  description: string | null;
  priority: string;
  target_period: string | null;
  status: string;
  linked_task_id: number | null;
  created_at: string;
}

export interface RoadmapWithItemsRecord extends RoadmapRecord {
  items: RoadmapItemRecord[];
}

export interface CreateRoadmapInput {
  name: string;
  theme?: string;
  color?: string;
}

export interface CreateRoadmapItemInput {
  title: string;
  description?: string;
  priority?: string;
  target_period?: string;
  status?: string;
  linked_task_id?: number | null;
}

export interface UpdateRoadmapItemInput {
  title?: string;
  description?: string | null;
  priority?: string;
  target_period?: string | null;
  status?: string;
  linked_task_id?: number | null;
}

export interface ProjectRecord {
  id: number;
  org_id?: string;
  team_id?: string;
  name: string;
  color: string | null;
  lifecycle_state?: string;
  created_at: string;
}

export interface CreateProjectInput {
  org_id?: string;
  team_id?: string;
  name: string;
  color?: string;
  lifecycle_state?: string;
}

export interface OrgRecord {
  id: string;
  name: string;
  slug: string;
  status: string;
  deployment_mode: string;
  created_at: string;
  updated_at: string;
}

export interface CreateOrgInput {
  id?: string;
  name: string;
  slug?: string;
  status?: string;
  deployment_mode?: string;
}

export interface TeamRecord {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTeamInput {
  id?: string;
  name: string;
  slug?: string;
  status?: string;
}

export interface OrgQueryContext {
  orgId: string;
  teamId?: string;
}

export interface OrgScopedTaskRepository extends TaskRepository {
  readonly orgId: string;
  readonly teamId?: string;
}

export interface WorkspaceScopeRepository {
  listOrgs: () => OrgRecord[];
  createOrg: (input: CreateOrgInput) => OrgRecord;
  listTeams: (context: OrgQueryContext) => TeamRecord[];
  createTeam: (context: OrgQueryContext, input: CreateTeamInput) => TeamRecord;
  listProjects: (context: OrgQueryContext) => ProjectRecord[];
  createProject: (context: OrgQueryContext, input: CreateProjectInput) => ProjectRecord;
  getTaskProjects: (context: OrgQueryContext, taskId: number) => ProjectRecord[];
  addTaskProject: (context: OrgQueryContext, taskId: number, projectId: number) => boolean;
  removeTaskProject: (context: OrgQueryContext, taskId: number, projectId: number) => boolean;
}

export interface SubscriptionRecord {
  id: string;
  agent_id: string;
  crew_id: string;
  created_at: string;
}

export interface CrewRecord {
  id: string;
  name: string;
  description: string | null;
  settings: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateCrewInput {
  id?: string;
  name: string;
  description?: string;
  settings?: string;
}

export interface CrewSubscriptionRecord {
  id: number;
  crew_id: string;
  agent_id: string;
  created_at: string;
}

export interface CreateCrewSubscriptionInput {
  crew_id: string;
  agent_id: string;
}

const DEFAULT_MISSION_CONTROL_PROJECTS: ReadonlyArray<{ name: string; color: string }> = [
  { name: 'Soteria', color: '#2563eb' },
  { name: 'Curacel', color: '#10b981' },
  { name: 'Personal', color: '#f59e0b' },
  { name: 'Moltbot', color: '#f43f5e' },
];

export interface TaskHistoryRecord {
  id: number;
  task_id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

interface SourceTaskRow {
  id: number;
  name: string;
  description: string | null;
  task_column: string | null;
  assignee: string | null;
  blocked: number | null;
  blocker_reason: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function isTaskColumn(value: string): value is TaskColumn {
  return (TASK_COLUMNS as readonly string[]).includes(value);
}

function normalizeTaskColumn(value: string | null | undefined): TaskColumn {
  if (!value) {
    return 'backlog';
  }

  const lowered = value.toLowerCase();
  if (isTaskColumn(lowered)) {
    return lowered;
  }

  return 'backlog';
}

function normalizeTimestamp(value: string | null | undefined): string {
  if (!value) {
    return new Date().toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }

  return parsed.toISOString();
}

function normalizeBlocked(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes';
  }

  return false;
}

function normalizeBlockerReason(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'undefined' || value === null) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function resolveMissionControlDbPath(): string {
  const custom = process.env.MISSION_CONTROL_DB_PATH;
  if (custom) {
    return path.resolve(custom);
  }

  return path.join(os.homedir(), 'Code', 'mission-control', 'tasks.db');
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function normalizeWorkspaceId(value: unknown, fallback?: string): string {
  const normalized = normalizeBlockerReason(value);
  if (normalized) {
    return normalized;
  }
  if (fallback) {
    return fallback;
  }
  throw new Error('org context is required');
}

function normalizeOrgQueryContext(context: OrgQueryContext): Required<OrgQueryContext> {
  const orgId = normalizeWorkspaceId(context?.orgId);
  const teamId = normalizeWorkspaceId(context?.teamId, DEFAULT_WORKSPACE_TEAM_ID);
  return { orgId, teamId };
}

function normalizeSlug(value: unknown, fallback: string): string {
  const raw = normalizeBlockerReason(value) ?? fallback;
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'workspace';
}

function seedDefaultMissionControlProjects(db: Database.Database): void {
  const insertIfMissing = db.prepare(`
    INSERT INTO projects (name, color, created_at)
    SELECT ?, ?, CURRENT_TIMESTAMP
    WHERE NOT EXISTS (
      SELECT 1
      FROM projects
      WHERE lower(name) = lower(?)
    )
  `);

  for (const project of DEFAULT_MISSION_CONTROL_PROJECTS) {
    insertIfMissing.run(project.name, project.color, project.name);
  }
}

function bootstrap(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      deployment_mode TEXT NOT NULL DEFAULT 'saas',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id, slug)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      team_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}',
      project_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      column TEXT NOT NULL DEFAULT 'backlog',
      assignee TEXT DEFAULT 'Unassigned',
      blocked INTEGER NOT NULL DEFAULT 0,
      blocker_reason TEXT,
      project TEXT DEFAULT 'General',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated_at ON tasks(updated_at DESC);

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'agent',
      type TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      agent_name TEXT,
      agent_emoji TEXT,
      file_path TEXT,
      task_id INTEGER,
      task_column TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_source ON activities(source);
    CREATE INDEX IF NOT EXISTS idx_activities_task_id ON activities(task_id);
    CREATE INDEX IF NOT EXISTS idx_activities_file_path ON activities(file_path);

    CREATE TABLE IF NOT EXISTS agent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      event TEXT NOT NULL,
      task_id INTEGER,
      action TEXT NOT NULL,
      result TEXT,
      model TEXT DEFAULT 'gemini-flash',
      tokens_used INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_agent_log_timestamp ON agent_log(timestamp DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_log_event ON agent_log(event);
    CREATE INDEX IF NOT EXISTS idx_agent_log_task_id ON agent_log(task_id);

    CREATE TABLE IF NOT EXISTS task_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author TEXT DEFAULT 'Human',
      parent_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS roadmaps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      theme TEXT,
      color TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS roadmap_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roadmap_id INTEGER NOT NULL REFERENCES roadmaps(id),
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'P2',
      target_period TEXT,
      status TEXT DEFAULT 'planned',
      linked_task_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_roadmap_items_roadmap_id ON roadmap_items(roadmap_id);

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      team_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}',
      name TEXT NOT NULL,
      color TEXT,
      lifecycle_state TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES entity_agents(id) ON DELETE CASCADE,
      crew_id TEXT NOT NULL REFERENCES crews(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, crew_id)
    );
    CREATE TABLE IF NOT EXISTS crews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      settings TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_crews_updated_at ON crews(updated_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS crew_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crew_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(crew_id, agent_id)
    );

    CREATE INDEX IF NOT EXISTS idx_crew_subscriptions_crew ON crew_subscriptions(crew_id);
    CREATE INDEX IF NOT EXISTS idx_crew_subscriptions_agent ON crew_subscriptions(agent_id);

    CREATE TABLE IF NOT EXISTS task_projects (
      task_id INTEGER NOT NULL,
      org_id TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}',
      project_id INTEGER NOT NULL,
      PRIMARY KEY (task_id, project_id)
    );

    CREATE INDEX IF NOT EXISTS idx_task_projects_task_id ON task_projects(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_projects_project_id ON task_projects(project_id);

    CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_task_history_task_id ON task_history(task_id);
    CREATE INDEX IF NOT EXISTS idx_task_history_changed_at ON task_history(changed_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS file_sources (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL,
      base_url TEXT,
      base_path TEXT,
      auth_type TEXT NOT NULL DEFAULT 'none',
      auth_ref TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      capabilities TEXT NOT NULL DEFAULT '{}',
      health TEXT NOT NULL DEFAULT 'ok',
      last_synced_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_file_sources_enabled ON file_sources(enabled);
    CREATE INDEX IF NOT EXISTS idx_file_sources_type ON file_sources(type);
    CREATE INDEX IF NOT EXISTS idx_file_sources_updated_at ON file_sources(updated_at DESC);

    CREATE TABLE IF NOT EXISTS file_index (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'one-off',
      agent TEXT NOT NULL DEFAULT 'other',
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurring_pattern TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      preview TEXT,
      content_hash TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_file_index_source_path ON file_index(source_id, path);
    CREATE INDEX IF NOT EXISTS idx_file_index_source ON file_index(source_id);
    CREATE INDEX IF NOT EXISTS idx_file_index_type ON file_index(type);
    CREATE INDEX IF NOT EXISTS idx_file_index_agent ON file_index(agent);
    CREATE INDEX IF NOT EXISTS idx_file_index_indexed_at ON file_index(indexed_at DESC);

    CREATE TABLE IF NOT EXISTS file_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      error TEXT,
      files_scanned INTEGER NOT NULL DEFAULT 0,
      files_indexed INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_source ON file_sync_runs(source_id);
    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_status ON file_sync_runs(status);
    CREATE INDEX IF NOT EXISTS idx_file_sync_runs_started_at ON file_sync_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS document_sessions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      source_id TEXT NOT NULL,
      path TEXT NOT NULL,
      content_hash TEXT,
      version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_sessions_doc_id ON document_sessions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_sessions_updated_at ON document_sessions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_authorship_ranges (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      author TEXT NOT NULL,
      reviewed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_authorship_ranges_doc_id ON document_authorship_ranges(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_authorship_ranges_updated_at ON document_authorship_ranges(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_authorship_history (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      range_id TEXT,
      author TEXT NOT NULL,
      diff_json TEXT NOT NULL DEFAULT '{}',
      timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_authorship_history_doc_id ON document_authorship_history(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_authorship_history_updated_at ON document_authorship_history(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_presence (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      cursor_json TEXT NOT NULL DEFAULT '{}',
      last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_document_presence_doc_agent ON document_presence(doc_id, agent_id);
    CREATE INDEX IF NOT EXISTS idx_document_presence_doc_id ON document_presence(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_presence_updated_at ON document_presence(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_comments (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      selected_text TEXT,
      text TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_comments_doc_id ON document_comments(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comments_updated_at ON document_comments(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_comment_replies (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      comment_id TEXT NOT NULL,
      author TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_doc_id ON document_comment_replies(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_comment_id ON document_comment_replies(comment_id);
    CREATE INDEX IF NOT EXISTS idx_document_comment_replies_updated_at ON document_comment_replies(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_suggestions (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      author TEXT NOT NULL,
      type TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      original_text TEXT NOT NULL,
      suggested_text TEXT NOT NULL,
      reason TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_suggestions_doc_id ON document_suggestions(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_suggestions_updated_at ON document_suggestions(updated_at DESC);

    CREATE TABLE IF NOT EXISTS document_review_runs (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_document_review_runs_doc_id ON document_review_runs(doc_id);
    CREATE INDEX IF NOT EXISTS idx_document_review_runs_updated_at ON document_review_runs(updated_at DESC);

    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      token_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      scopes_json TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tokens_hash ON agent_tokens(token_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tokens_type_actor ON agent_tokens(token_type, actor);
    CREATE INDEX IF NOT EXISTS idx_agent_tokens_updated_at ON agent_tokens(updated_at DESC);


    CREATE TABLE IF NOT EXISTS entity_agents (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      emoji TEXT NOT NULL,
      avatar_url TEXT,
      description TEXT,
      adapter_type TEXT,
      runtime_type TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      instructions_path TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entity_modules (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      icon TEXT,
      kind TEXT NOT NULL DEFAULT 'core',
      permissions_schema_json TEXT NOT NULL DEFAULT '[]',
      ui_config_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entity_agent_module_grants (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      permissions_json TEXT NOT NULL DEFAULT '[]',
      scope_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(agent_id, module_id)
    );

    CREATE TABLE IF NOT EXISTS entity_module_skill_refs (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL,
      label TEXT NOT NULL,
      kind TEXT NOT NULL,
      ref TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0,
      notes TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_entity_agents_slug ON entity_agents(slug);
    CREATE INDEX IF NOT EXISTS idx_entity_agents_status ON entity_agents(status);
    CREATE INDEX IF NOT EXISTS idx_entity_modules_slug ON entity_modules(slug);
    CREATE INDEX IF NOT EXISTS idx_entity_grants_agent ON entity_agent_module_grants(agent_id);
    CREATE INDEX IF NOT EXISTS idx_entity_grants_module ON entity_agent_module_grants(module_id);
    CREATE INDEX IF NOT EXISTS idx_entity_skill_refs_module ON entity_module_skill_refs(module_id);
  `);

  if (!hasColumn(db, 'tasks', 'brief')) {
    db.exec('ALTER TABLE tasks ADD COLUMN brief TEXT');
  }

  if (!hasColumn(db, 'tasks', 'origin_channel')) {
    db.exec('ALTER TABLE tasks ADD COLUMN origin_channel TEXT');
  }

  if (!hasColumn(db, 'tasks', 'due_date')) {
    db.exec('ALTER TABLE tasks ADD COLUMN due_date TEXT');
  }

  if (!hasColumn(db, 'tasks', 'priority')) {
    db.exec("ALTER TABLE tasks ADD COLUMN priority TEXT DEFAULT 'P2'");
  }

  if (!hasColumn(db, 'tasks', 'estimate_hours')) {
    db.exec('ALTER TABLE tasks ADD COLUMN estimate_hours REAL');
  }

  if (!hasColumn(db, 'tasks', 'time_spent')) {
    db.exec('ALTER TABLE tasks ADD COLUMN time_spent REAL DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'output')) {
    db.exec('ALTER TABLE tasks ADD COLUMN output TEXT');
  }

  if (!hasColumn(db, 'tasks', 'progress_status')) {
    db.exec("ALTER TABLE tasks ADD COLUMN progress_status TEXT DEFAULT 'backlog'");
  }

  if (!hasColumn(db, 'tasks', 'recurring')) {
    db.exec('ALTER TABLE tasks ADD COLUMN recurring INTEGER DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'recurring_config')) {
    db.exec('ALTER TABLE tasks ADD COLUMN recurring_config TEXT');
  }

  if (!hasColumn(db, 'tasks', 'model')) {
    db.exec('ALTER TABLE tasks ADD COLUMN model TEXT');
  }

  if (!hasColumn(db, 'tasks', 'archived')) {
    db.exec('ALTER TABLE tasks ADD COLUMN archived INTEGER DEFAULT 0');
  }

  seedDefaultMissionControlProjects(db);
  seedEntityRegistryDefaults(db);
}


function seedEntityRegistryDefaults(db: Database.Database): void {
  const agents = [
    ['assistant', 'assistant', 'Assistant', '🤖', null, 'General-purpose local agent placeholder', 'local', 'cli', 'active', null, '{"owner":"Workspace","verification":"Registry + grants","modules":["chat","tasks","files","docs"]}']
  ];
  const insertAgent = db.prepare(`
    INSERT OR IGNORE INTO entity_agents (
      id, slug, name, emoji, avatar_url, description, adapter_type, runtime_type, status, instructions_path, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const agent of agents) {
    insertAgent.run(...agent);
  }

  const modules = [
    ['chat', 'chat', 'Chat', 'Workspace chat module', 1, '💬', 'core', '["read","post","mention","admin"]', '{"label":"Chat"}'],
    ['tasks', 'tasks', 'Mission Control', 'Task and kanban module', 1, '📋', 'core', '["read","create","update","assign","review","admin"]', '{"label":"Mission Control"}'],
    ['files', 'files', 'Files', 'Workspace file access', 1, '📁', 'core', '["read","write","delete","search"]', '{"label":"Files"}'],
    ['docs', 'docs', 'Docs', 'Editor and docs collaboration', 1, '📝', 'core', '["read","write","comment","review"]', '{"label":"Docs"}'],
    ['swarm', 'swarm', 'Swarm', 'Swarm orchestration module', 1, '🐝', 'core', '["read","dispatch","supervise","kill","admin"]', '{"label":"Swarm"}'],
    ['plugins', 'plugins', 'Plugins', 'Plugin management module', 1, '🧩', 'core', '["read","toggle","configure","admin"]', '{"label":"Plugins"}'],
    ['entity-agent-contracts', 'entity-agent-contracts', 'Entity Agent Contracts', 'Required operating contract for Entity-aware onboarding agents.', 1, '📜', 'contract', '["read","validate"]', '{"label":"Required contract"}'],
    ['entity-fs', 'entity-fs', 'Entity FS', 'Entity-backed file source and docs-link delivery behavior for setup agents.', 1, '📁', 'module', '["read","search","export"]', '{"label":"Required docs/file layer"}'],
    ['entity-mc', 'entity-mc', 'Entity MC', 'Mission Control helper bundle for setup-safe progress reporting and verification.', 1, '📋', 'module', '["read","configure","verify"]', '{"label":"Recommended task helper"}'],
    ['entity-linker', 'entity-linker', 'Entity Linker', 'Docs-link delivery integration for shared artifacts during onboarding.', 1, '🔗', 'plugin', '["read","rewrite","verify"]', '{"label":"Recommended docs linker"}'],
    ['entity-discord-title-hook', 'entity-discord-title-hook', 'Discord Title Hook', 'Admin-managed Discord channel title sync integration.', 1, '#️⃣', 'plugin', '["read","configure"]', '{"label":"Admin only"}'],
    ['entity-services', 'entity-services', 'Entity Services', 'Admin-managed service/runtime integrations.', 1, '🛠️', 'plugin', '["read","configure","admin"]', '{"label":"Admin only"}'],
    ['geordi-swarm', 'geordi-swarm', 'Geordi Swarm', 'Future multi-agent swarm orchestration on top of Entity helper modules.', 1, '🐝', 'plugin', '["read","dispatch","admin"]', '{"label":"Future swarm module"}']
  ];
  const insertModule = db.prepare(`
    INSERT OR IGNORE INTO entity_modules (
      id, slug, name, description, enabled, icon, kind, permissions_schema_json, ui_config_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const moduleRow of modules) {
    insertModule.run(...moduleRow);
  }

  const skillRefs = [
    ['tasks-mc-sh', 'tasks', 'mc.sh', 'script', 'skills/entity-mc/source-scripts/mc.sh', 1, 'Mission Control CLI helper bundled with Entity'],
    ['tasks-context', 'tasks', 'Entity context', 'doc', 'memory/entity-project-context.md', 1, 'Entity runtime context'],
    ['swarm-skill', 'swarm', 'Swarm skill', 'skill', 'skills/entity-mc/', 0, 'Swarm-adjacent execution runtime'],
    ['plugins-admin', 'plugins', 'Plugin admin', 'doc', 'packages/app/src/stores/pluginStore.ts', 0, 'Plugin UI/state wiring'],
    ['entity-agent-contracts-doc', 'entity-agent-contracts', 'Entity contract spec', 'doc', 'docs/pluggable-agents-modules-spec.md', 1, 'Required onboarding contract reference'],
    ['entity-fs-doc', 'entity-fs', 'Entity FS onboarding spec', 'doc', 'docs/pluggable-agents-modules-spec.md', 1, 'Docs/file delivery reference'],
    ['entity-mc-skill', 'entity-mc', 'Entity MC skill bundle', 'skill', 'skills/entity-mc/', 1, 'Setup-safe Mission Control helper bundle'],
    ['entity-linker-doc', 'entity-linker', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Docs-link integration contract'],
    ['entity-discord-title-hook-doc', 'entity-discord-title-hook', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Admin-only Discord integration reference'],
    ['entity-services-doc', 'entity-services', 'Plugin architecture spec', 'doc', 'docs/PLUGIN-ARCHITECTURE-SPEC.md', 0, 'Admin-only service integration reference'],
    ['geordi-swarm-doc', 'geordi-swarm', 'Geordi Swarm manifest example', 'doc', 'docs/ENTITY-PLUGIN-MANIFEST.example.json', 0, 'Future swarm packaging reference']
  ];
  const insertSkillRef = db.prepare(`
    INSERT OR IGNORE INTO entity_module_skill_refs (
      id, module_id, label, kind, ref, required, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ref of skillRefs) {
    insertSkillRef.run(...ref);
  }

  const moduleIdBySlug = new Map(
    (db.prepare('SELECT id, slug FROM entity_modules').all() as Array<{ id: string; slug: string }>).map((row) => [row.slug, row.id])
  );
  const agentRows = db.prepare('SELECT id, metadata_json FROM entity_agents').all() as Array<{ id: string; metadata_json: string }>;
  const insertGrant = db.prepare(`
    INSERT OR IGNORE INTO entity_agent_module_grants (
      id, agent_id, module_id, enabled, permissions_json, scope_json
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const agent of agentRows) {
    let modulesForAgent: string[] = [];
    try {
      const metadata = JSON.parse(agent.metadata_json || '{}') as { modules?: string[] };
      modulesForAgent = Array.isArray(metadata.modules) ? metadata.modules : [];
    } catch {
      modulesForAgent = [];
    }
    for (const moduleSlug of modulesForAgent) {
      const moduleId = moduleIdBySlug.get(moduleSlug);
      if (!moduleId) continue;
      insertGrant.run(randomUUID(), agent.id, moduleId, 1, '[]', '{}');
    }
  }
}

function ensureTaskSchema(db: Database.Database): void {
  if (!hasColumn(db, 'tasks', 'blocked')) {
    db.exec('ALTER TABLE tasks ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
  }

  if (!hasColumn(db, 'tasks', 'blocker_reason')) {
    db.exec('ALTER TABLE tasks ADD COLUMN blocker_reason TEXT');
  }

  if (!hasColumn(db, 'tasks', 'project')) {
    db.exec("ALTER TABLE tasks ADD COLUMN project TEXT DEFAULT 'General'");
  }
}

function ensureWorkspaceScopeSchema(db: Database.Database): void {
  db.prepare(`
    INSERT OR IGNORE INTO orgs (id, name, slug, status, deployment_mode)
    VALUES (?, ?, ?, 'active', 'saas')
  `).run(DEFAULT_WORKSPACE_ORG_ID, 'Default Workspace', 'default');

  db.prepare(`
    INSERT OR IGNORE INTO teams (id, org_id, name, slug, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(DEFAULT_WORKSPACE_TEAM_ID, DEFAULT_WORKSPACE_ORG_ID, 'Default Team', 'default');

  if (!hasColumn(db, 'tasks', 'org_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN org_id TEXT DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}'`);
  }

  if (!hasColumn(db, 'tasks', 'team_id')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN team_id TEXT DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}'`);
  }

  if (!hasColumn(db, 'tasks', 'project_id')) {
    db.exec('ALTER TABLE tasks ADD COLUMN project_id INTEGER');
  }

  if (!hasColumn(db, 'projects', 'org_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN org_id TEXT DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}'`);
  }

  if (!hasColumn(db, 'projects', 'team_id')) {
    db.exec(`ALTER TABLE projects ADD COLUMN team_id TEXT DEFAULT '${DEFAULT_WORKSPACE_TEAM_ID}'`);
  }

  if (!hasColumn(db, 'projects', 'lifecycle_state')) {
    db.exec("ALTER TABLE projects ADD COLUMN lifecycle_state TEXT DEFAULT 'active'");
  }

  if (!hasColumn(db, 'task_projects', 'org_id')) {
    db.exec(`ALTER TABLE task_projects ADD COLUMN org_id TEXT DEFAULT '${DEFAULT_WORKSPACE_ORG_ID}'`);
  }

  db.exec(`
    UPDATE tasks
    SET org_id = '${DEFAULT_WORKSPACE_ORG_ID}'
    WHERE org_id IS NULL OR trim(org_id) = '';

    UPDATE tasks
    SET team_id = '${DEFAULT_WORKSPACE_TEAM_ID}'
    WHERE team_id IS NULL OR trim(team_id) = '';

    UPDATE projects
    SET org_id = '${DEFAULT_WORKSPACE_ORG_ID}'
    WHERE org_id IS NULL OR trim(org_id) = '';

    UPDATE projects
    SET team_id = '${DEFAULT_WORKSPACE_TEAM_ID}'
    WHERE team_id IS NULL OR trim(team_id) = '';

    UPDATE projects
    SET lifecycle_state = 'active'
    WHERE lifecycle_state IS NULL OR trim(lifecycle_state) = '';

    UPDATE task_projects
    SET org_id = COALESCE(
      (SELECT tasks.org_id FROM tasks WHERE tasks.id = task_projects.task_id),
      '${DEFAULT_WORKSPACE_ORG_ID}'
    )
    WHERE org_id IS NULL OR trim(org_id) = '';

    UPDATE tasks
    SET project_id = (
      SELECT tp.project_id
      FROM task_projects tp
      INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tasks.org_id
      WHERE tp.task_id = tasks.id
      ORDER BY tp.project_id ASC
      LIMIT 1
    )
    WHERE project_id IS NULL;

    CREATE INDEX IF NOT EXISTS idx_tasks_org_updated_at ON tasks(org_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_team_updated_at ON tasks(team_id, updated_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
    CREATE INDEX IF NOT EXISTS idx_projects_org_team ON projects(org_id, team_id, id);
    CREATE INDEX IF NOT EXISTS idx_task_projects_org_task_id ON task_projects(org_id, task_id);
  `);
}

function openEntityDatabase(): Database.Database {
  return getEntityDatabase((db) => {
    bootstrap(db);
    ensureTaskSchema(db);
    ensureWorkspaceScopeSchema(db);
  });
}

function iterateSourceRows(source: Database.Database): IterableIterator<SourceTaskRow> {
  const supportsArchived = hasColumn(source, 'tasks', 'archived');
  const supportsBlocked = hasColumn(source, 'tasks', 'blocked');
  const supportsBlockerReason = hasColumn(source, 'tasks', 'blocker_reason');
  const whereClause = supportsArchived ? 'WHERE archived = 0' : '';

  const query = `
    SELECT
      id,
      name,
      description,
      "column" AS task_column,
      assignee,
      ${supportsBlocked ? 'blocked' : '0 AS blocked'},
      ${supportsBlockerReason ? 'blocker_reason' : 'NULL AS blocker_reason'},
      created_at,
      updated_at
    FROM tasks
    ${whereClause}
    ORDER BY id ASC
  `;

  return source.prepare(query).iterate() as IterableIterator<SourceTaskRow>;
}

let missionControlSeeded = false;

function seedFromMissionControl(target: Database.Database): void {
  if (missionControlSeeded) {
    return;
  }

  const existing = target.prepare('SELECT COUNT(*) AS count FROM tasks').get() as { count: number };
  const sourcePath = resolveMissionControlDbPath();
  if (!fs.existsSync(sourcePath)) {
    missionControlSeeded = true;
    return;
  }

  const source = new Database(sourcePath, { readonly: true });

  try {
    const insert = target.prepare(`
      INSERT OR IGNORE INTO tasks (
        id,
        name,
        description,
        column,
        assignee,
        blocked,
        blocker_reason,
        created_at,
        updated_at,
        metadata
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const backfillBlocked = target.prepare(`
      UPDATE tasks
      SET blocked = 1, blocker_reason = COALESCE(?, blocker_reason)
      WHERE id = ? AND (blocked IS NULL OR blocked = 0)
    `);
    const backfillReason = target.prepare(`
      UPDATE tasks
      SET blocker_reason = ?
      WHERE id = ? AND (blocker_reason IS NULL OR blocker_reason = '')
    `);

    const syncRows = target.transaction((sourceRows: readonly SourceTaskRow[]) => {
      for (const row of sourceRows) {
        const createdAt = normalizeTimestamp(row.created_at);
        const updatedAt = normalizeTimestamp(row.updated_at ?? row.created_at);
        const blocked = normalizeBlocked(row.blocked);
        const blockerReason = normalizeBlockerReason(row.blocker_reason);

        if (existing.count === 0) {
          insert.run(
            row.id,
            row.name,
            row.description,
            normalizeTaskColumn(row.task_column),
            row.assignee ?? 'Unassigned',
            blocked ? 1 : 0,
            blockerReason,
            createdAt,
            updatedAt,
            '{}'
          );
          continue;
        }

        if (blocked) {
          backfillBlocked.run(blockerReason, row.id);
        } else if (blockerReason) {
          backfillReason.run(blockerReason, row.id);
        }
      }
    });

    const batch: SourceTaskRow[] = [];
    const batchSize = 500;
    for (const row of iterateSourceRows(source)) {
      batch.push(row);
      if (batch.length >= batchSize) {
        syncRows(batch);
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      syncRows(batch);
    }
  } finally {
    source.close();
    missionControlSeeded = true;
  }
}

function mapTaskRow(row: Record<string, unknown>): TaskRecord {
  return {
    id: Number(row.id),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    team_id: normalizeWorkspaceId(row.team_id, DEFAULT_WORKSPACE_TEAM_ID),
    project_id: normalizePositiveInteger(row.project_id),
    name: String(row.name ?? ''),
    description: row.description === null ? null : String(row.description ?? ''),
    brief: row.brief === null ? null : String(row.brief ?? ''),
    origin_channel: row.origin_channel === null ? null : String(row.origin_channel ?? ''),
    column: normalizeTaskColumn(String(row.column ?? 'backlog')),
    model: normalizeBlockerReason(row.model),
    archived: normalizeBlocked(row.archived),
    assignee: row.assignee === null ? null : String(row.assignee ?? 'Unassigned'),
    blocked: normalizeBlocked(row.blocked),
    blocker_reason: normalizeBlockerReason(row.blocker_reason),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
    metadata: row.metadata === null ? null : String(row.metadata ?? '{}'),
    project: normalizeBlockerReason(row.project) ?? 'General',
    due_date: normalizeBlockerReason(row.due_date),
    priority:
      row.priority === null ? null : typeof row.priority === 'undefined' ? 'P2' : String(row.priority ?? 'P2'),
    estimate_hours: normalizeNullableNumber(row.estimate_hours),
    time_spent: normalizeNullableNumber(row.time_spent),
    output: normalizeBlockerReason(row.output),
    progress_status:
      row.progress_status === null
        ? null
        : typeof row.progress_status === 'undefined'
          ? 'backlog'
          : String(row.progress_status ?? 'backlog'),
    recurring: normalizeBlocked(row.recurring),
    recurring_config: normalizeBlockerReason(row.recurring_config),
  };
}

function normalizeActivitySource(value: unknown): ActivitySource {
  return value === 'task' ? 'task' : 'agent';
}

function normalizeActivityType(value: unknown): ActivityType {
  if (typeof value !== 'string') {
    return 'message_sent';
  }

  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'file_edit':
    case 'tool_call':
    case 'message_sent':
    case 'command_run':
    case 'research':
    case 'thinking':
    case 'task_created':
    case 'task_updated':
    case 'task_moved':
    case 'task_completed':
    case 'task_deleted':
    case 'task_comment':
      return normalized;
    default:
      return 'message_sent';
  }
}

function mapActivityRow(row: Record<string, unknown>): ActivityRecord {
  const rawTaskId = Number(row.task_id);
  return {
    id: Number(row.id),
    source: normalizeActivitySource(row.source),
    type: normalizeActivityType(row.type),
    action: String(row.action ?? ''),
    description: String(row.description ?? ''),
    agent_name: row.agent_name === null ? null : String(row.agent_name ?? ''),
    agent_emoji: row.agent_emoji === null ? null : String(row.agent_emoji ?? ''),
    file_path: row.file_path === null ? null : String(row.file_path ?? ''),
    task_id: Number.isInteger(rawTaskId) ? rawTaskId : null,
    task_column: row.task_column === null ? null : String(row.task_column ?? ''),
    metadata: row.metadata === null ? null : String(row.metadata ?? ''),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function clampActivityLimit(limit: number): number {
  if (!Number.isInteger(limit)) {
    return 100;
  }

  if (limit < 1) {
    return 1;
  }

  if (limit > 500) {
    return 500;
  }

  return limit;
}

function mapAgentLogRow(row: Record<string, unknown>): AgentLogRecord {
  const rawTaskId = Number(row.task_id);
  const rawTokensUsed = Number(row.tokens_used);
  return {
    id: Number(row.id),
    timestamp: normalizeTimestamp(String(row.timestamp ?? '')),
    event: String(row.event ?? ''),
    task_id: Number.isInteger(rawTaskId) ? rawTaskId : null,
    action: String(row.action ?? ''),
    result: normalizeBlockerReason(row.result),
    model: typeof row.model === 'string' && row.model.trim() ? row.model.trim() : 'gemini-flash',
    tokens_used: Number.isInteger(rawTokensUsed) && rawTokensUsed > 0 ? rawTokensUsed : 0,
  };
}

function clampAgentLogLimit(limit: number): number {
  if (!Number.isInteger(limit)) {
    return 100;
  }

  if (limit < 1) {
    return 1;
  }

  if (limit > 1000) {
    return 1000;
  }

  return limit;
}

function mapTaskCommentRow(row: Record<string, unknown>): TaskCommentRecord {
  const rawTaskId = Number(row.task_id);
  const rawParentId = Number(row.parent_id);
  return {
    id: Number(row.id),
    task_id: Number.isInteger(rawTaskId) ? rawTaskId : 0,
    body: String(row.body ?? ''),
    author: typeof row.author === 'string' && row.author.trim() ? row.author.trim() : 'Human',
    parent_id: Number.isInteger(rawParentId) && rawParentId > 0 ? rawParentId : null,
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function normalizePositiveInteger(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}

function mapRoadmapRow(row: Record<string, unknown>): RoadmapRecord {
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    theme: normalizeBlockerReason(row.theme),
    color: normalizeBlockerReason(row.color),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function mapRoadmapItemRow(row: Record<string, unknown>): RoadmapItemRecord {
  const rawRoadmapId = Number(row.roadmap_id);
  return {
    id: Number(row.id),
    roadmap_id: Number.isInteger(rawRoadmapId) ? rawRoadmapId : 0,
    title: String(row.title ?? ''),
    description: normalizeBlockerReason(row.description),
    priority: typeof row.priority === 'string' && row.priority.trim() ? row.priority.trim() : 'P2',
    target_period: normalizeBlockerReason(row.target_period),
    status: typeof row.status === 'string' && row.status.trim() ? row.status.trim() : 'planned',
    linked_task_id: normalizePositiveInteger(row.linked_task_id),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function mapProjectRow(row: Record<string, unknown>): ProjectRecord {
  return {
    id: Number(row.id),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    team_id: normalizeWorkspaceId(row.team_id, DEFAULT_WORKSPACE_TEAM_ID),
    name: String(row.name ?? ''),
    color: normalizeBlockerReason(row.color),
    lifecycle_state: normalizeBlockerReason(row.lifecycle_state) ?? 'active',
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
  };
}

function mapOrgRow(row: Record<string, unknown>): OrgRecord {
  return {
    id: normalizeWorkspaceId(row.id),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    status: String(row.status ?? 'active'),
    deployment_mode: String(row.deployment_mode ?? 'saas'),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}

function mapTeamRow(row: Record<string, unknown>): TeamRecord {
  return {
    id: normalizeWorkspaceId(row.id),
    org_id: normalizeWorkspaceId(row.org_id, DEFAULT_WORKSPACE_ORG_ID),
    name: String(row.name ?? ''),
    slug: String(row.slug ?? ''),
    status: String(row.status ?? 'active'),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}

function mapCrewRow(row: Record<string, unknown>): CrewRecord {
  return {
    id: typeof row.id === 'string' ? row.id : String(row.id ?? ''),
    name: String(row.name ?? ''),
    description: normalizeBlockerReason(row.description),
    settings: normalizeBlockerReason(row.settings),
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? row.created_at ?? '')),
  };
}


function mapCrewSubscriptionRow(row: Record<string, unknown>): CrewSubscriptionRecord {
  return {
    id: Number(row.id),
    crew_id: String(row.crew_id ?? ""),
    agent_id: String(row.agent_id ?? ""),
    created_at: normalizeTimestamp(String(row.created_at ?? "")),
  };
}

function loadProjectsByTaskIds(db: Database.Database, taskIds: readonly number[]): Map<number, ProjectRecord[]> {
  const normalizedTaskIds = Array.from(
    new Set(taskIds.map((taskId) => normalizePositiveInteger(taskId)).filter((taskId): taskId is number => Boolean(taskId)))
  );

  if (normalizedTaskIds.length === 0) {
    return new Map();
  }

  const placeholders = normalizedTaskIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT
      tp.task_id,
      p.id,
      p.org_id,
      p.team_id,
      p.name,
      p.color,
      p.lifecycle_state,
      p.created_at
    FROM task_projects tp
    INNER JOIN projects p ON p.id = tp.project_id
    WHERE tp.task_id IN (${placeholders})
    ORDER BY tp.task_id ASC, p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const rows = stmt.all(...normalizedTaskIds) as Array<Record<string, unknown>>;
  const projectsByTaskId = new Map<number, ProjectRecord[]>();

  for (const row of rows) {
    const taskId = normalizePositiveInteger(row.task_id);
    if (!taskId) {
      continue;
    }

    const current = projectsByTaskId.get(taskId);
    const nextProject = mapProjectRow(row);
    if (current) {
      current.push(nextProject);
      continue;
    }

    projectsByTaskId.set(taskId, [nextProject]);
  }

  return projectsByTaskId;
}

function attachProjectsToTasks(db: Database.Database, tasks: TaskRecord[]): TaskRecord[] {
  if (tasks.length === 0) {
    return tasks;
  }

  const projectsByTaskId = loadProjectsByTaskIds(
    db,
    tasks.map((task) => task.id)
  );

  return tasks.map((task) => ({
    ...task,
    projects: projectsByTaskId.get(task.id) ?? [],
  }));
}

function loadProjectsByTaskIdsForOrg(
  db: Database.Database,
  orgId: string,
  taskIds: readonly number[]
): Map<number, ProjectRecord[]> {
  const normalizedTaskIds = Array.from(
    new Set(taskIds.map((taskId) => normalizePositiveInteger(taskId)).filter((taskId): taskId is number => Boolean(taskId)))
  );

  if (normalizedTaskIds.length === 0) {
    return new Map();
  }

  const placeholders = normalizedTaskIds.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT
      tp.task_id,
      p.id,
      p.org_id,
      p.team_id,
      p.name,
      p.color,
      p.lifecycle_state,
      p.created_at
    FROM task_projects tp
    INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
    WHERE tp.task_id IN (${placeholders})
      AND tp.org_id = ?
      AND p.org_id = ?
    ORDER BY tp.task_id ASC, p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const rows = stmt.all(...normalizedTaskIds, orgId, orgId) as Array<Record<string, unknown>>;
  const projectsByTaskId = new Map<number, ProjectRecord[]>();

  for (const row of rows) {
    const taskId = normalizePositiveInteger(row.task_id);
    if (!taskId) {
      continue;
    }

    const current = projectsByTaskId.get(taskId);
    const nextProject = mapProjectRow(row);
    if (current) {
      current.push(nextProject);
      continue;
    }

    projectsByTaskId.set(taskId, [nextProject]);
  }

  return projectsByTaskId;
}

function attachProjectsToTasksForOrg(db: Database.Database, orgId: string, tasks: TaskRecord[]): TaskRecord[] {
  if (tasks.length === 0) {
    return tasks;
  }

  const projectsByTaskId = loadProjectsByTaskIdsForOrg(
    db,
    orgId,
    tasks.map((task) => task.id)
  );

  return tasks.map((task) => ({
    ...task,
    projects: projectsByTaskId.get(task.id) ?? [],
  }));
}

function mapTaskHistoryRow(row: Record<string, unknown>): TaskHistoryRecord {
  const rawTaskId = Number(row.task_id);
  return {
    id: Number(row.id),
    task_id: Number.isInteger(rawTaskId) ? rawTaskId : 0,
    field: String(row.field ?? ''),
    old_value: normalizeBlockerReason(row.old_value),
    new_value: normalizeBlockerReason(row.new_value),
    changed_by: normalizeBlockerReason(row.changed_by),
    changed_at: normalizeTimestamp(String(row.changed_at ?? '')),
  };
}


function mapAgentRegistryRow(row: Record<string, unknown>): AgentRegistryRecord {
  return {
    id: String(row.id ?? ''),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    emoji: String(row.emoji ?? ''),
    avatar_url: typeof row.avatar_url === 'string' ? row.avatar_url : null,
    description: typeof row.description === 'string' ? row.description : null,
    adapter_type: typeof row.adapter_type === 'string' ? row.adapter_type : null,
    runtime_type: typeof row.runtime_type === 'string' ? row.runtime_type : null,
    status: String(row.status ?? 'active'),
    instructions_path: typeof row.instructions_path === 'string' ? row.instructions_path : null,
    metadata_json: typeof row.metadata_json === 'string' ? row.metadata_json : '{}',
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? '')),
  };
}

function mapModuleRegistryRow(row: Record<string, unknown>): ModuleRegistryRecord {
  return {
    id: String(row.id ?? ''),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    description: typeof row.description === 'string' ? row.description : null,
    enabled: Number(row.enabled ?? 0) === 1,
    icon: typeof row.icon === 'string' ? row.icon : null,
    kind: String(row.kind ?? 'core'),
    permissions_schema_json: typeof row.permissions_schema_json === 'string' ? row.permissions_schema_json : '[]',
    ui_config_json: typeof row.ui_config_json === 'string' ? row.ui_config_json : '{}',
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? '')),
  };
}

function mapAgentModuleGrantRow(row: Record<string, unknown>): AgentModuleGrantRecord {
  return {
    id: String(row.id ?? ''),
    agent_id: String(row.agent_id ?? ''),
    module_id: String(row.module_id ?? ''),
    enabled: Number(row.enabled ?? 0) === 1,
    permissions_json: typeof row.permissions_json === 'string' ? row.permissions_json : '[]',
    scope_json: typeof row.scope_json === 'string' ? row.scope_json : '{}',
    created_at: normalizeTimestamp(String(row.created_at ?? '')),
    updated_at: normalizeTimestamp(String(row.updated_at ?? '')),
  };
}

function mapModuleSkillRefRow(row: Record<string, unknown>): ModuleSkillRefRecord {
  return {
    id: String(row.id ?? ''),
    module_id: String(row.module_id ?? ''),
    label: String(row.label ?? ''),
    kind: String(row.kind ?? ''),
    ref: String(row.ref ?? ''),
    required: Number(row.required ?? 0) === 1,
    notes: typeof row.notes === 'string' ? row.notes : null,
  };
}

export function createAgentRegistryRepository(): AgentRegistryRepository {
  const db = openEntityDatabase();
  const listStmt = db.prepare('SELECT * FROM entity_agents ORDER BY name COLLATE NOCASE ASC');
  const getStmt = db.prepare('SELECT * FROM entity_agents WHERE id = ?');
  const getBySlugStmt = db.prepare('SELECT * FROM entity_agents WHERE slug = ?');
  const deleteAgentStmt = db.prepare('DELETE FROM entity_agents WHERE id = ?');
  const deleteAgentGrantsStmt = db.prepare('DELETE FROM entity_agent_module_grants WHERE agent_id = ?');
  const createStmt = db.prepare(`
    INSERT INTO entity_agents (
      id, slug, name, emoji, avatar_url, description, adapter_type, runtime_type, status, instructions_path, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  return {
    listAgents: () => (listStmt.all() as Array<Record<string, unknown>>).map(mapAgentRegistryRow),
    getAgent: (id: string) => {
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapAgentRegistryRow(row) : undefined;
    },
    getAgentBySlug: (slug: string) => {
      const row = getBySlugStmt.get(slug) as Record<string, unknown> | undefined;
      return row ? mapAgentRegistryRow(row) : undefined;
    },
    createAgent: (input: CreateAgentRegistryInput) => {
      const id = input.id?.trim() || randomUUID();
      createStmt.run(
        id,
        input.slug.trim().toLowerCase(),
        input.name.trim(),
        input.emoji.trim(),
        input.avatar_url?.trim() || null,
        input.description?.trim() || null,
        input.adapter_type?.trim() || null,
        input.runtime_type?.trim() || null,
        input.status?.trim() || 'active',
        input.instructions_path?.trim() || null,
        input.metadata_json?.trim() || '{}'
      );
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to create entity agent');
      return mapAgentRegistryRow(row);
    },
    updateAgent: (id: string, updates: UpdateAgentRegistryInput) => {
      const fields: string[] = [];
      const values: unknown[] = [];
      if (typeof updates.slug === 'string') { fields.push('slug = ?'); values.push(updates.slug.trim().toLowerCase()); }
      if (typeof updates.name === 'string') { fields.push('name = ?'); values.push(updates.name.trim()); }
      if (typeof updates.emoji === 'string') { fields.push('emoji = ?'); values.push(updates.emoji.trim()); }
      if (updates.avatar_url !== undefined) { fields.push('avatar_url = ?'); values.push(typeof updates.avatar_url === 'string' ? updates.avatar_url.trim() || null : null); }
      if (updates.description !== undefined) { fields.push('description = ?'); values.push(typeof updates.description === 'string' ? updates.description.trim() || null : null); }
      if (updates.adapter_type !== undefined) { fields.push('adapter_type = ?'); values.push(typeof updates.adapter_type === 'string' ? updates.adapter_type.trim() || null : null); }
      if (updates.runtime_type !== undefined) { fields.push('runtime_type = ?'); values.push(typeof updates.runtime_type === 'string' ? updates.runtime_type.trim() || null : null); }
      if (typeof updates.status === 'string') { fields.push('status = ?'); values.push(updates.status.trim() || 'active'); }
      if (typeof updates.instructions_path === 'string') { fields.push('instructions_path = ?'); values.push(updates.instructions_path.trim() || null); }
      if (typeof updates.metadata_json === 'string') { fields.push('metadata_json = ?'); values.push(updates.metadata_json.trim() || '{}'); }
      if (fields.length === 0) {
        const row = getStmt.get(id) as Record<string, unknown> | undefined;
        return row ? mapAgentRegistryRow(row) : undefined;
      }
      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      db.prepare(`UPDATE entity_agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      return row ? mapAgentRegistryRow(row) : undefined;
    },
    deleteAgent: (id: string): boolean => {
      const transaction = db.transaction((agentId: string) => {
        deleteAgentGrantsStmt.run(agentId);
        return deleteAgentStmt.run(agentId).changes > 0;
      });
      return transaction(id);
    },
  };
}

export function createModuleRegistryRepository(): ModuleRegistryRepository {
  const db = openEntityDatabase();
  const listModulesStmt = db.prepare('SELECT * FROM entity_modules ORDER BY name COLLATE NOCASE ASC');
  const listSkillsStmt = db.prepare('SELECT * FROM entity_module_skill_refs WHERE module_id = ? ORDER BY required DESC, label COLLATE NOCASE ASC');
  const listGrantsStmt = db.prepare('SELECT * FROM entity_agent_module_grants WHERE agent_id = ? ORDER BY module_id ASC');
  const getGrantStmt = db.prepare('SELECT * FROM entity_agent_module_grants WHERE agent_id = ? AND module_id = ?');
  const upsertGrantStmt = db.prepare(`
    INSERT INTO entity_agent_module_grants (id, agent_id, module_id, enabled, permissions_json, scope_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(agent_id, module_id) DO UPDATE SET
      enabled = excluded.enabled,
      permissions_json = excluded.permissions_json,
      scope_json = excluded.scope_json,
      updated_at = CURRENT_TIMESTAMP
  `);
  const deleteGrantStmt = db.prepare('DELETE FROM entity_agent_module_grants WHERE agent_id = ? AND module_id = ?');
  return {
    listModules: (): ModuleRegistryRecord[] => (listModulesStmt.all() as Array<Record<string, unknown>>).map(mapModuleRegistryRow),
    listModuleSkillRefs: (moduleId: string): ModuleSkillRefRecord[] => (listSkillsStmt.all(moduleId) as Array<Record<string, unknown>>).map(mapModuleSkillRefRow),
    listAgentModuleGrants: (agentId: string): AgentModuleGrantRecord[] => (listGrantsStmt.all(agentId) as Array<Record<string, unknown>>).map(mapAgentModuleGrantRow),
    upsertAgentModuleGrant: (input: UpsertAgentModuleGrantInput): AgentModuleGrantRecord => {
      upsertGrantStmt.run(
        randomUUID(),
        input.agent_id,
        input.module_id,
        input.enabled === false ? 0 : 1,
        input.permissions_json?.trim() || '[]',
        input.scope_json?.trim() || '{}'
      );
      const row = getGrantStmt.get(input.agent_id, input.module_id) as Record<string, unknown> | undefined;
      if (!row) throw new Error('Failed to upsert entity agent module grant');
      return mapAgentModuleGrantRow(row);
    },
    deleteAgentModuleGrant: (agentId: string, moduleId: string): boolean => {
      const result = deleteGrantStmt.run(agentId, moduleId);
      return result.changes > 0;
    },
  };
}

export function createTaskRepository(): TaskRepository {
  const db = openEntityDatabase();
  seedFromMissionControl(db);

  const listStmt = db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC, id DESC');
  const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const createStmt = db.prepare(`
    INSERT INTO tasks (
      org_id,
      team_id,
      project_id,
      name,
      description,
      brief,
      origin_channel,
      column,
      model,
      archived,
      assignee,
      blocked,
      blocker_reason,
      project,
      due_date,
      priority,
      estimate_hours,
      time_spent,
      output,
      progress_status,
      recurring,
      recurring_config,
      metadata,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ?');

  return {
    listTasks: () => {
      const rows = listStmt.all() as Array<Record<string, unknown>>;
      return attachProjectsToTasks(db, rows.map(mapTaskRow));
    },

    getTask: (id: number) => {
      const row = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }

      const [task] = attachProjectsToTasks(db, [mapTaskRow(row)]);
      return task;
    },

    createTask: (input: CreateTaskInput) => {
      const taskName = input.name.trim();
      const priority = typeof input.priority === 'string' && input.priority.trim() ? input.priority.trim() : 'P2';
      const progressStatus =
        typeof input.progress_status === 'string' && input.progress_status.trim()
          ? input.progress_status.trim()
          : 'backlog';
      const estimateHours = normalizeNullableNumber(input.estimate_hours);
      const timeSpent = normalizeNullableNumber(input.time_spent);
      const result = createStmt.run(
        normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
        normalizeWorkspaceId(input.team_id, DEFAULT_WORKSPACE_TEAM_ID),
        normalizePositiveInteger(input.project_id),
        taskName,
        input.description?.trim() || null,
        input.brief?.trim() || null,
        input.origin_channel?.trim() || null,
        normalizeTaskColumn(input.column),
        typeof input.model === 'string' ? input.model.trim() || null : null,
        normalizeBlocked(input.archived) ? 1 : 0,
        input.assignee?.trim() || 'Unassigned',
        normalizeBlocked(input.blocked) ? 1 : 0,
        normalizeBlockerReason(input.blocker_reason),
        normalizeBlockerReason(input.project) ?? 'General',
        normalizeBlockerReason(input.due_date),
        priority,
        estimateHours,
        timeSpent === null ? 0 : timeSpent,
        typeof input.output === 'string' ? input.output.trim() || null : null,
        progressStatus,
        normalizeBlocked(input.recurring) ? 1 : 0,
        typeof input.recurring_config === 'string' ? input.recurring_config.trim() || null : null,
        input.metadata?.trim() || '{}'
      );

      const task = getStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!task) {
        throw new Error('Failed to create task');
      }

      const [createdTask] = attachProjectsToTasks(db, [mapTaskRow(task)]);
      return createdTask;
    },

    updateTask: (id: number, updates: UpdateTaskInput) => {
      const existingTask = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!existingTask) {
        return undefined;
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      if (typeof updates.name === 'string') {
        fields.push('name = ?');
        values.push(updates.name.trim());
      }

      if (typeof updates.description === 'string') {
        fields.push('description = ?');
        values.push(updates.description.trim() || null);
      }

      if (typeof updates.brief === 'string') {
        fields.push('brief = ?');
        values.push(updates.brief.trim() || null);
      }

      if (typeof updates.origin_channel === 'string') {
        fields.push('origin_channel = ?');
        values.push(updates.origin_channel.trim() || null);
      }

      if (typeof updates.column === 'string') {
        fields.push('column = ?');
        values.push(normalizeTaskColumn(updates.column));
      }

      if (typeof updates.model === 'string') {
        fields.push('model = ?');
        values.push(updates.model.trim() || null);
      }

      if (typeof updates.archived !== 'undefined') {
        fields.push('archived = ?');
        values.push(normalizeBlocked(updates.archived) ? 1 : 0);
      }

      if (typeof updates.assignee === 'string') {
        fields.push('assignee = ?');
        values.push(updates.assignee.trim() || 'Unassigned');
      }

      if (typeof updates.blocked !== 'undefined') {
        fields.push('blocked = ?');
        values.push(normalizeBlocked(updates.blocked) ? 1 : 0);
      }

      if (typeof updates.blocker_reason === 'string') {
        fields.push('blocker_reason = ?');
        values.push(normalizeBlockerReason(updates.blocker_reason));
      }

      if (typeof updates.project === 'string') {
        fields.push('project = ?');
        values.push(normalizeBlockerReason(updates.project) ?? 'General');
      }

      if (typeof updates.due_date === 'string') {
        fields.push('due_date = ?');
        values.push(normalizeBlockerReason(updates.due_date));
      }

      if (typeof updates.priority === 'string') {
        fields.push('priority = ?');
        values.push(updates.priority.trim() || 'P2');
      }

      if (typeof updates.estimate_hours !== 'undefined') {
        fields.push('estimate_hours = ?');
        values.push(normalizeNullableNumber(updates.estimate_hours));
      }

      if (typeof updates.time_spent !== 'undefined') {
        fields.push('time_spent = ?');
        const normalized = normalizeNullableNumber(updates.time_spent);
        values.push(normalized === null ? 0 : normalized);
      }

      if (typeof updates.output === 'string') {
        fields.push('output = ?');
        values.push(updates.output.trim() || null);
      }

      if (typeof updates.progress_status === 'string') {
        fields.push('progress_status = ?');
        values.push(updates.progress_status.trim() || 'backlog');
      }

      if (typeof updates.recurring !== 'undefined') {
        fields.push('recurring = ?');
        values.push(normalizeBlocked(updates.recurring) ? 1 : 0);
      }

      if (typeof updates.recurring_config === 'string') {
        fields.push('recurring_config = ?');
        values.push(updates.recurring_config.trim() || null);
      }

      if (typeof updates.metadata === 'string') {
        fields.push('metadata = ?');
        values.push(updates.metadata.trim() || '{}');
      }

      if (typeof updates.org_id === 'string') {
        fields.push('org_id = ?');
        values.push(normalizeWorkspaceId(updates.org_id, DEFAULT_WORKSPACE_ORG_ID));
      }

      if (typeof updates.team_id === 'string') {
        fields.push('team_id = ?');
        values.push(normalizeWorkspaceId(updates.team_id, DEFAULT_WORKSPACE_TEAM_ID));
      }

      if (typeof updates.project_id !== 'undefined') {
        fields.push('project_id = ?');
        values.push(normalizePositiveInteger(updates.project_id));
      }

      if (fields.length === 0) {
        return mapTaskRow(existingTask);
      }

      fields.push('updated_at = CURRENT_TIMESTAMP');
      values.push(id);
      db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const refreshed = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!refreshed) {
        return undefined;
      }

      const [updatedTask] = attachProjectsToTasks(db, [mapTaskRow(refreshed)]);
      return updatedTask;
    },

    moveTask: (id: number, nextColumn: string) => {
      const normalizedColumn = normalizeTaskColumn(nextColumn);
      db.prepare('UPDATE tasks SET column = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(normalizedColumn, id);
      const refreshed = getStmt.get(id) as Record<string, unknown> | undefined;
      if (!refreshed) {
        return undefined;
      }

      const [movedTask] = attachProjectsToTasks(db, [mapTaskRow(refreshed)]);
      return movedTask;
    },

    deleteTask: (id: number) => {
      const result = deleteStmt.run(id);
      return result.changes > 0;
    },
  };
}

export function createOrgScopedTaskRepository(context: OrgQueryContext): OrgScopedTaskRepository {
  const { orgId, teamId } = normalizeOrgQueryContext(context);
  const db = openEntityDatabase();
  seedFromMissionControl(db);
  const legacyRepository = createTaskRepository();

  const listStmt = db.prepare('SELECT * FROM tasks WHERE org_id = ? ORDER BY updated_at DESC, id DESC');
  const getStmt = db.prepare('SELECT * FROM tasks WHERE id = ? AND org_id = ?');
  const projectInOrgStmt = db.prepare('SELECT id FROM projects WHERE id = ? AND org_id = ?');
  const deleteStmt = db.prepare('DELETE FROM tasks WHERE id = ? AND org_id = ?');

  function assertProjectInOrg(projectId: number | null): void {
    if (!projectId) {
      return;
    }
    const project = projectInOrgStmt.get(projectId, orgId) as { id: number } | undefined;
    if (!project) {
      throw new Error('project not found in org context');
    }
  }

  return {
    orgId,
    teamId,

    listTasks: () => {
      const rows = listStmt.all(orgId) as Array<Record<string, unknown>>;
      return attachProjectsToTasksForOrg(db, orgId, rows.map(mapTaskRow));
    },

    getTask: (id: number) => {
      const row = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }

      const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(row)]);
      return task;
    },

    createTask: (input: CreateTaskInput) => {
      const projectId = normalizePositiveInteger(input.project_id);
      assertProjectInOrg(projectId);
      const created = legacyRepository.createTask({
        ...input,
        org_id: orgId,
        team_id: normalizeWorkspaceId(input.team_id, teamId),
        project_id: projectId,
      });
      const scopedTask = getStmt.get(created.id, orgId) as Record<string, unknown> | undefined;
      if (!scopedTask) {
        throw new Error('Failed to create org-scoped task');
      }

      const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(scopedTask)]);
      return task;
    },

    updateTask: (id: number, updates: UpdateTaskInput) => {
      const existing = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      const projectId = typeof updates.project_id === 'undefined'
        ? undefined
        : normalizePositiveInteger(updates.project_id);
      if (typeof projectId !== 'undefined') {
        assertProjectInOrg(projectId);
      }

      const updated = legacyRepository.updateTask(id, {
        ...updates,
        org_id: orgId,
        team_id: typeof updates.team_id === 'string' ? updates.team_id : teamId,
        project_id: typeof projectId === 'undefined' ? updates.project_id : projectId,
      });
      if (!updated) {
        return undefined;
      }

      const row = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }

      const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(row)]);
      return task;
    },

    moveTask: (id: number, nextColumn: string) => {
      const existing = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      legacyRepository.moveTask(id, nextColumn);
      const row = getStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        return undefined;
      }

      const [task] = attachProjectsToTasksForOrg(db, orgId, [mapTaskRow(row)]);
      return task;
    },

    deleteTask: (id: number) => {
      const result = deleteStmt.run(id, orgId);
      return result.changes > 0;
    },
  };
}

export function createWorkspaceScopeRepository(): WorkspaceScopeRepository {
  const db = openEntityDatabase();
  const listOrgsStmt = db.prepare('SELECT * FROM orgs ORDER BY name COLLATE NOCASE ASC, id ASC');
  const createOrgStmt = db.prepare(`
    INSERT INTO orgs (
      id,
      name,
      slug,
      status,
      deployment_mode,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const getOrgStmt = db.prepare('SELECT * FROM orgs WHERE id = ?');
  const listTeamsStmt = db.prepare(`
    SELECT * FROM teams
    WHERE org_id = ?
    ORDER BY name COLLATE NOCASE ASC, id ASC
  `);
  const createTeamStmt = db.prepare(`
    INSERT INTO teams (
      id,
      org_id,
      name,
      slug,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);
  const getTeamStmt = db.prepare('SELECT * FROM teams WHERE id = ? AND org_id = ?');
  const listProjectsStmt = db.prepare(`
    SELECT * FROM projects
    WHERE org_id = ? AND (? IS NULL OR team_id = ?)
    ORDER BY datetime(created_at) DESC, id DESC
  `);
  const createProjectStmt = db.prepare(`
    INSERT INTO projects (
      org_id,
      team_id,
      name,
      color,
      lifecycle_state,
      created_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?');
  const getTaskInOrgStmt = db.prepare('SELECT id FROM tasks WHERE id = ? AND org_id = ?');
  const listTaskProjectsStmt = db.prepare(`
    SELECT
      p.id,
      p.org_id,
      p.team_id,
      p.name,
      p.color,
      p.lifecycle_state,
      p.created_at
    FROM task_projects tp
    INNER JOIN projects p ON p.id = tp.project_id AND p.org_id = tp.org_id
    WHERE tp.task_id = ?
      AND tp.org_id = ?
    ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const addTaskProjectStmt = db.prepare(`
    INSERT OR IGNORE INTO task_projects (task_id, org_id, project_id)
    SELECT t.id, ?, p.id
    FROM tasks t
    INNER JOIN projects p ON p.id = ? AND p.org_id = ?
    WHERE t.id = ? AND t.org_id = ?
  `);
  const removeTaskProjectStmt = db.prepare(`
    DELETE FROM task_projects
    WHERE task_id = ? AND project_id = ? AND org_id = ?
  `);

  return {
    listOrgs: () => {
      const rows = listOrgsStmt.all() as Array<Record<string, unknown>>;
      return rows.map(mapOrgRow);
    },

    createOrg: (input: CreateOrgInput) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('org name is required');
      }

      const id = normalizeWorkspaceId(input.id, randomUUID());
      createOrgStmt.run(
        id,
        name,
        normalizeSlug(input.slug, name),
        normalizeBlockerReason(input.status) ?? 'active',
        normalizeBlockerReason(input.deployment_mode) ?? 'saas'
      );
      const row = getOrgStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create org');
      }

      return mapOrgRow(row);
    },

    listTeams: (context: OrgQueryContext) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const rows = listTeamsStmt.all(orgId) as Array<Record<string, unknown>>;
      return rows.map(mapTeamRow);
    },

    createTeam: (context: OrgQueryContext, input: CreateTeamInput) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const name = input.name.trim();
      if (!name) {
        throw new Error('team name is required');
      }

      const id = normalizeWorkspaceId(input.id, randomUUID());
      createTeamStmt.run(
        id,
        orgId,
        name,
        normalizeSlug(input.slug, name),
        normalizeBlockerReason(input.status) ?? 'active'
      );
      const row = getTeamStmt.get(id, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create team');
      }

      return mapTeamRow(row);
    },

    listProjects: (context: OrgQueryContext) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const rows = listProjectsStmt.all(orgId, teamId ?? null, teamId ?? null) as Array<Record<string, unknown>>;
      return rows.map(mapProjectRow);
    },

    createProject: (context: OrgQueryContext, input: CreateProjectInput) => {
      const { orgId, teamId } = normalizeOrgQueryContext(context);
      const name = input.name.trim();
      if (!name) {
        throw new Error('project name is required');
      }

      const lifecycleState = normalizeBlockerReason(input.lifecycle_state) ?? 'active';
      const result = createProjectStmt.run(
        orgId,
        normalizeWorkspaceId(input.team_id, teamId),
        name,
        normalizeBlockerReason(input.color),
        lifecycleState
      );
      const row = getProjectStmt.get(result.lastInsertRowid as number, orgId) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create project');
      }

      return mapProjectRow(row);
    },

    getTaskProjects: (context: OrgQueryContext, taskId: number) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const task = getTaskInOrgStmt.get(safeTaskId, orgId) as { id: number } | undefined;
      if (!task) {
        return [];
      }

      const rows = listTaskProjectsStmt.all(safeTaskId, orgId) as Array<Record<string, unknown>>;
      return rows.map(mapProjectRow);
    },

    addTaskProject: (context: OrgQueryContext, taskId: number, projectId: number) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = addTaskProjectStmt.run(orgId, safeProjectId, orgId, safeTaskId, orgId);
      return result.changes > 0;
    },

    removeTaskProject: (context: OrgQueryContext, taskId: number, projectId: number) => {
      const { orgId } = normalizeOrgQueryContext(context);
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = removeTaskProjectStmt.run(safeTaskId, safeProjectId, orgId);
      return result.changes > 0;
    },
  };
}

export function createActivityRepository(): ActivityRepository {
  const db = openEntityDatabase();

  const listStmt = db.prepare(`
    SELECT
      id,
      source,
      type,
      action,
      description,
      agent_name,
      agent_emoji,
      file_path,
      task_id,
      task_column,
      metadata,
      created_at
    FROM activities
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `);

  const listByTaskStmt = db.prepare(`
    SELECT * FROM activities
    WHERE task_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `);

  const createStmt = db.prepare(`
    INSERT INTO activities (
      source,
      type,
      action,
      description,
      agent_name,
      agent_emoji,
      file_path,
      task_id,
      task_column,
      metadata,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const getStmt = db.prepare('SELECT * FROM activities WHERE id = ?');

  return {
    listActivities: (limit = 100) => {
      const safeLimit = clampActivityLimit(limit);
      const rows = listStmt.all(safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapActivityRow);
    },

    listActivitiesByTaskId: (taskId: number, limit = 100) => {
      if (!Number.isInteger(taskId) || taskId < 1) {
        return [];
      }

      const safeLimit = clampActivityLimit(limit);
      const rows = listByTaskStmt.all(taskId, safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapActivityRow);
    },

    createActivity: (input: CreateActivityInput) => {
      const action = input.action.trim();
      const description = input.description.trim();
      if (!action || !description) {
        throw new Error('activity action and description are required');
      }

      const result = createStmt.run(
        input.source ?? 'agent',
        input.type,
        action,
        description,
        input.agent_name?.trim() || null,
        input.agent_emoji?.trim() || null,
        input.file_path?.trim() || null,
        typeof input.task_id === 'number' && Number.isInteger(input.task_id) ? input.task_id : null,
        input.task_column?.trim() || null,
        input.metadata?.trim() || null
      );

      const row = getStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create activity');
      }

      return mapActivityRow(row);
    },
  };
}

export function createAgentLogRepository(): AgentLogRepository {
  const db = openEntityDatabase();

  const listStmt = db.prepare(`
    SELECT
      id,
      timestamp,
      event,
      task_id,
      action,
      result,
      model,
      tokens_used
    FROM agent_log
    ORDER BY datetime(timestamp) DESC, id DESC
    LIMIT ?
  `);

  const createStmt = db.prepare(`
    INSERT INTO agent_log (
      event,
      task_id,
      action,
      result,
      model,
      tokens_used,
      timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);

  const getStmt = db.prepare('SELECT * FROM agent_log WHERE id = ?');
  const statusStmt = db.prepare(`
    SELECT
      COUNT(*) AS total_actions,
      MAX(timestamp) AS last_run
    FROM agent_log
  `);

  return {
    listLogs: (limit = 100) => {
      const safeLimit = clampAgentLogLimit(limit);
      const rows = listStmt.all(safeLimit) as Array<Record<string, unknown>>;
      return rows.map(mapAgentLogRow);
    },

    createLog: (input: CreateAgentLogInput) => {
      const event = input.event.trim();
      const action = input.action.trim();
      if (!event) {
        throw new Error('agent log event is required');
      }

      if (!action) {
        throw new Error('agent log action is required');
      }

      const rawTokensUsed = Number(input.tokens_used);
      const normalizedTokensUsed = Number.isFinite(rawTokensUsed) && rawTokensUsed > 0 ? Math.floor(rawTokensUsed) : 0;
      const taskId = typeof input.task_id === 'number' && Number.isInteger(input.task_id) ? input.task_id : null;
      const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : 'gemini-flash';
      const resultText =
        typeof input.result === 'string'
          ? input.result.trim() || null
          : input.result === null
            ? null
            : null;

      const createResult = createStmt.run(event, taskId, action, resultText, model, normalizedTokensUsed);
      const row = getStmt.get(createResult.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create agent log');
      }

      return mapAgentLogRow(row);
    },

    getStatus: () => {
      const row = statusStmt.get() as { total_actions?: number; last_run?: string | null } | undefined;
      const totalActions =
        row && typeof row.total_actions === 'number' && Number.isFinite(row.total_actions) ? row.total_actions : 0;
      const lastRun = row?.last_run ? normalizeTimestamp(String(row.last_run)) : null;
      return { lastRun, totalActions };
    },
  };
}

export function createTaskCommentRepository(): TaskCommentRepository {
  const db = openEntityDatabase();

  const listStmt = db.prepare(
    'SELECT * FROM task_comments WHERE task_id = ? ORDER BY datetime(created_at) ASC, id ASC'
  );
  const createStmt = db.prepare(`
    INSERT INTO task_comments (
      task_id,
      body,
      author,
      parent_id
    ) VALUES (?, ?, ?, ?)
  `);
  const getStmt = db.prepare('SELECT * FROM task_comments WHERE id = ?');

  return {
    listComments: (taskId: number) => {
      const rows = listStmt.all(taskId) as Array<Record<string, unknown>>;
      return rows.map(mapTaskCommentRow);
    },

    createComment: (input: CreateTaskCommentInput) => {
      const taskId = input.task_id;
      if (!Number.isInteger(taskId) || taskId <= 0) {
        throw new Error('task_id must be a positive integer');
      }

      const body = input.body.trim();
      if (!body) {
        throw new Error('comment body is required');
      }

      const author = typeof input.author === 'string' && input.author.trim() ? input.author.trim() : 'Human';
      const parentId =
        typeof input.parent_id === 'number' && Number.isInteger(input.parent_id) && input.parent_id > 0
          ? input.parent_id
          : null;

      const result = createStmt.run(taskId, body, author, parentId);
      const row = getStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create task comment');
      }

      return mapTaskCommentRow(row);
    },
  };
}

interface StrategicRepository {
  getRoadmaps: () => RoadmapWithItemsRecord[];
  createRoadmap: (input: CreateRoadmapInput) => RoadmapRecord;
  deleteRoadmap: (id: number) => boolean;
  createRoadmapItem: (roadmapId: number, input: CreateRoadmapItemInput) => RoadmapItemRecord;
  updateRoadmapItem: (id: number, input: UpdateRoadmapItemInput) => RoadmapItemRecord | undefined;
  deleteRoadmapItem: (id: number) => boolean;
  getProjects: () => ProjectRecord[];
  createProject: (input: CreateProjectInput) => ProjectRecord;
  deleteProject: (id: number) => boolean;
  getCrews: () => CrewRecord[];
  getSubscribedCrews: (agentSlug: string) => CrewRecord[];
  createCrew: (input: CreateCrewInput) => CrewRecord;
  subscribeToCrew: (crewId: string, agentId: string) => CrewSubscriptionRecord;
  unsubscribeFromCrew: (crewId: string, agentId: string) => boolean;
  getSubscribersForCrew: (crewId: string) => CrewSubscriptionRecord[];
  getSubscriptionsForAgent: (agentId: string) => CrewSubscriptionRecord[];
  getTaskProjects: (taskId: number) => ProjectRecord[];
  addTaskProject: (taskId: number, projectId: number) => boolean;
  removeTaskProject: (taskId: number, projectId: number) => boolean;
  getTaskHistory: (taskId: number) => TaskHistoryRecord[];
  addTaskHistory: (
    taskId: number,
    field: string,
    oldValue?: string | null,
    newValue?: string | null,
    changedBy?: string | null
  ) => TaskHistoryRecord;
}

function createStrategicRepository(): StrategicRepository {
  const db = openEntityDatabase();

  const listRoadmapsStmt = db.prepare(`
    SELECT
      r.id AS roadmap_id,
      r.name AS roadmap_name,
      r.theme AS roadmap_theme,
      r.color AS roadmap_color,
      r.created_at AS roadmap_created_at,
      ri.id AS item_id,
      ri.roadmap_id AS item_roadmap_id,
      ri.title AS item_title,
      ri.description AS item_description,
      ri.priority AS item_priority,
      ri.target_period AS item_target_period,
      ri.status AS item_status,
      ri.linked_task_id AS item_linked_task_id,
      ri.created_at AS item_created_at
    FROM roadmaps r
    LEFT JOIN roadmap_items ri ON ri.roadmap_id = r.id
    ORDER BY datetime(r.created_at) DESC, r.id DESC, datetime(ri.created_at) ASC, ri.id ASC
  `);
  const getRoadmapStmt = db.prepare('SELECT * FROM roadmaps WHERE id = ?');
  const createRoadmapStmt = db.prepare(`
    INSERT INTO roadmaps (
      name,
      theme,
      color,
      created_at
    ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const deleteRoadmapItemsByRoadmapStmt = db.prepare('DELETE FROM roadmap_items WHERE roadmap_id = ?');
  const deleteRoadmapStmt = db.prepare('DELETE FROM roadmaps WHERE id = ?');
  const deleteRoadmapTx = db.transaction((roadmapId: number) => {
    deleteRoadmapItemsByRoadmapStmt.run(roadmapId);
    return deleteRoadmapStmt.run(roadmapId);
  });

  const createRoadmapItemStmt = db.prepare(`
    INSERT INTO roadmap_items (
      roadmap_id,
      title,
      description,
      priority,
      target_period,
      status,
      linked_task_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getRoadmapItemStmt = db.prepare('SELECT * FROM roadmap_items WHERE id = ?');
  const deleteRoadmapItemStmt = db.prepare('DELETE FROM roadmap_items WHERE id = ?');

  const listProjectsStmt = db.prepare('SELECT * FROM projects ORDER BY datetime(created_at) DESC, id DESC');
  const getProjectStmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const createProjectStmt = db.prepare(`
    INSERT INTO projects (
      org_id,
      team_id,
      name,
      color,
      lifecycle_state,
      created_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const deleteTaskProjectsByProjectStmt = db.prepare('DELETE FROM task_projects WHERE project_id = ?');
  const deleteProjectStmt = db.prepare('DELETE FROM projects WHERE id = ?');
  const deleteProjectTx = db.transaction((projectId: number) => {
    deleteTaskProjectsByProjectStmt.run(projectId);
    return deleteProjectStmt.run(projectId);
  });

  const listCrewsStmt = db.prepare('SELECT * FROM crews ORDER BY datetime(updated_at) DESC, id DESC');
  const getCrewStmt = db.prepare('SELECT * FROM crews WHERE id = ?');
  const createCrewStmt = db.prepare(`
    INSERT INTO crews (
      id,
      name,
      description,
      settings,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `);


  const subscribeToCrewStmt = db.prepare("INSERT INTO crew_subscriptions (crew_id, agent_id) VALUES (?, ?)");
  const unsubscribeFromCrewStmt = db.prepare("DELETE FROM crew_subscriptions WHERE crew_id = ? AND agent_id = ?");
  const getSubscribersForCrewStmt = db.prepare("SELECT * FROM crew_subscriptions WHERE crew_id = ? ORDER BY created_at ASC");
  const getSubscriptionsForAgentStmt = db.prepare("SELECT * FROM crew_subscriptions WHERE agent_id = ? ORDER BY created_at ASC");
  const getSubscriptionStmt = db.prepare("SELECT * FROM crew_subscriptions WHERE crew_id = ? AND agent_id = ?");

  const listTaskProjectsStmt = db.prepare(`
    SELECT
      p.id,
      p.org_id,
      p.team_id,
      p.name,
      p.color,
      p.lifecycle_state,
      p.created_at
    FROM task_projects tp
    INNER JOIN projects p ON p.id = tp.project_id
    WHERE tp.task_id = ?
    ORDER BY p.name COLLATE NOCASE ASC, p.id ASC
  `);
  const addTaskProjectStmt = db.prepare(`
    INSERT OR IGNORE INTO task_projects (task_id, org_id, project_id)
    SELECT t.id, t.org_id, p.id
    FROM tasks t
    INNER JOIN projects p ON p.id = ? AND p.org_id = t.org_id
    WHERE t.id = ?
  `);
  const removeTaskProjectStmt = db.prepare('DELETE FROM task_projects WHERE task_id = ? AND project_id = ?');

  const listTaskHistoryStmt = db.prepare(
    'SELECT * FROM task_history WHERE task_id = ? ORDER BY datetime(changed_at) DESC, id DESC'
  );
  const createTaskHistoryStmt = db.prepare(`
    INSERT INTO task_history (
      task_id,
      field,
      old_value,
      new_value,
      changed_by,
      changed_at
    ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `);
  const getTaskHistoryByIdStmt = db.prepare('SELECT * FROM task_history WHERE id = ?');

  return {
    getRoadmaps: () => {
      const rows = listRoadmapsStmt.all() as Array<Record<string, unknown>>;
      const roadmapsById = new Map<number, RoadmapWithItemsRecord>();

      for (const row of rows) {
        const roadmapId = normalizePositiveInteger(row.roadmap_id);
        if (!roadmapId) {
          continue;
        }

        let roadmap = roadmapsById.get(roadmapId);
        if (!roadmap) {
          roadmap = {
            ...mapRoadmapRow({
              id: row.roadmap_id,
              name: row.roadmap_name,
              theme: row.roadmap_theme,
              color: row.roadmap_color,
              created_at: row.roadmap_created_at,
            }),
            items: [],
          };
          roadmapsById.set(roadmapId, roadmap);
        }

        const itemId = normalizePositiveInteger(row.item_id);
        if (!itemId) {
          continue;
        }

        roadmap.items.push(
          mapRoadmapItemRow({
            id: row.item_id,
            roadmap_id: row.item_roadmap_id,
            title: row.item_title,
            description: row.item_description,
            priority: row.item_priority,
            target_period: row.item_target_period,
            status: row.item_status,
            linked_task_id: row.item_linked_task_id,
            created_at: row.item_created_at,
          })
        );
      }

      return Array.from(roadmapsById.values());
    },

    createRoadmap: (input: CreateRoadmapInput) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('roadmap name is required');
      }

      const result = createRoadmapStmt.run(
        name,
        normalizeBlockerReason(input.theme),
        normalizeBlockerReason(input.color)
      );
      const row = getRoadmapStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create roadmap');
      }

      return mapRoadmapRow(row);
    },

    deleteRoadmap: (id: number) => {
      const roadmapId = normalizePositiveInteger(id);
      if (!roadmapId) {
        throw new Error('roadmap id must be a positive integer');
      }

      const result = deleteRoadmapTx(roadmapId);
      return result.changes > 0;
    },

    createRoadmapItem: (roadmapId: number, input: CreateRoadmapItemInput) => {
      const safeRoadmapId = normalizePositiveInteger(roadmapId);
      if (!safeRoadmapId) {
        throw new Error('roadmap id must be a positive integer');
      }

      const roadmap = getRoadmapStmt.get(safeRoadmapId) as Record<string, unknown> | undefined;
      if (!roadmap) {
        throw new Error('roadmap not found');
      }

      const title = input.title.trim();
      if (!title) {
        throw new Error('roadmap item title is required');
      }

      const priority = typeof input.priority === 'string' && input.priority.trim() ? input.priority.trim() : 'P2';
      const status = typeof input.status === 'string' && input.status.trim() ? input.status.trim() : 'planned';
      const linkedTaskId = normalizePositiveInteger(input.linked_task_id);

      const result = createRoadmapItemStmt.run(
        safeRoadmapId,
        title,
        normalizeBlockerReason(input.description),
        priority,
        normalizeBlockerReason(input.target_period),
        status,
        linkedTaskId
      );

      const row = getRoadmapItemStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create roadmap item');
      }

      return mapRoadmapItemRow(row);
    },

    updateRoadmapItem: (id: number, input: UpdateRoadmapItemInput) => {
      const roadmapItemId = normalizePositiveInteger(id);
      if (!roadmapItemId) {
        throw new Error('roadmap item id must be a positive integer');
      }

      const existing = getRoadmapItemStmt.get(roadmapItemId) as Record<string, unknown> | undefined;
      if (!existing) {
        return undefined;
      }

      const fields: string[] = [];
      const values: unknown[] = [];

      if (typeof input.title === 'string') {
        const title = input.title.trim();
        if (!title) {
          throw new Error('roadmap item title cannot be empty');
        }

        fields.push('title = ?');
        values.push(title);
      }

      if (typeof input.description !== 'undefined') {
        fields.push('description = ?');
        values.push(input.description === null ? null : normalizeBlockerReason(input.description));
      }

      if (typeof input.priority === 'string') {
        fields.push('priority = ?');
        values.push(input.priority.trim() || 'P2');
      }

      if (typeof input.target_period !== 'undefined') {
        fields.push('target_period = ?');
        values.push(input.target_period === null ? null : normalizeBlockerReason(input.target_period));
      }

      if (typeof input.status === 'string') {
        fields.push('status = ?');
        values.push(input.status.trim() || 'planned');
      }

      if (typeof input.linked_task_id !== 'undefined') {
        fields.push('linked_task_id = ?');
        values.push(normalizePositiveInteger(input.linked_task_id));
      }

      if (fields.length === 0) {
        return mapRoadmapItemRow(existing);
      }

      values.push(roadmapItemId);
      db.prepare(`UPDATE roadmap_items SET ${fields.join(', ')} WHERE id = ?`).run(...values);

      const refreshed = getRoadmapItemStmt.get(roadmapItemId) as Record<string, unknown> | undefined;
      return refreshed ? mapRoadmapItemRow(refreshed) : undefined;
    },

    deleteRoadmapItem: (id: number) => {
      const roadmapItemId = normalizePositiveInteger(id);
      if (!roadmapItemId) {
        throw new Error('roadmap item id must be a positive integer');
      }

      const result = deleteRoadmapItemStmt.run(roadmapItemId);
      return result.changes > 0;
    },

    getProjects: () => {
      const rows = listProjectsStmt.all() as Array<Record<string, unknown>>;
      return rows.map(mapProjectRow);
    },

    createProject: (input: CreateProjectInput) => {
      const name = input.name.trim();
      if (!name) {
        throw new Error('project name is required');
      }

      const result = createProjectStmt.run(
        normalizeWorkspaceId(input.org_id, DEFAULT_WORKSPACE_ORG_ID),
        normalizeWorkspaceId(input.team_id, DEFAULT_WORKSPACE_TEAM_ID),
        name,
        normalizeBlockerReason(input.color),
        normalizeBlockerReason(input.lifecycle_state) ?? 'active'
      );
      const row = getProjectStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create project');
      }

      return mapProjectRow(row);
    },

    
    getSubscribedCrews: (agentSlug: string) => {
      const agent = db.prepare('SELECT id FROM entity_agents WHERE slug = ? OR name = ?').get(agentSlug, agentSlug) as { id: string } | undefined;
      if (!agent) return [];
      
      const rows = db.prepare('SELECT c.* FROM crews c JOIN subscriptions s ON c.id = s.crew_id WHERE s.agent_id = ? ORDER BY c.updated_at DESC').all(agent.id) as Array<Record<string, unknown>>;
      return rows.map(mapCrewRow);
    },
    getCrews: () => {
      const rows = listCrewsStmt.all() as Array<Record<string, unknown>>;
      return rows.map(mapCrewRow);
    },

    createCrew: (input: CreateCrewInput) => {
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      if (!name) {
        throw new Error('crew name is required');
      }

      const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : randomUUID();
      createCrewStmt.run(
        id,
        name,
        normalizeBlockerReason(input.description),
        normalizeBlockerReason(input.settings)
      );
      const row = getCrewStmt.get(id) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create crew');
      }

      return mapCrewRow(row);
    },


    subscribeToCrew: (crewId: string, agentId: string) => {
      if (!crewId.trim() || !agentId.trim()) {
        throw new Error("crew_id and agent_id are required");
      }
      try {
        subscribeToCrewStmt.run(crewId, agentId);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes("UNIQUE constraint")) {
          throw new Error("already subscribed");
        }
        throw err;
      }
      const row = getSubscriptionStmt.get(crewId, agentId) as Record<string, unknown> | undefined;
      if (!row) throw new Error("Failed to subscribe");
      return mapCrewSubscriptionRow(row);
    },

    unsubscribeFromCrew: (crewId: string, agentId: string) => {
      const result = unsubscribeFromCrewStmt.run(crewId, agentId);
      return result.changes > 0;
    },

    getSubscribersForCrew: (crewId: string) => {
      const rows = getSubscribersForCrewStmt.all(crewId) as Array<Record<string, unknown>>;
      return rows.map(mapCrewSubscriptionRow);
    },

    getSubscriptionsForAgent: (agentId: string) => {
      const rows = getSubscriptionsForAgentStmt.all(agentId) as Array<Record<string, unknown>>;
      return rows.map(mapCrewSubscriptionRow);
    },

    deleteProject: (id: number) => {
      const projectId = normalizePositiveInteger(id);
      if (!projectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = deleteProjectTx(projectId);
      return result.changes > 0;
    },

    getTaskProjects: (taskId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const rows = listTaskProjectsStmt.all(safeTaskId) as Array<Record<string, unknown>>;
      return rows.map(mapProjectRow);
    },

    addTaskProject: (taskId: number, projectId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = addTaskProjectStmt.run(safeProjectId, safeTaskId);
      return result.changes > 0;
    },

    removeTaskProject: (taskId: number, projectId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const safeProjectId = normalizePositiveInteger(projectId);
      if (!safeProjectId) {
        throw new Error('project id must be a positive integer');
      }

      const result = removeTaskProjectStmt.run(safeTaskId, safeProjectId);
      return result.changes > 0;
    },

    getTaskHistory: (taskId: number) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const rows = listTaskHistoryStmt.all(safeTaskId) as Array<Record<string, unknown>>;
      return rows.map(mapTaskHistoryRow);
    },

    addTaskHistory: (
      taskId: number,
      field: string,
      oldValue?: string | null,
      newValue?: string | null,
      changedBy?: string | null
    ) => {
      const safeTaskId = normalizePositiveInteger(taskId);
      if (!safeTaskId) {
        throw new Error('task id must be a positive integer');
      }

      const normalizedField = field.trim();
      if (!normalizedField) {
        throw new Error('history field is required');
      }

      const result = createTaskHistoryStmt.run(
        safeTaskId,
        normalizedField,
        normalizeBlockerReason(oldValue),
        normalizeBlockerReason(newValue),
        normalizeBlockerReason(changedBy)
      );

      const row = getTaskHistoryByIdStmt.get(result.lastInsertRowid as number) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error('Failed to create task history entry');
      }

      return mapTaskHistoryRow(row);
    },
  };
}

let strategicRepository: StrategicRepository | null = null;

function getStrategicRepository(): StrategicRepository {
  if (!strategicRepository) {
    strategicRepository = createStrategicRepository();
  }

  return strategicRepository;
}

export function getRoadmaps(): RoadmapWithItemsRecord[] {
  return getStrategicRepository().getRoadmaps();
}

export function createRoadmap(input: CreateRoadmapInput): RoadmapRecord {
  return getStrategicRepository().createRoadmap(input);
}

export function deleteRoadmap(id: number): boolean {
  return getStrategicRepository().deleteRoadmap(id);
}

export function createRoadmapItem(roadmapId: number, input: CreateRoadmapItemInput): RoadmapItemRecord {
  return getStrategicRepository().createRoadmapItem(roadmapId, input);
}

export function updateRoadmapItem(id: number, input: UpdateRoadmapItemInput): RoadmapItemRecord | undefined {
  return getStrategicRepository().updateRoadmapItem(id, input);
}

export function deleteRoadmapItem(id: number): boolean {
  return getStrategicRepository().deleteRoadmapItem(id);
}

export function getProjects(): ProjectRecord[] {
  return getStrategicRepository().getProjects();
}

export function createProject(input: CreateProjectInput): ProjectRecord {
  return getStrategicRepository().createProject(input);
}

export function deleteProject(id: number): boolean {
  return getStrategicRepository().deleteProject(id);
}

export function getCrews(): CrewRecord[] {
  return getStrategicRepository().getCrews();
}

export function createCrew(input: CreateCrewInput): CrewRecord {
  return getStrategicRepository().createCrew(input);
}


export function subscribeToCrew(crewId: string, agentId: string): CrewSubscriptionRecord {
  return getStrategicRepository().subscribeToCrew(crewId, agentId);
}

export function unsubscribeFromCrew(crewId: string, agentId: string): boolean {
  return getStrategicRepository().unsubscribeFromCrew(crewId, agentId);
}

export function getSubscribersForCrew(crewId: string): CrewSubscriptionRecord[] {
  return getStrategicRepository().getSubscribersForCrew(crewId);
}

export function getSubscriptionsForAgent(agentId: string): CrewSubscriptionRecord[] {
  return getStrategicRepository().getSubscriptionsForAgent(agentId);
}

export function getTaskProjects(taskId: number): ProjectRecord[] {
  return getStrategicRepository().getTaskProjects(taskId);
}

export function addTaskProject(taskId: number, projectId: number): boolean {
  return getStrategicRepository().addTaskProject(taskId, projectId);
}

export function removeTaskProject(taskId: number, projectId: number): boolean {
  return getStrategicRepository().removeTaskProject(taskId, projectId);
}

export function getTaskHistory(taskId: number): TaskHistoryRecord[] {
  return getStrategicRepository().getTaskHistory(taskId);
}

export function addTaskHistory(
  taskId: number,
  field: string,
  oldValue?: string | null,
  newValue?: string | null,
  changedBy?: string | null
): TaskHistoryRecord {
  return getStrategicRepository().addTaskHistory(taskId, field, oldValue, newValue, changedBy);
}

// Chat module re-exports
export {
  createChatRepository,
  type ChatCategoryRecord,
  type ChatChannelRecord,
  type ChatMessageRecord,
  type ChatThreadRecord,
} from "./chat";


export function getSubscribedCrews(agentSlug: string): CrewRecord[] {
  return getStrategicRepository().getSubscribedCrews(agentSlug);
}
