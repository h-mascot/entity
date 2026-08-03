import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  OPENWIKI_MINIMUM_RELEASE_AGE_MINUTES,
  OPENWIKI_VERSION,
  buildCredentialFreeEnvironment,
  buildOpenWikiArgs,
  buildOpenWikiEnvironment,
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


test("OpenWiki execution environments do not forward ambient secrets", () => {
  const ambient = {
    PATH: "/bin",
    HOME: "/tmp/home",
    LANG: "en_US.UTF-8",
    OPENAI_API_KEY: "openai-secret",
    GITHUB_TOKEN: "github-secret",
    AWS_SECRET_ACCESS_KEY: "aws-secret",
    DEPLOY_WEBHOOK_TOKEN: "deploy-secret",
    OPENAI_CHATGPT_UNRELATED_SECRET: "prefix-secret",
    OPENWIKI_PROVIDER_RETRY_ATTEMPTS: "5",
    HTTPS_PROXY: "http://proxy.example:8080",
    HTTP_PROXY: "http://user:password@proxy.example:8080",
    NO_PROXY: "localhost,127.0.0.1",
  };
  assert.deepEqual(buildCredentialFreeEnvironment(ambient, { isolatedHome: "/tmp/isolated-home" }), {
    PATH: "/bin",
    HOME: "/tmp/isolated-home",
    LANG: "en_US.UTF-8",
    HTTPS_PROXY: "http://proxy.example:8080",
    NO_PROXY: "localhost,127.0.0.1",
    NPM_CONFIG_USERCONFIG: "/tmp/isolated-home/.npmrc",
    XDG_CONFIG_HOME: "/tmp/isolated-home/.config",
  });
  const openAi = buildOpenWikiEnvironment(ambient, {
    provider: "openai",
    model: "gpt-test",
    authEnvironment: {},
  });
  assert.equal(openAi.OPENAI_API_KEY, "openai-secret");
  assert.equal(openAi.GITHUB_TOKEN, undefined);
  assert.equal(openAi.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(openAi.DEPLOY_WEBHOOK_TOKEN, undefined);
  assert.equal(openAi.OPENWIKI_TELEMETRY_DISABLED, "1");
  assert.equal(openAi.OPENWIKI_PROVIDER_RETRY_ATTEMPTS, "5");
  assert.equal(openAi.HTTP_PROXY, undefined);
  assert.equal(buildOpenWikiEnvironment(ambient, {
    provider: "openai",
    model: "gpt-test",
    authEnvironment: { OPENAI_CHATGPT_ACCESS_TOKEN: "wrong-provider" },
  }).OPENAI_CHATGPT_ACCESS_TOKEN, undefined);

  const chatGpt = buildOpenWikiEnvironment(ambient, {
    provider: "openai-chatgpt",
    model: "gpt-test",
    authEnvironment: { OPENAI_CHATGPT_ACCESS_TOKEN: "oauth-only" },
  });
  assert.equal(chatGpt.OPENAI_API_KEY, undefined);
  assert.equal(chatGpt.GITHUB_TOKEN, undefined);
  assert.equal(chatGpt.OPENAI_CHATGPT_ACCESS_TOKEN, "oauth-only");
  assert.equal(chatGpt.OPENAI_CHATGPT_UNRELATED_SECRET, undefined);
  assert.throws(
    () => buildOpenWikiEnvironment(ambient, { provider: "unknown-provider", model: "gpt-test" }),
    /Unsupported OpenWiki provider/,
  );
});

test("source fingerprint hashes tracked symlink targets without following broken links", async () => {
  const root = await fixture();
  await symlink("missing-target-a", path.join(root, "portable-link"));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  const first = await computeSourceFingerprint(root);
  await unlink(path.join(root, "portable-link"));
  await symlink("missing-target-b", path.join(root, "portable-link"));
  assert.equal(spawnSync("git", ["add", "portable-link"], { cwd: root }).status, 0);
  assert.notEqual(await computeSourceFingerprint(root), first);
});

test("source fingerprint fallback hashes symlink text without following links", async () => {
  const root = await fixture();
  const external = await mkdtemp(path.join(tmpdir(), "entity-openwiki-external-"));
  await writeFile(path.join(external, "secret.txt"), "secret-a\n");
  await symlink(path.join(external, "secret.txt"), path.join(root, "external-link"));
  await symlink("missing-a", path.join(root, "broken-link"));
  const first = await computeSourceFingerprint(root);
  await writeFile(path.join(external, "secret.txt"), "secret-b\n");
  assert.equal(await computeSourceFingerprint(root), first, "external target content must not be followed");
  await unlink(path.join(root, "broken-link"));
  await symlink("missing-b", path.join(root, "broken-link"));
  assert.notEqual(await computeSourceFingerprint(root), first, "link text must affect the fingerprint");
});

test("source fingerprint includes safe environment templates but excludes private env files", async () => {
  const root = await fixture();
  const initial = await computeSourceFingerprint(root);
  await writeFile(path.join(root, ".env.example"), "ENTITY_HOST=localhost\n");
  const templateFingerprint = await computeSourceFingerprint(root);
  assert.notEqual(templateFingerprint, initial);
  await writeFile(path.join(root, ".env.local"), "SECRET=private\n");
  assert.equal(await computeSourceFingerprint(root), templateFingerprint);
});

test("source fingerprint treats deleted tracked files like their post-commit absence", async () => {
  const root = await fixture();
  const removable = path.join(root, "packages", "server", "src", "removable.ts");
  await writeFile(removable, "export const removable = true;\n");
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  const present = await computeSourceFingerprint(root);
  await unlink(removable);
  const deletedWorktree = await computeSourceFingerprint(root);
  assert.notEqual(deletedWorktree, present);
  assert.equal(spawnSync("git", ["rm", "--cached", "packages/server/src/removable.ts"], { cwd: root }).status, 0);
  assert.equal(await computeSourceFingerprint(root), deletedWorktree);
});

test("source fingerprint includes untracked non-ignored source files", async () => {
  const root = await fixture();
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  const first = await computeSourceFingerprint(root);
  await writeFile(path.join(root, "new-source.ts"), "export const newSource = true;\n");
  assert.notEqual(await computeSourceFingerprint(root), first);
});

test("provider environments forward only the selected OpenWiki provider fields", () => {
  const ambient = {
    PATH: "/bin",
    COPILOT_API_KEY: "copilot-key",
    GITHUB_TOKEN: "unrelated-github-token",
    OPENROUTER_API_KEY: "openrouter-key",
    OPENAI_COMPATIBLE_API_KEY: "compatible-key",
    OPENAI_COMPATIBLE_BASE_URL: "https://example.invalid/v1",
    BEDROCK_AWS_ACCESS_KEY_ID: "bedrock-id",
    BEDROCK_AWS_SECRET_ACCESS_KEY: "bedrock-secret",
    BEDROCK_AWS_REGION: "eu-west-1",
  };
  const copilot = buildOpenWikiEnvironment(ambient, { provider: "copilot", model: "test" });
  assert.equal(copilot.COPILOT_API_KEY, "copilot-key");
  assert.equal(copilot.GITHUB_TOKEN, undefined);
  assert.equal(copilot.OPENROUTER_API_KEY, undefined);
  const compatible = buildOpenWikiEnvironment(ambient, { provider: "openai-compatible", model: "test" });
  assert.equal(compatible.OPENAI_COMPATIBLE_API_KEY, "compatible-key");
  assert.equal(compatible.OPENAI_COMPATIBLE_BASE_URL, "https://example.invalid/v1");
  assert.equal(compatible.BEDROCK_AWS_SECRET_ACCESS_KEY, undefined);
  const bedrock = buildOpenWikiEnvironment(ambient, { provider: "bedrock", model: "test" });
  assert.equal(bedrock.BEDROCK_AWS_ACCESS_KEY_ID, "bedrock-id");
  assert.equal(bedrock.BEDROCK_AWS_SECRET_ACCESS_KEY, "bedrock-secret");
  assert.equal(bedrock.BEDROCK_AWS_REGION, "eu-west-1");
  assert.equal(bedrock.OPENAI_COMPATIBLE_API_KEY, undefined);
});

test("source fingerprint covers all tracked-style shipped roots", async () => {
  const root = await fixture();
  let fingerprint = await computeSourceFingerprint(root);
  for (const [relativePath, content] of [
    ["SECURITY.md", "# Security\n"],
    ["package-lock.json", "{}\n"],
    ["entity-agent-contracts-plugin/index.ts", "export const contract = 1;\n"],
    ["entity-linker-plugin/index.ts", "export const linker = 1;\n"],
    ["skills/entity/SKILL.md", "# Entity skill\n"],
    ["packages/app/public/docs/output/proof.md", "# Shipped proof\n"],
    ["packages/server/clawd/memory/fixture.md", "# Shipped fixture\n"],
    ["packages/server/src/build/manifest.ts", "export const shipped = true;\n"],
    ["packages/app/src/dist/fixture.ts", "export const tracked = true;\n"],
  ]) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    const next = await computeSourceFingerprint(root);
    assert.notEqual(next, fingerprint, `${relativePath} must affect the source fingerprint`);
    fingerprint = next;
  }
});

test("tracked source nested under build and dist directory names affects the fingerprint", async () => {
  const root = await fixture();
  const buildPath = path.join(root, "packages/server/src/build/manifest.ts");
  const distPath = path.join(root, "packages/app/src/dist/fixture.ts");
  await mkdir(path.dirname(buildPath), { recursive: true });
  await mkdir(path.dirname(distPath), { recursive: true });
  await writeFile(buildPath, "export const shipped = 1;\n");
  await writeFile(distPath, "export const tracked = 1;\n");
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  let fingerprint = await computeSourceFingerprint(root);
  await writeFile(buildPath, "export const shipped = 2;\n");
  let next = await computeSourceFingerprint(root);
  assert.notEqual(next, fingerprint);
  fingerprint = next;
  await writeFile(distPath, "export const tracked = 2;\n");
  next = await computeSourceFingerprint(root);
  assert.notEqual(next, fingerprint);
});

test("pull request CI verifies generated docs against the PR head after merge-tree tests", async () => {
  const workflow = await readFile(new URL("../.github/workflows/main.yml", import.meta.url), "utf8");
  const testPosition = workflow.indexOf('npm test || echo "Tests skipped (MVP mode)"');
  const headPosition = workflow.indexOf("github.event.pull_request.head.sha");
  const verifyPosition = workflow.lastIndexOf("npm run docs:wiki:verify");
  assert.ok(testPosition >= 0 && headPosition > testPosition && verifyPosition > headPosition);
  assert.match(workflow, /repository: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
});

test("OpenWiki runner uses and removes an isolated credential-file home", async () => {
  const runner = await readFile(new URL("./entity-openwiki.mjs", import.meta.url), "utf8");
  assert.match(runner, /mkdtemp\(path\.join\(os\.tmpdir\(\), "entity-openwiki-home-"\)\)/);
  assert.match(runner, /writeFile\(path\.join\(isolatedHome, "\.npmrc"\), ""\)/);
  assert.match(runner, /installEnvironment = \{ \.\.\.buildCredentialFreeEnvironment\([^;]+CI: "true" \};/);
  assert.match(runner, /finally \{\s*await rm\(isolatedHome, \{ recursive: true, force: true \}\);\s*\}/s);
  assert.doesNotMatch(runner, /process\.exit\(installResult\.status|process\.exit\(result\.status/);
});

test("OpenWiki runner removes isolated HOME when pnpm startup fails", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "entity-openwiki-cleanup-test-"));
  const runnerPath = fileURLToPath(new URL("./entity-openwiki.mjs", import.meta.url));
  const failed = spawnSync(process.execPath, [runnerPath, "update"], {
    env: {
      ...process.env,
      PATH: "/definitely-missing",
      TMPDIR: temporaryRoot,
      OPENWIKI_PROVIDER: "openai",
      OPENAI_API_KEY: "test-only",
    },
    encoding: "utf8",
  });
  assert.notEqual(failed.status, 0);
  const leftovers = (await readdir(temporaryRoot)).filter((name) => name.startsWith("entity-openwiki-home-"));
  assert.deepEqual(leftovers, []);
});

test("deploy gate verifies the exact source checkout and fails closed", async () => {
  const deploySource = await readFile(new URL("../deploy.sh", import.meta.url), "utf8");
  const releaseCheckSource = await readFile(new URL("./entity-release-check.sh", import.meta.url), "utf8");
  assert.match(deploySource, /\[\[ -x "\$\{RELEASE_CHECK_SCRIPT\}" \]\] \|\| error/);
  assert.match(deploySource, /"\$\{RELEASE_CHECK_SCRIPT\}" "\$\{MAC_ENTITY_DIR\}"/);
  assert.match(deploySource, /npm run docs:wiki:verify/);
  assert.doesNotMatch(deploySource, /Release safety check script not found; continuing/);
  assert.match(deploySource, /SOURCE_SHA=.*git -C "\$\{MAC_ENTITY_DIR\}" rev-parse HEAD/);
  assert.match(deploySource, /SOURCE_ROOT=.*rev-parse --show-toplevel/);
  assert.match(deploySource, /SOURCE_DIR_REAL=.*pwd -P/);
  assert.match(deploySource, /ENTITY_RELEASE_BRANCH .*does not match configured source branch/);
  assert.match(deploySource, /refs\/remotes\/origin\/\$\{RELEASE_BRANCH\}/);
  const gatewayDeploySource = await readFile(new URL("./entity-gateway-pull-deploy.mjs", import.meta.url), "utf8");
  assert.match(gatewayDeploySource, /\+refs\/heads\/\$\{config\.branch\}:refs\/remotes\/origin\/\$\{config\.branch\}/);
  const webhookDeploySource = await readFile(new URL("./entity-deploy-webhook-server.mjs", import.meta.url), "utf8");
  assert.match(webhookDeploySource, /git fetch --prune origin \+refs\/heads\/main:refs\/remotes\/origin\/main/);
  assert.match(webhookDeploySource, /ENTITY_RELEASE_SHA="\$\{sha\}"/);
  assert.match(webhookDeploySource, /ENTITY_RELEASE_BRANCH="main"/);
  assert.match(deploySource, /Detached source SHA .* does not match branch/);
  assert.doesNotMatch(deploySource, /ENTITY_ALLOW_DIRTY_DEPLOY/);
  assert.match(deploySource, /command -v node/);
  assert.match(deploySource, /nohup '\$\{REMOTE_NODE_BIN\}' '\$\{RUNTIME_NODE_ENTRY\}'/);
  assert.doesNotMatch(deploySource, /nohup node '\$\{RUNTIME_NODE_ENTRY\}'/);
  assert.doesNotMatch(deploySource, /ENTITY_REMOTE_NODE_BIN:-\/opt\/homebrew/);
  assert.match(deploySource, /RELEASE_METADATA_PAYLOAD=.*python3/s);
  assert.match(deploySource, /entity-release-info-stdin\.mjs/);
  assert.doesNotMatch(deploySource, / -e 'const fs=require/);
  assert.doesNotMatch(deploySource, /--branch '\$\{RELEASE_BRANCH\}'/);
  assert.doesNotMatch(deploySource, /node "\$\{SCRIPT_DIR\}\/scripts\/entity-release-info\.mjs" --root "\$\{ENTITY_DIR\}"/);
  assert.match(releaseCheckSource, /REPO_ROOT=.*\$\{1:-/);
});

test("release metadata stdin wrapper preserves metacharacters without a shell", async () => {
  const root = await fixture();
  const outputPath = path.join(root, "captured.json");
  const recorderPath = path.join(root, "recorder.mjs");
  await writeFile(recorderPath, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(process.argv.slice(2)));\n`);
  const payload = {
    script: recorderPath,
    root: "/tmp/entity path/with'quote",
    sha: "abc123",
    branch: "review-$(touch-never-runs)'quoted",
    environment: "sandbox;still-data",
  };
  const wrapped = spawnSync(process.execPath, [fileURLToPath(new URL("./entity-release-info-stdin.mjs", import.meta.url))], {
    input: JSON.stringify(payload),
    encoding: "utf8",
  });
  assert.equal(wrapped.status, 0, wrapped.stderr);
  assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), [
    "--root", payload.root,
    "--sha", payload.sha,
    "--branch", payload.branch,
    "--environment", payload.environment,
    "--write",
  ]);
});

test("deploy rejects source subdirectories, dirty bypasses, and branch mismatches before network access", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "scripts"), { recursive: true });
  await copyFile(new URL("../deploy.sh", import.meta.url), path.join(root, "deploy.sh"));
  await copyFile(new URL("./entity-release-check.sh", import.meta.url), path.join(root, "scripts", "entity-release-check.sh"));
  await chmod(path.join(root, "deploy.sh"), 0o755);
  await chmod(path.join(root, "scripts", "entity-release-check.sh"), 0o755);
  assert.equal(spawnSync("git", ["init", "-q", "-b", "review-test"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.email", "review@example.invalid"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Review Test"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["commit", "-qm", "fixture"], { cwd: root }).status, 0);
  const baseEnvironment = {
    ...process.env,
    ENTITY_PROD_HOST: "invalid.example",
    ENTITY_PROD_HTTP_HOST: "invalid.example",
    ENTITY_PROD_DIR: "/tmp/entity-invalid-target",
    ENTITY_PROD_DB: "/tmp/entity-invalid.db",
  };
  const subdirectory = spawnSync("bash", [path.join(root, "deploy.sh")], {
    cwd: root,
    env: { ...baseEnvironment, ENTITY_SOURCE_DIR: path.join(root, "packages") },
    encoding: "utf8",
  });
  assert.notEqual(subdirectory.status, 0);
  assert.match(`${subdirectory.stdout}${subdirectory.stderr}`, /exact checkout root/);

  const wrongBranch = spawnSync("bash", [path.join(root, "deploy.sh")], {
    cwd: root,
    env: { ...baseEnvironment, ENTITY_SOURCE_DIR: root, ENTITY_RELEASE_BRANCH: "stale-branch" },
    encoding: "utf8",
  });
  assert.notEqual(wrongBranch.status, 0);
  assert.match(`${wrongBranch.stdout}${wrongBranch.stderr}`, /does not match configured source branch/);

  await writeFile(path.join(root, "dirty.txt"), "dirty\n");
  const dirty = spawnSync("bash", [path.join(root, "deploy.sh")], {
    cwd: root,
    env: { ...baseEnvironment, ENTITY_SOURCE_DIR: root, ENTITY_ALLOW_DIRTY_DEPLOY: "1" },
    encoding: "utf8",
  });
  assert.notEqual(dirty.status, 0);
  assert.match(`${dirty.stdout}${dirty.stderr}`, /dirty deploys are not permitted/);

  await unlink(path.join(root, "dirty.txt"));
  assert.equal(spawnSync("git", ["checkout", "--detach", "HEAD"], { cwd: root }).status, 0);
  const detached = spawnSync("bash", [path.join(root, "deploy.sh")], {
    cwd: root,
    env: { ...baseEnvironment, ENTITY_SOURCE_DIR: root, ENTITY_RELEASE_BRANCH: "review-test" },
    encoding: "utf8",
    timeout: 10000,
  });
  const detachedOutput = `${detached.stdout}${detached.stderr}`;
  assert.notEqual(detached.status, 0);
  assert.match(detachedOutput, /\[release-check\] OK: HEAD @ [0-9a-f]+ is clean/);
  assert.doesNotMatch(detachedOutput, /Detached source SHA .* does not match branch|requires ENTITY_RELEASE_BRANCH/);
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


test("generation metadata has no unverifiable source commit claim", async () => {
  const root = await fixture();
  const metadata = await writeGenerationMetadata(root, { provider: "copilot", model: "gpt-5.5" });
  assert.equal(metadata.schemaVersion, 2);
  assert.equal(Object.hasOwn(metadata, "sourceSha"), false);
  const metadataPath = path.join(root, "openwiki", ".entity-openwiki.json");
  await writeFile(metadataPath, `${JSON.stringify({ ...metadata, schemaVersion: 1 })}\n`);
  await assert.rejects(() => verifyGeneratedWiki(root), /schema version/i);
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
