/**
 * THE-867 / WP1-B-06 — Workplane v1 layout lock (Q34).
 *
 * Canonical structured panels are fixed. Humans own panel navigation (active
 * panel selection). Agents may later supply task data/proof/activity into
 * trusted panels, but must not reorder, hide, add custom layout panels, or
 * override human-selected panel state.
 *
 * Fail-closed: unknown actors and malformed mutation payloads are rejected;
 * the canonical layout is never mutated.
 */

import {
  WORKPLANE_PANEL_IDS,
  DEFAULT_WORKPLANE_PANEL,
  isWorkplanePanelId,
} from './workplaneUrlState.ts';
import type { WorkplanePanelId } from '../components/mission-control/taskDetailWorkplaneSeams.ts';

/** Layout contract version for Workplanes slice 1. */
export const WORKPLANE_LAYOUT_VERSION = 'v1' as const;

/** Actors that may attempt layout-affecting operations. */
export type WorkplaneLayoutActor = 'human' | 'agent' | 'system' | 'unknown';

/**
 * Mutation kinds that touch structured layout (not panel *content*).
 * `set_active_panel` is navigation; only humans may apply it in v1.
 */
export type WorkplaneLayoutMutationKind =
  | 'reorder_panels'
  | 'hide_panel'
  | 'show_panel'
  | 'add_custom_panel'
  | 'remove_panel'
  | 'set_active_panel'
  | 'override_panel_state'
  | 'replace_layout';

export type WorkplaneLayoutRejectionCode =
  | 'agent_layout_mutation_forbidden'
  | 'unknown_actor_forbidden'
  | 'system_layout_mutation_forbidden'
  | 'structural_layout_mutation_forbidden'
  | 'invalid_panel_id'
  | 'invalid_mutation_payload'
  | 'custom_panel_forbidden';

export interface WorkplaneCanonicalLayout {
  version: typeof WORKPLANE_LAYOUT_VERSION;
  locked: true;
  humanOwnsLayout: true;
  agentsMayMutateLayout: false;
  /** Frozen canonical panel order for Workplanes v1 (Q33). */
  panelIds: readonly WorkplanePanelId[];
}

export interface WorkplaneLayoutMutationAttempt {
  actor: WorkplaneLayoutActor;
  kind: WorkplaneLayoutMutationKind;
  /** Proposed panel order / set for reorder/replace. */
  panelIds?: unknown;
  /** Target panel for hide/show/remove/set_active. */
  panelId?: unknown;
  /** Agent/custom widget panel (always rejected in v1). */
  customPanel?: unknown;
  /** Proposed active panel override. */
  activePanel?: unknown;
  /** Optional provenance for receipts/tests. */
  source?: string;
}

export interface WorkplaneLayoutMutationAccepted {
  accepted: true;
  layout: WorkplaneCanonicalLayout;
  activePanel: WorkplanePanelId;
  reason: string;
  rejectionCode: null;
}

export interface WorkplaneLayoutMutationRejected {
  accepted: false;
  layout: WorkplaneCanonicalLayout;
  /** Unchanged human/canonical active panel. */
  activePanel: WorkplanePanelId;
  reason: string;
  rejectionCode: WorkplaneLayoutRejectionCode;
}

export type WorkplaneLayoutMutationResult =
  | WorkplaneLayoutMutationAccepted
  | WorkplaneLayoutMutationRejected;

export interface ResolveLockedWorkplaneLayoutInput {
  /** Human-selected / URL active panel (authoritative). */
  activePanel?: WorkplanePanelId | string | null;
  /**
   * Optional agent/task payload that may attempt to smuggle layout fields
   * (e.g. metadata.workplane_layout). Always inspected and rejected.
   */
  agentPayload?: unknown;
  /** Explicit mutation attempts to evaluate (tests / future agent bridges). */
  attempts?: WorkplaneLayoutMutationAttempt[];
}

export interface ResolveLockedWorkplaneLayoutResult {
  layout: WorkplaneCanonicalLayout;
  activePanel: WorkplanePanelId;
  rejectedAttempts: WorkplaneLayoutMutationRejected[];
  /** True when every structural/agent attempt was rejected (or none present). */
  layoutIntact: true;
}

const CANONICAL_PANEL_IDS: readonly WorkplanePanelId[] = Object.freeze([
  ...WORKPLANE_PANEL_IDS,
]);

const STRUCTURAL_KINDS = new Set<WorkplaneLayoutMutationKind>([
  'reorder_panels',
  'hide_panel',
  'show_panel',
  'add_custom_panel',
  'remove_panel',
  'override_panel_state',
  'replace_layout',
]);

/** Keys commonly used by agents/plugins to smuggle layout overrides. */
const AGENT_LAYOUT_PAYLOAD_KEYS = [
  'workplane_layout',
  'workplaneLayout',
  'layout',
  'panel_order',
  'panelOrder',
  'panels',
  'hidden_panels',
  'hiddenPanels',
  'custom_panels',
  'customPanels',
  'active_panel',
  'activePanel',
] as const;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    const s = readString(item);
    if (!s) return null;
    out.push(s);
  }
  return out;
}

/** Frozen canonical Workplane v1 layout. Always the same reference shape. */
export function getCanonicalWorkplaneLayout(): WorkplaneCanonicalLayout {
  return {
    version: WORKPLANE_LAYOUT_VERSION,
    locked: true,
    humanOwnsLayout: true,
    agentsMayMutateLayout: false,
    panelIds: CANONICAL_PANEL_IDS,
  };
}

/** Stable join of canonical panel ids for DOM/receipts. */
export function formatWorkplanePanelOrder(
  panelIds: readonly WorkplanePanelId[] = CANONICAL_PANEL_IDS,
): string {
  return panelIds.join(',');
}

export function isCanonicalWorkplanePanelOrder(
  panelIds: readonly string[] | null | undefined,
): boolean {
  if (!panelIds || panelIds.length !== CANONICAL_PANEL_IDS.length) {
    return false;
  }
  return CANONICAL_PANEL_IDS.every((id, index) => panelIds[index] === id);
}

function normalizeActivePanel(
  value: WorkplanePanelId | string | null | undefined,
): WorkplanePanelId {
  return isWorkplanePanelId(value) ? value : DEFAULT_WORKPLANE_PANEL;
}

function reject(
  activePanel: WorkplanePanelId,
  rejectionCode: WorkplaneLayoutRejectionCode,
  reason: string,
): WorkplaneLayoutMutationRejected {
  return {
    accepted: false,
    layout: getCanonicalWorkplaneLayout(),
    activePanel,
    reason,
    rejectionCode,
  };
}

function accept(
  activePanel: WorkplanePanelId,
  reason: string,
): WorkplaneLayoutMutationAccepted {
  return {
    accepted: true,
    layout: getCanonicalWorkplaneLayout(),
    activePanel,
    reason,
    rejectionCode: null,
  };
}

/**
 * Apply a single layout mutation attempt against the locked v1 layout.
 * Structural mutations are always rejected. Agents cannot change active panel.
 * Humans may change active panel to a canonical panel id only.
 */
export function applyWorkplaneLayoutMutation(
  currentActivePanel: WorkplanePanelId | string | null | undefined,
  attempt: WorkplaneLayoutMutationAttempt,
): WorkplaneLayoutMutationResult {
  const activePanel = normalizeActivePanel(currentActivePanel);
  const layout = getCanonicalWorkplaneLayout();

  if (!attempt || typeof attempt !== 'object') {
    return reject(activePanel, 'invalid_mutation_payload', 'Layout mutation payload is invalid.');
  }

  const actor = attempt.actor;
  if (actor !== 'human' && actor !== 'agent' && actor !== 'system' && actor !== 'unknown') {
    return reject(activePanel, 'invalid_mutation_payload', 'Layout mutation actor is invalid.');
  }

  if (actor === 'unknown') {
    return reject(
      activePanel,
      'unknown_actor_forbidden',
      'Unknown actors cannot mutate Workplane layout (fail-closed).',
    );
  }

  if (actor === 'system' && STRUCTURAL_KINDS.has(attempt.kind)) {
    return reject(
      activePanel,
      'system_layout_mutation_forbidden',
      'System actors cannot change the canonical Workplane v1 layout.',
    );
  }

  if (actor === 'agent') {
    // Agents may never touch layout or override human panel selection.
    return reject(
      activePanel,
      'agent_layout_mutation_forbidden',
      `Agent layout mutation rejected (${attempt.kind}); humans own Workplane v1 layout.`,
    );
  }

  // Human / system navigation path below. Structural edits remain forbidden in v1.
  if (STRUCTURAL_KINDS.has(attempt.kind) || attempt.kind === 'add_custom_panel') {
    if (attempt.kind === 'add_custom_panel' || attempt.customPanel != null) {
      return reject(
        activePanel,
        'custom_panel_forbidden',
        'Custom/plugin Workplane panels are deferred; v1 uses canonical panels only.',
      );
    }
    return reject(
      activePanel,
      'structural_layout_mutation_forbidden',
      `Structural layout mutation rejected (${attempt.kind}); v1 layout is locked to canonical panels.`,
    );
  }

  if (attempt.kind !== 'set_active_panel') {
    return reject(
      activePanel,
      'invalid_mutation_payload',
      `Unsupported layout mutation kind: ${String(attempt.kind)}`,
    );
  }

  const nextPanel = normalizeCandidatePanel(attempt.activePanel ?? attempt.panelId);
  if (!nextPanel) {
    return reject(
      activePanel,
      'invalid_panel_id',
      'Active panel must be a canonical Workplane panel id.',
    );
  }

  // Human (or non-structural system navigation) may select a canonical panel.
  if (actor === 'human' || actor === 'system') {
    return accept(nextPanel, `Active panel set to ${nextPanel} by ${actor}.`);
  }

  return reject(
    activePanel,
    'unknown_actor_forbidden',
    'Active panel changes require a human actor.',
  );
}

function normalizeCandidatePanel(value: unknown): WorkplanePanelId | null {
  const asString = readString(value);
  if (!asString || !isWorkplanePanelId(asString)) {
    return null;
  }
  return asString;
}

/**
 * Scan an agent/task payload for smuggled layout fields and convert them into
 * explicit rejected mutation attempts (never applied).
 */
export function extractAgentLayoutMutationAttempts(
  payload: unknown,
): WorkplaneLayoutMutationAttempt[] {
  const root = toRecord(payload);
  if (!root) {
    return [];
  }

  const attempts: WorkplaneLayoutMutationAttempt[] = [];
  const layoutBag =
    toRecord(root.workplane_layout) ??
    toRecord(root.workplaneLayout) ??
    toRecord(root.layout);

  const panelOrder =
    readStringArray(root.panel_order) ??
    readStringArray(root.panelOrder) ??
    readStringArray(root.panels) ??
    (layoutBag
      ? readStringArray(layoutBag.panel_order) ??
        readStringArray(layoutBag.panelOrder) ??
        readStringArray(layoutBag.panels)
      : null);

  if (panelOrder && !isCanonicalWorkplanePanelOrder(panelOrder)) {
    attempts.push({
      actor: 'agent',
      kind: 'reorder_panels',
      panelIds: panelOrder,
      source: 'agent_payload.panel_order',
    });
  }

  const hidden =
    readStringArray(root.hidden_panels) ??
    readStringArray(root.hiddenPanels) ??
    (layoutBag
      ? readStringArray(layoutBag.hidden_panels) ?? readStringArray(layoutBag.hiddenPanels)
      : null);
  if (hidden && hidden.length > 0) {
    for (const panelId of hidden) {
      attempts.push({
        actor: 'agent',
        kind: 'hide_panel',
        panelId,
        source: 'agent_payload.hidden_panels',
      });
    }
  }

  const custom =
    (Array.isArray(root.custom_panels) ? root.custom_panels : null) ??
    (Array.isArray(root.customPanels) ? root.customPanels : null) ??
    (layoutBag && Array.isArray(layoutBag.custom_panels) ? layoutBag.custom_panels : null) ??
    (layoutBag && Array.isArray(layoutBag.customPanels) ? layoutBag.customPanels : null);
  if (custom && custom.length > 0) {
    for (const customPanel of custom) {
      attempts.push({
        actor: 'agent',
        kind: 'add_custom_panel',
        customPanel,
        source: 'agent_payload.custom_panels',
      });
    }
  }

  const activeOverride =
    readString(root.active_panel) ??
    readString(root.activePanel) ??
    (layoutBag
      ? readString(layoutBag.active_panel) ?? readString(layoutBag.activePanel)
      : null);
  if (activeOverride) {
    attempts.push({
      actor: 'agent',
      kind: 'set_active_panel',
      activePanel: activeOverride,
      panelId: activeOverride,
      source: 'agent_payload.active_panel',
    });
  }

  // Any recognized layout key present as a full replace attempt.
  const hasLayoutKey = AGENT_LAYOUT_PAYLOAD_KEYS.some((key) => key in root);
  if (hasLayoutKey && attempts.length === 0 && layoutBag) {
    attempts.push({
      actor: 'agent',
      kind: 'replace_layout',
      panelIds: panelOrder ?? undefined,
      activePanel: activeOverride ?? undefined,
      source: 'agent_payload.workplane_layout',
    });
  }

  return attempts;
}

/**
 * Resolve the locked layout + human active panel, rejecting agent/structural
 * mutation attempts. Layout is always intact after resolve.
 */
export function resolveLockedWorkplaneLayout(
  input: ResolveLockedWorkplaneLayoutInput = {},
): ResolveLockedWorkplaneLayoutResult {
  const humanActive = normalizeActivePanel(input.activePanel);
  const attempts = [
    ...(input.attempts ?? []),
    ...extractAgentLayoutMutationAttempts(input.agentPayload),
  ];

  const rejectedAttempts: WorkplaneLayoutMutationRejected[] = [];
  let activePanel = humanActive;

  for (const attempt of attempts) {
    const result = applyWorkplaneLayoutMutation(activePanel, attempt);
    if (!result.accepted) {
      rejectedAttempts.push(result);
      // Keep prior human active panel — never apply rejected mutations.
      continue;
    }
    // Only human/system set_active_panel can accept; structural never accepts.
    activePanel = result.activePanel;
  }

  return {
    layout: getCanonicalWorkplaneLayout(),
    activePanel,
    rejectedAttempts,
    layoutIntact: true,
  };
}

/**
 * Human panel navigation helper used by WorkplaneShell.
 * Equivalent to applyWorkplaneLayoutMutation with actor=human, kind=set_active_panel.
 */
export function selectWorkplanePanelAsHuman(
  currentActivePanel: WorkplanePanelId | string | null | undefined,
  nextPanel: WorkplanePanelId | string,
): WorkplaneLayoutMutationResult {
  return applyWorkplaneLayoutMutation(currentActivePanel, {
    actor: 'human',
    kind: 'set_active_panel',
    panelId: nextPanel,
    activePanel: nextPanel,
    source: 'human_panel_nav',
  });
}
