import type { FileSourceRecord, FileSourceType } from '../../../../db/src/file-sources';
import type { FileSourceAdapter, SourceCapability } from './types';
import { LocalFileSourceAdapter } from './local';
import { DocsifyFileSourceAdapter } from './docsify';
import { HttpMarkdownFileSourceAdapter } from './http-markdown';

const DEFAULT_CAPABILITIES: SourceCapability = {
  read: true,
  write: false,
  rename: false,
  delete: false,
  list: true,
  search: false,
};

class PlaceholderAdapter implements FileSourceAdapter {
  readonly key: string;
  readonly source: FileSourceRecord;

  constructor(key: string, source: FileSourceRecord) {
    this.key = key;
    this.source = source;
  }

  async validate(source: FileSourceRecord): Promise<void> {
    if (!source.id || !source.display_name) {
      throw new Error('Invalid source configuration.');
    }
  }

  capabilities(): SourceCapability {
    return DEFAULT_CAPABILITIES;
  }

  async list(_path: string): Promise<never> {
    throw new Error(`${this.key} adapter not implemented yet.`);
  }

  async read(_path: string): Promise<never> {
    throw new Error(`${this.key} adapter not implemented yet.`);
  }

  async write(_path: string, _content: string): Promise<never> {
    throw new Error(`${this.key} adapter not implemented yet.`);
  }

  async mkdir(_path: string): Promise<never> {
    throw new Error(`${this.key} adapter not implemented yet.`);
  }
}

type AdapterFactory = (source: FileSourceRecord) => FileSourceAdapter;

const factories: Record<FileSourceType, AdapterFactory> = {
  local: (source) => new LocalFileSourceAdapter(source),
  docsify: (source) => new DocsifyFileSourceAdapter(source),
  'http-markdown': (source) => new HttpMarkdownFileSourceAdapter(source),
  github: (source) => new PlaceholderAdapter('github', source),
  s3: (source) => new PlaceholderAdapter('s3', source),
  custom: (source) => new PlaceholderAdapter('custom', source),
};

export function createFileSourceAdapter(source: FileSourceRecord): FileSourceAdapter {
  const factory = factories[source.type];
  if (!factory) {
    throw new Error(`Unsupported source type: ${source.type}`);
  }

  return factory(source);
}
