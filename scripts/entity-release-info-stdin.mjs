#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const payload = JSON.parse(readFileSync(0, "utf8"));
for (const field of ["script", "root", "sha", "branch", "environment"]) {
  if (typeof payload[field] !== "string" || payload[field].length === 0) {
    throw new Error(`Invalid release metadata payload field: ${field}`);
  }
}
const result = spawnSync(process.execPath, [
  payload.script,
  "--root", payload.root,
  "--sha", payload.sha,
  "--branch", payload.branch,
  "--environment", payload.environment,
  "--write",
], { stdio: ["ignore", "inherit", "inherit"] });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
