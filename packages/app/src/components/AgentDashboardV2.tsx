import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react';
import type { ActivityEntry } from '../hooks/useActivityStream';
import type { TaskBoardTask } from '../hooks/useTaskBoard';
import AgentManagementSurface from './AgentManagementSurface';
import AddAgentCreationPanel from './agents/AddAgentCreationPanel';
import { getAgentRegistryRecord, resolveAgentAvatarUrl } from '../lib/agentRegistry';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../lib/http';

type SidebarAgentStatus = 'online' | 'offline';
type AgentRuntimeStatus = 'active' | 'idle' | 'blocked' | 'degraded' | 'offline' | 'unknown';
type AgentTab = 'management' | 'activity' | 'output' | 'health' | 'queue';
type FeedCategory = 'tool' | 'file' | 'message' | 'error';
type TaskColumn = 'backlog' | 'todo' | 'doing' | 'review' | 'done';

type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';

interface SidebarAgent {
  id: string;
  name: string;
  emoji: string;
  avatarUrl?: string;
  model: string;
  runtime: string;
  status: SidebarAgentStatus;
  rawStatus?: string;
  runtimeStatus?: HelmRuntimeStatusSummary;
}

interface HelmRuntimeStatusSummary {
  source: 'helm';
  binding_id: string | null;
  state: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  health: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  readiness: 'ready' | 'degraded' | 'unavailable' | 'unknown';
  current_work: string | null;
  heartbeat_at: string | null;
  checked_at: string;
  stale: boolean;
  reason: string;
  helm_link: string | null;
}

interface AgentDashboardV2Props {
  agents: SidebarAgent[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
  activities: ActivityEntry[];
  tasks: TaskBoardTask[];
  wsConnected: boolean;
}

interface AgentTaskSummary {
  title: string;
  priority: TaskPriority;
}

interface AgentQueueEntry {
  id: string;
  title: string;
  priority: TaskPriority;
  column: TaskColumn;
}

interface FeedEntry {
  id: string;
  summary: string;
  detail: string;
  timestamp: string;
  category: FeedCategory;
}

interface DashboardTask {
  id: number;
  name: string;
  description: string | null;
  assignee: string;
  column: TaskColumn;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
}

interface DashboardActivity {
  id: string;
  source: string;
  type: string;
  action: string;
  description: string;
  agentName: string;
  filePath: string | null;
  taskId: number | null;
  taskColumn: string | null;
  metadata: string | null;
  createdAt: string;
}

interface CrewCardAgent {
  sidebarId: string;
  identityKeys: string[];
  name: string;
  emoji: string;
  avatarUrl?: string;
  model: string;
  runtime: string;
  status: AgentRuntimeStatus;
  currentTask: AgentTaskSummary | null;
  tasks: number;
  tasksDoing: number;
  tasksDone: number;
  files: number;
  messages: number;
  errors: number;
  lastAction: string;
  lastActionAt: string | null;
  runtimeStatus?: HelmRuntimeStatusSummary;
  sparklineValues: number[];
  sparklineLabels: string[];
  uptimeSeconds?: number;
  downtimeSeconds?: number;
  health: {
    cpuLoad: number | null;
    memoryLoad: number | null;
    queueDepth: number | null;
    restarts: number | null;
    heartbeatAt: string | null;
  };
}

interface AgentMetrics {
  system: { cpuPercent: number; memUsedMb: number; memTotalMb: number; memPercent: number; uptimeSeconds: number; loadAvg: number };
  gateway: { pid: number; cpuPercent: number; memPercent: number };
  agents: Record<string, { inputTokens: number; outputTokens: number; contextTokens: number; estimatedCost: number }>;
}

const REFRESH_INTERVAL_MS = 30_000;
const SPARKLINE_HOURS = 12;
const TASK_COLUMNS: readonly TaskColumn[] = ['backlog', 'todo', 'doing', 'review', 'done'];

const STATUS_META: Record<
  AgentRuntimeStatus,
  { label: string; dot: string; badgeBg: string; badgeText: string; glow: string }
> = {
  active: {
    label: 'Active',
    dot: 'var(--success)',
    badgeBg: 'var(--surface-success)',
    badgeText: 'var(--success)',
    glow: 'inset 0 0 0 1px var(--success)',
  },
  idle: {
    label: 'Idle',
    dot: 'var(--review-warning)',
    badgeBg: 'var(--surface-muted)',
    badgeText: 'var(--review-warning)',
    glow: 'inset 0 0 0 1px var(--review-warning)',
  },
  blocked: {
    label: 'Blocked',
    dot: 'var(--error)',
    badgeBg: 'var(--surface-error)',
    badgeText: 'var(--error)',
    glow: 'inset 0 0 0 1px var(--error)',
  },
  degraded: {
    label: 'Degraded',
    dot: 'var(--review-warning)',
    badgeBg: 'var(--surface-muted)',
    badgeText: 'var(--review-warning)',
    glow: 'inset 0 0 0 1px var(--review-warning)',
  },
  offline: {
    label: 'Offline',
    dot: 'var(--text-muted)',
    badgeBg: 'var(--surface-muted)',
    badgeText: 'var(--text-secondary)',
    glow: 'inset 0 0 0 1px var(--border-secondary)',
  },
  unknown: {
    label: 'Unknown',
    dot: 'var(--text-muted)',
    badgeBg: 'var(--surface-muted)',
    badgeText: 'var(--text-secondary)',
    glow: 'inset 0 0 0 1px var(--border-secondary)',
  },
};

const FEED_META: Record<FeedCategory, { dot: string; text: string }> = {
  tool: { dot: 'var(--review-info)', text: 'var(--text-primary)' },
  file: { dot: 'var(--suggestion-insert)', text: 'var(--text-primary)' },
  message: { dot: 'var(--review-warning)', text: 'var(--text-primary)' },
  error: { dot: 'var(--error)', text: 'var(--text-primary)' },
};

const TAB_ITEMS: Array<{ id: AgentTab; label: string }> = [
  { id: 'management', label: 'Management' },
  { id: 'activity', label: 'Activity Feed' },
  { id: 'output', label: 'Work Output' },
  { id: 'health', label: 'Health' },
  { id: 'queue', label: 'Task Queue' },
];

function AgentAvatar({
  avatarUrl,
  emoji,
  name,
  size = 'md',
}: {
  avatarUrl?: string;
  emoji: string;
  name: string;
  size?: 'md' | 'lg';
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const dimensions = size === 'lg' ? 'h-12 w-12 text-xl' : 'h-10 w-10 text-lg';

  if (avatarUrl && !imageFailed) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${dimensions} rounded-full object-cover`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <div className={`flex ${dimensions} items-center justify-center rounded-full bg-[var(--surface-muted)]`}>
      {emoji}
    </div>
  );
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
}

function normalizeText(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function normalizeIdentity(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[\s_-]+/g, '');
}

function buildIdentityKeys(id: string, name: string): string[] {
  const keys = new Set<string>();
  const normalizedId = normalizeIdentity(id);
  const normalizedName = normalizeIdentity(name);

  if (normalizedId) {
    keys.add(normalizedId);
  }
  if (normalizedName) {
    keys.add(normalizedName);
  }

  return Array.from(keys);
}

function matchesIdentity(identityKeys: readonly string[], candidate: string): boolean {
  const normalizedCandidate = normalizeIdentity(candidate);
  return normalizedCandidate ? identityKeys.includes(normalizedCandidate) : false;
}

function parseMetadataRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return toRecord(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  return toRecord(value);
}

function matchesActivityIdentity(identityKeys: readonly string[], entry: DashboardActivity): boolean {
  if (matchesIdentity(identityKeys, entry.agentName)) {
    return true;
  }

  if (normalizeText(entry.type).toLowerCase() === 'file_edit') {
    return false;
  }

  const normalizedDescription = normalizeIdentity(entry.description);
  if (!normalizedDescription) {
    return false;
  }

  return identityKeys.some((identityKey) => {
    if (identityKey.length < 2 || !/[a-z]/.test(identityKey)) {
      return false;
    }

    return normalizedDescription.includes(identityKey);
  });
}

function toIsoTimestamp(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date().toISOString();
}

function toTaskId(value: unknown): number | null {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }

  return null;
}

function extractList(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  const record = toRecord(payload);
  if (!record) {
    return [];
  }

  for (const key of keys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function normalizeOnlineStatus(value: unknown): SidebarAgentStatus {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return 'online';
  }

  if (normalized.includes('offline') || normalized.includes('disconnected') || normalized.includes('down')) {
    return 'offline';
  }

  return 'online';
}

function normalizeHelmRuntimeStatus(value: unknown): HelmRuntimeStatusSummary | undefined {
  const record = toRecord(value);
  if (!record || record.source !== 'helm') {
    return undefined;
  }
  const state = normalizeText(record.state).toLowerCase();
  const health = normalizeText(record.health).toLowerCase();
  const readiness = normalizeText(record.readiness).toLowerCase();
  return {
    source: 'helm',
    binding_id: normalizeText(record.binding_id) || null,
    state: state === 'healthy' || state === 'degraded' || state === 'unavailable' || state === 'unknown' ? state : 'unknown',
    health: health === 'healthy' || health === 'degraded' || health === 'unavailable' || health === 'unknown' ? health : 'unknown',
    readiness: readiness === 'ready' || readiness === 'degraded' || readiness === 'unavailable' || readiness === 'unknown' ? readiness : 'unknown',
    current_work: normalizeText(record.current_work) || null,
    heartbeat_at: normalizeText(record.heartbeat_at) || null,
    checked_at: normalizeText(record.checked_at) || new Date().toISOString(),
    stale: record.stale === true,
    reason: normalizeText(record.reason) || 'helm_status_unknown',
    helm_link: normalizeText(record.helm_link) || null,
  };
}

function normalizeTaskColumn(value: unknown): TaskColumn {
  if (typeof value !== 'string') {
    return 'backlog';
  }

  const normalized = value.trim().toLowerCase();
  return TASK_COLUMNS.includes(normalized as TaskColumn) ? (normalized as TaskColumn) : 'backlog';
}

function normalizePriority(value: unknown): TaskPriority {
  if (typeof value !== 'string') {
    return 'P2';
  }

  const normalized = value.trim().toUpperCase();
  if (normalized === 'P0' || normalized === 'P1' || normalized === 'P2' || normalized === 'P3') {
    return normalized;
  }

  return 'P2';
}

function formatTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unknown';
  }

  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatRelative(iso: string | null): string {
  if (!iso) {
    return 'just now';
  }

  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) {
    return 'just now';
  }

  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatCurrency(amount: number | null): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return '—';
  }

  return `$${amount.toFixed(2)}`;
}

function formatBurn(amount: number | null): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    return '—';
  }

  return `$${amount.toFixed(2)}/hr burn`;
}

function isFileType(type: string): boolean {
  const normalized = normalizeText(type).toLowerCase();
  return normalized.includes('file') || normalized.includes('edit');
}

function isTaskType(type: string): boolean {
  return normalizeText(type).toLowerCase().includes('task');
}

function isMessageType(type: string): boolean {
  const normalized = normalizeText(type).toLowerCase();
  return normalized.includes('message') || normalized.includes('comment');
}

function isErrorType(type: string): boolean {
  return normalizeText(type).toLowerCase().includes('error');
}

function activityCategory(type: string): FeedCategory {
  if (isErrorType(type)) {
    return 'error';
  }

  if (isFileType(type)) {
    return 'file';
  }

  if (isTaskType(type)) {
    return 'tool';
  }

  if (isMessageType(type)) {
    return 'message';
  }

  return 'tool';
}

function priorityTone(priority: TaskPriority): CSSProperties {
  if (priority === 'P0') {
    return {
      background: 'var(--surface-error)',
      color: 'var(--error)',
      borderColor: 'var(--error)',
    };
  }
  if (priority === 'P1') {
    return {
      background: 'var(--surface-muted)',
      color: 'var(--review-warning)',
      borderColor: 'var(--review-warning)',
    };
  }
  if (priority === 'P2') {
    return {
      background: 'var(--surface-accent)',
      color: 'var(--accent)',
      borderColor: 'var(--accent)',
    };
  }
  return {
    background: 'var(--surface-muted)',
    color: 'var(--text-secondary)',
    borderColor: 'var(--border-secondary)',
  };
}

function queueStatusTone(column: TaskColumn): CSSProperties {
  if (column === 'doing') return { color: 'var(--success)' };
  if (column === 'review') return { color: 'var(--review-warning)' };
  if (column === 'done') return { color: 'var(--accent)' };
  return { color: 'var(--text-secondary)' };
}

function queueStatusLabel(column: TaskColumn): string {
  if (column === 'doing') {
    return 'running';
  }

  return column;
}

function boundedPercent(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

function getAgentCost(metrics: AgentMetrics | null, agentName: string): number | null {
  if (!metrics?.agents) return null;
  const key = agentName.toLowerCase();
  const keyMap: Record<string, string> = { ada: "main", spock: "spock", scotty: "scotty", geordi: "geordi", zora: "zora" };
  const sessionKey = keyMap[key] || key;
  const agentData = metrics.agents[sessionKey];
  return agentData?.estimatedCost ?? null;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function resolveRuntimeStatus(agent: SidebarAgent, hasActiveTask: boolean, hasRecentActivity: boolean): AgentRuntimeStatus {
  if (agent.runtimeStatus?.state === 'degraded') {
    return 'degraded';
  }
  if (agent.runtimeStatus?.state === 'unavailable') {
    return 'offline';
  }
  if (agent.runtimeStatus?.state === 'unknown') {
    return 'unknown';
  }
  if (agent.status === 'offline') {
    return 'offline';
  }

  const normalizedRawStatus = normalizeText(agent.rawStatus).toLowerCase();
  if (normalizedRawStatus.includes('blocked') || normalizedRawStatus.includes('error')) {
    return 'blocked';
  }

  if (hasActiveTask || hasRecentActivity) {
    return 'active';
  }

  return 'idle';
}

function parseAgents(payload: unknown): SidebarAgent[] {
  const rows = extractList(payload, ['agents', 'list']);
  const seen = new Set<string>();

  const parsed = rows
    .map((raw) => {
      const record = toRecord(raw);
      if (!record) {
        return null;
      }

      const idSource = record.id;
      const nameSource = record.name;
      const id =
        typeof idSource === 'string'
          ? idSource.trim()
          : Number.isFinite(Number(idSource))
            ? String(Number(idSource))
            : '';
      const name = typeof nameSource === 'string' ? nameSource.trim() : id;

      if (!id || !name) {
        return null;
      }

      if (seen.has(id)) {
        return null;
      }
      seen.add(id);

      if (id.toLowerCase() === 'assistant' || normalizeText(record.status).toLowerCase() === 'template') {
        return null;
      }

      const model = normalizeText(record.model);
      const runtime = [record.adapter_type, record.runtime_type]
        .map(normalizeText)
        .filter(Boolean)
        .join(' · ') || normalizeText(record.runtime) || 'registry';
      const emoji = normalizeText(record.emoji) || '🤖';
      const avatarUrl = normalizeText(record.avatarUrl) || normalizeText(record.avatar_url) || normalizeText(record.avatar) || undefined;

      return {
        id,
        name,
        emoji,
        avatarUrl,
        model,
        runtime,
        status: normalizeOnlineStatus(record.status),
        rawStatus: normalizeText(record.status) || undefined,
        runtimeStatus: normalizeHelmRuntimeStatus(record.runtime_status ?? record.runtimeStatus),
      } as SidebarAgent;
    })
    .filter((entry): entry is SidebarAgent => entry !== null);

  return parsed;
}

function parseTasks(payload: unknown): DashboardTask[] {
  const rows = extractList(payload, ['tasks']);

  return rows
    .map((raw) => {
      const record = toRecord(raw);
      if (!record) {
        return null;
      }

      const id = Number(record.id);
      const name = normalizeText(record.name);
      if (!Number.isInteger(id) || id <= 0 || !name) {
        return null;
      }

      return {
        id,
        name,
        description: normalizeText(record.description) || null,
        assignee: normalizeText(record.assignee) || 'Unassigned',
        column: normalizeTaskColumn(record.column),
        priority: normalizePriority(record.priority),
        createdAt: toIsoTimestamp(record.created_at),
        updatedAt: toIsoTimestamp(record.updated_at ?? record.created_at),
      } as DashboardTask;
    })
    .filter((entry): entry is DashboardTask => entry !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function parseActivities(payload: unknown): DashboardActivity[] {
  const rows = extractList(payload, ['activities', 'entries']);

  return rows
    .map((raw, index) => {
      const record = toRecord(raw);
      if (!record) {
        return null;
      }

      const idSource = record.id;
      const id =
        typeof idSource === 'string'
          ? idSource
          : Number.isFinite(Number(idSource))
            ? String(Number(idSource))
            : `activity-${Date.now()}-${index}`;

      const filePath = normalizeText(record.file_path ?? record.filePath) || null;
      const type = normalizeText(record.type) || 'message';
      const metadataRecord = parseMetadataRecord(record.metadata);
      const metadataAssignee = normalizeText(metadataRecord?.assignee);
      const agentNameFromField = normalizeText(record.agent_name ?? record.agentName);
      const description = normalizeText(record.description) || filePath || 'No details';
      const isFileEdit = type.toLowerCase() === 'file_edit';
      const resolvedAgentName = isFileEdit ? agentNameFromField : agentNameFromField || metadataAssignee;

      return {
        id,
        source: normalizeText(record.source) || 'agent',
        type,
        action: normalizeText(record.action) || 'Activity',
        description,
        agentName: resolvedAgentName || 'Unknown',
        filePath,
        taskId: toTaskId(record.task_id ?? record.taskId),
        taskColumn: normalizeText(record.task_column ?? record.taskColumn) || null,
        metadata: normalizeText(record.metadata) || null,
        createdAt: toIsoTimestamp(record.created_at ?? record.timestamp),
      } as DashboardActivity;
    })
    .filter((entry): entry is DashboardActivity => entry !== null)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function buildSparklineSeries(entries: DashboardActivity[], hours = SPARKLINE_HOURS): { values: number[]; labels: string[] } {
  const safeHours = Math.max(2, hours);
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setMinutes(0, 0, 0);

  const startMs = currentHour.getTime() - (safeHours - 1) * 60 * 60 * 1000;
  const endMs = startMs + safeHours * 60 * 60 * 1000;

  const values = Array.from({ length: safeHours }, () => 0);
  const labels = Array.from({ length: safeHours }, (_, index) => {
    const bucketDate = new Date(startMs + index * 60 * 60 * 1000);
    return bucketDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  });

  for (const entry of entries) {
    const time = Date.parse(entry.createdAt);
    if (!Number.isFinite(time) || time < startMs || time >= endMs) {
      continue;
    }

    const index = Math.floor((time - startMs) / (60 * 60 * 1000));
    if (index >= 0 && index < values.length) {
      values[index] += 1;
    }
  }

  return { values, labels };
}

function Sparkline({ values, labels, stroke }: { values: number[]; labels: string[]; stroke: string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const gradientId = useId().replace(/:/g, '');
  const width = 640;
  const height = 200;
  const paddingTop = 12;
  const paddingRight = 10;
  const paddingBottom = 16;
  const paddingLeft = 10;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;
  const hasData = values.some((value) => value > 0);
  const max = useMemo(() => Math.max(1, ...values), [values]);

  const points = useMemo(
    () =>
      values.map((value, index) => {
        const denominator = Math.max(1, values.length - 1);
        const x = paddingLeft + (index / denominator) * plotWidth;
        const y = paddingTop + (1 - value / max) * plotHeight;
        return { x, y };
      }),
    [max, plotHeight, plotWidth, values]
  );

  const path = useMemo(() => {
    if (points.length < 2) {
      return '';
    }

    const smoothing = 0.18;
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const previousAnchor = points[index - 2] ?? previous;
      const nextAnchor = points[index + 1] ?? current;
      const control1x = previous.x + (current.x - previousAnchor.x) * smoothing;
      const control1y = previous.y + (current.y - previousAnchor.y) * smoothing;
      const control2x = current.x - (nextAnchor.x - previous.x) * smoothing;
      const control2y = current.y - (nextAnchor.y - previous.y) * smoothing;
      d += ` C ${control1x.toFixed(1)} ${control1y.toFixed(1)} ${control2x.toFixed(1)} ${control2y.toFixed(1)} ${current.x.toFixed(1)} ${current.y.toFixed(1)}`;
    }

    return d;
  }, [points]);

  const areaPath = useMemo(() => {
    if (!path || points.length < 2) {
      return '';
    }

    const first = points[0];
    const last = points[points.length - 1];
    const baselineY = paddingTop + plotHeight;
    return `${path} L ${last.x.toFixed(1)} ${baselineY.toFixed(1)} L ${first.x.toFixed(1)} ${baselineY.toFixed(1)} Z`;
  }, [path, plotHeight, points]);

  const tooltipPoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="relative h-full min-h-[180px] w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)]/35">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {Array.from({ length: 4 }).map((_, index) => {
          const y = paddingTop + (index / 3) * plotHeight;
          return (
            <line
              key={`grid-${index}`}
              x1={paddingLeft}
              y1={y}
              x2={paddingLeft + plotWidth}
              y2={y}
              stroke="var(--border-secondary)"
              strokeOpacity="0.28"
              strokeWidth="1"
            />
          );
        })}

        {hasData && areaPath && (
          <>
            <defs>
              <linearGradient id={`spark-fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
                <stop offset="100%" stopColor={stroke} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#spark-fill-${gradientId})`} />
            <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}

        {hasData &&
          hoverIndex !== null &&
          points.map((point, index) => (
            <circle
              key={`point-${labels[index] ?? index}`}
              cx={point.x}
              cy={point.y}
              r={hoverIndex === index ? 3 : 2.2}
              fill={stroke}
              fillOpacity={hoverIndex === index ? 1 : 0.45}
              stroke="var(--bg-primary)"
              strokeWidth="1"
            />
          ))}

        {hasData &&
          values.map((_, index) => {
            const bucketWidth = values.length > 0 ? plotWidth / values.length : plotWidth;
            return (
              <rect
                key={`hit-${labels[index] ?? index}`}
                x={paddingLeft + index * bucketWidth}
                y={paddingTop}
                width={bucketWidth}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHoverIndex(index)}
              />
            );
          })}
      </svg>

      {!hasData && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-[var(--text-secondary)]">
          No activity data
        </div>
      )}

      {hasData && hoverIndex !== null && tooltipPoint && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-[10px] text-[var(--text-primary)]"
          style={{
            left: `${(tooltipPoint.x / width) * 100}%`,
            top: `${Math.max(18, (tooltipPoint.y / height) * 100 - 6)}%`,
          }}
        >
          {`${labels[hoverIndex] ?? 'Unknown'}: ${values[hoverIndex]} ${values[hoverIndex] === 1 ? 'action' : 'actions'}`}
        </div>
      )}
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[var(--bg-primary)] p-3 lg:p-4">
      <div className="flex w-full flex-col gap-3 text-[var(--text-primary)]">
        <div className="rounded-xl border border-[var(--border-primary)] bg-[var(--card-bg)] px-4 py-3 text-sm text-[var(--text-secondary)]">
          Loading agent dashboard…
        </div>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={`skeleton-${index}`} className="animate-pulse rounded-xl border border-[var(--border-primary)] bg-[var(--card-bg)] p-4">
              <div className="mb-3 h-4 w-40 rounded bg-[var(--surface-muted)]" />
              <div className="mb-3 h-16 rounded bg-[var(--surface-muted)]" />
              <div className="grid grid-cols-4 gap-2">
                <div className="h-10 rounded bg-[var(--surface-muted)]" />
                <div className="h-10 rounded bg-[var(--surface-muted)]" />
                <div className="h-10 rounded bg-[var(--surface-muted)]" />
                <div className="h-10 rounded bg-[var(--surface-muted)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AgentDashboardV2({
  agents,
  selectedAgentId,
  onSelectAgent,
  tasks,
  wsConnected,
}: AgentDashboardV2Props) {
  const [liveAgents, setLiveAgents] = useState<SidebarAgent[]>([]);
  const [liveTasks, setLiveTasks] = useState<DashboardTask[]>([]);
  const [liveActivities, setLiveActivities] = useState<DashboardActivity[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [activitiesError, setActivitiesError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadData = async (isInitial: boolean) => {
      if (isInitial) {
        setInitialLoading(true);
      } else {
        setRefreshing(true);
      }

      const [agentsResult, tasksResult, activitiesResult, metricsResult] = await Promise.allSettled([
        requestJsonWithFallback({
          urls: buildApiCandidates('/agents'),
          fallbackError: 'Unable to load agents.',
        }),
        requestJsonWithFallback({
          urls: buildApiCandidates('/tasks'),
          fallbackError: 'Unable to load tasks.',
        }),
        requestJsonWithFallback({
          urls: buildApiCandidates('/activity/recent'),
          fallbackError: 'Unable to load activity.',
        }),
        requestJsonWithFallback({
          urls: buildApiCandidates('/agents/metrics'),
          fallbackError: 'Unable to load metrics.',
        }),
      ]);

      if (cancelled) {
        return;
      }

      if (agentsResult.status === 'fulfilled') {
        setLiveAgents(parseAgents(agentsResult.value));
        setAgentsError(null);
      } else {
        setAgentsError(toErrorMessage(agentsResult.reason, 'Unable to load agents.'));
      }

      if (tasksResult.status === 'fulfilled') {
        setLiveTasks(parseTasks(tasksResult.value));
        setTasksError(null);
      } else {
        setTasksError(toErrorMessage(tasksResult.reason, 'Unable to load tasks.'));
      }

      if (activitiesResult.status === 'fulfilled') {
        setLiveActivities(parseActivities(activitiesResult.value));
        setActivitiesError(null);
      } else {
        setActivitiesError(toErrorMessage(activitiesResult.reason, 'Unable to load activity.'));
      }

      if (metricsResult.status === 'fulfilled' && metricsResult.value && typeof metricsResult.value === 'object') {
        setMetrics(metricsResult.value as AgentMetrics);
      }

      if (isInitial) {
        setInitialLoading(false);
      } else {
        setRefreshing(false);
      }
    };

    void loadData(true);

    const intervalId = window.setInterval(() => {
      void loadData(false);
    }, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!selectedAgentId) {
      return;
    }

    const selectedIdentity = normalizeIdentity(selectedAgentId);
    if (!selectedIdentity) {
      onSelectAgent(null);
      return;
    }

    const sourceAgents = agents.length > 0 ? agents : liveAgents;
    const exists = sourceAgents.some((agent) => {
      const keys = buildIdentityKeys(agent.id, agent.name);
      return keys.includes(selectedIdentity);
    });

    if (!exists) {
      onSelectAgent(null);
    }
  }, [agents, liveAgents, onSelectAgent, selectedAgentId]);

  const crewAgents = useMemo<CrewCardAgent[]>(() => {
    const sourceAgents = agents.length > 0 ? agents : liveAgents;
    return sourceAgents.map((agent) => {
      const identityKeys = buildIdentityKeys(agent.id, agent.name);
      const assignedTasks = liveTasks
        .filter((task) => matchesIdentity(identityKeys, task.assignee))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const agentActivities = liveActivities
        .filter((entry) => matchesActivityIdentity(identityKeys, entry))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const doingTasks = assignedTasks.filter((task) => task.column === 'doing');
      const doneTasks = assignedTasks.filter((task) => task.column === 'done');
      const lastActivity = agentActivities[0] ?? null;
      const hasRecentActivity =
        !!lastActivity && Date.now() - new Date(lastActivity.createdAt).getTime() <= 30 * 60 * 1000;

      const sparkline = buildSparklineSeries(agentActivities, SPARKLINE_HOURS);

      const registryRecord = getAgentRegistryRecord(agent.id) ?? getAgentRegistryRecord(agent.name);

      return {
        sidebarId: agent.id,
        identityKeys,
        avatarUrl: registryRecord ? registryRecord.avatarUrl : resolveAgentAvatarUrl(agent.id) ?? resolveAgentAvatarUrl(agent.name) ?? agent.avatarUrl,
        name: agent.name,
        emoji: agent.emoji,
        model: agent.model,
        runtime: agent.runtime,
        status: resolveRuntimeStatus(agent, doingTasks.length > 0, hasRecentActivity),
        currentTask:
          doingTasks[0] === undefined
            ? agent.runtimeStatus?.current_work
              ? { title: agent.runtimeStatus.current_work, priority: 'P2' }
              : null
            : {
                title: doingTasks[0].name,
                priority: doingTasks[0].priority,
              },
        tasks: assignedTasks.length,
        tasksDoing: doingTasks.length,
        tasksDone: doneTasks.length,
        files: agentActivities.filter((entry) => isFileType(entry.type)).length,
        messages: agentActivities.filter((entry) => isMessageType(entry.type)).length,
        errors: agentActivities.filter((entry) => isErrorType(entry.type)).length,
        lastAction: lastActivity?.description || lastActivity?.action || 'No recent activity',
        lastActionAt: lastActivity?.createdAt ?? null,
        runtimeStatus: agent.runtimeStatus,
        sparklineValues: sparkline.values,
        sparklineLabels: sparkline.labels,
        uptimeSeconds: metrics?.system?.uptimeSeconds ?? undefined,
        health: {
          cpuLoad: metrics?.system?.cpuPercent ?? null,
          memoryLoad: metrics?.system?.memPercent ?? null,
          queueDepth: doingTasks.length,
          restarts: null,
          heartbeatAt: agent.runtimeStatus?.heartbeat_at ?? null,
        },
      };
    });
  }, [agents, liveActivities, liveAgents, liveTasks, metrics]);

  const selectedAgent = useMemo<CrewCardAgent | null>(() => {
    if (!selectedAgentId) {
      return null;
    }

    const selectedIdentity = normalizeIdentity(selectedAgentId);
    if (!selectedIdentity) {
      return null;
    }

    return crewAgents.find((agent) => agent.identityKeys.includes(selectedIdentity)) ?? null;
  }, [crewAgents, selectedAgentId]);

  const [detailTab, setDetailTab] = useState<AgentTab>('management');
  useEffect(() => {
    setDetailTab('management');
  }, [selectedAgent?.sidebarId]);

  const crewStats = useMemo(() => {
    const active = crewAgents.filter((agent) => agent.status === 'active').length;
    const idle = crewAgents.filter((agent) => agent.status === 'idle').length;
    const totalTasks = crewAgents.reduce((total, agent) => total + agent.tasks, 0);
    const totalErrors = crewAgents.reduce((total, agent) => total + agent.errors, 0);
    const topPerformer =
      crewAgents.length > 0
        ? crewAgents.reduce((best, current) => (current.tasksDone > best.tasksDone ? current : best), crewAgents[0])
        : null;

    return {
      active,
      idle,
      burn: null as number | null,
      totalTasks,
      totalCost: metrics ? Object.values(metrics.agents || {}).reduce((sum, a) => sum + (a?.estimatedCost || 0), 0) : null,
      totalErrors,
      topPerformer,
    };
  }, [crewAgents, metrics]);

  const selectedFeed = useMemo<FeedEntry[]>(() => {
    if (!selectedAgent) {
      return [];
    }

    return liveActivities
      .filter((entry) => matchesActivityIdentity(selectedAgent.identityKeys, entry))
      .slice(0, 20)
      .map((entry) => ({
        id: entry.id,
        summary: entry.action || 'Activity',
        detail: entry.description || entry.filePath || 'No details',
        timestamp: entry.createdAt,
        category: activityCategory(entry.type),
      }));
  }, [liveActivities, selectedAgent]);

  const selectedTasks = useMemo(() => {
    if (!selectedAgent) {
      return [];
    }

    return liveTasks
      .filter((task) => matchesIdentity(selectedAgent.identityKeys, task.assignee))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [liveTasks, selectedAgent]);

  const selectedQueue = useMemo<AgentQueueEntry[]>(() => {
    return selectedTasks.slice(0, 20).map((task) => ({
      id: `task-${task.id}`,
      title: task.name,
      priority: task.priority,
      column: task.column,
    }));
  }, [selectedTasks]);

  const outputFiles = useMemo(() => {
    if (!selectedAgent) {
      return [] as Array<{ id: string; filePath: string; description: string; timestamp: string }>;
    }

    const latestByPath = new Map<string, DashboardActivity>();

    for (const entry of liveActivities) {
      if (!matchesActivityIdentity(selectedAgent.identityKeys, entry) || !entry.filePath) {
        continue;
      }

      const existing = latestByPath.get(entry.filePath);
      if (!existing || new Date(entry.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        latestByPath.set(entry.filePath, entry);
      }
    }

    return Array.from(latestByPath.entries())
      .map(([filePath, entry]) => ({
        id: `${entry.id}-${filePath}`,
        filePath,
        description: entry.description,
        timestamp: entry.createdAt,
      }))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20);
  }, [liveActivities, selectedAgent]);

  const dashboardErrorMessage = useMemo(() => {
    const failedSources: string[] = [];
    if (agentsError) {
      failedSources.push('agents');
    }
    if (tasksError) {
      failedSources.push('tasks');
    }
    if (activitiesError) {
      failedSources.push('activity feed');
    }

    if (failedSources.length === 0) {
      return null;
    }

    return `Unable to load ${failedSources.join(', ')}.`;
  }, [activitiesError, agentsError, tasksError]);

  if (initialLoading && liveAgents.length === 0 && agents.length === 0) {
    return <LoadingShell />;
  }

  if (!selectedAgent) {
    return (
      <div className="min-h-0 flex-1 overflow-auto bg-[var(--bg-primary)] p-4 lg:p-6">
        <div className="flex w-full flex-col gap-4 text-[var(--text-primary)]">
          {dashboardErrorMessage && (
            <div
              className="entity-ops-panel border-[var(--error)] bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]"
              role="status"
            >
              {dashboardErrorMessage}
            </div>
          )}

          <div className="entity-ops-panel-strong px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="entity-ops-section-title">Agent Fleet</div>
                <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                  {crewAgents.length} agents · {crewStats.active} active · {crewStats.idle} idle
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="entity-ops-chip entity-ops-chip-blue">{crewStats.totalTasks} tasks</span>
                <span className={`entity-ops-chip ${crewStats.totalErrors > 0 ? 'entity-ops-chip-red' : ''}`}>
                  {crewStats.totalErrors} errors
                </span>
                <span className="entity-ops-chip font-mono">{formatBurn(crewStats.burn)}</span>
              </div>
            </div>
            {refreshing && (
              <span className="mt-2 inline-block text-xs text-[var(--text-secondary)]" role="status">
                Refreshing…
              </span>
            )}
          </div>

          <AddAgentCreationPanel />

          {crewAgents.length === 0 ? (
            <div className="entity-ops-empty px-4 py-8 text-sm">
              No agents available.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {crewAgents.map((agent) => {
                const statusMeta = STATUS_META[agent.status];
                return (
                  <button
                    key={agent.sidebarId}
                    type="button"
                    onClick={() => onSelectAgent(agent.sidebarId)}
                    className="entity-ops-row grid gap-3 p-3 text-left transition-transform duration-150 hover:-translate-y-0.5"
                    style={{
                      boxShadow: statusMeta.glow,
                    }}
                  >
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <AgentAvatar avatarUrl={agent.avatarUrl} emoji={agent.emoji} name={agent.name} />
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{agent.name}</div>
                              <div className="truncate text-xs text-[var(--text-secondary)]">
                                Runtime · {agent.runtime || 'registry'}
                                <span className="mx-1 text-[var(--text-muted)]">·</span>
                                Model · {agent.model || 'default resolving'}
                              </div>
                            </div>
                          </div>
                          <span
                            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                            style={{
                              borderColor: statusMeta.dot,
                              background: statusMeta.badgeBg,
                              color: statusMeta.badgeText,
                            }}
                          >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusMeta.dot }} />
                            {statusMeta.label}
                          </span>
                        </div>

                        <div className="entity-ops-panel px-3 py-2">
                          <div className="mb-1 entity-ops-section-title">Current task</div>
                          {agent.currentTask ? (
                            <>
                              <div className="line-clamp-2 text-sm font-medium text-[var(--text-primary)]">{agent.currentTask.title}</div>
                              <span
                                className="mt-2 inline-flex rounded border px-1.5 py-0.5 text-[11px]"
                                style={priorityTone(agent.currentTask.priority)}
                              >
                                {agent.currentTask.priority}
                              </span>
                            </>
                          ) : (
                            <div className="text-sm text-[var(--text-secondary)]">No active task</div>
                          )}
                          <div className="mt-2 text-[11px] text-[var(--text-muted)]">
                            Doing {agent.tasksDoing} · Done {agent.tasksDone} · Total {agent.tasks}
                          </div>
                        </div>
                      </div>

                      <div className="flex h-[200px] min-h-[180px] flex-col">
                        <div className="mb-1 entity-ops-section-title">Activity</div>
                        <div className="min-h-0 flex-1">
                          <Sparkline values={agent.sparklineValues} labels={agent.sparklineLabels} stroke="var(--accent)" />
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-primary)] pt-2">
                      <div className="grid grid-cols-4 gap-2 text-center text-[10px]">
                        <div className="entity-ops-panel px-2 py-1">
                          <div className="text-[var(--text-muted)]">tasks</div>
                          <div className="font-semibold text-[var(--text-primary)]">{agent.tasks}</div>
                        </div>
                        <div className="entity-ops-panel px-2 py-1">
                          <div className="text-[var(--text-muted)]">files</div>
                          <div className="font-semibold text-[var(--text-primary)]">{agent.files}</div>
                        </div>
                        <div className="entity-ops-panel px-2 py-1">
                          <div className="text-[var(--text-muted)]">msgs</div>
                          <div className="font-semibold text-[var(--text-primary)]">{agent.messages}</div>
                        </div>
                        <div className="entity-ops-panel px-2 py-1">
                          <div className="text-[var(--text-muted)]">err</div>
                          <div className="font-semibold text-[var(--text-primary)]">{agent.errors}</div>
                        </div>
                      </div>

                      <div className="min-w-0 text-left sm:text-right">
                        <div className="truncate text-xs text-[var(--text-secondary)]">{agent.lastAction}</div>
                        <div className="mt-0.5 font-mono text-[11px] text-[var(--text-muted)]">
                          {agent.lastActionAt
                            ? `${formatTime(agent.lastActionAt)} · ${formatRelative(agent.lastActionAt)} · Cost ${formatCurrency(getAgentCost(metrics, agent.name))}`
                            : `Unknown time · Cost ${formatCurrency(getAgentCost(metrics, agent.name))}`}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            <div className="entity-ops-panel-strong px-4 py-3">
              <div className="entity-ops-section-title">Total Cost</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{formatCurrency(crewStats.totalCost)}</div>
            </div>
            <div className="entity-ops-panel-strong px-4 py-3">
              <div className="entity-ops-section-title">Top Performer</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
                {crewStats.topPerformer ? `${crewStats.topPerformer.name} (${crewStats.topPerformer.tasksDone} done)` : '—'}
              </div>
            </div>
            <div className="entity-ops-panel-strong px-4 py-3">
              <div className="entity-ops-section-title">Crew Errors</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{crewStats.totalErrors}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const statusMeta = STATUS_META[selectedAgent.status];
  const selectedCost = getAgentCost(metrics, selectedAgent.name);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[var(--bg-primary)] p-4 lg:p-6">
      <div className="flex w-full flex-col gap-4 text-[var(--text-primary)]">
        {dashboardErrorMessage && (
          <div
            className="entity-ops-panel border-[var(--error)] bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]"
            role="status"
          >
            {dashboardErrorMessage}
          </div>
        )}

        <AddAgentCreationPanel />

        <div className="border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-4 py-3">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-primary)] pb-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => onSelectAgent(null)}
                aria-label="Back to Crew"
                className="entity-ops-icon-btn h-8 w-8 min-w-8"
              >
                ←
              </button>
              <AgentAvatar avatarUrl={selectedAgent.avatarUrl} emoji={selectedAgent.emoji} name={selectedAgent.name} size="lg" />
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <div className="truncate text-xl font-semibold text-[var(--text-primary)]">{selectedAgent.name}</div>
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: statusMeta.dot }}
                    aria-hidden="true"
                  />
                </div>
                <div className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
                  Runtime · {selectedAgent.runtime || 'registry'}
                  <span className="mx-1 text-[var(--text-muted)]">·</span>
                  Model · {selectedAgent.model || 'default resolving'}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="entity-ops-chip">last {formatRelative(selectedAgent.lastActionAt)}</span>
                  <span className={`entity-ops-chip ${selectedAgent.errors > 0 ? 'entity-ops-chip-red' : 'entity-ops-chip-green'}`}>
                    {selectedAgent.errors} warnings
                  </span>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(['Chat', 'Task', 'Files', 'Plugins'] as const).map((action) => (
                <button key={action} type="button" className="mc-shell-btn px-3 py-1.5 text-xs">
                  {action}
                </button>
              ))}
              <span
                className="entity-ops-chip"
                style={{
                  borderColor: statusMeta.dot,
                  background: statusMeta.badgeBg,
                  color: statusMeta.badgeText,
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusMeta.dot }} />
                {statusMeta.label}
              </span>
              <span className="entity-ops-chip">
                Uptime: {selectedAgent.uptimeSeconds ? formatDuration(selectedAgent.uptimeSeconds) : '—'}
              </span>
              <span className="entity-ops-chip entity-ops-chip-blue font-mono">
                Cost: {formatCurrency(selectedCost)}
              </span>
              {refreshing && <span className="text-[var(--text-secondary)]">Refreshing…</span>}
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-3 border-b border-[var(--border-primary)] pb-3 text-xs">
            <span className="text-[var(--text-muted)]">Runtime</span>
            <span className="text-[var(--text-secondary)]">{selectedAgent.runtime || 'registry'}</span>
            <span className="text-[var(--text-muted)]">Model</span>
            <span className="text-[var(--text-secondary)]">{selectedAgent.model || 'default resolving'}</span>
            <span className="ml-auto text-[var(--text-muted)]">{statusMeta.label}</span>
          </div>

          <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <div className="entity-ops-panel px-3 py-2">
              <div className="entity-ops-section-title">Active Work</div>
              {selectedAgent.currentTask ? (
                <div className="mt-2">
                  <div className="line-clamp-2 text-base font-semibold text-[var(--text-primary)]">
                    {selectedAgent.currentTask.title}
                  </div>
                  <span className="mt-2 inline-flex rounded border px-1.5 py-0.5 text-[11px]" style={priorityTone(selectedAgent.currentTask.priority)}>
                    {selectedAgent.currentTask.priority}
                  </span>
                </div>
              ) : (
                <div className="mt-2 text-sm text-[var(--text-secondary)]">No active task assigned.</div>
              )}
            </div>
            <div className="entity-ops-panel px-3 py-2">
              <div className="entity-ops-section-title">Latest Activity</div>
              <div className="mt-2 line-clamp-2 text-sm text-[var(--text-primary)]">{selectedAgent.lastAction}</div>
              <div className="mt-1 font-mono text-[11px] text-[var(--text-muted)]">
                {selectedAgent.lastActionAt ? `${formatTime(selectedAgent.lastActionAt)} · ${formatRelative(selectedAgent.lastActionAt)}` : 'No timestamp'}
              </div>
            </div>
          </div>

          <div className="grid gap-0 overflow-hidden rounded-lg border border-[var(--border-primary)] sm:grid-cols-2 lg:grid-cols-6">
            <div className="entity-ops-panel px-3 py-2">
              <div className="entity-ops-section-title">Status</div>
              <div className="mt-1 text-sm font-semibold" style={{ color: statusMeta.badgeText }}>{statusMeta.label}</div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">Online</div>
            </div>
            <div className="border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="entity-ops-section-title">Tasks</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{selectedAgent.tasks}</div>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                Doing {selectedAgent.tasksDoing} · Done {selectedAgent.tasksDone}
              </div>
            </div>
            <div className="border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="entity-ops-section-title">Files</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{selectedAgent.files}</div>
            </div>
            <div className="border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="entity-ops-section-title">Messages</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{selectedAgent.messages}</div>
            </div>
            <div className="border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="entity-ops-section-title">Errors</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{selectedAgent.errors}</div>
            </div>
            <div className="border-l border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-2">
              <div className="entity-ops-section-title">Cost</div>
              <div className="mt-1 text-lg font-semibold text-[var(--text-primary)]">{formatCurrency(selectedCost)}</div>
            </div>
          </div>
        </div>

        <div className="entity-ops-panel-strong overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-primary)] px-3 py-2">
            <div>
              <div className="entity-ops-section-title">Agent Detail</div>
              <div className="mt-0.5 text-sm text-[var(--text-secondary)]">
                Management, activity, output, health, and queue for {selectedAgent.name}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
            {TAB_ITEMS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setDetailTab(tab.id)}
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  detailTab === tab.id
                    ? 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--accent)]'
                    : 'border-[var(--border-primary)] bg-[var(--surface-muted)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                }`}
              >
                {tab.label}
                <span className="ml-2 font-mono text-[10px] opacity-75">
                  {tab.id === 'activity'
                    ? selectedFeed.length
                    : tab.id === 'management'
                      ? selectedAgent.status
                      : tab.id === 'output'
                        ? outputFiles.length
                        : tab.id === 'queue'
                          ? selectedQueue.length
                          : selectedAgent.status}
                </span>
              </button>
            ))}
            </div>
          </div>

          {detailTab === 'management' && (
            <div className="p-3">
              <AgentManagementSurface
                agentId={selectedAgent.sidebarId}
                agentName={selectedAgent.name}
                runtime={selectedAgent.runtime}
                model={selectedAgent.model}
                currentTaskTitle={selectedAgent.currentTask?.title ?? null}
                runtimeStatus={selectedAgent.runtimeStatus}
                tasks={tasks}
              />
            </div>
          )}

          {detailTab === 'activity' && (
            <div className="grid min-h-[360px] lg:grid-cols-[170px_minmax(0,1fr)_300px]">
              <aside className="hidden border-r border-[var(--border-primary)] bg-[var(--bg-secondary)]/60 p-3 lg:block">
                <div className="mb-3 flex items-center justify-between">
                  <div className="entity-ops-section-title">Filters</div>
                  <button type="button" className="text-[11px] text-[var(--accent)]">Reset</button>
                </div>
                {(['Sources', 'Types', 'Origins', 'Agents', 'Date'] as const).map((label) => (
                  <label key={label} className="mb-3 block">
                    <span className="mb-1 block text-[11px] text-[var(--text-muted)]">{label}</span>
                    <select className="mc-shell-input w-full px-2 py-1.5 text-xs">
                      <option>{label === 'Date' ? 'Today' : `All ${label.toLowerCase()}`}</option>
                    </select>
                  </label>
                ))}
              </aside>
              <div className="max-h-[62vh] min-h-0 overflow-auto p-3">
                <div className="mb-3 text-xs font-medium text-[var(--text-secondary)]">
                  {new Date().toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
                {selectedFeed.length > 0 ? (
                  <div className="space-y-0">
                    {selectedFeed.map((entry) => {
                      const feedMeta = FEED_META[entry.category];
                      return (
                        <div
                          key={entry.id}
                          className="grid gap-3 border-b border-[var(--border-primary)] py-3 last:border-b-0 sm:grid-cols-[70px_1px_minmax(0,1fr)]"
                        >
                          <div className="font-mono text-xs text-[var(--text-muted)]">{formatTime(entry.timestamp)}</div>
                          <div className="relative hidden bg-[var(--border-primary)] sm:block">
                            <span className="absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full" style={{ background: feedMeta.dot }} />
                          </div>
                          <div className="min-w-0">
                            <div className="mb-1 text-sm font-medium" style={{ color: feedMeta.text }}>
                              {selectedAgent.name} · {entry.summary}
                            </div>
                            <div className="line-clamp-2 text-sm text-[var(--text-secondary)]">{entry.detail}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="entity-ops-empty px-3 py-6 text-sm">No recent activity.</div>
                )}
              </div>
              <aside className="hidden border-l border-[var(--border-primary)] bg-[var(--bg-secondary)]/60 p-3 lg:block">
                <div className="mb-3 flex border-b border-[var(--border-primary)] text-xs">
                  {(['Details', 'Context', 'Audit'] as const).map((tab) => (
                    <button key={tab} type="button" className={`px-3 py-2 ${tab === 'Details' ? 'border-b border-[var(--accent)] text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                      {tab}
                    </button>
                  ))}
                </div>
                <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2 text-xs">
                  <dt className="text-[var(--text-muted)]">Name</dt>
                  <dd className="truncate text-[var(--text-primary)]">{selectedAgent.name}</dd>
                  <dt className="text-[var(--text-muted)]">Model</dt>
                  <dd className="truncate">{selectedAgent.model}</dd>
                  <dt className="text-[var(--text-muted)]">Runtime</dt>
                  <dd className="truncate">{selectedAgent.runtime}</dd>
                  <dt className="text-[var(--text-muted)]">Status</dt>
                  <dd style={{ color: statusMeta.badgeText }}>{statusMeta.label}</dd>
                  <dt className="text-[var(--text-muted)]">Runtime state</dt>
                  <dd className="truncate">
                    {selectedAgent.runtimeStatus
                      ? `${selectedAgent.runtimeStatus.state} · ${selectedAgent.runtimeStatus.reason.replace(/_/g, ' ')}`
                      : 'Not reported'}
                  </dd>
                  <dt className="text-[var(--text-muted)]">Readiness</dt>
                  <dd className="truncate">{selectedAgent.runtimeStatus?.readiness ?? 'unknown'}</dd>
                  <dt className="text-[var(--text-muted)]">Tasks</dt>
                  <dd>{selectedAgent.tasks} total · {selectedAgent.tasksDoing} active</dd>
                  <dt className="text-[var(--text-muted)]">Last seen</dt>
                  <dd>{formatRelative(selectedAgent.health.heartbeatAt ?? selectedAgent.lastActionAt)}</dd>
                </dl>
                <div className="mt-5 border-t border-[var(--border-primary)] pt-4">
                  <div className="entity-ops-section-title">Currently Working On</div>
                  <div className="mt-3 rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-sm">
                    {selectedAgent.currentTask?.title ?? 'No active task assigned.'}
                  </div>
                </div>
              </aside>
            </div>
          )}

          {detailTab === 'output' && (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Files</div>
                {outputFiles.length > 0 ? (
                  outputFiles.map((output) => (
                    <div
                      key={output.id}
                      className="entity-ops-row px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate font-mono text-xs font-medium text-[var(--text-primary)]" title={output.filePath}>
                          {output.filePath}
                        </div>
                        <div className="font-mono text-xs text-[var(--text-secondary)]">{formatTime(output.timestamp)}</div>
                      </div>
                      <div className="mt-1 line-clamp-2 text-sm text-[var(--text-secondary)]">{output.description}</div>
                    </div>
                  ))
                ) : (
                  <div className="entity-ops-empty px-3 py-6 text-sm">
                    No file output yet.
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Tasks</div>
                {selectedTasks.length > 0 ? (
                  selectedTasks.slice(0, 20).map((task) => (
                    <div
                      key={`output-task-${task.id}`}
                      className="entity-ops-row px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]" title={task.name}>
                          {task.name}
                        </div>
                        <div className="font-mono text-xs text-[var(--text-secondary)]">{formatTime(task.updatedAt)}</div>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                        <span className="rounded border px-1.5 py-0.5" style={priorityTone(task.priority)}>
                          {task.priority}
                        </span>
                        <span className="uppercase tracking-wide" style={queueStatusTone(task.column)}>
                          {task.column}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="entity-ops-empty px-3 py-6 text-sm">
                    No task output yet.
                  </div>
                )}
              </div>
            </div>
          )}

          {detailTab === 'health' && (
            <div className="grid gap-3 lg:grid-cols-2">
              {selectedAgent.runtimeStatus && (
                <div className="entity-ops-panel px-4 py-3 lg:col-span-2">
                  <div className="mb-2 entity-ops-section-title">Helm Runtime Status</div>
                  <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <div className="text-[var(--text-muted)]">State</div>
                      <div className="mt-1 text-[var(--text-primary)]">{selectedAgent.runtimeStatus.state}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">Readiness</div>
                      <div className="mt-1 text-[var(--text-primary)]">{selectedAgent.runtimeStatus.readiness}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">Heartbeat</div>
                      <div className="mt-1 text-[var(--text-primary)]">{selectedAgent.runtimeStatus.heartbeat_at ? formatRelative(selectedAgent.runtimeStatus.heartbeat_at) : 'unknown'}</div>
                    </div>
                    <div>
                      <div className="text-[var(--text-muted)]">Reason</div>
                      <div className="mt-1 text-[var(--text-primary)]">{selectedAgent.runtimeStatus.reason.replace(/_/g, ' ')}</div>
                    </div>
                  </div>
                  {selectedAgent.runtimeStatus.helm_link && (
                    <a
                      href={selectedAgent.runtimeStatus.helm_link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex text-xs text-[var(--accent)]"
                    >
                      Open in Helm
                    </a>
                  )}
                </div>
              )}
              <div className="entity-ops-panel px-4 py-3">
                <div className="mb-2 entity-ops-section-title">Resource Load</div>
                <div className="mb-2 text-xs text-[var(--text-secondary)]">
                  CPU {selectedAgent.health.cpuLoad === null ? '—' : `${selectedAgent.health.cpuLoad}%`}
                </div>
                <div className="mb-3 h-2 rounded bg-[var(--bg-tertiary)]">
                  <div
                    className="h-2 rounded bg-[var(--accent)]"
                    style={{ width: `${boundedPercent(selectedAgent.health.cpuLoad)}%` }}
                  />
                </div>
                <div className="mb-2 text-xs text-[var(--text-secondary)]">
                  Memory {selectedAgent.health.memoryLoad === null ? '—' : `${selectedAgent.health.memoryLoad}%`}
                </div>
                <div className="h-2 rounded bg-[var(--bg-tertiary)]">
                  <div
                    className="h-2 rounded bg-[var(--success)]"
                    style={{ width: `${boundedPercent(selectedAgent.health.memoryLoad)}%` }}
                  />
                </div>
              </div>
              <div className="entity-ops-panel px-4 py-3">
                <div className="mb-2 entity-ops-section-title">Runtime Health</div>
                <div className="grid gap-2 text-sm text-[var(--text-secondary)] sm:grid-cols-2">
                  <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/35 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">WebSocket</div>
                    {wsConnected ? <span className="text-[var(--success)]">Connected</span> : <span className="text-[var(--error)]">Disconnected</span>}
                  </div>
                  <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/35 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Queue depth</div>
                    {selectedAgent.health.queueDepth ?? '—'}
                  </div>
                  <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/35 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Restarts</div>
                    {selectedAgent.health.restarts ?? '—'}
                  </div>
                  <div className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)]/35 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Heartbeat</div>
                    {selectedAgent.health.heartbeatAt ? formatRelative(selectedAgent.health.heartbeatAt) : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {detailTab === 'queue' && (
            <div className="space-y-2">
              {selectedQueue.length > 0 ? (
                selectedQueue.map((item) => (
                  <div key={item.id} className="entity-ops-row px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-[var(--text-primary)]">{item.title}</div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="rounded border px-1.5 py-0.5" style={priorityTone(item.priority)}>
                          {item.priority}
                        </span>
                        <span className="uppercase tracking-wide" style={queueStatusTone(item.column)}>
                          {queueStatusLabel(item.column)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-muted)]">{item.id}</div>
                  </div>
                ))
              ) : (
                <div className="entity-ops-empty px-3 py-6 text-sm">
                  No queued tasks.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
