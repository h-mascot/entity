#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderOpenWikiHtml, verifyOpenWikiHtml } from "../packages/app/scripts/entity-openwiki-html-lib.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(scriptDirectory, "..");
const args = process.argv.slice(2);
const command = args[0] ?? "render";
const rootFlagIndex = args.indexOf("--root");
const root = rootFlagIndex >= 0 ? path.resolve(args[rootFlagIndex + 1] ?? "") : defaultRoot;

if (!["render", "verify"].includes(command)) {
  console.error("Usage: node scripts/entity-openwiki-html.mjs <render|verify> [--root PATH]");
  process.exitCode = 64;
} else {
  try {
    const result = command === "render"
      ? await renderOpenWikiHtml(root)
      : await verifyOpenWikiHtml(root);
    console.log(`[entity-openwiki-html] ${command === "render" ? "rendered" : "verified"} ${result.documentCount} pages (${result.contentHash})`);
  } catch (error) {
    console.error(`[entity-openwiki-html] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
