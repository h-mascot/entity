import express from "express";
import http from "http";
import { afterEach, describe, expect, it } from "vitest";
import { registerTaskRoutes } from "./tasks";

const servers: http.Server[] = [];

const task = {
  id: 19,
  org_id: "org-a",
  team_id: "team-claims",
  name: "Review claim",
  column: "todo",
  metadata: {},
};

async function setup() {
  // REC-006 adaptation: main's trust model treats a request without a customer
  // principal as the trusted service path (see principals/request-context.ts),
  // so no request stubbing is required for these navigation tests.
  const app = express();

  const deps = {
    activityRepository: {
      listActivitiesByTaskId: () => [],
    },
    enrichTasksWithSubtaskSummary: (tasks: unknown[]) => tasks,
    parseTaskId: (value: string) => {
      const id = Number.parseInt(value, 10);
      return Number.isInteger(id) && id > 0 ? id : null;
    },
    readParentTaskId: () => null,
    taskSyncLayer: {
      getTask: async (id: number) => id === task.id ? task : null,
      listSubtasks: async () => [],
    },
  };

  registerTaskRoutes(app, "", deps);
  registerTaskRoutes(app, "/api", deps);
  app.get("*", (_req, res) => {
    res.type("html").send("<main>Entity application shell</main>");
  });

  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("test server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) =>
    new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })));
});

describe("task browser navigation", () => {
  it("falls through the legacy task path to the SPA for HTML navigation", async () => {
    const baseUrl = await setup();

    const response = await fetch(`${baseUrl}/tasks/19`, {
      headers: { accept: "text/html" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("Entity application shell");
  });

  it("keeps the prefixed task API JSON response", async () => {
    const baseUrl = await setup();

    const response = await fetch(`${baseUrl}/api/tasks/19`, {
      headers: { accept: "application/json" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      id: 19,
      name: "Review claim",
    });
  });
});
