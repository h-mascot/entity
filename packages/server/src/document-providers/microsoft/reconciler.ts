/** T-024 — Microsoft provider revision/change reconciliation. Pure injected transport seam. */
import { UNSAFE_REVISION_TOKEN_CHARACTERS } from '../revision-coordinator';
import type { DocumentPreviewState } from '../../../../db/src/document-integrations';
import type { MicrosoftProviderItemEvidence } from './read-state';

export interface MicrosoftChangeSource {
  poll(): Promise<{ items: readonly MicrosoftProviderItemEvidence[]; watchActive: boolean }>;
}
export interface MicrosoftReconcileRecord {
  id: string;
  workspaceId: string;
  externalId: string;
  currentRevision: string | null;
  previewState: DocumentPreviewState;
  previewUrl: string | null;
  providerUrl: string | null;
  permissionsSummary: string;
  changeToken: string | null;
}
export interface MicrosoftReconcileRegistry {
  find(workspaceId: string, externalId: string): MicrosoftReconcileRecord | undefined;
  update(workspaceId: string, id: string, patch: Partial<Omit<MicrosoftReconcileRecord, 'id' | 'workspaceId' | 'externalId'>>): void;
}
export type MicrosoftReconcileOutcome =
  | { kind: 'applied'; externalId: string }
  | { kind: 'duplicate-ignored'; externalId: string }
  | { kind: 'stale-discarded'; externalId: string }
  | { kind: 'unknown-document'; externalId: string };
export interface MicrosoftReconcileResult {
  health: { state: 'healthy' | 'degraded'; mode: 'delta' | 'polling'; reason: 'none' | 'delta_unavailable' | 'change_tracking_failed' };
  outcomes: MicrosoftReconcileOutcome[];
  applied: number;
}

export class UnsafeMicrosoftRevisionError extends Error {
  readonly codePoint: number;
  constructor(codePoint: number) {
    super('UNSAFE_REVISION_TOKEN: provider revision contained a forbidden character; raw token rejected');
    this.name = 'UnsafeMicrosoftRevisionError';
    this.codePoint = codePoint;
  }
}
function assertSafeRevision(value: string): void {
  const match = UNSAFE_REVISION_TOKEN_CHARACTERS.exec(value);
  if (match) throw new UnsafeMicrosoftRevisionError(match[0].codePointAt(0) ?? 0);
}
function revision(item: MicrosoftProviderItemEvidence): string | null { return item.eTag ?? item.cTag ?? null; }

export function createMicrosoftReconciler(deps: {
  source: MicrosoftChangeSource;
  registry: MicrosoftReconcileRegistry;
  compareRevisions: (a: string, b: string) => number;
}): { reconcile(workspaceId: string): Promise<MicrosoftReconcileResult> } {
  return { async reconcile(workspaceId) {
    let polled: { items: readonly MicrosoftProviderItemEvidence[]; watchActive: boolean };
    try { polled = await deps.source.poll(); } catch {
      return { health: { state: 'degraded', mode: 'polling', reason: 'change_tracking_failed' }, outcomes: [], applied: 0 };
    }
    const outcomes: MicrosoftReconcileOutcome[] = [];
    for (const item of polled.items) {
      const current = revision(item); if (current) assertSafeRevision(current);
      const known = deps.registry.find(workspaceId, item.externalId);
      if (!known) { outcomes.push({ kind: 'unknown-document', externalId: item.externalId }); continue; }
      if (!current || (known.currentRevision && deps.compareRevisions(current, known.currentRevision) < 0)) { outcomes.push({ kind: 'stale-discarded', externalId: item.externalId }); continue; }
      if (known.currentRevision === current) { outcomes.push({ kind: 'duplicate-ignored', externalId: item.externalId }); continue; }
      deps.registry.update(workspaceId, known.id, {
        currentRevision: current,
        providerUrl: item.webUrl ?? null,
        changeToken: item.deltaLink ?? null,
      });
      outcomes.push({ kind: 'applied', externalId: item.externalId });
    }
    return {
      health: polled.watchActive ? { state: 'healthy', mode: 'delta', reason: 'none' } : { state: 'degraded', mode: 'polling', reason: 'delta_unavailable' },
      outcomes, applied: outcomes.filter((outcome) => outcome.kind === 'applied').length,
    };
  } };
}
