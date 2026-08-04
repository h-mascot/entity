import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildOpenWikiHtml,
  renderOpenWikiHtml,
  verifyOpenWikiHtml,
} from "../packages/app/scripts/entity-openwiki-html-lib.mjs";

async function wikiFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "entity-openwiki-html-test-"));
  await mkdir(path.join(root, "openwiki", "features"), { recursive: true });
  await writeFile(path.join(root, "openwiki", "INSTRUCTIONS.md"), "# Internal instructions\n");
  await writeFile(path.join(root, "openwiki", "log.md"), "# Internal log\n");
  await writeFile(path.join(root, "openwiki", "index.md"), `---\ntitle: Entity Wiki\ndescription: Product and operations documentation.\ntags: [entity, docs]\n---\n# Entity Wiki\n\nRead [Files](features/files.md), browse [Features](features/), or follow [Moved Files](old/files.md).\n`);
  await writeFile(path.join(root, "openwiki", "features", "index.md"), `---\ntitle: Features\n---\n# Features\n`);
  await writeFile(path.join(root, "openwiki", "features", "files.md"), `---\ntype: Feature\ntitle: Files and docs\ndescription: Browse and inspect source-backed documents.\ntags: [files, documents]\n---\n# Files and docs\n\n<script>alert("must not execute")</script>\n\n| Surface | State |\n| --- | --- |\n| Entity Wiki | Read only |\n\n[Back](../index.md) · [External](https://example.com/docs)\n`);
  return root;
}

test("buildOpenWikiHtml turns frontmatter into presentation metadata without showing YAML", async () => {
  const root = await wikiFixture();
  const output = await buildOpenWikiHtml(root, { sourceId: "entity-wiki" });
  const page = output.files.get("features/files.html");

  assert.ok(page);
  assert.match(page, /<h1[^>]*>Files and docs<\/h1>/);
  assert.match(page, /Browse and inspect source-backed documents\./);
  assert.match(page, /<span[^>]*>files<\/span>/);
  assert.doesNotMatch(page, /type:\s*Feature/);
  assert.doesNotMatch(page, /tags:\s*\[/);
  assert.doesNotMatch(page, /<script>/);
  assert.match(page, /&lt;script&gt;alert/);
  assert.match(page, /<table>/);
  assert.doesNotMatch(page, /<script\b/i);
});

test("buildOpenWikiHtml rewrites wiki links through Entity and isolates external links", async () => {
  const root = await wikiFixture();
  const output = await buildOpenWikiHtml(root, { sourceId: "entity-wiki" });
  const index = output.files.get("index.html");
  const nested = output.files.get("features/files.html");

  assert.match(index, /href="\/docs\/source\/entity-wiki\/features\/files\.html"[^>]*target="_top"/);
  assert.match(index, /href="\/docs\/source\/entity-wiki\/features\/index\.html" target="_top">Features<\/a>/);
  assert.match(index, /href="\/docs\/source\/entity-wiki\/features\/files\.html" target="_top">Moved Files<\/a>/);
  assert.match(nested, /href="\/docs\/source\/entity-wiki\/index\.html"[^>]*target="_top"/);
  assert.match(nested, /href="https:\/\/example\.com\/docs"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
});

test("buildOpenWikiHtml keeps keyboard focus visibly distinct from hover", async () => {
  const root = await wikiFixture();
  const output = await buildOpenWikiHtml(root, { sourceId: "entity-wiki" });
  const index = output.files.get("index.html");

  assert.match(index, /:focus-visible\{[^}]*outline:2px solid var\(--accent\)[^}]*outline-offset:2px/);
  assert.doesNotMatch(index, /:focus-visible\{[^}]*outline:none/);
});

test("renderOpenWikiHtml creates deterministic recursive pages and a content manifest", async () => {
  const root = await wikiFixture();
  const first = await renderOpenWikiHtml(root, { sourceId: "entity-wiki" });
  const firstIndex = await readFile(path.join(root, "openwiki-html", "index.html"), "utf8");
  const firstManifest = await readFile(path.join(root, "openwiki-html", ".entity-openwiki-html.json"), "utf8");

  assert.equal(first.documentCount, 3);
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.sourceId, "entity-wiki");
  assert.match(firstManifest, /"contentHash": "sha256:[a-f0-9]{64}"/);
  await assert.rejects(() => readFile(path.join(root, "openwiki-html", "INSTRUCTIONS.html"), "utf8"), /ENOENT/);
  await assert.rejects(() => readFile(path.join(root, "openwiki-html", "log.html"), "utf8"), /ENOENT/);

  await renderOpenWikiHtml(root, { sourceId: "entity-wiki" });
  assert.equal(await readFile(path.join(root, "openwiki-html", "index.html"), "utf8"), firstIndex);
  assert.equal(await readFile(path.join(root, "openwiki-html", ".entity-openwiki-html.json"), "utf8"), firstManifest);
  await verifyOpenWikiHtml(root, { sourceId: "entity-wiki" });
});

test("verifyOpenWikiHtml rejects stale, missing, and extra presentation output", async () => {
  const root = await wikiFixture();
  await renderOpenWikiHtml(root, { sourceId: "entity-wiki" });

  await writeFile(path.join(root, "openwiki", "features", "files.md"), "# Changed after render\n");
  await assert.rejects(() => verifyOpenWikiHtml(root, { sourceId: "entity-wiki" }), /stale/i);

  await renderOpenWikiHtml(root, { sourceId: "entity-wiki" });
  await writeFile(path.join(root, "openwiki-html", "unexpected.html"), "unexpected\n");
  await assert.rejects(() => verifyOpenWikiHtml(root, { sourceId: "entity-wiki" }), /unexpected|extra/i);
});

test("renderOpenWikiHtml refuses a symlinked output directory", async () => {
  const root = await wikiFixture();
  const external = await mkdtemp(path.join(tmpdir(), "entity-openwiki-html-external-"));
  await symlink(external, path.join(root, "openwiki-html"));

  await assert.rejects(() => renderOpenWikiHtml(root, { sourceId: "entity-wiki" }), /symbolic link|symlink/i);
  await assert.rejects(() => readFile(path.join(external, "index.html"), "utf8"), /ENOENT/);
});

test("HTML wiki presentation is wired into setup, verification, CI, and deployment", async () => {
  const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const [rootPackage, appPackage, setup, example, docsExample, runner, deploy, workflow, loopWorkflow, ignore] = await Promise.all([
    readFile(path.join(repo, "package.json"), "utf8"),
    readFile(path.join(repo, "packages", "app", "package.json"), "utf8"),
    readFile(path.join(repo, "scripts", "entity-setup.js"), "utf8"),
    readFile(path.join(repo, "entity.config.example.yaml"), "utf8"),
    readFile(path.join(repo, "docs", "config", "entity.config.example.yaml"), "utf8"),
    readFile(path.join(repo, "scripts", "entity-openwiki.mjs"), "utf8"),
    readFile(path.join(repo, "deploy.sh"), "utf8"),
    readFile(path.join(repo, ".github", "workflows", "main.yml"), "utf8"),
    readFile(path.join(repo, ".github", "workflows", "loop-docs-sweep.yml"), "utf8"),
    readFile(path.join(repo, ".openwikiignore"), "utf8"),
  ]);

  assert.match(rootPackage, /"docs:wiki:render"/);
  assert.match(rootPackage, /"test:wiki-html"/);
  assert.match(appPackage, /"docs:wiki:render"/);
  assert.match(setup, /basePath: \.\/openwiki-html/);
  assert.match(example, /id: entity-wiki[\s\S]*basePath: \.\/openwiki-html[\s\S]*readOnly: true/);
  assert.match(docsExample, /id: entity-wiki[\s\S]*basePath: \.\/openwiki-html[\s\S]*readOnly: true/);
  assert.match(runner, /renderOpenWikiHtml/);
  assert.match(runner, /verifyOpenWikiHtml/);
  assert.match(runner, /openwiki-html/);
  assert.match(deploy, /openwiki-html\/.*ENTITY_DIR.*openwiki-html\//s);
  assert.match(deploy, /ENTITY_PROD_CONFIG_PATH/);
  assert.match(deploy, /entity-wiki-config-migrate\.mjs/);
  assert.match(workflow, /npm run test:wiki-html/);
  assert.ok(loopWorkflow.indexOf("run: npm ci") < loopWorkflow.indexOf("run: npm run docs:wiki:verify"));
  assert.match(loopWorkflow, /npm run test:wiki-html/);
  assert.match(ignore, /^\/openwiki-html\/$/m);
  assert.match(ignore, /^\/\.openwiki-html-tmp-\*\/$/m);
  assert.match(ignore, /^\/\.openwiki-html-backup-\*\/$/m);
});
