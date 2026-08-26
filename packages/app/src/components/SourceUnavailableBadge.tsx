import { SOURCE_UNAVAILABLE_NOTICE } from '../lib/sourceAvailability.ts';

/**
 * Shared visible marker for configured sources whose connector type has no
 * implementation in this build. Rendered in the Files tree and Admin settings.
 */
export default function SourceUnavailableBadge() {
  return (
    <span
      data-testid="source-unavailable-badge"
      className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
      title="This connector type is not implemented in the current build. Configuration is kept, but file operations stay unavailable."
    >
      {SOURCE_UNAVAILABLE_NOTICE}
    </span>
  );
}
