import fs from "fs";
import os from "os";
import path from "path";

export type ReleaseInfo = {
  schemaVersion: 1;
  app: "entity";
  environment: string;
  gitSha: string | null;
  artifactHash: string | null;
  builtAt: string | null;
  releasePathBasename: string;
  releasePath: string;
  version: string | null;
  manifestPresent: boolean;
  source: "manifest" | "version-file" | "environment" | "runtime";
  nodeVersion: string;
  hostname: string;
};

type ReleaseManifest = {
  schemaVersion?: unknown;
  app?: unknown;
  environment?: unknown;
  environmentBuiltFor?: unknown;
  gitSha?: unknown;
  artifactHash?: unknown;
  builtAt?: unknown;
  version?: unknown;
};

export function readReleaseInfo(releaseRoot = process.cwd()): ReleaseInfo {
  const manifestPath = path.join(releaseRoot, "RELEASE.json");
  const versionPath = path.join(releaseRoot, "VERSION");
  const manifest = readReleaseManifest(manifestPath);
  const version = readOptionalText(versionPath);
  const envGitSha = normalizeString(process.env.ENTITY_RELEASE_SHA ?? process.env.GIT_SHA);
  const manifestGitSha = normalizeString(manifest?.gitSha);
  const gitSha = manifestGitSha ?? normalizeGitSha(version) ?? normalizeGitSha(envGitSha);
  const environment =
    normalizeString(process.env.ENTITY_ENV) ??
    normalizeString(manifest?.environment) ??
    normalizeString(manifest?.environmentBuiltFor) ??
    (process.env.NODE_ENV === "production" ? "production" : "development");

  return {
    schemaVersion: 1,
    app: "entity",
    environment,
    gitSha,
    artifactHash: normalizeString(manifest?.artifactHash) ?? normalizeString(process.env.ENTITY_ARTIFACT_HASH),
    builtAt: normalizeString(manifest?.builtAt) ?? normalizeString(process.env.ENTITY_BUILT_AT),
    releasePathBasename: path.basename(releaseRoot),
    releasePath: releaseRoot,
    version: normalizeString(manifest?.version) ?? version ?? gitSha,
    manifestPresent: manifest !== null,
    source: manifest ? "manifest" : version ? "version-file" : envGitSha ? "environment" : "runtime",
    nodeVersion: process.version,
    hostname: os.hostname(),
  };
}

function readReleaseManifest(manifestPath: string): ReleaseManifest | null {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as ReleaseManifest;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Treat malformed manifests as absent for liveness; verification scripts fail hard.
      return null;
    }
  }
  return null;
}

function readOptionalText(filePath: string): string | null {
  try {
    const value = fs.readFileSync(filePath, "utf8").trim();
    return value || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return null;
    }
  }
  return null;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeGitSha(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/[0-9a-f]{40}/i);
  return match?.[0] ?? null;
}
