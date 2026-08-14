import type { FileSourceRecord } from '../../../../db/src/file-sources';

export interface SourceCapability {
  read: boolean;
  write: boolean;
  rename: boolean;
  delete: boolean;
  list: boolean;
  search: boolean;
}

export type SourcePathKind = 'file' | 'directory' | 'other';

export interface SourceNode {
  sourceId: string;
  path: string;
  name: string;
  isDirectory: boolean;
  kind?: SourcePathKind;
  size?: number;
  updatedAt?: string;
  orgId?: string | null;
  sensitivity?: string | null;
  aclJson?: string | null;
  entityVisibilityPolicyJson?: string | null;
}


export interface SourcePathMetadata {
  sourceId: string;
  path: string;
  name: string;
  kind: SourcePathKind;
  size?: number;
  updatedAt?: string;
  orgId?: string | null;
  sensitivity?: string | null;
  aclJson?: string | null;
  entityVisibilityPolicyJson?: string | null;
}

export interface SourceReadOptions {
  maxBytes?: number;
}

export interface SourceFileReadResult {
  content: string;
  contentType: string;
  updatedAt?: string;
  size?: number;
  isBinary?: boolean;
}

export interface SourceFileRawResult {
  content: Buffer;
  contentType: string;
  updatedAt?: string;
  size: number;
}

export interface FileSourceAdapter {
  readonly key: string;
  validate(source: FileSourceRecord): Promise<void>;
  capabilities(): SourceCapability;
  list(path: string): Promise<SourceNode[]>;
  stat?(path: string): Promise<SourcePathMetadata>;
  read(path: string, options?: SourceReadOptions): Promise<SourceFileReadResult>;
  readRaw?(path: string): Promise<SourceFileRawResult>;
  write(path: string, content: string): Promise<{ updatedAt?: string }>;
  writeExclusive?(path: string, content: string): Promise<{ updatedAt?: string }>;
  mkdir(path: string): Promise<void>;
}
