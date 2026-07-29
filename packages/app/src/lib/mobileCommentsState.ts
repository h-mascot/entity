export type MobileCommentsLoadState = 'loading' | 'empty' | 'loaded' | 'error';
export type MobileCommentsSubmitState = 'idle' | 'sending' | 'success' | 'failure';

export interface MobileCommentItem {
  id: string;
}

export interface MobileCommentsState<T extends MobileCommentItem = MobileCommentItem> {
  documentIdentity: string;
  loadState: MobileCommentsLoadState;
  threads: T[];
  loadMessage: string | null;
  submitState: MobileCommentsSubmitState;
  submitMessage: string | null;
}

export interface MobileCommentComposerState {
  documentIdentity: string;
  draft: string;
  submitState: MobileCommentsSubmitState;
  submitMessage: string | null;
}

export type MobileCommentsEvent<T extends MobileCommentItem = MobileCommentItem> =
  | { type: 'document-changed'; documentIdentity: string }
  | { type: 'load-started'; documentIdentity: string }
  | { type: 'load-succeeded'; documentIdentity: string; threads: T[] }
  | { type: 'load-failed'; documentIdentity: string; status?: number }
  | { type: 'submit-succeeded'; documentIdentity: string; thread: T }
  | { type: 'submit-failed'; documentIdentity: string; status?: number };

export function mobileCommentsPermissionMessage(status: number): string | null {
  if (status === 401) {
    return 'Your Documents session has expired. Sign in again to view comments.';
  }
  if (status === 403) {
    return 'You do not have permission to access comments for this document.';
  }
  return null;
}

function failureMessage(status: number | undefined, fallback: string): string {
  return status === undefined
    ? fallback
    : mobileCommentsPermissionMessage(status) ?? fallback;
}

export function createMobileCommentsState<T extends MobileCommentItem = MobileCommentItem>(
  documentIdentity: string,
): MobileCommentsState<T> {
  return {
    documentIdentity,
    loadState: 'loading',
    threads: [],
    loadMessage: null,
    submitState: 'idle',
    submitMessage: null,
  };
}

export function reduceMobileCommentsState<T extends MobileCommentItem>(
  state: MobileCommentsState<T>,
  event: MobileCommentsEvent<T>,
): MobileCommentsState<T> {
  if (event.type === 'document-changed') {
    return createMobileCommentsState<T>(event.documentIdentity);
  }
  if (event.documentIdentity !== state.documentIdentity) {
    return state;
  }
  if (event.type === 'load-started') {
    return {
      ...state,
      loadState: 'loading',
      threads: [],
      loadMessage: null,
    };
  }
  if (event.type === 'load-succeeded') {
    return {
      ...state,
      loadState: event.threads.length === 0 ? 'empty' : 'loaded',
      threads: event.threads,
      loadMessage: null,
    };
  }
  if (event.type === 'load-failed') {
    return {
      ...state,
      loadState: 'error',
      threads: [],
      loadMessage: failureMessage(event.status, 'Comments could not be loaded. Try again.'),
    };
  }
  if (event.type === 'submit-succeeded') {
    const existingIndex = state.threads.findIndex((thread) => thread.id === event.thread.id);
    const threads = existingIndex < 0
      ? [...state.threads, event.thread]
      : state.threads.map((thread, index) => index === existingIndex ? event.thread : thread);
    return {
      ...state,
      loadState: 'loaded',
      threads,
      submitState: 'success',
      submitMessage: 'Comment posted.',
    };
  }
  return {
    ...state,
    submitState: 'failure',
    submitMessage: failureMessage(event.status, 'Comment could not be posted. Try again.'),
  };
}

export function beginMobileCommentSubmit<T extends MobileCommentItem>(
  state: MobileCommentsState<T>,
  body: string,
): { accepted: boolean; state: MobileCommentsState<T> } {
  if (state.submitState === 'sending' || !body.trim()) {
    return { accepted: false, state };
  }
  return {
    accepted: true,
    state: {
      ...state,
      submitState: 'sending',
      submitMessage: null,
    },
  };
}

export function settleMobileCommentSubmit(
  state: MobileCommentComposerState,
  completion: {
    documentIdentity: string;
    outcome: 'success' | 'failure';
    message: string;
  },
): MobileCommentComposerState {
  if (completion.documentIdentity !== state.documentIdentity) {
    return state;
  }

  return {
    ...state,
    draft: completion.outcome === 'success' ? '' : state.draft,
    submitState: completion.outcome,
    submitMessage: completion.message,
  };
}
