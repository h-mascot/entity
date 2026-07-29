import test from 'node:test';
import assert from 'node:assert/strict';

import * as docHubRoute from './docHubRoute.ts';
import { parseDocHubRouteState } from './docHubRoute.ts';

test('opening and closing mobile tool presentation cannot erase the active route tool', () => {
  type MobileDocHubToolPresentationState = {
    activeTool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | null;
    sheetOpen: boolean;
  };
  type MobileDocHubToolPresentationEvent =
    | { type: 'sheet-opened' }
    | { type: 'sheet-closed' };
  const reduceMobileDocHubToolPresentation = (
    docHubRoute as typeof docHubRoute & {
      reduceMobileDocHubToolPresentation: (
        state: MobileDocHubToolPresentationState,
        event: MobileDocHubToolPresentationEvent,
      ) => MobileDocHubToolPresentationState;
    }
  ).reduceMobileDocHubToolPresentation;

  assert.equal(typeof reduceMobileDocHubToolPresentation, 'function');
  const restored: MobileDocHubToolPresentationState = {
    activeTool: 'share',
    sheetOpen: false,
  };
  const opened = reduceMobileDocHubToolPresentation(restored, { type: 'sheet-opened' });
  assert.deepEqual(opened, {
    activeTool: 'share',
    sheetOpen: true,
  });
  assert.deepEqual(
    reduceMobileDocHubToolPresentation(opened, { type: 'sheet-closed' }),
    restored,
  );
});

test('changing the selected document closes mobile tools without erasing route tool state', () => {
  type MobileDocHubToolPresentationState = {
    activeTool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | null;
    sheetOpen: boolean;
    documentIdentity: string;
  };
  type DocumentChangedEvent = {
    type: 'document-changed';
    documentIdentity: string;
  };
  const reduceMobileDocHubToolPresentation = (
    docHubRoute.reduceMobileDocHubToolPresentation as unknown as (
      state: MobileDocHubToolPresentationState,
      event: DocumentChangedEvent,
    ) => MobileDocHubToolPresentationState
  );
  const openForFirstDocument: MobileDocHubToolPresentationState = {
    activeTool: 'share',
    sheetOpen: true,
    documentIdentity: '["source-a","output/first.md"]',
  };

  const secondDocument = reduceMobileDocHubToolPresentation(
    openForFirstDocument,
    {
      type: 'document-changed',
      documentIdentity: '["source-b","output/second.md"]',
    },
  );
  assert.deepEqual(secondDocument, {
    activeTool: 'share',
    sheetOpen: false,
    documentIdentity: '["source-b","output/second.md"]',
  });

  assert.deepEqual(
    reduceMobileDocHubToolPresentation(secondDocument, {
      type: 'document-changed',
      documentIdentity: '["source-c","output/third.md"]',
    }),
    {
      activeTool: 'share',
      sheetOpen: false,
      documentIdentity: '["source-c","output/third.md"]',
    },
    'the tools sheet must remain closed across subsequent document selections',
  );
});

test('mobile Convert uses nested Tools -> Convert -> Tools -> closed navigation', () => {
  type MobileSurfaceState = {
    documentIdentity: string;
    surface: 'closed' | 'tools' | 'convert';
    route: {
      activeTool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | null;
      activeJobId: string | null;
    };
  };
  type MobileSurfaceEvent =
    | { type: 'tools-opened' }
    | { type: 'convert-opened' }
    | { type: 'browser-back' }
    | { type: 'close-requested' };
  const reduceMobileDocHubSurfaceState = (
    docHubRoute as typeof docHubRoute & {
      reduceMobileDocHubSurfaceState: (
        state: MobileSurfaceState,
        event: MobileSurfaceEvent,
      ) => MobileSurfaceState;
    }
  ).reduceMobileDocHubSurfaceState;

  assert.equal(
    typeof reduceMobileDocHubSurfaceState,
    'function',
    'mobile Tools and full-screen Convert need one nested surface state machine',
  );
  const initial: MobileSurfaceState = {
    documentIdentity: '["workspace","output/daily-brief.md"]',
    surface: 'closed',
    route: {
      activeTool: 'share',
      activeJobId: 'job-42',
    },
  };
  const tools = reduceMobileDocHubSurfaceState(initial, { type: 'tools-opened' });
  const convert = reduceMobileDocHubSurfaceState(tools, { type: 'convert-opened' });

  assert.deepEqual(convert, {
    ...initial,
    surface: 'convert',
    route: {
      activeTool: 'convert',
      activeJobId: 'job-42',
    },
  });

  const backToTools = reduceMobileDocHubSurfaceState(convert, { type: 'browser-back' });
  assert.deepEqual(backToTools, {
    ...convert,
    surface: 'tools',
  });
  assert.deepEqual(
    reduceMobileDocHubSurfaceState(backToTools, { type: 'browser-back' }),
    {
      ...convert,
      surface: 'closed',
    },
  );

  const closeToTools = reduceMobileDocHubSurfaceState(convert, { type: 'close-requested' });
  assert.deepEqual(closeToTools, {
    ...convert,
    surface: 'tools',
  });
  assert.deepEqual(
    reduceMobileDocHubSurfaceState(closeToTools, { type: 'close-requested' }),
    {
      ...convert,
      surface: 'closed',
    },
  );
});

test('mobile Comments uses nested Tools -> Comments -> Tools -> closed navigation', () => {
  const initial: docHubRoute.MobileDocHubSurfaceState = {
    documentIdentity: '["workspace","output/daily-brief.md"]',
    surface: 'closed',
    route: {
      activeTool: null,
      activeJobId: null,
    },
  };
  const tools = docHubRoute.reduceMobileDocHubSurfaceState(initial, { type: 'tools-opened' });
  const comments = docHubRoute.reduceMobileDocHubSurfaceState(tools, { type: 'comments-opened' });

  assert.equal(comments.surface, 'comments');
  assert.equal(comments.route.activeTool, 'comments');
  assert.equal(
    docHubRoute.reduceMobileDocHubSurfaceState(comments, { type: 'browser-back' }).surface,
    'tools',
  );
  assert.equal(
    docHubRoute.reduceMobileDocHubSurfaceState(
      { ...comments, surface: 'tools' },
      { type: 'browser-back' },
    ).surface,
    'closed',
  );
});

test('opening mobile Tools from closed moves focus into the dialog', () => {
  type MobileSurface = docHubRoute.MobileDocHubSurfaceState['surface'];
  type MobileFocusIntent = 'dialog-close' | 'first-tool-action' | null;
  const resolveMobileDocHubFocusIntent = (
    docHubRoute as typeof docHubRoute & {
      resolveMobileDocHubFocusIntent: (
        previousSurface: MobileSurface,
        nextSurface: MobileSurface,
      ) => MobileFocusIntent;
    }
  ).resolveMobileDocHubFocusIntent;

  assert.equal(
    typeof resolveMobileDocHubFocusIntent,
    'function',
    'mobile surface transitions need an explicit focus-transfer contract',
  );
  assert.ok(
    ['dialog-close', 'first-tool-action'].includes(
      resolveMobileDocHubFocusIntent('closed', 'tools') ?? '',
    ),
    'opening Tools must focus its close control or first action, not leave focus on the inert trigger',
  );
});

test('changing documents closes mobile Convert without erasing durable route or job state', () => {
  type MobileSurfaceState = {
    documentIdentity: string;
    surface: 'closed' | 'tools' | 'convert';
    route: {
      activeTool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | null;
      activeJobId: string | null;
    };
  };
  const reduceMobileDocHubSurfaceState = (
    docHubRoute as typeof docHubRoute & {
      reduceMobileDocHubSurfaceState: (
        state: MobileSurfaceState,
        event: {
          type: 'document-changed';
          documentIdentity: string;
        },
      ) => MobileSurfaceState;
    }
  ).reduceMobileDocHubSurfaceState;
  const converting: MobileSurfaceState = {
    documentIdentity: '["workspace","output/first.md"]',
    surface: 'convert',
    route: {
      activeTool: 'convert',
      activeJobId: 'job-42',
    },
  };

  assert.equal(typeof reduceMobileDocHubSurfaceState, 'function');
  assert.deepEqual(
    reduceMobileDocHubSurfaceState(converting, {
      type: 'document-changed',
      documentIdentity: '["book","output/second.md"]',
    }),
    {
      documentIdentity: '["book","output/second.md"]',
      surface: 'closed',
      route: {
        activeTool: 'convert',
        activeJobId: 'job-42',
      },
    },
    'document replacement must close transient surfaces without cancelling or dropping durable Convert state',
  );
});

test('route synchronization clears stale active tools outside a tool-bearing document URL', () => {
  const resolveSynchronizedDocHubTool = (
    docHubRoute as typeof docHubRoute & {
      resolveSynchronizedDocHubTool: (
        pathname: string,
        search?: string,
      ) => 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | null;
    }
  ).resolveSynchronizedDocHubTool;

  assert.equal(typeof resolveSynchronizedDocHubTool, 'function');
  assert.equal(
    resolveSynchronizedDocHubTool(
      '/docs/source/workspace/output/first-report.md',
      '?tool=share',
    ),
    'share',
  );
  assert.equal(
    resolveSynchronizedDocHubTool(
      '/docs/source/workspace/output/second-report.md',
      '',
    ),
    null,
    'a document route without tool state must clear the previous Share highlight',
  );
  assert.equal(
    resolveSynchronizedDocHubTool('/task/42', '?tool=share'),
    null,
    'leaving Doc Hub must clear the previous Share highlight',
  );
});

test('direct Doc Hub navigation derives both target and tool state from the destination route', () => {
  type RouteSynchronization = {
    target: {
      sourceId: string | null;
      path: string;
    } | null;
    activeTool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | null;
  };
  const resolveDocHubRouteSynchronization = (
    docHubRoute as typeof docHubRoute & {
      resolveDocHubRouteSynchronization: (
        pathname: string,
        search: string,
        fsMultiSourceEnabled: boolean,
      ) => RouteSynchronization;
    }
  ).resolveDocHubRouteSynchronization;

  assert.equal(
    typeof resolveDocHubRouteSynchronization,
    'function',
    'popstate and direct navigation need one shared route synchronization contract',
  );

  const staleUiState: RouteSynchronization = {
    target: {
      sourceId: 'book',
      path: 'memory/First Daily Brief.md',
    },
    activeTool: 'comments',
  };
  assert.deepEqual(
    {
      ...staleUiState,
      ...resolveDocHubRouteSynchronization(
        '/docs/source/workspace/output/task-42-report.md',
        '',
        true,
      ),
    },
    {
      target: {
        sourceId: 'workspace',
        path: 'output/task-42-report.md',
      },
      activeTool: null,
    },
    'a direct Markdown/task-output navigation without ?tool must clear stale Comments state',
  );

  assert.deepEqual(
    resolveDocHubRouteSynchronization(
      '/docs/source/workspace/output/task-43-report.md',
      '?tool=share',
      true,
    ),
    {
      target: {
        sourceId: 'workspace',
        path: 'output/task-43-report.md',
      },
      activeTool: 'share',
    },
    'the same synchronization contract must restore explicit route tool state',
  );
});

test('programmatic task exits and file selections cannot retain a prior Doc Hub tool', () => {
  type ActiveTool = 'intelligence' | 'convert' | 'comments' | 'share' | 'audio' | null;
  type ProgrammaticNavigationEvent = {
    type: 'programmatic-route' | 'file-selected';
    pathname: string;
    search?: string;
  };
  const reduceActiveDocHubToolNavigation = (
    docHubRoute as typeof docHubRoute & {
      reduceActiveDocHubToolNavigation: (
        activeTool: ActiveTool,
        event: ProgrammaticNavigationEvent,
      ) => ActiveTool;
    }
  ).reduceActiveDocHubToolNavigation;

  assert.equal(
    typeof reduceActiveDocHubToolNavigation,
    'function',
    'programmatic Back and file selection need one explicit active-tool transition',
  );
  assert.equal(
    reduceActiveDocHubToolNavigation('comments', {
      type: 'programmatic-route',
      pathname: '/task/42',
    }),
    null,
    'programmatic Back to a task route must clear stale Comments state without popstate',
  );
  assert.equal(
    reduceActiveDocHubToolNavigation('share', {
      type: 'file-selected',
      pathname: '/docs/source/workspace/output/new-task-report.md',
    }),
    null,
    'selecting a different file without tool route state must clear stale Share state',
  );
  assert.equal(
    reduceActiveDocHubToolNavigation(null, {
      type: 'file-selected',
      pathname: '/docs/source/workspace/output/new-task-report.md',
      search: '?tool=audio',
    }),
    'audio',
    'programmatic selection may restore a tool only when the destination route names it',
  );
});

test('source-backed mobile Share preserves durable Convert state for the current selection', () => {
  const buildCanonicalSelectedDocHubToolUrl = (
    docHubRoute as typeof docHubRoute & {
      buildCanonicalSelectedDocHubToolUrl: (
        target: { sourceId: string; path: string },
        pathname: string,
        search: string,
        tool: 'intelligence' | 'convert' | 'comments' | 'share' | 'audio',
        deploymentUrl: string | URL,
      ) => string;
    }
  ).buildCanonicalSelectedDocHubToolUrl;

  assert.equal(typeof buildCanonicalSelectedDocHubToolUrl, 'function');
  const canonicalUrl = buildCanonicalSelectedDocHubToolUrl(
    { sourceId: 'book', path: 'memory/Daily Brief.md' },
    '/docs/source/book/memory/Daily%20Brief.md',
    '?tool=convert&convertSource=artifact&convertArtifact=artifact-42'
      + '&convertOutput=audio&convertTemplate=voice-v1&convertJob=job-42'
      + '&selectedText=private&unrecognized=discard-me',
    'share',
    'https://entity.example/deployment/prefix',
  );
  const url = new URL(canonicalUrl);

  assert.equal(url.origin, 'https://entity.example');
  assert.deepEqual(
    parseDocHubRouteState(url.pathname, url.search),
    {
      sourceId: 'book',
      path: 'memory/Daily Brief.md',
      tool: 'share',
      convert: {
        sourceKind: 'artifact',
        artifactRef: 'artifact-42',
        outputType: 'audio',
        templateId: 'voice-v1',
        jobId: 'job-42',
      },
    },
  );
  assert.equal(url.searchParams.has('selectedText'), false);
  assert.equal(url.searchParams.has('unrecognized'), false);
});

test('mobile template selection closes the picker without restoring a stale Convert URL', () => {
  type MobileConvertPickerSelectionTransition = {
    historyMode: 'replace';
    surface: 'convert';
    route: string;
  };
  const resolveMobileConvertPickerSelectionTransition = (
    docHubRoute as typeof docHubRoute & {
      resolveMobileConvertPickerSelectionTransition?: (
        pathname: string,
        search: string,
        templateId: string,
      ) => MobileConvertPickerSelectionTransition;
    }
  ).resolveMobileConvertPickerSelectionTransition;

  assert.equal(
    typeof resolveMobileConvertPickerSelectionTransition,
    'function',
    'template selection must atomically replace the picker entry as Convert instead of navigating Back to its stale URL',
  );
  assert.deepEqual(
    resolveMobileConvertPickerSelectionTransition?.(
      '/docs/source/book/memory/Daily%20Brief.md',
      '?tool=convert&convertOutput=html&convertTemplate=Default&convertJob=job-42'
        + '&selectedText=private',
      'executive-brief',
    ),
    {
      historyMode: 'replace',
      surface: 'convert',
      route: '/docs/source/book/memory/Daily%20Brief.md'
        + '?tool=convert&convertOutput=html&convertTemplate=executive-brief&convertJob=job-42',
    },
    'closing the picker must retain the selected template and safe Convert state in the visible history entry',
  );
});
