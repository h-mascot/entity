export type FileSourceType = 'local' | 'docsify' | 'http-markdown' | 'github' | 's3' | 'custom';
export type FileSourceHealth = 'ok' | 'degraded' | 'error';

export interface FileSource {
  id: string;
  displayName: string;
  type: FileSourceType;
  baseUrl: string | null;
  basePath: string | null;
  authType: 'none' | 'bearer' | 'api-key' | 'basic' | 'ssh';
  authRef: string | null;
  enabled: boolean;
  icon: string | null;
  capabilities: string;
  health: FileSourceHealth;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceNode {
  sourceId: string;
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: string;
}

export interface SourceTreeResponse {
  sourceId: string;
  path: string;
  capabilities: {
    read: boolean;
    write: boolean;
    rename: boolean;
    delete: boolean;
    list: boolean;
    search: boolean;
  };
  nodes: SourceNode[];
}

export interface SourceFileResponse {
  sourceId: string;
  path: string;
  content: string;
  contentType: string;
  size?: number;
  isBinary?: boolean;
  updatedAt: string | null;
  readOnly: boolean;
  cached?: boolean;
  cachedAt?: string | null;
  cacheAgeMs?: number | null;
}

export interface UnifiedSearchResult {
  id: string;
  sourceId: string;
  sourceName: string;
  path: string;
  title: string;
  type: string;
  agent: string;
  origin: string;
  isRecurring: boolean;
  recurringPattern: string | null;
  preview: string | null;
  updatedAt: string | null;
  indexedAt: string | null;
}

export interface UnifiedSearchResponse {
  indexed: boolean;
  results: UnifiedSearchResult[];
}
