import test from 'node:test';
import assert from 'node:assert/strict';

import * as documentShellState from './documentShellState.ts';
import {
  getDocumentShellCollapseState,
  shouldShowDocumentRightRail,
} from './documentShellState.ts';

interface MobileDocHubToolsModel {
  trigger: {
    label: string;
    accessibleName: string;
    icon: string;
  };
  sheet: {
    kind: 'bottom-sheet';
    accessibleName: string;
    documentIdentity: {
      label: string;
      value: string;
    };
    actions: Array<{
      id: 'intelligence' | 'comments' | 'share' | 'audio';
      label: string;
      accessibleName: string;
    }>;
  };
}

function mobileDocHubToolsModel(documentPath: string): MobileDocHubToolsModel {
  const buildMobileDocHubToolsModel = (
    documentShellState as typeof documentShellState & {
      buildMobileDocHubToolsModel: (path: string) => MobileDocHubToolsModel;
    }
  ).buildMobileDocHubToolsModel;

  assert.equal(typeof buildMobileDocHubToolsModel, 'function');
  return buildMobileDocHubToolsModel(documentPath);
}

test('documents default both workspace sidebars to focused mode', () => {
  assert.deepEqual(getDocumentShellCollapseState('["workspace","output/report.html"]'), {
    left: true,
    right: true,
  });
});

test('non-document workspace pages default both sidebars open', () => {
  assert.deepEqual(getDocumentShellCollapseState(null), {
    left: false,
    right: false,
  });
});

test('document right rail stays visible while collaboration is unavailable', () => {
  assert.equal(shouldShowDocumentRightRail({ agentNativeEditorEnabled: true, documentsReady: false }), true);
});

test('document right rail stays hidden when the agent-native editor is disabled', () => {
  assert.equal(shouldShowDocumentRightRail({ agentNativeEditorEnabled: false, documentsReady: true }), false);
});

test('mobile Doc Hub exposes a visible icon-and-text Tools entry', () => {
  const model = mobileDocHubToolsModel('memory/Daily Brief.md');

  assert.equal(model.trigger.label, 'Tools');
  assert.equal(model.trigger.accessibleName, 'Open document tools');
  assert.notEqual(model.trigger.icon.trim(), '');
});

test('mobile Doc Hub uses one labeled bottom sheet for every required tool group', () => {
  const model = mobileDocHubToolsModel('memory/Daily Brief.md');

  assert.equal(model.sheet.kind, 'bottom-sheet');
  assert.equal(model.sheet.accessibleName, 'Document tools');
  assert.deepEqual(
    model.sheet.actions.map(({ id, label }) => ({ id, label })),
    [
      { id: 'intelligence', label: 'Intelligence / Convert' },
      { id: 'comments', label: 'Comments' },
      { id: 'share', label: 'Share / Copy' },
      { id: 'audio', label: 'Listen / Audio' },
    ],
  );
  for (const action of model.sheet.actions) {
    assert.notEqual(action.label.trim(), '');
    assert.notEqual(action.accessibleName.trim(), '');
  }
});

test('mobile tools sheet keeps the current document identity visible', () => {
  const model = mobileDocHubToolsModel('memory/Daily Brief.md');

  assert.deepEqual(model.sheet.documentIdentity, {
    label: 'Current document',
    value: 'memory/Daily Brief.md',
  });
});

test('mobile tool actions distinguish wired handlers from honestly unavailable shells', async () => {
  type ToolAction =
    | {
        id: 'intelligence' | 'comments' | 'share' | 'audio';
        availability: 'enabled';
        onSelect: () => void | Promise<void>;
        unavailableReason?: never;
      }
    | {
        id: 'intelligence' | 'comments' | 'share' | 'audio';
        availability: 'unavailable';
        onSelect?: never;
        unavailableReason: string;
      };
  type ActionAwareModel = Omit<MobileDocHubToolsModel, 'sheet'> & {
    sheet: Omit<MobileDocHubToolsModel['sheet'], 'actions'> & {
      actions: ToolAction[];
    };
  };
  const shareCalls: string[] = [];
  const canonicalUrl = 'https://entity.example/docs/source/workspace/memory/Daily%20Brief.md?tool=share';
  const actionAwareBuilder = documentShellState.buildMobileDocHubToolsModel as unknown as (
    documentPath: string,
    handlers: {
      share: () => void | Promise<void>;
    },
  ) => ActionAwareModel;

  const model = actionAwareBuilder('memory/Daily Brief.md', {
    share: async () => {
      shareCalls.push(canonicalUrl);
    },
  });
  const share = model.sheet.actions.find((action) => action.id === 'share');

  assert.ok(share);
  assert.equal(share.availability, 'enabled');
  assert.equal(typeof share.onSelect, 'function');
  if (share.availability !== 'enabled') {
    assert.fail('Share / Copy must be wired when its native-share caller is available');
  }
  await share.onSelect();
  assert.deepEqual(shareCalls, [canonicalUrl]);

  for (const action of model.sheet.actions.filter((candidate) => candidate.id !== 'share')) {
    assert.equal(action.availability, 'unavailable', `${action.id} must not masquerade as enabled`);
    assert.equal('onSelect' in action, false, `${action.id} must not expose an inert handler`);
    assert.equal(
      action.availability === 'unavailable' && action.unavailableReason.trim().length > 0,
      true,
      `${action.id} must explain why it is unavailable`,
    );
  }
});

test('mobile Intelligence and Convert action is enabled when its full-screen handler is supplied', async () => {
  type ToolAction =
    | {
        id: 'intelligence' | 'comments' | 'share' | 'audio';
        availability: 'enabled';
        onSelect: () => void | Promise<void>;
      }
    | {
        id: 'intelligence' | 'comments' | 'share' | 'audio';
        availability: 'unavailable';
        unavailableReason: string;
      };
  const selections: string[] = [];
  const buildMobileDocHubToolsModel = documentShellState.buildMobileDocHubToolsModel as unknown as (
    documentPath: string,
    handlers: {
      intelligenceConvert?: () => void | Promise<void>;
    },
  ) => {
    sheet: {
      actions: ToolAction[];
    };
  };
  const model = buildMobileDocHubToolsModel('memory/Daily Brief.md', {
    intelligenceConvert: async () => {
      selections.push('convert');
    },
  });
  const intelligenceConvert = model.sheet.actions.find(
    (action) => action.id === 'intelligence',
  );

  assert.ok(intelligenceConvert);
  assert.equal(
    intelligenceConvert.availability,
    'enabled',
    'the Intelligence / Convert action must stop advertising an unavailable shell once wired',
  );
  if (intelligenceConvert.availability !== 'enabled') {
    assert.fail('Intelligence / Convert must expose its supplied handler');
  }
  await intelligenceConvert.onSelect();
  assert.deepEqual(selections, ['convert']);
});

test('mobile Comments action is enabled when its document-scoped handler is supplied', async () => {
  const selections: string[] = [];
  const model = documentShellState.buildMobileDocHubToolsModel('memory/Daily Brief.md', {
    comments: async () => {
      selections.push('comments');
    },
  });
  const comments = model.sheet.actions.find((action) => action.id === 'comments');

  assert.ok(comments);
  assert.equal(comments.availability, 'enabled');
  if (comments.availability !== 'enabled') {
    assert.fail('Comments must expose its supplied handler');
  }
  assert.equal(comments.accessibleName, 'Open document comments');
  await comments.onSelect();
  assert.deepEqual(selections, ['comments']);
});

test('mobile Audio action is enabled when its current-document handler is supplied', async () => {
  const selections: string[] = [];
  const buildMobileDocHubToolsModel = documentShellState.buildMobileDocHubToolsModel as unknown as (
    documentPath: string,
    handlers: {
      audio?: () => void | Promise<void>;
    },
  ) => {
    sheet: {
      actions: Array<
        | {
            id: 'intelligence' | 'comments' | 'share' | 'audio';
            availability: 'enabled';
            accessibleName: string;
            onSelect: () => void | Promise<void>;
          }
        | {
            id: 'intelligence' | 'comments' | 'share' | 'audio';
            availability: 'unavailable';
            accessibleName: string;
            unavailableReason: string;
          }
      >;
    };
  };
  const model = buildMobileDocHubToolsModel('memory/Daily Brief.md', {
    audio: async () => {
      selections.push('audio');
    },
  });
  const audio = model.sheet.actions.find((action) => action.id === 'audio');

  assert.ok(audio);
  assert.equal(
    audio.availability,
    'enabled',
    'Listen / Audio must stop advertising an unavailable shell once its handler is wired',
  );
  if (audio.availability !== 'enabled') {
    assert.fail('Listen / Audio must expose its supplied current-document handler');
  }
  assert.equal(audio.accessibleName, 'Listen to current document');
  await audio.onSelect();
  assert.deepEqual(selections, ['audio']);
});

test('mobile first-look model makes document actions clear and maps Convert to its active group', () => {
  type FirstLookToolAction = {
    id: 'intelligence' | 'comments' | 'share' | 'audio';
    label: string;
    active: boolean;
  };
  const buildMobileDocHubToolsModel = documentShellState.buildMobileDocHubToolsModel as unknown as (
    documentPath: string,
    handlers: Record<string, never>,
    options: {
      activeTool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | null;
    },
  ) => {
    sheet: {
      documentIdentity: {
        label: string;
        value: string;
      };
      actions: FirstLookToolAction[];
    };
  };

  const model = buildMobileDocHubToolsModel(
    'memory/Daily Brief.md',
    {},
    { activeTool: 'convert' },
  );

  assert.deepEqual(model.sheet.documentIdentity, {
    label: 'Current document',
    value: 'memory/Daily Brief.md',
  });
  assert.equal(
    model.sheet.actions.find((action) => action.id === 'intelligence')?.active,
    true,
    'the Convert route tool must mark the Intelligence / Convert group active',
  );
  assert.equal(
    model.sheet.actions.filter((action) => action.id !== 'intelligence').some((action) => action.active),
    false,
    'only the selected tool group may be active',
  );
  assert.deepEqual(
    model.sheet.actions.map(({ id, label }) => ({ id, label })),
    [
      { id: 'intelligence', label: 'Intelligence / Convert' },
      { id: 'comments', label: 'Comments' },
      { id: 'share', label: 'Share / Copy' },
      { id: 'audio', label: 'Listen / Audio' },
    ],
    'Convert, Comments, Share/Copy, and Listen/Audio need explicit visible labels',
  );
});

function startFragmentRetry<T>(options: {
  findTarget: () => T | null;
  schedule: (retry: () => void) => void;
  onFound: (target: T) => void;
}): () => void {
  const startDocHubFragmentTargetRetry = (
    documentShellState as typeof documentShellState & {
      startDocHubFragmentTargetRetry: <Target>(retryOptions: {
        findTarget: () => Target | null;
        schedule: (retry: () => void) => void;
        onFound: (target: Target) => void;
      }) => () => void;
    }
  ).startDocHubFragmentTargetRetry;

  assert.equal(typeof startDocHubFragmentTargetRetry, 'function');
  return startDocHubFragmentTargetRetry(options);
}

test('cold Doc Hub fragment retry keeps looking across lazy mount and stops once found', () => {
  const pending: Array<() => void> = [];
  const target = { id: 'install' };
  let lookupCount = 0;
  const found: Array<typeof target> = [];

  startFragmentRetry({
    findTarget: () => {
      lookupCount += 1;
      return lookupCount >= 3 ? target : null;
    },
    schedule: (retry) => pending.push(retry),
    onFound: (resolved) => found.push(resolved),
  });

  assert.equal(lookupCount, 1);
  assert.equal(pending.length, 1);
  pending.shift()?.();
  assert.equal(lookupCount, 2);
  assert.equal(pending.length, 1);
  pending.shift()?.();
  assert.equal(lookupCount, 3);
  assert.deepEqual(found, [target]);
  assert.equal(pending.length, 0, 'finding the lazy-mounted heading must stop retries');
});

test('cold Doc Hub fragment retry stops pending lookup after cancellation', () => {
  const pending: Array<() => void> = [];
  let lookupCount = 0;
  const found: unknown[] = [];
  const cancel = startFragmentRetry({
    findTarget: () => {
      lookupCount += 1;
      return null;
    },
    schedule: (retry) => pending.push(retry),
    onFound: (resolved) => found.push(resolved),
  });

  assert.equal(lookupCount, 1);
  assert.equal(pending.length, 1);
  cancel();
  pending.shift()?.();
  assert.equal(lookupCount, 1, 'a stale retry must not inspect a replaced document');
  assert.deepEqual(found, []);
  assert.equal(pending.length, 0);
});

test('mobile manual-share fallback cannot survive sheet dismissal or a document identity change', () => {
  type ManualShareState = {
    documentIdentity: string | null;
    value: string | null;
  };
  type ManualShareEvent =
    | {
        type: 'manual-required';
        documentIdentity: string;
        value: string;
      }
    | {
        type: 'sheet-dismissed';
      }
    | {
        type: 'document-changed';
        documentIdentity: string | null;
      };
  const reduceMobileManualShareState = (
    documentShellState as typeof documentShellState & {
      reduceMobileManualShareState: (
        state: ManualShareState,
        event: ManualShareEvent,
      ) => ManualShareState;
    }
  ).reduceMobileManualShareState;

  assert.equal(
    typeof reduceMobileManualShareState,
    'function',
    'MobileView needs one pure lifecycle helper for manual-share fallback state',
  );

  const firstDocumentIdentity = 'workspace:memory/First Daily Brief.md';
  const secondDocumentIdentity = 'workspace:memory/Second Daily Brief.md';
  const staleCanonicalUrl =
    'https://entity.example/docs/source/workspace/memory/First%20Daily%20Brief.md?tool=share';
  const initialState: ManualShareState = {
    documentIdentity: firstDocumentIdentity,
    value: null,
  };
  const manualFallback = reduceMobileManualShareState(initialState, {
    type: 'manual-required',
    documentIdentity: firstDocumentIdentity,
    value: staleCanonicalUrl,
  });

  assert.deepEqual(manualFallback, {
    documentIdentity: firstDocumentIdentity,
    value: staleCanonicalUrl,
  });
  assert.deepEqual(
    reduceMobileManualShareState(manualFallback, { type: 'sheet-dismissed' }),
    {
      documentIdentity: firstDocumentIdentity,
      value: null,
    },
  );

  const afterDocumentChange = reduceMobileManualShareState(manualFallback, {
    type: 'document-changed',
    documentIdentity: secondDocumentIdentity,
  });
  assert.deepEqual(afterDocumentChange, {
    documentIdentity: secondDocumentIdentity,
    value: null,
  });
  assert.equal(JSON.stringify(afterDocumentChange).includes(staleCanonicalUrl), false);
});

test('mobile manual-share fallback ignores an async result from a dismissed sheet session', () => {
  type SessionAwareManualShareState = {
    documentIdentity: string | null;
    value: string | null;
    sheetSessionId: string | null;
  };
  type SessionAwareManualShareEvent =
    | {
        type: 'manual-required';
        documentIdentity: string;
        value: string;
        sheetSessionId: string;
      }
    | {
        type: 'sheet-dismissed';
      };
  const reduceMobileManualShareState = documentShellState.reduceMobileManualShareState as unknown as (
    state: SessionAwareManualShareState,
    event: SessionAwareManualShareEvent,
  ) => SessionAwareManualShareState;
  const documentIdentity = 'workspace:memory/Daily Brief.md';
  const canonicalUrl =
    'https://entity.example/docs/source/workspace/memory/Daily%20Brief.md?tool=share';
  const openSession: SessionAwareManualShareState = {
    documentIdentity,
    value: null,
    sheetSessionId: 'sheet-session-1',
  };

  const sameSessionResult = reduceMobileManualShareState(openSession, {
    type: 'manual-required',
    documentIdentity,
    value: canonicalUrl,
    sheetSessionId: 'sheet-session-1',
  });
  assert.equal(
    sameSessionResult.value,
    canonicalUrl,
    'a manual fallback may populate while its originating sheet session remains open',
  );

  const dismissed = reduceMobileManualShareState(openSession, {
    type: 'sheet-dismissed',
  });
  assert.equal(dismissed.value, null);

  const lateResult = reduceMobileManualShareState(dismissed, {
    type: 'manual-required',
    documentIdentity,
    value: canonicalUrl,
    sheetSessionId: 'sheet-session-1',
  });
  assert.equal(
    lateResult.value,
    null,
    'a manual-required result from a dismissed sheet session must stay ignored',
  );
  assert.equal(JSON.stringify(lateResult).includes(canonicalUrl), false);
});

test('mobile manual-share identity includes source authority and rejects same-path stale results', () => {
  const buildMobileDocHubDocumentIdentity = (
    documentShellState as typeof documentShellState & {
      buildMobileDocHubDocumentIdentity: (
        sourceId: string | null,
        path: string,
      ) => string;
    }
  ).buildMobileDocHubDocumentIdentity;
  const reduceMobileManualShareState = documentShellState.reduceMobileManualShareState;

  assert.equal(
    typeof buildMobileDocHubDocumentIdentity,
    'function',
    'mobile share state needs one source-and-path document identity helper',
  );

  const sharedPath = 'output/daily-brief.md';
  const sourceAIdentity = buildMobileDocHubDocumentIdentity('source-a', sharedPath);
  const sourceBIdentity = buildMobileDocHubDocumentIdentity('source-b', sharedPath);
  assert.notEqual(
    sourceAIdentity,
    sourceBIdentity,
    'the same path under different sources must not share manual-fallback identity',
  );

  const sourceACanonicalUrl =
    'https://entity.example/docs/source/source-a/output/daily-brief.md?tool=share';
  const sourceBState = reduceMobileManualShareState(
    {
      documentIdentity: sourceAIdentity,
      value: null,
      sheetSessionId: 'source-a-session',
    },
    {
      type: 'document-changed',
      documentIdentity: sourceBIdentity,
    },
  );
  const lateSourceAResult = reduceMobileManualShareState(sourceBState, {
    type: 'manual-required',
    documentIdentity: sourceAIdentity,
    value: sourceACanonicalUrl,
    sheetSessionId: 'source-a-session',
  });
  const sourceBVisibleValue =
    lateSourceAResult.documentIdentity === sourceBIdentity
      ? lateSourceAResult.value
      : null;

  assert.equal(sourceBVisibleValue, null);
  assert.equal(JSON.stringify(lateSourceAResult).includes(sourceACanonicalUrl), false);
});

test('desktop manual-copy fallback ignores a late result from the previous document', () => {
  type DesktopManualCopyState = {
    documentIdentity: string;
    value: string | null;
  };
  type DesktopManualCopyEvent =
    | {
        type: 'manual-required';
        documentIdentity: string;
        value: string;
      }
    | {
        type: 'document-changed';
        documentIdentity: string;
      };
  const reduceDesktopManualCopyState = (
    documentShellState as typeof documentShellState & {
      reduceDesktopManualCopyState: (
        state: DesktopManualCopyState,
        event: DesktopManualCopyEvent,
      ) => DesktopManualCopyState;
    }
  ).reduceDesktopManualCopyState;

  assert.equal(
    typeof reduceDesktopManualCopyState,
    'function',
    'desktop manual-copy fallback needs one document-scoped lifecycle helper',
  );

  const firstDocumentIdentity = '["book","memory/First.md"]';
  const secondDocumentIdentity = '["workspace","output/Second.md"]';
  const staleFirstUrl =
    'https://entity.example/docs/source/book/memory/First.md?tool=share';
  const afterNavigation = reduceDesktopManualCopyState(
    {
      documentIdentity: firstDocumentIdentity,
      value: null,
    },
    {
      type: 'document-changed',
      documentIdentity: secondDocumentIdentity,
    },
  );
  const afterLateClipboardRejection = reduceDesktopManualCopyState(
    afterNavigation,
    {
      type: 'manual-required',
      documentIdentity: firstDocumentIdentity,
      value: staleFirstUrl,
    },
  );

  assert.deepEqual(afterLateClipboardRejection, {
    documentIdentity: secondDocumentIdentity,
    value: null,
  });
  assert.equal(JSON.stringify(afterLateClipboardRejection).includes(staleFirstUrl), false);
});
