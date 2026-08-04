/**
 * THE-868 / WP1-B-07 — Narrow/mobile viewport smoke contract for Workplane panels.
 *
 * Ensures Workplanes Slice 1 panels remain usable at phone/narrow widths without
 * document horizontal overflow, while preserving the THE-867 layout lock.
 */

import { WORKPLANE_PANEL_IDS } from './workplaneUrlState.ts';
import type { WorkplanePanelId } from '../components/mission-control/taskDetailWorkplaneSeams.ts';

/** iPhone-class width used for mobile smoke screenshots. */
export const WORKPLANE_MOBILE_MAX_WIDTH = 390;

/** Tablet/narrow breakpoint where Workplane shell switches to compact rules. */
export const WORKPLANE_NARROW_MAX_WIDTH = 720;

export type WorkplaneViewportBand = 'mobile' | 'narrow' | 'desktop';

/** Panels that must remain visually sane in WP1-B-07 smoke (incl. placeholders). */
export const WORKPLANE_NARROW_SMOKE_PANELS: readonly WorkplanePanelId[] = Object.freeze([
  ...WORKPLANE_PANEL_IDS,
]);

export interface WorkplaneNarrowViewportContract {
  issue: 'THE-868';
  code: 'WP1-B-07';
  mobileMaxWidth: typeof WORKPLANE_MOBILE_MAX_WIDTH;
  narrowMaxWidth: typeof WORKPLANE_NARROW_MAX_WIDTH;
  requiredPanels: readonly WorkplanePanelId[];
  shellClassName: 'workplane-shell';
  navClassName: 'workplane-panel-nav';
  bodyClassName: 'workplane-panel-body';
  overflowPolicy: 'no_document_horizontal_overflow';
  layoutLockPreserved: true;
  humanPanelNavPreserved: true;
}

export function getWorkplaneNarrowViewportContract(): WorkplaneNarrowViewportContract {
  return {
    issue: 'THE-868',
    code: 'WP1-B-07',
    mobileMaxWidth: WORKPLANE_MOBILE_MAX_WIDTH,
    narrowMaxWidth: WORKPLANE_NARROW_MAX_WIDTH,
    requiredPanels: WORKPLANE_NARROW_SMOKE_PANELS,
    shellClassName: 'workplane-shell',
    navClassName: 'workplane-panel-nav',
    bodyClassName: 'workplane-panel-body',
    overflowPolicy: 'no_document_horizontal_overflow',
    layoutLockPreserved: true,
    humanPanelNavPreserved: true,
  };
}

/**
 * Classify a viewport width into mobile / narrow / desktop bands.
 * Non-finite or non-positive widths fail closed to `mobile` (most constrained).
 */
export function classifyWorkplaneViewportWidth(width: number): WorkplaneViewportBand {
  if (!Number.isFinite(width) || width <= 0) {
    return 'mobile';
  }
  if (width <= WORKPLANE_MOBILE_MAX_WIDTH) {
    return 'mobile';
  }
  if (width <= WORKPLANE_NARROW_MAX_WIDTH) {
    return 'narrow';
  }
  return 'desktop';
}

export function isWorkplaneNarrowViewport(width: number): boolean {
  const band = classifyWorkplaneViewportWidth(width);
  return band === 'mobile' || band === 'narrow';
}

/** Shell class list for CSS hooks (additive; does not change layout ownership). */
export function workplaneShellNarrowClassNames(): string {
  return 'entity-shell workplane-shell workplane-shell--narrow-ready flex h-screen flex-col bg-[var(--bg-primary)] text-[var(--text-secondary)]';
}

export function workplanePanelNavNarrowClassNames(): string {
  return 'workplane-panel-nav flex flex-wrap gap-1 border-b border-[var(--border-primary)] px-3 py-2';
}

export function workplanePanelBodyNarrowClassNames(): string {
  return 'workplane-panel-body flex-1 overflow-auto p-4';
}

/**
 * Measure whether a box overflows horizontally beyond a 1px rounding tolerance.
 * Used by browser proof + unit assertions over synthetic metrics.
 */
export function hasHorizontalOverflow(
  scrollWidth: number,
  clientWidth: number,
  tolerancePx = 1,
): boolean {
  if (!Number.isFinite(scrollWidth) || !Number.isFinite(clientWidth)) {
    return true;
  }
  return scrollWidth > clientWidth + Math.max(0, tolerancePx);
}

/** DOM attribute contract exposed on the Workplane shell for narrow smoke. */
export interface WorkplaneNarrowDomAttrs {
  'data-workplane-narrow-ready': 'true';
  'data-workplane-viewport-smoke': 'WP1-B-07';
  'data-workplane-overflow-policy': 'no_document_horizontal_overflow';
  'data-workplane-layout-locked': 'true';
}

export function workplaneNarrowDomAttrs(): WorkplaneNarrowDomAttrs {
  return {
    'data-workplane-narrow-ready': 'true',
    'data-workplane-viewport-smoke': 'WP1-B-07',
    'data-workplane-overflow-policy': 'no_document_horizontal_overflow',
    'data-workplane-layout-locked': 'true',
  };
}

/** Test helper: assert markup includes narrow-ready + layout-lock contracts. */
export function assertWorkplaneNarrowMarkupContract(html: string): {
  narrowReady: boolean;
  viewportSmoke: boolean;
  overflowPolicy: boolean;
  layoutLocked: boolean;
  layoutIntact: boolean;
  hasNavClass: boolean;
  hasBodyClass: boolean;
  hasShellClass: boolean;
  panelTabsPresent: boolean;
} {
  const panelTabsPresent = WORKPLANE_NARROW_SMOKE_PANELS.every((id) =>
    html.includes(`data-testid="workplane-panel-tab-${id}"`),
  );
  return {
    narrowReady: /data-workplane-narrow-ready="true"/.test(html),
    viewportSmoke: /data-workplane-viewport-smoke="WP1-B-07"/.test(html),
    overflowPolicy: /data-workplane-overflow-policy="no_document_horizontal_overflow"/.test(html),
    layoutLocked: /data-workplane-layout-locked="true"/.test(html),
    layoutIntact: /data-workplane-layout-intact="true"/.test(html),
    hasNavClass: /class="[^"]*\bworkplane-panel-nav\b/.test(html),
    hasBodyClass: /class="[^"]*\bworkplane-panel-body\b/.test(html),
    hasShellClass: /class="[^"]*\bworkplane-shell\b/.test(html),
    panelTabsPresent,
  };
}
