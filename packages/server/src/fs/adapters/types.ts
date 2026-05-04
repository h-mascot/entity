import type { FileSourceRecord } from '../../../../db/src/file-sources';

export interface SourceCapability {
  read: boolean;
  write: boolean;
  rename: boolean;
  delete: boolean;
  list: boolean;
  search: boolean;
}

export interface SourceNode {
  sourceId: string;
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: string;
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
  read(path: string): Promise<SourceFileReadResult>;
  readRaw?(path: string): Promise<SourceFileRawResult>;
  write(path: string, content: string): Promise<{ updatedAt?: string }>;
  mkdir(path: string): Promise<void>;
}
