import type { Express, Request, Response } from "express";
import type { TaskRecord, UpdateRoadmapItemInput } from "../../../db/src";
import { asyncHandler } from "../middleware/async-handler";

type RegisterTaskRoutesDeps = Record<string, any>;

export function registerTaskRoutes(app: Express, prefix: "" | "/api", deps: RegisterTaskRoutesDeps): void {
  const {
    AGENT_CONFIG,
    WORKSPACE,
    activityEventService,
    activityRepository,
    addTaskProject,
    broadcast,
    buildMergeAuditNote,
    buildOwnerAccountabilityInbox,
    buildTaskMutationActivityEvent,
    buildTaskPaginationMeta,
    buildTaskPreview,
    buildTaskProjectLabel,
    capitalizeColumn,
    commentMentionResponder,
    completeTaskWithReceipt,
    createProject,
    createRoadmap,
    createRoadmapItem,
    deleteProject,
    deleteRoadmap,
    deleteRoadmapItem,
    deriveTaskWorkDomain,
    deriveSubtaskBreakdown,
    enrichTasksWithSubtaskSummary,
    evidenceArtifactRepository,
    findTaskDuplicateCandidates,
    getPrimaryReviewReason,
    getProjects,
    getRoadmaps,
    getTaskActorFromRequest,
    getTaskHistory,
    getTaskProjects,
    hasAssignedOwner,
    isActiveTaskColumn,
    isReviewGatedTask,
    isValidTaskColumn,
    logActivity,
    mergeTaskMetadataWithParentLink,
    normalizeBlockedInput,
    normalizeBlockerReasonInput,
    normalizeTaskOutputLinks,
    paginateTasks,
    parsePositiveId,
    parsePositiveIdList,
    parseTaskAccountabilityForCreate,
    parseTaskAccountabilityUpdates,
    parseTaskId,
    parseTaskPaginationQuery,
    phase2FlagEnabled,
    phase2Flags,
    pluginHooks,
    readParentTaskId,
    registerCrewRoutes,
    removeTaskProject,
    replaceTaskProjects,
    shouldValidateReviewEntryOnTransition,
    statusForStrategicError,
    syncTaskProjectAssignments,
    taskAgent,
    taskCommentRepository,
    taskHasProjectName,
    taskSyncLayer,
    updateRoadmapItem,
    validateReviewCompletion,
    validateReviewEntry,
    validateTaskAccountability,
    validateTaskDoneReviewGateState,
    withReceiptArtifactRef,
  } = deps;
  const tasksBase = `${prefix}/tasks`;

  const serializeDuplicateCandidates = (
    title: string,
    candidates: ReturnType<typeof findTaskDuplicateCandidates>,
  ) => ({
    title,
    count: candidates.length,
    duplicates: candidates.slice(0, 8).map((candidate: any) => ({
      id: candidate.task.id,
      name: candidate.task.name,
      column: candidate.task.column,
      blocked: candidate.task.blocked,
      assignee: candidate.task.assignee,
      score: Number(candidate.score.toFixed(3)),
      exact: candidate.exact,
      updated_at: candidate.task.updated_at,
    })),
  });

  app.get(`${tasksBase}/duplicates`, asyncHandler(async (req, res) => {
    const title =
      typeof req.query.title === "string" ? req.query.title.trim() : "";
    if (!title) {
      return res
        .status(400)
        .json({ error: "title query parameter is required" });
    }

    const excludeTaskId = parsePositiveId(req.query.excludeTaskId);

    try {
      const tasks = await taskSyncLayer.listTasks();
      const candidates = findTaskDuplicateCandidates(title, tasks, {
        excludeTaskId:
          typeof excludeTaskId === "number" ? excludeTaskId : undefined,
      });
      return res.json(serializeDuplicateCandidates(title, candidates));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.get(tasksBase, asyncHandler(async (req, res) => {
    const pagination = parseTaskPaginationQuery(req.query);
    if ("error" in pagination) {
      return res.status(400).json({ error: pagination.error });
    }
    const rawWorkDomainFilter = req.query.work_domain;
    const workDomainFilter =
      typeof rawWorkDomainFilter === "undefined" ? null : rawWorkDomainFilter;
    if (
      workDomainFilter !== null &&
      (typeof workDomainFilter !== "string" ||
        workDomainFilter.length > 64 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(workDomainFilter))
    ) {
      return res.status(400).json({
        error: "work_domain must be a normalized lowercase slug (1-64 characters)",
      });
    }

    try {
      let tasks = (await taskSyncLayer.listTasks()).map((task: any) => ({
        ...task,
        ...deriveTaskWorkDomain(task),
      }));
      // Support ?column=X filtering (single column)
      const columnFilter =
        typeof req.query.column === "string"
          ? req.query.column.trim().toLowerCase()
          : null;
      if (columnFilter) {
        tasks = tasks.filter((t: any) => t.column === columnFilter);
      }
      // Support ?columns=todo,doing,review (multi-column include filter)
      const columnsFilter =
        typeof req.query.columns === "string"
          ? req.query.columns.trim().toLowerCase()
          : null;
      if (columnsFilter) {
        const allowedColumns = new Set(
          columnsFilter
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        );
        tasks = tasks.filter((t: any) => allowedColumns.has(t.column));
      }
      // Support ?excludeColumns=done,backlog (multi-column exclude filter)
      const excludeColumnsFilter =
        typeof req.query.excludeColumns === "string"
          ? req.query.excludeColumns.trim().toLowerCase()
          : null;
      if (excludeColumnsFilter) {
        const excludedColumns = new Set(
          excludeColumnsFilter
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        );
        tasks = tasks.filter((t: any) => !excludedColumns.has(t.column));
      }

      const projectFilter =
        typeof req.query.project === "string"
          ? req.query.project.trim().toLowerCase()
          : null;
      if (projectFilter && projectFilter !== "all") {
        tasks = tasks.filter((task: any) => taskHasProjectName(task, projectFilter));
      }
      if (workDomainFilter) {
        tasks = tasks.filter(
          (task: any) => task.work_domain === workDomainFilter,
        );
      }

      const enrichedTasks = enrichTasksWithSubtaskSummary(tasks);
      const total = enrichedTasks.length;
      const paginatedTasks = paginateTasks(enrichedTasks, pagination);
      // Only embed activity when explicitly requested (?includeActivity=true)
      // This avoids 296 individual SQLite queries on every poll
      const includeActivity =
        String(req.query.includeActivity ?? "false").toLowerCase() === "true";
      if (includeActivity && (pagination.limit === null || pagination.limit > 500)) {
        return res.status(400).json({
          error: "includeActivity requires an explicit limit of 500 or fewer",
        });
      }
      const result = includeActivity
        ? paginatedTasks.map((task: any) => ({
            ...task,
            activity: activityRepository.listActivitiesByTaskId(task.id, 20),
          }))
        : paginatedTasks;
      res.json({
        tasks: result,
        ...buildTaskPaginationMeta(total, pagination, result.length),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.status(500).json({ error: message });
    }
  }));

  app.get(`${tasksBase}/stale`, asyncHandler(async (req, res) => {
    const hoursRaw = Number(req.query.hours);
    const thresholdHours =
      Number.isFinite(hoursRaw) && hoursRaw > 0 ? hoursRaw : 24;
    const includeBlocked =
      String(req.query.includeBlocked ?? "false").toLowerCase() === "true";

    try {
      const tasks = await taskSyncLayer.listTasks();
      const now = Date.now();
      const stale = tasks
        .filter((task: any) => {
          if (task.column === "done" || task.column === "backlog") {
            return false;
          }
          if (!includeBlocked && task.blocked) {
            return false;
          }
          const ts = Date.parse(task.updated_at || task.created_at);
          if (Number.isNaN(ts)) {
            return false;
          }
          const ageHours = (now - ts) / (1000 * 60 * 60);
          return ageHours >= thresholdHours;
        })
        .map((task: any) => {
          const ts = Date.parse(task.updated_at || task.created_at);
          const ageHours = Number.isNaN(ts)
            ? null
            : Number(((now - ts) / (1000 * 60 * 60)).toFixed(1));
          return { ...task, stale_hours: ageHours };
        });

      return res.json({
        threshold_hours: thresholdHours,
        count: stale.length,
        tasks: stale,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.get(`${tasksBase}/owner-inbox`, asyncHandler(async (req, res) => {
    const ownerPrincipalId =
      typeof req.query.ownerPrincipalId === "string"
        ? req.query.ownerPrincipalId.trim()
        : typeof req.query.owner_principal_id === "string"
          ? req.query.owner_principal_id.trim()
          : "";
    if (!ownerPrincipalId) {
      return res.status(400).json({ error: "ownerPrincipalId query parameter is required" });
    }

    const stalledHoursRaw = Number(req.query.stalledHours);
    const stalledHours = Number.isFinite(stalledHoursRaw) && stalledHoursRaw > 0 ? stalledHoursRaw : 24;

    try {
      const tasks = await taskSyncLayer.listTasks();
      return res.json(buildOwnerAccountabilityInbox({
        ownerPrincipalId,
        tasks,
        stalledHours,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.get(`${tasksBase}/:id`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      // Always include activity for single-task detail view
      const activity = activityRepository.listActivitiesByTaskId(id, 20);
      const subtasks = await taskSyncLayer.listSubtasks(id);
      const enrichedTask = enrichTasksWithSubtaskSummary([
        task,
        ...subtasks,
      ]).find((entry: any) => entry.id === id) ?? {
        ...task,
        parent_task_id: readParentTaskId(task.metadata),
        subtask_count: subtasks.length,
        subtask_done_count: subtasks.filter((entry: any) => entry.column === "done")
          .length,
      };
      return res.json({ ...enrichedTask, activity, subtasks });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.post(tasksBase, asyncHandler(async (req, res) => {
    const {
      name,
      description,
      column,
      assignee,
      metadata,
      blocked,
      blocker_reason,
      project,
      projectIds,
      due_date,
      due_at,
      priority,
      estimate_hours,
      time_spent,
      output,
      brief,
      origin_channel,
      progress_status,
      recurring,
      recurring_config,
      model,
      worktype,
      policy_inputs_json,
      create_anyway,
      dedupe_override,
      createAnyway,
    } = req.body as {
      name?: string;
      description?: string;
      column?: string;
      assignee?: string;
      metadata?: string;
      blocked?: unknown;
      blocker_reason?: unknown;
      project?: string;
      projectIds?: unknown;
      due_date?: string;
      due_at?: string;
      priority?: string;
      estimate_hours?: number;
      time_spent?: number;
      output?: string;
      brief?: string;
      origin_channel?: string;
      progress_status?: string;
      recurring?: unknown;
      recurring_config?: string;
      model?: string;
      worktype?: string;
      policy_inputs_json?: string;
      create_anyway?: unknown;
      dedupe_override?: unknown;
      createAnyway?: unknown;
    };

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }

    const accountability = parseTaskAccountabilityForCreate(
      req.body as Record<string, unknown>,
      getTaskActorFromRequest(req),
    );
    if ("error" in accountability) {
      return res.status(400).json(accountability);
    }

    const requestedColumn =
      typeof column === "string" ? column.trim().toLowerCase() : "backlog";
    const requestedAssignee = typeof assignee === "string" ? assignee : null;
    const createAnywayOverride =
      normalizeBlockedInput(create_anyway) ??
      normalizeBlockedInput(dedupe_override) ??
      normalizeBlockedInput(createAnyway) ??
      false;

    const accountabilityCheck = validateTaskAccountability({
      column: requestedColumn,
      assignee: requestedAssignee,
      executor_principal_id: accountability.executor_principal_id,
      taskmaster_drivable: accountability.taskmaster_drivable,
      owner_principal_type: accountability.owner_principal_type,
    });
    if (!accountabilityCheck.ok) {
      return res.status(400).json({
        error: accountabilityCheck.error,
        message: accountabilityCheck.message,
      });
    }

    try {
      let requestedProjectIds: number[] | undefined;
      let requestedProjectLabel = project;
      if (typeof projectIds !== "undefined") {
        const parsedProjectIds = parsePositiveIdList(projectIds);
        if (!parsedProjectIds) {
          return res.status(400).json({
            error: "projectIds must be an array of positive integers",
          });
        }
        requestedProjectIds = parsedProjectIds;

        const availableProjects = getProjects();
        const availableProjectIds = new Set(
          availableProjects.map((candidate: any) => candidate.id),
        );
        for (const candidateId of requestedProjectIds!) {
          if (!availableProjectIds.has(candidateId)) {
            return res
              .status(404)
              .json({ error: `project ${candidateId} not found` });
          }
        }

        requestedProjectLabel = buildTaskProjectLabel(
          requestedProjectIds,
          availableProjects,
          "General",
        );
      }

      const normalizedDueDate =
        typeof due_date === "string"
          ? due_date
          : typeof due_at === "string"
            ? due_at
            : undefined;
      const normalizedOutput = normalizeTaskOutputLinks(output) ?? undefined;
      const existingTasks = await taskSyncLayer.listTasks();
      const dedupeCandidates = findTaskDuplicateCandidates(name, existingTasks);
      const exactDuplicate =
        dedupeCandidates.find((candidate: any) => candidate.exact) ?? null;
      if (!createAnywayOverride && dedupeCandidates.length > 0) {
        return res.status(409).json({
          error: exactDuplicate
            ? "Duplicate task title"
            : "Potential duplicate tasks found",
          message: exactDuplicate
            ? `An active task with the same normalized title already exists (#${exactDuplicate.task.id}).`
            : "Similar active tasks already exist. Merge or use create_anyway=true to create anyway.",
          duplicateType: exactDuplicate ? "exact" : "fuzzy",
          ...serializeDuplicateCandidates(name.trim(), dedupeCandidates),
          allowCreateAnyway: true,
        });
      }
      if (requestedColumn === "review") {
        const reviewAssessment = await taskAgent.assessReview(
          buildTaskPreview({
            name: name.trim(),
            description,
            brief,
            origin_channel,
            column: requestedColumn,
            model,
            assignee: requestedAssignee,
            blocked: normalizeBlockedInput(blocked) ?? false,
            blocker_reason: normalizeBlockerReasonInput(blocker_reason) ?? null,
            due_date: normalizedDueDate,
            priority,
            estimate_hours,
            time_spent,
            output: output ?? null,
            progress_status,
            recurring: normalizeBlockedInput(recurring) ?? false,
            recurring_config,
            metadata,
          }),
        );
        if (reviewAssessment.verdict === "INVALID") {
          return res.status(400).json({
            error: "Invalid review output",
            message: getPrimaryReviewReason(reviewAssessment),
            review: {
              verdict: reviewAssessment.verdict,
              score: reviewAssessment.score,
              taskType: reviewAssessment.taskType,
              evidenceStatus: reviewAssessment.evidenceStatus,
              reasons: reviewAssessment.reasons,
            },
          });
        }
      }
      const task = await taskSyncLayer.createTask({
        name,
        description,
        column,
        assignee,
        ...accountability,
        blocked: normalizeBlockedInput(blocked),
        blocker_reason: normalizeBlockerReasonInput(blocker_reason),
        project: requestedProjectLabel,
        metadata,
        due_date: normalizedDueDate,
        priority,
        estimate_hours,
        time_spent,
        output: normalizedOutput,
        brief,
        origin_channel,
        progress_status,
        recurring: normalizeBlockedInput(recurring),
        recurring_config,
        model,
        worktype,
        policy_inputs_json,
      });

      let responseTask = task;
      if (requestedProjectIds !== undefined) {
        replaceTaskProjects(task.id, requestedProjectIds);
        responseTask = (await taskSyncLayer.getTask(task.id)) ?? task;
      }

      const activityEvent = buildTaskMutationActivityEvent({
        action: "create",
        task: responseTask,
        actorPrincipalId: getTaskActorFromRequest(req),
      });
      logActivity({
        source: "task",
        type:
          responseTask.column === "done" ? "task_completed" : "task_created",
        activityEventType: activityEvent.eventType,
        activityEventPayload: activityEvent.payload,
        action:
          responseTask.column === "done" ? "Completed task" : "Created task",
        description: `${responseTask.name} in ${capitalizeColumn(responseTask.column)}.`,
        agentName: responseTask.assignee || undefined,
        taskId: responseTask.id,
        taskColumn: responseTask.column,
        metadata: {
          taskName: responseTask.name,
          assignee: responseTask.assignee,
        },
      });
      broadcast({ type: "task:created", task: responseTask });
      await pluginHooks.emit("task:created", { task: responseTask });

      if (AGENT_CONFIG.enabled && responseTask.column === "review") {
        void taskAgent.handleTaskMovedToReview(responseTask).catch((err: any) => {
          const message =
            err instanceof Error ? err.message : "Unknown agent hook error";
          console.error("[TaskAgent] review_check hook failed:", message);
        });
      }

      return res.status(201).json(responseTask);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  const handleUpdateTask = async (
    req: Request,
    res: Response,
  ) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const {
      name,
      description,
      column,
      assignee,
      metadata,
      blocked,
      blocker_reason,
      project,
      projectIds,
      due_date,
      due_at,
      priority,
      estimate_hours,
      time_spent,
      output,
      brief,
      origin_channel,
      progress_status,
      recurring,
      recurring_config,
      model,
      worktype,
      policy_inputs_json,
      create_anyway,
      dedupe_override,
      createAnyway,
    } = req.body as {
      name?: string;
      description?: string;
      column?: string;
      assignee?: string;
      metadata?: string;
      blocked?: unknown;
      blocker_reason?: unknown;
      project?: string;
      projectIds?: unknown;
      due_date?: string;
      due_at?: string;
      priority?: string;
      estimate_hours?: number;
      time_spent?: number;
      output?: string;
      brief?: string;
      origin_channel?: string;
      progress_status?: string;
      recurring?: unknown;
      recurring_config?: string;
      model?: string;
      worktype?: string;
      policy_inputs_json?: string;
      create_anyway?: unknown;
      dedupe_override?: unknown;
      createAnyway?: unknown;
    };
    try {
      const existingTask = await taskSyncLayer.getTask(id);
      if (!existingTask) {
        return res.status(404).json({ error: "task not found" });
      }
      const accountabilityUpdates = parseTaskAccountabilityUpdates(
        req.body as Record<string, unknown>,
      );

      let requestedProjectIds: number[] | undefined;
      let requestedProjectLabel = project;
      if (typeof projectIds !== "undefined") {
        const parsedProjectIds = parsePositiveIdList(projectIds);
        if (!parsedProjectIds) {
          return res.status(400).json({
            error: "projectIds must be an array of positive integers",
          });
        }
        requestedProjectIds = parsedProjectIds;

        const availableProjects = getProjects();
        const availableProjectIds = new Set(
          availableProjects.map((candidate: any) => candidate.id),
        );
        for (const candidateId of requestedProjectIds!) {
          if (!availableProjectIds.has(candidateId)) {
            return res
              .status(404)
              .json({ error: `project ${candidateId} not found` });
          }
        }

        requestedProjectLabel = buildTaskProjectLabel(
          requestedProjectIds,
          availableProjects,
          "General",
        );
      }

      const normalizedDueDate =
        typeof due_date === "string"
          ? due_date
          : typeof due_at === "string"
            ? due_at
            : undefined;

      if (column !== undefined && !isValidTaskColumn(column)) {
        return res.status(400).json({ error: "invalid column" });
      }

      // WIP Limit: max 10 tasks in Doing at a time
      const WIP_LIMIT = 10;
      if (column === "doing" && existingTask.column !== "doing") {
        const allTasks = await taskSyncLayer.listTasks();
        const doingCount = allTasks.filter((t: any) => t.column === "doing").length;
        if (doingCount >= WIP_LIMIT) {
          return res.status(409).json({
            error: "WIP Limit Reached",
            message: `Cannot move to Doing. Currently ${doingCount}/${WIP_LIMIT} tasks in Doing. Move existing tasks to Review/Done first.`,
            doingCount,
            limit: WIP_LIMIT,
          });
        }
      }

      if (typeof name === "string" && !name.trim()) {
        return res.status(400).json({ error: "name cannot be empty" });
      }

      const createAnywayOverride =
        normalizeBlockedInput(create_anyway) ??
        normalizeBlockedInput(dedupe_override) ??
        normalizeBlockedInput(createAnyway) ??
        false;
      const candidateName =
        typeof name === "string" ? name.trim() : existingTask.name;
      if (candidateName) {
        const allTasks = await taskSyncLayer.listTasks();
        const dedupeCandidates = findTaskDuplicateCandidates(
          candidateName,
          allTasks,
          { excludeTaskId: existingTask.id },
        );
        const exactDuplicate =
          dedupeCandidates.find((candidate: any) => candidate.exact) ?? null;
        if (!createAnywayOverride && dedupeCandidates.length > 0) {
          return res.status(409).json({
            error: exactDuplicate
              ? "Duplicate task title"
              : "Potential duplicate tasks found",
            message: exactDuplicate
              ? `An active task with the same normalized title already exists (#${exactDuplicate.task.id}).`
              : "Similar active tasks already exist. Merge or use create_anyway=true to keep this update.",
            duplicateType: exactDuplicate ? "exact" : "fuzzy",
            ...serializeDuplicateCandidates(candidateName, dedupeCandidates),
            allowCreateAnyway: true,
          });
        }
      }

      const nextColumn =
        typeof column === "string"
          ? column.trim().toLowerCase()
          : existingTask.column;
      const nextAssignee =
        typeof assignee === "string" ? assignee : existingTask.assignee;
      const nextExecutor =
        typeof accountabilityUpdates.executor_principal_id === "string"
          ? accountabilityUpdates.executor_principal_id
          : existingTask.executor_principal_id;
      const nextTaskmasterDrivable =
        typeof accountabilityUpdates.taskmaster_drivable === "boolean"
          ? accountabilityUpdates.taskmaster_drivable
          : Boolean(existingTask.taskmaster_drivable);
      const nextOwnerPrincipalType =
        typeof accountabilityUpdates.owner_principal_type === "string"
          ? accountabilityUpdates.owner_principal_type
          : existingTask.owner_principal_type;
      const existingTaskIsOwnerlessActive =
        isActiveTaskColumn(existingTask.column) &&
        !hasAssignedOwner(existingTask.assignee) &&
        !hasAssignedOwner(existingTask.executor_principal_id ?? null) &&
        !existingTask.taskmaster_drivable;
      const accountabilityCheck = validateTaskAccountability({
        column: nextColumn,
        assignee: nextAssignee,
        executor_principal_id: nextExecutor,
        taskmaster_drivable: nextTaskmasterDrivable,
        owner_principal_type: nextOwnerPrincipalType,
      });
      if (
        !accountabilityCheck.ok &&
        (!existingTaskIsOwnerlessActive ||
          assignee !== undefined ||
          column !== undefined ||
          Object.keys(accountabilityUpdates).length > 0)
      ) {
        return res.status(400).json({
          error: accountabilityCheck.error,
          message: accountabilityCheck.message,
        });
      }

      const movingToReview = shouldValidateReviewEntryOnTransition(
        existingTask.column,
        nextColumn,
      );
      const normalizedOutput = normalizeTaskOutputLinks(output) ?? undefined;
      if (movingToReview && phase2FlagEnabled(phase2Flags, "review_gate_policy_enforcement")) {
        const reviewEntry = validateReviewEntry(
          metadata ?? existingTask.metadata,
        );
        if (!reviewEntry.ok) {
          return res.status(400).json({
            error: "Invalid review packet",
            message: reviewEntry.message ?? "Review packet failed validation.",
            review: reviewEntry.metadata,
          });
        }

        const reviewAssessment = await taskAgent.assessReview(
          buildTaskPreview({
            ...existingTask,
            name: typeof name === "string" ? name.trim() : existingTask.name,
            description: description ?? existingTask.description,
            brief: brief ?? existingTask.brief,
            origin_channel: origin_channel ?? existingTask.origin_channel,
            column: nextColumn,
            model: model ?? existingTask.model,
            assignee: nextAssignee,
            blocked: normalizeBlockedInput(blocked) ?? existingTask.blocked,
            blocker_reason:
              normalizeBlockerReasonInput(blocker_reason) ??
              existingTask.blocker_reason,
            due_date: normalizedDueDate ?? existingTask.due_date,
            priority: priority ?? existingTask.priority,
            estimate_hours: estimate_hours ?? existingTask.estimate_hours,
            time_spent: time_spent ?? existingTask.time_spent,
            output: normalizedOutput ?? existingTask.output,
            progress_status: progress_status ?? existingTask.progress_status,
            recurring:
              normalizeBlockedInput(recurring) ?? existingTask.recurring,
            recurring_config: recurring_config ?? existingTask.recurring_config,
            metadata: metadata ?? existingTask.metadata,
            created_at: existingTask.created_at,
            updated_at: existingTask.updated_at,
          }),
        );
        if (reviewAssessment.verdict === "INVALID") {
          return res.status(400).json({
            error: "Invalid review output",
            message: getPrimaryReviewReason(reviewAssessment),
            review: {
              verdict: reviewAssessment.verdict,
              score: reviewAssessment.score,
              taskType: reviewAssessment.taskType,
              evidenceStatus: reviewAssessment.evidenceStatus,
              reasons: reviewAssessment.reasons,
            },
          });
        }
      }

      const completionMetadata = metadata ?? existingTask.metadata;
      const movingToDone =
        nextColumn === "done" &&
        existingTask.column !== "done";
      if (movingToDone && phase2FlagEnabled(phase2Flags, "review_gate_policy_enforcement")) {
        const reviewGateState = validateTaskDoneReviewGateState(existingTask);
        if (!reviewGateState.ok) {
          return res.status(reviewGateState.status).json({
            error: reviewGateState.code,
            message: reviewGateState.message,
          });
        }
      }
      if (
        movingToDone &&
        phase2FlagEnabled(phase2Flags, "review_gate_policy_enforcement") &&
        isReviewGatedTask(completionMetadata)
      ) {
        const completionCheck = validateReviewCompletion(
          { ...existingTask, metadata: completionMetadata },
          getTaskActorFromRequest(req),
        );
        if (!completionCheck.ok) {
          return res.status(400).json({
            error: "Invalid review completion",
            message:
              completionCheck.message ?? "Review completion failed validation.",
            review: completionCheck.metadata,
          });
        }
      }

      const taskUpdates = {
        name,
        description,
        column,
        assignee,
        ...accountabilityUpdates,
        blocked: normalizeBlockedInput(blocked),
        blocker_reason: normalizeBlockerReasonInput(blocker_reason),
        project: requestedProjectLabel,
        metadata,
        due_date: normalizedDueDate,
        priority,
        estimate_hours,
        time_spent,
        output: normalizedOutput,
        brief,
        origin_channel,
        progress_status,
        recurring: normalizeBlockedInput(recurring),
        recurring_config,
        model,
        worktype,
        policy_inputs_json,
      };

      let receiptArtifactId: string | null = null;
      let receiptContentHash: string | undefined;
      const task = movingToDone && phase2FlagEnabled(phase2Flags, "receipt_completion_enforcement")
        ? (await completeTaskWithReceipt(
            {
              previousTask: existingTask,
              nextTask: {
                ...existingTask,
                name: typeof name === "string" ? name.trim() : existingTask.name,
                description: description ?? existingTask.description,
                column: "done",
                assignee: nextAssignee ?? null,
                executor_principal_id: nextExecutor ?? null,
                assignment_state:
                  accountabilityUpdates.assignment_state ?? existingTask.assignment_state,
                metadata: completionMetadata,
                output: normalizedOutput ?? existingTask.output,
                project: requestedProjectLabel ?? existingTask.project,
              },
              actorPrincipalId: getTaskActorFromRequest(req),
              updates: taskUpdates,
            },
            {
              storageRoot: WORKSPACE,
              artifactRepository: evidenceArtifactRepository,
              activityRepository,
              updateTask: (taskId: any, updates: any) => taskSyncLayer.updateTask(taskId, updates),
            },
          ).then((result: any) => {
            receiptArtifactId = result.artifact.id;
            receiptContentHash = result.artifact.content_hash;
            return result.task;
          }))
        : await taskSyncLayer.updateTask(id, taskUpdates);

      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      let responseTask = task;
      if (requestedProjectIds !== undefined) {
        replaceTaskProjects(task.id, requestedProjectIds);
        responseTask = (await taskSyncLayer.getTask(task.id)) ?? task;
      }

      const becameDone =
        existingTask.column !== "done" && responseTask.column === "done";
      const activityEvent = buildTaskMutationActivityEvent({
        action: "update",
        previousTask: existingTask,
        task: responseTask,
        actorPrincipalId: getTaskActorFromRequest(req),
      });
      const activityEventPayload = withReceiptArtifactRef(
        activityEvent.payload,
        receiptArtifactId,
        receiptContentHash,
      );
      logActivity({
        source: "task",
        type: becameDone ? "task_completed" : "task_updated",
        activityEventType: activityEvent.eventType,
        activityEventPayload: activityEventPayload,
        action: becameDone ? "Completed task" : "Updated task",
        description: `${responseTask.name} in ${capitalizeColumn(responseTask.column)}.`,
        agentName: responseTask.assignee || undefined,
        taskId: responseTask.id,
        taskColumn: responseTask.column,
        metadata: {
          taskName: responseTask.name,
          assignee: responseTask.assignee,
        },
      });
      broadcast({ type: "task:updated", task: responseTask });
      await pluginHooks.emit("task:updated", {
        previousTask: existingTask,
        task: responseTask,
      });

      if (AGENT_CONFIG.enabled) {
        const movedToReview =
          existingTask.column !== "review" && responseTask.column === "review";
        const missingOutputInReview =
          responseTask.column === "review" &&
          (!responseTask.output || !responseTask.output.trim());
        const activeWithoutOwner =
          isActiveTaskColumn(responseTask.column) &&
          !hasAssignedOwner(responseTask.assignee) &&
          !hasAssignedOwner(responseTask.executor_principal_id ?? null) &&
          !responseTask.taskmaster_drivable;
        if (movedToReview) {
          void taskAgent.handleTaskMovedToReview(responseTask).catch((err: any) => {
            const message =
              err instanceof Error ? err.message : "Unknown agent hook error";
            console.error("[TaskAgent] review_check hook failed:", message);
          });
        } else if (missingOutputInReview) {
          void taskAgent.handleOutputMissing(responseTask).catch((err: any) => {
            const message =
              err instanceof Error ? err.message : "Unknown agent hook error";
            console.error("[TaskAgent] output_missing hook failed:", message);
          });
        }

        if (activeWithoutOwner) {
          void taskAgent.handleOwnershipGap(responseTask).catch((err: any) => {
            const message =
              err instanceof Error ? err.message : "Unknown agent hook error";
            console.error("[TaskAgent] ownership_check hook failed:", message);
          });
        }
      }

      return res.json(responseTask);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  };

  app.put(`${tasksBase}/:id`, asyncHandler(handleUpdateTask));
  app.patch(`${tasksBase}/:id`, asyncHandler(handleUpdateTask));

  app.post(`${tasksBase}/:id/merge`, asyncHandler(async (req, res) => {
    const targetTaskId = parseTaskId(req.params.id);
    if (!targetTaskId) {
      return res.status(400).json({ error: "invalid target task id" });
    }

    const sourceTaskId = parsePositiveId(
      req.body?.sourceTaskId ?? req.body?.source_task_id,
    );
    if (!sourceTaskId) {
      return res
        .status(400)
        .json({ error: "sourceTaskId must be a positive integer" });
    }

    if (sourceTaskId === targetTaskId) {
      return res
        .status(400)
        .json({ error: "source and target tasks must be different" });
    }

    try {
      const targetTask = await taskSyncLayer.getTask(targetTaskId);
      const sourceTask = await taskSyncLayer.getTask(sourceTaskId);
      if (!targetTask || !sourceTask) {
        return res.status(404).json({ error: "task not found" });
      }

      const mergeNote = buildMergeAuditNote(sourceTask, targetTask);
      const targetAuditComment = taskCommentRepository.createComment({
        task_id: targetTask.id,
        body: mergeNote,
        author: "Task Merge Bot",
      });

      const sourceComments = taskCommentRepository.listComments(sourceTask.id);
      let copiedComments = 0;
      for (const comment of sourceComments) {
        const copiedBody = `↪️ Merged from #${sourceTask.id} comment by ${comment.author || "unknown"}:\n${comment.body}`;
        taskCommentRepository.createComment({
          task_id: targetTask.id,
          body: copiedBody,
          author: "Task Merge Bot",
        });
        copiedComments += 1;
      }

      taskCommentRepository.createComment({
        task_id: sourceTask.id,
        body: `🔒 Archived after merge into #${targetTask.id}.`,
        author: "Task Merge Bot",
      });

      const archivedSource = await taskSyncLayer.updateTask(sourceTask.id, {
        archived: true,
        column: "done",
        blocked: false,
        blocker_reason: `Merged into #${targetTask.id}`,
      });

      if (!archivedSource) {
        return res
          .status(500)
          .json({ error: "failed to archive source task after merge" });
      }

      logActivity({
        source: "task",
        type: "task_updated",
        action: "Merged duplicate task",
        description: `Merged task #${sourceTask.id} into #${targetTask.id}.`,
        agentName: targetTask.assignee || undefined,
        taskId: targetTask.id,
        taskColumn: targetTask.column,
        metadata: { sourceTaskId: sourceTask.id, targetTaskId: targetTask.id },
      });

      logActivity({
        source: "task",
        type: "task_updated",
        action: "Archived via merge",
        description: `Archived duplicate task after merge into #${targetTask.id}.`,
        agentName: sourceTask.assignee || undefined,
        taskId: sourceTask.id,
        taskColumn: archivedSource.column,
        metadata: { sourceTaskId: sourceTask.id, targetTaskId: targetTask.id },
      });

      broadcast({
        type: "task:comment",
        taskId: targetTask.id,
        comment: targetAuditComment,
      });
      broadcast({ type: "task:updated", task: archivedSource });
      await pluginHooks.emit("task:updated", {
        previousTask: sourceTask,
        task: archivedSource,
      });

      return res.json({
        merged: true,
        targetTaskId: targetTask.id,
        sourceTaskId: sourceTask.id,
        copiedComments,
        sourceArchived: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.put(`${tasksBase}/:id/move`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const column = req.body?.column;
    if (!isValidTaskColumn(column)) {
      return res.status(400).json({ error: "valid column required" });
    }

    try {
      const existingTask = await taskSyncLayer.getTask(id);
      if (!existingTask) {
        return res.status(404).json({ error: "task not found" });
      }

      const accountabilityCheck = validateTaskAccountability({
        column,
        assignee: existingTask.assignee,
        executor_principal_id: existingTask.executor_principal_id,
        taskmaster_drivable: existingTask.taskmaster_drivable,
        owner_principal_type: existingTask.owner_principal_type,
      });
      if (!accountabilityCheck.ok) {
        return res.status(400).json({
          error: accountabilityCheck.error,
          message: accountabilityCheck.message,
        });
      }

      if (
        shouldValidateReviewEntryOnTransition(existingTask.column, column) &&
        phase2FlagEnabled(phase2Flags, "review_gate_policy_enforcement")
      ) {
        const reviewEntry = validateReviewEntry(existingTask.metadata);
        if (!reviewEntry.ok) {
          return res.status(400).json({
            error: "Invalid review packet",
            message: reviewEntry.message ?? "Review packet failed validation.",
            review: reviewEntry.metadata,
          });
        }

        const reviewAssessment = await taskAgent.assessReview(
          buildTaskPreview({
            ...existingTask,
            column,
          }),
        );
        if (reviewAssessment.verdict === "INVALID") {
          return res.status(400).json({
            error: "Invalid review output",
            message: getPrimaryReviewReason(reviewAssessment),
            review: {
              verdict: reviewAssessment.verdict,
              score: reviewAssessment.score,
              taskType: reviewAssessment.taskType,
              evidenceStatus: reviewAssessment.evidenceStatus,
              reasons: reviewAssessment.reasons,
            },
          });
        }
      }

      if (
        column === "done" &&
        existingTask.column !== "done" &&
        phase2FlagEnabled(phase2Flags, "review_gate_policy_enforcement")
      ) {
        const reviewGateState = validateTaskDoneReviewGateState(existingTask);
        if (!reviewGateState.ok) {
          return res.status(reviewGateState.status).json({
            error: reviewGateState.code,
            message: reviewGateState.message,
          });
        }
      }

      if (
        column === "done" &&
        existingTask.column !== "done" &&
        phase2FlagEnabled(phase2Flags, "review_gate_policy_enforcement") &&
        isReviewGatedTask(existingTask.metadata)
      ) {
        const completionCheck = validateReviewCompletion(
          existingTask,
          getTaskActorFromRequest(req),
        );
        if (!completionCheck.ok) {
          return res.status(400).json({
            error: "Invalid review completion",
            message:
              completionCheck.message ?? "Review completion failed validation.",
            review: completionCheck.metadata,
          });
        }
      }

      let receiptArtifactId: string | null = null;
      let receiptContentHash: string | undefined;
      const task = column === "done" &&
        existingTask.column !== "done" &&
        phase2FlagEnabled(phase2Flags, "receipt_completion_enforcement")
        ? (await completeTaskWithReceipt(
            {
              previousTask: existingTask,
              nextTask: {
                ...existingTask,
                column: "done",
              },
              actorPrincipalId: getTaskActorFromRequest(req),
              updates: { column: "done" },
            },
            {
              storageRoot: WORKSPACE,
              artifactRepository: evidenceArtifactRepository,
              activityRepository,
              updateTask: (taskId: any, updates: any) => taskSyncLayer.updateTask(taskId, updates),
            },
          ).then((result: any) => {
            receiptArtifactId = result.artifact.id;
            receiptContentHash = result.artifact.content_hash;
            return result.task;
          }))
        : await taskSyncLayer.moveTask(id, column);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const activityEvent = buildTaskMutationActivityEvent({
        action: "move",
        previousTask: existingTask,
        task,
        actorPrincipalId: getTaskActorFromRequest(req),
      });
      const activityEventPayload = withReceiptArtifactRef(
        activityEvent.payload,
        receiptArtifactId,
        receiptContentHash,
      );
      logActivity({
        source: "task",
        type: task.column === "done" ? "task_completed" : "task_moved",
        activityEventType: activityEvent.eventType,
        activityEventPayload: activityEventPayload,
        action: task.column === "done" ? "Completed task" : "Moved task",
        description: `${task.name} moved to ${capitalizeColumn(task.column)}.`,
        agentName: task.assignee || undefined,
        taskId: task.id,
        taskColumn: task.column,
        metadata: { taskName: task.name, assignee: task.assignee },
      });
      broadcast({ type: "task:moved", taskId: id, column: task.column });
      await pluginHooks.emit("task:moved", {
        previousTask: existingTask,
        task,
        taskId: id,
        fromColumn: existingTask.column,
        toColumn: task.column,
      });

      if (
        AGENT_CONFIG.enabled &&
        existingTask.column !== "review" &&
        task.column === "review"
      ) {
        void taskAgent.handleTaskMovedToReview(task).catch((err: any) => {
          const message =
            err instanceof Error ? err.message : "Unknown agent hook error";
          console.error("[TaskAgent] review_check hook failed:", message);
        });
      }

      return res.json(task);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.delete(`${tasksBase}/:id`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      const deleted = await taskSyncLayer.deleteTask(id);
      if (!deleted) {
        return res.status(404).json({ error: "task not found" });
      }

      if (task) {
        const activityEvent = buildTaskMutationActivityEvent({
          action: "delete",
          task,
          actorPrincipalId: getTaskActorFromRequest(req),
        });
        logActivity({
          source: "task",
          type: "task_deleted",
          activityEventType: activityEvent.eventType,
          activityEventPayload: activityEvent.payload,
          action: "Deleted task",
          description: `${task.name} removed from ${capitalizeColumn(task.column)}.`,
          agentName: task.assignee || undefined,
          taskId: task.id,
          taskColumn: task.column,
          metadata: { taskName: task.name, assignee: task.assignee },
        });
      }
      broadcast({ type: "task:deleted", taskId: id });
      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.post(`${tasksBase}/:id/note`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { note } = req.body as { note?: unknown; session_id?: unknown };
    if (typeof note !== "string" || !note.trim()) {
      return res.status(400).json({ error: "note required" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      logActivity({
        source: "task",
        type: "task_updated",
        action: "Added note",
        description: note.trim().slice(0, 200),
        agentName: task.assignee || undefined,
        taskId: id,
      });

      const refreshed = await taskSyncLayer.getTask(id);
      if (!refreshed) {
        return res.status(404).json({ error: "task not found" });
      }

      return res.json(refreshed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.get(`${tasksBase}/:id/activity`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const limitRaw = Number(req.query.limit ?? 20);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;

    try {
      const activities = activityRepository.listActivitiesByTaskId(id, limit);
      return res.json(activities);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.post(`${tasksBase}/:id/activity`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { action, user, details, type, session_id } = req.body as {
      action?: unknown;
      user?: unknown;
      details?: unknown;
      type?: unknown;
      session_id?: unknown;
    };

    if (typeof action !== "string" || !action.trim()) {
      return res.status(400).json({ error: "action required" });
    }

    // Skip raw tool_call logs — they spam the activity table (13K/day)
    if (action.trim() === "tool_call") {
      return res.json({ success: true, skipped: true });
    }

    if (typeof details !== "string" || !details.trim()) {
      return res.status(400).json({ error: "details required" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      logActivity({
        source: "task",
        type: "task_updated",
        action: action.trim(),
        description: details.trim(),
        agentName:
          typeof user === "string" && user.trim()
            ? user
            : task.assignee || undefined,
        taskId: id,
        metadata: { user, session_id, activityType: type },
      });

      return res.json({ success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.post(`${tasksBase}/:id/subtasks/auto`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { force } = req.body as { force?: unknown };

    try {
      const parentTask = await taskSyncLayer.getTask(id);
      if (!parentTask) {
        return res.status(404).json({ error: "task not found" });
      }

      const existingTasks = await taskSyncLayer.listTasks();
      const existingSubtasks = existingTasks.filter(
        (entry: any) => readParentTaskId(entry.metadata) === id,
      );
      if (
        existingSubtasks.length > 0 &&
        normalizeBlockedInput(force) !== true
      ) {
        return res.status(409).json({
          error: "subtasks already exist",
          message: "Use force=true to generate additional subtasks.",
          existingCount: existingSubtasks.length,
          subtasks: existingSubtasks,
        });
      }

      const breakdown = deriveSubtaskBreakdown(parentTask);
      const createdSubtasks = [] as Awaited<
        ReturnType<typeof taskSyncLayer.createTask>
      >[];
      const defaultAssignee = parentTask.assignee ?? "Unassigned";
      const defaultColumn =
        parentTask.column === "done" ? "todo" : parentTask.column;

      for (const step of breakdown) {
        const subtask = await taskSyncLayer.createTask({
          name: step.length > 140 ? `${step.slice(0, 137)}...` : step,
          description: `Auto-generated subtask for #${parentTask.id}: ${parentTask.name}`,
          assignee: defaultAssignee,
          column: isValidTaskColumn(defaultColumn) ? defaultColumn : "todo",
          priority: parentTask.priority ?? "P2",
          model: parentTask.model ?? undefined,
          metadata: mergeTaskMetadataWithParentLink(null, parentTask.id),
        });
        createdSubtasks.push(subtask);
      }

      logActivity({
        source: "task",
        type: "task_updated",
        action: "Generated subtasks",
        description: `Auto-generated ${createdSubtasks.length} subtasks for #${parentTask.id}.`,
        agentName: parentTask.assignee || undefined,
        taskId: parentTask.id,
        taskColumn: parentTask.column,
        metadata: { subtaskIds: createdSubtasks.map((entry: any) => entry.id) },
      });

      for (const subtask of createdSubtasks) {
        broadcast({ type: "task:created", task: subtask });
      }

      const refreshedSubtasks = await taskSyncLayer.listSubtasks(id);
      return res.status(201).json({
        taskId: parentTask.id,
        createdCount: createdSubtasks.length,
        subtasks: refreshedSubtasks,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.get(`${tasksBase}/:id/comments`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const limit =
        typeof req.query.limit === "undefined"
          ? undefined
          : Number(req.query.limit);
      if (
        typeof limit !== "undefined" &&
        (!Number.isInteger(limit) || limit <= 0)
      ) {
        return res.status(400).json({ error: "limit must be a positive integer" });
      }
      const beforeId =
        typeof req.query.before_id === "undefined"
          ? undefined
          : Number(req.query.before_id);
      if (
        typeof beforeId !== "undefined" &&
        (!Number.isInteger(beforeId) || beforeId <= 0)
      ) {
        return res.status(400).json({ error: "before_id must be a positive integer" });
      }
      const comments = taskCommentRepository.listComments(id, {
        limit,
        before_id: beforeId,
      });
      return res.json(comments);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));

  app.post(`${tasksBase}/:id/comments`, asyncHandler(async (req, res) => {
    const id = parseTaskId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { body, author, parent_id } = req.body as {
      body?: unknown;
      author?: unknown;
      parent_id?: unknown;
    };
    if (typeof body !== "string" || !body.trim()) {
      return res.status(400).json({ error: "body required" });
    }

    let parentId: number | null = null;
    if (typeof parent_id !== "undefined" && parent_id !== null) {
      const parsed = Number(parent_id);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return res.status(400).json({ error: "invalid parent_id" });
      }
      parentId = parsed;
    }

    try {
      const task = await taskSyncLayer.getTask(id);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const comment = taskCommentRepository.createComment({
        task_id: id,
        body: body.trim(),
        author: typeof author === "string" ? author : undefined,
        parent_id: parentId,
      });

      logActivity({
        source: "task",
        type: "task_comment",
        action: "Added comment",
        description: body.trim().slice(0, 200),
        agentName:
          typeof author === "string" && author.trim()
            ? author
            : task?.assignee || undefined,
        taskId: id,
        metadata: { author, taskName: task?.name },
      });
      broadcast({ type: "task:comment", taskId: id, comment });

      // If the comment @mentions an agent, let the agent read the card and reply
      // (and optionally pick up the task). Fire-and-forget so the POST returns fast.
      void commentMentionResponder(id, comment);

      return res.status(201).json(comment);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res.status(500).json({ error: message });
    }
  }));
}

export function registerStrategicRoutes(app: Express, prefix: "" | "/api", deps: RegisterTaskRoutesDeps): void {
  const {
    addTaskProject,
    buildTaskProjectLabel,
    createCrew,
    createProject,
    createRoadmap,
    createRoadmapItem,
    deleteProject,
    deleteRoadmap,
    deleteRoadmapItem,
    getCrews,
    getProjects,
    getRoadmaps,
    getSubscribersForCrew,
    getSubscriptionsForAgent,
    getTaskHistory,
    getTaskProjects,
    parsePositiveId,
    parsePositiveIdList,
    parseTaskId,
    registerCrewRoutes,
    removeTaskProject,
    replaceTaskProjects,
    statusForStrategicError,
    subscribeToCrew,
    taskSyncLayer,
    unsubscribeFromCrew,
    updateRoadmapItem,
  } = deps;
  const roadmapsBase = `${prefix}/roadmaps`;
  const roadmapItemsBase = `${prefix}/roadmap-items`;
  const projectsBase = `${prefix}/projects`;
  const tasksBase = `${prefix}/tasks`;

  registerCrewRoutes({
    app,
    prefix,
    getCrews,
    createCrew,
    subscribeToCrew,
    unsubscribeFromCrew,
    getSubscribersForCrew,
    getSubscriptionsForAgent,
    statusForError: statusForStrategicError,
  });

  app.get(roadmapsBase, (_req, res) => {
    try {
      const roadmaps = getRoadmaps();
      return res.json(roadmaps);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.post(roadmapsBase, (req, res) => {
    const { name, theme, color } = req.body as {
      name?: unknown;
      theme?: unknown;
      color?: unknown;
    };
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }

    if (
      typeof theme !== "undefined" &&
      theme !== null &&
      typeof theme !== "string"
    ) {
      return res.status(400).json({ error: "theme must be a string" });
    }

    if (
      typeof color !== "undefined" &&
      color !== null &&
      typeof color !== "string"
    ) {
      return res.status(400).json({ error: "color must be a string" });
    }

    try {
      const roadmap = createRoadmap({
        name,
        theme: typeof theme === "string" ? theme : undefined,
        color: typeof color === "string" ? color : undefined,
      });
      return res.status(201).json(roadmap);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.delete(`${roadmapsBase}/:id`, (req, res) => {
    const roadmapId = parsePositiveId(req.params.id);
    if (!roadmapId) {
      return res.status(400).json({ error: "invalid roadmap id" });
    }

    try {
      const deleted = deleteRoadmap(roadmapId);
      if (!deleted) {
        return res.status(404).json({ error: "roadmap not found" });
      }

      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.post(`${roadmapsBase}/:roadmapId/items`, (req, res) => {
    const roadmapId = parsePositiveId(req.params.roadmapId);
    if (!roadmapId) {
      return res.status(400).json({ error: "invalid roadmap id" });
    }

    const {
      title,
      description,
      priority,
      target_period,
      status,
      linked_task_id,
    } = req.body as {
      title?: unknown;
      description?: unknown;
      priority?: unknown;
      target_period?: unknown;
      status?: unknown;
      linked_task_id?: unknown;
    };

    if (typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ error: "title required" });
    }

    if (
      typeof description !== "undefined" &&
      description !== null &&
      typeof description !== "string"
    ) {
      return res.status(400).json({ error: "description must be a string" });
    }

    if (
      typeof priority !== "undefined" &&
      priority !== null &&
      typeof priority !== "string"
    ) {
      return res.status(400).json({ error: "priority must be a string" });
    }

    if (
      typeof target_period !== "undefined" &&
      target_period !== null &&
      typeof target_period !== "string"
    ) {
      return res.status(400).json({ error: "target_period must be a string" });
    }

    if (
      typeof status !== "undefined" &&
      status !== null &&
      typeof status !== "string"
    ) {
      return res.status(400).json({ error: "status must be a string" });
    }

    const linkedTaskId =
      typeof linked_task_id === "undefined" || linked_task_id === null
        ? null
        : parsePositiveId(linked_task_id);
    if (
      typeof linked_task_id !== "undefined" &&
      linked_task_id !== null &&
      !linkedTaskId
    ) {
      return res
        .status(400)
        .json({ error: "linked_task_id must be a positive integer" });
    }

    try {
      const roadmapItem = createRoadmapItem(roadmapId, {
        title,
        description: typeof description === "string" ? description : undefined,
        priority: typeof priority === "string" ? priority : undefined,
        target_period:
          typeof target_period === "string" ? target_period : undefined,
        status: typeof status === "string" ? status : undefined,
        linked_task_id: linkedTaskId,
      });
      return res.status(201).json(roadmapItem);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.patch(`${roadmapItemsBase}/:id`, (req, res) => {
    const roadmapItemId = parsePositiveId(req.params.id);
    if (!roadmapItemId) {
      return res.status(400).json({ error: "invalid roadmap item id" });
    }

    const body = req.body as {
      title?: unknown;
      description?: unknown;
      priority?: unknown;
      target_period?: unknown;
      status?: unknown;
      linked_task_id?: unknown;
    };
    const updates: UpdateRoadmapItemInput = {};
    let hasUpdates = false;

    if (typeof body.title !== "undefined") {
      if (typeof body.title !== "string") {
        return res.status(400).json({ error: "title must be a string" });
      }
      updates.title = body.title;
      hasUpdates = true;
    }

    if (typeof body.description !== "undefined") {
      if (body.description !== null && typeof body.description !== "string") {
        return res
          .status(400)
          .json({ error: "description must be a string or null" });
      }
      updates.description = body.description as string | null;
      hasUpdates = true;
    }

    if (typeof body.priority !== "undefined") {
      if (typeof body.priority !== "string") {
        return res.status(400).json({ error: "priority must be a string" });
      }
      updates.priority = body.priority;
      hasUpdates = true;
    }

    if (typeof body.target_period !== "undefined") {
      if (
        body.target_period !== null &&
        typeof body.target_period !== "string"
      ) {
        return res
          .status(400)
          .json({ error: "target_period must be a string or null" });
      }
      updates.target_period = body.target_period as string | null;
      hasUpdates = true;
    }

    if (typeof body.status !== "undefined") {
      if (typeof body.status !== "string") {
        return res.status(400).json({ error: "status must be a string" });
      }
      updates.status = body.status;
      hasUpdates = true;
    }

    if (typeof body.linked_task_id !== "undefined") {
      if (body.linked_task_id === null) {
        updates.linked_task_id = null;
        hasUpdates = true;
      } else {
        const linkedTaskId = parsePositiveId(body.linked_task_id);
        if (!linkedTaskId) {
          return res.status(400).json({
            error: "linked_task_id must be a positive integer or null",
          });
        }
        updates.linked_task_id = linkedTaskId;
        hasUpdates = true;
      }
    }

    if (!hasUpdates) {
      return res.status(400).json({ error: "no updates provided" });
    }

    try {
      const roadmapItem = updateRoadmapItem(roadmapItemId, updates);
      if (!roadmapItem) {
        return res.status(404).json({ error: "roadmap item not found" });
      }

      return res.json(roadmapItem);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.delete(`${roadmapItemsBase}/:id`, (req, res) => {
    const roadmapItemId = parsePositiveId(req.params.id);
    if (!roadmapItemId) {
      return res.status(400).json({ error: "invalid roadmap item id" });
    }

    try {
      const deleted = deleteRoadmapItem(roadmapItemId);
      if (!deleted) {
        return res.status(404).json({ error: "roadmap item not found" });
      }

      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.get(projectsBase, (_req, res) => {
    try {
      const projects = getProjects();
      return res.json(projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.post(projectsBase, (req, res) => {
    const { name, color } = req.body as { name?: unknown; color?: unknown };
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name required" });
    }

    if (
      typeof color !== "undefined" &&
      color !== null &&
      typeof color !== "string"
    ) {
      return res.status(400).json({ error: "color must be a string" });
    }

    try {
      const project = createProject({
        name,
        color: typeof color === "string" ? color : undefined,
      });
      return res.status(201).json(project);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.delete(`${projectsBase}/:id`, (req, res) => {
    const projectId = parsePositiveId(req.params.id);
    if (!projectId) {
      return res.status(400).json({ error: "invalid project id" });
    }

    try {
      const deleted = deleteProject(projectId);
      if (!deleted) {
        return res.status(404).json({ error: "project not found" });
      }

      return res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  });

  app.get(`${tasksBase}/:taskId/projects`, asyncHandler(async (req, res) => {
    const taskId = parseTaskId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(taskId);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const projects = getTaskProjects(taskId);
      return res.json(projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  }));

  app.post(`${tasksBase}/:taskId/projects`, asyncHandler(async (req, res) => {
    const taskId = parseTaskId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const { project_id, projectIds } = req.body as {
      project_id?: unknown;
      projectIds?: unknown;
    };

    const task = await taskSyncLayer.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: "task not found" });
    }

    const allProjectIds = new Set<number>(
      getProjects().map((project: any) => project.id),
    );

    if (typeof projectIds !== "undefined") {
      const parsedProjectIds = parsePositiveIdList(projectIds);
      if (!parsedProjectIds) {
        return res
          .status(400)
          .json({ error: "projectIds must be an array of positive integers" });
      }

      for (const candidateId of parsedProjectIds) {
        if (!allProjectIds.has(candidateId)) {
          return res
            .status(404)
            .json({ error: `project ${candidateId} not found` });
        }
      }

      try {
        const projects = replaceTaskProjects(taskId, parsedProjectIds);
        return res.json(projects);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return res
          .status(statusForStrategicError(message))
          .json({ error: message });
      }
    }

    const projectId = parsePositiveId(project_id);
    if (!projectId) {
      return res
        .status(400)
        .json({ error: "project_id must be a positive integer" });
    }

    if (!allProjectIds.has(projectId)) {
      return res.status(404).json({ error: "project not found" });
    }

    try {
      const currentIds = getTaskProjects(taskId).map((project: any) => project.id);
      const projects = replaceTaskProjects(taskId, [...currentIds, projectId]);
      return res.status(201).json(projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  }));

  app.delete(`${tasksBase}/:taskId/projects`, asyncHandler(async (req, res) => {
    const taskId = parseTaskId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: "invalid task id" });
    }

    const projectId = parsePositiveId(req.body?.project_id);
    if (!projectId) {
      return res
        .status(400)
        .json({ error: "project_id must be a positive integer" });
    }

    try {
      const task = await taskSyncLayer.getTask(taskId);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const currentProjects = getTaskProjects(taskId);
      if (!currentProjects.some((project: any) => project.id === projectId)) {
        return res.status(404).json({ error: "task project link not found" });
      }
      const projects = replaceTaskProjects(
        taskId,
        currentProjects
          .map((project: any) => project.id)
          .filter((currentId: number) => currentId !== projectId),
      );
      return res.json(projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  }));

  app.get(`${tasksBase}/:taskId/history`, asyncHandler(async (req, res) => {
    const taskId = parseTaskId(req.params.taskId);
    if (!taskId) {
      return res.status(400).json({ error: "invalid task id" });
    }

    try {
      const task = await taskSyncLayer.getTask(taskId);
      if (!task) {
        return res.status(404).json({ error: "task not found" });
      }

      const history = getTaskHistory(taskId);
      return res.json(history);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return res
        .status(statusForStrategicError(message))
        .json({ error: message });
    }
  }));
}

