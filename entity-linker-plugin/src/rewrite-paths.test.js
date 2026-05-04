import test from "node:test";
import assert from "node:assert/strict";

import { ENTITY_OUTPUT_BASE_URL, replaceEntityPaths } from "./rewrite-paths.js";

test("rewrites tilde-based output paths", () => {
  const input = "See ~/clawd/output/screenshots/demo.png for context.";
  const actual = replaceEntityPaths(input);

  assert.equal(
    actual,
    `See ${ENTITY_OUTPUT_BASE_URL}screenshots/demo.png for context.`,
  );
});

test("rewrites absolute clawd paths to Entity output URLs", () => {
  const input = "Artifacts live at /home/henrymascot/clawd/runs/task-1/result.json";
  const actual = replaceEntityPaths(input);

  assert.equal(
    actual,
    `Artifacts live at ${ENTITY_OUTPUT_BASE_URL}runs/task-1/result.json`,
  );
});

test("rewrites every matching path in the same message", () => {
  const input =
    "Compare ~/clawd/output/a.txt with /home/henrymascot/clawd/output/b.txt";
  const actual = replaceEntityPaths(input);

  assert.equal(
    actual,
    `Compare ${ENTITY_OUTPUT_BASE_URL}a.txt with ${ENTITY_OUTPUT_BASE_URL}b.txt`,
  );
});

test("leaves unrelated text unchanged", () => {
  const input = "No local file paths here.";
  const actual = replaceEntityPaths(input);

  assert.equal(actual, input);
});
