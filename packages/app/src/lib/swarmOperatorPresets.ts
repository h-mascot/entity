/**
 * THE-898 / EEPC-B-03 — Operator presets for Swarm dispatch using contract.
 *
 * Builds selectable dispatch presets from the EEPC-B-01 public execution-engine
 * list. Presets respect acceptsDispatch / execution mode from the contract and
 * never surface secret-shaped health diagnostics.
 */

import {
  containsSecretShapedValue,
  normalizeExecutionEngineListItem,
  redactExecutionEngineMessage,
  type PublicExecutionEngineListItem,
} from './executionEnginePublicHealth.ts';

export type SwarmOperatorPresetAvailability =
  | 'ready'
  | 'degraded'
  | 'refuses_dispatch'
  | 'unknown';

export interface SwarmOperatorPreset {
  /** Stable preset id (engine name). */
  id: string;
  /** Provider name sent on create/dispatch. */
  provider: string;
  label: string;
  description: string;
  executionMode: string | null;
  category: string | null;
  acceptsDispatch: boolean;
  /** True when contract accepts dispatch (operator may select for create). */
  selectable: boolean;
  /** True when selectable and public health reports available. */
  ready: boolean;
  availability: SwarmOperatorPresetAvailability;
  /** Short operator-facing status (redacted). */
  statusLabel: string;
  healthMessage: string | null;
  /** Create-job default: auto-dispatch when contract accepts dispatch. */
  autoDispatch: boolean;
}

export interface SwarmDispatchCreatePayload {
  provider: string;
  auto_dispatch: boolean;
  task_id?: number;
  summary?: string;
  spec?: string;
}

function readMode(engine: PublicExecutionEngineListItem): string | null {
  const mode = engine.executionMode ?? engine.mode ?? engine.meta?.executionMode;
  return typeof mode === 'string' && mode.trim() ? mode.trim() : null;
}

function describeMode(mode: string | null): string {
  switch (mode) {
    case 'push':
      return 'Push dispatch — Entity sends work to the runner.';
    case 'pull':
      return 'Pull dispatch — job is queued for a runner claim.';
    case 'hybrid':
      return 'Hybrid dispatch — queue/API with optional polling.';
    case 'stub':
      return 'Stub engine — dispatch is not accepted.';
    default:
      return 'Contract-backed execution engine.';
  }
}

function availabilityFor(args: {
  acceptsDispatch: boolean;
  healthAvailable: boolean;
  healthKnown: boolean;
}): SwarmOperatorPresetAvailability {
  if (!args.acceptsDispatch) return 'refuses_dispatch';
  if (!args.healthKnown) return 'unknown';
  return args.healthAvailable ? 'ready' : 'degraded';
}

function statusLabelFor(availability: SwarmOperatorPresetAvailability): string {
  switch (availability) {
    case 'ready':
      return 'Ready';
    case 'degraded':
      return 'Degraded';
    case 'refuses_dispatch':
      return 'No dispatch';
    case 'unknown':
      return 'Health unknown';
  }
}

/**
 * Project public execution engines into operator dispatch presets.
 * Stub / non-dispatch engines remain visible but not selectable.
 */
export function buildSwarmOperatorPresets(
  engines: PublicExecutionEngineListItem[] | null | undefined,
): SwarmOperatorPreset[] {
  if (!Array.isArray(engines) || engines.length === 0) return [];

  const presets: SwarmOperatorPreset[] = [];
  const seen = new Set<string>();

  for (const raw of engines) {
    if (!raw || typeof raw !== 'object' || typeof raw.name !== 'string' || !raw.name.trim()) {
      continue;
    }
    const name = raw.name.trim();
    if (seen.has(name)) continue;
    seen.add(name);

    const normalized = normalizeExecutionEngineListItem(raw);
    const acceptsDispatch = Boolean(normalized.acceptsDispatch);
    const healthKnown = raw.health != null && typeof raw.health === 'object';
    const healthAvailable = Boolean(normalized.health.available);
    const availability = availabilityFor({ acceptsDispatch, healthAvailable, healthKnown });
    const mode = readMode(normalized);
    const description =
      (typeof normalized.description === 'string' && normalized.description.trim()
        ? normalized.description.trim()
        : describeMode(mode)) || describeMode(mode);

    const healthMessage =
      redactExecutionEngineMessage(normalized.health.message) ??
      (availability === 'unknown' ? 'Health unknown' : null);

    const preset: SwarmOperatorPreset = {
      id: name,
      provider: name,
      label: normalized.label || name,
      description,
      executionMode: mode,
      category: typeof normalized.category === 'string' ? normalized.category : null,
      acceptsDispatch,
      selectable: acceptsDispatch,
      ready: acceptsDispatch && healthAvailable,
      availability,
      statusLabel: statusLabelFor(availability),
      healthMessage,
      autoDispatch: acceptsDispatch,
    };

    // Defense-in-depth: never emit secret-shaped operator text.
    if (containsSecretShapedValue(preset.healthMessage) || containsSecretShapedValue(preset.description)) {
      preset.healthMessage = preset.healthMessage
        ? redactExecutionEngineMessage(preset.healthMessage) ?? '[redacted]'
        : null;
      if (containsSecretShapedValue(preset.description)) {
        preset.description = describeMode(mode);
      }
    }

    presets.push(preset);
  }

  return presets.sort((a, b) => {
    const rank = (p: SwarmOperatorPreset) => {
      if (p.ready) return 0;
      if (p.selectable && p.availability === 'degraded') return 1;
      if (p.selectable) return 2;
      return 3;
    };
    const diff = rank(a) - rank(b);
    if (diff !== 0) return diff;
    return a.label.localeCompare(b.label);
  });
}

/** Prefer a ready selectable preset; else first selectable; else null. */
export function selectDefaultSwarmOperatorPreset(
  presets: SwarmOperatorPreset[],
  preferredProvider?: string | null,
): SwarmOperatorPreset | null {
  if (!presets.length) return null;
  if (preferredProvider) {
    const preferred = presets.find((p) => p.provider === preferredProvider && p.selectable);
    if (preferred) return preferred;
  }
  return (
    presets.find((p) => p.ready) ??
    presets.find((p) => p.selectable) ??
    null
  );
}

export function findSwarmOperatorPreset(
  presets: SwarmOperatorPreset[],
  provider: string | null | undefined,
): SwarmOperatorPreset | null {
  if (!provider) return null;
  return presets.find((p) => p.provider === provider) ?? null;
}

/**
 * Build the Swarm create-job body for a selected operator preset.
 * Refuses non-selectable presets (stub / acceptsDispatch=false).
 */
export function buildSwarmDispatchPayload(
  preset: SwarmOperatorPreset,
  input: { taskId?: number | null; summary?: string; spec?: string },
): SwarmDispatchCreatePayload {
  if (!preset.selectable || !preset.acceptsDispatch) {
    throw new Error(`Engine "${preset.provider}" refuses dispatch under execution-engine contract`);
  }

  const payload: SwarmDispatchCreatePayload = {
    provider: preset.provider,
    auto_dispatch: preset.autoDispatch,
  };

  if (typeof input.taskId === 'number' && Number.isFinite(input.taskId) && input.taskId > 0) {
    payload.task_id = Math.trunc(input.taskId);
  }

  const summary = input.summary?.trim();
  if (summary) payload.summary = summary;

  const spec = input.spec?.trim();
  if (spec) payload.spec = spec;

  return payload;
}

/** Selectable presets only — used by the SwarmBoard picker. */
export function listSelectableSwarmOperatorPresets(
  presets: SwarmOperatorPreset[],
): SwarmOperatorPreset[] {
  return presets.filter((p) => p.selectable);
}
