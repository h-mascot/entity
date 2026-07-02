import type { ReactNode } from 'react';

interface GovernanceSectionProps {
  open: boolean;
  actionEligible: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export default function GovernanceSection({ open, actionEligible, onToggle, children }: GovernanceSectionProps) {
  return (
    <section
      style={{ order: 2 }}
      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3"
      data-testid="task-governance-provenance-panel"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={onToggle}
        aria-expanded={open}
      >
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Governance & provenance
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Review, approval, routing, receipt, and document provenance details.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-xs text-[var(--text-secondary)]">
          {open ? 'Hide' : actionEligible ? 'Action needed' : 'Show'}
        </span>
      </button>

      {open ? <div className="mt-3 flex flex-col gap-3">{children}</div> : null}
    </section>
  );
}
