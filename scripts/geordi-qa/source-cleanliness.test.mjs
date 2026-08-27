import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { verifySourceCleanliness } from "./source-cleanliness.mjs";

const execFile = promisify(execFileCallback);

async function makeRepo(t, { commit = true } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "geordi-clean-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await execFile("git", ["init", "-q"], { cwd: dir });
  await execFile("git", ["config", "user.email", "qa@example.invalid"], { cwd: dir });
  await execFile("git", ["config", "user.name", "Geordi QA"], { cwd: dir });
  if (commit) {
    await writeFile(path.join(dir, "file.txt"), "deterministic\n");
    await execFile("git", ["add", "."], { cwd: dir });
    await execFile("git", ["commit", "-qm", "init"], { cwd: dir });
  }
  return dir;
}

test("clean repo verifies ok with sha, from the source cwd", async (t) => {
  const repo = await makeRepo(t);
  const result = await verifySourceCleanliness({ sourcePath: repo });
  const canonical = await realpath(repo);
  assert.equal(result.ok, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.violations, []);
  assert.match(result.sha, /^[0-9a-f]{40}$/);
  assert.equal(result.checkedFromCwd, canonical);
  assert.equal(result.top, canonical);
});

test("dirty repo reports verbatim violations and ok=false", async (t) => {
  const repo = await makeRepo(t);
  await writeFile(path.join(repo, "untracked.txt"), "dirt\n");
  const result = await verifySourceCleanliness({ sourcePath: repo });
  assert.equal(result.ok, false);
  assert.equal(result.clean, false);
  assert.ok(
    result.violations.some((line) => line.endsWith("untracked.txt")),
    "violation lists the untracked file verbatim",
  );
});

test("every git invocation executes with cwd exactly the resolved source path", async (t) => {
  const repo = await makeRepo(t);
  const cwdCalls = [];
  const recordingExec = async (file, args, options) => {
    cwdCalls.push(options?.cwd);
    return { stdout: await realStdout(file, args, options) };
  };
  const real = promisify(execFileCallback);
  async function realStdout(file, args, options) {
    return (await real(file, args, options)).stdout;
  }
  await verifySourceCleanliness({ sourcePath: repo, exec: recordingExec });
  assert.ok(cwdCalls.length >= 3, "sha, toplevel and status must each be checked");
  for (const cwd of cwdCalls) {
    const canonical = await realpath(repo);
    assert.equal(cwd, canonical, "git must run with cwd = resolved source path");
  }
});

test("refuses a path that is not the worktree root", async (t) => {
  const repo = await makeRepo(t);
  const nested = path.join(repo, "nested");
  await mkdir(nested);
  await assert.rejects(
    () => verifySourceCleanliness({ sourcePath: nested }),
    /worktree root/i,
  );
});

test("non-repo path fails with a typed error", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "geordi-norepo-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(() => verifySourceCleanliness({ sourcePath: dir }), /git/);
});

// Live proof that this exact worktree verifies clean from its own cwd is a
// post-commit receipt (gqr006-source-cleanliness-live.log): as a unit test it
// would race with the very commit that lands this file.
