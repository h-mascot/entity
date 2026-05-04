import { useMemo } from 'react';
import type { ProjectOption } from './projectOptions';

interface MCProjectTagPickerProps {
  projects: ProjectOption[];
  selectedIds: number[];
  selectedProjects: ProjectOption[];
  search: string;
  loading: boolean;
  error: string | null;
  onSearchChange: (value: string) => void;
  onToggleProject: (projectId: number) => void;
}

export default function MCProjectTagPicker({
  projects,
  selectedIds,
  selectedProjects,
  search,
  loading,
  error,
  onSearchChange,
  onToggleProject,
}: MCProjectTagPickerProps) {
  const selectedProjectIds = useMemo(() => new Set(selectedIds), [selectedIds]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects.filter((project) => {
      if (!query) {
        return true;
      }

      return project.name.toLowerCase().includes(query);
    });
  }, [projects, search]);

  return (
    <section className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">Projects</div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">Pick one or more project tags for routing.</div>
        </div>
        <div className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {selectedProjects.length} selected
        </div>
      </div>

      <div className="mt-4 flex min-h-[48px] flex-wrap gap-2 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3">
        {selectedProjects.length > 0 ? (
          selectedProjects.map((project) => (
            <span
              key={project.id}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--accent)]/40 bg-[var(--surface-accent)] px-3 py-1 text-xs text-[var(--text-primary)]"
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: project.color ?? '#6b7280' }}
                aria-hidden="true"
              />
              <span>{project.name}</span>
              <button
                type="button"
                className="text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
                onClick={() => onToggleProject(project.id)}
                aria-label={`Remove ${project.name}`}
              >
                x
              </button>
            </span>
          ))
        ) : (
          <div className="flex min-h-[22px] items-center text-sm text-[var(--text-muted)]">No projects selected.</div>
        )}
      </div>

      <div className="mt-3">
        <input
          type="text"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Filter project tags..."
          className="mc-shell-input w-full px-3 py-2 text-sm"
        />
      </div>

      <div className="mt-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-3">
        {loading ? (
          <div className="text-sm text-[var(--text-muted)]">Loading project tags...</div>
        ) : error ? (
          <div className="text-sm text-[var(--error)]">{error}</div>
        ) : filteredProjects.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {filteredProjects.map((project) => {
              const selected = selectedProjectIds.has(project.id);

              return (
                <button
                  key={project.id}
                  type="button"
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                      : 'border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                  }`}
                  onClick={() => onToggleProject(project.id)}
                  aria-pressed={selected}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: project.color ?? '#6b7280' }}
                    aria-hidden="true"
                  />
                  <span>{project.name}</span>
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                      selected
                        ? 'border-[var(--accent)]/40 bg-[var(--bg-primary)] text-[var(--text-primary)]'
                        : 'border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                    }`}
                  >
                    {selected ? 'On' : 'Add'}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-sm text-[var(--text-muted)]">
            {projects.length === 0 ? 'No projects available.' : 'No matching projects.'}
          </div>
        )}
      </div>
    </section>
  );
}
