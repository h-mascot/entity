#!/usr/bin/env node
import { constants, realpathSync } from "node:fs";
import { copyFile, lstat, readFile, readlink, rename, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_ID_PATTERN = /^(\s*)-\s+id:\s*["']?entity-wiki["']?\s*(?:#.*)?$/;
const NEXT_SOURCE_PATTERN = /^(\s*)-\s+id:\s*/;
const BASE_PATH_PATTERN = /^(\s*)basePath:\s*(["']?)([^"'#\s]+)\2(\s*(?:#.*)?)$/;
const READ_ONLY_PATTERN = /^(\s*)readOnly:\s*(true|false)(\s*(?:#.*)?)$/;

export function migrateEntityWikiConfig(content) {
  const lines = content.split("\n");
  const sourceStart = lines.findIndex((line) => SOURCE_ID_PATTERN.test(line));
  if (sourceStart < 0) {
    throw new Error("entity-wiki source is missing from runtime config");
  }

  const sourceIndent = SOURCE_ID_PATTERN.exec(lines[sourceStart])?.[1]?.length ?? 0;
  let sourceEnd = lines.length;
  for (let index = sourceStart + 1; index < lines.length; index += 1) {
    const match = NEXT_SOURCE_PATTERN.exec(lines[index]);
    if (match && match[1].length === sourceIndent) {
      sourceEnd = index;
      break;
    }
    if (lines[index].trim() && !lines[index].startsWith(" ".repeat(sourceIndent + 1))) {
      sourceEnd = index;
      break;
    }
  }

  let basePathIndex = -1;
  let currentBasePath = "";
  for (let index = sourceStart + 1; index < sourceEnd; index += 1) {
    const match = BASE_PATH_PATTERN.exec(lines[index]);
    if (match) {
      basePathIndex = index;
      currentBasePath = match[3];
      break;
    }
  }

  if (basePathIndex < 0) {
    throw new Error("entity-wiki source has no basePath");
  }
  if (currentBasePath !== "./openwiki" && currentBasePath !== "./openwiki-html") {
    return { changed: false, content, usesGeneratedHtml: false, preservedCustomPath: currentBasePath };
  }

  let changed = false;
  const basePathMatch = BASE_PATH_PATTERN.exec(lines[basePathIndex]);
  const indent = basePathMatch?.[1] ?? "    ";
  if (currentBasePath === "./openwiki") {
    const comment = basePathMatch?.[4] ?? "";
    lines[basePathIndex] = `${indent}basePath: ./openwiki-html${comment}`;
    changed = true;
  }

  const relativeReadOnlyIndex = lines.slice(sourceStart + 1, sourceEnd).findIndex((line) => READ_ONLY_PATTERN.test(line));
  if (relativeReadOnlyIndex >= 0) {
    const readOnlyIndex = sourceStart + 1 + relativeReadOnlyIndex;
    const readOnlyMatch = READ_ONLY_PATTERN.exec(lines[readOnlyIndex]);
    if (readOnlyMatch?.[2] !== "true") {
      lines[readOnlyIndex] = `${readOnlyMatch?.[1] ?? indent}readOnly: true${readOnlyMatch?.[3] ?? ""}`;
      changed = true;
    }
  } else {
    lines.splice(basePathIndex + 1, 0, `${indent}readOnly: true`);
    changed = true;
  }

  return { changed, content: lines.join("\n"), usesGeneratedHtml: true };
}

async function ensurePresentationLink(configPath, presentationPath) {
  const resolvedPresentation = path.resolve(presentationPath);
  const presentationStat = await stat(resolvedPresentation);
  if (!presentationStat.isDirectory()) {
    throw new Error(`generated HTML presentation is not a directory: ${resolvedPresentation}`);
  }

  const linkPath = path.join(path.dirname(path.resolve(configPath)), "openwiki-html");
  if (linkPath === resolvedPresentation) {
    return linkPath;
  }
  try {
    const linkStat = await lstat(linkPath);
    if (!linkStat.isSymbolicLink()) {
      throw new Error(`refusing to replace non-symlink presentation path: ${linkPath}`);
    }
    const currentTarget = await readlink(linkPath);
    const resolvedTarget = path.resolve(path.dirname(linkPath), currentTarget);
    if (resolvedTarget !== resolvedPresentation) {
      throw new Error(`refusing to replace custom presentation symlink: ${linkPath}`);
    }
    return linkPath;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const relativeTarget = path.relative(path.dirname(linkPath), resolvedPresentation) || ".";
  await symlink(relativeTarget, linkPath, "dir");
  return linkPath;
}

export async function migrateEntityWikiConfigFile(configPath, { presentationPath } = {}) {
  const resolved = path.resolve(configPath);
  const content = await readFile(resolved, "utf8");
  const result = migrateEntityWikiConfig(content);
  let presentationLink = null;
  if (result.usesGeneratedHtml) {
    if (!presentationPath) {
      throw new Error("presentationPath is required for the generated HTML wiki source");
    }
    presentationLink = await ensurePresentationLink(resolved, presentationPath);
  }
  if (!result.changed) {
    return {
      changed: false,
      backupPath: null,
      presentationLink,
      preservedCustomPath: result.preservedCustomPath ?? null,
    };
  }

  const backupPath = `${resolved}.before-openwiki-html`;
  try {
    await copyFile(resolved, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }

  const temporaryPath = `${resolved}.openwiki-html-${process.pid}.tmp`;
  await writeFile(temporaryPath, result.content, { mode: 0o600 });
  await rename(temporaryPath, resolved);
  return { changed: true, backupPath, presentationLink, preservedCustomPath: null };
}

async function main() {
  const configPath = process.argv[2];
  const presentationPath = process.argv[3];
  if (!configPath || !presentationPath) {
    throw new Error("Usage: node scripts/entity-wiki-config-migrate.mjs <entity.config.yaml> <openwiki-html-directory>");
  }
  const result = await migrateEntityWikiConfigFile(configPath, { presentationPath });
  if (result.preservedCustomPath) {
    console.log(`preserved custom entity-wiki path ${result.preservedCustomPath}`);
  } else {
    console.log(result.changed ? `migrated ${configPath}` : `already migrated ${configPath}`);
  }
}

function isMainModule() {
  if (!process.argv[1]) return false;
  const modulePath = fileURLToPath(import.meta.url);
  try {
    return realpathSync(process.argv[1]) === realpathSync(modulePath);
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(modulePath);
  }
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`[entity-wiki-config] ${error.message}`);
    process.exitCode = 1;
  });
}
