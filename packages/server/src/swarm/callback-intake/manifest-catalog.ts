/**
 * EEPC-A-03 — Validated manifest catalog for callback intake lookup.
 *
 * Loads EEPC-A-02 valid fixtures only. Not a production provider registry.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseExecutionEngineManifest,
  type ExecutionEnginePluginManifest,
} from '../manifest';

const FIXTURES_DIR = path.join(__dirname, '../manifest/fixtures');

let cached: Map<string, ExecutionEnginePluginManifest> | null = null;

export function loadValidatedManifestCatalog(): Map<string, ExecutionEnginePluginManifest> {
  if (cached) return cached;

  const map = new Map<string, ExecutionEnginePluginManifest>();
  const files = readdirSync(FIXTURES_DIR)
    .filter((name) => name.startsWith('valid-') && name.endsWith('.json'))
    .sort();

  for (const file of files) {
    const raw = JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), 'utf8')) as unknown;
    const manifest = parseExecutionEngineManifest(raw);
    map.set(manifest.identity.name, manifest);
  }

  cached = map;
  return map;
}

export function getValidatedManifestByProvider(
  provider: string,
): ExecutionEnginePluginManifest | undefined {
  return loadValidatedManifestCatalog().get(provider);
}

/** Test helper — clear cached catalog between suites if fixtures mutate. */
export function resetValidatedManifestCatalogForTests(): void {
  cached = null;
}
