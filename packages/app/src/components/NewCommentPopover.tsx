import { useEffect, useMemo, useRef, useState } from 'react';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface NewCommentPopoverAnchor {
  left: number;
  top: number;
  bottom: number;
}

export function NewCommentPopover({
  anchor,
  selectedText,
  onSubmit,
  onCancel,
  placeholder = 'Leave a comment…',
  title = 'New Comment',
}: {
  anchor: NewCommentPopoverAnchor;
  selectedText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
  title?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState('');

  const style = useMemo(() => {
    const width = 320;
    const padding = 10;
    const maxLeft = typeof window !== 'undefined' ? window.innerWidth - width - padding : 0;
    const left = clamp(anchor.left, padding, Math.max(padding, maxLeft));
    const top = clamp(anchor.bottom + 10, padding, typeof window !== 'undefined' ? window.innerHeight - 240 : anchor.bottom);

    return { left, top, width };
  }, [anchor.bottom, anchor.left]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!ref.current || !target) {
        return;
      }
      if (!ref.current.contains(target)) {
        onCancel();
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [onCancel]);

  useEffect(() => {
    // Focus first field on mount.
    const timer = window.setTimeout(() => {
      const input = ref.current?.querySelector('textarea') as HTMLTextAreaElement | null;
      input?.focus();
    }, 20);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-[75]">
      <div
        ref={ref}
        className="absolute overflow-hidden rounded-xl border border-[var(--border-secondary)] bg-[var(--card-bg)] shadow-[0_18px_60px_rgba(0,0,0,0.48)]"
        style={style}
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-primary)] px-3 py-2">
          <div className="text-xs font-medium text-[var(--text-primary)]">{title}</div>
          <button
            type="button"
            onClick={onCancel}
            className="mc-shell-btn px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>
        <div className="px-3 py-2">
          <div className="mb-2 rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-muted)]">
            <span className="mr-1 text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">Selection</span>
            <span className="text-[var(--text-secondary)]">{selectedText.trim() ? selectedText : '(empty)'}</span>
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={placeholder}
            className="mc-shell-input h-24 w-full resize-none px-3 py-2 text-sm"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button type="button" onClick={onCancel} className="mc-shell-btn px-3 py-1.5 text-xs">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSubmit(text)}
              disabled={!text.trim()}
              className={`mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] ${
                text.trim() ? '' : 'cursor-not-allowed opacity-40'
              }`}
            >
              Submit
            </button>
          </div>
          <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[var(--text-muted)]">
            Mentions ready: type @Assistant, @Human
          </div>
        </div>
      </div>
    </div>
  );
}

