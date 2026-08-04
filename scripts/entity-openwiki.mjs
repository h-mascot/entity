#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  buildCredentialFreeEnvironment,
  buildOpenWikiArgs,
  buildOpenWikiEnvironment,
  buildPnpmInstallArgs,
  codexAuthToOpenWikiEnv,
  generatedWikiStatusIsClean,
  normalizeOpenWikiBootstrapText,
  shouldRunOpenWiki,
  validateOpenWikiProvider,
  verifyGeneratedWiki,
  writeGenerationMetadata,
} from "./entity-openwiki-lib.mjs";
import {
  renderOpenWikiHtml,
  verifyOpenWikiHtml,
} from "../packages/app/scripts/entity-openwiki-html-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedMode = process.argv[2] ?? "update";
const mode = requestedMode === "prepare" ? "update" : requestedMode;
const userMessage = process.argv.slice(3).join(" ");

if (requestedMode === "verify") {
  const metadata = await verifyGeneratedWiki(root);
  const presentation = await verifyOpenWikiHtml(root);
  console.log(`[entity-openwiki] verified source fingerprint ${metadata.sourceFingerprint} and ${presentation.documentCount} HTML pages`);
  process.exit(0);
}
if (!new Set(["init", "update"]).has(mode)) {
  console.error("Usage: node scripts/entity-openwiki.mjs <init|update|prepare|verify>");
  process.exit(64);
}

if (requestedMode === "prepare") {
  const initialStatus = spawnSync("git", [
    "status", "--porcelain", "--untracked-files=normal", "--", "openwiki", "openwiki-html", "AGENTS.md", "CLAUDE.md",
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
    try {
      await verifyOpenWikiHtml(root);
    } catch {
      await renderOpenWikiHtml(root);
      const presentationStatus = spawnSync("git", [
        "status", "--porcelain", "--untracked-files=normal", "--", "openwiki-html",
      ], { cwd: root, encoding: "utf8" });
      if (presentationStatus.error) throw presentationStatus.error;
      if (presentationStatus.status !== 0) process.exit(presentationStatus.status ?? 1);
      if (!generatedWikiStatusIsClean(presentationStatus.stdout)) {
        console.error("[entity-openwiki] HTML presentation changed. Review and commit these files, then rerun shipping:");
        console.error(presentationStatus.stdout.trimEnd());
        process.exit(75);
      }
    }
    console.log("[entity-openwiki] wiki and HTML presentation are already fresh; prepare skipped generation.");
    process.exit(0);
  }
}

const provider = process.env.OPENWIKI_PROVIDER || "openai-chatgpt";
const model = process.env.OPENWIKI_MODEL_ID || "gpt-5.4-mini";
validateOpenWikiProvider(provider);
let authEnvironment = {};
if (provider === "openai-chatgpt" && !process.env.OPENAI_CHATGPT_ACCESS_TOKEN) {
  const authPath = path.join(os.homedir(), ".codex", "auth.json");
  try {
    const auth = JSON.parse(await readFile(authPath, "utf8"));
    authEnvironment = codexAuthToOpenWikiEnv(auth);
  } catch (error) {
    throw new Error(`OpenWiki requires a valid Codex OAuth login at ${authPath}: ${error.message}`);
  }
} else if (provider === "openai-chatgpt") {
  authEnvironment = Object.fromEntries(
    ["OPENAI_CHATGPT_ACCESS_TOKEN", "OPENAI_CHATGPT_REFRESH_TOKEN", "OPENAI_CHATGPT_EXPIRES_AT", "OPENAI_CHATGPT_ACCOUNT_ID"]
      .flatMap((key) => typeof process.env[key] === "string" ? [[key, process.env[key]]] : []),
  );
}
const isolatedHome = await mkdtemp(path.join(os.tmpdir(), "entity-openwiki-home-"));
try {
  await mkdir(path.join(isolatedHome, ".config"), { recursive: true });
  await writeFile(path.join(isolatedHome, ".npmrc"), "");
  const installEnvironment = { ...buildCredentialFreeEnvironment(process.env, { isolatedHome }), CI: "true" };
  const environment = buildOpenWikiEnvironment(process.env, { provider, model, authEnvironment, isolatedHome });

  const installResult = spawnSync("pnpm", buildPnpmInstallArgs(), {
    cwd: root,
    env: installEnvironment,
    stdio: "inherit",
  });
  if (installResult.error) throw installResult.error;
  if (installResult.status !== 0) {
    throw new Error(`pnpm install failed with status ${installResult.status ?? "unknown"}`);
  }

  const openwikiBinary = path.join(root, "tools", "openwiki", "node_modules", ".bin", "openwiki");
  const result = spawnSync(openwikiBinary, buildOpenWikiArgs(mode, userMessage), {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`OpenWiki failed with status ${result.status ?? "unknown"}`);
  }
} finally {
  await rm(isolatedHome, { recursive: true, force: true });
}

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

await writeGenerationMetadata(root, {
  provider,
  model,
});
const presentation = await renderOpenWikiHtml(root);
const metadata = await verifyGeneratedWiki(root);
await verifyOpenWikiHtml(root);
console.log(`[entity-openwiki] generated and verified ${metadata.sourceFingerprint} with ${presentation.documentCount} HTML pages`);
if (requestedMode === "prepare") {
  const statusResult = spawnSync("git", [
    "status", "--porcelain", "--untracked-files=normal", "--", "openwiki", "openwiki-html", "AGENTS.md", "CLAUDE.md",
  ], { cwd: root, encoding: "utf8" });
  if (statusResult.error) throw statusResult.error;
  if (statusResult.status !== 0) process.exit(statusResult.status ?? 1);
  if (!generatedWikiStatusIsClean(statusResult.stdout)) {
    console.error("[entity-openwiki] generated documentation changed. Review and commit these files, then rerun shipping:");
    console.error(statusResult.stdout.trimEnd());
    process.exit(75);
  }
}
