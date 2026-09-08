import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureSampleTasks } from "./sample-tasks";

interface StoredTask {
  id: number;
  name: string;
  column: string;
}

function createPersistentTaskLayer() {
  let nextId = 1;
  let tasks: StoredTask[] = [];
  return {
    layer: {
      listTasks: vi.fn(async () => [...tasks]),
      createTask: vi.fn(async (input: { name: string; column: string }) => {
        const created = { id: nextId++, name: input.name, column: input.column };
        tasks.push(created);
        return created;
      }),
    },
    deleteAll: () => {
      tasks = [];
    },
    list: () => [...tasks],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sample task seeding", () => {
  it("does not recreate deleted samples on restart when ENTITY_SEED_SAMPLE_DATA is absent", async () => {
    const store = createPersistentTaskLayer();
    const logActivity = vi.fn();

    vi.stubEnv("ENTITY_SEED_SAMPLE_DATA", "true");
    await ensureSampleTasks({ logActivity, taskSyncLayer: store.layer });
    expect(store.list()).toHaveLength(4);

    store.deleteAll();
    vi.stubEnv("ENTITY_SEED_SAMPLE_DATA", undefined);
    await ensureSampleTasks({ logActivity, taskSyncLayer: store.layer });

    expect(store.list()).toEqual([]);
    expect(store.layer.createTask).toHaveBeenCalledTimes(4);
  });

  it.each(["true", "TRUE", "1", "on", "ON", "yes", " yes "])(
    "seeds only for explicit opt-in value %j",
    async (value) => {
      const store = createPersistentTaskLayer();
      vi.stubEnv("ENTITY_SEED_SAMPLE_DATA", value);

      await ensureSampleTasks({ logActivity: vi.fn(), taskSyncLayer: store.layer });

      expect(store.list()).toHaveLength(4);
    },
  );

  it.each([undefined, "", "false", "0", "off", "no", "enabled", "2"])(
    "stays disabled for non-opt-in value %j",
    async (value) => {
      const store = createPersistentTaskLayer();
      vi.stubEnv("ENTITY_SEED_SAMPLE_DATA", value);

      await ensureSampleTasks({ logActivity: vi.fn(), taskSyncLayer: store.layer });

      expect(store.list()).toEqual([]);
    },
  );
});
