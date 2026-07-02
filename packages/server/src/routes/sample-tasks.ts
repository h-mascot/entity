import { capitalizeColumn } from "./task-helpers";

interface EnsureSampleTasksDeps {
  logActivity: (input: any) => unknown;
  taskSyncLayer: any;
}

export async function ensureSampleTasks(deps: EnsureSampleTasksDeps): Promise<void> {
  const { logActivity, taskSyncLayer } = deps;
  const sampleTasks = [
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
  ] as const;

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

