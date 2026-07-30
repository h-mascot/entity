export * from './types';
export * from './errors';
export * from './migrations';
export * from './repositories';
export * from './serialize';
export * from './audit';

import type Database from 'better-sqlite3';
import { createInferenceProviderAuditAdapter } from './audit';
import { runInferenceProviderMigrations } from './migrations';
import {
  createBindingRepository,
  createDefaultsRepository,
  createHealthCheckRepository,
  createModelRepository,
  createProfileRepository,
} from './repositories';

export interface ProviderRegistryRepositories {
  profiles: ReturnType<typeof createProfileRepository>;
  models: ReturnType<typeof createModelRepository>;
  defaults: ReturnType<typeof createDefaultsRepository>;
  bindings: ReturnType<typeof createBindingRepository>;
  healthChecks: ReturnType<typeof createHealthCheckRepository>;
  audit: ReturnType<typeof createInferenceProviderAuditAdapter>;
}

/** Ensure schema and construct repository set for a SQLite connection. */
export function openProviderRegistry(
  db: Database.Database,
  options?: { logger?: Pick<Console, 'info' | 'warn' | 'error'> },
): ProviderRegistryRepositories {
  runInferenceProviderMigrations({ db, logger: options?.logger });
  return {
    profiles: createProfileRepository(db),
    models: createModelRepository(db),
    defaults: createDefaultsRepository(db),
    bindings: createBindingRepository(db),
    healthChecks: createHealthCheckRepository(db),
    audit: createInferenceProviderAuditAdapter(db),
  };
}
