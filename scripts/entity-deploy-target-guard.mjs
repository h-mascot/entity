#!/usr/bin/env node
// Deploy destination safety guard (recovery REC-003).
//
// Immutable releases: a deploy destination must be a fresh exact-SHA release
// directory. The historical mutation path was a manual profile pointing
// ENTITY_PROD_DIR at .../<env>/current — rsync followed the symlink and
// overwrote a previously deployed release in place, leaving RELEASE.json and
// the directory basename claiming the old SHA while serving new bytes.
//
// deploy.sh probes the remote destination (python3 over ssh) and pipes the
// probe JSON here. This guard fail-closes on:
//   - SYMLINK_TARGET: destination resolves through a symlink (`current`)
//   - IDENTITY_COLLISION: existing RELEASE.json/VERSION carries another SHA
//   - BASENAME_COLLISION: SHA-named dir whose basename contradicts the candidate
//   - RELEASE_UNREADABLE: RELEASE.json present but not parseable
// and allows fresh dirs, metadata-less resume dirs, and same-SHA redeploys.
import { readFileSync } from "node:fs";

const SHA_RE = /^[0-9a-f]{40}$/i;

export function decideDeployTarget(probe, expectedSha) {
  const expected = String(expectedSha || "").toLowerCase();
  if (!SHA_RE.test(expected)) {
    return {
      ok: false,
      reason: "INVALID_EXPECTED_SHA",
      message: `expected release SHA is not a 40-hex git SHA: ${expectedSha}`,
    };
  }
  if (!probe || typeof probe !== "object") {
    return { ok: false, reason: "INVALID_PROBE", message: "destination probe is missing or not an object" };
  }
  const abspath = normalizePath(probe.abspath);
  const realpath = normalizePath(probe.realpath);
  if (!abspath || !realpath) {
    return { ok: false, reason: "INVALID_PROBE", message: "destination probe lacks abspath/realpath" };
  }
  if (realpath !== abspath) {
    return {
      ok: false,
      reason: "SYMLINK_TARGET",
      message:
        `deploy destination ${probe.configured} resolves through a symlink ` +
        `(${abspath} -> ${realpath}); deploys must target a fresh exact-SHA release ` +
        `directory, never the 'current' (or any) symlink`,
    };
  }
  if (!probe.exists) {
    return { ok: true, reason: "FRESH_TARGET" };
  }
  const dirBasename = String(probe.basename || "").toLowerCase();
  if (SHA_RE.test(dirBasename) && dirBasename !== expected) {
    return {
      ok: false,
      reason: "BASENAME_COLLISION",
      message:
        `existing release directory ${realpath} is named for ${dirBasename} but the ` +
        `candidate release SHA is ${expected}; refusing to mutate an existing release`,
    };
  }
  if (probe.releasePresent && !probe.releaseGitSha) {
    return {
      ok: false,
      reason: "RELEASE_UNREADABLE",
      message: `existing destination ${realpath} has a RELEASE.json whose gitSha cannot be read; refusing an unidentifiable target`,
    };
  }
  if (probe.releaseGitSha && String(probe.releaseGitSha).toLowerCase() !== expected) {
    return {
      ok: false,
      reason: "IDENTITY_COLLISION",
      message:
        `existing destination ${realpath} carries RELEASE.json gitSha ${probe.releaseGitSha} ` +
        `but the candidate release SHA is ${expected}; refusing to mutate an existing release`,
    };
  }
  if (probe.version && String(probe.version).toLowerCase() !== expected) {
    return {
      ok: false,
      reason: "IDENTITY_COLLISION",
      message:
        `existing destination ${realpath} carries VERSION ${probe.version} but the ` +
        `candidate release SHA is ${expected}; refusing to mutate an existing release`,
    };
  }
  if (probe.releasePresent) {
    return { ok: true, reason: "SAME_SHA_REDEPLOY" };
  }
  return { ok: true, reason: "NO_METADATA_RESUME" };
}

function normalizePath(p) {
  const value = String(p || "").trim();
  if (!value) return "";
  if (value === "/") return "/";
  return value.replace(/\/+$/, "");
}

function usageAndExit(code) {
  console.error("usage: entity-deploy-target-guard.mjs --expected-sha <sha> [--configured <path>] < probe.json");
  process.exit(code);
}

function parseArgs(argv) {
  const parsed = { expectedSha: "", configured: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--expected-sha") parsed.expectedSha = argv[++i] || "";
    else if (arg === "--configured") parsed.configured = argv[++i] || "";
    else usageAndExit(64);
  }
  if (!parsed.expectedSha) usageAndExit(64);
  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let probe;
  try {
    probe = JSON.parse(readFileSync(0, "utf8"));
  } catch (err) {
    console.error(`deploy-target-guard: REJECT INVALID_PROBE: cannot parse probe JSON from stdin: ${err.message}`);
    process.exit(1);
  }
  if (args.configured && probe.configured !== args.configured) {
    console.error(
      `deploy-target-guard: REJECT CONFIG_MISMATCH: probe describes ${probe.configured} ` +
        `but the configured destination is ${args.configured}`,
    );
    process.exit(1);
  }
  const decision = decideDeployTarget(probe, args.expectedSha);
  if (!decision.ok) {
    console.error(`deploy-target-guard: REJECT ${decision.reason}: ${decision.message}`);
    process.exit(1);
  }
  console.log(`deploy-target-guard: OK ${decision.reason}: destination ${probe.realpath || probe.abspath} is safe for ${args.expectedSha}`);
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) main();
