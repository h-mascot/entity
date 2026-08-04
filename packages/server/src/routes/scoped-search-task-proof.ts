import {
  getWorktypeRegistryEntry,
  type EvidenceArtifactRecord,
  type TaskRecord,
} from '../../../db/src';
import type { RequestOrgBinding } from '../request-permissions';
import {
  keywordScore,
  permissionSafeResult,
  type RankedSearchResult,
  type ScopedSearchResult,
} from './scoped-search-documents';

export interface TaskProofSearchFilters {
  teamId?: string;
  projectId?: number;
  state?: string;
  sensitivity?: string;
  worktype?: string;
  ownerId?: string;
  assigneeId?: string;
  initiatorId?: string;
  reviewState?: string;
  risk?: string;
  from?: string;
  to?: string;
}

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function policyJson(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
  }
  return null;
}

function includesQuery(query: string, values: unknown[]): boolean {
  const needle = query.toLowerCase();
  return values
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(needle));
}

function withinDates(updatedAt: string, filters: TaskProofSearchFilters): boolean {
  const timestamp = Date.parse(updatedAt);
  if (filters.from && timestamp < Date.parse(filters.from)) return false;
  if (filters.to && timestamp > Date.parse(filters.to)) return false;
  return true;
}

function taskProjectIds(task: TaskRecord): string[] {
  const ids = new Set<string>();
  if (task.project_id) ids.add(String(task.project_id));
  for (const project of task.projects ?? []) ids.add(String(project.id));
  return [...ids];
}

function nestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function combineSensitivities(...values: Array<string | null | undefined>): string | null {
  const combined = [...new Set(values
    .flatMap((value) => value?.split(',') ?? [])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean))];
  return combined.length > 0 ? combined.join(', ') : null;
}

function taskSensitivity(task: TaskRecord, metadata: Record<string, unknown>): string | null {
  const policyInputs = parseRecord(task.policy_inputs_json);
  const layers = Object.keys(nestedRecord(policyInputs, 'layers')).length > 0
    ? nestedRecord(policyInputs, 'layers')
    : policyInputs;
  const policySensitivities = [
    readString(policyInputs, 'sensitivity', 'sensitivity_class'),
    ...['workspace', 'org', 'team', 'project', 'worktype', 'task', 'risk']
      .map((layer) => readString(nestedRecord(layers, layer), 'sensitivity', 'sensitivity_class')),
  ];
  return combineSensitivities(
    readString(metadata, 'sensitivity', 'sensitivity_class'),
    ...policySensitivities,
    getWorktypeRegistryEntry(task.worktype)?.sensitivity,
  );
}

function sensitivityMatches(value: string | null, requested: string | undefined): boolean {
  if (!requested) return true;
  return value?.split(',').some((entry) =>
    entry.trim().toLowerCase() === requested.toLowerCase()
  ) ?? false;
}

function hasDisclosureSensitiveFilters(filters: TaskProofSearchFilters): boolean {
  return Boolean(
    filters.teamId
    || filters.projectId
    || filters.state
    || filters.sensitivity
    || filters.worktype
    || filters.ownerId
    || filters.assigneeId
    || filters.initiatorId
    || filters.reviewState
    || filters.risk
    || filters.from
    || filters.to,
  );
}

export function taskTitleMatchesQuery(task: TaskRecord, query: string): boolean {
  return includesQuery(query, [task.name]);
}

function taskMatches(
  task: TaskRecord,
  filters: TaskProofSearchFilters,
): boolean {
  const metadata = parseRecord(task.metadata);
  const projects = taskProjectIds(task);
  const sensitivity = taskSensitivity(task, metadata);
  return (!filters.teamId || task.team_id === filters.teamId)
    && (!filters.projectId || projects.includes(String(filters.projectId)))
    && (!filters.state || task.column === filters.state)
    && sensitivityMatches(sensitivity, filters.sensitivity)
    && (!filters.worktype || task.worktype === filters.worktype)
    && (!filters.ownerId || task.owner_principal_id === filters.ownerId)
    && (!filters.assigneeId || task.assignee === filters.assigneeId || task.executor_principal_id === filters.assigneeId)
    && (!filters.initiatorId || task.initiator_principal_id === filters.initiatorId)
    && (!filters.reviewState || task.review_state === filters.reviewState)
    && (!filters.risk || task.risk_level === filters.risk)
    && withinDates(task.updated_at, filters);
}

export function taskResults(
  binding: RequestOrgBinding,
  query: string,
  tasks: TaskRecord[],
  filters: TaskProofSearchFilters,
): RankedSearchResult[] {
  return tasks
    .filter((task) => task.org_id === binding.orgId)
    .filter((task) => taskMatches(task, filters))
    .map((task) => {
      const metadata = parseRecord(task.metadata);
      const sensitivity = taskSensitivity(task, metadata);
      const aclJson = policyJson(metadata, 'acl_json', 'acl');
      const visibilityJson = policyJson(metadata, 'entity_visibility_policy_json', 'entity_visibility_policy');
      const description = task.description?.trim() || task.brief?.trim() || null;
      const result: ScopedSearchResult = {
        objectType: 'task',
        objectId: String(task.id),
        title: task.name,
        snippet: description ? description.slice(0, 280) : null,
        // Workplane owns `/workplane/:taskId`; the scoped-search envelope is
        // org-scoped, so this deep link only routes within the bound org's tasks.
        deepLink: { route: `/workplane/${task.id}` },
        scope: {
          orgId: task.org_id ?? binding.orgId,
          teamId: task.team_id ?? null,
          projectIds: taskProjectIds(task),
        },
        state: task.column,
        reviewState: task.review_state ?? null,
        sensitivity,
        permission: { state: 'visible', reasons: [] },
        provenance: {
          backend: 'tasks',
          sourceId: task.origin_channel,
          indexed: false,
          indexedAt: null,
          lagSeconds: null,
          canonical: true,
          mutability: 'mutable',
        },
        ranking: { score: keywordScore(query, task.name), basis: 'keyword' },
      };
      const safe = permissionSafeResult(binding, {
        object_type: 'task',
        object_id: task.id,
        org_id: task.org_id,
        team_id: task.team_id,
        project_id: task.project_id,
        title: task.name,
        snippet: description,
        sensitivity,
        acl_json: aclJson,
        entity_visibility_policy_json: visibilityJson,
      }, result, [visibilityJson, aclJson]);
      if (
        !safe
        || (safe.permission.state === 'restricted' && hasDisclosureSensitiveFilters(filters))
        || !includesQuery(query, safe.permission.state === 'restricted'
        ? [task.name]
        : [task.name, task.description, task.brief, task.project, task.worktype]
        )
      ) {
        return null;
      }
      return safe ? {
        result: safe,
        recencyMs: safe.permission.state === 'restricted' ? 0 : Date.parse(task.updated_at) || 0,
      } : null;
    })
    .filter((entry): entry is RankedSearchResult => Boolean(entry));
}

export function taskMatchesProofOriginFilters(
  task: TaskRecord,
  filters: TaskProofSearchFilters,
): boolean {
  const metadata = parseRecord(task.metadata);
  const projects = taskProjectIds(task);
  return (!filters.teamId || task.team_id === filters.teamId)
    && (!filters.projectId || projects.includes(String(filters.projectId)))
    && sensitivityMatches(taskSensitivity(task, metadata), filters.sensitivity)
    && (!filters.worktype || task.worktype === filters.worktype)
    && (!filters.ownerId || task.owner_principal_id === filters.ownerId)
    && (!filters.assigneeId || task.assignee === filters.assigneeId || task.executor_principal_id === filters.assigneeId)
    && (!filters.initiatorId || task.initiator_principal_id === filters.initiatorId)
    && (!filters.reviewState || task.review_state === filters.reviewState)
    && (!filters.risk || task.risk_level === filters.risk);
}

function proofMatchesOriginTask(
  artifact: EvidenceArtifactRecord,
  task: TaskRecord | undefined,
  filters: TaskProofSearchFilters,
): boolean {
  const effectiveTeamId = artifact.team_id ?? task?.team_id ?? null;
  const effectiveProjectIds = artifact.project_id
    ? [String(artifact.project_id)]
    : task
      ? taskProjectIds(task)
      : [];
  if (filters.teamId && effectiveTeamId !== filters.teamId) return false;
  if (filters.projectId && !effectiveProjectIds.includes(String(filters.projectId))) return false;
  const usesOriginTaskFilter = Boolean(
    filters.worktype
    || filters.ownerId
    || filters.assigneeId
    || filters.initiatorId
    || filters.reviewState
    || filters.risk,
  );
  if (!usesOriginTaskFilter) return true;
  if (!task) return false;
  return (!filters.worktype || task.worktype === filters.worktype)
    && (!filters.ownerId || task.owner_principal_id === filters.ownerId)
    && (!filters.assigneeId || task.assignee === filters.assigneeId || task.executor_principal_id === filters.assigneeId)
    && (!filters.initiatorId || task.initiator_principal_id === filters.initiatorId)
    && (!filters.reviewState || task.review_state === filters.reviewState)
    && (!filters.risk || task.risk_level === filters.risk);
}

export function proofResults(
  binding: RequestOrgBinding,
  query: string,
  artifacts: EvidenceArtifactRecord[],
  tasksById: Map<number, TaskRecord>,
  filters: TaskProofSearchFilters,
): RankedSearchResult[] {
  return artifacts
    .filter((artifact) => artifact.org_id === binding.orgId)
    .filter((artifact) => {
      const task = artifact.origin_task_id ? tasksById.get(artifact.origin_task_id) : undefined;
      const metadata = parseRecord(artifact.metadata_json);
      const taskMetadata = task ? parseRecord(task.metadata) : {};
      const sensitivity = combineSensitivities(
        readString(metadata, 'sensitivity', 'sensitivity_class'),
        task ? taskSensitivity(task, taskMetadata) : null,
      );
      return (!artifact.origin_task_id || Boolean(task))
        && proofMatchesOriginTask(artifact, task, filters)
        && (!filters.state || artifact.availability_state === filters.state)
        && sensitivityMatches(sensitivity, filters.sensitivity)
        && withinDates(artifact.updated_at, filters);
    })
    .map((artifact) => {
      const task = artifact.origin_task_id ? tasksById.get(artifact.origin_task_id) : undefined;
      const metadata = parseRecord(artifact.metadata_json);
      const taskMetadata = task ? parseRecord(task.metadata) : {};
      const artifactSensitivity = readString(metadata, 'sensitivity', 'sensitivity_class');
      const sensitivity = combineSensitivities(
        artifactSensitivity,
        task ? taskSensitivity(task, taskMetadata) : null,
      );
      const aclJson = policyJson(metadata, 'acl_json', 'acl');
      const visibilityJson = policyJson(metadata, 'entity_visibility_policy_json', 'entity_visibility_policy');
      const taskAclJson = policyJson(taskMetadata, 'acl_json', 'acl');
      const taskVisibilityJson = policyJson(
        taskMetadata,
        'entity_visibility_policy_json',
        'entity_visibility_policy',
      );
      const objectType = artifact.artifact_kind === 'raw_task_receipt' ? 'receipt' : 'evidence_artifact';
      const result: ScopedSearchResult = {
        objectType,
        objectId: artifact.id,
        title: artifact.title,
        snippet: null,
        // Route proof artifacts to their origin task's Workplane view when known.
        deepLink: artifact.origin_task_id ? { route: `/workplane/${artifact.origin_task_id}` } : null,
        scope: {
          orgId: artifact.org_id,
          teamId: artifact.team_id ?? task?.team_id ?? null,
          projectIds: artifact.project_id
            ? [String(artifact.project_id)]
            : task
              ? taskProjectIds(task)
              : [],
        },
        state: artifact.availability_state,
        reviewState: task?.review_state ?? null,
        sensitivity,
        permission: { state: 'visible', reasons: [] },
        provenance: {
          backend: 'proofs',
          sourceId: artifact.artifact_kind,
          indexed: false,
          indexedAt: null,
          lagSeconds: null,
          canonical: true,
          mutability: artifact.mutability_policy === 'editable_versioned'
            ? 'editable_versioned'
            : 'immutable',
        },
        ranking: { score: keywordScore(query, artifact.title), basis: 'keyword' },
      };
      const artifactSafe = permissionSafeResult(binding, {
        object_type: 'evidence_artifact',
        object_id: artifact.id,
        org_id: artifact.org_id,
        team_id: artifact.team_id ?? task?.team_id,
        project_id: artifact.project_id ?? task?.project_id,
        title: artifact.title,
        sensitivity: artifactSensitivity,
        acl_json: aclJson,
        entity_visibility_policy_json: visibilityJson,
      }, result, [visibilityJson, aclJson]);
      const taskSafe = task ? permissionSafeResult(binding, {
        object_type: 'task',
        object_id: task.id,
        org_id: task.org_id,
        team_id: task.team_id,
        project_id: task.project_id,
        title: task.name,
        sensitivity: taskSensitivity(task, taskMetadata),
        acl_json: taskAclJson,
        entity_visibility_policy_json: taskVisibilityJson,
      }, result, [taskVisibilityJson, taskAclJson]) : result;
      if (!artifactSafe || !taskSafe) return null;
      const safe = artifactSafe.permission.state === 'restricted' ? artifactSafe : taskSafe;
      if (
        (safe.permission.state === 'restricted' && hasDisclosureSensitiveFilters(filters))
        || !includesQuery(query, safe.permission.state === 'restricted'
        ? [artifact.title]
        : [artifact.title, artifact.artifact_kind, artifact.human_path_alias, task?.name]
        )
      ) {
        return null;
      }
      return safe ? {
        result: safe,
        recencyMs: safe.permission.state === 'restricted' ? 0 : Date.parse(artifact.updated_at) || 0,
      } : null;
    })
    .filter((entry): entry is RankedSearchResult => Boolean(entry));
}

export function observeProofHealth(artifacts: EvidenceArtifactRecord[]): {
  degradedReasons: string[];
  unknownReasons: string[];
} {
  const degradedReasons = new Set<string>();
  const unknownReasons = new Set<string>();
  for (const artifact of artifacts) {
    if (artifact.integrity_state === 'unknown') unknownReasons.add('proof_integrity_unknown');
    else if (artifact.integrity_state !== 'valid') degradedReasons.add('proof_integrity_degraded');
    if (artifact.availability_state === 'unknown') unknownReasons.add('proof_availability_unknown');
    else if (artifact.availability_state !== 'available') degradedReasons.add('proof_availability_degraded');
  }
  return { degradedReasons: [...degradedReasons], unknownReasons: [...unknownReasons] };
}
