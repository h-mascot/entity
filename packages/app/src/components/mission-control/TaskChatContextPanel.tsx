import { useEffect, useMemo, useState } from 'react';
import { buildApiCandidates, requestJsonWithFallback, toErrorMessage } from '../../lib/http';

type ReadinessState = 'live' | 'staged' | 'degraded' | 'unavailable' | 'not_configured';

interface ClickClackReadiness {
  state: ReadinessState;
  configured: boolean;
  bridgeEnabled: boolean;
  baseUrl: string | null;
  reason: string;
  checkedAt: string;
}

interface ChatChannelSummary {
  id: string;
  name: string;
  description?: string;
}

interface ChatThreadSummary {
  id: string;
  title: string;
  messageCount?: number;
}

interface ChatTaskPayload {
  taskId: string;
  channel: ChatChannelSummary | null;
  messages: unknown[];
  threads: ChatThreadSummary[];
}

interface ChatObjectRef {
  object_type: string;
  object_id: string;
  link_role: string;
}

interface ObjectRefPayload {
  object_refs: ChatObjectRef[];
  restricted_count: number;
}

export interface ChatCanonicalContext {
  label: string;
  value: string;
  href?: string | null;
}

interface TaskChatContextPanelProps {
  taskId: number;
  apiBase?: string;
  proofAvailable: boolean;
  documentObjectCount: number;
  outputLinkCount: number;
  canonicalContext?: ChatCanonicalContext[];
}

interface PanelState {
  readiness: ClickClackReadiness | null;
  chat: ChatTaskPayload | null;
  refs: ObjectRefPayload | null;
  error: string | null;
}

const READINESS_COPY: Record<ReadinessState, { label: string; tone: string; description: string }> = {
  live: {
    label: 'Live',
    tone: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
    description: 'ClickClack bridge is ready for work-object collaboration.',
  },
  staged: {
    label: 'Staged',
    tone: 'border-sky-500/25 bg-sky-500/10 text-sky-200',
    description: 'Chat context is configured or planned, but the bridge is not live.',
  },
  degraded: {
    label: 'Degraded',
    tone: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    description: 'Chat context is partially available; Entity work state remains canonical.',
  },
  unavailable: {
    label: 'Unavailable',
    tone: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
    description: 'Chat transport is unavailable. Proof, docs, and review remain visible in Entity.',
  },
  not_configured: {
    label: 'Not configured',
    tone: 'border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--text-secondary)]',
    description: 'No ClickClack bridge is configured for this environment.',
  },
};

function formatToken(value: string | null | undefined): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.replace(/[_-]+/g, ' ') : 'unknown';
}

function buildDefaultContext(taskId: number, proofAvailable: boolean, documentObjectCount: number, outputLinkCount: number): ChatCanonicalContext[] {
  return [
    { label: 'Task', value: `Entity task #${taskId}` },
    { label: 'Proof', value: proofAvailable ? 'Canonical proof panel remains below' : 'No proof receipt recorded yet' },
    { label: 'Docs/files/artifacts', value: `${documentObjectCount} Entity object${documentObjectCount === 1 ? '' : 's'}` },
    { label: 'Output links', value: `${outputLinkCount} canonical output link${outputLinkCount === 1 ? '' : 's'}` },
  ];
}

export default function TaskChatContextPanel({
  taskId,
  apiBase = '',
  proofAvailable,
  documentObjectCount,
  outputLinkCount,
  canonicalContext,
}: TaskChatContextPanelProps) {
  const [state, setState] = useState<PanelState>({
    readiness: null,
    chat: null,
    refs: null,
    error: null,
  });

  const contextRows = useMemo(
    () => canonicalContext && canonicalContext.length > 0
      ? canonicalContext
      : buildDefaultContext(taskId, proofAvailable, documentObjectCount, outputLinkCount),
    [canonicalContext, documentObjectCount, outputLinkCount, proofAvailable, taskId],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setState((current) => ({ ...current, error: null }));
      try {
        const [readinessPayload, chatPayload] = await Promise.all([
          requestJsonWithFallback<{ readiness: ClickClackReadiness }>({
            urls: buildApiCandidates('/chat/clickclack/readiness', apiBase),
            fallbackError: 'Unable to load ClickClack readiness.',
          }),
          requestJsonWithFallback<ChatTaskPayload>({
            urls: buildApiCandidates(`/chat/task/${taskId}`, apiBase),
            fallbackError: 'Unable to load chat context.',
          }),
        ]);

        let refs: ObjectRefPayload | null = null;
        if (chatPayload.channel?.id) {
          refs = await requestJsonWithFallback<ObjectRefPayload>({
            urls: buildApiCandidates(`/chat/channels/${encodeURIComponent(chatPayload.channel.id)}/object-refs`, apiBase),
            init: { headers: { 'x-entity-org-id': 'entity' } },
            continueOnStatuses: [404],
            fallbackError: 'Unable to load chat ObjectRefs.',
          }).catch(() => null);
        }

        if (!cancelled) {
          setState({
            readiness: readinessPayload.readiness,
            chat: chatPayload,
            refs,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            readiness: current.readiness ?? {
              state: 'unavailable',
              configured: false,
              bridgeEnabled: false,
              baseUrl: null,
              reason: 'panel_load_failed',
              checkedAt: new Date().toISOString(),
            },
            error: toErrorMessage(error, 'Unable to load embedded chat context.'),
          }));
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBase, taskId]);

  const readiness = state.readiness;
  const readinessCopy = readiness ? READINESS_COPY[readiness.state] : READINESS_COPY.unavailable;
  const messageCount = state.chat?.messages.length ?? 0;
  const threadCount = state.chat?.threads.length ?? 0;
  const objectRefs = state.refs?.object_refs ?? [];
  const restrictedCount = state.refs?.restricted_count ?? 0;

  return (
    <section
      style={{ order: 3 }}
      className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-3"
      data-testid="task-chat-context-panel"
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Embedded Chat Context
          </div>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            ClickClack collaboration appears here as context only. Entity remains canonical for task, docs, proof, and review.
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] ${readinessCopy.tone}`}
          data-testid="task-chat-readiness-state"
        >
          {readinessCopy.label}
        </span>
      </div>

      <div className="grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Readiness</div>
          <div>{readinessCopy.description}</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
            Reason: {formatToken(readiness?.reason)}
          </div>
        </div>

        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Linked channel</div>
          {state.chat?.channel ? (
            <>
              <div>{state.chat.channel.name || state.chat.channel.id}</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                {messageCount} message{messageCount === 1 ? '' : 's'} / {threadCount} thread{threadCount === 1 ? '' : 's'}
              </div>
            </>
          ) : (
            <>
              <div>No task channel linked yet.</div>
              <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">Panel remains staged until chat context exists.</div>
            </>
          )}
        </div>

        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Canonical Entity context</div>
          <div className="mt-1 grid gap-1 sm:grid-cols-2">
            {contextRows.map((entry) => (
              <div key={`${entry.label}-${entry.value}`} className="rounded border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-1">
                <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">{entry.label}</div>
                {entry.href ? (
                  <a href={entry.href} className="text-sky-300 hover:text-sky-200">{entry.value}</a>
                ) : (
                  <div>{entry.value}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1.5 sm:col-span-2">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">Permission-filtered chat ObjectRefs</div>
          {objectRefs.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {objectRefs.slice(0, 6).map((ref) => (
                <span
                  key={`${ref.object_type}:${ref.object_id}:${ref.link_role}`}
                  className="rounded-full border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-2 py-0.5 text-[11px]"
                >
                  {formatToken(ref.link_role)}: {formatToken(ref.object_type)} {ref.object_id}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-[var(--text-muted)]">No visible chat ObjectRefs for this task channel.</div>
          )}
          {restrictedCount > 0 ? (
            <div className="mt-1 text-[11px] text-amber-200">
              {restrictedCount} linked object{restrictedCount === 1 ? '' : 's'} hidden by Entity permissions.
            </div>
          ) : null}
        </div>
      </div>

      {state.error ? (
        <div className="mt-2 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100">
          {state.error}
        </div>
      ) : null}
    </section>
  );
}
