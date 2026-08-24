#!/usr/bin/env node
// Drift-aware live release verification (recovery REC-004).
//
// The pull-deployer used to short-circuit `UP_TO_DATE` from its cached
// last-deployed state alone, and post-deploy verification only compared the
// API-reported SHA. The historical failure: release directory fa2e439 was
// mutated in place to serve ffce217 bytes, the cache still said fa2e439 was
// deployed, and nothing revalidated the live tree — so the controller kept
// reporting up-to-date while the sandbox served drifted bytes.
//
// collectLiveState() gathers live truth from the host that runs the service:
// the `current` symlink target, the live RELEASE.json/VERSION, recomputed
// dist tree hashes, the served index bytes, the API-reported SHA, the
// listening service's working directory, and the DB symlink realpath.
// decideDrift() compares those facts against the expected release SHA and
// fails closed on any contradiction or unavailable fact.
import { existsSync, readFileSync, realpathSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { maybeTreeHash } from "./entity-release-info.mjs";

export async function collectLiveState(config, inject = {}) {
  const fetchImpl = inject.fetchImpl || fetch;
  const lsofPort = inject.lsofPort || defaultLsofPort;
  const lsofCwd = inject.lsofCwd || defaultLsofCwd;
  const port = parseInt(config.prodPort, 10) || 3000;
  const base = `http://127.0.0.1:${port}`;
  const releaseMode = Boolean(config.currentLink && config.releaseBaseDir);

  const state = {
    releaseMode,
    currentLink: config.currentLink || null,
    currentRealpath: null,
    manifest: null,
    version: "",
    recomputedAppDistHash: null,
    recomputedServerDistHash: null,
    apiSha: null,
    servedIndexBytes: null,
    releaseIndexBytes: null,
    serviceCwd: null,
    dbSymlinkRealpath: null,
    expectedDbRealpath: null,
  };

  if (releaseMode) {
    try {
      const linkTarget = readlinkSync(config.currentLink);
      state.currentRealpath = realpathSync(linkTarget || config.currentLink);
    } catch {
      state.currentRealpath = null;
    }
    if (state.currentRealpath) {
      try {
        state.manifest = JSON.parse(readFileSync(join(state.currentRealpath, "RELEASE.json"), "utf8"));
      } catch {
        state.manifest = null;
      }
      try {
        state.version = readFileSync(join(state.currentRealpath, "VERSION"), "utf8").trim().split(/\r?\n/)[0] || "";
      } catch {
        state.version = "";
      }
      state.recomputedAppDistHash = maybeTreeHash(join(state.currentRealpath, "packages/app/dist"));
      state.recomputedServerDistHash = maybeTreeHash(
        join(state.currentRealpath, "packages/server/dist"),
        "server-dist",
      );
      const indexFile = join(state.currentRealpath, "packages/app/dist/index.html");
      if (existsSync(indexFile)) {
        try {
          state.releaseIndexBytes = readFileSync(indexFile);
        } catch {
          state.releaseIndexBytes = null;
        }
      }
      try {
        state.dbSymlinkRealpath = realpathSync(
          join(state.currentRealpath, "packages/server/dist/db/entity-tasks.db"),
        );
      } catch {
        state.dbSymlinkRealpath = null;
      }
    }
    if (config.prodDb) {
      try {
        state.expectedDbRealpath = realpathSync(config.prodDb);
      } catch {
        state.expectedDbRealpath = null;
      }
    }
  }

  state.apiSha = await fetchApiSha(base, fetchImpl);
  state.servedIndexBytes = await fetchIndexBytes(base, fetchImpl);
  if (releaseMode) {
    const pid = await lsofPort(port);
    if (pid) state.serviceCwd = await lsofCwd(pid);
  }
  return state;
}

export function decideDrift(live, expectedSha) {
  const reasons = [];
  const expected = String(expectedSha || "").toLowerCase();
  if (!live) return { ok: false, reasons: ["LIVE_STATE_MISSING"] };

  if (live.apiSha === null) reasons.push("API_SHA_UNAVAILABLE");
  else if (String(live.apiSha).toLowerCase() !== expected) reasons.push("API_SHA_MISMATCH");

  if (!live.releaseMode) return { ok: reasons.length === 0, reasons };

  if (!live.currentRealpath) reasons.push("CURRENT_LINK_MISSING");
  if (live.currentRealpath && basename(live.currentRealpath).toLowerCase() !== expected) {
    reasons.push("CURRENT_BASENAME_MISMATCH");
  }
  if (!live.manifest) reasons.push("RELEASE_MANIFEST_MISSING");
  if (live.manifest && String(live.manifest.gitSha || "").toLowerCase() !== expected) {
    reasons.push("RELEASE_SHA_MISMATCH");
  }
  if (!live.version) reasons.push("VERSION_MISSING");
  if (live.version && live.version.toLowerCase() !== expected) reasons.push("VERSION_MISMATCH");

  // Luna-high F2: the manifest app/server dist hashes, the recomputed dist
  // tree hashes, the release index bytes, and the served index bytes are all
  // REQUIRED evidence. Missing/unreadable/unavailable facts are explicit drift
  // reasons (fail closed) — never silently skipped comparisons.
  const manifestHashes = live.manifest?.distHashes || {};
  const appHash = manifestHashes["packages/app/dist"];
  if (!appHash) {
    reasons.push("MANIFEST_APP_HASH_MISSING");
  } else if (!live.recomputedAppDistHash) {
    reasons.push("APP_DIST_UNREADABLE");
  } else if (live.recomputedAppDistHash !== appHash) {
    reasons.push("APP_DIST_BYTES_MUTATED");
  }
  const serverHash = manifestHashes["packages/server/dist"];
  if (!serverHash) {
    reasons.push("MANIFEST_SERVER_HASH_MISSING");
  } else if (!live.recomputedServerDistHash) {
    reasons.push("SERVER_DIST_UNREADABLE");
  } else if (live.recomputedServerDistHash !== serverHash) {
    reasons.push("SERVER_DIST_BYTES_MUTATED");
  }

  if (live.releaseIndexBytes === null) {
    reasons.push("RELEASE_INDEX_UNREADABLE");
  }
  if (live.servedIndexBytes === null) {
    reasons.push("SERVED_INDEX_UNAVAILABLE");
  }
  if (
    live.servedIndexBytes !== null &&
    live.releaseIndexBytes !== null &&
    !live.servedIndexBytes.equals(live.releaseIndexBytes)
  ) {
    reasons.push("SERVED_INDEX_MISMATCH");
  }

  if (live.serviceCwd === null) reasons.push("SERVICE_CWD_UNKNOWN");
  else if (live.currentRealpath && !pathWithin(live.serviceCwd, live.currentRealpath)) {
    reasons.push("SERVICE_CWD_OUTSIDE_RELEASE");
  }

  if (live.expectedDbRealpath === null) reasons.push("EXPECTED_DB_UNAVAILABLE");
  if (live.dbSymlinkRealpath === null) reasons.push("DB_SYMLINK_MISSING");
  if (
    live.dbSymlinkRealpath !== null &&
    live.expectedDbRealpath !== null &&
    live.dbSymlinkRealpath !== live.expectedDbRealpath
  ) {
    reasons.push("DB_REALPATH_MISMATCH");
  }

  return { ok: reasons.length === 0, reasons };
}

export function decideUpToDate({ force, state, repo, branch, targetSha, live }) {
  // REC-004: the cached target SHA alone is not proof of up-to-date-ness.
  // UP_TO_DATE is valid only after the live release identity revalidates;
  // anything else (cache miss, force, drift) must fall through to a deploy.
  if (force) return { upToDate: false, reason: 'forced' };
  if (!state || state.repo !== repo || state.branch !== branch || state.sha !== targetSha) {
    return { upToDate: false, reason: 'cache-miss' };
  }
  const drift = decideDrift(live, targetSha);
  if (!drift.ok) {
    return { upToDate: false, reason: `drift:${drift.reasons.join(',')}` };
  }
  return { upToDate: true, reason: 'revalidated-live-identity' };
}

async function fetchApiSha(base, fetchImpl) {
  try {
    const res = await fetchImpl(`${base}/api/version`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.gitSha === "string" ? body.gitSha : null;
  } catch {
    return null;
  }
}

async function fetchIndexBytes(base, fetchImpl) {
  try {
    const res = await fetchImpl(`${base}/`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function defaultLsofPort(port) {
  const result = spawnSync("lsof", ["-w", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return null;
  const match = /^p(\d+)$/m.exec(result.stdout.trim());
  return match ? Number(match[1]) : null;
}

function defaultLsofCwd(pid) {
  const result = spawnSync("lsof", ["-a", "-w", `-p`, String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout) return null;
  const match = /^n(.+)$/m.exec(result.stdout.trim());
  return match ? match[1] : null;
}

function pathWithin(candidate, root) {
  if (candidate === root) return true;
  return candidate.startsWith(`${root}/`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  // CLI: node entity-deploy-live-verify.mjs --sha <sha> --current-link <path>
  //      --release-base-dir <path> --prod-db <path> --port <n>
  // Prints JSON drift report; exit 0 = consistent, 1 = drift.
  const args = process.argv.slice(2);
  const read = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : "";
  };
  const config = {
    currentLink: read("--current-link"),
    releaseBaseDir: read("--release-base-dir"),
    prodDb: read("--prod-db"),
    prodPort: read("--port") || "3000",
  };
  const sha = read("--sha");
  const live = await collectLiveState(config);
  const drift = decideDrift(live, sha);
  console.log(JSON.stringify({ ...drift, live: summarize(live) }, null, 2));
  process.exit(drift.ok ? 0 : 1);
}

function summarize(live) {
  return {
    releaseMode: live.releaseMode,
    currentRealpath: live.currentRealpath,
    releaseGitSha: live.manifest?.gitSha || null,
    version: live.version || null,
    apiSha: live.apiSha,
    serviceCwd: live.serviceCwd,
    dbSymlinkRealpath: live.dbSymlinkRealpath,
    expectedDbRealpath: live.expectedDbRealpath,
  };
}
