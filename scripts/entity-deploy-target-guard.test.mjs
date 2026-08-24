import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { decideDeployTarget } from "./entity-deploy-target-guard.mjs";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const guardScript = join(scriptsDirectory, "entity-deploy-target-guard.mjs");
const deployScript = join(scriptsDirectory, "..", "deploy.sh");
const sandboxDeployScript = join(scriptsDirectory, "entity-deploy-sandbox.sh");

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

function probe(overrides = {}) {
  return {
    configured: `/srv/entity-sandbox/releases/${shaA}`,
    abspath: `/srv/entity-sandbox/releases/${shaA}`,
    realpath: `/srv/entity-sandbox/releases/${shaA}`,
    basename: shaA,
    exists: true,
    releasePresent: false,
    releaseGitSha: null,
    version: "",
    ...overrides,
  };
}

test("decision: fresh non-existent exact-SHA target is safe", () => {
  const result = decideDeployTarget(probe({ exists: false }), shaA);
  assert.deepEqual(result, { ok: true, reason: "FRESH_TARGET" });
});

test("decision: destination that resolves through a symlink (the historical `current` profile) is rejected", () => {
  const result = decideDeployTarget(
    probe({
      configured: "/srv/entity-sandbox/current",
      abspath: "/srv/entity-sandbox/current",
      realpath: `/srv/entity-sandbox/releases/${shaB}`,
      basename: shaB,
      releasePresent: true,
      releaseGitSha: shaB,
      version: shaB,
    }),
    shaA,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "SYMLINK_TARGET");
  assert.match(result.message, /current/);
});

test("decision: existing directory carrying a mismatched RELEASE.json identity is rejected", () => {
  const result = decideDeployTarget(probe({ releasePresent: true, releaseGitSha: shaB }), shaA);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "IDENTITY_COLLISION");
});

test("decision: existing directory carrying a mismatched VERSION identity is rejected", () => {
  const result = decideDeployTarget(probe({ version: shaB }), shaA);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "IDENTITY_COLLISION");
});

test("decision: SHA-named directory whose basename contradicts the release SHA is rejected", () => {
  const result = decideDeployTarget(probe({ basename: shaB }), shaA);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "BASENAME_COLLISION");
});

test("decision: present but unreadable RELEASE.json fails closed", () => {
  const result = decideDeployTarget(probe({ releasePresent: true, releaseGitSha: null }), shaA);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "RELEASE_UNREADABLE");
});

test("decision: same-SHA redeploy of an existing release is allowed", () => {
  const result = decideDeployTarget(probe({ releasePresent: true, releaseGitSha: shaA, version: shaA }), shaA);
  assert.deepEqual(result, { ok: true, reason: "SAME_SHA_REDEPLOY" });
});

test("decision: existing metadata-less directory (deploy resume) is allowed", () => {
  const result = decideDeployTarget(probe(), shaA);
  assert.deepEqual(result, { ok: true, reason: "NO_METADATA_RESUME" });
});

test("decision: trailing-slash destinations do not false-positive as symlinks", () => {
  const configured = `/srv/entity-sandbox/releases/${shaA}/`;
  const result = decideDeployTarget(
    probe({
      configured,
      abspath: `/srv/entity-sandbox/releases/${shaA}/`,
      realpath: `/srv/entity-sandbox/releases/${shaA}`,
    }),
    shaA,
  );
  assert.equal(result.ok, true);
});

test("decision: invalid expected SHA fails closed", () => {
  const result = decideDeployTarget(probe(), "not-a-sha");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "INVALID_EXPECTED_SHA");
});

test("cli: reads probe JSON on stdin and exits non-zero with the reason on violations", () => {
  const violation = probe({
    configured: "/srv/entity-sandbox/current",
    abspath: "/srv/entity-sandbox/current",
    realpath: `/srv/entity-sandbox/releases/${shaB}`,
    basename: shaB,
  });
  const result = spawnSync(
    process.execPath,
    [guardScript, "--expected-sha", shaA, "--configured", "/srv/entity-sandbox/current"],
    { input: JSON.stringify(violation), encoding: "utf8" },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /SYMLINK_TARGET/);
});

test("cli: safe target exits zero and reports why", () => {
  const result = spawnSync(
    process.execPath,
    [guardScript, "--expected-sha", shaA, "--configured", `/srv/entity-sandbox/releases/${shaA}`],
    { input: JSON.stringify(probe({ exists: false })), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FRESH_TARGET/);
});

test("cli: probe for a different configured path fails closed", () => {
  const result = spawnSync(
    process.execPath,
    [guardScript, "--expected-sha", shaA, "--configured", "/srv/other"],
    { input: JSON.stringify(probe()), encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CONFIG_MISMATCH/);
});

// ---------------------------------------------------------------------------
// End-to-end regression: deploy.sh itself must refuse to deploy through the
// `current` symlink or into a mismatched-SHA release directory (the exact
// historical mutation path that produced mutated sandbox releases), and must
// let a fresh exact-SHA release directory through.
// ---------------------------------------------------------------------------

function makeStubSourceRepo() {
  const dir = mkdtempSync(join(tmpdir(), "entity-deploy-guard-src-"));
  mkdirSync(join(dir, "packages/server/dist"), { recursive: true });
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({
    name: "entity-deploy-guard-stub",
    private: true,
    scripts: { "docs:wiki:verify": "exit 0" },
  }, null, 2)}\n`);
  writeFileSync(join(dir, "packages/server/dist/placeholder.txt"), "dist\n");
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "recovery@example.invalid"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "recovery"], { cwd: dir });
  spawnSync("git", ["add", "-A"], { cwd: dir });
  spawnSync("git", ["commit", "-q", "-m", "stub"], { cwd: dir });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
  return { dir, head };
}

function runDeploy({ sourceDir, sourceSha, scenario, env = {} }) {
  const logDir = mkdtempSync(join(tmpdir(), "entity-deploy-guard-run-"));
  const scenarioFile = join(logDir, "scenario.json");
  writeFileSync(scenarioFile, `${JSON.stringify(scenario, null, 2)}\n`);
  const binDir = join(logDir, "bin");
  mkdirSync(binDir);
  const fakeSsh = join(binDir, "ssh");
  writeFileSync(
    fakeSsh,
    [
      "#!/usr/bin/env bash",
      "set -u",
      `printf '%s\\n' "$*" >> "${join(logDir, "ssh.log")}"`,
      `if printf '%s' "$*" | grep -q -- "python3 - "; then`,
      `  exec python3 "${join(logDir, "emit-probe.py")}"`,
      "fi",
      'case "$*" in',
      '  *"command -v node"*) echo "/opt/homebrew/bin/node"; exit 0 ;;',
      '  *"--version"*) echo "v22.9.0"; exit 0 ;;',
      '  *"select count(*) from tasks"*)',
      `    python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["dbCount"])' "${scenarioFile}"`,
      "    exit $? ;;",
      "  *) exit 0 ;;",
      "esac",
    ].join("\n") + "\n",
  );
  chmodSync(fakeSsh, 0o755);
  writeFileSync(
    join(logDir, "emit-probe.py"),
    `import json\nprint(json.dumps(json.load(open(${JSON.stringify(scenarioFile)}))["guardProbe"]))\n`,
  );

  const result = spawnSync(
    "bash",
    [deployScript, "--server-only"],
    {
      encoding: "utf8",
      cwd: scriptsDirectory,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        ENTITY_PROD_HOST: "fake-host.invalid",
        ENTITY_PROD_HTTP_HOST: "fake-host.invalid",
        ENTITY_PROD_PORT: "3999",
        ENTITY_PROD_DIR: scenario.targetDir,
        ENTITY_PROD_DB: "/srv/entity-data/entity-tasks.db",
        ENTITY_SOURCE_DIR: sourceDir,
        ENTITY_RELEASE_SHA: sourceSha,
        ENTITY_RELEASE_BRANCH: "main",
        ENTITY_RELEASE_ENVIRONMENT: "sandbox",
        ENTITY_SKIP_MAC_BUILD: "1",
        ENTITY_DEPLOY_DRY_RUN: "0",
        ENTITY_DEPLOY_MIN_TASKS: "10",
        ENTITY_DEPLOY_READY_ATTEMPTS: "1",
        ...env,
      },
      timeout: 120_000,
    },
  );
  const sshLog = (() => {
    try {
      return readFileSync(join(logDir, "ssh.log"), "utf8");
    } catch {
      return "";
    }
  })();
  return { result, sshLog, logDir };
}

test("deploy.sh: refuses a destination that resolves through the `current` symlink before any sync or DB preflight", () => {
  const { dir, head } = makeStubSourceRepo();
  const targetDir = "/srv/entity-sandbox/current";
  const scenario = {
    targetDir,
    dbCount: "50",
    guardProbe: {
      configured: targetDir,
      abspath: targetDir,
      realpath: `/srv/entity-sandbox/releases/${shaB}`,
      basename: shaB,
      exists: true,
      releasePresent: true,
      releaseGitSha: shaB,
      version: shaB,
    },
  };
  const { result, sshLog } = runDeploy({ sourceDir: dir, sourceSha: head, scenario });
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(result.status, 0, `deploy through current must fail:\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /SYMLINK_TARGET/);
  // The refusal must happen before the DB preflight probe — fail fast, before
  // any mutation-capable step.
  assert.doesNotMatch(sshLog, /select count\(\*\) from tasks/);
});

test("deploy.sh: refuses an existing release directory whose RELEASE.json identity contradicts the candidate SHA", () => {
  const { dir, head } = makeStubSourceRepo();
  const targetDir = "/srv/entity-sandbox/releases/legacy-pin";
  const scenario = {
    targetDir,
    dbCount: "50",
    guardProbe: {
      configured: targetDir,
      abspath: targetDir,
      realpath: targetDir,
      basename: "legacy-pin",
      exists: true,
      releasePresent: true,
      releaseGitSha: shaB,
      version: shaB,
    },
  };
  const { result, sshLog } = runDeploy({ sourceDir: dir, sourceSha: head, scenario });
  rmSync(dir, { recursive: true, force: true });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /IDENTITY_COLLISION/);
  assert.doesNotMatch(sshLog, /select count\(\*\) from tasks/);
});

test("deploy.sh: allows a fresh exact-SHA release directory and proceeds past the destination guard", () => {
  const { dir, head } = makeStubSourceRepo();
  const targetDir = `/srv/entity-sandbox/releases/${head}`;
  const scenario = {
    targetDir,
    dbCount: "0",
    guardProbe: {
      configured: targetDir,
      abspath: targetDir,
      realpath: targetDir,
      basename: head,
      exists: false,
      releasePresent: false,
      releaseGitSha: null,
      version: "",
    },
  };
  const { result, sshLog } = runDeploy({ sourceDir: dir, sourceSha: head, scenario });
  rmSync(dir, { recursive: true, force: true });
  // The guard must have passed: the deploy advanced all the way to the DB
  // preflight (which then intentionally aborts on dbCount=0 < min 10).
  assert.match(sshLog, /select count\(\*\) from tasks/);
  assert.doesNotMatch(result.stderr, /SYMLINK_TARGET|IDENTITY_COLLISION|BASENAME_COLLISION/);
  assert.match(result.stderr, /only 0 tasks/);
});

test("entity-deploy-sandbox.sh: refuses the unsafe `current` symlink profile before doing any work", () => {
  for (const unsafe of ["current", "previous"]) {
    const result = spawnSync("bash", [sandboxDeployScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        ENTITY_SANDBOX_HOST: "fake-host.invalid",
        ENTITY_SANDBOX_HTTP_HOST: "fake-host.invalid",
        ENTITY_SANDBOX_DB: "/srv/entity-data/entity-tasks.db",
        ENTITY_SANDBOX_DIR: `/srv/entity-sandbox/${unsafe}`,
      },
      timeout: 30_000,
    });
    assert.notEqual(result.status, 0, `${unsafe} profile must be refused:\n${result.stdout}`);
    assert.match(result.stderr, new RegExp(unsafe));
    assert.match(result.stderr, /symlink/i);
  }
});
