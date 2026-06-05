import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FileSystemEpisodeStore } from "../src/fs-episode-store.js";
import type { Episode } from "@exp-loop/core";

function makeEpisode(overrides?: Partial<Episode>): Episode {
  return {
    id: "ep_test_001",
    task: {
      id: "task_001",
      description: "Test task",
      domain: "frontend",
      taskType: "bugfix",
    },
    status: "success",
    trace: {
      steps: [{ index: 0, action: "test step" }],
    },
    result: "done",
    startedAt: "2026-06-01T10:00:00Z",
    endedAt: "2026-06-01T10:30:00Z",
    ...overrides,
  };
}

describe("FileSystemEpisodeStore", () => {
  let baseDir: string;
  let store: FileSystemEpisodeStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "exp-loop-test-"));
    store = new FileSystemEpisodeStore(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("should save and retrieve an episode", async () => {
    const ep = makeEpisode();
    await store.save(ep);

    const retrieved = await store.get("ep_test_001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("ep_test_001");
    expect(retrieved!.task.domain).toBe("frontend");
    expect(retrieved!.status).toBe("success");
  });

  it("should return null for non-existent id", async () => {
    const result = await store.get("does_not_exist");
    expect(result).toBeNull();
  });

  it("should list episodes with filters", async () => {
    await store.save(makeEpisode({ id: "ep_1", status: "success" }));
    await store.save(
      makeEpisode({
        id: "ep_2",
        status: "failure",
        task: { id: "t2", description: "t", domain: "backend", taskType: "bugfix" },
      }),
    );
    await store.save(makeEpisode({ id: "ep_3", status: "success" }));

    const all = await store.list();
    expect(all).toHaveLength(3);

    const successOnly = await store.list({ status: "success" });
    expect(successOnly).toHaveLength(2);

    const frontendOnly = await store.list({ domain: "frontend" });
    expect(frontendOnly).toHaveLength(2);

    const limited = await store.list({ limit: 1 });
    expect(limited).toHaveLength(1);
  });
});
