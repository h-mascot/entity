import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { toErrorMessage } from '../../lib/http';
import type { CreateTaskPayload, TaskBoardTask, TaskColumn, TaskPriority } from '../../hooks/useTaskBoard';
import { useUserProfile } from '../../lib/userProfile';
import { fetchProjectOptions, type ProjectOption } from './projectOptions';

const AGENT_ASSIGNEE_OPTIONS = ['Assistant', 'Human'] as const;
const PRIORITY_OPTIONS: TaskPriority[] = ['P0', 'P1', 'P2', 'P3'];
const CREATE_TASK_COLUMNS = ['backlog', 'todo', 'doing'] as const;

type CreateTaskColumn = Extract<TaskColumn, (typeof CREATE_TASK_COLUMNS)[number]>;

const COLUMN_LABELS: Record<CreateTaskColumn, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  doing: 'Doing',
};

interface CreateTaskFormState {
  name: string;
  description: string;
  assignee: string;
  dueDate: string;
  priority: TaskPriority;
  column: CreateTaskColumn;
  recurring: boolean;
  projectIds: number[];
}

interface MCCreateTaskModalProps {
  open: boolean;
  apiBase?: string;
  onClose: () => void;
  onCreateTask: (payload: CreateTaskPayload) => Promise<TaskBoardTask>;
  onCreated?: (task: TaskBoardTask) => void;
}

const DEFAULT_FORM: CreateTaskFormState = {
  name: '',
  description: '',
  assignee: 'Unassigned',
  dueDate: '',
  priority: 'P2',
  column: 'backlog',
  recurring: false,
  projectIds: [],
};

export default function MCCreateTaskModal({
  open,
  apiBase = '',
  onClose,
  onCreateTask,
  onCreated,
}: MCCreateTaskModalProps) {
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [form, setForm] = useState<CreateTaskFormState>(DEFAULT_FORM);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectSearch, setProjectSearch] = useState('');
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [userProfile] = useUserProfile();
  const assigneeOptions = useMemo(
    () => [...AGENT_ASSIGNEE_OPTIONS, userProfile.displayName, 'Unassigned'],
    [userProfile.displayName]
  );

  useEffect(() => {
    if (!open) {
      setVisible(false);
      setForm(DEFAULT_FORM);
      setProjects([]);
      setProjectSearch('');
      setProjectError(null);
      setSubmitError(null);
      setSubmitting(false);
      return;
    }

    const animationId = window.requestAnimationFrame(() => setVisible(true));
    return () => window.cancelAnimationFrame(animationId);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const focusId = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });

    return () => window.cancelAnimationFrame(focusId);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    setLoadingProjects(true);
    setProjectError(null);

    void fetchProjectOptions(apiBase)
      .then((loadedProjects) => {
        if (!cancelled) {
          setProjects(loadedProjects);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setProjectError(toErrorMessage(error, 'Unable to load projects.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingProjects(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiBase, open]);

  const selectedProjectIds = useMemo(() => new Set(form.projectIds), [form.projectIds]);

  const filteredProjects = useMemo(() => {
    const query = projectSearch.trim().toLowerCase();
    return projects.filter((project) => {
      if (!query) {
        return true;
      }

      return project.name.toLowerCase().includes(query);
    });
  }, [projectSearch, projects]);

  const selectedProjects = useMemo(() => {
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    return form.projectIds.map((projectId) => projectsById.get(projectId)).filter((entry): entry is ProjectOption => Boolean(entry));
  }, [form.projectIds, projects]);

  const assigneeRequired = form.column === 'todo' || form.column === 'doing';

  const toggleProjectSelection = (projectId: number) => {
    setForm((current) => ({
      ...current,
      projectIds: current.projectIds.includes(projectId)
        ? current.projectIds.filter((candidateId) => candidateId !== projectId)
        : [...current.projectIds, projectId],
    }));
    setSubmitError(null);
  };

  const updateField = <Key extends keyof CreateTaskFormState>(key: Key, value: CreateTaskFormState[Key]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
    setSubmitError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setSubmitError('Task name is required.');
      return;
    }

    if (assigneeRequired && form.assignee === 'Unassigned') {
      setSubmitError('Todo and Doing tasks require an assignee.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      const projectNames = selectedProjects.map((project) => project.name);
      const task = await onCreateTask({
        name: trimmedName,
        description: form.description.trim() || undefined,
        assignee: form.assignee,
        column: form.column,
        priority: form.priority,
        project: projectNames.length > 0 ? projectNames.join(', ') : undefined,
        projectIds: form.projectIds,
        due_date: form.dueDate || null,
        recurring: form.recurring,
        metadata: JSON.stringify({
          priority: form.priority,
          due_date: form.dueDate || null,
          recurring: form.recurring,
          project_ids: form.projectIds,
          project_names: projectNames,
        }),
      });

      onClose();
      onCreated?.(task);
    } catch (error) {
      setSubmitError(toErrorMessage(error, 'Failed to create task.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[88]">
      <button
        type="button"
        className={`absolute inset-0 bg-black/60 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        aria-label="Close new task modal"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mc-create-task-title"
          className={`relative w-full max-w-3xl rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-secondary)] shadow-[0_24px_80px_rgba(0,0,0,0.45)] transition-[transform,opacity] duration-200 ${
            visible ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
        >
          <form onSubmit={handleSubmit}>
            <div className="border-b border-[var(--border-primary)] px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2 id="mc-create-task-title" className="text-xl font-semibold text-[var(--text-primary)]">
                    New Task
                  </h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    Capture the full task metadata up front so Mission Control can place it correctly.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="mc-shell-btn inline-flex h-9 w-9 items-center justify-center px-0 py-0 text-base text-[var(--text-primary)]"
                  aria-label="Close new task modal"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="max-h-[80vh] overflow-y-auto px-5 py-5 sm:px-6">
              {submitError ? (
                <div className="mb-4 rounded-xl border border-[var(--error)]/40 bg-[var(--surface-error)] px-4 py-3 text-sm text-[var(--error)]">
                  {submitError}
                </div>
              ) : null}

              <div className="grid gap-4">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Task Name
                  </label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={form.name}
                    onChange={(event) => updateField('name', event.target.value)}
                    placeholder="Task name"
                    className="mc-shell-input w-full px-3 py-2.5 text-sm"
                    required
                  />
                </div>

                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Description
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(event) => updateField('description', event.target.value)}
                    placeholder="Description"
                    rows={4}
                    className="mc-shell-input min-h-[120px] w-full resize-y px-3 py-3 text-sm leading-6"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      Assignee
                    </label>
                    <select
                      value={form.assignee}
                      onChange={(event) => updateField('assignee', event.target.value)}
                      className="mc-shell-input w-full px-3 py-2 text-sm"
                    >
                      {assigneeOptions.map((assignee) => (
                        <option key={assignee} value={assignee}>
                          {assignee}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={form.dueDate}
                      onChange={(event) => updateField('dueDate', event.target.value)}
                      className="mc-shell-input w-full px-3 py-2 text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      Priority
                    </label>
                    <select
                      value={form.priority}
                      onChange={(event) => updateField('priority', event.target.value as TaskPriority)}
                      className="mc-shell-input w-full px-3 py-2 text-sm"
                    >
                      {PRIORITY_OPTIONS.map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                      Column
                    </label>
                    <select
                      value={form.column}
                      onChange={(event) => updateField('column', event.target.value as CreateTaskColumn)}
                      className="mc-shell-input w-full px-3 py-2 text-sm"
                    >
                      {CREATE_TASK_COLUMNS.map((column) => (
                        <option key={column} value={column}>
                          {COLUMN_LABELS[column]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end">
                    <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2.5">
                      <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                        <input
                          type="checkbox"
                          checked={form.recurring}
                          onChange={(event) => updateField('recurring', event.target.checked)}
                        />
                        <span>Recurring</span>
                      </label>
                    </div>
                  </div>
                </div>

                <section className="rounded-xl border border-[var(--border-primary)] bg-[var(--bg-primary)] px-4 py-4">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    Projects
                  </div>
                  <div className="mb-3 flex min-h-[28px] flex-wrap gap-2">
                    {selectedProjects.length > 0 ? (
                      selectedProjects.map((project) => (
                        <span
                          key={project.id}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--border-primary)] bg-[var(--bg-tertiary)] px-3 py-1 text-xs text-[var(--text-secondary)]"
                        >
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ backgroundColor: project.color ?? '#6b7280' }}
                            aria-hidden="true"
                          />
                          <span>{project.name}</span>
                        </span>
                      ))
                    ) : (
                      <div className="text-sm text-[var(--text-muted)]">No projects selected.</div>
                    )}
                  </div>

                  <input
                    type="text"
                    value={projectSearch}
                    onChange={(event) => setProjectSearch(event.target.value)}
                    placeholder="Search projects..."
                    className="mc-shell-input w-full px-3 py-2 text-sm"
                  />

                  <div className="mt-3 max-h-52 overflow-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-2">
                    {loadingProjects ? (
                      <div className="px-2 py-3 text-sm text-[var(--text-muted)]">Loading projects...</div>
                    ) : projectError ? (
                      <div className="px-2 py-3 text-sm text-[var(--error)]">{projectError}</div>
                    ) : filteredProjects.length > 0 ? (
                      filteredProjects.map((project) => (
                        <label
                          key={project.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--bg-tertiary)]"
                        >
                          <input
                            type="checkbox"
                            checked={selectedProjectIds.has(project.id)}
                            onChange={() => toggleProjectSelection(project.id)}
                          />
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: project.color ?? '#6b7280' }}
                            aria-hidden="true"
                          />
                          <span>{project.name}</span>
                        </label>
                      ))
                    ) : (
                      <div className="px-2 py-3 text-sm text-[var(--text-muted)]">
                        {projects.length === 0 ? 'No projects available.' : 'No matching projects.'}
                      </div>
                    )}
                  </div>
                </section>

                {assigneeRequired && form.assignee === 'Unassigned' ? (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                    Todo and Doing tasks require an assignee.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[var(--border-primary)] px-5 py-4 sm:px-6">
              <button type="button" onClick={onClose} className="mc-shell-btn px-4 py-2 text-sm" disabled={submitting}>
                Cancel
              </button>
              <button
                type="submit"
                className="mc-shell-btn mc-shell-btn-active px-4 py-2 text-sm font-medium text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={submitting}
              >
                {submitting ? 'Creating...' : 'Create Task'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
