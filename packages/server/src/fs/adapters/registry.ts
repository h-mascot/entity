import type { FileSourceRecord, FileSourceType } from '../../../../db/src/file-sources';
import type { FileSourceAdapter, SourceCapability } from './types';
import { LocalFileSourceAdapter } from './local';
import { DocsifyFileSourceAdapter } from './docsify';
import { HttpMarkdownFileSourceAdapter } from './http-markdown';
import { ConnectorNotImplementedError } from '../errors';

const IMPLEMENTED_SOURCE_TYPES: ReadonlySet<FileSourceType> = new Set<FileSourceType>([
  'local',
  'docsify',
  'http-markdown',
]);

/** True when the connector type has a real adapter in this build. */
export function isFileSourceTypeImplemented(type: FileSourceType): boolean {
  return IMPLEMENTED_SOURCE_TYPES.has(type);
}

// Placeholder connectors cannot serve anything: advertising read/list would
// let UIs offer expand/browse actions that can only fail.
const PLACEHOLDER_CAPABILITIES: SourceCapability = {
  read: false,
  write: false,
  rename: false,
  delete: false,
  list: false,
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

    // Fail closed: placeholder adapters cannot reach the upstream yet, so a
    // connection test must not report success for an unimplemented connector.
    throw new ConnectorNotImplementedError(this.key);
  }

  capabilities(): SourceCapability {
    return PLACEHOLDER_CAPABILITIES;
  }

  async list(_path: string): Promise<never> {
    throw new ConnectorNotImplementedError(this.key);
  }

  async read(_path: string): Promise<never> {
    throw new ConnectorNotImplementedError(this.key);
  }

  async write(_path: string, _content: string): Promise<never> {
    throw new ConnectorNotImplementedError(this.key);
  }

  async mkdir(_path: string): Promise<never> {
    throw new ConnectorNotImplementedError(this.key);
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
