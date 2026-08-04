import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const script = join(scriptsDirectory, "entity-release-info.mjs");
const deployScript = join(scriptsDirectory, "..", "deploy.sh");
const sha = "a".repeat(40);

function runManifest(root, { write = false } = {}) {
  const args = [script, "--root", root, "--sha", sha, "--branch", "main", "--environment", "sandbox"];
  if (write) args.push("--write");
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return write ? JSON.parse(readFileSync(join(root, "RELEASE.json"), "utf8")) : JSON.parse(result.stdout).manifest;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "entity-release-info-test-"));
  mkdirSync(join(root, "packages/server/dist/db"), { recursive: true });
  writeFileSync(join(root, "packages/server/dist/server.js"), "immutable-server\n");
  writeFileSync(join(root, "app.txt"), "immutable-app\n");
  return root;
}

test("artifact hashes do not follow file or directory symlink targets", () => {
  const root = fixture();
  const external = mkdtempSync(join(tmpdir(), "entity-release-external-"));
  try {
    const database = join(external, "entity-tasks.db");
    const externalDirectory = join(external, "runtime");
    mkdirSync(externalDirectory);
    writeFileSync(database, "private-db-v1\n");
    writeFileSync(join(externalDirectory, "secret.txt"), "private-secret-v1\n");
    symlinkSync(database, join(root, "packages/server/dist/db/entity-tasks.db"));
    symlinkSync(externalDirectory, join(root, "runtime-link"));

    const before = runManifest(root);
    writeFileSync(database, "private-db-v2\n");
    writeFileSync(join(externalDirectory, "secret.txt"), "private-secret-v2\n");
    const after = runManifest(root);

    assert.equal(after.artifactHash, before.artifactHash);
    assert.equal(after.distHashes["packages/server/dist"], before.distHashes["packages/server/dist"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("artifact hashes exclude mutable runtime state and remain stable across metadata writes", () => {
  const root = fixture();
  try {
    const serverDist = join(root, "packages/server/dist");
    writeFileSync(join(root, ".env"), "TOKEN=first\n");
    writeFileSync(join(serverDist, ".env"), "TOKEN=first\n");
    writeFileSync(join(serverDist, "db/runtime.db"), "db-first\n");
    writeFileSync(join(serverDist, "db/runtime.db-wal"), "wal-first\n");
    writeFileSync(join(serverDist, "runtime.log"), "log-first\n");

    const before = runManifest(root, { write: true });
    writeFileSync(join(root, ".env"), "TOKEN=second\n");
    writeFileSync(join(serverDist, ".env"), "TOKEN=second\n");
    writeFileSync(join(serverDist, "db/runtime.db"), "db-second\n");
    writeFileSync(join(serverDist, "db/runtime.db-wal"), "wal-second\n");
    writeFileSync(join(serverDist, "runtime.log"), "log-second\n");
    const after = runManifest(root, { write: true });

    assert.equal(after.artifactHash, before.artifactHash);
    assert.equal(after.distHashes["packages/server/dist"], before.distHashes["packages/server/dist"]);

    writeFileSync(join(root, "app.txt"), "immutable-app-changed\n");
    const changed = runManifest(root);
    assert.notEqual(changed.artifactHash, before.artifactHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact hash includes nested shipped files named VERSION", () => {
  const root = fixture();
  try {
    const shippedVersion = join(root, "packages/server/skills/entity-mc/VERSION");
    mkdirSync(dirname(shippedVersion), { recursive: true });
    writeFileSync(shippedVersion, "1.0.0\n");
    const before = runManifest(root);
    writeFileSync(shippedVersion, "1.0.1\n");
    const after = runManifest(root);
    assert.notEqual(after.artifactHash, before.artifactHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deploy preflights an explicit remote Node binary before synchronization", () => {
  const root = mkdtempSync(join(tmpdir(), "entity-deploy-source-"));
  const fakeBin = mkdtempSync(join(tmpdir(), "entity-deploy-bin-"));
  const rsyncMarker = join(root, "rsync-called");
  try {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "deploy-preflight-fixture",
      scripts: { "docs:wiki:verify": "node -e \"process.exit(0)\"" },
    }));
    writeFileSync(join(root, "tracked.txt"), "fixture\n");
    for (const args of [
      ["init", "-b", "main"],
      ["config", "user.email", "test@example.com"],
      ["config", "user.name", "Entity Test"],
      ["add", "."],
      ["commit", "-m", "fixture"],
    ]) {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();

    const ssh = join(fakeBin, "ssh");
    writeFileSync(ssh, `#!/bin/sh\ncase "$*" in\n  *"--version"*) exit 127 ;;\n  *"select count"*) printf '49\\n'; exit 0 ;;\n  *"realpath"*) printf 'NOT_A_SYMLINK\\n'; exit 0 ;;\n  *) exit 0 ;;\nesac\n`);
    chmodSync(ssh, 0o755);
    const rsync = join(fakeBin, "rsync");
    writeFileSync(rsync, `#!/bin/sh\nprintf 'called\\n' > "${rsyncMarker}"\nexit 0\n`);
    chmodSync(rsync, 0o755);

    const result = spawnSync("bash", [deployScript, "--all"], {
      cwd: dirname(deployScript),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
        ENTITY_SOURCE_DIR: root,
        ENTITY_PROD_HOST: "test-host",
        ENTITY_PROD_HTTP_HOST: "test-host",
        ENTITY_PROD_DIR: "/tmp/entity-release",
        ENTITY_PROD_DB: "/tmp/entity.db",
        ENTITY_RELEASE_SHA: commit,
        ENTITY_RELEASE_BRANCH: "main",
        ENTITY_REMOTE_NODE_BIN: "/definitely/missing/node",
        ENTITY_SKIP_MAC_BUILD: "1",
        ENTITY_DEPLOY_SKIP_RESTART: "1",
        ENTITY_DEPLOY_MIN_TASKS: "1",
      },
    });

    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0);
    assert.match(output, /Remote Node\.js preflight failed/);
    assert.doesNotMatch(output, /Syncing built files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("deploy writes release metadata after runtime environment files are installed", () => {
  const source = readFileSync(deployScript, "utf8");
  const runtimeEnvironmentInstalled = source.indexOf('rsync -az -e "ssh ${SSH_OPTS[*]}" "${RUNTIME_ENV_TMP}" "${PROD_HOST}:${ENTITY_DIR}/packages/server/dist/.env"');
  const metadataWritten = source.indexOf('log "Writing release identity metadata');
  const restartBoundary = source.indexOf('if [[ "$SKIP_RESTART" == "1" ]]');

  assert.notEqual(runtimeEnvironmentInstalled, -1);
  assert.notEqual(metadataWritten, -1);
  assert.ok(metadataWritten > runtimeEnvironmentInstalled);
  assert.ok(metadataWritten < restartBoundary);
});

test("deploy removes the temporary runtime environment file on early failure", () => {
  const source = readFileSync(deployScript, "utf8");
  const temporaryFileCreated = source.indexOf("RUNTIME_ENV_TMP=$(mktemp)");
  const cleanupTrapInstalled = source.indexOf("trap cleanup_runtime_env EXIT");
  const firstEnvironmentCopy = source.indexOf('rsync -az -e "ssh ${SSH_OPTS[*]}" "${RUNTIME_ENV_TMP}"');

  assert.notEqual(temporaryFileCreated, -1);
  assert.ok(cleanupTrapInstalled > temporaryFileCreated);
  assert.ok(cleanupTrapInstalled < firstEnvironmentCopy);
  assert.match(source, /cleanup_runtime_env\(\) \{[\s\S]*rm -f "\$\{RUNTIME_ENV_TMP\}"[\s\S]*\}/);
});
