import type {
  ActivityEventPayload,
  ActivityEventType,
  ActivityType,
} from "../../../db/src";

interface CreateActivityLoggerDeps {
  activityRepository: any;
  broadcast: (data: unknown) => void;
}

export function createActivityLogger(deps: CreateActivityLoggerDeps) {
  const { activityRepository, broadcast } = deps;
  return function logActivity(input: {
    source: "agent" | "task";
    type: ActivityType;
    activityEventType?: ActivityEventType | string;
    activityEventPayload?: Partial<ActivityEventPayload> | Record<string, unknown>;
    action: string;
    description: string;
    agentName?: string;
    agentEmoji?: string;
    filePath?: string;
    taskId?: number;
    taskColumn?: string;
    metadata?: Record<string, unknown>;
  }) {
    try {
      const activity = activityRepository.createActivity({
        source: input.source,
        type: input.type,
        activity_event_type: input.activityEventType,
        activity_event_payload: input.activityEventPayload,
        action: input.action,
        description: input.description,
        agent_name: input.agentName || "Entity",
        agent_emoji: input.agentEmoji || "⚡",
        file_path: input.filePath,
        task_id: input.taskId,
        task_column: input.taskColumn,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      });
      broadcast({ type: "activity:created", activity });
      return activity;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown activity error";
      console.error("[Activity] Failed to log activity:", message);
      return null;
    }
  };
}
