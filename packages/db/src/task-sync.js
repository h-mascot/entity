"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDbMode = normalizeDbMode;
exports.createTaskSyncLayer = createTaskSyncLayer;
const cloud_1 = require("./cloud");
const local_1 = require("./local");
const DB_MODE_ENV_KEYS = ['ENTITY_DB_MODE', 'DB_MODE'];
const CLOUD_BASE_ENV_KEYS = ['ENTITY_CLOUD_API_BASE', 'CLOUD_API_BASE'];
const PLATFORM_ENV_KEYS = ['ENTITY_RUNTIME', 'ENTITY_PLATFORM'];
function normalizeString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}
function normalizeDbMode(value) {
    const normalized = normalizeString(value);
    if (!normalized) {
        return null;
    }
    const upper = normalized.toUpperCase();
    if (upper === 'LOCAL' || upper === 'CLOUD') {
        return upper;
    }
    return null;
}
function readFirstDefinedEnv(keys) {
    for (const key of keys) {
        const value = normalizeString(process.env[key]);
        if (value) {
            return value;
        }
    }
    return null;
}
function prefersLocalRuntime(platform) {
    if (!platform) {
        return false;
    }
    const normalized = platform.toLowerCase();
    return normalized === 'electron' || normalized === 'desktop' || normalized === 'mobile';
}
function resolveCloudBaseUrl(explicitBaseUrl) {
    const explicit = normalizeString(explicitBaseUrl);
    if (explicit) {
        return explicit;
    }
    return readFirstDefinedEnv(CLOUD_BASE_ENV_KEYS);
}
function resolvePlatform(explicitPlatform) {
    const explicit = normalizeString(explicitPlatform);
    if (explicit) {
        return explicit;
    }
    return readFirstDefinedEnv(PLATFORM_ENV_KEYS);
}
function createTaskSyncLayer(options = {}) {
    const localAdapter = (0, local_1.createLocalTaskAdapter)(options.local);
    const cloudBaseUrl = resolveCloudBaseUrl(options.cloudBaseUrl);
    const cloudAdapter = cloudBaseUrl
        ? (0, cloud_1.createCloudTaskAdapter)({
            baseUrl: cloudBaseUrl,
            ...options.cloud,
        })
        : null;
    let runtimeModeOverride = normalizeDbMode(options.mode);
    const runtimePlatform = resolvePlatform(options.platform);
    function resolveMode() {
        if (runtimeModeOverride === 'CLOUD' && cloudAdapter) {
            return 'CLOUD';
        }
        if (runtimeModeOverride === 'LOCAL') {
            return 'LOCAL';
        }
        for (const key of DB_MODE_ENV_KEYS) {
            const envMode = normalizeDbMode(process.env[key]);
            if (!envMode) {
                continue;
            }
            if (envMode === 'CLOUD' && cloudAdapter) {
                return 'CLOUD';
            }
            return 'LOCAL';
        }
        if (prefersLocalRuntime(runtimePlatform)) {
            return 'LOCAL';
        }
        return cloudAdapter ? 'CLOUD' : 'LOCAL';
    }
    function getAdapter() {
        return resolveMode() === 'CLOUD' && cloudAdapter ? cloudAdapter : localAdapter;
    }
    return {
        getMode: () => resolveMode(),
        setMode: (mode) => {
            runtimeModeOverride = mode;
        },
        hasCloudAdapter: () => Boolean(cloudAdapter),
        listTasks: () => getAdapter().listTasks(),
        getTask: (id) => getAdapter().getTask(id),
        createTask: (input) => getAdapter().createTask(input),
        updateTask: (id, updates) => getAdapter().updateTask(id, updates),
        moveTask: (id, nextColumn) => getAdapter().moveTask(id, nextColumn),
        deleteTask: (id) => getAdapter().deleteTask(id),
    };
}
