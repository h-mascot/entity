import { stat, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export interface LocalRevision {
  token: string;
  size: number;
  modifiedAtMs: number;
  contentHash: string;
}

export interface LocalVersionWatcherOptions {
  inspect: () => Promise<LocalRevision>;
  onChange?: (revision: LocalRevision) => void;
}

/** A deterministic, polling-friendly watcher. Duplicate observations are emitted once. */
export class LocalVersionWatcher {
  private lastToken: string | undefined;
  private stopped = false;

  constructor(private readonly options: LocalVersionWatcherOptions) {}

  async inspect(): Promise<LocalRevision> {
    if (this.stopped) throw new Error('local version watcher is stopped');
    return this.options.inspect();
  }

  async observe(): Promise<LocalRevision | null> {
    const revision = await this.inspect();
    if (revision.token === this.lastToken) return null;
    this.lastToken = revision.token;
    this.options.onChange?.(revision);
    return revision;
  }

  stop(): void { this.stopped = true; }
}

export async function inspectLocalRevision(filePath: string): Promise<LocalRevision> {
  const [metadata, content] = await Promise.all([stat(filePath), readFile(filePath)]);
  const contentHash = createHash('sha256').update(content).digest('hex');
  return {
    token: `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}:${contentHash}`,
    size: metadata.size,
    modifiedAtMs: metadata.mtimeMs,
    contentHash,
  };
}

export function createLocalVersionWatcher(filePath: string, options: Omit<LocalVersionWatcherOptions, 'inspect'> = {}): LocalVersionWatcher {
  return new LocalVersionWatcher({ ...options, inspect: () => inspectLocalRevision(filePath) });
}
