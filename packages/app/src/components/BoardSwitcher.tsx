import { useEffect, useRef, useState } from 'react';
import {
  BOARD_TEMPLATES,
  BOARD_VIEWS,
  boardViewToRenderTab,
  boardViewSupportsFilter,
  buildBoardCustomizationPatch,
  type BoardSummary,
  type BoardTemplate,
  type BoardView,
  type BoardFilterScope,
} from '../lib/boardsState';

const TEMPLATE_LABELS: Record<BoardTemplate, string> = {
  blank: 'Blank',
  strategic: 'Strategic',
  engineering: 'Engineering',
};

const VIEW_LABELS: Record<BoardView, string> = {
  board: 'Board',
  analytics: 'Analytics',
  strategic: 'Strategic',
  engineering: 'Engineering',
};

const FILTER_SCOPES: BoardFilterScope[] = ['all', 'projects', 'workDomain', 'none'];

interface BoardSwitcherProps {
  boards: BoardSummary[];
  activeBoardId: number | null;
  loading: boolean;
  error: string | null;
  onSelect: (board: BoardSummary) => void;
  onCreate: (input: { name: string; template: BoardTemplate }) => void;
  onRename: (id: number, name: string) => void;
  onCustomize: (
    id: number,
    updates: { view?: BoardView; filter_config: BoardSummary['filter_config'] },
  ) => void;
  onReorder: (orderedIds: readonly number[]) => void;
  onDelete: (id: number) => void;
  onRetry?: () => void;
}

/**
 * Accessible, responsive board switcher replacing the fixed Tasks peer tabs.
 * Shows General / Analytics defaults plus user boards, an "+ Add board" creator
 * (Blank / Strategic / Engineering templates), and per-board rename/delete for
 * non-default boards. Swarm is intentionally not present (it is a task capability).
 */
export function BoardSwitcher({
  boards,
  activeBoardId,
  loading,
  error,
  onSelect,
  onCreate,
  onRename,
  onCustomize,
  onReorder,
  onDelete,
  onRetry,
}: BoardSwitcherProps) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftTemplate, setDraftTemplate] = useState<BoardTemplate>('blank');
  const [menuForId, setMenuForId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [customizingId, setCustomizingId] = useState<number | null>(null);
  const [customizeView, setCustomizeView] = useState<BoardView>('board');
  const [customizeScope, setCustomizeScope] = useState<BoardFilterScope>('all');
  const [customizeWorkDomain, setCustomizeWorkDomain] = useState('');
  const [customizeProjectIds, setCustomizeProjectIds] = useState('');
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (renamingId !== null) renameInputRef.current?.focus();
  }, [renamingId]);

  function submitCreate() {
    const name = draftName.trim() || `${TEMPLATE_LABELS[draftTemplate]} board`;
    onCreate({ name, template: draftTemplate });
    setDraftName('');
    setDraftTemplate('blank');
    setAdding(false);
  }

  function submitRename(id: number) {
    const name = renameValue.trim();
    if (name) onRename(id, name);
    setRenamingId(null);
    setRenameValue('');
  }

  function openCustomize(board: BoardSummary) {
    setCustomizingId(board.id);
    setCustomizeView(board.view);
    setCustomizeScope(boardViewSupportsFilter(board.view) ? board.filter_config.scope : 'all');
    setCustomizeWorkDomain(board.filter_config.workDomain ?? '');
    setCustomizeProjectIds(
      Array.isArray(board.filter_config.projectIds) ? board.filter_config.projectIds.join(',') : '',
    );
    setMenuForId(null);
  }

  function submitCustomize(id: number) {
    const patch = buildBoardCustomizationPatch({
      view: customizeView,
      scope: customizeScope,
      workDomain: customizeWorkDomain,
      projectIdsCsv: customizeProjectIds,
    });
    onCustomize(id, patch);
    setCustomizingId(null);
  }

  function moveBoard(board: BoardSummary, delta: -1 | 1) {
    const orderedIds = boards.map((b) => b.id);
    const idx = orderedIds.indexOf(board.id);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= orderedIds.length) return;
    const next = orderedIds.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    onReorder(next);
    setMenuForId(null);
  }

  if (loading && boards.length === 0) {
    return (
      <span className="mc-shell-pill px-3 py-1 text-xs text-[var(--text-muted)]" aria-live="polite">
        Loading boards…
      </span>
    );
  }

  if (error && boards.length === 0) {
    return (
      <span className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
        <span>{error}</span>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="mc-shell-btn px-2 py-1 text-xs">
            Retry
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Boards">
      {boards.map((board) => {
        const isActive = board.id === activeBoardId;
        const renderTab = boardViewToRenderTab(board.view);
        const label =
          board.name ||
          (board.key === 'general' ? 'General' : board.key === 'analytics' ? 'Analytics' : 'Board');

        if (renamingId === board.id) {
          return (
            <span key={board.id} className="flex items-center gap-1">
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename(board.id);
                  if (e.key === 'Escape') setRenamingId(null);
                }}
                maxLength={80}
                aria-label={`Rename ${label} board`}
                className="mc-shell-input px-2 py-1 text-xs"
              />
              <button type="button" onClick={() => submitRename(board.id)} className="mc-shell-btn px-2 py-1 text-xs">
                Save
              </button>
              <button type="button" onClick={() => setRenamingId(null)} className="mc-shell-btn px-2 py-1 text-xs">
                Cancel
              </button>
            </span>
          );
        }

        if (customizingId === board.id) {
          // BRD-002: customize view + task inclusion/filter configuration.
          // D2: only views that consume the persisted task-inclusion filter
          // (board/analytics/engineering) support filter customization. The
          // Strategic view renders roadmaps and ignores the filter, so its filter
          // controls are disabled (the persistence layer also collapses to 'all').
          const filterSupported = boardViewSupportsFilter(customizeView);
          return (
            <span key={board.id} className="flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-2 shadow-lg" role="dialog" aria-label={`Customize ${label} board`}>
              <span className="flex items-center gap-1">
                <label className="text-[10px] text-[var(--text-muted)]" htmlFor={`customize-view-${board.id}`}>View</label>
                <select
                  id={`customize-view-${board.id}`}
                  value={customizeView}
                  onChange={(e) => setCustomizeView(e.target.value as BoardView)}
                  className="mc-shell-input px-1 py-1 text-xs"
                >
                  {BOARD_VIEWS.map((view) => (
                    <option key={view} value={view}>{VIEW_LABELS[view]}</option>
                  ))}
                </select>
                <label
                  className={`text-[10px] ${filterSupported ? 'text-[var(--text-muted)]' : 'text-[var(--text-muted)]/60'}`}
                  htmlFor={`customize-scope-${board.id}`}
                >Tasks</label>
                <select
                  id={`customize-scope-${board.id}`}
                  value={filterSupported ? customizeScope : 'all'}
                  onChange={(e) => setCustomizeScope(e.target.value as BoardFilterScope)}
                  disabled={!filterSupported}
                  aria-disabled={!filterSupported}
                  className="mc-shell-input px-1 py-1 text-xs disabled:opacity-60"
                >
                  {FILTER_SCOPES.map((scope) => (
                    <option key={scope} value={scope}>{scope}</option>
                  ))}
                </select>
              </span>
              {filterSupported && customizeScope === 'workDomain' ? (
                <input
                  type="text"
                  value={customizeWorkDomain}
                  onChange={(e) => setCustomizeWorkDomain(e.target.value)}
                  placeholder="work-domain (e.g. engineering)"
                  maxLength={64}
                  aria-label="Work domain filter"
                  className="mc-shell-input px-2 py-1 text-xs"
                />
              ) : null}
              {filterSupported && customizeScope === 'projects' ? (
                <input
                  type="text"
                  value={customizeProjectIds}
                  onChange={(e) => setCustomizeProjectIds(e.target.value)}
                  placeholder="project ids, comma-separated"
                  aria-label="Project ids filter"
                  className="mc-shell-input px-2 py-1 text-xs"
                />
              ) : null}
              {!filterSupported ? (
                <span className="text-[10px] text-[var(--text-muted)]">
                  Strategic view shows roadmaps; task filter isn’t applied.
                </span>
              ) : null}
              <span className="flex items-center gap-1">
                <button type="button" onClick={() => submitCustomize(board.id)} className="mc-shell-btn px-2 py-1 text-xs">Save</button>
                <button type="button" onClick={() => setCustomizingId(null)} className="mc-shell-btn px-2 py-1 text-xs">Cancel</button>
              </span>
            </span>
          );
        }

        return (
          <span key={board.id} className="flex items-center gap-1">
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-pressed={isActive}
              onClick={() => onSelect(board)}
              data-active={renderTab}
              className={`mc-shell-btn entity-context-tab px-3 py-1 text-xs font-medium ${
                isActive ? 'mc-shell-btn-active text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}
            >
              {label}
            </button>
            {!board.is_default ? (
              <span className="relative">
                <button
                  type="button"
                  aria-label={`Customize ${label} board`}
                  aria-haspopup="menu"
                  aria-expanded={menuForId === board.id}
                  onClick={() => setMenuForId(menuForId === board.id ? null : board.id)}
                  className="mc-shell-btn px-1 py-1 text-xs text-[var(--text-muted)]"
                >
                  •••
                </button>
                {menuForId === board.id ? (
                  <span
                    role="menu"
                    className="absolute left-0 top-full z-30 mt-1 flex flex-col gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-1 shadow-lg"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setRenamingId(board.id);
                        setRenameValue(board.name);
                        setMenuForId(null);
                      }}
                      className="mc-shell-btn px-2 py-1 text-left text-xs"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => openCustomize(board)}
                      className="mc-shell-btn px-2 py-1 text-left text-xs"
                    >
                      Customize view &amp; tasks
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => moveBoard(board, -1)}
                      className="mc-shell-btn px-2 py-1 text-left text-xs"
                    >
                      Move left
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => moveBoard(board, 1)}
                      className="mc-shell-btn px-2 py-1 text-left text-xs"
                    >
                      Move right
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        if (typeof window !== 'undefined' && window.confirm(`Delete the "${label}" board? Tasks are not deleted.`)) {
                          onDelete(board.id);
                        }
                        setMenuForId(null);
                      }}
                      className="mc-shell-btn px-2 py-1 text-left text-xs text-[var(--text-muted)]"
                    >
                      Delete
                    </button>
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
        );
      })}

      {adding ? (
        <span className="flex flex-wrap items-center gap-1">
          <input
            ref={addInputRef}
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate();
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="Board name"
            maxLength={80}
            aria-label="New board name"
            className="mc-shell-input px-2 py-1 text-xs"
          />
          <select
            value={draftTemplate}
            onChange={(e) => setDraftTemplate(e.target.value as BoardTemplate)}
            aria-label="Board template"
            className="mc-shell-input px-2 py-1 text-xs"
          >
            {BOARD_TEMPLATES.map((template) => (
              <option key={template} value={template}>
                {TEMPLATE_LABELS[template]}
              </option>
            ))}
          </select>
          <button type="button" onClick={submitCreate} className="mc-shell-btn px-2 py-1 text-xs">
            Create
          </button>
          <button type="button" onClick={() => setAdding(false)} className="mc-shell-btn px-2 py-1 text-xs">
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mc-shell-btn entity-context-tab px-3 py-1 text-xs font-medium text-[var(--text-muted)]"
          aria-label="Add board"
        >
          + Add board
        </button>
      )}
    </div>
  );
}

export default BoardSwitcher;
