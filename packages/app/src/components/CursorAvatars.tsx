import { EditorState, RangeSetBuilder, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import type { DocumentPresenceRecord, DocumentPresenceStatus, JsonValue } from '../types/collaboration';

const ACTIVE_WINDOW_MS = 60_000;
const IDLE_WINDOW_MS = 5 * 60_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function statusRank(status: DocumentPresenceStatus): number {
  switch (status) {
    case 'active':
      return 0;
    case 'idle':
      return 1;
    default:
      return 2;
  }
}

function maxStatus(a: DocumentPresenceStatus, b: DocumentPresenceStatus): DocumentPresenceStatus {
  return statusRank(a) >= statusRank(b) ? a : b;
}

function resolveAgedStatus(lastActivityAt: string | null, nowMs: number): DocumentPresenceStatus {
  if (!lastActivityAt) {
    return 'disconnected';
  }

  const ts = Date.parse(lastActivityAt);
  if (!Number.isFinite(ts)) {
    return 'disconnected';
  }

  const ageMs = nowMs - ts;
  if (ageMs <= ACTIVE_WINDOW_MS) {
    return 'active';
  }
  if (ageMs <= IDLE_WINDOW_MS) {
    return 'idle';
  }
  return 'disconnected';
}

function resolvePresenceTone(presence: DocumentPresenceRecord, nowMs: number): DocumentPresenceStatus {
  const explicit = presence.status ?? 'active';
  const aged = resolveAgedStatus(presence.last_activity_at ?? null, nowMs);
  // Never show a "more active" state than the last-activity window would imply.
  // This preserves explicit disconnects while still aging active->idle->disconnected.
  return maxStatus(explicit, aged);
}

function resolveCursorPos(state: EditorState, cursor: JsonValue): number | null {
  if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
    return null;
  }

  const record = cursor as Record<string, unknown>;
  const posCandidate =
    record.pos ??
    (record.cursor && typeof record.cursor === 'object' ? (record.cursor as Record<string, unknown>).pos : undefined) ??
    (record.position && typeof record.position === 'object' ? (record.position as Record<string, unknown>).pos : undefined);

  if (typeof posCandidate === 'number' && Number.isFinite(posCandidate)) {
    return clamp(Math.floor(posCandidate), 0, state.doc.length);
  }

  const lineCandidate =
    record.line ??
    (record.position && typeof record.position === 'object' ? (record.position as Record<string, unknown>).line : undefined);
  const chCandidate =
    record.ch ??
    record.column ??
    (record.position && typeof record.position === 'object' ? (record.position as Record<string, unknown>).ch : undefined);

  if (typeof lineCandidate === 'number' && typeof chCandidate === 'number') {
    const safeLine = clamp(Math.floor(lineCandidate) + 1, 1, state.doc.lines);
    const line = state.doc.line(safeLine);
    const safeCh = clamp(Math.floor(chCandidate), 0, line.length);
    return clamp(line.from + safeCh, 0, state.doc.length);
  }

  return null;
}

function normalizeActorId(value: string): string {
  return value.trim().toLowerCase();
}

function resolveActorLabel(actorId: string): string {
  switch (normalizeActorId(actorId)) {
    case 'ada':
      return 'Ada';
    case 'spock':
      return 'Spock';
    case 'scotty':
      return 'Scotty';
    case 'human':
      return 'Human';
    default:
      return actorId;
  }
}

class CursorAvatarWidget extends WidgetType {
  private readonly actorId: string;
  private readonly typing: boolean;
  private readonly tone: DocumentPresenceStatus;

  constructor(actorId: string, typing: boolean, tone: DocumentPresenceStatus) {
    super();
    this.actorId = actorId;
    this.typing = typing;
    this.tone = tone;
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span');
    const normalized = normalizeActorId(this.actorId);
    wrapper.className = `cm-remote-cursor cm-remote-cursor-${normalized}`;
    if (this.typing) {
      wrapper.classList.add('cm-remote-cursor-typing');
    }
    if (this.tone === 'idle') {
      wrapper.style.opacity = '0.45';
    }

    const dot = document.createElement('span');
    dot.className = 'cm-remote-cursor-dot';
    dot.textContent = '';

    const label = document.createElement('span');
    label.className = 'cm-remote-cursor-label';
    label.textContent = resolveActorLabel(normalized);

    wrapper.append(dot, label);
    return wrapper;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export interface CursorAvatarsOptions {
  presence: readonly DocumentPresenceRecord[];
}

function buildCursorDecorationSet(state: EditorState, presence: readonly DocumentPresenceRecord[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const length = state.doc.length;
  const nowMs = Date.now();

  for (const entry of presence) {
    const tone = resolvePresenceTone(entry, nowMs);
    if (tone === 'disconnected') {
      continue;
    }

    const pos = resolveCursorPos(state, entry.cursor_json);
    if (pos === null) {
      continue;
    }

    const actionCandidate =
      entry.cursor_json && typeof entry.cursor_json === 'object' && !Array.isArray(entry.cursor_json)
        ? (entry.cursor_json as Record<string, unknown>).action
        : undefined;
    const action = typeof actionCandidate === 'string' ? actionCandidate.trim().toLowerCase() : '';
    const typing = action === 'typing';
    const safePos = clamp(pos, 0, length);

    builder.add(
      safePos,
      safePos,
      Decoration.widget({
        widget: new CursorAvatarWidget(entry.agent_id, typing, tone),
        side: 1,
      })
    );
  }

  return builder.finish();
}

export function buildCursorAvatarsExtension(options: CursorAvatarsOptions): Extension {
  const presence = options.presence ?? [];
  const field = StateField.define<DecorationSet>({
    create(state) {
      return buildCursorDecorationSet(state, presence);
    },
    update(decorations, transaction) {
      if (!transaction.docChanged) {
        return decorations;
      }
      return buildCursorDecorationSet(transaction.state, presence);
    },
    provide(field) {
      return EditorView.decorations.from(field);
    },
  });

  return field;
}
