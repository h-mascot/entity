import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { migrateEntityWikiConfig, migrateEntityWikiConfigFile } from "./entity-wiki-config-migrate.mjs";

const CONFIG = `server:\n  port: 3007\nfileSources:\n  - id: workspace\n    displayName: Workspace\n    type: local\n    basePath: ./workspace\n  - id: entity-wiki\n    displayName: Entity Wiki\n    type: local\n    basePath: ./openwiki\n    readOnly: true\n  - id: other\n    displayName: Other\n    type: local\n    basePath: ./other\n`;

test("migrateEntityWikiConfig changes only the Entity Wiki source path", () => {
  const result = migrateEntityWikiConfig(CONFIG);
  assert.equal(result.changed, true);
  assert.match(result.content, /- id: entity-wiki[\s\S]*?basePath: \.\/openwiki-html/);
  assert.match(result.content, /- id: workspace[\s\S]*?basePath: \.\/workspace/);
  assert.match(result.content, /- id: other[\s\S]*?basePath: \.\/other/);
});

test("migrateEntityWikiConfig is idempotent", () => {
  const first = migrateEntityWikiConfig(CONFIG);
  const second = migrateEntityWikiConfig(first.content);
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test("migrateEntityWikiConfig preserves custom paths and refuses missing sources", () => {
  const custom = migrateEntityWikiConfig(
    CONFIG.replace("basePath: ./openwiki\n    readOnly", "basePath: /private/wiki\n    readOnly"),
  );
  assert.equal(custom.changed, false);
  assert.equal(custom.preservedCustomPath, "/private/wiki");
  assert.throws(() => migrateEntityWikiConfig("fileSources: []\n"), /entity-wiki source is missing/);
});

test("migrateEntityWikiConfig forces generated HTML sources read-only", () => {
  const writable = migrateEntityWikiConfig(CONFIG.replace("readOnly: true", "readOnly: false"));
  assert.equal(writable.changed, true);
  assert.match(writable.content, /readOnly: true/);
  assert.doesNotMatch(writable.content, /readOnly: false/);

  const omitted = migrateEntityWikiConfig(CONFIG.replace("    readOnly: true\n", ""));
  assert.equal(omitted.changed, true);
  assert.equal((omitted.content.match(/readOnly: true/g) ?? []).length, 1);
});

test("migrateEntityWikiConfigFile preserves a backup and is safe to rerun", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "entity-wiki-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "entity.config.yaml");
  const presentationPath = path.join(root, "runtime", "openwiki-html");
  await mkdir(presentationPath, { recursive: true });
  await writeFile(configPath, CONFIG);

  const first = await migrateEntityWikiConfigFile(configPath, { presentationPath });
  assert.equal(first.changed, true);
  assert.equal(await readFile(`${configPath}.before-openwiki-html`, "utf8"), CONFIG);
  assert.match(await readFile(configPath, "utf8"), /basePath: \.\/openwiki-html/);
  assert.equal(await readlink(path.join(root, "openwiki-html")), "runtime/openwiki-html");

  const second = await migrateEntityWikiConfigFile(configPath, { presentationPath });
  assert.equal(second.changed, false);
  assert.equal(await readFile(`${configPath}.before-openwiki-html`, "utf8"), CONFIG);
});

test("migrateEntityWikiConfigFile accepts the managed current presentation alias for immutable releases", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "entity-wiki-config-managed-current-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sha = "a".repeat(40);
  const configPath = path.join(root, "entity.config.yaml");
  const presentationPath = path.join(root, "releases", sha, "openwiki-html");
  await mkdir(presentationPath, { recursive: true });
  await writeFile(configPath, CONFIG.replace("./openwiki", "./openwiki-html"));
  await symlink(path.join("current", "openwiki-html"), path.join(root, "openwiki-html"), "dir");

  const result = await migrateEntityWikiConfigFile(configPath, { presentationPath });
  assert.equal(result.changed, false);
  assert.equal(result.presentationLink, path.join(root, "openwiki-html"));
  assert.equal(await readlink(path.join(root, "openwiki-html")), path.join("current", "openwiki-html"));
});

test("migrateEntityWikiConfigFile refuses to replace an existing custom presentation symlink", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "entity-wiki-config-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "entity.config.yaml");
  const expectedPresentation = path.join(root, "expected", "openwiki-html");
  const customPresentation = path.join(root, "custom", "openwiki-html");
  await mkdir(expectedPresentation, { recursive: true });
  await mkdir(customPresentation, { recursive: true });
  await writeFile(configPath, CONFIG.replace("./openwiki", "./openwiki-html"));
  await symlink(path.relative(root, customPresentation), path.join(root, "openwiki-html"), "dir");

  await assert.rejects(
    () => migrateEntityWikiConfigFile(configPath, { presentationPath: expectedPresentation }),
    /refusing to replace custom presentation symlink/,
  );
  assert.equal(await readlink(path.join(root, "openwiki-html")), "custom/openwiki-html");
});

test("migrateEntityWikiConfigFile supports config and presentation in the same runtime directory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "entity-wiki-config-in-tree-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "entity.config.yaml");
  const presentationPath = path.join(root, "openwiki-html");
  await mkdir(presentationPath);
  await writeFile(configPath, CONFIG);

  const result = await migrateEntityWikiConfigFile(configPath, { presentationPath });
  assert.equal(result.changed, true);
  assert.equal(result.presentationLink, presentationPath);
  assert.equal((await lstat(presentationPath)).isDirectory(), true);
});

test("config migrator CLI runs when invoked through a deployment symlink", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "entity-wiki-config-cli-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, "entity.config.yaml");
  const presentationPath = path.join(root, "runtime", "openwiki-html");
  const cliPath = path.join(root, "entity-wiki-config-migrate.mjs");
  await mkdir(presentationPath, { recursive: true });
  await writeFile(configPath, CONFIG);
  await symlink(fileURLToPath(new URL("./entity-wiki-config-migrate.mjs", import.meta.url)), cliPath);

  const result = spawnSync(process.execPath, [cliPath, configPath, presentationPath], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /migrated/);
  assert.match(await readFile(configPath, "utf8"), /basePath: \.\/openwiki-html/);
});
