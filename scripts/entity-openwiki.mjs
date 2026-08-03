#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildOpenWikiArgs,
  buildPnpmInstallArgs,
  codexAuthToOpenWikiEnv,
  generatedWikiStatusIsClean,
  normalizeOpenWikiBootstrapText,
  shouldRunOpenWiki,
  verifyGeneratedWiki,
  writeGenerationMetadata,
} from "./entity-openwiki-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedMode = process.argv[2] ?? "update";
const mode = requestedMode === "prepare" ? "update" : requestedMode;
const userMessage = process.argv.slice(3).join(" ");

if (requestedMode === "verify") {
  const metadata = await verifyGeneratedWiki(root);
  console.log(`[entity-openwiki] verified source fingerprint ${metadata.sourceFingerprint}`);
  process.exit(0);
}
if (!new Set(["init", "update"]).has(mode)) {
  console.error("Usage: node scripts/entity-openwiki.mjs <init|update|prepare|verify>");
  process.exit(64);
}

if (requestedMode === "prepare") {
  const initialStatus = spawnSync("git", [
    "status", "--porcelain", "--untracked-files=normal", "--", "openwiki", "AGENTS.md", "CLAUDE.md",
  ], { cwd: root, encoding: "utf8" });
  if (initialStatus.error) throw initialStatus.error;
  if (initialStatus.status !== 0) process.exit(initialStatus.status ?? 1);
  if (!generatedWikiStatusIsClean(initialStatus.stdout)) {
    console.error("[entity-openwiki] generated documentation is already dirty. Review and commit it before shipping:");
    console.error(initialStatus.stdout.trimEnd());
    process.exit(75);
  }

  let wikiIsFresh = false;
  try {
    await verifyGeneratedWiki(root);
    wikiIsFresh = true;
  } catch {
    // A stale or incomplete wiki must be regenerated below.
  }
  if (!shouldRunOpenWiki(requestedMode, wikiIsFresh)) {
    console.log("[entity-openwiki] wiki is already fresh; prepare skipped generation.");
    process.exit(0);
  }
}

const provider = process.env.OPENWIKI_PROVIDER || "openai-chatgpt";
const model = process.env.OPENWIKI_MODEL_ID || "gpt-5.4-mini";
const environment = {
  ...process.env,
  OPENWIKI_PROVIDER: provider,
  OPENWIKI_MODEL_ID: model,
  OPENWIKI_TELEMETRY_DISABLED: process.env.OPENWIKI_TELEMETRY_DISABLED || "1",
};
if (provider === "openai-chatgpt" && !environment.OPENAI_CHATGPT_ACCESS_TOKEN) {
  const authPath = path.join(os.homedir(), ".codex", "auth.json");
  try {
    const auth = JSON.parse(await readFile(authPath, "utf8"));
    Object.assign(environment, codexAuthToOpenWikiEnv(auth));
  } catch (error) {
    throw new Error(`OpenWiki requires a valid Codex OAuth login at ${authPath}: ${error.message}`);
  }
}

const installResult = spawnSync("pnpm", buildPnpmInstallArgs(), {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
if (installResult.error) throw installResult.error;
if (installResult.status !== 0) process.exit(installResult.status ?? 1);

const openwikiBinary = path.join(root, "tools", "openwiki", "node_modules", ".bin", "openwiki");
const result = spawnSync(openwikiBinary, buildOpenWikiArgs(mode, userMessage), {
  cwd: root,
  env: environment,
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

for (const bootstrapName of ["AGENTS.md", "CLAUDE.md"]) {
  const bootstrapPath = path.join(root, bootstrapName);
  try {
    const generatedBootstrap = await readFile(bootstrapPath, "utf8");
    const normalizedBootstrap = normalizeOpenWikiBootstrapText(generatedBootstrap);
    if (normalizedBootstrap !== generatedBootstrap) await writeFile(bootstrapPath, normalizedBootstrap);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const shaResult = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
if (shaResult.status !== 0) process.exit(shaResult.status ?? 1);
await writeGenerationMetadata(root, {
  provider,
  model,
  sourceSha: shaResult.stdout.trim(),
});
const metadata = await verifyGeneratedWiki(root);
console.log(`[entity-openwiki] generated and verified ${metadata.sourceFingerprint}`);
if (requestedMode === "prepare") {
  const statusResult = spawnSync("git", [
    "status", "--porcelain", "--untracked-files=normal", "--", "openwiki", "AGENTS.md", "CLAUDE.md",
  ], { cwd: root, encoding: "utf8" });
  if (statusResult.error) throw statusResult.error;
  if (statusResult.status !== 0) process.exit(statusResult.status ?? 1);
  if (!generatedWikiStatusIsClean(statusResult.stdout)) {
    console.error("[entity-openwiki] generated documentation changed. Review and commit these files, then rerun shipping:");
    console.error(statusResult.stdout.trimEnd());
    process.exit(75);
  }
}
