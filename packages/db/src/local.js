"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLocalTaskAdapter = createLocalTaskAdapter;
const index_1 = require("./index");
function createLocalTaskAdapter(options = {}) {
    const repository = options.repository ?? (0, index_1.createTaskRepository)();
    return {
        mode: 'LOCAL',
        listTasks: async () => repository.listTasks(),
        getTask: async (id) => repository.getTask(id),
        createTask: async (input) => repository.createTask(input),
        updateTask: async (id, updates) => repository.updateTask(id, updates),
        moveTask: async (id, nextColumn) => repository.moveTask(id, nextColumn),
        deleteTask: async (id) => repository.deleteTask(id),
    };
}
