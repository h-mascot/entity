import { HttpRequestError, buildApiCandidates, requestJsonWithFallback } from '../../lib/http.ts';

export const MC_PROJECT_TAG_NAMES = ['Soteria', 'Curacel', 'Personal', 'Moltbot'] as const;

const PROJECT_TAG_ORDER = new Map(MC_PROJECT_TAG_NAMES.map((name, index) => [name.toLowerCase(), index]));

export interface ProjectOption {
  id: number;
  name: string;
  color: string | null;
  created_at?: string | null;
  project_key?: string | null;
  work_domain?: string | null;
}

interface ProjectOptionSelection {
  includeWorkDomains?: readonly string[];
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

export function normalizeProjectOption(raw: unknown): ProjectOption | null {
  const record = toRecord(raw);
  if (!record) {
    return null;
  }

  const id = normalizePositiveInteger(record.id);
  const name = readNonEmptyString(record.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    color: readNonEmptyString(record.color),
    created_at: readNonEmptyString(record.created_at),
    project_key: readNonEmptyString(record.project_key),
    work_domain: readNonEmptyString(record.work_domain),
  };
}

function compareProjectOptions(left: ProjectOption, right: ProjectOption): number {
  const leftOrder = PROJECT_TAG_ORDER.get(left.name.toLowerCase());
  const rightOrder = PROJECT_TAG_ORDER.get(right.name.toLowerCase());

  if (typeof leftOrder === 'number' || typeof rightOrder === 'number') {
    if (typeof leftOrder !== 'number') {
      return 1;
    }
    if (typeof rightOrder !== 'number') {
      return -1;
    }
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
  }

  return left.name.localeCompare(right.name);
}

export function sortProjectOptions(projects: ProjectOption[]): ProjectOption[] {
  return [...projects].sort(compareProjectOptions);
}

export function selectMissionControlProjectOptions(
  payload: unknown[],
  selection: ProjectOptionSelection = {},
): ProjectOption[] {
  const allowedTags = new Set(MC_PROJECT_TAG_NAMES.map((name) => name.toLowerCase()));
  const includedDomains = new Set(selection.includeWorkDomains ?? []);
  const projects = payload
    .map(normalizeProjectOption)
    .filter((project): project is ProjectOption => project !== null)
    .filter(
      (project) =>
        allowedTags.has(project.name.toLowerCase()) ||
        (project.work_domain !== null &&
          project.work_domain !== undefined &&
          includedDomains.has(project.work_domain)),
    );

  return sortProjectOptions(projects);
}

export async function fetchProjectOptions(
  apiBase: string,
  selection: ProjectOptionSelection = {},
): Promise<ProjectOption[]> {
  try {
    const payload = await requestJsonWithFallback({
      urls: buildApiCandidates('/projects', apiBase),
      init: { method: 'GET' },
      continueOnStatuses: [],
      fallbackError: 'Unable to load projects.',
    });

    if (!Array.isArray(payload)) {
      return [];
    }

    return selectMissionControlProjectOptions(payload, selection);
  } catch (error) {
    if (error instanceof HttpRequestError && error.status === 404) {
      return [];
    }

    throw error;
  }
}
