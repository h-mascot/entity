import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { collectLiveState, decideDrift, decideUpToDate } from "./entity-deploy-live-verify.mjs";
import { maybeTreeHash } from "./entity-release-info.mjs";
import { realpathSync } from "node:fs";

const shaA = "a".repeat(40);
// Historical drifted tips: release directory fa2e439 mutated in place to serve
// ffce217 bytes — the exact controller-blind spot this module must catch.
const shaFa2e439 = "fa2e43984a1927328396244ba96726b5cfecf11b";
const shaFfce217 = "ffce21789943e3cd7f25aa60c851145c73f8e842";

function liveState(overrides = {}) {
  return {
    releaseMode: true,
    currentLink: "/srv/entity-sandbox/current",
    currentRealpath: `/srv/entity-sandbox/releases/${shaA}`,
    manifest: {
      gitSha: shaA,
      distHashes: {
        "packages/app/dist": `sha256:${"a".repeat(64)}`,
        "packages/server/dist": `sha256:${"s".repeat(64)}`,
      },
    },
    version: shaA,
    recomputedAppDistHash: `sha256:${"a".repeat(64)}`,
    recomputedServerDistHash: `sha256:${"s".repeat(64)}`,
    apiSha: shaA,
    servedIndexBytes: Buffer.from("index-bytes"),
    releaseIndexBytes: Buffer.from("index-bytes"),
    serviceCwd: `/srv/entity-sandbox/releases/${shaA}`,
    dbSymlinkRealpath: "/srv/entity-data/entity-tasks.db",
    expectedDbRealpath: "/srv/entity-data/entity-tasks.db",
    ...overrides,
  };
}

test("decision: fully consistent live identity is not drifted", () => {
  const result = decideDrift(liveState(), shaA);
  assert.deepEqual(result, { ok: true, reasons: [] });
});

test("decision: historical fa2e439 directory serving ffce217 API identity is drift", () => {
  const result = decideDrift(
    liveState({
      currentRealpath: `/srv/entity-sandbox/releases/${shaFa2e439}`,
      manifest: { gitSha: shaFa2e439, distHashes: {} },
      version: shaFa2e439,
      serviceCwd: `/srv/entity-sandbox/releases/${shaFa2e439}`,
      apiSha: shaFfce217,
    }),
    shaFa2e439,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("API_SHA_MISMATCH"), JSON.stringify(result.reasons));
});

test("decision: basename/SHA contradiction is drift even when the API agrees", () => {
  const result = decideDrift(
    liveState({ currentRealpath: `/srv/entity-sandbox/releases/${shaFa2e439}`, serviceCwd: `/srv/entity-sandbox/releases/${shaFa2e439}` }),
    shaA,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("CURRENT_BASENAME_MISMATCH"), JSON.stringify(result.reasons));
});

test("decision: mutated artifact bytes under an unchanged SHA are drift", () => {
  const result = decideDrift(
    liveState({ recomputedAppDistHash: `sha256:${"b".repeat(64)}` }),
    shaA,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("APP_DIST_BYTES_MUTATED"), JSON.stringify(result.reasons));
});

test("decision: served index bytes differing from the release copy is drift", () => {
  const result = decideDrift(
    liveState({ servedIndexBytes: Buffer.from("served-by-attacker") }),
    shaA,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("SERVED_INDEX_MISMATCH"), JSON.stringify(result.reasons));
});

// Luna-high F2: every verification artifact is REQUIRED evidence. A missing,
// unreadable, or unavailable fact must itself be drift with an explicit reason
// (the previous comparison-only logic fail-open when either side was absent).

test("decision: manifest missing the app dist hash fails closed", () => {
  const result = decideDrift(
    liveState({ manifest: { gitSha: shaA, distHashes: { "packages/server/dist": `sha256:${"s".repeat(64)}` } } }),
    shaA,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("MANIFEST_APP_HASH_MISSING"), JSON.stringify(result.reasons));
});

test("decision: manifest missing the server dist hash fails closed", () => {
  const result = decideDrift(
    liveState({ manifest: { gitSha: shaA, distHashes: { "packages/app/dist": `sha256:${"a".repeat(64)}` } } }),
    shaA,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("MANIFEST_SERVER_HASH_MISSING"), JSON.stringify(result.reasons));
});

test("decision: unreadable app dist tree fails closed", () => {
  const result = decideDrift(liveState({ recomputedAppDistHash: null }), shaA);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("APP_DIST_UNREADABLE"), JSON.stringify(result.reasons));
});

test("decision: unreadable server dist tree fails closed", () => {
  const result = decideDrift(liveState({ recomputedServerDistHash: null }), shaA);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("SERVER_DIST_UNREADABLE"), JSON.stringify(result.reasons));
});

test("decision: unreadable release index copy fails closed", () => {
  const result = decideDrift(liveState({ releaseIndexBytes: null }), shaA);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("RELEASE_INDEX_UNREADABLE"), JSON.stringify(result.reasons));
});

test("decision: unavailable served index bytes fail closed", () => {
  const result = decideDrift(liveState({ servedIndexBytes: null }), shaA);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("SERVED_INDEX_UNAVAILABLE"), JSON.stringify(result.reasons));
});

test("decision: service working outside the live release is drift", () => {
  const result = decideDrift(
    liveState({ serviceCwd: `/srv/entity-sandbox/releases/${shaFfce217}` }),
    shaA,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("SERVICE_CWD_OUTSIDE_RELEASE"), JSON.stringify(result.reasons));
});

test("decision: unknown service working directory fails closed as drift", () => {
  const result = decideDrift(liveState({ serviceCwd: null }), shaA);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("SERVICE_CWD_UNKNOWN"), JSON.stringify(result.reasons));
});

test("decision: DB symlink resolving away from the configured DB is drift", () => {
  const result = decideDrift(liveState({ dbSymlinkRealpath: "/srv/other/entity-tasks.db" }), shaA);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("DB_REALPATH_MISMATCH"), JSON.stringify(result.reasons));
});

test("decision: missing pieces fail closed", () => {
  const missingLink = decideDrift(liveState({ currentRealpath: null }), shaA);
  assert.ok(missingLink.reasons.includes("CURRENT_LINK_MISSING"));

  const missingManifest = decideDrift(liveState({ manifest: null }), shaA);
  assert.ok(missingManifest.reasons.includes("RELEASE_MANIFEST_MISSING"));

  const missingVersion = decideDrift(liveState({ version: "" }), shaA);
  assert.ok(missingVersion.reasons.includes("VERSION_MISSING"));

  const apiDown = decideDrift(liveState({ apiSha: null }), shaA);
  assert.ok(apiDown.reasons.includes("API_SHA_UNAVAILABLE"));
});

test("decision: non-release lanes still require API identity revalidation", () => {
  const ok = decideDrift(liveState({ releaseMode: false }), shaA);
  assert.deepEqual(ok, { ok: true, reasons: [] });

  const drifted = decideDrift(liveState({ releaseMode: false, apiSha: shaFfce217 }), shaA);
  assert.equal(drifted.ok, false);
  assert.deepEqual(drifted.reasons, ["API_SHA_MISMATCH"]);
});

test("controller: cached SHA with healthy live identity reports up-to-date only when revalidated", () => {
  const state = { repo: "h-mascot/entity", branch: "main", sha: shaA, deployedAt: "2026-08-24T00:00:00Z" };
  const upToDate = decideUpToDate({ force: false, state, repo: "h-mascot/entity", branch: "main", targetSha: shaA, live: liveState() });
  assert.deepEqual(upToDate, { upToDate: true, reason: "revalidated-live-identity" });

  const drift = decideUpToDate({
    force: false,
    state,
    repo: "h-mascot/entity",
    branch: "main",
    targetSha: shaA,
    live: liveState({ apiSha: shaFfce217 }),
  });
  assert.equal(drift.upToDate, false);
  assert.match(drift.reason, /drift:.*API_SHA_MISMATCH/);
});

test("controller: force and cache misses never report up-to-date", () => {
  const state = { repo: "h-mascot/entity", branch: "main", sha: shaA, deployedAt: "2026-08-24T00:00:00Z" };
  assert.deepEqual(
    decideUpToDate({ force: true, state, repo: "h-mascot/entity", branch: "main", targetSha: shaA, live: liveState() }),
    { upToDate: false, reason: "forced" },
  );
  assert.equal(
    decideUpToDate({ force: false, state: null, repo: "h-mascot/entity", branch: "main", targetSha: shaA, live: liveState() }).upToDate,
    false,
  );
  assert.equal(
    decideUpToDate({
      force: false,
      state: { ...state, sha: shaFfce217 },
      repo: "h-mascot/entity",
      branch: "main",
      targetSha: shaA,
      live: liveState(),
    }).upToDate,
    false,
  );
});

// ---------------------------------------------------------------------------
// collectLiveState integration: real filesystem layout + real local HTTP
// server, proving the collector observes live truth rather than cached state.
// ---------------------------------------------------------------------------

function buildReleaseTree(root, { sha, indexBytes, dbTarget, tamperIndex = false }) {
  const releases = join(root, "releases");
  const releaseDir = join(releases, sha);
  const appDist = join(releaseDir, "packages/app/dist");
  const serverDbDir = join(releaseDir, "packages/server/dist/db");
  mkdirSync(appDist, { recursive: true });
  mkdirSync(serverDbDir, { recursive: true });
  writeFileSync(join(appDist, "index.html"), indexBytes);
  const manifest = {
    schemaVersion: 1,
    app: "entity",
    gitSha: sha,
    distHashes: {
      "packages/app/dist": maybeTreeHash(appDist),
      "packages/server/dist": maybeTreeHash(join(releaseDir, "packages/server/dist"), "server-dist"),
    },
  };
  writeFileSync(join(releaseDir, "RELEASE.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(releaseDir, "VERSION"), `${sha}\n`);
  if (dbTarget) symlinkSync(dbTarget, join(serverDbDir, "entity-tasks.db"));
  if (tamperIndex) writeFileSync(join(appDist, "index.html"), tamperIndex);
  symlinkSync(releaseDir, join(root, "current"));
  return { releaseDir, manifest };
}

async function withSandboxServer({ apiSha, indexBytes }, fn) {
  const server = createServer((req, res) => {
    if (req.url === "/api/version") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ gitSha: apiSha }));
      return;
    }
    if (req.url === "/api/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(indexBytes);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function stubLsof(releaseDir) {
  const cwd = realpathSync(releaseDir);
  return {
    lsofPort: async () => 4242,
    lsofCwd: async () => cwd,
  };
}

test("collector + decision: consistent live release passes end to end", async () => {
  const root = mkdtempSync(join(tmpdir(), "entity-live-verify-"));
  const dbFile = join(root, "entity-tasks.db");
  writeFileSync(dbFile, "sqlite\n");
  const { releaseDir } = buildReleaseTree(root, { sha: shaA, indexBytes: "index-bytes-A", dbTarget: dbFile });
  await withSandboxServer({ apiSha: shaA, indexBytes: "index-bytes-A" }, async (port) => {
    const config = {
      releaseBaseDir: join(root, "releases"),
      currentLink: join(root, "current"),
      prodDb: dbFile,
      prodPort: String(port),
    };
    const live = await collectLiveState(config, stubLsof(releaseDir));
    const drift = decideDrift(live, shaA, config);
    assert.deepEqual(drift, { ok: true, reasons: [] });
    assert.equal(basename(live.currentRealpath), shaA);
    assert.equal(live.dbSymlinkRealpath, realpathSync(dbFile));
  });
  rmSync(root, { recursive: true, force: true });
});

test("collector + decision: detects the fa2e439 release mutated to serve ffce217", async () => {
  const root = mkdtempSync(join(tmpdir(), "entity-live-verify-"));
  const dbFile = join(root, "entity-tasks.db");
  writeFileSync(dbFile, "sqlite\n");
  // Release directory named fa2e439 with fa2e439 metadata and fa2e439 files,
  // but the live server was mutated in place to report ffce217 and serve
  // ffce217 bytes (the historical in-place mutation).
  const { releaseDir } = buildReleaseTree(root, {
    sha: shaFa2e439,
    indexBytes: "index-bytes-fa2e439",
    dbTarget: dbFile,
  });
  await withSandboxServer({ apiSha: shaFfce217, indexBytes: "index-bytes-ffce217" }, async (port) => {
    const config = {
      releaseBaseDir: join(root, "releases"),
      currentLink: join(root, "current"),
      prodDb: dbFile,
      prodPort: String(port),
    };
    const live = await collectLiveState(config, stubLsof(releaseDir));
    const drift = decideDrift(live, shaFa2e439, config);
    assert.equal(drift.ok, false);
    assert.ok(drift.reasons.includes("API_SHA_MISMATCH"), JSON.stringify(drift.reasons));
    assert.ok(drift.reasons.includes("SERVED_INDEX_MISMATCH"), JSON.stringify(drift.reasons));
  });
  rmSync(root, { recursive: true, force: true });
});

test("collector + decision: catches mutated dist bytes under an unchanged manifest", async () => {
  const root = mkdtempSync(join(tmpdir(), "entity-live-verify-"));
  const dbFile = join(root, "entity-tasks.db");
  writeFileSync(dbFile, "sqlite\n");
  const { releaseDir } = buildReleaseTree(root, {
    sha: shaA,
    indexBytes: "index-bytes-A",
    dbTarget: dbFile,
    tamperIndex: "index-bytes-A-tampered",
  });
  await withSandboxServer({ apiSha: shaA, indexBytes: "index-bytes-A" }, async (port) => {
    const config = {
      releaseBaseDir: join(root, "releases"),
      currentLink: join(root, "current"),
      prodDb: dbFile,
      prodPort: String(port),
    };
    const live = await collectLiveState(config, stubLsof(releaseDir));
    const drift = decideDrift(live, shaA, config);
    assert.equal(drift.ok, false);
    assert.ok(drift.reasons.includes("APP_DIST_BYTES_MUTATED"), JSON.stringify(drift.reasons));
    assert.ok(drift.reasons.includes("SERVED_INDEX_MISMATCH"), JSON.stringify(drift.reasons));
  });
  rmSync(root, { recursive: true, force: true });
});
