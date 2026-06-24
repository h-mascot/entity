import express from 'express';
import { WORKTYPE_REGISTRY } from '../../../db/src';
import {
  phase2FlagEnabled,
  resolvePhase2Flags,
  type Phase2FlagSnapshot,
} from '../phase2-flags';

export function serializeWorktypeRegistry() {
  return Object.values(WORKTYPE_REGISTRY).map((entry) => ({
    worktype: entry.worktype,
    schema_name: entry.schema_name,
    schema_version: entry.schema_version,
    risk_default: entry.risk_default,
    indexable: entry.indexable,
    sensitivity: entry.sensitivity,
    plan_labels: entry.plan_labels,
    fields: entry.fields.map((field) => ({
      name: field.name,
      type: field.type,
      allowed_values: field.allowed_values ?? null,
      risk_default: field.risk_default ?? null,
      indexable: field.indexable,
      sensitivity: field.sensitivity,
      plan_label: field.plan_label,
    })),
  }));
}

export interface WorktypeRegistryRouterDependencies {
  flags?: Phase2FlagSnapshot;
}

export function createWorktypeRegistryRouter(
  dependencies: WorktypeRegistryRouterDependencies = {},
): express.Router {
  const router = express.Router();
  const flags = dependencies.flags ?? resolvePhase2Flags();
  router.get('/', (_req, res) => {
    if (!phase2FlagEnabled(flags, 'worktype_registry_surface')) {
      return res.status(503).json({
        error: 'worktype registry disabled',
        flag: flags.worktype_registry_surface,
      });
    }
    res.json({ worktypes: serializeWorktypeRegistry() });
  });
  return router;
}
