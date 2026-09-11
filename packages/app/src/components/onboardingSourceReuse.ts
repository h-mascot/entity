/**
 * Reuse policy for the onboarding "Test source" flow.
 *
 * `POST /api/sources` never returns 409 and display names are not unique
 * server-side, so reuse cannot be triggered by conflict handling — the wizard
 * must resolve an existing source before creating one, or every test click
 * would leave another duplicate source behind (failed placeholder tests make
 * re-clicks likely).
 */

export interface OnboardingSourceSummary {
  id: string;
  displayName?: string | null;
  type?: string | null;
  baseUrl?: string | null;
  basePath?: string | null;
  /** The API summary always reports this boolean; only enabled sources are reusable. */
  enabled?: boolean | null;
}

export interface OnboardingSourceDraft {
  displayName: string;
  type: string;
  baseUrl?: string;
  basePath?: string;
}

function normalizeLocation(value?: string | null): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

/**
 * Finds the existing source a test click may reuse. Identity is display name
 * plus connector type plus location (trailing slashes ignored), and only an
 * ENABLED source is eligible: a disabled source stays out of listings and
 * the index, so reusing it would report "Reachable" for a source the wizard
 * cannot actually use — and silently enabling a deliberately disabled
 * source is not the wizard's call. A click must also never test a stale
 * source in place of the requested configuration, and never fork a new
 * source for an unchanged configuration.
 */
export function findReusableOnboardingSource(
  sources: readonly OnboardingSourceSummary[],
  draft: OnboardingSourceDraft,
): OnboardingSourceSummary | undefined {
  const displayName = draft.displayName.trim();
  const usesBasePath = draft.type === 'local';
  const draftLocation = usesBasePath ? normalizeLocation(draft.basePath) : normalizeLocation(draft.baseUrl);

  return sources.find((source) => {
    if (!source.id || (source.displayName ?? '').trim() !== displayName) return false;
    if ((source.type ?? '') !== draft.type) return false;
    if (source.enabled === false) return false;
    const sourceLocation = usesBasePath ? normalizeLocation(source.basePath) : normalizeLocation(source.baseUrl);
    return sourceLocation === draftLocation;
  });
}
