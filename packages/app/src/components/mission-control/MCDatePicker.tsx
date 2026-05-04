import { useEffect, useMemo, useRef, useState } from 'react';

interface MCDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

interface CalendarDay {
  date: Date;
  inCurrentMonth: boolean;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const DATE_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateValue(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function parseDateValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
}

function toMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(left: Date | null, right: Date): boolean {
  if (!left) {
    return false;
  }

  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function buildCalendarDays(month: Date): CalendarDay[] {
  const monthStart = toMonthStart(month);
  const firstVisibleDay = new Date(monthStart);
  firstVisibleDay.setDate(monthStart.getDate() - monthStart.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(firstVisibleDay.getFullYear(), firstVisibleDay.getMonth(), firstVisibleDay.getDate() + index);
    return {
      date,
      inCurrentMonth: date.getMonth() === monthStart.getMonth(),
    };
  });
}

export default function MCDatePicker({
  value,
  onChange,
  disabled = false,
  placeholder = 'Pick a date',
}: MCDatePickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedDate = useMemo(() => parseDateValue(value), [value]);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => toMonthStart(selectedDate ?? new Date()));

  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const today = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!open) {
      return;
    }

    setVisibleMonth(toMonthStart(selectedDate ?? new Date()));
  }, [open, selectedDate]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  const selectDate = (date: Date) => {
    onChange(formatDateValue(date));
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="mc-shell-input flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60"
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={disabled}
      >
        <span className={selectedDate ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}>
          {selectedDate ? DATE_LABEL_FORMATTER.format(selectedDate) : placeholder}
        </span>
        <span className="text-xs text-[var(--text-muted)]" aria-hidden="true">
          {open ? 'Close' : selectedDate ? 'Change' : 'Pick'}
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 z-20 mt-2 w-[18rem] rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="mc-shell-btn inline-flex h-8 w-8 items-center justify-center px-0 py-0 text-sm"
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
              aria-label="Previous month"
            >
              {'<'}
            </button>
            <div className="text-sm font-medium text-[var(--text-primary)]">{MONTH_LABEL_FORMATTER.format(visibleMonth)}</div>
            <button
              type="button"
              className="mc-shell-btn inline-flex h-8 w-8 items-center justify-center px-0 py-0 text-sm"
              onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
              aria-label="Next month"
            >
              {'>'}
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="py-1">
                {label}
              </div>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarDays.map(({ date, inCurrentMonth }) => {
              const selected = isSameDay(selectedDate, date);
              const isToday = isSameDay(today, date);

              return (
                <button
                  key={formatDateValue(date)}
                  type="button"
                  onClick={() => selectDate(date)}
                  className={`inline-flex h-9 items-center justify-center rounded-lg border text-sm transition ${
                    selected
                      ? 'border-[var(--accent)] bg-[var(--surface-accent)] text-[var(--text-primary)]'
                      : isToday
                        ? 'border-[var(--accent)]/50 bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--surface-accent)]/60'
                        : 'border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                  } ${inCurrentMonth ? '' : 'opacity-45'}`}
                  aria-pressed={selected}
                  aria-label={DATE_LABEL_FORMATTER.format(date)}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-primary)] pt-3">
            <button
              type="button"
              className="mc-shell-btn px-3 py-1.5 text-xs"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              Clear
            </button>
            <button
              type="button"
              className="mc-shell-btn mc-shell-btn-active border-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--text-primary)]"
              onClick={() => selectDate(today)}
            >
              Today
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
