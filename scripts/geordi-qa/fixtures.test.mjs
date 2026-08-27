import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REQUIRED_FIXTURE_IDS,
  loadGeordiQaFixtures,
  validateGeordiQaFixture,
} from "./fixtures.mjs";

function minimalFixture(overrides = {}) {
  return {
    id: "admin-navigation",
    surface: "Admin navigation",
    purpose: "Deterministically exercise the grouped admin navigation surface.",
    target: "http://sandbox.entity/?tab=admin",
    preconditions: ["Sandbox build identity verified against the approved SHA."],
    steps: [
      {
        action: "Activate the Admin group in the primary navigation.",
        expect: "Admin settings container renders with grouped sections.",
      },
    ],
    expected: {
      adminGroups: ["Workspace", "Work", "Team", "Admin"],
    },
    cleanup: ["No mutations performed; nothing to restore."],
    forbidden: ["Entering credentials or approving permission prompts."],
    ...overrides,
  };
}

test("required fixture ids cover the six GQR-006 surfaces in plan order", () => {
  assert.deepEqual(REQUIRED_FIXTURE_IDS, [
    "admin-navigation",
    "task-handoffs",
    "provider-preview",
    "refresh",
    "mobile-viewport",
    "external-document-metadata",
  ]);
});

test("loads exactly the six deterministic browser fixtures from the default directory", async () => {
  const loaded = await loadGeordiQaFixtures();
  assert.equal(loaded.fixtures.length, 6);
  assert.deepEqual(
    loaded.fixtures.map((fixture) => fixture.id),
    REQUIRED_FIXTURE_IDS,
  );
  for (const id of REQUIRED_FIXTURE_IDS) {
    assert.ok(loaded.byId[id], `fixture ${id} must be addressable by id`);
  }
});

test("every shipped fixture passes validation", async () => {
  const loaded = await loadGeordiQaFixtures();
  for (const fixture of loaded.fixtures) {
    assert.doesNotThrow(() => validateGeordiQaFixture(fixture), fixture.id);
  }
});

test("validation enforces the complete fixture shape", () => {
  assert.throws(() => validateGeordiQaFixture({ ...minimalFixture(), id: "" }), /id/);
  assert.throws(() => validateGeordiQaFixture({ ...minimalFixture(), surface: 7 }), /surface/);
  assert.throws(() => validateGeordiQaFixture({ ...minimalFixture(), purpose: "" }), /purpose/);
  assert.throws(() => validateGeordiQaFixture({ ...minimalFixture(), target: "" }), /target/);
  assert.throws(
    () => validateGeordiQaFixture({ ...minimalFixture(), preconditions: "none" }),
    /preconditions/,
  );
  assert.throws(() => validateGeordiQaFixture({ ...minimalFixture(), steps: [] }), /steps/);
  assert.throws(
    () => validateGeordiQaFixture({ ...minimalFixture(), steps: [{ action: "x" }] }),
    /steps\[0\]/,
  );
  assert.throws(
    () => validateGeordiQaFixture({ ...minimalFixture(), expected: {} }),
    /expected/,
  );
  assert.throws(
    () => validateGeordiQaFixture({ ...minimalFixture(), cleanup: "n/a" }),
    /cleanup/,
  );
  assert.throws(
    () => validateGeordiQaFixture({ ...minimalFixture(), forbidden: [] }),
    /forbidden/,
  );
  // Unknown fixture ids are rejected so fixtures stay a closed, plan-bound set.
  assert.throws(() => validateGeordiQaFixture(minimalFixture({ id: "surprise" })), /id/);
});

test("validation rejects secret-like values anywhere in a fixture", () => {
  const leaky = minimalFixture({
    expected: { adminGroups: ["Workspace"], apiToken: "abc123" },
  });
  assert.throws(() => validateGeordiQaFixture(leaky), /apiToken/);
});

test("validation rejects embedded base64 payloads", () => {
  const blob = minimalFixture({
    expected: {
      screenshot:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    },
  });
  assert.throws(() => validateGeordiQaFixture(blob), /base64/i);
});

test("fixtures are deterministic: repeated loads deep-equal and JSON round-trip", async () => {
  const first = await loadGeordiQaFixtures();
  const second = await loadGeordiQaFixtures();
  assert.deepEqual(first, second);
  for (const fixture of first.fixtures) {
    assert.deepEqual(JSON.parse(JSON.stringify(fixture)), fixture);
  }
});

test("admin-navigation fixture targets Users & Access activation deterministically", async () => {
  const { byId } = await loadGeordiQaFixtures();
  const fixture = byId["admin-navigation"];
  assert.deepEqual(fixture.expected.adminGroups, ["Workspace", "Work", "Team", "Admin"]);
  const usersStep = fixture.steps.find((step) => /Users & Access/.test(step.action));
  assert.ok(usersStep, "must include a Users & Access activation step");
  assert.match(usersStep.expect, /Users & Access/);
});

test("task-handoffs fixture uses the GEORDI-QA synthetic prefix with mandatory cleanup", async () => {
  const { byId } = await loadGeordiQaFixtures();
  const fixture = byId["task-handoffs"];
  const titleStep = fixture.steps.find((step) => /GEORDI-QA-/.test(JSON.stringify(step)));
  assert.ok(titleStep, "must reference the GEORDI-QA synthetic prefix");
  assert.ok(
    fixture.cleanup.some((step) => /delete|remove|restore/i.test(step)),
    "cleanup must delete or restore the synthetic record",
  );
  assert.ok(fixture.expected.handoffsSection, "expected must name the handoffs section state");
});

test("provider-preview fixture expects honest provider card states and forbids credential entry", async () => {
  const { byId } = await loadGeordiQaFixtures();
  const fixture = byId["provider-preview"];
  assert.deepEqual(fixture.expected.providers, [
    "Google Workspace",
    "Microsoft 365",
    "Local",
  ]);
  for (const state of fixture.expected.connectionStates) {
    assert.ok(
      ["connected", "disconnected", "sandbox", "unknown"].includes(state),
      `honest state vocabulary only: ${state}`,
    );
  }
  assert.ok(
    fixture.forbidden.some((rule) => /credential|oauth|permission prompt/i.test(rule)),
    "must forbid credential/OAuth entry",
  );
});

test("refresh fixture requires persistence across reload with a recovery fallback", async () => {
  const { byId } = await loadGeordiQaFixtures();
  const fixture = byId["refresh"];
  assert.equal(fixture.expected.persistsAcrossRefresh, true);
  assert.ok(
    fixture.steps.some((step) => /reload|refresh/i.test(step.action)),
    "must include a reload/refresh step",
  );
  assert.ok(
    fixture.recovery && /new-tab|re-navigate/i.test(fixture.recovery),
    "must define the native reload-unavailable recovery path",
  );
  assert.ok(
    fixture.cleanup.some((step) => /restor/i.test(step)),
    "must restore the toggled module",
  );
});

test("mobile-viewport fixture pins the viewport width and honest BLOCKED fallback", async () => {
  const { byId } = await loadGeordiQaFixtures();
  const fixture = byId["mobile-viewport"];
  assert.equal(fixture.expected.viewportWidthPx, 390);
  assert.ok(fixture.expected.navigationState, "must define the expected mobile navigation state");
  assert.ok(
    fixture.blockedFallback && /exact blocker/i.test(fixture.blockedFallback),
    "must demand the exact blocker when native resize is unavailable",
  );
});

test("external-document-metadata fixture is fully deterministic and semantic-match only", async () => {
  const { byId } = await loadGeordiQaFixtures();
  const fixture = byId["external-document-metadata"];
  assert.equal(fixture.expected.matchMode, "semantic");
  for (const field of [
    "title",
    "sourceId",
    "sourceName",
    "mimeType",
    "sizeBytes",
    "modifiedAt",
  ]) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(fixture.expected.documentMetadata, field),
      `metadata field ${field} must be pinned`,
    );
  }
  assert.equal(typeof fixture.expected.documentMetadata.sizeBytes, "number");
  assert.ok(
    fixture.forbidden.some((rule) => /substring/i.test(rule)),
    "must forbid substring matching against metadata",
  );
});

test("loader rejects a fixture directory with missing or duplicate ids", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "geordi-qa-fixtures-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(dir, { recursive: true });
  const good = minimalFixture();
  await writeFile(path.join(dir, "a.json"), JSON.stringify(good));
  await writeFile(path.join(dir, "b.json"), JSON.stringify(good));
  await assert.rejects(() => loadGeordiQaFixtures(dir), /duplicate fixture id/i);

  await rm(path.join(dir, "b.json"));
  await assert.rejects(() => loadGeordiQaFixtures(dir), /missing fixture id/i);
});
