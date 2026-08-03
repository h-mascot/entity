import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const OPENWIKI_VERSION = "0.2.5";
export const OPENWIKI_MINIMUM_RELEASE_AGE_MINUTES = 10080;
export const OPENWIKI_METADATA_PATH = "openwiki/.entity-openwiki.json";

const EXCLUDED_DIRECTORIES = new Set([
  ".git", ".tmp", ".claude", "artifacts", "build", "data", "dist", "logs", "memory", "node_modules", "openwiki", "output", "run-state", "var",
]);
const EXCLUDED_SOURCE_PREFIXES = [
  ".claude/", ".cursor/run-state/", "artifacts/", "docs/internal/", "memory/", "openwiki/", "output/", "var/",
];
const INCLUDED_OPENWIKI_INPUTS = new Set(["openwiki/INSTRUCTIONS.md"]);
const EXCLUDED_FILE_PATTERN = /(?:^|\/)(?:[^/]*\.db(?:-|$)|[^/]*\.sqlite(?:3)?(?:-|$)|[^/]*\.log$)/;
const SAFE_ENV_TEMPLATE_NAMES = new Set([".env.example", ".env.sample", ".env.template"]);
const BASE_ENVIRONMENT_KEYS = ["HOME", "LANG", "LC_ALL", "LOGNAME", "PATH", "SHELL", "TMPDIR", "TMP", "TEMP", "USER"];
const PROXY_ENVIRONMENT_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"];
const CHATGPT_CREDENTIAL_KEYS = [
  "OPENAI_CHATGPT_ACCESS_TOKEN", "OPENAI_CHATGPT_REFRESH_TOKEN", "OPENAI_CHATGPT_EXPIRES_AT", "OPENAI_CHATGPT_ACCOUNT_ID",
];
const PROVIDER_CREDENTIAL_KEYS = {
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
  baseten: ["BASETEN_API_KEY", "BASETEN_BASE_URL"],
  bedrock: [
    "BEDROCK_AWS_ACCESS_KEY_ID", "BEDROCK_AWS_SECRET_ACCESS_KEY", "BEDROCK_AWS_SESSION_TOKEN", "BEDROCK_AWS_REGION",
    "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_REGION", "AWS_DEFAULT_REGION", "AWS_PROFILE",
    "AWS_CONFIG_FILE", "AWS_SHARED_CREDENTIALS_FILE", "AWS_ROLE_ARN", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_BEARER_TOKEN_BEDROCK",
  ],
  copilot: ["COPILOT_API_KEY", "COPILOT_BASE_URL"],
  fireworks: ["FIREWORKS_API_KEY", "FIREWORKS_BASE_URL"],
  gemini: ["GEMINI_API_KEY"],
  "gemini-enterprise": [
    "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_APPLICATION_CREDENTIALS",
    "OPENWIKI_GOOGLE_ACCESS_TOKEN", "OPENWIKI_GOOGLE_CLIENT_ID", "OPENWIKI_GOOGLE_CLIENT_SECRET", "OPENWIKI_GOOGLE_REFRESH_TOKEN",
  ],
  nebius: ["NEBIUS_API_KEY"],
  nvidia: ["NVIDIA_API_KEY", "NVIDIA_BASE_URL"],
  openai: ["OPENAI_API_KEY", "OPENAI_BASE_URL"],
  "openai-chatgpt": [],
  "openai-compatible": ["OPENAI_COMPATIBLE_API_KEY", "OPENAI_COMPATIBLE_BASE_URL"],
  openrouter: ["OPENROUTER_API_KEY", "OPENWIKI_OPENROUTER_PROVIDER_ONLY"],
};
const REQUIRED_OPENWIKI_IGNORE_PATTERNS = [
  ".env",
  "*.db",
  "docs/internal/",
  "/var/",
  "/memory/",
  "/artifacts/",
  "/.claude/",
  "/.cursor/run-state/",
];

export function buildCredentialFreeEnvironment(processEnvironment = process.env) {
  const environment = Object.fromEntries(BASE_ENVIRONMENT_KEYS.flatMap((key) => {
    const value = processEnvironment[key];
    return typeof value === "string" && value.length > 0 ? [[key, value]] : [];
  }));
  for (const key of PROXY_ENVIRONMENT_KEYS) {
    const value = processEnvironment[key];
    if (typeof value !== "string" || value.length === 0) continue;
    if (key.toLowerCase() === "no_proxy") {
      environment[key] = value;
      continue;
    }
    try {
      const proxyUrl = new URL(value);
      if (!proxyUrl.username && !proxyUrl.password) environment[key] = value;
    } catch {
      // Invalid or credential-bearing proxy values are not forwarded to third-party tooling.
    }
  }
  return environment;
}

export function buildOpenWikiEnvironment(processEnvironment, { provider, model, authEnvironment = {} }) {
  const environment = {
    ...buildCredentialFreeEnvironment(processEnvironment),
    OPENWIKI_PROVIDER: provider,
    OPENWIKI_MODEL_ID: model,
    OPENWIKI_TELEMETRY_DISABLED: "1",
  };
  const retryAttempts = processEnvironment.OPENWIKI_PROVIDER_RETRY_ATTEMPTS;
  if (typeof retryAttempts === "string" && retryAttempts.length > 0) {
    environment.OPENWIKI_PROVIDER_RETRY_ATTEMPTS = retryAttempts;
  }
  for (const key of PROVIDER_CREDENTIAL_KEYS[provider] ?? []) {
    const value = processEnvironment[key];
    if (typeof value === "string" && value.length > 0) environment[key] = value;
  }
  for (const key of CHATGPT_CREDENTIAL_KEYS) {
    const value = authEnvironment[key];
    if (typeof value === "string" && value.length > 0) environment[key] = value;
  }
  return environment;
}

export function validateOpenWikiIgnore(contents) {
  const patterns = new Set(contents.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
  for (const required of REQUIRED_OPENWIKI_IGNORE_PATTERNS) {
    if (!patterns.has(required)) throw new Error(`.openwikiignore must include ${required}`);
  }
}

export function buildPnpmInstallArgs() {
  return [
    `--config.minimum-release-age=${OPENWIKI_MINIMUM_RELEASE_AGE_MINUTES}`,
    "--dir",
    "tools/openwiki",
    "install",
    "--frozen-lockfile",
  ];
}

export function buildOpenWikiArgs(mode = "update", userMessage = "") {
  if (!new Set(["init", "update"]).has(mode)) {
    throw new Error(`Unsupported OpenWiki mode: ${mode}`);
  }
  const args = ["code", mode === "init" ? "--init" : "--update", "--print"];
  if (userMessage.trim()) args.push(userMessage.trim());
  return args;
}

function sourcePathIsIncluded(relativePath) {
  const normalizedPath = relativePath.split(path.sep).join("/").replace(/^\.\//, "");
  if (INCLUDED_OPENWIKI_INPUTS.has(normalizedPath)) return true;
  if (EXCLUDED_SOURCE_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) return false;
  const baseName = path.posix.basename(normalizedPath);
  if ((baseName === ".env" || baseName.startsWith(".env.")) && !SAFE_ENV_TEMPLATE_NAMES.has(baseName)) return false;
  if (EXCLUDED_FILE_PATTERN.test(normalizedPath)) return false;
  return !normalizedPath.split("/").some((part) => EXCLUDED_DIRECTORIES.has(part));
}

async function collectFiles(root, relativePath, files) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  if (normalizedPath !== "." && !sourcePathIsIncluded(normalizedPath)) return;
  const absolutePath = path.join(root, relativePath);
  let entryStat;
  try {
    entryStat = await stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  if (entryStat.isFile()) {
    files.push(normalizedPath);
    return;
  }
  if (!entryStat.isDirectory()) return;

  const entries = await readdir(absolutePath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    await collectFiles(root, path.join(relativePath, entry.name), files);
  }
}

export async function computeSourceFingerprint(root) {
  let files = [];
  const tracked = spawnSync("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" });
  if (!tracked.error && tracked.status === 0) {
    files = tracked.stdout.split("\0").filter(Boolean).filter(sourcePathIsIncluded);
  } else {
    await collectFiles(root, ".", files);
  }
  for (const includedPath of INCLUDED_OPENWIKI_INPUTS) {
    if (!files.includes(includedPath)) await collectFiles(root, includedPath, files);
  }
  files = [...new Set(files)].sort();
  const hash = createHash("sha256");
  for (const relativePath of files) {
    const absolutePath = path.join(root, relativePath);
    let entryStat;
    try {
      entryStat = await lstat(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    hash.update(relativePath);
    hash.update("\0");
    if (entryStat.isSymbolicLink()) {
      hash.update("symlink\0");
      hash.update(await readlink(absolutePath));
    } else {
      hash.update(await readFile(absolutePath));
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}



export function generatedWikiStatusIsClean(status) {
  return status.trim().length === 0;
}

export function shouldRunOpenWiki(requestedMode, wikiIsFresh) {
  return requestedMode !== "prepare" || !wikiIsFresh;
}

export function normalizeOpenWikiBootstrapText(text) {
  return text.replace(
    "The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki.",
    "Entity refreshes OpenWiki before sandbox shipping on the trusted Enterprise runner; GitHub Actions verifies that committed generated docs remain fresh.",
  );
}

export function codexAuthToOpenWikiEnv(auth) {
  const tokens = auth?.tokens;
  const accessToken = tokens?.access_token;
  const refreshToken = tokens?.refresh_token;
  const accountId = tokens?.account_id;
  if (![accessToken, refreshToken, accountId].every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("Codex OAuth credentials are incomplete");
  }
  const segments = accessToken.split(".");
  if (segments.length < 2) throw new Error("Codex OAuth access token is not a JWT");
  let claims;
  try {
    claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Codex OAuth access token claims are invalid");
  }
  if (!Number.isFinite(claims.exp)) throw new Error("Codex OAuth access token has no expiry");
  return {
    OPENAI_CHATGPT_ACCESS_TOKEN: accessToken,
    OPENAI_CHATGPT_REFRESH_TOKEN: refreshToken,
    OPENAI_CHATGPT_EXPIRES_AT: String(Math.trunc(claims.exp * 1000)),
    OPENAI_CHATGPT_ACCOUNT_ID: accountId,
  };
}

export async function writeGenerationMetadata(root, { provider, model, sourceSha }) {
  const metadataPath = path.join(root, OPENWIKI_METADATA_PATH);
  const sourceFingerprint = await computeSourceFingerprint(root);
  try {
    const existing = JSON.parse(await readFile(metadataPath, "utf8"));
    if (
      existing.schemaVersion === 1 &&
      existing.openwikiVersion === OPENWIKI_VERSION &&
      existing.sourceFingerprint === sourceFingerprint &&
      existing.provider === provider &&
      existing.model === model
    ) {
      return existing;
    }
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }

  const metadata = {
    schemaVersion: 1,
    openwikiVersion: OPENWIKI_VERSION,
    sourceFingerprint,
    sourceSha,
    provider,
    model,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}


async function collectConceptDocuments(directory, root = directory, concepts = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectConceptDocuments(entryPath, root, concepts);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const relativePath = path.relative(root, entryPath);
      if (!new Set(["INSTRUCTIONS.md", "index.md", "log.md"]).has(relativePath)) concepts.push(relativePath);
    }
  }
  return concepts;
}

export async function verifyGeneratedWiki(root) {
  const instructionsPath = path.join(root, "openwiki", "INSTRUCTIONS.md");
  const indexPath = path.join(root, "openwiki", "index.md");
  const metadataPath = path.join(root, OPENWIKI_METADATA_PATH);

  const [instructions, index, metadataText, ignoreContents] = await Promise.all([
    readFile(instructionsPath, "utf8"),
    readFile(indexPath, "utf8"),
    readFile(metadataPath, "utf8"),
    readFile(path.join(root, ".openwikiignore"), "utf8"),
  ]);
  validateOpenWikiIgnore(ignoreContents);
  if (!instructions.trim()) throw new Error("OpenWiki instructions are empty");
  if (!/okf_version:\s*["']?0\.1["']?/.test(index)) {
    throw new Error("OpenWiki index is missing OKF v0.1 metadata");
  }
  const concepts = await collectConceptDocuments(path.join(root, "openwiki"));
  if (concepts.length === 0) {
    throw new Error("OpenWiki has no generated concept documents; run the one-time init command");
  }

  const metadata = JSON.parse(metadataText);
  if (metadata.openwikiVersion !== OPENWIKI_VERSION) {
    throw new Error(`OpenWiki metadata version ${metadata.openwikiVersion} does not match pinned ${OPENWIKI_VERSION}`);
  }
  const currentFingerprint = await computeSourceFingerprint(root);
  if (metadata.sourceFingerprint !== currentFingerprint) {
    throw new Error("Generated OpenWiki documentation is stale for the current Entity source fingerprint");
  }
  return metadata;
}
