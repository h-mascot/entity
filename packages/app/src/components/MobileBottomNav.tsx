import { useEffect, useState } from 'react';

export type MobileTab = 'files' | 'agents' | 'tasks' | 'services' | 'chat' | 'activity' | 'admin';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onChange: (tab: MobileTab) => void;
  visibleTabs?: readonly MobileTab[];
}

type IconProps = { className?: string };

function FolderIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h6a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    </svg>
  );
}

function ChecklistIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="4.5" width="15" height="15" rx="2.5" />
      <path d="M7 9.5l2 2 3-3.5" />
      <path d="M7 15h7" />
    </svg>
  );
}

function ChatIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 4V6Z" />
    </svg>
  );
}

function BotIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4.5" y="8" width="15" height="10" rx="3" />
      <path d="M12 8V4.5" />
      <circle cx="12" cy="3.5" r="1" />
      <path d="M9 12.5v1.5" />
      <path d="M15 12.5v1.5" />
      <path d="M20.5 6.5l.6-1.4 1.4-.6-1.4-.6-.6-1.4-.6 1.4-1.4.6 1.4.6.6 1.4Z" />
    </svg>
  );
}

function EllipsisIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="5.5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18.5" cy="12" r="1.4" />
    </svg>
  );
}

function SatelliteIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" transform="rotate(45 7 7)" />
      <path d="M13 11l3.5 3.5" />
      <path d="M14 20a6 6 0 0 0-6-6" />
      <path d="M17.5 20A9.5 9.5 0 0 0 8 10.5" />
    </svg>
  );
}

function PulseIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h4l2.5-6 4 15 2.5-9H21" />
    </svg>
  );
}

function GearIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10.05 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01c.26.63.87 1.04 1.56 1.04H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.94Z" />
    </svg>
  );
}

const PRIMARY_ITEMS: Array<{
  id: MobileTab;
  label: string;
  Icon: (props: IconProps) => JSX.Element;
}> = [
  { id: 'files', label: 'Files', Icon: FolderIcon },
  { id: 'tasks', label: 'Tasks', Icon: ChecklistIcon },
  { id: 'chat', label: 'Chat', Icon: ChatIcon },
  { id: 'agents', label: 'Agents', Icon: BotIcon },
];

const MORE_ITEMS: Array<{
  id: MobileTab;
  label: string;
  Icon: (props: IconProps) => JSX.Element;
}> = [
  { id: 'services', label: 'Services', Icon: SatelliteIcon },
  { id: 'activity', label: 'Activity', Icon: PulseIcon },
  { id: 'admin', label: 'Admin', Icon: GearIcon },
];

export default function MobileBottomNav({
  activeTab,
  onChange,
  visibleTabs = [...PRIMARY_ITEMS.map((item) => item.id), ...MORE_ITEMS.map((item) => item.id)],
}: MobileBottomNavProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const primaryItems = PRIMARY_ITEMS.filter((item) => visibleTabs.includes(item.id));
  const moreItems = MORE_ITEMS.filter((item) => visibleTabs.includes(item.id));
  const moreActive = moreItems.some((item) => item.id === activeTab);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  const selectMore = (tab: MobileTab) => {
    onChange(tab);
    setSheetOpen(false);
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="entity-mobile-nav-shadow fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-[var(--border-primary)] px-2 py-1.5 md:hidden"
        style={{
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
          background: 'color-mix(in srgb, var(--bg-secondary) 88%, transparent)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {primaryItems.map((item) => {
          const active = item.id === activeTab;
          const Icon = item.Icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`flex min-h-[48px] w-14 flex-col items-center justify-center gap-0.5 rounded-full transition-colors ${
                active ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
              }`}
              style={
                active
                  ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)' }
                  : undefined
              }
            >
              <Icon className="h-6 w-6" />
              {active ? (
                <span className="text-[10px] font-medium leading-none">{item.label}</span>
              ) : null}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="More"
          aria-current={moreActive ? 'page' : undefined}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          className={`flex min-h-[48px] w-14 flex-col items-center justify-center gap-0.5 rounded-full transition-colors ${
            moreActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'
          }`}
          style={
            moreActive
              ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)' }
              : undefined
          }
        >
          <EllipsisIcon className="h-6 w-6" />
          {moreActive ? (
            <span className="text-[10px] font-medium leading-none">More</span>
          ) : null}
        </button>
      </nav>

      {sheetOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="More options">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/50"
          />
          <div
            className="entity-mobile-nav-shadow entity-mobile-sheet-enter absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 pt-3"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--border-primary)]" />
            {moreItems.map((item, index) => {
              const Icon = item.Icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectMore(item.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`${index > 0 ? 'mt-1 ' : ''}flex w-full items-center gap-3 rounded-xl px-3 py-3.5 text-left transition-colors ${
                    active ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                  }`}
                  style={active ? { background: 'color-mix(in srgb, var(--accent) 18%, transparent)' } : undefined}
                >
                  <Icon className="h-6 w-6 shrink-0" />
                  <span className="text-[15px] font-medium">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}
