import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FileSystemPatternStore } from "../src/fs-pattern-store.js";
import type { Pattern } from "@exp-loop/core";

function makePattern(overrides?: Partial<Pattern>): Pattern {
  return {
    id: "pat_test_001",
    domain: "frontend",
    taskType: "bugfix",
    signature: "frontend::bugfix",
    matchedEpisodeIds: ["ep_001"],
    commonSteps: ["inspect", "fix", "test"],
    support: 1,
    successRate: 1,
    confidence: 0.3,
    promotion: "none",
    ...overrides,
  };
}

describe("FileSystemPatternStore", () => {
  let baseDir: string;
  let store: FileSystemPatternStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "exp-loop-test-"));
    store = new FileSystemPatternStore(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("should save and retrieve a pattern", async () => {
    await store.save(makePattern());
    const retrieved = await store.get("pat_test_001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.signature).toBe("frontend::bugfix");
  });

  it("should list all patterns", async () => {
    await store.save(makePattern({ id: "pat_1" }));
    await store.save(makePattern({ id: "pat_2" }));

    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it("should update pattern fields", async () => {
    await store.save(makePattern());
    await store.update("pat_test_001", {
      support: 3,
      promotion: "candidate_skill",
    });

    const updated = await store.get("pat_test_001");
    expect(updated!.support).toBe(3);
    expect(updated!.promotion).toBe("candidate_skill");
  });
});
