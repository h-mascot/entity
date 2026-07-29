import test from 'node:test';
import assert from 'node:assert/strict';

type CommentThread = {
  id: string;
  body: string;
};

type MobileCommentsState = {
  documentIdentity: string;
  loadState: 'loading' | 'empty' | 'loaded' | 'error';
  threads: CommentThread[];
  loadMessage: string | null;
  submitState: 'idle' | 'sending' | 'success' | 'failure';
  submitMessage: string | null;
};

type MobileCommentsEvent =
  | { type: 'document-changed'; documentIdentity: string }
  | { type: 'load-started'; documentIdentity: string }
  | { type: 'load-succeeded'; documentIdentity: string; threads: CommentThread[] }
  | { type: 'load-failed'; documentIdentity: string; status?: number }
  | { type: 'submit-succeeded'; documentIdentity: string; thread: CommentThread }
  | { type: 'submit-failed'; documentIdentity: string; status?: number };

type MobileCommentsStateModule = {
  createMobileCommentsState: (documentIdentity: string) => MobileCommentsState;
  reduceMobileCommentsState: (
    state: MobileCommentsState,
    event: MobileCommentsEvent,
  ) => MobileCommentsState;
  beginMobileCommentSubmit: (
    state: MobileCommentsState,
    body: string,
  ) => {
    accepted: boolean;
    state: MobileCommentsState;
  };
  mobileCommentsPermissionMessage: (status: number) => string | null;
  settleMobileCommentSubmit: (
    state: {
      documentIdentity: string;
      draft: string;
      submitState: 'idle' | 'sending' | 'success' | 'failure';
      submitMessage: string | null;
    },
    completion: {
      documentIdentity: string;
      outcome: 'success' | 'failure';
      message: string;
    },
  ) => {
    documentIdentity: string;
    draft: string;
    submitState: 'idle' | 'sending' | 'success' | 'failure';
    submitMessage: string | null;
  };
};

const modulePath: string = './mobileCommentsState.ts';

async function loadStateModule(): Promise<MobileCommentsStateModule> {
  return import(modulePath) as Promise<MobileCommentsStateModule>;
}

test('mobile comments model exposes loading, empty, loaded, and error states', async () => {
  const {
    createMobileCommentsState,
    reduceMobileCommentsState,
  } = await loadStateModule();
  const identity = '["workspace","output/daily-brief.md"]';
  const initial = createMobileCommentsState(identity);

  assert.equal(initial.loadState, 'loading');
  assert.deepEqual(initial.threads, []);

  const empty = reduceMobileCommentsState(initial, {
    type: 'load-succeeded',
    documentIdentity: identity,
    threads: [],
  });
  assert.equal(empty.loadState, 'empty');

  const loaded = reduceMobileCommentsState(initial, {
    type: 'load-succeeded',
    documentIdentity: identity,
    threads: [{ id: 'thread-1', body: 'Ship it.' }],
  });
  assert.equal(loaded.loadState, 'loaded');
  assert.deepEqual(loaded.threads, [{ id: 'thread-1', body: 'Ship it.' }]);

  const failed = reduceMobileCommentsState(initial, {
    type: 'load-failed',
    documentIdentity: identity,
  });
  assert.equal(failed.loadState, 'error');
  assert.notEqual(failed.loadMessage?.trim(), '');
});

test('document changes reset comments and reject stale load results', async () => {
  const {
    createMobileCommentsState,
    reduceMobileCommentsState,
  } = await loadStateModule();
  const firstIdentity = '["book","memory/first.md"]';
  const secondIdentity = '["workspace","output/second.md"]';
  const firstLoaded = reduceMobileCommentsState(
    createMobileCommentsState(firstIdentity),
    {
      type: 'load-succeeded',
      documentIdentity: firstIdentity,
      threads: [{ id: 'thread-a', body: 'First document only' }],
    },
  );
  const secondLoading = reduceMobileCommentsState(firstLoaded, {
    type: 'document-changed',
    documentIdentity: secondIdentity,
  });

  assert.equal(secondLoading.documentIdentity, secondIdentity);
  assert.equal(secondLoading.loadState, 'loading');
  assert.deepEqual(secondLoading.threads, []);

  const afterStaleResult = reduceMobileCommentsState(secondLoading, {
    type: 'load-succeeded',
    documentIdentity: firstIdentity,
    threads: [{ id: 'thread-stale', body: 'Must not leak' }],
  });
  assert.deepEqual(afterStaleResult, secondLoading);
  assert.equal(JSON.stringify(afterStaleResult).includes('Must not leak'), false);
});

test('duplicate comment submissions are rejected while one is pending', async () => {
  const {
    createMobileCommentsState,
    beginMobileCommentSubmit,
  } = await loadStateModule();
  const initial = createMobileCommentsState('["workspace","output/report.md"]');

  const first = beginMobileCommentSubmit(initial, 'A useful comment');
  assert.equal(first.accepted, true);
  assert.equal(first.state.submitState, 'sending');

  const duplicate = beginMobileCommentSubmit(first.state, 'A useful comment');
  assert.equal(duplicate.accepted, false);
  assert.strictEqual(duplicate.state, first.state);
});

test('401 and 403 comment failures have explicit permission messages', async () => {
  const { mobileCommentsPermissionMessage } = await loadStateModule();
  const unauthenticated = mobileCommentsPermissionMessage(401);
  const forbidden = mobileCommentsPermissionMessage(403);

  assert.match(unauthenticated ?? '', /sign in|authentication|session/i);
  assert.match(forbidden ?? '', /permission|access|allowed/i);
  assert.notEqual(unauthenticated, forbidden);
  assert.equal(mobileCommentsPermissionMessage(500), null);
});

test('comment submit success and failure settle the pending state', async () => {
  const {
    createMobileCommentsState,
    beginMobileCommentSubmit,
    reduceMobileCommentsState,
  } = await loadStateModule();
  const identity = '["workspace","output/report.md"]';
  const pending = beginMobileCommentSubmit(
    createMobileCommentsState(identity),
    'Ready for review.',
  ).state;

  const succeeded = reduceMobileCommentsState(pending, {
    type: 'submit-succeeded',
    documentIdentity: identity,
    thread: { id: 'thread-new', body: 'Ready for review.' },
  });
  assert.equal(succeeded.submitState, 'success');
  assert.equal(succeeded.threads.some(({ id }) => id === 'thread-new'), true);

  const failed = reduceMobileCommentsState(pending, {
    type: 'submit-failed',
    documentIdentity: identity,
    status: 403,
  });
  assert.equal(failed.submitState, 'failure');
  assert.match(failed.submitMessage ?? '', /permission|access|allowed/i);
});

test('a submit completion from the previous document cannot clear or toast over the new draft', async () => {
  const { settleMobileCommentSubmit } = await loadStateModule();
  const currentComposer = {
    documentIdentity: '["workspace","output/new-document.md"]',
    draft: 'Draft for the newly selected document',
    submitState: 'idle' as const,
    submitMessage: null,
  };

  assert.equal(
    typeof settleMobileCommentSubmit,
    'function',
    'the comments surface needs a pure document-scoped async completion gate',
  );
  const staleSuccess = settleMobileCommentSubmit(currentComposer, {
    documentIdentity: '["book","memory/previous-document.md"]',
    outcome: 'success',
    message: 'Comment posted.',
  });
  assert.strictEqual(staleSuccess, currentComposer);
  assert.equal(staleSuccess.draft, 'Draft for the newly selected document');
  assert.equal(staleSuccess.submitMessage, null);

  const staleFailure = settleMobileCommentSubmit(currentComposer, {
    documentIdentity: '["book","memory/previous-document.md"]',
    outcome: 'failure',
    message: 'Comment could not be posted.',
  });
  assert.strictEqual(staleFailure, currentComposer);
});
