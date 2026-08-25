import type { FileSourceRecord, FileSourceType } from '../../../../db/src/file-sources';
import type { FileSourceAdapter, SourceCapability } from './types';
import { LocalFileSourceAdapter } from './local';
import { DocsifyFileSourceAdapter } from './docsify';
import { HttpMarkdownFileSourceAdapter } from './http-markdown';
import { GitHubFileSourceAdapter } from './github';

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

  async validate(_source: FileSourceRecord): Promise<void> {
    throw new Error(
      `${this.key} sources are not implemented yet. Configure a local, docsify, http-markdown, or github source instead.`
    );
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
  github: (source) => new GitHubFileSourceAdapter(source),
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

// Types whose adapters perform a real live availability check in validate().
export const liveSourceAdapterTypes: readonly FileSourceType[] = ['local', 'docsify', 'http-markdown', 'github'];

export function adapterSupportsLiveValidation(type: FileSourceType): boolean {
  return liveSourceAdapterTypes.includes(type);
}
