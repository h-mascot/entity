import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";

const HTML_SCHEMA_VERSION = 1;
const DEFAULT_SOURCE_ID = "entity-wiki";
const SOURCE_DIRECTORY = "openwiki";
const OUTPUT_DIRECTORY = "openwiki-html";
const MANIFEST_FILE = ".entity-openwiki-html.json";
const EXCLUDED_DOCUMENT_NAMES = new Set(["instructions.md", "log.md"]);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripWrappingQuotes(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => stripWrappingQuotes(item.trim()))
      .filter(Boolean);
  }
  return stripWrappingQuotes(trimmed);
}

export function parseOpenWikiFrontmatter(markdown) {
  const normalized = markdown.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) {
    return { attributes: {}, body: normalized };
  }

  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) {
    return { attributes: {}, body: normalized };
  }

  const attributes = {};
  for (const line of normalized.slice(4, end).split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0 || /^\s/.test(line)) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key)) {
      attributes[key] = parseScalar(value);
    }
  }

  return { attributes, body: normalized.slice(end + 5) };
}

function firstMarkdownHeading(markdown) {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
}

function titleFromPath(relativePath) {
  const stem = path.posix.basename(relativePath, path.posix.extname(relativePath));
  if (stem.toLowerCase() === "index") return "Overview";
  return stem
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(String).map((tag) => tag.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return value.split(",").map((tag) => tag.trim()).filter(Boolean);
  return [];
}

function pageUrl(sourceId, htmlPath) {
  const encodedSource = encodeURIComponent(sourceId);
  const encodedPath = htmlPath.split("/").map(encodeURIComponent).join("/");
  return `/docs/source/${encodedSource}/${encodedPath}`;
}

function splitHref(href) {
  const hashIndex = href.indexOf("#");
  if (hashIndex < 0) return { pathPart: href, hash: "" };
  return { pathPart: href.slice(0, hashIndex), hash: href.slice(hashIndex) };
}

function safeExternalHref(href) {
  try {
    const parsed = new URL(href);
    return ["https:", "http:", "mailto:"].includes(parsed.protocol) ? href : "#";
  } catch {
    return "#";
  }
}

function rewriteHref(href, currentDocumentPath, knownDocuments, sourceId) {
  if (!href || href.startsWith("#")) return { href: href || "#", attributes: "" };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
    return {
      href: safeExternalHref(href),
      attributes: ' target="_blank" rel="noopener noreferrer"',
    };
  }

  const { pathPart, hash } = splitHref(href);
  const currentDirectory = path.posix.dirname(currentDocumentPath);
  const normalizedTarget = path.posix.normalize(path.posix.join(currentDirectory, pathPart));
  let resolved;
  if (/\.md$/i.test(pathPart)) {
    resolved = normalizedTarget;
  } else if (pathPart.endsWith("/") || !path.posix.extname(pathPart)) {
    resolved = path.posix.join(normalizedTarget, "index.md");
  } else {
    return { href: "#", attributes: "" };
  }
  if (resolved.startsWith("../")) return { href: "#", attributes: "" };
  if (!knownDocuments.has(resolved)) {
    const basename = path.posix.basename(resolved);
    const uniqueBasenameMatches = [...knownDocuments].filter((documentPath) => path.posix.basename(documentPath) === basename);
    if (uniqueBasenameMatches.length !== 1) return { href: "#", attributes: "" };
    [resolved] = uniqueBasenameMatches;
  }
  const htmlPath = resolved.replace(/\.md$/i, ".html");
  return {
    href: `${pageUrl(sourceId, htmlPath)}${hash}`,
    attributes: ' target="_top"',
  };
}

function slugger() {
  const counts = new Map();
  return (value) => {
    const base = value
      .toLowerCase()
      .replaceAll(/<[^>]+>/g, "")
      .replaceAll(/[^a-z0-9\s-]/g, "")
      .trim()
      .replaceAll(/\s+/g, "-") || "section";
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
}

function createMarkdownRenderer({ currentDocumentPath, knownDocuments, sourceId }) {
  const marked = new Marked({ gfm: true, breaks: false });
  const slug = slugger();
  marked.use({
    renderer: {
      heading(token) {
        const content = this.parser.parseInline(token.tokens);
        const id = slug(token.text);
        return `<h${token.depth} id="${escapeHtml(id)}">${content}</h${token.depth}>\n`;
      },
      link(token) {
        const rewritten = rewriteHref(token.href, currentDocumentPath, knownDocuments, sourceId);
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<a href="${escapeHtml(rewritten.href)}"${rewritten.attributes}${title}>${this.parser.parseInline(token.tokens)}</a>`;
      },
      image(token) {
        const href = /^(https?:|data:image\/)/i.test(token.href) ? token.href : "";
        if (!href) return `<span class="image-unavailable">${escapeHtml(token.text || "Image unavailable")}</span>`;
        const title = token.title ? ` title="${escapeHtml(token.title)}"` : "";
        return `<img src="${escapeHtml(href)}" alt="${escapeHtml(token.text || "")}" loading="lazy"${title}>`;
      },
      html(token) {
        return escapeHtml(token.text);
      },
    },
  });
  return marked;
}

async function collectMarkdownDocuments(sourceRoot, relativeDirectory = "") {
  const absoluteDirectory = path.join(sourceRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const documents = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      documents.push(...await collectMarkdownDocuments(sourceRoot, relativePath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md") && !EXCLUDED_DOCUMENT_NAMES.has(entry.name.toLowerCase())) {
      documents.push(relativePath);
    }
  }
  return documents;
}

function stripDuplicateTitle(body, title) {
  const match = body.match(/^(\s*)#\s+(.+?)\s*\n/);
  if (!match || match[2].trim().toLowerCase() !== title.trim().toLowerCase()) return body;
  return `${match[1]}${body.slice(match[0].length)}`;
}

function navMarkup(documents, activeDocument, sourceId) {
  const items = documents.map((document) => {
    const active = document.relativePath === activeDocument.relativePath;
    return `<li><a class="wiki-nav-link${active ? " is-active" : ""}" href="${escapeHtml(pageUrl(sourceId, document.htmlPath))}" target="_top"${active ? ' aria-current="page"' : ""}><span>${escapeHtml(document.title)}</span><small>${escapeHtml(document.section)}</small></a></li>`;
  }).join("\n");
  return `<nav aria-label="Wiki pages"><ul class="wiki-nav-list">${items}</ul></nav>`;
}

function htmlDocument({ document, documents, renderedMarkdown, sourceId }) {
  const tags = document.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
  const type = document.type ? `<span class="eyebrow-type">${escapeHtml(document.type)}</span>` : "";
  const navigation = navMarkup(documents, document, sourceId);
  const currentIndex = documents.findIndex((candidate) => candidate.relativePath === document.relativePath);
  const previous = documents[currentIndex - 1];
  const next = documents[currentIndex + 1];
  const pager = [
    previous ? `<a href="${escapeHtml(pageUrl(sourceId, previous.htmlPath))}" target="_top" class="pager-link"><small>Previous</small><strong>← ${escapeHtml(previous.title)}</strong></a>` : "<span></span>",
    next ? `<a href="${escapeHtml(pageUrl(sourceId, next.htmlPath))}" target="_top" class="pager-link pager-next"><small>Next</small><strong>${escapeHtml(next.title)} →</strong></a>` : "<span></span>",
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(document.title)} · Entity Wiki</title>
<style>
:root{color-scheme:dark;--bg:#090b0e;--panel:#101318;--panel-2:#151920;--line:#252b34;--text:#f4f7fb;--muted:#9aa4b2;--quiet:#6f7a88;--accent:#63e6ff;--accent-soft:rgba(99,230,255,.1);--code:#0c1015;font-family:Inter,Geist,"SF Pro Text",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:16px}*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--text)}body{line-height:1.65}.skip-link{position:fixed;left:1rem;top:-4rem;z-index:10;padding:.65rem .9rem;background:var(--accent);color:#041014;border-radius:.45rem;font-weight:700}.skip-link:focus{top:1rem}.wiki-shell{display:grid;grid-template-columns:minmax(15rem,19rem) minmax(0,1fr);min-height:100vh}.wiki-sidebar{position:sticky;top:0;height:100vh;overflow:auto;border-right:1px solid var(--line);background:var(--panel);padding:1.5rem 1rem}.wiki-brand{display:flex;align-items:center;gap:.65rem;margin:0 .5rem 1.5rem;font-size:.76rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.wiki-brand-mark{width:.7rem;height:.7rem;border-radius:50%;background:var(--accent);box-shadow:0 0 1rem rgba(99,230,255,.38)}.wiki-nav-list{display:grid;gap:.25rem;margin:0;padding:0;list-style:none}.wiki-nav-link{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.65rem .75rem;border:1px solid transparent;border-radius:.55rem;color:var(--muted);text-decoration:none;font-size:.88rem}.wiki-nav-link:hover{border-color:var(--line);background:var(--panel-2);color:var(--text)}.wiki-nav-link:focus-visible,.pager-link:focus-visible,.mobile-nav summary:focus-visible,.prose a:focus-visible,.skip-link:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.wiki-nav-link.is-active{border-color:rgba(99,230,255,.24);background:var(--accent-soft);color:var(--accent)}.wiki-nav-link small{color:var(--quiet);font-size:.64rem;text-transform:uppercase;letter-spacing:.08em}.wiki-main{min-width:0}.mobile-nav{display:none;border-bottom:1px solid var(--line);background:var(--panel);padding:.8rem 1rem}.mobile-nav summary{cursor:pointer;font-weight:700}.mobile-nav nav{margin-top:.75rem}.wiki-article{width:min(100%,74rem);margin:0 auto;padding:clamp(2rem,5vw,5rem) clamp(1.25rem,5vw,5rem) 4rem}.page-header{padding-bottom:2rem;border-bottom:1px solid var(--line);margin-bottom:2.5rem}.eyebrow{display:flex;align-items:center;gap:.65rem;color:var(--accent);font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.eyebrow-type:before{content:"/";margin-right:.65rem;color:var(--quiet)}h1{margin:.75rem 0 0;font-size:clamp(2.15rem,5vw,4.5rem);line-height:1.02;letter-spacing:-.045em;max-width:18ch}h2,h3,h4{scroll-margin-top:1.5rem;line-height:1.2;letter-spacing:-.02em}h2{margin:3rem 0 1rem;font-size:1.75rem;padding-top:.5rem}h3{margin:2.25rem 0 .75rem;font-size:1.25rem}.description{max-width:68ch;margin:1.1rem 0 0;color:var(--muted);font-size:1.04rem}.tags{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:1.25rem}.tag{border:1px solid var(--line);border-radius:999px;padding:.22rem .55rem;color:var(--muted);font-size:.7rem}.prose{max-width:78ch}.prose p,.prose li{color:#cbd2dc}.prose a{color:var(--accent);text-underline-offset:.2em}.prose a:hover{text-decoration-thickness:.13em}.prose code{border:1px solid var(--line);border-radius:.35rem;background:var(--code);padding:.12rem .32rem;color:#d9f8ff;font-size:.86em}.prose pre{overflow:auto;border:1px solid var(--line);border-radius:.7rem;background:var(--code);padding:1rem}.prose pre code{border:0;padding:0;background:transparent}.prose blockquote{margin:1.5rem 0;padding:.2rem 1rem;border-left:3px solid var(--accent);color:var(--muted)}.prose table{display:block;width:max-content;max-width:100%;overflow:auto;border-collapse:collapse;margin:1.5rem 0}.prose th,.prose td{border:1px solid var(--line);padding:.65rem .8rem;text-align:left}.prose th{background:var(--panel-2);color:var(--text)}.prose img{max-width:100%;height:auto;border-radius:.7rem}.image-unavailable{color:var(--quiet);font-style:italic}.pager{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line)}.pager-link{display:flex;flex-direction:column;gap:.15rem;padding:.85rem 1rem;border:1px solid var(--line);border-radius:.65rem;color:var(--text);text-decoration:none}.pager-link:hover{border-color:var(--accent)}.pager-link small{color:var(--quiet);text-transform:uppercase;letter-spacing:.08em}.pager-next{text-align:right}@media(max-width:760px){.wiki-shell{display:block}.wiki-sidebar{display:none}.mobile-nav{display:block;position:sticky;top:0;z-index:2}.wiki-article{padding-top:2.5rem}h1{font-size:2.55rem}.pager{grid-template-columns:1fr}}
</style>
</head>
<body>
<a class="skip-link" href="#wiki-content">Skip to content</a>
<div class="wiki-shell">
<aside class="wiki-sidebar"><div class="wiki-brand"><span class="wiki-brand-mark"></span>Entity Wiki</div>${navigation}</aside>
<main class="wiki-main" id="wiki-content">
<details class="mobile-nav"><summary>Wiki navigation · ${escapeHtml(document.title)}</summary>${navigation}</details>
<article class="wiki-article">
<header class="page-header"><div class="eyebrow"><span>Entity Wiki</span>${type}</div><h1>${escapeHtml(document.title)}</h1>${document.description ? `<p class="description">${escapeHtml(document.description)}</p>` : ""}${tags ? `<div class="tags" aria-label="Tags">${tags}</div>` : ""}</header>
<div class="prose">${renderedMarkdown}</div>
<nav class="pager" aria-label="Adjacent wiki pages">${pager}</nav>
</article>
</main>
</div>
</body>
</html>
`;
}

function hashFiles(files) {
  const hash = createHash("sha256");
  for (const [relativePath, content] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

export async function buildOpenWikiHtml(root, { sourceId = DEFAULT_SOURCE_ID } = {}) {
  const sourceRoot = path.join(path.resolve(root), SOURCE_DIRECTORY);
  const relativePaths = await collectMarkdownDocuments(sourceRoot);
  if (!relativePaths.includes("index.md")) throw new Error("OpenWiki HTML requires openwiki/index.md");

  const documents = [];
  for (const relativePath of relativePaths) {
    const markdown = await readFile(path.join(sourceRoot, relativePath), "utf8");
    const { attributes, body } = parseOpenWikiFrontmatter(markdown);
    const title = String(attributes.title || firstMarkdownHeading(body) || titleFromPath(relativePath));
    documents.push({
      relativePath,
      htmlPath: relativePath.replace(/\.md$/i, ".html"),
      title,
      description: typeof attributes.description === "string" ? attributes.description : "",
      type: typeof attributes.type === "string" ? attributes.type : "",
      tags: normalizeTags(attributes.tags),
      body: stripDuplicateTitle(body, title),
      section: relativePath.includes("/") ? titleFromPath(relativePath.split("/")[0]) : "Overview",
    });
  }

  const knownDocuments = new Set(documents.map((document) => document.relativePath));
  const files = new Map();
  for (const document of documents) {
    const renderer = createMarkdownRenderer({ currentDocumentPath: document.relativePath, knownDocuments, sourceId });
    const renderedMarkdown = await renderer.parse(document.body);
    files.set(document.htmlPath, htmlDocument({ document, documents, renderedMarkdown, sourceId }));
  }

  const manifest = {
    schemaVersion: HTML_SCHEMA_VERSION,
    sourceId,
    sourceDirectory: SOURCE_DIRECTORY,
    documentCount: files.size,
    contentHash: hashFiles(files),
  };
  return { ...manifest, files };
}

async function assertOutputDirectoryIsSafe(outputRoot) {
  try {
    const stats = await lstat(outputRoot);
    if (stats.isSymbolicLink()) throw new Error(`Refusing symbolic link output directory: ${outputRoot}`);
    if (!stats.isDirectory()) throw new Error(`OpenWiki HTML output is not a directory: ${outputRoot}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function writeOutputTree(outputRoot, build) {
  for (const [relativePath, content] of build.files) {
    const outputPath = path.join(outputRoot, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
  const manifest = {
    schemaVersion: build.schemaVersion,
    sourceId: build.sourceId,
    sourceDirectory: build.sourceDirectory,
    documentCount: build.documentCount,
    contentHash: build.contentHash,
  };
  await writeFile(path.join(outputRoot, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

export async function renderOpenWikiHtml(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const outputRoot = path.join(resolvedRoot, OUTPUT_DIRECTORY);
  await assertOutputDirectoryIsSafe(outputRoot);
  const build = await buildOpenWikiHtml(resolvedRoot, options);
  const temporaryRoot = await mkdtemp(path.join(resolvedRoot, `.${OUTPUT_DIRECTORY}-tmp-`));
  const backupRoot = path.join(resolvedRoot, `.${OUTPUT_DIRECTORY}-backup-${process.pid}-${Date.now()}`);
  let movedPreviousOutput = false;
  let installedNewOutput = false;
  try {
    await writeOutputTree(temporaryRoot, build);
    try {
      await rename(outputRoot, backupRoot);
      movedPreviousOutput = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(temporaryRoot, outputRoot);
    installedNewOutput = true;
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    if (movedPreviousOutput && !installedNewOutput) {
      try {
        await rename(backupRoot, outputRoot);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], "OpenWiki HTML render failed and the previous output could not be restored");
      }
    }
    throw error;
  }
  if (movedPreviousOutput) await rm(backupRoot, { recursive: true, force: true });
  return {
    schemaVersion: build.schemaVersion,
    sourceId: build.sourceId,
    sourceDirectory: build.sourceDirectory,
    documentCount: build.documentCount,
    contentHash: build.contentHash,
  };
}

async function collectOutputFiles(outputRoot, relativeDirectory = "") {
  const absoluteDirectory = path.join(outputRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await collectOutputFiles(outputRoot, relativePath));
    else if (entry.isFile()) files.push(relativePath);
    else throw new Error(`Unexpected OpenWiki HTML output entry: ${relativePath}`);
  }
  return files;
}

export async function verifyOpenWikiHtml(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const outputRoot = path.join(resolvedRoot, OUTPUT_DIRECTORY);
  await assertOutputDirectoryIsSafe(outputRoot);
  const build = await buildOpenWikiHtml(resolvedRoot, options);
  const expected = new Map(build.files);
  expected.set(MANIFEST_FILE, `${JSON.stringify({
    schemaVersion: build.schemaVersion,
    sourceId: build.sourceId,
    sourceDirectory: build.sourceDirectory,
    documentCount: build.documentCount,
    contentHash: build.contentHash,
  }, null, 2)}\n`);

  let actualPaths;
  try {
    actualPaths = await collectOutputFiles(outputRoot);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("OpenWiki HTML output is missing or stale; run npm run docs:wiki:render");
    throw error;
  }

  for (const actualPath of actualPaths) {
    if (!expected.has(actualPath)) throw new Error(`Unexpected extra OpenWiki HTML output: ${actualPath}`);
  }
  for (const [relativePath, expectedContent] of expected) {
    let actualContent;
    try {
      actualContent = await readFile(path.join(outputRoot, relativePath), "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") throw new Error(`OpenWiki HTML output is missing or stale: ${relativePath}`);
      throw error;
    }
    if (actualContent !== expectedContent) throw new Error(`OpenWiki HTML output is stale: ${relativePath}`);
  }
  return {
    schemaVersion: build.schemaVersion,
    sourceId: build.sourceId,
    sourceDirectory: build.sourceDirectory,
    documentCount: build.documentCount,
    contentHash: build.contentHash,
  };
}
