const DEFAULT_ENTITY_BASE_URL = process.env.PUBLIC_ENTITY_BASE_URL || process.env.ENTITY_BASE_URL || 'http://localhost:3000';
const DOCS_ROUTE_ROOTS = new Set(['output', 'memory', 'workspace', 'projects', 'zora', 'spock']);
const WORKSPACE_ROUTE_ROOTS = new Set(['docs', 'notes']);

function trimTrailingPunctuation(value: string): { core: string; suffix: string } {
  const match = value.match(/^(.*?)([),.;!?]+)?$/);
  if (!match) return { core: value, suffix: '' };
  return { core: match[1] ?? value, suffix: match[2] ?? '' };
}

function toEntityDocsPath(docsPath: string): string {
  const normalizedPath = String(docsPath).replace(/^\/+/, '');
  const [rawRoot, ...restParts] = normalizedPath.split('/');
  const root = rawRoot.toLowerCase();
  const rest = restParts.join('/');

  if (DOCS_ROUTE_ROOTS.has(root) && rest) {
    return `${root}/${rest}`;
  }

  if (WORKSPACE_ROUTE_ROOTS.has(root) && rest) {
    return `workspace/${root}/${rest}`;
  }

  return `workspace/${normalizedPath}`;
}

function normalizeEntityBaseUrl(entityBaseUrl: string): string {
  return entityBaseUrl.replace(/\/+$/, '');
}

function toEntityDocsUrl(docsPath: string, entityBaseUrl: string): string {
  return `${normalizeEntityBaseUrl(entityBaseUrl)}/docs/${toEntityDocsPath(docsPath)}`;
}

function rewriteMatchedPath(rawPath: string, entityBaseUrl: string): string {
  const { core, suffix } = trimTrailingPunctuation(rawPath);
  return `${toEntityDocsUrl(core, entityBaseUrl)}${suffix}`;
}

function toDocsPathFromLocalClawd(agentSuffix: string | undefined, rawPath: string): string {
  const normalizedPath = rawPath.replace(/^\/+/, '');
  const [rawRoot, ...restParts] = normalizedPath.split('/');
  const root = rawRoot.toLowerCase();
  const rest = restParts.join('/');

  if ((agentSuffix === '-zora' || agentSuffix === '-spock') && root === 'output' && rest) {
    return `${agentSuffix.slice(1)}/${rest}`;
  }

  if (DOCS_ROUTE_ROOTS.has(root) && rest) {
    return `${root}/${rest}`;
  }

  if (WORKSPACE_ROUTE_ROOTS.has(root) && rest) {
    return `workspace/${root}/${rest}`;
  }

  return `workspace/${normalizedPath}`;
}

export function normalizeTaskOutputLinks(
  rawValue: string | null | undefined,
  entityBaseUrl = DEFAULT_ENTITY_BASE_URL
): string | null | undefined {
  if (typeof rawValue !== 'string') return rawValue;

  let value = rawValue;

  value = value.replace(/https?:\/\/[^/\s)]+\/([^\s)]+)/gi, (full: string, docsPath: string) => {
    const { core } = trimTrailingPunctuation(String(docsPath));
    const normalizedPath = core.replace(/^\/+/, '');
    const [rawRoot, rawSecond] = normalizedPath.split('/');
    const root = rawRoot.toLowerCase();
    const second = rawSecond?.toLowerCase();
    const alreadyEntityDocsUrl = root === 'docs' && second !== undefined && DOCS_ROUTE_ROOTS.has(second);

    if (alreadyEntityDocsUrl) {
      const { core, suffix } = trimTrailingPunctuation(String(docsPath));
      return `${normalizeEntityBaseUrl(entityBaseUrl)}/${core.replace(/^\/+/, '')}${suffix}`;
    }

    const legacyFileServerUrl = /^https?:\/\/[^\s)]+:8788\//i.test(full);
    if (legacyFileServerUrl || DOCS_ROUTE_ROOTS.has(root) || WORKSPACE_ROUTE_ROOTS.has(root)) {
      return rewriteMatchedPath(String(docsPath), entityBaseUrl);
    }

    return full;
  });

  value = value.replace(
    /(?:~|\/(?:Users|home)\/[^/\s)]+)\/clawd(-zora|-spock|-scotty)?\/([^\s)]+)/gi,
    (_full: string, agentSuffix: string | undefined, localPath: string) => {
      const { core, suffix } = trimTrailingPunctuation(String(localPath));
      return `${entityBaseUrl}/docs/${toDocsPathFromLocalClawd(agentSuffix, core)}${suffix}`;
    }
  );

  value = value.replace(
    /(^|[\s(])((?:output|memory|workspace|projects|zora|spock|docs|notes)\/[^\s)]+)/gi,
    (_full: string, prefix: string, docsPath: string) => `${prefix}${rewriteMatchedPath(String(docsPath), entityBaseUrl)}`
  );

  return value;
}
