import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSkillExporter } from "../src/skill-exporter.js";
import type { Skill, SkillRegistry, SkillSummary, SkillProposal, SkillUsage, SkillQuery } from "@exp-loop/core";

const mockSkill: Skill = {
  id: "skill_test_1",
  name: "frontend-bugfix-workflow",
  description: "Standard workflow for fixing frontend bugs",
  domain: "frontend",
  taskType: "bugfix",
  scope: "domain",
  triggers: ["css", "layout", "bugfix"],
  version: "1.0.0",
  status: "active",
  sourcePatternIds: ["pat_1"],
  sourceExperienceIds: ["exp_1"],
  content: "# Frontend Bugfix Workflow\n\n## Steps\n1. Inspect the component\n2. Identify the issue\n3. Apply fix\n4. Test",
  createdAt: "2026-06-01T10:00:00.000Z",
  updatedAt: "2026-06-01T10:00:00.000Z",
};

function makeSkillRegistry(skill: Skill | null): SkillRegistry {
  return {
    async listSummaries() { return []; },
    async load(id: string) { return skill?.id === id ? skill : null; },
    async saveDraft(p: SkillProposal) { return {} as Skill; },
    async activate() {},
    async deprecate() {},
    async markUsed() {},
  };
}

describe("createSkillExporter", () => {
  let tmpDir: string;
  let dataDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "exporter-test-"));
    dataDir = join(tmpDir, ".exp-loop");
    await mkdir(dataDir, { recursive: true });
  });

  it("exports a skill to the target directory", async () => {
    const exporter = createSkillExporter({
      skillRegistry: makeSkillRegistry(mockSkill),
      dataDir,
    });

    const result = await exporter.export({
      skillId: "skill_test_1",
      targetDir: join(tmpDir, "skills"),
    });

    expect(result.path).toContain("frontend-bugfix-workflow/SKILL.md");

    const content = await readFile(result.path, "utf-8");
    expect(content).toContain("name: frontend-bugfix-workflow");
    expect(content).toContain("# Frontend Bugfix Workflow");
    expect(content).toContain("1. Inspect the component");
  });

  it("records a SkillDelivery on export", async () => {
    const exporter = createSkillExporter({
      skillRegistry: makeSkillRegistry(mockSkill),
      dataDir,
    });

    const result = await exporter.export({
      skillId: "skill_test_1",
      targetDir: join(tmpDir, "skills"),
    });

    expect(result.delivery.skillId).toBe("skill_test_1");
    expect(result.delivery.skillName).toBe("frontend-bugfix-workflow");
    expect(result.delivery.scope).toBe("domain");

    const deliveries = await exporter.listDeliveries();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].skillId).toBe("skill_test_1");
  });

  it("throws when skill not found", async () => {
    const exporter = createSkillExporter({
      skillRegistry: makeSkillRegistry(null),
      dataDir,
    });

    await expect(
      exporter.export({ skillId: "nonexistent", targetDir: tmpDir }),
    ).rejects.toThrow("Skill not found");
  });

  it("throws on overwrite conflict without overwrite flag", async () => {
    const exporter = createSkillExporter({
      skillRegistry: makeSkillRegistry(mockSkill),
      dataDir,
    });

    await exporter.export({
      skillId: "skill_test_1",
      targetDir: join(tmpDir, "skills"),
    });

    await expect(
      exporter.export({
        skillId: "skill_test_1",
        targetDir: join(tmpDir, "skills"),
      }),
    ).rejects.toThrow("already exists");
  });

  it("allows overwrite with flag", async () => {
    const exporter = createSkillExporter({
      skillRegistry: makeSkillRegistry(mockSkill),
      dataDir,
    });

    await exporter.export({
      skillId: "skill_test_1",
      targetDir: join(tmpDir, "skills"),
    });

    const result = await exporter.export({
      skillId: "skill_test_1",
      targetDir: join(tmpDir, "skills"),
      overwrite: true,
    });

    expect(result.path).toContain("SKILL.md");
    const deliveries = await exporter.listDeliveries();
    expect(deliveries).toHaveLength(2);
  });
});
