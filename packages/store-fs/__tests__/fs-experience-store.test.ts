import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { FileSystemExperienceStore } from "../src/fs-experience-store.js";
import type { Experience } from "@exp-loop/core";

function makeExperience(overrides?: Partial<Experience>): Experience {
  return {
    id: "exp_test_001",
    title: "Use overflow-hidden for sidebar",
    domain: "frontend",
    taskType: "bugfix",
    scope: "domain",
    triggers: ["css", "overflow"],
    problem: "Sidebar overflows on resize",
    recommendation: "Use overflow: hidden instead of scroll for sidebar containers",
    avoid: ["overflow: scroll on sidebars"],
    applyWhen: ["Working with sidebar components"],
    evidence: ["ep_001: scroll caused layout shift"],
    sourceEpisodeIds: ["ep_001"],
    confidence: 0.85,
    version: 1,
    status: "active",
    createdAt: "2026-06-01T11:00:00Z",
    updatedAt: "2026-06-01T11:00:00Z",
    ...overrides,
  };
}

describe("FileSystemExperienceStore", () => {
  let baseDir: string;
  let store: FileSystemExperienceStore;

  beforeEach(async () => {
    baseDir = await mkdtemp(join(tmpdir(), "exp-loop-test-"));
    store = new FileSystemExperienceStore(baseDir);
  });

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  it("should save experience as Markdown with frontmatter", async () => {
    const exp = makeExperience();
    await store.save(exp);

    const filePath = join(baseDir, "experiences", "domain", "frontend", "exp_test_001.md");
    const content = await readFile(filePath, "utf-8");

    expect(content).toContain("---");
    expect(content).toContain("## Problem");
    expect(content).toContain("## Recommendation");
    expect(content).toContain("## Apply When");
    expect(content).toContain("## Avoid");
    expect(content).toContain("overflow: hidden");
  });

  it("should round-trip serialize/deserialize", async () => {
    const exp = makeExperience();
    await store.save(exp);

    const retrieved = await store.get("exp_test_001");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe("exp_test_001");
    expect(retrieved!.title).toBe("Use overflow-hidden for sidebar");
    expect(retrieved!.recommendation).toContain("overflow: hidden");
    expect(retrieved!.applyWhen).toEqual(["Working with sidebar components"]);
    expect(retrieved!.avoid).toEqual(["overflow: scroll on sidebars"]);
    expect(retrieved!.confidence).toBe(0.85);
    expect(retrieved!.version).toBe(1);
  });

  it("should list experiences with filters", async () => {
    await store.save(makeExperience({ id: "exp_1", domain: "frontend", scope: "domain" }));
    await store.save(makeExperience({ id: "exp_2", domain: "backend", scope: "domain" }));
    await store.save(makeExperience({ id: "exp_3", scope: "global", domain: undefined }));

    const all = await store.list();
    expect(all).toHaveLength(3);

    const frontendOnly = await store.list({ domain: "frontend" });
    expect(frontendOnly).toHaveLength(1);
    expect(frontendOnly[0].id).toBe("exp_1");

    const globalOnly = await store.list({ scope: "global" });
    expect(globalOnly).toHaveLength(1);
    expect(globalOnly[0].id).toBe("exp_3");
  });

  it("should update experience fields", async () => {
    await store.save(makeExperience());
    await store.update("exp_test_001", {
      needsReview: true,
      sourceEpisodeIds: ["ep_001", "ep_002"],
      updatedAt: "2026-06-02T00:00:00Z",
    });

    const updated = await store.get("exp_test_001");
    expect(updated!.needsReview).toBe(true);
    expect(updated!.sourceEpisodeIds).toEqual(["ep_001", "ep_002"]);
  });

  it("should record usage to JSONL", async () => {
    await store.recordUsage({
      experienceId: "exp_001",
      episodeId: "ep_001",
      matchedAt: "2026-06-01T10:00:00Z",
      injected: true,
      outcome: "helped",
    });

    const usageFile = join(baseDir, "usage", "experience-usage.jsonl");
    const content = await readFile(usageFile, "utf-8");
    const line = JSON.parse(content.trim());

    expect(line.experienceId).toBe("exp_001");
    expect(line.outcome).toBe("helped");
    expect(line._ts).toBeDefined();
  });
});
