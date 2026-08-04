/**
 * EEPC-A-02 — Execution-engine plugin manifest types.
 *
 * Pure contract surface for Swarm/Codex/eforge/stub providers.
 * No runtime registration or dispatch wiring lives here.
 */

import type { SwarmJobStatus } from '../types';
import type { RunState } from '../providers/interface';

/** Manifest document schema version (not adapter version). */
export const EXECUTION_ENGINE_MANIFEST_SCHEMA_VERSION = '1.0.0' as const;

export const EXECUTION_ENGINE_KIND = 'execution-engine' as const;

export const EXECUTION_MODES = ['push', 'pull', 'hybrid', 'stub'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

export const PROVIDER_CATEGORIES = [
  'orchestration',
  'build-system',
  'delivery-control-plane',
  'environment',
] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export const LIFECYCLE_CAPABILITIES = [
  'dispatch',
  'status',
  'cancel',
  'collectProof',
  'claimCallback',
  'releaseCallback',
  'proofCallback',
  'completeCallback',
  'failCallback',
] as const;
export type LifecycleCapability = (typeof LIFECYCLE_CAPABILITIES)[number];

export const CALLBACK_EVENTS = [
  'claim',
  'release',
  'status',
  'proof',
  'complete',
  'fail',
  'plan',
  'progress',
  'blocker',
] as const;
export type CallbackEvent = (typeof CALLBACK_EVENTS)[number];

export const ACTIVITY_EVENT_KINDS = [
  'plan',
  'progress',
  'log',
  'proof',
  'status',
  'blocker',
] as const;
export type ActivityEventKind = (typeof ACTIVITY_EVENT_KINDS)[number];

export const CONFIG_SOURCES = ['env', 'plugin_settings'] as const;
export type ConfigSource = (typeof CONFIG_SOURCES)[number];

export const PUBLIC_HEALTH_FIELDS = [
  'available',
  'latencyMs',
  'message',
] as const;
export type PublicHealthField = (typeof PUBLIC_HEALTH_FIELDS)[number];

export interface ExecutionEngineIdentity {
  /** Stable namespaced id, e.g. `swarm.acp`. */
  id: string;
  /** Provider key stored on `swarm_jobs.provider`. */
  name: string;
  /** Operator-facing label. */
  label: string;
  /** Adapter/plugin semver (not schema version). */
  version: string;
  category: ProviderCategory;
  description?: string;
}

export interface ExecutionContract {
  mode: ExecutionMode;
  /** Dispatcher must refuse dispatch when false. */
  acceptsDispatch: boolean;
  /** Entity should poll provider.status / collectProof (push path). */
  entityPollsProvider: boolean;
  /** Runner claims work via tracker callbacks (pull/hybrid path). */
  expectsClaimCallbacks: boolean;
}

export type LifecycleCapabilities = Record<LifecycleCapability, boolean>;

export interface CallbackIntakeMapping {
  event: CallbackEvent;
  method: 'POST';
  /** Absolute API path template under Entity, e.g. `/api/swarm/jobs/:id/claim`. */
  pathTemplate: string;
  /** Q46 ActivityEvent placeholder; not a full event model. */
  activityEventKind?: ActivityEventKind;
  authRequired: boolean;
  idempotent: boolean;
}

export interface StatusMapping {
  /** Preferred Swarm job status immediately after a successful dispatch call. */
  afterDispatch?: SwarmJobStatus;
  /** Map provider RunState → Swarm job status hints. */
  runStateToJobStatus: Partial<Record<RunState, SwarmJobStatus>>;
}

export interface HealthContract {
  /** Fields allowed on public list/health APIs. */
  publicFields: PublicHealthField[];
  /** Private diagnostics never returned on public surfaces. */
  privateFields: string[];
  /** New contract default: URLs are not public-safe in health.message. */
  allowUrlsInPublicMessage: boolean;
  /** New contract default: filesystem paths are not public-safe in health.message. */
  allowPathsInPublicMessage: boolean;
}

export interface ConfigBinding {
  /** Env or settings key name — never a secret value. */
  key: string;
  source: ConfigSource;
  required: boolean;
  /** When true, values must never appear in logs, health, or audit UI. */
  secret: boolean;
  description?: string;
}

export interface DangerousActionDeclaration {
  id: string;
  label: string;
  method: 'POST';
  pathTemplate: string;
  /** Must always be true — dangerous actions are never implied by health. */
  requiresExplicitAllow: true;
  shells: boolean;
  description?: string;
}

export interface ActivityEventPlaceholder {
  /** Kinds this engine may eventually emit on the shared ActivityEvent spine (Q46). */
  emits: ActivityEventKind[];
}

export interface ExecutionEnginePluginManifest {
  schemaVersion: typeof EXECUTION_ENGINE_MANIFEST_SCHEMA_VERSION;
  kind: typeof EXECUTION_ENGINE_KIND;
  identity: ExecutionEngineIdentity;
  execution: ExecutionContract;
  lifecycle: LifecycleCapabilities;
  callbacks: {
    intake: CallbackIntakeMapping[];
  };
  statusMapping: StatusMapping;
  health: HealthContract;
  config: {
    bindings: ConfigBinding[];
  };
  dangerousActions: DangerousActionDeclaration[];
  activityEvents: ActivityEventPlaceholder;
}

export interface ManifestValidationIssue {
  path: string;
  code: string;
  message: string;
}

export type ManifestValidationResult =
  | { ok: true; manifest: ExecutionEnginePluginManifest; issues: [] }
  | { ok: false; manifest?: undefined; issues: ManifestValidationIssue[] };
