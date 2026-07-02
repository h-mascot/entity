import fs from "fs/promises";
import os from "os";
import path from "path";

export const SAMPLE_DOC_FILENAME = "entity-doc-viewer-demo.md";
export const SAMPLE_DOC_OUTPUT_PATH = `output/${SAMPLE_DOC_FILENAME}`;

const SAMPLE_DOC_MARKDOWN = [
  "# Entity Doc Viewer — Demo Document",
  "",
  "Welcome to a self-seeded document that shows how Entity renders Markdown in the in-app doc viewer.",
  "",
  "## Overview",
  "",
  "Use this demo to check headings, paragraphs, links, lists, tables, task checklists, quotes, and code formatting.",
  "",
  "### Text formatting",
  "",
  "The viewer supports **bold text**, _italic text_, and inline `code` spans for filenames, commands, and identifiers.",
  "",
  "### Bulleted list",
  "",
  "- Open this document from a task Output link.",
  "- Scan the rendered Markdown styles.",
  "- Follow links without leaving the Entity workflow.",
  "",
  "### Numbered list",
  "",
  "1. Seed the demo document on startup.",
  "2. Seed a task whose Output links to it.",
  "3. Open the rendered document from the task detail view.",
  "",
  "> This blockquote demonstrates how callouts or copied notes appear in the viewer.",
  "",
  "### Code block",
  "",
  "```ts",
  "const docsUrl = '/docs/output/entity-doc-viewer-demo.md';",
  "console.log(`Open ${docsUrl} inside Entity`);",
  "```",
  "",
  "### Table",
  "",
  "| Feature | Rendered here | Notes |",
  "| --- | --- | --- |",
  "| Headings | Yes | H1, H2, and H3 are included. |",
  "| Lists | Yes | Bulleted and numbered examples are included. |",
  "| Code | Yes | Inline and fenced code are included. |",
  "",
  "### Checklist",
  "",
  "- [x] Demo file seeded without overwriting user content.",
  "- [x] Task Output links to this document.",
  "- [ ] Replace this demo with your own project deliverable when ready.",
  "",
  "### Links",
  "",
  "- Jump back to [another section](#overview).",
  "- Visit the [Markdown Guide](https://www.markdownguide.org/) for syntax reference.",
  "",
].join("\n");

export interface EnsureSampleDocsResult {
  created: boolean;
  filePath: string;
}

export function getSampleDocsWorkspaceRoot(): string {
  const homeDir = process.env.HOME?.trim() || os.homedir();
  const defaultDocsRoot = path.join(homeDir, "entity-workspace");
  return (
    process.env.ENTITY_WORKSPACE_ROOT?.trim() ||
    process.env.WORKSPACE?.trim() ||
    defaultDocsRoot
  );
}

export function getSampleDocPath(): string {
  return path.join(
    getSampleDocsWorkspaceRoot(),
    "output",
    SAMPLE_DOC_FILENAME,
  );
}

export async function ensureSampleDocs(): Promise<EnsureSampleDocsResult> {
  const filePath = getSampleDocPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  try {
    await fs.writeFile(filePath, SAMPLE_DOC_MARKDOWN, { flag: "wx" });
    return { created: true, filePath };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      return { created: false, filePath };
    }
    throw err;
  }
}
