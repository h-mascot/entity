import express from 'express';
import { WORKTYPE_REGISTRY } from '../../../db/src';

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

export function createWorktypeRegistryRouter(): express.Router {
  const router = express.Router();
  router.get('/', (_req, res) => {
    res.json({ worktypes: serializeWorktypeRegistry() });
  });
  return router;
}
