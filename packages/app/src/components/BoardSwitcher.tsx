import { useEffect, useRef, useState } from 'react';
import {
  BOARD_TEMPLATES,
  boardViewToRenderTab,
  type BoardSummary,
  type BoardTemplate,
} from '../lib/boardsState';

const TEMPLATE_LABELS: Record<BoardTemplate, string> = {
  blank: 'Blank',
  strategic: 'Strategic',
  engineering: 'Engineering',
};

interface BoardSwitcherProps {
  boards: BoardSummary[];
  activeBoardId: number | null;
  loading: boolean;
  error: string | null;
  onSelect: (board: BoardSummary) => void;
  onCreate: (input: { name: string; template: BoardTemplate }) => void;
  onRename: (id: number, name: string) => void;
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
  onDelete,
  onRetry,
}: BoardSwitcherProps) {
  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftTemplate, setDraftTemplate] = useState<BoardTemplate>('blank');
  const [menuForId, setMenuForId] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');
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
              <button
                type="button"
                onClick={() => submitRename(board.id)}
                className="mc-shell-btn px-2 py-1 text-xs"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setRenamingId(null)}
                className="mc-shell-btn px-2 py-1 text-xs"
              >
                Cancel
              </button>
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
