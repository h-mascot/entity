import { capitalizeColumn } from "./task-helpers";
import { normalizeTaskOutputLinks } from "../task-output-links";
import { SAMPLE_DOC_OUTPUT_PATH } from "./sample-docs";

interface EnsureSampleTasksDeps {
  logActivity: (input: any) => unknown;
  taskSyncLayer: any;
}

interface SampleTaskSeed {
  name: string;
  description: string;
  column: string;
  assignee: string;
  output?: string;
}

export const SAMPLE_DOC_VIEWER_TASK_NAME =
  "Demo: open a document from task output";
export const SAMPLE_DOC_VIEWER_TASK_OUTPUT =
  `Deliverable ready. Open the rendered document: [Entity Doc Viewer Demo](${SAMPLE_DOC_OUTPUT_PATH})`;

export async function ensureSampleTasks(deps: EnsureSampleTasksDeps): Promise<void> {
  const { logActivity, taskSyncLayer } = deps;
  const sampleTasks: readonly SampleTaskSeed[] = [
    {
      name: "Sample: Product brief review",
      description:
        "Open this card to test editing title, assignee, due date, and description.",
      column: "backlog",
      assignee: "User",
    },
    {
      name: "Sample: QA regression checklist",
      description:
        "Use this to test task detail updates and comments workflow.",
      column: "doing",
      assignee: "Assistant",
    },
    {
      name: "Sample: Weekly planning sync",
      description:
        "Move this card across columns to validate board interactions.",
      column: "review",
      assignee: "Assistant",
    },
    {
      name: SAMPLE_DOC_VIEWER_TASK_NAME,
      description:
        "Open this card to launch a rendered Markdown document from task Output.",
      column: "review",
      assignee: "Assistant",
      output: SAMPLE_DOC_VIEWER_TASK_OUTPUT,
    },
  ];

  try {
    const existingTasks = await taskSyncLayer.listTasks();
    const existingNames = new Set(
      existingTasks.map((task: any) => task.name.trim().toLowerCase()),
    );

    for (const sample of sampleTasks) {
      const normalizedName = sample.name.trim().toLowerCase();
      if (existingNames.has(normalizedName)) {
        continue;
      }

      const created = await taskSyncLayer.createTask({
        name: sample.name,
        description: sample.description,
        column: sample.column,
        assignee: sample.assignee,
        output:
          sample.output === undefined
            ? undefined
            : normalizeTaskOutputLinks(sample.output),
      });
      existingNames.add(normalizedName);

      logActivity({
        source: "task",
        type: "task_created",
        action: "Created task",
        description: `${created.name} in ${capitalizeColumn(created.column)}.`,
        taskId: created.id,
        taskColumn: created.column,
        metadata: { seeded: true },
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Seed] Failed to ensure sample tasks:", message);
  }
}

