export interface DocHubRouteTarget {
  sourceId: string;
  path: string;
}

export interface DocHubRouteSelection {
  sourceId: string | null;
  path: string;
}

export interface RelativeDocHubNavigation {
  target: DocHubRouteSelection;
  route: string;
}

export interface DocHubFragmentScrollIntent {
  hash: string;
  timing: 'immediate' | 'after-document-load';
}

export type DocHubTool = 'intelligence' | 'convert' | 'comments' | 'share' | 'audio';
export type ConvertSourceKind = 'current-document' | 'selected-text' | 'artifact';
export type ConvertOutputType = 'html' | 'markdown' | 'audio';

export interface DocHubConvertRouteState {
  sourceKind?: ConvertSourceKind;
  artifactRef?: string;
  outputType?: ConvertOutputType;
  templateId?: string;
  jobId?: string;
}

export interface DocHubRouteState extends DocHubRouteTarget {
  tool?: DocHubTool;
  convert?: DocHubConvertRouteState;
}

export type DocHubRailFocus = 'intelligence' | 'comments';

export interface MobileDocHubToolPresentationState {
  activeTool: DocHubTool | null;
  sheetOpen: boolean;
  documentIdentity?: string | null;
}

export type MobileDocHubToolPresentationEvent =
  | { type: 'sheet-opened' }
  | { type: 'sheet-closed' }
  | { type: 'document-changed'; documentIdentity: string | null };

export type ProgrammaticDocHubNavigationEvent = {
  type: 'programmatic-route' | 'file-selected';
  pathname: string;
  search?: string;
};

export interface MobileDocHubSurfaceState {
  documentIdentity: string | null;
  surface: 'closed' | 'tools' | 'convert' | 'comments' | 'picker';
  route: {
    activeTool: DocHubTool | null;
    activeJobId: string | null;
  };
}

export type MobileDocHubFocusIntent =
  | 'document-trigger'
  | 'dialog-close'
  | 'first-tool-action'
  | 'convert-action'
  | 'comments-action'
  | 'template-trigger'
  | null;

export type MobileDocHubSurfaceEvent =
  | { type: 'tools-opened' }
  | { type: 'convert-opened' }
  | { type: 'comments-opened' }
  | { type: 'picker-opened' }
  | { type: 'browser-back' | 'close-requested' }
  | { type: 'history-restored'; surface: MobileDocHubSurfaceState['surface'] }
  | { type: 'document-changed'; documentIdentity: string | null }
  | {
      type: 'route-synchronized';
      activeTool: DocHubTool | null;
      activeJobId: string | null;
    };

const WORKSPACE_ROOTS = new Set(['output', 'memory', 'projects']);
const WORKSPACE_TABS = new Set(['files', 'agents', 'tasks', 'services', 'chat', 'admin']);
const DOC_HUB_TOOLS = new Set<DocHubTool>(['intelligence', 'convert', 'comments', 'share', 'audio']);
const CONVERT_SOURCE_KINDS = new Set<ConvertSourceKind>(['current-document', 'selected-text', 'artifact']);
const CONVERT_OUTPUT_TYPES = new Set<ConvertOutputType>(['html', 'markdown', 'audio']);
const SAFE_ROUTE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export type DocHubWorkspaceTab = 'files' | 'agents' | 'tasks' | 'services' | 'chat' | 'admin';

export function resolveMobileDocHubFocusIntent(
  previousSurface: MobileDocHubSurfaceState['surface'],
  nextSurface: MobileDocHubSurfaceState['surface'],
): MobileDocHubFocusIntent {
  if (nextSurface === 'closed') return 'document-trigger';
  if (nextSurface === 'picker') return 'first-tool-action';
  if (nextSurface === 'comments') return 'first-tool-action';
  if (nextSurface === 'convert') {
    return previousSurface === 'picker' ? 'template-trigger' : 'dialog-close';
  }
  if (nextSurface === 'tools') {
    if (previousSurface === 'comments') return 'comments-action';
    if (previousSurface === 'convert' || previousSurface === 'picker') return 'convert-action';
    return 'dialog-close';
  }
  return null;
}

export function resolveWorkspaceTabRoute(pathname: string, search = ''): DocHubWorkspaceTab | null {
  if (pathname !== '/') {
    return null;
  }
  const requestedTab = new URLSearchParams(search).get('tab');
  return requestedTab && WORKSPACE_TABS.has(requestedTab)
    ? requestedTab as DocHubWorkspaceTab
    : 'files';
}

function decodePathSegments(pathname: string): string[] {
  return pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
}

function normalizedTarget(sourceId: string | null, path: string): DocHubRouteTarget | null {
  const pathSegments = path.split('/').filter(Boolean);
  if (
    pathSegments.length === 0
    || pathSegments.some((segment) => segment === '..' || segment === '~')
  ) {
    return null;
  }

  const normalizedPath = pathSegments.join('/');
  const normalizedSourceId = sourceId?.trim() || 'workspace';
  return { sourceId: normalizedSourceId, path: normalizedPath };
}

export function resolveDocHubRouteTarget(pathname: string, search = ''): DocHubRouteTarget | null {
  const segments = decodePathSegments(pathname);
  const [root, second, ...rest] = segments;

  if (root === 'docs' && second === 'source' && rest.length >= 2) {
    const [sourceId, ...sourcePath] = rest;
    return normalizedTarget(sourceId, sourcePath.join('/'));
  }

  if (root === 'docs' && second === 'workspace' && rest.length > 0) {
    return normalizedTarget('workspace', rest.join('/'));
  }

  if (root === 'docs' && second && WORKSPACE_ROOTS.has(second) && rest.length > 0) {
    return normalizedTarget('workspace', [second, ...rest].join('/'));
  }

  if (root === 'docs' && second && rest.length > 0) {
    return normalizedTarget(second, rest.join('/'));
  }

  if (root === 'workspace' && second) {
    return normalizedTarget('workspace', [second, ...rest].join('/'));
  }

  if (root && WORKSPACE_ROOTS.has(root) && second) {
    return normalizedTarget('workspace', [root, second, ...rest].join('/'));
  }

  if (pathname !== '/') {
    return null;
  }

  const params = new URLSearchParams(search);
  const workspaceTab = resolveWorkspaceTabRoute(pathname, search);
  if (workspaceTab && workspaceTab !== 'files') {
    return null;
  }
  const filePath = params.get('file');
  return filePath ? normalizedTarget(params.get('source'), filePath) : null;
}

export function resolveDocHubRouteSelection(
  pathname: string,
  search: string,
  fsMultiSourceEnabled: boolean,
): DocHubRouteSelection | null {
  const target = resolveDocHubRouteTarget(pathname, search);
  if (!target) {
    return null;
  }

  const params = new URLSearchParams(search);
  const isSourceLessLocalRoute = pathname === '/' && params.has('file') && !params.has('source');
  return {
    ...target,
    sourceId: isSourceLessLocalRoute && !fsMultiSourceEnabled
      ? null
      : target.sourceId,
  };
}

export function resolveDocHubFragmentScrollIntent(
  currentPathname: string,
  currentSearch: string,
  destinationRoute: string,
): DocHubFragmentScrollIntent | null {
  let destination: URL;
  try {
    destination = new URL(destinationRoute, 'https://entity.invalid');
  } catch {
    return null;
  }
  if (!destination.hash) {
    return null;
  }

  const current = resolveDocHubRouteTarget(currentPathname, currentSearch);
  const next = resolveDocHubRouteTarget(destination.pathname, destination.search);
  const sameDocument = Boolean(
    current
    && next
    && current.sourceId === next.sourceId
    && current.path === next.path,
  );
  return {
    hash: destination.hash,
    timing: sameDocument ? 'immediate' : 'after-document-load',
  };
}

export function buildDocHubRoutePath(target: DocHubRouteTarget): string {
  const encodedPath = target.path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `/docs/source/${encodeURIComponent(target.sourceId)}/${encodedPath}`;
}

function buildLocalDocHubRoute(path: string, state?: DocHubRouteState): string {
  const params = new URLSearchParams({ tab: 'files', file: path });
  if (state) {
    const safeStateUrl = new URL(serializeDocHubRouteState(state), 'https://entity.invalid');
    for (const [key, value] of safeStateUrl.searchParams) {
      params.set(key, value);
    }
  }
  return `/?${params.toString()}`;
}

export function resolveRelativeDocHubNavigation(
  pathname: string,
  search: string,
  href: string,
  fsMultiSourceEnabled: boolean,
  deploymentOrigin = 'https://entity.invalid',
): RelativeDocHubNavigation | null {
  const current = resolveDocHubRouteSelection(pathname, search, fsMultiSourceEnabled);
  const trimmedHref = href.trim();
  if (!trimmedHref) {
    return null;
  }
  if (trimmedHref.startsWith('#')) {
    if (!current || trimmedHref.length === 1) {
      return null;
    }
    const currentState = parseDocHubRouteState(pathname, search);
    const portableState: DocHubRouteState = {
      sourceId: current.sourceId ?? 'workspace',
      path: current.path,
      ...(currentState?.tool ? { tool: currentState.tool } : {}),
      ...(currentState?.convert ? { convert: currentState.convert } : {}),
    };
    const route = current.sourceId === null
      ? buildLocalDocHubRoute(current.path, portableState)
      : serializeDocHubRouteState(portableState);
    return {
      target: current,
      route: `${route}${trimmedHref}`,
    };
  }

  const isRelativeReference = !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(trimmedHref);
  if (!current && isRelativeReference) {
    return null;
  }

  try {
    const origin = new URL(deploymentOrigin).origin;
    const basePath = current
      ? buildDocHubRoutePath({
          sourceId: current.sourceId ?? 'workspace',
          path: current.path,
        })
      : '/';
    const resolved = new URL(trimmedHref, `${origin}${basePath}`);
    if (resolved.origin !== origin || !resolved.pathname.startsWith('/docs/')) {
      return null;
    }
    if (current && isRelativeReference) {
      const sourceRoot = `/docs/source/${encodeURIComponent(current.sourceId ?? 'workspace')}/`;
      if (!resolved.pathname.startsWith(sourceRoot)) {
        return null;
      }
    }

    const resolvedTarget = resolveDocHubRouteTarget(resolved.pathname, resolved.search);
    if (!resolvedTarget) {
      return null;
    }

    const target: DocHubRouteSelection =
      current?.sourceId === null && isRelativeReference
        ? { sourceId: null, path: resolvedTarget.path }
        : resolvedTarget;
    const resolvedState = parseDocHubRouteState(resolved.pathname, resolved.search);
    const portableState: DocHubRouteState = {
      sourceId: target.sourceId ?? 'workspace',
      path: target.path,
      ...(resolvedState?.tool ? { tool: resolvedState.tool } : {}),
      ...(resolvedState?.convert ? { convert: resolvedState.convert } : {}),
    };

    const route = target.sourceId === null
      ? buildLocalDocHubRoute(target.path, portableState)
      : serializeDocHubRouteState(portableState);

    return {
      target,
      route: `${route}${resolved.hash}`,
    };
  } catch {
    return null;
  }
}

export function resolvePaneRelativeDocHubNavigation(
  windowPathname: string,
  windowSearch: string,
  paneTarget: DocHubRouteSelection,
  href: string,
  fsMultiSourceEnabled: boolean,
  deploymentOrigin = 'https://entity.invalid',
): RelativeDocHubNavigation | null {
  const trimmedHref = href.trim();
  const isRelativeReference = !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(trimmedHref);
  if (!isRelativeReference) {
    return resolveRelativeDocHubNavigation(
      windowPathname,
      windowSearch,
      trimmedHref,
      fsMultiSourceEnabled,
      deploymentOrigin,
    );
  }

  const paneRoute = paneTarget.sourceId === null && !fsMultiSourceEnabled
    ? buildLocalDocHubRoute(paneTarget.path)
    : buildDocHubRoutePath({
        sourceId: paneTarget.sourceId ?? 'workspace',
        path: paneTarget.path,
      });
  const paneUrl = new URL(paneRoute, deploymentOrigin);
  return resolveRelativeDocHubNavigation(
    paneUrl.pathname,
    paneUrl.search,
    trimmedHref,
    fsMultiSourceEnabled,
    deploymentOrigin,
  );
}

export function buildTransientDocHubHistoryRoute(
  currentPathname: string,
  currentSearch: string,
  destinationPathname: string,
  destinationSearch: string,
): string {
  const current = parseDocHubRouteState(currentPathname, currentSearch);
  const destination = parseDocHubRouteState(destinationPathname, destinationSearch);
  if (
    !current
    || !destination
    || current.sourceId !== destination.sourceId
    || current.path !== destination.path
  ) {
    return `${destinationPathname}${destinationSearch}`;
  }

  const preserved: DocHubRouteState = {
    sourceId: destination.sourceId,
    path: destination.path,
    ...(current.tool ? { tool: current.tool } : {}),
    ...(current.convert ? { convert: current.convert } : {}),
  };
  return destinationPathname === '/'
    ? buildLocalDocHubRoute(destination.path, preserved)
    : serializeDocHubRouteState(preserved);
}

function recognizedValue<T extends string>(value: string | null, values: Set<T>): T | undefined {
  return value && values.has(value as T) ? value as T : undefined;
}

function safeRouteIdentifier(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && SAFE_ROUTE_IDENTIFIER.test(normalized) ? normalized : undefined;
}

export function parseDocHubRouteState(pathname: string, search = ''): DocHubRouteState | null {
  const target = resolveDocHubRouteTarget(pathname, search);
  if (!target) {
    return null;
  }

  const params = new URLSearchParams(search);
  const tool = recognizedValue(params.get('tool'), DOC_HUB_TOOLS);
  const sourceKind = recognizedValue(params.get('convertSource'), CONVERT_SOURCE_KINDS);
  const outputType = recognizedValue(params.get('convertOutput'), CONVERT_OUTPUT_TYPES);
  const artifactRef = safeRouteIdentifier(params.get('convertArtifact'));
  const templateId = safeRouteIdentifier(params.get('convertTemplate'));
  const jobId = safeRouteIdentifier(params.get('convertJob'));
  const convert = sourceKind || outputType || artifactRef || templateId || jobId
    ? {
        ...(sourceKind ? { sourceKind } : {}),
        ...(artifactRef ? { artifactRef } : {}),
        ...(outputType ? { outputType } : {}),
        ...(templateId ? { templateId } : {}),
        ...(jobId ? { jobId } : {}),
      }
    : undefined;

  return {
    ...target,
    ...(tool ? { tool } : {}),
    ...(convert ? { convert } : {}),
  };
}

export function resolveDocHubRailFocus(tool: DocHubTool | undefined): DocHubRailFocus | null {
  return tool === 'intelligence' || tool === 'comments' ? tool : null;
}

export function resolveSynchronizedDocHubTool(
  pathname: string,
  search = '',
): DocHubTool | null {
  return parseDocHubRouteState(pathname, search)?.tool ?? null;
}

export function reduceActiveDocHubToolNavigation(
  _activeTool: DocHubTool | null,
  event: ProgrammaticDocHubNavigationEvent,
): DocHubTool | null {
  return resolveSynchronizedDocHubTool(event.pathname, event.search);
}

export function reduceMobileDocHubSurfaceState(
  state: MobileDocHubSurfaceState,
  event: MobileDocHubSurfaceEvent,
): MobileDocHubSurfaceState {
  if (event.type === 'tools-opened') {
    return { ...state, surface: 'tools' };
  }
  if (event.type === 'convert-opened') {
    return {
      ...state,
      surface: 'convert',
      route: { ...state.route, activeTool: 'convert' },
    };
  }
  if (event.type === 'comments-opened') {
    return {
      ...state,
      surface: 'comments',
      route: { ...state.route, activeTool: 'comments' },
    };
  }
  if (event.type === 'picker-opened') {
    return { ...state, surface: 'picker' };
  }
  if (event.type === 'history-restored') {
    return { ...state, surface: event.surface };
  }
  if (event.type === 'document-changed') {
    return {
      ...state,
      documentIdentity: event.documentIdentity,
      surface: 'closed',
    };
  }
  if (event.type === 'route-synchronized') {
    return {
      ...state,
      route: {
        activeTool: event.activeTool,
        activeJobId: event.activeJobId,
      },
    };
  }
  return {
    ...state,
    surface:
      state.surface === 'picker'
        ? 'convert'
        : state.surface === 'convert' || state.surface === 'comments'
          ? 'tools'
          : 'closed',
  };
}

export function resolveDocHubRouteSynchronization(
  pathname: string,
  search: string,
  fsMultiSourceEnabled: boolean,
): {
  target: DocHubRouteSelection | null;
  activeTool: DocHubTool | null;
} {
  return {
    target: resolveDocHubRouteSelection(pathname, search, fsMultiSourceEnabled),
    activeTool: resolveSynchronizedDocHubTool(pathname, search),
  };
}

export function resolveMobileConvertControlState(
  pathname: string,
  search: string,
): {
  outputType: ConvertOutputType;
  templateId: string;
  jobId: string | null;
} {
  const convert = parseDocHubRouteState(pathname, search)?.convert;
  return {
    outputType: convert?.outputType ?? 'markdown',
    templateId: convert?.templateId ?? 'Default',
    jobId: convert?.jobId ?? null,
  };
}

export function resolveMobileConvertPickerSelectionTransition(
  pathname: string,
  search: string,
  templateId: string,
): {
  historyMode: 'replace';
  surface: 'convert';
  route: string;
} {
  const routeState = parseDocHubRouteState(pathname, search);
  const safeTemplateId = safeRouteIdentifier(templateId);
  if (!routeState || !safeTemplateId) {
    throw new TypeError('An active Doc Hub document and safe template are required.');
  }
  return {
    historyMode: 'replace',
    surface: 'convert',
    route: serializeDocHubRouteState({
      ...routeState,
      tool: 'convert',
      convert: {
        ...routeState.convert,
        templateId: safeTemplateId,
      },
    }),
  };
}

export function buildActivatedDocHubToolRoute(
  pathname: string,
  search: string,
  tool: DocHubTool,
  hash = '',
): string {
  if (!parseDocHubRouteState(pathname, search)) {
    throw new TypeError('An active Doc Hub document is required.');
  }
  const params = new URLSearchParams(search);
  params.set('tool', tool);
  const nextSearch = params.toString();
  return `${nextSearch ? `${pathname}?${nextSearch}` : pathname}${hash}`;
}

export function reduceMobileDocHubToolPresentation(
  state: MobileDocHubToolPresentationState,
  event: MobileDocHubToolPresentationEvent,
): MobileDocHubToolPresentationState {
  if (event.type === 'document-changed') {
    return {
      ...state,
      sheetOpen: false,
      documentIdentity: event.documentIdentity,
    };
  }
  return {
    ...state,
    sheetOpen: event.type === 'sheet-opened',
  };
}

export function serializeDocHubRouteState(state: DocHubRouteState): string {
  const target = normalizedTarget(state.sourceId, state.path);
  if (!target || target.sourceId !== state.sourceId.trim()) {
    throw new TypeError('A valid Doc Hub source and document are required.');
  }

  const params = new URLSearchParams();
  if (DOC_HUB_TOOLS.has(state.tool as DocHubTool)) {
    params.set('tool', state.tool as DocHubTool);
  }

  const sourceKind = recognizedValue(state.convert?.sourceKind ?? null, CONVERT_SOURCE_KINDS);
  const outputType = recognizedValue(state.convert?.outputType ?? null, CONVERT_OUTPUT_TYPES);
  const artifactRef = safeRouteIdentifier(state.convert?.artifactRef);
  const templateId = safeRouteIdentifier(state.convert?.templateId);
  const jobId = safeRouteIdentifier(state.convert?.jobId);

  if (sourceKind) params.set('convertSource', sourceKind);
  if (artifactRef) params.set('convertArtifact', artifactRef);
  if (outputType) params.set('convertOutput', outputType);
  if (templateId) params.set('convertTemplate', templateId);
  if (jobId) params.set('convertJob', jobId);

  const search = params.toString();
  const route = buildDocHubRoutePath(target);
  return search ? `${route}?${search}` : route;
}

export function buildSynchronizedDocHubRoute(
  pathname: string,
  search: string,
  target: DocHubRouteTarget,
): string {
  const currentState = parseDocHubRouteState(pathname, search);
  return serializeDocHubRouteState({
    ...target,
    ...(currentState?.tool ? { tool: currentState.tool } : {}),
    ...(currentState?.convert ? { convert: currentState.convert } : {}),
  });
}

export function buildCanonicalDocHubUrl(
  state: DocHubRouteState,
  deploymentUrl: string | URL,
): string {
  let deployment: URL;
  try {
    deployment = new URL(deploymentUrl);
  } catch {
    throw new TypeError('A valid HTTP deployment URL is required.');
  }

  if (deployment.protocol !== 'http:' && deployment.protocol !== 'https:') {
    throw new TypeError('A valid HTTP deployment URL is required.');
  }

  return new URL(serializeDocHubRouteState(state), deployment.origin).toString();
}

export function buildCanonicalSelectedDocHubToolUrl(
  target: DocHubRouteTarget,
  pathname: string,
  search: string,
  tool: DocHubTool,
  deploymentUrl: string | URL,
): string {
  const currentState = parseDocHubRouteState(pathname, search);
  return buildCanonicalDocHubUrl(
    {
      ...target,
      tool,
      ...(currentState?.convert ? { convert: currentState.convert } : {}),
    },
    deploymentUrl,
  );
}

export function buildCanonicalLocalDocHubUrl(
  path: string,
  pathname: string,
  search: string,
  deploymentUrl: string | URL,
): string {
  const currentState = parseDocHubRouteState(pathname, search);
  const safeStateUrl = new URL(buildCanonicalDocHubUrl(
    {
      sourceId: 'workspace',
      path,
      ...(currentState?.tool ? { tool: currentState.tool } : {}),
      ...(currentState?.convert ? { convert: currentState.convert } : {}),
    },
    deploymentUrl,
  ));
  const localUrl = new URL('/', safeStateUrl.origin);
  localUrl.searchParams.set('tab', 'files');
  localUrl.searchParams.set('file', path);
  for (const [key, value] of safeStateUrl.searchParams) {
    localUrl.searchParams.set(key, value);
  }
  return localUrl.toString();
}

export function buildDocHubExitPath(returnTaskId: unknown): string {
  return typeof returnTaskId === 'number' && Number.isSafeInteger(returnTaskId) && returnTaskId > 0
    ? `/task/${returnTaskId}`
    : '/';
}

export function shouldRestoreLastDocHubFile(pathname: string, search = ''): boolean {
  return resolveWorkspaceTabRoute(pathname, search) === 'files';
}
