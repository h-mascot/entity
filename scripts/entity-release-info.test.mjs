import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import { serializeRuntimeEnv } from "./entity-runtime-env.mjs";

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
    const externalFile = join(external, "runtime-file.txt");
    const externalDirectory = join(external, "runtime");
    mkdirSync(externalDirectory);
    writeFileSync(database, "private-db-v1\n");
    writeFileSync(externalFile, "private-file-v1\n");
    writeFileSync(join(externalDirectory, "secret.txt"), "private-secret-v1\n");
    symlinkSync(database, join(root, "packages/server/dist/db/entity-tasks.db"));
    symlinkSync(externalFile, join(root, "runtime-file-link"));
    symlinkSync(externalDirectory, join(root, "runtime-link"));

    const before = runManifest(root);
    writeFileSync(database, "private-db-v2\n");
    writeFileSync(externalFile, "private-file-v2\n");
    writeFileSync(join(externalDirectory, "secret.txt"), "private-secret-v2\n");
    const after = runManifest(root);

    assert.equal(after.artifactHash, before.artifactHash);
    assert.equal(after.distHashes["packages/server/dist"], before.distHashes["packages/server/dist"]);

    const alternateFile = join(external, "runtime-file-alternate.txt");
    writeFileSync(alternateFile, "private-file-v2\n");
    rmSync(join(root, "runtime-file-link"));
    symlinkSync(alternateFile, join(root, "runtime-file-link"));
    const retargeted = runManifest(root);
    assert.notEqual(retargeted.artifactHash, after.artifactHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("package lock hash does not follow a symlink target", () => {
  const root = fixture();
  const external = mkdtempSync(join(tmpdir(), "entity-release-lock-external-"));
  try {
    const externalLock = join(external, "package-lock.json");
    writeFileSync(externalLock, '{"lockfileVersion":3,"value":"first"}\n');
    symlinkSync(externalLock, join(root, "package-lock.json"));

    const before = runManifest(root);
    writeFileSync(externalLock, '{"lockfileVersion":3,"value":"second"}\n');
    const after = runManifest(root);

    assert.equal(after.packageLockHash, before.packageLockHash);

    const alternateLock = join(external, "alternate-package-lock.json");
    writeFileSync(alternateLock, '{"lockfileVersion":3,"value":"second"}\n');
    rmSync(join(root, "package-lock.json"));
    symlinkSync(alternateLock, join(root, "package-lock.json"));
    const retargeted = runManifest(root);
    assert.notEqual(retargeted.packageLockHash, after.packageLockHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
  }
});

test("dist hash does not follow a symlinked dist root", () => {
  const root = fixture();
  const external = mkdtempSync(join(tmpdir(), "entity-release-dist-external-"));
  const alternate = mkdtempSync(join(tmpdir(), "entity-release-dist-alternate-"));
  try {
    const distRoot = join(root, "packages/server/dist");
    rmSync(distRoot, { recursive: true, force: true });
    writeFileSync(join(external, "server.js"), "external-first\n");
    symlinkSync(external, distRoot);

    const before = runManifest(root);
    writeFileSync(join(external, "server.js"), "external-second\n");
    const after = runManifest(root);

    assert.equal(after.distHashes["packages/server/dist"], before.distHashes["packages/server/dist"]);

    writeFileSync(join(alternate, "server.js"), "external-second\n");
    rmSync(distRoot);
    symlinkSync(alternate, distRoot);
    const retargeted = runManifest(root);
    assert.notEqual(retargeted.distHashes["packages/server/dist"], after.distHashes["packages/server/dist"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(external, { recursive: true, force: true });
    rmSync(alternate, { recursive: true, force: true });
  }
});

test("artifact and dist hashes domain-separate regular files from symlinks", () => {
  const root = fixture();
  try {
    const target = "/external/runtime-target";
    const rootEntry = join(root, "kind-entry");
    const distEntry = join(root, "packages/server/dist/kind-entry");
    symlinkSync(target, rootEntry);
    symlinkSync(target, distEntry);

    const before = runManifest(root);
    rmSync(rootEntry);
    rmSync(distEntry);
    writeFileSync(rootEntry, `symlink:${target}`);
    writeFileSync(distEntry, `symlink:${target}`);
    const after = runManifest(root);

    assert.notEqual(after.artifactHash, before.artifactHash);
    assert.notEqual(after.distHashes["packages/server/dist"], before.distHashes["packages/server/dist"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
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

test("each dist hash changes when its immutable contents change", () => {
  const root = fixture();
  try {
    const distFiles = {
      "packages/app/dist": join(root, "packages/app/dist/app.js"),
      "packages/server/dist": join(root, "packages/server/dist/server.js"),
      "packages/db/dist": join(root, "packages/db/dist/db.js"),
    };
    for (const file of Object.values(distFiles)) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "first\n");
    }
    let before = runManifest(root);
    for (const [distName, file] of Object.entries(distFiles)) {
      writeFileSync(file, `changed-${distName}\n`);
      const after = runManifest(root);
      assert.notEqual(after.artifactHash, before.artifactHash);
      assert.notEqual(after.distHashes[distName], before.distHashes[distName]);
      before = after;
    }
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
        ENTITY_PROD_CONFIG_PATH: "/tmp/entity-release/entity.config.yaml",
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

test("runtime environment serialization round-trips through dotenv", () => {
  const env = {
    EDGE_TTS_COMMAND: "apostrophe' quote\" back\\slash #hash $dollar",
    KOKORO_TTS_DEFAULT_VOICE: "unicode-é and spaces",
    OPENAI_TTS_MODEL: "line1\nline2",
    OPENAI_TTS_VOICE: "literal\\nsequence",
    EDGE_TTS_VOICE: "trailing-backslash\\",
  };
  const serialized = serializeRuntimeEnv({
    runtimeBaseUrl: "http://sandbox.entity:3007",
    env,
  });
  const parsed = dotenv.parse(serialized);

  assert.equal(parsed.ENTITY_BASE_URL, "http://sandbox.entity:3007");
  for (const [key, value] of Object.entries(env)) assert.equal(parsed[key], value);
});

test("explicit deploy lane origin overrides an ambient Entity base URL", () => {
  const parsed = dotenv.parse(serializeRuntimeEnv({
    runtimeBaseUrl: "http://sandbox.entity:3007",
    env: { ENTITY_BASE_URL: "https://stale.example" },
  }));

  assert.equal(parsed.ENTITY_BASE_URL, "http://sandbox.entity:3007");
});

test("runtime environment serialization rejects a non-origin base URL", () => {
  assert.throws(
    () => serializeRuntimeEnv({ runtimeBaseUrl: "http://sandbox.entity/path", env: {} }),
    /canonical http\(s\) origin/,
  );
});

test("deploy persists the trusted lane base URL into the runtime environment", () => {
  const source = readFileSync(deployScript, "utf8");

  assert.match(source, /node "\$\{SCRIPT_DIR\}\/scripts\/entity-runtime-env\.mjs" "\$\{RUNTIME_ENV_TMP\}" "\$\{PROD_BASE_URL\}"/);
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

// T-038 exact-SHA release proof (R-039): the reviewed candidate SHA must be the
// SHA CI evaluates and the deployed sandbox reports; any mismatch fails closed.
// `entity-release-info.mjs --check --expected <sha>` is the shared primitive used
// by CI and the sandbox-deploy path to prove the deployed receipt identity equals
// the reviewed candidate SHA and that no source/build drift slipped in.

// Helper: build a git worktree fixture whose committed HEAD is a real SHA and
// whose RELEASE.json is written for a caller-chosen recorded SHA.
function gitReleaseFixture(recordedSha) {
  const root = mkdtempSync(join(tmpdir(), "entity-exactsha-" + (recordedSha || "").slice(0, 6) + "-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "exactsha-fixture",
    scripts: { "docs:wiki:verify": "node -e \"process.exit(0)\"" },
  }));
  writeFileSync(join(root, "tracked.txt"), "immutable\n");
  writeFileSync(join(root, "VERSION"), recordedSha ? `${recordedSha}\n` : "");
  writeFileSync(join(root, "RELEASE.json"), JSON.stringify({ schemaVersion: 1, gitSha: recordedSha }, null, 2));
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
  return root;
}

function headSha(root) {
  return spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim();
}

function runCheck(root, { expected } = {}) {
  const args = [script, "--check", "--root", root];
  if (expected) args.push("--expected", expected);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

test("exact-SHA check passes when deployed receipt SHA, VERSION, and source HEAD all equal the reviewed candidate SHA", () => {
  const root = gitReleaseFixture();
  try {
    const candidate = headSha(root);
    writeFileSync(join(root, "RELEASE.json"), JSON.stringify({ schemaVersion: 1, gitSha: candidate }, null, 2));
    writeFileSync(join(root, "VERSION"), `${candidate}\n`);
    const result = runCheck(root, { expected: candidate });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.gitSha, candidate);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exact-SHA check fails closed when deployed SHA does not match the reviewed candidate SHA", () => {
  const reviewed = "4".repeat(40);
  const deployed = "5".repeat(40);
  const root = gitReleaseFixture(deployed);
  try {
    writeFileSync(join(root, "RELEASE.json"), JSON.stringify({ schemaVersion: 1, gitSha: deployed }, null, 2));
    writeFileSync(join(root, "VERSION"), `${deployed}\n`);
    const result = runCheck(root, { expected: reviewed });
    assert.notEqual(result.status, 0);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /EXACT_SHA_MISMATCH/);
    assert.match(output, new RegExp(reviewed));
    assert.match(output, new RegExp(deployed));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exact-SHA check fails closed when the deployed RELEASE.json and VERSION disagree", () => {
  const root = gitReleaseFixture();
  try {
    const shaA = "a".repeat(40);
    const shaB = "b".repeat(40);
    writeFileSync(join(root, "RELEASE.json"), JSON.stringify({ schemaVersion: 1, gitSha: shaA }, null, 2));
    writeFileSync(join(root, "VERSION"), `${shaB}\n`);
    const result = runCheck(root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /EXACT_SHA_MISMATCH/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("exact-SHA check fails closed when the source checkout has drifted from the deployed/gitSha identity", () => {
  const root = gitReleaseFixture();
  try {
    const deployed = headSha(root);
    const drifted = "c".repeat(40);
    writeFileSync(join(root, "RELEASE.json"), JSON.stringify({ schemaVersion: 1, gitSha: drifted }, null, 2));
    writeFileSync(join(root, "VERSION"), `${drifted}\n`);
    const result = runCheck(root);
    assert.notEqual(result.status, 0);
    const output = `${result.stdout}\n${result.stderr}`;
    assert.match(output, /SOURCE_DRIFT/);
    assert.match(output, new RegExp(deployed));
    assert.match(output, new RegExp(drifted));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deploy-sandbox invokes the exact-SHA release check and must never target production", () => {
  const source = readFileSync(deployScript, "utf8");
  const scriptSource = readFileSync(join(scriptsDirectory, "entity-deploy-sandbox.sh"), "utf8");
  // The sandbox deploy must route identity through the shared release-info exact-SHA check.
  assert.match(scriptSource, /release-info\.mjs[^\n]*--check/);
  assert.match(scriptSource, /--expected/);
  // It must resolve and export the exact candidate SHA for the deploy lane.
  assert.match(scriptSource, /ENTITY_RELEASE_SHA/);
  // The sandbox lane stays sandbox-gated and never routes through a prod lane.
  assert.match(scriptSource, /ENTITY_SANDBOX_/);
  assert.doesNotMatch(scriptSource, /promote:prod/);
});

// T-038 blocker 2: the deployment path must self-contain the native managed-storage
// broker — compile/test it and install the executable to the deployed runtime path
// before restart — so a sandbox/gateway never crash-loops on a missing broker.

test("deploy self-contains the native managed-storage broker build and runtime install (T-038 blocker 2)", () => {
  const deploySource = readFileSync(deployScript, "utf8");
  const buildSource = readFileSync(join(scriptsDirectory, "build-managed-storage-broker.mjs"), "utf8");
  // deploy.sh must invoke the native broker build during the server build, before
  // the built files are synced, so a broken broker lane fails closed pre-sync.
  assert.match(deploySource, /build-managed-storage-broker\.mjs/);
  const buildInvoked = deploySource.indexOf("build-managed-storage-broker.mjs");
  const serverBuild = deploySource.indexOf("npm --prefix packages/server run build");
  const syncBegins = deploySource.indexOf("Syncing built files to configured target");
  assert.ok(serverBuild !== -1 && buildInvoked > serverBuild, "broker build must run after the server TS build");
  assert.ok(buildInvoked < syncBegins, "broker build must complete before the server-dist sync");
  // The build/install tool must place the executable at the deployed runtime path
  // the compiled server resolves (dist/server/native/.../.build/broker).
  assert.match(buildSource, /packages\/server\/dist\/server\/native\/managed-storage-broker\/\.build\/broker/);
  assert.match(buildSource, /copyFileSync/);
});

test("native managed-storage broker build installs an executable at the deployed runtime path (T-038 blocker 2)", () => {
  const buildScript = join(scriptsDirectory, "build-managed-storage-broker.mjs");
  const result = spawnSync(process.execPath, [buildScript], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(`${result.stdout}\n${result.stderr}`, /compile and direct tests passed/);
  const runtimeBroker = join(scriptsDirectory, "..", "packages/server/dist/server/native/managed-storage-broker/.build/broker");
  assert.equal(existsSync(runtimeBroker), true, "deployed runtime broker executable must be installed");
  // Fail-closed: the installed artifact must be an executable file, not an empty/absent stub.
  assert.ok(lstatSync(runtimeBroker).isFile(), "installed broker must be a regular file");
  assert.notEqual(lstatSync(runtimeBroker).size, 0, "installed broker must not be empty");
  assert.notEqual(lstatSync(runtimeBroker).mode & 0o111, 0, "installed broker must be executable");
});

// T-038 blocker 2 (post-restart readiness contract): the sandbox deploy installed
// and ran the broker and eventually preserved all 49 tasks at the exact SHA, but
// deploy.sh accepted the first NUMERIC /api/tasks response (0) while the configured
// 49-task DB was still hydrating, then aborted with a false "TASK COUNT DROPPED".
// Readiness must keep polling until the count is numeric AND at least the preflight
// TASK_COUNT, and still fail closed on a persistent drop/crash/timeout. The contract
// lives in scripts/entity-readiness-poll.sh; these tests exercise it deterministically
// with a faked curl (no SSH/server required).

const readinessPollScript = join(scriptsDirectory, "entity-readiness-poll.sh");

// Install a faked curl that returns one line from seqFile per call (via countFile),
// plus a no-op sleep, into bin/ so the poll can be driven without any network or
// real delay.
function installReadinessFakes(bin, seqFile, countFile) {
  mkdirSync(bin, { recursive: true });
  const { curl, sleep } = { curl: join(bin, "curl"), sleep: join(bin, "sleep") };
  writeFileSync(curl, [
    "#!/usr/bin/env bash",
    `seq_file="${seqFile}"`,
    `count_file="${countFile}"`,
    'i="$(cat "$count_file" 2>/dev/null || echo 0)"',
    'line="$(sed -n "$((i + 1))p" "$seq_file")"',
    'printf "%s" "$line"',
    'printf "%s" "$((i + 1))" > "$count_file"',
  ].join("\n") + "\n");
  chmodSync(curl, 0o755);
  writeFileSync(sleep, "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(sleep, 0o755);
  return { curl, sleep };
}

function runReadinessPoll({ seq = [], expected, attempts = 3 }) {
  const root = mkdtempSync(join(tmpdir(), "entity-ready-poll-"));
  try {
    const bin = join(root, "bin");
    const seqFile = join(root, "seq.txt");
    const countFile = join(root, "count.txt");
    writeFileSync(seqFile, seq.join("\n") + (seq.length ? "\n" : ""));
    installReadinessFakes(bin, seqFile, countFile);
    return spawnSync("bash", [readinessPollScript, "http://ready.test:3000", String(expected)], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ENTITY_DEPLOY_READY_ATTEMPTS: String(attempts),
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("readiness waits for hydration instead of aborting on a numeric zero-task response (T-038 blocker 2)", () => {
  // The 49-task DB is still hydrating: two 0-total responses then the real 49.
  // deploy.sh must NOT accept the first numeric 0 as ready; it must continue until
  // numeric AND >= preflight, and succeed once hydration completes.
  const result = runReadinessPoll({ seq: ['{"total": 0}', '{"total": 0}', '{"total": 49}'], expected: 49, attempts: 3 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.trim(), "49");
});

test("readiness fails closed when the count never reaches the preflight task count", () => {
  // A persistent sub-preflight count (a real drop) must fail closed, not falsely pass.
  const result = runReadinessPoll({ seq: ['{"total": 10}', '{"total": 10}', '{"total": 10}'], expected: 49, attempts: 3 });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /never reported >= 49 tasks/);
});

test("readiness fails closed when the API never returns a numeric task count (crash)", () => {
  // A crash-loop / non-numeric API must fail closed (never-ready), not be mistaken
  // for a zero-task or dropped-count state.
  const result = runReadinessPoll({ seq: ["not-json", "not-json", "not-json"], expected: 49, attempts: 3 });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /never became ready with a numeric task count/);
});

test("deploy readiness polls until numeric AND at least preflight TASK_COUNT (T-038 blocker 2 regression)", () => {
  const source = readFileSync(deployScript, "utf8");
  // deploy.sh must route readiness through the shared poll, passing the preflight
  // TASK_COUNT as the required floor (numeric alone is not readiness).
  assert.match(source, /scripts\/entity-readiness-poll\.sh"\s+"\$\{PROD_BASE_URL\}" "\$\{TASK_COUNT\}"/);
  // And it must not re-introduce the false first-numeric "TASK COUNT DROPPED" abort.
  assert.doesNotMatch(source, /TASK COUNT DROPPED/);
});
