#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const envPath = process.env.ENTITY_DEPLOY_WEBHOOK_ENV || "";
if (envPath) loadEnvFile(envPath);

const port = Number(process.env.PORT || process.env.WEBHOOK_PORT || 18788);
const token = process.env.WEBHOOK_DEPLOY_TOKEN;
const allowedRepo = process.env.WEBHOOK_DEPLOY_REPO || "h-mascot/entity";
const sourceDir = process.env.ENTITY_DEPLOY_SOURCE_DIR;
const prodHost = process.env.ENTITY_PROD_HOST;
const prodHttpHost = process.env.ENTITY_PROD_HTTP_HOST || "127.0.0.1";
const prodDir = process.env.ENTITY_PROD_DIR;
const prodDb = process.env.ENTITY_PROD_DB || (prodDir ? `${prodDir}/packages/db/entity-tasks.db` : "");
const logPath = process.env.ENTITY_DEPLOY_LOG || "/tmp/entity-deploy-webhook.log";

let activeDeploy = null;

if (!token) {
  console.error("WEBHOOK_DEPLOY_TOKEN is required");
  process.exit(78);
}
for (const [name, value] of Object.entries({ ENTITY_DEPLOY_SOURCE_DIR: sourceDir, ENTITY_PROD_HOST: prodHost, ENTITY_PROD_DIR: prodDir, ENTITY_PROD_DB: prodDb })) {
  if (!value) {
    console.error(`${name} is required for deploy webhook runtime`);
    process.exit(78);
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      return sendJson(res, 200, {
        status: "ok",
        repo: allowedRepo,
        active: Boolean(activeDeploy),
        timestamp: new Date().toISOString(),
      });
    }

    if (req.method !== "POST" || req.url !== "/webhook/entity-deploy") {
      return sendJson(res, 404, { error: "not_found" });
    }

    const auth = req.headers.authorization || "";
    if (auth !== `Bearer ${token}`) {
      log("Rejected deploy: bad authorization header");
      return sendJson(res, 401, { error: "unauthorized" });
    }

    const payload = await readJson(req);
    if (payload.action !== "approve") {
      return sendJson(res, 400, { error: "invalid_action" });
    }
    if (payload.repo !== allowedRepo) {
      return sendJson(res, 400, { error: "invalid_repo", expected: allowedRepo });
    }
    if (payload.ref && payload.ref !== "main") {
      return sendJson(res, 400, { error: "invalid_ref", expected: "main" });
    }
    if (!/^[0-9a-f]{40}$/i.test(payload.sha || "")) {
      return sendJson(res, 400, { error: "invalid_sha" });
    }
    if (activeDeploy) {
      return sendJson(res, 409, { error: "deploy_in_progress", activeDeploy });
    }

    const deployId = String(payload.docId || `entity-deploy-${Date.now()}`);
    activeDeploy = { deployId, sha: payload.sha, startedAt: new Date().toISOString() };
    log(`Deploy ${deployId} accepted repo=${payload.repo} sha=${payload.sha} runId=${payload.runId || "unknown"}`);

    const result = await runDeploy({ deployId, sha: payload.sha });
    activeDeploy = null;

    if (result.code === 0) {
      log(`Deploy ${deployId} completed`);
      return sendJson(res, 200, { status: "deployed", deployId, sha: payload.sha });
    }

    log(`Deploy ${deployId} failed code=${result.code}`);
    return sendJson(res, 500, {
      status: "failed",
      deployId,
      sha: payload.sha,
      code: result.code,
    });
  } catch (error) {
    activeDeploy = null;
    log(`Request failed: ${error.stack || error.message}`);
    return sendJson(res, 500, { error: "server_error", message: error.message });
  }
});

server.listen(port, "0.0.0.0", () => {
  log(`Entity deploy webhook listening on ${port} for ${allowedRepo}`);
});

function runDeploy({ deployId, sha }) {
  mkdirSync(dirname(logPath), { recursive: true });
  const command = `
set -euo pipefail
if [ ! -d "${sourceDir}/.git" ]; then
  rm -rf "${sourceDir}"
  git clone https://github.com/${allowedRepo}.git "${sourceDir}"
fi
cd "${sourceDir}"
git fetch --prune origin main
git checkout --detach "${sha}"
git clean -fdx
npm ci
ENTITY_PROD_HOST="${prodHost}" \
ENTITY_PROD_HTTP_HOST="${prodHttpHost}" \
ENTITY_PROD_DIR="${prodDir}" \
ENTITY_PROD_DB="${prodDb}" \
ENTITY_SOURCE_DIR="${sourceDir}" \
./deploy.sh --all
`;

  return new Promise((resolve) => {
    const child = spawn("/bin/bash", ["-lc", command], {
      env: { ...process.env, PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}` },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const write = (chunk) => {
      const text = chunk.toString();
      appendFileSync(logPath, `[${new Date().toISOString()}] [${deployId}] ${text}`);
    };

    child.stdout.on("data", write);
    child.stderr.on("data", write);
    child.on("close", (code) => resolve({ code }));
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        req.destroy();
        reject(new Error("request_too_large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(`${JSON.stringify(body)}\n`);
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(logPath, line);
  } catch {
    // stdout remains available even if the log path is not writable.
  }
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.replace(/^["']|["']$/g, "");
  }
}
