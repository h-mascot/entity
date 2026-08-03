import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const OPENWIKI_VERSION = "0.2.5";
export const OPENWIKI_MINIMUM_RELEASE_AGE_MINUTES = 10080;
export const OPENWIKI_METADATA_PATH = "openwiki/.entity-openwiki.json";

const SOURCE_ROOTS = [
  "package.json",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "CONTEXT.md",
  ".openwikiignore",
  ".github/workflows",
  ".cursor/loops/README.md",
  "openwiki/INSTRUCTIONS.md",
  "entity.config.example.yaml",
  "deploy.sh",
  "docs",
  "packages",
  "electron",
  "scripts",
  "tools/openwiki",
];
const EXCLUDED_DIRECTORIES = new Set([".git", ".tmp", "build", "data", "dist", "logs", "node_modules", "openwiki", "output"]);
const EXCLUDED_SOURCE_PREFIXES = ["docs/internal/"];
const EXCLUDED_FILE_PATTERN = /(?:\.db(?:-|$)|\.sqlite(?:3)?(?:-|$)|\.log$)/;
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

async function collectFiles(root, relativePath, files) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  if (EXCLUDED_SOURCE_PREFIXES.some((prefix) => normalizedPath.startsWith(prefix))) return;
  const absolutePath = path.join(root, relativePath);
  let entryStat;
  try {
    entryStat = await stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }

  if (entryStat.isFile()) {
    if (!EXCLUDED_FILE_PATTERN.test(relativePath)) files.push(relativePath);
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
  const files = [];
  for (const sourceRoot of SOURCE_ROOTS) await collectFiles(root, sourceRoot, files);
  files.sort();
  const hash = createHash("sha256");
  for (const relativePath of files) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relativePath)));
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
