export default function MCEngineeringEntry() {
  return (
    <section
      className="flex h-full min-h-0 items-center justify-center bg-[var(--bg-primary)] px-6 py-10"
      aria-labelledby="engineering-board-title"
      data-testid="engineering-board-entry"
    >
      <div className="mc-shell-panel w-full max-w-xl px-6 py-8 text-center sm:px-10 sm:py-10">
        <div
          className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-xl text-[var(--text-secondary)]"
          aria-hidden="true"
        >
          {'</>'}
        </div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          Work domain
        </p>
        <h1 id="engineering-board-title" className="text-2xl font-semibold text-[var(--text-primary)]">
          Engineering board
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
          Coding work has a dedicated Mission Control entry point. Engineering tasks will appear
          here when domain-scoped board loading is connected.
        </p>
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
          Entity Engineering · entry ready
        </div>
      </div>
    </section>
  );
}
