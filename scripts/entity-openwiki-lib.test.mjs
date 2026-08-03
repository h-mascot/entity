import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OPENWIKI_MINIMUM_RELEASE_AGE_MINUTES,
  OPENWIKI_VERSION,
  buildOpenWikiArgs,
  buildPnpmInstallArgs,
  computeSourceFingerprint,
  codexAuthToOpenWikiEnv,
  generatedWikiStatusIsClean,
  normalizeOpenWikiBootstrapText,
  shouldRunOpenWiki,
  validateOpenWikiIgnore,
  verifyGeneratedWiki,
  writeGenerationMetadata,
} from "./entity-openwiki-lib.mjs";

async function fixture({ withConcept = true } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "entity-openwiki-test-"));
  await mkdir(path.join(root, "packages", "server", "src"), { recursive: true });
  await mkdir(path.join(root, "openwiki"), { recursive: true });
  await writeFile(path.join(root, "package.json"), '{"name":"entity"}\n');
  await writeFile(path.join(root, ".openwikiignore"), [
    ".env", "*.db", "docs/internal/", "/var/", "/memory/", "/artifacts/", "/.claude/", "/.cursor/run-state/",
  ].join("\n"));
  await writeFile(path.join(root, "packages", "server", "src", "feature.ts"), "export const feature = true;\n");
  await writeFile(path.join(root, "openwiki", "INSTRUCTIONS.md"), "# Instructions\n");
  await writeFile(path.join(root, "openwiki", "index.md"), '---\nokf_version: "0.1"\ntype: index\n---\n# Entity Wiki\n');
  if (withConcept) {
    await writeFile(path.join(root, "openwiki", "features.md"), '---\ntype: feature\n---\n# Features\n');
  }
  return root;
}

test("buildOpenWikiArgs pins OpenWiki and enforces minimum release age", () => {
  assert.equal(OPENWIKI_VERSION, "0.2.5");
  assert.equal(OPENWIKI_MINIMUM_RELEASE_AGE_MINUTES, 10080);
  assert.deepEqual(buildPnpmInstallArgs(), [
    `--config.minimum-release-age=${OPENWIKI_MINIMUM_RELEASE_AGE_MINUTES}`,
    "--dir",
    "tools/openwiki",
    "install",
    "--frozen-lockfile",
  ]);
  assert.deepEqual(buildOpenWikiArgs("update"), ["code", "--update", "--print"]);
  assert.deepEqual(buildOpenWikiArgs("init"), ["code", "--init", "--print"]);
  assert.deepEqual(buildOpenWikiArgs("update", "Remove the duplicate workflow"), [
    "code", "--update", "--print", "Remove the duplicate workflow",
  ]);
});

test("prepare generation runs only when the wiki is stale", () => {
  assert.equal(shouldRunOpenWiki("prepare", true), false);
  assert.equal(shouldRunOpenWiki("prepare", false), true);
  assert.equal(shouldRunOpenWiki("update", true), true);
});

test("OpenWiki bootstrap guidance reflects trusted generation and GitHub verification", () => {
  const normalized = normalizeOpenWikiBootstrapText(
    "The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages."
  );
  assert.match(normalized, /trusted Enterprise runner/);
  assert.match(normalized, /GitHub Actions verifies/);
  assert.doesNotMatch(normalized, /GitHub Actions workflow refreshes/);
});

test("OpenWiki ignore policy blocks private runtime and agent state", () => {
  assert.throws(
    () => validateOpenWikiIgnore(".env\n*.db\ndocs/internal/\n"),
    /\/var\//,
  );
  assert.doesNotThrow(() => validateOpenWikiIgnore([
    ".env",
    "*.db",
    "docs/internal/",
    "/var/",
    "/memory/",
    "/artifacts/",
    "/.claude/",
    "/.cursor/run-state/",
  ].join("\n")));
});

test("source fingerprint covers workflows, public docs, and focused tests", async () => {
  const root = await fixture();
  let fingerprint = await computeSourceFingerprint(root);

  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: CI\n");
  let next = await computeSourceFingerprint(root);
  assert.notEqual(next, fingerprint);
  fingerprint = next;

  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "docs", "architecture.md"), "# Architecture\n");
  next = await computeSourceFingerprint(root);
  assert.notEqual(next, fingerprint);
  fingerprint = next;

  await writeFile(path.join(root, "packages", "server", "src", "feature.test.ts"), "test coverage evidence\n");
  assert.notEqual(await computeSourceFingerprint(root), fingerprint);
});

test("source fingerprint changes for product source but ignores generated wiki", async () => {
  const root = await fixture();
  const initial = await computeSourceFingerprint(root);
  await writeFile(path.join(root, "openwiki", "generated.md"), "generated\n");
  assert.equal(await computeSourceFingerprint(root), initial);
  await writeFile(path.join(root, ".openwikiignore"), "*.db\n");
  const ignoreFingerprint = await computeSourceFingerprint(root);
  assert.notEqual(ignoreFingerprint, initial);
  await writeFile(path.join(root, "openwiki", "INSTRUCTIONS.md"), "Updated instructions\n");
  const instructionFingerprint = await computeSourceFingerprint(root);
  assert.notEqual(instructionFingerprint, ignoreFingerprint);
  await writeFile(path.join(root, "packages", "server", "src", "feature.ts"), "export const feature = false;\n");
  assert.notEqual(await computeSourceFingerprint(root), initial);
});

test("generated wiki verification rejects stale source fingerprints", async () => {
  const root = await fixture();
  await writeGenerationMetadata(root, { provider: "copilot", model: "gpt-5.5", sourceSha: "abc123" });
  await verifyGeneratedWiki(root);
  await writeFile(path.join(root, "packages", "server", "src", "feature.ts"), "export const feature = false;\n");
  await assert.rejects(() => verifyGeneratedWiki(root), /stale/i);
});


test("generation metadata is stable when source and model are unchanged", async () => {
  const root = await fixture();
  await writeGenerationMetadata(root, { provider: "copilot", model: "gpt-5.5", sourceSha: "first" });
  const first = await readFile(path.join(root, "openwiki", ".entity-openwiki.json"), "utf8");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await writeGenerationMetadata(root, { provider: "copilot", model: "gpt-5.5", sourceSha: "docs-only-commit" });
  const second = await readFile(path.join(root, "openwiki", ".entity-openwiki.json"), "utf8");
  assert.equal(second, first);
});


test("generated wiki verification rejects an uninitialized index skeleton", async () => {
  const root = await fixture({ withConcept: false });
  await writeGenerationMetadata(root, { provider: "copilot", model: "gpt-4.1", sourceSha: "abc123" });
  await assert.rejects(() => verifyGeneratedWiki(root), /concept/i);
});


test("Codex OAuth auth maps to OpenWiki environment without exposing unrelated fields", () => {
  const payload = Buffer.from(JSON.stringify({ exp: 2000000000 })).toString("base64url");
  const accessToken = `header.${payload}.signature`;
  const result = codexAuthToOpenWikiEnv({
    tokens: {
      access_token: accessToken,
      refresh_token: "refresh-secret",
      account_id: "account-123",
    },
    unrelated: "ignored",
  });
  assert.deepEqual(result, {
    OPENAI_CHATGPT_ACCESS_TOKEN: accessToken,
    OPENAI_CHATGPT_REFRESH_TOKEN: "refresh-secret",
    OPENAI_CHATGPT_EXPIRES_AT: "2000000000000",
    OPENAI_CHATGPT_ACCOUNT_ID: "account-123",
  });
});


test("generated wiki status cleanliness rejects changed or untracked docs", () => {
  assert.equal(generatedWikiStatusIsClean(""), true);
  assert.equal(generatedWikiStatusIsClean(" M openwiki/quickstart.md\n"), false);
  assert.equal(generatedWikiStatusIsClean("?? CLAUDE.md\n"), false);
});


test("standard setup emits the Entity Wiki file source", async () => {
  const setupSource = await readFile(new URL("./entity-setup.js", import.meta.url), "utf8");
  assert.match(setupSource, /'  - id: entity-wiki'/);
  assert.match(setupSource, /'    basePath: \.\/openwiki'/);
  assert.match(setupSource, /'    readOnly: true'/);
  const configSource = await readFile(new URL("../entity.config.example.yaml", import.meta.url), "utf8");
  assert.match(configSource, /id: entity-wiki[\s\S]*readOnly: true/);
});
