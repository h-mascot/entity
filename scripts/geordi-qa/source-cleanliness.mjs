// Geordi QA source-cleanliness verification (GQR-006).
//
// Verifies the QA target checkout is clean *from the source cwd*: every git
// invocation runs with cwd resolved to the source path, and the check refuses
// to grade a path that is not its own worktree root. Running from the source
// cwd makes conditional includes, sparse-checkout config, and cwd-sensitive
// excludes resolve exactly as they do for a developer inside the checkout,
// which `git -C` from a foreign cwd does not guarantee.
import { execFile as execFileCallback } from "node:child_process";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const defaultExec = async (file, args, options) => execFile(file, args, options);

export async function verifySourceCleanliness({ sourcePath, exec = defaultExec } = {}) {
  if (typeof sourcePath !== "string" || sourcePath.length === 0) {
    throw new Error("sourcePath is required");
  }
  const resolved = await realpath(sourcePath);

  const runGit = async (args) => {
    const { stdout } = await exec("git", args, { cwd: resolved, encoding: "utf8" });
    return stdout.trim();
  };

  let top;
  try {
    top = await runGit(["rev-parse", "--show-toplevel"]);
  } catch (error) {
    throw new Error(`git failed for ${resolved}: ${error.message}`);
  }
  if (path.resolve(top) !== resolved) {
    throw new Error(
      `source cleanliness must be verified from the source cwd: ${resolved} is not the worktree root (${top})`,
    );
  }

  const sha = await runGit(["rev-parse", "HEAD"]);
  const branch = await runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const status = await runGit(["status", "--porcelain"]);
  const violations = status.length === 0 ? [] : status.split("\n");

  return {
    sourcePath: resolved,
    checkedFromCwd: resolved,
    top: path.resolve(top),
    sha,
    branch,
    clean: violations.length === 0,
    violations,
    ok: violations.length === 0,
  };
}
