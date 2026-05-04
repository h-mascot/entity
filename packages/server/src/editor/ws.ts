import { WebSocket } from 'ws';

export type EditorChannelEvent =
  | 'document.state'
  | 'document.presence'
  | 'document.edit'
  | 'document.comment'
  | 'document.suggestion'
  | 'document.review';

export interface EditorWsEnvelope<TPayload = unknown> {
  type: 'editor:event';
  event: EditorChannelEvent;
  docId: string;
  payload: TPayload;
  emittedAt: string;
}

export interface EditorWsBroadcaster {
  broadcast: <TPayload>(event: EditorChannelEvent, docId: string, payload: TPayload) => void;
  broadcastState: (docId: string, payload: Record<string, unknown>) => void;
  broadcastPresence: (docId: string, payload: Record<string, unknown>) => void;
  broadcastEdit: (docId: string, payload: Record<string, unknown>) => void;
  broadcastComment: (docId: string, payload: Record<string, unknown>) => void;
  broadcastSuggestion: (docId: string, payload: Record<string, unknown>) => void;
  broadcastReview: (docId: string, payload: Record<string, unknown>) => void;
}

function createEnvelope<TPayload>(event: EditorChannelEvent, docId: string, payload: TPayload): EditorWsEnvelope<TPayload> {
  return {
    type: 'editor:event',
    event,
    docId,
    payload,
    emittedAt: new Date().toISOString(),
  };
}

export function createEditorWsBroadcaster(clients: ReadonlySet<WebSocket>): EditorWsBroadcaster {
  const broadcast = <TPayload>(event: EditorChannelEvent, docId: string, payload: TPayload): void => {
    const normalizedDocId = docId.trim();
    if (!normalizedDocId) {
      return;
    }

    const message = JSON.stringify(createEnvelope(event, normalizedDocId, payload));
    clients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) {
        return;
      }

      try {
        client.send(message);
      } catch {
        // Ignore transient socket send failures on broadcast fanout.
      }
    });
  };

  return {
    broadcast,
    broadcastState: (docId, payload) => broadcast('document.state', docId, payload),
    broadcastPresence: (docId, payload) => broadcast('document.presence', docId, payload),
    broadcastEdit: (docId, payload) => broadcast('document.edit', docId, payload),
    broadcastComment: (docId, payload) => broadcast('document.comment', docId, payload),
    broadcastSuggestion: (docId, payload) => broadcast('document.suggestion', docId, payload),
    broadcastReview: (docId, payload) => broadcast('document.review', docId, payload),
  };
}
