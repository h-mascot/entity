"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCloudTaskAdapter = createCloudTaskAdapter;
const index_1 = require("./index");
function normalizeTaskColumn(value) {
    if (typeof value !== 'string') {
        return 'backlog';
    }
    const lowered = value.toLowerCase();
    return index_1.TASK_COLUMNS.includes(lowered) ? lowered : 'backlog';
}
function normalizeTimestamp(value) {
    if (typeof value === 'string') {
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString();
        }
    }
    return new Date().toISOString();
}
function normalizeNullableNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function normalizeProjectRecord(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const row = raw;
    const id = Number(row.id);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!Number.isInteger(id) || id <= 0 || !name) {
        return null;
    }
    return {
        id,
        name,
        color: typeof row.color === 'string' && row.color.trim() ? row.color.trim() : null,
        created_at: normalizeTimestamp(row.created_at),
    };
}
function normalizeTaskProjects(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map(normalizeProjectRecord).filter((project) => project !== null);
}
function normalizeTaskRecord(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const row = raw;
    const id = Number(row.id);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!Number.isInteger(id) || id <= 0 || !name) {
        return null;
    }
    return {
        id,
        name,
        description: typeof row.description === 'string' ? row.description : null,
        brief: typeof row.brief === 'string' ? row.brief : null,
        origin_channel: typeof row.origin_channel === 'string'
            ? row.origin_channel
            : typeof row.originChannel === 'string'
                ? row.originChannel
                : null,
        column: normalizeTaskColumn(row.column),
        assignee: typeof row.assignee === 'string' && row.assignee.trim() ? row.assignee : 'Unassigned',
        blocked: typeof row.blocked === 'boolean'
            ? row.blocked
            : typeof row.blocked === 'number'
                ? row.blocked !== 0
                : typeof row.blocked === 'string'
                    ? row.blocked.trim().toLowerCase() === '1' || row.blocked.trim().toLowerCase() === 'true'
                    : false,
        blocker_reason: typeof row.blocker_reason === 'string' && row.blocker_reason.trim()
            ? row.blocker_reason.trim()
            : typeof row.blockerReason === 'string' && row.blockerReason.trim()
                ? row.blockerReason.trim()
                : null,
        project: typeof row.project === 'string' && row.project.trim()
            ? row.project.trim()
            : typeof row.project_name === 'string' && row.project_name.trim()
                ? row.project_name.trim()
                : 'General',
        projects: normalizeTaskProjects(row.projects),
        due_date: typeof row.due_date === 'string' && row.due_date.trim()
            ? row.due_date.trim()
            : typeof row.dueDate === 'string' && row.dueDate.trim()
                ? row.dueDate.trim()
                : null,
        priority: typeof row.priority === 'string' && row.priority.trim()
            ? row.priority.trim()
            : typeof row.priorityLevel === 'string' && row.priorityLevel.trim()
                ? row.priorityLevel.trim()
                : null,
        estimate_hours: normalizeNullableNumber(typeof row.estimate_hours !== 'undefined' ? row.estimate_hours : row.estimateHours),
        time_spent: normalizeNullableNumber(typeof row.time_spent !== 'undefined' ? row.time_spent : row.timeSpent),
        output: typeof row.output === 'string' ? row.output : null,
        progress_status: typeof row.progress_status === 'string'
            ? row.progress_status
            : typeof row.progressStatus === 'string'
                ? row.progressStatus
                : null,
        recurring: typeof row.recurring === 'boolean'
            ? row.recurring
            : typeof row.recurring === 'number'
                ? row.recurring !== 0
                : typeof row.recurring === 'string'
                    ? row.recurring.trim().toLowerCase() === '1' || row.recurring.trim().toLowerCase() === 'true'
                    : false,
        recurring_config: typeof row.recurring_config === 'string'
            ? row.recurring_config
            : typeof row.recurringConfig === 'string'
                ? row.recurringConfig
                : null,
        model: typeof row.model === 'string' ? row.model : null,
        archived: typeof row.archived === 'boolean'
            ? row.archived
            : typeof row.archived === 'number'
                ? row.archived !== 0
                : typeof row.archived === 'string'
                    ? row.archived.trim().toLowerCase() === '1' || row.archived.trim().toLowerCase() === 'true'
                    : false,
        created_at: normalizeTimestamp(row.created_at),
        updated_at: normalizeTimestamp(row.updated_at ?? row.created_at),
        metadata: typeof row.metadata === 'string' ? row.metadata : null,
    };
}
function toTaskList(payload) {
    if (Array.isArray(payload)) {
        return payload.map(normalizeTaskRecord).filter((task) => task !== null);
    }
    if (payload && typeof payload === 'object') {
        const record = payload;
        if (Array.isArray(record.tasks)) {
            return record.tasks.map(normalizeTaskRecord).filter((task) => task !== null);
        }
    }
    return [];
}
function toSingleTask(payload) {
    if (!payload || typeof payload !== 'object') {
        return null;
    }
    const direct = normalizeTaskRecord(payload);
    if (direct) {
        return direct;
    }
    const record = payload;
    if (record.task && typeof record.task === 'object') {
        return normalizeTaskRecord(record.task);
    }
    return null;
}
async function readJson(response) {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        throw new Error('Cloud adapter received invalid JSON.');
    }
}
function extractErrorMessage(payload, status) {
    if (payload && typeof payload === 'object') {
        const record = payload;
        if (typeof record.error === 'string' && record.error.trim()) {
            return record.error.trim();
        }
    }
    return `Cloud request failed with status ${status}.`;
}
function sanitizeBaseUrl(baseUrl) {
    return baseUrl.trim().replace(/\/+$/, '');
}
function buildTaskUrls(baseUrl, endpoint) {
    return [`${baseUrl}/api${endpoint}`, `${baseUrl}${endpoint}`];
}
async function requestTaskApi(baseUrl, fetchImpl, endpoint, init, headers, allowNotFound = false) {
    const urls = buildTaskUrls(baseUrl, endpoint);
    let lastError = null;
    for (let index = 0; index < urls.length; index += 1) {
        const url = urls[index];
        try {
            const response = await fetchImpl(url, {
                ...init,
                headers: {
                    ...headers,
                    ...(init?.headers ?? {}),
                },
            });
            const payload = await readJson(response);
            if (response.status === 404 && index < urls.length - 1) {
                continue;
            }
            if (response.status === 404 && allowNotFound) {
                return { payload: null, notFound: true };
            }
            if (!response.ok) {
                throw new Error(extractErrorMessage(payload, response.status));
            }
            return { payload, notFound: false };
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error('Cloud request failed.');
        }
    }
    if (allowNotFound) {
        return { payload: null, notFound: true };
    }
    if (lastError) {
        throw lastError;
    }
    throw new Error('Cloud request failed.');
}
function createCloudTaskAdapter(options) {
    const baseUrl = sanitizeBaseUrl(options.baseUrl);
    const fetchImpl = options.fetchImpl ?? fetch;
    const baseHeaders = options.headers ?? {};
    async function listTasks() {
        const { payload } = await requestTaskApi(baseUrl, fetchImpl, '/tasks', undefined, baseHeaders);
        return toTaskList(payload);
    }
    async function getTask(id) {
        const { payload, notFound } = await requestTaskApi(baseUrl, fetchImpl, `/tasks/${id}`, undefined, baseHeaders, true);
        if (notFound) {
            return undefined;
        }
        return toSingleTask(payload) ?? undefined;
    }
    async function createTask(input) {
        const { payload } = await requestTaskApi(baseUrl, fetchImpl, '/tasks', {
            method: 'POST',
            body: JSON.stringify(input),
        }, {
            'Content-Type': 'application/json',
            ...baseHeaders,
        });
        const task = toSingleTask(payload);
        if (!task) {
            throw new Error('Cloud createTask returned an invalid task payload.');
        }
        return task;
    }
    async function updateTask(id, updates) {
        const { payload, notFound } = await requestTaskApi(baseUrl, fetchImpl, `/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify(updates),
        }, {
            'Content-Type': 'application/json',
            ...baseHeaders,
        }, true);
        if (notFound) {
            return undefined;
        }
        return toSingleTask(payload) ?? undefined;
    }
    async function moveTask(id, nextColumn) {
        const { payload, notFound } = await requestTaskApi(baseUrl, fetchImpl, `/tasks/${id}/move`, {
            method: 'PUT',
            body: JSON.stringify({ column: nextColumn }),
        }, {
            'Content-Type': 'application/json',
            ...baseHeaders,
        }, true);
        if (notFound) {
            return undefined;
        }
        return toSingleTask(payload) ?? undefined;
    }
    async function deleteTask(id) {
        const { notFound } = await requestTaskApi(baseUrl, fetchImpl, `/tasks/${id}`, {
            method: 'DELETE',
        }, baseHeaders, true);
        return !notFound;
    }
    return {
        mode: 'CLOUD',
        listTasks,
        getTask,
        createTask,
        updateTask,
        moveTask,
        deleteTask,
    };
}
