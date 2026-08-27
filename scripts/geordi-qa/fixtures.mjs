// Geordi QA deterministic browser fixtures (GQR-006).
//
// These fixtures give the Geordi QA worker a closed, deterministic set of
// browser surfaces to exercise against a verified sandbox build. They carry no
// secrets, no base64 payloads, and no live network expectations. They exist so
// the post-merge focused reruns do not depend on improvised per-run data.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_FIXTURE_IDS = [
  "admin-navigation",
  "task-handoffs",
  "provider-preview",
  "refresh",
  "mobile-viewport",
  "external-document-metadata",
];

const DEFAULT_FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

// Secret-shaped keys must never appear in a QA fixture, even with benign values.
const SECRET_LIKE_KEY = /token|secret|password|credential|api[-_]?key/i;
// Base64 payloads (data URIs or long base64 runs) are forbidden: the compact
// evidence index and fixtures stay lightweight and base64-free by contract.
const BASE64_DATA_URI = /^data:[^;,]*;base64,/i;
const LONG_BASE64_RUN = /[A-Za-z0-9+/]{300,}={0,2}/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== "string" || v.length === 0)) {
    throw new Error(`${field} must be a non-empty array of non-empty strings`);
  }
}

function scanForSecrets(value, trail) {
  if (typeof value === "string") {
    if (BASE64_DATA_URI.test(value) || LONG_BASE64_RUN.test(value)) {
      throw new Error(`${trail} must not embed base64 payloads`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanForSecrets(entry, `${trail}[${index}]`));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_LIKE_KEY.test(key) && entry !== null && entry !== undefined) {
        throw new Error(`${trail}.${key} looks secret-like; fixtures must carry no secrets`);
      }
      scanForSecrets(entry, `${trail}.${key}`);
    }
  }
}

export function validateGeordiQaFixture(fixture) {
  if (!isPlainObject(fixture)) throw new Error("fixture must be an object");
  const { id } = fixture;
  if (typeof id !== "string" || !REQUIRED_FIXTURE_IDS.includes(id)) {
    throw new Error(`id must be one of the required fixture ids: ${REQUIRED_FIXTURE_IDS.join(", ")}`);
  }
  if (typeof fixture.surface !== "string" || fixture.surface.length === 0) {
    throw new Error("surface must be a non-empty string");
  }
  if (typeof fixture.purpose !== "string" || fixture.purpose.length === 0) {
    throw new Error("purpose must be a non-empty string");
  }
  if (typeof fixture.target !== "string" || fixture.target.length === 0) {
    throw new Error("target must be a non-empty string");
  }
  assertStringArray(fixture.preconditions, "preconditions");
  if (!Array.isArray(fixture.steps) || fixture.steps.length === 0) {
    throw new Error("steps must be a non-empty array");
  }
  fixture.steps.forEach((step, index) => {
    if (
      !isPlainObject(step) ||
      typeof step.action !== "string" ||
      step.action.length === 0 ||
      typeof step.expect !== "string" ||
      step.expect.length === 0
    ) {
      throw new Error(`steps[${index}] must have non-empty action and expect strings`);
    }
  });
  if (!isPlainObject(fixture.expected) || Object.keys(fixture.expected).length === 0) {
    throw new Error("expected must be a non-empty object");
  }
  assertStringArray(fixture.cleanup, "cleanup");
  assertStringArray(fixture.forbidden, "forbidden");
  if (fixture.recovery !== undefined && typeof fixture.recovery !== "string") {
    throw new Error("recovery must be a string when present");
  }
  if (fixture.blockedFallback !== undefined && typeof fixture.blockedFallback !== "string") {
    throw new Error("blockedFallback must be a string when present");
  }
  scanForSecrets(fixture, `fixture(${id})`);
  return fixture;
}

export async function loadGeordiQaFixtures(directory = DEFAULT_FIXTURES_DIR) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  const fixtures = [];
  const byId = Object.create(null);
  for (const name of names) {
    const raw = await readFile(path.join(directory, name), "utf8");
    const fixture = validateGeordiQaFixture(JSON.parse(raw));
    if (byId[fixture.id] !== undefined) {
      throw new Error(`duplicate fixture id ${fixture.id} (from ${name})`);
    }
    byId[fixture.id] = fixture;
    fixtures.push(fixture);
  }
  const missing = REQUIRED_FIXTURE_IDS.filter((id) => byId[id] === undefined);
  if (missing.length > 0) {
    throw new Error(`missing fixture id(s): ${missing.join(", ")}`);
  }
  fixtures.sort((a, b) => REQUIRED_FIXTURE_IDS.indexOf(a.id) - REQUIRED_FIXTURE_IDS.indexOf(b.id));
  return { fixtures, byId };
}
