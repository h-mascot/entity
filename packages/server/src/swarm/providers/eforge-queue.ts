import fs from "fs/promises";
import path from "path";
import type { BuildJobPayload } from "./interface";

export interface EforgeQueueWriteResult {
  queueFile: string;
  slug: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "swarm-job";
}

export async function writeEforgeQueueFile(
  queueDir: string,
  job: BuildJobPayload,
  metadata: Record<string, unknown> = {},
): Promise<EforgeQueueWriteResult> {
  const slug = slugify(job.title);
  const queuePath = path.resolve(queueDir);
  await fs.mkdir(queuePath, { recursive: true });

  const frontmatter = [
    "---",
    "source: entity-swarm",
    `job_id: ${job.jobId}`,
    `title: ${JSON.stringify(job.title)}`,
    `repo: ${JSON.stringify(job.repo)}`,
    `branch: ${JSON.stringify(job.branch || "main")}`,
    `generated_at: ${JSON.stringify(new Date().toISOString())}`,
    ...Object.entries(metadata).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
    "---",
  ].join("\n");

  const body = [
    frontmatter,
    "",
    `# ${job.title}`,
    "",
    "## Objective",
    job.spec,
    "",
    "## Execution context",
    `- Repo: ${job.repo}`,
    `- Branch: ${job.branch || "main"}`,
    `- Job ID: ${job.jobId}`,
    ...(job.context ? ["", "## Context", job.context] : []),
    ...(job.feedback ? ["", "## Prior feedback", job.feedback] : []),
  ].join("\n");

  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}-${job.jobId}.md`;
  const fullPath = path.join(queuePath, filename);
  await fs.writeFile(fullPath, body, "utf8");
  return { queueFile: fullPath, slug };
}
