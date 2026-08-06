import path from "path";
import type { Request } from "express";
import { TASK_COLUMNS, type ActivityEventPayload, type TaskRecord } from "../../../db/src";
import { getCustomerPrincipal } from "../principals/request-context";

const TASK_COLUMN_SET = new Set<string>(TASK_COLUMNS);

export function capitalizeColumn(column: string): string {
  return column.charAt(0).toUpperCase() + column.slice(1);
}


export function parsePositiveId(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  return null;
}



export function buildTaskPreview(input: {
  id?: number;
  name: string;
  description?: string | null;
  brief?: string | null;
  origin_channel?: string | null;
  column?: string | null;
  model?: string | null;
  archived?: boolean;
  assignee?: string | null;
  blocked?: boolean;
  blocker_reason?: string | null;
  due_date?: string | null;
  priority?: string | null;
  estimate_hours?: number | null;
  time_spent?: number | null;
  output?: string | null;
  progress_status?: string | null;
  recurring?: boolean;
  recurring_config?: string | null;
  metadata?: string | null;
  created_at?: string;
  updated_at?: string;
}): TaskRecord {
  const now = new Date().toISOString();
  const normalizedColumn =
    typeof input.column === "string" &&
    TASK_COLUMN_SET.has(input.column.toLowerCase())
      ? input.column.toLowerCase()
      : "backlog";

  return {
    id: input.id ?? 0,
    name: input.name,
    description: input.description ?? null,
    brief: input.brief ?? null,
    origin_channel: input.origin_channel ?? null,
    column: normalizedColumn as TaskRecord["column"],
    model: input.model ?? null,
    archived: input.archived ?? false,
    assignee: input.assignee ?? null,
    blocked: input.blocked ?? false,
    blocker_reason: input.blocker_reason ?? null,
    due_date: input.due_date ?? null,
    priority: input.priority ?? null,
    estimate_hours: input.estimate_hours ?? null,
    time_spent: input.time_spent ?? null,
    output: input.output ?? null,
    progress_status: input.progress_status ?? null,
    recurring: input.recurring ?? false,
    recurring_config: input.recurring_config ?? null,
    created_at: input.created_at ?? now,
    updated_at: input.updated_at ?? now,
    metadata: input.metadata ?? null,
  };
}

export function parsePositiveIdList(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const ids: number[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    const parsed = parsePositiveId(item);
    if (!parsed) {
      return null;
    }

    if (seen.has(parsed)) {
      continue;
    }

    seen.add(parsed);
    ids.push(parsed);
  }

  return ids;
}

export function statusForStrategicError(message: string): number {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("not found")) {
    return 404;
  }

  if (
    normalized.includes("required") ||
    normalized.includes("must be") ||
    normalized.includes("cannot be") ||
    normalized.includes("invalid")
  ) {
    return 400;
  }

  return 500;
}

export function isValidTaskColumn(value: unknown): value is string {
  return typeof value === "string" && TASK_COLUMN_SET.has(value.toLowerCase());
}

export function normalizeBlockedInput(value: unknown): boolean | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }

  return undefined;
}

export function normalizeBlockerReasonInput(value: unknown): string | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : "";
}


export function parseTaskMetadataRecord(
  metadata: string | null | undefined,
): Record<string, unknown> {
  if (typeof metadata !== "string") {
    return {};
  }

  const trimmed = metadata.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore malformed metadata
  }

  return {};
}

export function readParentTaskId(metadata: string | null | undefined): number | null {
  const record = parseTaskMetadataRecord(metadata);
  const candidate = Number(
    record.parent_task_id ?? record.parentTaskId ?? record.parent_id,
  );
  if (!Number.isInteger(candidate) || candidate <= 0) {
    return null;
  }
  return candidate;
}

export function enrichTasksWithSubtaskSummary<
  T extends { id: number; metadata: string | null; column: string },
>(
  tasks: T[],
): Array<
  T & {
    parent_task_id: number | null;
    subtask_count: number;
    subtask_done_count: number;
  }
> {
  const childrenByParent = new Map<number, { total: number; done: number }>();

  for (const task of tasks) {
    const parentId = readParentTaskId(task.metadata);
    if (!parentId) {
      continue;
    }
    const entry = childrenByParent.get(parentId) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (task.column === "done") {
      entry.done += 1;
    }
    childrenByParent.set(parentId, entry);
  }

  return tasks.map((task) => {
    const summary = childrenByParent.get(task.id) ?? { total: 0, done: 0 };
    return {
      ...task,
      parent_task_id: readParentTaskId(task.metadata),
      subtask_count: summary.total,
      subtask_done_count: summary.done,
    };
  });
}

export function deriveSubtaskBreakdown(parentTask: {
  name: string;
  description: string | null;
  metadata: string | null;
}): string[] {
  const sourceText =
    `${parentTask.name}\n${parentTask.description ?? ""}`.trim();
  if (!sourceText) {
    return [];
  }

  const bulletMatches = Array.from(
    sourceText.matchAll(
      /(?:^|\n)\s*(?:[-*•]|\d+[.)])\s+(.+?)(?=$|\n\s*(?:[-*•]|\d+[.)])\s+)/gms,
    ),
  )
    .map((entry) => entry[1]?.trim())
    .filter((entry): entry is string => Boolean(entry && entry.length >= 8));

  if (bulletMatches.length >= 2) {
    return bulletMatches.slice(0, 8);
  }

  const sentenceMatches = sourceText
    .split(/(?<=[.!?])\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 12)
    .slice(0, 6);

  if (sentenceMatches.length >= 2) {
    return sentenceMatches.map((entry, index) => `Step ${index + 1}: ${entry}`);
  }

  return [
    `Clarify scope and acceptance criteria for: ${parentTask.name}`,
    `Implement core work for: ${parentTask.name}`,
    `Validate and attach output evidence for: ${parentTask.name}`,
  ];
}

export function mergeTaskMetadataWithParentLink(
  metadata: string | null | undefined,
  parentTaskId: number,
): string {
  const record = parseTaskMetadataRecord(metadata);
  const nextRecord: Record<string, unknown> = {
    ...record,
    parent_task_id: parentTaskId,
  };
  return JSON.stringify(nextRecord);
}


export function withReceiptArtifactRef(
  payload: ActivityEventPayload,
  artifactId: string | null | undefined,
  contentHash?: string,
): ActivityEventPayload {
  if (!artifactId) return payload;
  const objectRefs = Array.isArray(payload.object_refs)
    ? [...payload.object_refs]
    : [];
  objectRefs.push({
    object_type: "evidence_artifact",
    object_id: artifactId,
    link_role: "receipt",
  });
  return {
    ...payload,
    object_refs: objectRefs,
    data: {
      ...(payload.data && typeof payload.data === "object" && !Array.isArray(payload.data)
        ? payload.data
        : {}),
      receipt_artifact_id: artifactId,
      receipt_content_hash: contentHash,
    },
  };
}


export function getTaskActorFromRequest(
  req: Request,
  fallback = "Human",
): string {
  // Server-resolved customer principal wins for durable actor attribution
  // (Terra B2): a caller-supplied X-Entity-Actor / X-Agent-Name / body actor
  // MUST NOT grant authority or determine durable attribution. The trusted
  // service/admin path (no customer credential) keeps the historical header
  // convention (PR #71/#72 preserved).
  const customer = getCustomerPrincipal(req);
  if (customer) {
    return customer.principalId;
  }
  const entityActor = req.header("X-Entity-Actor");
  if (typeof entityActor === "string" && entityActor.trim()) {
    return entityActor.trim();
  }
  const agentName = req.header("X-Agent-Name");
  if (typeof agentName === "string" && agentName.trim()) {
    return agentName.trim();
  }
  const bodyActor = req.body?.actor;
  if (typeof bodyActor === "string" && bodyActor.trim()) {
    return bodyActor.trim();
  }
  return fallback;
}


export function parseTaskId(value: string): number | null {
  return parsePositiveId(value);
}


export function normalizeBooleanFlag(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (typeof value === "undefined") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }

  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }

  return fallback;
}


export function createWorkspaceRelativePath(workspaceRoot: string): (filePath: string) => string {
  return function toWorkspaceRelativePath(filePath: string): string {
    if (!path.isAbsolute(filePath)) {
      return filePath;
    }

    const relativePath = path.relative(workspaceRoot, filePath);
    if (relativePath.startsWith("..")) {
      return filePath;
    }

    return relativePath || path.basename(filePath);
  };
}
